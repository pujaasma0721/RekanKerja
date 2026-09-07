import { NextRequest, NextResponse } from "next/server";
import { requireEssActor } from "@/onevity/ess/lib/ess-guard";
import { recordClockLog, resolveDayType, listDaily } from "@/onevity/time-attendance/services/attendance-service";

// POST /api/ess/attendance/clock — Clock In/Out dari web ESS (source "Web").
// Body: { direction: "IN" | "OUT", note?: string }
// Timestamp = waktu server (jujur, tak bisa dimanipulasi klien).
// Validasi UX: IN ganda / OUT tanpa IN / OUT ganda ditolak 409.
export async function POST(req: NextRequest) {
  try {
    const m = await requireEssActor(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, employeeId } = m;

    const b = await req.json().catch(() => ({}));
    const direction = b.direction === "OUT" ? "OUT" : b.direction === "IN" ? "IN" : null;
    if (!direction) return NextResponse.json({ error: "direction wajib IN atau OUT" }, { status: 400 });
    const note = b.note ? String(b.note).slice(0, 200) : null;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);

    // jadwal hari ini — tanpa day type tidak ada konteks absensi
    const schedule = await resolveDayType(db, employeeId, today);
    if (!schedule.dayType) {
      return NextResponse.json(
        { error: "Tidak ada jadwal kerja untuk Anda hari ini — clock in/out tidak tersedia. Hubungi HR bila seharusnya ada." },
        { status: 409 },
      );
    }
    if (!schedule.assignment.clockingRequired) {
      return NextResponse.json(
        { error: "Jadwal Anda hari ini tidak mengharuskan clock in/out (non-clocking)." },
        { status: 409 },
      );
    }

    // log hari ini — validasi urutan IN/OUT
    const logs = await db.attendanceClockLog.findMany({
      where: { employeeId, timestamp: { gte: today, lt: tomorrow } },
      orderBy: { timestamp: "asc" },
      select: { direction: true, timestamp: true },
    });
    const hasIn = logs.some((l) => l.direction === "IN");
    const hasOut = logs.some((l) => l.direction === "OUT");
    if (direction === "IN" && hasIn) {
      return NextResponse.json({ error: "Anda sudah clock-in hari ini." }, { status: 409 });
    }
    if (direction === "OUT") {
      if (!hasIn) return NextResponse.json({ error: "Belum clock-in — clock-out tidak bisa sebelum clock-in." }, { status: 409 });
      if (hasOut) return NextResponse.json({ error: "Anda sudah clock-out hari ini." }, { status: 409 });
    }

    await recordClockLog(db, {
      employeeId,
      timestamp: now,
      direction,
      source: "Web",
      note,
    });

    // baris harian terbaru setelah regenerasi
    const rows = await listDaily(db, today, employeeId);
    const todayRow = rows[0] ?? null;

    return NextResponse.json({
      ok: true,
      direction,
      time: now.toISOString(),
      today: todayRow
        ? {
            date: todayRow.workDate.toISOString().slice(0, 10),
            status: todayRow.status,
            checkIn: todayRow.checkIn,
            checkOut: todayRow.checkOut,
            lateMinutes: todayRow.lateMinutes,
            workMinutes: todayRow.workMinutes,
          }
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
