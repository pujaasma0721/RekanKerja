// Migrasi P9-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P9; §7.3/§37
// UU PDP) — SEMUA idempoten (pola hotfix P1/P3 pada migrate-performance-p0):
//   1. DataSubjectRequest: applicantId jadi NULLABLE + kolom employeeId +
//      FK EmployeeDsr (onDelete: SetNull) + index employeeId — perluasan DSR
//      utk KARYAWAN (data kinerja §7.3 UU PDP; DSR pelamar F9 tidak berubah).
//   2. AppraisalRecord: kolom archivedAt (retensi arsip hasil penilaian —
//      ditandai job harian perf-retention-scan; penghapusan permanen TIDAK
//      otomatis, hanya keputusan eksplisit HR).
// Tidak ada seed data. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-performance-p9.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

// ALTER idempoten — SET search_path per schema (pola migrate-performance-p0).
const DDL: string[] = [
  // --- DataSubjectRequest: DSR karyawan (P9 §7.3) ---
  `ALTER TABLE "DataSubjectRequest" ALTER COLUMN "applicantId" DROP NOT NULL`,
  `ALTER TABLE "DataSubjectRequest" ADD COLUMN IF NOT EXISTS "employeeId" TEXT`,
  `ALTER TABLE "DataSubjectRequest" DROP CONSTRAINT IF EXISTS "DataSubjectRequest_employeeId_fkey"`,
  `ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `CREATE INDEX IF NOT EXISTS "DataSubjectRequest_employeeId_idx" ON "DataSubjectRequest"("employeeId")`,
  // --- AppraisalRecord: retensi arsip (P9 §37) ---
  `ALTER TABLE "AppraisalRecord" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3)`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-p9] schema: ${list.join(", ")}`);
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
      console.log(`    DSR karyawan (employeeId nullable applicantId) + archivedAt siap`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
