import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const grades = await db.grade.findMany({
      include: { _count: { select: { assignments: { where: { validTo: null } }, positions: true } } },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json({
      grades: grades.map((g) => ({
        id: g.id, code: g.code, name: g.name, minSalary: g.minSalary, maxSalary: g.maxSalary,
        sortOrder: g.sortOrder, active: g.active,
        employeeCount: g._count.assignments, positionCount: g._count.positions,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.code || !b.name) return NextResponse.json({ error: "Kode dan nama grade wajib diisi" }, { status: 400 });
    const exists = await db.grade.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode grade ${b.code} sudah dipakai` }, { status: 400 });
    const grade = await db.grade.create({
      data: {
        code: b.code, name: b.name,
        minSalary: Number(b.minSalary ?? 0), maxSalary: Number(b.maxSalary ?? 0),
        sortOrder: Number(b.sortOrder ?? 0),
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "Grade", entityId: grade.id, detail: `Grade ${grade.code} dibuat` } });
    return NextResponse.json({ grade }, { status: 201 });
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
    const grade = await db.grade.update({
      where: { id: b.id },
      data: {
        name: b.name,
        minSalary: b.minSalary != null ? Number(b.minSalary) : undefined,
        maxSalary: b.maxSalary != null ? Number(b.maxSalary) : undefined,
        active: b.active,
      },
    });
    return NextResponse.json({ grade });
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
    const [emp, pos] = await Promise.all([
      db.employeeAssignment.count({ where: { validTo: null, gradeId: id } }),
      db.position.count({ where: { gradeId: id } }),
    ]);
    if (emp > 0 || pos > 0) return NextResponse.json({ error: `Grade masih dipakai (${emp} karyawan, ${pos} posisi)` }, { status: 400 });
    await db.grade.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
