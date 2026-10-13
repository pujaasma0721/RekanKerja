import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  listCheckIns, scheduleCheckIn, logCheckIn, markMissed, saveMidActual, midProgress,
  reviseTarget, pendingRevisions, decideRevision,
} from "@/rekankerja/performance/services/perf-checkin-service";

// ============================================================================
// PERFORMANCE — API check-in 1-on-1 & monitoring (P2 — §17):
//   GET  ?cycleId[&appraisalId&from&to&status]   → riwayat check-in
//   GET  ?mid=1&appraisalId=                      → progres tengah tahun (§27-3)
//   GET  ?revisions=1[&cycleId]                   → permintaan revisi menunggu L2
//   POST {action: schedule|log|markMissed|saveMidActual|revise|approveRevision|rejectRevision}
//   PATCH {id, patch} — reschedule/agenda (status Planned)
// Guard menu: performance:checkins (op revise — §14.2). ActivityLog di mutasi.
// ============================================================================
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:checkins", "performance:goals", "performance:cycles"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("revisions") === "1") {
      const actor = goalActorOf(m.actor);
      const rows = await pendingRevisions(db, {
        cycleId: sp.get("cycleId") ?? undefined,
        forApproverEmployeeId: actor.superAdmin ? undefined : actor.employeeId ?? undefined,
      });
      return NextResponse.json({ rows });
    }

    if (sp.get("mid") === "1") {
      const appraisalId = sp.get("appraisalId");
      if (!appraisalId) return NextResponse.json({ error: "appraisalId wajib" }, { status: 400 });
      return NextResponse.json(await midProgress(db, appraisalId));
    }

    const rows = await listCheckIns(db, {
      cycleId: sp.get("cycleId") ?? undefined,
      appraisalId: sp.get("appraisalId") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      status: sp.get("status") ?? undefined,
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const act = action === "revise" ? "op:revise" : action === "approveRevision" || action === "rejectRevision" ? "op:revise" : "update";
    const m = await requireMenuAction(req, "performance:checkins", act as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = goalActorOf(m.actor);

    switch (action) {
      case "schedule": {
        const id = await scheduleCheckIn(db, actor, {
          appraisalId: String(b.appraisalId ?? ""),
          heldAt: b.heldAt, agenda: b.agenda != null ? String(b.agenda) : undefined, nextCheckInAt: b.nextCheckInAt,
        });
        await db.activityLog.create({
          data: { action: "Created", entity: "CheckIn", entityId: id, detail: `Check-in 1-on-1 dijadwalkan ${String(b.heldAt ?? "")} (§27-1)` },
        });
        return NextResponse.json({ id }, { status: 201 });
      }
      case "log": {
        const out = await logCheckIn(db, actor, {
          id: b.id != null ? String(b.id) : undefined,
          appraisalId: b.appraisalId != null ? String(b.appraisalId) : undefined,
          heldAt: b.heldAt,
          wins: Array.isArray(b.wins) ? b.wins.map(String) : [],
          blockers: Array.isArray(b.blockers) ? b.blockers.map(String) : [],
          next: Array.isArray(b.next) ? b.next.map(String) : [],
          managerComment: b.managerComment != null ? String(b.managerComment) : undefined,
        });
        await db.activityLog.create({
          data: { action: "Updated", entity: "CheckIn", entityId: out.id, detail: `Hasil 1-on-1 dicatat (Held) — dua arah §27-2` },
        });
        return NextResponse.json(out);
      }
      case "markMissed": {
        await markMissed(db, actor, String(b.id ?? ""));
        await db.activityLog.create({
          data: { action: "Missed", entity: "CheckIn", entityId: String(b.id ?? ""), detail: "Check-in ditandai terlewat" },
        });
        return NextResponse.json({ ok: true });
      }
      case "saveMidActual": {
        const rows = (Array.isArray(b.rows) ? b.rows : []) as { kpiId: string; midActual: number | null }[];
        const out = await saveMidActual(db, actor, String(b.appraisalId ?? ""), rows);
        await db.activityLog.create({
          data: { action: "Updated", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""), detail: `Checkpoint tengah tahun: ${out.updated} KPI midActual diisi (§27-3)` },
        });
        return NextResponse.json(out);
      }
      case "revise": {
        const changes = (Array.isArray(b.changes) ? b.changes : []) as never[];
        const out = await reviseTarget(db, actor, String(b.appraisalId ?? ""), changes, String(b.reason ?? ""));
        await db.activityLog.create({
          data: {
            action: "RevisionRequested", entity: "RevisionRequest", entityId: out.requestId,
            detail: `Ringkas: revisi target diajukan atasan — menunggu keputusan L2 ${out.approverName ?? "(HR)"} (payload lengkap di log RevisionRequested terkait; §27-4)`,
          },
        });
        return NextResponse.json(out, { status: 201 });
      }
      case "approveRevision":
      case "rejectRevision": {
        const out = await decideRevision(db, actor, String(b.requestId ?? ""), action === "approveRevision" ? "approve" : "reject", b.note != null ? String(b.note) : undefined);
        return NextResponse.json(out);
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
    const b = (await req.json()) as Record<string, unknown>;
    const m = await requireMenuAction(req, "performance:checkins", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = String(b.id ?? "");
    const patch: Record<string, unknown> = {};
    if (b.heldAt != null) {
      const d = new Date(String(b.heldAt));
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Tanggal tidak valid" }, { status: 400 });
      d.setHours(12, 0, 0, 0);
      patch.heldAt = d;
    }
    if (b.agenda != null) patch.agenda = String(b.agenda).trim() || null;
    if (b.nextCheckInAt != null) {
      const d = new Date(String(b.nextCheckInAt));
      if (!Number.isNaN(d.getTime())) { d.setHours(12, 0, 0, 0); patch.nextCheckInAt = d; }
    }
    await m.db.checkIn.update({ where: { id, status: "Planned" }, data: patch as never });
    await m.db.activityLog.create({
      data: { action: "Updated", entity: "CheckIn", entityId: id, detail: "Jadwal/agenda check-in diubah (masih Planned)" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
