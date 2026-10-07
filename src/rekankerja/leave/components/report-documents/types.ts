// T112 — tipe payload 12 laporan distribusi Leave =============================
// Mirror 1:1 dari src/rekankerja/leave/api/leave-report-documents.ts — dipakai
// komponen tab "Reports" (report-documents-tab.tsx).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.).
 *  Struktur identik dgn HR types.DocMeta (doc-kit HR dipakai bersama). */
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

// ---------- Grup 1: Saldo & Hak Cuti ----------
export interface LR11Data {
  typeName: string;
  typeUnit: string;
  rows: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    joinDate: string; tenureYears: number;
    carriedOver: number; earned: number; adjustment: number;
    taken: number; applied: number; cashed: number; remaining: number;
    entitlement: number; typeUnit: string; paid: boolean; cashable: boolean;
    periodLabel: string;
  }[];
  total: number;
  avgRemaining: number;
  zeroRemaining: number;
  sum: {
    carriedOver: number; earned: number; adjustment: number;
    taken: number; applied: number; cashed: number; remaining: number;
  };
  isMonth: boolean;
}

export type Urgency = "overdue" | "critical" | "warning" | "caution" | "safe";

export interface LR12Data {
  year: number;
  items: {
    employeeNo: string; name: string; unit: string | null; leaveType: string;
    carryOverMax: number; carriedOver: number; remaining: number; potentialForfeit: number;
    forfeitDate: string; daysRemaining: number; urgency: Urgency;
  }[];
  total: number;
  counts: { urgency: Urgency; label: string; count: number }[];
  totalCarried: number;
  totalPotentialForfeit: number;
}

export interface LR13Data {
  typeName: string;
  masked: boolean;
  items: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    remaining: number; monthlySalary: number | null; dailyRate: number | null; liability: number | null;
  }[];
  totalEmployees: number;
  totalDays: number;
  totalLiability: number | null;
  top5: LR13Data["items"];
}

// ---------- Grup 2: Transaksi & Riwayat ----------
export interface LR21Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null; leaveType: string;
    dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
    workingDays: number; status: string; reason: string | null; source: string;
    decidedBy: string | null; decidedAt: string | null;
  }[];
  total: number;
  totalDays: number;
  byStatus: { status: string; label: string; count: number }[];
  uniqueEmployees: number;
}

export interface LR22Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null; leaveType: string;
    dateFrom: string; dateTo: string; workingDays: number;
    requestDate: string; waitingDays: number; sla: "overdue" | "due-soon" | "on-track";
    source: string; reason: string | null;
  }[];
  total: number;
  totalDays: number;
  counts: { sla: string; label: string; count: number }[];
  oldestWaiting: number;
}

export interface LR23Data {
  month: string;
  items: {
    unit: string; employeeNo: string; name: string; leaveType: string;
    dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
    workingDays: number; daysInMonth: number; conflicts: number; backToWork: string;
  }[];
  byUnit: {
    unit: string; rows: LR23Data["items"]; employees: number; days: number; conflicts: number;
  }[];
  total: number;
  totalDays: number;
  withConflicts: number;
  unitsAffected: number;
}

// ---------- Grup 3: Analisis Ketidakhadiran ----------
export interface LR31Data {
  month: string;
  workdays: number;
  rows: {
    division: string; headcount: number; workdays: number;
    present: number; onLeave: number; workoff: number; absent: number; lostTotal: number;
    rate: number | null; unplannedRate: number | null;
  }[];
  total: {
    headcount: number; present: number; onLeave: number; workoff: number; absent: number;
    lostTotal: number; rate: number | null; unplannedRate: number | null;
  };
}

export interface LR32Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    dateFrom: string; dateTo: string; workingDays: number;
    reason: string | null; note: string | null; status: string;
    skdComplete: boolean; decidedBy: string | null; decidedAt: string | null;
  }[];
  total: number;
  totalDays: number;
  complete: number;
  incomplete: number;
  uniqueEmployees: number;
  pending: number;
}

export interface LR33Data {
  summary: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    count: number; firstDate: string; lastDate: string;
    recommendation: string; action: string;
  }[];
  detail: {
    date: string; weekday: string; employeeNo: string; name: string; unit: string | null; notes: string | null;
  }[];
  employees: number;
  totalDays: number;
  sp1: number;
  top: LR33Data["summary"][number] | null;
}

// ---------- Grup 4: Kepatuhan & Cuti Khusus ----------
export interface LR41Data {
  year: number;
  items: {
    docNo: string; employeeNo: string; name: string; gender: string; unit: string | null;
    leaveType: string; basis: string; dateFrom: string; dateTo: string;
    workingDays: number; unitOfMeasure: string; status: string;
    needDocs: boolean; docsComplete: boolean; reason: string | null;
  }[];
  byType: { code: string; basis: string; count: number; days: number }[];
  total: number;
  totalDays: number;
  female: number;
  male: number;
  docsMissing: number;
}

export interface LR42Data {
  waitingMonths: number;
  entitlement: number;
  taken: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    joinDate: string; tenureYears: number; dateFrom: string; dateTo: string;
    workingDays: number; status: string; note: string | null;
  }[];
  eligible: {
    employeeNo: string; name: string; unit: string | null;
    joinDate: string; tenureYears: number; employmentStatus: string;
  }[];
  takenCount: number;
  eligibleCount: number;
}

export interface LR43Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
    workingDays: number; status: string; reason: string | null;
    decidedBy: string | null; decidedAt: string | null;
  }[];
  femaleActive: number;
  total: number;
  totalDays: number;
  uniqueEmployees: number;
  avgPerEmployee: number;
  top: { employeeNo: string; days: number }[];
  approved: number;
  pending: number;
}

export type LeaveReportData =
  | LR11Data | LR12Data | LR13Data
  | LR21Data | LR22Data | LR23Data
  | LR31Data | LR32Data | LR33Data
  | LR41Data | LR42Data | LR43Data;
