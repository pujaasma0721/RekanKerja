import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { recruitmentOverviewStats } from "@/rekankerja/recruitment/services/overview-service";

// ============================================================================
// RECRUITMENT — API Overview (dashboard Ringkasan modul).
//   GET → satu agregat KPI (PR → lowongan → seleksi → offer/hired + rencana/
//         anggaran + rantai Standard Selection Process).
// Guard menu: view salah satu menu rekrutmen (pola leave/travel — halaman
// Ringkasan adalah pintu modul; pengguna tanpa menu rekrutmen apa pun tidak
// bisa membukanya). Uang (anggaran) via moneyViewForReq — masked → null.
// ============================================================================

const RECRUITMENT_VIEW_MENUS = [
  "recruitment:overview",
  "recruitment:pr", "recruitment:pr-approval",
  "recruitment:openings", "recruitment:applicants", "recruitment:referral", "recruitment:public-staging",
  "recruitment:candidates", "recruitment:selection", "recruitment:offers",
  "recruitment:plan", "recruitment:budget", "recruitment:demographics",
  "recruitment:reports", "recruitment:compliance",
  "recruitment:masters", "recruitment:settings",
];

// GET /api/rekankerja/recruitment/overview
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, RECRUITMENT_VIEW_MENUS);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const mv = await moneyViewForReq(req, m.db);
    const overview = await recruitmentOverviewStats(m.db, mv.canSee);
    return NextResponse.json(overview);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
