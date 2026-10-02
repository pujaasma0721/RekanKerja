import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import { travelStats, listBudgets, travelAnalytics } from "@/rekankerja/travel/services/travel-service";

// GET /api/rekankerja/travel/overview — KPI ringkasan modul travel.
// Task 98 (F0-5/B10): gerbang vault uang — dulu overview menampilkan UANG ASLI
// walau Brankas Uang tertutup (konsisten dgn claims yang mem-mask). Kini semua
// kolom uang → null saat masked (UI "—").
// Task 98 (F2-5): + analytics pintar (tren 6 bulan, compliance rate, aging
// SLA approval, top traveler, burn-rate budget vs waktu).
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["travel:requests", "travel:travel-request", "travel:travel-approval", "travel:travel-claim", "travel:travel-claim-approval", "travel:travel-budget"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const mv = await getMoneyView(db, { userId: m.actor.userId, membershipRole: m.actor.role });
    const [stats, budgets, analytics] = await Promise.all([
      travelStats(db, mv),
      listBudgets(db, mv),
      travelAnalytics(db, mv),
    ]);
    return NextResponse.json({ stats, budgets: budgets.slice(0, 3), analytics });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
