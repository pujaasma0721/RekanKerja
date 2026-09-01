import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

// GET /api/onevity/lookups?category=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const category = req.nextUrl.searchParams.get("category");
    const where = category && category !== "all" ? { category } : {};
    const lookups = await db.lookup.findMany({ where, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] });
    const grouped: Record<string, typeof lookups> = {};
    for (const l of lookups) (grouped[l.category] ??= []).push(l);
    return NextResponse.json({ lookups, grouped });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.category || !b.label) return NextResponse.json({ error: "Kategori & label wajib" }, { status: 400 });
    const code = b.code ?? b.label.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const exists = await db.lookup.findFirst({ where: { category: b.category, code } });
    if (exists) return NextResponse.json({ error: `Entri ${b.label} sudah ada di kategori ini` }, { status: 400 });
    const count = await db.lookup.count({ where: { category: b.category } });
    const lookup = await db.lookup.create({
      data: { category: b.category, code, label: b.label, sortOrder: b.sortOrder ?? count + 1 },
    });
    return NextResponse.json({ lookup }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const lookup = await db.lookup.update({
      where: { id: b.id },
      data: { label: b.label, sortOrder: b.sortOrder, active: b.active },
    });
    return NextResponse.json({ lookup });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.lookup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
