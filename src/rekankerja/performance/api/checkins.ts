import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listCheckIns, scheduleCheckIn, logCheckIn, markMissed, midCheckpointView, saveMidActual, reviseTarget,
} from "@/rekankerja/performance/services/checkin-service";

// ============================================================================
// PERFORMANCE — API check-in & monitoring (P2 — §17; §27 alur 3).
//   GET  ?cycleId&appraisalId&from&to          → riwayat 1-on-1 semua tim
//   GET  ?midCheckpoint=1&cycleId              → checkpoint tengah tahun (midActual + progress)
//   POST  {action:schedule}                    → jadwalkan check-in (Planned)
//   POST  {action:log}                        → catat hasil (Held; wins/blockers/next)
//   POST  {action:markMissed}
//   POST  {action:saveMidActual}              → checkpoint per KPI (guard jendela mid §35-5)
//   POST  {action:reviseTarget}               → revisi mid-year (propose oleh atasan / apply oleh L2/HR)
// Guard menu: performance:checkins. ActivityLog di service.
// ============================================================================

async function actorIsHr(req: NextRequest): Promise<boolean> {
  // HR ditandai akses menu performance:settings (halaman HR-only §14.2) —
  // atasan hanya punya menu checkins/goals/appraisals (§36).
  const r = await requireMenuViewAny(req, ["performance:settings"]);
  return r.ok;
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:checkins", "performance:appraisals", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("midCheckpoint") === "1") {
      const rows = await midCheckpointView(db, sp.get("cycleId") ?? "");
      return NextResponse.json({ rows });
    }
    const res = await listCheckIns(db, {
      cycleId: sp.get("cycleId") ?? undefined,
      appraisalId: sp.get("appraisalId") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    const op = action === "reviseTarget" ? "op:revise" : action === "schedule" || action === "log" || action === "markMissed" || action === "saveMidActual" ? "update" : "update";
    const m = await requireMenuAction(req, "performance:checkins", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = m.actor;
    const isHr = await actorIsHr(req);

    switch (action) {
      case "schedule": {
        const id = await scheduleCheckIn(db, {
          appraisalId: String(b.appraisalId ?? ""),
          heldAt: String(b.heldAt ?? ""),
          agenda: b.agenda != null ? String(b.agenda) : undefined,
          nextCheckInAt: b.nextCheckInAt != null ? String(b.nextCheckInAt) : null,
        }, actor.name);
        return NextResponse.json({ id }, { status: 201 });
      }
      case "log": {
        await logCheckIn(db, {
          checkInId: String(b.checkInId ?? ""),
          wins: Array.isArray(b.wins) ? b.wins.map(String).filter(Boolean) : [],
          blockers: Array.isArray(b.blockers) ? b.blockers.map(String).filter(Boolean) : [],
          next: Array.isArray(b.next) ? b.next.map(String).filter(Boolean) : [],
          managerComment: b.managerComment != null ? String(b.managerComment) : undefined,
          nextCheckInAt: b.nextCheckInAt != null ? String(b.nextCheckInAt) : null,
        }, actor.name);
        return NextResponse.json({ ok: true });
      }
      case "markMissed": {
        await markMissed(db, String(b.checkInId ?? ""), actor.name);
        return NextResponse.json({ ok: true });
      }
      case "saveMidActual": {
        await saveMidActual(db, {
          kpiId: String(b.kpiId ?? ""),
          midActual: b.midActual == null || b.midActual === "" ? null : Number(b.midActual),
        }, actor.name, isHr && b.force === true);
        return NextResponse.json({ ok: true });
      }
      case "reviseTarget": {
        await reviseTarget(db, {
          appraisalId: String(b.appraisalId ?? ""),
          reason: String(b.reason ?? ""),
          items: Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).map((i) => ({
            kpiId: String(i.kpiId ?? ""),
            target: i.target === undefined ? undefined : (i.target == null || i.target === "" ? null : Number(i.target)),
            thresholdMin: i.thresholdMin === undefined ? undefined : (i.thresholdMin == null || i.thresholdMin === "" ? null : Number(i.thresholdMin)),
            stretchValue: i.stretchValue === undefined ? undefined : (i.stretchValue == null || i.stretchValue === "" ? null : Number(i.stretchValue)),
            weight: i.weight === undefined ? undefined : Number(i.weight),
          })) : [],
        }, { employeeId: actor.employeeId, name: actor.name, isHr }, b.mode === "propose" ? "propose" : "apply");
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
