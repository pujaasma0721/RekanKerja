import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";

// GET /api/rekankerja/component-assignments?kind=&employeeId=
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
    // 28-c: dekripsi amount di batas serializer (angka utk frontend).
    // 45-b: gate vault (requireTenant → resolve via sesi; masked → null).
    const mv = await moneyViewForReq(req, db);
    return NextResponse.json({ assignments: mv.json(assignments) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/component-assignments — komponen khusus (Specific) / periodik (Periodic)
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

    // M-8 (MAJOR, revisi Task 64j): komponen Specific untuk period × processType
    // yang run-nya sudah PAID tidak akan pernah dibayar (run paid tidak bisa
    // dihitung ulang) → tolak di muka. Run berstatus Confirmed KINI BOLEH —
    // fitur hitung ulang parsial (recalcEmployees) memungkinkan memasukkan
    // komponen terlambat ke run yang sudah dikonfirmasi (belum dibayar).
    if (kind === "Specific") {
      const paidRun = await db.payrollRun.findFirst({
        where: { periodId: b.periodId, processTypeId: b.processTypeId, status: "Paid" },
      });
      if (paidRun) {
        return NextResponse.json(
          { error: `Run ${paidRun.runNo} untuk period × jenis proses ini sudah dibayar — komponen khusus tidak akan pernah diproses; buat run koreksi/rapel pada period lain` },
          { status: 400 }
        );
      }
    }

    const assignment = await db.employeeComponentAssignment.create({
      data: {
        employeeId: b.employeeId,
        wageComponentId: b.wageComponentId,
        kind,
        // 28-c: nilai komponen disimpan TERENKRIPSI (enc:v1:n:…).
        amount: tenantCryptoForDb(db).encryptMoney(Number(b.amount ?? 0)),
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
    // 28-c: dekripsi amount di batas serializer.
    // 45-b: gate vault (aktor requireMutator); tulis amount tetap raw di atas.
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    return NextResponse.json({ assignment: mv.json(assignment) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/rekankerja/component-assignments?id=
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
