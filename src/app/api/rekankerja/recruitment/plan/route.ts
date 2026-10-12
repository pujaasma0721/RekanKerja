import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import {
  PLAN_STATUSES, listPlans, getPlan, planOptions, createPlan, updatePlan, applyPlan, deletePlan, syncPlanHeadcount,
  listPlanPrs, outsidePlanPrs,
  type PlanInput,
} from "@/rekankerja/recruitment/services/planning-service";

// ============================================================================
// RECRUITMENT F5 — API Rencana Rekrutmen (RecruitmentPlan RekanKerja §2.1).
//   GET    ?options=1 | ?id= | ?prs= (drill-down PLAN-LINK)
//         | ?outside=1 | ?list=1&period=&status=          → rows + stats + outside
//   POST   { period, positionTitle, targetA, … }           → buat baris plan
//   PATCH  { action: update|apply|delete|sync-headcount, … }
// Guard menu: recruitment:plan (view/create/update/delete + op:apply).
// Formula a–h + rekonsiliasi PR dihitung service; salaryBudget vault
// (moneyVisible gating). ActivityLog di service.
// ============================================================================

// GET /api/rekankerja/recruitment/plan
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:plan", "recruitment:pr"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    if (sp.get("options")) {
      return NextResponse.json(await planOptions(db));
    }
    const mv = await moneyViewForReq(req, db);
    const id = sp.get("id");
    if (id) {
      const row = await getPlan(db, id, mv.canSee);
      if (!row) return NextResponse.json({ error: "Rencana rekrutmen tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }
    // PLAN-LINK — drill-down: daftar PR penyumbang recon satu rencana
    const prsOf = sp.get("prs");
    if (prsOf) {
      const prs = await listPlanPrs(db, prsOf);
      if (prs == null) return NextResponse.json({ error: "Rencana rekrutmen tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ prs });
    }
    // PLAN-LINK — daftar PR aktif di luar rencana mana pun
    if (sp.get("outside")) {
      return NextResponse.json({ outside: await outsidePlanPrs(db) });
    }
    const res = await listPlans(db, {
      period: sp.get("period"),
      status: sp.get("status"),
      moneyVisible: mv.canSee,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/rekankerja/recruitment/plan — buat baris rencana
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const m = await requireMenuAction(req, "recruitment:plan", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const input: PlanInput = {
      period: String(b.period ?? ""),
      seqNo: b.seqNo != null && b.seqNo !== "" ? Number(b.seqNo) : undefined,
      positionId: b.positionId || null,
      positionTitle: String(b.positionTitle ?? ""),
      companyOfficeId: b.companyOfficeId || null,
      targetA: Number(b.targetA ?? 0),
      adjustB: b.adjustB != null && b.adjustB !== "" ? Number(b.adjustB) : 0,
      empD: b.empD != null && b.empD !== "" ? Number(b.empD) : undefined,
      inE: b.inE != null && b.inE !== "" ? Number(b.inE) : 0,
      outF: b.outF != null && b.outF !== "" ? Number(b.outF) : 0,
      salaryBudget: b.salaryBudget != null && b.salaryBudget !== "" ? Number(b.salaryBudget) : null,
      basePeriod: b.basePeriod || null,
      note: b.note || null,
    };
    const row = await createPlan(m.db, input, m.actor.name);
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/rekankerja/recruitment/plan — update | apply | delete | sync
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "update");
    const op: MenuActionRef =
      action === "apply" ? "op:apply" :
      action === "sync-headcount" ? "update" :
      action === "delete" ? "delete" :
      b.id ? "update" : "create";
    const m = await requireMenuAction(req, "recruitment:plan", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    if (action === "apply" && b.id) {
      const row = await applyPlan(db, String(b.id), m.actor.name);
      return NextResponse.json({ row });
    }
    if (action === "sync-headcount" && b.id) {
      const res = await syncPlanHeadcount(db, String(b.id), m.actor.name);
      return NextResponse.json(res);
    }
    if (action === "delete" && b.id) {
      await deletePlan(db, String(b.id), m.actor.name);
      return NextResponse.json({ ok: true });
    }
    if (action === "update" && b.id) {
      const input: Partial<PlanInput> = {};
      if (b.period !== undefined) input.period = b.period ? String(b.period) : "";
      if (b.seqNo !== undefined) input.seqNo = b.seqNo === "" || b.seqNo == null ? undefined : Number(b.seqNo);
      if (b.positionId !== undefined) input.positionId = b.positionId || null;
      if (b.positionTitle !== undefined) input.positionTitle = String(b.positionTitle ?? "");
      if (b.companyOfficeId !== undefined) input.companyOfficeId = b.companyOfficeId || null;
      if (b.targetA !== undefined) input.targetA = b.targetA === "" || b.targetA == null ? 0 : Number(b.targetA);
      if (b.adjustB !== undefined) input.adjustB = b.adjustB === "" || b.adjustB == null ? 0 : Number(b.adjustB);
      if (b.empD !== undefined) input.empD = b.empD === "" || b.empD == null ? 0 : Number(b.empD);
      if (b.inE !== undefined) input.inE = b.inE === "" || b.inE == null ? 0 : Number(b.inE);
      if (b.outF !== undefined) input.outF = b.outF === "" || b.outF == null ? 0 : Number(b.outF);
      if (b.salaryBudget !== undefined) input.salaryBudget = b.salaryBudget === "" || b.salaryBudget == null ? null : Number(b.salaryBudget);
      if (b.basePeriod !== undefined) input.basePeriod = b.basePeriod || null;
      if (b.note !== undefined) input.note = b.note || null;
      const row = await updatePlan(db, String(b.id), input, m.actor.name);
      return NextResponse.json({ row });
    }
    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/plan?id= — hapus baris Draft
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:plan", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await deletePlan(m.db, id, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// konstanta status plan (re-export tipe klien — tidak dipakai handler)
export const PLAN_STATUS_VALUES = PLAN_STATUSES;
