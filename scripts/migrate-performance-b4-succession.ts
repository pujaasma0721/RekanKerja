// Migrasi B4-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B4; D-BL13…D-BL15) —
// SEMUA idempoten (pola migrate-performance-p0/p9/b1):
//   1. CREATE TABLE IF NOT EXISTS "SuccessionPosition" — register peran
//      kritis per Position (unique positionId + critical + targetSuccessors).
//   2. CREATE TABLE IF NOT EXISTS "SuccessorCandidate" — kandidat penerus
//      (readiness manual HR di atas saran 9-box D-BL13 + snapshot
//      suggested9Box/flightRisk + devNotes TEKS — D-BL14).
//   3. Index + FK drop-add idempoten — selaras prisma/schema-tenant.prisma &
//      prisma/tenant-ddl.sql (pola F0–F9/P0/B1).
// Tidak ada seed data. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-performance-b4-succession.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- SuccessionPosition (D-BL14: per Position — flag kritis + target ≥2) ---
  `CREATE TABLE IF NOT EXISTS "SuccessionPosition" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT true,
    "targetSuccessors" INTEGER NOT NULL DEFAULT 2,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SuccessionPosition_pkey" PRIMARY KEY ("id")
  )`,
  // --- SuccessorCandidate (D-BL13/D-BL14: readiness + snapshot + devNotes) ---
  `CREATE TABLE IF NOT EXISTS "SuccessorCandidate" (
    "id" TEXT NOT NULL,
    "successionPositionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readiness" TEXT NOT NULL,
    "suggested9Box" TEXT,
    "flightRisk" DOUBLE PRECISION,
    "devNotes" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SuccessorCandidate_pkey" PRIMARY KEY ("id")
  )`,
  // --- index ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "SuccessionPosition_positionId_key" ON "SuccessionPosition"("positionId")`,
  `CREATE INDEX IF NOT EXISTS "SuccessorCandidate_employeeId_idx" ON "SuccessorCandidate"("employeeId")`,
  // --- unique satu karyawan per peran (guard duplikat 409) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "SuccessorCandidate_successionPositionId_employeeId_key" ON "SuccessorCandidate"("successionPositionId", "employeeId")`,
  // --- FK drop-add idempoten (pola P0/B1) ---
  `ALTER TABLE "SuccessionPosition" DROP CONSTRAINT IF EXISTS "SuccessionPosition_positionId_fkey"`,
  `ALTER TABLE "SuccessionPosition" ADD CONSTRAINT "SuccessionPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "SuccessorCandidate" DROP CONSTRAINT IF EXISTS "SuccessorCandidate_successionPositionId_fkey"`,
  `ALTER TABLE "SuccessorCandidate" ADD CONSTRAINT "SuccessorCandidate_successionPositionId_fkey" FOREIGN KEY ("successionPositionId") REFERENCES "SuccessionPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "SuccessorCandidate" DROP CONSTRAINT IF EXISTS "SuccessorCandidate_employeeId_fkey"`,
  `ALTER TABLE "SuccessorCandidate" ADD CONSTRAINT "SuccessorCandidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-b4-succession] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
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
      console.log(`    tabel SuccessionPosition/SuccessorCandidate siap`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
