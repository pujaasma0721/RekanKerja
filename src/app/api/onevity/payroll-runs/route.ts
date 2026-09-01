import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { nextRunNo, calculateAndSaveRun, confirmRun } from "@/lib/onevity/payroll-service";

// GET /api/onevity/payroll-runs?periodId=&status=
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const periodId = req.nextUrl.searchParams.get("periodId");
    const status = req.nextUrl.searchParams.get("status");
    const runs = await db.payrollRun.findMany({
      where: {
        ...(periodId ? { periodId } : {}),
        ...(status && status !== "all" ? { status } : {}),
      },
      include: {
        period: true,
        processType: true,
        _count: { select: { lines: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    return NextResponse.json({ runs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/payroll-runs — buat run baru (Draft)
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.periodId || !b.processTypeId) {
      return NextResponse.json({ error: "Period & jenis proses wajib dipilih" }, { status: 400 });
    }
    const period = await db.payrollPeriod.findUnique({ where: { id: b.periodId } });
    if (!period) return NextResponse.json({ error: "Period tidak ditemukan" }, { status: 404 });
    if (period.status === "Closed" || period.status === "Locked") {
      return NextResponse.json({ error: `Period ${period.name} sudah ${period.status === "Closed" ? "ditutup" : "terkunci"}` }, { status: 400 });
    }
    const processType = await db.processType.findUnique({ where: { id: b.processTypeId } });
    if (!processType) return NextResponse.json({ error: "Jenis proses tidak ditemukan" }, { status: 404 });

    // Cegah run ganda: period+type aktif (Draft/Calculated/Confirmed/Paid)
    const existing = await db.payrollRun.findFirst({
      where: { periodId: b.periodId, processTypeId: b.processTypeId, status: { not: "Cancelled" } },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Run ${existing.runNo} (${existing.status}) sudah ada untuk ${period.name} × ${processType.name}` },
        { status: 400 }
      );
    }

    const runNo = await nextRunNo(db, period.code, processType.code);
    const run = await db.payrollRun.create({
      data: {
        runNo,
        periodId: b.periodId,
        processTypeId: b.processTypeId,
        calculateTax: b.calculateTax ?? processType.calculateTax,
        allEmployee: b.allEmployee ?? true,
        notes: b.notes ?? null,
      },
      include: { period: true, processType: true },
    });
    await db.activityLog.create({ data: { action: "Created", entity: "PayrollRun", entityId: run.id, detail: `Run payroll ${runNo} dibuat (${period.name} × ${processType.name})` } });
    return NextResponse.json({ run }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// PATCH /api/onevity/payroll-runs — action: calculate | confirm | markPaid | cancel
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const b = await req.json();
    if (!b.id || !b.action) return NextResponse.json({ error: "id & action wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({ where: { id: b.id } });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    switch (b.action) {
      case "calculate": {
        const result = await calculateAndSaveRun(db, b.id);
        return NextResponse.json({
          ok: true,
          summary: {
            employees: result.lines.length,
            totalBruto: result.totalBruto,
            totalDeduction: result.totalDeduction,
            totalTax: result.totalTax,
            totalNet: result.totalNet,
          },
        });
      }
      case "confirm": {
        await confirmRun(db, b.id);
        return NextResponse.json({ ok: true });
      }
      case "markPaid": {
        if (run.status !== "Confirmed") {
          return NextResponse.json({ error: "Run harus Confirmed sebelum ditandai dibayar" }, { status: 400 });
        }
        await db.payrollRun.update({ where: { id: b.id }, data: { status: "Paid", paidAt: new Date() } });
        await db.activityLog.create({ data: { action: "Updated", entity: "PayrollRun", entityId: b.id, detail: `Run ${run.runNo} ditandai DIBAYAR` } });
        return NextResponse.json({ ok: true });
      }
      case "cancel": {
        if (run.status === "Paid") return NextResponse.json({ error: "Run yang sudah dibayar tidak bisa dibatalkan" }, { status: 400 });
        await db.payrollRun.update({ where: { id: b.id }, data: { status: "Cancelled" } });
        await db.payrollRunLine.deleteMany({ where: { runId: b.id } });
        await db.activityLog.create({ data: { action: "Cancelled", entity: "PayrollRun", entityId: b.id, detail: `Run ${run.runNo} dibatalkan` } });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Action tidak dikenal: ${b.action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/payroll-runs?id= — hanya Draft/Calculated
export async function DELETE(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({ where: { id } });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });
    if (run.status === "Confirmed" || run.status === "Paid") {
      return NextResponse.json({ error: "Run yang sudah dikonfirmasi/dibayar tidak dapat dihapus" }, { status: 400 });
    }
    await db.payrollRun.delete({ where: { id } });
    await db.activityLog.create({ data: { action: "Deleted", entity: "PayrollRun", entityId: id, detail: `Run ${run.runNo} dihapus` } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
