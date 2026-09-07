import { NextRequest, NextResponse } from "next/server";
import { requireEssActor, countPendingApprovals } from "@/onevity/ess/lib/ess-guard";
import { resolveDayType, listDaily, recapPeriod } from "@/onevity/time-attendance/services/attendance-service";
import { listBalances, listRequests } from "@/onevity/leave/services/leave-service";

function dayStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// GET /api/ess/dashboard — agregat satu-fetch untuk Beranda ESS:
// hari ini (jadwal + status + clock), rekap bulan, saldo cuti ringkas,
// slip gaji terakhir, pengajuan terakhir, persetujuan menunggu, jadwal 7 hari.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const now = new Date();
    const today = dayStart(now);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const year = today.getFullYear();

    // hari ini — jadwal + rekap harian + log clock terakhir
    const [schedule, todayRows, clockLogs] = await Promise.all([
      resolveDayType(db, employeeId, today),
      listDaily(db, today, employeeId),
      db.attendanceClockLog.findMany({
        where: { employeeId, timestamp: { gte: today, lt: addDays(today, 1) } },
        orderBy: { timestamp: "asc" },
        select: { direction: true, timestamp: true, source: true },
      }),
    ]);
    const todayRow = todayRows[0] ?? null;

    // rekap bulan berjalan
    const recapRows = await recapPeriod(db, monthStart, monthEnd, employeeId);
    const recap = recapRows[0] ?? null;

    // saldo cuti tahun berjalan (ringkas)
    const balances = await listBalances(db, { employeeId, year });
    const balanceSummary = balances
      .filter((b) => b.year === year)
      .map((b) => ({
        leaveTypeCode: b.leaveTypeCode,
        leaveTypeName: b.leaveTypeName,
        unit: b.unit,
        entitlement: b.entitlement,
        taken: b.taken,
        applied: b.applied,
        remaining: b.remaining,
      }));

    // slip gaji terakhir (run Confirmed/Paid)
    const lastLine = await db.payrollRunLine.findFirst({
      where: { employeeId, run: { status: { in: ["Confirmed", "Paid"] } } },
      orderBy: [{ run: { period: { startDate: "desc" } } }, { run: { sequence: "desc" } }],
      select: {
        net: true, bruto: true,
        run: {
          select: {
            runNo: true, status: true, paidAt: true, confirmedAt: true,
            period: { select: { name: true } },
            processType: { select: { name: true } },
          },
        },
      },
    });

    // pengajuan cuti terakhir (5)
    const requests = await listRequests(db, { employeeId, status: "all", year });
    const recentRequests = [...requests]
      .sort((a, b) => new Date(b.requestDate).getTime() - new Date(a.requestDate).getTime())
      .slice(0, 5)
      .map((r) => ({
        id: r.id, docNo: r.docNo, leaveTypeName: r.leaveTypeName,
        dateFrom: r.dateFrom, dateTo: r.dateTo, workingDays: r.workingDays,
        status: r.status, requestDate: r.requestDate,
      }));

    const pendingApprovals = await countPendingApprovals(db, employeeId);

    // jadwal 7 hari ke depan (day type per tanggal)
    const upcoming: { date: string; dayCode: string | null; dayName: string | null; color: string | null; category: string | null }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      const s = await resolveDayType(db, employeeId, d);
      upcoming.push({
        date: d.toISOString().slice(0, 10),
        dayCode: s.dayType?.code ?? null,
        dayName: s.dayType?.name ?? null,
        color: s.dayType?.color ?? null,
        category: s.dayType?.category ?? null,
      });
    }

    return NextResponse.json({
      today: {
        date: today.toISOString().slice(0, 10),
        dayName: schedule.dayType?.name ?? null,
        dayCode: schedule.dayType?.code ?? null,
        timeIn: schedule.dayType?.timeIn ?? null,
        timeOut: schedule.dayType?.timeOut ?? null,
        clockingRequired: schedule.assignment.clockingRequired,
        status: todayRow?.status ?? null,
        checkIn: todayRow?.checkIn ?? null,
        checkOut: todayRow?.checkOut ?? null,
        lateMinutes: todayRow?.lateMinutes ?? 0,
        workMinutes: todayRow?.workMinutes ?? 0,
        logs: clockLogs,
      },
      month: {
        label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(today),
        presentDays: recap?.presentDays ?? 0,
        lateCount: recap?.lateCount ?? 0,
        lateMinutes: recap?.lateMinutes ?? 0,
        absentDays: recap?.absentDays ?? 0,
        leavePaidDays: recap?.leavePaidDays ?? 0,
        scheduledDays: recap?.scheduledDays ?? 0,
        overtimeMinutes: recap?.overtimeMinutes ?? 0,
      },
      balances: balanceSummary,
      lastPayslip: lastLine
        ? {
            runNo: lastLine.run.runNo,
            periodName: lastLine.run.period.name,
            processTypeName: lastLine.run.processType.name,
            status: lastLine.run.status,
            net: lastLine.net,
            bruto: lastLine.bruto,
            paidAt: lastLine.run.paidAt,
          }
        : null,
      recentRequests,
      pendingApprovals,
      upcoming,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
