// Migrasi P0-PERFORMANCE (DEVELOPMENT-PLAN-PERFORMANCE.md §15 + §20 P0) ke
// tenant existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×20 (PerformanceSetting, KpiDefinition,
//      Competency, RatingScale, PerformanceTemplate(+Item), PerformanceCycle,
//      AppraisalRecord, AppraisalKpi, AppraisalCompetencyScore, CheckIn,
//      Feedback360(+Answer), CalibrationSession(+Decision), MeritMatrix,
//      MeritRecommendation, PipPlan(+Checkpoint), ProbationEvaluation) +
//      unique/index/FK drop-add — selaras prisma/schema-tenant.prisma &
//      prisma/tenant-ddl.sql (pola F0–F9 rekrutmen).
//   2. Seed master default (insert-only bila tabel kosong):
//        • PerformanceSetting (prefix dokumen + bobot default + banding + retensi).
//        • KPI Library starter-pack ±40 — 4 perspektif BSC (Lampiran B), versi 1
//          efektif tahun berjalan, beberapa bertanda dataSource auto-binding.
//        • 12 kompetensi ber-level (3 CoreValue + 5 Managerial + 4 Technical),
//          masing-masing deskriptor perilaku 5 level (anchor anti-halo §8).
//        • RatingScale 5 tingkat dwibahasa (Lampiran C).
//        • PerformanceTemplate 2 (Umum 70/20/10, Manajerial 60/25/15) + item.
//        • MeritMatrix default (grid rating 1–5 → bonus bulan + % kenaikan).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU CLI: bun run scripts/migrate-performance-p0.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const YEAR = new Date().getFullYear();

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalibrationDecision_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "MeritMatrix" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gridJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MeritMatrix_pkey" PRIMARY KEY ("id")
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
  // PerformanceCycle
  `CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceCycle_code_key" ON "PerformanceCycle"("code")`,
  `CREATE INDEX IF NOT EXISTS "PerformanceCycle_status_periodEnd_idx" ON "PerformanceCycle"("status", "periodEnd")`,
  // KpiDefinition (AM2 §18.9: unique code+versionNo, bukan code tunggal)
  `CREATE UNIQUE INDEX IF NOT EXISTS "KpiDefinition_code_versionNo_key" ON "KpiDefinition"("code", "versionNo")`,
  `CREATE INDEX IF NOT EXISTS "KpiDefinition_category_active_idx" ON "KpiDefinition"("category", "active")`,
  `CREATE INDEX IF NOT EXISTS "KpiDefinition_status_idx" ON "KpiDefinition"("status")`,
  // Competency
  `CREATE UNIQUE INDEX IF NOT EXISTS "Competency_code_versionNo_key" ON "Competency"("code", "versionNo")`,
  `CREATE INDEX IF NOT EXISTS "Competency_kind_active_idx" ON "Competency"("kind", "active")`,
  `CREATE INDEX IF NOT EXISTS "Competency_status_idx" ON "Competency"("status")`,
  // RatingScale
  `CREATE UNIQUE INDEX IF NOT EXISTS "RatingScale_value_key" ON "RatingScale"("value")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RatingScale_minScore_key" ON "RatingScale"("minScore")`,
  // PerformanceTemplate
  `CREATE UNIQUE INDEX IF NOT EXISTS "PerformanceTemplate_code_key" ON "PerformanceTemplate"("code")`,
  `CREATE INDEX IF NOT EXISTS "PerformanceTemplateItem_templateId_idx" ON "PerformanceTemplateItem"("templateId")`,
  // AppraisalRecord
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalRecord_docNo_key" ON "AppraisalRecord"("docNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalRecord_cycleId_employeeId_key" ON "AppraisalRecord"("cycleId", "employeeId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalRecord_employeeId_idx" ON "AppraisalRecord"("employeeId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalRecord_cycleId_status_idx" ON "AppraisalRecord"("cycleId", "status")`,
  // AppraisalKpi
  `CREATE INDEX IF NOT EXISTS "AppraisalKpi_appraisalId_idx" ON "AppraisalKpi"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalKpi_kpiDefId_idx" ON "AppraisalKpi"("kpiDefId")`,
  // AppraisalCompetencyScore
  `CREATE UNIQUE INDEX IF NOT EXISTS "AppraisalCompetencyScore_appraisalId_competencyId_key" ON "AppraisalCompetencyScore"("appraisalId", "competencyId")`,
  `CREATE INDEX IF NOT EXISTS "AppraisalCompetencyScore_competencyId_idx" ON "AppraisalCompetencyScore"("competencyId")`,
  // CheckIn
  `CREATE INDEX IF NOT EXISTS "CheckIn_appraisalId_heldAt_idx" ON "CheckIn"("appraisalId", "heldAt")`,
  // Feedback360
  `CREATE UNIQUE INDEX IF NOT EXISTS "Feedback360_appraisalId_reviewerId_reviewerType_key" ON "Feedback360"("appraisalId", "reviewerId", "reviewerType")`,
  `CREATE INDEX IF NOT EXISTS "Feedback360_answer_feedbackId_competencyId_idx" ON "Feedback360Answer"("feedbackId", "competencyId")`,
  `CREATE INDEX IF NOT EXISTS "Feedback360Answer_competencyId_idx" ON "Feedback360Answer"("competencyId")`,
  // Calibration
  `CREATE INDEX IF NOT EXISTS "CalibrationSession_cycleId_idx" ON "CalibrationSession"("cycleId")`,
  `CREATE INDEX IF NOT EXISTS "CalibrationDecision_appraisalId_idx" ON "CalibrationDecision"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "CalibrationDecision_sessionId_idx" ON "CalibrationDecision"("sessionId")`,
  // Merit
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritMatrix_code_key" ON "MeritMatrix"("code")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritRecommendation_docNo_key" ON "MeritRecommendation"("docNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MeritRecommendation_appraisalId_key" ON "MeritRecommendation"("appraisalId")`,
  `CREATE INDEX IF NOT EXISTS "MeritRecommendation_matrixId_idx" ON "MeritRecommendation"("matrixId")`,
  // PIP
  `CREATE UNIQUE INDEX IF NOT EXISTS "PipPlan_docNo_key" ON "PipPlan"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "PipPlan_employeeId_status_idx" ON "PipPlan"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "PipPlan_appraisalId_idx" ON "PipPlan"("appraisalId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PipCheckpoint_pipId_seq_key" ON "PipCheckpoint"("pipId", "seq")`,
  // Probation
  `CREATE UNIQUE INDEX IF NOT EXISTS "ProbationEvaluation_docNo_key" ON "ProbationEvaluation"("docNo")`,
  `CREATE INDEX IF NOT EXISTS "ProbationEvaluation_employeeId_status_idx" ON "ProbationEvaluation"("employeeId", "status")`,
  `CREATE INDEX IF NOT EXISTS "ProbationEvaluation_dueDate_idx" ON "ProbationEvaluation"("dueDate")`,
  `CREATE INDEX IF NOT EXISTS "ProbationEvaluation_cycleId_idx" ON "ProbationEvaluation"("cycleId")`,
  // FK — drop-add idempoten (pola F0–F9)
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_cycleId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_employeeId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalRecord" DROP CONSTRAINT IF EXISTS "AppraisalRecord_managerId_fkey"`,
  `ALTER TABLE "AppraisalRecord" ADD CONSTRAINT "AppraisalRecord_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalKpi" DROP CONSTRAINT IF EXISTS "AppraisalKpi_appraisalId_fkey"`,
  `ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalKpi" DROP CONSTRAINT IF EXISTS "AppraisalKpi_kpiDefId_fkey"`,
  `ALTER TABLE "AppraisalKpi" ADD CONSTRAINT "AppraisalKpi_kpiDefId_fkey" FOREIGN KEY ("kpiDefId") REFERENCES "KpiDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalCompetencyScore" DROP CONSTRAINT IF EXISTS "AppraisalCompetencyScore_appraisalId_fkey"`,
  `ALTER TABLE "AppraisalCompetencyScore" ADD CONSTRAINT "AppraisalCompetencyScore_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "AppraisalCompetencyScore" DROP CONSTRAINT IF EXISTS "AppraisalCompetencyScore_competencyId_fkey"`,
  `ALTER TABLE "AppraisalCompetencyScore" ADD CONSTRAINT "AppraisalCompetencyScore_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CheckIn" DROP CONSTRAINT IF EXISTS "CheckIn_appraisalId_fkey"`,
  `ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360" DROP CONSTRAINT IF EXISTS "Feedback360_appraisalId_fkey"`,
  `ALTER TABLE "Feedback360" ADD CONSTRAINT "Feedback360_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360" DROP CONSTRAINT IF EXISTS "Feedback360_reviewerId_fkey"`,
  `ALTER TABLE "Feedback360" ADD CONSTRAINT "Feedback360_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360Answer" DROP CONSTRAINT IF EXISTS "Feedback360Answer_feedbackId_fkey"`,
  `ALTER TABLE "Feedback360Answer" ADD CONSTRAINT "Feedback360Answer_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "Feedback360"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "Feedback360Answer" DROP CONSTRAINT IF EXISTS "Feedback360Answer_competencyId_fkey"`,
  `ALTER TABLE "Feedback360Answer" ADD CONSTRAINT "Feedback360Answer_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CalibrationSession" DROP CONSTRAINT IF EXISTS "CalibrationSession_cycleId_fkey"`,
  `ALTER TABLE "CalibrationSession" ADD CONSTRAINT "CalibrationSession_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CalibrationDecision" DROP CONSTRAINT IF EXISTS "CalibrationDecision_sessionId_fkey"`,
  `ALTER TABLE "CalibrationDecision" ADD CONSTRAINT "CalibrationDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CalibrationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CalibrationDecision" DROP CONSTRAINT IF EXISTS "CalibrationDecision_appraisalId_fkey"`,
  `ALTER TABLE "CalibrationDecision" ADD CONSTRAINT "CalibrationDecision_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "MeritRecommendation" DROP CONSTRAINT IF EXISTS "MeritRecommendation_appraisalId_fkey"`,
  `ALTER TABLE "MeritRecommendation" ADD CONSTRAINT "MeritRecommendation_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "MeritRecommendation" DROP CONSTRAINT IF EXISTS "MeritRecommendation_matrixId_fkey"`,
  `ALTER TABLE "MeritRecommendation" ADD CONSTRAINT "MeritRecommendation_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "MeritMatrix"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PipPlan" DROP CONSTRAINT IF EXISTS "PipPlan_employeeId_fkey"`,
  `ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PipPlan" DROP CONSTRAINT IF EXISTS "PipPlan_appraisalId_fkey"`,
  `ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "AppraisalRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PipPlan" DROP CONSTRAINT IF EXISTS "PipPlan_reviewerId_fkey"`,
  `ALTER TABLE "PipPlan" ADD CONSTRAINT "PipPlan_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PipCheckpoint" DROP CONSTRAINT IF EXISTS "PipCheckpoint_pipId_fkey"`,
  `ALTER TABLE "PipCheckpoint" ADD CONSTRAINT "PipCheckpoint_pipId_fkey" FOREIGN KEY ("pipId") REFERENCES "PipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ProbationEvaluation" DROP CONSTRAINT IF EXISTS "ProbationEvaluation_employeeId_fkey"`,
  `ALTER TABLE "ProbationEvaluation" ADD CONSTRAINT "ProbationEvaluation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "ProbationEvaluation" DROP CONSTRAINT IF EXISTS "ProbationEvaluation_cycleId_fkey"`,
  `ALTER TABLE "ProbationEvaluation" ADD CONSTRAINT "ProbationEvaluation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "PerformanceCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PerformanceTemplateItem" DROP CONSTRAINT IF EXISTS "PerformanceTemplateItem_templateId_fkey"`,
  `ALTER TABLE "PerformanceTemplateItem" ADD CONSTRAINT "PerformanceTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PerformanceTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

// ============================================================
// SEED — starter pack master (Lampiran B/C + §23 default)
// ============================================================

type KpiSeed = {
  code: string; name: string; category: string; polarity: string; unit: string;
  dataSource?: string; sourceKey?: string; description?: string;
};

const KPI_SEED: KpiSeed[] = [
  // ===== Financial (10) =====
  { code: "FIN-RECV", name: "Nilai piutang tertagih", category: "Financial", polarity: "Higher", unit: "Rp", description: "Nilai rupiah piutang yang berhasil ditagih pada periode" },
  { code: "FIN-COST-VS-BUDGET", name: "Biaya operasional vs anggaran", category: "Financial", polarity: "Lower", unit: "%", description: "Deviasi biaya aktual terhadap anggaran periode" },
  { code: "FIN-STOCK-DIFF", name: "Selisih stok fisik vs sistem", category: "Financial", polarity: "Lower", unit: "%", description: "Selisih nilai opname terhadap catatan sistem" },
  { code: "FIN-SAVE-PROC", name: "Penghematan pengadaan", category: "Financial", polarity: "Higher", unit: "Rp", description: "Nilai penghematan hasil negosiasi/efisiensi pengadaan" },
  { code: "FIN-REVENUE-GROWTH", name: "Pertumbuhan pendapatan unit", category: "Financial", polarity: "Higher", unit: "%", description: "Delta pendapatan unit vs periode sebelumnya" },
  { code: "FIN-MARGIN-CONTRIB", name: "Margin kontribusi unit", category: "Financial", polarity: "Higher", unit: "%" },
  { code: "FIN-BAD-DEBT", name: "Piutang macet baru", category: "Financial", polarity: "Lower", unit: "Rp" },
  { code: "FIN-BUDGET-ACC", name: "Akurasi proyeksi anggaran", category: "Financial", polarity: "Higher", unit: "%" },
  { code: "FIN-COST-UNIT", name: "Biaya per unit keluaran", category: "Financial", polarity: "Lower", unit: "Rp" },
  { code: "FIN-CASH-CYCLE", name: "Siklus konversi kas", category: "Financial", polarity: "Lower", unit: "hari" },
  // ===== Customer (10) =====
  { code: "CUS-SAT-INT", name: "Kepuasan pelanggan internal", category: "Customer", polarity: "Higher", unit: "skala", description: "Skor survei kepuasan layanan antar-unit (1–10)" },
  { code: "CUS-SAT-EXT", name: "Kepuasan pelanggan eksternal", category: "Customer", polarity: "Higher", unit: "skala" },
  { code: "CUS-SLA-TICKET", name: "SLA penyelesaian tiket", category: "Customer", polarity: "Higher", unit: "%" },
  { code: "CUS-REPEAT-COMPLAINT", name: "Keluhan berulang", category: "Customer", polarity: "Lower", unit: "kasus" },
  { code: "CUS-DOC-ONTIME", name: "Ketepatan pengiriman dokumen", category: "Customer", polarity: "Higher", unit: "%" },
  { code: "CUS-NPS", name: "Net Promoter Score", category: "Customer", polarity: "Higher", unit: "skala" },
  { code: "CUS-RETENTION", name: "Retensi pelanggan kunci", category: "Customer", polarity: "Higher", unit: "%" },
  { code: "CUS-FIRST-RESPONSE", name: "Waktu respons pertama", category: "Customer", polarity: "Lower", unit: "jam" },
  { code: "CUS-ESCALATION", name: "Escalation rate", category: "Customer", polarity: "Lower", unit: "%" },
  { code: "CUS-ACCURACY-ORDER", name: "Akurasi pemrosesan pesanan", category: "Customer", polarity: "Higher", unit: "%" },
  // ===== InternalProcess (11) =====
  { code: "IPR-PAYROLL-ONTIME", name: "Ketepatan closing payroll", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Payroll", sourceKey: "payroll_closing_ontime", description: "Run payroll selesai se tanggal tanpa koreksi" },
  { code: "IPR-EMP-DATA-ACC", name: "Data karyawan akurat", category: "InternalProcess", polarity: "Higher", unit: "%", description: "% field kritis profil terisi benar" },
  { code: "IPR-TTF", name: "Waktu proses PR → hire", category: "InternalProcess", polarity: "Lower", unit: "hari", dataSource: "Recruitment", sourceKey: "recruitment_time_to_fill", description: "Rata-rata hari dari approval PR hingga kandidat join" },
  { code: "IPR-PRESENCE", name: "Kehadiran & ketepatan waktu", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Attendance", sourceKey: "attendance_presence_pct", description: "Tarikan otomatis % kehadiran periode (§16/§18.6)" },
  { code: "IPR-LATE-UNPLANNED", name: "Absen tak terencana", category: "InternalProcess", polarity: "Lower", unit: "hari", dataSource: "Attendance", sourceKey: "attendance_unplanned_absence_days", description: "Tarikan otomatis hari absen tanpa cuti disetujui" },
  { code: "IPR-INPUT-ERROR", name: "Tingkat error input", category: "InternalProcess", polarity: "Lower", unit: "kasus" },
  { code: "IPR-AUDIT-FINDING", name: "Temuan audit internal", category: "InternalProcess", polarity: "Lower", unit: "temuan" },
  { code: "IPR-PROC-CYCLE", name: "Waktu siklus proses utama", category: "InternalProcess", polarity: "Lower", unit: "hari" },
  { code: "IPR-LEAVE-PROC-DAYS", name: "Waktu proses cuti", category: "InternalProcess", polarity: "Lower", unit: "hari", dataSource: "Leave", sourceKey: "leave_processing_days" },
  { code: "IPR-COMPLIANCE-SCORE", name: "Skor kepatuhan SOP", category: "InternalProcess", polarity: "Higher", unit: "%" },
  { code: "IPR-BACKLOG", name: "Backlog pekerjaan", category: "InternalProcess", polarity: "Lower", unit: "item" },
  // ===== LearningGrowth (9) =====
  { code: "LNG-TRAIN-COMPLETE", name: "Penyelesaian pelatihan wajib", category: "LearningGrowth", polarity: "Higher", unit: "%" },
  { code: "LNG-INITIATIVE", name: "Inisiatif perbaikan diadopsi", category: "LearningGrowth", polarity: "Higher", unit: "usulan" },
  { code: "LNG-CROSS-TRAIN", name: "Cross-training penguasaan proses", category: "LearningGrowth", polarity: "Higher", unit: "proses" },
  { code: "LNG-CERT-COMPLETE", name: "Sertifikasi selesai tepat waktu", category: "LearningGrowth", polarity: "Higher", unit: "%" },
  { code: "LNG-KM-CONTRIB", name: "Kontribusi knowledge base", category: "LearningGrowth", polarity: "Higher", unit: "artikel" },
  { code: "LNG-SUCCESS-PLAN", name: "Penyelesaian rencana pengembangan", category: "LearningGrowth", polarity: "Higher", unit: "%" },
  { code: "LNG-INNOVATION-ROI", name: "Nilai manfaat inovasi", category: "LearningGrowth", polarity: "Higher", unit: "Rp" },
  { code: "LNG-SKILL-ASSESS", name: "Kenaikan asesmen kompetensi", category: "LearningGrowth", polarity: "Higher", unit: "%" },
  { code: "LNG-TALENT-READY", name: "Kesiapan kader suksesi", category: "LearningGrowth", polarity: "Higher", unit: "%" },
];

type CompSeed = {
  code: string; name: string; kind: string;
  levels: { level: number; label: string; descriptor: string }[];
};

const COMPETENCY_SEED: CompSeed[] = [
  {
    code: "CV-INTEGRITAS", name: "Integritas", kind: "CoreValue",
    levels: [
      { level: 1, label: "1 — Perlu pengawasan ketat", descriptor: "Terpatok pada aturan hanya saat diawasi; integritas belum konsisten di bawah tekanan." },
      { level: 2, label: "2 — Sesuai aturan", descriptor: "Mematuhi kebijakan & prosedur; melaporkan penyimpangan yang ditemukan." },
      { level: 3, label: "3 — Konsisten", descriptor: "Jujur & transparan bahkan dalam situasi sulit; menjaga kerahasiaan data." },
      { level: 4, label: "4 — Teladan", descriptor: "Menjadi rujukan etika; mengingatkan rekan secara konstruktif." },
      { level: 5, label: "5 — Pembudaya", descriptor: "Membangun mekanisme/kebiasaan etika tim; menangani dilema etik lintas unit." },
    ],
  },
  {
    code: "CV-KOLABORASI", name: "Kolaborasi", kind: "CoreValue",
    levels: [
      { level: 1, label: "1 — Bekerja sendiri", descriptor: "Cenderung menyelesaikan sendiri; minim berbagi informasi." },
      { level: 2, label: "2 — Responsif", descriptor: "Membantu bila diminta; berpartisipasi dalam forum tim." },
      { level: 3, label: "3 — Aktif", descriptor: "Proaktif menawarkan bantuan lintas peran; komunikatif status pekerjaan." },
      { level: 4, label: "4 — Penghubung", descriptor: "Menjembatani silo antar unit; memfasilitasi kesepahaman." },
      { level: 5, label: "5 — Perekat organisasi", descriptor: "Membangun budaya gotong royong; diakui sebagai penengah konflik." },
    ],
  },
  {
    code: "CV-ORIENTASI-HASIL", name: "Orientasi Hasil", kind: "CoreValue",
    levels: [
      { level: 1, label: "1 — Tertinggal", descriptor: "Penyelesaian sering melewati tenggat tanpa eskalasi." },
      { level: 2, label: "2 — Sesuai", descriptor: "Menyelesaikan sesuai instruksi dan tenggat dasar." },
      { level: 3, label: "3 — Andal", descriptor: "Konsisten memenuhi komitmen; eskalasi dini bila berisiko." },
      { level: 4, label: "4 — Melampaui", descriptor: "Melampaui target dengan kualitas terjaga." },
      { level: 5, label: "5 — Transformative", descriptor: "Mengubah cara kerja sehingga tim mencapai hasil berulang lebih tinggi." },
    ],
  },
  {
    code: "MG-LEADERSHIP", name: "Kepemimpinan", kind: "Managerial",
    levels: [
      { level: 1, label: "1 — Administrator", descriptor: "Membagi tugas tanpa arah jelas." },
      { level: 2, label: "2 — Pengarah", descriptor: "Menetapkan target; memantau hasil." },
      { level: 3, label: "3 — Pembina", descriptor: "Coaching reguler; delegasi sesuai kesiapan anggota." },
      { level: 4, label: "4 — Penggerak", descriptor: "Menginspirasi kinerja; menangani underperformance tegas & adil." },
      { level: 5, label: "5 — Visioner", descriptor: "Membangun pemimpin baru; strategi tim selaras visi organisasi." },
    ],
  },
  {
    code: "MG-DECISION", name: "Pengambilan Keputusan", kind: "Managerial",
    levels: [
      { level: 1, label: "1 — Ragu", descriptor: "Menunda keputusan; bergantung persetujuan penuh atasan." },
      { level: 2, label: "2 — Prosedural", descriptor: "Memutuskan sesuai SOP; eskalasi kasus di luar wewenang." },
      { level: 3, label: "3 — Analitis", descriptor: "Menimbang data & risiko; keputusan tepat waktu." },
      { level: 4, label: "4 — Strategis", descriptor: "Keputusan selaras kepentingan jangka panjang lintas unit." },
      { level: 5, label: "5 — Decisive under ambiguity", descriptor: "Tegas dalam ambiguitas tinggi; membangun kerangka keputusan organisasi." },
    ],
  },
  {
    code: "MG-COMMUNICATION", name: "Komunikasi", kind: "Managerial",
    levels: [
      { level: 1, label: "1 — Tersampaikan seadanya", descriptor: "Informasi sering terlambat/kurang jelas." },
      { level: 2, label: "2 — Jelas", descriptor: "Menyampaikan instruksi & konteks secara terstruktur." },
      { level: 3, label: "3 — Efektif", descriptor: "Menyesuaikan gaya per audiens; mendengarkan aktif." },
      { level: 4, label: "4 — Persuasif", descriptor: "Membangun kesepahaman pada isu kompleks; negosiasi baik." },
      { level: 5, label: "5 — Influencer", descriptor: "Narasi yang menggerakkan organisasi; komunikasi krisis mantap." },
    ],
  },
  {
    code: "MG-DEVELOPING", name: "Membina Bawahan", kind: "Managerial",
    levels: [
      { level: 1, label: "1 — Tanpa pembinaan", descriptor: "Tidak ada 1-on-1 terdokumentasi." },
      { level: 2, label: "2 — Reaktif", descriptor: "Menangapi masalah bawahan bila muncul." },
      { level: 3, label: "3 — Rutin", descriptor: "Check-in terjadwal; feedback dua arah." },
      { level: 4, label: "4 — Rencana karier", descriptor: "Rencana pengembangan per individu terlaksana." },
      { level: 5, label: "5 — Pabrik talenta", descriptor: "Kader siap suksesi teruji; alumni berkembang di organisasi." },
    ],
  },
  {
    code: "MG-CHANGE", name: "Manajemen Perubahan", kind: "Managerial",
    levels: [
      { level: 1, label: "1 — Menolak", descriptor: "Menunda/menghambat kebijakan baru." },
      { level: 2, label: "2 — Mengikuti", descriptor: "Melaksanakan perubahan sesuai arahan." },
      { level: 3, label: "3 — Mendukung", descriptor: "Menjelaskan alasan perubahan ke tim; memfasilitasi." },
      { level: 4, label: "4 — Mengelola", descriptor: "Merencanakan transisi; menyeimbangkan resistensi." },
      { level: 5, label: "5 — Agen perubahan", descriptor: "Memrakarsasi perubahan berdampak organisasi." },
    ],
  },
  {
    code: "TC-PROBLEM-SOLVING", name: "Pemecahan Masalah", kind: "Technical",
    levels: [
      { level: 1, label: "1 — Melapor", descriptor: "Menyerahkan masalah ke atasan." },
      { level: 2, label: "2 — Mengatasi gejala", descriptor: "Menyelesaikan insiden sesuai panduan." },
      { level: 3, label: "3 — Analisis akar", descriptor: "Mengurai akar masalah; solusi bertahan." },
      { level: 4, label: "4 — Sistemik", descriptor: "Solusi lintas proses dengan pencegahan berulang." },
      { level: 5, label: "5 — Merancang ulang", descriptor: "Mendesain ulang proses sehingga kelas masalah hilang." },
    ],
  },
  {
    code: "TC-QUALITY", name: "Mutu Pekerjaan", kind: "Technical",
    levels: [
      { level: 1, label: "1 — Banyak rework", descriptor: "Hasil sering dikembalikan untuk diperbaiki." },
      { level: 2, label: "2 — Sesuai standar", descriptor: "Memenuhi standar dengan supervisi normal." },
      { level: 3, label: "3 — Teliti", descriptor: "Kesalahan jarang; pemeriksaan mandiri." },
      { level: 4, label: "4 — Presisi", descriptor: "Kerja presisi di bawah tekanan tenggat." },
      { level: 5, label: "5 — Penjaga mutu", descriptor: "Menetapkan standar/bar QC bagi tim." },
    ],
  },
  {
    code: "TC-LEARNING-AGILITY", name: "Kecepatan Belajar", kind: "Technical",
    levels: [
      { level: 1, label: "1 — Lambat menyerap", descriptor: "Butuh pengulangan banyak untuk materi baru." },
      { level: 2, label: "2 — Bertahap", descriptor: "Menguasai materi baru dengan waktu wajar." },
      { level: 3, label: "3 — Cepat", descriptor: "Belajar mandiri; bertanya tepat sasaran." },
      { level: 4, label: "4 — Aplikatif", descriptor: "Menerapkan pengetahuan baru ke pekerjaan nyata." },
      { level: 5, label: "5 — Multi-domain", descriptor: "Menyerap domain baru & mengajarkannya kembali." },
    ],
  },
  {
    code: "TC-TECH-MASTERY", name: "Penguasaan Teknis Fungsi", kind: "Technical",
    levels: [
      { level: 1, label: "1 — Dasar", descriptor: "Pemahaman dasar fungsi; butuh panduan." },
      { level: 2, label: "2 — Praktis", descriptor: "Menangani kasus rutin mandiri." },
      { level: 3, label: "3 — Mahir", descriptor: "Menangani kasus kompleks; rujukan tim." },
      { level: 4, label: "4 — Pakar", descriptor: "Solusi khusus; melatih lain." },
      { level: 5, label: "5 — Autoritas", descriptor: "Diakui pakar lintas organisasi; menetapkan praktik terbaik." },
    ],
  },
];

const RATING_SCALE_SEED = [
  { value: 5, labelId: "Sangat Baik", labelEn: "Outstanding", minScore: 90, color: "emerald", guideline: "Secara konsisten melampaui ekspektasi; dampak lintas unit" },
  { value: 4, labelId: "Baik", labelEn: "Exceeds Expectations", minScore: 80, color: "teal", guideline: "Melampaui sebagian target; inisiatif nyata" },
  { value: 3, labelId: "Memenuhi", labelEn: "Meets Expectations", minScore: 70, color: "amber", guideline: "Memenuhi target & standar perilaku" },
  { value: 2, labelId: "Perlu Pengembangan", labelEn: "Needs Improvement", minScore: 60, color: "orange", guideline: "Di bawah sebagian target; butuh rencana pengembangan" },
  { value: 1, labelId: "Tidak Memenuhi", labelEn: "Unsatisfactory", minScore: 0, color: "rose", guideline: "Jauh di bawah target; pertimbangkan PIP" },
];

const MERIT_MATRIX_SEED = {
  code: "MERIT-STD",
  name: "Matriks Merit Standar",
  grid: {
    5: { bonusMonths: 2, raisePct: [10, 15], note: "Kinerja luar biasa — prioritas retensi" },
    4: { bonusMonths: 1.5, raisePct: [8, 12], note: "Melampaui ekspektasi" },
    3: { bonusMonths: 1, raisePct: [5, 8], note: "Memenuhi ekspektasi" },
    2: { bonusMonths: 0.5, raisePct: [0, 3], note: "Perlu pengembangan — kenaikan minimal" },
    1: { bonusMonths: 0, raisePct: [0, 0], note: "Tidak ada merit — jalur PIP" },
  },
};

const TEMPLATE_SEED = [
  {
    code: "TPL-UMUM", name: "Template Umum (Non-Manajerial)", weights: { kpi: 70, competency: 20, core: 10 },
    kpis: ["FIN-RECV", "CUS-SLA-TICKET", "IPR-INPUT-ERROR", "LNG-TRAIN-COMPLETE"],
    comps: ["CV-INTEGRITAS", "CV-KOLABORASI", "CV-ORIENTASI-HASIL", "TC-PROBLEM-SOLVING", "TC-QUALITY", "TC-LEARNING-AGILITY"],
  },
  {
    code: "TPL-MANAJERIAL", name: "Template Manajerial", weights: { kpi: 60, competency: 25, core: 15 },
    kpis: ["FIN-BUDGET-ACC", "CUS-RETENTION", "IPR-COMPLIANCE-SCORE", "LNG-TALENT-READY"],
    comps: ["CV-INTEGRITAS", "CV-ORIENTASI-HASIL", "MG-LEADERSHIP", "MG-DECISION", "MG-COMMUNICATION", "MG-DEVELOPING", "MG-CHANGE"],
  },
];

async function seedTenant(c: Client, schemaName: string): Promise<void> {
  const now = new Date();
  // PerformanceSetting — selalu 1 baris (upsert-like insert bila kosong)
  await c.query(
    `INSERT INTO "PerformanceSetting" ("id", "docPrefixes", "defWeights", "appealDays", "retentionYears", "updatedAt")
     SELECT gen_random_uuid()::text, 'PER|PRB|PIP|MER', '70|20|10', 7, 5, $1
     WHERE NOT EXISTS (SELECT 1 FROM "PerformanceSetting")`,
    [now],
  );
  // KPI library — insert bila kode belum ada versi berapapun
  for (const k of KPI_SEED) {
    await c.query(
      `INSERT INTO "KpiDefinition" ("id","code","name","category","polarity","unit","dataSource","sourceKey","description","active","versionNo","effectiveYear","status","createdAt","updatedAt")
       SELECT gen_random_uuid()::text, $1,$2,$3,$4,$5,$6,$7,$8, true, 1, $9, 'Active', $10, $10
       WHERE NOT EXISTS (SELECT 1 FROM "KpiDefinition" WHERE code = $1)`,
      [k.code, k.name, k.category, k.polarity, k.unit, k.dataSource ?? "Manual", k.sourceKey ?? null, k.description ?? null, YEAR, now],
    );
  }
  // Kompetensi + deskriptor 5 level
  for (const comp of COMPETENCY_SEED) {
    await c.query(
      `INSERT INTO "Competency" ("id","code","name","kind","levelsJson","active","versionNo","effectiveYear","status","createdAt","updatedAt")
       SELECT gen_random_uuid()::text, $1,$2,$3,$4, true, 1, $5, 'Active', $6, $6
       WHERE NOT EXISTS (SELECT 1 FROM "Competency" WHERE code = $1)`,
      [comp.code, comp.name, comp.kind, JSON.stringify(comp.levels), YEAR, now],
    );
  }
  // RatingScale
  for (const r of RATING_SCALE_SEED) {
    await c.query(
      `INSERT INTO "RatingScale" ("id","value","labelId","labelEn","minScore","color","guideline")
       SELECT gen_random_uuid()::text, $1,$2,$3,$4,$5,$6
       WHERE NOT EXISTS (SELECT 1 FROM "RatingScale" WHERE value = $1)`,
      [r.value, r.labelId, r.labelEn, r.minScore, r.color, r.guideline],
    );
  }
  // MeritMatrix default
  await c.query(
    `INSERT INTO "MeritMatrix" ("id","code","name","gridJson","active","createdAt","updatedAt")
     SELECT gen_random_uuid()::text, $1, $2, $3, true, $4, $4
     WHERE NOT EXISTS (SELECT 1 FROM "MeritMatrix" WHERE code = $1)`,
    [MERIT_MATRIX_SEED.code, MERIT_MATRIX_SEED.name, JSON.stringify(MERIT_MATRIX_SEED.grid), now],
  );
  // PerformanceTemplate + item (bobot merata dalam komponen)
  for (const t of TEMPLATE_SEED) {
    const tpl = await c.query(
      `SELECT id FROM "PerformanceTemplate" WHERE code = $1 LIMIT 1`, [t.code],
    );
    if (tpl.rowCount === 0) {
      const ins = await c.query(
        `INSERT INTO "PerformanceTemplate" ("id","code","name","weightsJson","active","createdAt","updatedAt")
         VALUES (gen_random_uuid()::text, $1,$2,$3, true, $4, $4) RETURNING id`,
        [t.code, t.name, JSON.stringify(t.weights), now],
      );
      const tplId = ins.rows[0].id;
      const kpiIds = (await c.query(
        `SELECT id FROM "KpiDefinition" WHERE code = ANY($1) AND "versionNo" = 1`, [t.kpis],
      )).rows as { id: string }[];
      const compIds = (await c.query(
        `SELECT id FROM "Competency" WHERE code = ANY($1) AND "versionNo" = 1`, [t.comps],
      )).rows as { id: string }[];
      const kpiW = kpiIds.length ? 100 / kpiIds.length : 0;
      const compW = compIds.length ? 100 / compIds.length : 0;
      for (const k of kpiIds) {
        await c.query(
          `INSERT INTO "PerformanceTemplateItem" ("id","templateId","kind","refId","weight")
           VALUES (gen_random_uuid()::text, $1,'Kpi',$2,$3)`,
          [tplId, k.id, kpiW],
        );
      }
      for (const k of compIds) {
        await c.query(
          `INSERT INTO "PerformanceTemplateItem" ("id","templateId","kind","refId","weight")
           VALUES (gen_random_uuid()::text, $1,'Competency',$2,$3)`,
          [tplId, k.id, compW],
        );
      }
    }
  }
}

export async function main(schemas?: string[]): Promise<void> {
  const targets = schemas && schemas.length ? schemas : await DEFAULT_SCHEMAS();
  if (!targets.length) return;
  const c = new Client({
    connectionString:
      process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
  });
  await c.connect();
  try {
    for (const schemaName of targets) {
      await c.query(`SET search_path TO "${schemaName}"`);
      for (const ddl of CREATE_TABLES) await c.query(ddl);
      for (const ddl of AFTER_TABLE) await c.query(ddl);
      await seedTenant(c, schemaName);
      console.log(`[m[migrate-performance-p0] schema: ${schemaName} — 20 tabel + seed master OK`);
    }
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
