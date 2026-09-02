import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// GET /api/onevity/attendance/day-types — master tipe hari (padanan DayType.jsp)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const dayTypes = await db.workDayType.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
    });
    return NextResponse.json({ dayTypes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat tipe hari baru
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
