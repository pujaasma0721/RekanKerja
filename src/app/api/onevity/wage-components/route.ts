import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/wage-components?type=
export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get("type");
    const where = type && type !== "all" ? { type } : {};
    const components = await db.wageComponent.findMany({ where, orderBy: [{ type: "asc" }, { code: "asc" }] });
    const counts = await db.wageComponent.groupBy({ by: ["type"], _count: true });
    const typeCounts: Record<string, number> = {};
    for (const c of counts) typeCounts[c.type] = c._count;
    return NextResponse.json({ components, typeCounts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama komponen wajib diisi" }, { status: 400 });
    const exists = await db.wageComponent.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode ${b.code} sudah dipakai` }, { status: 400 });
    const comp = await db.wageComponent.create({
      data: {
        code: b.code, name: b.name, type: b.type ?? "Earning", calcMethod: b.calcMethod ?? "Fixed",
        amount: Number(b.amount ?? 0), prorated: b.prorated ?? false, taxable: b.taxable ?? true,
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "WageComponent", entityId: comp.id, detail: `Komponen upah ${comp.name} dibuat` } });
    return NextResponse.json({ component: comp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const comp = await db.wageComponent.update({
      where: { id: b.id },
      data: {
        name: b.name, type: b.type, calcMethod: b.calcMethod,
        amount: b.amount != null ? Number(b.amount) : undefined,
        prorated: b.prorated, taxable: b.taxable, active: b.active,
      },
    });
    return NextResponse.json({ component: comp });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.wageComponent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
