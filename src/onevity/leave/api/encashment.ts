import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listEncashments, submitEncashment, decideEncashment } from "@/onevity/leave/services/leave-service";

// GET /api/onevity/leave/encashment?status= — uang pengganti cuti
// (padanan LeaveEncashment.jsp + LeaveEncashmentToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const status = req.nextUrl.searchParams.get("status") ?? "all";
    const rows = await listEncashments(db, { status });
    const stats = {
      total: rows.length,
      submitted: rows.filter((r) => r.status === "Submitted").length,
      approved: rows.filter((r) => r.status === "Approved").length,
      transferred: rows.filter((r) => r.status === "Transferred").length,
      paid: rows.filter((r) => r.status === "Paid").length,
      totalDays: Math.round(rows.filter((r) => ["Approved", "Transferred", "Paid"].includes(r.status)).reduce((s, r) => s + r.days, 0) * 100) / 100,
      totalAmount: rows.filter((r) => ["Approved", "Transferred", "Paid"].includes(r.status)).reduce((s, r) => s + r.amount, 0),
    };
    return NextResponse.json({ encashments: rows, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan encashment (saldo → uang)
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.employeeId || !b.leaveTypeId || !b.year || !b.days) {
      return NextResponse.json({ error: "employeeId, leaveTypeId, year & days wajib" }, { status: 400 });
    }
    const res = await submitEncashment(db, {
      employeeId: String(b.employeeId),
      leaveTypeId: String(b.leaveTypeId),
      year: parseInt(b.year, 10),
      days: Number(b.days),
      paymentDate: b.paymentDate ? String(b.paymentDate) : undefined,
      note: b.note ? String(b.note) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (approve | reject | cancel)
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const res = await decideEncashment(db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
