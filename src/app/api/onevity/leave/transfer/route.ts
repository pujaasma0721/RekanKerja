import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { transferEncashment } from "@/lib/onevity/leave-service";

// POST /api/onevity/leave/transfer — encashment Approved → komponen UCT payroll
// (padanan EmpLeaveCashable.jsp: period + process type + wage code + transfer).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
    const res = await transferEncashment(db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
