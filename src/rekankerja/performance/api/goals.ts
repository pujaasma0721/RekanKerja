import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import {
  listParticipants, getGoalsDetail, assignBatch, saveKpiRow, addKpiRow, deleteKpiRow,
  submitGoals, proposeGoals, decideProposal, copySources, copyPreview, copyFromCycle, resolveSource,
} from "@/rekankerja/performance/services/goals-service";
import { buildTargetsTemplate, parseTargetsXlsx, validateTargetRows, commitTargetRows } from "@/rekankerja/performance/services/perf-excel";
import { xlsxResponse } from "@/rekankerja/shared/lib/export";

// ============================================================================
// PERFORMANCE — API target & KPI (P1 — §17; §18.1 builder, §18.2 salin, §18.5
// impor Excel AMANDEMEN 2).
//   GET  ?cycleId&q&managerId&onlyWithoutKpi        → { rows, total } (peserta)
//   GET  ?appraisalId=…                            → detail builder (KPI rows)
//   GET  ?cycleId&copySources=1                    → daftar siklus sumber §18.2
//   GET  ?cycleId&employeeId&sources=1             → resolusi sumber peserta (D15)
//   GET  ?importTemplate=targets&cycleId=…         → unduh .xlsx (§18.5)
//   POST  {action:assignBatch}                      → ganti draf baris (builder)
//   POST  {action:saveRow}                         → autosave 1 baris draf (§18.7)
//   POST  {action:addRow|deleteRow}
//   POST  {action:submit|lockGoals}                 → kunci target (§35-3)
//   POST  {action:propose}                          → usulan MBO karyawan (ESS)
//   POST  {action:decideProposal}                   → setuju/tolak/ambil alih
//   POST  {action:copyPreview|copyFromCycle}       → salin periode lalu (§18.2)
//   POST  {action:importPreview|importCommit}       → impor Excel (§18.5, D16)
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:goals", "performance:cycles", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const sp = req.nextUrl.searchParams;

    // unduh template Excel target (§18.5)
    if (sp.get("importTemplate") === "targets") {
      const cycleId = sp.get("cycleId") ?? "";
      const buf = await buildTargetsTemplate(db, cycleId);
      return xlsxResponse(buf, `template_target_kpi.xlsx`);
    }

    const cycleId = sp.get("cycleId") ?? "";

    if (sp.get("copySources") === "1") {
      const res = await copySources(db, cycleId);
      return NextResponse.json(res);
    }
    if (sp.get("sources") === "1") {
      const employeeId = sp.get("employeeId") ?? "";
      const res = await resolveSource(db, cycleId, employeeId);
      return NextResponse.json({ sources: res });
    }
    const appraisalId = sp.get("appraisalId");
    if (appraisalId) {
      const detail = await getGoalsDetail(db, appraisalId);
      return NextResponse.json({ detail });
    }
    const res = await listParticipants(db, {
      cycleId,
      q: sp.get("q") ?? undefined,
      managerId: sp.get("managerId") ?? undefined,
      onlyWithoutKpi: sp.get("onlyWithoutKpi") === "1",
      limit: Number(sp.get("limit") ?? 200),
      offset: Number(sp.get("offset") ?? 0),
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    let b: Record<string, unknown>;
    const contentType = req.headers.get("content-type") ?? "";
    let importFile: File | null = null;
    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      const obj: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) {
        if (v instanceof File) importFile = v;
        else obj[k] = v;
      }
      // field JSON dalam formData
      for (const key of ["items", "kpis", "channels", "rows"]) {
        if (typeof obj[key] === "string") {
          try { obj[key] = JSON.parse(obj[key] as string); } catch { /* biarkan */ }
        }
      }
      b = obj;
    } else {
      b = await req.json();
    }
    const action = String(b.action ?? "");
    // guard: impor = op khusus; salin/submit = update; propose = dari ESS (self-scope di route ess)
    const op = action === "importPreview" || action === "importCommit" ? "op:import"
      : action === "copyPreview" || action === "copyFromCycle" ? "op:copy"
      : "update";
    const m = await requireMenuAction(req, "performance:goals", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const actor = m.actor.name;

    switch (action) {
      case "assignBatch": {
        const res = await assignBatch(db, {
          appraisalId: String(b.appraisalId ?? ""),
          kpis: Array.isArray(b.kpis) ? (b.kpis as Record<string, unknown>[]).map((k) => ({
            id: k.id != null ? String(k.id) : undefined,
            kpiDefId: k.kpiDefId != null ? String(k.kpiDefId) : null,
            title: String(k.title ?? ""),
            polarity: String(k.polarity ?? "Higher"),
            unit: String(k.unit ?? ""),
            thresholdMin: k.thresholdMin == null || k.thresholdMin === "" ? null : Number(k.thresholdMin),
            target: Number(k.target ?? 0),
            stretchValue: k.stretchValue == null || k.stretchValue === "" ? null : Number(k.stretchValue),
            weight: Number(k.weight ?? 0),
            isCritical: k.isCritical === true,
            dataSource: k.dataSource != null ? String(k.dataSource) : "Manual",
            sourceKey: k.sourceKey != null ? String(k.sourceKey) : null,
          })) : [],
        }, actor);
        return NextResponse.json(res);
      }
      case "saveRow": {
        await saveKpiRow(db, {
          kpiId: String(b.kpiId ?? ""),
          patch: {
            title: b.title != null ? String(b.title) : undefined,
            polarity: b.polarity != null ? String(b.polarity) : undefined,
            unit: b.unit != null ? String(b.unit) : undefined,
            thresholdMin: b.thresholdMin === undefined ? undefined : (b.thresholdMin == null || b.thresholdMin === "" ? null : Number(b.thresholdMin)),
            target: b.target === undefined ? undefined : (b.target == null || b.target === "" ? 0 : Number(b.target)),
            stretchValue: b.stretchValue === undefined ? undefined : (b.stretchValue == null || b.stretchValue === "" ? null : Number(b.stretchValue)),
            weight: b.weight === undefined ? undefined : (b.weight == null || b.weight === "" ? 0 : Number(b.weight)),
            isCritical: b.isCritical === undefined ? undefined : b.isCritical === true,
          },
        });
        return NextResponse.json({ ok: true, savedAt: new Date().toISOString() });
      }
      case "addRow": {
        const id = await addKpiRow(db, {
          appraisalId: String(b.appraisalId ?? ""),
          kpi: {
            kpiDefId: b.kpiDefId != null ? String(b.kpiDefId) : null,
            title: String(b.title ?? ""),
            polarity: String(b.polarity ?? "Higher"),
            unit: String(b.unit ?? ""),
            thresholdMin: b.thresholdMin == null || b.thresholdMin === "" ? null : Number(b.thresholdMin),
            target: Number(b.target ?? 0),
            stretchValue: b.stretchValue == null || b.stretchValue === "" ? null : Number(b.stretchValue),
            weight: Number(b.weight ?? 0),
            isCritical: b.isCritical === true,
            dataSource: b.dataSource != null ? String(b.dataSource) : "Manual",
            sourceKey: b.sourceKey != null ? String(b.sourceKey) : null,
          },
        });
        return NextResponse.json({ id }, { status: 201 });
      }
      case "deleteRow": {
        await deleteKpiRow(db, String(b.kpiId ?? ""));
        return NextResponse.json({ ok: true });
      }
      case "submit":
      case "lockGoals": {
        await submitGoals(db, String(b.appraisalId ?? ""), actor);
        return NextResponse.json({ ok: true });
      }
      case "propose": {
        await proposeGoals(db, {
          appraisalId: String(b.appraisalId ?? ""),
          kpis: Array.isArray(b.kpis) ? (b.kpis as Record<string, unknown>[]).map((k) => ({
            kpiDefId: k.kpiDefId != null ? String(k.kpiDefId) : null,
            title: String(k.title ?? ""),
            polarity: String(k.polarity ?? "Higher"),
            unit: String(k.unit ?? ""),
            thresholdMin: k.thresholdMin == null || k.thresholdMin === "" ? null : Number(k.thresholdMin),
            target: Number(k.target ?? 0),
            stretchValue: k.stretchValue == null || k.stretchValue === "" ? null : Number(k.stretchValue),
            weight: Number(k.weight ?? 0),
            isCritical: k.isCritical === true,
            dataSource: "Manual",
            sourceKey: null,
          })) : [],
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "decideProposal": {
        await decideProposal(db, {
          appraisalId: String(b.appraisalId ?? ""),
          decision: b.decision === "approve" || b.decision === "reject" || b.decision === "edit" ? b.decision : bad2(),
        }, actor);
        return NextResponse.json({ ok: true });
      }
      case "copyPreview": {
        const res = await copyPreview(db, {
          cycleId: String(b.cycleId ?? ""),
          employeeId: String(b.employeeId ?? ""),
          sourceCycleId: b.sourceCycleId ? String(b.sourceCycleId) : undefined,
        });
        return NextResponse.json(res);
      }
      case "copyFromCycle": {
        const res = await copyFromCycle(db, {
          cycleId: String(b.cycleId ?? ""),
          employeeId: String(b.employeeId ?? ""),
          sourceCycleId: String(b.sourceCycleId ?? ""),
          items: Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).map((i) => ({
            sourceKpiId: String(i.sourceKpiId ?? ""),
            target: i.target == null ? undefined : Number(i.target),
          })) : [],
          mode: b.mode === "replace" ? "replace" : "merge",
        }, actor);
        return NextResponse.json(res);
      }
      case "importPreview": {
        if (!importFile) return NextResponse.json({ error: "File .xlsx wajib diunggah" }, { status: 400 });
        // MIME whitelist + magic number (pola attachment — D16)
        const name = importFile.name.toLowerCase();
        if (!name.endsWith(".xlsx")) return NextResponse.json({ error: "Hanya file .xlsx diterima (D16)" }, { status: 400 });
        const buffer = Buffer.from(await importFile.arrayBuffer());
        if (buffer.length < 4 || buffer.readUInt16LE(0) !== 0x4b50 || buffer.readUInt16LE(2) !== 0x0403) {
          return NextResponse.json({ error: "File bukan .xlsx valid (magic number PK)" }, { status: 400 });
        }
        const raw = await parseTargetsXlsx(buffer);
        const res = await validateTargetRows(db, String(b.cycleId ?? ""), raw);
        return NextResponse.json(res);
      }
      case "importCommit": {
        const rows = Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]).map((r) => ({
          row: Number(r.row ?? 0),
          valid: r.valid === true,
          errors: Array.isArray(r.errors) ? r.errors.map(String) : [],
          employeeNo: String(r.employeeNo ?? ""),
          employeeName: String(r.employeeName ?? ""),
          appraisalId: r.appraisalId != null ? String(r.appraisalId) : null,
          kpiDefId: r.kpiDefId != null ? String(r.kpiDefId) : null,
          title: String(r.title ?? ""),
          polarity: String(r.polarity ?? "Higher"),
          unit: String(r.unit ?? ""),
          thresholdMin: r.thresholdMin == null ? null : Number(r.thresholdMin),
          target: r.target == null ? null : Number(r.target),
          stretchValue: r.stretchValue == null ? null : Number(r.stretchValue),
          weight: r.weight == null ? null : Number(r.weight),
          isCritical: r.isCritical === true,
        })) : [];
        const res = await commitTargetRows(db, String(b.cycleId ?? ""), rows, actor);
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

function bad2(): never { throw new Error("Keputusan usulan tidak dikenal (approve/reject/edit)"); }
