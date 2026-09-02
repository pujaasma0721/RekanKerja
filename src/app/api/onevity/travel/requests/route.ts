import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { listTravelRequests, submitTravelRequest, decideTravelRequest } from "@/lib/onevity/travel-service";

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
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
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
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan approval (padanan Operation: Approve | Reject | Cancel).
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const res = await decideTravelRequest(db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
