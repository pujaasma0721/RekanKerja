"use client";
// OneVity Attendance — shared types (mirror API responses)
export interface DayTypeRow {
  id: string; code: string; name: string; color: string; category: string;
  timeIn: string | null; timeOut: string | null; nextDay: boolean;
  breakMinutes: number; breakPaid: boolean; normalMinutes: number;
  toleranceLateMinutes: number; toleranceEarlyMinutes: number;
  flexible: boolean; needOvertimeOrder: boolean; active: boolean;
}

export interface ScheduleDayRow {
  id: string; sequence: number; dayTypeId: string;
  dayType: { code: string; name: string; color: string; category: string; timeIn: string | null; timeOut: string | null; nextDay: boolean; normalMinutes: number };
}

export interface ScheduleRow {
  id: string; code: string; name: string; cycleDays: number; active: boolean;
  days: ScheduleDayRow[];
  _count: { assignments: number };
}

export interface AssignmentRow {
  id: string; employeeId: string; scheduleId: string;
  anchorMonday: string; anchorSequence: number; clockingRequired: boolean;
  validFrom: string; validTo: string | null; notes: string | null;
  employee: { employeeNo: string; fullName: string; status: string; assignments: { orgUnit: { name: string } | null }[] };
  schedule: { code: string; name: string; cycleDays: number; days: { sequence: number; dayType: { code: string; name: string; color: string } }[] };
}

export interface EmployeeOption {
  id: string; employeeNo: string; fullName: string; orgUnitName: string | null;
}

export interface MatrixCell {
  date: string; code: string | null; name: string | null; color: string | null; category: string | null;
}

export interface MatrixRow {
  employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; assigned: boolean; clockingRequired: boolean; cells: MatrixCell[];
}

export interface DailyRow {
  employeeId: string; employeeNo: string; fullName: string; orgUnitName: string | null;
  workDate: string; dayTypeCode: string | null; dayTypeName: string | null;
  dayTypeColor: string | null; dayCategory: string | null;
  status: string; presence: number;
  checkIn: string | null; checkOut: string | null;
  lateMinutes: number; earlyMinutes: number; workMinutes: number;
  normalMinutes: number; absenceMinutes: number; overtimeMinutes: number;
  notes: string | null;
}

export interface ClockLogRow {
  id: string; employeeId: string; timestamp: string; direction: string; source: string; note: string | null;
  employee: { employeeNo: string; fullName: string };
}

export interface RecapRow {
  employeeId: string; employeeNo: string; fullName: string; orgUnitName: string | null; baseSalary: number;
  scheduledDays: number; presentDays: number; lateCount: number; lateMinutes: number;
  absentDays: number; absenceMinutes: number; workoffPaidDays: number; workoffUnpaidDays: number;
  offDays: number; normalMinutes: number; overtimeMinutes: number;
  overtimePay: number; lateDeduction: number; absenceDeduction: number; attendanceAllowance: number;
}

export interface OvertimeRow {
  id: string; orderNo: string; employeeId: string; overtimeDate: string;
  timeFrom: string; timeTo: string;
  planMinutes: number; actualMinutes: number; verifiedMinutes: number;
  dayCategory: string; rateMultiplier: number; letterNo: string | null; reason: string | null;
  status: string; approverId: string | null; decidedAt: string | null; decisionNote: string | null; paidRunNo: string | null;
  employee: { employeeNo: string; fullName: string; assignments: { baseSalary: number; orgUnit: { name: string } | null }[] };
  baseSalary: number; orgUnitName: string | null; estPay: number; effectiveMinutes: number;
}

export interface WorkoffRow {
  id: string; docNo: string; employeeId: string; dateFrom: string; dateTo: string;
  allDay: boolean; timeFrom: string | null; timeTo: string | null;
  paid: boolean; deductLeave: boolean; reason: string | null; documentNote: string | null;
  status: string; approverId: string | null; decidedAt: string | null; decisionNote: string | null;
  employee: { employeeNo: string; fullName: string; assignments: { orgUnit: { name: string } | null }[] };
  dayType: { code: string; name: string } | null;
  orgUnitName: string | null;
}

export interface AttendanceRule {
  id: string;
  roundingMinutes: number; minOvertimeMinutes: number; overtimeRoundingMinutes: number;
  nonClockingPolicy: string;
  overtimeComponentCode: string; lateDeductionComponentCode: string;
  absenceDeductionComponentCode: string; attendanceAllowanceComponentCode: string;
  attendanceAllowanceAmount: number; lateDeductionPerHour: number; absenceDeductionPerDay: number;
}

export interface PeriodOption {
  id: string; code: string; name: string; status: string; startDate: string; endDate: string; processTypes?: string;
  /** window transfer absensi terakhir (marker fix M-4) — dipakai prefill dialog transfer */
  taStartDate?: string | null; taEndDate?: string | null;
}

// label Indonesia
export const DAY_CATEGORY_LABEL: Record<string, string> = {
  Workday: "Hari Kerja", Off: "Hari Libur", Holiday: "Libur Nasional",
};

export const ATT_STATUS_LABEL: Record<string, string> = {
  Present: "Hadir", Late: "Telat", Absent: "Absen", Off: "Off",
  WorkOff: "Izin", Holiday: "Libur", OnLeave: "Cuti",
};

export const OT_CATEGORY_LABEL: Record<string, string> = {
  Weekday: "Hari Kerja (1,5×/2×)", Weekend: "Hari Libur Mingguan (2×/3×)", Holiday: "Libur Nasional (2×/3×/4×)",
};
