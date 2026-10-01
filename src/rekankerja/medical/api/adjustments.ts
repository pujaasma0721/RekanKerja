import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { listAdjustments, submitAdjustment, decideAdjustment } from "@/rekankerja/medical/services/medical-service";

// GET /api/rekankerja/medical/adjustments?state=&year= — penyesuaian saldo
// (padanan MedicalBenefitAdjustment.jsp + MedicalBenefitAdjustmentToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["medical:medical-adjustment"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi).
    const mv = await moneyViewForReq(req, db);
    const [adjustments, employees] = await Promise.all([
      listAdjustments(db, {
        state: sp.get("state") ?? "all",
        year: sp.get("year") ? Number(sp.get("year")) : undefined,
      }, mv),
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
// Guard (fix audit aktor/role): VIEWER 403 + aktor sesi nyata.
// Task 32-d: guard hak AKSI menu — create pada medical:medical-adjustment (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "medical:medical-adjustment", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actorId = m.actor.appUserId ?? m.actor.userId;
    const b = await req.json();
    if (!b.employeeId || !b.typeId || !b.year || !b.adjustmentDate || !b.amount) {
      return NextResponse.json({ error: "employeeId, typeId, year, adjustmentDate & amount wajib" }, { status: 400 });
    }
    const res = await submitAdjustment(m.db, {
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
// Guard (fix audit aktor/role): decidedBy = aktor sesi nyata, VIEWER 403.
// Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve pada
// medical:medical-adjustment; cancel → update. Body dibaca SEKALI sebelum guard.
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "medical:medical-adjustment", "update")
      : await requireMenuAction(req, "medical:medical-adjustment", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const actorId = m.actor.appUserId ?? m.actor.userId;
    const res = await decideAdjustment(m.db, {
      adjustmentId: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    }, actorId);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
