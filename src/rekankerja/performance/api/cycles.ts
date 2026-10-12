import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listCycles, getCycleDetail, createCycle, patchCycle, enrollParticipants, openGoal, advanceCycle,
  commandCenter, nudgeParticipants, laggingParticipants, listEnrollable,
} from "@/rekankerja/performance/services/cycle-service";
import { copyTeam } from "@/rekankerja/performance/services/goals-service";

// ============================================================================
// PERFORMANCE — API siklus penilaian (P1 — DEVELOPMENT-PLAN-PERFORMANCE.md §17)
//   GET  ?status&year&q&offset&limit   → { rows, total }
//   GET  ?id=…                        → { cycle, participants }
//   GET  ?commandCenter=1&cycleId=…   → matrix §18.8 (peserta + agregat atasan)
//   POST {action:create}              → siklus baru (Draft)
//   POST {action:enroll}              → enroll peserta (allActive/employeeIds)
//   POST {action:openGoal}           → Draft → GoalSetting (+prefill opsi §25-5)
//   POST {action:startOngoing|startAssessment|startCalibration|publish|close}
//   POST {action:copyTeam}           → salin massal tim §18.2-c
//   POST {action:nudge|nudgeAll}     → Remind/Remind All multi-kanal §18.8
//   PATCH {id, …field}               → ubah siklus (Draft saja)
// Guard menu: performance:cycles. ActivityLog di service.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:cycles", "performance:overview", "performance:goals", "performance:appraisals"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("employees") === "1") {
      const res = await listEnrollable(db, sp.get("cycleId") ?? "", sp.get("q") ?? undefined);
      return NextResponse.json(res);
    }
    if (sp.get("commandCenter") === "1") {
      const cycleId = sp.get("cycleId") ?? "";
      const data = await commandCenter(db, cycleId);
      return NextResponse.json(data);
    }
    const id = sp.get("id");
    if (id) {
      const data = await getCycleDetail(db, id);
      return NextResponse.json(data);
    }
    const res = await listCycles(db, {
      status: sp.get("status") ?? undefined,
      year: sp.get("year") ?? undefined,
      q: sp.get("q") ?? undefined,
      limit: Number(sp.get("limit") ?? 50),
      offset: Number(sp.get("offset") ?? 0),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "create");
    // aksi nudge butuh op khusus; aksi lain update/create standar
    const op = action === "nudge" || action === "nudgeAll" ? "op:nudge" : action === "create" ? "create" : "update";
    const m = await requireMenuAction(req, "performance:cycles", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = m.actor.name;

    switch (action) {
      case "create": {
        const id = await createCycle(db, {
          code: String(b.code ?? ""),
          name: String(b.name ?? ""),
          cycleType: b.cycleType != null ? String(b.cycleType) : undefined,
          periodStart: String(b.periodStart ?? ""),
          periodEnd: String(b.periodEnd ?? ""),
          goalStart: b.goalStart ?? null,
          goalEnd: b.goalEnd ?? null,
          midStart: b.midStart ?? null,
          midEnd: b.midEnd ?? null,
          selfStart: b.selfStart ?? null,
          selfEnd: b.selfEnd ?? null,
          mgrStart: b.mgrStart ?? null,
          mgrEnd: b.mgrEnd ?? null,
          calibStart: b.calibStart ?? null,
          calibEnd: b.calibEnd ?? null,
          weightsJson: b.weightsJson != null ? String(b.weightsJson) : undefined,
          feedback360: b.feedback360 === true,
        }, actor);
        return NextResponse.json({ id }, { status: 201 });
      }
      case "enroll": {
        const res = await enrollParticipants(db, String(b.cycleId ?? ""), {
          employeeIds: Array.isArray(b.employeeIds) ? b.employeeIds.map(String) : undefined,
          allActive: b.allActive === true,
        }, actor);
        return NextResponse.json(res);
      }
      case "openGoal": {
        await openGoal(db, String(b.cycleId ?? ""), actor, b.force === true);
        // (opsional §25-5) prefill dari periode lalu — tiap peserta tetap menunggu review + submit
        if (b.prefill === true) {
          const res = await copyTeam(db, { cycleId: String(b.cycleId ?? "") }, actor);
          return NextResponse.json({ ok: true, prefill: res });
        }
        return NextResponse.json({ ok: true });
      }
      case "startOngoing":
      case "startAssessment":
      case "startCalibration":
      case "publish":
      case "close": {
        const target = { startOngoing: "Ongoing", startAssessment: "Assessment", startCalibration: "Calibration", publish: "Published", close: "Closed" }[action]!;
        await advanceCycle(db, String(b.cycleId ?? ""), target, actor, b.force === true);
        return NextResponse.json({ ok: true });
      }
      case "copyTeam": {
        const res = await copyTeam(db, {
          cycleId: String(b.cycleId ?? ""),
          sourceCycleId: b.sourceCycleId ? String(b.sourceCycleId) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "nudge": {
        const res = await nudgeParticipants(db, {
          cycleId: String(b.cycleId ?? ""),
          appraisalIds: Array.isArray(b.appraisalIds) ? b.appraisalIds.map(String) : [],
          channels: Array.isArray(b.channels) ? b.channels.map(String) : undefined,
          phase: b.phase != null ? String(b.phase) : undefined,
          message: b.message != null ? String(b.message) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "nudgeAll": {
        const lag = await laggingParticipants(db, String(b.cycleId ?? ""));
        if (lag.appraisalIds.length === 0) return NextResponse.json({ sent: [], rateLimited: [], queuedOutsideWorkHours: false, phase: lag.phase, note: "Tidak ada peserta tertinggal pada fase ini" });
        const res = await nudgeParticipants(db, {
          cycleId: String(b.cycleId ?? ""),
          appraisalIds: lag.appraisalIds,
          channels: Array.isArray(b.channels) ? b.channels.map(String) : undefined,
          phase: lag.phase,
          message: b.message != null ? String(b.message) : undefined,
        }, actor);
        return NextResponse.json({ ...res, phase: lag.phase, recipients: lag.appraisalIds.length });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    const m = await requireMenuAction(req, "performance:cycles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    await patchCycle(db, String(b.id), {
      name: b.name != null ? String(b.name) : undefined,
      cycleType: b.cycleType != null ? String(b.cycleType) : undefined,
      periodStart: b.periodStart ?? undefined,
      periodEnd: b.periodEnd ?? undefined,
      goalStart: b.goalStart ?? null,
      goalEnd: b.goalEnd ?? null,
      midStart: b.midStart ?? null,
      midEnd: b.midEnd ?? null,
      selfStart: b.selfStart ?? null,
      selfEnd: b.selfEnd ?? null,
      mgrStart: b.mgrStart ?? null,
      mgrEnd: b.mgrEnd ?? null,
      calibStart: b.calibStart ?? null,
      calibEnd: b.calibEnd ?? null,
      weightsJson: b.weightsJson != null ? String(b.weightsJson) : undefined,
      feedback360: b.feedback360 === true ? true : b.feedback360 === false ? false : undefined,
    }, m.actor.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
