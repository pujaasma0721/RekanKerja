// ============================================================================
// RECRUITMENT F3 — Proses seleksi terstruktur (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F3 + §4.2/§4.3 — §2.6 EvaluationProcess/PerCandidate + HRX D1/D3):
//   · rantai CandidateSelectionStep per kandidat (dibuat dari katalog master
//     saat nominasi — difilter appliesInternal/appliesExternal);
//   · lifecycle tahap: Planned → [Acknowledged] → Performed → Passed|Failed
//     (continueProcess) | Cancelled; SLA dueDate = plan + slaDays master;
//   · board kanban per PR (kolom = tahap; kartu = kandidat) + kalender bulanan
//     + monitor IncompleteEvaluation (tahap aktif lewat SLA → badge);
//   · surat undangan via mesin surat (LetterTemplate kategori "Recruitment",
//     key REC_INVITE) → snapshot RecruitmentLetter + PDF (letterPdfBuffer);
//   · reminder SLA (scheduler job jobSelectionReminders — 3 hari sebelum
//     dueDate & setiap hari saat overdue, dedupe claimReminder).
// Scorecard gate (HRX D2) didelegasikan ke scorecard-service.scorecardGateOk.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { Prisma } from "@/generated/tenant";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent } from "@/rekankerja/shared/services/email-service";
import { sendWa, employeePhoneOf } from "@/rekankerja/shared/services/wa-service";
import { getStepScorecards, scorecardGateOk } from "@/rekankerja/recruitment/services/scorecard-service";
import { getRecruitmentSetting, recruitmentAutomationOn } from "@/rekankerja/recruitment/services/recruitment-setting-service";

// ============ konstanta domain ============

export const CANDIDATE_STATUSES = ["Nominated", "InProcess", "Passed", "Failed", "Withdrawn"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_SOURCES = ["Internal", "External"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const STEP_STATUSES = ["Planned", "Acknowledged", "Performed", "Passed", "Failed", "Cancelled"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

const TERMINAL_STEP: StepStatus[] = ["Passed", "Failed", "Cancelled"];
const ACTIVE_CANDIDATE: CandidateStatus[] = ["Nominated", "InProcess"];

/** Template surat undangan seleksi (kategori Recruitment — letter-defaults). */
export const INVITE_TEMPLATE_KEY = "REC_INVITE";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function fmtDateId(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDateTimeId(d: Date | null | undefined): string {
  if (!d) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${fmtDateId(d)} ${hh}:${mm}`;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ============ tipe serializer ============

export interface CandidateCard {
  id: string;
  prId: string;
  prNo: string;
  applicantId: string | null;
  employeeId: string | null;
  source: CandidateSource;
  status: CandidateStatus;
  fullName: string;
  note: string | null;
  nominatedAt: string;
  nominatedByName: string | null;
  // progres
  currentStepId: string | null;
  currentStageId: string | null;
  currentStageName: string | null;
  currentSeqNo: number | null; // seqNo step aktif (1-based) — null = selesai
  totalSteps: number;
  passedSteps: number;
  latestScore: number | null; // skor tahap terakhir tercatat
  latestResult: string | null;
  // SLA & panel
  dueDate: string | null;
  overdue: boolean; // step aktif lewat dueDate
  planDate: string | null;
  scorecardCount: number; // scorecard submitted pada step aktif
  divergence: boolean; // flag kalibrasi (panel selisih >2)
  invitationLetterNo: string | null; // undangan step aktif
}

export interface BoardColumn {
  stageId: string; // SelectionProcess id; kolom terminal: "__passed__" / "__out__"
  name: string;
  code: string;
  seqNo: number;
  slaDays: number | null;
  resultType: string;
  needAck: boolean;
  mandatory: boolean;
  cards: CandidateCard[];
  overdueCount: number;
}

export interface SelectionBoard {
  pr: {
    id: string; prNo: string; status: string; positionTitle: string | null;
    requiredNo: number; employmentStatus: string;
    /** SB-RC-BL — PR ini punya daftar tahapan kustom (PrSelectionStage). */
    stageCustomized: boolean;
  };
  columns: BoardColumn[];
  /** badge IncompleteEvaluation per PR — tahap aktif yang lewat SLA. */
  overdueCount: number;
  stats: { nominated: number; inProcess: number; passed: number; failed: number; withdrawn: number; overdue: number };
}

export interface StepLetter {
  id: string;
  letterNo: string;
  kind: string;
  issuedAt: string;
}

export interface StepRow {
  id: string;
  candidateId: string;
  seqNo: number;
  stageId: string;
  stageName: string;
  stageCode: string;
  resultType: string;
  minResultPass: number | null;
  slaDays: number | null;
  needAck: boolean;
  mandatory: boolean;
  planDate: string | null;
  dueDate: string | null;
  acknowledgedAt: string | null;
  performedById: string | null;
  performerName: string | null;
  performedAt: string | null;
  status: StepStatus;
  score: number | null;
  result: string | null;
  comment: string | null;
  /** B6 — link meeting video-call tahap seleksi (opsional). */
  meetingUrl: string | null;
  continueProcess: boolean;
  reportFileName: string | null;
  letterNo: string | null;
  letters: StepLetter[];
  overdue: boolean;
  isCurrent: boolean;
  scorecardPanel: { count: number; submitted: number; divergence: boolean; feedbackOk: boolean };
}

export interface CandidateDetail {
  card: CandidateCard;
  pr: { id: string; prNo: string; positionTitle: string | null; requiredNo: number; employmentStatus: string; officerName: string | null };
  steps: StepRow[];
  /** profil penuh (admin HR) — pelamar eksternal atau karyawan internal. */
  profile: {
    kind: "External" | "Internal";
    applicantNo: string | null;
    employeeNo: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    educationLevel: string | null;
    gpa: number | null;
    totalExpMonths: number;
    expectedSalary: number | null; // null bila vault menyembunyikan
    sourceLabel: string | null;
    referralName: string | null;
  };
}

export interface CalendarEvent {
  stepId: string;
  candidateId: string;
  candidateName: string;
  prId: string;
  prNo: string;
  positionTitle: string | null;
  stageName: string;
  planDate: string;
  dueDate: string | null;
  status: StepStatus;
  source: CandidateSource;
  performerName: string | null;
  overdue: boolean;
}

// ============ include helpers ============

const STEP_LIST_INCLUDE = {
  selectionProcess: { select: { id: true, name: true, code: true, resultType: true, minResultPass: true, slaDays: true, needAcknowledgement: true, mandatory: true, processOrder: true } },
  performedBy: { select: { fullName: true } },
  letters: { select: { id: true, letterNo: true, kind: true, issuedAt: true }, orderBy: { issuedAt: "desc" as const } },
} satisfies Prisma.CandidateSelectionStepInclude;

type StepWithProc = Prisma.CandidateSelectionStepGetPayload<{ include: typeof STEP_LIST_INCLUDE }>;

const CANDIDATE_LIST_INCLUDE = {
  pr: { select: { id: true, prNo: true, status: true, position: { select: { title: true } }, requiredNo: true, employmentStatus: true, recruitmentOfficer: { select: { fullName: true } } } },
  nominatedBy: { select: { fullName: true } },
  selectionSteps: { include: STEP_LIST_INCLUDE, orderBy: { seqNo: "asc" as const } },
} satisfies Prisma.JobCandidateInclude;

type CandidateWithSteps = Prisma.JobCandidateGetPayload<{ include: typeof CANDIDATE_LIST_INCLUDE }>;

// ============ logika inti rantai ============

/** Tahap aktif = step non-terminal pertama (urut seqNo). */
function currentStepOf(steps: StepWithProc[]): StepWithProc | null {
  return steps.find((s) => !TERMINAL_STEP.includes(s.status as StepStatus)) ?? null;
}

function stepOverdue(s: StepWithProc | null): boolean {
  return !!s && !!s.dueDate && s.dueDate.getTime() < Date.now();
}

/**
 * Buat rantai tahap per kandidat — SB-RC-BL: bila PR punya daftar tahapan
 * kustom (PrSelectionStage, user-defined) pakai URUTAN itu (tetap difilter
 * appliesInternal/appliesExternal); PR tanpa kustom → katalog aktif standar
 * tenant urut processOrder (perilaku F3 lama). Dipanggil saat nominasi
 * (candidate-service).
 */
export async function ensureStepsForCandidate(db: TenantDb, candidate: { id: string; source: string; prId: string }): Promise<number> {
  const prStages = await db.prSelectionStage.findMany({
    where: { prId: candidate.prId },
    orderBy: { seqNo: "asc" },
    include: { selectionProcess: true },
  });
  const stages = prStages.length > 0
    ? prStages.map((ps) => ps.selectionProcess)
    : await db.selectionProcess.findMany({
      where: { active: true },
      orderBy: { processOrder: "asc" },
    });
  const applicable = stages.filter((s) =>
    candidate.source === "Internal" ? s.appliesInternal : s.appliesExternal,
  );
  let seq = 1;
  for (const st of applicable) {
    await db.candidateSelectionStep.create({
      data: { candidateId: candidate.id, selectionProcessId: st.id, seqNo: seq++ },
    });
  }
  return seq - 1;
}

/** Kartu board + baris tabel dari kandidat + panel scorecard step aktif. */
function cardOf(
  c: CandidateWithSteps,
  panel: { count: number; divergence: boolean } | null,
): CandidateCard {
  const cur = currentStepOf(c.selectionSteps);
  const done = c.selectionSteps.filter((s) => s.status === "Passed" || s.status === "Failed").length;
  const lastResult = [...c.selectionSteps].reverse().find((s) => s.status === "Passed" || s.status === "Failed");
  return {
    id: c.id, prId: c.prId, prNo: c.pr.prNo,
    applicantId: c.applicantId, employeeId: c.employeeId,
    source: c.source as CandidateSource, status: c.status as CandidateStatus,
    fullName: c.fullName, note: c.note,
    nominatedAt: c.nominatedAt.toISOString(), nominatedByName: c.nominatedBy?.fullName ?? null,
    currentStepId: cur?.id ?? null,
    currentStageId: cur?.selectionProcess.id ?? null,
    currentStageName: cur?.selectionProcess.name ?? null,
    currentSeqNo: cur?.seqNo ?? null,
    totalSteps: c.selectionSteps.length,
    passedSteps: done,
    latestScore: lastResult?.score ?? null,
    latestResult: lastResult?.result ?? null,
    dueDate: iso(cur?.dueDate),
    overdue: stepOverdue(cur),
    planDate: iso(cur?.planDate),
    scorecardCount: panel?.count ?? 0,
    divergence: panel?.divergence ?? false,
    invitationLetterNo: cur?.letters[0]?.letterNo ?? cur?.letterNo ?? null,
  };
}

/** Panel ringkas semua step PR (skor tertimbang evaluator utk divergensi). */
async function panelIndexForSteps(db: TenantDb, stepIds: string[]): Promise<Map<string, { count: number; divergence: boolean }>> {
  const out = new Map<string, { count: number; divergence: boolean }>();
  if (stepIds.length === 0) return out;
  const rows = await db.candidateScorecard.findMany({
    where: { selectionStepId: { in: stepIds }, submittedAt: { not: null } },
    include: { items: { include: { competency: { select: { weight: true } } } } },
  });
  const byStep = new Map<string, number[]>();
  for (const r of rows) {
    const arr = byStep.get(r.selectionStepId) ?? [];
    const wSum = r.items.reduce((s, i) => s + i.competency.weight, 0);
    const score = wSum > 0 ? r.items.reduce((s, i) => s + i.score * i.competency.weight, 0) / wSum : null;
    if (score != null) arr.push(score);
    byStep.set(r.selectionStepId, arr);
  }
  for (const id of stepIds) {
    const scores = byStep.get(id) ?? [];
    const gap = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : 0;
    out.set(id, { count: scores.length, divergence: gap > 2 });
  }
  return out;
}

// ============ board & list ============

export async function getBoard(db: TenantDb, prId: string): Promise<SelectionBoard | null> {
  const pr = await db.personnelRequisition.findUnique({
    where: { id: prId },
    select: {
      id: true, prNo: true, status: true, requiredNo: true, employmentStatus: true,
      position: { select: { title: true } },
      recruitmentOfficer: { select: { fullName: true } },
      // SB-RC-BL — deteksi daftar tahapan kustom per PR
      stages: { select: { id: true, seqNo: true } },
    },
  });
  if (!pr) return null;

  const candidates = await db.jobCandidate.findMany({
    where: { prId }, include: CANDIDATE_LIST_INCLUDE, orderBy: { nominatedAt: "asc" },
  });

  const allStepIds = candidates.flatMap((c) => c.selectionSteps.map((s) => s.id));
  const panels = await panelIndexForSteps(db, allStepIds);

  const cards = candidates.map((c) => {
    const cur = currentStepOf(c.selectionSteps);
    return cardOf(c, cur ? panels.get(cur.id) ?? null : null);
  });

  // kolom = tahap yang dipakai rantai kandidat PR ini (urut processOrder);
  // bila belum ada kandidat → SB-RC-BL: daftar kustom PR bila ada, selain itu
  // katalog aktif penuh (empty state informatif).
  const stageIds = new Set<string>();
  for (const c of candidates) for (const s of c.selectionSteps) stageIds.add(s.selectionProcessId);
  let stages: { id: string; name: string; code: string; processOrder: number; slaDays: number | null; resultType: string; needAcknowledgement: boolean; mandatory: boolean }[];
  if (stageIds.size > 0) {
    stages = await db.selectionProcess.findMany({
      where: { id: { in: [...stageIds] } },
      orderBy: { processOrder: "asc" },
    });
  } else {
    const prStages = await db.prSelectionStage.findMany({
      where: { prId },
      orderBy: { seqNo: "asc" },
      include: { selectionProcess: true },
    });
    stages = prStages.length > 0
      ? prStages.map((ps) => ps.selectionProcess)
      : await db.selectionProcess.findMany({ where: { active: true }, orderBy: { processOrder: "asc" } });
  }

  const columns: BoardColumn[] = stages.map((st, i) => {
    const colCards = cards.filter((c) =>
      c.status !== "Passed" && c.status !== "Failed" && c.status !== "Withdrawn"
        ? c.currentStageId === st.id
        : false,
    );
    return {
      stageId: st.id, name: st.name, code: st.code, seqNo: i + 1,
      slaDays: st.slaDays, resultType: st.resultType, needAck: st.needAcknowledgement, mandatory: st.mandatory,
      cards: colCards,
      overdueCount: colCards.filter((c) => c.overdue).length,
    };
  });

  // kolom terminal: Lulus semua tahap | Gagal/Ditarik
  const passedCards = cards.filter((c) => c.status === "Passed");
  const outCards = cards.filter((c) => c.status === "Failed" || c.status === "Withdrawn");
  const terminalBase = columns.length;
  columns.push({
    stageId: "__passed__", name: "Lulus", code: "PASSED", seqNo: terminalBase + 1,
    slaDays: null, resultType: "—", needAck: false, mandatory: false,
    cards: passedCards, overdueCount: 0,
  });
  columns.push({
    stageId: "__out__", name: "Gagal / Ditarik", code: "OUT", seqNo: terminalBase + 2,
    slaDays: null, resultType: "—", needAck: false, mandatory: false,
    cards: outCards, overdueCount: 0,
  });

  return {
    pr: { id: pr.id, prNo: pr.prNo, status: pr.status, positionTitle: pr.position?.title ?? null, requiredNo: pr.requiredNo, employmentStatus: pr.employmentStatus, stageCustomized: pr.stages.length > 0 },
    columns,
    overdueCount: cards.filter((c) => c.overdue).length,
    stats: {
      nominated: cards.filter((c) => c.status === "Nominated").length,
      inProcess: cards.filter((c) => c.status === "InProcess").length,
      passed: passedCards.length,
      failed: cards.filter((c) => c.status === "Failed").length,
      withdrawn: cards.filter((c) => c.status === "Withdrawn").length,
      overdue: cards.filter((c) => c.overdue).length,
    },
  };
}

/** Daftar kandidat lintas PR (tabel) + ringkasan per PR utk badge & picker. */
export async function listCandidates(db: TenantDb, opts: { prId?: string | null; status?: string | null }): Promise<{ rows: CandidateCard[] }> {
  const where: Prisma.JobCandidateWhereInput = {};
  if (opts.prId) where.prId = opts.prId;
  if (opts.status) where.status = opts.status;
  const candidates = await db.jobCandidate.findMany({
    where, include: CANDIDATE_LIST_INCLUDE, orderBy: { nominatedAt: "desc" }, take: 300,
  });
  const stepIds = candidates.flatMap((c) => c.selectionSteps.map((s) => s.id));
  const panels = await panelIndexForSteps(db, stepIds);
  return {
    rows: candidates.map((c) => {
      const cur = currentStepOf(c.selectionSteps);
      return cardOf(c, cur ? panels.get(cur.id) ?? null : null);
    }),
  };
}

// ============ SB-RC-BL — tahapan seleksi kustom per PR (user-defined) ============

/** Baris katalog utk dialog Tahapan PR (mirror ProcessOpt service masters). */
export interface PrStageCatalogRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  resultType: string;
  slaDays: number | null;
  mandatory: boolean;
  needAcknowledgement: boolean;
  appliesInternal: boolean;
  appliesExternal: boolean;
}

/** Konfigurasi tahapan PR utk dialog (standar vs kustom + katalog pilihan). */
export interface PrStageConfig {
  prId: string;
  prNo: string;
  customized: boolean; // PR punya daftar kustom (PrSelectionStage)
  /** urutan id tahap terpilih (kosong bila standar). */
  stageIds: string[];
  /** kandidat sudah ternominasi di PR ini (warning: perubahan hanya utk nominasi BARU). */
  candidateCount: number;
  catalog: PrStageCatalogRow[];
}

/** Baca konfigurasi tahapan PR + katalog lengkap (dialog "Tahapan PR"). */
export async function getPrStageConfig(db: TenantDb, prId: string): Promise<PrStageConfig | null> {
  const pr = await db.personnelRequisition.findUnique({
    where: { id: prId },
    select: {
      id: true, prNo: true,
      stages: { orderBy: { seqNo: "asc" }, select: { selectionProcessId: true } },
      _count: { select: { candidates: true } },
    },
  });
  if (!pr) return null;
  const catalog = await db.selectionProcess.findMany({
    orderBy: [{ active: "desc" }, { processOrder: "asc" }],
  });
  return {
    prId: pr.id,
    prNo: pr.prNo,
    customized: pr.stages.length > 0,
    stageIds: pr.stages.map((s) => s.selectionProcessId),
    candidateCount: pr._count.candidates,
    catalog: catalog.map((c) => ({
      id: c.id, code: c.code, name: c.name, active: c.active,
      resultType: c.resultType, slaDays: c.slaDays, mandatory: c.mandatory,
      needAcknowledgement: c.needAcknowledgement,
      appliesInternal: c.appliesInternal, appliesExternal: c.appliesExternal,
    })),
  };
}

/**
 * Simpan daftar tahapan kustom PR (replace-all dalam satu transaksi).
 * `processIds` kosong = reset ke standar tenant (hapus semua baris kustom).
 * Rantai kandidat yang SUDAH dibuat tidak disentuh (snapshot audit-safe) —
 * hanya nominasi berikutnya yang membaca daftar baru.
 */
export async function setPrStages(
  db: TenantDb,
  input: { prId: string; processIds: string[]; actorName?: string | null },
): Promise<{ customized: boolean; count: number }> {
  const pr = await db.personnelRequisition.findUnique({
    where: { id: input.prId },
    select: { id: true, prNo: true, stages: { select: { selectionProcessId: true } } },
  });
  if (!pr) throw new Error("Permintaan karyawan (PR) tidak ditemukan");

  // dedupe + validasi: semua id harus ada di katalog
  const ids = [...new Set(input.processIds)];
  if (ids.length > 0) {
    const found = await db.selectionProcess.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    if (found.length !== ids.length) throw new Error("Ada tahap seleksi yang tidak dikenal — muat ulang daftar tahapan");
  }

  await db.$transaction([
    db.prSelectionStage.deleteMany({ where: { prId: pr.id } }),
    ...ids.map((selectionProcessId, i) =>
      db.prSelectionStage.create({
        data: { prId: pr.id, selectionProcessId, seqNo: i + 1 },
      }),
    ),
  ]);

  const found = await db.selectionProcess.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameById = new Map(found.map((f) => [f.id, f.name]));
  const names = ids.map((id) => nameById.get(id)).filter((n): n is string => !!n);
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PrSelectionStage", entityId: pr.prNo,
      detail: ids.length > 0
        ? `Tahapan seleksi PR ${pr.prNo} dikustomisasi: ${ids.length} tahap (${names.join(" → ")}) — berlaku utk nominasi kandidat BARU${input.actorName ? ` oleh ${input.actorName}` : ""}`
        : `Tahapan seleksi PR ${pr.prNo} direset ke standar tenant${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return { customized: ids.length > 0, count: ids.length };
}


/** Badge IncompleteEvaluation per PR (dipakai picker PR + overview). */
export async function selectionSummaries(db: TenantDb): Promise<{ prId: string; prNo: string; candidates: number; active: number; overdue: number; invitations: number }[]> {
  const rows = await db.jobCandidate.findMany({
    where: { status: { in: [...ACTIVE_CANDIDATE] } },
    select: { prId: true, pr: { select: { prNo: true } }, selectionSteps: { select: { status: true, dueDate: true }, orderBy: { seqNo: "asc" } } },
  });
  // surat undangan terbit per PR (RecruitmentLetter via kandidat)
  const letters = await db.recruitmentLetter.findMany({
    where: { kind: "Invitation" },
    select: { candidate: { select: { prId: true } } },
    take: 1000,
  });
  const inviteByPr = new Map<string, number>();
  for (const l of letters) {
    const k = l.candidate.prId;
    inviteByPr.set(k, (inviteByPr.get(k) ?? 0) + 1);
  }
  const map = new Map<string, { prId: string; prNo: string; candidates: number; active: number; overdue: number; invitations: number }>();
  for (const r of rows) {
    const cur = r.selectionSteps.find((s) => !TERMINAL_STEP.includes(s.status as StepStatus)) ?? null;
    const overdue = !!cur && !!cur.dueDate && cur.dueDate.getTime() < Date.now();
    const prev = map.get(r.prId) ?? { prId: r.prId, prNo: r.pr.prNo, candidates: 0, active: 0, overdue: 0, invitations: 0 };
    prev.candidates++;
    prev.active++;
    if (overdue) prev.overdue++;
    map.set(r.prId, prev);
  }
  for (const [prId, v] of map) v.invitations = inviteByPr.get(prId) ?? 0;
  return [...map.values()].sort((a, b) => a.prNo.localeCompare(b.prNo));
}

export async function getCandidateDetail(db: TenantDb, id: string, moneyVisible: boolean): Promise<CandidateDetail | null> {
  const c = await db.jobCandidate.findUnique({ where: { id }, include: CANDIDATE_LIST_INCLUDE });
  if (!c) return null;

  // panel per step (lengkap — dipakai tab scorecard)
  const panels = new Map<string, Awaited<ReturnType<typeof getStepScorecards>>>();
  for (const s of c.selectionSteps) {
    panels.set(s.id, await getStepScorecards(db, s.id));
  }
  const cur = currentStepOf(c.selectionSteps);
  const card = cardOf(c, cur ? { count: panels.get(cur.id)?.scorecards.filter((x) => x.submittedAt).length ?? 0, divergence: panels.get(cur.id)?.divergence ?? false } : null);

  // profil penuh (PII decrypt di batas serializer — pola applicant-service)
  const tc = tenantCryptoForDb(db);
  let profile: CandidateDetail["profile"];
  if (c.applicantId) {
    const a = await db.applicant.findUnique({
      where: { id: c.applicantId },
      include: { adMediaType: { select: { name: true } }, referralEmployee: { select: { fullName: true } } },
    });
    profile = {
      kind: "External",
      applicantNo: a?.applicantNo ?? null, employeeNo: null,
      email: a ? tc.decryptText(a.email) : null,
      phone: a ? tc.decryptText(a.phone) : null,
      city: a ? tc.decryptText(a.city) : null,
      educationLevel: a?.highestEduLevel ?? null, gpa: a?.highestGpa ?? null,
      totalExpMonths: a?.totalExpMonths ?? 0,
      expectedSalary: moneyVisible && a ? (a.expectedSalary ? Number(tc.decryptMoney(a.expectedSalary)) : null) : null,
      sourceLabel: a?.source ?? null,
      referralName: a?.referralEmployee?.fullName ?? null,
    };
  } else {
    const e = await db.employee.findUnique({
      where: { id: c.employeeId ?? "" },
      select: { employeeNo: true, email: true, position: { select: { title: true } } },
    });
    profile = {
      kind: "Internal",
      applicantNo: null, employeeNo: e?.employeeNo ?? null,
      email: e?.email ?? null, phone: null, city: null,
      educationLevel: null, gpa: null, totalExpMonths: 0,
      expectedSalary: null, sourceLabel: "Karyawan Internal",
      referralName: e?.position?.title ?? null,
    };
  }

  return {
    card,
    pr: { id: c.pr.id, prNo: c.pr.prNo, positionTitle: c.pr.position?.title ?? null, requiredNo: c.pr.requiredNo, employmentStatus: c.pr.employmentStatus, officerName: c.pr.recruitmentOfficer?.fullName ?? null },
    steps: c.selectionSteps.map((s) => {
      const panel = panels.get(s.id);
      return {
        id: s.id, candidateId: s.candidateId, seqNo: s.seqNo,
        stageId: s.selectionProcess.id, stageName: s.selectionProcess.name, stageCode: s.selectionProcess.code,
        resultType: s.selectionProcess.resultType, minResultPass: s.selectionProcess.minResultPass,
        slaDays: s.selectionProcess.slaDays, needAck: s.selectionProcess.needAcknowledgement,
        mandatory: s.selectionProcess.mandatory,
        planDate: iso(s.planDate), dueDate: iso(s.dueDate), acknowledgedAt: iso(s.acknowledgedAt),
        performedById: s.performedById, performerName: s.performedBy?.fullName ?? null, performedAt: iso(s.performedAt),
        status: s.status as StepStatus, score: s.score, result: s.result, comment: s.comment,
        meetingUrl: s.meetingUrl ?? null,
        continueProcess: s.continueProcess, reportFileName: s.reportFileName,
        letterNo: s.letterNo,
        letters: s.letters.map((l) => ({ id: l.id, letterNo: l.letterNo, kind: l.kind, issuedAt: l.issuedAt.toISOString() })),
        overdue: stepOverdue(s),
        isCurrent: cur?.id === s.id,
        scorecardPanel: {
          count: panel?.scorecards.length ?? 0,
          submitted: panel?.scorecards.filter((x) => x.submittedAt != null).length ?? 0,
          divergence: panel?.divergence ?? false,
          feedbackOk: panel?.feedbackOk ?? false,
        },
      };
    }),
    profile,
  };
}

// ============ aksi tahap ============

async function stepCtx(db: TenantDb, stepId: string) {
  const step = await db.candidateSelectionStep.findUnique({
    where: { id: stepId },
    include: {
      selectionProcess: true,
      performedBy: { select: { fullName: true } },
      candidate: { include: CANDIDATE_LIST_INCLUDE },
    },
  });
  if (!step) throw new Error("Tahap seleksi tidak ditemukan");
  return step;
}

function assertStepEditable(step: { status: string }) {
  if (TERMINAL_STEP.includes(step.status as StepStatus)) {
    throw new Error(`Tahap sudah berakhir (${step.status}) — tidak bisa diubah`);
  }
}

function parseDateInput(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * B6 — validasi link meeting video-call: wajib URL http/https bila diisi.
 * Kosong → null; tidak valid → throw (API merespons 400).
 */
function parseMeetingUrl(v: string | null | undefined): string | null {
  const s = v?.trim() ?? "";
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Link meeting harus berupa URL http/https yang valid (contoh: https://meet.google.com/abc-defg-hij)");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Link meeting harus berupa URL http/https yang valid (contoh: https://meet.google.com/abc-defg-hij)");
  }
  return u.toString();
}

export interface ScheduleStepInput {
  stepId: string;
  planDate: string; // datetime-local ISO
  dueDate?: string | null; // override SLA (opsional)
  performedById?: string | null; // evaluator penanggung jawab
  /** B6 — link meeting video-call (opsional, URL http/https). */
  meetingUrl?: string | null;
  actorName?: string | null;
}

/** Jadwalkan tahap (plan + due SLA + evaluator + link meeting B6) + notifikasi evaluator/kandidat. */
export async function scheduleStep(db: TenantDb, input: ScheduleStepInput): Promise<void> {
  const step = await stepCtx(db, input.stepId);
  assertStepEditable(step);
  const plan = parseDateInput(input.planDate);
  if (!plan) throw new Error("Jadwal (plan date) wajib diisi");
  const meetingUrl = parseMeetingUrl(input.meetingUrl ?? null); // invalid → throw → 400

  const slaDays = step.selectionProcess.slaDays;
  const due = parseDateInput(input.dueDate ?? null) ?? (slaDays ? new Date(plan.getTime() + slaDays * 86_400_000) : null);

  await db.candidateSelectionStep.update({
    where: { id: step.id },
    data: {
      planDate: plan, dueDate: due,
      performedById: input.performedById ?? step.performedById ?? null,
      meetingUrl,
      // reschedule → ack di-reset (undangan baru perlu konfirmasi baru)
      acknowledgedAt: null, status: "Planned",
    },
  });

  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateSelectionStep", entityId: step.candidate.pr.prNo,
      detail: `Tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName} (${step.candidate.pr.prNo}) dijadwalkan ${fmtDateTimeId(plan)}${due ? ` — SLA s.d. ${fmtDateId(due)}` : ""}${meetingUrl ? ` — link meeting ${meetingUrl}` : ""}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });

  if (input.performedById) {
    const ev = await db.employee.findUnique({ where: { id: input.performedById }, select: { fullName: true, email: true } });
    void notifyEvent(db, {
      to: "employee", employeeId: input.performedById, docType: "RecruitmentSelection", docNo: step.candidate.pr.prNo,
      title: `Jadwal seleksi baru — ${step.selectionProcess.name}`,
      body: `${step.candidate.fullName} (${step.candidate.pr.prNo}) dijadwalkan ${fmtDateTimeId(plan)}${due ? `, batas SLA ${fmtDateId(due)}` : ""}${ev ? `. Evaluator: ${ev.fullName}` : ""}`,
      kind: "recruitment", link: "recruitment:selection",
    }).catch(() => {});
    if (ev?.email) {
      void notifyEmailEvent(db, {
        event: "recruitment.selection.scheduled",
        to: [{ email: ev.email, name: ev.fullName }],
        data: {
          nama: ev.fullName, docNo: step.candidate.pr.prNo,
          posisi: step.candidate.pr.position?.title ?? "-",
          kandidat: step.candidate.fullName, tahap: step.selectionProcess.name,
          urutan: String(step.seqNo), totalTahap: String(step.candidate.selectionSteps.length),
          jadwal: fmtDateTimeId(plan), batasSla: due ? fmtDateId(due) : "-",
          linkMeeting: meetingUrl ?? "-",
        },
      });
    }
  }

  // B6 — WhatsApp paralel (fire-and-forget, never-throw; pola shift-swap):
  // undangan ke KANDIDAT (nomor Applicant terenkripsi — PII decrypt hanya
  // di batas service) + info jadwal ke EVALUATOR (employeePhoneOf).
  void (async () => {
    const ph = (nama: string) => ({
      nama, docNo: step.candidate.pr.prNo,
      posisi: step.candidate.pr.position?.title ?? "-",
      kandidat: step.candidate.fullName, tahap: step.selectionProcess.name,
      jadwal: fmtDateTimeId(plan), batasSla: due ? fmtDateId(due) : "-",
      linkMeeting: meetingUrl ?? "-",
    });
    const [evaluatorPhone, applicantRow] = await Promise.all([
      employeePhoneOf(db, input.performedById ?? null),
      step.candidate.applicantId
        ? db.applicant.findUnique({ where: { id: step.candidate.applicantId }, select: { phone: true, email: true } })
        : Promise.resolve(null),
    ]);
    if (evaluatorPhone && input.performedById) {
      const ev = await db.employee.findUnique({ where: { id: input.performedById }, select: { fullName: true } }).catch(() => null);
      void sendWa(db, { event: "recruitment.selection.scheduled", toPhone: evaluatorPhone, placeholders: ph(ev?.fullName ?? "Evaluator") });
    }
    const candPhone = applicantRow?.phone ? tenantCryptoForDb(db).decryptText(applicantRow.phone) : null;
    if (candPhone) {
      void sendWa(db, { event: "recruitment.selection.scheduled", toPhone: candPhone, placeholders: ph(step.candidate.fullName) });
    }

    // REC-AUDIT-FIX M9 — wiring setting "auto.ack.email.candidate" (dulu DEAD
    // CONFIG: toggle ada di UI Pengaturan Rekrutmen tapi service tidak pernah
    // membacanya): email undangan ke KANDIDAT saat tahap dijadwalkan —
    // default ON, baris "false" di RecruitmentSetting mematikannya.
    if (step.candidate.applicantId) {
      const on = await recruitmentAutomationOn(db, "auto.ack.email.candidate").catch(() => true);
      const candEmail = applicantRow?.email ? tenantCryptoForDb(db).decryptText(applicantRow.email) : null;
      if (on && candEmail) {
        void notifyEmailEvent(db, {
          event: "recruitment.selection.scheduled",
          to: [{ email: candEmail, name: step.candidate.fullName }],
          data: {
            nama: step.candidate.fullName, docNo: step.candidate.pr.prNo,
            posisi: step.candidate.pr.position?.title ?? "-",
            kandidat: step.candidate.fullName, tahap: step.selectionProcess.name,
            urutan: String(step.seqNo), totalTahap: String(step.candidate.selectionSteps.length),
            jadwal: fmtDateTimeId(plan), batasSla: due ? fmtDateId(due) : "-",
            linkMeeting: meetingUrl ?? "-",
          },
        });
      }
    }
  })().catch(() => { /* notifikasi tidak boleh mengganggu proses utama */ });
}

/** Acknowledgement kandidat/peserta (RequestAcknowledge — HRX D3). */
export async function acknowledgeStep(db: TenantDb, input: { stepId: string; actorName?: string | null; onBehalf?: boolean }): Promise<void> {
  const step = await stepCtx(db, input.stepId);
  if (step.status !== "Planned") throw new Error("Hanya tahap berstatus Planned yang bisa di-acknowledge");
  await db.candidateSelectionStep.update({
    where: { id: step.id },
    data: { status: "Acknowledged", acknowledgedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateSelectionStep", entityId: step.candidate.pr.prNo,
      detail: `Tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName} di-acknowledge${input.onBehalf ? " (atas nama kandidat)" : ""}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
}

export interface RecordResultInput {
  stepId: string;
  performedById?: string | null;
  performedAt?: string | null;
  score?: number | null;
  result?: string | null;
  comment?: string | null;
  /** Pass|Fail — bila kosong & tahap Quantitative dgn minResultPass → derive dari skor. */
  outcome?: "Pass" | "Fail" | null;
  /** Gagal tapi proses lanjut (keputusan HR). */
  continueProcess?: boolean | null;
  actorName?: string | null;
}

async function applyStepResult(db: TenantDb, input: RecordResultInput): Promise<{ outcome: "Pass" | "Fail" | null; candidateStatus: CandidateStatus }> {
  const step = await stepCtx(db, input.stepId);
  assertStepEditable(step);

  // outcome eksplisit > derive skor kuantitatif
  let outcome = input.outcome ?? null;
  if (!outcome && step.selectionProcess.resultType === "Quantitative" && step.selectionProcess.minResultPass != null && input.score != null) {
    outcome = input.score >= (step.selectionProcess.minResultPass as number) ? "Pass" : "Fail";
  }

  // REC-AUDIT-FIX L3 — tanpa hasil akhir yang bisa ditentukan, catat
  // PELAKSANAAN saja: status Performed (state mesin yang dulu tak pernah
  // ditulis — "Planned → [Acknowledged] → Performed → Passed|Failed").
  // Skor/catatan tersimpan; hasil Lulus/Gagal menyusul lewat pemanggilan
  // berikutnya. Kandidat Nominated dinaikkan ke InProcess (proses sudah jalan).
  if (!outcome) {
    await db.candidateSelectionStep.update({
      where: { id: step.id },
      data: {
        status: "Performed",
        score: input.score ?? null,
        result: input.result?.trim() || null,
        comment: input.comment?.trim() || null,
        performedById: input.performedById ?? step.performedById ?? null,
        performedAt: parseDateInput(input.performedAt) ?? new Date(),
      },
    });
    const prevStatus = step.candidate.status as CandidateStatus;
    const candidateStatus: CandidateStatus = prevStatus === "Nominated" ? "InProcess" : prevStatus;
    if (candidateStatus !== prevStatus) {
      await db.jobCandidate.update({ where: { id: step.candidate.id }, data: { status: candidateStatus } });
    }
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "JobCandidate", entityId: step.candidate.pr.prNo,
        detail: `Tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName} DIJALANKAN (Performed — hasil akhir menyusul)${input.score != null ? ` (skor sementara ${input.score})` : ""}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
      },
    });
    return { outcome: null, candidateStatus };
  }

  // HRX D2 — feedback scorecard wajib sebelum naik tahap
  if (outcome === "Pass") {
    const gate = await scorecardGateOk(db, { id: step.id, selectionProcessId: step.selectionProcessId });
    if (!gate.ok) throw new Error(gate.reason);
  }

  const continueProcess = outcome === "Fail" ? (input.continueProcess ?? false) : true;

  await db.candidateSelectionStep.update({
    where: { id: step.id },
    data: {
      status: outcome === "Pass" ? "Passed" : "Failed",
      score: input.score ?? null,
      result: input.result?.trim() || null,
      comment: input.comment?.trim() || null,
      continueProcess,
      performedById: input.performedById ?? step.performedById ?? null,
      performedAt: parseDateInput(input.performedAt) ?? new Date(),
    },
  });

  // transisi kandidat + step berikutnya
  const remaining = step.candidate.selectionSteps.filter((s) => s.id !== step.id && !TERMINAL_STEP.includes(s.status as StepStatus));
  let candidateStatus: CandidateStatus;
  if (outcome === "Pass") {
    candidateStatus = remaining.length > 0 ? "InProcess" : "Passed";
  } else if (continueProcess && remaining.length > 0) {
    candidateStatus = "InProcess";
  } else {
    candidateStatus = "Failed";
    // hentikan sisa rantai
    for (const s of remaining) {
      await db.candidateSelectionStep.update({
        where: { id: s.id },
        data: { status: "Cancelled", comment: `Proses dihentikan — gagal tahap ${step.selectionProcess.name}` },
      });
    }
  }
  if (candidateStatus !== step.candidate.status) {
    await db.jobCandidate.update({ where: { id: step.candidate.id }, data: { status: candidateStatus } });
  }

  await db.activityLog.create({
    data: {
      action: "Updated", entity: "JobCandidate", entityId: step.candidate.pr.prNo,
      detail: `Hasil tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName}: ${outcome === "Pass" ? "LULUS" : "GAGAL"}${input.score != null ? ` (skor ${input.score})` : ""}${outcome === "Fail" && !continueProcess ? " — proses dihentikan" : ""}; status kandidat → ${candidateStatus}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return { outcome, candidateStatus };
}

/** Catat hasil tahap eksplisit (dari detail kandidat — tombol per step).
 *  Tanpa hasil akhir → tahap dicatat Performed (L3 — lihat applyStepResult). */
export async function recordStepResult(db: TenantDb, input: RecordResultInput): Promise<{ outcome: "Pass" | "Fail" | null; candidateStatus: CandidateStatus }> {
  return applyStepResult(db, input);
}

/** Naikkan kandidat ke tahap berikutnya (board drag / bulk) — hasil tahap aktif. */
export async function advanceCandidate(db: TenantDb, input: Omit<RecordResultInput, "stepId"> & { candidateId: string }): Promise<{ outcome: "Pass" | "Fail" | null; candidateStatus: CandidateStatus; stepId: string }> {
  const candidate = await db.jobCandidate.findUnique({
    where: { id: input.candidateId },
    include: { selectionSteps: { include: STEP_LIST_INCLUDE, orderBy: { seqNo: "asc" } } },
  });
  if (!candidate) throw new Error("Kandidat tidak ditemukan");
  if (candidate.status === "Withdrawn") throw new Error("Kandidat sudah ditarik");
  const cur = currentStepOf(candidate.selectionSteps);
  if (!cur) throw new Error("Semua tahap sudah selesai — kandidat tidak bisa dimajukan");
  const res = await applyStepResult(db, { ...input, stepId: cur.id });
  return { ...res, stepId: cur.id };
}

/** Batalkan satu tahap (mis. tahap tidak relevan utk kandidat ini). */
export async function cancelStep(db: TenantDb, input: { stepId: string; comment?: string | null; actorName?: string | null }): Promise<void> {
  const step = await stepCtx(db, input.stepId);
  assertStepEditable(step);
  await db.candidateSelectionStep.update({
    where: { id: step.id },
    data: { status: "Cancelled", comment: input.comment?.trim() || "Dibatalkan (tidak relevan)" },
  });
  // step aktif berikutnya otomatis jadi current; bila habis → kandidat Passed?
  const remaining = step.candidate.selectionSteps.filter((s) => s.id !== step.id && !TERMINAL_STEP.includes(s.status as StepStatus));
  if (remaining.length === 0 && ACTIVE_CANDIDATE.includes(step.candidate.status as CandidateStatus)) {
    const anyPassed = step.candidate.selectionSteps.some((s) => s.id !== step.id && s.status === "Passed");
    await db.jobCandidate.update({ where: { id: step.candidate.id }, data: { status: anyPassed ? "Passed" : "Failed" } });
  } else if (ACTIVE_CANDIDATE.includes(step.candidate.status as CandidateStatus) && step.candidate.status === "Nominated") {
    await db.jobCandidate.update({ where: { id: step.candidate.id }, data: { status: "InProcess" } });
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CandidateSelectionStep", entityId: step.candidate.pr.prNo,
      detail: `Tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName} dibatalkan${input.comment ? ` — ${input.comment}` : ""}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
}

/** Tambah tahap ke rantai kandidat (fleksibilitas per kandidat — risk F3). */
export async function addStep(db: TenantDb, input: { candidateId: string; selectionProcessId: string; actorName?: string | null }): Promise<string> {
  const candidate = await db.jobCandidate.findUnique({
    where: { id: input.candidateId },
    include: { selectionSteps: { include: STEP_LIST_INCLUDE, orderBy: { seqNo: "asc" } } },
  });
  if (!candidate) throw new Error("Kandidat tidak ditemukan");
  const stage = await db.selectionProcess.findUnique({ where: { id: input.selectionProcessId } });
  if (!stage || !stage.active) throw new Error("Tahap master tidak ditemukan / tidak aktif");
  if (candidate.selectionSteps.some((s) => s.selectionProcessId === stage.id)) {
    throw new Error(`Tahap ${stage.name} sudah ada di rantai kandidat ini`);
  }
  const created = await db.candidateSelectionStep.create({
    data: { candidateId: candidate.id, selectionProcessId: stage.id, seqNo: 999 },
  });

  // REC-AUDIT-FIX M8 — urutkan ulang seluruh rantai by processOrder (seqNo
  // aman — unik per pasangan [candidate, stage, seq], stage berbeda tak pernah
  // bentrok). DULU ada 2 bug: (1) idx dipetakan SEBELUM sort (urutan lama!
  // — sort tidak mengubah apa pun, tahap baru TIDAK masuk posisi processOrder);
  // (2) tiap update fire-and-forget `void` (gagal tenggorokan tanpa jejak).
  // Sekarang: sort DULU baru index, dan seluruh penomoran dijalankan dalam
  // $transaction (atomik + gagal terlihat).
  const all = [...candidate.selectionSteps.map((s) => ({ id: s.id, processOrder: s.selectionProcess.processOrder })), { id: created.id, processOrder: stage.processOrder }]
    .sort((a, b) => a.processOrder - b.processOrder);
  await db.$transaction(
    all.map((x, i) => db.candidateSelectionStep.update({ where: { id: x.id }, data: { seqNo: i + 1 } })),
  );

  if (candidate.status === "Nominated") {
    await db.jobCandidate.update({ where: { id: candidate.id }, data: { status: "InProcess" } });
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "CandidateSelectionStep", entityId: candidate.prId,
      detail: `Tahap ${stage.name} ditambahkan ke rantai kandidat ${candidate.fullName}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return created.id;
}

/** Tarik kandidat (Withdrawn) — sisa tahap aktif dibatalkan. */
export async function withdrawCandidate(db: TenantDb, input: { candidateId: string; note?: string | null; actorName?: string | null }): Promise<void> {
  const candidate = await db.jobCandidate.findUnique({
    where: { id: input.candidateId },
    include: { selectionSteps: { where: { status: { in: ["Planned", "Acknowledged", "Performed"] } } } },
  });
  if (!candidate) throw new Error("Kandidat tidak ditemukan");
  if (candidate.status === "Withdrawn") throw new Error("Kandidat sudah ditarik");
  await db.jobCandidate.update({
    where: { id: candidate.id },
    data: { status: "Withdrawn", note: input.note?.trim() || candidate.note },
  });
  for (const s of candidate.selectionSteps) {
    await db.candidateSelectionStep.update({
      where: { id: s.id },
      data: { status: "Cancelled", comment: input.note?.trim() || "Kandidat ditarik dari proses" },
    });
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "JobCandidate", entityId: candidate.prId,
      detail: `Kandidat ${candidate.fullName} ditarik dari proses${input.note ? ` — ${input.note}` : ""}${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
}

// ============ surat undangan (letter engine — kategori Recruitment) ============

export interface InvitationResult {
  id: string;
  letterNo: string;
  body: string;
  subject: string | null;
  issuedAt: string;
  /** true bila surat ini sudah ada sebelumnya (idempoten per tahap). */
  existing: boolean;
}

const PDF_COMPANY_SELECT = { name: true, address: true, city: true, phone: true, taxId: true } as const;

/** Terbitkan surat undangan untuk tahap — idempoten per (step, template). */
export async function issueInvitation(db: TenantDb, input: { stepId: string; actorId?: string | null; actorName?: string | null }): Promise<InvitationResult> {
  const step = await stepCtx(db, input.stepId);
  assertStepEditable(step);
  if (!step.planDate) throw new Error("Jadwalkan tahap terlebih dahulu sebelum menerbitkan undangan");

  // idempoten per tahap + template
  const existing = await db.recruitmentLetter.findFirst({
    where: { selectionStepId: step.id, templateKey: INVITE_TEMPLATE_KEY, kind: "Invitation" },
    orderBy: { issuedAt: "desc" },
  });
  if (existing) {
    return { id: existing.id, letterNo: existing.letterNo, body: existing.body, subject: existing.subject, issuedAt: existing.issuedAt.toISOString(), existing: true };
  }

  const template = await db.letterTemplate.findFirst({ where: { key: INVITE_TEMPLATE_KEY, active: true } });
  if (!template) {
    const any = await db.letterTemplate.findUnique({ where: { key: INVITE_TEMPLATE_KEY } });
    throw new Error(`Template surat undangan (REC_INVITE) belum tersedia${any ? " — aktifkan di menu Template Surat" : " — hubungi admin untuk seeding"}`);
  }

  // nomor NNN/HR-RC/{romawi}/{tahun} (pola letter-service)
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const countSame = await db.recruitmentLetter.count({ where: { issuedAt: { gte: yearStart, lt: yearEnd } } });
  const letterNo = `${String(countSame + 1).padStart(3, "0")}/HR-RC/${ROMAN[now.getMonth()]}/${now.getFullYear()}`;

  // konteks kandidat (PII decrypt di batas serializer)
  const tc = tenantCryptoForDb(db);
  const company = await db.company.findFirst({ select: PDF_COMPANY_SELECT });
  const candidate = step.candidate;
  let city = "—";
  let sourceLabel = "Portal Web";
  if (candidate.applicantId) {
    const a = await db.applicant.findUnique({ where: { id: candidate.applicantId }, select: { city: true, source: true } });
    if (a) {
      const c = tc.decryptText(a.city);
      if (c && c.trim()) city = c;
      if (a.source) sourceLabel = a.source;
    }
  } else {
    sourceLabel = "Kandidat Internal (karyawan)";
  }

  const ctx: Record<string, string> = {
    letter_no: letterNo,
    letter_date: fmtDateId(now),
    city: company?.city ?? "Jakarta",
    company_name: company?.name ?? "RekanKerja HRIS",
    signatory_name: template.signatoryName?.trim() || "HR Manager",
    signatory_title: template.signatoryTitle,
    candidate_name: candidate.fullName,
    candidate_city: city,
    candidate_source: sourceLabel,
    pr_no: candidate.pr.prNo,
    position_name: candidate.pr.position?.title ?? "posisi sesuai PR",
    stage_name: step.selectionProcess.name,
    stage_seq: String(step.seqNo),
    stage_total: String(candidate.selectionSteps.length),
    result_type: step.selectionProcess.resultType,
    plan_date: fmtDateTimeId(step.planDate),
    due_date: step.dueDate ? fmtDateId(step.dueDate) : "—",
    evaluator_name: step.performedBy?.fullName ?? "Tim Rekrutmen",
  };
  // render lokal (renderLetterBody murni — tanpa konteks employee)
  const body = template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = ctx[token];
    return v != null && v.trim() !== "" ? v : "—";
  });

  const doc = await db.recruitmentLetter.create({
    data: {
      letterNo, kind: "Invitation", templateKey: INVITE_TEMPLATE_KEY,
      candidateId: candidate.id, selectionStepId: step.id,
      subject: template.subject, body,
      metaJson: JSON.stringify({ templateName: template.name, stageName: step.selectionProcess.name, planDate: step.planDate.toISOString() }),
      createdById: input.actorId ?? null,
    },
  });
  // tampilkan nomor undangan tercepat di step
  await db.candidateSelectionStep.update({ where: { id: step.id }, data: { letterNo } });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "RecruitmentLetter", entityId: letterNo,
      detail: `Surat undangan ${letterNo} tahap ${step.selectionProcess.name} kandidat ${candidate.fullName} (${candidate.pr.prNo})${input.actorName ? ` oleh ${input.actorName}` : ""}`,
    },
  });
  return { id: doc.id, letterNo, body, subject: template.subject, issuedAt: doc.issuedAt.toISOString(), existing: false };
}

/** PDF surat rekrutmen (kop perusahaan — letterPdfBuffer mesin surat).
 *  F7: tanggal metadata PDF DIKUNCI ke issuedAt surat → byte PDF deterministik
 *  lintas proses (hash sha256 e-sign kandidat dapat diverifikasi ulang). */
export async function letterPdf(db: TenantDb, letterId: string): Promise<Uint8Array | null> {
  const letter = await db.recruitmentLetter.findUnique({ where: { id: letterId } });
  if (!letter) return null;
  const { letterPdfBuffer } = await import("@/rekankerja/shared/services/letter-service");
  const company = await db.company.findFirst({ select: PDF_COMPANY_SELECT });
  return letterPdfBuffer(
    { refNo: letter.letterNo, body: letter.body, subject: letter.subject },
    company ? { name: company.name, address: company.address, city: company.city, phone: company.phone, taxId: company.taxId } : null,
    null,
    null,
    letter.issuedAt,
  );
}

// ============ kalender seleksi bulanan ============

export async function getSelectionCalendar(db: TenantDb, month: string): Promise<{ month: string; events: CalendarEvent[] }> {
  // month = "YYYY-MM"
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error("Format bulan tidak valid (YYYY-MM)");
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);

  const steps = await db.candidateSelectionStep.findMany({
    where: { planDate: { gte: start, lt: end } },
    include: {
      selectionProcess: { select: { name: true } },
      performedBy: { select: { fullName: true } },
      candidate: {
        select: {
          id: true, fullName: true, source: true,
          pr: { select: { id: true, prNo: true, position: { select: { title: true } } } },
        },
      },
    },
    orderBy: { planDate: "asc" },
    take: 500,
  });

  return {
    month,
    events: steps.map((s) => ({
      stepId: s.id, candidateId: s.candidate.id, candidateName: s.candidate.fullName,
      prId: s.candidate.pr.id, prNo: s.candidate.pr.prNo, positionTitle: s.candidate.pr.position?.title ?? null,
      stageName: s.selectionProcess.name,
      planDate: s.planDate!.toISOString(), dueDate: iso(s.dueDate),
      status: s.status as StepStatus, source: s.candidate.source as CandidateSource,
      performerName: s.performedBy?.fullName ?? null,
      overdue: !!s.dueDate && s.dueDate.getTime() < Date.now() && !TERMINAL_STEP.includes(s.status as StepStatus),
    })),
  };
}

// ============ scheduler job — reminder SLA tahap (HRX D3 ADAPT) ============

/**
 * Pengingat tahap seleksi (diimpor scheduler-service):
 *   · dueDate ≤ 3 hari lagi → "X hari lagi";
 *   · dueDate lewat → "TERLAMBAT X hari" (harian, dedupe claimReminder).
 * Penerima: evaluator (performedById) → fallback officer PR → admin HR.
 */
export async function jobSelectionReminders(db: TenantDb): Promise<{ reminded: number; notified: number }> {
  // F7 — setting otomasi (default ON; baris "false" mematikan reminder)
  if ((await getRecruitmentSetting(db, "auto.reminder.selection", "true").catch(() => "true")) === "false") {
    return { reminded: 0, notified: 0 };
  }
  const now = Date.now();
  const horizon = new Date(now + 3 * 86_400_000);
  const steps = await db.candidateSelectionStep.findMany({
    where: {
      status: { in: ["Planned", "Acknowledged", "Performed"] },
      dueDate: { not: null, lte: horizon },
    },
    include: {
      selectionProcess: { select: { name: true } },
      performedBy: { select: { id: true, fullName: true, email: true } },
      candidate: {
        select: {
          id: true, fullName: true, applicantId: true,
          pr: { select: { id: true, prNo: true, position: { select: { title: true } }, recruitmentOfficer: { select: { id: true, fullName: true, email: true } } } },
        },
      },
    },
    take: 300,
  });

  let reminded = 0;
  let notified = 0;
  for (const s of steps) {
    if (!s.dueDate) continue;
    const diffDays = Math.ceil((s.dueDate.getTime() - now) / 86_400_000);
    const overdue = s.dueDate.getTime() < now;
    const statusSla = overdue ? `TERLAMBAT ${Math.abs(diffDays)} hari` : `${diffDays} hari lagi`;

    const target = s.performedBy ?? s.candidate.pr.recruitmentOfficer;
    const key = `selection-reminder:${s.id}:${overdue ? "overdue" : "due"}:${s.dueDate.toISOString().slice(0, 10)}`;
    const claimed = await db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM "ActivityLog"
      WHERE "action" = 'Reminder' AND "entity" = 'Scheduler' AND "entityId" = ${key}`.then((r) => r[0]?.n ?? 0);
    if (claimed > 0) continue; // sudah diingatkan utk tanggal ini

    if (target) {
      const res = await notifyEvent(db, {
        to: "employee", employeeId: target.id, docType: "RecruitmentSelection", docNo: s.candidate.pr.prNo,
        title: `[Pengingat] ${s.selectionProcess.name} — ${s.candidate.fullName}`,
        body: `${statusSla} (batas ${fmtDateId(s.dueDate)}) — ${s.candidate.pr.prNo}${s.candidate.pr.position?.title ? ` · ${s.candidate.pr.position.title}` : ""}`,
        kind: "recruitment", link: "recruitment:selection",
      }).catch(() => ({ recipients: [] }));
      notified += res.recipients.length;
      if (target.email) {
        void notifyEmailEvent(db, {
          event: "recruitment.selection.reminder",
          to: [{ email: target.email, name: target.fullName }],
          data: {
            nama: target.fullName, docNo: s.candidate.pr.prNo,
            posisi: s.candidate.pr.position?.title ?? "-",
            kandidat: s.candidate.fullName, tahap: s.selectionProcess.name,
            jadwal: fmtDateTimeId(s.planDate), batasSla: fmtDateId(s.dueDate), statusSla,
            linkMeeting: s.meetingUrl ?? "-",
          },
        });
      }
      // B6 — WhatsApp paralel (fire-and-forget, never-throw): pengingat ke
      // EVALUATOR (employeePhoneOf) + KANDIDAT (Applicant.phone terenkripsi).
      void (async () => {
        const ph = (nama: string) => ({
          nama, docNo: s.candidate.pr.prNo,
          posisi: s.candidate.pr.position?.title ?? "-",
          kandidat: s.candidate.fullName, tahap: s.selectionProcess.name,
          jadwal: fmtDateTimeId(s.planDate), batasSla: fmtDateId(s.dueDate),
          linkMeeting: s.meetingUrl ?? "-",
        });
        const [targetPhone, applicantRow] = await Promise.all([
          employeePhoneOf(db, target.id),
          s.candidate.applicantId
            ? db.applicant.findUnique({ where: { id: s.candidate.applicantId }, select: { phone: true } })
            : Promise.resolve(null),
        ]);
        if (targetPhone) {
          void sendWa(db, { event: "recruitment.selection.reminder", toPhone: targetPhone, placeholders: ph(target.fullName) });
        }
        const candPhone = applicantRow?.phone ? tenantCryptoForDb(db).decryptText(applicantRow.phone) : null;
        if (candPhone) {
          void sendWa(db, { event: "recruitment.selection.reminder", toPhone: candPhone, placeholders: ph(s.candidate.fullName) });
        }
      })().catch(() => { /* notifikasi tidak boleh mengganggu proses utama */ });
    }
    await db.activityLog.create({
      data: {
        actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key,
        detail: `Pengingat SLA tahap ${s.selectionProcess.name} kandidat ${s.candidate.fullName} (${s.candidate.pr.prNo}) — ${statusSla}`,
      },
    });
    reminded++;
  }
  return { reminded, notified };
}
