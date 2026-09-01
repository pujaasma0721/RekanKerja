import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET ?employeeId= | POST | DELETE ?id=
export async function GET(req: NextRequest) {
  try {
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
    const education = await db.employeeEducation.findMany({ where: { employeeId }, orderBy: { endYear: "desc" } });
    return NextResponse.json({ education });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.employeeId || !b.level || !b.institution) return NextResponse.json({ error: "Jenjang & institusi wajib diisi" }, { status: 400 });
    const edu = await db.employeeEducation.create({
      data: {
        employeeId: b.employeeId, level: b.level, institution: b.institution, major: b.major ?? null,
        startYear: b.startYear ? Number(b.startYear) : null, endYear: b.endYear ? Number(b.endYear) : null,
        gpa: b.gpa ? Number(b.gpa) : null,
      },
    });
    return NextResponse.json({ education: edu }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.employeeEducation.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
