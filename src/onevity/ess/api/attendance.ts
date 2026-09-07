import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { resolveDayType, listDaily, recapPeriod } from "@/onevity/time-attendance/services/attendance-service";

// GET /api/ess/attendance?month=YYYY-MM — data absensi sendiri satu bulan:
// jadwal hari ini + baris harian + rekap bulan. Default: bulan berjalan.
export async function GET(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const sp = req.nextUrl.searchParams;
    const monthStr = sp.get("month"); // "YYYY-MM"
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth();
    if (monthStr && /^\d{4}-\d{2}$/.test(monthStr)) {
      const [y, mo] = monthStr.split("-").map(Number);
      if (mo >= 1 && mo <= 12) {
        year = y;
        month = mo - 1;
      }
    }
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0);

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [schedule, daily, recaps] = await Promise.all([
      resolveDayType(db, employeeId, today),
      db.attendanceDaily.findMany({
        where: { employeeId, workDate: { gte: from, lt: new Date(to.getTime() + 86400000) } },
        orderBy: { workDate: "asc" },
      }),
      recapPeriod(db, from, to, employeeId),
    ]);
    const recap = recaps[0] ?? null;

    // day types untuk label/warna (join manual — dayTypeId pada baris)
    const dayTypes = await db.workDayType.findMany({
      select: { id: true, code: true, name: true, color: true, category: true, timeIn: true, timeOut: true },
    });
    const dtById = new Map(dayTypes.map((d) => [d.id, d]));

    const rows = daily.map((r) => {
      const dt = r.dayTypeId ? dtById.get(r.dayTypeId) : undefined;
      return {
        date: r.workDate.toISOString().slice(0, 10),
        dayCode: dt?.code ?? null,
        dayName: dt?.name ?? null,
        dayColor: dt?.color ?? null,
        category: dt?.category ?? null,
        status: r.status,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        lateMinutes: r.lateMinutes,
        earlyMinutes: r.earlyMinutes,
        workMinutes: r.workMinutes,
        normalMinutes: r.normalMinutes,
        overtimeMinutes: r.overtimeMinutes,
        notes: r.notes,
      };
    });

    return NextResponse.json({
      month: { year, month: month + 1, label: new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(from), isCurrent: year === now.getFullYear() && month === now.getMonth() },
      today: {
        date: today.toISOString().slice(0, 10),
        dayName: schedule.dayType?.name ?? null,
        dayCode: schedule.dayType?.code ?? null,
        timeIn: schedule.dayType?.timeIn ?? null,
        timeOut: schedule.dayType?.timeOut ?? null,
        clockingRequired: schedule.assignment.clockingRequired,
      },
      rows,
      recap: recap
        ? {
            scheduledDays: recap.scheduledDays,
            presentDays: recap.presentDays,
            lateCount: recap.lateCount,
            lateMinutes: recap.lateMinutes,
            absentDays: recap.absentDays,
            leavePaidDays: recap.leavePaidDays,
            leaveUnpaidDays: recap.leaveUnpaidDays,
            offDays: recap.offDays,
            workoffPaidDays: recap.workoffPaidDays,
            overtimeMinutes: recap.overtimeMinutes,
            normalMinutes: recap.normalMinutes,
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
