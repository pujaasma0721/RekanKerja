import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { listBudgetPeriods, getBudget, upsertBudget, deleteBudget } from "@/rekankerja/recruitment/services/planning-service";

// ============================================================================
// RECRUITMENT F5 — API Anggaran Rekrutmen (RecruitmentBudget RekanKerja §2.2 —
// dua level ringkasan: per Job Opportunity + per Advertised PR).
//   GET    ?periods=1            → { periods, suggest }
//   GET    ?period=2026          → { row } (budget + used + perJO + prs)
//   POST   { period, totalBudget, adjust?, note? }  → upsert (vault)
//   DELETE ?period=2026          → hapus anggaran periode
// Guard menu: recruitment:budget (view/update). used = Σ actualCost method
// JO periode tsb — cocok dengan kanal biaya Lowongan (F2).
// ============================================================================

// GET /api/rekankerja/recruitment/budget
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:budget", "recruitment:openings"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    if (sp.get("periods")) {
      return NextResponse.json(await listBudgetPeriods(db));
    }
    const period = sp.get("period") ?? String(new Date().getFullYear());
    const mv = await moneyViewForReq(req, db);
    const row = await getBudget(db, period, mv.canSee);
    return NextResponse.json({ row });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/budget — upsert anggaran periode
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const m = await requireMenuAction(req, "recruitment:budget", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await upsertBudget(m.db, {
      period: String(b.period ?? ""),
      totalBudget: Number(b.totalBudget ?? 0),
      adjust: b.adjust != null && b.adjust !== "" ? Number(b.adjust) : 0,
      note: b.note || null,
    }, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/budget?period=
export async function DELETE(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period");
    if (!period) return NextResponse.json({ error: "period wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:budget", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await deleteBudget(m.db, period, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
