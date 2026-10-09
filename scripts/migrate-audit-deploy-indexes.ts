// Migrasi AUD-DEPLOY (audit deploy-readiness 3-a H-3/H-4/M-13) ke tenant
// EXISTING — IDEMPOTEN (CREATE INDEX IF NOT EXISTS), pola migrate-task43.
//
// 9 index baru di prisma/schema-tenant.prisma (tenant-ddl.sql sudah
// diregenerasi → tenant BARU otomatis); skrip ini menutup parity tenant
// existing:
//   1. ActivityLog(createdAt)              — audit UI default sort + dashboard take-8
//   2. ActivityLog(employeeId)             — jejak akses PDP (M-9)
//   3. ActivityLog(personnelActionId)      — detail PA
//   4. AppUser(email)                      — findFirst(by email) di SETIAP guard menu/sesi
//   5. PayrollRunItem(lineId)              — include items per payslip/run (tabel tumbuh terbesar)
//   6. EmployeeLoan(employeeId, status)    — engine payroll buildRunRows
//   7. BenefitClaim(status) + (employeeId) + (periodId) — daftar/histori/penjadwalan
//   8. EmployeeFamily(employeeId)          — include family (profil payroll, PTKP)
//   9. Employee(status)                    — filter lintas modul
//  (+ PayrollJournalLine(journalId) — include lines per jurnal)
//
// Jalankan: bun scripts/migrate-audit-deploy-indexes.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const PLATFORM_URL =
  process.env.PLATFORM_DB_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const FALLBACK_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// (nama index Prisma di tenant-ddl.sql, DDL)
const INDEXES: [string, string][] = [
  ["ActivityLog_createdAt_idx", `CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt")`],
  ["ActivityLog_employeeId_idx", `CREATE INDEX IF NOT EXISTS "ActivityLog_employeeId_idx" ON "ActivityLog"("employeeId")`],
  ["ActivityLog_personnelActionId_idx", `CREATE INDEX IF NOT EXISTS "ActivityLog_personnelActionId_idx" ON "ActivityLog"("personnelActionId")`],
  ["AppUser_email_idx", `CREATE INDEX IF NOT EXISTS "AppUser_email_idx" ON "AppUser"("email")`],
  ["PayrollRunItem_lineId_idx", `CREATE INDEX IF NOT EXISTS "PayrollRunItem_lineId_idx" ON "PayrollRunItem"("lineId")`],
  ["EmployeeLoan_employeeId_status_idx", `CREATE INDEX IF NOT EXISTS "EmployeeLoan_employeeId_status_idx" ON "EmployeeLoan"("employeeId", "status")`],
  ["BenefitClaim_status_idx", `CREATE INDEX IF NOT EXISTS "BenefitClaim_status_idx" ON "BenefitClaim"("status")`],
  ["BenefitClaim_employeeId_idx", `CREATE INDEX IF NOT EXISTS "BenefitClaim_employeeId_idx" ON "BenefitClaim"("employeeId")`],
  ["BenefitClaim_periodId_idx", `CREATE INDEX IF NOT EXISTS "BenefitClaim_periodId_idx" ON "BenefitClaim"("periodId")`],
  ["EmployeeFamily_employeeId_idx", `CREATE INDEX IF NOT EXISTS "EmployeeFamily_employeeId_idx" ON "EmployeeFamily"("employeeId")`],
  ["Employee_status_idx", `CREATE INDEX IF NOT EXISTS "Employee_status_idx" ON "Employee"("status")`],
  ["PayrollJournalLine_journalId_idx", `CREATE INDEX IF NOT EXISTS "PayrollJournalLine_journalId_idx" ON "PayrollJournalLine"("journalId")`],
];

const TABLES = ["ActivityLog", "AppUser", "PayrollRunItem", "EmployeeLoan", "BenefitClaim", "EmployeeFamily", "Employee", "PayrollJournalLine"];

async function activeTenantSchemas(): Promise<{ slug: string; schemaName: string }[]> {
  const c = new Client({ connectionString: PLATFORM_URL });
  try {
    await c.connect();
    const r = await c.query<{ slug: string; schemaName: string }>(
      `SELECT "slug", "schemaName" FROM public."Tenant" WHERE "status" = 'ACTIVE' ORDER BY "slug"`,
    );
    if (r.rowCount && r.rowCount > 0) return r.rows;
  } catch (e) {
    console.warn(`[audit-deploy-indexes] registry tenant tak terbaca (${e instanceof Error ? e.message : e}) — fallback schema sandbox`);
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
  return FALLBACK_SCHEMAS.map((s) => ({ slug: s.replace(/^tenant_/, "").replace(/_/g, "-"), schemaName: s }));
}

async function migrateSchema(schemaName: string, slug: string): Promise<void> {
  console.log(`\n[${schemaName}] (${slug}) migrasi index AUD-DEPLOY…`);
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    // pre-check tabel ada (tenant parsial pra-migrasi)
    const existingTables = new Set(
      (await c.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
        [schemaName],
      )).rows.map((r) => r.table_name),
    );
    const missing = TABLES.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      console.log(`  SKIP — tabel belum ada di schema ini: ${missing.join(", ")}`);
      return;
    }

    for (const [name, ddl] of INDEXES) {
      await c.query(ddl);
      console.log(`  ✓ ${name}`);
    }

    // verifikasi: semua index terdaftar di pg_indexes
    const idx = await c.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)`,
      [schemaName, INDEXES.map(([n]) => n)],
    );
    console.log(`  verifikasi: ${idx.rowCount}/${INDEXES.length} index terdaftar di pg_indexes`);
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const list = await activeTenantSchemas();
  for (const t of list) {
    await migrateSchema(t.schemaName, t.slug);
  }
  console.log(`\nDONE — ${INDEXES.length} index AUD-DEPLOY diterapkan (idempoten) di ${list.length} tenant`);
}

main().catch((e) => { console.error(e); process.exit(1); });
