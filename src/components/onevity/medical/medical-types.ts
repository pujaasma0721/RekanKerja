"use client";
// OneVity Medical — shared types (padanan modul Medical Benefit oranHR)
export interface EmployeeOption {
  id: string; employeeNo: string; fullName: string;
}

export interface BenefitTypeUI {
  id: string; code: string; name: string; description: string | null; active: boolean;
  needReceipt: boolean;
  limitRule: string; limitValue: number; wageCode: string | null;
  freqUnlimited: boolean; freqValue: number; freqPeriod: string;
  pctCompany: number; pctInsurance: number; insuranceCompany: string | null;
  unusedRule: string; cashWageCode: string | null; maxCarryOver: number;
  dependentEnabled: boolean; maxDependents: number; maxChildAge: number; depLimitRule: string;
  balanceCount: number; claimCount: number;
}

export interface ProviderUI {
  id: string; code: string; name: string; kind: string;
  city: string | null; address: string | null; phone: string | null; active: boolean;
}

export interface BalanceUI {
  id: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; baseSalary: number;
  typeCode: string; typeName: string; year: number; limitRule: string;
  benefitAmount: number; adjustmentAmount: number; carriedOver: number;
  initialUsed: number; usedAmount: number; remaining: number;
  depBenefitAmount: number; depAdjustment: number; depUsed: number; depRemaining: number;
}

export interface ClaimLineUI {
  treatedName: string; treatment: string | null; treatmentDate: string | null;
  receiptNo: string | null; physician: string | null; hospital: string | null;
  occupationalInjury: boolean; billAmount: number; reimburseAmount: number;
  approvedAmount: number; nonReAmount: number; note: string | null;
}

export interface ClaimUI {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; typeCode: string; typeName: string; year: number;
  claimDate: string; letterNo: string | null; state: string; forDependent: boolean;
  maxBenefitAt: number; usedAt: number;
  totalBill: number; totalReimburse: number; totalApproved: number; totalNonRe: number;
  settleDate: string | null; journalNo: string | null; periodCode: string | null;
  paidRunNo: string | null; decisionNote: string | null;
  lineCount: number;
  lines?: ClaimLineUI[];
  statusLog: { state: string; at: string; by: string; note?: string }[];
}

export interface ClaimPreviewUI {
  employeeNo: string; fullName: string; baseSalary: number;
  typeName: string; typeCode: string; limitRule: string;
  benefitAmount: number; adjustmentAmount: number; carriedOver: number;
  initialUsed: number; usedAmount: number; remaining: number;
  claimCountYear: number;
  freqUnlimited: boolean; freqValue: number; freqPeriod: string;
  needReceipt: boolean; dependentEnabled: boolean;
  providers: { id: string; name: string; kind: string }[];
}

export interface AdjustmentUI {
  id: string; docNo: string; employeeNo: string; fullName: string;
  typeCode: string; typeName: string; year: number; forDependent: boolean;
  amount: number; adjustmentDate: string; note: string | null; state: string;
  decisionNote: string | null;
}

export interface MedicalStatsUI {
  year: number; totalBalances: number; totalClaims: number; pendingClaims: number;
  settledClaims: number; adjustments: number; types: number;
  settledApproved: number; settledBill: number; remaining: number;
  byType: { typeCode: string; typeName: string; claimCount: number; approvedAmount: number }[];
}

export interface PeriodOptionUI {
  id: string; name: string; code: string; status: string;
}

export const CLAIM_STATUS_LABEL: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Menunggu",
  Returned: "Dikembalikan",
  Approved: "Disetujui",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
  Settled: "Disetujui & Dibayar",
};

export const LIMIT_RULE_LABEL: Record<string, string> = {
  UNLIMITED: "Unlimited",
  NOMINAL: "Nominal",
  FACTOR: "Faktor × Gaji",
  WAGE_COMPONENT: "Komponen Upah",
};

export const UNUSED_RULE_LABEL: Record<string, string> = {
  FORFEITED: "Hangus (reset)",
  CASH: "Ditarik Tunai (UMC)",
  CARRY: "Dibawa Tahun Depan",
};

export const DEP_LIMIT_LABEL: Record<string, string> = {
  SHARED: "1 paket dengan karyawan",
  TOTAL_SEPARATE: "1 limit terpisah (gabung dep.)",
  EACH: "Limit per dependent",
};

export const FREQ_PERIOD_LABEL: Record<string, string> = {
  MEDICAL: "period medis",
  WORK: "masa kerja",
  YEAR: "tahun",
};

export const fmtIDR = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const fmtIDRShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (Math.abs(n) >= 1_000) return `Rp ${(n / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${n.toLocaleString("id-ID")}`;
};

export const fmtDateID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTimeID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const todayISO = () => new Date().toISOString().slice(0, 10);
