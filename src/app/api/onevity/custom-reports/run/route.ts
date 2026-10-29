// OneVity — Report Builder (Task 28-b) =====================================
// POST /api/onevity/custom-reports/run — jalankan laporan ad-hoc.
// Body: { entity, fields: string[], filters: [{field,op,value}], page? }.
// Guard op hr:custom-reports:run; entity/field/filter divalidasi terhadap
// katalog whitelist (ReportSpecError → 400). Respons: { rows (nilai mentah —
// tanggal ISO, diformat di UI), total, truncated, columns }.
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { getMoneyView } from "@/onevity/shared/lib/money-view";
import { ReportSpecError, runReport } from "@/onevity/shared/services/report-builder";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:custom-reports", "op:run");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = await req.json().catch(() => ({}));
    // 45-b: gerbang vault uang — aktor requireMenuAction (userId+role).
    const mv = await getMoneyView(m.db, { userId: m.actor.userId, membershipRole: m.actor.role });
    const res = await runReport(m.db, {
      entity: b.entity,
      fields: b.fields,
      filters: b.filters,
      page: b.page,
    }, mv);
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof ReportSpecError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
