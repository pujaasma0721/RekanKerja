import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { transferClaimsToPayroll } from "@/rekankerja/travel/services/travel-service";

// POST /api/rekankerja/travel/transfer — klaim Approved → komponen UTRP/TRVSTLIN
// payroll period (padanan TravelClaim Operation "Transfer" + Wage Definition).
// 24-FIX-TRAVEL #7: guard mutasi requireMutator — role VIEWER ditolak (403) dan
// aktor sesi nyata tercatat di ActivityLog transfer.
export async function POST(req: NextRequest) {
  try {
    // Task 32-d: guard hak AKSI menu — op:transfer pada travel:travel-claim-approval (per pengguna).
    const m = await requireMenuAction(req, "travel:travel-claim-approval", "op:transfer");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json();
    if (!b.periodId) return NextResponse.json({ error: "periodId wajib" }, { status: 400 });
    const res = await transferClaimsToPayroll(m.db, {
      periodId: String(b.periodId),
      processTypeCode: b.processTypeCode ? String(b.processTypeCode) : undefined,
      actor: { name: m.actor.name, appUserId: m.actor.appUserId },
    });
    return NextResponse.json(res, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
