// Migrasi F3-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F3) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×7 (JobCandidate, CandidateSelectionStep,
//      ScorecardTemplate, ScorecardCompetency, CandidateScorecard,
//      ScorecardItem, RecruitmentLetter) + unique/index/FK — selaras
//      prisma/tenant-ddl.sql.
//   2. Referensi F3 untuk SEMUA tenant: template surat REC_INVITE (kategori
//      "Recruitment" — letter-defaults), minResultPass Psikotes=70, dan 3
//      template scorecard default (2 terikat tahap + 1 umum).
//   3. Seed demo MII (insert-only bila JobCandidate masih kosong) — SEMUA
//      lewat jalur produksi (nominateApplicant/nominateEmployee/scheduleStep/
//      issueInvitation/acknowledgeStep/saveScorecard/recordStepResult):
//        • PR Approved + 5 kandidat eksternal + 1 internal:
//          – Dewi: step 1 dijadwalkan + SURAT UNDANGAN terbit + ack
//          – Gita: 2 scorecard evaluator (selisih >2 → flag kalibrasi)
//          – Maria: step 1 overdue (SLA lewat 10 hari — badge overdue)
//          – Ahmad: lulus tahap 1 (scorecard+hasil), GAGAL tahap 2 Psikotes
//            skor 60 < 70 → kandidat Failed + sisa tahap Cancelled
//          – Budi: LULUS SEMUA 5 tahap (kolom Lulus) — scorecard utk tahap
//            yang berubrik
//          – 1 karyawan internal (Nominated — utk ESS MySelectionProcess)
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU CLI: bun run scripts/migrate-recruitment-f3.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { LETTER_TEMPLATE_DEFAULTS } from "@/rekankerja/shared/lib/letter-defaults";
import { nominateApplicant, nominateEmployee } from "@/rekankerja/recruitment/services/candidate-service";
import {
  scheduleStep, issueInvitation, acknowledgeStep, recordStepResult,
} from "@/rekankerja/recruitment/services/selection-service";
import { saveScorecard } from "@/rekankerja/recruitment/services/scorecard-service";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "JobCandidate" (
    "id" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "applicantId" TEXT,
    "employeeId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'External',
    "status" TEXT NOT NULL DEFAULT 'Nominated',
    "fullName" TEXT NOT NULL,
    "nominatedById" TEXT,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobCandidate_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CandidateSelectionStep" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionProcessId" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "planDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Planned',
    "score" DOUBLE PRECISION,
    "result" TEXT,
    "comment" TEXT,
    "continueProcess" BOOLEAN NOT NULL DEFAULT true,
    "reportFileName" TEXT,
    "letterNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateSelectionStep_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ScorecardTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "selectionProcessId" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScorecardTemplate_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ScorecardCompetency" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "anchorsJson" TEXT,
    "orderNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScorecardCompetency_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CandidateScorecard" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionStepId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "recommendation" TEXT,
    "overallComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateScorecard_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ScorecardItem" (
    "id" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "competencyId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScorecardItem_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RecruitmentLetter" (
    "id" TEXT NOT NULL,
    "letterNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "selectionStepId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "metaJson" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "RecruitmentLetter_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "JobCandidate_prId_applicantId_key" ON "JobCandidate"("prId", "applicantId")`,
  `CREATE INDEX IF NOT EXISTS "JobCandidate_prId_status_idx" ON "JobCandidate"("prId", "status")`,
  `CREATE INDEX IF NOT EXISTS "JobCandidate_employeeId_idx" ON "JobCandidate"("employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateSelectionStep_candidateId_selectionProcessId_seqNo_key" ON "CandidateSelectionStep"("candidateId", "selectionProcessId", "seqNo")`,
  `CREATE INDEX IF NOT EXISTS "CandidateSelectionStep_candidateId_status_idx" ON "CandidateSelectionStep"("candidateId", "status")`,
  `CREATE INDEX IF NOT EXISTS "CandidateSelectionStep_status_dueDate_idx" ON "CandidateSelectionStep"("status", "dueDate")`,
  `CREATE INDEX IF NOT EXISTS "ScorecardTemplate_active_idx" ON "ScorecardTemplate"("active")`,
  `CREATE INDEX IF NOT EXISTS "ScorecardCompetency_templateId_orderNo_idx" ON "ScorecardCompetency"("templateId", "orderNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateScorecard_selectionStepId_evaluatorId_key" ON "CandidateScorecard"("selectionStepId", "evaluatorId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ScorecardItem_scorecardId_competencyId_key" ON "ScorecardItem"("scorecardId", "competencyId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecruitmentLetter_letterNo_key" ON "RecruitmentLetter"("letterNo")`,
  `CREATE INDEX IF NOT EXISTS "RecruitmentLetter_candidateId_issuedAt_idx" ON "RecruitmentLetter"("candidateId", "issuedAt")`,
  `CREATE INDEX IF NOT EXISTS "RecruitmentLetter_kind_issuedAt_idx" ON "RecruitmentLetter"("kind", "issuedAt")`,
  // penyembuhan instalasi F3 awal (kolom ditambahkan setelah revisi skema)
  `ALTER TABLE "JobCandidate" ALTER COLUMN "nominatedById" DROP NOT NULL`,
  `ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "letterNo" TEXT`,
  // FK drop-add idempoten (pola F2)
  `ALTER TABLE "JobCandidate" DROP CONSTRAINT IF EXISTS "JobCandidate_prId_fkey"`,
  `ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "JobCandidate" DROP CONSTRAINT IF EXISTS "JobCandidate_applicantId_fkey"`,
  `ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobCandidate" DROP CONSTRAINT IF EXISTS "JobCandidate_employeeId_fkey"`,
  `ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobCandidate" DROP CONSTRAINT IF EXISTS "JobCandidate_nominatedById_fkey"`,
  `ALTER TABLE "JobCandidate" ADD CONSTRAINT "JobCandidate_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateSelectionStep" DROP CONSTRAINT IF EXISTS "CandidateSelectionStep_candidateId_fkey"`,
  `ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateSelectionStep" DROP CONSTRAINT IF EXISTS "CandidateSelectionStep_selectionProcessId_fkey"`,
  `ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_selectionProcessId_fkey" FOREIGN KEY ("selectionProcessId") REFERENCES "SelectionProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateSelectionStep" DROP CONSTRAINT IF EXISTS "CandidateSelectionStep_performedById_fkey"`,
  `ALTER TABLE "CandidateSelectionStep" ADD CONSTRAINT "CandidateSelectionStep_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "ScorecardCompetency" DROP CONSTRAINT IF EXISTS "ScorecardCompetency_templateId_fkey"`,
  `ALTER TABLE "ScorecardCompetency" ADD CONSTRAINT "ScorecardCompetency_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateScorecard" DROP CONSTRAINT IF EXISTS "CandidateScorecard_candidateId_fkey"`,
  `ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateScorecard" DROP CONSTRAINT IF EXISTS "CandidateScorecard_selectionStepId_fkey"`,
  `ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateScorecard" DROP CONSTRAINT IF EXISTS "CandidateScorecard_templateId_fkey"`,
  `ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScorecardTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateScorecard" DROP CONSTRAINT IF EXISTS "CandidateScorecard_evaluatorId_fkey"`,
  `ALTER TABLE "CandidateScorecard" ADD CONSTRAINT "CandidateScorecard_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "ScorecardItem" DROP CONSTRAINT IF EXISTS "ScorecardItem_scorecardId_fkey"`,
  `ALTER TABLE "ScorecardItem" ADD CONSTRAINT "ScorecardItem_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "CandidateScorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ScorecardItem" DROP CONSTRAINT IF EXISTS "ScorecardItem_competencyId_fkey"`,
  `ALTER TABLE "ScorecardItem" ADD CONSTRAINT "ScorecardItem_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "ScorecardCompetency"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "RecruitmentLetter" DROP CONSTRAINT IF EXISTS "RecruitmentLetter_candidateId_fkey"`,
  `ALTER TABLE "RecruitmentLetter" ADD CONSTRAINT "RecruitmentLetter_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "RecruitmentLetter" DROP CONSTRAINT IF EXISTS "RecruitmentLetter_selectionStepId_fkey"`,
  `ALTER TABLE "RecruitmentLetter" ADD CONSTRAINT "RecruitmentLetter_selectionStepId_fkey" FOREIGN KEY ("selectionStepId") REFERENCES "CandidateSelectionStep"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

// ============ referensi F3 (SEMUA tenant — idempoten) ============

/** Template scorecard default (HRX D2) — 2 terikat tahap + 1 umum. */
const SCORECARD_SEED: { name: string; stageCode: string | null; description: string; competencies: { name: string; weight: number }[] }[] = [
  {
    name: "Interview HR — Screening Awal",
    stageCode: "INTERVIEW_HR",
    description: "Rubrik penyaringan awal oleh HR (kesesuaian diri, motivasi, ekspektasi).",
    competencies: [
      { name: "Komunikasi & Interaksi", weight: 1 },
      { name: "Kesesuaian Diri & Motivasi", weight: 1 },
      { name: "Kecocokan Ekspektasi Kerja", weight: 1 },
    ],
  },
  {
    name: "Interview User — Kompetensi Teknis",
    stageCode: "INTERVIEW_USER",
    description: "Rubrik wawancara user/atasan (keahlian teknis bidang).",
    competencies: [
      { name: "Keahlian Teknis Bidang", weight: 1.5 },
      { name: "Problem Solving & Analisis", weight: 1 },
      { name: "Kualitas & Ketelitian Hasil Kerja", weight: 1 },
    ],
  },
  {
    name: "Rubrik Umum Wawancara",
    stageCode: null,
    description: "Rubrik generik — bisa dipakai tahap mana pun tanpa rubrik khusus.",
    competencies: [
      { name: "Komunikasi", weight: 1 },
      { name: "Kerja Sama Tim", weight: 1 },
      { name: "Inisiatif & Proaktif", weight: 1 },
      { name: "Integritas & Etika Kerja", weight: 1 },
    ],
  },
];

async function ensureF3Reference(db: ReturnType<typeof getTenantClient>): Promise<string[]> {
  const notes: string[] = [];

  // 1) template surat REC_INVITE (kategori Recruitment — letter-defaults)
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    if (t.category !== "Recruitment") continue;
    const before = await db.letterTemplate.findUnique({ where: { key: t.key }, select: { id: true } });
    if (before) continue;
    await db.letterTemplate.create({
      data: {
        key: t.key, category: t.category, name: t.name,
        description: t.description ?? null, subject: t.subject ?? null,
        body: t.body, signatoryTitle: t.signatoryTitle,
      },
    });
    notes.push(`template surat ${t.key}`);
  }

  // 2) Psikotes minResultPass = 70 (padanan min_result_pass oranHR §2.6)
  const psiko = await db.selectionProcess.findUnique({ where: { code: "PSIKOTES" }, select: { id: true, minResultPass: true } });
  if (psiko && psiko.minResultPass == null) {
    await db.selectionProcess.update({ where: { id: psiko.id }, data: { minResultPass: 70 } });
    notes.push("minResultPass Psikotes=70");
  }

  // 3) template scorecard default (idempoten per nama)
  for (const t of SCORECARD_SEED) {
    const before = await db.scorecardTemplate.findFirst({ where: { name: t.name }, select: { id: true } });
    if (before) continue;
    const stage = t.stageCode ? await db.selectionProcess.findUnique({ where: { code: t.stageCode }, select: { id: true } }) : null;
    const tpl = await db.scorecardTemplate.create({
      data: {
        name: t.name, description: t.description,
        selectionProcessId: stage?.id ?? null, active: true,
      },
    });
    let order = 1;
    for (const c of t.competencies) {
      await db.scorecardCompetency.create({
        data: { templateId: tpl.id, name: c.name, weight: c.weight, orderNo: order++ },
      });
    }
    notes.push(`scorecard "${t.name}"`);
  }
  return notes;
}

// ============ demo seed (MII saja — insert-only bila kosong) ============

async function seedDemoF3(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.jobCandidate.count();
  if (existing > 0) return "";

  // PR Approved + pelamar demo F2
  const pr = await db.personnelRequisition.findFirst({
    where: { status: "Approved" },
    select: { id: true, prNo: true },
    orderBy: { prNo: "asc" },
  });
  if (!pr) return "";

  const applicants = await db.applicant.findMany({
    where: { status: "Active" },
    select: { id: true, applicantNo: true, firstName: true, lastName: true },
    orderBy: { applicantNo: "asc" },
  });
  const byFirst = (n: string) => applicants.find((a) => a.firstName === n);

  // evaluator: 2 karyawan aktif pertama
  const emps = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, fullName: true },
    orderBy: { employeeNo: "asc" }, take: 4,
  });
  if (emps.length < 2) return "";
  const [ev1, ev2] = emps;
  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  const nominatorId = hrdUser?.employeeId ?? ev1!.id;

  // tahap master + template rubrik
  const stages = await db.selectionProcess.findMany({ where: { active: true }, orderBy: { processOrder: "asc" }, select: { id: true, code: true, name: true } });
  const stage = (code: string) => stages.find((s) => s.code === code)!;
  const interviewHr = stage("INTERVIEW_HR");
  const templates = await db.scorecardTemplate.findMany({ include: { competencies: { orderBy: { orderNo: "asc" } } } });
  const hrTpl = templates.find((t) => t.selectionProcessId === interviewHr.id);
  if (!hrTpl) return "";

  const days = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  // ---- 1) Dewi — dijadwalkan + SURAT UNDANGAN + acknowledge ----
  const dewi = byFirst("Dewi");
  if (dewi) {
    const cand = await nominateApplicant(db, { prId: pr.id, applicantId: dewi.id, nominatedById: nominatorId, actorName: "Demo Seed F3" });
    const step = await db.candidateSelectionStep.findFirst({ where: { candidateId: cand.id, selectionProcessId: interviewHr.id } });
    if (step) {
      await scheduleStep(db, { stepId: step.id, planDate: days(3).toISOString(), performedById: ev1!.id, actorName: "Demo Seed F3" });
      await issueInvitation(db, { stepId: step.id, actorId: nominatorId, actorName: "Demo Seed F3" });
      await acknowledgeStep(db, { stepId: step.id, actorName: "Demo Seed F3", onBehalf: true });
    }
  }

  // ---- 2) Gita — 2 evaluator scorecard divergen (gap >2 → flag kalibrasi) ----
  const gita = byFirst("Gita");
  if (gita) {
    const cand = await nominateApplicant(db, { prId: pr.id, applicantId: gita.id, nominatedById: nominatorId, actorName: "Demo Seed F3" });
    const step = await db.candidateSelectionStep.findFirst({ where: { candidateId: cand.id, selectionProcessId: interviewHr.id } });
    if (step) {
      await scheduleStep(db, { stepId: step.id, planDate: days(5).toISOString(), performedById: ev1!.id, actorName: "Demo Seed F3" });
      const compIds = hrTpl.competencies.map((c) => c.id);
      await saveScorecard(db, {
        selectionStepId: step.id, evaluatorId: ev1!.id, templateId: hrTpl.id,
        items: compIds.map((id, i) => ({ competencyId: id, score: i === 2 ? 4 : 5 })),
        recommendation: "StrongHire",
        overallComment: "Sangat komunikatif, motivasi tinggi, ekspektasi selaras — direkomendasikan lanjut.",
        submit: true,
      }, "Demo Seed F3");
      await saveScorecard(db, {
        selectionStepId: step.id, evaluatorId: ev2!.id, templateId: hrTpl.id,
        items: compIds.map((id, i) => ({ competencyId: id, score: i === 2 ? 3 : 2 })),
        recommendation: "NoHire",
        overallComment: "Cukup komunikatif namun motivasi tampak datar — perlu diskusi kalibrasi panel.",
        submit: true,
      }, "Demo Seed F3");
      // perform tanpa hasil → menunggu keputusan HR (flag divergensi terlihat)
      await db.candidateSelectionStep.update({ where: { id: step.id }, data: { status: "Performed", performedAt: new Date(), performedById: ev1!.id } });
      await db.jobCandidate.update({ where: { id: cand.id }, data: { status: "InProcess" } });
    }
  }

  // ---- 3) Maria — SLA overdue (plan 40 hr lalu, SLA 30 hr → lewat 10 hr) ----
  const maria = byFirst("Maria");
  if (maria) {
    const cand = await nominateApplicant(db, { prId: pr.id, applicantId: maria.id, nominatedById: nominatorId, actorName: "Demo Seed F3" });
    const step = await db.candidateSelectionStep.findFirst({ where: { candidateId: cand.id, selectionProcessId: interviewHr.id } });
    if (step) {
      await scheduleStep(db, { stepId: step.id, planDate: days(-40).toISOString(), performedById: ev2!.id, actorName: "Demo Seed F3" });
    }
  }

  // ---- 4) Ahmad — lulus tahap 1 (scorecard+hasil), GAGAL tahap 2 Psikotes 60<70 ----
  const ahmad = byFirst("Ahmad");
  if (ahmad) {
    const cand = await nominateApplicant(db, { prId: pr.id, applicantId: ahmad.id, nominatedById: nominatorId, actorName: "Demo Seed F3" });
    const step1 = await db.candidateSelectionStep.findFirst({ where: { candidateId: cand.id, selectionProcessId: interviewHr.id } });
    if (step1) {
      await scheduleStep(db, { stepId: step1.id, planDate: days(-12).toISOString(), performedById: ev1!.id, actorName: "Demo Seed F3" });
      const compIds = hrTpl.competencies.map((c) => c.id);
      await saveScorecard(db, {
        selectionStepId: step1.id, evaluatorId: ev1!.id, templateId: hrTpl.id,
        items: compIds.map((id) => ({ competencyId: id, score: 4 })),
        recommendation: "Hire",
        overallComment: "Penyaringan awal baik — komunikasi dan motivasi memenuhi standar posisi.",
        submit: true,
      }, "Demo Seed F3");
      await recordStepResult(db, {
        stepId: step1.id, outcome: "Pass", performedById: ev1!.id,
        result: "Memenuhi standar screening awal",
        comment: "Lanjut ke psikotes", actorName: "Demo Seed F3",
      });
    }
    const step2 = await db.candidateSelectionStep.findFirst({ where: { candidateId: cand.id, selectionProcessId: stage("PSIKOTES").id } });
    if (step2) {
      await scheduleStep(db, { stepId: step2.id, planDate: days(-5).toISOString(), performedById: ev2!.id, actorName: "Demo Seed F3" });
      await recordStepResult(db, {
        stepId: step2.id, score: 60, performedById: ev2!.id,
        result: "Skor di bawah batas kelulusan (70)",
        actorName: "Demo Seed F3",
      }); // Quantitative + minResultPass → auto Fail, continueProcess=false → kandidat Failed
    }
  }

  // ---- 5) Budi — LULUS SEMUA tahap (kolom Lulus) ----
  const budi = byFirst("Budi");
  if (budi) {
    const cand = await nominateApplicant(db, { prId: pr.id, applicantId: budi.id, nominatedById: nominatorId, actorName: "Demo Seed F3" });
    const steps = await db.candidateSelectionStep.findMany({ where: { candidateId: cand.id }, orderBy: { seqNo: "asc" } });
    const userTpl = templates.find((t) => t.selectionProcessId === stage("INTERVIEW_USER").id);
    for (const s of steps) {
      const stg = stages.find((x) => x.id === s.selectionProcessId)!;
      await scheduleStep(db, { stepId: s.id, planDate: days(-30 + steps.indexOf(s) * 3).toISOString(), performedById: ev1!.id, actorName: "Demo Seed F3" });
      const tpl = stg.code === "INTERVIEW_HR" ? hrTpl : stg.code === "INTERVIEW_USER" ? userTpl : null;
      if (tpl) {
        const compIds = tpl.competencies.map((c) => c.id);
        await saveScorecard(db, {
          selectionStepId: s.id, evaluatorId: ev1!.id, templateId: tpl.id,
          items: compIds.map((id) => ({ competencyId: id, score: 4 })),
          recommendation: "Hire",
          overallComment: `Hasil ${stg.name} positif — direkomendasikan lanjut ke tahap berikutnya.`,
          submit: true,
        }, "Demo Seed F3");
      }
      await recordStepResult(db, {
        stepId: s.id, outcome: "Pass", performedById: ev1!.id,
        result: stg.code === "PSIKOTES" ? "Skor 82 — di atas batas kelulusan" : "Memenuhi standar",
        actorName: "Demo Seed F3",
      });
    }
  }

  // ---- 6) kandidat internal (karyawan aktif — ESS MySelectionProcess).
  // Yusuf Rahayu MII00010 dipilih karena punya akun ESS demo (yusuf@mii.co.id
  // / EssDemo123! — scripts/seed-ess-demo-user.ts) supaya E2E bisa login ESS
  // dan melihat tahapan sendiri (acceptance F3).
  const essEmp = (await db.employee.findFirst({ where: { employeeNo: "MII00010" }, select: { id: true } }))
    ?? emps.find((e) => e.id !== ev1!.id && e.id !== ev2!.id)
    ?? emps[3];
  if (essEmp) {
    await nominateEmployee(db, { prId: pr.id, employeeId: essEmp.id, nominatedById: nominatorId, note: "Kandidat internal — mutasi lintas unit (HRX A4)", actorName: "Demo Seed F3" });
  }

  return `${pr.prNo}: 6 kandidat (Dewi undangan terbit · Gita divergensi panel · Maria overdue · Ahmad gagal Psikotes · Budi lulus semua · 1 internal)`;
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f3] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        await c.query(ddl);
      }
      console.log(`    7 tabel F3 siap (JobCandidate … RecruitmentLetter)`);
    } finally {
      await c.end();
    }

    // referensi (semua tenant)
    const db = getTenantClient(schemaName);
    const notes = await ensureF3Reference(db);
    if (notes.length > 0) console.log(`    referensi: ${notes.join(" · ")}`);

    // demo hanya untuk tenant MII
    if (schemaName.includes("mitra_industri")) {
      const demo = await seedDemoF3(schemaName);
      if (demo) console.log(`    demo: ${demo}`);
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, BUKAN saat diimpor
// aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
