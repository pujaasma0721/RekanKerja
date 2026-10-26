// Migrasi B5-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B5; D-BL16/D-BL17) —
// SEMUA idempoten (pola migrate-performance-b4-succession/b1):
//   1. CREATE TABLE IF NOT EXISTS "SalaryBenchmark" — master benchmark gaji
//      pasar per tahun × sumber (kunci Grade ATAU Position; p25/p50/p75).
//   2. Index + FK drop-add idempoten — selaras prisma/schema-tenant.prisma &
//      prisma/tenant-ddl.sql.
// Catatan Postgres: unique(year, sourceLabel, gradeCode, positionId) dengan
// 2 kolom nullable berperilaku NULL-distinct (dua baris serupa dengan NULL
// tidak dianggap duplikat) → guard duplikat NULL-AWARE dijalankan di SERVICE
// benchmark (409), bukan di DB.
// Tidak ada seed data. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-performance-b5-benchmark.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- SalaryBenchmark (D-BL16: master benchmark gaji — kunci grade ATAU posisi) ---
  `CREATE TABLE IF NOT EXISTS "SalaryBenchmark" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "gradeCode" TEXT,
    "positionId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "p25" DOUBLE PRECISION NOT NULL,
    "p50" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalaryBenchmark_pkey" PRIMARY KEY ("id")
  )`,
  // --- index (unique 3-kolom nullable → guard 409 null-aware di service) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "SalaryBenchmark_year_sourceLabel_gradeCode_positionId_key" ON "SalaryBenchmark"("year", "sourceLabel", "gradeCode", "positionId")`,
  `CREATE INDEX IF NOT EXISTS "SalaryBenchmark_year_gradeCode_idx" ON "SalaryBenchmark"("year", "gradeCode")`,
  // --- FK drop-add idempoten (pola P0/B1/B4 — RESTRICT: posisi terpakai benchmark tak boleh terhapus diam-diam) ---
  `ALTER TABLE "SalaryBenchmark" DROP CONSTRAINT IF EXISTS "SalaryBenchmark_positionId_fkey"`,
  `ALTER TABLE "SalaryBenchmark" ADD CONSTRAINT "SalaryBenchmark_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-b5-benchmark] schema: ${list.join(", ")}`);
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
      console.log(`    tabel SalaryBenchmark siap`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
