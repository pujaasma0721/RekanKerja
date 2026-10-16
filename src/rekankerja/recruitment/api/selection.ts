import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny, requireMenuAction, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import {
  getBoard, getCandidateDetail, getSelectionCalendar, selectionSummaries,
  scheduleStep, acknowledgeStep, recordStepResult, advanceCandidate,
  cancelStep, addStep, withdrawCandidate, issueInvitation, letterPdf,
  getPrStageConfig, setPrStages,
} from "@/rekankerja/recruitment/services/selection-service";
import {
  listTemplates, upsertTemplate, deactivateTemplate,
  getStepScorecards, saveScorecard,
  SCORECARD_RECOMMENDATIONS, type TemplateInput, type ScorecardSaveInput,
} from "@/rekankerja/recruitment/services/scorecard-service";

// ============================================================================
// RECRUITMENT F3 — API proses seleksi (board kanban + tahap + surat + kalender
// + scorecard). DEVELOPMENT-PLAN-RECRUITMENT.md §7 F3.
//   GET  ?board=1&prId=            → { board }  (kolom tahap + kartu kandidat)
//   GET  ?summaries=1              → { summaries } (badge per PR)
//   GET  ?calendar=YYYY-MM         → { month, events }
//   GET  ?candidateId=             → { row } detail kandidat + tahap + panel
//   GET  ?stepId=&scorecards=1      → { panel } scorecard step
//   GET  ?templates=1               → { templates } katalog rubrik
//   GET  ?prStages=1&prId=          → { config } tahapan kustom PR + katalog (SB-RC-BL)
//   GET  ?letterPdf=ID              → PDF surat undangan (stream)
//   POST { action: schedule|ack|result|advance|cancel-step|add-step
//          |withdraw|invite|scorecard-save|template-upsert|template-deactivate
//          |pr-stages-save }
// Guard: recruitment:selection (view + op:schedule/op:result/op:invite +
// create/update utk scorecard) · op:withdraw → recruitment:candidates.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:selection", "recruitment:candidates"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;

    // PDF surat undangan (response stream — bukan JSON)
    const letterId = sp.get("letterPdf");
    if (letterId) {
      const bytes = await letterPdf(db, letterId);
      if (!bytes) return NextResponse.json({ error: "Surat tidak ditemukan" }, { status: 404 });
      return new NextResponse(Buffer.from(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="surat-undangan-${letterId}.pdf"`,
        },
      });
    }

    if (sp.get("board")) {
      const prId = sp.get("prId");
      if (!prId) return NextResponse.json({ error: "prId wajib" }, { status: 400 });
      const board = await getBoard(db, prId);
      if (!board) return NextResponse.json({ error: "PR tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ board });
    }

    if (sp.get("summaries")) {
      return NextResponse.json({ summaries: await selectionSummaries(db), recommendations: SCORECARD_RECOMMENDATIONS });
    }

    const calendar = sp.get("calendar");
    if (calendar) {
      return NextResponse.json(await getSelectionCalendar(db, calendar));
    }

    const candidateId = sp.get("candidateId");
    if (candidateId) {
      const mv = await moneyViewForReq(req, db);
      const row = await getCandidateDetail(db, candidateId, mv.canSee);
      if (!row) return NextResponse.json({ error: "Kandidat tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ row });
    }

    const stepId = sp.get("stepId");
    if (stepId && sp.get("scorecards")) {
      return NextResponse.json({ panel: await getStepScorecards(db, stepId) });
    }

    if (sp.get("templates")) {
      return NextResponse.json({ templates: await listTemplates(db), recommendations: SCORECARD_RECOMMENDATIONS });
    }

    // SB-RC-BL — konfigurasi tahapan seleksi kustom per PR (dialog Tahapan PR)
    if (sp.get("prStages")) {
      const prId = sp.get("prId");
      if (!prId) return NextResponse.json({ error: "prId wajib" }, { status: 400 });
      const config = await getPrStageConfig(db, prId);
      if (!config) return NextResponse.json({ error: "PR tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ config });
    }

    return NextResponse.json({ error: "Parameter query tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const actorName = (b.actorName as string) ?? null;

    // ---------- guard per aksi ----------
    const guard = async (menuKey: string, act: MenuActionRef) => {
      const m = await requireMenuAction(req, menuKey, act);
      if (!m.ok) throw new GuardError(m.status, m.error);
      return m;
    };

    try {
      switch (action) {
        case "schedule": {
          const m = await guard("recruitment:selection", "op:schedule");
          await scheduleStep(m.db, {
            stepId: String(b.stepId ?? ""),
            planDate: String(b.planDate ?? ""),
            dueDate: b.dueDate ? String(b.dueDate) : null,
            performedById: b.performedById ? String(b.performedById) : null,
            meetingUrl: b.meetingUrl ? String(b.meetingUrl) : null, // B6 — URL invalid → 400
            actorName: m.actor.name,
          });
          return NextResponse.json({ ok: true });
        }
        case "ack": {
          const m = await guard("recruitment:selection", "op:schedule");
          await acknowledgeStep(m.db, {
            stepId: String(b.stepId ?? ""),
            actorName: m.actor.name,
            onBehalf: b.onBehalf === true,
          });
          return NextResponse.json({ ok: true });
        }
        case "result": {
          const m = await guard("recruitment:selection", "op:result");
          const res = await recordStepResult(m.db, {
            stepId: String(b.stepId ?? ""),
            performedById: b.performedById ? String(b.performedById) : null,
            performedAt: b.performedAt ? String(b.performedAt) : null,
            score: b.score != null && b.score !== "" ? Number(b.score) : null,
            result: b.result ? String(b.result) : null,
            comment: b.comment ? String(b.comment) : null,
            outcome: b.outcome === "Pass" || b.outcome === "Fail" ? b.outcome : null,
            continueProcess: b.continueProcess != null ? Boolean(b.continueProcess) : null,
            actorName: m.actor.name,
          });
          return NextResponse.json(res);
        }
        case "advance": {
          const m = await guard("recruitment:selection", "op:result");
          const res = await advanceCandidate(m.db, {
            candidateId: String(b.candidateId ?? ""),
            performedById: b.performedById ? String(b.performedById) : null,
            score: b.score != null && b.score !== "" ? Number(b.score) : null,
            result: b.result ? String(b.result) : null,
            comment: b.comment ? String(b.comment) : null,
            outcome: b.outcome === "Pass" || b.outcome === "Fail" ? b.outcome : null,
            continueProcess: b.continueProcess != null ? Boolean(b.continueProcess) : null,
            actorName: m.actor.name,
          });
          return NextResponse.json(res);
        }
        case "cancel-step": {
          const m = await guard("recruitment:selection", "op:result");
          await cancelStep(m.db, {
            stepId: String(b.stepId ?? ""),
            comment: b.comment ? String(b.comment) : null,
            actorName: m.actor.name,
          });
          return NextResponse.json({ ok: true });
        }
        case "add-step": {
          const m = await guard("recruitment:selection", "op:result");
          const id = await addStep(m.db, {
            candidateId: String(b.candidateId ?? ""),
            selectionProcessId: String(b.selectionProcessId ?? ""),
            actorName: m.actor.name,
          });
          return NextResponse.json({ id });
        }
        case "withdraw": {
          const m = await guard("recruitment:candidates", "op:withdraw");
          await withdrawCandidate(m.db, {
            candidateId: String(b.candidateId ?? ""),
            note: b.note ? String(b.note) : null,
            actorName: m.actor.name,
          });
          return NextResponse.json({ ok: true });
        }
        case "invite": {
          const m = await guard("recruitment:selection", "op:invite");
          const res = await issueInvitation(m.db, {
            stepId: String(b.stepId ?? ""),
            actorId: m.actor.employeeId ?? null,
            actorName: m.actor.name,
          });
          return NextResponse.json(res);
        }
        case "scorecard-save": {
          const m = await guard("recruitment:selection", "update");
          const items = Array.isArray(b.items)
            ? (b.items as Record<string, unknown>[]).map((i) => ({
                competencyId: String(i.competencyId ?? ""),
                score: Number(i.score ?? 0),
                comment: i.comment ? String(i.comment) : null,
              }))
            : [];
          const input: ScorecardSaveInput = {
            selectionStepId: String(b.selectionStepId ?? ""),
            evaluatorId: String(b.evaluatorId ?? ""),
            templateId: String(b.templateId ?? ""),
            items,
            recommendation: b.recommendation ? String(b.recommendation) : null,
            overallComment: b.overallComment ? String(b.overallComment) : null,
            submit: b.submit === true,
          };
          const res = await saveScorecard(m.db, input, m.actor.name);
          return NextResponse.json(res);
        }
        case "template-upsert": {
          const isNew = !b.id;
          const m = await guard("recruitment:selection", isNew ? "create" : "update");
          const comps = Array.isArray(b.competencies)
            ? (b.competencies as Record<string, unknown>[]).filter((c) => c.name).map((c, i) => ({
                name: String(c.name ?? ""),
                description: c.description ? String(c.description) : null,
                weight: c.weight != null && c.weight !== "" ? Number(c.weight) : 1,
                orderNo: c.orderNo != null ? Number(c.orderNo) : i + 1,
                anchors: Array.isArray(c.anchors) ? (c.anchors as { value: number; label: string; guide: string }[]) : null,
              }))
            : [];
          const input: TemplateInput = {
            id: b.id ? String(b.id) : null,
            name: String(b.name ?? ""),
            selectionProcessId: b.selectionProcessId ? String(b.selectionProcessId) : null,
            description: b.description ? String(b.description) : null,
            active: b.active == null ? true : Boolean(b.active),
            competencies: comps,
          };
          const id = await upsertTemplate(m.db, input, m.actor.name);
          return NextResponse.json({ id });
        }
        case "template-deactivate": {
          const m = await guard("recruitment:selection", "update");
          await deactivateTemplate(m.db, String(b.id ?? ""), m.actor.name);
          return NextResponse.json({ ok: true });
        }
        case "pr-stages-save": {
          // SB-RC-BL — simpan daftar tahapan kustom per PR (kosong = reset standar)
          const m = await guard("recruitment:selection", "update");
          const processIds = Array.isArray(b.processIds)
            ? (b.processIds as unknown[]).map(String).filter(Boolean)
            : [];
          const res = await setPrStages(m.db, {
            prId: String(b.prId ?? ""),
            processIds,
            actorName: m.actor.name,
          });
          return NextResponse.json(res);
        }
        default:
          return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
      }
    } catch (e) {
      if (e instanceof GuardError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

/** Error guard menu dengan status HTTP (dipakai switch di atas). */
class GuardError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
