import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  results, nineBox, publish, acknowledge, appeal, withdrawAppeal, decideAppeal, closeCycleResults,
} from "@/rekankerja/performance/services/perf-results-service";
import type { CalibrationActor } from "@/rekankerja/performance/services/perf-calibration-service";

// ============================================================================
// PERFORMANCE — API Hasil & 9-Box (P4 — §17 results, §31 Alur 7, §18-6):
//   GET  ?cycleId[&unitId]      → daftar hasil + ack + banding (row-level:
//                                 HR semua; atasan timnya — §11.3)
//   GET  ?ninebox=1&cycleId      → matriks 9-box 3×3 (HR/Direksi saja §11.3)
//   POST {action: publish|decideAppeal|closeResults}          (admin)
//   POST {action: acknowledge|appeal|withdrawAppeal, appraisalId}
//        — self-scope: employeeId aktor WAJIB = peserta (§35-13/14; jalur
//          utama karyawan = ess/my-appraisal; kontrak §17 results)
// Guard menu: performance:results (op publish/appeal/close §14.2).
// ============================================================================

function calibActorOf(m: MenuActor): CalibrationActor {
  const base = goalActorOf(m);
  return { ...base, name: m.name };
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:results"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = calibActorOf(m.actor);
    const sp = req.nextUrl.searchParams;

    const cycleId = sp.get("cycleId");
    if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });

    if (sp.get("ninebox") === "1") {
      return NextResponse.json(await nineBox(db, actor, { cycleId }));
    }
    return NextResponse.json(await results(db, actor, { cycleId, unitId: sp.get("unitId") ?? undefined }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const op =
      action === "publish" ? "op:publish" :
      action === "closeResults" ? "op:close" :
      action === "decideAppeal" ? "op:appeal" :
      "update";
    const m = await requireMenuAction(req, "performance:results", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = calibActorOf(m.actor);

    switch (action) {
      case "publish": {
        const out = await publish(db, actor, String(b.cycleId ?? ""), { force: b.force === true });
        return NextResponse.json(out);
      }
      case "closeResults": {
        const out = await closeCycleResults(db, actor, String(b.cycleId ?? ""));
        return NextResponse.json(out);
      }
      case "decideAppeal": {
        const out = await decideAppeal(db, actor, String(b.appraisalId ?? ""), {
          decision: b.decision === "Adjusted" ? "Adjusted" : "Rejected",
          note: String(b.note ?? ""),
          newScore: b.newScore != null && b.newScore !== "" ? Number(b.newScore) : null,
        });
        return NextResponse.json(out);
      }
      // ===== self-scope karyawan (kontrak §17; jalur utama = ess/my-appraisal) =====
      case "acknowledge": {
        if (!actor.employeeId || (b.employeeId != null && String(b.employeeId) !== actor.employeeId)) {
          return NextResponse.json({ error: "Acknowledge hanya oleh karyawan peserta sendiri (§35-13)" }, { status: 403 });
        }
        const out = await acknowledge(db, actor.employeeId, String(b.appraisalId ?? ""));
        return NextResponse.json(out);
      }
      case "appeal": {
        if (!actor.employeeId || (b.employeeId != null && String(b.employeeId) !== actor.employeeId)) {
          return NextResponse.json({ error: "Banding hanya oleh karyawan peserta sendiri (§35-14)" }, { status: 403 });
        }
        const out = await appeal(db, actor.employeeId, String(b.appraisalId ?? ""), {
          note: String(b.note ?? ""),
          evidence: b.evidence != null ? String(b.evidence) : null,
        });
        return NextResponse.json(out, { status: 201 });
      }
      case "withdrawAppeal": {
        if (!actor.employeeId || (b.employeeId != null && String(b.employeeId) !== actor.employeeId)) {
          return NextResponse.json({ error: "Penarikan banding hanya oleh pengaju sendiri" }, { status: 403 });
        }
        const out = await withdrawAppeal(db, actor.employeeId, String(b.appraisalId ?? ""));
        return NextResponse.json(out);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
