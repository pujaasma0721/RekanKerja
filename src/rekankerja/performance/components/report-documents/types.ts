// P8-PERF — tipe payload 14 laporan dokumen Performance ========================
// Mirror 1:1 dari src/rekankerja/performance/api/report-documents.ts — dipakai
// komponen tab "Dokumen Laporan" (report-documents-tab.tsx).
//
// KONVENSI UANG: laporan Performance adalah dokumen HR-internal — nominal
// merit didekripsi server-side dan diserialisasi sebagai number (tanpa gerbang
// brankas, beda dari medical yang memakai null/•••).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.).
 *  Struktur identik dgn HR/Leave/Medical types.DocMeta (doc-kit HR dipakai bersama). */
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

// ---------- Grup 1: Siklus & Partisipasi ----------

export interface PF11Data {
  rows: {
    code: string; name: string; cycleType: string;
    periodStart: string; periodEnd: string; status: string;
    gates: { goal: string | null; mid: string | null; self: string | null; mgr: string | null; calib: string | null };
    feedback360: boolean;
    participants: number; completed: number; completionPct: number; // 0..100
  }[];
  totalCycles: number;
  activeCycles: number;
  totalParticipants: number;
}

export interface PF12Data {
  cycle: { code: string; name: string; status: string; periodStart: string; periodEnd: string };
  rows: {
    docNo: string; employeeNo: string; name: string; unit: string | null; status: string;
    targetDone: boolean; selfDone: boolean; managerDone: boolean; acknowledged: boolean;
    finalScore: number | null;
  }[];
  summary: { participants: number; target: number; self: number; manager: number; acknowledged: number };
  pending: { target: number; self: number; manager: number; ack: number };
}

export interface PF13Data {
  cycle: { code: string; name: string };
  rows: {
    employeeNo: string; name: string; unit: string | null; docNo: string;
    kpiCode: string | null; title: string; unitOf: string; polarity: string;
    weight: number; thresholdMin: number | null; target: number; stretch: number | null;
    isCritical: boolean; origin: string; proposedBy: string; finalActual: number | null;
  }[];
  employees: number;
  kpiRows: number;
  sumWeight: number; // total bobot semua baris (≠100 per definisi lintas peserta)
}

// ---------- Grup 2: Penilaian & Hasil ----------

export interface PF21Data {
  cycle: { code: string; name: string; status: string; publishAt: string | null };
  rows: {
    docNo: string; employeeNo: string; name: string; unit: string | null; managerName: string | null;
    status: string; managerScore: number | null; finalScore: number | null; finalRating: number | null;
    potentialBand: number | null; calibrated: boolean; acknowledgedAt: string | null;
  }[];
  summary: { participants: number; scored: number; finalized: number; mean: number | null; min: number | null; max: number | null };
}

/** counts idx 0..4 = rating 1..5. */
export interface PF22Data {
  cycle: { code: string; name: string };
  byUnit: { unit: string; participants: number; counts: number[]; mean: number | null; sigma: number | null }[];
  byManager: { managerName: string; participants: number; counts: number[]; mean: number | null; sigma: number | null }[];
  overall: { participants: number; counts: number[]; mean: number | null; sigma: number | null };
}

export interface PF23Data {
  cycle: { code: string; name: string; status: string };
  employee: { docNo: string; employeeNo: string; name: string; unit: string | null; managerName: string | null; status: string };
  kpis: {
    title: string; unit: string; polarity: string; weight: number;
    thresholdMin: number | null; target: number; stretch: number | null;
    finalActual: number | null; score: number | null; dataSource: string; isCritical: boolean; origin: string;
  }[];
  comps: { name: string; kind: string; selfScore: number | null; score: number | null; comment: string | null }[];
  f360: { group: string; count: number; overallAvg: number | null }[];
  final: {
    selfScore: number | null; managerScore: number | null; finalScore: number | null;
    finalRating: number | null; potentialBand: number | null; calibrated: boolean; acknowledgedAt: string | null;
  };
}

export interface PF24Data {
  cycle: { code: string; name: string };
  groups: { group: string; count: number; overallAvg: number | null; byComp: { competency: string; avg: number }[] }[];
  excluded: { group: string; count: number }[];
  note: string;
}

// ---------- Grup 3: Kualitas & Kepatuhan ----------

export interface PF31Data {
  cycle: { code: string; name: string };
  sessions: {
    id: string; heldAt: string; unit: string | null; chairName: string | null; notes: string | null;
    decisions: {
      docNo: string; employeeName: string;
      oldScore: number | null; newScore: number | null; oldRating: number | null; newRating: number | null;
      potentialBand: number | null; reason: string; decidedBy: string; decidedAt: string;
    }[];
  }[];
  totalSessions: number;
  totalDecisions: number;
}

export interface PF32Data {
  cycle: { code: string; name: string };
  company: { n: number; mean: number | null; sigma: number | null };
  rows: {
    managerName: string; teamSize: number; teamMean: number; teamSigma: number;
    sigmaRatio: number | null; z: number | null;
    flag: "red-pelis" | "amber-pelis" | "amber-royal" | "red-royal" | "central" | "ok" | null;
    flagLabelId: string; flagLabelEn: string;
  }[];
  flags: { flag: string; label: string; count: number }[];
}

export interface PF33Data {
  rows: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    appealNote: string | null; appealStatus: string | null;
    submittedAt: string | null; decidedBy: string | null; decidedAt: string | null;
    windowEnd: string | null; cycleCode: string;
  }[];
  total: number;
  pending: number;
  decided: number;
}

// ---------- Grup 4: Konsekuensi & Analitik ----------

export interface PF41Data {
  rows: {
    docNo: string; cycleCode: string; employeeNo: string; name: string; unit: string | null; finalRating: number | null;
    matrixCode: string | null; bonusMonths: number | null; bonusAmount: number | null;
    raisePct: number | null; raiseAmount: number | null;
    status: string; chainStatus: string | null; appliedRunNo: string | null; paDocNo: string | null; letterRefNo: string | null;
  }[];
  summary: { count: number; approved: number; applied: number; sumBonus: number; sumRaise: number };
}

export interface PF42Data {
  rows: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    startDate: string; endDate: string; status: string; reviewerName: string | null;
    checkpoints: { total: number; reviewed: number; lastAchievement: number | null };
    spSuggestion: string | null;
  }[];
  summary: { total: number; active: number; recovered: number; notRecovered: number; recoveryRate: number | null };
}

export interface PF43Data {
  cycle: { code: string; name: string };
  cells: { pot: number; perf: 1 | 2 | 3; participants: { employeeNo: string; name: string; unit: string | null; score: number | null; rating: number | null }[] }[];
  placed: number;
  unplaced: number;
}

export interface PF44Data {
  rows: { unit: string; year: number; cycles: string; participants: number; meanScore: number | null; counts: number[] }[];
  years: number[];
}

export type PerformanceReportData =
  | PF11Data | PF12Data | PF13Data
  | PF21Data | PF22Data | PF23Data | PF24Data
  | PF31Data | PF32Data | PF33Data
  | PF41Data | PF42Data | PF43Data | PF44Data;
