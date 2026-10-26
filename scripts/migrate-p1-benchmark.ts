// Migrasi P1-BENCHMARK (DEVELOPMENT-PLAN-BENCHMARK.md §4 P1) — SEMUA idempoten
// (pola migrate-recruitment-b8-referral):
//   1. ALTER TABLE "EmployeeFamily" ADD COLUMN IF NOT EXISTS "nationalId" TEXT
//      (D-BM4 — NIK anggota keluarga, terenkripsi aplikasi enc:v1:t:).
//   2. CREATE TABLE IF NOT EXISTS "EmergencyContact" (D-BM2 — kontak darurat).
//   3. CREATE TABLE IF NOT EXISTS "EmployeeProfileChangeRequest" (D-BM1).
//   4. CREATE TABLE IF NOT EXISTS "AttendanceRegularizationRequest" (D-BM7).
//   5. CREATE TABLE IF NOT EXISTS "ReferralSubmission" (D-BM15).
//   6. Index + FK (idempoten — DROP CONSTRAINT IF EXISTS lalu ADD).
//   7. Seed komponen upah NIGHT_PREM (D-BM13 — premi malam, TIDAK aktif di
//      template mana pun; tenant menambahkannya sendiri bila ingin) — hanya
//      bila kode belum ada (INSERT ... ON CONFLICT DO NOTHING).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping modul)
// ATAU dijalankan CLI: bun run scripts/migrate-p1-benchmark.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- P1.1 — fondasi data karyawan ---
  `ALTER TABLE "EmployeeFamily" ADD COLUMN IF NOT EXISTS "nationalId" TEXT`,
  `CREATE TABLE IF NOT EXISTS "EmergencyContact" (
    "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL, "phone" TEXT NOT NULL, "address" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false, "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "EmployeeProfileChangeRequest" (
    "id" TEXT NOT NULL, "docNo" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL, "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Submitted', "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3), "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeProfileChangeRequest_pkey" PRIMARY KEY ("id"))`,
  // --- P1.3 — regularisasi absensi mandiri ---
  `CREATE TABLE IF NOT EXISTS "AttendanceRegularizationRequest" (
    "id" TEXT NOT NULL, "docNo" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
    "workDate" DATE NOT NULL, "kind" TEXT NOT NULL, "clockIn" TEXT, "clockOut" TEXT,
    "reason" TEXT NOT NULL, "attachmentIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'Submitted', "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3), "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendanceRegularizationRequest_pkey" PRIMARY KEY ("id"))`,
  // --- P1.6 — staging referral ESS ---
  `CREATE TABLE IF NOT EXISTS "ReferralSubmission" (
    "id" TEXT NOT NULL, "docNo" TEXT NOT NULL, "referrerEmployeeId" TEXT NOT NULL,
    "jobOpeningId" TEXT, "candidateName" TEXT NOT NULL, "candidateEmail" TEXT,
    "candidatePhone" TEXT, "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Submitted', "verifyNote" TEXT,
    "verifiedById" TEXT, "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralSubmission_pkey" PRIMARY KEY ("id"))`,
  // --- index ---
  `CREATE INDEX IF NOT EXISTS "EmergencyContact_employeeId_idx" ON "EmergencyContact"("employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfileChangeRequest_docNo_key" ON "EmployeeProfileChangeRequest"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "EmployeeProfileChangeRequest_employeeId_status_idx" ON "EmployeeProfileChangeRequest"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "EmployeeProfileChangeRequest_status_idx" ON "EmployeeProfileChangeRequest"("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRegularizationRequest_docNo_key" ON "AttendanceRegularizationRequest"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceRegularizationRequest_employeeId_status_idx" ON "AttendanceRegularizationRequest"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceRegularizationRequest_status_idx" ON "AttendanceRegularizationRequest"("status")`,
  `CREATE INDEX IF NOT EXISTS "AttendanceRegularizationRequest_workDate_idx" ON "AttendanceRegularizationRequest"("workDate")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReferralSubmission_docNo_key" ON "ReferralSubmission"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "ReferralSubmission_referrerEmployeeId_status_idx" ON "ReferralSubmission"("referrerEmployeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "ReferralSubmission_status_idx" ON "ReferralSubmission"("status")`,
  // --- FK (drop-if-exists lalu add — idempoten) ---
  `ALTER TABLE "EmergencyContact" DROP CONSTRAINT IF EXISTS "EmergencyContact_employeeId_fkey"`,
  `ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EmployeeProfileChangeRequest" DROP CONSTRAINT IF EXISTS "EmployeeProfileChangeRequest_employeeId_fkey"`,
  `ALTER TABLE "EmployeeProfileChangeRequest" ADD CONSTRAINT "EmployeeProfileChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EmployeeProfileChangeRequest" DROP CONSTRAINT IF EXISTS "EmployeeProfileChangeRequest_decidedById_fkey"`,
  `ALTER TABLE "EmployeeProfileChangeRequest" ADD CONSTRAINT "EmployeeProfileChangeRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "AttendanceRegularizationRequest" DROP CONSTRAINT IF EXISTS "AttendanceRegularizationRequest_employeeId_fkey"`,
  `ALTER TABLE "AttendanceRegularizationRequest" ADD CONSTRAINT "AttendanceRegularizationRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ReferralSubmission" DROP CONSTRAINT IF EXISTS "ReferralSubmission_referrerEmployeeId_fkey"`,
  `ALTER TABLE "ReferralSubmission" ADD CONSTRAINT "ReferralSubmission_referrerEmployeeId_fkey" FOREIGN KEY ("referrerEmployeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

// Seed komponen upah NIGHT_PREM (D-BM13) — hanya bila kode belum ada.
// TIDAK dimasukkan ke template mana pun (aktif per tenant secara eksplisit).
const SEED_WAGE_NIGHT_PREM = `
INSERT INTO "WageComponent" (
  "id", "code", "name", "type", "wageType", "calcMethod", "formula",
  "active", "includeInTHP", "sptReference", "createdAt"
) VALUES (
  'seed_nightprem_p1', 'NIGHT_PREM', 'Tunjangan Shift Malam', 'Earning', 'Compensation',
  'Formula', 'NIGHT_HOURS*BASE_SALARY/173', true, true, 'Tunjangan',
  CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO NOTHING`;

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-p1-benchmark] schema: ${list.join(", ")}`);
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
          // 42710 = duplicate object (kolom/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      // seed NIGHT_PREM (tabel WageComponent ada di semua schema tenant)
      try {
        await c.query(SEED_WAGE_NIGHT_PREM);
      } catch {
        // tabel belum ada di schema ini (tenant sangat awal) — dilewati
      }
      for (const tbl of ["EmergencyContact", "EmployeeProfileChangeRequest", "AttendanceRegularizationRequest", "ReferralSubmission"]) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
          [schemaName, tbl],
        );
        console.log(`    tabel ${tbl}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
      const np = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "WageComponent" WHERE code = 'NIGHT_PREM'`,
      );
      console.log(`    komponen NIGHT_PREM: ${np.rows[0]?.n ? "ada" : "HILANG"}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI: bun run scripts/migrate-p1-benchmark.ts [schema1 schema2 ...]
if (process.argv[1] && process.argv[1].includes("migrate-p1-benchmark")) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
