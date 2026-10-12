import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { applicantDemographics } from "@/rekankerja/recruitment/services/demographics-service";

// ============================================================================
// RECRUITMENT F5 — API Demografi pelamar + segmen talent pool + silver
// medalist (RekanKerja §2.5 ApplicantDemography + HRX auto-saran talent pool).
//   GET ?stats=1 → { total, byGender, byAge, byEdu, bySource, byStatus,
//                    segments, silver }
// Guard menu: recruitment:demographics (juga view-any dari talent pool).
// ============================================================================

// GET /api/rekankerja/recruitment/demographics
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:demographics", "recruitment:applicants"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    return NextResponse.json(await applicantDemographics(m.db));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
