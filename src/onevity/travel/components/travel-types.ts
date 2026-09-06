"use client";
// OneVity Travel — shared types (padanan modul Travel Administration)
import { currentLocale, getLang } from "@/onevity/shared/lib/i18n-core";
export interface EmployeeOption {
  id: string; employeeNo: string; fullName: string;
}

export interface TemplateRowUI {
  id: string; code: string; name: string; isDefault: boolean; description: string | null;
  settlementDay: number; settlementMethod: string; active: boolean;
  requestCount: number; claimCount: number;
}

export interface ExpenseTypeRowUI {
  id: string; code: string; name: string; kind: string; description: string | null;
  needDocs: boolean; limitAmount: number; unlimited: boolean; currency: string;
  compWageCode: string | null; debitAccount: string | null; creditAccount: string | null; active: boolean;
}

export interface ZoneRowUI {
  id: string; code: string; name: string; overseas: boolean;
}

export interface DestinationUI {
  seq: number; city: string; country: string; dateFrom: string; dateTo: string;
  overseas: boolean; zoneName: string | null;
}

export interface TravelRequestRowUI {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; requestDate: string; dateFrom: string; dateTo: string; days: number;
  templateCode: string; templateName: string; costCenter: string | null; purpose: string;
  remark: string | null; status: string; claimRequestedAt: string | null;
  decidedAt: string | null; decisionNote: string | null;
  destinations: DestinationUI[];
  advanceAmount: number;
  claimCount: number;
  /** K-2 (24-FIX-TRAVEL): ada klaim aktif (status bukan Rejected/Cancelled). */
  hasActiveClaim: boolean;
  activeClaimDocNo: string | null;
  settlementDue: string | null;
  overdue: boolean;
  /** info approval berjenjang (Task 25) — null bila tanpa chain */
  approval?: TravelApprovalUI | null;
}

/** Ringkasan jalur approval berjenjang pada row list (Task 25). */
export interface TravelApprovalUI {
  status: "InProgress" | "Approved" | "Rejected" | "Cancelled";
  currentLevel: number;
  totalLevels: number;
  currentApprover: string | null;
}

export interface ClaimExpenseUI {
  expenseCode: string; kind: string; description: string | null;
  amount: number; qty: number; guestName: string | null; overLimit: boolean;
  expenseDate: string | null;
}

export interface TravelClaimRowUI {
  id: string; docNo: string; requestDocNo: string | null; employeeId: string;
  employeeNo: string; fullName: string; orgUnitName: string | null;
  claimDate: string; templateCode: string; templateName: string; costCenter: string | null;
  purpose: string | null; remark: string | null; status: string;
  otherCompanyExp: number; exchangeLoss: number; payableEmployee: number; payableCompany: number;
  totalSettlement: number; settlementMethod: string; voucherNo: string | null;
  journalNo: string | null; journalDate: string | null; periodCode: string | null;
  transferredRunNo: string | null; paidRunNo: string | null;
  decidedAt: string | null; decisionNote: string | null;
  advanceAmount: number;
  totalExpenses: number;
  expenseLines: number;
  overLimitLines: number;
  expenseKinds: string[];
  /** T16-ATTACH — metadata lampiran kwitansi (badge "lampiran n" + preview). */
  attachments?: import("@/onevity/shared/components/attachment-upload").AttachmentMetaUI[];
  attachmentCount?: number;
}

export interface BudgetItemUI {
  costCenter: string; amount: number; note: string | null;
}

export interface BudgetRowUI {
  id: string; year: number; startDate: string; endDate: string; currency: string;
  totalBudget: number; note: string | null;
  items: BudgetItemUI[];
  used: number; remaining: number; claimCount: number;
}

export interface TravelStatsUI {
  requestsThisMonth: number;
  requestsApprovedYtd: number;
  pendingRequestApprovals: number;
  pendingClaimApprovals: number;
  claimsYtd: number;
  claimsYtdAmount: number;
  transferredCount: number;
  paidCount: number;
  budgetYear: number | null;
  budgetTotal: number;
  budgetUsed: number;
  advanceOutstanding: number;
  topExpenseKinds: { kind: string; amount: number }[];
}

export interface PeriodOptionUI {
  id: string; name: string; code: string; status: string;
}

export const TRAVEL_STATUS_LABEL: Record<string, string> = {
  Submitted: "Menunggu",
  Approved: "Disetujui",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
  Transferred: "Ditransfer",
  Paid: "Dibayar",
};

// Peta EN paralel TRAVEL_STATUS_LABEL (render: t(MAP[k], MAP_EN[k])).
export const TRAVEL_STATUS_LABEL_EN: Record<string, string> = {
  Submitted: "Pending",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  Transferred: "Transferred",
  Paid: "Paid",
};

export const EXPENSE_KIND_LABEL: Record<string, string> = {
  GENERAL: "General Expense",
  ALLOWANCE: "Allowance",
  MILEAGE: "Mileage",
  ENTERTAINMENT: "Entertainment",
};

// Formatter angka/tanggal mengikuti bahasa aktif (i18n-core, disinkronkan
// setLang) — padanan pola fmtIDR/fmtDate di shared/lib/api.ts.
export const fmtIDR = (n: number) =>
  new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const fmtIDRShort = (n: number) => {
  const loc = currentLocale();
  if (getLang() === "en") {
    if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString(loc, { maximumFractionDigits: 1 })}B`;
    if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString(loc, { maximumFractionDigits: 1 })}M`;
    return `Rp ${n.toLocaleString(loc)}`;
  }
  if (Math.abs(n) >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString(loc, { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString(loc, { maximumFractionDigits: 1 })} jt`;
  if (Math.abs(n) >= 1_000) return `Rp ${(n / 1_000).toLocaleString(loc, { maximumFractionDigits: 0 })} rb`;
  return `Rp ${n.toLocaleString(loc)}`;
};

export const fmtDateID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(currentLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "—";
