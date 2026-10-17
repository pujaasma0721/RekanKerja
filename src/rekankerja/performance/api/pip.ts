import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  DecisionConflictError, DecisionForbiddenError, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import {
  ensurePipInfrastructure, listPips, pipDetail, searchPipEmployees, pipReferees, linkableAppraisals,
  createPip, patchPip, activatePip, decidePipApproval, reviewCheckpoint, extendPip, pipOutcome, cancelPip,
} from "@/rekankerja/performance/services/perf-pip-service";

// ============================================================================
// PERFORMANCE — API PIP end-to-end (P6 — §17 pip; §33 alur 9; §35 guard 20–22):
//   GET  ?status=&employeeId=&q=       → register PIP (+ chain + SK + checkpoint)
//                                        + stats ringkasan per status + recoveryRate
//   GET  ?id=                          → detail (targets + checkpoints + chain + saran)
//   GET  ?employees=1&q=                → cari karyawan Active (picker create)
//   GET  ?referees=1                   → kandidat pembina + HR advisor
//   GET  ?linkable=1&employeeId=        → penilaian Closed milik karyawan (tautan)
//   POST {action:create}               → PIP baru (usulan Alur 8 / manual ber-alasan,
//                                        SK terbit — §35-20)
//   POST {action:activate}              → ajukan aktivasi (approval AS-PIP-STD §33-1)
//   POST {action:approve|reject}        → putus jenjang (approve final → Active)
//   POST {action:reviewCheckpoint}     → catat capaian checkpoint (pembina/HR §33-3)
//   POST {action:extend}               → perpanjang 1× (total ≤3 bln — §35-21)
//   POST {action:outcome}              → Recovered/NotRecovered (+ saran SP §33-4)
//   POST {action:cancel|close}         → batalkan (alasan ter-audit)
//   POST {action:patch}                → ubah draf (rebuild checkpoint bila tanggal)
// Guard menu: performance:pip — aksi create/update = CRUD dasar; op khusus
// activate/checkpoint/extend/outcome (katalog menu-perms §14.2).
// Error map: DecisionConflictError → 409, DecisionForbiddenError → 403 (pola merit).
// ============================================================================

function errStatus(e: unknown): number {
  if (e instanceof DecisionConflictError) return 409;
  if (e instanceof DecisionForbiddenError) return 403;
  return 400;
}

function parseTargetsInput(raw: unknown): { title: string; metric: string; target: string; weight: number }[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]).map((t) => ({
    title: String(t.title ?? ""), metric: String(t.metric ?? ""), target: String(t.target ?? ""), weight: Number(t.weight ?? 0),
  })) : [];
}

export async function GET(req: NextRequest) {
  try {
    // PERF-AUD F-07: register PIP = data disipliner konfidensial — HANYA
    // pemegang menu performance:pip (fallback performance:overview dihapus;
    // halaman overview tidak memanggil API ini sama sekali).
    const m = await requireMenuViewAny(req, ["performance:pip"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    if (id) {
      const detail = await pipDetail(db, id);
      if (!detail) return NextResponse.json({ error: "PIP tidak ditemukan" }, { status: 404 });
      return NextResponse.json(detail);
    }
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
      q: sp.get("q") || undefined,
    }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: errStatus(e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    // guard per aksi — base CRUD (create/update) + op khusus menu-perms
    // "performance:pip" (§14.2); approve/reject memakai op activate (keputusan
    // approver jenjang — pola calibration approve).
    const opKey: Record<string, string> = {
      create: "create",
      activate: "op:activate",
      approve: "op:activate",
      reject: "op:activate",
      extend: "op:extend",
      reviewCheckpoint: "op:checkpoint",
      outcome: "op:outcome",
      cancel: "update",
      close: "update",
      patch: "update",
      submit: "op:activate", // legacy — kompatibilitas pemanggil lama
    };
    const op = opKey[action];
    if (!op) return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    const m = await requireMenuAction(req, "performance:pip", op as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor: DecideActor = { role: m.actor.role, employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null };
    const pipActor = {
      role: m.actor.role, appUserRole: m.actor.appUserRole,
      employeeId: m.actor.employeeId ?? null, name: m.actor.name, appUserId: m.actor.appUserId ?? null,
    };

    switch (action) {
      case "create": {
        const res = await createPip(db, {
          employeeId: String(b.employeeId ?? ""),
          appraisalId: b.appraisalId != null && b.appraisalId !== "" ? String(b.appraisalId) : undefined,
          reason: b.reason != null ? String(b.reason) : undefined,
          startDate: String(b.startDate ?? ""),
          months: Number(b.months ?? 2), // default 2 bln (D7) bila UI tak mengirim
          targets: parseTargetsInput(b.targets),
          reviewerId: b.reviewerId != null && b.reviewerId !== "" ? String(b.reviewerId) : undefined,
          hrAdvisorId: b.hrAdvisorId != null && b.hrAdvisorId !== "" ? String(b.hrAdvisorId) : undefined,
        }, m.actor.name);
        return NextResponse.json(res, { status: 201 });
      }
      case "activate":
      case "submit": {
        const res = await activatePip(db, {
          id: String(b.id ?? ""),
          actor: m.actor.name,
          actorId: m.actor.appUserId ?? null,
        });
        return NextResponse.json(res);
      }
      case "approve":
      case "reject": {
        const res = await decidePipApproval(db, {
          id: String(b.id ?? ""),
          action: action === "reject" ? "reject" : "approve",
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
        }, pipActor);
        return NextResponse.json(res);
      }
      case "extend": {
        const res = await extendPip(db, {
          id: String(b.id ?? ""),
          months: b.months != null && b.months !== "" ? Number(b.months) : undefined,
          reason: String(b.reason ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "outcome": {
        const res = await pipOutcome(db, {
          id: String(b.id ?? ""),
          outcome: b.outcome === "NotRecovered" ? "NotRecovered" : "Recovered",
          notes: String(b.notes ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "cancel":
      case "close": {
        const res = await cancelPip(db, {
          id: String(b.id ?? ""),
          reason: String(b.reason ?? ""),
          actor: m.actor.name,
        });
        return NextResponse.json(res);
      }
      case "patch": {
        const res = await patchPip(db, {
          id: String(b.id ?? ""),
          startDate: b.startDate != null && b.startDate !== "" ? String(b.startDate) : undefined,
          months: b.months != null && b.months !== "" ? Number(b.months) : undefined,
          targets: b.targets !== undefined ? parseTargetsInput(b.targets) : undefined,
          reviewerId: b.reviewerId != null && b.reviewerId !== "" ? String(b.reviewerId) : undefined,
          hrAdvisorId: b.hrAdvisorId === null ? null : (b.hrAdvisorId != null && b.hrAdvisorId !== "" ? String(b.hrAdvisorId) : undefined),
          appraisalId: b.appraisalId === null ? null : (b.appraisalId != null && b.appraisalId !== "" ? String(b.appraisalId) : undefined),
        }, m.actor.name);
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: errStatus(e) });
  }
}
