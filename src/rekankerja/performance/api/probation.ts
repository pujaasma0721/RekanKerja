import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import type { DecideActor } from "@/rekankerja/shared/services/approval-engine";
import {
  ensureProbInfrastructure, listProbations, searchProbationEmployees,
  createManualProbation, assessProbation, recommendProbation, submitDecision, decideProbation,
  toPersonnelAction, toLetter, cancelProbation,
} from "@/rekankerja/performance/services/probation-service";

// ============================================================================
// PERFORMANCE — API evaluasi masa percobaan (P7 — §17 probation; §28 alur 4;
// §35 guard): D9 auto-create dari onboarding terjadi di appointment-service;
// endpoint ini melayani daftar + alur manual HR/atasan:
//   GET  ?status=&dueSoon=1&employeeId=   → daftar evaluasi (+ chain + PA + surat)
//   GET  ?employees=1&q=                   → karyawan utk picker create manual
//   POST {action:create}                   → evaluasi manual (kriteria 3–6 Σ100, dueDate ≤ join+3bln §7.1)
//   POST {action:assess}                   → penilaian atasan (skor 0–100)
//   POST {action:recommend}                → rekomendasi HR (Confirm/Extend/Terminate)
//   POST {action:submit}                   → ajukan keputusan (approval ProbationDecision AS-PROB-STD)
//   POST {action:decide}                   → putus jenjang (approve/reject)
//   POST {action:toPersonnelAction}        → gulir PA (ChangeStatus/ExtendProbation/Termination)
//   POST {action:toLetter}                 → terbitkan surat PROB_RESULT/PROB_EXTEND
//   POST {action:cancel}                   → batalkan (alasan ter-audit)
// Guard menu: performance:probation — op per aksi (lihat MENU_OPS). ActivityLog di service.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:probation", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    if (sp.get("employees") === "1") {
      return NextResponse.json(await searchProbationEmployees(db, sp.get("q") || undefined));
    }
    await ensureProbInfrastructure(db); // self-heal tenant lama (idempoten)
    return NextResponse.json(await listProbations(db, {
      status: sp.get("status") || undefined,
      dueSoon: sp.get("dueSoon") === "1",
      employeeId: sp.get("employeeId") || undefined,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // op per aksi — katalog MENU_OPS "performance:probation"
    // (new/assess/recommend/submit/decide/cancel; toPersonnelAction & toLetter
    //  = lanjutan keputusan → reuse op:decide)
    const opKey: Record<string, `op:${string}`> = {
      create: "op:new",
      assess: "op:assess",
      recommend: "op:recommend",
      submit: "op:submit",
      decide: "op:decide",
      toPersonnelAction: "op:decide",
      toLetter: "op:decide",
      cancel: "op:cancel",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:probation", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor: DecideActor = { role: m.actor.role, employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null };

    switch (action) {
      case "create": {
        const res = await createManualProbation(db, {
          employeeId: String(b.employeeId ?? ""),
          joinDate: String(b.joinDate ?? ""),
          criteria: Array.isArray(b.criteria) ? (b.criteria as Record<string, unknown>[]).map((c) => ({
            title: String(c.title ?? ""), weight: Number(c.weight ?? 0),
          })) : undefined,
          actor: m.actor.name,
        });
        return NextResponse.json(res, { status: 201 });
      }
      case "assess": {
        const res = await assessProbation(db, {
          id: String(b.id ?? ""),
          criteria: Array.isArray(b.criteria) ? (b.criteria as Record<string, unknown>[]).map((c) => ({
            title: String(c.title ?? ""), weight: Number(c.weight ?? 0),
          })) : undefined,
          managerScore: Number(b.managerScore ?? 0),
          note: b.note != null ? String(b.note) : undefined,
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "recommend": {
        const res = await recommendProbation(db, {
          id: String(b.id ?? ""),
          recommendation: String(b.recommendation ?? ""),
          hrNote: b.hrNote != null ? String(b.hrNote) : undefined,
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "submit": {
        const res = await submitDecision(db, {
          id: String(b.id ?? ""),
          actor: m.actor.name,
          actorId: m.actor.appUserId ?? null,
        });
        return NextResponse.json(res);
      }
      case "decide": {
        const res = await decideProbation(db, {
          id: String(b.id ?? ""),
          action: b.decision === "reject" ? "reject" : "approve",
          note: b.note != null ? String(b.note) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "toPersonnelAction": {
        const rawType = String(b.type ?? "");
        const res = await toPersonnelAction(db, {
          id: String(b.id ?? ""),
          type: rawType === "ChangeStatus" || rawType === "ExtendProbation" || rawType === "Termination" ? rawType : undefined,
          effectiveDate: b.effectiveDate != null && b.effectiveDate !== "" ? String(b.effectiveDate) : undefined,
          actor: m.actor.name,
        });
        return NextResponse.json(res, { status: 201 });
      }
      case "toLetter": {
        const res = await toLetter(db, {
          id: String(b.id ?? ""),
          actorId: m.actor.appUserId ?? null,
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "cancel": {
        const res = await cancelProbation(db, {
          id: String(b.id ?? ""),
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
