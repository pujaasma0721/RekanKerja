import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { recapPeriod, transferToPayroll } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/absence?from=&to= — rekap period per karyawan
// (padanan Query - Employee Attendance/Absence/Tidiness) + period payroll utk transfer.
// Rekap uang hanya menghitung lembur Approved yang belum dibayar (fix K-1).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const now = new Date();
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? new Date(`${fromParam}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? new Date(`${toParam}T00:00:00`) : new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const [recap, periods, processTypes] = await Promise.all([
      recapPeriod(db, from, to),
      db.payrollPeriod.findMany({
        where: { status: { in: ["Open", "Processing"] } },
        select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true, taStartDate: true, taEndDate: true },
        orderBy: { startDate: "desc" },
      }),
      db.processType.findMany({ select: { id: true, code: true, name: true }, orderBy: { sequence: "asc" } }),
    ]);

    const totals = {
      employees: recap.length,
      presentDays: recap.reduce((s, r) => s + r.presentDays, 0),
      lateCount: recap.reduce((s, r) => s + r.lateCount, 0),
      lateMinutes: recap.reduce((s, r) => s + r.lateMinutes, 0),
      absentDays: recap.reduce((s, r) => s + r.absentDays, 0),
      workoffUnpaidDays: recap.reduce((s, r) => s + r.workoffUnpaidDays, 0),
      overtimeMinutes: recap.reduce((s, r) => s + r.overtimeMinutes, 0),
      overtimePay: recap.reduce((s, r) => s + r.overtimePay, 0),
      lateDeduction: recap.reduce((s, r) => s + r.lateDeduction, 0),
      absenceDeduction: recap.reduce((s, r) => s + r.absenceDeduction, 0),
      attendanceAllowance: recap.reduce((s, r) => s + r.attendanceAllowance, 0),
    };
    return NextResponse.json({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), recap, totals, periods, processTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — Transfer ke Payroll (padanan /TransferPayroll.jsp):
// body { periodId, processTypeCode, from?, to?, includeOvertime, includeLate, includeAbsence, includeAttendanceAllowance }
// Fix M-4: from/to opsional (default jendela TA period / rentang period) + window
// divalidasi vs period & anti-overlap (guard di transferToPayroll). Guard VIEWER + aktor sesi.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "Period payroll wajib dipilih" }, { status: 400 });
    const fromOk = typeof b.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.from);
    const toOk = typeof b.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.to);
    if ((b.from !== undefined && !fromOk) || (b.to !== undefined && !toOk)) {
      return NextResponse.json({ error: "Jendela tanggal absensi tidak valid (YYYY-MM-DD)" }, { status: 400 });
    }

    const result = await transferToPayroll(m.db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
      from: fromOk ? new Date(`${b.from}T00:00:00`) : undefined,
      to: toOk ? new Date(`${b.to}T00:00:00`) : undefined,
      includeOvertime: b.includeOvertime,
      includeLate: b.includeLate,
      includeAbsence: b.includeAbsence,
      includeAttendanceAllowance: b.includeAttendanceAllowance,
      actor: { name: m.actor.name, appUserId: m.actor.appUserId },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
