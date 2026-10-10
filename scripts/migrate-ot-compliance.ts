// Kepatuhan lembur PP 35/2021 (commit 3cd71e3) — DDL kolom AttendanceRule yang
// lupa masuk parity: otWorkweekDays (5|6) + otBasisMode (BASE|BASE_FIXED) +
// otBasisComponentCodes. Fresh tenant sudah punya kolom via tenant-ddl.sql;
// tenant existing (mis. prod) error:
//   Invalid `prisma.attendanceRule.findFirst()` invocation:
//   The column `AttendanceRule.otWorkweekDays` does not exist in the current database.
// Terjadi di getRule() (tab Pengaturan "Schedule templates", overtime engine,
// analytics, laporan). Idempoten: cek information_schema per kolom.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU dijalankan CLI.
import "./lib/env";
import { Client } from "pg";
import { tenantSchemas } from "../src/rekankerja/shared/lib/parity-runner";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const COLUMNS: [column: string, ddl: string][] = [
  [`otWorkweekDays`, `ALTER TABLE "AttendanceRule" ADD COLUMN "otWorkweekDays" INTEGER NOT NULL DEFAULT 5`],
  [`otBasisMode`, `ALTER TABLE "AttendanceRule" ADD COLUMN "otBasisMode" TEXT NOT NULL DEFAULT 'BASE'`],
  [`otBasisComponentCodes`, `ALTER TABLE "AttendanceRule" ADD COLUMN "otBasisComponentCodes" TEXT`],
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[ot-compliance] belum ada tenant — lewati");
    return;
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      // Per-schema search_path dipulihkan tiap iterasi (pola Task 64k).
      try {
        await c.query(`SET search_path TO "${schema}"`);
        const hasTable = await c.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'AttendanceRule'`,
          [schema],
        );
        if (hasTable.rowCount === 0) {
          console.log(`[${schema}] tanpa tabel AttendanceRule — skip`);
          continue;
        }
        for (const [column, ddl] of COLUMNS) {
          const exists = await c.query(
            `SELECT 1 FROM information_schema.columns
              WHERE table_schema = $1 AND table_name = 'AttendanceRule' AND column_name = $2`,
            [schema, column],
          );
          if (exists.rowCount === 0) {
            await c.query(ddl);
            console.log(`[${schema}] kolom AttendanceRule.${column} ditambahkan`);
          } else {
            console.log(`[${schema}] kolom AttendanceRule.${column} sudah ada (idempoten)`);
          }
        }
      } catch (e) {
        // Satu tenant bermasalah tidak boleh menghentikan tenant lain.
        console.error(`[${schema}] GAGAL: ${e instanceof Error ? e.message : String(e)} — lanjut`);
      }
    }
  } finally {
    await c.query("SET search_path TO public");
    await c.end();
  }
}

// CLI mandiri: npx tsx scripts/migrate-ot-compliance.ts
if (process.argv[1]?.includes("migrate-ot-compliance") && process.argv[1]?.endsWith(".ts")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
