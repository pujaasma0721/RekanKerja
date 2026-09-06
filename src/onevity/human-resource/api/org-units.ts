import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";

// GET /api/onevity/org-units[?withTree=1]
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const withTree = req.nextUrl.searchParams.get("withTree") === "1";
    const units = await db.orgUnit.findMany({
      where: { active: true },
      include: { parent: { select: { name: true } }, _count: { select: { assignments: { where: { validTo: null } }, positions: true, children: true } } },
      orderBy: [{ level: "asc" }, { code: "asc" }],
    });
    const flat = units.map((u) => ({
      id: u.id, code: u.code, name: u.name, parentId: u.parentId, level: u.level,
      headcountBudget: u.headcountBudget, active: u.active,
      parentName: u.parent?.name ?? null,
      employeeCount: u._count.assignments, positionCount: u._count.positions, childCount: u._count.children,
    }));
    if (!withTree) return NextResponse.json({ units: flat });
    // build nested tree
    const map = new Map(flat.map((u) => [u.id, { ...u, children: [] as unknown[] }]));
    const roots: unknown[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) (map.get(node.parentId)!.children as unknown[]).push(node);
      else roots.push(node);
    }
    return NextResponse.json({ units: flat, tree: roots });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create unit — T1-SECURITY: guard hak AKSI menu hr:tree (Unit Organisasi).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama unit wajib diisi" }, { status: 400 });
    const exists = await db.orgUnit.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode unit ${b.code} sudah dipakai` }, { status: 400 });
    let level = 1;
    if (b.parentId) {
      const parent = await db.orgUnit.findUnique({ where: b.parentId });
      if (!parent) return NextResponse.json({ error: "Unit induk tidak ditemukan" }, { status: 400 });
      level = parent.level + 1;
    }
    const company = b.companyId ? await db.company.findUnique({ where: { id: b.companyId } }) : await db.company.findFirst();
    if (!company) return NextResponse.json({ error: "Perusahaan tidak ditemukan" }, { status: 400 });
    const unit = await db.orgUnit.create({
      data: {
        code: b.code, name: b.name, parentId: b.parentId ?? null,
        companyId: company.id, level, headcountBudget: Number(b.headcountBudget ?? 0),
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "OrgUnit", entityId: unit.id, detail: `Unit organisasi ${unit.name} (${unit.code}) dibuat` } });
    return NextResponse.json({ unit }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH update — T1-SECURITY: guard hak AKSI menu hr:tree (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const unit = await db.orgUnit.update({
      where: { id: b.id },
      data: {
        name: b.name, headcountBudget: b.headcountBudget != null ? Number(b.headcountBudget) : undefined,
        active: b.active,
      },
    });
    await db.activityLog.create({ data: { action: "Updated", entity: "OrgUnit", entityId: unit.id, detail: `Unit ${unit.name} diperbarui` } });
    return NextResponse.json({ unit });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id= — T1-SECURITY: guard hak AKSI menu hr:tree (Hapus).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:tree", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const [children, employees, positions] = await Promise.all([
      db.orgUnit.count({ where: { parentId: id } }),
      db.employeeAssignment.count({ where: { validTo: null, orgUnitId: id } }),
      db.position.count({ where: { orgUnitId: id } }),
    ]);
    if (children > 0) return NextResponse.json({ error: "Unit memiliki sub-unit — hapus/pindahkan sub-unit terlebih dahulu" }, { status: 400 });
    if (employees > 0) return NextResponse.json({ error: `Unit masih memiliki ${employees} karyawan aktif` }, { status: 400 });
    if (positions > 0) return NextResponse.json({ error: `Unit masih memiliki ${positions} posisi` }, { status: 400 });
    const unit = await db.orgUnit.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "OrgUnit", entityId: id, detail: `Unit ${unit.name} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
