import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET ?employeeId= | POST | DELETE ?id=
export async function GET(req: NextRequest) {
  try {
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const experiences = await db.employeeExperience.findMany({ where: { employeeId }, orderBy: { endDate: "desc" } });
    return NextResponse.json({ experiences });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.employeeId || !b.company || !b.position) return NextResponse.json({ error: "Perusahaan & posisi wajib diisi" }, { status: 400 });
    const exp = await db.employeeExperience.create({
      data: {
        employeeId: b.employeeId, company: b.company, position: b.position,
        startDate: b.startDate ? new Date(b.startDate) : null, endDate: b.endDate ? new Date(b.endDate) : null,
        notes: b.notes ?? null,
      },
    });
    return NextResponse.json({ experience: exp }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.employeeExperience.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
