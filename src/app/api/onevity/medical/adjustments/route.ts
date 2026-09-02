import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { readSessionCookie } from "@/lib/onevity/auth";
import { listAdjustments, submitAdjustment, decideAdjustment } from "@/lib/onevity/medical-service";

// GET /api/onevity/medical/adjustments?state=&year= — penyesuaian saldo
// (padanan MedicalBenefitAdjustment.jsp + MedicalBenefitAdjustmentToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const [adjustments, employees] = await Promise.all([
      listAdjustments(db, {
        state: sp.get("state") ?? "all",
        year: sp.get("year") ? Number(sp.get("year")) : undefined,
      }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    const stats = {
      total: adjustments.length,
      submitted: adjustments.filter((a) => a.state === "Submitted").length,
      approved: adjustments.filter((a) => a.state === "Approved").length,
      rejected: adjustments.filter((a) => a.state === "Rejected").length,
      cancelled: adjustments.filter((a) => a.state === "Cancelled").length,
    };
    return NextResponse.json({ adjustments, employees, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan penyesuaian (± employee/dependent amount).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const actor = readSessionCookie(req);
    const actorId = actor?.uid ?? "system";
    const b = await req.json();
    if (!b.employeeId || !b.typeId || !b.year || !b.adjustmentDate || !b.amount) {
      return NextResponse.json({ error: "employeeId, typeId, year, adjustmentDate & amount wajib" }, { status: 400 });
    }
    const res = await submitAdjustment(db, {
      employeeId: String(b.employeeId),
      typeId: String(b.typeId),
      year: Number(b.year),
      forDependent: Boolean(b.forDependent),
      amount: Number(b.amount),
      adjustmentDate: String(b.adjustmentDate),
      note: b.note ? String(b.note) : undefined,
    }, actorId);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan adjustment (Approve → saldo bertambah/kurang | Reject | Cancel).
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const actor = readSessionCookie(req);
    const actorId = actor?.uid ?? "system";
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const res = await decideAdjustment(db, {
      adjustmentId: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    }, actorId);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
