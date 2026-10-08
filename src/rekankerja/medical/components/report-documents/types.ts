// T-MED-REPORTS — tipe payload 12 laporan distribusi Medical ====================
// Mirror 1:1 dari src/rekankerja/medical/api/medical-report-documents.ts — dipakai
// komponen tab "Dokumen Laporan" (report-documents-tab.tsx).
//
// KONVENSI UANG: semua nilai rupiah = number | null — null saat brankas uang
// terkunci (MoneyView masked); frontend merender "•••" (pola LR1.3 leave).

/** Meta dokumen — header standar semua laporan (logo, perusahaan, periode, dsb.).
 *  Struktur identik dgn HR/Leave types.DocMeta (doc-kit HR dipakai bersama). */
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

/** Status urgensi saldo (R1.1) & alert utilizer (R1.2). */
export type BalanceStatus = "exhausted" | "critical" | "warning" | "caution" | "safe";

// ---------- Grup 1: Saldo & Plafon Tunjangan Medis ----------

export interface MR11Data {
  year: number;
  masked: boolean;
  rows: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    typeCode: string; typeName: string; dependent: boolean;
    plafon: number | null; used: number | null; remaining: number | null;
    usedPct: number | null; // 0..100 (null saat masked)
    status: BalanceStatus;  // exhausted ≤0 · critical <5% · warning <10% · caution <20% · safe
  }[];
  byType: {
    typeCode: string; typeName: string; count: number;
    plafon: number | null; used: number | null; remaining: number | null;
  }[];
  total: number; // baris employee × jenis
  employees: number; // karyawan unik
  sum: { plafon: number | null; used: number | null; remaining: number | null };
}

export interface MR12Data {
  year: number;
  items: {
    employeeNo: string; name: string; unit: string | null;
    typeCode: string; typeName: string;
    plafon: number | null; used: number | null; remaining: number | null;
    remainingPct: number; // 0..100 (selalu terisi — bukan uang)
    claimCount: number;
    urgency: "exhausted" | "critical" | "warning" | "caution";
  }[];
  total: number;
  counts: { urgency: string; label: string; count: number }[];
  exhausted: number;
  totalRemaining: number | null;
}

export interface MR13Data {
  year: number;
  masked: boolean;
  byType: {
    typeCode: string; typeName: string; pctCompany: number;
    employees: number; plafon: number | null; used: number | null; remaining: number | null;
    liability: number | null; // remaining × pctCompany%
  }[];
  byUnit: {
    unit: string; employees: number; remaining: number | null; liability: number | null;
  }[];
  headcount: number;
  totalRemaining: number | null;
  totalLiability: number | null;
}

// ---------- Grup 2: Transaksi & Rekapitulasi Klaim ----------

export interface MR21Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    typeName: string; claimDate: string; state: string;
    receiptDate: string | null; patient: string; dependent: boolean;
    treatment: string | null; physician: string | null; hospital: string | null;
    bill: number | null; approved: number | null;
  }[];
  total: number; // baris perawatan
  claims: number; // dokumen klaim unik
  uniqueEmployees: number;
  sum: { bill: number | null; approved: number | null };
  byState: { state: string; label: string; count: number }[];
}

export interface MR22Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    typeName: string; claimDate: string; state: string; // Draft|Submitted|Approved
    waitingDays: number;
    sla: "overdue" | "due-soon" | "on-track"; // SLA verifikasi 3 hari kerja
    needReceipt: boolean; receiptComplete: boolean;
    needLetter: boolean; letterComplete: boolean;
    readyToVerify: boolean; // semua dokumen lengkap
    bill: number | null; approved: number | null;
  }[];
  total: number;
  counts: { state: string; label: string; count: number }[];
  oldestWaiting: number;
  docsMissing: number;
  sum: { bill: number | null; approved: number | null };
}

export interface MR23Data {
  items: {
    docNo: string; employeeNo: string; name: string; unit: string | null;
    patient: string; relation: string; // Pasangan|Anak|Orang Tua|Tanggungan (best-effort dr EmployeeFamily)
    claimDate: string; typeName: string;
    treatment: string | null; physician: string | null; hospital: string | null;
    bill: number | null; approved: number | null;
  }[];
  byEmployee: {
    employeeNo: string; name: string; unit: string | null; claims: number;
    bill: number | null; approved: number | null;
  }[];
  total: number;
  employees: number;
  sum: { bill: number | null; approved: number | null };
}

// ---------- Grup 3: Analisis Biaya & Utilisasi ----------

export interface MR31Data {
  year: number;
  masked: boolean;
  rows: {
    typeCode: string; typeName: string;
    claimCount: number; settledCount: number;
    bill: number | null; approved: number | null;
    companyPart: number | null; insurancePart: number | null;
    sharePct: number | null; // approved / total approved × 100
    avgPerClaim: number | null;
  }[];
  monthly: { month: string; claims: number; bill: number | null; approved: number | null }[];
  total: { claimCount: number; bill: number | null; approved: number | null; companyPart: number | null; insurancePart: number | null };
}

export interface MR32Data {
  year: number;
  masked: boolean;
  rows: {
    division: string; headcount: number;
    claimCount: number; inpatientClaims: number; outpatientClaims: number;
    approved: number | null;
    sickLeaveDays: number; lostWorkdays: number; // cuti sakit (CT-SAKIT) + klaim rawat inap (est. hari)
    costPerLostDay: number | null;
  }[];
  total: {
    headcount: number; claimCount: number; inpatientClaims: number; outpatientClaims: number;
    approved: number | null; sickLeaveDays: number; lostWorkdays: number; costPerLostDay: number | null;
  };
}

export interface MR33Data {
  items: {
    diagnosis: string; // teks jenis perawatan — tanpa nama pasien (anonim)
    claims: number; patients: number; // jumlah pasien unik (angka saja)
    bill: number | null; approved: number | null;
    sharePct: number | null;
    inpatient: boolean; // klaim pada jenis Rawat Inap
    firstSeen: string | null; lastSeen: string | null;
  }[];
  total: number; // kombinasi diagnosis unik
  claimsTotal: number;
  sum: { bill: number | null; approved: number | null };
  privacyNote: string;
}

// ---------- Grup 4: Rekonsiliasi Asuransi & Kepatuhan ----------

export interface MR41Data {
  year: number;
  masked: boolean;
  byInsurer: {
    insurer: string; claims: number;
    approved: number | null;       // klaim riil disetujui (settled)
    insurancePart: number | null;  // bagian asuransi (piutang 13xx)
    recovered: number | null;      // sudah dibayar asuransi
    outstanding: number | null;    // piutang belum tertagih
    writtenOff: number | null;
    recoveryRate: number | null;   // recovered / insurancePart × 100
  }[];
  monthly: {
    month: string; claims: number; approved: number | null;
    companyPart: number | null; insurancePart: number | null;
  }[];
  claims: {
    docNo: string; employeeNo: string; name: string; typeName: string; insurer: string;
    settleDate: string | null; insState: string; insAmount: number | null;
    insPaidAmount: number | null; outstanding: number | null; ageDays: number;
  }[];
  sum: {
    approved: number | null; insurancePart: number | null; recovered: number | null;
    outstanding: number | null; writtenOff: number | null;
  };
  unsubmitted: number;
  waitingPayment: number;
}

export interface MR42Data {
  year: number;
  enroll: {
    employeeNo: string; name: string; unit: string | null; gender: string;
    joinDate: string; employmentStatus: string;
    balanceGenerated: boolean; delayedDays: number; // hari sejak masuk
    action: string;
  }[];
  deenroll: {
    employeeNo: string; name: string; unit: string | null;
    joinDate: string; endDate: string | null; status: string;
    claimsThisYear: number; balanceRemaining: number | null;
    action: string;
  }[];
  counts: { enroll: number; deenroll: number };
  activeEnrolled: number; // karyawan aktif dgn saldo medis tahun tsb.
}

export interface MR43Data {
  items: {
    docNo: string; employeeNo: string; name: string; typeName: string;
    claimDate: string; patient: string; dependent: boolean;
    bill: number | null;
    firstPayer: number | null;   // non-reimbursement — ditanggung penjamin pertama (BPJS/pihak lain)
    reimburse: number | null;    // diajukan reimbursement internal
    approved: number | null;      // disetujui perusahaan (penjamin kedua - internal)
    insurancePart: number | null; // bagian asuransi swasta dari approved
    journalNo: string | null;
  }[];
  total: number;
  sum: {
    bill: number | null; firstPayer: number | null; reimburse: number | null;
    approved: number | null; insurancePart: number | null;
  };
  withFirstPayer: number; // klaim dgn bagian penjamin pertama > 0
}

export type MedicalReportData =
  | MR11Data | MR12Data | MR13Data
  | MR21Data | MR22Data | MR23Data
  | MR31Data | MR32Data | MR33Data
  | MR41Data | MR42Data | MR43Data;
