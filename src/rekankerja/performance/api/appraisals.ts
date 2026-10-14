import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { goalActorOf } from "@/rekankerja/performance/api/cycles";
import {
  listAppraisals, appraisalDetail, submitSelf, saveManagerScore, submitManager,
  pullAutoSources, previewImpact, aiCompose,
  buildActualsTemplateXlsx, importActualsPreview, importActualsCommit,
  type ManagerPatch, type ImpactDraft, type AiComposeInput,
} from "@/rekankerja/performance/services/perf-appraisal-service";

// ============================================================================
// PERFORMANCE — API penilaian akhir periode (P3 — §17):
//   GET  ?cycleId&q&status&mine        → daftar peserta + skor + progress
//   GET  ?id=                           → detail (KPI + kompetensi + 360 agregat)
//   GET  ?importTemplate=actuals&cycleId= → unduh .xlsx realisasi §18.5
//   POST {action: submitSelf|saveManagerScore|submitManager|pullAutoSources|
//         importActualsCommit|previewImpact|aiCompose|finalize(stub)}
//   POST multipart {action: importActualsPreview, cycleId, file} (D16)
// Guard menu: performance:appraisals (op import/ai-compose/pull — §14.2) +
// goalActorOf row-level + ActivityLog per mutasi.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:appraisals", "performance:cycles", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = goalActorOf(m.actor);
    const sp = req.nextUrl.searchParams;

    // unduh template impor realisasi (§18.5)
    if (sp.get("importTemplate") === "actuals") {
      const cycleId = sp.get("cycleId");
      if (!cycleId) return NextResponse.json({ error: "cycleId wajib" }, { status: 400 });
      const { buffer, cycleCode } = await buildActualsTemplateXlsx(db, cycleId);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="template-realisasi-${cycleCode}.xlsx"`,
        },
      });
    }

    const id = sp.get("id");
    if (id) return NextResponse.json(await appraisalDetail(db, id));

    const cycleId = sp.get("cycleId");
    if (!cycleId) return NextResponse.json({ error: "cycleId atau id wajib" }, { status: 400 });
    const rows = await listAppraisals(db, actor, {
      cycleId,
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      mine: sp.get("mine") === "1",
    });
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // multipart → pratinjau impor realisasi (D16)
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = String(form.get("action") ?? "");
      if (action !== "importActualsPreview") {
        return NextResponse.json({ error: `Aksi multipart tidak dikenal: ${action}` }, { status: 400 });
      }
      const m = await requireMenuAction(req, "performance:appraisals", "op:import");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const file = form.get("file");
      const cycleId = String(form.get("cycleId") ?? "");
      if (!(file instanceof File)) return NextResponse.json({ error: "Berkas .xlsx wajib diunggah" }, { status: 400 });
      if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Ukuran file melebihi 2 MB (D16)" }, { status: 400 });
      const buf = Buffer.from(await file.arrayBuffer());
      const actor = goalActorOf(m.actor);
      const preview = await importActualsPreview(m.db, actor, cycleId, { buffer: buf, name: file.name, type: file.type });
      await m.db.activityLog.create({
        data: {
          action: "Processed", entity: "PerformanceCycle", entityId: cycleId,
          detail: `Pratinjau impor realisasi ${file.name}: ${preview.counts.valid} valid · ${preview.counts.error} error (D16)`,
        },
      });
      return NextResponse.json(preview);
    }

    const b = (await req.json()) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const act =
      action === "importActualsCommit" ? "op:import" :
      action === "aiCompose" ? "op:ai-compose" :
      action === "pullAutoSources" ? "op:pull" :
      action === "previewImpact" ? "view" :
      action === "saveManagerScore" ? "update" : "update";
    const m = await requireMenuAction(req, "performance:appraisals", act as never);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = goalActorOf(m.actor);
    // kunci rate-limit AI per pengguna (AppUser / fallback employeeId)
    const actorKey = m.actor.appUserId ?? m.actor.employeeId ?? m.actor.userId;

    switch (action) {
      case "submitSelf": {
        const input = {
          selfScores: (Array.isArray(b.selfScores) ? b.selfScores : []) as { competencyId: string; score: number }[],
          selfComments: (Array.isArray(b.selfComments) ? b.selfComments : []) as { competencyId: string; comment: string }[],
          selfAiAssistedIds: (Array.isArray(b.selfAiAssistedIds) ? b.selfAiAssistedIds : []).map(String),
          manualActuals: (Array.isArray(b.manualActuals) ? b.manualActuals : []) as { kpiId: string; finalActual: number }[],
          evidence: (Array.isArray(b.evidence) ? b.evidence : []) as { kpiId: string; note: string }[],
        };
        const out = await submitSelf(db, String(b.employeeId ?? actor.employeeId ?? ""), String(b.appraisalId ?? ""), input);
        await db.activityLog.create({
          data: {
            action: "Submitted", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
            detail: `Self-assessment submitted (SelfDone): ${out.compCount} kompetensi · skor ${out.selfScore}${out.notified ? " · atasan dinotifikasi" : ""} (§35-7)`,
          },
        });
        return NextResponse.json(out);
      }
      case "saveManagerScore": {
        const patch: ManagerPatch = {
          kpiFinals: (Array.isArray(b.kpiFinals) ? b.kpiFinals : []) as ManagerPatch["kpiFinals"],
          compScores: (Array.isArray(b.compScores) ? b.compScores : []) as ManagerPatch["compScores"],
          compComments: (Array.isArray(b.compComments) ? b.compComments : []) as ManagerPatch["compComments"],
          aiAssistedIds: (Array.isArray(b.aiAssistedIds) ? b.aiAssistedIds : []).map(String),
          managerComment: b.managerComment != null ? String(b.managerComment) : undefined,
        };
        const out = await saveManagerScore(db, actor, String(b.appraisalId ?? ""), patch);
        // autosave §18.7 — log RINGKAS per batch (bukan per ketikan)
        await db.activityLog.create({
          data: {
            action: "Updated", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
            detail: `Autosave draf penilaian atasan — progres ${out.progress.pct}% (${out.progress.kpiFilled}/${out.progress.kpiTotal} KPI · ${out.progress.compScored}/${out.progress.compTotal} kompetensi) (§18.7)`,
          },
        }).catch(() => { /* autosave tidak boleh gagal karena log */ });
        return NextResponse.json(out);
      }
      case "submitManager": {
        const out = await submitManager(db, actor, String(b.appraisalId ?? ""));
        await db.activityLog.create({
          data: {
            action: "Submitted", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
            detail: `Penilaian atasan DIKUNCI (ManagerDone): skor ${out.managerScore} · ${out.docNo}${out.notified ? " · karyawan dinotifikasi" : ""} (§35-8)`,
          },
        });
        return NextResponse.json(out);
      }
      case "pullAutoSources": {
        const out = await pullAutoSources(db, actor, String(b.appraisalId ?? ""), {
          apply: b.apply === true,
          overwrite: b.overwrite === true,
          kpiIds: Array.isArray(b.kpiIds) ? b.kpiIds.map(String) : undefined,
        });
        if (b.apply === true) {
          await db.activityLog.create({
            data: {
              action: "Updated", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
              detail: `Tarikan otomatis diterapkan: ${out.applied} KPI terisi bukti autoValueJson · ${out.skippedManual} input manual dilewati (§18.6)`,
            },
          });
        } else {
          await db.activityLog.create({
            data: {
              action: "Processed", entity: "AppraisalKpi", entityId: String(b.appraisalId ?? ""),
              detail: `Pratinjau tarikan otomatis: ${out.rows.filter((r) => !r.needsManual).length} KPI ber-sumber · ${out.rows.filter((r) => r.needsManual).length} perlu input manual (§18.6)`,
            },
          }).catch(() => { /* preview read-only — log best-effort */ });
        }
        return NextResponse.json(out);
      }
      case "importActualsCommit": {
        const rows = (Array.isArray(b.rows) ? b.rows : []) as never[];
        const out = await importActualsCommit(db, actor, String(b.cycleId ?? ""), rows);
        await db.activityLog.create({
          data: {
            action: "Updated", entity: "AppraisalKpi", entityId: String(b.cycleId ?? ""),
            detail: `Impor Excel realisasi: ${out.updated} final aktual terisi, ${out.skipped} lompat — status TIDAK berubah, submitManager tetap terpisah (D16 §18.5)`,
          },
        });
        return NextResponse.json(out);
      }
      case "previewImpact": {
        const draft = {
          kpiFinals: (b.kpiFinals ?? {}) as ImpactDraft["kpiFinals"],
          compScores: (b.compScores ?? {}) as ImpactDraft["compScores"],
        };
        const out = await previewImpact(db, actor, String(b.appraisalId ?? ""), draft);
        // stateless §18.12 — hanya ActivityLog panggilan, hasil TIDAK disimpan (D21)
        await db.activityLog.create({
          data: {
            action: "Processed", entity: "AppraisalRecord", entityId: String(b.appraisalId ?? ""),
            detail: `PreviewImpact (stateless): pScore ${out.pScore} · rating ${out.pRating ?? "-"} · lengkap ${out.incomplete ? "belum" : "ya"} (§18.12/D21 — tanpa nominal Rp)`,
          },
        }).catch(() => { /* estimator tidak boleh gagal karena log */ });
        return NextResponse.json(out);
      }
      case "aiCompose": {
        const input = {
          scope: (b.scope === "self" || b.scope === "manager" || b.scope === "360" ? b.scope : "manager") as AiComposeInput["scope"],
          appraisalId: String(b.appraisalId ?? ""),
          competencyId: b.competencyId != null ? String(b.competencyId) : undefined,
          points: (Array.isArray(b.points) ? b.points : []).map(String),
          tone: (b.tone === "encouraging" || b.tone === "firm" ? b.tone : "neutral") as AiComposeInput["tone"],
          length: b.length === "medium" ? "medium" as const : "short" as const,
          lang: b.lang === "en" ? "en" as const : "id" as const,
        };
        const out = await aiCompose(db, actor, actorKey, input);
        return NextResponse.json(out); // unavailable → status 200 + flag (kegagalan tenang)
      }
      case "finalize": {
        // stub — finalisasi via P4 kalibrasi (approval chain §11.1)
        return NextResponse.json(
          { error: "Finalisasi via P4 kalibrasi — belum tersedia pada fase P3 (aksi ditolak sementara)" },
          { status: 400 },
        );
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
