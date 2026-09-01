"use client";
// OneVity Payroll — tipe & label bersama (dipakai semua view modul payroll)

export interface WageCompFull {
  id: string; code: string; name: string;
  type: string; wageType: string; calcMethod: string;
  amount: number; formula: string | null;
  incomeTaxMethod: string; processMethod: string;
  roundingType: string; roundingValue: number;
  prorated: boolean; taxable: boolean;
  includeInBasicIncome: boolean; includeInTHP: boolean; displayInPaySlip: boolean;
  applyThrRules: boolean; jamsostekBasis: string | null;
  sptReference: string | null; naturaType: string | null; wageCodeBackPay: string | null;
  active: boolean;
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
  items: RunItem[];
}

export interface RunDetail {
  run: RunRow & { lines: RunLine[] };
  componentTotals: { code: string; name: string; type: string; wageType: string; total: number }[];
}

export interface LoanRow {
  id: string; employeeId: string; letterNo: string;
  loanDate: string; amount: number; installmentCount: number; installmentAmount: number;
  interestRate: number; startPaymentDate: string; purpose: string | null;
  status: string; paidAmount: number; outstanding: number; wageComponentCode: string | null;
  employee: { employeeNo: string; fullName: string };
  installments: { id: string; sequence: number; periodCode: string | null; dueDate: string; amount: number; status: string; deductedRunNo: string | null }[];
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

export interface ProfileRow {
  employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; positionName: string | null; gradeName: string | null;
  baseSalary: number;
  profile: {
    id: string; npwp: string | null; hasNpwp: boolean; processMethod: string;
    paymentFrequency: string; wageTemplateId: string | null; wageTemplateName: string | null;
    taxStatus: string; ptkpValue: number; dependents: number;
    bankName: string | null; bankAccount: string | null;
  } | null;
}

export interface TemplateRow {
  id: string; code: string; name: string; description: string | null; active: boolean;
  _count: { profiles: number };
  items: { id: string; sortOrder: number; wageComponent: { id: string; code: string; name: string; type: string; wageType: string } }[];
}

// ============ LABELS ============
// TAX_STATUS_LABEL didefinisikan di engine (dipakai server & client)
export { TAX_STATUS_LABEL } from "@/lib/onevity/payroll-engine";

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
];
