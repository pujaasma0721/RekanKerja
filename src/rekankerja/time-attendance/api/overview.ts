import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { attendanceStats, attendanceCoverage } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/overview — KPI dashboard modul attendance
// (hari ini + bulan berjalan + approval menunggu).
// G-04 (audit 42): properti baru `coverage` — populasi harapan vs baris
// AttendanceDaily yang ada (indikator kualitas data; konsumen lama tak rusak).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const now = new Date();
    const dateParam = req.nextUrl.searchParams.get("date");
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T00:00:00`) : now;
    const monthFrom = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthTo = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const [stats, coverage] = await Promise.all([
      attendanceStats(db, date, monthFrom, monthTo),
      attendanceCoverage(db, monthFrom, monthTo),
    ]);
    return NextResponse.json({ ...stats, coverage });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
