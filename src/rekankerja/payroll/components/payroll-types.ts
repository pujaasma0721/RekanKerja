"use client";
// RekanKerja Payroll — tipe & label bersama (dipakai semua view modul payroll)

export interface WageCompFull {
  id: string; code: string; name: string;
  type: string; wageType: string; calcMethod: string;
  amount: number; formula: string | null;
  incomeTaxMethod: string; processMethod: string;
  roundingType: string; roundingValue: number;
  prorated: boolean; taxable: boolean;
  /** Task 64b — basis prorata: null/"Calendar" = hari kalender; "WorkingDays" = hari kerja jadwal. */
  prorateBasis?: string | null;
  includeInBasicIncome: boolean; includeInTHP: boolean; displayInPaySlip: boolean;
  applyThrRules: boolean; jamsostekBasis: string | null;
  sptReference: string | null; naturaType: string | null; wageCodeBackPay: string | null;
  accountDebitCode: string | null; accountCreditCode: string | null;
  active: boolean;
  /** Task 32 — jumlah aturan diferensiasi besaran (relasi rules). */
  ruleCount?: number;
}

export interface PeriodRow {
  id: string; code: string; name: string; payType: string;
  startDate: string; endDate: string; taStartDate: string | null; taEndDate: string | null;
  payPeriod: number; sptMonth: number; sptYear: number;
  processDate: string | null; status: string; notes: string | null;
  _count: { runs: number };
}

export interface ProcessTypeRow {
  id: string; code: string; name: string; sequence: number; calculateTax: boolean; active: boolean;
}

export interface RunRow {
  id: string; runNo: string;
  periodId: string; processTypeId: string;
  period: { id: string; code: string; name: string; status: string };
  processType: { id: string; code: string; name: string };
  sequence: number; status: string;
  calculateTax: boolean; allEmployee: boolean;
  /** 26-b P0 — preferensi slip email berpassword (sandi NIK karyawan). */
  slipPassword: boolean;
  employeeCount: number; totalBruto: number; totalDeduction: number; totalTax: number; totalNet: number;
  notes: string | null;
  calculatedAt: string | null; confirmedAt: string | null; paidAt: string | null; createdAt: string;
  _count: { lines: number };
}

export interface RunItem {
  id: string; lineId: string; code: string; name: string; wageType: string; type: string;
  incomeTaxMethod: string; amount: number; note: string | null; sortOrder: number;
}

export interface RunLine {
  id: string; runId: string; employeeId: string;
  employeeNo: string; employeeName: string; orgUnitName: string | null; positionName: string | null;
  ptkpStatus: string; ptkpValue: number;
  bruto: number; deduction: number; taxRegular: number; taxIrregular: number;
  net: number; actualNetTax: number | null; notes: string | null;
  // 26-b P0 — penanda UMP/UMK (PP 36/2021) dari hasil kalkulasi
  umkWarning: boolean;
  umkJson: string | null;
  items: RunItem[];
}

/** Snapshot warning UMP/UMK per line (parse umkJson — 26-b). */
export interface UmkLineWarning {
  employeeNo: string;
  employeeName: string;
  office: string | null;
  officeCode: string | null;
  baseSalary: number;
  umk: { label: string; amount: number };
  gap: number;
}

export interface RunDetail {
  run: RunRow & { lines: RunLine[] };
  componentTotals: { code: string; name: string; type: string; wageType: string; total: number }[];
  /** Task 63 — log kejadian run (parameter kurang/anomali/info proses). */
  logs?: RunLog[];
}

export interface RunLog {
  id: string; runId: string;
  employeeId: string | null; employeeNo: string | null; employeeName: string | null;
  level: "warning" | "error" | "info"; code: string; message: string;
  createdAt: string;
}

export interface LoanRow {
  id: string; employeeId: string; letterNo: string;
  loanDate: string; amount: number; installmentCount: number; installmentAmount: number;
  interestRate: number; startPaymentDate: string; purpose: string | null;
  status: string; paidAmount: number; outstanding: number; wageComponentCode: string | null;
  employee: { employeeNo: string; fullName: string };
  installments: { id: string; sequence: number; periodCode: string | null; dueDate: string; amount: number; status: string; deductedRunNo: string | null }[];
  /** info approval berjenjang pengajuan (Task 25) — null bila tanpa chain */
  approval?: LoanApprovalUI | null;
}

/** Ringkasan jalur approval berjenjang pinjaman (Task 25). */
export interface LoanApprovalUI {
  status: "InProgress" | "Approved" | "Rejected" | "Cancelled";
  currentLevel: number;
  totalLevels: number;
  currentApprover: string | null;
}

export interface CompAssignmentRow {
  id: string; employeeId: string; wageComponentId: string;
  kind: string; amount: number; periodId: string | null; processTypeId: string | null;
  basedDate: string | null; notes: string | null; active: boolean;
  employee: { employeeNo: string; fullName: string };
  wageComponent: { code: string; name: string; type: string };
  period: { code: string; name: string } | null;
  processType: { code: string; name: string } | null;
}

/** Task 49: saran PTKP hasil derivasi data keluarga (server-side; tanpa PII). */
export interface PtkpSuggestion {
  taxStatus: string; // TK0..TK3 | K0..K3
  dependents: number; // 0..3
  spouse: boolean;
  tanggungan: number; // jumlah nyata sebelum clamp 3
}

export interface ProfileRow {
  employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; positionName: string | null; gradeName: string | null;
  baseSalary: number;
  profile: {
    id: string; npwp: string | null; hasNpwp: boolean; processMethod: string;
    paymentFrequency: string; wageTemplateId: string | null; wageTemplateName: string | null;
    taxStatus: string; ptkpValue: number; dependents: number;
    ptkpSource: "auto" | "manual";
    bankName: string | null; bankAccount: string | null;
  } | null;
  ptkpSuggestion: PtkpSuggestion;
  /** Task 64h — template valid hari ini dari riwayat (sumber tampilan read-only). */
  effectiveTemplate?: { id: string | null; name: string | null };
}

/** Task 64d — riwayat gaji & template upah per karyawan (modul Payroll). */
export interface SalaryHistoryEntry {
  id: string; validFrom: string; validTo: string | null;
  baseSalary: number; reason: string | null; sourceDocNo: string | null;
  notes: string | null; positionName: string | null; orgUnitName: string | null;
  gradeName: string | null; officeCode: string | null;
}
export interface TemplateHistoryEntry {
  id: string; validFrom: string; validTo: string | null;
  templateId: string | null; templateCode: string | null; templateName: string | null;
  reason: string | null; sourceDocNo: string | null; notes: string | null;
}
export interface PayrollHistoryResponse {
  employee: { id: string; employeeNo: string; fullName: string };
  salary: SalaryHistoryEntry[];
  templates: TemplateHistoryEntry[];
}

/** Task 49: hasil sinkronisasi massal PTKP dari data keluarga (POST sync-ptkp). */
export interface PtkpSyncResponse {
  ok: boolean;
  dryRun: boolean;
  employees: number;
  changed: number;
  autoEnabled: number;
  preservedKi: string[];
  changes: { employeeId: string; employeeName: string; changed: boolean; from: string; to: string }[];
  detail: string;
}

export interface TemplateRow {
  id: string; code: string; name: string; description: string | null; active: boolean;
  _count: { profiles: number };
  items: { id: string; sortOrder: number; wageComponent: { id: string; code: string; name: string; type: string; wageType: string } }[];
}

export interface JournalLine {
  id: string; sequence: number; accountCode: string; accountName: string;
  position: string; amount: number; memo: string | null; wageCode: string | null;
}

export interface JournalRow {
  id: string; journalNo: string; journalDate: string;
  runId: string | null; runNo: string | null; description: string | null;
  totalDebit: number; totalCredit: number; status: string;
  _count: { lines: number };
}

export interface MissingRunRow {
  id: string; runNo: string; periodName: string; typeName: string; status: string;
}

export interface SptEmployee {
  employeeId: string; employeeNo: string; employeeName: string;
  orgUnitName: string | null; positionName: string | null;
  npwp: string | null; hasNpwp: boolean; taxStatus: string; ptkpAnnual: number;
  runs: number;
  incomeRegular: number; incomeIrregular: number; incomeNonTaxable: number; incomeFinal: number;
  brutoTaxable: number; biayaJabatan: number; iuranJstk: number;
  neto: number; pkp: number; pph21Annual: number; taxWithheld: number; delta: number;
}

export interface SptReportData {
  year: number;
  employees: SptEmployee[];
  totals: {
    employees: number; brutoTaxable: number; biayaJabatan: number; iuranJstk: number;
    neto: number; pph21Annual: number; taxWithheld: number; delta: number;
  };
  regulation: { biayaJabatanRate: number; biayaJabatanCapAnnual: number };
}

export interface RapelBreakdownRow {
  periodCode: string; periodName: string; paid: number; expected: number; diff: number;
}

export interface EmployeeOption {
  id: string; employeeNo: string; fullName: string;
  orgUnitName?: string | null; positionName?: string | null;
}

// ============ BENEFIT (P5) ============

export interface BenefitTypeUsage {
  used: number; limit: number | null; remaining: number | null;
  inLimit: boolean; windowLabel: string;
}

export interface BenefitTypeRow {
  id: string; code: string; name: string; category: string; description: string | null;
  resetPeriod: string; maxClaimAmount: number; unlimited: boolean; allowOverlimit: boolean;
  needDocuments: boolean; autoApproveInLimit: boolean; payInPayroll: boolean;
  wageComponentId: string | null; entitleFor: string;
  validFrom: string; validTo: string | null; active: boolean;
  wageComponent: { id: string; code: string; name: string } | null;
  claimCount: number; activeClaimCount: number; totalApprovedAmount: number; ytdAmount: number;
  usage: BenefitTypeUsage | null;
  /** Task 33 — jumlah aturan diferensiasi limit klaim. */
  ruleCount?: number;
}

export interface BenefitClaimRow {
  id: string; claimNo: string; benefitTypeId: string; employeeId: string;
  claimDate: string; amount: number; approvedAmount: number;
  description: string | null; documentsNote: string | null; status: string;
  limitUsed: number; limitRemaining: number; inLimit: boolean;
  periodId: string | null; paidRunNo: string | null;
  approvedBy: string | null; approvedAt: string | null; rejectedReason: string | null;
  createdAt: string;
  benefitType: {
    id: string; code: string; name: string; category: string; resetPeriod: string;
    maxClaimAmount: number; unlimited: boolean; allowOverlimit: boolean;
    autoApproveInLimit: boolean; payInPayroll: boolean; needDocuments: boolean; wageComponentId: string | null;
  };
  employee: { employeeNo: string; fullName: string };
  period: { code: string; name: string; status: string } | null;
}

export interface BenefitStats {
  total: number; pending: number; pendingAmount: number;
  approvedCount: number; approvedAmount: number;
  scheduledCount: number; paidCount: number; paidAmount: number;
  rejectedCount: number; ytdAmount: number;
}

// ============ LABELS ============
// TAX_STATUS_LABEL didefinisikan di engine (dipakai server & client)
export { TAX_STATUS_LABEL } from "@/rekankerja/payroll/services/payroll-engine";

export const WAGE_TYPE_LABEL: Record<string, string> = {
  BasicSalary: "Gaji Pokok", Compensation: "Tunjangan/Kompensasi", CompensationNatura: "Kompensasi Natura",
  Deduction: "Potongan", Overtime: "Lembur", Jamsostek: "BPJS/Jamsostek", Loan: "Pinjaman",
  THPRounding: "Pembulatan THP", FinalTax: "Pajak Final", IncomeTax: "PPh21", Information: "Informasi",
  BackPay: "Back Pay (Rapel)", ServiceCharge: "Service Charge",
};

export const TAX_METHOD_LABEL: Record<string, string> = {
  NonTaxable: "Non-Taxable", Regular: "Reguler", Irregular: "Irreguler",
  FixedRateFinal: "Tarif Final", SeveranceFinal: "Final (Pesangon)", PensionFinal: "Final (Pensiun)",
  PKP: "PKP", Final2Years: "Final > 2 Thn",
};

export const PERIOD_STATUS_LABEL: Record<string, string> = {
  Open: "Terbuka", Processed: "Terproses", Closed: "Ditutup", Locked: "Terkunci",
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft", Calculated: "Terhitung", Confirmed: "Dikonfirmasi", Paid: "Dibayar", Cancelled: "Dibatalkan",
};

export const TAX_STATUS_OPTIONS: { value: string; label: string; ptkp: number }[] = [
  { value: "TK0", label: "TK/0 — Lajang", ptkp: 54_000_000 },
  { value: "TK1", label: "TK/1 — +1 tanggungan", ptkp: 58_500_000 },
  { value: "TK2", label: "TK/2 — +2 tanggungan", ptkp: 63_000_000 },
  { value: "TK3", label: "TK/3 — +3 tanggungan", ptkp: 67_500_000 },
  { value: "K0", label: "K/0 — Menikah", ptkp: 58_500_000 },
  { value: "K1", label: "K/1 — Menikah +1", ptkp: 63_000_000 },
  { value: "K2", label: "K/2 — Menikah +2", ptkp: 67_500_000 },
  { value: "K3", label: "K/3 — Menikah +3", ptkp: 72_000_000 },
  { value: "KI0", label: "K/I/0 — Menikah, pasangan bekerja", ptkp: 63_000_000 },
  { value: "KI1", label: "K/I/1 — K/I +1", ptkp: 67_500_000 },
  { value: "KI2", label: "K/I/2 — K/I +2", ptkp: 72_000_000 },
  { value: "KI3", label: "K/I/3 — K/I +3", ptkp: 76_500_000 },
];

export const FORMULA_VARIABLES = [
  { name: "BASE_SALARY", desc: "Gaji pokok dari penempatan aktif karyawan" },
  { name: "WORKING_DAYS", desc: "Hari kerja period (Senin–Jumat)" },
  { name: "PRORATE", desc: "Faktor prorata masa kerja (0–1)" },
  { name: "BPJS_BASE", desc: "Basis BPJS (= gaji pokok)" },
  { name: "JHT_BASE", desc: "Basis JHT (tanpa batas)" },
  { name: "JP_BASE", desc: "Basis JP (dibatasi cap regulasi)" },
  { name: "JPK_BASE", desc: "Basis JPK (dibatasi cap regulasi)" },
  { name: "JHT_RATE_CO / JHT_RATE_EMP", desc: "Tarif JHT perusahaan / pegawai" },
  { name: "JP_RATE_CO / JP_RATE_EMP", desc: "Tarif JP perusahaan / pegawai" },
  { name: "JPK_RATE_CO / JPK_RATE_EMP", desc: "Tarif JPK perusahaan / pegawai" },
  { name: "JKK_RATE / JKM_RATE", desc: "Tarif JKK & JKM" },
]

// ============ LABEL EN (peta paralel — render: t(MAP[k], MAP_EN[k])) ============
export const WAGE_TYPE_LABEL_EN: Record<string, string> = {
  BasicSalary: "Base Salary", Compensation: "Allowance/Compensation", CompensationNatura: "Natura Compensation",
  Deduction: "Deduction", Overtime: "Overtime", Jamsostek: "BPJS/Jamsostek", Loan: "Loan",
  THPRounding: "THP Rounding", FinalTax: "Final Tax", IncomeTax: "PPh21", Information: "Information",
  BackPay: "Back Pay (Retro Pay)", ServiceCharge: "Service Charge",
};

export const TAX_METHOD_LABEL_EN: Record<string, string> = {
  NonTaxable: "Non-Taxable", Regular: "Regular", Irregular: "Irregular",
  FixedRateFinal: "Final Rate", SeveranceFinal: "Final (Severance)", PensionFinal: "Final (Pension)",
  PKP: "PKP", Final2Years: "Final > 2 Yrs",
};

export const PERIOD_STATUS_LABEL_EN: Record<string, string> = {
  Open: "Open", Processed: "Processed", Closed: "Closed", Locked: "Locked",
};

export const RUN_STATUS_LABEL_EN: Record<string, string> = {
  Draft: "Draft", Calculated: "Calculated", Confirmed: "Confirmed", Paid: "Paid", Cancelled: "Cancelled",
};

export const TAX_STATUS_OPTION_EN: Record<string, string> = {
  TK0: "TK/0 — Single", TK1: "TK/1 — +1 dependent", TK2: "TK/2 — +2 dependents", TK3: "TK/3 — +3 dependents",
  K0: "K/0 — Married", K1: "K/1 — Married +1", K2: "K/2 — Married +2", K3: "K/3 — Married +3",
  KI0: "K/I/0 — Married, working spouse", KI1: "K/I/1 — K/I +1", KI2: "K/I/2 — K/I +2", KI3: "K/I/3 — K/I +3",
};

export const FORMULA_VARIABLES_EN: Record<string, string> = {
  BASE_SALARY: "Base salary from the employee's active placement",
  WORKING_DAYS: "Working days of the period (Monday–Friday)",
  PRORATE: "Employment prorate factor (0–1)",
  BPJS_BASE: "BPJS basis (= base salary)",
  JHT_BASE: "JHT basis (no cap)",
  JP_BASE: "JP basis (capped by regulation)",
  JPK_BASE: "JPK basis (capped by regulation)",
  "JHT_RATE_CO / JHT_RATE_EMP": "JHT rate company / employee",
  "JP_RATE_CO / JP_RATE_EMP": "JP rate company / employee",
  "JPK_RATE_CO / JPK_RATE_EMP": "JPK rate company / employee",
  "JKK_RATE / JKM_RATE": "JKK & JKM rates",
};
