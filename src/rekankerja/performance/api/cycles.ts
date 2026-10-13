import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/rekankerja/shared/services/access-scope";
import {
  listCycles, getCycle, createCycle, updateCycle, deleteCycle, enrollParticipants,
  openGoal, startOngoing, startAssessment, startCalibration, publishCycle, closeCycle,
  commandCenter, nudgeParticipants, nudgeAllLagging, flushQueuedNudges,
  NUDGE_CHANNELS, type NudgeChannel, type CycleInput, type EnrollInput,
} from "@/rekankerja/performance/services/perf-cycle-service";
import { prefillFromPrevious } from "@/rekankerja/performance/services/perf-goal-service";

// ============================================================================
// PERFORMANCE — API siklus penilaian + Command Center (P1 — §17):
//   GET  ?status&year&q                     → { rows }
//   GET  ?detail=ID                         → { cycle }
//   GET  ?commandCenter=1&cycleId=          → matriks §18.8 (matrix + agregat
//        per atasan + tile "belum mengisi")
//   POST  {action: create|enroll|openGoal|startOngoing|startAssessment|
//         startCalibration|publish|close|nudge|nudgeAll}
//   PATCH  {id, ...} — hanya status Draft
//   DELETE ?id= — hanya Draft
// Guard menu: performance:cycles (enroll/phase/nudge ops; VIEWER 403).
// ActivityLog di setiap mutasi.
// ============================================================================

/** Aktor goal (row-level ringan §11.3): super admin/HR tanpa employeeId → semua. */
export function goalActorOf(m: MenuActor) {
  return {
    employeeId: m.employeeId,
    superAdmin: SUPER_ADMIN_APP_ROLES.includes(m.appUserRole ?? "") || SUPER_ADMIN_PLATFORM_ROLES.includes(m.role),
  };
}

function cycleInputOf(b: Record<string, unknown>): CycleInput {
  return {
    code: String(b.code ?? ""),
    name: String(b.name ?? ""),
    cycleType: b.cycleType != null ? String(b.cycleType) : undefined,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    goalStart: b.goalStart, goalEnd: b.goalEnd,
    midStart: b.midStart, midEnd: b.midEnd,
    selfStart: b.selfStart, selfEnd: b.selfEnd,
    mgrStart: b.mgrStart, mgrEnd: b.mgrEnd,
    calibStart: b.calibStart, calibEnd: b.calibEnd,
    publishAt: b.publishAt,
    weightsJson: b.weightsJson != null ? String(b.weightsJson) : undefined,
    feedback360: b.feedback360 === true,
  };
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:cycles", "performance:goals", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    // Command Center (§18.8) — flush antrean nudge terjadwal juga (jam kerja)
    if (sp.get("commandCenter") === "1") {
      const cycleId = sp.get("cycleId");
      if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
      void flushQueuedNudges(db, "tenant").catch(() => { /* never */ });
      const cc = await commandCenter(db, cycleId);
      return NextResponse.json(cc);
    }

    const detail = sp.get("detail");
    if (detail) {
      const cycle = await getCycle(db, detail);
      if (!cycle) return NextResponse.json({ error: "Siklus tidak ditemukan" }, { status: 404 });
      return NextResponse.json({
        cycle: {
          ...cycle,
          appraisals: undefined,
          participantCount: cycle.appraisals.length,
        },
      });
    }

    const yearRaw = sp.get("year");
    const rows = await listCycles(db, {
      status: sp.get("status") ?? undefined,
      year: yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : undefined,
      q: sp.get("q") ?? undefined,
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
    const act =
      action === "enroll" ? "op:enroll" :
      action === "nudge" || action === "nudgeAll" ? "op:nudge" :
      action === "create" ? "create" :
      action === "deleteDraft" ? "delete" : "op:phase";
    const m = await requireMenuAction(req, "performance:cycles", act as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    switch (action) {
      case "create": {
        const id = await createCycle(db, cycleInputOf(b));
        await db.activityLog.create({
          data: { action: "Created", entity: "PerformanceCycle", entityId: id, detail: `Siklus penilaian ${String(b.code)} dibuat (Draft)` },
        });
        return NextResponse.json({ id }, { status: 201 });
      }
      case "deleteDraft": {
        const id = String(b.id ?? "");
        await deleteCycle(db, id);
        await db.activityLog.create({
          data: { action: "Deleted", entity: "PerformanceCycle", entityId: id, detail: "Siklus Draft dihapus (beserta peserta)" },
        });
        return NextResponse.json({ ok: true });
      }
      case "enroll": {
        const input: EnrollInput = {
          cycleId: String(b.cycleId ?? ""),
          mode: (b.mode === "unit" || b.mode === "ids" ? b.mode : "all") as EnrollInput["mode"],
          unitId: b.unitId != null ? String(b.unitId) : undefined,
          employeeIds: Array.isArray(b.employeeIds) ? b.employeeIds.map(String) : undefined,
          managerOverrides:
            b.managerOverrides && typeof b.managerOverrides === "object"
              ? Object.fromEntries(Object.entries(b.managerOverrides as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
              : undefined,
        };
        const report = await enrollParticipants(db, input);
        await db.activityLog.create({
          data: {
            action: "Processed", entity: "PerformanceCycle", entityId: input.cycleId,
            detail: `Enroll: ${report.enrolled.length} peserta ditambahkan; ${report.skippedDuplicate.length} duplikat dilompati; ${report.needManager.length} tanpa atasan (butuh penunjukan)`,
          },
        });
        return NextResponse.json({ report });
      }
      case "openGoal": {
        const id = String(b.cycleId ?? "");
        await openGoal(db, id);
        let prefill: { filled: number; templateFilled: number; noSource: number } | null = null;
        if (b.prefill === true) {
          prefill = await prefillFromPrevious(db, id, b.templateId != null ? String(b.templateId) : undefined);
        }
        await db.activityLog.create({
          data: {
            action: "Submitted", entity: "PerformanceCycle", entityId: id,
            detail: `Fase penetapan target DIBUKA (GoalSetting)${prefill ? ` + prefill: ${prefill.filled} salinan, ${prefill.templateFilled} template, ${prefill.noSource} tanpa sumber` : ""}`,
          },
        });
        return NextResponse.json({ ok: true, prefill });
      }
      case "startOngoing": {
        const id = String(b.cycleId ?? "");
        await startOngoing(db, id);
        await db.activityLog.create({ data: { action: "Submitted", entity: "PerformanceCycle", entityId: id, detail: "Fase Ongoing dimulai (siklus berjalan)" } });
        return NextResponse.json({ ok: true });
      }
      case "startAssessment": {
        const id = String(b.cycleId ?? "");
        await startAssessment(db, id);
        await db.activityLog.create({ data: { action: "Submitted", entity: "PerformanceCycle", entityId: id, detail: "Fase Assessment dibuka (self → manager)" } });
        return NextResponse.json({ ok: true });
      }
      case "startCalibration": {
        const id = String(b.cycleId ?? "");
        await startCalibration(db, id);
        await db.activityLog.create({ data: { action: "Submitted", entity: "PerformanceCycle", entityId: id, detail: "Fase Kalibrasi dibuka" } });
        return NextResponse.json({ ok: true });
      }
      case "publish": {
        const id = String(b.cycleId ?? "");
        await publishCycle(db, id, b.force === true);
        await db.activityLog.create({
          data: { action: "Submitted", entity: "PerformanceCycle", entityId: id, detail: `Hasil siklus DIPUBLIKASIKAN${b.force === true ? " (force — peserta ManagerDone dipaksa)" : ""}` },
        });
        return NextResponse.json({ ok: true });
      }
      case "close": {
        const id = String(b.cycleId ?? "");
        await closeCycle(db, id);
        await db.activityLog.create({ data: { action: "Submitted", entity: "PerformanceCycle", entityId: id, detail: "Siklus DITUTUP (Closed)" } });
        return NextResponse.json({ ok: true });
      }
      case "nudge": {
        const channels = (Array.isArray(b.channels) ? b.channels.map(String) : ["in-app"]).filter((c): c is NudgeChannel =>
          (NUDGE_CHANNELS as readonly string[]).includes(c));
        const results = await nudgeParticipants(db, "tenant", {
          appraisalIds: Array.isArray(b.appraisalIds) ? b.appraisalIds.map(String) : [],
          channels, message: b.message != null ? String(b.message) : undefined,
        });
        const sentCount = results.flatMap((r) => r.results).filter((r) => r.status === "sent").length;
        await db.activityLog.create({
          data: {
            action: "Nudged", entity: "PerformanceCycle", entityId: String(b.cycleId ?? ""),
            detail: `Remind manual: ${results.length} peserta × kanal ${channels.join("+")}; terkirim ${sentCount} (laporan per kanal di hasil)`,
          },
        });
        return NextResponse.json({ results });
      }
      case "nudgeAll": {
        const cycleId = String(b.cycleId ?? "");
        const channels = (Array.isArray(b.channels) ? b.channels.map(String) : ["in-app", "email"]).filter((c): c is NudgeChannel =>
          (NUDGE_CHANNELS as readonly string[]).includes(c));
        const results = await nudgeAllLagging(db, "tenant", cycleId, channels, b.message != null ? String(b.message) : undefined);
        const sentCount = results.flatMap((r) => r.results).filter((r) => r.status === "sent").length;
        await db.activityLog.create({
          data: {
            action: "Nudged", entity: "PerformanceCycle", entityId: cycleId,
            detail: `Remind All: ${results.length} peserta tertinggal × kanal ${channels.join("+")}; terkirim ${sentCount}`,
          },
        });
        return NextResponse.json({ results });
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
    const id = String(b.id ?? "");
    const m = await requireMenuAction(req, "performance:cycles", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await updateCycle(m.db, id, cycleInputOf(b));
    await m.db.activityLog.create({
      data: { action: "Updated", entity: "PerformanceCycle", entityId: id, detail: `Siklus ${String(b.code)} diperbarui (Draft)` },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const m = await requireMenuAction(req, "performance:cycles", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    await deleteCycle(m.db, id);
    await m.db.activityLog.create({
      data: { action: "Deleted", entity: "PerformanceCycle", entityId: id, detail: "Siklus Draft dihapus" },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
