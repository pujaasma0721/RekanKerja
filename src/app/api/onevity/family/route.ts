import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET ?employeeId= | POST | DELETE ?id=
export async function GET(req: NextRequest) {
  try {
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const family = await db.employeeFamily.findMany({ where: { employeeId }, orderBy: { birthDate: "asc" } });
    return NextResponse.json({ family });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.employeeId || !b.name || !b.relation) return NextResponse.json({ error: "Nama & hubungan wajib diisi" }, { status: 400 });
    const fam = await db.employeeFamily.create({
      data: {
        employeeId: b.employeeId, relation: b.relation, name: b.name, gender: b.gender ?? "M",
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        occupation: b.occupation ?? null, isDependent: b.isDependent ?? true,
      },
    });
    return NextResponse.json({ family: fam }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.employeeFamily.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
