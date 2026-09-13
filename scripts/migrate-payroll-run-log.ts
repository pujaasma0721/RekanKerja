// Task 63 — PayrollRunLog: log kejadian run payroll (parameter kurang/anomali)
// ===========================================================================
// Tabel baris log per kejadian selama kalkulasi run: karyawan tanpa template
// upah, tanpa profil payroll, gaji kosong/0, tanpa penempatan aktif, dll.
// Fresh tenant mendapat tabel dari tenant-ddl.sql; tenant existing via step
// parity ini (idempoten — CREATE TABLE IF NOT EXISTS + index).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI.
import "./lib/env";
import { Client } from "pg";
import { tenantSchemas } from "../src/onevity/shared/lib/parity-runner";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[payroll-run-log] belum ada tenant — lewati");
    return;
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "PayrollRunLog" (
          "id" TEXT NOT NULL,
          "runId" TEXT NOT NULL,
          "employeeId" TEXT,
          "employeeNo" TEXT,
          "employeeName" TEXT,
          "level" TEXT NOT NULL DEFAULT 'warning',
          "code" TEXT NOT NULL,
          "message" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "PayrollRunLog_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "PayrollRunLog_runId_idx" ON "PayrollRunLog"("runId")`);
      console.log(`[${schema}] tabel PayrollRunLog siap (idempoten)`);
    }
  } finally {
    await c.end().catch(() => {});
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-payroll-run-log.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
