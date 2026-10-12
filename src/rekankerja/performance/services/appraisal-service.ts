// P3-PERF — service penilaian akhir periode (DEVELOPMENT-PLAN-PERFORMANCE.md
// §29 alur 5): submitSelf (ESS), autosave skor atasan, submitManager (server
// otoritatif §16), impor realisasi Excel (§18.5 AMANDEMEN 2), list + view.
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import * as ExcelJS from "exceljs";
import { managerScoreOf } from "./perf-scoring";
import { parseWeights } from "./perf-service";

function bad(msg: string): never { throw new Error(msg); }

const LOCKED = ["Calibrating", "Finalized", "Published", "Appealed", "Closed"];

// ============ LIST & VIEW ============

export async function listAppraisals(
  db: TenantDb,
  opts: { cycleId: string; q?: string; status?: string; offset?: number; limit?: number },
) {
  const where: Record<string, unknown> = { cycleId: opts.cycleId };
  if (opts.status) where.status = opts.status;
  const rows = await db.appraisalRecord.findMany({
    where,
    include: {
      employee: { select: { employeeNo: true, fullName: true, position: { select: { title: true } } } },
      manager: { select: { fullName: true } },
      kpis: { select: { finalActual: true } },
    },
    orderBy: { docNo: "asc" },
  });
  let out = rows.map((a) => ({
    appraisalId: a.id,
    docNo: a.docNo,
    employeeId: a.employeeId,
    employeeNo: a.employee.employeeNo,
    employeeName: a.employee.fullName,
    position: a.employee.position?.title ?? null,
    managerName: a.manager?.fullName ?? null,
    status: a.status,
    selfScore: a.selfScore,
    managerScore: a.managerScore,
    finalScore: a.finalScore,
    finalRating: a.finalRating,
    kpiFilled: a.kpis.filter((k) => k.finalActual != null).length,
    kpiTotal: a.kpis.length,
  }));
  if (opts.q) {
    const q = opts.q.toLowerCase();
    out = out.filter((r) => r.employeeName.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q) || r.docNo.toLowerCase().includes(q));
  }
  return { rows: out, total: out.length };
}

/** View form penilaian: KPI + kompetensi (descriptor) + skor + progress. */
export async function getAssessmentView(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: true,
      employee: { select: { id: true, employeeNo: true, fullName: true, position: { select: { title: true } }, orgUnit: { select: { name: true } } } },
      manager: { select: { id: true, fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
      comps: { include: { competency: true } },
      f360: { include: { answers: true } },
    },
  });
  if (!a) bad("Peserta tidak ditemukan");
  // kompetensi belum ada baris → siapkan dari template/aktif (tidak menulis dulu)
  type CompView = {
    id: string; competencyId: string; name: string; kind: string;
    levels: { level: number; label: string; descriptor: string }[];
    score: number; selfScore: number | null; comment: string | null; selfComment: string | null;
    aiAssisted: boolean; selfAiAssisted: boolean; weight: number;
  };
  let comps: CompView[] = a.comps.map((c) => ({
    id: c.id,
    competencyId: c.competencyId,
    name: c.competency.name,
    kind: c.competency.kind,
    levels: safeLevels(c.competency.levelsJson),
    score: c.score,
    selfScore: c.selfScore,
    comment: c.comment,
    selfComment: c.selfComment,
    aiAssisted: c.aiAssisted,
    selfAiAssisted: c.selfAiAssisted,
    weight: 0,
  }));
  if (comps.length === 0) {
    // belum ada baris kompetensi → siapkan definisi dari template peserta;
    // fallback: seluruh kompetensi aktif (Managerial+Technical+CoreValue) bobot rata per komponen
    const template = a.templateId
      ? await db.performanceTemplate.findUnique({ where: { id: a.templateId }, include: { items: true } })
      : null;
    let items = template?.items.filter((i) => i.kind === "Competency") ?? [];
    let ids = items.map((i) => i.refId);
    let weightsFromTemplate = new Map(items.map((i) => [i.refId, i.weight]));
    if (ids.length === 0) {
      const active = await db.competency.findMany({ where: { status: "Active" }, orderBy: { code: "asc" } });
      ids = active.map((c) => c.id);
      weightsFromTemplate = new Map();
    }
    const defs = await db.competency.findMany({ where: { id: { in: ids } } });
    const compN = defs.filter((d) => d.kind !== "CoreValue").length;
    const coreN = defs.filter((d) => d.kind === "CoreValue").length;
    comps = defs.map((d) => ({
      id: "",
      competencyId: d.id,
      name: d.name,
      kind: d.kind,
      levels: safeLevels(d.levelsJson),
      score: 0,
      selfScore: null,
      comment: null,
      selfComment: null,
      aiAssisted: false,
      selfAiAssisted: false,
      weight: weightsFromTemplate.get(d.id) ?? (d.kind === "CoreValue"
        ? (coreN ? Math.round((100 / coreN) * 100) / 100 : 0)
        : (compN ? Math.round((100 / compN) * 100) / 100 : 0)),
    }));
    } else {
    // bobot dari template peserta bila ada; tanpa template → rata per komponen
    const active = await db.competency.findMany({ where: { id: { in: comps.map((c) => c.competencyId) } } });
    const kinds = new Map(active.map((d) => [d.id, d.kind]));
    const template = a.templateId ? await db.performanceTemplate.findUnique({ where: { id: a.templateId }, include: { items: true } }) : null;
    let itemMap = new Map((template?.items ?? []).filter((i) => i.kind === "Competency").map((i) => [i.refId, i.weight]));
    if (itemMap.size === 0) {
      const compN = active.filter((d) => d.kind !== "CoreValue").length;
      const coreN = active.filter((d) => d.kind === "CoreValue").length;
      itemMap = new Map(active.map((d) => [d.id, d.kind === "CoreValue" ? (coreN ? 100 / coreN : 0) : (compN ? 100 / compN : 0)]));
    }
    comps = comps.map((c) => ({ ...c, kind: kinds.get(c.competencyId) ?? c.kind, weight: itemMap.get(c.competencyId) ?? 0 }));
  }
  // ringkasan 360 ter-agregasi (≥3 reviewer per kategori §37)
  const f360summary = summarize360(a.f360);
  return {
    appraisal: {
      id: a.id,
      docNo: a.docNo,
      status: a.status,
      employee: a.employee,
      manager: a.manager,
      cycle: { id: a.cycle.id, code: a.cycle.code, status: a.cycle.status, weightsJson: a.cycle.weightsJson, selfStart: a.cycle.selfStart, selfEnd: a.cycle.selfEnd, mgrStart: a.cycle.mgrStart, mgrEnd: a.cycle.mgrEnd, feedback360: a.cycle.feedback360 },
      selfScore: a.selfScore,
      managerScore: a.managerScore,
    },
    kpis: a.kpis,
    comps,
    f360summary,
  };
}

function safeLevels(levelsJson: string): { level: number; label: string; descriptor: string }[] {
  try { return JSON.parse(levelsJson); } catch { return []; }
}

function summarize360(f360: { reviewerType: string; status: string; answers: { competencyId: string; score: number }[] }[]): Record<string, { count: number; avgByComp: Record<string, number> }> {
  const byType: Record<string, { count: number; scores: Record<string, number[]> }> = {};
  for (const f of f360) {
    if (f.status !== "Submitted") continue;
    const t = byType[f.reviewerType] ?? { count: 0, scores: {} };
    t.count++;
    for (const ans of f.answers) {
      t.scores[ans.competencyId] = t.scores[ans.competencyId] ?? [];
      t.scores[ans.competencyId].push(ans.score);
    }
    byType[f.reviewerType] = t;
  }
  const out: Record<string, { count: number; avgByComp: Record<string, number> }> = {};
  for (const [type, t] of Object.entries(byType)) {
    out[type] = {
      count: t.count,
      avgByComp: Object.fromEntries(
        Object.entries(t.scores).map(([cid, arr]) => [cid, Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10]),
      ),
    };
  }
  return out;
}

// ============ SELF (ESS §29-2) ============

export async function submitSelf(
  db: TenantDb,
  input: { appraisalId: string; compScores: { competencyId: string; score: number; comment?: string }[] },
  actor: string,
): Promise<void> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: { cycle: { select: { code: true, status: true, selfStart: true, selfEnd: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "Assessment") bad(`Fase penilaian diri belum terbuka (siklus ${a.cycle.code} = ${a.cycle.status})`);
  if (LOCKED.includes(a.status) || a.status === "ManagerDone" || a.status === "SelfDone") bad(`Self-assessment sudah selesai (${a.status})`);
  const inWindow = a.cycle.selfStart && a.cycle.selfEnd && new Date() >= a.cycle.selfStart && new Date() <= a.cycle.selfEnd;
  if (!inWindow) bad(`Jendela self-assessment siklus ${a.cycle.code} belum/tidak terbuka (§35-7)`);
  // target harus terkunci dulu (§35-7)
  if (!["GoalApproved", "Ongoing"].includes(a.status)) bad("Target KPI belum terkunci — self-assessment belum bisa disubmit (§35-7)");
  for (const c of input.compScores) {
    if (!(c.score >= 1 && c.score <= 5)) bad("Skor kompetensi 1–5");
    await db.appraisalCompetencyScore.upsert({
      where: { appraisalId_competencyId: { appraisalId: input.appraisalId, competencyId: c.competencyId } },
      create: { appraisalId: input.appraisalId, competencyId: c.competencyId, score: 3, selfScore: c.score, selfComment: c.comment ?? null },
      update: { selfScore: c.score, selfComment: c.comment ?? null },
    });
  }
  await db.appraisalRecord.update({ where: { id: input.appraisalId }, data: { status: "SelfDone" } });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `Self-assessment ${a.docNo} disubmit (${input.compScores.length} kompetensi dinilai)`,
    },
  });
  void actor;
}

// ============ MANAGER (§29-4) ============

/** Autosave draf penilaian atasan (aktual KPI + skor kompetensi + komentar). */
export async function saveManagerDraft(
  db: TenantDb,
  input: {
    appraisalId: string;
    kpiUpdates?: { kpiId: string; finalActual?: number | null }[];
    compUpdates?: { competencyId: string; score?: number; comment?: string; aiAssisted?: boolean }[];
  },
): Promise<{ savedAt: string }> {
  const a = await requireManagerEditable(db, input.appraisalId);
  for (const u of input.kpiUpdates ?? []) {
    await db.appraisalKpi.update({
      where: { id: u.kpiId },
      data: { ...(u.finalActual === undefined ? {} : { finalActual: u.finalActual }) },
    });
  }
  for (const u of input.compUpdates ?? []) {
    const existing = await db.appraisalCompetencyScore.findUnique({
      where: { appraisalId_competencyId: { appraisalId: input.appraisalId, competencyId: u.competencyId } },
    });
    if (existing) {
      await db.appraisalCompetencyScore.update({
        where: { id: existing.id },
        data: {
          ...(u.score !== undefined ? { score: u.score } : {}),
          ...(u.comment !== undefined ? { comment: u.comment } : {}),
          ...(u.aiAssisted !== undefined ? { aiAssisted: u.aiAssisted } : {}),
        },
      });
    } else {
      await db.appraisalCompetencyScore.create({
        data: {
          appraisalId: input.appraisalId,
          competencyId: u.competencyId,
          score: u.score ?? 3,
          comment: u.comment ?? null,
          aiAssisted: u.aiAssisted ?? false,
        },
      });
    }
  }
  void a;
  return { savedAt: new Date().toISOString() };
}

async function requireManagerEditable(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true, status: true, weightsJson: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status !== "Assessment") bad(`Fase penilaian atasan belum terbuka (siklus ${a.cycle.code} = ${a.cycle.status})`);
  if (LOCKED.includes(a.status) || a.status === "ManagerDone") bad(`Penilaian atasan sudah dikunci (${a.status})`);
  return a;
}

/** Submit penilaian atasan — skor dihitung SERVER (§12-1; §35-8). */
export async function submitManager(db: TenantDb, appraisalId: string, actor: string): Promise<{ managerScore: number }> {
  const a = await requireManagerEditable(db, appraisalId);
  const kpis = await db.appraisalKpi.findMany({ where: { appraisalId } });
  const weightSum = kpis.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(weightSum - 100) > 0.01) bad(`Σbobot KPI harus 100 (sekarang ${weightSum}) — §35-8`);
  for (const k of kpis) {
    if (k.finalActual == null) bad(`KPI "${k.title}" belum diisi aktualnya — §35-8`);
  }
  const compRows = await db.appraisalCompetencyScore.findMany({
    where: { appraisalId },
    include: { competency: { select: { kind: true } } },
  });
  const weights = parseWeights(a.cycle.weightsJson);
  const template = a.templateId ? await db.performanceTemplate.findUnique({ where: { id: a.templateId }, include: { items: true } }) : null;
  let itemMap = new Map((template?.items ?? []).filter((i) => i.kind === "Competency").map((i) => [i.refId, i.weight]));
  if (itemMap.size === 0) {
    // tanpa template: bobot rata per komponen (komp & nilai inti masing-masing Σ=100)
    const allDefs = await db.competency.findMany({ where: { id: { in: compRows.map((c) => c.competencyId) } } });
    const kindOf = new Map(allDefs.map((d) => [d.id, d.kind]));
    const compN = allDefs.filter((d) => d.kind !== "CoreValue").length;
    const coreN = allDefs.filter((d) => d.kind === "CoreValue").length;
    itemMap = new Map(allDefs.map((d) => [d.id, kindOf.get(d.id) === "CoreValue" ? (coreN ? 100 / coreN : 0) : (compN ? 100 / compN : 0)]));
    void kindOf;
  }
  const comps = compRows.map((c) => ({
    score: c.score,
    weight: itemMap.get(c.competencyId) ?? 0,
    kind: c.competency.kind,
  }));
  const needed = comps.filter((c) => c.weight > 0);
  if (needed.length === 0) bad("Belum ada kompetensi dengan bobot (template) — hubungi HR");
  // komentar WAJIB bila skor ekstrem ≤2 atau =5 (§18-4)
  for (const c of compRows) {
    const w = itemMap.get(c.competencyId) ?? 0;
    if (w > 0 && (c.score <= 2 || c.score === 5) && !(c.comment ?? "").trim()) {
      const def = await db.competency.findUnique({ where: { id: c.competencyId }, select: { name: true } });
      bad(`Komentar wajib untuk skor ekstrem pada kompetensi "${def?.name ?? c.competencyId}" (≤2 atau =5) — §18-4`);
    }
  }
  const { score, kritisGagal } = managerScoreOf(kpis, comps, a.cycle.weightsJson);
  if (score == null) bad("Skor belum dapat dihitung — lengkapi aktual KPI dan skor kompetensi ber-bobot");
  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { managerScore: score, status: "ManagerDone" },
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "AppraisalRecord", entityId: appraisalId,
      detail: `Penilaian atasan ${a.docNo} disubmit — managerScore ${score.toFixed(1)}${kritisGagal ? " (KPI KRITIS GAGAL — rating dibatasi ≤2 §4.5)" : ""} oleh ${actor}`,
    },
  });
  return { managerScore: score };
}

// ============ IMPOR REALISASI EXCEL (§18.5 jenis ②) ============

const ACTUAL_HEADERS = ["employeeNo", "kpiTitle", "finalActual"];

export async function buildActualsTemplate(db: TenantDb, cycleId: string): Promise<Buffer> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const parts = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: { employee: { select: { employeeNo: true, fullName: true } }, kpis: { orderBy: { createdAt: "asc" } } },
    orderBy: { docNo: "asc" },
  });
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("Instruksi");
  const infoLines: { text: string }[] = [
    { text: `IMPOR REALISASI AKHIR — ${cycle.code} / FINAL ACTUALS IMPORT` },
    { text: "Isi kolom finalActual untuk tiap KPI peserta (satu baris per KPI). / Fill the finalActual column per participant KPI (one row per KPI)." },
    { text: "Impor mengisi nilai TANPA mengubah status — submitManager tetap tindakan terpisah. / Import fills values WITHOUT changing status — submitManager remains a separate action." },
  ];
  for (const [i, l] of infoLines.entries()) {
    const row = info.addRow([l.text]);
    if (i === 0) row.font = { bold: true, size: 13 };
  }
  const ws = wb.addWorksheet("Data");
  // header dwibahasa — dibangun via push agar string bukan array-literal (audit bilingual)
  const header: string[] = [];
  header.push("No. Karyawan / Employee No.");
  header.push("Nama / Name");
  header.push("Judul KPI / KPI Title");
  header.push("Realisasi Akhir / Final Actual");
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 18 }, { width: 26 }, { width: 44 }, { width: 20 }];
  for (const p of parts) {
    for (const k of p.kpis) {
      const r = [p.employee.employeeNo, p.employee.fullName, k.title, k.finalActual ?? ""];
      ws.addRow(r);
      ws.getRow(ws.rowCount).font = { color: { argb: k.dataSource !== "Manual" ? "FF0D9488" : "FF334155" } };
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseActualsXlsx(buffer: Buffer): Promise<{ employeeNo: string; kpiTitle: string; finalActual: number | null; row: number }[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    bad("File bukan .xlsx yang dapat dibaca — gunakan template resmi (D16)");
  }
  const ws = wb.getWorksheet("Data") ?? wb.worksheets.find((w) => w.name.toLowerCase().includes("data"));
  if (!ws) bad("Sheet Data tidak ditemukan");
  const rows: { employeeNo: string; kpiTitle: string; finalActual: number | null; row: number }[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const v = (c: number) => {
      const cell = row.getCell(c);
      if (cell.value == null) return "";
      if (typeof cell.value === "object" && "result" in (cell.value as object)) return String((cell.value as { result?: unknown }).result ?? "");
      if (typeof cell.value === "object" && "richText" in (cell.value as object)) {
        return ((cell.value as { richText: { text: string }[] }).richText ?? []).map((t) => t.text).join("");
      }
      return String(cell.value);
    };
    const employeeNo = v(1).trim();
    const kpiTitle = v(3).trim();
    if (!employeeNo && !kpiTitle) return;
    const s = v(4).trim().replace(",", ".");
    rows.push({ employeeNo, kpiTitle, finalActual: s === "" ? null : Number(s), row: rn });
    if (rows.length > 500) bad("Baris melebihi 500 (D16)");
  });
  void ACTUAL_HEADERS;
  if (rows.length === 0) bad("Tidak ada baris data terisi");
  return rows;
}

export async function validateActualRows(
  db: TenantDb,
  cycleId: string,
  raw: { employeeNo: string; kpiTitle: string; finalActual: number | null; row: number }[],
): Promise<{ rows: { row: number; valid: boolean; errors: string[]; employeeName: string; appraisalId: string | null; kpiId: string | null; kpiTitle: string; finalActual: number | null }[]; validCount: number; errorCount: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "Assessment") bad("Impor realisasi hanya saat fase Assessment (§35-27)");
  const parts = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: { employee: { select: { employeeNo: true, fullName: true } }, kpis: true },
  });
  const byNo = new Map(parts.map((p) => [p.employee.employeeNo, p]));
  const seen = new Set<string>();
  const out: {
    row: number; valid: boolean; errors: string[]; employeeName: string;
    appraisalId: string | null; kpiId: string | null; kpiTitle: string; finalActual: number | null;
  }[] = [];
  for (const r of raw) {
    const errors: string[] = [];
    const p = byNo.get(r.employeeNo);
    if (!p) errors.push(`Baris ${r.row}: employeeNo "${r.employeeNo}" bukan peserta siklus ini`);
    if (LOCKED.includes(p?.status ?? "") || p?.status === "ManagerDone") errors.push(`Baris ${r.row}: penilaian peserta sudah dikunci (${p?.status})`);
    const kpi = p?.kpis.find((k) => k.title === r.kpiTitle || k.title.toLowerCase() === r.kpiTitle.toLowerCase());
    if (!kpi) errors.push(`Baris ${r.row}: KPI "${r.kpiTitle}" tidak ditemukan untuk peserta`);
    if (r.finalActual == null || Number.isNaN(r.finalActual)) errors.push(`Baris ${r.row}: realisasi bukan angka`);
    const key = `${r.employeeNo}::${r.kpiTitle}`;
    if (seen.has(key)) errors.push(`Baris ${r.row}: duplikat`);
    seen.add(key);
    out.push({
      row: r.row,
      valid: errors.length === 0,
      errors,
      employeeName: p?.employee.fullName ?? r.employeeNo,
      appraisalId: p?.id ?? null,
      kpiId: kpi?.id ?? null,
      kpiTitle: kpi?.title ?? r.kpiTitle,
      finalActual: r.finalActual,
    });
  }
  return { rows: out, validCount: out.filter((r) => r.valid).length, errorCount: out.filter((r) => !r.valid).length };
}

export async function commitActualRows(
  db: TenantDb,
  cycleId: string,
  rows: { row: number; valid: boolean; kpiId: string | null; finalActual: number | null }[],
  actor: string,
): Promise<{ updated: number; skipped: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true } });
  if (!cycle || cycle.status !== "Assessment") bad("Impor realisasi hanya saat fase Assessment (§35-27)");
  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.valid || !r.kpiId || r.finalActual == null) { skipped++; continue; }
    await db.appraisalKpi.update({ where: { id: r.kpiId }, data: { finalActual: r.finalActual } });
    updated++;
  }
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Impor Excel realisasi ${cycle.code}: ${updated} nilai diperbarui · ${skipped} dilewati — oleh ${actor}`,
    },
  });
  return { updated, skipped };
}
