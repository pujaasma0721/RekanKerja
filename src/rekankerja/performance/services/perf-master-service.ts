// P0-PERF — service master modul Performance (DEVELOPMENT-PLAN-PERFORMANCE.md
// §17 masters · §18.5–18.9 AMANDEMEN 2: versioning pustaka + arsip lembut).
// Satu service multi-kind: kpi | competency | scale | template | meritMatrix.
// Aturan versioning (§18.9): minor (nama/deskripsi/aktif) = inline; definitif
// (satuan/polaritas/deskriptor level) = WAJIB versi baru (newVersion).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

const MASTER_KIND_SET = { kpi: true, competency: true, scale: true, template: true, meritMatrix: true } as const;
export type MasterKind = keyof typeof MASTER_KIND_SET;
export const MASTER_KINDS: MasterKind[] = (Object.keys(MASTER_KIND_SET) as MasterKind[]);
export function isMasterKind(v: unknown): v is MasterKind {
  return typeof v === "string" && v in MASTER_KIND_SET;
}

export interface KpiMasterInput {
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
  effectiveYear?: number;
}
export interface CompMasterInput {
  id?: string;
  code: string;
  name: string;
  kind?: string;
  levelsJson?: string; // [{level:1..5,label,descriptor}]
  active?: boolean;
  effectiveYear?: number;
}
export interface ScaleMasterInput {
  id?: string;
  value: number;
  labelId: string;
  labelEn: string;
  minScore: number;
  color?: string;
  guideline?: string | null;
}
export interface TemplateItemInput {
  kind: string; // Kpi|Competency
  refId: string;
  weight: number;
}
export interface TemplateMasterInput {
  id?: string;
  code: string;
  name: string;
  weightsJson?: string; // {kpi, competency, core}
  items?: TemplateItemInput[];
  active?: boolean;
}
export interface MeritMasterInput {
  id?: string;
  code: string;
  name: string;
  gridJson?: string;
  active?: boolean;
}

function bad(msg: string): never {
  throw new Error(msg);
}

// ============ LIST ============

export async function countMasters(db: TenantDb) {
  const [kpi, comp, scale, template, merit, cycle, appraisal] = await Promise.all([
    db.kpiDefinition.count({ where: { status: "Active" } }),
    db.competency.count({ where: { status: "Active" } }),
    db.ratingScale.count(),
    db.performanceTemplate.count(),
    db.meritMatrix.count(),
    db.performanceCycle.count(),
    db.appraisalRecord.count(),
  ]);
  return { kpi, competency: comp, scale, template, meritMatrix: merit, cycle, appraisal };
}

export async function listMasters(
  db: TenantDb,
  kind: MasterKind,
  opts: { q?: string; active?: string; category?: string; includeArchived?: boolean; historyOf?: string },
) {
  const q = (opts.q ?? "").trim();
  if (kind === "kpi") {
    const where: Record<string, unknown> = {};
    if (opts.historyOf) where.code = opts.historyOf;
    if (!opts.includeArchived && !opts.historyOf) where.status = { not: "Archived" };
    if (opts.active === "true") where.active = true;
    if (opts.active === "false") where.active = false;
    if (opts.category) where.category = opts.category;
    if (q) where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
    const rows = await db.kpiDefinition.findMany({
      where,
      orderBy: [{ code: "asc" }, { versionNo: "desc" }],
    });
    return rows;
  }
  if (kind === "competency") {
    const where: Record<string, unknown> = {};
    if (opts.historyOf) where.code = opts.historyOf;
    if (!opts.includeArchived && !opts.historyOf) where.status = { not: "Archived" };
    if (opts.active === "true") where.active = true;
    if (opts.active === "false") where.active = false;
    if (q) where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
    const rows = await db.competency.findMany({ where, orderBy: [{ code: "asc" }, { versionNo: "desc" }] });
    return rows;
  }
  if (kind === "scale") {
    const rows = await db.ratingScale.findMany({ orderBy: { value: "desc" } });
    return q ? rows.filter((r) => r.labelId.toLowerCase().includes(q.toLowerCase()) || r.labelEn.toLowerCase().includes(q.toLowerCase())) : rows;
  }
  if (kind === "template") {
    const rows = await db.performanceTemplate.findMany({
      where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : undefined,
      orderBy: { code: "asc" },
      include: { items: true },
    });
    return rows;
  }
  const rows = await db.meritMatrix.findMany({
    where: q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : undefined,
    orderBy: { code: "asc" },
  });
  return rows;
}

// ============ UPSERT (create / minor update) ============

export async function upsertKpi(db: TenantDb, input: KpiMasterInput, actor: string): Promise<string> {
  const year = input.effectiveYear ?? new Date().getFullYear();
  if (input.id) {
    const row = await db.kpiDefinition.findUnique({ where: { id: input.id } });
    if (!row) bad("Definisi KPI tidak ditemukan");
    // §18.9 — definitif = versi baru; di sini hanya minor yang boleh inline.
    const definitiveChanged =
      (input.category != null && input.category !== row.category) ||
      (input.polarity != null && input.polarity !== row.polarity) ||
      (input.unit != null && input.unit !== row.unit) ||
      (input.dataSource != null && input.dataSource !== row.dataSource) ||
      (input.sourceKey !== undefined && input.sourceKey !== row.sourceKey);
    if (definitiveChanged) {
      bad("Perubahan satuan/polaritas/kategori/sumber data bersifat definitif — gunakan \u201cSimpan sebagai versi baru\u201d agar data penilaian tahun lalu tetap utuh (§18.9)");
    }
    await db.kpiDefinition.update({
      where: { id: row.id },
      data: {
        name: input.name ?? row.name,
        description: input.description ?? row.description,
        ...(input.active != null && row.status !== "Archived" ? { active: input.active } : {}),
      },
    });
    return row.id;
  }
  // create v1
  const code = (input.code ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!code) bad("Kode KPI wajib diisi");
  if (!name) bad("Nama KPI wajib diisi");
  const category = input.category ?? bad("Kategori (perspektif BSC) wajib dipilih");
  const polarity = input.polarity ?? bad("Polaritas wajib dipilih");
  const unit = (input.unit ?? "").trim() || bad("Satuan wajib diisi");
  const dataSource = input.dataSource ?? "Manual";
  const sourceKey = dataSource === "Manual" ? null : (input.sourceKey?.trim() || null);
  const dup = await db.kpiDefinition.findUnique({ where: { code_versionNo: { code, versionNo: 1 } } });
  if (dup) bad(`Kode KPI ${code} sudah ada (versi 1) — gunakan kode lain`);
  const row = await db.kpiDefinition.create({
    data: {
      code, name, category, polarity, unit, dataSource, sourceKey,
      description: input.description ?? null,
      active: input.active ?? true,
      versionNo: 1, effectiveYear: year, status: "Active",
    },
  });
  void actor;
  return row.id;
}

export async function upsertCompetency(db: TenantDb, input: CompMasterInput, actor: string): Promise<string> {
  const year = input.effectiveYear ?? new Date().getFullYear();
  if (input.id) {
    const row = await db.competency.findUnique({ where: { id: input.id } });
    if (!row) bad("Kompetensi tidak ditemukan");
    const definitiveChanged =
      (input.kind != null && input.kind !== row.kind) ||
      (input.levelsJson != null && input.levelsJson !== row.levelsJson);
    if (definitiveChanged) {
      bad("Perubahan jenis/deskriptor level bersifat definitif — gunakan \u201cSimpan sebagai versi baru\u201d agar data penilaian tahun lalu tetap utuh (§18.9)");
    }
    await db.competency.update({
      where: { id: row.id },
      data: {
        name: input.name ?? row.name,
        ...(input.active != null && row.status !== "Archived" ? { active: input.active } : {}),
      },
    });
    return row.id;
  }
  const code = (input.code ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!code) bad("Kode kompetensi wajib diisi");
  if (!name) bad("Nama kompetensi wajib diisi");
  const kind = input.kind ?? bad("Jenis kompetensi wajib dipilih");
  const levelsJson = input.levelsJson ?? bad("Deskriptor 5 level wajib diisi");
  let levels: unknown;
  try { levels = JSON.parse(levelsJson); } catch { bad("Deskriptor level bukan JSON valid"); }
  if (!Array.isArray(levels) || levels.length !== 5) bad("Deskriptor level harus 5 tingkat (1–5)");
  const dup = await db.competency.findUnique({ where: { code_versionNo: { code, versionNo: 1 } } });
  if (dup) bad(`Kode kompetensi ${code} sudah ada (versi 1) — gunakan kode lain`);
  const row = await db.competency.create({
    data: { code, name, kind, levelsJson, active: input.active ?? true, versionNo: 1, effectiveYear: year, status: "Active" },
  });
  void actor;
  return row.id;
}

export async function upsertScale(db: TenantDb, input: ScaleMasterInput): Promise<string> {
  const value = Math.trunc(input.value);
  if (!(value >= 1 && value <= 9)) bad("Nilai rating harus bilangan bulat 1–9");
  if (input.labelId == null || !String(input.labelId).trim()) bad("Label (ID) wajib diisi");
  if (input.labelEn == null || !String(input.labelEn).trim()) bad("Label (EN) wajib diisi");
  if (!Number.isFinite(input.minScore)) bad("Skor minimum wajib angka");
  if (input.id) {
    await db.ratingScale.update({
      where: { id: input.id },
      data: {
        value,
        labelId: String(input.labelId).trim(),
        labelEn: String(input.labelEn).trim(),
        minScore: input.minScore,
        color: input.color ?? "emerald",
        guideline: input.guideline ?? null,
      },
    });
    return input.id;
  }
  const dupV = await db.ratingScale.findUnique({ where: { value } });
  if (dupV) bad(`Nilai rating ${value} sudah ada`);
  const row = await db.ratingScale.create({
    data: {
      value,
      labelId: String(input.labelId).trim(),
      labelEn: String(input.labelEn).trim(),
      minScore: input.minScore,
      color: input.color ?? "emerald",
      guideline: input.guideline ?? null,
    },
  });
  return row.id;
}

export async function upsertTemplate(db: TenantDb, input: TemplateMasterInput): Promise<string> {
  const code = (input.code ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!code) bad("Kode template wajib diisi");
  if (!name) bad("Nama template wajib diisi");
  let weights: { kpi?: number; competency?: number; core?: number } = {};
  if (input.weightsJson) {
    try { weights = JSON.parse(input.weightsJson); } catch { bad("Bobot template bukan JSON valid"); }
    const sum = (weights.kpi ?? 0) + (weights.competency ?? 0) + (weights.core ?? 0);
    if (Math.abs(sum - 100) > 0.01) bad(`Jumlah bobot KPI+Kompetensi+Nilai inti harus 100 (sekarang ${sum})`);
  }
  // validasi item bila diberikan: Σ per kind = 100
  if (input.items && input.items.length > 0) {
    for (const it of input.items) {
      if (it.kind !== "Kpi" && it.kind !== "Competency") bad(`Jenis item template tidak dikenal: ${it.kind}`);
      if (!Number.isFinite(it.weight) || it.weight <= 0 || it.weight > 100) bad(`Bobot item tidak valid (${it.weight})`);
    }
    const sumComp = input.items.filter((i) => i.kind === "Competency").reduce((s, i) => s + i.weight, 0);
    if (input.items.some((i) => i.kind === "Competency") && Math.abs(sumComp - 100) > 0.01) {
      bad(`Jumlah bobot item kompetensi harus 100 (sekarang ${sumComp})`);
    }
  }
  if (input.id) {
    const row = await db.performanceTemplate.findUnique({ where: { id: input.id } });
    if (!row) bad("Template tidak ditemukan");
    await db.performanceTemplate.update({
      where: { id: row.id },
      data: { code, name, ...(input.weightsJson ? { weightsJson: input.weightsJson } : {}), ...(input.active != null ? { active: input.active } : {}) },
    });
    if (input.items) {
      await db.performanceTemplateItem.deleteMany({ where: { templateId: row.id } });
      for (const it of input.items) {
        await db.performanceTemplateItem.create({ data: { templateId: row.id, kind: it.kind, refId: it.refId, weight: it.weight } });
      }
    }
    return row.id;
  }
  const dup = await db.performanceTemplate.findUnique({ where: { code } });
  if (dup) bad(`Kode template ${code} sudah ada`);
  const row = await db.performanceTemplate.create({
    data: {
      code, name,
      weightsJson: input.weightsJson ?? JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
      active: input.active ?? true,
    },
  });
  if (input.items) {
    for (const it of input.items) {
      await db.performanceTemplateItem.create({ data: { templateId: row.id, kind: it.kind, refId: it.refId, weight: it.weight } });
    }
  }
  return row.id;
}

export async function upsertMerit(db: TenantDb, input: MeritMasterInput): Promise<string> {
  const code = (input.code ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!code) bad("Kode matriks wajib diisi");
  if (!name) bad("Nama matriks wajib diisi");
  if (input.gridJson) {
    let grid: Record<string, unknown>;
    try { grid = JSON.parse(input.gridJson); } catch { bad("Grid matriks bukan JSON valid"); }
    for (const k of Object.keys(grid)) {
      if (Number.isFinite(Number(k)) && grid[k] != null && typeof grid[k] === "object") {
        const cell = grid[k] as Record<string, unknown>;
        if (cell.bonusMonths == null && cell.raisePct == null) bad(`Rating ${k}: isi bonusMonths dan/atau raisePct`);
      }
    }
  }
  if (input.id) {
    const row = await db.meritMatrix.findUnique({ where: { id: input.id } });
    if (!row) bad("Matriks merit tidak ditemukan");
    await db.meritMatrix.update({
      where: { id: row.id },
      data: { code, name, ...(input.gridJson ? { gridJson: input.gridJson } : {}), ...(input.active != null ? { active: input.active } : {}) },
    });
    return row.id;
  }
  const dup = await db.meritMatrix.findUnique({ where: { code } });
  if (dup) bad(`Kode matriks ${code} sudah ada`);
  const row = await db.meritMatrix.create({
    data: { code, name, gridJson: input.gridJson ?? "{}", active: input.active ?? true },
  });
  return row.id;
}

// ============ VERSIONING (AMANDEMEN 2 §18.9) ============

/** Simpan sebagai versi baru — perubahan definitif pustaka KPI/kompetensi. */
export async function newVersionMaster(
  db: TenantDb,
  kind: "kpi" | "competency",
  input: { id: string; changeNote: string; effectiveYear: number; data: Record<string, unknown> },
): Promise<string> {
  if (!input.id) bad("id definisi wajib");
  if (!input.changeNote?.trim()) bad("Catatan perubahan wajib diisi (audit HR — §18.9)");
  if (!Number.isFinite(input.effectiveYear)) bad("Tahun berlaku wajib diisi");
  if (kind === "kpi") {
    const old = await db.kpiDefinition.findUnique({ where: { id: input.id } });
    if (!old) bad("Definisi KPI tidak ditemukan");
    const maxV = await db.kpiDefinition.findFirst({
      where: { code: old.code },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const nextNo = (maxV?.versionNo ?? 0) + 1;
    const d = input.data as Partial<KpiMasterInput>;
    const created = await db.kpiDefinition.create({
      data: {
        code: old.code,
        name: (d.name ?? old.name).trim() || old.name,
        category: d.category ?? old.category,
        polarity: d.polarity ?? old.polarity,
        unit: d.unit ?? old.unit,
        dataSource: d.dataSource ?? old.dataSource,
        sourceKey: d.sourceKey !== undefined ? d.sourceKey : old.sourceKey,
        description: d.description !== undefined ? d.description : old.description,
        active: d.active ?? true,
        versionNo: nextNo,
        effectiveYear: input.effectiveYear,
        status: "Active",
        changeNote: input.changeNote.trim(),
      },
    });
    await db.kpiDefinition.update({
      where: { id: old.id },
      data: { status: "Superseded", supersededById: created.id, active: false },
    });
    return created.id;
  }
  const old = await db.competency.findUnique({ where: { id: input.id } });
  if (!old) bad("Kompetensi tidak ditemukan");
  const maxV = await db.competency.findFirst({
    where: { code: old.code },
    orderBy: { versionNo: "desc" },
    select: { versionNo: true },
  });
  const nextNo = (maxV?.versionNo ?? 0) + 1;
  const d = input.data as Partial<CompMasterInput>;
  const created = await db.competency.create({
    data: {
      code: old.code,
      name: (d.name ?? old.name).trim() || old.name,
      kind: d.kind ?? old.kind,
      levelsJson: d.levelsJson ?? old.levelsJson,
      active: d.active ?? true,
      versionNo: nextNo,
      effectiveYear: input.effectiveYear,
      status: "Active",
      changeNote: input.changeNote.trim(),
    },
  });
  await db.competency.update({
    where: { id: old.id },
    data: { status: "Superseded", supersededById: created.id, active: false },
  });
  return created.id;
}

/** Arsip lembut (§18.9): hilang dari picker, data historis tetap terbaca. */
export async function archiveMaster(db: TenantDb, kind: "kpi" | "competency", id: string, unarchive: boolean): Promise<void> {
  if (kind === "kpi") {
    const row = await db.kpiDefinition.findUnique({ where: { id } });
    if (!row) bad("Definisi KPI tidak ditemukan");
    if (row.status === "Superseded") bad("Versi Superseded tidak dapat diubah — bagian riwayat");
    if (unarchive) {
      const other = await db.kpiDefinition.findFirst({ where: { code: row.code, status: "Active" }, select: { id: true } });
      if (other) bad("Sudah ada versi Active untuk kode ini — arsipkan versi lain dulu");
      await db.kpiDefinition.update({ where: { id }, data: { status: "Active", active: true } });
    } else {
      await db.kpiDefinition.update({ where: { id }, data: { status: "Archived", active: false } });
    }
    return;
  }
  const row = await db.competency.findUnique({ where: { id } });
  if (!row) bad("Kompetensi tidak ditemukan");
  if (row.status === "Superseded") bad("Versi Superseded tidak dapat diubah — bagian riwayat");
  if (unarchive) {
    const other = await db.competency.findFirst({ where: { code: row.code, status: "Active" }, select: { id: true } });
    if (other) bad("Sudah ada versi Active untuk kode ini — arsipkan versi lain dulu");
    await db.competency.update({ where: { id }, data: { status: "Active", active: true } });
  } else {
    await db.competency.update({ where: { id }, data: { status: "Archived", active: false } });
  }
}

// ============ DELETE (guard referensi — §35-28) ============

export async function deleteMaster(db: TenantDb, kind: MasterKind, id: string): Promise<void> {
  if (kind === "kpi") {
    const [refs, tplRefs, supersedes] = await Promise.all([
      db.appraisalKpi.count({ where: { kpiDefId: id } }),
      db.performanceTemplateItem.count({ where: { refId: id } }),
      db.kpiDefinition.count({ where: { supersededById: id } }),
    ]);
    if (refs > 0) bad(`Definisi KPI dirujuk ${refs} baris penilaian — DILARANG hapus; arsipkan (§35-28)`);
    if (tplRefs > 0) bad(`Definisi KPI dipakai ${tplRefs} item template — hapus dari template dulu`);
    if (supersedes > 0) bad("Definisi KPI menjadi pengganti versi lama — tidak dapat dihapus");
    await db.kpiDefinition.delete({ where: { id } });
    return;
  }
  if (kind === "competency") {
    const [refs, tplRefs, supersedes, f360] = await Promise.all([
      db.appraisalCompetencyScore.count({ where: { competencyId: id } }),
      db.performanceTemplateItem.count({ where: { refId: id } }),
      db.competency.count({ where: { supersededById: id } }),
      db.feedback360Answer.count({ where: { competencyId: id } }),
    ]);
    if (refs > 0) bad(`Kompetensi dirujuk ${refs} baris penilaian — DILARANG hapus; arsipkan (§35-28)`);
    if (tplRefs > 0) bad(`Kompetensi dipakai ${tplRefs} item template — hapus dari template dulu`);
    if (supersedes > 0) bad("Kompetensi menjadi pengganti versi lama — tidak dapat dihapus");
    if (f360 > 0) bad(`Kompetensi dirujuk ${f360} isian 360 — DILARANG hapus`);
    await db.competency.delete({ where: { id } });
    return;
  }
  if (kind === "scale") {
    const row = await db.ratingScale.findUnique({ where: { id } });
    if (!row) bad("Skala rating tidak ditemukan");
    const refs = await db.appraisalRecord.count({ where: { finalRating: row.value } });
    if (refs > 0) bad(`Nilai rating ${row.value} dipakai ${refs} hasil penilaian — DILARANG hapus`);
    await db.ratingScale.delete({ where: { id } });
    return;
  }
  if (kind === "template") {
    const refs = await db.appraisalRecord.count({ where: { templateId: id } });
    if (refs > 0) bad(`Template dipakai ${refs} peserta penilaian — nonaktifkan, jangan hapus`);
    await db.performanceTemplate.delete({ where: { id } });
    return;
  }
  const refs = await db.meritRecommendation.count({ where: { matrixId: id } });
  if (refs > 0) bad(`Matriks dipakai ${refs} rekomendasi merit — nonaktifkan, jangan hapus`);
  await db.meritMatrix.delete({ where: { id } });
}
