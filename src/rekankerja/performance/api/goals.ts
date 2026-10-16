import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  listGoalParticipants, goalDetail, copySources, copyPreview, copyFromCycle, copyTeam,
  assignBatch, patchDraft, approveProposal, lockGoals,
  buildTargetTemplateXlsx, importTargetsPreview, importTargetsCommit, metricLevelsText,
  type KpiItemInput, type CopyRowInput,
} from "@/rekankerja/performance/services/perf-goal-service";

// ============================================================================
// PERFORMANCE — API target & KPI (P1 — §17):
//   GET  ?cycleId&q                          → daftar peserta + progres
//   GET  ?appraisalId=                       → detail baris KPI + validasi draf
//   GET  ?copySources=1&appraisalId=         → siklus sumber salin §18.2 (D15)
//   GET  ?importTemplate=targets&cycleId=    → unduh .xlsx dwibahasa §18.5
//   POST {action: assignBatch|patchDraft|approveProposal|lockGoals|copyFromCycle|
//         copyTeam}                          → mutasi draf/submit
//   POST {action: copyPreview}               → pratinjau salin (baca)
//   POST multipart {action: importTargetsPreview, cycleId, file} → pratinjau
//        validasi per sel (D16 — baris kotor ditolak per sel, bukan file)
//   POST {action: importTargetsCommit, cycleId, rows} → commit hanya baris valid
// Guard menu: performance:goals (op import — §18.5). ActivityLog di mutasi.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:goals", "performance:cycles"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = goalActorOf(m.actor);
    const sp = req.nextUrl.searchParams;

    // unduh template impor (§18.5) — contoh baris dari data nyata bila ada
    if (sp.get("importTemplate") === "targets") {
      const cycleId = sp.get("cycleId");
      if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
      const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true } });
      if (!cycle) return NextResponse.json({ error: "Siklus tidak ditemukan" }, { status: 404 });
      const sample = await db.appraisalRecord.findFirst({
        where: { cycleId },
        include: { employee: { select: { employeeNo: true, fullName: true } }, kpis: { take: 1 } },
      });
      const example = {
        employeeNo: sample?.employee.employeeNo ?? "MII00001",
        fullName: sample?.employee.fullName ?? "Nama Karyawan",
        kpi: sample?.kpis[0]?.title ?? "ACCURACY-ORDER",
        polarity: sample?.kpis[0]?.polarity ?? "Higher",
        unit: sample?.kpis[0]?.unit ?? "%",
        threshold: sample?.kpis[0]?.thresholdMin != null ? String(sample.kpis[0].thresholdMin) : "95",
        target: sample?.kpis[0]?.target != null ? String(sample.kpis[0].target) : "98",
        stretch: sample?.kpis[0]?.stretchValue != null ? String(sample.kpis[0].stretchValue) : "100",
        weight: sample?.kpis[0]?.weight != null ? String(sample.kpis[0].weight) : "20",
        critical: sample?.kpis[0]?.isCritical ? "Ya" : "Tidak",
        metric: metricLevelsText(sample?.kpis[0]?.metricLevelsJson) ??
          "1: Tidak submit / submit ulang usulan.\n2: Usulan disetujui atasan & DivMan/Direktur, kurang berkualitas/berdampak.\n3: Disetujui, berkualitas baik & berdampak.\n4: Terimplementasi dalam lingkup departemen.\n5: Terimplementasi lingkup lebih luas, terukur, tepat guna.",
      };
      const buf = await buildTargetTemplateXlsx(cycle.code, example);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="template-target-${cycle.code}.xlsx"`,
        },
      });
    }

    if (sp.get("copySources") === "1") {
      const appraisalId = sp.get("appraisalId");
      if (!appraisalId) return NextResponse.json({ error: "appraisalId wajib" }, { status: 400 });
      return NextResponse.json(await copySources(db, appraisalId));
    }

    const appraisalId = sp.get("appraisalId");
    if (appraisalId) {
      return NextResponse.json(await goalDetail(db, appraisalId));
    }

    const cycleId = sp.get("cycleId");
    if (!cycleId) return NextResponse.json({ error: "cycleId atau appraisalId wajib" }, { status: 400 });
    const rows = await listGoalParticipants(db, actor, { cycleId, q: sp.get("q") ?? undefined });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // multipart → pratinjau impor Excel (D16)
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = String(form.get("action") ?? "");
      if (action !== "importTargetsPreview") {
        return NextResponse.json({ error: `Aksi multipart tidak dikenal: ${action}` }, { status: 400 });
      }
      const m = await requireMenuAction(req, "performance:goals", "op:import");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const file = form.get("file");
      const cycleId = String(form.get("cycleId") ?? "");
      if (!(file instanceof File)) return NextResponse.json({ error: "Berkas .xlsx wajib diunggah" }, { status: 400 });
      if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Ukuran file melebihi 2 MB (D16)" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const actor = goalActorOf(m.actor);
      const preview = await importTargetsPreview(m.db, actor, cycleId, { buffer: buf, name: file.name, type: file.type });
      await m.db.activityLog.create({
        data: {
          action: "Processed", entity: "PerformanceCycle", entityId: cycleId,
          detail: `Pratinjau impor target ${file.name}: ${preview.counts.valid} valid · ${preview.counts.error} error · ${preview.counts.skip} lompat (D16)`,
        },
      });
      return NextResponse.json(preview);
    }

    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const act =
      action === "importTargetsCommit" ? "op:import" :
      action === "copyPreview" ? "view" : "update";
    const m = await requireMenuAction(req, "performance:goals", act as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = goalActorOf(m.actor);

    switch (action) {
      case "copyPreview": {
        const out = await copyPreview(db, actor, String(b.appraisalId ?? ""), String(b.sourceAppraisalId ?? ""));
        return NextResponse.json(out);
      }
      case "copyFromCycle": {
        const rows = (Array.isArray(b.rows) ? b.rows : []) as CopyRowInput[];
        const out = await copyFromCycle(db, actor, String(b.appraisalId ?? ""), String(b.sourceAppraisalId ?? ""), rows);
        await db.activityLog.create({
          data: {
            action: "Created", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
            detail: `Salin dari periode sebelumnya: ${out.created} baris dari ${out.cycleCode} (capaian direset, status tetap draf §18.2)`,
          },
        });
        return NextResponse.json(out);
      }
      case "copyTeam": {
        const out = await copyTeam(db, actor, String(b.cycleId ?? ""), String(b.sourceCycleId ?? ""));
        await db.activityLog.create({
          data: {
            action: "Created", entity: "PerformanceCycle", entityId: String(b.cycleId ?? ""),
            detail: `Salin tim: ${out.filled.length} terisi · ${out.skipped.length} dilewati (sudah isi) · ${out.noSource.length} tanpa sumber (§18.2-c)`,
          },
        });
        return NextResponse.json(out);
      }
      case "assignBatch": {
        const items = (Array.isArray(b.items) ? b.items : []) as KpiItemInput[];
        const out = await assignBatch(db, actor, String(b.appraisalId ?? ""), items, b.mode === "replace" ? "replace" : "append");
        await db.activityLog.create({
          data: {
            action: "Created", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
            detail: `Penetapan KPI: +${out.created} baris draf${out.removed ? `, −${out.removed} baris lama` : ""} (belum submit)`,
          },
        });
        return NextResponse.json(out);
      }
      case "patchDraft": {
        const rows = (Array.isArray(b.rows) ? b.rows : []) as { id: string; title?: string; description?: string | null; measureMode?: string; metricLevels?: unknown; unit?: string; polarity?: string; target?: number | null; thresholdMin?: number | null; stretchValue?: number | null; weight?: number; isCritical?: boolean }[];
        const removedIds = (Array.isArray(b.removedIds) ? b.removedIds : []).map(String);
        const out = await patchDraft(db, actor, String(b.appraisalId ?? ""), rows, removedIds);
        // autosave §18.7 — log RINGKAS (bukan per ketikan: satu baris per batch)
        await db.activityLog.create({
          data: {
            action: "Updated", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
            detail: `Autosave draf: ${out.updated} baris diperbarui${out.removed ? `, ${out.removed} dihapus` : ""}`,
          },
        }).catch(() => { /* autosave tidak boleh gagal karena log */ });
        return NextResponse.json(out);
      }
      case "approveProposal": {
        const out = await approveProposal(db, actor, String(b.appraisalId ?? ""), b.decision === "reject" ? "reject" : "approve");
        await db.activityLog.create({
          data: {
            action: b.decision === "reject" ? "Rejected" : "Approved", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
            detail: `Usulan KPI karyawan (MBO): ${out.kept} diterima masuk daftar resmi / ${out.removed} ditolak (§26-4)`,
          },
        });
        return NextResponse.json(out);
      }
      case "lockGoals": {
        const out = await lockGoals(db, actor, String(b.appraisalId ?? ""));
        await db.activityLog.create({
          data: {
            action: "Submitted", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
            detail: `Target DIKUNCI (GoalApproved): ${out.kpiCount} KPI · ${out.docNo}${out.notified ? " · karyawan dinotifikasi" : ""} (§35-3)`,
          },
        });
        return NextResponse.json(out);
      }
      case "importTargetsCommit": {
        const rows = (Array.isArray(b.rows) ? b.rows : []) as never[];
        const out = await importTargetsCommit(db, actor, String(b.cycleId ?? ""), rows);
        await db.activityLog.create({
          data: {
            action: "Created", entity: "AppraisalKpi", entityId: String(b.cycleId ?? ""),
            detail: `Impor Excel target: ${out.created} baris draf dibuat, ${out.skipped} lompat (D16 — hanya baris valid; hasil menunggu review+submit atasan)`,
          },
        });
        return NextResponse.json(out);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
