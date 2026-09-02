import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listTravelClaims, createClaim, decideClaim, previewClaim, getClaimDetail } from "@/onevity/travel/services/travel-service";

// GET /api/onevity/travel/claims?status=&employeeId= — daftar klaim
// (padanan TravelClaim.jsp / TravelClaimToApprove.jsp).
// GET ?requestId= — preview form klaim untuk request Approved.
// GET ?id= — detail klaim (rincian biaya).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const requestId = sp.get("requestId");
    if (requestId) {
      const res = await previewClaim(db, requestId);
      return NextResponse.json(res);
    }
    const id = sp.get("id");
    if (id) {
      const detail = await getClaimDetail(db, id);
      return NextResponse.json({ detail });
    }
    const claims = await listTravelClaims(db, {
      status: sp.get("status") ?? "all",
      employeeId: sp.get("employeeId") ?? undefined,
    });
    const stats = {
      total: claims.length,
      submitted: claims.filter((c) => c.status === "Submitted").length,
      approved: claims.filter((c) => c.status === "Approved").length,
      transferred: claims.filter((c) => c.status === "Transferred").length,
      paid: claims.filter((c) => c.status === "Paid").length,
      rejected: claims.filter((c) => c.status === "Rejected").length,
      cancelled: claims.filter((c) => c.status === "Cancelled").length,
      totalSettlement: claims.reduce((s, c) => s + c.totalSettlement, 0),
      payableEmployee: claims.filter((c) => c.status === "Approved").reduce((s, c) => s + c.payableEmployee, 0),
      payableCompany: claims.filter((c) => c.status === "Approved").reduce((s, c) => s + c.payableCompany, 0),
    };
    return NextResponse.json({ claims, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat klaim / settlement (rincian biaya per jenis + formula (a)+(b)-(c)).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!Array.isArray(b.expenses) || b.expenses.length === 0) {
      return NextResponse.json({ error: "Klaim wajib memuat minimal 1 baris biaya" }, { status: 400 });
    }
    const res = await createClaim(db, {
      requestId: b.requestId ? String(b.requestId) : undefined,
      employeeId: String(b.employeeId ?? ""),
      templateCode: String(b.templateCode ?? ""),
      claimDate: b.claimDate ? String(b.claimDate) : undefined,
      costCenter: b.costCenter ? String(b.costCenter) : undefined,
      purpose: b.purpose ? String(b.purpose) : undefined,
      remark: b.remark ? String(b.remark) : undefined,
      voucherNo: b.voucherNo ? String(b.voucherNo) : undefined,
      settlementMethod: b.settlementMethod ? String(b.settlementMethod) : undefined,
      expenses: b.expenses.map((e: Record<string, unknown>) => ({
        expenseCode: String(e.expenseCode ?? ""),
        expenseDate: e.expenseDate ? String(e.expenseDate) : undefined,
        description: e.description ? String(e.description) : undefined,
        amount: Math.max(0, Number(e.amount ?? 0)),
        qty: e.qty ? Number(e.qty) : undefined,
        guestName: e.guestName ? String(e.guestName) : undefined,
      })),
      otherCompanyExp: Math.max(0, Number(b.otherCompanyExp ?? 0)),
      exchangeLoss: Math.max(0, Number(b.exchangeLoss ?? 0)),
      payableEmployee: Math.max(0, Number(b.payableEmployee ?? 0)),
      payableCompany: Math.max(0, Number(b.payableCompany ?? 0)),
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — keputusan klaim (Approve → jurnal otomatis | Reject | Cancel)
// (padanan TravelClaimToApprove Operation + Transfer terpisah di /transfer).
export async function PATCH(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.id || !["approve", "reject", "cancel"].includes(b.action)) {
      return NextResponse.json({ error: "id & action (approve|reject|cancel) wajib" }, { status: 400 });
    }
    const res = await decideClaim(db, {
      id: String(b.id),
      action: b.action,
      note: b.note ? String(b.note) : undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
