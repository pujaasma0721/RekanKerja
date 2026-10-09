// T113 — tipe payload 12 laporan distribusi Attendance =======================
// Mirror 1:1 dari src/rekankerja/time-attendance/api/attendance-report-documents.ts
// — dipakai komponen tab "Reports" (report-documents-tab.tsx).

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

// ---------- Grup 1: Rekapitulasi Presensi Berkala ----------
export interface AR11Data {
  month: string;
  workdays: number;
  rows: {
    employeeNo: string; name: string; unit: string | null; employmentStatus: string;
    scheduled: number; present: number; lateDays: number; lateMinutes: number;
    sick: number; leaveOther: number; workoff: number; absent: number; off: number;
    workHours: number; overtimeHours: number; attendanceRate: number | null;
  }[];
  total: number;
  sum: {
    scheduled: number; present: number; lateDays: number; lateMinutes: number;
    sick: number; leaveOther: number; workoff: number; absent: number; off: number;
    workHours: number; overtimeHours: number;
  };
}

export interface AR12Data {
  date: string;
  dateLabel: string;
  rows: {
    employeeNo: string; name: string; unit: string | null;
    dayTypeCode: string | null; shift: string | null;
    checkIn: string | null; checkOut: string | null;
    lateMinutes: number; earlyMinutes: number; workHours: number | null;
    location: string | null; status: string; notes: string | null;
  }[];
  counts: { present: number; late: number; absent: number; off: number; onLeave: number; workoff: number };
  onTimePct: number | null;
}

export interface AR13Data {
  items: {
    employeeNo: string; name: string; unit: string | null;
    date: string; time: string; direction: "IN" | "OUT"; source: string;
    lat: number; lng: number;
    nearestName: string | null; distanceM: number | null; radiusM: number | null;
    within: boolean; locationLabel: string;
  }[];
  byLocation: { name: string; punches: number; employees: number }[];
  total: number;
  within: number;
  outside: number;
  employees: number;
  locationsCount: number;
}

// ---------- Grup 2: Keterlambatan & Jam Kerja Kurang ----------
export interface AR21Data {
  items: {
    date: string; employeeNo: string; name: string; unit: string | null; dayTypeCode: string | null;
    plannedIn: string | null; actualIn: string | null; lateMinutes: number;
    plannedOut: string | null; actualOut: string | null; earlyMinutes: number;
    severity: "tinggi" | "sedang" | "ringan"; note: string | null;
  }[];
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  avgLate: number;
  worst: { employeeNo: string; name: string; lateCount: number; lateMinutes: number } | null;
}

export interface AR22Data {
  rows: {
    employeeNo: string; name: string; unit: string | null; workdays: number;
    targetHours: number; actualHours: number; deficitHours: number;
    avgPerDay: number; achievement: number | null; status: "ok" | "watch" | "deficit";
  }[];
  totalTarget: number;
  totalActual: number;
  totalDeficit: number;
  achievement: number | null;
  deficitEmployees: number;
  standardHoursPerWeek: number;
}

export interface AR23Data {
  rows: {
    rank: number; employeeNo: string; name: string; unit: string | null;
    lateCount: number; lateMinutes: number; absentDays: number;
    workoffDays: number; leaveDays: number;
    violations: number; points: number; recommendation: string; action: string;
  }[];
  flagged: number;
  byRec: { recommendation: string; count: number }[];
  totalLate: number;
  totalAbsent: number;
}

// ---------- Grup 3: Lembur & Jam Kerja Efektif ----------
export interface AR31Data {
  items: {
    orderNo: string; date: string; employeeNo: string; name: string; unit: string | null;
    dayCategory: string; window: string;
    planHours: number; actualHours: number; verifiedHours: number;
    rateMultiplier: number; status: string; approver: string | null; reason: string | null;
  }[];
  byCategory: { dayCategory: string; label: string; count: number; verifiedHours: number }[];
  byStatus: { status: string; label: string; count: number }[];
  totalOrders: number;
  totalVerifiedHours: number;
  employees: number;
}

export interface AR32Data {
  masked: boolean;
  items: {
    orderNo: string; date: string; employeeNo: string; name: string; unit: string | null;
    dayCategory: string; verifiedHours: number;
    monthlySalary: number | null; hourlyRate: number | null; estimatedPay: number | null;
    indexNote: string; status: string;
  }[];
  totalHours: number;
  totalPay: number | null;
  orders: number;
  basisNote: string;
}

export interface AR33Data {
  month: string;
  modeLabel: string;
  caps: { dailyHours: number; weeklyHours: number; monthlyHours: number | null };
  rows: {
    employeeNo: string; name: string; unit: string | null; monthlyHours: number;
    /** AUD-OT: jam lembur hari kerja (dihitung ke cap) vs hari istirahat/
     *  libur resmi (DIKECUALIKAN dari cap — PP 35/2021 Ps.26 ayat 2). */
    weekdayHours: number;
    restDayHours: number;
    peakDaily: { date: string; hours: number } | null;
    peakWeekly: { weekLabel: string; hours: number } | null;
    violations: { type: "daily" | "weekly" | "monthly"; detail: string }[];
    status: "compliant" | "watch" | "violation";
  }[];
  withOt: number;
  compliant: number;
  watch: number;
  violation: number;
  /** total jam lembur hari istirahat/libur resmi (dikecualikan dari cap). */
  restDayHours: number;
  complianceRate: number | null;
  basis: string;
}

// ---------- Grup 4: Variasi Jadwal & Kerja Shift ----------
export interface AR41Data {
  items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    rosterCode: string; rosterShift: string;
    actualIn: string | null; actualOut: string | null;
    type: "absent" | "late" | "early" | "off-work" | "no-punch";
    detail: string; severity: "tinggi" | "sedang" | "rendah";
  }[];
  byType: { type: string; label: string; count: number }[];
  total: number;
  rosterDays: number;
  employees: number;
  onRosterPct: number | null;
}

export interface AR42Data {
  items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    category: "night" | "holiday"; categoryLabel: string;
    checkIn: string | null; checkOut: string | null;
    hours: number; otHours: number; premium: boolean;
  }[];
  nightCount: number;
  nightHours: number;
  holidayCount: number;
  holidayHours: number;
  employees: number;
  otVerifiedHours: number;
}

export interface AR43Data {
  items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    type: "missing-out" | "no-punch" | "revised";
    typeLabel: string; detail: string; severity: "tinggi" | "sedang" | "rendah";
    action: string;
  }[];
  counts: { type: string; label: string; count: number }[];
  total: number;
  employees: number;
}

export type AttendanceReportData =
  | AR11Data | AR12Data | AR13Data
  | AR21Data | AR22Data | AR23Data
  | AR31Data | AR32Data | AR33Data
  | AR41Data | AR42Data | AR43Data;
