import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

const SCHEDULE_INCLUDE = {
  days: {
    orderBy: { sequence: "asc" as const },
    include: { dayType: { select: { code: true, name: true, color: true, category: true, timeIn: true, timeOut: true, nextDay: true, normalMinutes: true } } },
  },
  _count: { select: { assignments: true } },
} as const;

// GET /api/onevity/attendance/schedules — master jadwal + cycle (padanan WorkSchedule.jsp)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
