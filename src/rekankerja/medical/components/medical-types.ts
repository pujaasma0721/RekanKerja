"use client";
// RekanKerja Medical — shared types (padanan modul Medical Benefit)
import { getLang } from "@/rekankerja/shared/lib/i18n-core";

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
  /** Task 33 — jumlah aturan diferensiasi plafon. */
  ruleCount?: number;
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
  /** W1-6 — relasi master MedicalProvider (null = klaim lama tanpa relasi). */
  providerId?: string | null;
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
  /** info approval berjenjang (Task 25) — null bila tanpa chain */
  approval?: MedicalApprovalUI | null;
  /** T16-ATTACH — metadata lampiran kwitansi (badge "lampiran n" + preview). */
  attachments?: import("@/rekankerja/shared/components/attachment-upload").AttachmentMetaUI[];
  attachmentCount?: number;
}

/** Ringkasan jalur approval berjenjang pada row list (Task 25). */
export interface MedicalApprovalUI {
  status: "InProgress" | "Approved" | "Rejected" | "Cancelled";
  currentLevel: number;
  totalLevels: number;
  currentApprover: string | null;
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
  // ---- tambahan (fix audit K-1/K-2/K-3 — additive, opsional utk kompatibilitas) ----
  joinDate?: string | null;
  depRemaining?: number;
  claimPool?: "employee" | "dependent";
  /** sisa pool yang benar setelah reservasi klaim menunggu (guard K-1/K-2). */
  remainingForClaim?: number;
  pendingReserved?: number;
  poolNote?: string | null;
  // ---- tambahan Wave 1 (additive, opsional) ----
  /** W1-1 — jenis UNLIMITED: tampil "∞" & guard plafon dilewati. */
  unlimited?: boolean;
  /** W1-3 — rencana split company/asuransi (estimasi UI). */
  insurancePlan?: { pctCompany: number; pctInsurance: number; insuranceCompany: string | null };
  /** W1-8 — faktor prorata masa kerja (null/undefined = penuh). */
  prorateFactor?: number | null;
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
  EVERY_X_YEARS: "setiap X tahun",
};

// ---- peta label EN (paralel — render: t(MAP[k], MAP_EN[k])) ----
export const CLAIM_STATUS_LABEL_EN: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Pending",
  Returned: "Returned",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  Settled: "Approved & Paid",
};

export const LIMIT_RULE_LABEL_EN: Record<string, string> = {
  UNLIMITED: "Unlimited",
  NOMINAL: "Nominal",
  FACTOR: "Salary Factor",
  WAGE_COMPONENT: "Wage Component",
};

export const UNUSED_RULE_LABEL_EN: Record<string, string> = {
  FORFEITED: "Forfeited (reset)",
  CASH: "Cashed Out (UMC)",
  CARRY: "Carried to Next Year",
};

export const DEP_LIMIT_LABEL_EN: Record<string, string> = {
  SHARED: "Shared package with employee",
  TOTAL_SEPARATE: "One separate limit (combined dependents)",
  EACH: "Limit per dependent",
};

export const FREQ_PERIOD_LABEL_EN: Record<string, string> = {
  MEDICAL: "medical period",
  WORK: "length of service",
  YEAR: "year",
  EVERY_X_YEARS: "every X years",
};

// ---- formatters ikut bahasa aktif (state i18n-core tersinkron dgn useI18n) ----
const dateLocale = () => (getLang() === "en" ? "en-US" : "id-ID");

export const fmtIDR = (n: number) =>
  new Intl.NumberFormat(dateLocale(), { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const fmtIDRShort = (n: number) => {
  if (getLang() === "en") {
    if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
    if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
    return `Rp ${n.toLocaleString("en-US")}`;
  }
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  if (Math.abs(n) >= 1_000) return `Rp ${(n / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${n.toLocaleString("id-ID")}`;
};

export const fmtDateID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(dateLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTimeID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(dateLocale(), { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const todayISO = () => new Date().toISOString().slice(0, 10);
