import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import type { DecideActor } from "@/rekankerja/shared/services/approval-engine";
import {
  calibrationDashboard, listSessions, createSession, recordDecision,
  startFinalize, decideFinalize, listFinalizations,
  publishResults, closeResults, decideAppeal, ensurePerfApprovalStructure,
} from "@/rekankerja/performance/services/calibration-service";

// ============================================================================
// PERFORMANCE — API kalibrasi & finalisasi (P4 — §17; §30 alur 6; §31 alur 7;
// §18.10 bell curve AMANDEMEN 2; approval docType PerformanceAppraisal AS-PERF-STD).
//   GET  ?cycleId=&metric=manager|final          → dashboard distribusi + bell curve + z D19
//   GET  ?cycleId=&sessions=1                    → sesi kalibrasi + keputusan ter-audit
//   GET  ?cycleId=&finalizations=1               → daftar finalisasi + status persetujuan
//   POST {action:createSession}                  → jadwal sesi (fase Assessment/Calibration)
//   POST {action:recordDecision}                 → keputusan kalibrasi (alasan wajib §30-3)
//   POST {action:startFinalize}                  → ajukan finalisasi (batch; engine PerformanceAppraisal)
//   POST {action:decideFinalize}                 → putus jenjang persetujuan (otoritas via engine)
//   POST {action:publish|close}                  → publikasi / penutupan hasil (Alur 7)
//   POST {action:decideAppeal}                   → putus banding (Rejected/Adjusted/Withdrawn)
// Guard: performance:calibration (decide/session/finalize) · performance:results (publish/appeal).
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:calibration", "performance:results", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const cycleId = sp.get("cycleId") ?? "";
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
    if (sp.get("sessions") === "1") return NextResponse.json(await listSessions(db, cycleId));
    if (sp.get("finalizations") === "1") {
      await ensurePerfApprovalStructure(db);
      return NextResponse.json(await listFinalizations(db, cycleId));
    }
    const metric = sp.get("metric") === "final" ? "final" : "manager";
    return NextResponse.json(await calibrationDashboard(db, { cycleId, metric }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const menuKey = action === "publish" || action === "close" || action === "decideAppeal" ? "performance:results" : "performance:calibration";
    const op = action === "createSession" ? "op:session"
      : action === "recordDecision" ? "op:decide"
      : action === "startFinalize" || action === "decideFinalize" ? "op:finalize"
      : action === "publish" || action === "close" ? "op:publish"
      : action === "decideAppeal" ? "op:appeal"
      : "update";
    const m = await requireMenuAction(req, menuKey, op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor: DecideActor = { role: m.actor.role, employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null };
    const cycleId = String(b.cycleId ?? "");

    switch (action) {
      case "createSession": {
        const res = await createSession(db, {
          cycleId,
          orgUnitId: b.orgUnitId != null && b.orgUnitId !== "" ? String(b.orgUnitId) : undefined,
          heldAt: String(b.heldAt ?? ""),
          participantIds: Array.isArray(b.participantIds) ? b.participantIds.map(String) : [],
          chairId: b.chairId != null && b.chairId !== "" ? String(b.chairId) : undefined,
          notes: b.notes != null ? String(b.notes) : undefined,
        }, m.actor.name);
        return NextResponse.json(res);
      }
      case "recordDecision": {
        const res = await recordDecision(db, {
          sessionId: String(b.sessionId ?? ""),
          appraisalId: String(b.appraisalId ?? ""),
          newScore: b.newScore == null || b.newScore === "" ? undefined : Number(b.newScore),
          newRating: b.newRating == null || b.newRating === "" ? undefined : Number(b.newRating),
          potentialBand: b.potentialBand == null || b.potentialBand === "" ? undefined : Number(b.potentialBand),
          reason: String(b.reason ?? ""),
        }, m.actor.name);
        return NextResponse.json(res);
      }
      case "startFinalize": {
        const res = await startFinalize(db, {
          appraisalIds: Array.isArray(b.appraisalIds) ? b.appraisalIds.map(String) : [String(b.appraisalId ?? "")].filter(Boolean),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "decideFinalize": {
        const res = await decideFinalize(db, {
          appraisalId: String(b.appraisalId ?? ""),
          action: b.decision === "reject" ? "reject" : "approve",
          note: b.note != null ? String(b.note) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "publish": {
        const res = await publishResults(db, { cycleId, force: b.force === true, actor: m.actor.name });
        return NextResponse.json(res);
      }
      case "close": {
        const res = await closeResults(db, { cycleId, force: b.force === true, actor: m.actor.name });
        return NextResponse.json(res);
      }
      case "decideAppeal": {
        const decision = String(b.decision ?? "");
        if (!["Rejected", "Adjusted", "Withdrawn"].includes(decision)) {
          return NextResponse.json({ error: `Keputusan banding tidak dikenal: ${decision}` }, { status: 400 });
        }
        const res = await decideAppeal(db, {
          appraisalId: String(b.appraisalId ?? ""),
          decision: decision as "Rejected" | "Adjusted" | "Withdrawn",
          newScore: b.newScore == null || b.newScore === "" ? undefined : Number(b.newScore),
          newRating: b.newRating == null || b.newRating === "" ? undefined : Number(b.newRating),
          reason: String(b.reason ?? ""),
        }, m.actor.name);
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
