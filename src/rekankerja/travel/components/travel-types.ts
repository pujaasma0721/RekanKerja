"use client";
// RekanKerja Travel — shared types (padanan modul Travel Administration)
import { currentLocale, getLang } from "@/rekankerja/shared/lib/i18n-core";
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
  /** Task 33 — jumlah aturan diferensiasi limit. */
  ruleCount?: number;
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
  // Audit 97: kolom uang nullable — Brankas Uang mem-mask jadi null (45-b).
  otherCompanyExp: number | null; exchangeLoss: number | null; payableEmployee: number | null; payableCompany: number | null;
  totalSettlement: number | null; settlementMethod: string; voucherNo: string | null;
  journalNo: string | null; journalDate: string | null; periodCode: string | null;
  transferredRunNo: string | null; paidRunNo: string | null;
  decidedAt: string | null; decisionNote: string | null;
  advanceAmount: number | null;
  totalExpenses: number | null;
  expenseLines: number;
  overLimitLines: number;
  expenseKinds: string[];
  /** T16-ATTACH — metadata lampiran kwitansi (badge "lampiran n" + preview). */
  attachments?: import("@/rekankerja/shared/components/attachment-upload").AttachmentMetaUI[];
  attachmentCount?: number;
  /** Task 98 (F2-4): bendera anomali pre-approval (bantuan approver). */
  anomalies?: { kind: string; label: string }[];
  /** T15-CHAIN-EXT: ringkasan jalur approval berjenjang (jenjang aktif + approver menunggu). */
  approval?: TravelApprovalUI | null;
}

export interface BudgetItemUI {
  costCenter: string; amount: number | null; note: string | null;
}

export interface BudgetRowUI {
  id: string; year: number; startDate: string; endDate: string; currency: string;
  /** Task 98 (F0-5): null = vault uang masked. */
  totalBudget: number | null; note: string | null;
  items: BudgetItemUI[];
  used: number | null; remaining: number | null; claimCount: number;
  /** Task 98 (F1-3): terpakai per cost center + komitmen klaim Approved. */
  usedByCc?: Record<string, number>;
  committed?: number | null;
}

export interface TravelStatsUI {
  requestsThisMonth: number;
  requestsApprovedYtd: number;
  pendingRequestApprovals: number;
  pendingClaimApprovals: number;
  claimsYtd: number;
  claimsYtdAmount: number | null;
  transferredCount: number;
  paidCount: number;
  budgetYear: number | null;
  budgetTotal: number | null;
  budgetUsed: number | null;
  advanceOutstanding: number | null;
  topExpenseKinds: { kind: string; amount: number | null }[];
}

/** Task 98 (F2-5) — analytics pintar view Ringkasan. */
export interface TravelAnalyticsUI {
  monthly: { month: string; label: string; amount: number; claims: number }[];
  complianceRate: number | null;
  overLimitLines: number;
  totalLines: number;
  agingPendingClaims: { docNo: string; fullName: string; days: number; totalSettlement: number | null }[];
  topTravelers: { employeeNo: string; fullName: string; claims: number; amount: number }[];
  burnRate: { year: number | null; budgetTotal: number | null; used: number | null; usedPct: number | null; elapsedPct: number | null };
  avgSettlement: number | null;
}

/** Task 98 (F1-1) — tarif kota acuan SBI (PMK 32/2025). */
export interface CityRateRowUI {
  id: string; city: string; country: string; overseas: boolean; zoneCode: string | null;
  uangHarian: number; plafonHotel: number; note: string | null;
}

/** Task 98 (F1-2) — estimasi trip client-side (mirror service estimateTrip). */
export interface TripEstimateUI {
  legs: {
    city: string; rateFound: boolean; overseas: boolean;
    days: number; nights: number;
    uangHarian: number; perDiem: number;
    plafonHotel: number; hotelEstimate: number;
  }[];
  days: number;
  perDiemTotal: number;
  hotelTotal: number;
  estimateTotal: number;
}

/** Estimasi client-side dari tarif kota (mirror aturan SBI service —
 *  uang harian × hari + plafon hotel × malam; 60% utk multi-kaki kota sama
 *  domestik). Dipakai sebagai PREVIEW — server tetap otoritatif saat submit. */
export function estimateTripClient(
  cityRates: CityRateRowUI[],
  legs: { city: string; dateFrom: string; dateTo: string; overseas?: boolean }[],
): TripEstimateUI {
  const find = (city: string) => {
    const c = city.trim().toLowerCase();
    if (!c) return null;
    let best: CityRateRowUI | null = null;
    for (const r of cityRates) {
      const rc = r.city.trim().toLowerCase();
      if (!rc) continue;
      if (c === rc || c.includes(rc) || rc.includes(c)) {
        if (!best || rc.length > best.city.trim().toLowerCase().length) best = r;
      }
    }
    return best;
  };
  const dayDiff = (a: string, b: string) => {
    const t1 = new Date(a).getTime();
    const t2 = new Date(b).getTime();
    return Number.isFinite(t1) && Number.isFinite(t2) ? Math.round((t2 - t1) / 86_400_000) : 0;
  };
  const out: TripEstimateUI["legs"] = [];
  let perDiemTotal = 0;
  let hotelTotal = 0;
  const sameCity = legs.length > 0 && legs.every((x) => x.city.trim().toLowerCase() === legs[0].city.trim().toLowerCase());
  for (const l of legs) {
    if (!l.city.trim()) continue;
    const rate = find(l.city);
    const days = Math.max(1, dayDiff(l.dateFrom, l.dateTo) + 1);
    const nights = Math.max(0, dayDiff(l.dateFrom, l.dateTo));
    const overseas = Boolean(l.overseas) || rate?.overseas || false;
    const uangHarian = rate ? (!overseas && sameCity && legs.length > 1 ? rate.uangHarian * 0.6 : rate.uangHarian) : 0;
    const perDiem = Math.round(uangHarian * days);
    const plafonHotel = rate?.plafonHotel ?? 0;
    const hotelEstimate = Math.round(plafonHotel * nights);
    perDiemTotal += perDiem;
    hotelTotal += hotelEstimate;
    out.push({ city: l.city.trim(), rateFound: rate !== null, overseas, days, nights, uangHarian, perDiem, plafonHotel, hotelEstimate });
  }
  return {
    legs: out,
    days: out.length > 0 ? Math.max(...out.map((x) => x.days)) : 0,
    perDiemTotal,
    hotelTotal,
    estimateTotal: perDiemTotal + hotelTotal,
  };
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
// Audit 97 (Task 97): Brankas Uang mem-mask kolom uang klaim jadi null —
// formatter kini null-safe (konvensi Task 56: nilai tersembunyi tampil "—").
// Sebelumnya fmtIDR(null) diam-diam jadi "Rp 0" (menyesatkan) dan
// fmtIDRShort(null) memanggil null.toLocaleString → CRASH seluruh view
// Klaim & Settlement saat vault tertutup (kondisi default).
export const fmtIDR = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat(currentLocale(), { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export const fmtIDRShort = (n: number | null | undefined) => {
  if (n == null) return "—";
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

/** Audit 97 — pengurangan uang null-propagating untuk Brankas Uang: hasil
 *  null bila kedua operand ter-mask sehingga fmtIDR menampilkan "—".
 *  (Sebelumnya `a - b` pada null diam-diam menghasilkan 0 → "Rp 0".) */
export const subMoney = (a: number | null, b: number | null): number | null =>
  a == null && b == null ? null : (a ?? 0) - (b ?? 0);

export const fmtDateID = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString(currentLocale(), { day: "2-digit", month: "short", year: "numeric" }) : "—";
