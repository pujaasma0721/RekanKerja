import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/wage-templates
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const template = await db.wageTemplate.findUnique({
        where: { id },
        include: {
          items: { orderBy: { sortOrder: "asc" }, include: { wageComponent: true } },
          _count: { select: { profiles: true } },
        },
      });
      if (!template) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ template });
    }
    const templates = await db.wageTemplate.findMany({
      where: { active: true },
      include: {
        items: { orderBy: { sortOrder: "asc" }, include: { wageComponent: true } },
        _count: { select: { profiles: true } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/wage-templates — buat template + daftar komponen
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode & nama template wajib" }, { status: 400 });
    const exists = await db.wageTemplate.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode ${b.code} sudah dipakai` }, { status: 400 });

    const componentIds: string[] = Array.isArray(b.componentIds) ? b.componentIds : [];
    const template = await db.wageTemplate.create({
      data: {
        code: b.code, name: b.name, description: b.description ?? null,
        items: {
          create: componentIds.map((wageComponentId, i) => ({ wageComponentId, sortOrder: i })),
        },
      },
      include: { items: { include: { wageComponent: true } } },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "WageTemplate", entityId: template.id, detail: `Template upah ${template.name} (${componentIds.length} komponen) dibuat` } });
    return NextResponse.json({ template }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/wage-templates — update nama/deskripsi/daftar komponen
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const template = await db.wageTemplate.findUnique({ where: { id: b.id }, include: { _count: { select: { profiles: true } } } });
    if (!template) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });

    if (Array.isArray(b.componentIds)) {
      await db.wageTemplateItem.deleteMany({ where: { wageTemplateId: b.id } });
      if (b.componentIds.length) {
        await db.wageTemplateItem.createMany({
          data: b.componentIds.map((wageComponentId: string, i: number) => ({ wageTemplateId: b.id, wageComponentId, sortOrder: i })),
        });
      }
    }
    const updated = await db.wageTemplate.update({
      where: { id: b.id },
      data: { name: b.name, description: b.description, active: b.active },
      include: { items: { orderBy: { sortOrder: "asc" }, include: { wageComponent: true } } },
    });
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/wage-templates?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const template = await db.wageTemplate.findUnique({ where: { id }, include: { _count: { select: { profiles: true } } } });
    if (!template) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
    if (template._count.profiles > 0) {
      return NextResponse.json({ error: `Template dipakai ${template._count.profiles} karyawan — pindahkan profil karyawan dulu` }, { status: 400 });
    }
    await db.wageTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
