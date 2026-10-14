import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { DecisionConflictError, DecisionForbiddenError } from "@/rekankerja/shared/services/approval-engine";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  distribution, bellCurve, openSession, decide, closeSession, listSessions,
  finalize, finalizeBoard, decidePerfApproval,
  type CalibrationActor,
} from "@/rekankerja/performance/services/perf-calibration-service";

// ============================================================================
// PERFORMANCE — API Kalibrasi (P4 — §17 calibration, §30 Alur 6, §18.10):
//   GET  ?cycleId&unitId&mode                 → dashboard distribusi §30-1
//   GET  ?curve=1&cycleId[&unitId&managerId&mode=before|after]
//                                             → Bell Curve §18.10 (histogram +
//        overlay normal + z per atasan D19; atasan otomatis dibatasi kurva
//        timnya sendiri — §11.3)
//   GET  ?sessions=1&cycleId                  → daftar sesi kalibrasi
//   GET  ?finalize=1&cycleId                  → board finalisasi (ManagerDone
//        siap submit + Calibrating = KOTAK APPROVAL PerformanceAppraisal +
//        Finalized selesai)
//   POST {action: openSession|decide|closeSession|finalize|approve|reject}
// Guard menu: performance:calibration (op decide/finalize/approve §14.2) +
//        ActivityLog per mutasi + otorisasi keputusan di engine (decide time).
// ============================================================================

function calibActorOf(m: MenuActor): CalibrationActor {
  const base = goalActorOf(m);
  return { ...base, name: m.name };
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:calibration"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = calibActorOf(m.actor);
    const sp = req.nextUrl.searchParams;

    const cycleId = sp.get("cycleId");
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });

    if (sp.get("curve") === "1") {
      const mode = sp.get("mode") === "after" ? "after" : "before";
      // §11.3/§18.10: atasan (non-superadmin) HANYA kurva timnya sendiri
      let managerId = sp.get("managerId") ?? undefined;
      if (!actor.superAdmin && actor.employeeId) managerId = actor.employeeId;
      return NextResponse.json(await bellCurve(db, {
        cycleId, mode,
        unitId: actor.superAdmin ? (sp.get("unitId") ?? undefined) : undefined,
        managerId,
      }));
    }

    if (sp.get("sessions") === "1") {
      return NextResponse.json(await listSessions(db, { cycleId }));
    }

    if (sp.get("finalize") === "1") {
      return NextResponse.json(await finalizeBoard(db, actor, { cycleId }));
    }

    const mode = sp.get("mode") === "after" ? "after" : "before";
    return NextResponse.json(await distribution(db, {
      cycleId, mode,
      unitId: actor.superAdmin ? (sp.get("unitId") ?? undefined) : undefined,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // guard berdasarkan aksi (pola pr.ts — body dibaca SEBELUM guard)
    const op =
      action === "finalize" ? "op:finalize" :
      action === "approve" || action === "reject" ? "op:approve" :
      "update";
    const m = await requireMenuAction(req, "performance:calibration", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = calibActorOf(m.actor);

    switch (action) {
      case "openSession": {
        const out = await openSession(db, actor, {
          cycleId: String(b.cycleId ?? ""),
          orgUnitId: b.orgUnitId ? String(b.orgUnitId) : null,
          heldAt: b.heldAt ? String(b.heldAt) : new Date().toISOString(),
          participants: Array.isArray(b.participants) ? b.participants.map(String) : [],
          chairId: b.chairId ? String(b.chairId) : null,
          notes: b.notes != null ? String(b.notes) : null,
        });
        return NextResponse.json(out, { status: 201 });
      }
      case "decide": {
        const out = await decide(db, actor, {
          sessionId: String(b.sessionId ?? ""),
          appraisalId: String(b.appraisalId ?? ""),
          newScore: b.newScore != null && b.newScore !== "" ? Number(b.newScore) : null,
          newRating: b.newRating != null && b.newRating !== "" ? Number(b.newRating) : null,
          potentialBand: b.potentialBand != null && b.potentialBand !== "" ? Number(b.potentialBand) : null,
          reason: String(b.reason ?? ""),
        });
        return NextResponse.json(out);
      }
      case "closeSession": {
        const out = await closeSession(db, actor, String(b.sessionId ?? ""), b.notes != null ? String(b.notes) : null);
        return NextResponse.json(out);
      }
      case "finalize": {
        const out = await finalize(db, actor, {
          appraisalIds: Array.isArray(b.appraisalIds) ? b.appraisalIds.map(String) : undefined,
          cycleId: b.cycleId != null ? String(b.cycleId) : undefined,
        });
        await db.activityLog.create({
          data: {
            action: "Submitted", entity: "PerformanceCycle", entityId: String(b.cycleId ?? "-"),
            detail: `Finalisasi batch: ${out.submitted.length} dokumen PerformanceAppraisal diajukan (${out.submitted.filter((s) => s.needL3).length} dengan L3 Direktur); ${out.skipped.length} dilewati (${actor.name}, §35-10)`,
          },
        }).catch(() => { /* log best-effort — hasil sudah di respons */ });
        return NextResponse.json(out);
      }
      case "approve":
      case "reject": {
        const out = await decidePerfApproval(db, {
          role: m.actor.role, employeeId: m.actor.employeeId, name: m.actor.name,
        }, {
          appraisalId: String(b.appraisalId ?? ""),
          action: action === "approve" ? "approve" : "reject",
          note: b.note != null ? String(b.note) : null,
        });
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
