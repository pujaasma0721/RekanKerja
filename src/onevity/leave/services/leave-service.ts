// OneVity Leave Service (ref: ANALISA-LEAVE.md — modul Leave Administration oranHR).
// Desain mengikuti ANALISA-LEAVE.md:
//   saldo = (a carried + b earned + c adjustment) − (d forfeited + e cashed + f taken + g applied)
//   earned dihitung dinamis (prorate bulanan opsional), taken/applied dari request
//   berstatus Approved/MassLeave, forfeited dari tanggal kadaluarsa carry-over.
import { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { dayStart, addDays, diffDays, resolveDayType } from "@/onevity/time-attendance/services/attendance-service";

// ============ util ============

const iso = (d: Date) => d.toISOString();
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function fmtDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** Jendela periode saldo: CALENDAR = 1 Jan–31 Des; ANNIVERSARY = per tanggal join. */
export function periodWindow(
  type: { periodMode: string },
  employee: { joinDate: Date },
  year: number,
): { validFrom: Date; validTo: Date; label: string } {
  if (type.periodMode === "ANNIVERSARY") {
    const j = employee.joinDate;
    const from = new Date(year - 1, j.getMonth(), j.getDate());
    const to = addDays(new Date(year, j.getMonth(), j.getDate()), -1);
    return { validFrom: from, validTo: to, label: `${fmtDateISO(from)} → ${fmtDateISO(to)}` };
  }
  return {
    validFrom: new Date(year, 0, 1),
    validTo: new Date(year, 11, 31),
    label: `01 Jan ${year} → 31 Des ${year}`,
  };
}

/** Tahun periode saldo tempat sebuah tanggal jatuh (mode anniversary-aware). */
export function yearForDate(
  type: { periodMode: string },
  employee: { joinDate: Date },
  date: Date,
): number {
  if (type.periodMode !== "ANNIVERSARY") return date.getFullYear();
  const j = employee.joinDate;
  const annivThisYear = new Date(date.getFullYear(), j.getMonth(), j.getDate());
  return date >= annivThisYear ? date.getFullYear() + 1 : date.getFullYear();
}

/** Bulan penuh berlaku dalam periode (prorate) — bulan berjalan dihitung penuh
 *  ("Leave Earned by End Of Month" oranHR), dihitung dari max(start periode, join). */
export function earnedMonths(
  from: Date,
  joinDate: Date,
  asOf: Date,
): number {
  const start = joinDate > from ? joinDate : from;
  const m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()) + 1;
  return Math.max(0, Math.min(12, m));
}

export function monthsInService(joinDate: Date, asOf: Date): number {
  return Math.max(0, (asOf.getFullYear() - joinDate.getFullYear()) * 12 + (asOf.getMonth() - joinDate.getMonth()));
}

/** Apakah sebuah tanggal adalah hari kerja efektif karyawan (dari jadwal TA).
 *  Karyawan tanpa assignment jadwal → fallback Senin–Jumat. */
async function isWorkday(db: TenantDb, employeeId: string, date: Date): Promise<boolean> {
  const { dayType } = await resolveDayType(db, employeeId, date);
  if (dayType) return dayType.category !== "Off" && dayType.category !== "Holiday";
  const dow = date.getDay();
  return dow >= 1 && dow <= 5;
}

// ============ tipe data baris saldo ============

export interface BalanceRow {
  balanceId: string | null;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  unit: string;
  paid: boolean;
  cashable: boolean;
  year: number;
  periodLabel: string;
  validFrom: Date;
  validTo: Date;
  entitlement: number;
  maxPerRequest: number;
  carriedOver: number; // (a)
  earned: number; // (b) — dinamis
  adjustment: number; // (c)
  forfeited: number; // (d) — dinamis (carry kadaluarsa 31-12)
  cashed: number; // (e)
  taken: number; // (f) — dinamis (request Approved/MassLeave, dateTo < hari ini)
  applied: number; // (g) — dinamis (request Approved/MassLeave, dateTo >= hari ini)
  remaining: number;
}

interface TypeLite {
  id: string; code: string; name: string; unit: string; entitlement: number;
  maxPerRequest: number; paid: boolean; cashable: boolean; periodMode: string;
  prorateMonthly: boolean; carryOverMax: number; waitingMonths: number;
  allowAdvance: boolean; allowHalfDay: boolean; active: boolean;
}

/** Hitung bagian dinamis saldo: earned/taken/applied/forfeited/remaining. */
function computeParts(
  balance: { year: number; carriedOver: number; adjustment: number; cashed: number },
  type: TypeLite,
  employee: { joinDate: Date },
  requests: { workingDays: number; dateTo: Date }[],
  asOf: Date,
): Pick<BalanceRow, "earned" | "forfeited" | "taken" | "applied" | "remaining"> {
  const win = periodWindow(type, employee, balance.year);
  const from = employee.joinDate > win.validFrom ? employee.joinDate : win.validFrom;
  const earned = type.prorateMonthly
    ? (type.entitlement * earnedMonths(from, employee.joinDate, asOf)) / 12
    : type.entitlement;
  // carry-over hangus setelah 31 Des tahun periode (padanan "Carry Over Forfeiture 31-12")
  const forfeitDate = new Date(balance.year, 11, 31, 23, 59, 59);
  const forfeited = balance.carriedOver > 0 && asOf > forfeitDate ? balance.carriedOver : 0;
  let taken = 0;
  let applied = 0;
  for (const r of requests) {
    if (dayStart(r.dateTo) < dayStart(asOf)) taken += r.workingDays;
    else applied += r.workingDays;
  }
  const remaining =
    balance.carriedOver + earned + balance.adjustment - forfeited - balance.cashed - taken - applied;
  return { earned: round2(earned), forfeited: round2(forfeited), taken: round2(taken), applied: round2(applied), remaining: round2(remaining) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Baris saldo semua karyawan (filter per karyawan / jenis / tahun). */
export async function listBalances(
  db: TenantDb,
  filter: { employeeId?: string; leaveTypeId?: string; year?: number; leaveTypeCode?: string } = {},
): Promise<BalanceRow[]> {
  const asOf = new Date();
  const balances = await db.leaveBalance.findMany({
    where: {
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.leaveTypeId ? { leaveTypeId: filter.leaveTypeId } : {}),
      ...(filter.year ? { year: filter.year } : {}),
    },
    include: {
      employee: {
        select: {
          id: true, employeeNo: true, fullName: true, joinDate: true, status: true,
          assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
        },
      },
      leaveType: true,
    },
    orderBy: [{ employee: { employeeNo: "asc" } }, { leaveType: { code: "asc" } }],
  });
  const filtered = filter.leaveTypeCode
    ? balances.filter((b) => b.leaveType.code === filter.leaveTypeCode)
    : balances;
  const reqs = await db.leaveRequest.findMany({
    where: { status: { in: ["Approved", "MassLeave"] } },
    select: { employeeId: true, leaveTypeId: true, year: true, workingDays: true, dateTo: true },
  });
  const reqMap = new Map<string, { workingDays: number; dateTo: Date }[]>();
  for (const r of reqs) {
    const key = `${r.employeeId}|${r.leaveTypeId}|${r.year}`;
    const arr = reqMap.get(key) ?? [];
    arr.push(r);
    reqMap.set(key, arr);
  }

  return filtered
    .filter((b) => b.employee.status === "Active")
    .map((b) => {
      const type = b.leaveType as unknown as TypeLite;
      const parts = computeParts(
        b, type, b.employee,
        reqMap.get(`${b.employeeId}|${b.leaveTypeId}|${b.year}`) ?? [],
        asOf,
      );
      const win = periodWindow(type, b.employee, b.year);
      return {
        balanceId: b.id, employeeId: b.employeeId, employeeNo: b.employee.employeeNo,
        fullName: b.employee.fullName, orgUnitName: b.employee.assignments[0]?.orgUnit?.name ?? null,
        leaveTypeId: b.leaveTypeId, leaveTypeCode: b.leaveType.code, leaveTypeName: b.leaveType.name,
        unit: b.leaveType.unit, paid: b.leaveType.paid, cashable: b.leaveType.cashable,
        year: b.year, periodLabel: win.label, validFrom: win.validFrom, validTo: win.validTo,
        entitlement: b.leaveType.entitlement,
        maxPerRequest: b.leaveType.maxPerRequest > 0 ? b.leaveType.maxPerRequest : b.leaveType.entitlement,
        carriedOver: round2(b.carriedOver), adjustment: round2(b.adjustment), cashed: round2(b.cashed),
        ...parts,
      };
    });
}

/** Saldo satu karyawan×jenis×tahun (auto-buat bila belum ada). */
async function ensureBalance(
  db: TenantDb,
  employeeId: string,
  type: TypeLite,
  year: number,
): Promise<{ id: string; year: number; carriedOver: number; adjustment: number; cashed: number }> {
  const existing = await db.leaveBalance.findUnique({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } },
  });
  if (existing) return existing;
  return db.leaveBalance.create({
    data: { employeeId, leaveTypeId: type.id, year, note: "auto-generated dari permintaan" },
  });
}

// ============ generate leave information (padanan GenerateLeaveInfoProcess) ============

export interface GenerateResult {
  year: number;
  employees: number;
  types: number;
  rows: number; // baris saldo dibuat
  updated: number; // carry-over diperbarui
  carryTotal: number; // total hari bawa
  skipped: string[];
}

export async function generateLeaveInfo(
  db: TenantDb,
  input: { year: number; leaveTypeId?: string; employeeIds?: string[] },
): Promise<GenerateResult> {
  const types = (await db.leaveType.findMany({
    where: { active: true, ...(input.leaveTypeId ? { id: input.leaveTypeId } : {}) },
  })) as unknown as TypeLite[];
  const employees = await db.employee.findMany({
    where: { status: "Active", ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}) },
    select: { id: true, employeeNo: true, fullName: true, joinDate: true },
    orderBy: { employeeNo: "asc" },
  });
  if (types.length === 0) throw new Error("Tidak ada jenis cuti aktif");
  if (employees.length === 0) throw new Error("Tidak ada karyawan aktif");

  const asOf = new Date();
  let rows = 0;
  let updated = 0;
  let carryTotal = 0;
  const skipped: string[] = [];

  // request tahun lalu & tahun ini utk hitung saldo periode sebelumnya
  const prevYear = input.year - 1;
  const reqs = await db.leaveRequest.findMany({
    where: { year: { in: [prevYear, input.year] }, status: { in: ["Approved", "MassLeave"] } },
    select: { employeeId: true, leaveTypeId: true, year: true, workingDays: true, dateTo: true },
  });
  const reqMap = new Map<string, { workingDays: number; dateTo: Date }[]>();
  for (const r of reqs) {
    const key = `${r.employeeId}|${r.leaveTypeId}|${r.year}`;
    const arr = reqMap.get(key) ?? [];
    arr.push(r);
    reqMap.set(key, arr);
  }
  const prevBalances = await db.leaveBalance.findMany({ where: { year: prevYear } });
  const prevMap = new Map(prevBalances.map((b) => [`${b.employeeId}|${b.leaveTypeId}`, b]));

  for (const emp of employees) {
    for (const type of types) {
      // jenis non-tahunan (waiting/event-based) tetap digenerate — saldo seragam
      const prev = prevMap.get(`${emp.id}|${type.id}`);
      let carry = 0;
      if (prev) {
        const parts = computeParts(
          prev, type, emp,
          reqMap.get(`${emp.id}|${type.id}|${prevYear}`) ?? [],
          // posisi akhir tahun lalu: 31 Des prevYear
          new Date(prevYear, 11, 31, 23, 59, 59),
        );
        carry = Math.max(0, Math.min(parts.remaining, type.carryOverMax));
      }
      const existing = await db.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: type.id, year: input.year } },
      });
      if (existing) {
        if (existing.carriedOver !== carry) {
          await db.leaveBalance.update({
            where: { id: existing.id },
            data: { carriedOver: round2(carry) },
          });
          updated++;
        }
      } else {
        await db.leaveBalance.create({
          data: { employeeId: emp.id, leaveTypeId: type.id, year: input.year, carriedOver: round2(carry) },
        });
        rows++;
      }
      carryTotal += carry;
    }
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "LeaveGenerate", entityId: String(input.year),
      detail: `Generate Leave Information ${input.year}: ${rows} baris baru, ${updated} carry-over diperbarui, total bawa ${round2(carryTotal)} hari`,
    },
  });

  return { year: input.year, employees: employees.length, types: types.length, rows, updated, carryTotal: round2(carryTotal), skipped };
}

// ============ leave adjustment (padanan LeaveAdjustment + GenerateLeaveAdjustment) ============

export async function adjustBalance(
  db: TenantDb,
  input: { employeeId: string; leaveTypeId: string; year: number; delta: number; reason: string },
): Promise<{ adjustment: number }> {
  if (!input.reason?.trim()) throw new Error("Alasan penyesuaian wajib diisi");
  if (input.delta === 0) throw new Error("Nilai penyesuaian tidak boleh 0");
  const type = await db.leaveType.findUnique({ where: { id: input.leaveTypeId } });
  if (!type) throw new Error("Jenis cuti tidak ditemukan");
  const balance = await ensureBalance(db, input.employeeId, type as unknown as TypeLite, input.year);
  const updated = await db.leaveBalance.update({
    where: { id: balance.id },
    data: { adjustment: round2(balance.adjustment + input.delta), note: input.reason.slice(0, 200) },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "LeaveAdjustment", entityId: balance.id,
      detail: `Penyesuaian saldo ${type.code} ${input.year}: ${input.delta > 0 ? "+" : ""}${input.delta} hari — ${input.reason}`,
    },
  });
  return { adjustment: updated.adjustment };
}

// ============ hitung hari permintaan (padanan Number of Working Applied) ============

export interface RequestCalc {
  workingDays: number;
  backToWork: Date | null;
  backToWorkSession: "AM" | "PM";
  skippedDates: string[];
}

/** Hitung hari kerja terpakai dari rentang + sesi AM/PM; hari off/libur dilewati. */
export async function calculateRequestDays(
  db: TenantDb,
  employeeId: string,
  from: Date,
  sessionFrom: "AM" | "PM",
  to: Date,
  sessionTo: "AM" | "PM",
): Promise<RequestCalc> {
  const start = dayStart(from);
  const end = dayStart(to);
  if (end < start) throw new Error("Tanggal selesai sebelum tanggal mulai");
  if (end.getTime() === start.getTime() && sessionFrom === "PM" && sessionTo === "AM") {
    throw new Error("Kombinasi sesi tidak valid (PM → AM pada hari yang sama)");
  }
  let days = 0;
  const skippedDates: string[] = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (await isWorkday(db, employeeId, d)) days += 1;
    else skippedDates.push(fmtDateISO(d));
  }
  if (sessionFrom === "PM" && days > 0) days -= 0.5;
  if (sessionTo === "AM" && days > 0) days -= 0.5;
  days = Math.max(0, round2(days));

  // hari kerja kembali: sesi AM hari kerja berikutnya (atau PM hari yang sama bila setengah hari terakhir)
  let backToWork: Date | null = null;
  let backToWorkSession: "AM" | "PM" = "AM";
  if (sessionTo === "AM" && await isWorkday(db, employeeId, end)) {
    backToWork = end;
    backToWorkSession = "PM";
  } else {
    for (let d = addDays(end, 1); d <= addDays(end, 30); d = addDays(d, 1)) {
      if (await isWorkday(db, employeeId, d)) { backToWork = d; backToWorkSession = "AM"; break; }
    }
  }
  return { workingDays: days, backToWork, backToWorkSession, skippedDates };
}

// ============ leave request (padanan LeaveRequest.jsp) ============

export interface SubmitRequestInput {
  employeeId: string;
  leaveTypeId: string;
  dateFrom: string; // YYYY-MM-DD
  sessionFrom: "AM" | "PM";
  dateTo: string;
  sessionTo: "AM" | "PM";
  reason: string;
  note?: string;
  source?: string; // Admin|ESS
}

export interface SubmitRequestResult {
  docNo: string;
  workingDays: number;
  remaining: number;
  backToWork: string | null;
}

/** Nomor dokumen berikutnya per prefix (LR/ML/LE) — max-suffix, bukan count+1,
 *  supaya aman bila ada baris terhapus. ML menggabung header MassLeave + baris
 *  permintaan (sub-rows ML-…-001). */
async function nextDocNo(db: TenantDb, prefix: "LR" | "ML" | "LE"): Promise<string> {
  const year = new Date().getFullYear();
  const start = `${prefix}-${year}-`;
  let max = 0;
  const bump = (rows: { docNo: string }[]) => {
    for (const r of rows) {
      const n = parseInt(r.docNo.slice(start.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  };
  if (prefix === "LE") {
    bump(await db.leaveEncashment.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } }));
  } else {
    bump(await db.leaveRequest.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } }));
    if (prefix === "ML") {
      bump(await db.massLeave.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } }));
    }
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

async function activeSalary(db: TenantDb, employeeId: string): Promise<number> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } },
  });
  return emp?.assignments[0]?.baseSalary ?? 0;
}

export async function previewRequest(
  db: TenantDb,
  input: Pick<SubmitRequestInput, "employeeId" | "leaveTypeId" | "dateFrom" | "sessionFrom" | "dateTo" | "sessionTo">,
): Promise<{
  workingDays: number;
  balance: number;
  remaining: number;
  backToWork: string | null;
  maxPerRequest: number;
  unit: string;
  waitingMonths: number;
  allowAdvance: boolean;
  periodLabel: string;
}> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const type = (await db.leaveType.findUnique({ where: { id: input.leaveTypeId } })) as unknown as TypeLite | null;
  if (!type || !type.active) throw new Error("Jenis cuti tidak ditemukan / tidak aktif");

  const from = dayStart(new Date(input.dateFrom));
  const to = dayStart(new Date(input.dateTo));
  const calc = await calculateRequestDays(db, input.employeeId, from, input.sessionFrom, to, input.sessionTo);
  const year = yearForDate(type, emp, from);
  const balance = await ensureBalance(db, input.employeeId, type, year);
  const [row] = await listBalances(db, { employeeId: input.employeeId, leaveTypeId: type.id, year });
  const current = row?.remaining ?? 0;
  return {
    workingDays: calc.workingDays,
    balance: current,
    remaining: round2(current - calc.workingDays),
    backToWork: calc.backToWork ? iso(calc.backToWork) : null,
    maxPerRequest: type.maxPerRequest > 0 ? type.maxPerRequest : type.entitlement,
    unit: type.unit,
    waitingMonths: type.waitingMonths,
    allowAdvance: type.allowAdvance,
    periodLabel: periodWindow(type, emp, year).label,
  };
}

export async function submitRequest(db: TenantDb, input: SubmitRequestInput): Promise<SubmitRequestResult> {
  if (!input.reason?.trim()) throw new Error("Alasan cuti wajib diisi");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const type = (await db.leaveType.findUnique({ where: { id: input.leaveTypeId } })) as unknown as TypeLite | null;
  if (!type || !type.active) throw new Error("Jenis cuti tidak ditemukan / tidak aktif");

  const from = dayStart(new Date(input.dateFrom));
  const to = dayStart(new Date(input.dateTo));
  const asOf = new Date();

  // masa kerja minimum (waiting period — padanan "takeable after 6 months")
  if (type.waitingMonths > 0 && monthsInService(emp.joinDate, asOf) < type.waitingMonths) {
    throw new Error(`Cuti ${type.name} baru bisa diambil setelah ${type.waitingMonths} bulan masa kerja (saat ini ${monthsInService(emp.joinDate, asOf)} bulan)`);
  }
  // half-day
  if (!type.allowHalfDay && (input.sessionFrom === "PM" || input.sessionTo === "AM")) {
    throw new Error(`Cuti ${type.name} tidak mengizinkan setengah hari`);
  }

  const calc = await calculateRequestDays(db, input.employeeId, from, input.sessionFrom, to, input.sessionTo);
  if (calc.workingDays <= 0) throw new Error("Rentang tanggal tidak memuat hari kerja");

  // maksimum per permintaan
  const maxPer = type.maxPerRequest > 0 ? type.maxPerRequest : type.entitlement;
  if (calc.workingDays > maxPer) {
    throw new Error(`Maksimum ${maxPer} ${type.unit === "MONTH" ? "bulan" : "hari"} per permintaan untuk ${type.name}`);
  }

  // bentrok dengan permintaan lain (belum ditolak/dibatalkan)
  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId: input.employeeId,
      status: { in: ["Submitted", "Approved", "MassLeave"] },
      dateFrom: { lte: to },
      dateTo: { gte: from },
    },
  });
  if (overlap) throw new Error(`Bentrok dengan permintaan ${overlap.docNo} (${fmtDate(overlap.dateFrom)} – ${fmtDate(overlap.dateTo)})`);

  // saldo
  const year = yearForDate(type, emp, from);
  const balance = await ensureBalance(db, input.employeeId, type, year);
  const [row] = await listBalances(db, { employeeId: input.employeeId, leaveTypeId: type.id, year });
  const current = row?.remaining ?? 0;
  const remaining = round2(current - calc.workingDays);
  if (remaining < 0 && !type.allowAdvance) {
    throw new Error(`Saldo tidak cukup: ${current} ${type.unit === "MONTH" ? "bulan" : "hari"}, diminta ${calc.workingDays}. Advance leave tidak diizinkan untuk ${type.name}`);
  }

  const docNo = await nextDocNo(db, "LR");
  await db.leaveRequest.create({
    data: {
      docNo, employeeId: input.employeeId, leaveTypeId: type.id, year,
      requestDate: asOf, dateFrom: from, sessionFrom: input.sessionFrom,
      dateTo: to, sessionTo: input.sessionTo,
      workingDays: calc.workingDays,
      balanceAtRequest: current, remainingAtRequest: remaining,
      backToWorkDate: calc.backToWork,
      status: "Submitted", source: input.source ?? "Admin",
      reason: input.reason.trim(), note: input.note?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "LeaveRequest", entityId: docNo,
      detail: `${docNo}: ${emp.fullName} — ${type.name} ${fmtDate(from)} → ${fmtDate(to)} (${calc.workingDays} hari)`,
    },
  });
  return {
    docNo, workingDays: calc.workingDays, remaining,
    backToWork: calc.backToWork ? iso(calc.backToWork) : null,
  };
}

export interface RequestRow {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeName: string; leaveTypeCode: string; paid: boolean;
  year: number; requestDate: Date; dateFrom: Date; sessionFrom: string;
  dateTo: Date; sessionTo: string; workingDays: number;
  balanceAtRequest: number; remainingAtRequest: number; backToWorkDate: Date | null;
  status: string; source: string; reason: string | null; note: string | null;
  decisionNote: string | null; decidedAt: Date | null;
}

export async function listRequests(
  db: TenantDb,
  filter: { status?: string; employeeId?: string; year?: number; limit?: number } = {},
): Promise<RequestRow[]> {
  const rows = await db.leaveRequest.findMany({
    where: {
      ...(filter.status && filter.status !== "all" ? { status: filter.status } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.year ? { year: filter.year } : {}),
    },
    include: {
      employee: {
        select: {
          employeeNo: true, fullName: true,
          assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
        },
      },
      leaveType: { select: { name: true, code: true, paid: true } },
    },
    orderBy: [{ requestDate: "desc" }, { docNo: "desc" }],
    take: filter.limit ?? 500,
  });
  return rows.map((r) => ({
    id: r.id, docNo: r.docNo, employeeId: r.employeeId, employeeNo: r.employee.employeeNo,
    fullName: r.employee.fullName, orgUnitName: r.employee.assignments[0]?.orgUnit?.name ?? null,
    leaveTypeName: r.leaveType.name, leaveTypeCode: r.leaveType.code, paid: r.leaveType.paid,
    year: r.year, requestDate: r.requestDate, dateFrom: r.dateFrom, sessionFrom: r.sessionFrom,
    dateTo: r.dateTo, sessionTo: r.sessionTo, workingDays: r.workingDays,
    balanceAtRequest: r.balanceAtRequest, remainingAtRequest: r.remainingAtRequest,
    backToWorkDate: r.backToWorkDate, status: r.status, source: r.source,
    reason: r.reason, note: r.note, decisionNote: r.decisionNote, decidedAt: r.decidedAt,
  }));
}

// ============ approval (padanan LeaveRequestToApprove: Approve|Reject|Cancel) ============

export async function decideRequest(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string; actorId?: string },
): Promise<{ docNo: string; status: string; regeneratedDays: number }> {
  const req = await db.leaveRequest.findUnique({ where: { id: input.id }, include: { leaveType: true, employee: true } });
  if (!req) throw new Error("Permintaan tidak ditemukan");
  if (req.status !== "Submitted") throw new Error(`Permintaan sudah berstatus ${req.status}`);

  const status = input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Cancelled";
  await db.leaveRequest.update({
    where: { id: input.id },
    data: {
      status,
      decidedById: input.actorId ?? null,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    },
  });

  // hitung ulang rekap kehadiran rentang cuti (status OnLeave masuk/keluar)
  let regeneratedDays = 0;
  const from = dayStart(req.dateFrom);
  const to = dayStart(req.dateTo);
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const { regenerateDaily } = await import("@/onevity/time-attendance/services/attendance-service");
    await regenerateDaily(db, d, req.employeeId);
    regeneratedDays++;
  }

  await db.activityLog.create({
    data: {
      action: status === "Approved" ? "Approved" : status === "Rejected" ? "Rejected" : "Cancelled",
      entity: "LeaveRequest", entityId: req.docNo,
      detail: `${req.docNo} (${req.employee.fullName}, ${req.leaveType.name}) → ${status}${input.note ? ` — ${input.note}` : ""}`,
    },
  });
  return { docNo: req.docNo, status, regeneratedDays };
}

// ============ mass leave (padanan MassLeave.jsp — SKB cuti bersama) ============

export interface MassLeaveInput {
  leaveTypeId: string;
  letterNo?: string;
  dateFrom: string;
  dateTo: string;
  amount?: number; // hari per tanggal (umumnya 1)
  orgUnitName?: string; // kosong = semua
  excludeNonWorking?: boolean;
  excludeConflicted?: boolean;
  note?: string;
  createdBy?: string;
}

export interface MassLeaveResult {
  docNo: string;
  employees: number;
  generated: number;
  skippedConflict: number;
  skippedBalance: number;
  totalDays: number;
}

export async function createMassLeave(db: TenantDb, input: MassLeaveInput): Promise<MassLeaveResult> {
  const type = (await db.leaveType.findUnique({ where: { id: input.leaveTypeId } })) as unknown as TypeLite | null;
  if (!type || !type.active) throw new Error("Jenis cuti tidak ditemukan / tidak aktif");
  const from = dayStart(new Date(input.dateFrom));
  const to = dayStart(new Date(input.dateTo));
  if (to < from) throw new Error("Tanggal selesai sebelum tanggal mulai");
  const amount = input.amount && input.amount > 0 ? input.amount : 1;

  // kandidat: karyawan aktif, opsional filter org (prefix utk include sub-org)
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    include: { assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } },
    orderBy: { employeeNo: "asc" },
  });
  const targets = employees.filter((e) => {
    if (!input.orgUnitName) return true;
    const org = e.assignments[0]?.orgUnit?.name ?? "";
    return org === input.orgUnitName || org.startsWith(input.orgUnitName);
  });

  // tanggal efektif: hanya hari kerja bila excludeNonWorking (per karyawan —
  // operator rotasi & non-clocking bisa beda; union utk jumlah tanggal)
  const allDates = new Set<string>();
  const perEmpDates = new Map<string, string[]>();
  for (const emp of targets) {
    const set: string[] = [];
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      if (input.excludeNonWorking === false || (await isWorkday(db, emp.id, d))) {
        set.push(fmtDateISO(d));
        allDates.add(fmtDateISO(d));
      }
    }
    perEmpDates.set(emp.id, set);
  }
  const dates = [...allDates].sort().map((s) => new Date(s + "T00:00:00"));
  if (dates.length === 0) throw new Error("Rentang tidak memuat hari kerja bagi karyawan mana pun");

  const year = yearForDate(type, { joinDate: new Date() }, from);
  let generated = 0;
  let skippedConflict = 0;
  let skippedBalance = 0;
  let totalDays = 0;

  const docNo = await nextDocNo(db, "ML");
  for (const emp of targets) {
    const empDatesArr = (perEmpDates.get(emp.id) ?? []).sort().map((s) => new Date(s + "T00:00:00"));
    if (empDatesArr.length === 0) continue;
    const empFrom = dayStart(empDatesArr[0]!);
    const empTo = dayStart(empDatesArr[empDatesArr.length - 1]!);
    const days = round2(empDatesArr.length * amount);

    // bentrok?
    if (input.excludeConflicted !== false) {
      const overlap = await db.leaveRequest.findFirst({
        where: {
          employeeId: emp.id, status: { in: ["Submitted", "Approved", "MassLeave"] },
          dateFrom: { lte: empTo }, dateTo: { gte: empFrom },
        },
      });
      if (overlap) { skippedConflict++; continue; }
    }

    // saldo (advance tidak diizinkan utk massal)
    const empYear = yearForDate(type, emp, empFrom);
    await ensureBalance(db, emp.id, type, empYear);
    const [row] = await listBalances(db, { employeeId: emp.id, leaveTypeId: type.id, year: empYear });
    const current = row?.remaining ?? 0;
    if (current - days < 0) { skippedBalance++; continue; }

    const seq = generated + 1;
    await db.leaveRequest.create({
      data: {
        docNo: `${docNo}-${String(seq).padStart(3, "0")}`,
        employeeId: emp.id, leaveTypeId: type.id, year: empYear,
        requestDate: new Date(),
        dateFrom: empFrom, sessionFrom: "AM",
        dateTo: empTo, sessionTo: "PM",
        workingDays: days, balanceAtRequest: current, remainingAtRequest: round2(current - days),
        backToWorkDate: null,
        status: "MassLeave", source: "MassLeave",
        reason: input.note?.trim() || `Cuti massal ${docNo}`,
        note: input.letterNo ? `No surat: ${input.letterNo}` : null,
      },
    });
    generated++;
    totalDays += days;
  }

  await db.massLeave.create({
    data: {
      docNo, leaveTypeId: type.id, letterNo: input.letterNo?.trim() || null,
      dateFrom: from, dateTo: to, amount,
      orgUnitName: input.orgUnitName || null,
      includeSubOrg: true,
      excludeNonWorking: input.excludeNonWorking !== false,
      excludeConflicted: input.excludeConflicted !== false,
      note: input.note?.trim() || null, generated, createdBy: input.createdBy || null,
    },
  });

  // rekap kehadiran rentang (OnLeave)
  const { regenerateDaily } = await import("@/onevity/time-attendance/services/attendance-service");
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    await regenerateDaily(db, d);
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MassLeave", entityId: docNo,
      detail: `Cuti massal ${docNo}: ${generated}/${targets.length} karyawan × ${dates.length} tanggal (${round2(totalDays)} hari) — ${input.note ?? ""}`,
    },
  });
  return { docNo, employees: targets.length, generated, skippedConflict, skippedBalance, totalDays: round2(totalDays) };
}

export async function listMassLeaves(db: TenantDb) {
  const rows = await db.massLeave.findMany({
    include: { leaveType: { select: { name: true, code: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((m) => ({
    id: m.id, docNo: m.docNo, leaveTypeName: m.leaveType.name, letterNo: m.letterNo,
    dateFrom: m.dateFrom, dateTo: m.dateTo, amount: m.amount, orgUnitName: m.orgUnitName,
    excludeNonWorking: m.excludeNonWorking, excludeConflicted: m.excludeConflicted,
    note: m.note, generated: m.generated, createdAt: m.createdAt,
  }));
}

// ============ encashment (padanan LeaveEncashment + Employee Leave Cashable) ============

export async function submitEncashment(
  db: TenantDb,
  input: { employeeId: string; leaveTypeId: string; year: number; days: number; paymentDate?: string; note?: string },
): Promise<{ docNo: string; amount: number; remaining: number }> {
  const type = (await db.leaveType.findUnique({ where: { id: input.leaveTypeId } })) as unknown as TypeLite | null;
  if (!type || !type.active) throw new Error("Jenis cuti tidak ditemukan / tidak aktif");
  if (!type.cashable) throw new Error(`Cuti ${type.name} tidak dapat diuangkan (Balance Cashable = tidak)`);
  if (input.days <= 0) throw new Error("Jumlah hari diuangkan harus lebih dari 0");
  const [row] = await listBalances(db, { employeeId: input.employeeId, leaveTypeId: type.id, year: input.year });
  if (!row) throw new Error("Saldo belum digenerate untuk periode ini");
  if (input.days > row.remaining) {
    throw new Error(`Saldo tidak cukup: tersedia ${row.remaining} ${type.unit === "MONTH" ? "bulan" : "hari"}`);
  }
  const salary = await activeSalary(db, input.employeeId);
  const amount = Math.round((input.days * salary) / 25); // upah harian = gpokok/25
  const docNo = await nextDocNo(db, "LE");
  await db.leaveEncashment.create({
    data: {
      docNo, employeeId: input.employeeId, leaveTypeId: type.id, year: input.year,
      requestDate: new Date(),
      paymentDate: input.paymentDate ? new Date(input.paymentDate) : null,
      days: input.days, amount,
      status: "Submitted", note: input.note?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "LeaveEncashment", entityId: docNo,
      detail: `${docNo}: ${input.days} hari cuti diuangkan (≈ ${amount})`,
    },
  });
  return { docNo, amount, remaining: round2(row.remaining - input.days) };
}

export async function decideEncashment(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string; actorId?: string },
): Promise<{ docNo: string; status: string }> {
  const enc = await db.leaveEncashment.findUnique({ where: { id: input.id }, include: { leaveType: true } });
  if (!enc) throw new Error("Data encashment tidak ditemukan");
  if (enc.status !== "Submitted") throw new Error(`Encashment sudah berstatus ${enc.status}`);

  const status = input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Cancelled";
  await db.leaveEncashment.update({
    where: { id: input.id },
    data: {
      status, decidedById: input.actorId ?? null, decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    },
  });
  if (status === "Approved") {
    // saldo cashed bertambah (kolom e)
    const balance = await db.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: enc.employeeId, leaveTypeId: enc.leaveTypeId, year: enc.year } },
    });
    if (balance) {
      await db.leaveBalance.update({
        where: { id: balance.id },
        data: { cashed: round2(balance.cashed + enc.days) },
      });
    }
  }
  await db.activityLog.create({
    data: {
      action: status === "Approved" ? "Approved" : status === "Rejected" ? "Rejected" : "Cancelled",
      entity: "LeaveEncashment", entityId: enc.docNo,
      detail: `${enc.docNo} (${enc.days} hari) → ${status}`,
    },
  });
  return { docNo: enc.docNo, status };
}

export async function listEncashments(
  db: TenantDb,
  filter: { status?: string } = {},
): Promise<
  {
    id: string; docNo: string; employeeNo: string; fullName: string; leaveTypeName: string;
    year: number; requestDate: Date; paymentDate: Date | null; days: number; amount: number;
    status: string; periodCode: string | null; transferredRunNo: string | null; note: string | null;
    decisionNote: string | null;
  }[]
> {
  const rows = await db.leaveEncashment.findMany({
    where: filter.status && filter.status !== "all" ? { status: filter.status } : {},
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      leaveType: { select: { name: true } },
    },
    orderBy: { requestDate: "desc" },
    take: 300,
  });
  return rows.map((e) => ({
    id: e.id, docNo: e.docNo, employeeNo: e.employee.employeeNo, fullName: e.employee.fullName,
    leaveTypeName: e.leaveType.name, year: e.year, requestDate: e.requestDate, paymentDate: e.paymentDate,
    days: e.days, amount: e.amount, status: e.status, periodCode: e.periodCode,
    transferredRunNo: e.transferredRunNo, note: e.note, decisionNote: e.decisionNote,
  }));
}

// ============ transfer ke payroll (padanan EmpLeaveCashable.jsp) ============

export interface EncashTransferResult {
  periodName: string;
  employees: number;
  rows: number;
  totalAmount: number;
  removed: number;
}

/** Encashment Approved (paymentDate dalam period) → komponen Specific UCT.
 *  Idempoten: assignment UCT periode ini dibuang lalu ditulis ulang. */
export async function transferEncashment(
  db: TenantDb,
  input: { periodId: string; processTypeCode?: string },
): Promise<EncashTransferResult> {
  const period = await db.payrollPeriod.findUnique({ where: { id: input.periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");
  if (period.status === "Locked" || period.status === "Closed") {
    throw new Error("Period sudah ditutup/terkunci — pilih period lain");
  }
  const ptCode = input.processTypeCode ?? "SALARY";
  const pt = await db.processType.findFirst({ where: { code: ptCode } });
  if (!pt) throw new Error(`Process type ${ptCode} tidak ditemukan`);
  const comp = await db.wageComponent.findUnique({ where: { code: "UCT" } });
  if (!comp) throw new Error("Komponen upah UCT belum didefinisikan (hubungi admin)");

  const start = dayStart(period.startDate);
  const end = dayStart(addDays(period.endDate, 1));
  const encs = await db.leaveEncashment.findMany({
    where: {
      status: { in: ["Approved", "Transferred"] },
      OR: [
        { paymentDate: { gte: start, lt: end } },
        { paymentDate: null, requestDate: { gte: start, lt: end } },
      ],
    },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
  });
  if (encs.length === 0) throw new Error("Tidak ada encashment Approved dengan payment date dalam period ini");

  // idempoten: buang assignment UCT lama period ini
  const removed = await db.employeeComponentAssignment.deleteMany({
    where: { kind: "Specific", periodId: period.id, processTypeId: pt.id, wageComponentId: comp.id },
  });

  const employees = new Set<string>();
  let total = 0;
  for (const e of encs) {
    const salary = await activeSalary(db, e.employeeId);
    const amount = Math.round((e.days * salary) / 25);
    await db.employeeComponentAssignment.create({
      data: {
        employeeId: e.employeeId, wageComponentId: comp.id,
        kind: "Specific", amount,
        periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
        notes: `Uang pengganti cuti ${e.docNo} — ${e.days} hari × upah harian`,
        active: true,
      },
    });
    employees.add(e.employeeId);
    total += amount;
    await db.leaveEncashment.update({
      where: { id: e.id },
      data: { status: "Transferred", periodCode: period.code },
    });
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "LeaveTransfer", entityId: period.id,
      detail: `Transfer uang pengganti cuti → ${period.name}: ${employees.size} karyawan, ${encs.length} baris, total ${total}`,
    },
  });
  return { periodName: period.name, employees: employees.size, rows: encs.length, totalAmount: total, removed: removed.count };
}

/** Dipanggil confirmRun(): encashment Transferred period run SALARY → Paid. */
export async function markEncashmentPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run || run.processType.code !== "SALARY") return 0;
  const res = await db.leaveEncashment.updateMany({
    where: {
      status: "Transferred",
      OR: [
        { paymentDate: { gte: run.period.startDate, lte: run.period.endDate } },
        { paymentDate: null, requestDate: { gte: run.period.startDate, lte: run.period.endDate } },
      ],
    },
    data: { status: "Paid", transferredRunNo: run.runNo },
  });
  if (res.count > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "LeaveEncashment", entityId: runId,
        detail: `${res.count} encashment cuti ditandai Dibayar via run ${run.runNo} (${run.period.name})`,
      },
    });
  }
  return res.count;
}

// ============ query & laporan ============

/** Siapa yang sedang/akan cuti pada rentang (padanan Query - Employee on Leave). */
export async function listOnLeave(db: TenantDb, from: Date, to: Date) {
  const start = dayStart(from);
  const end = dayStart(addDays(to, 1));
  const rows = await db.leaveRequest.findMany({
    where: { status: { in: ["Approved", "MassLeave"] }, dateFrom: { lt: end }, dateTo: { gte: start } },
    include: {
      employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
      leaveType: { select: { name: true, paid: true } },
    },
    orderBy: [{ dateFrom: "asc" }, { employee: { employeeNo: "asc" } }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id, docNo: r.docNo, employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
    orgUnitName: r.employee.assignments[0]?.orgUnit?.name ?? null,
    leaveTypeName: r.leaveType.name, paid: r.leaveType.paid,
    dateFrom: r.dateFrom, sessionFrom: r.sessionFrom, dateTo: r.dateTo, sessionTo: r.sessionTo,
    workingDays: r.workingDays, status: r.status, reason: r.reason,
  }));
}

/** Ringkasan penggunaan per jenis (padanan History - Summary Based on Leave Type). */
export async function typeUsageSummary(db: TenantDb, year: number) {
  const balances = await db.leaveBalance.findMany({
    where: { year },
    include: { leaveType: { select: { name: true, code: true, unit: true } } },
  });
  const requests = await db.leaveRequest.findMany({
    where: { year, status: { in: ["Approved", "MassLeave"] } },
    select: { leaveTypeId: true, workingDays: true },
  });
  const reqAgg = new Map<string, number>();
  for (const r of requests) reqAgg.set(r.leaveTypeId, (reqAgg.get(r.leaveTypeId) ?? 0) + r.workingDays);
  const byType = new Map<string, { code: string; name: string; unit: string; employees: number; carried: number; taken: number }>();
  for (const b of balances) {
    const cur = byType.get(b.leaveTypeId) ?? {
      code: b.leaveType.code, name: b.leaveType.name, unit: b.leaveType.unit,
      employees: 0, carried: 0, taken: 0,
    };
    cur.employees++;
    cur.carried += b.carriedOver;
    byType.set(b.leaveTypeId, cur);
  }
  return [...byType.entries()].map(([id, v]) => ({
    leaveTypeId: id, code: v.code, name: v.name, unit: v.unit,
    employees: v.employees,
    carriedOver: round2(v.carried),
    taken: round2(reqAgg.get(id) ?? 0),
  })).sort((a, b) => b.taken - a.taken || a.code.localeCompare(b.code));
}

// ============ overview (KPI ringkasan modul) ============

export async function leaveStats(db: TenantDb) {
  const now = new Date();
  const year = now.getFullYear();
  const [activeEmployees, pendingRequests, massLeaves, pendingEnc, types] = await Promise.all([
    db.employee.count({ where: { status: "Active" } }),
    db.leaveRequest.count({ where: { status: "Submitted" } }),
    db.leaveRequest.count({ where: { status: "MassLeave" } }),
    db.leaveEncashment.count({ where: { status: "Submitted" } }),
    db.leaveType.count({ where: { active: true } }),
  ]);
  const balances = await db.leaveBalance.findMany({
    where: { year },
    include: { leaveType: { select: { code: true, entitlement: true, prorateMonthly: true, periodMode: true } } },
  });
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, joinDate: true },
  });
  const empJoin = new Map(employees.map((e) => [e.id, e.joinDate]));
  const reqs = await db.leaveRequest.findMany({
    where: { year, status: { in: ["Approved", "MassLeave"] } },
    select: { employeeId: true, leaveTypeId: true, year: true, workingDays: true, dateTo: true },
  });
  const reqMap = new Map<string, { workingDays: number; dateTo: Date }[]>();
  for (const r of reqs) {
    const key = `${r.employeeId}|${r.leaveTypeId}|${r.year}`;
    const arr = reqMap.get(key) ?? [];
    arr.push(r);
    reqMap.set(key, arr);
  }
  let annualRemaining = 0;
  let annualCount = 0;
  for (const b of balances) {
    if (b.leaveType.code !== "CT-THN") continue;
    const join = empJoin.get(b.employeeId);
    if (!join) continue;
    const t = { ...b.leaveType, periodMode: b.leaveType.periodMode } as unknown as TypeLite;
    const parts = computeParts(b, t, { joinDate: join }, reqMap.get(`${b.employeeId}|${b.leaveTypeId}|${b.year}`) ?? [], now);
    annualRemaining += parts.remaining;
    annualCount++;
  }

  // yang sedang cuti hari ini
  const today = dayStart(now);
  const onLeaveToday = await db.leaveRequest.count({
    where: { status: { in: ["Approved", "MassLeave"] }, dateFrom: { lte: today }, dateTo: { gte: today } },
  });
  // akan cuti 30 hari ke depan
  const in30 = await db.leaveRequest.count({
    where: {
      status: { in: ["Approved", "MassLeave"] },
      dateFrom: { gte: today, lte: addDays(today, 30) },
    },
  });
  const approvedThisYear = await db.leaveRequest.count({
    where: { status: { in: ["Approved", "MassLeave"] }, requestDate: { gte: new Date(year, 0, 1) } },
  });
  const encTransferred = await db.leaveEncashment.count({
    where: { status: { in: ["Transferred", "Paid"] } },
  });

  return {
    year, activeEmployees, types,
    pendingRequests, pendingEnc, massLeaves,
    onLeaveToday, upcoming30: in30, approvedThisYear, encTransferred,
    avgAnnualRemaining: annualCount > 0 ? round2(annualRemaining / annualCount) : 0,
  };
}
