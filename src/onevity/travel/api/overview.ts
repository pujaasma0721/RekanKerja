import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuViewAny } from "@/onevity/shared/services/menu-access";
import { travelStats, listBudgets } from "@/onevity/travel/services/travel-service";

// GET /api/onevity/travel/overview — KPI ringkasan modul travel.
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["travel:requests", "travel:travel-request", "travel:travel-approval", "travel:travel-claim", "travel:travel-claim-approval", "travel:travel-budget"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const [stats, budgets] = await Promise.all([
      travelStats(db),
      listBudgets(db),
    ]);
    return NextResponse.json({ stats, budgets: budgets.slice(0, 3) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
