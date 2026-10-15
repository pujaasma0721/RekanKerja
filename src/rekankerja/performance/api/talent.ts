import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listAttritionRisk, talentHrActor, talentErrStatus, TalentForbiddenError,
} from "@/rekankerja/performance/services/talent-service";

// ============================================================================
// PERFORMANCE — API Talent & Risiko Attrisi (B3 — DEVELOPMENT-PLAN-BACKLOG.md
// §4 B3; D-BL10…D-BL12). READ-ONLY on-demand stateless (tidak ada tabel baru,
// tidak ada POST — op-map tidak diperlukan fase ini):
//   GET ?unitId=&q=&onlyHigh=1   → { rows, stats, disclaimer, scope }
// Guard menu: performance:talent (view). Akses baris lebih lanjut dijaga
// service (D-BL12): HR/admin semua; Direksi semua; selain itu hanya bawahan
// langsung; ESS bukan atasan → 403. Disclaimer key D-BL11 selalu disertakan.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:talent"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const res = await listAttritionRisk(db, {
      name: m.actor.name,
      employeeId: m.actor.employeeId,
      isHr: talentHrActor(m.actor.role, m.actor.appUserRole),
    }, {
      unitId: sp.get("unitId") || undefined,
      q: sp.get("q") || undefined,
      onlyHigh: sp.get("onlyHigh") === "1",
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof TalentForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: talentErrStatus(e) },
    );
  }
}
