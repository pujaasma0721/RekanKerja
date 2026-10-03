import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// Task 52-g — UU 13/2003 Ps.77 ayat (1): 40 jam kerja/minggu, pembagian sah
// 8 jam × 5 hari (≤ 2400 menit/minggu) ATAU pola 6 hari kerja × 7 jam
// (≤ 2520 menit dgn tiap hari kerja ≤ 420 menit). Rata-rata mingguan dihitung
// dari proporsi cycle: (Σ menit hari kerja) × 7 / cycleDays. Tipe hari
// kategori Off/Holiday tidak dihitung (bukan hari kerja).
function assertWeeklyHours(
  dayTypes: { code: string; category: string; normalMinutes: number }[],
  days: string[],
): void {
  const byCode = new Map(dayTypes.map((d) => [d.code, d]));
  let sumMinutes = 0;
  let workdays = 0;
  let maxDayMinutes = 0;
  for (const code of days) {
    const dt = byCode.get(code);
    if (!dt || dt.category !== "Workday") continue;
    workdays += 1;
    sumMinutes += dt.normalMinutes;
    maxDayMinutes = Math.max(maxDayMinutes, dt.normalMinutes);
  }
  const cycleDays = days.length;
  const weeklyAvg = Math.round((sumMinutes * 7) / cycleDays);
  const workdaysPerWeek = (workdays * 7) / cycleDays;
  // F-09 BPA-AUDIT-53 — UU 13/2003 Ps.79 ayat (2): WAJIB 1 hari istirahat
  // mingguan. Cycle tanpa hari Off/Holiday (mis. 7 hari kerja × 6 jam =
  // 2520 menit — lolos batas pola 6 hari sebelumnya) ditolak: rata-rata
  // hari libur per minggu harus ≥ 1 (proporsi cycle × 7).
  const offPerWeek = ((cycleDays - workdays) * 7) / cycleDays;
  if (offPerWeek < 0.99) {
    throw new Error(
      `Cycle ${cycleDays} hari tanpa hari istirahat mingguan (UU 13/2003 Ps.79(2) — wajib ≥1 hari Off/Libur per minggu). Tambahkan tipe hari Off ke cycle.`,
    );
  }
  // pola 6 hari kerja × 7 jam (UU 13/2003 Ps.77(1)(b)): toleransi pembulatan
  // (6.0 tepat, bukan hanya > 6.02) & tiap hari kerja ≤ 7 jam.
  const sixDayPattern = workdaysPerWeek >= 5.98 && maxDayMinutes <= 420;
  const weeklyLimit = sixDayPattern ? 2520 : 2400;
  if (weeklyAvg > weeklyLimit) {
    const jam = (n: number) => (n / 60).toFixed(1).replace(".0", "");
    throw new Error(
      `Rata-rata ${jam(weeklyAvg)} jam kerja/minggu melebihi batas UU 13/2003 Ps.77 (${jam(weeklyLimit)} jam — pola ${sixDayPattern ? "6 hari × 7 jam" : "5 hari × 8 jam"}). Kurangi menit hari kerja atau tambahkan hari libur ke cycle.`,
    );
  }
  if (maxDayMinutes > 480) {
    throw new Error(
      `Hari kerja terpanjang ${(maxDayMinutes / 60).toFixed(1)} jam melebihi 8 jam/hari (UU 13/2003 Ps.77) — perbaiki tipe hari terkait.`,
    );
  }
}

const SCHEDULE_INCLUDE = {
  days: {
    orderBy: { sequence: "asc" as const },
    include: { dayType: { select: { id: true, code: true, name: true, color: true, category: true, timeIn: true, timeOut: true, nextDay: true, normalMinutes: true } } },
  },
  _count: { select: { assignments: true } },
} as const;

// GET /api/rekankerja/attendance/schedules — master jadwal + cycle (padanan WorkSchedule.jsp)
// Task 100 (G1, audit A-01) — guard VIEW menu attendance:templates-schedule
// (dulu requireTenant; master jadwal kini berhak LIHAT per pengguna).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["attendance:templates-schedule"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const [schedules, dayTypes] = await Promise.all([
      db.workSchedule.findMany({ include: SCHEDULE_INCLUDE, orderBy: { code: "asc" } }),
      db.workDayType.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    ]);
    return NextResponse.json({ schedules, dayTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat jadwal (cycle dari daftar day type)
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Baru).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const code = String(b.code ?? "").trim().toUpperCase();
    const name = String(b.name ?? "").trim();
    const days: string[] = Array.isArray(b.days) ? b.days.filter((d: unknown) => typeof d === "string" && d) : [];
    if (!code || !name) return NextResponse.json({ error: "Kode & nama jadwal wajib diisi" }, { status: 400 });
    if (days.length < 1 || days.length > 28) return NextResponse.json({ error: "Cycle 1–28 hari" }, { status: 400 });
    const clash = await db.workSchedule.findUnique({ where: { code } });
    if (clash) return NextResponse.json({ error: `Kode ${code} sudah dipakai` }, { status: 400 });

    const dayTypes = await db.workDayType.findMany({ where: { code: { in: days }, active: true } });
    const byCode = new Map(dayTypes.map((d) => [d.code, d.id]));
    if (byCode.size !== new Set(days).size) {
      return NextResponse.json({ error: "Ada kode tipe hari tidak dikenal / tidak aktif" }, { status: 400 });
    }
    // Task 52-g — validasi 40 jam/minggu (UU 13/2003 Ps.77).
    try {
      assertWeeklyHours(dayTypes, days);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    const schedule = await db.workSchedule.create({
      data: {
        code, name, cycleDays: days.length,
        days: { create: days.map((dtCode, i) => ({ sequence: i + 1, dayTypeId: byCode.get(dtCode)! })) },
      },
      include: SCHEDULE_INCLUDE,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — ganti nama/aktif, atau susun ulang cycle
// T41-M2: guard hak AKSI menu attendance:templates-schedule (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "attendance:templates-schedule", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const existing = await db.workSchedule.findUnique({ where: { id: b.id } });
    if (!existing) return NextResponse.json({ error: "Jadwal tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = String(b.name).trim() || existing.name;
    if (b.active !== undefined) data.active = Boolean(b.active);

    // susun ulang cycle (days = daftar kode tipe hari berurutan)
    if (Array.isArray(b.days)) {
      const days: string[] = b.days.filter((d: unknown) => typeof d === "string" && d);
      if (days.length < 1 || days.length > 28) return NextResponse.json({ error: "Cycle 1–28 hari" }, { status: 400 });
      const dayTypes = await db.workDayType.findMany({ where: { code: { in: days }, active: true } });
      const byCode = new Map(dayTypes.map((d) => [d.code, d.id]));
      if (byCode.size !== new Set(days).size) {
        return NextResponse.json({ error: "Ada kode tipe hari tidak dikenal / tidak aktif" }, { status: 400 });
      }
      // Task 52-g — validasi SEBELUM mutasi (jangan hapus cycle dulu lalu gagal).
      try {
        assertWeeklyHours(dayTypes, days);
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }
      await db.workScheduleDay.deleteMany({ where: { scheduleId: b.id } });
      await db.workScheduleDay.createMany({
        data: days.map((dtCode, i) => ({ scheduleId: b.id, sequence: i + 1, dayTypeId: byCode.get(dtCode)! })),
      });
      data.cycleDays = days.length;
    }

    const schedule = await db.workSchedule.update({ where: { id: b.id }, data, include: SCHEDULE_INCLUDE });
    return NextResponse.json({ schedule });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
