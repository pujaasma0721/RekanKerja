import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { isValidTimeStr } from "@/rekankerja/time-attendance/services/attendance-service";

// GET /api/rekankerja/attendance/day-types — master tipe hari (padanan DayType.jsp)
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:templates-schedule
// (dulu requireTenant; pola GET attendance kini berhak LIHAT per pengguna).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:templates-schedule"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const dayTypes = await db.workDayType.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
    });
    return NextResponse.json({ dayTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat tipe hari baru
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Baru).
// Task 100 (G6, audit A-03) — validasi KETAT HH:MM utk timeIn/timeOut + urutan
// jam (timeIn < timeOut; terbalik hanya sah utk nextDay lintas tengah malam).
// Dulu string bebas → jam rusak (mis. "9:zz", "25:99") tersimpan → atTime()
// menghasilkan Invalid Date → telat/lembur/pulang cepat salah hitung.
function dayTypeError(timeIn: string | null, timeOut: string | null, nextDay: boolean): string | null {
  if (timeIn != null && !isValidTimeStr(timeIn)) {
    return `Jam masuk "${timeIn}" tidak valid — gunakan format HH:MM (jam 00–23, menit 00–59, mis. 08:00)`;
  }
  if (timeOut != null && !isValidTimeStr(timeOut)) {
    return `Jam keluar "${timeOut}" tidak valid — gunakan format HH:MM (jam 00–23, menit 00–59, mis. 17:00)`;
  }
  if (timeIn != null && timeOut != null && timeIn === timeOut) {
    return "Jam masuk dan jam keluar tidak boleh sama";
  }
  if (timeIn != null && timeOut != null && timeIn > timeOut && !nextDay) {
    return `Jam masuk ${timeIn} ≥ jam keluar ${timeOut} — hanya sah bila lintas tengah malam (centang "pulang hari berikutnya")`;
  }
  return null;
}
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const code = String(b.code ?? "").trim().toUpperCase();
    const name = String(b.name ?? "").trim();
    if (!code || !name) return NextResponse.json({ error: "Kode & nama tipe hari wajib diisi" }, { status: 400 });
    const clash = await db.workDayType.findUnique({ where: { code } });
    if (clash) return NextResponse.json({ error: `Kode ${code} sudah dipakai` }, { status: 400 });

    const category = ["Workday", "Off", "Holiday"].includes(b.category) ? b.category : "Workday";
    const timeIn = b.timeIn ? String(b.timeIn) : null;
    const timeOut = b.timeOut ? String(b.timeOut) : null;
    if (category === "Workday" && (!timeIn || !timeOut)) {
      return NextResponse.json({ error: "Tipe hari kerja wajib punya jam masuk & keluar" }, { status: 400 });
    }
    const nextDay = Boolean(b.nextDay);
    // Task 100 (G6) — tolak format jam rusak / urutan terbalik tanpa nextDay.
    const err = dayTypeError(timeIn, timeOut, nextDay);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    const normalMinutes = Math.max(0, Math.min(960, parseInt(b.normalMinutes ?? 0, 10) || 0));

    const dayType = await db.workDayType.create({
      data: {
        code, name, color: String(b.color ?? "#99CCFF"), category,
        timeIn, timeOut, nextDay,
        breakMinutes: Math.max(0, parseInt(b.breakMinutes ?? 0, 10) || 0),
        breakPaid: Boolean(b.breakPaid),
        normalMinutes,
        toleranceLateMinutes: Math.max(0, parseInt(b.toleranceLateMinutes ?? 0, 10) || 0),
        toleranceEarlyMinutes: Math.max(0, parseInt(b.toleranceEarlyMinutes ?? 0, 10) || 0),
        flexible: Boolean(b.flexible),
        needOvertimeOrder: b.needOvertimeOrder === undefined ? true : Boolean(b.needOvertimeOrder),
      },
    });
    return NextResponse.json({ dayType }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — perbarui / nonaktifkan
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.workDayType.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Tipe hari tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = String(b.name).trim() || existing.name;
    if (b.color !== undefined) data.color = String(b.color);
    if (b.category !== undefined && ["Workday", "Off", "Holiday"].includes(b.category)) data.category = b.category;
    if (b.timeIn !== undefined) data.timeIn = b.timeIn ? String(b.timeIn) : null;
    if (b.timeOut !== undefined) data.timeOut = b.timeOut ? String(b.timeOut) : null;
    if (b.nextDay !== undefined) data.nextDay = Boolean(b.nextDay);
    // Task 100 (G6) — validasi hasil gabungan PATCH terhadap nilai AKHIR
    // (nilai bawaan baris lama utk field yang tidak dikirim).
    {
      const finalTimeIn = (data.timeIn !== undefined ? data.timeIn : existing.timeIn) as string | null;
      const finalTimeOut = (data.timeOut !== undefined ? data.timeOut : existing.timeOut) as string | null;
      const finalNextDay = data.nextDay !== undefined ? (data.nextDay as boolean) : existing.nextDay;
      const err = dayTypeError(finalTimeIn, finalTimeOut, finalNextDay);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }
    if (b.breakMinutes !== undefined) data.breakMinutes = Math.max(0, parseInt(b.breakMinutes, 10) || 0);
    if (b.breakPaid !== undefined) data.breakPaid = Boolean(b.breakPaid);
    if (b.normalMinutes !== undefined) data.normalMinutes = Math.max(0, Math.min(960, parseInt(b.normalMinutes, 10) || 0));
    if (b.toleranceLateMinutes !== undefined) data.toleranceLateMinutes = Math.max(0, parseInt(b.toleranceLateMinutes, 10) || 0);
    if (b.toleranceEarlyMinutes !== undefined) data.toleranceEarlyMinutes = Math.max(0, parseInt(b.toleranceEarlyMinutes, 10) || 0);
    if (b.flexible !== undefined) data.flexible = Boolean(b.flexible);
    if (b.needOvertimeOrder !== undefined) data.needOvertimeOrder = Boolean(b.needOvertimeOrder);
    if (b.active !== undefined) data.active = Boolean(b.active);

    const dayType = await db.workDayType.update({ where: { id: b.id }, data });
    return NextResponse.json({ dayType });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
