import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  resultsView, acknowledgeOnBehalf, appealOnBehalf, decideAppeal,
} from "@/rekankerja/performance/services/calibration-service";

// ============================================================================
// PERFORMANCE — API hasil & 9-box (P4 — §17; §31 alur 7; §18-6 scatter 3×3).
//   GET  ?cycleId=                     → hasil per peserta + grid 9-box + ack status
//   POST {action:acknowledge}          → HR tandai dikomunikasikan offline (ter-log)
//   POST {action:appeal}               → HR ajukan banding ATAS NAMA karyawan
//   POST {action:decideAppeal}         → putus banding (Rejected/Adjusted/Withdrawn)
// Guard: performance:results (lihat/aksi hasil) — mutasi requireMutator + log.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:results", "performance:overview", "performance:calibration"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const cycleId = req.nextUrl.searchParams.get("cycleId") ?? "";
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
    return NextResponse.json(await resultsView(m.db, cycleId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const op = action === "decideAppeal" ? "op:appeal" : "update";
    const m = await requireMenuAction(req, "performance:results", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    switch (action) {
      case "acknowledge": {
        const res = await acknowledgeOnBehalf(db, {
          appraisalId: String(b.appraisalId ?? ""),
          reason: String(b.reason ?? ""),
        }, m.actor.name);
        return NextResponse.json(res);
      }
      case "appeal": {
        const res = await appealOnBehalf(db, {
          appraisalId: String(b.appraisalId ?? ""),
          note: String(b.note ?? ""),
        }, m.actor.name);
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
