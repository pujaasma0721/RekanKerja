import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listRequests, submitRequest, decideRequest, previewRequest } from "@/onevity/leave/services/leave-service";

// GET /api/onevity/leave/requests?status=&employeeId=&year= — daftar permintaan
// (padanan LeaveRequest.jsp / LeaveRequestToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status") ?? "all";
    const requests = await listRequests(db, {
      status,
      employeeId: sp.get("employeeId") ?? undefined,
      year: sp.get("year") ? Number(sp.get("year")) : undefined,
    });
    const stats = {
      total: requests.length,
      submitted: requests.filter((r) => r.status === "Submitted").length,
      approved: requests.filter((r) => r.status === "Approved").length,
      rejected: requests.filter((r) => r.status === "Rejected").length,
      cancelled: requests.filter((r) => r.status === "Cancelled").length,
      massLeave: requests.filter((r) => r.status === "MassLeave").length,
      pendingDays: Math.round(requests.filter((r) => r.status === "Submitted").reduce((s, r) => s + r.workingDays, 0) * 100) / 100,
      approvedDays: Math.round(requests.filter((r) => r.status === "Approved" || r.status === "MassLeave").reduce((s, r) => s + r.workingDays, 0) * 100) / 100,
    };
    return NextResponse.json({ requests, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan permintaan cuti (preview: true → hitung saja, tanpa simpan)
// Task 25: requireMutator — identitas pengaju tercatat pada jalur approval berjenjang.
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    const input = {
      employeeId: String(b.employeeId ?? ""),
      leaveTypeId: String(b.leaveTypeId ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      sessionFrom: b.sessionFrom === "PM" ? ("PM" as const) : ("AM" as const),
      dateTo: String(b.dateTo ?? ""),
      sessionTo: b.sessionTo === "AM" ? ("AM" as const) : ("PM" as const),
      reason: String(b.reason ?? ""),
      note: b.note ? String(b.note) : undefined,
      source: b.source ? String(b.source) : undefined,
      actorName: m.actor.name,
    };
    if (b.preview) {
      const res = await previewRequest(db, input);
      return NextResponse.json(res);
    }
    const res = await submitRequest(db, input);
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (padanan Operation: Approve | Reject | Cancel).
// L-05: guard mutasi requireMutator — role VIEWER ditolak (403) dan identitas
// approver NYATA dari sesi (AppUser tenant → fallback platform userId) dicatat
// ke decidedById (sebelumnya selalu NULL).
export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const res = await decideRequest(m.db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
      actorId: m.actor.appUserId ?? m.actor.userId,
      actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
