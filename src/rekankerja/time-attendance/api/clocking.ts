import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { listDaily, regenerateDaily, recordClockLog } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/clocking?date=YYYY-MM-DD — rekap harian (padanan
// EmpClocking.jsp) + log mentah hari tsb.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const dateParam = req.nextUrl.searchParams.get("date");
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? new Date(`${dateParam}T00:00:00`)
      : new Date();

    const [rows, logs, employees] = await Promise.all([
      listDaily(db, date),
      db.attendanceClockLog.findMany({
        where: { timestamp: { gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()), lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) } },
        include: { employee: { select: { employeeNo: true, fullName: true } } },
        orderBy: { timestamp: "asc" },
      }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);

    const stats = {
      total: rows.length,
      present: rows.filter((r) => r.status === "Present").length,
      late: rows.filter((r) => r.status === "Late").length,
      absent: rows.filter((r) => r.status === "Absent").length,
      workoff: rows.filter((r) => r.status === "WorkOff").length,
      off: rows.filter((r) => r.status === "Off").length,
      lateMinutes: rows.reduce((s, r) => s + r.lateMinutes, 0),
      overtimeMinutes: rows.reduce((s, r) => s + r.overtimeMinutes, 0),
    };
    return NextResponse.json({ date: date.toISOString().slice(0, 10), rows, logs, employees, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — catat clock manual/web (padanan Temporary Employee Clocking):
// body { employeeId, time: "HH:MM", direction, note } → log + rekap ulang.
// Guard hak AKSI menu attendance:clocking + VIEWER (requireMenuAction).
export async function POST(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu (input clock) — dulu hanya role-check.
    const m = await requireMenuAction(req, "attendance:clocking", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const dateParam = String(b.date ?? "");
    const time = String(b.time ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: "Tanggal & jam wajib (YYYY-MM-DD, HH:MM)" }, { status: 400 });
    }
    const timestamp = new Date(`${dateParam}T${time}:00`);
    await recordClockLog(m.db, {
      employeeId: String(b.employeeId ?? ""),
      timestamp,
      direction: b.direction === "OUT" ? "OUT" : "IN",
      source: "Manual",
      note: b.note ?? null,
    });
    const rows = await listDaily(m.db, timestamp);
    return NextResponse.json({ ok: true, rows }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — hitung ulang rekap satu tanggal (padanan "Refresh Clocking").
// Guard hak AKSI menu attendance:clocking + VIEWER (requireMenuAction) — regenerasi adalah operasi tulis.
export async function PATCH(req: NextRequest) {
  try {
    // Task 79 — guard hak AKSI menu (regenerasi rekap harian).
    const m = await requireMenuAction(req, "attendance:clocking", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    const dateParam = String(b.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return NextResponse.json({ error: "Tanggal wajib (YYYY-MM-DD)" }, { status: 400 });
    }
    const date = new Date(`${dateParam}T00:00:00`);
    const count = await regenerateDaily(m.db, date);
    const rows = await listDaily(m.db, date);
    return NextResponse.json({ regenerated: count, rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
