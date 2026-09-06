// GET /api/onevity/ess/dashboard — ringkasan KPI ESS (kontrak T8-ESS-FRONTEND).
import { NextResponse } from "next/server";
import { requireEss, fmtHhMm, fmtRangeId, fmtDateId } from "@/onevity/ess/api/ess-auth";
import { dayStart, addDays } from "@/onevity/time-attendance/services/attendance-service";
import { listBalances } from "@/onevity/leave/services/leave-service";

interface RecentDoc {
  docType: "Leave" | "WorkOff" | "Overtime" | "Travel" | "Medical";
  docNo: string;
  status: string;
  dateLabel: string;
  sortKey: Date;
}

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId, appUserId, appUserRole, platformRole } = m.actor;

  try {
    const now = new Date();
    const today = dayStart(now);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = addDays(today, 1); // eksklusif — month-to-date s.d. hari ini

    // ===== saldo cuti (jenis aktif tahun berjalan) =====
    const balances = await listBalances(db, { employeeId, year: today.getFullYear() });
    const annual = balances.find((b) => b.leaveTypeCode === "CT-THN");
    const leaveAvailable = annual
      ? annual.remaining
      : balances.reduce((mx, b) => Math.max(mx, b.remaining), 0);

    // ===== KPI dokumen saya vs menunggu keputusan saya =====
    const [pendingLeave, pendingWorkoff, pendingOvertime, pendingTravel, pendingMedical] =
      await Promise.all([
        db.leaveRequest.count({ where: { employeeId, status: "Submitted" } }),
        db.workOffPermission.count({ where: { employeeId, status: "Pending" } }),
        db.overtimeOrder.count({ where: { employeeId, status: "Pending" } }),
        db.travelRequest.count({ where: { employeeId, status: "Submitted" } }),
        db.medicalClaim.count({ where: { employeeId, state: "Submitted" } }),
      ]);
    const pendingMine = pendingLeave + pendingWorkoff + pendingOvertime + pendingTravel + pendingMedical;

    // waitingApproval: chain InProgress lintas docType yang approver JENJANG SAAT INI
    // = aktor — match employeeId langsung, ATAU jenjang HR_ADMIN yang menunggu
    // pengguna ber-peran admin (AppUser Admin/HR Manager / role workspace OWNER-
    // ADMIN-HR — selaras otorisasi engine canActorDecideCurrentStep).
    const adminRole =
      ["OWNER", "ADMIN", "HR"].includes(platformRole) || ["Admin", "HR Manager"].includes(appUserRole);
    const chains = await db.approvalChain.findMany({
      where: { status: "InProgress" },
      include: { steps: { where: { status: "Current" }, take: 1, select: { approverType: true, approverEmployeeId: true } } },
    });
    const waitingApproval = chains.filter((ch) => {
      const step = ch.steps[0];
      if (!step) return false;
      if (step.approverEmployeeId && step.approverEmployeeId === employeeId) return true;
      return step.approverType === "HR_ADMIN" && adminRole;
    }).length;

    // ===== kehadiran bulan berjalan (s.d. hari ini) =====
    const daily = await db.attendanceDaily.findMany({
      where: { employeeId, workDate: { gte: monthStart, lt: monthEnd } },
      select: { status: true, overtimeMinutes: true },
    });
    const present = daily.filter((r) => r.status === "Present").length;
    const late = daily.filter((r) => r.status === "Late").length;
    const absent = daily.filter((r) => r.status === "Absent").length;
    const overtimeHoursMonth =
      Math.round((daily.reduce((s, r) => s + r.overtimeMinutes, 0) / 60) * 10) / 10;

    // ===== dokumen terbaru (5) lintas jenis =====
    const [leaves, workoffs, overtimes, travels, medicals] = await Promise.all([
      db.leaveRequest.findMany({
        where: { employeeId },
        orderBy: { requestDate: "desc" },
        take: 5,
        select: { docNo: true, status: true, dateFrom: true, dateTo: true, requestDate: true },
      }),
      db.workOffPermission.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { docNo: true, status: true, dateFrom: true, dateTo: true, createdAt: true },
      }),
      db.overtimeOrder.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { orderNo: true, status: true, overtimeDate: true, createdAt: true },
      }),
      db.travelRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { docNo: true, status: true, dateFrom: true, dateTo: true, createdAt: true },
      }),
      db.medicalClaim.findMany({
        where: { employeeId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { docNo: true, state: true, claimDate: true, createdAt: true },
      }),
    ]);
    const recent: RecentDoc[] = [
      ...leaves.map((r) => ({
        docType: "Leave" as const, docNo: r.docNo, status: r.status,
        dateLabel: fmtRangeId(r.dateFrom, r.dateTo), sortKey: r.requestDate,
      })),
      ...workoffs.map((r) => ({
        docType: "WorkOff" as const, docNo: r.docNo, status: r.status,
        dateLabel: fmtRangeId(r.dateFrom, r.dateTo), sortKey: r.createdAt,
      })),
      ...overtimes.map((r) => ({
        docType: "Overtime" as const, docNo: r.orderNo, status: r.status,
        dateLabel: fmtDateId(r.overtimeDate), sortKey: r.createdAt,
      })),
      ...travels.map((r) => ({
        docType: "Travel" as const, docNo: r.docNo, status: r.status,
        dateLabel: fmtRangeId(r.dateFrom, r.dateTo), sortKey: r.createdAt,
      })),
      ...medicals.map((r) => ({
        docType: "Medical" as const, docNo: r.docNo, status: r.state,
        dateLabel: fmtDateId(r.claimDate), sortKey: r.createdAt,
      })),
    ].sort((a, b) => b.sortKey.getTime() - a.sortKey.getTime());

    // ===== slip gaji terbaru (run Confirmed/Paid) =====
    const latestLine = await db.payrollRunLine.findFirst({
      where: { employeeId, run: { status: { in: ["Confirmed", "Paid"] } } },
      orderBy: { run: { period: { endDate: "desc" } } },
      select: {
        id: true, net: true,
        run: { select: { status: true, period: { select: { name: true } } } },
      },
    });

    // ===== clock hari ini + notifikasi =====
    const todayRow = await db.attendanceDaily.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: today } },
      select: { checkIn: true, checkOut: true },
    });
    const notifications = await db.notification.findMany({
      where: { appUserId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, readAt: true, createdAt: true },
    });

    return NextResponse.json({
      kpi: {
        leaveAvailable: Math.round(leaveAvailable * 100) / 100,
        pendingMine,
        waitingApproval,
        present,
        late,
        absent,
        overtimeHoursMonth,
      },
      leaveBalances: balances.map((b) => ({
        code: b.leaveTypeCode,
        name: b.leaveTypeName,
        available: b.remaining,
      })),
      recentRequests: recent.slice(0, 5).map((r) => ({
        docType: r.docType, docNo: r.docNo, status: r.status, dateLabel: r.dateLabel,
      })),
      latestPayslip: latestLine
        ? {
            lineId: latestLine.id,
            periodName: latestLine.run.period.name,
            netAmount: latestLine.net,
            status: latestLine.run.status,
          }
        : null,
      clockToday: todayRow
        ? { in: todayRow.checkIn ? fmtHhMm(todayRow.checkIn) : null, out: todayRow.checkOut ? fmtHhMm(todayRow.checkOut) : null }
        : null,
      notifications,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
