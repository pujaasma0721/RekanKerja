"use client";
// RekanKerja Recruitment F3 — tipe & atom bersama view "Kandidat & Seleksi".
// Mirror serializer selection-service.ts / scorecard-service.ts (pola F2:
// komponen client TIDAK meng-import file service — interface lokal identik).
// Dipakai selection.tsx (papan/kalender) + selection-dialogs.tsx (dialog).
// F6b: + tipe mirror kontrak /api/…/recruitment/ai (skor AI + rubrik per PR).
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

export const SELECTION_API = "/api/rekankerja/recruitment/selection";
export const CANDIDATES_API = "/api/rekankerja/recruitment/candidates";
/** API AI rekrutmen (F6a parse CV + F6b skor AI/rubrik — sama-sama /ai). */
export const AI_API = "/api/rekankerja/recruitment/ai";

/** localStorage switch "Mode Buta" board seleksi (HRX B6/F6c — display only). */
export const BLIND_LS_KEY = "rk-blind-selection";

// ============ tipe (mirror JSON API F3) ============

export type CandidateSource = "Internal" | "External";
export type CandidateStatus = "Nominated" | "InProcess" | "Passed" | "Failed" | "Withdrawn";
export type StepStatus = "Planned" | "Acknowledged" | "Performed" | "Passed" | "Failed" | "Cancelled";

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
  currentStepId: string | null;
  currentStageId: string | null;
  currentStageName: string | null;
  currentSeqNo: number | null;
  totalSteps: number;
  passedSteps: number;
  latestScore: number | null;
  latestResult: string | null;
  dueDate: string | null;
  overdue: boolean;
  planDate: string | null;
  scorecardCount: number;
  divergence: boolean;
  invitationLetterNo: string | null;
}

export interface BoardColumn {
  stageId: string; // "__passed__" / "__out__" = kolom terminal
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
  };
  columns: BoardColumn[];
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
    expectedSalary: number | null;
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

export interface SummaryRow {
  prId: string;
  prNo: string;
  candidates: number;
  active: number;
  overdue: number;
  invitations: number;
}

export interface ScorecardItemRow {
  competencyId: string;
  name: string;
  weight: number;
  score: number;
  comment: string | null;
}

export interface ScorecardRow {
  id: string;
  evaluatorId: string;
  evaluatorName: string;
  evaluatorNo: string | null;
  templateId: string;
  templateName: string;
  submittedAt: string | null;
  recommendation: string | null;
  overallComment: string | null;
  weightedScore: number | null;
  items: ScorecardItemRow[];
}

export interface PanelResult {
  scorecards: ScorecardRow[];
  panelAvg: number | null;
  divergence: boolean;
  divergenceGap: number;
  feedbackOk: boolean;
}

export interface CompetencyRow {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  orderNo: number;
  anchors: { value: number; label: string; guide: string }[];
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  selectionProcessId: string | null;
  stageName: string | null;
  active: boolean;
  usedCount: number;
  competencies: CompetencyRow[];
}

/** picker options=1 /candidates. */
export interface EmployeeOpt { id: string; employeeNo: string; fullName: string; positionTitle: string | null }
export interface PrOpt { id: string; prNo: string; positionTitle: string | null; requiredNo: number; status: string }
export interface NominationOptions { prs: PrOpt[]; employees: EmployeeOpt[] }

/** baris pelamar picker (?status=Active&limit=100). */
export interface ApplicantOpt {
  id: string;
  applicantNo: string;
  fullName: string;
  status: string;
  source: string | null;
  sourceLabel: string | null;
}

/** master tahap seleksi (?masters&type=selection-process). */
export interface ProcessOpt {
  id: string;
  code: string;
  name: string;
  active: boolean;
  resultType?: string | null;
  minResultPass?: number | null;
  processOrder?: number;
}

/** hasil POST invite (idempoten). */
export interface InvitationResult {
  id: string;
  letterNo: string;
  body: string;
  subject: string | null;
  issuedAt: string;
  existing: boolean;
}

// ============ label domain (dwibahasa) ============

export const CANDIDATE_STATUSES: { key: CandidateStatus; label: string; labelEn: string }[] = [
  { key: "Nominated", label: "Dinominasikan", labelEn: "Nominated" },
  { key: "InProcess", label: "Proses Seleksi", labelEn: "In Process" },
  { key: "Passed", label: "Lulus", labelEn: "Passed" },
  { key: "Failed", label: "Gagal", labelEn: "Failed" },
  { key: "Withdrawn", label: "Ditarik", labelEn: "Withdrawn" },
];
export const CAND_LABEL: Record<string, string> = Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s.key, s.label]));
export const CAND_LABEL_EN: Record<string, string> = Object.fromEntries(CANDIDATE_STATUSES.map((s) => [s.key, s.labelEn]));
export const CAND_TONE: Record<string, string> = {
  Nominated: "slate", InProcess: "amber", Passed: "emerald", Failed: "rose", Withdrawn: "zinc",
};

export const STEP_STATUSES: { key: StepStatus; label: string; labelEn: string }[] = [
  { key: "Planned", label: "Terjadwal", labelEn: "Planned" },
  { key: "Acknowledged", label: "Dikonfirmasi", labelEn: "Acknowledged" },
  { key: "Performed", label: "Dilaksanakan", labelEn: "Performed" },
  { key: "Passed", label: "Lulus", labelEn: "Passed" },
  { key: "Failed", label: "Gagal", labelEn: "Failed" },
  { key: "Cancelled", label: "Dibatalkan", labelEn: "Cancelled" },
];
export const STEP_LABEL: Record<string, string> = Object.fromEntries(STEP_STATUSES.map((s) => [s.key, s.label]));
export const STEP_LABEL_EN: Record<string, string> = Object.fromEntries(STEP_STATUSES.map((s) => [s.key, s.labelEn]));
export const STEP_TONE: Record<string, string> = {
  Planned: "slate", Acknowledged: "brand", Performed: "amber", Passed: "emerald", Failed: "rose", Cancelled: "zinc",
};

export const RECOMMENDATIONS: { key: string; label: string; labelEn: string }[] = [
  { key: "StrongHire", label: "Sangat Rekomendasi", labelEn: "Strong Hire" },
  { key: "Hire", label: "Rekomendasi", labelEn: "Hire" },
  { key: "NoHire", label: "Tidak Rekomendasi", labelEn: "No Hire" },
  { key: "StrongNoHire", label: "Sangat Tidak Rekomendasi", labelEn: "Strong No Hire" },
];
export const REC_LABEL: Record<string, string> = Object.fromEntries(RECOMMENDATIONS.map((s) => [s.key, s.label]));
export const REC_LABEL_EN: Record<string, string> = Object.fromEntries(RECOMMENDATIONS.map((s) => [s.key, s.labelEn]));
export const REC_TONE: Record<string, string> = {
  StrongHire: "emerald", Hire: "teal", NoHire: "amber", StrongNoHire: "rose",
};

// ============ tone → kelas pill (pola F2 applicants) ============

const TONE_CLS: Record<string, string> = {
  brand: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
};
const TONE_DOT: Record<string, string> = {
  brand: "bg-brand", emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500",
  teal: "bg-teal-500", slate: "bg-slate-400", zinc: "bg-zinc-400",
};

/** Pill status generik ber-ton (pola Pill F2 applicants.tsx). */
export function Pill({ tone, children, className }: { tone: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      TONE_CLS[tone] ?? TONE_CLS.slate, TONE_DOT[tone] ?? TONE_DOT.slate, className,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} />
      {children}
    </span>
  );
}

export function CandPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={CAND_TONE[status] ?? "slate"}>{t(CAND_LABEL[status] ?? status, CAND_LABEL_EN[status] ?? status)}</Pill>;
}

export function StepPill({ status }: { status: string }) {
  const { t } = useI18n();
  return <Pill tone={STEP_TONE[status] ?? "slate"}>{t(STEP_LABEL[status] ?? status, STEP_LABEL_EN[status] ?? status)}</Pill>;
}

export function RecPill({ rec }: { rec: string }) {
  const { t } = useI18n();
  return <Pill tone={REC_TONE[rec] ?? "slate"}>{t(REC_LABEL[rec] ?? rec, REC_LABEL_EN[rec] ?? rec)}</Pill>;
}

// ============ tipe (mirror JSON API F6b — skor AI & rubrik per PR) ============

/** Satu faktor rubrik skor (PR.rubricJson — no-code). */
export interface RubricFactorUI {
  name: string;
  /** bobot relatif 0–1 (server menormalisasi Σ=1 saat generate). */
  weight: number;
  guide?: string | null;
}

/** Satu faktor hasil skor (factorsJson CandidateAiScore). */
export interface AiScoreFactor {
  factor: string;
  weight: number;
  score: number; // 0–100
  contribution: number; // weight × score
  evidence: string;
}

export interface AiScore {
  id: string;
  candidateId: string;
  candidateName: string;
  prNo: string;
  total: number; // 0–100
  mode: string; // ai|simulated
  model: string | null;
  generatedAt: string;
  generatedByName: string | null;
  factors: AiScoreFactor[];
}

/** Snapshot rubrik default service (3 faktor generik) — utk deteksi hint
 *  "rubrik default" di UI (getRubric fallback diam-diam bila PR belum di-set). */
export const DEFAULT_RUBRIC_UI: RubricFactorUI[] = [
  { name: "Pendidikan & Sertifikasi", weight: 0.3, guide: "Relevansi jenjang & bidang studi dengan kebutuhan posisi" },
  { name: "Relevansi Pengalaman", weight: 0.4, guide: "Lama & kedekatan pengalaman kerja dengan peran yang dilamar" },
  { name: "Keahlian Teknis", weight: 0.3, guide: "Penguasaan tools/metode kunci posisi" },
];

/** true bila daftar faktor identik dgn rubrik default (nama sama, urutan sama). */
export function isDefaultRubric(factors: RubricFactorUI[] | null | undefined): boolean {
  if (!factors || factors.length !== DEFAULT_RUBRIC_UI.length) return false;
  return DEFAULT_RUBRIC_UI.every((d, i) =>
    (factors[i]?.name ?? "").trim().toLowerCase() === d.name.trim().toLowerCase());
}

/** Ambang badge skor AI (F6b): ≥70 emerald · 50–69 amber · <50 rose. */
export function scoreToneKey(total: number): "emerald" | "amber" | "rose" {
  if (total >= 70) return "emerald";
  if (total >= 50) return "amber";
  return "rose";
}

const SCORE_TONE_CLS: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
};
const SCORE_TONE_BAR: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500",
};

/** Pill skor AI mini (badge kartu board — "AI 62.9"). */
export function AiScoreBadge({ total, onClick, title }: { total: number; onClick?: () => void; title?: string }) {
  const { t } = useI18n();
  const key = scoreToneKey(total);
  const cls = cn(
    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums whitespace-nowrap",
    SCORE_TONE_CLS[key],
    onClick && "cursor-pointer hover:brightness-95 dark:hover:brightness-125",
  );
  const body = (
    <>
      <span className="font-semibold">AI</span> {total.toFixed(1)}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title ?? t("skor AI kandidat (rekomendasi)", "candidate AI score (recommendation)")}>
      {body}
    </button>
  ) : (
    <span className={cls} title={title}>{body}</span>
  );
}

/** Bar skor 0–100 ber-tone ambang (breakdown faktor & total dialog). */
export function ScoreBar({ value, className }: { value: number; className?: string }) {
  const key = scoreToneKey(value);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", SCORE_TONE_BAR[key])} style={{ width: `${pct}%` }} />
    </span>
  );
}

// ============ helper kecil ============

/** selisih hari (positif = terlambat N hari) — utk badge overdue SLA. */
export function daysLateOf(dueIso: string | null | undefined): number {
  if (!dueIso) return 0;
  const due = new Date(dueIso).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((Date.now() - due) / 86_400_000));
}

/** label pengalaman bulan → "X thn Y bln" / EN. */
export function monthsLabel(n: number, en: boolean): string {
  if (!n) return "—";
  const y = Math.floor(n / 12);
  const m = n % 12;
  if (en) {
    if (y && m) return `${y} yr ${m} mo`;
    if (y) return `${y} yr${y > 1 ? "s" : ""}`;
    return `${m} mo`;
  }
  if (y && m) return `${y} thn ${m} bln`;
  if (y) return `${y} thn`;
  return `${m} bln`;
}
