import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ============================================================================
// PERFORMANCE — Service master kinerja (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md
// §15 + §18.9 versioning pustaka AMANDEMEN 2)
// Pola mengikuti recruitment-master-service: satu endpoint CRUD multi-tipe
// dengan validasi + whitelist per tipe; ActivityLog di route.
//
// VERSIONING §18.9 (AM2):
//   • Perubahan MINOR (nama tampilan, deskripsi/catatan tanpa mengubah makna)
//     → update inline pada baris versi aktif.
//   • Perubahan DEFINITIF (satuan/polaritas/kategori/sourceKey KPI; deskriptor
//     level kompetensi; kind) → wajib "Simpan sebagai versi baru": baris baru
//     versionNo+1 + effectiveYear + changeNote; versi lama otomatis
//     Superseded (tidak bisa dipilih untuk assignment baru, tetap terbaca
//     di riwayat). Data historis tetap aman — baris penilaian snapshot.
//   • Arsip ≠ hapus: status=Archived = hilang dari picker; hard-delete
//     DILARANG bila dirujuk baris penilaian/template (guard §35-28).
// ============================================================================

// Kunci = tipe endpoint ?type=… (identifier teknis, bukan teks UI):
// kpi = KPI library/pustaka KPI · competency = kompetensi · rating-scale =
// skala rating · template = template bobot · merit-matrix = matriks merit.
const MASTER_DEFS = {
  kpi: 1,
  competency: 1,
  "rating-scale": 1,
  template: 1,
  "merit-matrix": 1,
} as const;
export type PerfMasterType = keyof typeof MASTER_DEFS;
export const MASTER_TYPES = Object.keys(MASTER_DEFS) as PerfMasterType[];

export function isPerfMasterType(v: unknown): v is PerfMasterType {
  return typeof v === "string" && (MASTER_TYPES as readonly string[]).includes(v);
}

export function masterEntityOf(type: PerfMasterType): string {
  switch (type) {
    case "kpi": return "KpiDefinition";
    case "competency": return "Competency";
    case "rating-scale": return "RatingScale";
    case "template": return "PerformanceTemplate";
    case "merit-matrix": return "MeritMatrix";
  }
}

// ---------- enum whitelist ----------

const KPI_CATEGORIES = ["Financial", "Customer", "InternalProcess", "LearningGrowth"];
const KPI_POLARITIES = ["Higher", "Lower", "Boolean"];
const DATA_SOURCES = ["Manual", "Attendance", "Payroll", "Recruitment", "Leave"];
const COMP_KINDS = ["CoreValue", "Managerial", "Technical"];
const SCALE_COLORS = ["emerald", "teal", "amber", "orange", "rose", "slate"];

// ---------- validasi util ----------

function req(v: unknown, label: string): string {
  const s = v != null ? String(v).trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  return s;
}

function num(v: unknown): number | undefined {
  return Number.isFinite(Number(v)) ? Number(v) : undefined;
}

// ============================================================================
// LIST
// ============================================================================

/** Daftar master per tipe. Mode default: hanya versi Active (picker-safe);
 *  allVersions=true → seluruh versi (riwayat & dialog versi). */
export async function listMasters(
  db: TenantDb, type: PerfMasterType, allVersions = false,
): Promise<unknown[]> {
  const ver = allVersions ? undefined : { status: "Active" };
  const byCode = [{ active: "desc" as const }, { code: "asc" as const }, { versionNo: "desc" as const }];
  switch (type) {
    case "kpi":
      return db.kpiDefinition.findMany({ where: ver, orderBy: byCode });
    case "competency":
      return db.competency.findMany({ where: ver, orderBy: byCode });
    case "rating-scale":
      return db.ratingScale.findMany({ orderBy: { value: "desc" } });
    case "template":
      return db.performanceTemplate.findMany({
        orderBy: [{ active: "desc" as const }, { code: "asc" as const }],
        include: { items: { orderBy: { kind: "asc" } } },
      });
    case "merit-matrix":
      return db.meritMatrix.findMany({ orderBy: [{ active: "desc" as const }, { code: "asc" as const }] });
  }
}

/** Ringkasan jumlah per tipe (kartu overview modul). */
export async function countMasters(db: TenantDb): Promise<Record<PerfMasterType, number>> {
  const [kpi, comp, scale, tpl, mm] = await Promise.all([
    db.kpiDefinition.count({ where: { status: "Active" } }),
    db.competency.count({ where: { status: "Active" } }),
    db.ratingScale.count(),
    db.performanceTemplate.count(),
    db.meritMatrix.count(),
  ]);
  return { kpi, competency: comp, "rating-scale": scale, template: tpl, "merit-matrix": mm };
}

/** Riwayat versi untuk satu code (KPI/Kompetensi) — terbaru dulu. */
export async function versionHistory(
  db: TenantDb, type: "kpi" | "competency", code: string,
): Promise<Record<string, unknown>[]> {
  if (type === "kpi") {
    const rows = await db.kpiDefinition.findMany({
      where: { code }, orderBy: { versionNo: "desc" },
    });
    return rows.map((r) => ({
      id: r.id, versionNo: r.versionNo, effectiveYear: r.effectiveYear,
      status: r.status, changeNote: r.changeNote, name: r.name,
      unit: r.unit, polarity: r.polarity, category: r.category,
    }));
  }
  const rows = await db.competency.findMany({
    where: { code }, orderBy: { versionNo: "desc" },
  });
  return rows.map((r) => ({
    id: r.id, versionNo: r.versionNo, effectiveYear: r.effectiveYear,
    status: r.status, changeNote: r.changeNote, name: r.name,
    levelsJson: r.levelsJson, kind: r.kind,
  }));
}

// ============================================================================
// UPSERT — dengan perilaku versioning §18.9
// ============================================================================

export interface KpiUpsertInput {
  id?: string;
  code: string;
  name: string;
  category?: string;
  polarity?: string;
  unit?: string;
  dataSource?: string;
  sourceKey?: string | null;
  description?: string | null;
  active?: boolean;
  // AM2 §18.9 — mode versi baru
  asNewVersion?: boolean;
  effectiveYear?: number;
  changeNote?: string | null;
}

export async function upsertKpi(db: TenantDb, input: KpiUpsertInput): Promise<string> {
  const code = req(input.code, "Kode KPI");
  const name = req(input.name, "Nama KPI");
  const category = input.category ?? "InternalProcess";
  if (!KPI_CATEGORIES.includes(category)) throw new Error(`Kategori KPI tidak valid: ${category}`);
  const polarity = input.polarity ?? "Higher";
  if (!KPI_POLARITIES.includes(polarity)) throw new Error(`Polaritas tidak valid: ${polarity}`);
  const unit = req(input.unit ?? "%", "Satuan");
  const dataSource = input.dataSource ?? "Manual";
  if (!DATA_SOURCES.includes(dataSource)) throw new Error(`Sumber data tidak valid: ${dataSource}`);
  if (dataSource === "Manual" && input.sourceKey) throw new Error("sourceKey hanya untuk sumber data otomatis");
  const active = input.active !== false;

  if (input.id) {
    // ---------- UPDATE ----------
    const cur = await db.kpiDefinition.findUnique({ where: { id: input.id } });
    if (!cur) throw new Error("KPI tidak ditemukan");
    if (cur.code !== code) throw new Error("Kode KPI tidak dapat diubah (buat definisi baru)");

    const definitiveChanged =
      cur.unit !== unit || cur.polarity !== polarity || cur.category !== category ||
      cur.sourceKey !== (input.sourceKey ?? null) || cur.dataSource !== dataSource;

    if (input.asNewVersion && definitiveChanged) {
      // Perubahan DEFINITIF → versi baru §18.9
      const effectiveYear = num(input.effectiveYear) ?? new Date().getFullYear();
      const changeNote = req(input.changeNote, "Catatan perubahan (wajib untuk versi baru)");
      const next = (cur.versionNo ?? 1) + 1;
      const dup = await db.kpiDefinition.findUnique({ where: { code_versionNo: { code, versionNo: next } } });
      if (dup) throw new Error(`Versi ${next} untuk ${code} sudah ada`);
      const created = await db.kpiDefinition.create({
        data: {
          code, name, category, polarity, unit, dataSource,
          sourceKey: input.sourceKey ?? null,
          description: input.description ?? null,
          active, versionNo: next, effectiveYear, status: "Active",
          changeNote,
        },
      });
      await db.kpiDefinition.update({
        where: { id: cur.id },
        data: { status: "Superseded", supersededById: created.id, active: false },
      });
      return created.id;
    }
    if (!input.asNewVersion && definitiveChanged) {
      throw new Error(
        "Perubahan satuan/polaritas/kategori/sumber-data adalah perubahan definitif — gunakan \"Simpan sebagai versi baru\" dengan tahun berlaku + catatan perubahan (§18.9)",
      );
    }
    // Perubahan MINOR → inline
    await db.kpiDefinition.update({
      where: { id: cur.id },
      data: {
        name, description: input.description ?? null, active,
        changeNote: input.changeNote ?? cur.changeNote,
      },
    });
    return cur.id;
  }

  // ---------- CREATE ----------
  const exists = await db.kpiDefinition.findFirst({ where: { code } });
  if (exists) throw new Error(`Kode KPI ${code} sudah ada`);
  return (await db.kpiDefinition.create({
    data: {
      code, name, category, polarity, unit, dataSource,
      sourceKey: input.sourceKey ?? null,
      description: input.description ?? null,
      active,
      versionNo: 1,
      effectiveYear: num(input.effectiveYear) ?? new Date().getFullYear(),
      status: "Active",
      changeNote: input.changeNote ?? null,
    },
  })).id;
}

export interface CompUpsertInput {
  id?: string;
  code: string;
  name: string;
  kind?: string;
  levelsJson?: string; // [{level,label,descriptor}] — 5 level wajib
  active?: boolean;
  asNewVersion?: boolean;
  effectiveYear?: number;
  changeNote?: string | null;
}

export async function upsertCompetency(db: TenantDb, input: CompUpsertInput): Promise<string> {
  const code = req(input.code, "Kode kompetensi");
  const name = req(input.name, "Nama kompetensi");
  const kind = input.kind ?? "Technical";
  if (!COMP_KINDS.includes(kind)) throw new Error(`Jenis kompetensi tidak valid: ${kind}`);
  const levelsJson = input.levelsJson ?? "[]";
  let levels: { level: number; label: string; descriptor: string }[];
  try {
    levels = JSON.parse(levelsJson);
  } catch {
    throw new Error("Deskriptor level tidak valid (JSON)");
  }
  if (!Array.isArray(levels) || levels.length === 0) throw new Error("Minimal 1 level deskriptor diperlukan");
  for (const l of levels) {
    if (typeof l.level !== "number" || !l.label || !l.descriptor)
      throw new Error("Setiap level wajib {level, label, descriptor}");
  }
  const active = input.active !== false;

  if (input.id) {
    const cur = await db.competency.findUnique({ where: { id: input.id } });
    if (!cur) throw new Error("Kompetensi tidak ditemukan");
    if (cur.code !== code) throw new Error("Kode kompetensi tidak dapat diubah (buat definisi baru)");

    const definitiveChanged = cur.levelsJson !== levelsJson || cur.kind !== kind;

    if (input.asNewVersion && definitiveChanged) {
      const effectiveYear = num(input.effectiveYear) ?? new Date().getFullYear();
      const changeNote = req(input.changeNote, "Catatan perubahan (wajib untuk versi baru)");
      const next = (cur.versionNo ?? 1) + 1;
      const dup = await db.competency.findUnique({ where: { code_versionNo: { code, versionNo: next } } });
      if (dup) throw new Error(`Versi ${next} untuk ${code} sudah ada`);
      const created = await db.competency.create({
        data: { code, name, kind, levelsJson, active, versionNo: next, effectiveYear, status: "Active", changeNote },
      });
      await db.competency.update({
        where: { id: cur.id },
        data: { status: "Superseded", supersededById: created.id, active: false },
      });
      return created.id;
    }
    if (!input.asNewVersion && definitiveChanged) {
      throw new Error(
        "Perubahan deskriptor level/jenis adalah perubahan definitif — gunakan \"Simpan sebagai versi baru\" dengan tahun berlaku + catatan perubahan (§18.9)",
      );
    }
    await db.competency.update({
      where: { id: cur.id },
      data: { name, active, changeNote: input.changeNote ?? cur.changeNote },
    });
    return cur.id;
  }

  const exists = await db.competency.findFirst({ where: { code } });
  if (exists) throw new Error(`Kode kompetensi ${code} sudah ada`);
  return (await db.competency.create({
    data: {
      code, name, kind, levelsJson, active,
      versionNo: 1, effectiveYear: num(input.effectiveYear) ?? new Date().getFullYear(),
      status: "Active", changeNote: input.changeNote ?? null,
    },
  })).id;
}

export async function upsertRatingScale(db: TenantDb, input: {
  id?: string; value: number; labelId: string; labelEn: string;
  minScore: number; color?: string; guideline?: string | null;
}): Promise<string> {
  const value = num(input.value);
  if (value == null || value < 1 || value > 10) throw new Error("Nilai rating 1–10");
  const labelId = req(input.labelId, "Label (ID)");
  const labelEn = req(input.labelEn, "Label (EN)");
  const minScore = num(input.minScore);
  if (minScore == null || minScore < 0 || minScore > 100) throw new Error("Ambang skor 0–100");
  const color = input.color ?? "slate";
  if (!SCALE_COLORS.includes(color)) throw new Error(`Warna tidak valid: ${color}`);

  const dupVal = await db.ratingScale.findFirst({
    where: { value, ...(input.id ? { id: { not: input.id } } : {}) },
  });
  if (dupVal) throw new Error(`Nilai rating ${value} sudah dipakai`);
  const dupMin = await db.ratingScale.findFirst({
    where: { minScore, ...(input.id ? { id: { not: input.id } } : {}) },
  });
  if (dupMin) throw new Error(`Ambang skor ${minScore} sudah dipakai`);

  if (input.id) {
    await db.ratingScale.update({
      where: { id: input.id },
      data: { value, labelId, labelEn, minScore, color, guideline: input.guideline ?? null },
    });
    return input.id;
  }
  return (await db.ratingScale.create({
    data: { value, labelId, labelEn, minScore, color, guideline: input.guideline ?? null },
  })).id;
}

export async function upsertTemplate(db: TenantDb, input: {
  id?: string; code: string; name: string; weightsJson?: string;
  items?: { kind: string; refId: string; weight: number }[]; active?: boolean;
}): Promise<string> {
  const code = req(input.code, "Kode template");
  const name = req(input.name, "Nama template");
  let weights: { kpi?: number; competency?: number; core?: number } = { kpi: 70, competency: 20, core: 10 };
  if (input.weightsJson) {
    try {
      weights = JSON.parse(input.weightsJson);
    } catch {
      throw new Error("Bobot template tidak valid (JSON)");
    }
  }
  const sum = (weights.kpi ?? 0) + (weights.competency ?? 0) + (weights.core ?? 0);
  if (sum !== 100) throw new Error(`Total bobot harus 100 (sekarang ${sum})`);
  const active = input.active !== false;

  const items = input.items ?? [];
  const kpiW = items.filter((i) => i.kind === "Kpi").reduce((a, b) => a + (b.weight || 0), 0);
  const compW = items.filter((i) => i.kind === "Competency").reduce((a, b) => a + (b.weight || 0), 0);
  if (items.length && (kpiW > 100.01 || compW > 100.01)) throw new Error("Total bobot item per komponen melebihi 100");
  for (const it of items) {
    if (it.kind !== "Kpi" && it.kind !== "Competency") throw new Error(`Jenis item tidak valid: ${it.kind}`);
    if (!(it.weight > 0)) throw new Error("Bobot item harus > 0");
  }

  if (input.id) {
    const cur = await db.performanceTemplate.findUnique({ where: { id: input.id } });
    if (!cur) throw new Error("Template tidak ditemukan");
    if (cur.code !== code) {
      const dup = await db.performanceTemplate.findUnique({ where: { code } });
      if (dup) throw new Error(`Kode template ${code} sudah ada`);
    }
    await db.performanceTemplate.update({
      where: { id: input.id },
      data: { code, name, weightsJson: JSON.stringify(weights), active },
    });
    if (input.items) {
      await db.performanceTemplateItem.deleteMany({ where: { templateId: input.id } });
      await db.performanceTemplateItem.createMany({
        data: items.map((i) => ({ templateId: input.id as string, kind: i.kind, refId: i.refId, weight: i.weight })),
      });
    }
    return input.id;
  }

  const dup = await db.performanceTemplate.findUnique({ where: { code } });
  if (dup) throw new Error(`Kode template ${code} sudah ada`);
  const tpl = await db.performanceTemplate.create({
    data: { code, name, weightsJson: JSON.stringify(weights), active },
  });
  if (items.length) {
    await db.performanceTemplateItem.createMany({
      data: items.map((i) => ({ templateId: tpl.id, kind: i.kind, refId: i.refId, weight: i.weight })),
    });
  }
  return tpl.id;
}

export async function upsertMeritMatrix(db: TenantDb, input: {
  id?: string; code: string; name: string; gridJson?: string; active?: boolean;
}): Promise<string> {
  const code = req(input.code, "Kode matriks");
  const name = req(input.name, "Nama matriks");
  let grid: Record<string, unknown> = {};
  if (input.gridJson) {
    try {
      grid = JSON.parse(input.gridJson);
    } catch {
      throw new Error("Grid matriks tidak valid (JSON)");
    }
  }
  const active = input.active !== false;
  if (input.id) {
    const cur = await db.meritMatrix.findUnique({ where: { id: input.id } });
    if (!cur) throw new Error("Matriks merit tidak ditemukan");
    if (cur.code !== code) {
      const dup = await db.meritMatrix.findUnique({ where: { code } });
      if (dup) throw new Error(`Kode matriks ${code} sudah ada`);
    }
    await db.meritMatrix.update({
      where: { id: input.id },
      data: { code, name, gridJson: JSON.stringify(grid), active },
    });
    return input.id;
  }
  const dup = await db.meritMatrix.findUnique({ where: { code } });
  if (dup) throw new Error(`Kode matriks ${code} sudah ada`);
  return (await db.meritMatrix.create({
    data: { code, name, gridJson: JSON.stringify(grid), active },
  })).id;
}

// ============================================================================
// ARCHIVE / DELETE — guard referensi §35-28
// ============================================================================

/**
 * Arsipkan (bukan hapus): KPI/Kompetensi → status=Archived + active=false.
 * RatingScale/Template/MeritMatrix → inactive (soft). Hard-delete hanya bila
 * benar-benar tak dirujuk mana pun (§35-28) — untuk P0 cukup soft-archive.
 */
export async function archiveMaster(db: TenantDb, type: PerfMasterType, id: string): Promise<void> {
  switch (type) {
    case "kpi": {
      const refd = await db.appraisalKpi.count({ where: { kpiDefId: id } });
      const inTpl = await db.performanceTemplateItem.count({ where: { kind: "Kpi", refId: id } });
      if (refd > 0 || inTpl > 0) {
        // dirujuk → arsip saja (tetap terbaca di riwayat, hilang dari picker)
        await db.kpiDefinition.update({ where: { id }, data: { status: "Archived", active: false } });
        return;
      }
      await db.kpiDefinition.delete({ where: { id } });
      return;
    }
    case "competency": {
      const refd = await db.appraisalCompetencyScore.count({ where: { competencyId: id } });
      const inTpl = await db.performanceTemplateItem.count({ where: { kind: "Competency", refId: id } });
      const inFb = await db.feedback360Answer.count({ where: { competencyId: id } });
      if (refd > 0 || inTpl > 0 || inFb > 0) {
        await db.competency.update({ where: { id }, data: { status: "Archived", active: false } });
        return;
      }
      await db.competency.delete({ where: { id } });
      return;
    }
    case "rating-scale": {
      await db.ratingScale.delete({ where: { id } });
      return;
    }
    case "template": {
      const inUse = await db.appraisalRecord.count({ where: { templateId: id } });
      if (inUse > 0) {
        await db.performanceTemplate.update({ where: { id }, data: { active: false } });
        return;
      }
      await db.performanceTemplate.delete({ where: { id } });
      return;
    }
    case "merit-matrix": {
      const inUse = await db.meritRecommendation.count({ where: { matrixId: id } });
      if (inUse > 0) {
        await db.meritMatrix.update({ where: { id }, data: { active: false } });
        return;
      }
      await db.meritMatrix.delete({ where: { id } });
      return;
    }
  }
}

// ============================================================================
// SETTINGS + PENOMORAN
// ============================================================================

export async function getPerfSetting(db: TenantDb) {
  let row = await db.performanceSetting.findFirst();
  if (!row) {
    row = await db.performanceSetting.create({ data: {} });
  }
  return row;
}

export async function updatePerfSetting(db: TenantDb, input: {
  docPrefixes?: string; defWeights?: string; appealDays?: number; retentionYears?: number;
  okrEnabled?: boolean;
}) {
  const cur = await getPerfSetting(db);
  const docPrefixes = input.docPrefixes != null
    ? (() => {
        const parts = input.docPrefixes!.split("|").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2,5}$/.test(x));
        if (parts.length !== 4) throw new Error("Prefix dokumen: 4 kode 2–5 huruf dipisah | (PER|PRB|PIP|MER)");
        return parts.join("|");
      })()
    : cur.docPrefixes;
  const defWeights = input.defWeights != null
    ? (() => {
        const parts = input.defWeights!.split("|").map(Number);
        if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0) || parts.reduce((a, b) => a + b, 0) !== 100)
          throw new Error("Bobot default: 3 angka dipisah | berjumlah 100 (mis. 70|20|10)");
        return parts.join("|");
      })()
    : cur.defWeights;
  const appealDays = input.appealDays != null
    ? (() => { const n = Number(input.appealDays); if (!Number.isFinite(n) || n < 1 || n > 30) throw new Error("Jendela banding 1–30 hari"); return Math.round(n); })()
    : cur.appealDays;
  const retentionYears = input.retentionYears != null
    ? (() => { const n = Number(input.retentionYears); if (!Number.isFinite(n) || n < 1 || n > 25) throw new Error("Retensi 1–25 tahun"); return Math.round(n); })()
    : cur.retentionYears;
  // B1-BL (D-BL2) — mode OKR kuartalan per-tenant (default OFF).
  const okrEnabled = input.okrEnabled != null ? input.okrEnabled === true : cur.okrEnabled;
  return db.performanceSetting.update({
    where: { id: cur.id },
    data: { docPrefixes, defWeights, appealDays, retentionYears, okrEnabled },
  });
}

/**
 * Nomor dokumen kinerja berikutnya: {PREFIX}-YYYY-NNNN (max-suffix, delete-safe
 * — pola nextPrNo rekrutmen / nextDocNo leave).
 */
export async function nextPerfNo(db: TenantDb, kind: "PER" | "PRB" | "PIP" | "MER"): Promise<string> {
  const year = new Date().getFullYear();
  const start = `${kind}-${year}-`;
  let max = 0;
  const [prs, pips, probs, mers] = await Promise.all([
    db.appraisalRecord.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 500 }),
    kind === "PIP" ? db.pipPlan.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 500 }) : Promise.resolve([] as { docNo: string }[]),
    kind === "PRB" ? db.probationEvaluation.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 500 }) : Promise.resolve([] as { docNo: string }[]),
    kind === "MER" ? db.meritRecommendation.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 500 }) : Promise.resolve([] as { docNo: string }[]),
  ]);
  for (const r of [...prs, ...pips, ...probs, ...mers]) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

/**
 * P9-PERF — cadangkan RANGE nomor dokumen berurutan dalam SATU scan (enroll
 * massal §22 risiko 500 karyawan: jalur per-baris 3 query × N → jalur batch
 * 1 scan): max suffix dicari sekali, lalu {start}{max+1}…{start}{max+count}
 * dikembalikan tanpa query per baris. Format konsisten dgn nextPerfNo
 * ({PREFIX}-YYYY-NNNN); aman karena pemanggil membuat barisnya SEGERA
 * (createMany) sehingga scan berikutnya melihat nomor terpakai (delete-safe
 * sama dgn nextPerfNo).
 */
export async function reservePerfNoRange(
  db: TenantDb, kind: "PER" | "PRB" | "PIP" | "MER", count: number, year = new Date().getFullYear(),
): Promise<string[]> {
  if (count <= 0) return [];
  const start = `${kind}-${year}-`;
  let max = 0;
  const [prs, pips, probs, mers] = await Promise.all([
    db.appraisalRecord.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 5000 }),
    kind === "PIP" ? db.pipPlan.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 5000 }) : Promise.resolve([] as { docNo: string }[]),
    kind === "PRB" ? db.probationEvaluation.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 5000 }) : Promise.resolve([] as { docNo: string }[]),
    kind === "MER" ? db.meritRecommendation.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true }, take: 5000 }) : Promise.resolve([] as { docNo: string }[]),
  ]);
  for (const r of [...prs, ...pips, ...probs, ...mers]) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${start}${String(max + 1 + i).padStart(4, "0")}`);
}
