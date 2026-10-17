// Migrasi P2-BENCHMARK (DEVELOPMENT-PLAN-BENCHMARK.md §4 P2) — SEMUA idempoten
// (pola migrate-p1-benchmark):
//   1. Kolom baru: PayrollRegulation.bpjsOfficeCode/bpjsInpatientClass
//      (D-BM16 — kode kantor cabang BPJS + kelas perawatan JKN),
//      ApprovalStructure.escalateDays (D-BM21 — eskalasi otomatis, null=OFF),
//      CandidateSelectionStep.inviteTokenHash/inviteTokenExpAt (D-BM18 —
//      undangan kandidat pilih slot via portal), CandidateOffer.
//      selfServiceTokenHash/selfServiceTokenExpAt (D-BM19 — putusan mandiri).
//   2. Tabel baru: InsurancePolicy + PolicyMember (D-BM20 — polis asuransi
//      grup), CandidateStepEvaluator + InterviewSlot (D-BM18 — panel
//      interview + slot), CandidateOfferVersion (D-BM19 — riwayat versi),
//      PushConfig + PushSubscription (D-BM17 — web push).
//   3. Index + unique + FK (drop-then-add — idempoten).
// Tidak ada seed data (PushConfig self-seed saat pertama kali dibaca di
// runtime; template email baru via self-heal email-defaults).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU dijalankan CLI: bun run scripts/migrate-p2-benchmark.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- kolom baru (idempoten) ---
  `ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "bpjsOfficeCode" TEXT`,
  `ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "bpjsInpatientClass" TEXT`,
  `ALTER TABLE "ApprovalStructure" ADD COLUMN IF NOT EXISTS "escalateDays" INTEGER`,
  `ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "inviteTokenHash" TEXT`,
  `ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "inviteTokenExpAt" TIMESTAMP(3)`,
  `ALTER TABLE "CandidateOffer" ADD COLUMN IF NOT EXISTS "selfServiceTokenHash" TEXT`,
  `ALTER TABLE "CandidateOffer" ADD COLUMN IF NOT EXISTS "selfServiceTokenExpAt" TIMESTAMP(3)`,
  // --- P2.5-BM (D-BM20) — polis asuransi grup + enrollment ---
  `CREATE TABLE IF NOT EXISTS "InsurancePolicy" (
    "id" TEXT NOT NULL, "providerId" TEXT NOT NULL, "policyNo" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL,
    "premiumMonthly" TEXT, "pctCompany" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'Active', "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "PolicyMember" (
    "id" TEXT NOT NULL, "policyId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
    "dependentId" TEXT, "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyMember_pkey" PRIMARY KEY ("id"))`,
  // --- P2.3-BM (D-BM18) — panel evaluator + slot jadwal wawancara ---
  `CREATE TABLE IF NOT EXISTS "CandidateStepEvaluator" (
    "id" TEXT NOT NULL, "selectionStepId" TEXT NOT NULL, "evaluatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateStepEvaluator_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "InterviewSlot" (
    "id" TEXT NOT NULL, "selectionStepId" TEXT NOT NULL, "startAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60, "status" TEXT NOT NULL DEFAULT 'Open',
    "bookedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InterviewSlot_pkey" PRIMARY KEY ("id"))`,
  // --- P2.4-BM (D-BM19) — riwayat versi offer ---
  `CREATE TABLE IF NOT EXISTS "CandidateOfferVersion" (
    "id" TEXT NOT NULL, "offerId" TEXT NOT NULL, "versionNo" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL, "label" TEXT, "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CandidateOfferVersion_pkey" PRIMARY KEY ("id"))`,
  // --- P2.2-BM (D-BM17) — web push ---
  `CREATE TABLE IF NOT EXISTS "PushConfig" (
    "id" TEXT NOT NULL, "vapidPublic" TEXT NOT NULL, "vapidPrivate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushConfig_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id" TEXT NOT NULL, "appUserId" TEXT NOT NULL, "endpoint" TEXT NOT NULL,
    "endpointHash" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"))`,
  // --- index + unique (idempoten) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "InsurancePolicy_providerId_policyNo_key" ON "InsurancePolicy"("providerId", "policyNo")`,
  `CREATE INDEX IF NOT EXISTS "InsurancePolicy_status_periodEnd_idx" ON "InsurancePolicy"("status", "periodEnd")`,
  `CREATE INDEX IF NOT EXISTS "PolicyMember_employeeId_effectiveTo_idx" ON "PolicyMember"("employeeId", "effectiveTo")`,
  `CREATE INDEX IF NOT EXISTS "PolicyMember_policyId_idx" ON "PolicyMember"("policyId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateStepEvaluator_selectionStepId_evaluatorId_key" ON "CandidateStepEvaluator"("selectionStepId", "evaluatorId")`,
  `CREATE INDEX IF NOT EXISTS "CandidateStepEvaluator_evaluatorId_idx" ON "CandidateStepEvaluator"("evaluatorId")`,
  `CREATE INDEX IF NOT EXISTS "InterviewSlot_selectionStepId_status_idx" ON "InterviewSlot"("selectionStepId", "status")`,
  `CREATE INDEX IF NOT EXISTS "InterviewSlot_status_startAt_idx" ON "InterviewSlot"("status", "startAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateOfferVersion_offerId_versionNo_key" ON "CandidateOfferVersion"("offerId", "versionNo")`,
  `CREATE INDEX IF NOT EXISTS "CandidateOfferVersion_offerId_idx" ON "CandidateOfferVersion"("offerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_appUserId_endpointHash_key" ON "PushSubscription"("appUserId", "endpointHash")`,
  `CREATE INDEX IF NOT EXISTS "PushSubscription_appUserId_idx" ON "PushSubscription"("appUserId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateSelectionStep_inviteTokenHash_key" ON "CandidateSelectionStep"("inviteTokenHash")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateOffer_selfServiceTokenHash_key" ON "CandidateOffer"("selfServiceTokenHash")`,
  // --- FK (drop-if-exists lalu add — idempoten) ---
  `ALTER TABLE "InsurancePolicy" DROP CONSTRAINT IF EXISTS "InsurancePolicy_providerId_fkey"`,
  `ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "MedicalProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PolicyMember" DROP CONSTRAINT IF EXISTS "PolicyMember_policyId_fkey"`,
  `ALTER TABLE "PolicyMember" ADD CONSTRAINT "PolicyMember_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "PolicyMember" DROP CONSTRAINT IF EXISTS "PolicyMember_employeeId_fkey"`,
  `ALTER TABLE "PolicyMember" ADD CONSTRAINT "PolicyMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "PolicyMember" DROP CONSTRAINT IF EXISTS "PolicyMember_dependentId_fkey"`,
  `ALTER TABLE "PolicyMember" ADD CONSTRAINT "PolicyMember_dependentId_fkey" FOREIGN KEY ("dependentId") REFERENCES "EmployeeFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateStepEvaluator" DROP CONSTRAINT IF EXISTS "CandidateStepEvaluator_selectionStepId_fkey"`,
  `ALTER TABLE "CandidateStepEvaluator" ADD CONSTRAINT "CandidateStepEvaluator_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateStepEvaluator" DROP CONSTRAINT IF EXISTS "CandidateStepEvaluator_evaluatorId_fkey"`,
  `ALTER TABLE "CandidateStepEvaluator" ADD CONSTRAINT "CandidateStepEvaluator_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "InterviewSlot" DROP CONSTRAINT IF EXISTS "InterviewSlot_selectionStepId_fkey"`,
  `ALTER TABLE "InterviewSlot" ADD CONSTRAINT "InterviewSlot_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateOfferVersion" DROP CONSTRAINT IF EXISTS "CandidateOfferVersion_offerId_fkey"`,
  `ALTER TABLE "CandidateOfferVersion" ADD CONSTRAINT "CandidateOfferVersion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CandidateOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_appUserId_fkey"`,
  `ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-p2-benchmark] schema: ${list.join(", ")}`);
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
          // 42710 = duplicate object (kolom/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      for (const tbl of [
        "InsurancePolicy", "PolicyMember", "CandidateStepEvaluator", "InterviewSlot",
        "CandidateOfferVersion", "PushConfig", "PushSubscription",
      ]) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
          [schemaName, tbl],
        );
        console.log(`    tabel ${tbl}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
      for (const [tbl, col] of [
        ["PayrollRegulation", "bpjsOfficeCode"],
        ["ApprovalStructure", "escalateDays"],
        ["CandidateSelectionStep", "inviteTokenHash"],
        ["CandidateOffer", "selfServiceTokenHash"],
      ] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schemaName, tbl, col],
        );
        console.log(`    kolom ${tbl}.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI: bun run scripts/migrate-p2-benchmark.ts [schema1 schema2 ...]
if (process.argv[1] && process.argv[1].includes("migrate-p2-benchmark")) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
