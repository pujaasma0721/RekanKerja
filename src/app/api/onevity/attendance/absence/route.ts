import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { recapPeriod, transferToPayroll } from "@/lib/onevity/attendance-service";

// GET /api/onevity/attendance/absence?from=&to= — rekap period per karyawan
// (padanan Query - Employee Attendance/Absence/Tidiness) + period payroll utk transfer.
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
        select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true },
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
// body { periodId, processTypeCode, from, to, includeOvertime, includeLate, includeAbsence, includeAttendanceAllowance }
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "Period payroll wajib dipilih" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.from ?? "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.to ?? ""))) {
      return NextResponse.json({ error: "Jendela tanggal absensi wajib (from & to)" }, { status: 400 });
    }

    const result = await transferToPayroll(db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
      from: new Date(`${b.from}T00:00:00`),
      to: new Date(`${b.to}T00:00:00`),
      includeOvertime: b.includeOvertime,
      includeLate: b.includeLate,
      includeAbsence: b.includeAbsence,
      includeAttendanceAllowance: b.includeAttendanceAllowance,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
