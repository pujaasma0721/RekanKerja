// T104 — tipe payload 16 laporan distribusi HR =================================
// Mirror 1:1 dari src/rekankerja/human-resource/api/report-documents.ts —
// dipakai komponen tab "Reports" (report-documents-tab.tsx).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.). */
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
  /** T110: chip parameter terpasang saat generate (cakupan/periode/filter). */
  filters: { label: string; value: string }[];
}

export interface DocResponse<T> {
  id: string;
  meta: DocMeta;
  data: T;
}

interface EmpLite {
  employeeNo: string;
  name: string;
  gender: string;
  joinDate: string;
  unit: string | null;
  position: string | null;
}

// ---------- Grup 1: Demografi & Profil ----------
export interface R11Data {
  employees: {
    employeeNo: string; name: string; nik: string | null; gender: string;
    birthDate: string | null; age: number | null; education: string;
    marital: string | null; religion: string | null; unit: string | null;
    position: string | null; employmentStatus: string; joinDate: string; tenureYears: number;
  }[];
  totalActive: number;
  male: number;
  female: number;
  byStatus: { label: string; count: number }[];
  noUnit: number;
}

export interface R12Data {
  total: number;
  avgAge: number | null;
  minAge: number | null;
  maxAge: number | null;
  ageBuckets: { key: string; label: string; count: number }[];
  gender: { label: string; count: number }[];
  education: { label: string; count: number }[];
  marital: { label: string; count: number }[];
  religion: { label: string; count: number }[];
}

export interface R13UnitNode {
  code: string; name: string; level: number; headcount: number; budget: number;
  positions: { code: string; title: string; headcount: number; filled: number; gap: number }[];
  children: R13UnitNode[];
}

export interface R13Data {
  tree: R13UnitNode[];
  totalActive: number;
  totalBudget: number;
  vacant: number;
  units: number;
}

export interface R14Data {
  groups: {
    status: string;
    employees: (EmpLite & { tenureYears: number })[];
    male: number;
    female: number;
    avgTenure: number;
  }[];
  total: number;
  permanentPct: number;
}

export interface R15Data {
  offices: {
    code: string; name: string; city: string | null; address: string | null; phone: string | null;
    npwp: string | null; active: boolean; headcount: number; male: number; female: number;
    statusMix: { label: string; count: number }[];
    workLocations: { code: string; name: string; city: string | null; headcount: number }[];
  }[];
  noOffice: number;
  total: number;
}

// ---------- Grup 2: Masa Kerja & Kontrak ----------
export type Urgency = "overdue" | "critical" | "warning" | "caution" | "safe";

export interface R21Data {
  items: {
    employeeNo: string; name: string; unit: string | null; position: string | null;
    contractStart: string | null; contractEnd: string; daysRemaining: number;
    urgency: Urgency; renewalCount: number; employmentStatus: string;
  }[];
  total: number;
  counts: { urgency: Urgency; label: string; count: number }[];
}

export interface R22Data {
  buckets: { key: string; label: string; count: number; pct: number }[];
  longService: { employeeNo: string; name: string; joinDate: string; tenureYears: number; unit: string | null; position: string | null }[];
  total: number;
  avgTenure: number;
  longest: { name: string; joinDate: string; tenureYears: number } | null;
  eligible5yr: number;
}

export interface R23Data {
  items: {
    employeeNo: string; name: string; unit: string | null; position: string | null;
    manager: string | null; joinDate: string; evalDue: string; daysRemaining: number;
    status: "overdue" | "due-soon" | "scheduled";
  }[];
  total: number;
  overdue: number;
  dueSoon: number;
  scheduled: number;
}

// ---------- Grup 3: Pergerakan Karyawan ----------
export interface R31Data {
  window: "month" | "90d";
  items: (EmpLite & {
    manager: string | null; employmentStatus: string;
    onboarding: { status: string; done: number; total: number } | null;
  })[];
  thisMonth: number;
  last90: number;
  qtd: number;
  probation: number;
}

export interface R32Data {
  items: {
    employeeNo: string; name: string; status: string; joinDate: string; endDate: string;
    tenureYears: number; unit: string | null; position: string | null; exitReason: string | null;
    interview: { reason: string | null; nextPlan: string | null; feedback: string | null; satisfaction: number | null } | null;
    handoverDone: number; handoverTotal: number; handoverPct: number | null;
    offboardingStatus: string | null;
  }[];
  ytdExits: number;
  resigned: number;
  terminated: number;
  withInterview: number;
  avgSatisfaction: number | null;
  byReason: { label: string; count: number }[];
}

export interface R33Data {
  months: { key: string; label: string; full: string }[];
  rows: {
    division: string; headcount: number;
    cells: { hires: number; exits: number; rate: number | null }[];
    exitsYtd: number;
    rateYtd: number;
  }[];
  companyCells: { hires: number; exits: number; rate: number | null; headcount: number; month: string }[];
  kpi: { startHC: number; nowHC: number; hiresYtd: number; exitsYtd: number; avgHC: number; turnoverRate: number };
}

export interface R34Data {
  items: {
    employeeNo: string; name: string; effectiveDate: string | null; reason: string;
    fromUnit: string | null; toUnit: string | null; fromPosition: string | null; toPosition: string | null;
    fromGrade: string | null; toGrade: string | null; docNo: string | null; notes: string | null;
  }[];
  total: number;
  byReason: { label: string; count: number }[];
}

// ---------- Grup 4: Kepatuhan & Administrasi Legal ----------
export interface GenderPair { male: number; female: number }

export interface R41Data {
  identity: { name: string; address: string | null; city: string | null; taxId: string | null; offices: string[] };
  workers: { permanent: GenderPair; contract: GenderPair; probation: GenderPair; outsourcing: GenderPair };
  workersTotal: number;
  wageBuckets: { label: string; male: number; female: number; total: number }[];
  wageTotal: number;
  umk: { label: string; monthlyAmount: number; year: number } | null;
  bpjs: { healthRegistered: number; healthMissing: number; jkkRegistered: number; jkkMissing: number };
  totalAll: number;
}

export interface R42Data {
  items: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    nik: string | null; bpjsHealth: string | null; bpjsEmpSkill: string | null;
    health: boolean; jkk: boolean; status: "match" | "partial" | "missing";
  }[];
  total: number;
  matched: number;
  partial: number;
  missing: number;
  healthMissing: number;
  jkkMissing: number;
  compliancePct: number;
}

export interface R43Data {
  grades: {
    code: string; name: string; minSalary: number; maxSalary: number; midSalary: number;
    employees: number; actualMin: number | null; actualAvg: number | null; actualMax: number | null;
    belowUmk: number;
  }[];
  umk: { label: string; monthlyAmount: number; year: number } | null;
  masked: boolean;
  noGrade: number;
  total: number;
  overallBelowUmk: number;
}

export interface R44Data {
  items: {
    employeeNo: string; name: string; unit: string | null; position: string | null;
    docType: string; docNumber: string | null; notes: string | null; category: string;
    issuedAt: string | null; expiresAt: string | null; daysRemaining: number | null;
    status: "expired" | "expiring" | "active" | "no-expiry";
  }[];
  total: number;
  expired: number;
  expiring: number;
  active: number;
  noExpiry: number;
  compliancePct: number;
  byCategory: { label: string; total: number; expired: number; expiring: number }[];
  employeesCovered: number;
}

export type ReportData =
  | R11Data | R12Data | R13Data | R14Data | R15Data
  | R21Data | R22Data | R23Data
  | R31Data | R32Data | R33Data | R34Data
  | R41Data | R42Data | R43Data | R44Data;
