import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// GET /api/onevity/component-assignments?kind=&employeeId=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const kind = req.nextUrl.searchParams.get("kind");
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    const assignments = await db.employeeComponentAssignment.findMany({
      where: {
        ...(kind && kind !== "all" ? { kind } : {}),
        ...(employeeId ? { employeeId } : {}),
      },
      include: {
        employee: { select: { employeeNo: true, fullName: true } },
        wageComponent: true,
        period: true,
        processType: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ assignments });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/component-assignments — komponen khusus (Specific) / periodik (Periodic)
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    if (!b.employeeId || !b.wageComponentId) {
      return NextResponse.json({ error: "Karyawan & komponen wajib dipilih" }, { status: 400 });
    }
    const kind = b.kind === "Periodic" ? "Periodic" : "Specific";
    if (kind === "Specific" && (!b.periodId || !b.processTypeId)) {
      return NextResponse.json({ error: "Komponen khusus perlu period & jenis proses" }, { status: 400 });
    }
    const comp = await db.wageComponent.findUnique({ where: { id: b.wageComponentId } });
    if (!comp) return NextResponse.json({ error: "Komponen tidak ditemukan" }, { status: 404 });

    // M-8 (MAJOR): komponen Specific untuk period × processType yang run-nya sudah
    // Confirmed/Paid tidak akan pernah dibayar — run final tak dapat dihitung
    // ulang, dan run baru period+type yang sama ditolak guard duplikat →
    // komponen terjebak. Tolak di muka (pilih period/jenis proses lain).
    if (kind === "Specific") {
      const finalRun = await db.payrollRun.findFirst({
        where: { periodId: b.periodId, processTypeId: b.processTypeId, status: { in: ["Confirmed", "Paid"] } },
      });
      if (finalRun) {
        return NextResponse.json(
          { error: `Run ${finalRun.runNo} untuk period × jenis proses ini sudah ${finalRun.status === "Paid" ? "dibayar" : "dikonfirmasi"} — komponen khusus tidak akan pernah diproses; pilih period/jenis proses lain` },
          { status: 400 }
        );
      }
    }

    const assignment = await db.employeeComponentAssignment.create({
      data: {
        employeeId: b.employeeId,
        wageComponentId: b.wageComponentId,
        kind,
        amount: Number(b.amount ?? 0),
        periodId: kind === "Specific" ? b.periodId : null,
        processTypeId: kind === "Specific" ? b.processTypeId : null,
        basedDate: b.basedDate ? new Date(b.basedDate) : null,
        notes: b.notes ?? null,
      },
      include: { employee: { select: { employeeNo: true, fullName: true } }, wageComponent: true, period: true, processType: true },
    });
    await db.activityLog.create({
      data: { action: "Created", entity: "EmployeeComponentAssignment", entityId: assignment.id, employeeId: b.employeeId, detail: `Komponen ${comp.name} (${kind}) ${assignment.employee.fullName}` },
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/component-assignments?id=
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const a = await db.employeeComponentAssignment.findUnique({ where: { id } });
    if (!a) return NextResponse.json({ error: "Data tidak ditemukan" }, { status: 404 });
    await db.employeeComponentAssignment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
