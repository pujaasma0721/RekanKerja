// OneVity Attendance Service (ref: ANALISA-ATTENDANCE.md — modul Time Attendance).
// Engine inti: resolusi day type per karyawan (jadwal cycle + anchor) → rekap harian
// (hour buckets: telat/pulang cepat/kerja normal/absen) dari clock log → lembur
// (Plan → Actual → Verified, multiplier PP 35/2021) → Transfer to Payroll
// (rekap period → komponen Specific LEMBUR/TLATE/TABS/TKEHADIRAN, idempoten).
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import {
  startApprovalChain, decideApprovalChain, getApprovalChain, cancelApprovalChain,
  type DecideActor,
} from "@/onevity/shared/services/approval-engine";

// ============ utilitas waktu (semua Date = waktu lokal) ============

export function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86_400_000);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** "08:30" + tanggal dasar → Date; nextDay → +1 hari. */
export function atTime(hhmm: string, base: Date, nextDay = false): Date {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  const d = dayStart(base);
  d.setHours(h || 0, m || 0, 0, 0);
  if (nextDay) d.setDate(d.getDate() + 1);
  return d;
}

/** Pembulatan menit ke kelipatan (ke bawah). */
export function floorToMultiple(minutes: number, multiple: number): number {
  if (multiple <= 1) return Math.max(0, Math.round(minutes));
  return Math.max(0, Math.floor(minutes / multiple) * multiple);
}

// ============ resolusi jadwal (padanan Employee Schedule Assignment) ============

/** Info hari libur (T9-HOLIDAY) — overlay dari tabel HolidayDate. */
export interface HolidayInfo {
  id: string;
  /** YYYY-MM-DD (lokal) */
  date: string;
  name: string;
  /** National|Joint (cuti bersama)|Company */
  kind: string;
}

interface ResolvedSchedule {
  assignment: { id: string; clockingRequired: boolean; scheduleId: string };
  dayType: {
    id: string; code: string; name: string; color: string; category: string;
    timeIn: string | null; timeOut: string | null; nextDay: boolean;
    breakMinutes: number; normalMinutes: number;
    toleranceLateMinutes: number; toleranceEarlyMinutes: number; flexible: boolean;
  } | null;
  /**
   * T9-HOLIDAY: tanggal terdaftar di kalender libur → day type efektif adalah
   * HOLIDAY sintetis (kategori "Holiday") dan holiday berisi info kalender.
   * Prioritas: tanggal libur > cycle jadwal. null = bukan hari libur.
   */
  holiday: HolidayInfo | null;
}

/** Warna sel libur (kalender/matriks) — merah bata, beda dari OFF mingguan. */
export const HOLIDAY_COLOR = "#F87171";

/** Cari hari libur yang jatuh pada tanggal tsb (bila beberapa, National dulu). */
export async function holidayOn(db: TenantDb, date: Date): Promise<HolidayInfo | null> {
  try {
    const h = await db.holidayDate.findFirst({
      where: { date: { gte: dayStart(date), lt: addDays(dayStart(date), 1) } },
      orderBy: [{ kind: "desc" }, { name: "asc" }], // National > Joint > Company
    });
    if (!h) return null;
    const d = dayStart(h.date);
    return {
      id: h.id,
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      name: h.name,
      kind: h.kind,
    };
  } catch {
    return null; // schema tenant belum termigrasi — overlay libur mati anggun
  }
}


/** Assignment jadwal aktif pada tanggal tsb (validFrom ≤ date ≤ validTo). */
async function assignmentFor(db: TenantDb, employeeId: string, date: Date) {
  const list = await db.scheduleAssignment.findMany({
    where: {
      employeeId,
      // T5-TA-FIX (D-5, off-by-one): assignment sah utk rekap tanggal D adalah
      // validFrom ≤ D (dulu: ≤ D+1 — assignment yang baru efektif BESOK ikut
      // menaungi rekap hari ini). validTo tetap null/≥ D.
      validFrom: { lte: dayStart(date) },
      OR: [{ validTo: null }, { validTo: { gte: dayStart(date) } }],
    },
    orderBy: { validFrom: "desc" },
    take: 1,
    include: { schedule: { include: { days: true } } },
  });
  return list[0] ?? null;
}

/**
 * Resolusi day type efektif karyawan pada tanggal — padanan "Employee Clocking:
 * resolve day type efektif". Cycle di-anchor ke anchorMonday/anchorSequence.
 * Tidak ada assignment / sequence tidak terdaftar → null (hari tanpa jadwal).
 *
 * T9-HOLIDAY — overlay kalender libur: tanggal yang terdaftar di HolidayDate
 * MENANG atas cycle jadwal → day type efektif kategori "Holiday" (multiplier
 * lembur PP 35: 2×/3×/4×; hari kerja cuti melewati hari libur). Jam standar
 * kantor (08:00-17:00/480') dipakai acuan durasi bila lembur menutup hari.
 */
export async function resolveDayType(db: TenantDb, employeeId: string, date: Date): Promise<ResolvedSchedule> {
  // 1) overlay libur — cek DULU, prioritas di atas jadwal
  const holiday = await holidayOn(db, date);
  if (holiday) {
    const a = await assignmentFor(db, employeeId, date);
    return {
      assignment: a
        ? { id: a.id, clockingRequired: a.clockingRequired, scheduleId: a.scheduleId }
        : { id: "", clockingRequired: true, scheduleId: "" },
      dayType: {
        // id sintetis "HOLIDAY" — BUKAN baris WorkDayType (jangan ditulis ke
        // AttendanceDaily.dayTypeId; consumers membaca holiday utk identitas).
        id: "HOLIDAY",
        code: "HOLIDAY",
        name: holiday.name,
        color: HOLIDAY_COLOR,
        category: "Holiday",
        timeIn: null,
        timeOut: null,
        nextDay: false,
        breakMinutes: 0,
        normalMinutes: 0,
        toleranceLateMinutes: 0,
        toleranceEarlyMinutes: 0,
        flexible: false,
      },
      holiday,
    };
  }

  const a = await assignmentFor(db, employeeId, date);
  if (!a) return { assignment: { id: "", clockingRequired: true, scheduleId: "" }, dayType: null, holiday: null };

  const cycle = a.schedule.days;
  if (cycle.length === 0) return { assignment: a, dayType: null, holiday: null };

  // sequence efektif: offset hari dari anchor, diputar dalam cycle
  const offset = diffDays(a.anchorMonday, date);
  const idx = ((offset + (a.anchorSequence - 1)) % cycle.length + cycle.length) % cycle.length;
  const seq = cycle.reduce((best, d) => (d.sequence < best.sequence ? d : best), cycle[0]!).sequence + idx;
  const day = cycle.find((d) => d.sequence === seq) ?? cycle.find((d) => d.sequence === idx + 1);
  if (!day) return { assignment: a, dayType: null, holiday: null };

  const dt = await db.workDayType.findUnique({ where: { id: day.dayTypeId } });
  if (!dt || !dt.active) return { assignment: a, dayType: null, holiday: null };
  return {
    assignment: a,
    dayType: {
      id: dt.id, code: dt.code, name: dt.name, color: dt.color, category: dt.category,
      timeIn: dt.timeIn, timeOut: dt.timeOut, nextDay: dt.nextDay,
      breakMinutes: dt.breakMinutes, normalMinutes: dt.normalMinutes,
      toleranceLateMinutes: dt.toleranceLateMinutes, toleranceEarlyMinutes: dt.toleranceEarlyMinutes,
      flexible: dt.flexible,
    },
    holiday: null,
  };
}

// ============ aturan singleton (padanan Overtime Specified + Rounding) ============

export async function getRule(db: TenantDb) {
  // T5-TA-FIX: findFirst dgn orderBy deterministik — sandbox MII ternyata
  // memuat 2 baris AttendanceRule (race seed lama) dan findFirst tanpa orderBy
  // bisa mengembalikan baris BERBEDA per koneksi → "rule tersimpan tapi engine
  // memakai row lain" (gejala plasebo D-6). OrderBy stabil → settings PATCH
  // dan engine selalu sepakat baris yang sama. (Baris duplikat sandbox dibersihkan
  // saat uji T5; provisioning baru membuat 1 baris.)
  const rule = await db.attendanceRule.findFirst({ orderBy: { id: "asc" } });
  if (rule) return rule;
  return db.attendanceRule.create({ data: {} });
}

// ============ rekap harian (padanan "Refresh Clocking" → Employee Clocking) ============

interface WorkoffCoverage {
  paid: boolean | null; // null = tidak ada izin
  half: boolean; // setengah hari
}

async function workoffFor(db: TenantDb, employeeId: string, date: Date): Promise<WorkoffCoverage> {
  const start = dayStart(date);
  const end = addDays(start, 1);
  const rows = await db.workOffPermission.findMany({
    where: {
      employeeId,
      status: "Approved",
      dateFrom: { lt: end },
      dateTo: { gte: start },
    },
    orderBy: { dateFrom: "desc" },
  });
  const w = rows[0];
  if (!w) return { paid: null, half: false };
  return { paid: w.paid, half: !w.allDay };
}

// Cuti efektif pada tanggal (modul Leave): request Approved/MassLeave menutup hari —
// padanan Absence Code per jenis cuti. Setengah hari: sesi PM di tanggal mulai
// atau sesi AM di tanggal selesai.
interface LeaveCoverage {
  typeName: string;
  paid: boolean;
  half: boolean;
}

async function leaveFor(db: TenantDb, employeeId: string, date: Date): Promise<LeaveCoverage | null> {
  const start = dayStart(date);
  const end = addDays(start, 1);
  const rows = await db.leaveRequest.findMany({
    where: {
      employeeId,
      status: { in: ["Approved", "MassLeave"] },
      // T5-TA-FIX (WorkOff.deductLeave): request potongan OTOMATIS dari izin
      // tidak masuk (source "WorkOff") tidak dihitung sebagai cuti di rekap
      // harian — hari tsb tetap ditutup oleh WorkOffPermission (status WorkOff)
      // supaya regen konsisten (audit 1c).
      source: { not: "WorkOff" },
      dateFrom: { lt: end },
      dateTo: { gte: start },
    },
    orderBy: [{ status: "asc" }, { dateFrom: "desc" }],
    include: { leaveType: { select: { name: true, paid: true } } },
  });
  const r = rows[0];
  if (!r) return null;
  const isFrom = r.dateFrom.getTime() === start.getTime();
  const isTo = r.dateTo.getTime() === start.getTime();
  let half = false;
  if (isFrom && r.sessionFrom === "PM") half = true;
  if (isTo && r.sessionTo === "AM") half = true;
  return { typeName: r.leaveType.name, paid: r.leaveType.paid, half };
}

export interface DailyRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  workDate: Date;
  dayTypeCode: string | null;
  dayTypeName: string | null;
  dayTypeColor: string | null;
  dayCategory: string | null;
  status: string;
  presence: number;
  checkIn: Date | null;
  checkOut: Date | null;
  lateMinutes: number;
  earlyMinutes: number;
  workMinutes: number;
  normalMinutes: number;
  absenceMinutes: number;
  overtimeMinutes: number;
  clockingRequired: boolean;
  notes: string | null;
}

const DAILY_INCLUDE = {
  employee: {
    select: {
      id: true, employeeNo: true, fullName: true, status: true,
      assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 },
    },
  },
} as const;

/** Ambil rekap harian satu tanggal (join employee + day type). */
export async function listDaily(db: TenantDb, date: Date, employeeId?: string): Promise<DailyRow[]> {
  const start = dayStart(date);
  const end = addDays(start, 1);
  const rows = await db.attendanceDaily.findMany({
    where: { workDate: { gte: start, lt: end }, ...(employeeId ? { employeeId } : {}) },
    include: DAILY_INCLUDE,
    orderBy: { employee: { employeeNo: "asc" } },
  });
  const dayTypes = await db.workDayType.findMany();
  const dtById = new Map(dayTypes.map((d) => [d.id, d]));
  return rows.map((r) => {
    const dt = r.dayTypeId ? dtById.get(r.dayTypeId) : undefined;
    return {
      employeeId: r.employee.id,
      employeeNo: r.employee.employeeNo,
      fullName: r.employee.fullName,
      orgUnitName: r.employee.assignments[0]?.orgUnit?.name ?? null,
      workDate: r.workDate,
      dayTypeCode: dt?.code ?? null,
      dayTypeName: dt?.name ?? null,
      dayTypeColor: dt?.color ?? null,
      dayCategory: dt?.category ?? null,
      status: r.status,
      presence: r.presence,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      lateMinutes: r.lateMinutes,
      earlyMinutes: r.earlyMinutes,
      workMinutes: r.workMinutes,
      normalMinutes: r.normalMinutes,
      absenceMinutes: r.absenceMinutes,
      overtimeMinutes: r.overtimeMinutes,
      clockingRequired: true,
      notes: r.notes,
    };
  });
}

/**
 * Hitung ulang rekap satu tanggal — padanan "Refresh Clocking":
 * clock log (IN pertama → OUT terakhir, window sampai tengah hari berikutnya utk
 * shift malam) + toleransi day type + izin work off + lembur terverifikasi.
 * Idempoten: upsert per (employee, workDate).
 */
export async function regenerateDaily(db: TenantDb, date: Date, employeeId?: string): Promise<number> {
  const rule = await getRule(db);
  const start = dayStart(date);
  const winEnd = addDays(start, 2); // window clock: [00:00 tgl, 00:00 tgl+2)
  const dayEnd = addDays(start, 1);

  const employees = await db.employee.findMany({
    where: { status: "Active", ...(employeeId ? { id: employeeId } : {}) },
    select: { id: true, employeeNo: true, fullName: true },
    orderBy: { employeeNo: "asc" },
  });
  if (employees.length === 0) return 0;

  const logs = await db.attendanceClockLog.findMany({
    where: { timestamp: { gte: start, lt: winEnd } },
    orderBy: { timestamp: "asc" },
  });
  const logsByEmp = new Map<string, typeof logs>();
  for (const l of logs) {
    const arr = logsByEmp.get(l.employeeId) ?? [];
    arr.push(l);
    logsByEmp.set(l.employeeId, arr);
  }

  const otOrders = await db.overtimeOrder.findMany({
    where: { overtimeDate: { gte: start, lt: dayEnd }, status: { in: ["Approved", "Paid"] } },
  });
  // catatan: display harian boleh memuat lembur Paid (histori jam kerja); jalur
  // UANG (recapPeriod/transfer) memakai filter paidRunNo null — lihat fix K-1 di bawah.
  const otByEmp = new Map<string, typeof otOrders>();
  for (const o of otOrders) {
    const arr = otByEmp.get(o.employeeId) ?? [];
    arr.push(o);
    otByEmp.set(o.employeeId, arr);
  }

  let count = 0;
  for (const emp of employees) {
    const { assignment, dayType, holiday } = await resolveDayType(db, emp.id, date);
    // Fix K-2: clock-in tetap dibatasi hari tsb (nextDay: hingga D+1), namun clock-out
    // kini sah hingga 10 jam SETELAH jam pulang jadwal — menangkap clock-out lewat
    // tengah malam pada tipe hari non-lintas-hari (dulu dibuang → karyawan dianggap
    // Absen penuh padahal hadir + lembur). Batas atas juga mencegah tipe nextDay
    // memakai OUT milik shift sore hari berikutnya (workMinutes menggelembung).
    // Hari tanpa jam jadwal (off/tanpa assignment): batas = clock-in + 16 jam
    // (setara cap kerja 960 menit).
    const empLogs = logsByEmp.get(emp.id) ?? [];
    const checkIn = empLogs.find((l) => l.direction === "IN" && (l.timestamp < dayEnd || dayType?.nextDay === true))?.timestamp ?? null;
    const schedOut = dayType?.timeOut ? atTime(dayType.timeOut, date, dayType.nextDay) : null;
    let outLimit: Date | null = null;
    if (schedOut && (!checkIn || schedOut > checkIn)) {
      outLimit = new Date(schedOut.getTime() + 10 * 3_600_000);
    } else if (checkIn) {
      outLimit = new Date(checkIn.getTime() + 16 * 3_600_000);
    }
    const checkOutRaw = checkIn && outLimit
      ? [...empLogs].reverse().find((l) => l.direction === "OUT" && l.timestamp > checkIn && l.timestamp <= outLimit)?.timestamp ?? null
      : null;

    const wo = await workoffFor(db, emp.id, date);
    const lv = await leaveFor(db, emp.id, date);
    const target = dayType?.normalMinutes ?? 0;
    // T9-HOLIDAY: kategori "Holiday" (overlay kalender libur) = hari TIDAK kerja —
    // konsisten dgn isWorkday (hitungan hari cuti melewati hari libur nasional);
    // karyawan tanpa clock di hari libur tidak dihitung Absen (dulu: Absen penuh).
    const isOffDay = !dayType || dayType.category === "Off" || dayType.category === "Holiday";
    const clockingRequired = assignment?.clockingRequired ?? true;

    let status: string;
    let presence = 0;
    let lateMinutes = 0;
    let earlyMinutes = 0;
    let workMinutes = 0;
    let normalMinutes = 0;
    let absenceMinutes = 0;
    let notes: string | null = null;
    // T5-TA-FIX (D-7): klasifikasi berbayar eksplisit — diisi saat regen dari
    // WorkOffPermission.paid (status WorkOff) / LeaveType.paid (status OnLeave);
    // null utk status lain (baris lama belum ter-regen → recapPeriod fallback notes).
    let paidFlag: boolean | null = null;

    if (isOffDay) {
      if (checkIn && checkOutRaw) {
        // bekerja pada hari off/libur — hadir (lembur hari libur via work order)
        status = "Present";
        presence = 1;
        workMinutes = Math.min(960, minutesBetween(checkIn, checkOutRaw));
        normalMinutes = 0;
        notes = holiday ? `Bekerja pada hari libur — ${holiday.name}` : "Bekerja pada hari off";
      } else {
        status = "Off";
        // T9-HOLIDAY: catat nama libur — terlihat di rekap harian & fallback tampilan
        notes = holiday
          ? `Libur ${holiday.kind === "Joint" ? "bersama" : holiday.kind === "Company" ? "perusahaan" : "nasional"} — ${holiday.name}`
          : null;
      }
    } else if (lv) {
      // Cuti (Approved/MassLeave) menutup hari kerja — padanan Absence Code.
      status = "OnLeave";
      paidFlag = lv.paid;
      if (lv.paid) {
        normalMinutes = lv.half ? Math.floor(target / 2) : target;
        absenceMinutes = lv.half ? Math.ceil(target / 2) : 0;
        notes = lv.half ? `Cuti ${lv.typeName} (setengah hari, dibayar)` : `Cuti ${lv.typeName} (dibayar)`;
      } else {
        normalMinutes = 0;
        absenceMinutes = lv.half ? Math.ceil(target / 2) : target;
        notes = lv.half ? `Cuti ${lv.typeName} (setengah hari, tidak dibayar)` : `Cuti ${lv.typeName} (tidak dibayar)`;
      }
    } else if (wo.paid !== null) {
      // Izin tidak masuk (work off permission) menutup hari — padanan.
      status = "WorkOff";
      paidFlag = wo.paid;
      if (wo.paid) {
        normalMinutes = wo.half ? Math.floor(target / 2) : target;
        absenceMinutes = wo.half ? Math.ceil(target / 2) : 0;
        notes = wo.half ? "Izin setengah hari (dibayar)" : "Izin dibayar penuh";
      } else {
        normalMinutes = 0;
        absenceMinutes = wo.half ? Math.ceil(target / 2) : target;
        notes = wo.half ? "Izin setengah hari (tidak dibayar)" : "Izin tidak dibayar";
      }
    } else if (isOffDay) {
      if (checkIn && checkOutRaw) {
        // bekerja pada hari off — hadir (lembur hari libur via work order)
        status = "Present";
        presence = 1;
        workMinutes = Math.min(960, minutesBetween(checkIn, checkOutRaw));
        normalMinutes = 0;
        notes = "Bekerja pada hari off";
      } else {
        status = "Off";
      }
    } else if (!clockingRequired) {
      // T5-TA-FIX (D-6c): AttendanceRule.nonClockingPolicy dieksekusi —
      // - AssumeNormal (default, perilaku lama): hadir tanpa menit kerja
      //   ("jam dianggap normal" — status Present, workMinutes/normalMinutes 0);
      // - ByDays: karyawan non-clocking dihitung HADIR PENUH per hari assignment
      //   (presence=1, normalMinutes = durasi shift penuh);
      // - ByHours: workMinutes dihitung dari jam day type tanpa clock
      //   (workMinutes = normalMinutes = jam shift).
      if (rule.nonClockingPolicy === "ByDays") {
        status = "Present";
        presence = 1;
        normalMinutes = target;
        notes = "Non-clocking (ByDays) — hadir penuh per hari assignment";
      } else if (rule.nonClockingPolicy === "ByHours") {
        status = "Present";
        presence = 1;
        workMinutes = target;
        normalMinutes = Math.min(workMinutes, target);
        notes = `Non-clocking (ByHours) — dihitung ${(Math.round((target / 60) * 10) / 10)} jam dari jadwal`;
      } else {
        status = "Present";
        notes = "Non-clocking — jam dianggap normal";
      }
    } else if (!checkIn || !checkOutRaw) {
      status = "Absent";
      absenceMinutes = target;
      notes = checkIn ? "Tanpa clock-out" : "Tanpa clock-in";
    } else {
      presence = 1;
      workMinutes = Math.min(960, minutesBetween(checkIn, checkOutRaw));
      const schedIn = dayType!.timeIn ? atTime(dayType!.timeIn, date) : null;
      const schedOut = dayType!.timeOut ? atTime(dayType!.timeOut, date, dayType!.nextDay) : null;
      if (schedIn) {
        lateMinutes = floorToMultiple(minutesBetween(schedIn, checkIn) - dayType!.toleranceLateMinutes, rule.roundingMinutes);
      }
      if (dayType!.flexible) {
        // T5-TA-FIX (D-6b): day type FLEKSIBEL — telat tetap clockIn > jam masuk
        // jadwal + toleransi (window fleksibel); namun jam pulang jadwal TIDAK
        // mengikat — "pulang cepat" dihitung dari durasi shift wajib (target)
        // yang tidak tuntas: early = target − workMinutes.
        earlyMinutes = floorToMultiple(Math.max(0, target - workMinutes), rule.roundingMinutes);
      } else if (schedOut) {
        earlyMinutes = floorToMultiple(minutesBetween(checkOutRaw, schedOut) - dayType!.toleranceEarlyMinutes, rule.roundingMinutes);
      }
      normalMinutes = Math.min(workMinutes, target);
      absenceMinutes = Math.max(0, target - workMinutes);
      status = lateMinutes > 0 ? "Late" : "Present";
    }

    // lembur terverifikasi hari ini (status Approved / Paid)
    const ot = otByEmp.get(emp.id) ?? [];
    const overtimeMinutes = ot.reduce((s, o) => s + (o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes), 0);

    await db.attendanceDaily.upsert({
      where: { employeeId_workDate: { employeeId: emp.id, workDate: start } },
      create: {
        employeeId: emp.id, workDate: start,
        // T9-HOLIDAY: dayTypeId sintetis "HOLIDAY" bukan baris WorkDayType (FK) —
        // identitas libur dibaca dari notes; baris tetap tercatat utk histori.
        dayTypeId: holiday ? null : (dayType?.id ?? null),
        state: "Calculated", status, presence,
        checkIn, checkOut: checkOutRaw,
        lateMinutes, earlyMinutes, workMinutes, normalMinutes, absenceMinutes,
        overtimeMinutes, paidFlag, notes,
      },
      update: {
        dayTypeId: holiday ? null : (dayType?.id ?? null), state: "Calculated", status, presence,
        checkIn, checkOut: checkOutRaw,
        lateMinutes, earlyMinutes, workMinutes, normalMinutes, absenceMinutes,
        overtimeMinutes, paidFlag, notes, revised: false, revisedBy: null,
      },
    });
    count++;
  }
  return count;
}

export async function regenerateRange(db: TenantDb, from: Date, to: Date): Promise<number> {
  let total = 0;
  for (let d = dayStart(from); d <= dayStart(to); d = addDays(d, 1)) {
    total += await regenerateDaily(db, d);
  }
  return total;
}

// ============ upah lembur (PP 35/2021 + KEP-102: 1/173 upah bulanan) ============

/**
 * Upah lembur — mengikuti regulasi Indonesia:
 * - Weekday (hari kerja): jam ke-1 = 1,5×; jam berikutnya = 2×
 * - Weekend (hari istirahat mingguan): 8 jam pertama = 2×; setelahnya = 3×
 * - Holiday (libur nasional, PP 35/2021 Pasal 28): 7 jam pertama = 2×,
 *   jam ke-8 = 3×, jam ke-9 dst = 4× (fix M-1 — dulu 2×/3×/4× pada jam 1-5/6-7/8+)
 * upah sejam = 1/173 × upah bulanan; perhitungan per interval 30 menit.
 *
 * T5-TA-FIX (D-6a — rule plasebo): parameter aturan AttendanceRule dieksekusi —
 * - minMinutes (rule.minOvertimeMinutes, default 30): menit di bawah ambang
 *   tidak dibayar (lembur 25 menit tidak menghasilkan upah);
 * - rounding (rule.overtimeRoundingMinutes, default 30): menit dibulatkan KE
 *   ATAS ke kelipatan interval, upah dihitung per blok interval (default blok
 *   30 menit = perilaku lama; interval 15/30/60 = pembagi 60 → multiplier jam
 *   eksak pada batas jam).
 * Pemanggil lama tanpa opts → perilaku default 30/30 (kompatibel).
 */
export interface OvertimePayOptions {
  /** interval pembulatan menit lembur — rule.overtimeRoundingMinutes (default 30) */
  roundingMinutes?: number;
  /** ambang minimum menit agar lembur dibayar — rule.minOvertimeMinutes (default 30) */
  minMinutes?: number;
}

export function overtimePayFor(baseSalary: number, minutes: number, dayCategory: string, opts: OvertimePayOptions = {}): number {
  const rounding = Math.max(1, Math.round(opts.roundingMinutes ?? 30));
  const minMinutes = Math.max(0, Math.round(opts.minMinutes ?? 30));
  if (minutes <= 0 || baseSalary <= 0) return 0;
  if (minutes < minMinutes) return 0; // ambang minimum — di bawah ini tidak dibayar
  const paidMinutes = Math.ceil(minutes / rounding) * rounding; // pembulatan ke atas ke interval
  const hourly = baseSalary / 173;
  let pay = 0;
  for (let m = 0; m < paidMinutes; m += rounding) {
    const hourIndex = Math.floor(m / 60) + 1; // jam ke-berapa (1-based) pembuka blok
    let multiplier: number;
    if (dayCategory === "Weekend") multiplier = hourIndex <= 8 ? 2 : 3;
    else if (dayCategory === "Holiday") multiplier = hourIndex <= 7 ? 2 : hourIndex === 8 ? 3 : 4;
    else multiplier = hourIndex === 1 ? 1.5 : 2;
    pay += hourly * multiplier * (rounding / 60);
  }
  return Math.round(pay);
}

// ============ rekap period (padanan Query - Employee Attendance/Absence/Tidiness) ============

export interface RecapRow {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  baseSalary: number;
  scheduledDays: number; // hari kerja terjadwal dalam window
  presentDays: number;
  lateCount: number;
  lateMinutes: number;
  absentDays: number;
  absenceMinutes: number;
  workoffPaidDays: number;
  workoffUnpaidDays: number;
  leavePaidDays: number;
  leaveUnpaidDays: number;
  offDays: number;
  normalMinutes: number;
  overtimeMinutes: number;
  overtimePay: number;
  lateDeduction: number;
  absenceDeduction: number;
  attendanceAllowance: number;
}

export async function recapPeriod(db: TenantDb, from: Date, to: Date, employeeId?: string): Promise<RecapRow[]> {
  const rule = await getRule(db);
  const start = dayStart(from);
  const end = dayStart(addDays(to, 1));

  const rows = await db.attendanceDaily.findMany({
    where: { workDate: { gte: start, lt: end }, ...(employeeId ? { employeeId } : {}) },
    include: DAILY_INCLUDE,
    orderBy: { employee: { employeeNo: "asc" } },
  });
  const employees = await db.employee.findMany({
    where: { status: "Active", ...(employeeId ? { id: employeeId } : {}) },
    include: { assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 } },
    orderBy: { employeeNo: "asc" },
  });
  // Fix K-1: hanya order Approved yang BELUM dibayar (paidRunNo null) yang ikut
  // rekap uang/transfer — order Paid tidak boleh dihitung lagi di window berikutnya
  // (double-pay). Display jam (AttendanceDaily.overtimeMinutes) tetap memuat Paid.
  const otOrders = await db.overtimeOrder.findMany({
    where: { overtimeDate: { gte: start, lt: end }, status: "Approved", paidRunNo: null },
  });
  const otByEmp = new Map<string, typeof otOrders>();
  for (const o of otOrders) {
    const arr = otByEmp.get(o.employeeId) ?? [];
    arr.push(o);
    otByEmp.set(o.employeeId, arr);
  }

  const byEmp = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byEmp.get(r.employeeId) ?? [];
    arr.push(r);
    byEmp.set(r.employeeId, arr);
  }

  const out: RecapRow[] = [];
  for (const emp of employees) {
    const empRows = byEmp.get(emp.id) ?? [];
    const baseSalary = emp.assignments[0]?.baseSalary ?? 0;
    const orgName = emp.assignments[0]?.orgUnit?.name ?? null;

    let presentDays = 0, lateCount = 0, lateMinutes = 0, absentDays = 0, absenceMinutes = 0;
    let workoffPaid = 0, workoffUnpaid = 0, offDays = 0, normalMinutes = 0, overtimeMinutes = 0;
    let leavePaid = 0, leaveUnpaid = 0;
    let scheduledDays = 0;
    for (const r of empRows) {
      switch (r.status) {
        case "Present": presentDays++; scheduledDays++; break;
        case "Late": presentDays++; lateCount++; scheduledDays++; break;
        case "Absent": absentDays++; scheduledDays++; break;
        case "OnLeave":
          // T5-TA-FIX (D-7): klasifikasi berbayar dari kolom paidFlag (regen
          // mengisi dari LeaveType.paid); baris lama belum ter-regen (paidFlag
          // null) → fallback notes "tidak dibayar" (perilaku lama).
          if (r.paidFlag === false || (r.paidFlag === null && r.notes?.includes("tidak dibayar"))) leaveUnpaid++;
          else leavePaid++;
          scheduledDays++;
          break;
        case "WorkOff":
          // T5-TA-FIX (D-7): sama — paidFlag dari WorkOffPermission.paid,
          // fallback notes utk baris lama.
          if (r.paidFlag === false || (r.paidFlag === null && r.notes?.includes("tidak dibayar"))) workoffUnpaid++;
          else workoffPaid++;
          scheduledDays++;
          break;
        case "Off": offDays++; break;
        default: break;
      }
      lateMinutes += r.lateMinutes;
      absenceMinutes += r.absenceMinutes;
      normalMinutes += r.normalMinutes;
      overtimeMinutes += r.overtimeMinutes;
    }

    const hourly = baseSalary / 173;
    const lateDeduction = Math.round((lateMinutes / 60) * (rule.lateDeductionPerHour > 0 ? rule.lateDeductionPerHour : hourly));
    const perDay = rule.absenceDeductionPerDay > 0 ? rule.absenceDeductionPerDay : baseSalary / 25;
    const absenceDeduction = Math.round((absentDays + workoffUnpaid + leaveUnpaid) * perDay);
    const otPay = (otByEmp.get(emp.id) ?? []).reduce(
      (s, o) => s + overtimePayFor(
        baseSalary, o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes, o.dayCategory,
        // T5-TA-FIX (D-6a): rekap uang memakai rule (minimum + rounding), bukan
        // hardcode 30 menit — konsisten dgn tampilan estimasi API overtime.
        { roundingMinutes: rule.overtimeRoundingMinutes, minMinutes: rule.minOvertimeMinutes },
      ),
      0,
    );
    const perfect = scheduledDays > 0 && lateCount === 0 && absentDays === 0 && workoffUnpaid === 0 && leaveUnpaid === 0 &&
      presentDays + workoffPaid + leavePaid === scheduledDays;
    const attendanceAllowance = perfect ? rule.attendanceAllowanceAmount : 0;

    out.push({
      employeeId: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName, orgUnitName: orgName,
      baseSalary, scheduledDays, presentDays, lateCount, lateMinutes,
      absentDays, absenceMinutes, workoffPaidDays: workoffPaid, workoffUnpaidDays: workoffUnpaid,
      leavePaidDays: leavePaid, leaveUnpaidDays: leaveUnpaid,
      offDays, normalMinutes, overtimeMinutes,
      overtimePay: otPay, lateDeduction, absenceDeduction, attendanceAllowance,
    });
  }
  return out;
}

// ============ transfer ke payroll (padanan /TransferPayroll.jsp — JEMBATAN) ============

export interface TransferInput {
  periodId: string;
  processTypeCode?: string; // default "SALARY"
  from?: Date; // opsional — default: jendela TA period (taStartDate/taEndDate), else rentang period
  to?: Date;
  includeOvertime?: boolean;
  includeLate?: boolean;
  includeAbsence?: boolean;
  includeAttendanceAllowance?: boolean;
  /** aktor sesi (requireMutator) untuk jejak ActivityLog — opsional. */
  actor?: { name: string; appUserId: string | null };
}

export interface TransferResult {
  employees: number;
  window: { from: string; to: string };
  components: { code: string; name: string; employees: number; amount: number }[];
  removed: number; // assignment lama dibuang (amount 0 / re-transfer)
}

/**
 * Rekap window → komponen gaji Specific (period × process type) — idempoten:
 * re-transfer mengganti nilai assignment lama (padanan "Override Existing Data").
 *
 * Fix M-4 (BPA M-5): jendela transfer divalidasi terhadap period —
 * 1. default window = jendela TA period (taStartDate/taEndDate) bila valid,
 *    else rentang startDate–endDate period;
 * 2. window wajib berada di dalam jendela absensi period tersebut (TA window bila
 *    di-set HR, else rentang period) — menutup mismatch window transfer vs period;
 * 3. window yang sama dengan transfer terakhir period tsb = re-transfer idempoten;
 *    window BERIRISAN dengan window terakhir yang sudah dipakai run terkonfirmasi
 *    period YANG SAMA → ditolak (anti hitung-ganda);
 * 4. window yang beririsan dengan window terakhir period LAIN → ditolak;
 * 5. window yang benar-benar ditransfer disimpan ke PayrollPeriod.taStartDate/taEndDate
 *    — dipakai markOvertimePaidForRun (fix K-3).
 */
export async function transferToPayroll(db: TenantDb, input: TransferInput): Promise<TransferResult> {
  const period = await db.payrollPeriod.findUnique({ where: { id: input.periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");
  if (period.status === "Locked" || period.status === "Closed") {
    throw new Error("Period sudah ditutup/terkunci — pilih period lain");
  }
  const ptCode = input.processTypeCode ?? "SALARY";
  const pt = await db.processType.findFirst({ where: { code: ptCode } });
  if (!pt) throw new Error(`Process type ${ptCode} tidak ditemukan`);

  // ---- resolusi & validasi jendela transfer (fix M-4) ----
  const taFrom = period.taStartDate ? dayStart(period.taStartDate) : null;
  const taTo = period.taEndDate ? dayStart(period.taEndDate) : null;
  const hasTaWindow = !!(taFrom && taTo && taFrom <= taTo);
  const periodFrom = dayStart(period.startDate);
  const periodTo = dayStart(period.endDate);
  const from = input.from ? dayStart(input.from) : hasTaWindow ? taFrom! : periodFrom;
  const to = input.to ? dayStart(input.to) : hasTaWindow ? taTo! : periodTo;
  if (to < from) throw new Error("Jendela absensi tidak valid — tanggal selesai sebelum tanggal mulai");
  const toEnd = dayStart(addDays(to, 1));

  const boundsFrom = hasTaWindow ? taFrom! : periodFrom;
  const boundsTo = hasTaWindow ? taTo! : periodTo;
  if (from < boundsFrom || to > boundsTo) {
    throw new Error(
      `Jendela absensi ${fmtDate(from)}–${fmtDate(to)} berada di luar jendela period ${period.name} (${fmtDate(boundsFrom)}–${fmtDate(boundsTo)})`,
    );
  }

  const sameWindow = !!(taFrom && taTo && from.getTime() === taFrom.getTime() && to.getTime() === taTo.getTime());
  if (!sameWindow) {
    // irisan dengan window terakhir period INI yang sudah dipakai run terkonfirmasi
    if (taFrom && taTo && taFrom <= taTo && from < dayStart(addDays(taTo, 1)) && taFrom < toEnd) {
      const confirmed = await db.payrollRun.findFirst({
        where: { periodId: period.id, status: { in: ["Confirmed", "Paid"] } },
        select: { runNo: true },
      });
      if (confirmed) {
        throw new Error(
          `Jendela ${fmtDate(from)}–${fmtDate(to)} beririsan dengan window ${fmtDate(taFrom)}–${fmtDate(taTo)} yang sudah dibayarkan (run ${confirmed.runNo}) — penolakan anti hitung-ganda`,
        );
      }
    }
    // irisan dengan window terakhir period LAIN → absensi/lembur bisa terhitung 2×
    const others = await db.payrollPeriod.findMany({
      where: { id: { not: period.id }, taStartDate: { not: null }, taEndDate: { not: null } },
      select: { name: true, taStartDate: true, taEndDate: true },
    });
    for (const p of others) {
      const oFrom = dayStart(p.taStartDate!);
      const oTo = dayStart(p.taEndDate!);
      if (oFrom > oTo) continue; // window legacy terbalik (seed lama) — tidak sah, diabaikan
      if (from < dayStart(addDays(oTo, 1)) && oFrom < toEnd) {
        throw new Error(
          `Jendela ${fmtDate(from)}–${fmtDate(to)} beririsan dengan window period ${p.name} (${fmtDate(oFrom)}–${fmtDate(oTo)}) yang sudah ditransfer — data bisa terhitung dua kali`,
        );
      }
    }
  }

  const rule = await getRule(db);
  const map: [string, string][] = [
    [rule.overtimeComponentCode, "LEMBUR"],
    [rule.lateDeductionComponentCode, "TLATE"],
    [rule.absenceDeductionComponentCode, "TABS"],
    [rule.attendanceAllowanceComponentCode, "TKEHADIRAN"],
  ];
  const comps = await db.wageComponent.findMany({ where: { code: { in: map.map(([c]) => c) } } });
  const compByCode = new Map(comps.map((c) => [c.code, c]));

  const includeOvertime = input.includeOvertime ?? true;
  const includeLate = input.includeLate ?? true;
  const includeAbsence = input.includeAbsence ?? true;
  const includeAllowance = input.includeAttendanceAllowance ?? true;

  const recap = await recapPeriod(db, from, to);

  // assignment Specific lama periode ini utk komponen absensi → dibuang (idempoten)
  const removed = await db.employeeComponentAssignment.deleteMany({
    where: {
      kind: "Specific", periodId: period.id, processTypeId: pt.id, active: true,
      wageComponentId: { in: comps.map((c) => c.id) },
    },
  });

  const agg = new Map<string, { compId: string; code: string; name: string; employees: number; amount: number }>();
  let employees = 0;

  for (const r of recap) {
    const amounts: [string, number, string][] = [
      [rule.overtimeComponentCode, includeOvertime ? r.overtimePay : 0, `Lembur ${Math.round(r.overtimeMinutes / 60)} jam`],
      [rule.lateDeductionComponentCode, includeLate ? r.lateDeduction : 0, `Telat ${r.lateCount}× (${Math.round(r.lateMinutes)} menit)`],
      [rule.absenceDeductionComponentCode, includeAbsence ? r.absenceDeduction : 0, `Absen ${r.absentDays} hari, izin tanpa upah ${r.workoffUnpaidDays + r.leaveUnpaidDays} hari`],
      [rule.attendanceAllowanceComponentCode, includeAllowance ? r.attendanceAllowance : 0, "Tunjangan kehadiran penuh (tanpa telat/absen)"],
    ];
    let any = false;
    for (const [code, amount, note] of amounts) {
      if (amount <= 0) continue;
      const comp = compByCode.get(code);
      if (!comp) continue;
      any = true;
      await db.employeeComponentAssignment.create({
        data: {
          employeeId: r.employeeId, wageComponentId: comp.id,
          kind: "Specific", amount: Math.round(amount),
          periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
          notes: `${note} · window ${fmtDate(from)}–${fmtDate(to)}`,
          active: true,
        },
      });
      const cur = agg.get(code) ?? { compId: comp.id, code, name: comp.name, employees: 0, amount: 0 };
      cur.employees++;
      cur.amount += Math.round(amount);
      agg.set(code, cur);
    }
    if (any) employees++;
  }

  // simpan window terakhir yang ditransfer — penanda utk markOvertimePaidForRun (K-3)
  // dan guard overlap transfer berikutnya (M-4)
  await db.payrollPeriod.update({
    where: { id: period.id },
    data: { taStartDate: from, taEndDate: to },
  });

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "AttendanceTransfer", entityId: period.id,
      appUserId: input.actor?.appUserId ?? null,
      detail: `Transfer absensi → payroll ${period.name} (${ptCode})${input.actor ? ` oleh ${input.actor.name}` : ""}: ${employees} karyawan, ${[...agg.values()].reduce((s, c) => s + c.employees, 0)} komponen, window ${fmtDate(from)}–${fmtDate(to)}`,
    },
  });

  return {
    employees,
    window: { from: fmtDate(from), to: fmtDate(to) },
    components: [...agg.values()].sort((a, b) => a.code.localeCompare(b.code)),
    removed: removed.count,
  };
}

/**
 * Dipanggil confirmRun(): tandai Paid HANYA order lembur yang benar-benar dibayar
 * di run tsb — fix K-3 (dulu: window period run, semua order Approved, tanpa cek
 * keberadaan item di run):
 * - hanya run SALARY (run non-SALARY tidak pernah menandai lembur Paid);
 * - window = window transfer terakhir period (taStartDate/taEndDate — ditulis
 *   transferToPayroll, fix M-4); fallback window period utk data lama;
 * - hanya karyawan yang punya item komponen lembur (mis. LEMBUR) di run tsb —
 *   order yang tidak termuat di run tidak ditandai;
 * - hanya order yang sudah Approved sebelum run dihitung (decidedAt ≤ calculatedAt).
 */
export async function markOvertimePaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true,
      processType: true,
      lines: { select: { employeeId: true, items: { select: { code: true } } } },
    },
  });
  if (!run || run.processType.code !== "SALARY") return 0;

  const rule = await getRule(db);
  const paidEmployees = run.lines
    .filter((l) => l.items.some((i) => i.code === rule.overtimeComponentCode))
    .map((l) => l.employeeId);
  if (paidEmployees.length === 0) return 0;

  // window yang benar-benar ditransfer (marker M-4); fallback window period (data lama)
  const taFrom = run.period.taStartDate;
  const taTo = run.period.taEndDate;
  const hasWindow = !!(taFrom && taTo && dayStart(taFrom) <= dayStart(taTo));
  const winFrom = dayStart(hasWindow ? (taFrom as Date) : run.period.startDate);
  const winTo = hasWindow ? dayStart(addDays(taTo as Date, 1)) : dayStart(addDays(run.period.endDate, 1));

  const res = await db.overtimeOrder.updateMany({
    where: {
      status: "Approved",
      overtimeDate: { gte: winFrom, lt: winTo },
      employeeId: { in: paidEmployees },
      // hanya order yang sudah disetujui sebelum run dihitung (pasti ikut snapshot)
      ...(run.calculatedAt
        ? { OR: [{ decidedAt: null }, { decidedAt: { lte: run.calculatedAt } }] }
        : {}),
    },
    data: { status: "Paid", paidRunNo: run.runNo },
  });
  if (res.count > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "OvertimeOrder", entityId: runId,
        detail: `${res.count} perintah lembur ditandai Dibayar via run ${run.runNo} (${run.period.name}, window ${fmtDate(winFrom)}–${fmtDate(hasWindow ? (taTo as Date) : run.period.endDate)})`,
      },
    });
  }
  return res.count;
}

// ============ clock log (input manual/web — padanan Temporary Employee Clocking) ============

export async function recordClockLog(
  db: TenantDb,
  input: { employeeId: string; timestamp: Date; direction: "IN" | "OUT"; source?: string; note?: string | null },
): Promise<void> {
  if (!input.employeeId) throw new Error("Karyawan wajib dipilih");
  if (input.direction !== "IN" && input.direction !== "OUT") throw new Error("Arah clock harus IN atau OUT");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  await db.attendanceClockLog.create({
    data: {
      employeeId: input.employeeId,
      timestamp: input.timestamp,
      direction: input.direction,
      source: input.source ?? "Manual",
      note: input.note?.trim() || null,
    },
  });
  await regenerateDaily(db, input.timestamp, input.employeeId);
}

// ============ lembur: order + approval (padanan EmpOvertimeWrit) ============

export async function nextOrderNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `OT-${year}-`;
  const count = await db.overtimeOrder.count({ where: { orderNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

const OT_INCLUDE = {
  employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } } },
} as const;

export async function submitOvertimeOrder(
  db: TenantDb,
  input: {
    employeeId: string; overtimeDate: string; timeFrom: string; timeTo: string;
    planMinutes?: number; letterNo?: string | null; reason?: string | null;
  },
): Promise<{ order: unknown; note: string }> {
  if (!input.employeeId) throw new Error("Karyawan wajib dipilih");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.overtimeDate)) throw new Error("Tanggal lembur tidak valid (YYYY-MM-DD)");
  if (!/^\d{2}:\d{2}$/.test(input.timeFrom) || !/^\d{2}:\d{2}$/.test(input.timeTo)) throw new Error("Jam mulai/selesai harus format HH:MM");

  const date = new Date(`${input.overtimeDate}T00:00:00`);
  const tFrom = new Date(`${input.overtimeDate}T${input.timeFrom}:00`);
  let tTo = new Date(`${input.overtimeDate}T${input.timeTo}:00`);
  if (tTo <= tFrom) tTo = addDays(tTo, 1); // lintas tengah malam
  const plan = input.planMinutes && input.planMinutes > 0
    ? Math.round(input.planMinutes)
    : Math.max(30, minutesBetween(tFrom, tTo));

  // day type & kategori utk multiplier
  const { dayType } = await resolveDayType(db, input.employeeId, date);
  const dayCategory = dayType
    ? dayType.category === "Off" ? "Weekend" : dayType.category === "Holiday" ? "Holiday" : "Weekday"
    : "Weekday";

  const orderNo = await nextOrderNo(db);
  const order = await db.overtimeOrder.create({
    data: {
      orderNo, employeeId: input.employeeId, overtimeDate: date,
      timeFrom: tFrom, timeTo: tTo, planMinutes: plan,
      dayCategory, calculationTime: true,
      letterNo: input.letterNo?.trim() || null,
      reason: input.reason?.trim() || null,
      status: "Pending",
    },
    include: OT_INCLUDE,
  });
  return { order, note: `Perintah lembur ${orderNo} diajukan (${dayCategory}, rencana ${plan} menit) — menunggu persetujuan` };
}

export async function decideOvertimeOrder(
  db: TenantDb,
  id: string,
  action: "approve" | "reject" | "verify" | "cancel",
  opts: { approver?: string; note?: string; verifiedMinutes?: number },
): Promise<{ order: unknown; note: string }> {
  const order = await db.overtimeOrder.findUnique({ where: { id }, include: OT_INCLUDE });
  if (!order) throw new Error("Perintah lembur tidak ditemukan");

  if (action === "approve") {
    if (order.status !== "Pending") throw new Error("Hanya perintah berstatus Pending yang dapat disetujui");
    // Fix M-7: tolak approve lembur tanggal masa depan — lembur baru bisa disetujui
    // setelah tanggalnya berlalu sehingga bukti clocking tersedia (mencegah paid
    // tanpa bukti kehadiran).
    const today = dayStart(new Date());
    if (order.overtimeDate > today) {
      throw new Error(
        `Tanggal lembur ${fmtDate(order.overtimeDate)} masih di masa depan (hari ini ${fmtDate(today)}) — setujui setelah tanggal lembur berlalu agar bukti clocking ikut diverifikasi`,
      );
    }
    // actual dari clocking hari tsb (bila ada) — padanan Plan → Actual:
    // overlap jendela perintah lembur dengan kehadiran tercatat (clock in/out).
    let actual = 0;
    const daily = await db.attendanceDaily.findUnique({
      where: { employeeId_workDate: { employeeId: order.employeeId, workDate: dayStart(order.overtimeDate) } },
    });
    if (daily?.checkIn && daily?.checkOut) {
      const tFrom = order.timeFrom > daily.checkIn ? order.timeFrom : daily.checkIn;
      const tTo = order.timeTo < daily.checkOut ? order.timeTo : daily.checkOut;
      actual = Math.max(0, minutesBetween(tFrom, tTo));
      actual = Math.min(actual, 600);
    }
    // Fix M-7: tanpa bukti clock (daily belum ada / tanpa check-in-out) → verified 0
    // (bukan plan) — lembur menunggu verifikasi manual, tidak dibayar otomatis.
    const verified = opts.verifiedMinutes && opts.verifiedMinutes > 0 ? Math.round(opts.verifiedMinutes) : actual > 0 ? actual : 0;
    const updated = await db.overtimeOrder.update({
      where: { id },
      data: {
        status: "Approved", approverId: opts.approver?.trim() || "Admin HR",
        decidedAt: new Date(), decisionNote: opts.note?.trim() || null,
        actualMinutes: actual, verifiedMinutes: verified,
        // multiplier jam ke-1 sesuai kategori hari (Weekday 1,5× / Weekend 2× / Holiday 2×)
        rateMultiplier: verified > 0
          ? order.dayCategory === "Weekend" || order.dayCategory === "Holiday" ? 2 : 1.5
          : order.rateMultiplier,
      },
      include: OT_INCLUDE,
    });
    await regenerateDaily(db, order.overtimeDate, order.employeeId);
    const note = verified > 0
      ? `Lembur disetujui — dibayar ${verified} menit (aktual clocking ${actual} menit)`
      : `Lembur disetujui — belum ada bukti clocking, jam dibayar 0 menit — lakukan verifikasi manual bila lembur benar terjadi`;
    return { order: updated, note };
  }

  if (action === "reject") {
    if (order.status !== "Pending") throw new Error("Hanya perintah berstatus Pending yang dapat ditolak");
    if (!opts.note?.trim()) throw new Error("Alasan penolakan wajib diisi");
    const updated = await db.overtimeOrder.update({
      where: { id },
      data: { status: "Rejected", approverId: opts.approver?.trim() || "Admin HR", decidedAt: new Date(), decisionNote: opts.note.trim() },
      include: OT_INCLUDE,
    });
    await regenerateDaily(db, order.overtimeDate, order.employeeId);
    return { order: updated, note: `Perintah lembur ${order.orderNo} ditolak` };
  }

  if (action === "verify") {
    if (order.status !== "Approved") throw new Error("Verifikasi hanya untuk perintah yang sudah disetujui");
    const verified = Math.max(0, Math.round(opts.verifiedMinutes ?? order.actualMinutes));
    const updated = await db.overtimeOrder.update({
      where: { id },
      data: { verifiedMinutes: verified, decisionNote: opts.note?.trim() || `Jam diverifikasi: ${verified} menit` },
      include: OT_INCLUDE,
    });
    await regenerateDaily(db, order.overtimeDate, order.employeeId);
    return { order: updated, note: `Jam lembur ${order.orderNo} diverifikasi: ${verified} menit` };
  }

  // cancel
  if (!["Pending", "Approved"].includes(order.status)) throw new Error("Perintah yang sudah dibayar/ditolak tidak dapat dibatalkan");
  const updated = await db.overtimeOrder.update({
    where: { id },
    data: { status: "Cancelled", decisionNote: opts.note?.trim() || "Dibatalkan" },
    include: OT_INCLUDE,
  });
  await regenerateDaily(db, order.overtimeDate, order.employeeId);
  return { order: updated, note: `Perintah lembur ${order.orderNo} dibatalkan` };
}

// ============ work off permission (padanan EmployeeWorkOff.jsp) ============

// ---- T5-TA-FIX: potong saldo cuti tahunan dari izin tidak masuk (deductLeave) ----
// Audit AUDIT-3: flag deductLeave ditampilkan UI ("memotong saldo cuti: Ya")
// tapi tidak pernah dieksekusi. Mekanisme yang dipilih: approval FINAL izin
// menulis LeaveRequest OTOMATIS — docNo = nomor WO (unique index → relasi 1:1
// & idempoten), source "WorkOff", status Approved. Baris ini PERSIS jenis data
// yang dihitung kolom (f) taken / (g) applied oleh formula saldo leave-service
// (computeParts) — saldo & UI "Informasi Cuti" langsung konsisten TANPA
// menyentuh leave-service (leave-service meng-import attendance-service —
// import balik = dependensi melingkar). Validasi saldo di sini memakai MIRROR
// formula a–g + reservasi pending (permintaan cuti Submitted lain + izin
// Pending deductLeave lain — padanan reservasi L-01 leave-service).
// REJECT/CANCEL izin yang sudah terpotong → request otomatis dibatalkan
// (status Cancelled) → saldo kembali; idempoten.

/** Kode jenis cuti tahunan yang dipotong izin tidak masuk (deductLeave). */
const ANNUAL_LEAVE_CODE = "CT-THN";

interface AnnualLeaveTypeLite {
  id: string; code: string; name: string; unit: string; entitlement: number;
  prorateMonthly: boolean; carryOverMax: number; periodMode: string;
}

async function annualLeaveType(db: TenantDb): Promise<AnnualLeaveTypeLite | null> {
  return db.leaveType.findFirst({
    where: { code: ANNUAL_LEAVE_CODE, active: true },
    select: {
      id: true, code: true, name: true, unit: true, entitlement: true,
      prorateMonthly: true, carryOverMax: true, periodMode: true,
    },
  });
}

/** Mirror earnedMonths leave-service (bulan penuh berlaku, bulan berjalan penuh). */
function mirrorEarnedMonths(from: Date, joinDate: Date, asOf: Date): number {
  const start = joinDate > from ? joinDate : from;
  const m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()) + 1;
  return Math.max(0, Math.min(12, m));
}

/** Mirror yearForDate leave-service (CALENDAR → tahun kalender; ANNIVERSARY → per tanggal join). */
function mirrorYearForDate(periodMode: string, joinDate: Date, date: Date): number {
  if (periodMode !== "ANNIVERSARY") return date.getFullYear();
  const annivThisYear = new Date(date.getFullYear(), joinDate.getMonth(), joinDate.getDate());
  return date >= annivThisYear ? date.getFullYear() + 1 : date.getFullYear();
}

/** Mirror isWorkday leave-service — hari kerja efektif dari jadwal TA
 *  (category Off/Holiday bukan hari kerja); tanpa assignment → fallback Senin–Jumat. */
async function isWorkdayMirror(db: TenantDb, employeeId: string, date: Date): Promise<boolean> {
  const { dayType } = await resolveDayType(db, employeeId, date);
  if (dayType) return dayType.category !== "Off" && dayType.category !== "Holiday";
  const dow = date.getDay();
  return dow >= 1 && dow <= 5;
}

/** Sesi AM/PM padanan izin setengah hari — mirror calculateRequestDays:
 *  sehari penuh = AM→PM; setengah hari pagi (timeFrom < 12) = AM→AM;
 *  setengah hari siang = PM→PM (masing-masing −0,5 hari). */
function workoffSessions(allDay: boolean, timeFrom: string | null): { sessionFrom: "AM" | "PM"; sessionTo: "AM" | "PM" } {
  if (allDay) return { sessionFrom: "AM", sessionTo: "PM" };
  const h = timeFrom ? parseInt(timeFrom.split(":")[0] ?? "8", 10) : 8;
  return h < 12 ? { sessionFrom: "AM", sessionTo: "AM" } : { sessionFrom: "PM", sessionTo: "PM" };
}

/** Hari kerja terpakai oleh izin — mirror calculateRequestDays leave-service
 *  (hari off/libur dilewati; setengah hari −0,5). */
async function workoffDays(
  db: TenantDb,
  employeeId: string,
  from: Date,
  to: Date,
  allDay: boolean,
): Promise<number> {
  const start = dayStart(from);
  const end = dayStart(to);
  if (end < start) return 0;
  let days = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    if (await isWorkdayMirror(db, employeeId, d)) days += 1;
  }
  if (!allDay && days > 0) days -= 0.5;
  return Math.max(0, Math.round(days * 100) / 100);
}

interface WorkoffLeaveAvailability {
  /** sisa saldo resmi a+b+c−d−e−f−g (mirror computeParts) */
  remaining: number;
  /** reservasi: hari permintaan cuti Submitted lain (belum memotong saldo) */
  pendingLeave: number;
  /** reservasi: hari izin tidak masuk Pending (deductLeave) lain */
  pendingWorkoff: number;
  /** remaining − pendingLeave − pendingWorkoff */
  available: number;
}

/** Sisa saldo cuti tahunan TERSEDIA + reservasi pending (mirror formula saldo
 *  leave-service + padanan reservasi L-01). excludeWorkoffId dipakai saat
 *  re-validasi approve (izin itu sendiri dikecualikan dari reservasi). */
async function annualAvailability(
  db: TenantDb,
  employeeId: string,
  type: AnnualLeaveTypeLite,
  year: number,
  opts: { excludeWorkoffId?: string } = {},
): Promise<WorkoffLeaveAvailability> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { joinDate: true } });
  if (!emp) throw new Error("Karyawan tidak ditemukan");
  // baris saldo (auto-buat bila belum — mirror ensureBalance leave-service)
  const balance = await db.leaveBalance.upsert({
    where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } },
    create: { employeeId, leaveTypeId: type.id, year, note: "auto-generated dari izin tidak masuk (potong saldo cuti)" },
    update: {},
  });
  const asOf = new Date();
  // (b) earned — prorate bulanan opsional (mirror computeParts)
  const winFrom = new Date(year, 0, 1);
  const from = emp.joinDate > winFrom ? emp.joinDate : winFrom;
  const earned = type.prorateMonthly ? (type.entitlement * mirrorEarnedMonths(from, emp.joinDate, asOf)) / 12 : type.entitlement;
  // (d) carry-over hangus setelah 31-12 periode
  const forfeitDate = new Date(year, 11, 31, 23, 59, 59);
  const forfeited = balance.carriedOver > 0 && asOf > forfeitDate ? balance.carriedOver : 0;
  // (f)/(g) taken/applied dari request Approved/MassLeave (termasuk potongan
  // otomatis WorkOff yang sudah disetujui — konsisten dgn leave-service)
  const used = await db.leaveRequest.findMany({
    where: { employeeId, leaveTypeId: type.id, year, status: { in: ["Approved", "MassLeave"] } },
    select: { workingDays: true, dateTo: true },
  });
  let taken = 0;
  let applied = 0;
  for (const r of used) {
    if (dayStart(r.dateTo) < dayStart(asOf)) taken += r.workingDays;
    else applied += r.workingDays;
  }
  const remaining = balance.carriedOver + earned + balance.adjustment - forfeited - balance.cashed - taken - applied;
  // reservasi: permintaan cuti Submitted lain (belum memotong saldo resmi)
  const pending = await db.leaveRequest.findMany({
    where: { employeeId, leaveTypeId: type.id, year, status: "Submitted" },
    select: { workingDays: true },
  });
  const pendingLeave = pending.reduce((s, r) => s + r.workingDays, 0);
  // reservasi: izin tidak masuk Pending (deductLeave) lain
  const pendingWo = await db.workOffPermission.findMany({
    where: {
      employeeId, status: "Pending", deductLeave: true,
      ...(opts.excludeWorkoffId ? { id: { not: opts.excludeWorkoffId } } : {}),
    },
    select: { dateFrom: true, dateTo: true, allDay: true },
  });
  let pendingWorkoff = 0;
  for (const w of pendingWo) {
    pendingWorkoff += await workoffDays(db, employeeId, w.dateFrom, w.dateTo, w.allDay);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    remaining: round2(remaining),
    pendingLeave: round2(pendingLeave),
    pendingWorkoff: round2(pendingWorkoff),
    available: round2(remaining - pendingLeave - pendingWorkoff),
  };
}

interface WorkoffBalanceCheck {
  type: AnnualLeaveTypeLite;
  days: number;
  avail: WorkoffLeaveAvailability;
}

/** Validasi saldo cuti tahunan utk izin deductLeave — melempar Error ramah (400
 *  di route) bila saldo kurang. Dipanggil saat SUBMIT dan di-revalidasi saat
 *  APPROVE FINAL (saldo bisa berubah di antara keduanya). */
async function assertWorkoffLeaveBalance(
  db: TenantDb,
  employeeId: string,
  from: Date,
  to: Date,
  allDay: boolean,
  opts: { excludeWorkoffId?: string } = {},
): Promise<WorkoffBalanceCheck> {
  const type = await annualLeaveType(db);
  if (!type) {
    throw new Error(
      `Jenis cuti tahunan (${ANNUAL_LEAVE_CODE}) tidak ditemukan — saldo tidak bisa dipotong. Matikan opsi "potong saldo cuti" atau hubungi admin`,
    );
  }
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { joinDate: true } });
  if (!emp) throw new Error("Karyawan tidak ditemukan");
  // potongan dibukukan ke saldo periode tahun tanggal mulai izin
  const year = mirrorYearForDate(type.periodMode, emp.joinDate, dayStart(from));
  const days = await workoffDays(db, employeeId, from, to, allDay);
  const avail = await annualAvailability(db, employeeId, type, year, opts);
  if (days > avail.available) {
    const reserved = avail.pendingLeave + avail.pendingWorkoff;
    throw new Error(
      `Saldo cuti tahunan tidak cukup: tersedia ${avail.available} hari` +
        (reserved > 0 ? ` (saldo ${avail.remaining}, terpotong ${reserved} hari pengajuan lain yang menunggu persetujuan)` : ` (saldo ${avail.remaining})`) +
        `, diminta ${days} hari — matikan opsi "potong saldo cuti", kurangi rentang, atau ajukan cuti resmi melalui modul Leave`,
    );
  }
  return { type, days, avail };
}

interface WorkoffDeductionResult {
  applied: boolean;
  days: number;
  note: string;
}

/** Eksekusi potongan saldo saat izin disetujui penuh — idempoten (docNo 1:1).
 *  Tidak melempar: kegagalan non-saldo (jenis hilang/bentrok) dicatat ke
 *  ActivityLog supaya persetujuan tidak macet di tengah jalan. */
async function applyWorkoffLeaveDeduction(
  db: TenantDb,
  permit: { id: string; docNo: string; employeeId: string; dateFrom: Date; dateTo: Date; allDay: boolean; timeFrom: string | null; reason: string | null },
  approverName: string,
  appUserId: string | null,
): Promise<WorkoffDeductionResult> {
  const type = await annualLeaveType(db);
  if (!type) {
    await db.activityLog.create({
      data: {
        action: "Warning", entity: "WorkOffPermission", entityId: permit.docNo, appUserId,
        detail: `${permit.docNo}: saldo cuti TIDAK dipotong — jenis ${ANNUAL_LEAVE_CODE} tidak ditemukan`,
      },
    });
    return { applied: false, days: 0, note: "saldo tidak dipotong — jenis cuti tahunan tidak ditemukan" };
  }

  // idempoten: request otomatis sudah pernah dibuat (approve ulang / legacy)
  const existing = await db.leaveRequest.findUnique({ where: { docNo: permit.docNo } });
  if (existing) {
    if (existing.status === "Approved") {
      return { applied: true, days: existing.workingDays, note: `sudah dipotong sebelumnya (${existing.workingDays} hari)` };
    }
    return { applied: false, days: 0, note: `tidak dipotong (request otomatis berstatus ${existing.status})` };
  }

  // bentrok rentang dengan permintaan cuti lain → jangan potong dua kali
  const overlap = await db.leaveRequest.findFirst({
    where: {
      employeeId: permit.employeeId,
      status: { in: ["Submitted", "Approved", "MassLeave"] },
      dateFrom: { lte: dayStart(permit.dateTo) },
      dateTo: { gte: dayStart(permit.dateFrom) },
    },
  });
  if (overlap) {
    await db.activityLog.create({
      data: {
        action: "Warning", entity: "WorkOffPermission", entityId: permit.docNo, appUserId,
        detail: `${permit.docNo}: saldo cuti TIDAK dipotong — rentang bertabrakan dengan permintaan cuti ${overlap.docNo} (hari tsb sudah tercakup cuti)`,
      },
    });
    return { applied: false, days: 0, note: `saldo tidak dipotong — rentang bertabrakan dengan permintaan cuti ${overlap.docNo}` };
  }

  const emp = await db.employee.findUnique({ where: { id: permit.employeeId }, select: { joinDate: true } });
  if (!emp) return { applied: false, days: 0, note: "karyawan tidak ditemukan" };
  const year = mirrorYearForDate(type.periodMode, emp.joinDate, dayStart(permit.dateFrom));
  const days = await workoffDays(db, permit.employeeId, permit.dateFrom, permit.dateTo, permit.allDay);
  if (days <= 0) {
    await db.activityLog.create({
      data: {
        action: "Warning", entity: "WorkOffPermission", entityId: permit.docNo, appUserId,
        detail: `${permit.docNo}: saldo cuti TIDAK dipotong — rentang tidak memuat hari kerja`,
      },
    });
    return { applied: false, days: 0, note: "saldo tidak dipotong — rentang tidak memuat hari kerja" };
  }

  const avail = await annualAvailability(db, permit.employeeId, type, year, { excludeWorkoffId: permit.id });
  const sessions = workoffSessions(permit.allDay, permit.timeFrom);
  // hari kerja pertama setelah izin (padanan backToWorkDate)
  let backToWork: Date | null = null;
  for (let d = addDays(dayStart(permit.dateTo), 1); d <= addDays(dayStart(permit.dateTo), 30); d = addDays(d, 1)) {
    if (await isWorkdayMirror(db, permit.employeeId, d)) { backToWork = d; break; }
  }

  await db.leaveRequest.create({
    data: {
      // docNo = nomor izin (unique) → relasi 1:1, kunci idempotensi; muncul di
      // UI Informasi Cuti sebagai baris potongan dari izin tidak masuk.
      docNo: permit.docNo,
      employeeId: permit.employeeId, leaveTypeId: type.id, year,
      requestDate: new Date(),
      dateFrom: dayStart(permit.dateFrom), sessionFrom: sessions.sessionFrom,
      dateTo: dayStart(permit.dateTo), sessionTo: sessions.sessionTo,
      workingDays: days,
      balanceAtRequest: avail.remaining, remainingAtRequest: Math.round((avail.remaining - days) * 100) / 100,
      backToWorkDate: backToWork,
      status: "Approved", source: "WorkOff",
      reason: `Izin tidak masuk ${permit.docNo}${permit.reason ? `: ${permit.reason}` : ""}`,
      note: "Otomatis dari izin tidak masuk (potong saldo cuti)",
      decidedAt: new Date(),
      decisionNote: `Disetujui otomatis mengikuti persetujuan izin ${permit.docNo} (${approverName})`,
    },
  });
  const remainingAfter = Math.round((avail.remaining - days) * 100) / 100;
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "LeaveRequest", entityId: permit.docNo, appUserId,
      detail: `${permit.docNo}: saldo ${type.name} dipotong ${days} hari (${fmtIso(dayStart(permit.dateFrom))} → ${fmtIso(dayStart(permit.dateTo))}) oleh persetujuan izin tidak masuk — sisa ${remainingAfter} hari`,
    },
  });
  return { applied: true, days, note: `saldo cuti ${type.name} dipotong ${days} hari (sisa ${remainingAfter})` };
}

/** Kembalikan potongan saldo saat izin ditolak/dibatalkan — idempoten:
 *  request otomatis berstatus Approved → dibatalkan; sudah Cancelled / tidak
 *  ada → no-op (null). */
async function refundWorkoffLeave(
  db: TenantDb,
  permit: { docNo: string },
  cause: string,
): Promise<string | null> {
  const req = await db.leaveRequest.findUnique({ where: { docNo: permit.docNo } });
  if (!req || req.status !== "Approved") return null;
  await db.leaveRequest.update({
    where: { id: req.id },
    data: {
      status: "Cancelled",
      decisionNote: `Dibatalkan mengikuti izin ${permit.docNo} — potongan ${req.workingDays} hari dikembalikan`,
      decidedAt: new Date(),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Cancelled", entity: "LeaveRequest", entityId: permit.docNo,
      detail: `${permit.docNo}: potongan saldo cuti ${req.workingDays} hari DIKEMBALIKAN — izin ${cause}`,
    },
  });
  return `potongan saldo cuti ${req.workingDays} hari dikembalikan`;
}

export async function nextWorkoffNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  const count = await db.workOffPermission.count({ where: { docNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

const WO_INCLUDE = {
  employee: { select: { employeeNo: true, fullName: true } },
  dayType: { select: { code: true, name: true } },
} as const;

export interface WorkoffSubmitResult {
  permit: unknown;
  note: string;
  /** jumlah jenjang persetujuan untuk pengajuan ini */
  approvalLevels: number;
  /** nama approver jenjang pertama */
  firstApprover: string | null;
}

export async function submitWorkoff(
  db: TenantDb,
  input: {
    employeeId: string; dateFrom: string; dateTo?: string; allDay?: boolean;
    timeFrom?: string | null; timeTo?: string | null; paid?: boolean; deductLeave?: boolean;
    reason?: string | null; documentNote?: string | null;
    actorName?: string | null;
  },
): Promise<WorkoffSubmitResult> {
  if (!input.employeeId) throw new Error("Karyawan wajib dipilih");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom)) throw new Error("Tanggal mulai tidak valid (YYYY-MM-DD)");
  const from = new Date(`${input.dateFrom}T00:00:00`);
  const to = input.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo) ? new Date(`${input.dateTo}T00:00:00`) : from;
  if (to < from) throw new Error("Tanggal selesai tidak boleh sebelum tanggal mulai");
  if (diffDays(from, to) > 30) throw new Error("Izin maksimal 30 hari sekali pengajuan");

  const allDay = input.allDay ?? true;
  if (!allDay && !input.timeFrom) throw new Error("Izin setengah hari wajib mengisi jam mulai");
  if (input.paid === false && input.deductLeave === false) {
    throw new Error("Izin tidak dibayar namun tidak memotong cuti — konfigurasi tidak sah");
  }
  const deductLeave = input.deductLeave ?? true;

  // T5-TA-FIX (misi 1a): deductLeave dieksekusi — saat SUBMIT, saldo cuti
  // tahunan divalidasi cukup (mirror formula a–g + reservasi pending); kurang →
  // ditolak ramah (400 di route) sebelum izin/chain dibuat.
  let deductDays = 0;
  if (deductLeave) {
    const check = await assertWorkoffLeaveBalance(db, input.employeeId, from, to, allDay);
    deductDays = check.days;
  }

  const docNo = await nextWorkoffNo(db);
  const permit = await db.workOffPermission.create({
    data: {
      docNo, employeeId: input.employeeId, dateFrom: from, dateTo: to,
      allDay, timeFrom: allDay ? null : input.timeFrom ?? null, timeTo: allDay ? null : input.timeTo ?? null,
      paid: input.paid ?? true, deductLeave,
      reason: input.reason?.trim() || null,
      documentNote: input.documentNote?.trim() || null,
      status: "Pending",
    },
    include: WO_INCLUDE,
  });

  // Approval berjenjang (padanan Leave Task 25): bangun jalur persetujuan
  // sesuai struktur yang cocok dengan penempatan pemohon — fallback atasan
  // langsung → Admin/HR. Tanpa ini, izin hanya disetujui satu langkah datar.
  const chain = await startApprovalChain(db, {
    docType: "WorkOff", docId: permit.id, employeeId: input.employeeId,
    createdBy: input.actorName ?? null,
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "WorkOffPermission", entityId: docNo,
      detail: `${docNo}: ${permit.employee.fullName} — izin tidak masuk ${fmtIso(from)} → ${fmtIso(to)} (${allDay ? "sehari penuh" : "setengah hari"})${deductLeave ? `, memotong saldo cuti tahunan ${deductDays} hari` : ""} — approval berjenjang ${chain.totalLevels} level`,
    },
  });
  return {
    permit,
    note: `Izin ${docNo} diajukan (${allDay ? "sehari penuh" : "setengah hari"})${deductLeave ? ` — memotong saldo cuti tahunan ${deductDays} hari saat disetujui` : ""} — menunggu persetujuan ${chain.totalLevels} jenjang`,
    approvalLevels: chain.totalLevels,
    firstApprover: chain.steps[0]?.approverLabel ?? null,
  };
}

/** ISO pendek untuk activity log. */
function fmtIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface WorkoffDecisionResult {
  permit: unknown;
  note: string;
  affected: number;
  /** ada bila approve jenjang menengah — dokumen masih menunggu jenjang berikutnya */
  approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null };
}

export async function decideWorkoff(
  db: TenantDb,
  id: string,
  action: "approve" | "reject" | "cancel",
  opts: { approver?: string; note?: string; actor?: DecideActor },
): Promise<WorkoffDecisionResult> {
  const permit = await db.workOffPermission.findUnique({ where: { id }, include: WO_INCLUDE });
  if (!permit) throw new Error("Izin tidak ditemukan");

  // ==== approval berjenjang — chain dibuat saat submit; dokumen legacy
  // tanpa chain (Pending) dibuat saat putusan ini (backfill). ====
  let chain = await getApprovalChain(db, "WorkOff", id);
  if (!chain && permit.status === "Pending") {
    chain = await startApprovalChain(db, { docType: "WorkOff", docId: id, employeeId: permit.employeeId, createdBy: "legacy-backfill" });
  }
  const actor: DecideActor =
    opts.actor ?? { role: "ADMIN", employeeId: null, name: opts.approver?.trim() || "Admin HR" };

  if (action === "approve") {
    if (permit.status !== "Pending") throw new Error("Hanya izin berstatus Pending yang dapat disetujui");
    if (chain && chain.status === "InProgress") {
      // approve pada jenjang < total → status tetap Pending (menunggu jenjang
      // berikutnya); hanya jenjang TERAKHIR yang mengubah izin menjadi Approved
      // dan memicu hitung ulang rekap absensi.
      //
      // T5-TA-FIX (misi 1b): keputusan jenjang TERAKHIR akan memotong saldo cuti
      // (deductLeave) — saldo di-REVALIDASI SEBELUM chain diputuskan supaya
      // kegagalan (saldo berubah sejak submit) meninggalkan izin tetap Pending
      // + chain utuh (approver melihat pesan ramah dan bisa menolak dengan alasan);
      // melempar SETELAH chain final akan meninggalkan chain Approved + izin Pending
      // yang tidak bisa diputus ulang.
      if (permit.deductLeave && chain.currentLevel >= chain.totalLevels) {
        await assertWorkoffLeaveBalance(
          db, permit.employeeId, permit.dateFrom, permit.dateTo, permit.allDay,
          { excludeWorkoffId: permit.id },
        );
      }
      const res = await decideApprovalChain(db, {
        docType: "WorkOff", docId: id, action: "approve", note: opts.note, actor,
      });
      if (!res.final) {
        const currentStep = res.chain.steps.find((s) => s.status === "Current");
        const waiting = currentStep?.approverLabel ?? "jenjang berikutnya";
        await db.activityLog.create({
          data: {
            action: "Approved", entity: "WorkOffPermission", entityId: permit.docNo,
            detail: `${permit.docNo}: jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui — menunggu ${waiting}`,
          },
        });
        const refreshed = await db.workOffPermission.findUnique({ where: { id }, include: WO_INCLUDE });
        return {
          permit: refreshed,
          note: `Jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui — menunggu ${waiting}`,
          affected: 0,
          approval: {
            currentLevel: res.chain.currentLevel,
            totalLevels: res.chain.totalLevels,
            currentApprover: currentStep?.approverLabel ?? null,
          },
        };
      }
      const updated = await db.workOffPermission.update({
        where: { id },
        data: { status: "Approved", approverId: actor.name, decidedAt: new Date(), decisionNote: opts.note?.trim() || null },
        include: WO_INCLUDE,
      });
      const affected = await regenerateRange(db, permit.dateFrom, permit.dateTo);
      // T5-TA-FIX (misi 1b): jenjang terakhir + deductLeave → potong saldo cuti
      // tahunan (LeaveRequest otomatis, idempoten — lihat applyWorkoffLeaveDeduction).
      const deduction = permit.deductLeave
        ? await applyWorkoffLeaveDeduction(db, permit, actor.name, actor.appUserId ?? null)
        : null;
      await db.activityLog.create({
        data: {
          action: "Approved", entity: "WorkOffPermission", entityId: permit.docNo,
          detail: `${permit.docNo}: disetujui penuh (${res.chain.totalLevels} jenjang) oleh ${actor.name} — rekap ${affected} baris dihitung ulang${deduction ? `; ${deduction.note}` : ""}`,
        },
      });
      return {
        permit: updated,
        note: `Izin ${permit.docNo} disetujui penuh (${res.chain.totalLevels} jenjang) — rekap ${affected} baris dihitung ulang${deduction ? `; ${deduction.note}` : ""}`,
        affected,
      };
    }
    // tanpa chain aktif (mis. chain sudah final) — pertahankan perilaku lama
    // T5-TA-FIX: jalur pemulihan legacy ini ikut memotong saldo supaya izin
    // tidak bisa "lolos tanpa potongan" lewat jalur chain-final-tapi-izinya-Pending.
    const updated = await db.workOffPermission.update({
      where: { id },
      data: { status: "Approved", approverId: opts.approver?.trim() || "Admin HR", decidedAt: new Date(), decisionNote: opts.note?.trim() || null },
      include: WO_INCLUDE,
    });
    const affected = await regenerateRange(db, permit.dateFrom, permit.dateTo);
    const deduction = permit.deductLeave
      ? await applyWorkoffLeaveDeduction(db, permit, opts.approver?.trim() || "Admin HR", actor.appUserId ?? null)
      : null;
    return { permit: updated, note: `Izin ${permit.docNo} disetujui — rekap ${affected} baris dihitung ulang${deduction ? `; ${deduction.note}` : ""}`, affected };
  }

  if (action === "reject") {
    if (permit.status !== "Pending") throw new Error("Hanya izin berstatus Pending yang dapat ditolak");
    if (!opts.note?.trim()) throw new Error("Alasan penolakan wajib diisi");
    const rejectedAtLevel = chain && chain.status === "InProgress" ? ` di jenjang ${chain.currentLevel}/${chain.totalLevels}` : "";
    if (chain && chain.status === "InProgress") {
      await decideApprovalChain(db, { docType: "WorkOff", docId: id, action: "reject", note: opts.note, actor });
    }
    const updated = await db.workOffPermission.update({
      where: { id },
      data: { status: "Rejected", approverId: actor.name, decidedAt: new Date(), decisionNote: opts.note.trim() },
      include: WO_INCLUDE,
    });
    // T5-TA-FIX (misi 1b): penolakan mengembalikan potongan saldo bila izin
    // pernah disetujui (idempoten — izin biasanya belum terpotong saat ditolak).
    const refundNote = await refundWorkoffLeave(db, permit, `ditolak oleh ${actor.name}`);
    await db.activityLog.create({
      data: {
        action: "Rejected", entity: "WorkOffPermission", entityId: permit.docNo,
        detail: `${permit.docNo}: ditolak${rejectedAtLevel} oleh ${actor.name} — ${opts.note.trim()}${refundNote ? `; ${refundNote}` : ""}`,
      },
    });
    return { permit: updated, note: `Izin ${permit.docNo} ditolak${rejectedAtLevel}${refundNote ? ` — ${refundNote}` : ""}`, affected: 0 };
  }

  if (!["Pending", "Approved"].includes(permit.status)) throw new Error("Izin yang sudah ditolak/selesai tidak dapat dibatalkan");
  if (chain && chain.status === "InProgress") {
    await cancelApprovalChain(db, "WorkOff", id, actor.name);
  }
  const updated = await db.workOffPermission.update({
    where: { id },
    data: { status: "Cancelled", decisionNote: opts.note?.trim() || "Dibatalkan" },
    include: WO_INCLUDE,
  });
  // T5-TA-FIX (misi 1b): pembatalan izin yang sudah terpotong → saldo kembali
  // (request otomatis dibatalkan — idempoten), SEBELUM regen supaya rekap hari
  // workoff berhenti ditutup WorkOffPermission & potongannya tidak lagi dihitung.
  const refundNote = await refundWorkoffLeave(db, permit, `dibatalkan oleh ${actor.name}`);
  const affected = await regenerateRange(db, permit.dateFrom, permit.dateTo);
  await db.activityLog.create({
    data: {
      action: "Cancelled", entity: "WorkOffPermission", entityId: permit.docNo,
      detail: `${permit.docNo}: dibatalkan oleh ${actor.name} — rekap dihitung ulang${refundNote ? `; ${refundNote}` : ""}`,
    },
  });
  return { permit: updated, note: `Izin ${permit.docNo} dibatalkan — rekap dihitung ulang${refundNote ? ` — ${refundNote}` : ""}`, affected };
}

// ============ ringkasan hari ini (dashboard modul) ============

export async function attendanceStats(db: TenantDb, date: Date, monthFrom: Date, monthTo: Date) {
  const daily = await listDaily(db, date);
  const [today, month] = await Promise.all([
    summarize(daily),
    (async () => {
      const rows = await db.attendanceDaily.findMany({
        where: { workDate: { gte: dayStart(monthFrom), lt: dayStart(addDays(monthTo, 1)) } },
        select: { status: true, lateMinutes: true, absenceMinutes: true, overtimeMinutes: true, normalMinutes: true },
      });
      return summarize(rows.map((r) => ({ ...r, presence: 0, checkIn: null, checkOut: null } as never)));
    })(),
  ]);

  const [pendingOT, pendingWO, activeSchedules, assignedEmployees, nonClocking] = await Promise.all([
    db.overtimeOrder.count({ where: { status: "Pending" } }),
    db.workOffPermission.count({ where: { status: "Pending" } }),
    db.workSchedule.count({ where: { active: true } }),
    db.scheduleAssignment.count({ where: { OR: [{ validTo: null }, { validTo: { gte: new Date() } }] } }),
    db.scheduleAssignment.count({ where: { clockingRequired: false, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] } }),
  ]);

  // T9-HOLIDAY: ringkasan kalender libur — jumlah hari libur tahun berjalan +
  // libur terdekat dari tanggal acuan (KPI overview modul attendance).
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const yearEnd = new Date(date.getFullYear() + 1, 0, 1);
  let holidaysThisYear = 0;
  let nextHoliday: { date: string; name: string; kind: string } | null = null;
  try {
    holidaysThisYear = await db.holidayDate.count({ where: { date: { gte: yearStart, lt: yearEnd } } });
    const nh = await db.holidayDate.findFirst({
      where: { date: { gte: dayStart(date) } },
      orderBy: [{ date: "asc" }, { kind: "desc" }],
    });
    if (nh) {
      const d = dayStart(nh.date);
      nextHoliday = {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        name: nh.name,
        kind: nh.kind,
      };
    }
  } catch {
    // schema belum termigrasi — KPI libur dilewati mati anggun
  }

  return {
    today: { date: fmtDate(date), ...today, total: daily.length },
    month: { from: fmtDate(monthFrom), to: fmtDate(monthTo), ...month },
    pendingOvertime: pendingOT,
    pendingWorkoff: pendingWO,
    activeSchedules,
    assignedEmployees,
    nonClocking,
    holidaysThisYear,
    nextHoliday,
  };
}

function summarize(rows: { status: string; lateMinutes: number; absenceMinutes: number; overtimeMinutes: number }[]) {
  return {
    present: rows.filter((r) => r.status === "Present").length,
    late: rows.filter((r) => r.status === "Late").length,
    absent: rows.filter((r) => r.status === "Absent").length,
    workoff: rows.filter((r) => r.status === "WorkOff").length,
    off: rows.filter((r) => r.status === "Off").length,
    lateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0),
    absenceMinutes: rows.reduce((s, r) => s + r.absenceMinutes, 0),
    overtimeMinutes: rows.reduce((s, r) => s + r.overtimeMinutes, 0),
  };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}
