import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import type { DecideActor } from "@/rekankerja/shared/services/approval-engine";
import {
  ensurePipInfrastructure, listPips, searchPipEmployees, pipReferees, linkableAppraisals,
  createPip, updatePip, submitPip, decidePip, reviewCheckpoint, extendPip, outcomePip, cancelPip,
} from "@/rekankerja/performance/services/pip-service";

// ============================================================================
// PERFORMANCE — API PIP end-to-end (P6 — §17; §33 alur 9; §35 guard):
//   GET  ?status=&employeeId=          → daftar PIP (+ chain + SK + checkpoint)
//   GET  ?employees=1&q=                → cari karyawan Active (picker create)
//   GET  ?referees=1                    → kandidat pembina + HR advisor
//   GET  ?linkable=1&employeeId=        → penilaian Closed milik karyawan (tautan)
//   POST {action:create}                → draf PIP (target 3–5 Σ100, D7 1–3 bln)
//   POST {action:submit}                → ajukan (approval PipPlan AS-PIP-STD)
//   POST {action:decide}                → putus jenjang (approve/reject)
//   POST {action:reviewCheckpoint}      → catat capaian checkpoint (sekali jalan)
//   POST {action:extend}                → perpanjang 1× (total ≤3 bln — D7)
//   POST {action:outcome}               → Recovered/NotRecovered (+ saran SP)
//   POST {action:cancel}                → batalkan (alasan ter-audit)
//   PATCH {id, patch}                   → ubah draf (rebuild checkpoint bila tanggal)
// Guard menu: performance:pip — op per aksi (lihat MENU_OPS). ActivityLog di service.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:pip", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    if (sp.get("employees") === "1") {
      return NextResponse.json(await searchPipEmployees(db, sp.get("q") || undefined));
    }
    if (sp.get("referees") === "1") {
      return NextResponse.json(await pipReferees(db));
    }
    if (sp.get("linkable") === "1") {
      const employeeId = sp.get("employeeId") ?? "";
      if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });
      return NextResponse.json(await linkableAppraisals(db, employeeId));
    }
    await ensurePipInfrastructure(db); // self-heal tenant lama (idempoten)
    return NextResponse.json(await listPips(db, {
      status: sp.get("status") || undefined,
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
    // op per aksi — katalog MENU_OPS "performance:pip" (new/submit/decide/
    // activate/checkpoint/extend/outcome/cancel)
    const opKey: Record<string, `op:${string}`> = {
      create: "op:new",
      submit: "op:submit",
      decide: "op:decide",
      reviewCheckpoint: "op:checkpoint",
      extend: "op:extend",
      outcome: "op:outcome",
      cancel: "op:cancel",
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:pip", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor: DecideActor = { role: m.actor.role, employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null };

    switch (action) {
      case "create": {
        const res = await createPip(db, {
          employeeId: String(b.employeeId ?? ""),
          appraisalId: b.appraisalId != null && b.appraisalId !== "" ? String(b.appraisalId) : undefined,
          startDate: String(b.startDate ?? ""),
          months: Number(b.months ?? 2), // default 2 bln (D7) bila UI tak mengirim
          targets: Array.isArray(b.targets) ? (b.targets as Record<string, unknown>[]).map((t) => ({
            title: String(t.title ?? ""), metric: String(t.metric ?? ""), target: String(t.target ?? ""), weight: Number(t.weight ?? 0),
          })) : [],
          reviewerId: String(b.reviewerId ?? ""),
          hrAdvisorId: b.hrAdvisorId != null && b.hrAdvisorId !== "" ? String(b.hrAdvisorId) : undefined,
        }, m.actor.name);
        return NextResponse.json(res, { status: 201 });
      }
      case "submit": {
        const res = await submitPip(db, {
          id: String(b.id ?? ""),
          actor: m.actor.name,
          actorId: m.actor.appUserId ?? null,
        });
        return NextResponse.json(res);
      }
      case "decide": {
        const res = await decidePip(db, {
          id: String(b.id ?? ""),
          action: b.decision === "reject" ? "reject" : "approve",
          note: b.note != null ? String(b.note) : undefined,
        }, actor);
        return NextResponse.json(res);
      }
      case "reviewCheckpoint": {
        const res = await reviewCheckpoint(db, {
          id: String(b.id ?? ""),
          seq: Number(b.seq ?? 0),
          achievementPct: Number(b.achievementPct ?? 0),
          notes: b.notes != null ? String(b.notes) : undefined,
          actor: m.actor.name,
        }, actor);
        return NextResponse.json(res);
      }
      case "extend": {
        const res = await extendPip(db, {
          id: String(b.id ?? ""),
          extraWeeks: b.extraWeeks != null && b.extraWeeks !== "" ? Number(b.extraWeeks) : undefined,
          newEndDate: b.newEndDate != null && b.newEndDate !== "" ? String(b.newEndDate) : undefined,
          reason: String(b.reason ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "outcome": {
        const res = await outcomePip(db, {
          id: String(b.id ?? ""),
          outcome: b.outcome === "NotRecovered" ? "NotRecovered" : "Recovered",
          notes: String(b.notes ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "cancel": {
        const res = await cancelPip(db, {
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

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "performance:pip", "op:new");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const b = (await req.json()) as Record<string, unknown>;
    const res = await updatePip(db, {
      id: String(b.id ?? ""),
      startDate: b.startDate != null && b.startDate !== "" ? String(b.startDate) : undefined,
      months: b.months != null && b.months !== "" ? Number(b.months) : undefined,
      targets: Array.isArray(b.targets) ? (b.targets as Record<string, unknown>[]).map((t) => ({
        title: String(t.title ?? ""), metric: String(t.metric ?? ""), target: String(t.target ?? ""), weight: Number(t.weight ?? 0),
      })) : undefined,
      reviewerId: b.reviewerId != null && b.reviewerId !== "" ? String(b.reviewerId) : undefined,
      hrAdvisorId: b.hrAdvisorId === null ? null : (b.hrAdvisorId != null && b.hrAdvisorId !== "" ? String(b.hrAdvisorId) : undefined),
      appraisalId: b.appraisalId === null ? null : (b.appraisalId != null && b.appraisalId !== "" ? String(b.appraisalId) : undefined),
    }, m.actor.name);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
