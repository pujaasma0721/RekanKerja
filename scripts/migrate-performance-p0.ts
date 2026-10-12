// Migrasi P0-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P0) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS × 20: PerformanceSetting, KpiDefinition,
//      Competency, RatingScale, PerformanceTemplate, PerformanceTemplateItem,
//      MeritMatrix, PerformanceCycle, AppraisalRecord, AppraisalKpi,
//      AppraisalCompetencyScore, CheckIn, Feedback360, Feedback360Answer,
//      CalibrationSession, CalibrationDecision, MeritRecommendation, PipPlan,
//      PipCheckpoint, ProbationEvaluation (+ unique/index/FK selaras
//      tenant-ddl.sql, termasuk kolom AMANDEMEN 1 origin/copiedFromId/
//      goalsCopiedFrom + AMANDEMEN 2 versionNo/effectiveYear/status/
//      supersededById/changeNote + AMANDEMEN 3 selfComment/aiAssisted).
//   2. Seed default master performance (insert-only bila belum ada):
//      · PerformanceSetting (penomoran PER|PRB|PIP|MER, bobot 70|20|10,
//        banding 7 hari, retensi 5 tahun).
//      · KpiDefinition starter-pack 40 KPI — 4 perspektif BSC (Lampiran B),
//        termasuk 6 binding auto-source §16 (kehadiran, telat, lembur,
//        cuti tak terencana, time-to-fill, fulfilled MPP).
//      · Competency 12 ber-deskriptor 5 level (4 nilai inti + 4 manajerial
//        + 4 teknis — anchor anti-halo §8).
//      · RatingScale default 5 tingkat (§4.4 / Lampiran C).
//      · PerformanceTemplate 2 (STAFF-STD 70/20/10, MGR-STD 60/30/10) +
//        item kompetensi bobot.
//      · MeritMatrix MM-STD (rating → bulan bonus & % kenaikan — dipakai
//        Alur 8 + estimator dampak §18.12).
// Dapat diimpor IN-PROCESS oleh src/rekankerja/shared/lib/parity-runner.ts
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-performance-p0.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
// SATU sumber kebenaran seed (dipakai juga provisioning.ts utk tenant baru).
import { KPI_SEED, COMP_SEED, SCALE_SEED, TEMPLATE_SEED, CORE_TEMPLATE_ITEMS, MERIT_SEED, PERF_YEAR, COMPETENCY_LEVEL_LABELS, compLevelDescriptors } from "@/rekankerja/performance/services/perf-defaults";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const YEAR = PERF_YEAR;

// Urutan kolom selaras prisma/schema-tenant.prisma (tenant-ddl.sql).
const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "PerformanceSetting" (
    "id" TEXT NOT NULL,
    "docPrefixes" TEXT NOT NULL DEFAULT 'PER|PRB|PIP|MER',
    "defWeights" TEXT NOT NULL DEFAULT '70|20|10',
    "appealDays" INTEGER NOT NULL DEFAULT 7,
    "retentionYears" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceSetting_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "KpiDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL DEFAULT 'Manual',
    "sourceKey" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "effectiveYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supersededById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Competency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "levelsJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "versionNo" INTEGER NOT NULL DEFAULT 1,
    "effectiveYear" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "supersededById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RatingScale" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "labelId" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "color" TEXT NOT NULL,
    "guideline" TEXT,
    CONSTRAINT "RatingScale_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PerformanceTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightsJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceTemplate_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PerformanceTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    CONSTRAINT "PerformanceTemplateItem_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MeritMatrix" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gridJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeritMatrix_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PerformanceCycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycleType" TEXT NOT NULL DEFAULT 'Annual',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "goalStart" TIMESTAMP(3),
    "goalEnd" TIMESTAMP(3),
    "midStart" TIMESTAMP(3),
    "midEnd" TIMESTAMP(3),
    "selfStart" TIMESTAMP(3),
    "selfEnd" TIMESTAMP(3),
    "mgrStart" TIMESTAMP(3),
    "mgrEnd" TIMESTAMP(3),
    "calibStart" TIMESTAMP(3),
    "calibEnd" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "weightsJson" TEXT NOT NULL,
    "feedback360" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PerformanceCycle_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AppraisalRecord" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "templateId" TEXT,
    "goalsCopiedFrom" TEXT,
    "kpiTotalWeight" DOUBLE PRECISION,
    "selfScore" DOUBLE PRECISION,
    "managerScore" DOUBLE PRECISION,
    "finalScore" DOUBLE PRECISION,
    "finalRating" INTEGER,
    "potentialBand" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Enrolled',
    "acknowledgedAt" TIMESTAMP(3),
    "appealNote" TEXT,
    "appealStatus" TEXT,
    "appealDecidedBy" TEXT,
    "appealDecidedAt" TIMESTAMP(3),
    CONSTRAINT "AppraisalRecord_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AppraisalKpi" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "kpiDefId" TEXT,
    "title" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "thresholdMin" DOUBLE PRECISION,
    "target" DOUBLE PRECISION NOT NULL,
    "stretchValue" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" TEXT NOT NULL DEFAULT 'Manual',
    "autoValueJson" TEXT,
    "midActual" DOUBLE PRECISION,
    "finalActual" DOUBLE PRECISION,
    "evidenceJson" TEXT,
    "proposedBy" TEXT NOT NULL DEFAULT 'Manager',
    "origin" TEXT NOT NULL DEFAULT 'Fresh',
    "copiedFromId" TEXT,
    CONSTRAINT "AppraisalKpi_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AppraisalCompetencyScore" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "selfScore" INTEGER,
    "comment" TEXT,
    "selfComment" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "selfAiAssisted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "AppraisalCompetencyScore_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CheckIn" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "agenda" TEXT,
    "notesJson" TEXT NOT NULL,
    "managerComment" TEXT,
    "nextCheckInAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Feedback360" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Invited',
    "dueAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    CONSTRAINT "Feedback360_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Feedback360Answer" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Feedback360Answer_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CalibrationSession" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "heldAt" TIMESTAMP(3) NOT NULL,
    "participantsJson" TEXT NOT NULL,
    "chairId" TEXT,
    "notes" TEXT,
    CONSTRAINT "CalibrationSession_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CalibrationDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "oldScore" DOUBLE PRECISION,
    "newScore" DOUBLE PRECISION,
    "oldRating" INTEGER,
    "newRating" INTEGER,
    "potentialBand" INTEGER,
    "reason" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalibrationDecision_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MeritRecommendation" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "matrixId" TEXT,
    "bonusMonths" DOUBLE PRECISION,
    "bonusAmount" TEXT,
    "raisePct" DOUBLE PRECISION,
    "raiseAmount" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "personnelActionId" TEXT,
    "appliedRunNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeritRecommendation_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PipPlan" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "appraisalId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "targetsJson" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "hrAdvisorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "outcomeNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PipPlan_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PipCheckpoint" (
    "id" TEXT NOT NULL,
    "pipId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "achievementPct" DOUBLE PRECISION,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "PipCheckpoint_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ProbationEvaluation" (
    "id" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "onboardingId" TEXT,
    "cycleId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "criteriaJson" TEXT NOT NULL,
    "managerScore" DOUBLE PRECISION,
    "hrNote" TEXT,
    "recommendation" TEXT,
    "decisionDate" TIMESTAMP(3),
    "personnelActionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProbationEvaluation_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  // --- KpiDefinition (AMANDEMEN 2: unique per code+versionNo) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "KpiDefinition_code_versionNo_key" ON "KpiDefinition"("code", "versionNo")`,
  `CREATE INDEX IF NOT EXISTS "KpiDefinition_category_active_idx" ON "KpiDefinition"("category", "active")`,
  `CREATE INDEX IF NOT EXISTS "KpiDefinition_status_idx" ON "KpiDefinition"("status")`,
  // --- Competency (AMANDEMEN 2) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "Competency_code_versionNo_key" ON "Competency"("code", "versionNo")`,
  `CREATE INDEX IF NOT EXISTS "Competency_kind_active_idx" ON "Competency"("kind", "active")`,
  `CREATE INDEX IF NOT EXISTS "Competency_status_idx" ON "Competency"("status")`,
  // --- RatingScale ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "RatingScale_value_key" ON "RatingScale"("value")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RatingScale_minScore_key" ON "RatingScale"("minScore")`,
  // --- PerformanceTemplate(+Item) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceTemplate_code_key" ON "PerformanceTemplate"("code")`,
  `CREATE INDEX IF NOT EXISTS "PerformanceTemplateItem_templateId_idx" ON "PerformanceTemplateItem"("templateId")`,
  // --- MeritMatrix ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritMatrix_code_key" ON "MeritMatrix"("code")`,
  // --- PerformanceCycle ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceCycle_code_key" ON "PerformanceCycle"("code")`,
  `CREATE INDEX IF NOT EXISTS "PerformanceCycle_status_periodEnd_idx" ON "PerformanceCycle"("status", "periodEnd")`,
  // --- AppraisalRecord ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalRecord_docNo_key" ON "AppraisalRecord"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalRecord_employeeId_idx" ON "AppraisalRecord"("employeeId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalRecord_cycleId_status_idx" ON "AppraisalRecord"("cycleId", "status")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalRecord_managerId_idx" ON "AppraisalRecord"("managerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalRecord_cycleId_employeeId_key" ON "AppraisalRecord"("cycleId", "employeeId")`,
  // --- AppraisalKpi ---
  `CREATE INDEX IF NOT EXISTS "AppraisalKpi_appraisalId_idx" ON "AppraisalKpi"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalKpi_kpiDefId_idx" ON "AppraisalKpi"("kpiDefId")`,
  // --- AppraisalCompetencyScore ---
  `CREATE INDEX IF NOT EXISTS "AppraisalCompetencyScore_competencyId_idx" ON "AppraisalCompetencyScore"("competencyId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalCompetencyScore_appraisalId_competencyId_key" ON "AppraisalCompetencyScore"("appraisalId", "competencyId")`,
  // --- CheckIn ---
  `CREATE INDEX IF NOT EXISTS "CheckIn_appraisalId_heldAt_idx" ON "CheckIn"("appraisalId", "heldAt")`,
  // --- Feedback360(+Answer) ---
  `CREATE INDEX IF NOT EXISTS "Feedback360_appraisalId_idx" ON "Feedback360"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "Feedback360_reviewerId_idx" ON "Feedback360"("reviewerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Feedback360_appraisalId_reviewerId_reviewerType_key" ON "Feedback360"("appraisalId", "reviewerId", "reviewerType")`,
  `CREATE INDEX IF NOT EXISTS "Feedback360Answer_feedbackId_competencyId_idx" ON "Feedback360Answer"("feedbackId", "competencyId")`,
  // --- CalibrationSession/Decision ---
  `CREATE INDEX IF NOT EXISTS "CalibrationSession_cycleId_idx" ON "CalibrationSession"("cycleId")`,
  `CREATE INDEX IF NOT EXISTS "CalibrationDecision_appraisalId_idx" ON "CalibrationDecision"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "CalibrationDecision_sessionId_idx" ON "CalibrationDecision"("sessionId")`,
  // --- MeritRecommendation ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritRecommendation_docNo_key" ON "MeritRecommendation"("docNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritRecommendation_appraisalId_key" ON "MeritRecommendation"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "MeritRecommendation_status_idx" ON "MeritRecommendation"("status")`,
  // --- PipPlan(+Checkpoint) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "PipPlan_docNo_key" ON "PipPlan"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "PipPlan_employeeId_status_idx" ON "PipPlan"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PipPlan_reviewerId_idx" ON "PipPlan"("reviewerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PipCheckpoint_pipId_seq_key" ON "PipCheckpoint"("pipId", "seq")`,
  // --- ProbationEvaluation ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "ProbationEvaluation_docNo_key" ON "ProbationEvaluation"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "ProbationEvaluation_employeeId_status_idx" ON "ProbationEvaluation"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "ProbationEvaluation_dueDate_idx" ON "ProbationEvaluation"("dueDate")`,
  // --- FK (drop-if-exists + add — pola F1 rekrutmen, race-safe) ---
  `ALTER TABLE "PerformanceTemplateItem" DROP CONSTRAINT IF EXISTS "PerformanceTemplateItem_templateId_fkey"`,
  `ALTER TABLE "PerformanceTemplateItem" ADD CONSTRAINT "PerformanceTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PerformanceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_cycleId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_employeeId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_managerId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360" DROP CONSTRAINT IF EXISTS "Feedback360_reviewerId_fkey"`,
  `ALTER TABLE "Feedback360" ADD CONSTRAINT "Feedback360_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360Answer" DROP CONSTRAINT IF EXISTS "Feedback360Answer_feedbackId_fkey"`,
  `ALTER TABLE "Feedback360Answer" ADD CONSTRAINT "Feedback360Answer_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback360"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CalibrationSession" DROP CONSTRAINT IF EXISTS "CalibrationSession_cycleId_fkey"`,
  `ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CalibrationDecision" DROP CONSTRAINT IF EXISTS "CalibrationDecision_sessionId_fkey"`,
  `ALTER TABLE "CalibrationDecision" ADD CONSTRAINT "CalibrationDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CalibrationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "MeritRecommendation" DROP CONSTRAINT IF EXISTS "MeritRecommendation_appraisalId_fkey"`,
  `ALTER TABLE "MeritRecommendation" ADD CONSTRAINT "MeritRecommendation_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PipPlan" DROP CONSTRAINT IF EXISTS "PipPlan_employeeId_fkey"`,
  `ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PipCheckpoint" DROP CONSTRAINT IF EXISTS "PipCheckpoint_pipId_fkey"`,
  `ALTER TABLE "PipCheckpoint" ADD CONSTRAINT "PipCheckpoint_pipId_fkey" FOREIGN KEY ("pipId") REFERENCES "PipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ProbationEvaluation" DROP CONSTRAINT IF EXISTS "ProbationEvaluation_employeeId_fkey"`,
  `ALTER TABLE "ProbationEvaluation" ADD CONSTRAINT "ProbationEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-p0] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      // ---- 1. DDL idempoten ----
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        try {
          await c.query(ddl);
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? "");
          // 42710 = duplicate object (constraint/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      console.log(`    tabel performance siap (20)`);

      // ---- 2. seed PerformanceSetting (satu baris per tenant) ----
      const stCount = await c.query(`SELECT COUNT(*)::int AS n FROM "${schemaName}"."PerformanceSetting"`);
      if (!stCount.rows[0].n) {
        await c.query(
          `INSERT INTO "${schemaName}"."PerformanceSetting" (id, "docPrefixes", "defWeights", "appealDays", "retentionYears", "updatedAt")
           VALUES (gen_random_uuid()::text, 'PER|PRB|PIP|MER', '70|20|10', 7, 5, now())`,
        );
        console.log(`    PerformanceSetting dibuat`);
      }

      // ---- 3. seed pustaka KPI (insert-only per code+version 1) ----
      let kpiNew = 0;
      for (const k of KPI_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."KpiDefinition" WHERE code = $1 AND "versionNo" = 1`, [k.code]);
        if (dup.rowCount) continue;
        await c.query(
          `INSERT INTO "${schemaName}"."KpiDefinition"
             (id, code, name, category, polarity, unit, "dataSource", "sourceKey", description, active,
              "versionNo", "effectiveYear", status, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, true, 1, $9, 'Active', now(), now())`,
          [k.code, k.name, k.category, k.polarity, k.unit, k.dataSource ?? "Manual", k.sourceKey ?? null, k.description ?? null, YEAR],
        );
        kpiNew++;
      }

      // ---- 4. seed kompetensi 12 ber-level ----
      let compNew = 0;
      for (const cp of COMP_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."Competency" WHERE code = $1 AND "versionNo" = 1`, [cp.code]);
        if (dup.rowCount) continue;
        const levelsJson = JSON.stringify(compLevelDescriptors(cp).map((descriptor, i) => ({ level: i + 1, label: COMPETENCY_LEVEL_LABELS[i], descriptor })));
        await c.query(
          `INSERT INTO "${schemaName}"."Competency"
             (id, code, name, kind, "levelsJson", active, "versionNo", "effectiveYear", status, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, true, 1, $5, 'Active', now(), now())`,
          [cp.code, cp.name, cp.kind, levelsJson, YEAR],
        );
        compNew++;
      }

      // ---- 5. seed skala rating ----
      let scaleNew = 0;
      for (const sc of SCALE_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."RatingScale" WHERE value = $1`, [sc.value]);
        if (dup.rowCount) continue;
        await c.query(
          `INSERT INTO "${schemaName}"."RatingScale" (id, value, "labelId", "labelEn", "minScore", color, guideline)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4::double precision, $5, $6)`,
          [sc.value, sc.labelId, sc.labelEn, sc.minScore, sc.color, sc.guideline],
        );
        scaleNew++;
      }

      // ---- 6. seed template bobot + item kompetensi ----
      let tplNew = 0;
      for (const tp of TEMPLATE_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."PerformanceTemplate" WHERE code = $1`, [tp.code]);
        if (dup.rowCount) continue;
        const r = await c.query(
          `INSERT INTO "${schemaName}"."PerformanceTemplate" (id, code, name, "weightsJson", active, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, true, now(), now()) RETURNING id`,
          [tp.code, tp.name, tp.weightsJson],
        );
        const tplId = r.rows[0].id as string;
        // item kompetensi (komponen 20/30%)
        for (const it of tp.compItems) {
          await c.query(
            `INSERT INTO "${schemaName}"."PerformanceTemplateItem" (id, "templateId", kind, "refId", weight)
             SELECT gen_random_uuid()::text, $1, 'Competency', c.id, $2::double precision
             FROM "${schemaName}"."Competency" c WHERE c.code = $3 LIMIT 1`,
            [tplId, it.weight, it.code],
          );
        }
        // item nilai inti (komponen core 10% — rata 4)
        for (const cc of CORE_ITEMS) {
          await c.query(
            `INSERT INTO "${schemaName}"."PerformanceTemplateItem" (id, "templateId", kind, "refId", weight)
             SELECT gen_random_uuid()::text, $1, 'Competency', c.id, 25::double precision
             FROM "${schemaName}"."Competency" c WHERE c.code = $2 AND c.kind = 'CoreValue' LIMIT 1`,
            [tplId, cc],
          );
        }
        tplNew++;
      }

      // ---- 7. seed merit matrix ----
      const mmDup = await c.query(`SELECT 1 FROM "${schemaName}"."MeritMatrix" WHERE code = $1`, [MERIT_SEED.code]);
      if (!mmDup.rowCount) {
        await c.query(
          `INSERT INTO "${schemaName}"."MeritMatrix" (id, code, name, "gridJson", active, "createdAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, true, now())`,
          [MERIT_SEED.code, MERIT_SEED.name, MERIT_SEED.gridJson],
        );
        console.log(`    MeritMatrix MM-STD dibuat`);
      }

      console.log(`    KPI baru: ${kpiNew}, kompetensi baru: ${compNew}, skala baru: ${scaleNew}, template baru: ${tplNew}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung (bun scripts/migrate-performance-p0.ts),
// BUKAN saat diimpor aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
