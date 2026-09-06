// POST /api/onevity/ess/clock — presensi mandiri ESS (kontrak T8-ESS-FRONTEND).
// Body: { direction: "IN"|"OUT", latitude?, longitude?, note? }
// Validasi: jadwal hari ini ADA & clockingRequired; IN tunggal per hari;
// OUT wajib setelah IN. Log ditulis source "Web" + koordinat (kolom baru
// T7-ESS), lalu rekap hari itu dihitung ulang (regenerateDaily).
import { NextResponse } from "next/server";
import { requireEss, fmtHhMm } from "@/onevity/ess/api/ess-auth";
import { dayStart, addDays, resolveDayType, regenerateDaily } from "@/onevity/time-attendance/services/attendance-service";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const direction = String(b.direction ?? "").toUpperCase();
    const note = b.note != null ? String(b.note).slice(0, 200) : null;

    if (direction !== "IN" && direction !== "OUT") {
      return NextResponse.json({ error: "direction harus IN atau OUT" }, { status: 400 });
    }

    // koordinat opsional (number)
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (b.latitude != null) {
      const lat = Number(b.latitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return NextResponse.json({ error: "latitude tidak valid" }, { status: 400 });
      }
      latitude = lat;
    }
    if (b.longitude != null) {
      const lng = Number(b.longitude);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return NextResponse.json({ error: "longitude tidak valid" }, { status: 400 });
      }
      longitude = lng;
    }

    const now = new Date();
    const today = dayStart(now);
    const tomorrow = addDays(today, 1);

    // validasi jadwal: assignment aktif hari ini + clocking required
    const { assignment } = await resolveDayType(db, employeeId, today);
    if (!assignment.id) {
      return NextResponse.json(
        { error: "Tidak ada jadwal kerja aktif untuk Anda pada hari ini — hubungi HR" },
        { status: 400 },
      );
    }
    if (assignment.clockingRequired === false) {
      return NextResponse.json(
        { error: "Jadwal Anda non-clocking (jam kerja dianggap normal) — clock tidak diperlukan" },
        { status: 400 },
      );
    }

    // clock log hari ini (window [00:00, 00:00 besok))
    const logs = await db.attendanceClockLog.findMany({
      where: { employeeId, timestamp: { gte: today, lt: tomorrow } },
      orderBy: { timestamp: "asc" },
      select: { direction: true, timestamp: true },
    });
    const firstIn = logs.find((l) => l.direction === "IN");

    if (direction === "IN") {
      if (firstIn) {
        return NextResponse.json(
          { error: `Clock-in hari ini sudah tercatat pukul ${fmtHhMm(firstIn.timestamp)}` },
          { status: 400 },
        );
      }
    } else {
      if (!firstIn) {
        return NextResponse.json(
          { error: "Belum ada clock-in hari ini — clock-out wajib setelah clock-in" },
          { status: 400 },
        );
      }
    }

    await db.attendanceClockLog.create({
      data: {
        employeeId,
        timestamp: now,
        direction,
        source: "Web",
        note: note?.trim() || null,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
      },
    });

    // rekap hari ini dihitung ulang (IN/OUT baru langsung tercermin)
    await regenerateDaily(db, today, employeeId);

    return NextResponse.json({ ok: true, time: fmtHhMm(now) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
