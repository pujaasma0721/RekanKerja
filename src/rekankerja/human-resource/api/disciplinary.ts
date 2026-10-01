import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// GET (?employeeId= optional → all records) | POST | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 82-T5: GET dijaga view menu (dulu requireTenant — catatan disiplin
// sensitif). Dipakai menu Catatan Disiplin + panel detail karyawan (hr:directory).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["hr:directory", "hr:disciplinary"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const records = await db.disciplinaryRecord.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: {
        employee: {
          select: {
            id: true, fullName: true, employeeNo: true,
            // posisi/unit saat ini dari assignment aktif
            assignments: {
              where: { validTo: null },
              orderBy: { validFrom: "desc" },
              take: 1,
              include: { position: { select: { title: true } }, orgUnit: { select: { name: true } } },
            },
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });
    const disciplinary = records.map((r) => {
      const cur = r.employee.assignments[0] ?? null;
      const { assignments: _a, ...emp } = r.employee as typeof r.employee & { assignments?: unknown[] };
      return {
        ...r,
        employee: { ...emp, position: cur?.position ?? null, orgUnit: cur?.orgUnit ?? null },
      };
    });
    return NextResponse.json({ disciplinary });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

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
    const m = await requireMenuAction(req, "hr:directory", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await db.disciplinaryRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
