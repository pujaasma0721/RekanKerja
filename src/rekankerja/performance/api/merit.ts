import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import type { DecideActor } from "@/rekankerja/shared/services/approval-engine";
import {
  listMerit, recommendAll, updateMerit, submitMerit, decideMerit,
  toPayroll, toPersonnelAction, cancelMerit, issueResultLetter,
  pipProposals, dismissPipProposal, ensureMeritInfrastructure,
} from "@/rekankerja/performance/services/merit-service";

// ============================================================================
// PERFORMANCE — API merit & konsekuensi (P5 — §17; §32 alur 8; §35 guard 17–19):
//   GET  ?cycleId=&status=              → daftar usulan (+ chain + surat)
//   GET  ?cycleId=&pipProposals=1       → usul PIP (rating ≤2 pasca Closed)
//   POST {action:recommend}            → draf otomatis peserta Closed (§32-1)
//   POST {action:update}               → HR sesuaikan draf (nominal vault)
//   POST {action:submit}                → ajukan (approval MeritRecommendation D12)
//   POST {action:decide}               → putus jenjang (approve/reject)
//   POST {action:toPayroll}            → bonus → run BONUS + appliedRunNo (§35-18)
//   POST {action:toPersonnelAction}    → PA SalaryAdjustment/Promotion (§35-19)
//   POST {action:cancel}               → batalkan usulan (alasan ter-audit)
//   POST {action:issueLetter}          → surat hasil penilaian (PERF_RESULT)
//   POST {action:dismissPipProposal}   → catat alasan TIDAK menjalankan PIP
// Guard: performance:results op merit (lihat) / op merit (aksi).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:results", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const cycleId = sp.get("cycleId") ?? "";
    if (sp.get("pipProposals") === "1") {
      return NextResponse.json(await pipProposals(db, { cycleId: cycleId || undefined }));
    }
    await ensureMeritInfrastructure(db); // self-heal tenant lama (idempoten)
    return NextResponse.json(await listMerit(db, {
      cycleId: cycleId || undefined,
      status: sp.get("status") || undefined,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const m = await requireMenuAction(req, "performance:results", "op:merit");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor: DecideActor = { role: m.actor.role, employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null };

    switch (action) {
      case "recommend": {
        const res = await recommendAll(db, { cycleId: String(b.cycleId ?? ""), actor: m.actor.name });
        return NextResponse.json(res);
      }
      case "update": {
        const res = await updateMerit(db, {
          id: String(b.id ?? ""),
          bonusMonths: b.bonusMonths == null || b.bonusMonths === "" ? undefined : b.bonusMonths === null ? null : Number(b.bonusMonths),
          bonusAmount: b.bonusAmount == null || b.bonusAmount === "" ? undefined : b.bonusAmount === null ? null : Number(b.bonusAmount),
          raisePct: b.raisePct == null || b.raisePct === "" ? undefined : b.raisePct === null ? null : Number(b.raisePct),
          raiseAmount: b.raiseAmount == null || b.raiseAmount === "" ? undefined : b.raiseAmount === null ? null : Number(b.raiseAmount),
          note: b.note !== undefined ? (b.note == null ? null : String(b.note)) : undefined,
        }, m.actor.name);
        return NextResponse.json(res);
      }
      case "submit": {
        const res = await submitMerit(db, { id: String(b.id ?? ""), actor: m.actor.name });
        return NextResponse.json(res);
      }
      case "decide": {
        const res = await decideMerit(db, {
          id: String(b.id ?? ""),
          action: b.decision === "reject" ? "reject" : "approve",
          note: b.note != null ? String(b.note) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "toPayroll": {
        const res = await toPayroll(db, { id: String(b.id ?? ""), actor: m.actor.name });
        return NextResponse.json(res);
      }
      case "toPersonnelAction": {
        const res = await toPersonnelAction(db, {
          id: String(b.id ?? ""),
          type: b.type === "Promotion" ? "Promotion" : "SalaryAdjustment",
          effectiveDate: b.effectiveDate != null && b.effectiveDate !== "" ? String(b.effectiveDate) : undefined,
          overrideReason: b.overrideReason != null ? String(b.overrideReason) : undefined,
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "cancel": {
        const res = await cancelMerit(db, {
          id: String(b.id ?? ""),
          reason: String(b.reason ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "issueLetter": {
        const res = await issueResultLetter(db, {
          meritId: b.meritId != null && b.meritId !== "" ? String(b.meritId) : undefined,
          appraisalId: b.appraisalId != null && b.appraisalId !== "" ? String(b.appraisalId) : undefined,
          actorId: m.actor.appUserId ?? null,
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "dismissPipProposal": {
        const res = await dismissPipProposal(db, {
          appraisalId: String(b.appraisalId ?? ""),
          reason: String(b.reason ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
