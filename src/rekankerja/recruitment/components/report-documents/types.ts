// SB-RC-RD — tipe payload 12 laporan distribusi Recruitment ================
// Mirror 1:1 dari src/rekankerja/recruitment/api/recruitment-report-documents.ts
// — dipakai komponen tab "Dokumen Laporan" (report-documents-tab.tsx).
//
// KONVENSI UANG: seluruh nilai finansial (anggaran rencana, biaya iklan,
// cost-per-hire) melewati gerbang money-view di server — saat brankas
// terkunci payload mengirim `masked: true` + nilai `null` (UI menampilkan
// "•••" / "—"), selaras pola AR3.2 Attendance.

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.).
 *  Struktur identik dgn HR/Leave/Attendance types.DocMeta (doc-kit HR dipakai bersama). */
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

// ---------- Grup 1: Rencana & Permintaan Karyawan ----------

/** RC1.1 — Recruitment Plan Recap (MPP formula a–h + rekonsiliasi PR). */
export interface RC11Data {
  year: number;
  rows: {
    period: string;
    seqNo: number;
    positionTitle: string;
    office: string | null;
    status: string;
    /** formula a–h (lihat model RecruitmentPlan). */
    targetA: number;
    adjustB: number;
    totalC: number;
    empD: number;
    inE: number;
    outF: number;
    resultG: number;
    needH: number;
    /** anggaran upah rencana — null saat brankas terkunci. */
    salaryBudget: number | null;
    /** rekonsiliasi PR: diajukan / terpenuhi / belum (match planId ATAU posisi). */
    prRequested: number;
    prFulfilled: number;
    prUnfulfilled: number;
  }[];
  plans: number;
  applied: number;
  sum: {
    targetA: number; adjustB: number; totalC: number; empD: number;
    inE: number; outF: number; resultG: number; needH: number;
    prRequested: number; prFulfilled: number; prUnfulfilled: number;
  };
  masked: boolean;
}

/** RC1.2 — Personnel Requisition Status Register. */
export interface RC12Data {
  rows: {
    prNo: string;
    requestDate: string;
    position: string | null;
    office: string | null;
    unit: string | null;
    requester: string | null;
    officer: string | null;
    employmentStatus: string;
    requiredNo: number;
    appointed: number;
    status: string;
    ageDays: number | null;
    slaTargetDays: number | null;
  }[];
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  open: number;
  fulfilled: number;
}

/** RC1.3 — Requisition Aging & SLA Compliance. */
export interface RC13Data {
  rows: {
    prNo: string;
    position: string | null;
    office: string | null;
    status: string;
    requestDate: string;
    ageDays: number;
    slaTargetDays: number | null;
    overDays: number | null;
    candidates: number;
    appointed: number;
    risk: "tinggi" | "sedang" | "rendah" | "sehat";
  }[];
  buckets: { key: string; label: string; count: number }[];
  withSla: number;
  withinSla: number;
  overSla: number;
  avgAgeDays: number | null;
  oldest: { prNo: string; days: number } | null;
}

// ---------- Grup 2: Lowongan & Sumber Pelamar ----------

/** RC2.1 — Job Opening & Advertising Performance. */
export interface RC21Data {
  rows: {
    refNo: string;
    title: string;
    status: string;
    datePosted: string | null;
    lastAcceptDate: string | null;
    slots: number;
    prNos: string[];
    methods: number;
    plannedCost: number | null;
    actualCost: number | null;
    applications: number;
    candidates: number;
    hires: number;
  }[];
  total: number;
  posted: number;
  closed: number;
  sum: { slots: number; applications: number; candidates: number; hires: number; plannedCost: number | null; actualCost: number | null };
  masked: boolean;
}

/** RC2.2 — Applicant Source Effectiveness. */
export interface RC22Data {
  rows: {
    source: string;
    sourceLabel: string;
    applicants: number;
    candidates: number;
    hires: number;
    spend: number | null;
    costPerHire: number | null;
    hireRate: number | null;
  }[];
  total: { applicants: number; candidates: number; hires: number; spend: number | null; costPerHire: number | null };
  masked: boolean;
}

/** RC2.3 — Talent Pool Register. */
export interface RC23Data {
  rows: {
    applicantNo: string;
    name: string;
    status: string;
    source: string | null;
    eduLevel: string | null;
    gpa: number | null;
    expYears: number | null;
    dateApplied: string;
    keepOnFileUntil: string | null;
    applications: number;
    flags: ("blacklist" | "suspend")[];
  }[];
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  blacklisted: number;
  suspended: number;
  expiringSoon: number;
}

// ---------- Grup 3: Seleksi & Penilaian ----------

/** RC3.1 — Selection Funnel & Stage Pass-Through. */
export interface RC31Data {
  stages: {
    name: string;
    processOrder: number | null;
    resultType: string;
    mandatory: boolean;
    minResultPass: number | null;
    entered: number;
    performed: number;
    passed: number;
    failed: number;
    cancelled: number;
    passRate: number | null;
  }[];
  candidateStatus: { status: string; label: string; count: number }[];
  candidates: number;
  hired: number;
  overallPassRate: number | null;
}

/** RC3.2 — Selection Stage SLA Monitor. */
export interface RC32Data {
  rows: {
    candidateName: string;
    prNo: string;
    positionTitle: string | null;
    stageName: string;
    seqNo: number;
    planDate: string | null;
    dueDate: string | null;
    status: string;
    performedAt: string | null;
    performerName: string | null;
    lateDays: number | null;
    overdueDays: number | null;
  }[];
  byStage: { stage: string; total: number; done: number; onTime: number; late: number; pending: number; overdue: number; rate: number | null }[];
  total: number;
  onTime: number;
  late: number;
  pendingOverdue: number;
  complianceRate: number | null;
}

/** RC3.3 — Candidate Scorecard Summary. */
export interface RC33Data {
  rows: {
    candidateName: string;
    prNo: string;
    positionTitle: string | null;
    stageName: string;
    evaluatorName: string;
    submitted: boolean;
    submittedAt: string | null;
    avgScore: number | null;
    recommendation: string | null;
    competencyCount: number;
  }[];
  divergences: {
    candidateName: string;
    prNo: string;
    stageName: string;
    competency: string;
    spread: number;
    scores: number[];
  }[];
  total: number;
  submitted: number;
  pending: number;
  avgScore: number | null;
  flaggedDivergence: number;
  byRecommendation: { key: string; label: string; count: number }[];
}

// ---------- Grup 4: Offer, Pengangkatan & Biaya ----------

/** RC4.1 — Offer Status & Response. */
export interface RC41Data {
  rows: {
    offerNo: string;
    candidateName: string;
    prNo: string;
    positionTitle: string | null;
    status: string;
    sentAt: string | null;
    respondedAt: string | null;
    responseDays: number | null;
    expiryDate: string | null;
    appointed: boolean;
    note: string | null;
  }[];
  total: number;
  byStatus: { status: string; label: string; count: number }[];
  accepted: number;
  declined: number;
  acceptanceRate: number | null;
  avgResponseDays: number | null;
  expiringSoon: number;
}

/** RC4.2 — Hiring Realization (pengangkatan → karyawan). */
export interface RC42Data {
  rows: {
    prNo: string;
    positionTitle: string | null;
    officeName: string | null;
    unitName: string | null;
    candidateName: string;
    source: string;
    appointmentDate: string;
    employmentStatus: string;
    employeeNo: string | null;
    onboarding: string | null;
    letterNo: string | null;
  }[];
  total: number;
  onboarded: number;
  pendingOnboarding: number;
  bySource: { key: string; label: string; count: number }[];
}

/** RC4.3 — Recruitment Cost per Hire. */
export interface RC43Data {
  year: number;
  rows: {
    joNo: string;
    joTitle: string;
    method: string;
    mediaName: string | null;
    agencyName: string | null;
    datePosted: string | null;
    plannedCost: number | null;
    actualCost: number | null;
  }[];
  budget: { total: number | null; adjust: number | null; note: string | null } | null;
  hires: number;
  totalPlanned: number | null;
  totalActual: number | null;
  costPerHire: number | null;
  masked: boolean;
}

export type RecruitmentReportData =
  | RC11Data | RC12Data | RC13Data
  | RC21Data | RC22Data | RC23Data
  | RC31Data | RC32Data | RC33Data
  | RC41Data | RC42Data | RC43Data;
