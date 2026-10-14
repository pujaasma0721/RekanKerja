// P8-PERF — tipe payload 14 laporan kinerja pf11–pf44 ========================
// (DEVELOPMENT-PLAN-PERFORMANCE.md §11.2 — katalog AUTHORITATIVE). Mirror 1:1
// dari src/rekankerja/performance/api/performance-report-documents.ts — dipakai
// komponen tab "Dokumen Laporan" (report-documents-tab.tsx). API MENGIMPOR
// tipe ini (kontrak compile-time — field tidak bisa menyimpang).
//
// KONVENSI UANG: kolom rupiah = number | null — null saat Brankas Uang
// terkunci (MoneyView masked); frontend merender "•••" (pola medical MR1.1).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode…).
 *  Struktur identik dgn HR/Medical types.DocMeta (doc-kit HR dipakai bersama). */
export interface DocMeta {
  companyName: string;
  companyAddress: string | null;
  companyCity: string | null;
  companyTaxId: string | null;
  companyLogoUrl: string | null;
  branchLabel: string;
  printedBy: string;
  generatedAt: string;
  year: number;
  scope: "all" | "scoped";
  periodLabel: string;
  filters: { label: string; value: string }[];
}

export interface DocResponse<T> {
  id: string;
  meta: DocMeta;
  data: T;
}

// ---------- G1 · Siklus & Partisipasi (emerald) ----------

/** pf11 — Register Siklus & Fase. */
export interface PF11Row {
  code: string; name: string; cycleType: string; period: string;
  phases: string; // ringkasan jendela fase (goal/mid/self/mgr/calib)
  activePhase: string | null;
  status: string;
  participants: number;
  goalsLocked: number; // peserta yang targetnya terkunci (status ≥ Ongoing)
  resultsPublished: number; // peserta yang hasilnya terbit (≥ Published)
}
export interface PF11Data {
  year: number;
  rows: PF11Row[];
  total: { cycles: number; participants: number };
}

/** pf12 — Completion per Fase ("siapa belum isi"). */
export interface PF12Row {
  employeeNo: string; fullName: string; unit: string | null; position: string | null;
  status: string; kpiCount: number; totalWeight: number | null;
  selfSubmitted: boolean; managerDone: boolean;
  checkinCount: number;
  missing: string[]; // daftar fase yang belum ("Target", "Penilaian Diri", …)
}
export interface PF12Data {
  cycleCode: string; cycleStatus: string;
  rows: PF12Row[];
  summary: {
    total: number; targetDone: number; selfDone: number; managerDone: number;
    selfPct: number | null; managerPct: number | null;
  };
}

/** pf13 — Register Penetapan KPI. */
export interface PF13Row {
  employeeNo: string; fullName: string; unit: string | null;
  title: string; category: string; polarity: string;
  weight: number; thresholdMin: number | null; target: number; stretchValue: number | null;
  measure: string; origin: string;
  source: string; // "AUTO: <sourceKey>" | "Manual"
  isCritical: boolean;
}
export interface PF13Data {
  cycleCode: string;
  rows: PF13Row[];
  byEmployee: { employeeNo: string; name: string; kpiCount: number; sumWeight: number }[];
  total: number;
}

// ---------- G2 · Penilaian & Hasil (amber) ----------

/** pf21 — Register Hasil per Periode. */
export interface PF21Row {
  docNo: string; employeeNo: string; fullName: string; unit: string | null; position: string | null;
  managerName: string | null;
  selfScore: number | null; managerScore: number | null;
  finalScore: number | null; finalRating: number | null;
  ratingLabel: string | null; ratingLabelEn: string | null;
  status: string; calibrated: boolean; appealStatus: string | null;
}
export interface PF21Data {
  cycleCode: string;
  rows: PF21Row[];
  summary: {
    n: number; avgFinal: number | null;
    ratings: { r1: number; r2: number; r3: number; r4: number; r5: number };
  };
}

/** pf22 — Distribusi Rating per Unit/Atasan. */
export interface PF22Row {
  label: string; n: number;
  r1: number; r2: number; r3: number; r4: number; r5: number;
  avg: number | null;
}
export interface PF22Data {
  cycleCode: string; groupBy: "unit" | "atasan";
  rows: PF22Row[];
  total: PF22Row;
}

/** pf23 — Detail Skor per Karyawan + register riwayat (PP 35/2021 §7.2). */
export interface PF23HistoryRow {
  docNo: string; cycleCode: string; period: string; status: string;
  finalScore: number | null; finalRating: number | null; ratingLabel: string | null;
  calibratedFrom: number | null; calibratedTo: number | null;
  appealStatus: string | null; appealDecision: string | null;
  acknowledgedAt: string | null;
}
export interface PF23Kpi {
  title: string; weight: number;
  thresholdMin: number | null; target: number; stretchValue: number | null;
  actual: number | null; midActual: number | null;
  source: string; evidence: boolean;
}
export interface PF23Comp { name: string; score: number | null; selfScore: number | null; }
export interface PF23Detail {
  cycleCode: string; docNo: string; status: string;
  finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  kpis: PF23Kpi[];
  comps: PF23Comp[];
  f360: { invited: number; submitted: number; avg: number | null } | null;
  calibration: {
    decidedAt: string; oldScore: number | null; newScore: number | null;
    oldRating: number | null; newRating: number | null; reason: string; decidedBy: string;
  }[];
  appeal: { status: string | null; note: string | null; decidedBy: string | null; decidedAt: string | null } | null;
}
export interface PF23Data {
  employeeNo: string; fullName: string; unit: string | null;
  mode: "history" | "cycle";
  history: PF23HistoryRow[];
  detail: PF23Detail | null;
  note: string; // dasar hukum PP 35/2021 §7.2 (riwayat eksporabel & ter-audit)
}

/** pf24 — Ringkasan 360 Ter-agregasi (anonim ≥3). */
export interface PF24Row {
  employeeNo: string; fullName: string; unit: string | null;
  invited: number; submitted: number; participationPct: number | null;
  peer: number | null; subordinate: number | null; crossTeam: number | null; upward: number | null;
  overall: number | null;
  hidden: boolean; // submitted < 3 → "Diserahkan N (<3) — dirahasiakan"
}
export interface PF24Data {
  cycleCode: string; threshold: number;
  rows: PF24Row[];
  summary: { invited: number; submitted: number; participationPct: number | null; hidden: number };
}

// ---------- G3 · Kualitas & Kepatuhan (rose) ----------

/** pf31 — Jejak Kalibrasi (audit trail). */
export interface PF31Session {
  id: string; label: string; chair: string | null;
  participants: number; status: string; // Terbuka/Tertutup
  decisions: number;
}
export interface PF31Row {
  sessionLabel: string; chair: string | null;
  employeeNo: string; fullName: string; unit: string | null;
  oldScore: number | null; newScore: number | null;
  oldRating: number | null; newRating: number | null;
  potentialBand: number | null;
  reason: string; decidedBy: string; decidedAt: string;
}
export interface PF31Data {
  cycleCode: string;
  sessions: PF31Session[];
  rows: PF31Row[];
  summary: { decisions: number; sessions: number; totalScoreDelta: number };
}

/** pf32 — Indikator Bias Atasan (z-score D19). */
export interface PF32Row {
  managerId: string | null; managerName: string;
  n: number; meanScore: number; stdDev: number;
  z: number | null;
  flag: "leniency" | "strictness" | null; flagLevel: "amber" | "red" | null;
  centralTendency: boolean;
}
export interface PF32Data {
  cycleCode: string;
  company: { n: number; mean: number; sigma: number };
  rows: PF32Row[];
  summary: { flagged: number };
}

/** pf33 — Register Banding & Keputusannya. */
export interface PF33Row {
  docNo: string; employeeNo: string; fullName: string; unit: string | null; cycleCode: string;
  score: number | null; rating: number | null;
  appealNote: string; appealDate: string | null;
  decision: string | null; // Adjusted | Rejected | Submitted | Withdrawn
  newScore: number | null;
  decidedBy: string | null; decidedAt: string | null;
}
export interface PF33Data {
  year: number;
  rows: PF33Row[];
  summary: { appeals: number; adjusted: number; rejected: number; open: number };
}

// ---------- G4 · Konsekuensi & Analitik (violet) ----------

/** pf41 — Register Merit (uang VAULT — null saat brankas terkunci). */
export interface PF41Row {
  docNo: string; employeeNo: string; fullName: string; unit: string | null;
  appraisalNo: string; rating: number | null; ratingLabel: string | null;
  bonusMonths: number | null; raisePct: number | null;
  bonusAmount: number | null; raiseAmount: number | null; totalAmount: number | null;
  status: string;
  approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
  appliedRunNo: string | null; personnelActionId: string | null;
  appliedAt: string | null; note: string | null;
}
export interface PF41Data {
  cycleCode: string; masked: boolean;
  rows: PF41Row[];
  summary: { n: number; sumBonus: number | null; sumRaise: number | null; sumTotal: number | null };
}

/** pf42 — Register PIP & Outcome. */
export interface PF42Row {
  docNo: string; employeeNo: string; fullName: string; unit: string | null;
  period: string; extended: boolean; targetsCount: number;
  checkpoints: string; // "1: 105% · 2: 110%"
  lastReviewPct: number | null;
  status: string; reviewer: string | null; note: string | null;
}
export interface PF42Data {
  year: number;
  rows: PF42Row[];
  summary: { n: number; recovered: number; active: number; recoveryRate: number | null };
}

/** pf43 — Snapshot 9-Box. */
export interface PF43Cell {
  perf: 1 | 2 | 3; potential: 1 | 2 | 3; label: string; count: number;
  employees: { employeeNo: string; fullName: string; unit: string | null; finalScore: number | null; finalRating: number }[];
}
export interface PF43Data {
  cycleCode: string;
  cells: PF43Cell[]; // 9 sel (urut render: perf 3→1 baris, potential 1→3 kolom)
  unplaced: { docNo: string; fullName: string; finalRating: number | null; potentialBand: number | null }[];
  totals: { placed: number; unplaced: number };
}

/** pf44 — Tren Kinerja Multi-Tahun per Unit. */
export interface PF44Row {
  unit: string;
  perYear: { year: number; n: number; avg: number | null }[];
}
export interface PF44Data {
  years: number[];
  rows: PF44Row[];
  company: { year: number; n: number; avg: number | null }[];
}

export type PerformanceReportData =
  | PF11Data | PF12Data | PF13Data
  | PF21Data | PF22Data | PF23Data | PF24Data
  | PF31Data | PF32Data | PF33Data
  | PF41Data | PF42Data | PF43Data | PF44Data;
