import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// ============ POSITION LEVEL (level jabatan) ============

// GET /api/onevity/position-levels
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const levels = await db.positionLevel.findMany({
      include: { _count: { select: { positions: true, employees: { where: { status: "Active" } } } } },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json({
      levels: levels.map((l) => ({
        id: l.id, code: l.code, name: l.name, sortOrder: l.sortOrder, active: l.active,
        positionCount: l._count.positions, employeeCount: l._count.employees,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/position-levels
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama level jabatan wajib diisi" }, { status: 400 });
    const exists = await db.positionLevel.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode level ${b.code} sudah dipakai` }, { status: 400 });

    const level = await db.positionLevel.create({
      data: { code: b.code, name: b.name, sortOrder: Number(b.sortOrder ?? 0) },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "PositionLevel", entityId: level.id, detail: `Level jabatan ${level.code} — ${level.name} dibuat` } });
    return NextResponse.json({ level }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/position-levels
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (b.name != null) data.name = String(b.name);
    if (b.sortOrder != null) data.sortOrder = Number(b.sortOrder);
    if (b.active != null) data.active = !!b.active;
    const level = await db.positionLevel.update({ where: { id: b.id }, data });
    return NextResponse.json({ level });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/position-levels?id=
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const [pos, emp, used] = await Promise.all([
      db.position.count({ where: { positionLevelId: id } }),
      db.employee.count({ where: { positionLevelId: id } }),
      db.approvalStructure.count({ where: { positionLevelId: id } }),
    ]);
    if (pos > 0 || emp > 0) return NextResponse.json({ error: `Level masih dipakai (${pos} posisi, ${emp} karyawan)` }, { status: 400 });
    if (used > 0) return NextResponse.json({ error: `Level dipakai ${used} struktur approval` }, { status: 400 });
    const level = await db.positionLevel.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "PositionLevel", entityId: id, detail: `Level jabatan ${level.code} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
