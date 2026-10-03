// POST /api/rekankerja/ess/clock — presensi mandiri ESS (kontrak T8-ESS-FRONTEND).
// Body: { direction: "IN"|"OUT", latitude?, longitude?, note? }
// Validasi: jadwal hari ini ADA & clockingRequired; IN tunggal per hari;
// OUT wajib setelah IN (Task 100 G5: IN kemarin yang belum tertutup juga sah
// utk shift malam lintas hari). Log ditulis source "Web" + koordinat (kolom
// baru T7-ESS), lalu rekap hari itu dihitung ulang (regenerateDaily).
// 27-a P0: geofencing presensi — AttendanceRule.geofenceMode (Off|Warn|Strict)
// × koordinat WorkLocation karyawan. Strict tolak clock di luar radius /
// tanpa koordinat; Warn catat peringatan di note tapi clock tetap sah.
import { NextResponse } from "next/server";
import { requireEss, fmtHhMm } from "@/rekankerja/ess/api/ess-auth";
import { dayStart, addDays, resolveDayType, regenerateDaily } from "@/rekankerja/time-attendance/services/attendance-service";

const GEOFENCE_MODES = ["Off", "Warn", "Strict"] as const;
/** Radius default (meter) bila WorkLocation.radiusMeters kosong. */
const DEFAULT_RADIUS_M = 200;

/** Jarak haversine dua titik koordinat (meter). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const direction = String(b.direction ?? "").toUpperCase();
    let note = b.note != null ? String(b.note).slice(0, 200) : null;

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
      // Aturan 1 IN/hari utk IN baru TIDAK berubah (Task 100 G5 hanya membuka
      // OUT lintas hari di bawah).
      if (firstIn) {
        return NextResponse.json(
          { error: `Clock-in hari ini sudah tercatat pukul ${fmtHhMm(firstIn.timestamp)}` },
          { status: 400 },
        );
      }
    } else {
      if (!firstIn) {
        // Task 100 (G5, audit A-05) — shift malam lintas hari (mis. 22:00–06:00):
        // bila tidak ada IN hari ini, cari IN KEMARIN (window kemarin 12:00 →
        // sekarang) yang belum punya OUT setelahnya → clock-out SAH untuk IN
        // tersebut. Regen engine sudah mendukung clock lintas hari (window
        // D..D+2, outLimit +10 jam setelah jam pulang) — hanya guard ESS ini
        // yang dulu salah menolak ("Belum ada clock-in hari ini").
        const yesterday = addDays(today, -1);
        const sinceYesterdayNoon = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 12, 0, 0, 0);
        const yLogs = await db.attendanceClockLog.findMany({
          where: { employeeId, timestamp: { gte: sinceYesterdayNoon, lt: today } },
          orderBy: { timestamp: "asc" },
          select: { direction: true, timestamp: true },
        });
        const combined = [...yLogs, ...logs]; // gabung + logs hari ini (sudah asc per grup, urutan global aman: kemarin < hari ini)
        let openIn: { timestamp: Date } | null = null;
        for (const l of combined) {
          if (l.direction === "IN") openIn = l;
          else openIn = null; // OUT menutup IN sebelumnya
        }
        if (!openIn) {
          return NextResponse.json(
            { error: "Belum ada clock-in hari ini (atau kemarin sejak tengah hari) yang belum ditutup clock-out — clock-out wajib setelah clock-in" },
            { status: 400 },
          );
        }
      }
    }

    // ===== 27-a: validasi geofencing (sebelum menulis log) =====
    // Mode dari AttendanceRule singleton; koordinat dari lokasi kerja karyawan.
    // Lokasi tanpa koordinat (latitude/longitude null) → geofence tidak berlaku.
    const rule = await db.attendanceRule.findFirst({
      orderBy: { id: "asc" },
      select: { geofenceMode: true },
    });
    const mode = GEOFENCE_MODES.includes(rule?.geofenceMode as (typeof GEOFENCE_MODES)[number])
      ? (rule?.geofenceMode as "Off" | "Warn" | "Strict")
      : "Off";

    if (mode !== "Off") {
      const emp = await db.employee.findUnique({
        where: { id: employeeId },
        select: { workLocationId: true },
      });
      const loc = emp?.workLocationId
        ? await db.workLocation.findUnique({
            where: { id: emp.workLocationId },
            select: { code: true, latitude: true, longitude: true, radiusMeters: true },
          })
        : null;

      if (loc && loc.latitude != null && loc.longitude != null) {
        const radius = loc.radiusMeters && loc.radiusMeters > 0 ? loc.radiusMeters : DEFAULT_RADIUS_M;
        if (latitude == null || longitude == null) {
          if (mode === "Strict") {
            return NextResponse.json(
              {
                error:
                  `Presensi dari lokasi ini wajib mengaktifkan izin lokasi GPS pada perangkat Anda ` +
                  `(mode Geofencing Ketat, lokasi ${loc.code}). Izinkan akses lokasi lalu ulangi presensi.`,
              },
              { status: 400 },
            );
          }
        } else {
          const distance = haversineM(latitude, longitude, loc.latitude, loc.longitude);
          if (distance > radius) {
            if (mode === "Strict") {
              return NextResponse.json(
                {
                  error:
                    `Anda berjarak ${Math.round(distance)} m dari kantor (${loc.code}) — batas presensi ${radius} m. ` +
                    `Presensi hanya sah di dalam area kantor.`,
                },
                { status: 400 },
              );
            }
            // Warn: clock tetap sah, catat peringatan jarak pada note.
            note = `[geofence] jarak ${Math.round(distance)}m > radius ${radius}m${note?.trim() ? ` — ${note.trim()}` : ""}`;
          }
        }
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
