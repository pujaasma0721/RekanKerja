import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  meritBoard, recommendMerit, patchMerit, submitMerit, decideMeritApproval, cancelMerit,
  applyMerit, toPersonnelAction, decidePip, issueResultLetter, issueResultLetters,
  type MeritActor, type PipTargetInput,
} from "@/rekankerja/performance/services/perf-merit-service";

// ============================================================================
// PERFORMANCE — API Merit & Tindak Lanjut (P5 — §17 merit, §32 Alur 8):
//   GET  ?cycleId[&status]   → meritBoard: usulan merit (nominal didekripsi,
//        menu-guard performance:results) + stats + kandidat + usul PIP +
//        surat kinerja + run terbuka + matrix aktif.
//   POST {action: recommend|patch|submit|approve|reject|cancel|apply|
//        toPersonnelAction|issueLetter|issueLetters}  → op "op:merit" §14.2
//   POST {action: pipDecide} → op "op:pip" §14.2
// approve/reject: otorisasi keputusan tetap di engine (DecideActor sesi —
// pola calibration API).
// ============================================================================

function meritActorOf(m: MenuActor): MeritActor {
  const base = goalActorOf(m);
  return { ...base, name: m.name, userId: m.userId, role: m.role };
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:results"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = meritActorOf(m.actor);
    const sp = req.nextUrl.searchParams;

    const board = await meritBoard(db, actor, { cycleId: sp.get("cycleId") ?? undefined });
    // filter status (opsional — klien juga bisa memfilter sendiri)
    const status = sp.get("status");
    if (status && status !== "all") {
      return NextResponse.json({ ...board, recommendations: board.recommendations.filter((r) => r.status === status) });
    }
    return NextResponse.json(board);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // guard berdasarkan aksi (pola pr.ts — body dibaca SEBELUM guard):
    // pipDecide → op:pip; seluruh aksi merit lain → op:merit (§14.2)
    const op = action === "pipDecide" ? "op:pip" : "op:merit";
    const m = await requireMenuAction(req, "performance:results", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = meritActorOf(m.actor);

    switch (action) {
      case "recommend": {
        const out = await recommendMerit(db, actor, {
          cycleId: String(b.cycleId ?? ""),
          matrixId: b.matrixId != null ? String(b.matrixId) : undefined,
        });
        await db.activityLog.create({
          data: {
            action: "Created", entity: "MeritRecommendation", entityId: String(b.cycleId ?? "-"),
            detail: `Buat usulan massal oleh ${actor.name}: ${out.created.length} draf (matrix ${out.matrixCode}) · ${out.skippedExisting.length} sudah ada · ${out.skippedNoRating.length} tanpa rating · ${out.noSalary.length} tanpa gaji pokok (§32-1)`,
          },
        }).catch(() => { /* best-effort */ });
        return NextResponse.json(out, { status: 201 });
      }
      case "patch": {
        // terima bentuk FLAT ({bonusMonths,raisePct,note}) maupun NESTED
        // ({patch:{...}}) — kontrak UI & pemanggil eksternal tidak harus sama.
        const src = (b.patch && typeof b.patch === "object" && !Array.isArray(b.patch) ? b.patch : b) as Record<string, unknown>;
        const out = await patchMerit(db, actor, {
          id: String(b.id ?? ""),
          patch: {
            bonusMonths: src.bonusMonths != null && src.bonusMonths !== "" ? Number(src.bonusMonths) : undefined,
            raisePct: src.raisePct != null && src.raisePct !== "" ? Number(src.raisePct) : undefined,
            note: src.note != null ? String(src.note) : undefined,
          },
        });
        return NextResponse.json(out);
      }
      case "submit": {
        const out = await submitMerit(db, actor, { id: String(b.id ?? "") });
        return NextResponse.json(out, { status: 201 });
      }
      case "approve":
      case "reject": {
        const out = await decideMeritApproval(db, {
          docId: String(b.id ?? ""),
          action: action === "approve" ? "approve" : "reject",
          note: b.note != null ? String(b.note) : null,
          actor: { role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name },
        });
        return NextResponse.json(out);
      }
      case "cancel": {
        const out = await cancelMerit(db, actor, {
          id: String(b.id ?? ""),
          reason: b.reason != null ? String(b.reason) : undefined, // PERF-AUD F-09 — wajib utk Approved
        });
        return NextResponse.json(out);
      }
      case "apply": {
        const out = await applyMerit(db, actor, {
          id: String(b.id ?? ""),
          includeBonus: b.includeBonus !== false,
          includeRaise: b.includeRaise !== false,
        });
        return NextResponse.json(out);
      }
      case "toPersonnelAction": {
        const type = b.type === "Promotion" ? "Promotion" : "SalaryAdjustment";
        const out = await toPersonnelAction(db, actor, {
          id: String(b.id ?? ""),
          type,
          effectiveDate: b.effectiveDate != null ? String(b.effectiveDate) : null,
          force: b.force === true,
          reason: b.reason != null ? String(b.reason) : null,
        });
        return NextResponse.json(out, { status: 201 });
      }
      case "pipDecide": {
        const inp = (b.input ?? {}) as Record<string, unknown>;
        const out = await decidePip(db, actor, {
          appraisalId: String(b.appraisalId ?? ""),
          run: b.run === true,
          reason: b.reason != null ? String(b.reason) : null,
          input: {
            startDate: inp.startDate != null ? String(inp.startDate) : undefined,
            months: inp.months != null && inp.months !== "" ? Number(inp.months) : undefined,
            reviewerId: inp.reviewerId != null ? String(inp.reviewerId) : undefined,
            hrAdvisorId: inp.hrAdvisorId != null ? String(inp.hrAdvisorId) : null,
            targets: Array.isArray(inp.targets) ? (inp.targets as PipTargetInput[]) : [],
          },
        });
        return NextResponse.json(out, { status: 201 });
      }
      case "issueLetter": {
        const out = await issueResultLetter(db, actor, { appraisalId: String(b.appraisalId ?? "") });
        return NextResponse.json(out, { status: 201 });
      }
      case "issueLetters": {
        const out = await issueResultLetters(db, actor, { cycleId: String(b.cycleId ?? "") });
        return NextResponse.json(out);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof DecisionConflictError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof DecisionForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
