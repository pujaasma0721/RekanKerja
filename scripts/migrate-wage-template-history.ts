// Task 64 — EmployeeWageTemplateHistory: riwayat template upah effective-dated
// ===========================================================================
// Tabel riwayat pergantian template upah per karyawan (pola EmployeeAssignment):
// setiap perubahan menutup baris lama (validTo) & membuka baris baru (validFrom).
// Run payroll membaca versi BERLAKU pada period — perubahan template mid-year
// tidak merusak run bulan sebelumnya.
//
// Untuk tenant existing: tabel dibuat idempoten + BACKFILL satu baris per
// profil payroll aktif (validFrom = joinDate/created profil, template = nilai
// sekarang) sehingga run historis tetap punya versi yang bisa dibaca.
// Fresh tenant: tenant-ddl.sql sudah memuat tabel; backfill tetap aman
// (hanya mengisi karyawan yang belum punya baris riwayat).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI.
import "./lib/env";
import { Client } from "pg";
import { tenantSchemas } from "../src/rekankerja/shared/lib/parity-runner";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[wage-template-history] belum ada tenant — lewati");
    return;
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "EmployeeWageTemplateHistory" (
          "id" TEXT NOT NULL,
          "employeeId" TEXT NOT NULL,
          "wageTemplateId" TEXT,
          "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "validTo" TIMESTAMP(3),
          "changeReason" TEXT NOT NULL DEFAULT 'Initial',
          "sourceDocNo" TEXT,
          "notes" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "EmployeeWageTemplateHistory_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "EmployeeWageTemplateHistory_employeeId_validFrom_idx" ON "EmployeeWageTemplateHistory"("employeeId", "validFrom")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "EmployeeWageTemplateHistory_wageTemplateId_idx" ON "EmployeeWageTemplateHistory"("wageTemplateId")`);
      // Backfill: satu baris "Initial" per profil payroll yang belum punya
      // riwayat — memastikan run apa pun punya versi template yang terbaca.
      const res = await c.query(`
        INSERT INTO "EmployeeWageTemplateHistory" ("id", "employeeId", "wageTemplateId", "validFrom", "changeReason")
        SELECT
          'thh_' || md5(random()::text || clock_timestamp()::text),
          p."employeeId",
          p."wageTemplateId",
          -- NOTE: EmployeePayrollProfile TIDAK punya kolom createdAt (model/DDL/
          -- DB nyata) — jangan referensikan. Fallback: joinDate karyawan, lalu NOW().
          COALESCE(e."joinDate", CURRENT_TIMESTAMP),
          'Initial'
        FROM "EmployeePayrollProfile" p
        JOIN "Employee" e ON e."id" = p."employeeId"
        WHERE NOT EXISTS (
          SELECT 1 FROM "EmployeeWageTemplateHistory" h WHERE h."employeeId" = p."employeeId"
        )`);
      console.log(`[${schema}] EmployeeWageTemplateHistory siap; backfill ${res.rowCount ?? 0} baris`);
    }
  } finally {
    await c.end().catch(() => {});
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-wage-template-history.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
