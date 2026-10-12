import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// ============================================================================
// P8-PERF — ringkasan ringkas modul Performance utk halaman Ringkasan (§17):
// counts KPI (kartu) + distribusi rating & status formulir (mini-chart div).
// Guard: performance:overview | performance:reports.
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:overview", "performance:reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const [kpi, competency, cycles, activeParticipants, ratingRows, statusRows, pipRows] = await Promise.all([
      db.kpiDefinition.count({ where: { status: "Active" } }),
      db.competency.count({ where: { status: "Active" } }),
      db.performanceCycle.count(),
      db.appraisalRecord.count({ where: { cycle: { status: { not: "Closed" } } } }),
      db.appraisalRecord.groupBy({ by: ["finalRating"], _count: { _all: true }, where: { finalRating: { not: null } } }),
      db.appraisalRecord.groupBy({ by: ["status"], _count: { _all: true }, where: { cycle: { status: { not: "Closed" } } } }),
      db.pipPlan.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const ratingDist = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: ratingRows.find((r) => r.finalRating === rating)?._count._all ?? 0,
    }));
    const pip = {
      active: (pipRows.find((r) => r.status === "Active")?._count._all ?? 0) + (pipRows.find((r) => r.status === "Extended")?._count._all ?? 0),
      recovered: pipRows.find((r) => r.status === "Recovered")?._count._all ?? 0,
      notRecovered: pipRows.find((r) => r.status === "NotRecovered")?._count._all ?? 0,
    };
    return NextResponse.json({
      counts: { cycles, activeParticipants, kpi, competency },
      ratingDist,
      statusDist: statusRows.map((r) => ({ status: r.status, count: r._count._all })),
      pip,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
