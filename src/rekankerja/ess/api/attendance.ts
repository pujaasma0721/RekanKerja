// GET /api/rekankerja/ess/attendance?month=YYYY-MM — rekap absensi pribadi
// (kontrak T8-ESS-FRONTEND). Bulan berjalan tanpa data → regenerasi via
// attendance-service (regenerateRange) supaya ESS langsung terisi.
import { NextResponse } from "next/server";
import { requireEss, fmtHhMm, fmtIsoDate } from "@/rekankerja/ess/api/ess-auth";
import { regenerateRange } from "@/rekankerja/time-attendance/services/attendance-service";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month") ?? "";
    const now = new Date();
    let year = now.getFullYear();
    let monthIdx = now.getMonth();

    if (monthParam) {
      if (!/^\d{4}-\d{2}$/.test(monthParam)) {
        return NextResponse.json({ error: "Parameter month harus format YYYY-MM" }, { status: 400 });
      }
      year = Number(monthParam.slice(0, 4));
      monthIdx = Number(monthParam.slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) {
        return NextResponse.json({ error: "Bulan tidak valid" }, { status: 400 });
      }
    }

    const from = new Date(year, monthIdx, 1);
    const to = new Date(year, monthIdx + 1, 1); // eksklusif
    const isCurrentMonth = year === now.getFullYear() && monthIdx === now.getMonth();

    const query = () =>
      db.attendanceDaily.findMany({
        where: { employeeId, workDate: { gte: from, lt: to } },
        include: { dayType: { select: { code: true, category: true } } },
        orderBy: { workDate: "asc" },
      });

    let rows = await query();
    if (rows.length === 0 && isCurrentMonth) {
      // bulan berjalan belum direkap → hitung ulang s.d. hari ini (idempoten).
      // K-5 (audit 42): regen HANYA karyawan yang meminta (scope employeeId) —
      // dulu GET ESS memicu regenerateRange SELURUH PERUSAHAAN per page-view
      // (O(karyawan × hari) kerja berat per request); pelanggan 42+ karyawan
      // membuat halaman pribadi ini membebani DB lintas tenant.
      await regenerateRange(db, from, now, employeeId);
      rows = await query();
    }

    const summary = {
      present: rows.filter((r) => r.status === "Present").length,
      late: rows.filter((r) => r.status === "Late").length,
      absent: rows.filter((r) => r.status === "Absent").length,
      off: rows.filter((r) => r.status === "Off").length,
      onLeave: rows.filter((r) => r.status === "OnLeave").length,
      workoff: rows.filter((r) => r.status === "WorkOff").length,
      overtimeHours: Math.round((rows.reduce((s, r) => s + r.overtimeMinutes, 0) / 60) * 10) / 10,
    };

    return NextResponse.json({
      days: rows.map((r) => ({
        date: fmtIsoDate(r.workDate),
        dayTypeCode: r.dayType?.code ?? null,
        category: r.dayType?.category ?? null,
        status: r.status,
        clockIn: r.checkIn ? fmtHhMm(r.checkIn) : null,
        clockOut: r.checkOut ? fmtHhMm(r.checkOut) : null,
        lateMinutes: r.lateMinutes,
        earlyMinutes: r.earlyMinutes,
        workMinutes: r.workMinutes,
        overtimeMinutes: r.overtimeMinutes,
      })),
      summary,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
