import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { travelStats, listBudgets } from "@/lib/onevity/travel-service";

// GET /api/onevity/travel/overview — KPI ringkasan modul travel.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const [stats, budgets] = await Promise.all([
      travelStats(db),
      listBudgets(db),
    ]);
    return NextResponse.json({ stats, budgets: budgets.slice(0, 3) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
