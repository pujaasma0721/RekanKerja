// ============================================================================
// RECRUITMENT F3 — Scorecard terstruktur (HRX D2 — DEVELOPMENT-PLAN-RECRUITMENT
// .md §7 F3 + §4.3): template rubrik kompetensi 1–5 anchored per tahap +
// pengisian per evaluator + agregat panel & flag divergensi >2 poin.
//
// Aturan (HRX D2):
//   · ScorecardTemplate terikat tahap (selectionProcessId) — template umum
//     (null) boleh dipakai tahap mana pun saat mengisi.
//   · Feedback (overallComment) WAJIB sebelum tahap bisa naik — gate di
//     scorecardGateOk() dipanggil selection-service saat pass/advance.
//   · Divergensi panel: selisih skor rata-rata tertimbang antar evaluator
//     >2 poin → flag kalibrasi — DIHITUNG SAAT BACA (bukan disimpan).
//   · Kompetensi 1–5 anchored (anchorsJson) — default label bila kosong.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { Prisma } from "@/generated/tenant";

// ============ konstanta domain ============

export const SCORECARD_RECOMMENDATIONS = ["StrongHire", "Hire", "NoHire", "StrongNoHire"] as const;
export type ScorecardRecommendation = (typeof SCORECARD_RECOMMENDATIONS)[number];

/** Anchor rubrik default 1–5 (dipakai bila anchorsJson kompetensi kosong). */
export const DEFAULT_ANCHORS: { value: number; label: string; guide: string }[] = [
  { value: 1, label: "Jauh di bawah ekspektasi", guide: "Tidak memenuhi sama sekali; butuh pengembangan besar." },
  { value: 2, label: "Di bawah ekspektasi", guide: "Memenuhi sebagian kecil; ada gap signifikan." },
  { value: 3, label: "Memenuhi ekspektasi", guide: "Sesuai standar posisi." },
  { value: 4, label: "Di atas ekspektasi", guide: "Konsisten melampaui standar." },
  { value: 5, label: "Jauh di atas ekspektasi", guide: "Istimewa; level terbaik yang pernah diamati." },
];

/** Ambang divergensi panel (HRX D2: selisih >2 poin → flag kalibrasi). */
export const DIVERGENCE_THRESHOLD = 2;

// ============ tipe serializer ============

export interface CompetencyRow {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  orderNo: number;
  anchors: { value: number; label: string; guide: string }[];
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  selectionProcessId: string | null;
  stageName: string | null;
  active: boolean;
  usedCount: number;
  competencies: CompetencyRow[];
}

export interface ScorecardItemRow {
  competencyId: string;
  name: string;
  weight: number;
  score: number; // 1–5
  comment: string | null;
}

export interface ScorecardRow {
  id: string;
  evaluatorId: string;
  evaluatorName: string;
  evaluatorNo: string | null;
  templateId: string;
  templateName: string;
  submittedAt: string | null;
  recommendation: string | null;
  overallComment: string | null;
  /** Σ(score×weight)/Σweight — null bila belum ada item skor. */
  weightedScore: number | null;
  items: ScorecardItemRow[];
}

export interface PanelResult {
  scorecards: ScorecardRow[];
  /** skor rata-rata tertimbang antar evaluator TERKUMPUL. */
  panelAvg: number | null;
  /** max − min skor evaluator > 2 → flag kalibrasi (HRX D2). */
  divergence: boolean;
  divergenceGap: number;
  /** true bila ≥1 scorecard ter-SUBMIT dengan feedback terisi (gate naik tahap). */
  feedbackOk: boolean;
}

// ============ helper ============

function parseAnchors(json: string | null): { value: number; label: string; guide: string }[] {
  if (!json) return DEFAULT_ANCHORS;
  try {
    const arr = JSON.parse(json) as { value?: unknown; label?: unknown; guide?: unknown }[];
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_ANCHORS;
    return arr
      .filter((a) => Number(a.value) >= 1 && Number(a.value) <= 5)
      .map((a) => ({ value: Number(a.value), label: String(a.label ?? ""), guide: String(a.guide ?? "") }));
  } catch {
    return DEFAULT_ANCHORS;
  }
}

function weightedScoreOf(items: { score: number; weight: number }[]): number | null {
  if (items.length === 0) return null;
  const wSum = items.reduce((s, i) => s + i.weight, 0);
  if (wSum <= 0) return null;
  return items.reduce((s, i) => s + i.score * i.weight, 0) / wSum;
}

const TEMPLATE_INCLUDE = {
  selectionProcess: { select: { name: true } },
  competencies: { orderBy: [{ orderNo: "asc" as const }] },
} satisfies Prisma.ScorecardTemplateInclude;

function templateRow(
  t: Prisma.ScorecardTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>,
  usedCount: number,
): TemplateRow {
  return {
    id: t.id, name: t.name, description: t.description,
    selectionProcessId: t.selectionProcessId, stageName: t.selectionProcess?.name ?? null,
    active: t.active, usedCount,
    competencies: t.competencies.map((c) => ({
      id: c.id, name: c.name, description: c.description, weight: c.weight, orderNo: c.orderNo,
      anchors: parseAnchors(c.anchorsJson),
    })),
  };
}

// ============ katalog template ============

export async function listTemplates(db: TenantDb): Promise<TemplateRow[]> {
  const templates = await db.scorecardTemplate.findMany({
    include: TEMPLATE_INCLUDE,
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const used = await db.candidateScorecard.groupBy({
    by: ["templateId"], _count: { _all: true },
  });
  const usedMap = new Map(used.map((u) => [u.templateId, u._count._all]));
  return templates.map((t) => templateRow(t, usedMap.get(t.id) ?? 0));
}

export interface CompetencyInput {
  name: string;
  description?: string | null;
  weight?: number | null;
  orderNo?: number | null;
  anchors?: { value: number; label: string; guide: string }[] | null;
}

export interface TemplateInput {
  id?: string | null; // null = create
  name: string;
  selectionProcessId?: string | null;
  description?: string | null;
  active?: boolean;
  competencies: CompetencyInput[];
}

/** Buat/perbarui template + rubrik (kompetensi diganti penuh saat update). */
export async function upsertTemplate(db: TenantDb, input: TemplateInput, actorName?: string | null): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("Nama template scorecard wajib diisi");
  const comps = (input.competencies ?? []).filter((c) => c.name?.trim());
  if (comps.length === 0) throw new Error("Minimal satu kompetensi rubrik diperlukan");

  const data = {
    name,
    description: input.description?.trim() || null,
    selectionProcessId: input.selectionProcessId || null,
    active: input.active ?? true,
  };

  let templateId: string;
  if (input.id) {
    const existing = await db.scorecardTemplate.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("Template scorecard tidak ditemukan");
    await db.scorecardTemplate.update({ where: { id: input.id }, data });
    templateId = input.id;
    // rubrik diganti penuh (pola replace — konsisten updateApplicant)
    await db.scorecardCompetency.deleteMany({ where: { templateId } });
  } else {
    const created = await db.scorecardTemplate.create({ data });
    templateId = created.id;
  }

  let order = 1;
  for (const c of comps) {
    await db.scorecardCompetency.create({
      data: {
        templateId,
        name: c.name.trim(),
        description: c.description?.trim() || null,
        weight: c.weight != null && c.weight > 0 ? Number(c.weight) : 1,
        orderNo: c.orderNo ?? order,
        anchorsJson: c.anchors && c.anchors.length > 0 ? JSON.stringify(c.anchors) : null,
      },
    });
    order++;
  }

  await db.activityLog.create({
    data: {
      action: input.id ? "Updated" : "Created", entity: "ScorecardTemplate", entityId: name,
      detail: `${input.id ? "Template scorecard" : "Template scorecard baru"} "${name}" (${comps.length} kompetensi)${input.selectionProcessId ? " — terikat tahap seleksi" : ""}${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return templateId;
}

/** Nonaktifkan template (soft — dipakai scorecard tetap utuh utk audit). */
export async function deactivateTemplate(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const t = await db.scorecardTemplate.findUnique({ where: { id } });
  if (!t) throw new Error("Template scorecard tidak ditemukan");
  await db.scorecardTemplate.update({ where: { id }, data: { active: false } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "ScorecardTemplate", entityId: t.name,
      detail: `Template scorecard "${t.name}" dinonaktifkan${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

// ============ pengisian scorecard ============

const SCORECARD_INCLUDE = {
  evaluator: { select: { fullName: true, employeeNo: true } },
  template: { select: { name: true } },
  items: { include: { competency: { select: { name: true, weight: true } } } },
} satisfies Prisma.CandidateScorecardInclude;

function scorecardRow(s: Prisma.CandidateScorecardGetPayload<{ include: typeof SCORECARD_INCLUDE }>): ScorecardRow {
  const items = s.items.map((i) => ({
    competencyId: i.competencyId, name: i.competency.name, weight: i.competency.weight,
    score: i.score, comment: i.comment,
  }));
  return {
    id: s.id,
    evaluatorId: s.evaluatorId,
    evaluatorName: s.evaluator.fullName,
    evaluatorNo: s.evaluator.employeeNo,
    templateId: s.templateId,
    templateName: s.template.name,
    submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
    recommendation: s.recommendation,
    overallComment: s.overallComment,
    weightedScore: weightedScoreOf(items),
    items,
  };
}

/** Panel scorecard satu tahap (agregat + divergensi — dihitung saat baca). */
export async function getStepScorecards(db: TenantDb, selectionStepId: string): Promise<PanelResult> {
  const rows = await db.candidateScorecard.findMany({
    where: { selectionStepId },
    include: SCORECARD_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  const scorecards = rows.map(scorecardRow);
  const submitted = scorecards.filter((s) => s.submittedAt != null && s.weightedScore != null);
  const scores = submitted.map((s) => s.weightedScore as number);
  const panelAvg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const gap = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : 0;
  return {
    scorecards,
    panelAvg,
    divergence: gap > DIVERGENCE_THRESHOLD,
    divergenceGap: Number(gap.toFixed(2)),
    feedbackOk: scorecards.some((s) => s.submittedAt != null && !!s.overallComment?.trim()),
  };
}

export interface ScorecardItemInput {
  competencyId: string;
  score: number; // 1–5
  comment?: string | null;
}

export interface ScorecardSaveInput {
  selectionStepId: string;
  evaluatorId: string; // Employee
  templateId: string;
  items: ScorecardItemInput[];
  recommendation?: string | null;
  overallComment?: string | null;
  /** true = submit final (feedback wajib + semua kompetensi terisi). */
  submit: boolean;
}

/**
 * Simpan/draf scorecard per (tahap × evaluator) — upsert. Submit memaksa:
 * semua kompetensi template terisi skor 1–5 + overallComment (feedback wajib
 * HRX D2) + rekomendasi.
 */
export async function saveScorecard(db: TenantDb, input: ScorecardSaveInput, actorName?: string | null): Promise<{ id: string; submitted: boolean }> {
  const step = await db.candidateSelectionStep.findUnique({
    where: { id: input.selectionStepId },
    select: { id: true, status: true, candidate: { select: { id: true, fullName: true } }, selectionProcess: { select: { name: true } } },
  });
  if (!step) throw new Error("Tahap seleksi tidak ditemukan");
  if (["Passed", "Failed", "Cancelled"].includes(step.status)) {
    throw new Error("Tahap sudah selesai — scorecard tidak bisa diubah");
  }

  const template = await db.scorecardTemplate.findUnique({
    where: { id: input.templateId },
    include: { competencies: { select: { id: true, name: true } } },
  });
  if (!template || !template.active) throw new Error("Template scorecard tidak ditemukan / tidak aktif");

  const evaluator = await db.employee.findUnique({ where: { id: input.evaluatorId }, select: { id: true, fullName: true } });
  if (!evaluator) throw new Error("Evaluator tidak ditemukan");

  // validasi item: skor 1–5 + milik template
  const validIds = new Set(template.competencies.map((c) => c.id));
  const items = input.items.filter((i) => validIds.has(i.competencyId));
  const scored = new Map(items.map((i) => [i.competencyId, i]));

  if (input.submit) {
    const missing = template.competencies.filter((c) => !scored.has(c.id));
    if (missing.length > 0) {
      throw new Error(`Skor belum lengkap: ${missing.map((m) => m.name).join(", ")} — semua kompetensi wajib dinilai 1–5`);
    }
    if (items.some((i) => !Number.isFinite(i.score) || i.score < 1 || i.score > 5)) {
      throw new Error("Skor kompetensi harus di antara 1–5");
    }
    if (!input.overallComment?.trim()) {
      throw new Error("Feedback keseluruhan wajib diisi sebelum submit (kebijakan scorecard)");
    }
    if (!input.recommendation) {
      throw new Error("Rekomendasi akhir wajib dipilih sebelum submit");
    }
  }

  const existing = await db.candidateScorecard.findUnique({
    where: { selectionStepId_evaluatorId: { selectionStepId: input.selectionStepId, evaluatorId: input.evaluatorId } },
  });

  const data = {
    candidateId: step.candidate.id,
    templateId: input.templateId,
    recommendation: input.recommendation ?? null,
    overallComment: input.overallComment?.trim() || null,
    submittedAt: input.submit ? new Date() : null,
  };

  let id: string;
  if (existing) {
    if (existing.submittedAt) throw new Error("Scorecard sudah di-submit — hubungi HR bila perlu koreksi (jejak audit)");
    await db.candidateScorecard.update({ where: { id: existing.id }, data });
    await db.scorecardItem.deleteMany({ where: { scorecardId: existing.id } });
    id = existing.id;
  } else {
    const created = await db.candidateScorecard.create({
      data: { ...data, selectionStepId: input.selectionStepId, evaluatorId: input.evaluatorId },
    });
    id = created.id;
  }

  for (const c of template.competencies) {
    const it = scored.get(c.id);
    if (it) {
      await db.scorecardItem.create({
        data: { scorecardId: id, competencyId: c.id, score: Math.round(Math.max(1, Math.min(5, it.score))), comment: it.comment?.trim() || null },
      });
    }
  }

  await db.activityLog.create({
    data: {
      action: "Created", entity: "CandidateScorecard", entityId: step.candidate.fullName,
      detail: `${input.submit ? "Submit" : "Draf"} scorecard tahap ${step.selectionProcess.name} kandidat ${step.candidate.fullName} oleh evaluator ${evaluator.fullName}${actorName ? ` (input: ${actorName})` : ""}`,
    },
  });
  return { id, submitted: input.submit };
}

/**
 * GATE naik tahap (HRX D2): tahap yang punya template aktif terikat tahap
 * tersebut WAJIB punya ≥1 scorecard submitted dengan feedback terisi.
 * Dipanggil selection-service sebelum menandai tahap Passed.
 */
export async function scorecardGateOk(db: TenantDb, step: { id: string; selectionProcessId: string; candidateName?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const bound = await db.scorecardTemplate.findFirst({
    where: { selectionProcessId: step.selectionProcessId, active: true },
    select: { id: true, name: true },
  });
  if (!bound) return { ok: true }; // tahap tanpa rubrik terikat → tidak digate
  const panel = await getStepScorecards(db, step.id);
  if (panel.feedbackOk) return { ok: true };
  return {
    ok: false,
    reason: `Feedback scorecard wajib sebelum naik tahap — tahap ini memakai template "${bound.name}": submit minimal satu scorecard dengan feedback keseluruhan terisi (panel: ${panel.scorecards.filter((s) => s.submittedAt).length} terkirim)`,
  };
}
