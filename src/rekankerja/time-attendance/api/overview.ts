import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { attendanceStats, attendanceCoverage } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/overview — KPI dashboard modul attendance
// (hari ini + bulan berjalan + approval menunggu).
// G-04 (audit 42): properti baru `coverage` — populasi harapan vs baris
// AttendanceDaily yang ada (indikator kualitas data; konsumen lama tak rusak).
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:schedules (dulu
// requireTenant: KPI presensi perusahaan terbaca tanpa hak LIHAT menu).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:schedules"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

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
