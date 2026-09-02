import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { listOnLeave, typeUsageSummary } from "@/lib/onevity/leave-service";

// GET /api/onevity/leave/reports?from=&to=&year= — laporan:
//   onLeave (padanan Query - Employee on Leave) + typeUsage (Summary Based on Leave Type)
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const year = sp.get("year") ? Number(sp.get("year")) : new Date().getFullYear();
    const now = new Date();
    const from = sp.get("from") ? new Date(sp.get("from") + "T00:00:00") : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = sp.get("to") ? new Date(sp.get("to") + "T00:00:00") : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const [onLeave, typeUsage] = await Promise.all([
      listOnLeave(db, from, to),
      typeUsageSummary(db, year),
    ]);
    return NextResponse.json({
      window: { from: from.toISOString(), to: to.toISOString() },
      year,
      onLeave,
      typeUsage,
      onLeaveToday: onLeave.filter((r) => r.dateFrom <= now && r.dateTo >= now).length,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
