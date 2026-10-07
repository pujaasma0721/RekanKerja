import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";
import { getRule, overtimeCaps, overtimePayFor } from "@/rekankerja/time-attendance/services/attendance-service";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// =============================================================================
// T113 — LAPORAN DISTRIBUSI ATTENDANCE (print & PDF ready) =====================
// =============================================================================
// GET /api/rekankerja/attendance/reports/documents?id=<arId> — data satu laporan
// siap cetak (12 laporan / 4 grup: rekap presensi berkala, keterlambatan & jam
// kerja kurang, lembur & jam kerja efektif, variasi jadwal & kerja shift).
//
// Alur T110 (mirror HR/Leave): form parameter awal di klien mengirim query
// string (office/unit cakupan + month/date/from/to/otStatus periode + filter
// khusus) → diterapkan SERVER-SIDE sebelum builder berjalan. ?id=_params →
// daftar opsi filter (TANPA entri id kosong — pelajaran T110). ?export=xlsx →
// stream XLSX per laporan.
//
// Guard: requireMenuViewAny attendance:reports + cakupan akses efektif.
// Uang (R3.2 estimasi lembur): baseSalary terenkripsi didekripsi HANYA utk
// kalkulasi internal; NILAI yang diserialisasi digerbang money-view (masked
// saat brankas terkunci → null / "•••").
//
// KONVENSI WAKTU: seluruh timestamp demo/jadwal disimpan "naive-UTC" (jam
// dinding disimpan apa adanya) — format HH:mm & tanggal memakai getter UTC.

const DAY_MS = 24 * 3600 * 1000;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "ar11", "ar12", "ar13",
  "ar21", "ar22", "ar23",
  "ar31", "ar32", "ar33",
  "ar41", "ar42", "ar43",
]);

const REPORT_TITLES: Record<string, string> = {
  ar11: "Monthly Attendance Summary Roll (Rekap Kehadiran Bulanan)",
  ar12: "Daily Attendance Timesheet",
  ar13: "Multi-Location / Geofencing Attendance Sheet",
  ar21: "Late Arrival & Early Leaver Log",
  ar22: "Working Hours Deficit Report",
  ar23: "Top Attendance Offenders Sheet",
  ar31: "Overtime Summary Report",
  ar32: "Overtime Financial Estimate Sheet",
  ar33: "Working Hours Compliance Audit (Cap Lembur)",
  ar41: "Roster & Shift Schedule Deviation Report",
  ar42: "Night Shift & Special Premium Hours Log",
  ar43: "Attendance Exception Report",
};

// ============ parameter & filter awal (mirror T110/T112) ============

const OT_STATUS_LABELS: Record<string, string> = {
  Pending: "Menunggu Persetujuan", Approved: "Disetujui", Rejected: "Ditolak", Cancelled: "Dibatalkan", Paid: "Sudah Dibayar",
};
const ATT_STATUS_LABELS: Record<string, string> = {
  Present: "Hadir", Late: "Telat", Absent: "Absen", Off: "Off", Holiday: "Libur", WorkOff: "Izin", OnLeave: "Cuti",
};
const DAYCAT_LABELS: Record<string, string> = { Weekday: "Hari Kerja", Weekend: "Akhir Pekan", Holiday: "Hari Libur" };
const EXC_LABELS: Record<string, [string, string]> = {
  "missing-out": ["Lupa Absen Pulang", "Missing Clock-out"],
  "no-punch": ["Tanpa Absen (Import Mesin)", "No Punch (Machine Import)"],
  revised: ["Koreksi Manual (Revised)", "Manual Correction (Revised)"],
};

interface ReportFilters {
  office: string | null;
  unit: string | null;
  /** status perintah lembur (R3.x) */
  otStatus: string | null;
  /** YYYY-MM-DD — laporan harian (R1.2) */
  date: string | null;
  /** YYYY-MM */
  month: string | null;
  year: number | null;
  from: string | null;
  to: string | null;
  /** jenis anomali (R4.3) */
  exception: string[];
}

const isYM = (v: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
const isYMD = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ============ util kecil ============

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const hm = (d: Date | null | undefined): string | null =>
  d ? `${String(new Date(d).getUTCHours()).padStart(2, "0")}:${String(new Date(d).getUTCMinutes()).padStart(2, "0")}` : null;
const dateID = (d: Date) => `${d.getUTCDate()} ${MONTHS_ID[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
const monthLabel = (d: Date) => `${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
const dayStartU = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDaysU = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const overlapDays = (a1: Date, a2: Date, b1: Date, b2: Date) => a1 <= b2 && b1 <= a2;

/** Jarak haversine dua titik (meter). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Menit efektif satu perintah lembur (padanan otEffectiveMinutes service). */
const otEffectiveMinutes = (o: { status: string; planMinutes: number; actualMinutes: number; verifiedMinutes: number }) =>
  o.status === "Pending" ? o.planMinutes : o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan; tanpa entri id kosong). ----
    if (id === "_params") {
      const [offices, units, minAtt, otStats] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        db.attendanceDaily.aggregate({ _min: { workDate: true } }),
        db.overtimeOrder.findMany({ select: { status: true }, distinct: ["status"] }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = minAtt._min.workDate?.getFullYear() ?? nowP.getFullYear();
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      const ORDER = ["Pending", "Approved", "Paid", "Rejected", "Cancelled"];
      const present = [...new Set(otStats.map((r) => r.status).filter(Boolean))]
        .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        otStatuses: present.map((s) => ({ id: s, label: OT_STATUS_LABELS[s] ?? s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (ar11…ar43)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const monthParam = sp.get("month");
    const yearParam = sp.get("year");
    const dateParam = sp.get("date");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const list = (key: string) => (sp.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      unit: sp.get("unit") || null,
      otStatus: sp.get("otStatus") || null,
      date: isYMD(dateParam) ? dateParam : null,
      month: isYM(monthParam) ? monthParam : null,
      year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null,
      from: isYMD(fromParam) ? fromParam : null,
      to: isYMD(toParam) ? toParam : null,
      exception: list("exception"),
    };

    const scope = await resolveAccessScope(db, {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      appUserRole: m.actor.appUserRole,
      platformRole: m.actor.role,
    });
    const scopeCond = scopeWhere(scope);
    const tc = tenantCryptoForDb(db);
    const mv = await moneyViewForReq(req, db);
    const now = new Date();

    // ---- fetch utama ----
    const [rawEmps, unitsAll, officesAll, attsAll, clocksAll, otsAll, dayTypesAll, holidaysAll, leaveReqsAll, leaveTypesAll, company] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          id: true, employeeNo: true, fullName: true, gender: true, joinDate: true,
          endDate: true, status: true, orgUnitId: true, companyOfficeId: true,
          assignments: {
            where: { validTo: null },
            select: { employmentStatus: true, baseSalary: true, validFrom: true },
            orderBy: { validFrom: "desc" },
            take: 1,
          },
        },
      }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true } }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, active: true } }),
      db.attendanceDaily.findMany({
        select: {
          employeeId: true, workDate: true, dayTypeId: true, status: true, presence: true,
          checkIn: true, checkOut: true, lateMinutes: true, earlyMinutes: true,
          workMinutes: true, normalMinutes: true, absenceMinutes: true, overtimeMinutes: true,
          revised: true, revisedBy: true, notes: true,
        },
        orderBy: [{ workDate: "asc" }, { employeeId: "asc" }],
      }),
      db.attendanceClockLog.findMany({
        select: { employeeId: true, timestamp: true, direction: true, source: true, latitude: true, longitude: true },
        orderBy: { timestamp: "asc" },
      }),
      db.overtimeOrder.findMany({
        select: {
          id: true, orderNo: true, employeeId: true, overtimeDate: true, timeFrom: true, timeTo: true,
          planMinutes: true, actualMinutes: true, verifiedMinutes: true, dayCategory: true, rateMultiplier: true,
          reason: true, status: true, approverId: true, decidedAt: true,
        },
        orderBy: [{ overtimeDate: "desc" }, { orderNo: "desc" }],
      }),
      db.workDayType.findMany({
        select: { id: true, code: true, name: true, category: true, timeIn: true, timeOut: true, nextDay: true, normalMinutes: true, toleranceLateMinutes: true, toleranceEarlyMinutes: true, flexible: true },
      }),
      db.holidayDate.findMany({ select: { date: true, name: true, kind: true } }),
      db.leaveRequest.findMany({
        where: { status: { in: ["Approved", "MassLeave"] } },
        select: { employeeId: true, dateFrom: true, dateTo: true, workingDays: true, leaveTypeId: true },
      }),
      db.leaveType.findMany({ select: { id: true, code: true, name: true } }),
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    ]);

    // ---- maps ----
    const unitById = new Map(unitsAll.map((u) => [u.id, u]));
    const officeById = new Map(officesAll.map((o) => [o.id, o]));
    const dtById = new Map(dayTypesAll.map((d) => [d.id, d]));
    // jenis cuti sakit (CT-SAKIT — T112) utk split kolom Sakit pada R1.1
    const sickTypeIds = new Set(
      leaveTypesAll
        .filter((t) => t.code === "CT-SAKIT" || /sakit/i.test(t.name))
        .map((t) => t.id),
    );

    // ---- normalisasi karyawan + filter cakupan ----
    interface EnrEmp {
      id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
      status: string; orgUnitId: string | null; companyOfficeId: string | null;
      employmentStatus: string; monthlySalary: number;
    }
    const emps: EnrEmp[] = rawEmps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender,
      joinDate: e.joinDate, status: e.status, orgUnitId: e.orgUnitId, companyOfficeId: e.companyOfficeId,
      employmentStatus: e.assignments[0]?.employmentStatus ?? "Tanpa data",
      monthlySalary: e.assignments[0]?.baseSalary ? tc.decryptMoney(e.assignments[0].baseSalary) ?? 0 : 0,
    }));
    const empById = new Map(emps.map((e) => [e.id, e]));
    const empNameById = new Map(emps.map((e) => [e.id, e.fullName]));

    const unitSubtreeIds = (rootId: string): Set<string> => {
      const ids = new Set<string>();
      const walk = (pid: string) => {
        ids.add(pid);
        for (const u of unitsAll) if (u.parentId === pid) walk(u.id);
      };
      walk(rootId);
      return ids;
    };

    const scopedUnitIds = fp.unit ? unitSubtreeIds(fp.unit) : null;
    const scoped = emps.filter((e) =>
      (!fp.office || e.companyOfficeId === fp.office)
      && (!scopedUnitIds || (!!e.orgUnitId && scopedUnitIds.has(e.orgUnitId))),
    );
    const scopedIds = new Set(scoped.map((e) => e.id));
    const active = scoped.filter((e) => e.status === "Active");
    const unitName = (id: string | null) => (id ? unitById.get(id)?.name ?? null : null);
    const sortByNo = (a: { employeeNo: string }, b: { employeeNo: string }) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // permintaan cuti sakit ter-scope (R1.1 — kolom Sakit)
    const sickReqs = leaveReqsAll
      .filter((r) => sickTypeIds.has(r.leaveTypeId) && scopedIds.has(r.employeeId))
      .map((r) => ({ employeeId: r.employeeId, dateFrom: new Date(r.dateFrom), dateTo: new Date(r.dateTo), workingDays: r.workingDays }));

    // ---- rekap harian ter-scope ----
    interface AttRow {
      emp: EnrEmp; workDate: Date; dayTypeId: string | null;
      status: string; presence: number;
      checkIn: Date | null; checkOut: Date | null;
      lateMinutes: number; earlyMinutes: number;
      workMinutes: number; normalMinutes: number; absenceMinutes: number; overtimeMinutes: number;
      revised: boolean; revisedBy: string | null; notes: string | null;
      dayType: { code: string; name: string; category: string; timeIn: string | null; timeOut: string | null; nextDay: boolean; toleranceLateMinutes: number } | null;
    }
    const atts: AttRow[] = attsAll
      .filter((a) => scopedIds.has(a.employeeId))
      .map((a) => {
        const dt = a.dayTypeId ? dtById.get(a.dayTypeId) : undefined;
        return {
          emp: empById.get(a.employeeId)!, workDate: new Date(a.workDate), dayTypeId: a.dayTypeId,
          status: a.status, presence: a.presence, checkIn: a.checkIn ? new Date(a.checkIn) : null,
          checkOut: a.checkOut ? new Date(a.checkOut) : null,
          lateMinutes: a.lateMinutes, earlyMinutes: a.earlyMinutes,
          workMinutes: a.workMinutes, normalMinutes: a.normalMinutes, absenceMinutes: a.absenceMinutes, overtimeMinutes: a.overtimeMinutes,
          revised: a.revised, revisedBy: a.revisedBy, notes: a.notes,
          dayType: dt ? { code: dt.code, name: dt.name, category: dt.category, timeIn: dt.timeIn, timeOut: dt.timeOut, nextDay: dt.nextDay, toleranceLateMinutes: dt.toleranceLateMinutes } : null,
        };
      })
      .filter((a) => !!a.emp);

    // ---- clock log ter-scope ----
    interface ClockRow { emp: EnrEmp; timestamp: Date; direction: string; source: string; lat: number | null; lng: number | null }
    const clocks: ClockRow[] = clocksAll
      .filter((c) => scopedIds.has(c.employeeId))
      .map((c) => ({
        emp: empById.get(c.employeeId)!, timestamp: new Date(c.timestamp), direction: c.direction,
        source: c.source, lat: c.latitude, lng: c.longitude,
      }))
      .filter((c) => !!c.emp);

    // ---- perintah lembur ter-scope + status ----
    interface OtRow {
      id: string; orderNo: string; emp: EnrEmp; overtimeDate: Date; timeFrom: Date; timeTo: Date;
      planMinutes: number; actualMinutes: number; verifiedMinutes: number;
      dayCategory: string; rateMultiplier: number; reason: string | null;
      status: string; approver: string | null; decidedAt: Date | null;
    }
    const ots: OtRow[] = otsAll
      .filter((o) => scopedIds.has(o.employeeId))
      .filter((o) => !fp.otStatus || o.status === fp.otStatus)
      .map((o) => ({
        id: o.id, orderNo: o.orderNo, emp: empById.get(o.employeeId)!,
        overtimeDate: new Date(o.overtimeDate), timeFrom: new Date(o.timeFrom), timeTo: new Date(o.timeTo),
        planMinutes: o.planMinutes, actualMinutes: o.actualMinutes, verifiedMinutes: o.verifiedMinutes,
        dayCategory: o.dayCategory, rateMultiplier: o.rateMultiplier, reason: o.reason,
        status: o.status, approver: o.approverId ? empNameById.get(o.approverId) ?? null : null,
        decidedAt: o.decidedAt ? new Date(o.decidedAt) : null,
      }))
      .filter((o) => !!o.emp);

    // ---- lokasi kerja berkoordinat (geofence) ----
    const geoLocs = (await db.workLocation.findMany({
      where: { active: true, latitude: { not: null }, longitude: { not: null } },
      select: { name: true, latitude: true, longitude: true, radiusMeters: true },
    })) as { name: string; latitude: number; longitude: number; radiusMeters: number | null }[];

    const fromD = fp.from ? new Date(`${fp.from}T00:00:00Z`) : null;
    const toD = fp.to ? new Date(`${fp.to}T23:59:59Z`) : null;

    // ---- hari libur (map tanggal → nama) ----
    const holidayByDate = new Map<string, { name: string; kind: string }>();
    for (const h of holidaysAll) {
      const d = new Date(h.date);
      holidayByDate.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`, { name: h.name, kind: h.kind });
    }

    // ---- aturan & cap lembur ----
    const rule = await getRule(db);
    const caps = await overtimeCaps(db);
    const capsModeLabel = caps.otCapMode === "KEPMEN102" ? "Kepmen 102/2004" : caps.otCapMode === "CUSTOM" ? "Kebijakan Khusus" : "PP 35/2021";

    // ---- chip parameter terpasang (kop dokumen) ----
    const filterChips: { label: string; value: string }[] = [];
    if (fp.office) {
      const o = officeById.get(fp.office);
      if (o) filterChips.push({ label: "Cabang", value: `${o.name}${o.city ? ` — ${o.city}` : ""}` });
    }
    if (fp.unit) {
      const u = unitById.get(fp.unit);
      if (u) filterChips.push({ label: "Unit", value: u.name });
    }
    if (fp.otStatus) filterChips.push({ label: "Status Lembur", value: OT_STATUS_LABELS[fp.otStatus] ?? fp.otStatus });
    if (fp.month) {
      const [yy, mm] = fp.month.split("-").map(Number);
      filterChips.push({ label: "Bulan Data", value: `${MONTHS_ID[mm - 1]} ${yy}` });
    }
    if (fp.date) filterChips.push({ label: "Tanggal Data", value: dateID(new Date(`${fp.date}T00:00:00Z`)) });
    if (fp.year) filterChips.push({ label: "Tahun Data", value: String(fp.year) });
    if (fp.from || fp.to) {
      const fd = fp.from ? dateID(new Date(`${fp.from}T00:00:00Z`)) : "awal riwayat";
      const td = fp.to ? dateID(new Date(`${fp.to}T00:00:00Z`)) : dateID(now);
      filterChips.push({ label: "Rentang Tanggal", value: `${fd} – ${td}` });
    }
    if (fp.exception.length) filterChips.push({ label: "Jenis Anomali", value: fp.exception.map((x) => EXC_LABELS[x]?.[0] ?? x).join(", ") });

    const activeOffices = officesAll.filter((o) => o.active);
    const meta = {
      companyName: company?.name ?? "Perusahaan",
      companyAddress: company?.address ?? null,
      companyCity: company?.city ?? null,
      companyTaxId: company?.taxId ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      branchLabel: fp.office
        ? officeById.get(fp.office)?.name ?? "Semua Cabang & Lokasi Kerja"
        : activeOffices.length === 1 ? activeOffices[0].name : "Semua Cabang & Lokasi Kerja",
      printedBy: m.actor.name,
      generatedAt: now.toISOString(),
      year: now.getFullYear(),
      scope: scope.all ? "all" : "scoped",
      filters: filterChips,
    };

    // ---- konteks builder ----
    const ctx: Ctx = {
      db, scoped, active, atts, clocks, ots, now, fp, meta, tc, mv,
      unitName, sortByNo, fromD, toD, holidayByDate, rule, caps, capsModeLabel, geoLocs,
      otStatuses: Object.keys(OT_STATUS_LABELS),
      sickReqs,
    };

    const data = buildReport(id, ctx);

    // ---- mode export XLSX ----
    if (sp.get("export") === "xlsx") {
      const sheets = buildSheets(id, data, data.periodLabel);
      const buf = await toXlsxMulti(sheets);
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "AttendanceReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi Attendance (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-attendance-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ tipe konteks ============

interface EnrEmp2 {
  id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
  status: string; orgUnitId: string | null; companyOfficeId: string | null;
  employmentStatus: string; monthlySalary: number;
}

interface AttRow2 {
  emp: EnrEmp2; workDate: Date; dayTypeId: string | null;
  status: string; presence: number;
  checkIn: Date | null; checkOut: Date | null;
  lateMinutes: number; earlyMinutes: number;
  workMinutes: number; normalMinutes: number; absenceMinutes: number; overtimeMinutes: number;
  revised: boolean; revisedBy: string | null; notes: string | null;
  dayType: { code: string; name: string; category: string; timeIn: string | null; timeOut: string | null; nextDay: boolean; toleranceLateMinutes: number } | null;
}

interface ClockRow2 { emp: EnrEmp2; timestamp: Date; direction: string; source: string; lat: number | null; lng: number | null }

interface OtRow2 {
  id: string; orderNo: string; emp: EnrEmp2; overtimeDate: Date; timeFrom: Date; timeTo: Date;
  planMinutes: number; actualMinutes: number; verifiedMinutes: number;
  dayCategory: string; rateMultiplier: number; reason: string | null;
  status: string; approver: string | null; decidedAt: Date | null;
}

interface Ctx {
  db: TenantDb;
  scoped: EnrEmp2[];
  active: EnrEmp2[];
  atts: AttRow2[];
  clocks: ClockRow2[];
  ots: OtRow2[];
  now: Date;
  fp: ReportFilters;
  meta: {
    companyName: string; companyAddress: string | null; companyCity: string | null;
    companyTaxId: string | null; companyLogoUrl: string | null; branchLabel: string;
    printedBy: string; generatedAt: string; year: number; scope: string;
    filters: { label: string; value: string }[];
  };
  tc: ReturnType<typeof tenantCryptoForDb>;
  mv: Awaited<ReturnType<typeof moneyViewForReq>>;
  unitName: (id: string | null) => string | null;
  sortByNo: (a: { employeeNo: string }, b: { employeeNo: string }) => number;
  fromD: Date | null;
  toD: Date | null;
  holidayByDate: Map<string, { name: string; kind: string }>;
  rule: Awaited<ReturnType<typeof getRule>>;
  caps: Awaited<ReturnType<typeof overtimeCaps>>;
  capsModeLabel: string;
  geoLocs: { name: string; latitude: number; longitude: number; radiusMeters: number | null }[];
  otStatuses: string[];
  /** permintaan cuti sakit ter-scope (R1.1 kolom Sakit). */
  sickReqs: { employeeId: string; dateFrom: Date; dateTo: Date; workingDays: number }[];
}

function buildReport(id: string, ctx: Ctx): { periodLabel: string; payload: unknown } {
  switch (id) {
    case "ar11": return ar11Monthly(ctx);
    case "ar12": return ar12Daily(ctx);
    case "ar13": return ar13Geo(ctx);
    case "ar21": return ar21LateEarly(ctx);
    case "ar22": return ar22Deficit(ctx);
    case "ar23": return ar23Offenders(ctx);
    case "ar31": return ar31OtSummary(ctx);
    case "ar32": return ar32OtPay(ctx);
    case "ar33": return ar33OtCompliance(ctx);
    case "ar41": return ar41Roster(ctx);
    case "ar42": return ar42Night(ctx);
    default: return ar43Exception(ctx);
  }
}

// ===================== G1 — REKAPITULASI PRESENSI BERKALA =====================

/** Rentang bulan lokal (UTC-naive) dari "YYYY-MM". */
function monthRange(ym: string): { from: Date; to: Date } {
  const [y, m] = ym.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0, 23, 59, 59)) };
}

// ---------- AR1.1 Monthly Attendance Summary Roll ----------
function ar11Monthly(ctx: Ctx) {
  const ym = ctx.fp.month ?? `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, "0")}`;
  const { from, to } = monthRange(ym);
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  // hari cuti sakit per karyawan dalam bulan (CT-SAKIT — dari leaveRequest global)
  const sickByEmp = sickDaysInMonth(ctx, from, to);

  const perEmp = new Map<string, {
    emp: EnrEmp2; scheduled: number; present: number; lateDays: number; lateMinutes: number;
    onLeave: number; workoff: number; absent: number; off: number; workMinutes: number; overtimeMinutes: number;
  }>();
  for (const r of rows) {
    let c = perEmp.get(r.emp.id);
    if (!c) {
      c = { emp: r.emp, scheduled: 0, present: 0, lateDays: 0, lateMinutes: 0, onLeave: 0, workoff: 0, absent: 0, off: 0, workMinutes: 0, overtimeMinutes: 0 };
      perEmp.set(r.emp.id, c);
    }
    const isWorkday = r.dayType?.category === "Workday";
    if (r.status === "Present") { c.present += 1; if (isWorkday) c.scheduled += 1; }
    else if (r.status === "Late") { c.present += 1; c.lateDays += 1; c.lateMinutes += r.lateMinutes; if (isWorkday) c.scheduled += 1; }
    else if (r.status === "Absent") { c.absent += 1; if (isWorkday) c.scheduled += 1; }
    else if (r.status === "OnLeave") { c.onLeave += 1; if (isWorkday) c.scheduled += 1; }
    else if (r.status === "WorkOff") { c.workoff += 1; if (isWorkday) c.scheduled += 1; }
    else c.off += 1;
    c.workMinutes += r.workMinutes;
    c.overtimeMinutes += r.overtimeMinutes;
  }

  const out = [...perEmp.values()].map((c) => {
    const sick = sickByEmp.get(c.emp.id) ?? 0;
    const leaveOther = Math.max(0, c.onLeave - sick);
    const hadir = c.present + c.lateDays;
    return {
      employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: ctx.unitName(c.emp.orgUnitId),
      employmentStatus: c.emp.employmentStatus,
      scheduled: c.scheduled, present: hadir, lateDays: c.lateDays, lateMinutes: c.lateMinutes,
      sick, leaveOther, workoff: c.workoff, absent: c.absent, off: c.off,
      workHours: round1(c.workMinutes / 60), overtimeHours: round1(c.overtimeMinutes / 60),
      attendanceRate: hadir + c.absent > 0 ? round1((hadir / (hadir + c.absent)) * 100) : null,
    };
  }).sort((a, b) => (a.unit ?? "").localeCompare(b.unit ?? "") || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));

  // hari kerja terjadwal (level perusahaan) = MODUS jumlah hari terjadwal
  // per karyawan — union semua tanggal akan menghitung hari Sabtu/Minggu
  // karyawan shift rotasi sebagai "hari kerja" seluruh perusahaan.
  const schedCount = new Map<number, number>();
  for (const r of out) schedCount.set(r.scheduled, (schedCount.get(r.scheduled) ?? 0) + 1);
  let workdays = 0;
  let bestN = -1;
  for (const [d, n] of schedCount) {
    if (n > bestN || (n === bestN && d > workdays)) { workdays = d; bestN = n; }
  }
  const sum = {
    scheduled: out.reduce((s, r) => s + r.scheduled, 0), present: out.reduce((s, r) => s + r.present, 0),
    lateDays: out.reduce((s, r) => s + r.lateDays, 0), lateMinutes: out.reduce((s, r) => s + r.lateMinutes, 0),
    sick: out.reduce((s, r) => s + r.sick, 0), leaveOther: out.reduce((s, r) => s + r.leaveOther, 0),
    workoff: out.reduce((s, r) => s + r.workoff, 0), absent: out.reduce((s, r) => s + r.absent, 0),
    off: out.reduce((s, r) => s + r.off, 0),
    workHours: round1(out.reduce((s, r) => s + r.workHours, 0)), overtimeHours: round1(out.reduce((s, r) => s + r.overtimeHours, 0)),
  };
  const [yy, mm] = ym.split("-").map(Number);
  return {
    periodLabel: `${MONTHS_ID[mm - 1]} ${yy} — ${workdays} hari kerja terjadwal`,
    payload: { month: `${MONTHS_ID[mm - 1]} ${yy}`, workdays, rows: out, total: out.length, sum },
  };
}

/** Hari sakit (CT-SAKIT Approved/MassLeave) beririsan [from,to] per karyawan. */
function sickDaysInMonth(ctx: Ctx, from: Date, to: Date): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of ctx.sickReqs) {
    if (!overlapDays(r.dateFrom, r.dateTo, from, to)) continue;
    const o1 = Math.max(r.dateFrom.getTime(), from.getTime());
    const o2 = Math.min(r.dateTo.getTime(), to.getTime());
    const calDays = Math.floor((o2 - o1) / DAY_MS) + 1;
    const days = Math.max(0, Math.min(r.workingDays > 0 ? r.workingDays : calDays, calDays));
    map.set(r.employeeId, (map.get(r.employeeId) ?? 0) + days);
  }
  return map;
}

// ---------- AR1.2 Daily Attendance Timesheet ----------
function ar12Daily(ctx: Ctx) {
  const dateStr = ctx.fp.date ?? new Date().toISOString().slice(0, 10);
  const day = new Date(`${dateStr}T00:00:00Z`);
  const next = addDaysU(day, 1);
  const rows = ctx.atts
    .filter((a) => a.workDate >= day && a.workDate < next && a.emp.status === "Active")
    .sort((a, b) => (a.emp.orgUnitId ? ctx.unitName(a.emp.orgUnitId) ?? "" : "").localeCompare(b.emp.orgUnitId ? ctx.unitName(b.emp.orgUnitId) ?? "" : "") || ctx.sortByNo(a.emp, b.emp));

  // lokasi check-in per (karyawan, tanggal) — dari clock log berkoordinat
  const locByEmp = new Map<string, string>();
  for (const c of ctx.clocks) {
    if (c.direction !== "IN" || c.timestamp < day || c.timestamp >= next || c.lat == null || c.lng == null) continue;
    const loc = nearestLoc(ctx, c.lat, c.lng);
    if (loc) locByEmp.set(c.emp.id, loc.label);
  }

  const items = rows.map((r) => ({
    employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: ctx.unitName(r.emp.orgUnitId),
    dayTypeCode: r.dayType?.code ?? null,
    shift: r.dayType?.timeIn && r.dayType?.timeOut ? `${r.dayType.timeIn}–${r.dayType.timeOut}` : null,
    checkIn: hm(r.checkIn), checkOut: hm(r.checkOut),
    lateMinutes: r.lateMinutes, earlyMinutes: r.earlyMinutes,
    workHours: r.checkIn && r.checkOut ? round1(r.workMinutes / 60) : null,
    location: locByEmp.get(r.emp.id) ?? null,
    status: r.status, notes: r.notes,
  }));
  const counts = {
    present: items.filter((i) => i.status === "Present").length,
    late: items.filter((i) => i.status === "Late").length,
    absent: items.filter((i) => i.status === "Absent").length,
    off: items.filter((i) => i.status === "Off" || i.status === "Holiday").length,
    onLeave: items.filter((i) => i.status === "OnLeave").length,
    workoff: items.filter((i) => i.status === "WorkOff").length,
  };
  const hadir = counts.present + counts.late;
  const onTimePct = hadir > 0 ? round1((counts.present / hadir) * 100) : null;
  return {
    periodLabel: `Timesheet harian — ${dateID(day)}`,
    payload: { date: iso(day), dateLabel: dateID(day), rows: items, counts, onTimePct },
  };
}

/** Lokasi terdekat + label geofence utk satu koordinat. */
function nearestLoc(ctx: Ctx, lat: number, lng: number): { name: string; distance: number; radius: number; within: boolean; label: string } | null {
  let best: { name: string; distance: number; radius: number } | null = null;
  for (const l of ctx.geoLocs) {
    const d = haversineM(lat, lng, l.latitude, l.longitude);
    if (!best || d < best.distance) best = { name: l.name, distance: d, radius: l.radiusMeters ?? 200 };
  }
  if (!best) return null;
  const within = best.distance <= best.radius;
  const distLabel = best.distance < 1000 ? `${Math.round(best.distance)} m` : `${round1(best.distance / 1000)} km`;
  const label = within
    ? `Di radius — ${best.name} (${distLabel})`
    : `Di luar radius — ${distLabel} dari ${best.name}`;
  return { ...best, within, label };
}

// ---------- AR1.3 Multi-Location / Geofencing Attendance Sheet ----------
function ar13Geo(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const geo = ctx.clocks.filter((c) => c.lat != null && c.lng != null && c.timestamp >= from && c.timestamp <= to);

  const items = geo.map((c) => {
    const loc = nearestLoc(ctx, c.lat as number, c.lng as number);
    return {
      employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: ctx.unitName(c.emp.orgUnitId),
      date: dayStartU(c.timestamp).toISOString().slice(0, 10), time: hm(c.timestamp) ?? "—",
      direction: c.direction as "IN" | "OUT", source: c.source,
      lat: round2(c.lat as number), lng: round2(c.lng as number),
      nearestName: loc?.name ?? null, distanceM: loc ? Math.round(loc.distance) : null,
      radiusM: loc?.radius ?? null, within: loc?.within ?? false,
      locationLabel: loc?.label ?? "Tanpa lokasi terdaftar",
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }) || a.time.localeCompare(b.time));

  const byLoc = new Map<string, { name: string; punches: number; employees: Set<string> }>();
  for (const i of items) {
    const key = i.within ? i.nearestName ?? "Lainnya" : "Di luar radius";
    let c = byLoc.get(key);
    if (!c) { c = { name: key, punches: 0, employees: new Set() }; byLoc.set(key, c); }
    c.punches += 1;
    c.employees.add(i.employeeNo);
  }
  const within = items.filter((i) => i.within).length;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      byLocation: [...byLoc.values()].map((b) => ({ name: b.name, punches: b.punches, employees: b.employees.size })).sort((a, b) => b.punches - a.punches),
      total: items.length, within, outside: items.length - within,
      employees: new Set(items.map((i) => i.employeeNo)).size,
      locationsCount: ctx.geoLocs.length,
    },
  };
}

// ===================== G2 — KETERLAMBATAN & JAM KERJA KURANG =====================

// ---------- AR2.1 Late Arrival & Early Leaver Log ----------
function ar21LateEarly(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const items = ctx.atts
    .filter((a) => a.workDate >= from && a.workDate <= to && (a.lateMinutes > 0 || a.earlyMinutes > 0))
    .map((a) => {
      const late = a.lateMinutes > 0;
      const severity = late && a.lateMinutes > 30 ? "tinggi" : late && a.lateMinutes > 15 ? "sedang" : "ringan";
      return {
        date: dayStartU(a.workDate).toISOString().slice(0, 10),
        employeeNo: a.emp.employeeNo, name: a.emp.fullName, unit: ctx.unitName(a.emp.orgUnitId),
        dayTypeCode: a.dayType?.code ?? null,
        plannedIn: a.dayType?.timeIn ?? null, actualIn: hm(a.checkIn),
        lateMinutes: a.lateMinutes,
        plannedOut: a.dayType?.timeOut ?? null, actualOut: hm(a.checkOut),
        earlyMinutes: a.earlyMinutes,
        severity: severity as "tinggi" | "sedang" | "ringan",
        note: a.notes,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.lateMinutes - a.lateMinutes || b.earlyMinutes - a.earlyMinutes);

  const lateRows = items.filter((i) => i.lateMinutes > 0);
  const earlyRows = items.filter((i) => i.earlyMinutes > 0);
  const perEmp = new Map<string, { employeeNo: string; name: string; lateCount: number; lateMinutes: number }>();
  for (const i of lateRows) {
    const c = perEmp.get(i.employeeNo) ?? { employeeNo: i.employeeNo, name: i.name, lateCount: 0, lateMinutes: 0 };
    c.lateCount += 1; c.lateMinutes += i.lateMinutes;
    perEmp.set(i.employeeNo, c);
  }
  const worst = [...perEmp.values()].sort((a, b) => b.lateMinutes - a.lateMinutes)[0] ?? null;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      lateCount: lateRows.length, lateMinutes: lateRows.reduce((s, i) => s + i.lateMinutes, 0),
      earlyCount: earlyRows.length, earlyMinutes: earlyRows.reduce((s, i) => s + i.earlyMinutes, 0),
      avgLate: lateRows.length ? Math.round(lateRows.reduce((s, i) => s + i.lateMinutes, 0) / lateRows.length) : 0,
      worst: worst ? { ...worst } : null,
    },
  };
}

// ---------- AR2.2 Working Hours Deficit Report ----------
function ar22Deficit(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  const perEmp = new Map<string, { emp: EnrEmp2; workdays: number; target: number; actual: number }>();
  for (const r of rows) {
    // hari cuti/izin ditutup (OnLeave/WorkOff) BUKAN ukuran defisit jam kerja —
    // target = normal + absen per hari kerja efektif (Present/Late/Absent).
    if (r.dayType?.category !== "Workday" || r.status === "OnLeave" || r.status === "WorkOff") continue;
    let c = perEmp.get(r.emp.id);
    if (!c) { c = { emp: r.emp, workdays: 0, target: 0, actual: 0 }; perEmp.set(r.emp.id, c); }
    c.workdays += 1;
    // Present/Late: normal + absence = target penuh; Absent: absence = target.
    // Fallback non-clocking dgn jam (ByHours): pakai workMinutes sbg target.
    const dayTarget = r.normalMinutes + r.absenceMinutes > 0
      ? r.normalMinutes + r.absenceMinutes
      : r.workMinutes;
    c.target += dayTarget;
    c.actual += r.workMinutes;
  }

  const out = [...perEmp.values()].map((c) => {
    const targetH = round1(c.target / 60);
    const actualH = round1(c.actual / 60);
    const deficit = round1(Math.max(0, c.target - c.actual) / 60);
    const achievement = c.target > 0 ? round1((c.actual / c.target) * 100) : null;
    const status = achievement == null ? "ok" : achievement >= 97.5 ? "ok" : achievement >= 90 ? "watch" : "deficit";
    return {
      employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: ctx.unitName(c.emp.orgUnitId),
      workdays: c.workdays, targetHours: targetH, actualHours: actualH, deficitHours: deficit,
      avgPerDay: c.workdays > 0 ? round1((c.actual / 60) / c.workdays) : 0,
      achievement, status: status as "ok" | "watch" | "deficit",
    };
  }).sort((a, b) => b.deficitHours - a.deficitHours || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));

  const totalTarget = out.reduce((s, r) => s + r.targetHours, 0);
  const totalActual = out.reduce((s, r) => s + r.actualHours, 0);
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — standar ${round1(40)} jam/minggu (8 jam/hari × 5 hari)`,
    payload: {
      rows: out,
      totalTarget: round1(totalTarget), totalActual: round1(totalActual),
      totalDeficit: round1(out.reduce((s, r) => s + r.deficitHours, 0)),
      achievement: totalTarget > 0 ? round1((totalActual / totalTarget) * 100) : null,
      deficitEmployees: out.filter((r) => r.status === "deficit").length,
      standardHoursPerWeek: 40,
    },
  };
}

// ---------- AR2.3 Top Attendance Offenders Sheet ----------
function ar23Offenders(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  const perEmp = new Map<string, {
    emp: EnrEmp2; lateCount: number; lateMinutes: number; absentDays: number; workoffDays: number; leaveDays: number;
  }>();
  for (const r of rows) {
    let c = perEmp.get(r.emp.id);
    if (!c) {
      c = { emp: r.emp, lateCount: 0, lateMinutes: 0, absentDays: 0, workoffDays: 0, leaveDays: 0 };
      perEmp.set(r.emp.id, c);
    }
    if (r.lateMinutes > 0) { c.lateCount += 1; c.lateMinutes += r.lateMinutes; }
    if (r.status === "Absent") c.absentDays += 1;
    else if (r.status === "WorkOff") c.workoffDays += 1;
    else if (r.status === "OnLeave") c.leaveDays += 1;
  }

  const out = [...perEmp.values()].map((c) => {
    const violations = c.lateCount + c.absentDays;
    const points = c.lateCount * 1 + c.absentDays * 3; // alpa berbobot 3× telat
    let recommendation = "Pemantauan rutin";
    let action = "Tidak ada tindakan — pertahankan kedisiplinan.";
    if (c.absentDays >= 5 || points >= 12) {
      recommendation = "SP tingkat lanjut (SP2/SP3)";
      action = "Panggilan disciplin committee; siapkan SP2/SP3 — UU 13/2003 Ps.158 & PP 36/2021.";
    } else if (c.absentDays >= 3) {
      recommendation = "SP1 — Surat Peringatan Pertama";
      action = "Terbitkan SP1 + konseling atasan langsung (alpa beruntun).";
    } else if (points >= 6 || c.lateCount >= 5) {
      recommendation = "Teguran & konseling";
      action = "Teguran tertulis dari atasan + konseling HR; pantau 30 hari.";
    } else if (violations > 0) {
      recommendation = "Pemantauan";
      action = "Catat pada file karyawan; teguran lisan bila berulang.";
    }
    return {
      employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: ctx.unitName(c.emp.orgUnitId),
      lateCount: c.lateCount, lateMinutes: c.lateMinutes, absentDays: c.absentDays,
      workoffDays: c.workoffDays, leaveDays: c.leaveDays,
      violations, points,
      recommendation, action,
    };
  })
    .filter((r) => r.violations > 0)
    .sort((a, b) => b.points - a.points || b.violations - a.violations || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }))
    .slice(0, 20)
    .map((r, i) => ({ rank: i + 1, ...r }));

  const recs = ["SP tingkat lanjut (SP2/SP3)", "SP1 — Surat Peringatan Pertama", "Teguran & konseling", "Pemantauan"];
  const byRec = recs.map((rec) => ({ recommendation: rec, count: out.filter((o) => o.recommendation === rec).length }));
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      rows: out,
      flagged: out.length,
      byRec,
      totalLate: out.reduce((s, r) => s + r.lateCount, 0),
      totalAbsent: out.reduce((s, r) => s + r.absentDays, 0),
    },
  };
}

// ===================== G3 — LEMBUR & JAM KERJA EFEKTIF =====================

// ---------- AR3.1 Overtime Summary Report ----------
function ar31OtSummary(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const items = ctx.ots
    .filter((o) => o.overtimeDate >= dayStartU(from) && o.overtimeDate <= dayStartU(to))
    .map((o) => ({
      orderNo: o.orderNo, date: dayStartU(o.overtimeDate).toISOString().slice(0, 10),
      employeeNo: o.emp.employeeNo, name: o.emp.fullName, unit: ctx.unitName(o.emp.orgUnitId),
      dayCategory: o.dayCategory,
      window: `${hm(o.timeFrom) ?? "—"}–${hm(o.timeTo) ?? "—"}`,
      planHours: round1(o.planMinutes / 60), actualHours: round1(o.actualMinutes / 60), verifiedHours: round1(otEffectiveMinutes(o) / 60),
      rateMultiplier: o.rateMultiplier, status: o.status, approver: o.approver, reason: o.reason,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.orderNo.localeCompare(b.orderNo));

  const cats = ["Weekday", "Weekend", "Holiday"];
  const byCategory = cats.map((c) => {
    const rows = items.filter((i) => i.dayCategory === c);
    return { dayCategory: c, label: DAYCAT_LABELS[c] ?? c, count: rows.length, verifiedHours: round1(rows.reduce((s, i) => s + i.verifiedHours, 0)) };
  }).filter((c) => c.count > 0);
  const stats = ["Pending", "Approved", "Paid", "Rejected", "Cancelled"];
  const byStatus = stats.map((s) => {
    const n = items.filter((i) => i.status === s).length;
    return { status: s, label: OT_STATUS_LABELS[s] ?? s, count: n };
  }).filter((s) => s.count > 0);

  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      byCategory, byStatus,
      totalOrders: items.length,
      totalVerifiedHours: round1(items.reduce((s, i) => s + i.verifiedHours, 0)),
      employees: new Set(items.map((i) => i.employeeNo)).size,
    },
  };
}

// ---------- AR3.2 Overtime Financial Estimate Sheet ----------
function ar32OtPay(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const orders = ctx.ots
    .filter((o) => o.overtimeDate >= dayStartU(from) && o.overtimeDate <= dayStartU(to) && otEffectiveMinutes(o) > 0);

  const items = orders.map((o) => {
    const effMin = otEffectiveMinutes(o);
    const pay = canSee && o.emp.monthlySalary > 0
      ? overtimePayFor(o.emp.monthlySalary, effMin, o.dayCategory, {
        roundingMinutes: ctx.rule.overtimeRoundingMinutes, minMinutes: ctx.rule.minOvertimeMinutes,
      })
      : null;
    const hourIndex = Math.ceil(effMin / 60);
    return {
      orderNo: o.orderNo, date: dayStartU(o.overtimeDate).toISOString().slice(0, 10),
      employeeNo: o.emp.employeeNo, name: o.emp.fullName, unit: ctx.unitName(o.emp.orgUnitId),
      dayCategory: o.dayCategory,
      verifiedHours: round1(effMin / 60),
      monthlySalary: canSee && o.emp.monthlySalary > 0 ? Math.round(o.emp.monthlySalary) : null,
      hourlyRate: canSee && o.emp.monthlySalary > 0 ? Math.round(o.emp.monthlySalary / 173) : null,
      estimatedPay: pay,
      indexNote: `${DAYCAT_LABELS[o.dayCategory] ?? o.dayCategory} — maks ${hourIndex} jam: ${o.dayCategory === "Weekday" ? "1,5× jam ke-1, 2× berikutnya" : o.dayCategory === "Weekend" ? "2× 8 jam pertama, 3× berikutnya" : "2× 7 jam pertama, 3× jam ke-8, 4× berikutnya"}`,
      status: o.status,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.orderNo.localeCompare(b.orderNo));

  const totalPay = canSee ? items.reduce((s, i) => s + (i.estimatedPay ?? 0), 0) : null;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — indeks PP 35/2021 (upah/jam = gaji ÷ 173)`,
    payload: {
      masked: !canSee,
      items,
      totalHours: round1(items.reduce((s, i) => s + i.verifiedHours, 0)),
      totalPay,
      orders: items.length,
      basisNote: "Estimasi = 1/173 × upah/jam × indeks progresif (PP 35/2021 Ps.31). Nilai final mengikuti payroll run.",
    },
  };
}

// ---------- AR3.3 Working Hours Compliance Audit ----------
function ar33OtCompliance(ctx: Ctx) {
  const ym = ctx.fp.month ?? `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, "0")}`;
  const { from, to } = monthRange(ym);
  // order lembur AKTIF (Pending/Approved/Paid) — padanan helper cap service.
  const orders = ctx.ots.filter((o) =>
    ["Pending", "Approved", "Paid"].includes(o.status) && o.overtimeDate >= from && o.overtimeDate <= to);

  const perEmp = new Map<string, { emp: EnrEmp2; byDate: Map<string, number> }>();
  for (const o of orders) {
    let c = perEmp.get(o.emp.id);
    if (!c) { c = { emp: o.emp, byDate: new Map() }; perEmp.set(o.emp.id, c); }
    const k = dayStartU(o.overtimeDate).toISOString().slice(0, 10);
    c.byDate.set(k, (c.byDate.get(k) ?? 0) + otEffectiveMinutes(o));
  }

  const rows = [...perEmp.values()].map((c) => {
    const monthlyMinutes = [...c.byDate.values()].reduce((s, v) => s + v, 0);
    // bucket mingguan (Senin–Minggu)
    const byWeek = new Map<string, number>();
    for (const [d, min] of c.byDate) {
      const day = new Date(`${d}T00:00:00Z`);
      const diff = (day.getUTCDay() + 6) % 7;
      const monday = addDaysU(dayStartU(day), -diff).toISOString().slice(0, 10);
      byWeek.set(monday, (byWeek.get(monday) ?? 0) + min);
    }
    let peakDaily: { date: string; hours: number } | null = null;
    for (const [d, min] of c.byDate) {
      if (!peakDaily || min / 60 > peakDaily.hours) peakDaily = { date: d, hours: round1(min / 60) };
    }
    let peakWeekly: { weekLabel: string; hours: number } | null = null;
    for (const [wk, min] of byWeek) {
      if (!peakWeekly || min / 60 > peakWeekly.hours) {
        const w = new Date(`${wk}T00:00:00Z`);
        const sun = addDaysU(w, 6);
        peakWeekly = { weekLabel: `${dateID(w)} – ${dateID(sun)}`, hours: round1(min / 60) };
      }
    }
    const violations: { type: "daily" | "weekly" | "monthly"; detail: string }[] = [];
    if (peakDaily && peakDaily.hours > ctx.caps.dailyHours) {
      violations.push({ type: "daily", detail: `${dateID(new Date(`${peakDaily.date}T00:00:00Z`))}: ${peakDaily.hours} jam > cap ${ctx.caps.dailyHours} jam/hari` });
    }
    for (const [wk, min] of byWeek) {
      if (min / 60 > ctx.caps.weeklyHours) {
        const w = new Date(`${wk}T00:00:00Z`);
        violations.push({ type: "weekly", detail: `Minggu ${dateID(w)} – ${dateID(addDaysU(w, 6))}: ${round1(min / 60)} jam > cap ${ctx.caps.weeklyHours} jam/minggu` });
      }
    }
    if (ctx.caps.monthlyHours && monthlyMinutes / 60 > ctx.caps.monthlyHours) {
      violations.push({ type: "monthly", detail: `Bulan: ${round1(monthlyMinutes / 60)} jam > cap ${ctx.caps.monthlyHours} jam/bulan` });
    }
    const monthlyHours = round1(monthlyMinutes / 60);
    const weeklyCap = ctx.caps.weeklyHours;
    const status = violations.length > 0 ? "violation" : peakWeekly && peakWeekly.hours >= weeklyCap * 0.8 ? "watch" : "compliant";
    return {
      employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: ctx.unitName(c.emp.orgUnitId),
      monthlyHours, peakDaily, peakWeekly, violations,
      status: status as "compliant" | "watch" | "violation",
    };
  }).sort((a, b) => (a.status === "violation" ? -1 : 1) - (b.status === "violation" ? -1 : 1) || b.monthlyHours - a.monthlyHours || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));

  const compliant = rows.filter((r) => r.status === "compliant").length;
  const violation = rows.filter((r) => r.status === "violation").length;
  const watch = rows.filter((r) => r.status === "watch").length;
  const [yy, mm] = ym.split("-").map(Number);
  return {
    periodLabel: `${MONTHS_ID[mm - 1]} ${yy} — mode ${ctx.capsModeLabel} (${ctx.caps.dailyHours} jam/hari · ${ctx.caps.weeklyHours} jam/minggu)`,
    payload: {
      month: `${MONTHS_ID[mm - 1]} ${yy}`, modeLabel: ctx.capsModeLabel,
      caps: { dailyHours: ctx.caps.dailyHours, weeklyHours: ctx.caps.weeklyHours, monthlyHours: ctx.caps.monthlyHours },
      rows,
      withOt: rows.length, compliant, watch, violation,
      complianceRate: rows.length ? round1((compliant / rows.length) * 100) : null,
      basis: "UU 13/2003 Ps.78 · PP 35/2021 Ps.26–27 · Kepmen 102/2004",
    },
  };
}

// ===================== G4 — VARIASI JADWAL & KERJA SHIFT =====================

// ---------- AR4.1 Roster & Shift Schedule Deviation Report ----------
function ar41Roster(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  const items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    rosterCode: string; rosterShift: string; actualIn: string | null; actualOut: string | null;
    type: "absent" | "late" | "early" | "off-work" | "no-punch";
    detail: string; severity: "tinggi" | "sedang" | "rendah";
  }[] = [];
  let rosterDays = 0;
  for (const r of rows) {
    const isWorkday = r.dayType?.category === "Workday";
    const rosterCode = r.dayType?.code ?? "—";
    const rosterShift = r.dayType?.timeIn && r.dayType?.timeOut ? `${r.dayType.timeIn}–${r.dayType.timeOut}` : "—";
    const base = {
      date: dayStartU(r.workDate).toISOString().slice(0, 10),
      employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: ctx.unitName(r.emp.orgUnitId),
      rosterCode, rosterShift, actualIn: hm(r.checkIn), actualOut: hm(r.checkOut),
    };
    if (isWorkday) {
      rosterDays += 1;
      if (r.status === "Absent" && r.notes !== "Tanpa clock-out") {
        items.push({ ...base, type: "absent", detail: "Tidak hadir sesuai jadwal shift (tanpa izin/cuti tercatat)", severity: "tinggi" });
      } else if (r.status === "Absent" && r.notes === "Tanpa clock-out") {
        items.push({ ...base, type: "no-punch", detail: "Clock-in tercatat namun tanpa clock-out — jam kerja tidak dapat diverifikasi", severity: "sedang" });
      } else if (r.lateMinutes > (r.dayType?.toleranceLateMinutes ?? 0)) {
        items.push({
          ...base, type: "late",
          detail: `Masuk ${hm(r.checkIn)} vs jadwal ${r.dayType?.timeIn} (+${r.lateMinutes} m di luar toleransi ${r.dayType?.toleranceLateMinutes} m)`,
          severity: r.lateMinutes > 30 ? "tinggi" : "sedang",
        });
      } else if (r.earlyMinutes > 0) {
        items.push({
          ...base, type: "early",
          detail: `Pulang ${hm(r.checkOut)} vs jadwal ${r.dayType?.timeOut} (−${r.earlyMinutes} m)`,
          severity: r.earlyMinutes > 60 ? "sedang" : "rendah",
        });
      } else if (r.status === "Present" && !r.checkIn && !r.notes?.startsWith("Non-clocking")) {
        items.push({ ...base, type: "no-punch", detail: `Status hadir tanpa data punch (${r.notes ?? "tanpa keterangan"})`, severity: "rendah" });
      }
    } else if ((r.dayType?.category === "Off" || r.dayType?.category === "Holiday") && r.presence === 1) {
      items.push({
        ...base, type: "off-work",
        detail: `Bekerja pada hari ${r.dayType?.category === "Holiday" ? "libur" : "off"} (${r.notes ?? "perlu SPK lembur"})`,
        severity: "rendah",
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));

  const types: { type: string; label: string }[] = [
    { type: "absent", label: "Tidak Hadir vs Jadwal" },
    { type: "late", label: "Masuk vs Jadwal Shift" },
    { type: "early", label: "Pulang Cepat vs Jadwal" },
    { type: "no-punch", label: "Tanpa Data Punch" },
    { type: "off-work", label: "Bekerja pada Hari Off/Libur" },
  ];
  const byType = types.map((t) => ({ ...t, count: items.filter((i) => i.type === t.type).length }));
  const deviations = items.filter((i) => i.type !== "off-work").length;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      byType,
      total: items.length,
      rosterDays,
      employees: new Set(items.map((i) => i.employeeNo)).size,
      onRosterPct: rosterDays > 0 ? round1(((rosterDays - deviations) / rosterDays) * 100) : null,
    },
  };
}

// ---------- AR4.2 Night Shift & Special Premium Hours Log ----------
function ar42Night(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  const otHoursByEmpDate = new Map<string, number>();
  for (const o of ctx.ots) {
    if (!["Approved", "Paid"].includes(o.status)) continue;
    const k = `${o.emp.id}|${dayStartU(o.overtimeDate).toISOString().slice(0, 10)}`;
    otHoursByEmpDate.set(k, (otHoursByEmpDate.get(k) ?? 0) + otEffectiveMinutes(o) / 60);
  }

  const items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    category: "night" | "holiday"; categoryLabel: string;
    checkIn: string | null; checkOut: string | null; hours: number; otHours: number; premium: boolean;
  }[] = [];
  for (const r of rows) {
    const dateStr = dayStartU(r.workDate).toISOString().slice(0, 10);
    const holiday = ctx.holidayByDate.get(dateStr);
    const night = !!r.dayType && (r.dayType.nextDay || (r.dayType.timeIn ?? "") >= "22:00") && r.dayType.category === "Workday";
    const worked = r.presence === 1 && r.workMinutes > 0;
    if (!worked) continue;
    const otHours = round1(otHoursByEmpDate.get(`${r.emp.id}|${dateStr}`) ?? 0);
    if (night) {
      items.push({
        date: dateStr, employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: ctx.unitName(r.emp.orgUnitId),
        category: "night", categoryLabel: `Shift Malam (${r.dayType?.timeIn}–${r.dayType?.timeOut})`,
        checkIn: hm(r.checkIn), checkOut: hm(r.checkOut),
        hours: round1(r.workMinutes / 60), otHours, premium: true,
      });
    } else if (holiday) {
      items.push({
        date: dateStr, employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: ctx.unitName(r.emp.orgUnitId),
        category: "holiday", categoryLabel: `Hari Libur ${holiday.kind === "Joint" ? "Bersama" : holiday.kind === "Company" ? "Perusahaan" : "Nasional"} — ${holiday.name}`,
        checkIn: hm(r.checkIn), checkOut: hm(r.checkOut),
        hours: round1(r.workMinutes / 60), otHours, premium: true,
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));

  const nightRows = items.filter((i) => i.category === "night");
  const holidayRows = items.filter((i) => i.category === "holiday");
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      nightCount: nightRows.length, nightHours: round1(nightRows.reduce((s, i) => s + i.hours, 0)),
      holidayCount: holidayRows.length, holidayHours: round1(holidayRows.reduce((s, i) => s + i.hours, 0)),
      employees: new Set(items.map((i) => i.employeeNo)).size,
      otVerifiedHours: round1(items.reduce((s, i) => s + i.otHours, 0)),
    },
  };
}

// ---------- AR4.3 Attendance Exception Report ----------
function ar43Exception(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1));
  const to = ctx.toD ?? ctx.now;
  const rows = ctx.atts.filter((a) => a.workDate >= from && a.workDate <= to && a.emp.status === "Active");

  const items: {
    date: string; employeeNo: string; name: string; unit: string | null;
    type: "missing-out" | "no-punch" | "revised";
    typeLabel: string; detail: string; severity: "tinggi" | "sedang" | "rendah"; action: string;
  }[] = [];
  for (const r of rows) {
    const base = {
      date: dayStartU(r.workDate).toISOString().slice(0, 10),
      employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: ctx.unitName(r.emp.orgUnitId),
    };
    if (r.status === "Absent" && r.notes === "Tanpa clock-out" && r.checkIn) {
      items.push({
        ...base, type: "missing-out", typeLabel: EXC_LABELS["missing-out"][0],
        detail: `Clock-in ${hm(r.checkIn)} tercatat tanpa clock-out — hari dihitung absen penuh`,
        severity: "tinggi",
        action: "Minta karyawan melakukan koreksi manual (form timesheet) + verifikasi atasan.",
      });
    } else if (r.status === "Absent" && !r.checkIn && r.dayType?.category === "Workday" && r.notes?.includes("Import mesin")) {
      // import mesin fingerprint tanpa punch — kehadiran tidak terverifikasi
      items.push({
        ...base, type: "no-punch", typeLabel: EXC_LABELS["no-punch"][0],
        detail: "Import mesin tanpa data punch — kehadiran tidak terverifikasi perangkat",
        severity: "sedang",
        action: "Cocokkan dengan log mesin fisik; lengkapi punch manual bila valid.",
      });
    } else if (r.revised) {
      items.push({
        ...base, type: "revised", typeLabel: EXC_LABELS.revised[0],
        detail: `${r.notes ?? "Koreksi manual"} — oleh ${r.revisedBy ?? "—"}`,
        severity: "rendah",
        action: "Arsipkan formulir koreksi sebagai jejak audit.",
      });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  const filtered = ctx.fp.exception.length ? items.filter((i) => ctx.fp.exception.includes(i.type)) : items;

  const types = (Object.keys(EXC_LABELS) as (keyof typeof EXC_LABELS)[]).map((t) => ({
    type: t as string, label: EXC_LABELS[t][0], count: items.filter((i) => i.type === t).length,
  }));
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items: filtered,
      counts: types,
      total: items.length,
      employees: new Set(items.map((i) => i.employeeNo)).size,
    },
  };
}

// ============ XLSX ============

type AnyRec = Record<string, unknown>;
const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const d = (isoStr: unknown): string => {
  const str = isoStr == null || isoStr === "" ? null : String(isoStr);
  if (!str) return "—";
  const dt = new Date(str);
  return dt.getUTCDate() ? `${dt.getUTCDate()} ${MONTHS_ID[dt.getUTCMonth()].slice(0, 3)} ${dt.getUTCFullYear()}` : "—";
};

function buildSheets(id: string, built: { periodLabel: string; payload: unknown }, periodLabel: string): ExportSheet[] {
  const p = built.payload as AnyRec;
  const title = `${REPORT_TITLES[id]}${periodLabel ? ` — ${periodLabel}` : ""}`;
  switch (id) {
    case "ar11": {
      return [{
        name: "Rekap Bulanan",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Status", width: 14 },
          { header: "Hari Terjadwal", width: 13 }, { header: "Hadir", width: 9 }, { header: "Telat (hari)", width: 11 }, { header: "Telat (menit)", width: 12 },
          { header: "Sakit", width: 8 }, { header: "Cuti Lain", width: 10 }, { header: "Izin", width: 8 }, { header: "Alpa", width: 8 }, { header: "Off/Libur", width: 10 },
          { header: "Jam Kerja", width: 10 }, { header: "Jam Lembur", width: 11 }, { header: "Tingkat Hadir %", width: 13 },
        ],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [s(r.employeeNo), s(r.name), s(r.unit), s(r.employmentStatus), (r.scheduled as number) ?? 0, (r.present as number) ?? 0, (r.lateDays as number) ?? 0, (r.lateMinutes as number) ?? 0, (r.sick as number) ?? 0, (r.leaveOther as number) ?? 0, (r.workoff as number) ?? 0, (r.absent as number) ?? 0, (r.off as number) ?? 0, (r.workHours as number) ?? 0, (r.overtimeHours as number) ?? 0, (r.attendanceRate as number) ?? "—"]),
      }];
    }
    case "ar12": {
      const label: Record<string, string> = { Present: "Hadir", Late: "Telat", Absent: "Absen", Off: "Off", Holiday: "Libur", WorkOff: "Izin", OnLeave: "Cuti" };
      return [{
        name: "Timesheet Harian",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Day Type", width: 12 },
          { header: "Jadwal", width: 13 }, { header: "Jam Masuk", width: 10 }, { header: "Jam Pulang", width: 10 },
          { header: "Telat (m)", width: 10 }, { header: "Cepat (m)", width: 10 }, { header: "Jam Kerja", width: 10 },
          { header: "Lokasi Check-in", width: 34 }, { header: "Status", width: 10 }, { header: "Catatan", width: 30 },
        ],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [s(r.employeeNo), s(r.name), s(r.unit), s(r.dayTypeCode), s(r.shift), s(r.checkIn), s(r.checkOut), (r.lateMinutes as number) ?? 0, (r.earlyMinutes as number) ?? 0, (r.workHours as number) ?? "—", s(r.location), label[r.status as string] ?? s(r.status), s(r.notes)]),
      }];
    }
    case "ar13": {
      return [{
        name: "Presensi Geofencing",
        title,
        columns: [
          { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Jam", width: 8 }, { header: "Arah", width: 6 }, { header: "Sumber", width: 10 },
          { header: "Koordinat", width: 22 }, { header: "Lokasi Terdekat", width: 24 }, { header: "Jarak (m)", width: 10 }, { header: "Radius (m)", width: 10 }, { header: "Status Radius", width: 22 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.time), s(i.direction), s(i.source), `${(i.lat as number) ?? 0}, ${(i.lng as number) ?? 0}`, s(i.nearestName), (i.distanceM as number) ?? "—", (i.radiusM as number) ?? "—", i.within ? "Di dalam radius" : "DI LUAR RADIUS"]),
      }];
    }
    case "ar21": {
      const sev: Record<string, string> = { tinggi: "Tinggi (>30 m)", sedang: "Sedang (16–30 m)", ringan: "Ringan (≤15 m)" };
      return [{
        name: "Log Telat & Pulang Cepat",
        title,
        columns: [
          { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Shift", width: 10 }, { header: "Jadwal Masuk", width: 12 }, { header: "Aktual Masuk", width: 12 }, { header: "Telat (menit)", width: 12 },
          { header: "Jadwal Pulang", width: 12 }, { header: "Aktual Pulang", width: 12 }, { header: "Cepat (menit)", width: 12 }, { header: "Severity", width: 16 }, { header: "Catatan", width: 28 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.dayTypeCode), s(i.plannedIn), s(i.actualIn), (i.lateMinutes as number) ?? 0, s(i.plannedOut), s(i.actualOut), (i.earlyMinutes as number) ?? 0, sev[i.severity as string] ?? s(i.severity), s(i.note)]),
      }];
    }
    case "ar22": {
      const st: Record<string, string> = { ok: "Sesuai", watch: "Perhatian", deficit: "DEFISIT" };
      return [{
        name: "Defisit Jam Kerja",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Hari Kerja", width: 10 },
          { header: "Target (jam)", width: 12 }, { header: "Aktual (jam)", width: 12 }, { header: "Defisit (jam)", width: 12 },
          { header: "Rata-rata/hari", width: 13 }, { header: "Pencapaian %", width: 12 }, { header: "Status", width: 12 },
        ],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [s(r.employeeNo), s(r.name), s(r.unit), (r.workdays as number) ?? 0, (r.targetHours as number) ?? 0, (r.actualHours as number) ?? 0, (r.deficitHours as number) ?? 0, (r.avgPerDay as number) ?? 0, (r.achievement as number) ?? "—", st[r.status as string] ?? s(r.status)]),
      }];
    }
    case "ar23": {
      return [{
        name: "Top Pelanggaran",
        title,
        columns: [
          { header: "Peringkat", width: 10 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Telat (hari)", width: 11 }, { header: "Telat (menit)", width: 12 }, { header: "Alpa (hari)", width: 10 },
          { header: "Izin", width: 8 }, { header: "Cuti", width: 8 }, { header: "Total Pelanggaran", width: 14 }, { header: "Poin", width: 8 },
          { header: "Rekomendasi", width: 30 }, { header: "Tindakan", width: 46 },
        ],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [(r.rank as number) ?? 0, s(r.employeeNo), s(r.name), s(r.unit), (r.lateCount as number) ?? 0, (r.lateMinutes as number) ?? 0, (r.absentDays as number) ?? 0, (r.workoffDays as number) ?? 0, (r.leaveDays as number) ?? 0, (r.violations as number) ?? 0, (r.points as number) ?? 0, s(r.recommendation), s(r.action)]),
      }];
    }
    case "ar31": {
      const st: Record<string, string> = OT_STATUS_LABELS;
      return [{
        name: "Rekap Lembur",
        title,
        columns: [
          { header: "No. Order", width: 14 }, { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Kategori Hari", width: 13 }, { header: "Jam", width: 13 }, { header: "Rencana (jam)", width: 12 }, { header: "Aktual (jam)", width: 12 },
          { header: "Terverifikasi (jam)", width: 16 }, { header: "Indeks", width: 8 }, { header: "Status", width: 18 }, { header: "Pemutus", width: 20 }, { header: "Alasan", width: 34 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.orderNo), d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.dayCategory), s(i.window), (i.planHours as number) ?? 0, (i.actualHours as number) ?? 0, (i.verifiedHours as number) ?? 0, (i.rateMultiplier as number) ?? 0, st[i.status as string] ?? s(i.status), s(i.approver), s(i.reason)]),
      }];
    }
    case "ar32": {
      const rp = (n: unknown) => (n == null ? "—" : n as number);
      return [{
        name: "Estimasi Biaya Lembur",
        title,
        columns: [
          { header: "No. Order", width: 14 }, { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Kategori Hari", width: 13 }, { header: "Jam Terverifikasi", width: 14 }, { header: "Gaji Pokok (Rp)", width: 16 },
          { header: "Upah/Jam (Rp)", width: 14 }, { header: "Estimasi Bayar (Rp)", width: 18 }, { header: "Indeks Berlaku", width: 40 }, { header: "Status", width: 18 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.orderNo), d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.dayCategory), (i.verifiedHours as number) ?? 0, rp(i.monthlySalary), rp(i.hourlyRate), rp(i.estimatedPay), s(i.indexNote), s(i.status)]),
      }];
    }
    case "ar33": {
      const st: Record<string, string> = { compliant: "Patuh", watch: "Perhatian", violation: "PELANGGARAN" };
      return [{
        name: "Audit Cap Lembur",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Total Lembur (jam)", width: 15 },
          { header: "Puncak Harian", width: 16 }, { header: "Puncak Mingguan", width: 24 }, { header: "Temuan Pelanggaran", width: 52 }, { header: "Status", width: 14 },
        ],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [
          s(r.employeeNo), s(r.name), s(r.unit), (r.monthlyHours as number) ?? 0,
          r.peakDaily ? `${d((r.peakDaily as AnyRec).date as string)}: ${(r.peakDaily as AnyRec).hours} jam` : "—",
          r.peakWeekly ? `${(r.peakWeekly as AnyRec).weekLabel}: ${(r.peakWeekly as AnyRec).hours} jam` : "—",
          ((r.violations as AnyRec[]) ?? []).map((v) => v.detail as string).join(" · ") || "—",
          st[r.status as string] ?? s(r.status),
        ]),
      }];
    }
    case "ar41": {
      const t: Record<string, string> = { absent: "Tidak hadir", late: "Masuk vs jadwal", early: "Pulang cepat", "no-punch": "Tanpa punch", "off-work": "Kerja hari off" };
      const sev: Record<string, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };
      return [{
        name: "Deviasi Jadwal",
        title,
        columns: [
          { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Roster", width: 12 }, { header: "Jam Shift", width: 13 }, { header: "Masuk", width: 8 }, { header: "Pulang", width: 8 },
          { header: "Jenis Deviasi", width: 18 }, { header: "Rincian", width: 52 }, { header: "Severity", width: 10 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.rosterCode), s(i.rosterShift), s(i.actualIn), s(i.actualOut), t[i.type as string] ?? s(i.type), s(i.detail), sev[i.severity as string] ?? s(i.severity)]),
      }];
    }
    case "ar42": {
      return [{
        name: "Shift Malam & Libur",
        title,
        columns: [
          { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Kategori", width: 36 }, { header: "Masuk", width: 8 }, { header: "Pulang", width: 8 },
          { header: "Jam Kerja", width: 10 }, { header: "Lembur Terverifikasi (jam)", width: 16 }, { header: "Insentif", width: 10 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.categoryLabel), s(i.checkIn), s(i.checkOut), (i.hours as number) ?? 0, (i.otHours as number) ?? 0, i.premium ? "Layak" : "—"]),
      }];
    }
    default: {
      const sev: Record<string, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };
      return [{
        name: "Transaksi Janggal",
        title,
        columns: [
          { header: "Tanggal", width: 12 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Jenis", width: 26 }, { header: "Rincian", width: 52 }, { header: "Severity", width: 10 }, { header: "Tindak Lanjut", width: 46 },
        ],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.date), s(i.employeeNo), s(i.name), s(i.unit), s(i.typeLabel), s(i.detail), sev[i.severity as string] ?? s(i.severity), s(i.action)]),
      }];
    }
  }
}
