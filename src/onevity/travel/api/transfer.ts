import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { transferClaimsToPayroll } from "@/onevity/travel/services/travel-service";

// POST /api/onevity/travel/transfer — klaim Approved → komponen UTRP/TRVSTLIN
// payroll period (padanan TravelClaim Operation "Transfer" + Wage Definition).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
    const res = await transferClaimsToPayroll(db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
