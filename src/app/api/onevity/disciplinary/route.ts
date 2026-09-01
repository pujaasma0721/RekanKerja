import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET (?employeeId= optional → all records) | POST | DELETE ?id=
export async function GET(req: NextRequest) {
  try {
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const disciplinary = await db.disciplinaryRecord.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: { employee: { select: { id: true, fullName: true, employeeNo: true, position: { select: { title: true } }, orgUnit: { select: { name: true } } } } },
      orderBy: { issuedAt: "desc" },
    });
    return NextResponse.json({ disciplinary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.employeeId || !b.violation) return NextResponse.json({ error: "Pelanggaran wajib diisi" }, { status: 400 });
    const rec = await db.disciplinaryRecord.create({
      data: {
        employeeId: b.employeeId, warningLevel: b.warningLevel ?? "Verbal",
        violation: b.violation, sanction: b.sanction ?? null,
        issuedAt: b.issuedAt ? new Date(b.issuedAt) : new Date(),
        expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
        notes: b.notes ?? null,
      },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "DisciplinaryRecord", entityId: rec.id, employeeId: b.employeeId, detail: `Pelanggaran dicatat: ${b.violation} (${b.warningLevel ?? "Verbal"})` },
    });
    return NextResponse.json({ disciplinary: rec }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.disciplinaryRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
