// OneVity ESS — TS types sesuai KONTRAK API (dibangun paralel oleh agent T7).
// Endpoint: GET/POST /api/onevity/ess/* — frontend memanggil persis sesuai kontrak.
//
// Catatan bentuk data: objek kontrak yang field dalamnya tidak dirinci di kontrak
// (attendance days/summary, klaim medis/travel) dideklarasikan sebagai record
// longgar (EssRecord) dan dibaca DEFENSIF lewat helper pickStr/pickNum di ess-api —
// tampilan tetap rapi (fallback "—") bila backend memakai nama field varian.

// ============ view ESS (view-state internal shell, bukan route) ============
export type EssView =
  | "dashboard"
  | "profile"
  | "leave"
  | "attendance"
  | "payslips"
  | "claims"
  | "requests"
  | "letters"
  // wave 27 — pengumuman / tukar shift / aset saya
  | "announcements"
  | "swap"
  | "assets";

/** record dinamis — kolom dibaca defensif (pickStr/pickNum) */
export type EssRecord = Record<string, unknown>;

// ============ 1. GET /ess/me ============
export interface EssEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  positionTitle: string | null;
  orgUnitName: string | null;
  gradeCode: string | null;
  levelCode: string | null;
  managerName: string | null;
  joinDate: string | null;
  employmentStatus: string | null;
  taxId: string | null;
  bpjsHealth: string | null;
  bpjsEmpskill: string | null;
}

export interface EssMe {
  employee: EssEmployee;
  companyName: string | null;
  role: string | null;
  canAdmin: boolean;
}

// ============ 2. GET /ess/dashboard ============
export interface EssDashboardKpi {
  leaveAvailable: number;
  pendingMine: number;
  waitingApproval: number;
  present: number;
  late: number;
  absent: number;
  overtimeHoursMonth: number;
}

export interface EssLeaveBalanceLite {
  code: string | null;
  name: string;
  available: number;
}

export interface EssRecentRequest {
  docType: string;
  docNo: string;
  status: string;
  dateLabel: string | null;
}

export interface EssLatestPayslip {
  lineId: string;
  periodName: string;
  netAmount: number;
  status: string;
}

export interface EssClockToday {
  in: string | null;
  out: string | null;
}

export interface EssNotification {
  id: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface EssDashboard {
  kpi: EssDashboardKpi;
  leaveBalances: EssLeaveBalanceLite[];
  recentRequests: EssRecentRequest[];
  latestPayslip: EssLatestPayslip | null;
  clockToday: EssClockToday | null;
  notifications: EssNotification[];
}

// ============ 3-4. GET/POST /ess/leave ============
export interface EssLeaveBalance {
  /** id jenis cuti — dipakai submit { typeId } */
  id?: string | null;
  typeId?: string | null;
  code: string | null;
  name: string;
  entitlement?: number | null;
  /** terpakai (nama backend: taken; varian used fallback defensif) */
  taken?: number | null;
  used?: number | null;
  /** pending (nama backend: applied; varian pending fallback defensif) */
  applied?: number | null;
  pending?: number | null;
  available: number;
}

/** jenjang approval pengajuan cuti (bentuk aktual backend T7) */
export interface EssLeaveApproval {
  level?: number | null;
  total?: number | null;
  currentApproverName?: string | null;
}

export interface EssLeaveRequest {
  id?: string | null;
  docNo: string;
  typeName?: string | null;
  dateLabel?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  days?: number | null;
  status: string;
  /** jenjang approval saat ini (badge "Jenjang X/Y menunggu {approver}") */
  approval?: EssLeaveApproval | null;
  /** fallback flat bila backend memakai bentuk legacy */
  approvalStep?: number | null;
  approvalLevels?: number | null;
  currentApprover?: string | null;
}

export interface EssLeaveData {
  balances: EssLeaveBalance[];
  requests: EssLeaveRequest[];
}

export interface EssLeaveSubmitInput {
  typeId: string;
  dateFrom: string;
  dateTo: string;
  halfDay?: boolean;
  reason: string;
}

// ============ 5. GET /ess/attendance?month=YYYY-MM ============
export interface EssAttendanceData {
  days: EssRecord[];
  summary: EssRecord;
}

// ============ 6. POST /ess/clock ============
export interface EssClockInput {
  direction: "IN" | "OUT";
  latitude?: number;
  longitude?: number;
  note?: string;
}

export interface EssClockResult {
  ok: boolean;
  time: string;
}

// ============ 7-8. GET /ess/payslips(+detail) ============
export interface EssPayslipLine {
  lineId: string;
  periodName: string;
  status: string;
  gross: number;
  net: number;
  paidAt: string | null;
}

export interface EssPayslipItem {
  name: string;
  kind: string;
  amount: number;
}

export interface EssPayslipDetail {
  periodName: string;
  runStatus: string;
  employeeName: string;
  items: EssPayslipItem[];
  gross: number;
  totalDeductions: number;
  net: number;
}

// ============ 9. GET /ess/claims ============
export interface EssClaimsData {
  medical: EssRecord[];
  travel: EssRecord[];
}

// ============ 10. POST /ess/workoff ============
export interface EssWorkoffInput {
  dateFrom: string;
  dateTo: string;
  halfDay?: boolean;
  paid: boolean;
  reason: string;
}

// ============ 11. POST /ess/overtime ============
export interface EssOvertimeInput {
  date: string;
  planStart: string;
  planEnd: string;
  reason: string;
}

// ============ 12. GET/POST /ess/notifications ============
export interface EssNotificationsData {
  items: EssNotification[];
  unread: number;
}

// ============ 13. GET/POST /ess/letters (26-a — permintaan surat layanan) ============
/** Jenis surat layanan yang tersedia (LetterTemplate EmployeeService aktif). */
export interface EssLetterTemplate {
  key: string;
  name: string;
  description: string | null;
  subject: string | null;
}

/** Riwayat permintaan surat milik karyawan. */
export interface EssLetterRequest {
  id: string;
  reqNo: string;
  templateKey: string;
  templateName: string;
  purpose: string | null;
  notes: string | null;
  status: string; // Pending | Approved | Rejected | Issued
  rejectReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  letterDocumentId: string | null;
  letterRefNo: string | null;
  issuedAt: string | null;
}

export interface EssLettersData {
  templates: EssLetterTemplate[];
  requests: EssLetterRequest[];
}

// ============ hasil submit umum (201 { docNo, status }) ============
export interface EssSubmitResult {
  docNo: string;
  status: string;
}
