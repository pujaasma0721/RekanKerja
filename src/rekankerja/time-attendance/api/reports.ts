import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet } from "@/rekankerja/shared/lib/export";
import { dayStart } from "@/rekankerja/time-attendance/services/attendance-service";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// Laporan Attendance (padanan Laporan HR — hr/reports, T12-REPORTS):
// GET /api/rekankerja/attendance/reports?month=YYYY-MM
//   • KPI Bulan Ini: hadir (Present+Late), telat, absen, izin (WorkOff),
//     cuti (OnLeave), off/libur, total keterlambatan, jam kerja, jam lembur,
//     tingkat kehadiran % (hadir / (hadir + tidak hadir)).
//   • Tren 12 Bulan: hadir vs ketidakhadiran (absen+izin) per bulan.
//   • Komposisi Status: distribusi AttendanceDaily per status.
//   • Top Pelanggaran Jadwal: top 10 karyawan telat & absen terbanyak.
//   • Rekap Per Karyawan & Per Unit Kerja.
// ?export=kpi → XLSX multi-sheet (pola hr/reports — Content-Disposition).
//
// Guard: menu view attendance:reports (item "Laporan Attendance") — dipagar
// terpisah dari view operasional (pola leave/travel/medical reports).
// Sumber data: AttendanceDaily hasil regen clocking (sudah dihitung) —
// agregat menit/jam saja, tanpa kolom uang (biaya lembur → modul Payroll).

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "YYYY-MM" lokal (bukan toISOString — hindari shift -1 hari, kelas bug B-10). */
function ymLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Label bulan singkat "Jan 2026" dari "YYYY-MM". */
function monthLabelOf(ym: string): string {
  const [y, m] = ym.split("-");
  const mi = Number(m) - 1;
  return `${MONTH_LABELS[mi] ?? m} ${y}`;
}

/** Rentang bulan lokal: from (inklusif), to (inklusif), next (eksklusif utk query). */
function monthRange(ym: string): { from: Date; to: Date; next: Date } {
  const [y, m] = ym.split("-").map(Number);
  return {
    from: new Date(y, m - 1, 1),
    to: new Date(y, m, 0),
    next: new Date(y, m, 1),
  };
}

/** Daftar 12 bulan "YYYY-MM" berakhir pada bulan param. */
function last12Months(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) out.push(ymLocal(new Date(y, m - 1 - i, 1)));
  return out;
}

interface StatusCell { count: number; lateMinutes: number; workMinutes: number; overtimeMinutes: number }
const emptyCell = (): StatusCell => ({ count: 0, lateMinutes: 0, workMinutes: 0, overtimeMinutes: 0 });

/** Akumulator rekap (per karyawan / per unit). */
interface RecapCell {
  employees: Set<string>;
  present: number; late: number; absent: number; workoff: number; onLeave: number; off: number;
  lateMinutes: number; workMinutes: number; overtimeMinutes: number;
}
const newRecap = (): RecapCell => ({
  employees: new Set(),
  present: 0, late: 0, absent: 0, workoff: 0, onLeave: 0, off: 0,
  lateMinutes: 0, workMinutes: 0, overtimeMinutes: 0,
});

/** Masukkan satu baris AttendanceDaily ke sel rekap (status → bucket). */
function recapAdd(cell: RecapCell, r: { employeeId: string; status: string; lateMinutes: number; workMinutes: number; overtimeMinutes: number }) {
  cell.employees.add(r.employeeId);
  if (r.status === "Present") cell.present += 1;
  else if (r.status === "Late") cell.late += 1;
  else if (r.status === "Absent") cell.absent += 1;
  else if (r.status === "WorkOff") cell.workoff += 1;
  else if (r.status === "OnLeave") cell.onLeave += 1;
  else cell.off += 1; // Off + Holiday + status tak dikenal
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const now = new Date();
    const monthParam = req.nextUrl.searchParams.get("month") ?? ymLocal(now);
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: "Parameter month harus format YYYY-MM" }, { status: 400 });
    }
    const { from, next } = monthRange(monthParam);

    // ===== KPI bulan terpilih (satu groupBy status + sum menit) =====
    const statusAgg = await db.attendanceDaily.groupBy({
      by: ["status"],
      where: { workDate: { gte: from, lt: next } },
      _count: { _all: true },
      _sum: { lateMinutes: true, workMinutes: true, overtimeMinutes: true },
    });
    const byStatus = new Map<string, StatusCell>();
    for (const r of statusAgg) {
      byStatus.set(r.status, {
        count: r._count._all,
        lateMinutes: r._sum.lateMinutes ?? 0,
        workMinutes: r._sum.workMinutes ?? 0,
        overtimeMinutes: r._sum.overtimeMinutes ?? 0,
      });
    }
    const st = (k: string): StatusCell => byStatus.get(k) ?? emptyCell();
    const statusComposition = [...byStatus.entries()]
      .map(([status, c]) => ({ status, count: c.count }))
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));

    const present = st("Present").count + st("Late").count;
    const absence = st("Absent").count + st("WorkOff").count + st("OnLeave").count;
    const headcountRows = await db.attendanceDaily.findMany({
      where: { workDate: { gte: from, lt: next } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });

    const kpi = {
      month: monthParam,
      headcount: headcountRows.length,
      present,
      late: st("Late").count,
      absent: st("Absent").count,
      workoff: st("WorkOff").count,
      onLeave: st("OnLeave").count,
      off: st("Off").count + st("Holiday").count,
      lateMinutes: st("Present").lateMinutes + st("Late").lateMinutes,
      workHours: Math.round((st("Present").workMinutes + st("Late").workMinutes + st("Absent").workMinutes) / 60),
      overtimeHours: Math.round((st("Present").overtimeMinutes + st("Late").overtimeMinutes + st("Absent").overtimeMinutes) / 60),
      attendanceRate: present + absence > 0 ? Math.round((present / (present + absence)) * 1000) / 10 : 0,
    };

    // ===== tren 12 bulan (satu groupBy, bucket per bulan-lokal) =====
    const months = last12Months(monthParam);
    const trendAgg = await db.attendanceDaily.groupBy({
      by: ["workDate", "status"],
      where: { workDate: { gte: monthRange(months[0]).from, lt: next } },
      _count: { _all: true },
    });
    const trendMap = new Map<string, { present: number; absent: number; workoff: number; onLeave: number; off: number }>();
    for (const ym of months) trendMap.set(ym, { present: 0, absent: 0, workoff: 0, onLeave: 0, off: 0 });
    for (const r of trendAgg) {
      const cell = trendMap.get(ymLocal(dayStart(r.workDate)));
      if (!cell) continue;
      const n = r._count._all;
      if (r.status === "Present" || r.status === "Late") cell.present += n;
      else if (r.status === "Absent") cell.absent += n;
      else if (r.status === "WorkOff") cell.workoff += n;
      else if (r.status === "OnLeave") cell.onLeave += n;
      else cell.off += n;
    }
    const trend = months.map((ym) => {
      const c = trendMap.get(ym)!;
      return {
        month: monthLabelOf(ym),
        ym,
        present: c.present,
        absent: c.absent + c.workoff, // tidak hadir: absen + izin (padanan KPI)
        onLeave: c.onLeave,
        off: c.off,
      };
    });

    // ===== baris bulan terpilih utk top pelanggaran + rekap =====
    const rows = await db.attendanceDaily.findMany({
      where: { workDate: { gte: from, lt: next } },
      select: {
        employeeId: true, status: true, lateMinutes: true, workMinutes: true, overtimeMinutes: true,
        employee: {
          select: {
            employeeNo: true, fullName: true,
            assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
          },
        },
      },
    });

    const orgNameOf = (r: (typeof rows)[number]) => r.employee.assignments[0]?.orgUnit?.name ?? null;

    // top 10 pelanggaran jadwal (telat & absen terbanyak)
    const violMap = new Map<string, {
      employeeNo: string; fullName: string; orgUnitName: string | null;
      lateCount: number; lateMinutes: number; absentCount: number; workoffCount: number; onLeaveCount: number;
    }>();
    for (const r of rows) {
      const isLate = r.lateMinutes > 0;
      const isStatusHit = r.status === "Absent" || r.status === "WorkOff" || r.status === "OnLeave";
      if (!isLate && !isStatusHit) continue;
      const cell = violMap.get(r.employeeId) ?? {
        employeeNo: r.employee.employeeNo, fullName: r.employee.fullName, orgUnitName: orgNameOf(r),
        lateCount: 0, lateMinutes: 0, absentCount: 0, workoffCount: 0, onLeaveCount: 0,
      };
      if (isLate) { cell.lateCount += 1; cell.lateMinutes += r.lateMinutes; }
      if (r.status === "Absent") cell.absentCount += 1;
      else if (r.status === "WorkOff") cell.workoffCount += 1;
      else if (r.status === "OnLeave") cell.onLeaveCount += 1;
      violMap.set(r.employeeId, cell);
    }
    const topViolations = [...violMap.values()]
      .sort((a, b) =>
        (b.lateCount + b.absentCount) - (a.lateCount + a.absentCount) ||
        b.lateMinutes - a.lateMinutes ||
        a.employeeNo.localeCompare(b.employeeNo))
      .slice(0, 10);

    // rekap per karyawan
    const empMap = new Map<string, RecapCell & { employeeNo: string; fullName: string; orgUnitName: string | null }>();
    for (const r of rows) {
      let cell = empMap.get(r.employeeId);
      if (!cell) {
        cell = Object.assign(newRecap(), {
          employeeNo: r.employee.employeeNo, fullName: r.employee.fullName, orgUnitName: orgNameOf(r),
        });
        empMap.set(r.employeeId, cell);
      }
      recapAdd(cell, r);
    }
    const perEmployee = [...empMap.values()]
      .map((c) => ({
        employeeNo: c.employeeNo, fullName: c.fullName, orgUnitName: c.orgUnitName,
        presentDays: c.present + c.late, lateDays: c.late, lateMinutes: c.lateMinutes,
        absentDays: c.absent, workoffDays: c.workoff, onLeaveDays: c.onLeave, offDays: c.off,
        workHours: Math.round(c.workMinutes / 60), overtimeHours: Math.round(c.overtimeMinutes / 60),
      }))
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));

    // rekap per unit kerja
    const orgMap = new Map<string, RecapCell>();
    for (const r of rows) {
      const org = orgNameOf(r) ?? "(tanpa unit)";
      let cell = orgMap.get(org);
      if (!cell) {
        cell = newRecap();
        orgMap.set(org, cell);
      }
      recapAdd(cell, r);
    }
    const perOrg = [...orgMap.entries()]
      .map(([orgUnitName, c]) => ({
        orgUnitName,
        headcount: c.employees.size,
        presentDays: c.present + c.late, lateDays: c.late, lateMinutes: c.lateMinutes,
        absentDays: c.absent, workoffDays: c.workoff, onLeaveDays: c.onLeave, offDays: c.off,
        workHours: Math.round(c.workMinutes / 60), overtimeHours: Math.round(c.overtimeMinutes / 60),
      }))
      .sort((a, b) => b.headcount - a.headcount || a.orgUnitName.localeCompare(b.orgUnitName));

    // ===== mode export XLSX (multi-sheet — pola hr/reports) =====
    const exportMode = req.nextUrl.searchParams.get("export");
    if (exportMode) {
      if (exportMode !== "kpi") {
        return NextResponse.json({ error: "Parameter export tidak dikenal — gunakan ?export=kpi" }, { status: 400 });
      }
      const sheets: ExportSheet[] = [
        {
          name: "Ringkasan",
          title: `Laporan Attendance — ${monthLabelOf(monthParam)}`,
          columns: [{ header: "Indikator", width: 30 }, { header: "Nilai", width: 16 }],
          rows: [
            ["Bulan", monthLabelOf(monthParam)],
            ["Karyawan Terjadwal", kpi.headcount],
            ["Hadir (incl. Telat)", kpi.present],
            ["Telat", kpi.late],
            ["Absen", kpi.absent],
            ["Izin (Work Off)", kpi.workoff],
            ["Cuti (On Leave)", kpi.onLeave],
            ["Off + Libur", kpi.off],
            ["Total Keterlambatan (menit)", kpi.lateMinutes],
            ["Total Jam Kerja", kpi.workHours],
            ["Total Jam Lembur", kpi.overtimeHours],
            ["Tingkat Kehadiran (%)", kpi.attendanceRate],
          ],
        },
        {
          name: "Tren 12 Bulan",
          title: "Hadir vs Tidak Hadir — 12 Bulan",
          columns: [
            { header: "Bulan", width: 12 }, { header: "Hadir", width: 10 },
            { header: "Absen + Izin", width: 13 }, { header: "Cuti", width: 10 }, { header: "Off/Libur", width: 12 },
          ],
          rows: trend.map((t) => [t.month, t.present, t.absent, t.onLeave, t.off]),
        },
        {
          name: "Komposisi Status",
          columns: [{ header: "Status", width: 24 }, { header: "Jumlah Hari-Karyawan", width: 22 }],
          rows: statusComposition.map((s) => [s.status, s.count]),
        },
        {
          name: "Top Pelanggaran",
          title: "Top 10 Telat & Absen Terbanyak",
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 28 }, { header: "Unit Kerja", width: 24 },
            { header: "Telat (hari)", width: 12 }, { header: "Telat (menit)", width: 13 },
            { header: "Absen (hari)", width: 12 }, { header: "Izin (hari)", width: 11 }, { header: "Cuti (hari)", width: 11 },
          ],
          rows: topViolations.map((v) => [
            v.employeeNo, v.fullName, v.orgUnitName ?? "", v.lateCount, v.lateMinutes, v.absentCount, v.workoffCount, v.onLeaveCount,
          ]),
        },
        {
          name: "Per Karyawan",
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 28 }, { header: "Unit Kerja", width: 24 },
            { header: "Hari Hadir", width: 11 }, { header: "Telat (hari)", width: 11 }, { header: "Telat (menit)", width: 13 },
            { header: "Absen (hari)", width: 11 }, { header: "Izin (hari)", width: 11 }, { header: "Cuti (hari)", width: 11 },
            { header: "Off/Libur (hari)", width: 14 }, { header: "Jam Kerja", width: 11 }, { header: "Jam Lembur", width: 12 },
          ],
          rows: perEmployee.map((r) => [
            r.employeeNo, r.fullName, r.orgUnitName ?? "", r.presentDays, r.lateDays, r.lateMinutes,
            r.absentDays, r.workoffDays, r.onLeaveDays, r.offDays, r.workHours, r.overtimeHours,
          ]),
        },
        {
          name: "Per Unit Kerja",
          columns: [
            { header: "Unit Kerja", width: 30 }, { header: "Karyawan", width: 10 },
            { header: "Hari Hadir", width: 11 }, { header: "Telat (hari)", width: 11 }, { header: "Telat (menit)", width: 13 },
            { header: "Absen (hari)", width: 11 }, { header: "Izin (hari)", width: 11 }, { header: "Cuti (hari)", width: 11 },
            { header: "Off/Libur (hari)", width: 14 }, { header: "Jam Kerja", width: 11 }, { header: "Jam Lembur", width: 12 },
          ],
          rows: perOrg.map((r) => [
            r.orgUnitName, r.headcount, r.presentDays, r.lateDays, r.lateMinutes,
            r.absentDays, r.workoffDays, r.onLeaveDays, r.offDays, r.workHours, r.overtimeHours,
          ]),
        },
      ];
      const buf = await toXlsxMulti(sheets);
      await logExport(db, m.actor.appUserId);
      return xlsxResponse(buf, exportFilename("rekankerja-attendance", "xlsx", monthParam));
    }

    return NextResponse.json({
      generatedAt: now.toISOString(),
      kpi,
      trend,
      statusComposition,
      topViolations,
      perEmployee,
      perOrg,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

/** Audit trail ekspor (pola hr/reports logExport — gagal diam, export tetap sukses). */
async function logExport(db: TenantDb, appUserId: string | null) {
  try {
    await db.activityLog.create({
      data: {
        action: "Exported",
        entity: "AttendanceReport",
        ...(appUserId ? { appUserId } : {}),
        detail: "Ekspor XLSX laporan attendance (kpi)",
      },
    });
  } catch {
    // ActivityLog tak tersedia di schema legacy — export tetap sukses.
  }
}
