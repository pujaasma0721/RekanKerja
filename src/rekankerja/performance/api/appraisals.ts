import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listAppraisals, getAssessmentView, saveManagerDraft, submitManager,
  buildActualsTemplate, parseActualsXlsx, validateActualRows, commitActualRows,
} from "@/rekankerja/performance/services/appraisal-service";
import { pullAutoSourcesFor } from "@/rekankerja/performance/services/auto-source-service";
import { previewImpactCompute } from "@/rekankerja/performance/services/perf-scoring";
import { aiCompose, type AiTone } from "@/rekankerja/performance/services/ai-compose";
import { xlsxResponse } from "@/rekankerja/shared/lib/export";

// ============================================================================
// PERFORMANCE — API penilaian (P3 — §17; §29 alur 5; §18.4 form, §18.5 impor
// realisasi, §18.6 tarikan otomatis, §18.11 AI assist, §18.12 estimasi dampak).
//   GET  ?cycleId&q&status&offset&limit        → daftar peserta penilaian
//   GET  ?id=…                                → view form penilaian (KPI+kompetensi+360)
//   GET  ?importTemplate=actuals&cycleId=…     → unduh .xlsx realisasi
//   POST  {action:saveDraft}                   → autosave draf atasan (§18.7)
//   POST  {action:submitManager}              → kunci penilaian (skor server §16)
//   POST  {action:pullAutoSources}            → tarikan otomatis preview/apply (§18.6)
//   POST  {action:previewImpact}              → estimasi dampak real-time (§18.12 D21)
//   POST  {action:aiCompose}                  → AI assist ulasan (§18.11 D20)
//   POST  {action:importActualsPreview|importActualsCommit} → impor Excel (D16)
// Guard: performance:appraisals. Aktivitas ter-log di service.
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:appraisals", "performance:overview", "performance:calibration"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    if (sp.get("importTemplate") === "actuals") {
      const buf = await buildActualsTemplate(db, sp.get("cycleId") ?? "");
      return xlsxResponse(buf, `template_realisasi_${sp.get("cycleId")?.slice(0, 8) ?? "kpi"}.xlsx`);
    }
    const id = sp.get("id");
    if (id) {
      const view = await getAssessmentView(db, id);
      return NextResponse.json(view);
    }
    const res = await listAppraisals(db, {
      cycleId: sp.get("cycleId") ?? "",
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let b: Record<string, unknown>;
    let importFile: File | null = null;
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) {
        if (typeof v === "string") obj[k] = v;
        else importFile = v as File;
      }
      b = obj;
    } else {
      b = await req.json();
    }
    const action = String(b.action ?? "");
    const op = action === "aiCompose" ? "op:aiCompose"
      : action === "previewImpact" ? "op:previewImpact"
      : action === "importActualsPreview" || action === "importActualsCommit" ? "op:importActuals"
      : action === "pullAutoSources" ? "op:pullAuto"
      : "update";
    const m = await requireMenuAction(req, "performance:appraisals", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = m.actor;

    switch (action) {
      case "saveDraft": {
        const res = await saveManagerDraft(db, {
          appraisalId: String(b.appraisalId ?? ""),
          kpiUpdates: Array.isArray(b.kpiUpdates) ? (b.kpiUpdates as Record<string, unknown>[]).map((u) => ({
            kpiId: String(u.kpiId ?? ""),
            finalActual: u.finalActual === undefined ? undefined : (u.finalActual == null || u.finalActual === "" ? null : Number(u.finalActual)),
          })) : [],
          compUpdates: Array.isArray(b.compUpdates) ? (b.compUpdates as Record<string, unknown>[]).map((u) => ({
            competencyId: String(u.competencyId ?? ""),
            score: u.score === undefined ? undefined : Number(u.score),
            comment: u.comment === undefined ? undefined : String(u.comment ?? ""),
            aiAssisted: u.aiAssisted === undefined ? undefined : u.aiAssisted === true,
          })) : [],
        });
        return NextResponse.json(res);
      }
      case "submitManager": {
        const res = await submitManager(db, String(b.appraisalId ?? ""), actor.name);
        return NextResponse.json(res);
      }
      case "pullAutoSources": {
        const res = await pullAutoSourcesFor(db, {
          appraisalId: String(b.appraisalId ?? ""),
          apply: b.apply === true,
        });
        return NextResponse.json(res);
      }
      case "previewImpact": {
        // STATELESS (D21): draf dari body — hasil tidak disimpan; hanya log ringan.
        const view = await getAssessmentView(db, String(b.appraisalId ?? ""));
        const kpis = (Array.isArray(b.kpis) ? b.kpis : view.kpis) as { polarity: string; thresholdMin: number | null; target: number; stretchValue: number | null; finalActual: number | null; weight: number; isCritical: boolean }[];
        const comps = (Array.isArray(b.comps) ? b.comps : view.comps.map((c) => ({ score: c.score || 3, weight: c.weight, kind: c.kind }))) as { score: number; weight: number; kind: string }[];
        const res = await previewImpactCompute(db, { kpis, comps, weightsJson: view.appraisal.cycle.weightsJson });
        return NextResponse.json(res);
      }
      case "aiCompose": {
        const res = await aiCompose(db, {
          appUserId: actor.appUserId ?? null,
          points: Array.isArray(b.points) ? b.points.map(String) : [],
          competencyName: b.competencyName != null ? String(b.competencyName) : undefined,
          contextLabel: b.contextLabel != null ? String(b.contextLabel) : undefined,
          tone: (["neutral", "encouraging", "firm"].includes(String(b.tone))) ? (b.tone as AiTone) : "neutral",
          length: b.length === "medium" ? "medium" : "short",
          lang: b.lang === "en" ? "en" : "id",
        });
        return NextResponse.json(res);
      }
      case "importActualsPreview": {
        if (!importFile) return NextResponse.json({ error: "File .xlsx wajib diunggah" }, { status: 400 });
        const name = importFile.name.toLowerCase();
        if (!name.endsWith(".xlsx")) return NextResponse.json({ error: "Hanya file .xlsx diterima (D16)" }, { status: 400 });
        const buffer = Buffer.from(await importFile.arrayBuffer());
        if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50 || buffer.readUInt16LE(2) !== 0x0403) {
          return NextResponse.json({ error: "File bukan .xlsx valid (magic number PK)" }, { status: 400 });
        }
        const raw = await parseActualsXlsx(buffer);
        const res = await validateActualRows(db, String(b.cycleId ?? ""), raw);
        return NextResponse.json(res);
      }
      case "importActualsCommit": {
        const res = await commitActualRows(db, String(b.cycleId ?? ""), Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]).map((r) => ({
          row: Number(r.row ?? 0),
          valid: r.valid === true,
          kpiId: r.kpiId != null ? String(r.kpiId) : null,
          finalActual: r.finalActual == null ? null : Number(r.finalActual),
        })) : [], actor.name);
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
