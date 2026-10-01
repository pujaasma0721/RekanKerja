import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// GET /api/rekankerja/positions?q=&orgUnitId=&gradeId=&active=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() ?? "";
    const orgUnitId = sp.get("orgUnitId");
    const gradeId = sp.get("gradeId");
    const active = sp.get("active");

    const where: Record<string, unknown> = {};
    if (q) where.OR = [{ code: { contains: q } }, { title: { contains: q } }];
    if (orgUnitId && orgUnitId !== "all") where.orgUnitId = orgUnitId;
    if (gradeId && gradeId !== "all") where.gradeId = gradeId;
    if (active === "true") where.active = true;
    if (active === "false") where.active = false;

    const positions = await db.position.findMany({
      where,
      include: {
        job: { select: { title: true, code: true } },
        orgUnit: { select: { name: true, code: true } },
        grade: { select: { code: true, name: true } },
        reportsTo: { select: { title: true, code: true } },
        // pemegang posisi = karyawan dengan assignment aktif di posisi ini
        assignments: {
          where: { validTo: null, employee: { status: "Active" } },
          select: { employee: { select: { id: true, fullName: true, employeeNo: true } } },
          take: 1,
          orderBy: { employee: { employeeNo: "asc" } },
        },
        _count: { select: { directReports: true, assignments: { where: { validTo: null } } } },
      },
      orderBy: { code: "asc" },
    });
    return NextResponse.json({
      positions: positions.map((p) => ({
        id: p.id, code: p.code, title: p.title, level: p.level,
        headcount: p.headcount, filled: p._count.assignments, active: p.active,
        job: p.job, orgUnit: p.orgUnit, grade: p.grade, reportsTo: p.reportsTo,
        directReportCount: p._count.directReports,
        employees: p.assignments.map((a) => a.employee),
        unitId: p.orgUnitId,
      })),
      total: positions.length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST create — T1-SECURITY: guard hak AKSI menu hr:list (Baru) per pengguna.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:list", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.code || !b.title) return NextResponse.json({ error: "Kode dan judul posisi wajib diisi" }, { status: 400 });
    const exists = await db.position.findUnique({ where: { code: b.code } });
    if (exists) return NextResponse.json({ error: `Kode posisi ${b.code} sudah dipakai` }, { status: 400 });
    if (b.jobId) {
      const job = await db.job.findUnique({ where: { id: b.jobId } });
      if (!job) return NextResponse.json({ error: "Job tidak ditemukan" }, { status: 400 });
    }
    const grade = b.gradeId ? await db.grade.findUnique({ where: { id: b.gradeId } }) : null;
    const position = await db.position.create({
      data: {
        code: b.code, title: b.title, jobId: b.jobId ?? null, orgUnitId: b.orgUnitId ?? null,
        gradeId: b.gradeId ?? null, level: grade?.code ?? b.level ?? null,
        headcount: Number(b.headcount ?? 1), reportsToId: b.reportsToId ?? null,
      },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "Position", entityId: position.id, detail: `Posisi ${position.title} (${position.code}) dibuat` } });
    return NextResponse.json({ position }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH update — T1-SECURITY: guard hak AKSI menu hr:list (Ubah).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:list", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const position = await db.position.update({
      where: { id: b.id },
      data: {
        title: b.title, jobId: b.jobId, orgUnitId: b.orgUnitId, gradeId: b.gradeId,
        headcount: b.headcount != null ? Number(b.headcount) : undefined,
        reportsToId: b.reportsToId, active: b.active,
      },
    });
    await db.activityLog.create({ data: { action: "Updated", entity: "Position", entityId: position.id, detail: `Posisi ${position.title} diperbarui` } });
    return NextResponse.json({ position });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id= — T1-SECURITY: guard hak AKSI menu hr:list (Hapus).
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:list", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const count = await db.employeeAssignment.count({ where: { positionId: id } });
    if (count > 0) return NextResponse.json({ error: `Posisi masih dipegang ${count} karyawan` }, { status: 400 });
    const reports = await db.position.count({ where: { reportsToId: id } });
    if (reports > 0) return NextResponse.json({ error: `Posisi masih menjadi atasan dari ${reports} posisi lain` }, { status: 400 });
    const position = await db.position.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "Position", entityId: id, detail: `Posisi ${position.title} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
