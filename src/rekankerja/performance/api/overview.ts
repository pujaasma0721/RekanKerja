import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { overviewFor } from "@/rekankerja/performance/services/perf-overview-service";

// ============================================================================
// PERFORMANCE — API Overview (dashboard Ringkasan modul).
//   GET → satu agregat: siklus aktif + pipeline appraisal + kesehatan target
//         + check-in + 360 (agregat) + kalibrasi + PIP + percobaan + merit
//         (uang vault-gate) + OKR (bila aktif) + feed aktivitas.
// Guard menu: view salah satu menu kinerja inti (pola REC-OV — halaman
// Ringkasan adalah pintu modul). Uang via moneyViewForReq — masked → null.
// ============================================================================

const PERFORMANCE_VIEW_MENUS = [
  "performance:overview",
  "performance:cycles",
  "performance:appraisals",
  "performance:reports",
];

// GET /api/rekankerja/performance/overview
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, PERFORMANCE_VIEW_MENUS);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const mv = await moneyViewForReq(req, m.db);
    const overview = await overviewFor(m.db, { canSeeMoney: mv.canSee });
    return NextResponse.json({ overview });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
