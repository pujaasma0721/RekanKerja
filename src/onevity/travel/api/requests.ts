import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { listTravelRequests, submitTravelRequest, decideTravelRequest } from "@/onevity/travel/services/travel-service";

// GET /api/onevity/travel/requests?status=&employeeId= — daftar permintaan
// (padanan TravelRequest.jsp / TravelRequestToApprove.jsp).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const requests = await listTravelRequests(db, {
      status: sp.get("status") ?? "all",
      employeeId: sp.get("employeeId") ?? undefined,
    });
    const stats = {
      total: requests.length,
      submitted: requests.filter((r) => r.status === "Submitted").length,
      approved: requests.filter((r) => r.status === "Approved").length,
      rejected: requests.filter((r) => r.status === "Rejected").length,
      cancelled: requests.filter((r) => r.status === "Cancelled").length,
      withClaim: requests.filter((r) => r.claimCount > 0).length,
      overdueSettlement: requests.filter((r) => r.overdue).length,
      advanceTotal: requests.reduce((s, r) => s + r.advanceAmount, 0),
    };
    return NextResponse.json({ requests, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — ajukan permintaan travel (destinasi multi-kaki + uang muka).
// Task 25: guard mutasi — identitas pengaju tercatat pada jalur approval berjenjang.
// Task 32-d: guard hak AKSI menu — create pada menu travel:travel-request (per pengguna).
export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "travel:travel-request", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = await req.json();
    if (!Array.isArray(b.destinations) || b.destinations.length === 0) {
      return NextResponse.json({ error: "Minimal 1 destinasi wajib" }, { status: 400 });
    }
    const res = await submitTravelRequest(db, {
      employeeId: String(b.employeeId ?? ""),
      templateCode: String(b.templateCode ?? ""),
      dateFrom: String(b.dateFrom ?? ""),
      dateTo: String(b.dateTo ?? ""),
      purpose: String(b.purpose ?? ""),
      remark: b.remark ? String(b.remark) : undefined,
      costCenter: b.costCenter ? String(b.costCenter) : undefined,
      destinations: b.destinations.map((d: Record<string, unknown>) => ({
        dateFrom: String(d.dateFrom ?? ""),
        dateTo: String(d.dateTo ?? ""),
        city: String(d.city ?? ""),
        country: d.country ? String(d.country) : undefined,
        zoneCode: d.zoneCode ? String(d.zoneCode) : undefined,
        overseas: Boolean(d.overseas),
        note: d.note ? String(d.note) : undefined,
      })),
      advanceAmount: Math.max(0, Number(b.advanceAmount ?? 0)),
      advanceNote: b.advanceNote ? String(b.advanceNote) : undefined,
      actorName: m.actor.name,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (padanan Operation: Approve | Reject | Cancel).
// 24-FIX-TRAVEL #7: guard mutasi — role VIEWER ditolak (403) dan
// identitas approver NYATA dari sesi (AppUser tenant → fallback platform userId)
// dicatat ke decidedById (sebelumnya selalu NULL).
// Task 32-d: guard hak AKSI menu per pengguna — approve/reject → op:approve pada
// travel:travel-approval; cancel → op:cancel pada travel:travel-request.
// Body dibaca SEKALI sebelum guard (aksi menentukan menu yang dicek).
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const m = b.action === "cancel"
      ? await requireMenuAction(req, "travel:travel-request", "op:cancel")
      : await requireMenuAction(req, "travel:travel-approval", "op:approve");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const res = await decideTravelRequest(m.db, {
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
