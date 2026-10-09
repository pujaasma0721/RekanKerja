import { NextRequest, NextResponse } from "next/server";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  dayStart, addDays, getRule, overtimePayFor, otBasisContext, otBasisFor, attendanceCoverage,
} from "@/rekankerja/time-attendance/services/attendance-service";

// Task 100 F1 (G15) — Analytics absensi bulanan.
// =====================================================================
// GET /api/rekankerja/attendance/analytics?month=YYYY-MM
// Guard VIEW menu attendance:schedules (halaman Ringkasan — sama dgn
// api/overview.ts) + gerbang uang moneyViewForReq (estPay lembur → null
// tanpa money-view; perhitungan tetap atas gaji RAW — pola api/overtime.ts).
//
// Response (shape FINAL — agen frontend E memakai kontrak ini):
// {
//   month: "YYYY-MM",
//   trend: [{ date, present, late, absent, onLeave, off, workoff }],
//   heatmap: [{ dow: 1-7 (Sen=1), hour: 5-22, count }],
//   otByOrg: [{ org, minutes, estPay }],   // estPay null bila tanpa money-view
//   moneyView: boolean,
//   topLate: [{ employeeNo, fullName, count, minutes }],
//   coverage: { expected, actual, missing, coveragePct, asOf, missingByDay, missingByEmployee },
// }

/** Slot heatmap: Senin=1..Minggu=7 (kontrak frontend). */
function dowMondayFirst(d: Date): number {
  return (d.getDay() + 6) % 7 + 1;
}

/** "YYYY-MM-DD" LOKAL (bukan toISOString — hindari shift -1 hari di WIB 00:00–07:00; kelas bug B-10 Task 100). */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:schedules"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const now = new Date();
    const monthParam = req.nextUrl.searchParams.get("month")
      ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: "Parameter month harus format YYYY-MM" }, { status: 400 });
    }
    const [yearStr, monStr] = monthParam.split("-");
    const year = Number(yearStr);
    const mon = Number(monStr) - 1;
    if (mon < 0 || mon > 11) {
      return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });
    }
    const from = new Date(year, mon, 1);
    const to = new Date(year, mon + 1, 0); // akhir bulan (inclusive)
    const nextMonth = addDays(to, 1); // batas eksklusif query

    const mv = await moneyViewForReq(req, db);

    // ===== trend: hitungan status per tanggal (groupBy workDate+status) =====
    const trendRows = await db.attendanceDaily.groupBy({
      by: ["workDate", "status"],
      where: { workDate: { gte: from, lt: nextMonth } },
      _count: { _all: true },
    });
    const trendMap = new Map<string, { date: string; present: number; late: number; absent: number; onLeave: number; off: number; workoff: number }>();
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      trendMap.set(isoLocal(d), {
        date: isoLocal(d), present: 0, late: 0, absent: 0, onLeave: 0, off: 0, workoff: 0,
      });
    }
    for (const r of trendRows) {
      const key = isoLocal(dayStart(r.workDate));
      const cell = trendMap.get(key);
      if (!cell) continue;
      const n = r._count._all;
      if (r.status === "Present") cell.present += n;
      else if (r.status === "Late") cell.late += n;
      else if (r.status === "Absent") cell.absent += n;
      else if (r.status === "OnLeave") cell.onLeave += n;
      else if (r.status === "WorkOff") cell.workoff += n; // izin tidak masuk (bonus key)
      else cell.off += n; // Off + Holiday (hari tanpa kerja terjadwal)
    }

    // ===== heatmap: kepadatan clock-IN per (hari-minggu, jam 5-22 lokal) =====
    const clockLogs = await db.attendanceClockLog.findMany({
      where: { timestamp: { gte: from, lt: nextMonth }, direction: "IN" },
      select: { timestamp: true },
    });
    const heat = new Map<string, number>();
    for (const l of clockLogs) {
      const hour = l.timestamp.getHours();
      if (hour < 5 || hour > 22) continue; // di luar jendela tampilan heatmap
      const key = `${dowMondayFirst(l.timestamp)}|${hour}`;
      heat.set(key, (heat.get(key) ?? 0) + 1);
    }
    const heatmap: Array<{ dow: number; hour: number; count: number }> = [];
    for (let dow = 1; dow <= 7; dow++) {
      for (let hour = 5; hour <= 22; hour++) {
        heatmap.push({ dow, hour, count: heat.get(`${dow}|${hour}`) ?? 0 });
      }
    }

    // ===== otByOrg: menit lembur disetujui + estimasi upah per unit kerja =====
    // (Approved + Paid — histori jam lembur bulan tsb; join org manual dari
    // assignment aktif karyawan, pola include api/overtime.ts)
    const rule = await getRule(db);
    const otOrders = await db.overtimeOrder.findMany({
      where: { overtimeDate: { gte: from, lt: nextMonth }, status: { in: ["Approved", "Paid"] } },
      include: {
        employee: {
          select: {
            employeeNo: true, fullName: true,
            assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 },
          },
        },
      },
    });
    const otByOrgMap = new Map<string, { org: string; minutes: number; pay: number }>();
    // AUD-OT (PP 35/2021 Ps.31-32): tabel rate per model minggu kerja + dasar
    // upah (BASE / BASE_FIXED) — konsisten dgn rekap & API lembur.
    const otBasisCtx = await otBasisContext(db, [...new Set(otOrders.map((o) => o.employeeId))]);
    const workweekDays = rule.otWorkweekDays === 6 ? 6 : 5;
    for (const o of otOrders) {
      const org = o.employee.assignments[0]?.orgUnit?.name ?? "(tanpa unit)";
      // 28-c: baseSalary terenkripsi — dekripsi utk perhitungan (display digate)
      const baseSalary = tenantCryptoForDb(db).decryptMoney(o.employee.assignments[0]?.baseSalary) ?? 0;
      const minutes = o.verifiedMinutes > 0 ? o.verifiedMinutes : o.actualMinutes;
      const pay = overtimePayFor(otBasisFor(otBasisCtx, baseSalary, o.employeeId), minutes, o.dayCategory, {
        roundingMinutes: rule.overtimeRoundingMinutes, minMinutes: rule.minOvertimeMinutes,
        workweekDays,
      });
      const cell = otByOrgMap.get(org) ?? { org, minutes: 0, pay: 0 };
      cell.minutes += minutes;
      cell.pay += pay;
      otByOrgMap.set(org, cell);
    }
    const otByOrg = [...otByOrgMap.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .map((c) => ({ org: c.org, minutes: c.minutes, estPay: mv.canSee ? Math.round(c.pay) : null }));

    // ===== topLate: 10 karyawan terlambat terbanyak bulan ini =====
    const lateRows = await db.attendanceDaily.findMany({
      where: { workDate: { gte: from, lt: nextMonth }, lateMinutes: { gt: 0 } },
      select: { lateMinutes: true, employee: { select: { employeeNo: true, fullName: true } } },
    });
    const lateByEmp = new Map<string, { employeeNo: string; fullName: string; count: number; minutes: number }>();
    for (const r of lateRows) {
      const cell = lateByEmp.get(r.employee.employeeNo) ?? {
        employeeNo: r.employee.employeeNo, fullName: r.employee.fullName, count: 0, minutes: 0,
      };
      cell.count += 1;
      cell.minutes += r.lateMinutes;
      lateByEmp.set(r.employee.employeeNo, cell);
    }
    const topLate = [...lateByEmp.values()].sort((a, b) => b.minutes - a.minutes || b.count - a.count).slice(0, 10);

    // ===== coverageMonth: coverage rekap bulan (service G-04) =====
    const coverage = await attendanceCoverage(db, from, to);

    return NextResponse.json({
      month: monthParam,
      trend: [...trendMap.values()],
      heatmap,
      otByOrg,
      moneyView: mv.canSee,
      topLate,
      coverage,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
