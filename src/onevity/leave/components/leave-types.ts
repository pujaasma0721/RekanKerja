"use client";
// OneVity Leave — shared types (padanan modul Leave Administration)
export interface EmployeeOption {
  id: string; employeeNo: string; fullName: string;
}

export interface LeaveTypeRow {
  id: string; code: string; name: string; description: string | null;
  unit: "DAY" | "MONTH"; entitlement: number; maxPerRequest: number;
  paid: boolean; cashable: boolean; periodMode: "CALENDAR" | "ANNIVERSARY";
  prorateMonthly: boolean; carryOverMax: number; waitingMonths: number;
  allowAdvance: boolean; allowHalfDay: boolean; needDocs: boolean;
  active: boolean;
}

export interface BalanceRowUI {
  balanceId: string | null; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeId: string; leaveTypeCode: string; leaveTypeName: string;
  unit: string; paid: boolean; cashable: boolean; year: number; periodLabel: string;
  entitlement: number; maxPerRequest: number;
  carriedOver: number; earned: number; adjustment: number; forfeited: number;
  cashed: number; taken: number; applied: number; remaining: number;
}

export interface RequestRowUI {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeName: string; leaveTypeCode: string; paid: boolean;
  year: number; requestDate: string; dateFrom: string; sessionFrom: string;
  dateTo: string; sessionTo: string; workingDays: number;
  balanceAtRequest: number; remainingAtRequest: number; backToWorkDate: string | null;
  status: string; source: string; reason: string | null; note: string | null;
  decisionNote: string | null; decidedAt: string | null;
  /** info approval berjenjang (Task 25) — null bila tanpa chain */
  approval?: ApprovalChainUI | null;
}

/** Ringkasan jalur approval berjenjang pada row list (Task 25). */
export interface ApprovalChainUI {
  status: "InProgress" | "Approved" | "Rejected" | "Cancelled";
  currentLevel: number;
  totalLevels: number;
  currentApprover: string | null;
}

export interface EncashmentRowUI {
  id: string; docNo: string; employeeNo: string; fullName: string; leaveTypeName: string;
  year: number; requestDate: string; paymentDate: string | null; days: number; amount: number;
  status: string; periodCode: string | null; transferredRunNo: string | null;
  note: string | null; decisionNote: string | null;
}

export interface MassLeaveRowUI {
  id: string; docNo: string; leaveTypeName: string; letterNo: string | null;
  dateFrom: string; dateTo: string; amount: number; orgUnitName: string | null;
  excludeNonWorking: boolean; excludeConflicted: boolean; note: string | null;
  generated: number; createdAt: string;
}

export const LEAVE_STATUS_LABEL: Record<string, string> = {
  Submitted: "Menunggu",
  Approved: "Disetujui",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
  MassLeave: "Cuti Massal",
  Transferred: "Ditransfer",
  Paid: "Dibayar",
};

// LABEL EN (peta paralel — render: t(MAP[k], MAP_EN[k]))
export const LEAVE_STATUS_LABEL_EN: Record<string, string> = {
  Submitted: "Pending",
  Approved: "Approved",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
  MassLeave: "Mass Leave",
  Transferred: "Transferred",
  Paid: "Paid",
};

export const SESSION_LABEL: Record<string, string> = { AM: "Pagi", PM: "Siang" };
export const SESSION_LABEL_EN: Record<string, string> = { AM: "Morning", PM: "Afternoon" };

export const fmtDay = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
