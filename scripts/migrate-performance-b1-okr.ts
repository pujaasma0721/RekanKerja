// Migrasi B1-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B1; D-BL1…D-BL5) —
// SEMUA idempoten (pola migrate-performance-p0/p9):
//   1. CREATE TABLE IF NOT EXISTS "OkrObjective" + "OkrKeyResult" — modul OKR
//      kuartalan TERPISAH dari mesin penilaian (D-BL1: tidak menyentuh
//      AppraisalRecord/skor/rating/merit sama sekali).
//   2. ALTER TABLE "PerformanceSetting" ADD COLUMN IF NOT EXISTS "okrEnabled"
//      BOOLEAN NOT NULL DEFAULT false — fitur per-tenant default OFF (D-BL2).
//   3. Index + FK drop-add idempoten — selaras prisma/schema-tenant.prisma &
//      prisma/tenant-ddl.sql (pola F0–F9/P0).
// Tidak ada seed data. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-performance-b1-okr.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- OkrObjective (D-BL3/D-BL4: status Draft|Posted|Closed; align pohon dukungan) ---
  `CREATE TABLE IF NOT EXISTS "OkrObjective" (
    "id" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerEmployeeId" TEXT NOT NULL,
    "alignToId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "weight" INTEGER NOT NULL DEFAULT 100,
    "closedScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OkrObjective_pkey" PRIMARY KEY ("id")
  )`,
  // --- OkrKeyResult (D-BL4/D-BL5: 3–5 KR per objective, Σweight 100, skor server) ---
  `CREATE TABLE IF NOT EXISTS "OkrKeyResult" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "polarity" TEXT NOT NULL DEFAULT 'HigherIsBetter',
    "baseline" DOUBLE PRECISION NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 20,
    "confidence" TEXT NOT NULL DEFAULT 'Yellow',
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OkrKeyResult_pkey" PRIMARY KEY ("id")
  )`,
  // --- index ---
  `CREATE INDEX IF NOT EXISTS "OkrObjective_quarter_status_idx" ON "OkrObjective"("quarter", "status")`,
  `CREATE INDEX IF NOT EXISTS "OkrObjective_ownerEmployeeId_idx" ON "OkrObjective"("ownerEmployeeId")`,
  `CREATE INDEX IF NOT EXISTS "OkrKeyResult_objectiveId_idx" ON "OkrKeyResult"("objectiveId")`,
  // --- FK drop-add idempoten (pola P0) ---
  `ALTER TABLE "OkrObjective" DROP CONSTRAINT IF EXISTS "OkrObjective_ownerEmployeeId_fkey"`,
  `ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "OkrObjective" DROP CONSTRAINT IF EXISTS "OkrObjective_alignToId_fkey"`,
  `ALTER TABLE "OkrObjective" ADD CONSTRAINT "OkrObjective_alignToId_fkey" FOREIGN KEY ("alignToId") REFERENCES "OkrObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "OkrKeyResult" DROP CONSTRAINT IF EXISTS "OkrKeyResult_objectiveId_fkey"`,
  `ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "OkrObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "OkrKeyResult" DROP CONSTRAINT IF EXISTS "OkrKeyResult_updatedById_fkey"`,
  `ALTER TABLE "OkrKeyResult" ADD CONSTRAINT "OkrKeyResult_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  // --- PerformanceSetting.okrEnabled (D-BL2 — per-tenant default OFF) ---
  `ALTER TABLE "PerformanceSetting" ADD COLUMN IF NOT EXISTS "okrEnabled" BOOLEAN NOT NULL DEFAULT false`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-b1-okr] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      await c.query(`SET search_path TO "${schemaName}"`);
      for (const ddl of DDL) {
        try {
          await c.query(ddl);
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? "");
          // 42710 = duplicate object (constraint/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      console.log(`    tabel OkrObjective/OkrKeyResult + PerformanceSetting.okrEnabled siap`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
