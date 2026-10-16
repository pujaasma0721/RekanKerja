import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { APPRAISAL_LOCKED } from "@/rekankerja/performance/services/perf-cycle-service";

// ============================================================================
// PERFORMANCE — Service target & KPI (P1 — DEVELOPMENT-PLAN-PERFORMANCE.md
// §20 P1: KPI Builder §18.1 + salin periode sebelumnya §18.2 + penetapan/
// usulan MBO/lock §26 + impor Excel target §18.5 AM2 + progress §18.7)
//
// Prinsip yang dijaga service ini:
//   • DRAF vs SAH: baris AppraisalKpi adalah DRAF selama appraisal belum
//     GoalApproved — autosave PATCH bebas; submit (lockGoals) adalah keputusan
//     eksplisit manusia dengan validasi keras §35-3 (Σbobot=100, 3–8 item).
//   • SALIN ≠ SUBMIT §18.4: copyFromCycle/copyTeam/prefill menghasilkan baris
//     draf + provenance (origin=CopiedFromCycle + copiedFromId + chip
//     goalsCopiedFrom); capaian & bukti TIDAK PERNAH ikut disalin.
//   • IMPOR ≠ SUBMIT §18.5: commit impor hanya menulis baris draf per baris
//     valid (D16 — baris kotor ditolak per sel dengan alasan, tidak membatalkan
//     baris lain).
//   • Free-text KPI (kpiDefId null) sah untuk usulan karyawan/kustom —
//     pustaka tetap jalan lewat kpiDefId.
// ============================================================================

const DAY_MS = 86_400_000;

// ---------- util ----------

function reqStr(v: unknown, label: string): string {
  const s = v != null ? String(v).trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  return s;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Metric / Measure of Success — deskriptor terstruktur level 1–5 (model
 *  KPI-METRIC: inti pembuatan KPI, dibawa ke semua titik penilaian). */
export interface MetricLevel { level: number; descriptor: string }

function parseMetricLevels(v: unknown): MetricLevel[] {
  let raw: unknown = v;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const out: MetricLevel[] = [];
  for (const it of raw) {
    const lv = Number((it as MetricLevel)?.level);
    const d = String((it as MetricLevel)?.descriptor ?? "").trim();
    if (lv >= 1 && lv <= 5 && d) out.push({ level: lv, descriptor: d.slice(0, 2000) });
  }
  return out;
}

/** Serialisasi normal (null saat kosong) — dipakai assign/patch/import/copy. */
function metricLevelsJsonOf(v: unknown): string | null {
  const levels = parseMetricLevels(v);
  return levels.length > 0 ? JSON.stringify(levels) : null;
}

/** Metric lengkap = SEMUA level 1–5 terisi (gerbang submit §35-3 — KPI tanpa
 *  metric tidak boleh dikunci; KPI = judul + definisi + metric + bobot). */
export function isMetricComplete(v: unknown): boolean {
  const levels = parseMetricLevels(v);
  for (let i = 1; i <= 5; i++) {
    if (!levels.some((l) => l.level === i)) return false;
  }
  return true;
}

/** Render metric → teks berbaris (dipakai laporan/ringkasan). */
export function metricLevelsText(v: unknown): string | null {
  const levels = parseMetricLevels(v).sort((a, b) => a.level - b.level);
  if (levels.length === 0) return null;
  return levels.map((l) => `${l.level} : ${l.descriptor}`).join("\n");
}

/** Parser Excel: baris "1: …" s.d. "5: …" → level terstruktur. */
function parseMetricExcel(text: string): MetricLevel[] {
  const out: MetricLevel[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([1-5])\s*[:\).\-]\s*(.+)$/.exec(line);
    if (m) out.push({ level: Number(m[1]), descriptor: m[2].trim() });
  }
  return out;
}

function dayOf(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

export interface GoalActor {
  /** employeeId aktor — null = akun HR tanpa data karyawan (akses penuh HR). */
  employeeId: string | null;
  /** true = super admin (akses semua peserta). */
  superAdmin: boolean;
}

/** Peserta yang terlihat aktor (row-level §11.3 ringan — P9 mengeras penuh):
 *  HR/super admin → semua; atasan → hanya peserta yang dinilainya. */
function visibleWhere(actor: GoalActor, cycleId: string): Record<string, unknown> {
  const base: Record<string, unknown> = { cycleId };
  if (!actor.superAdmin && actor.employeeId) base.managerId = actor.employeeId;
  return base;
}

async function mustAppraisal(db: TenantDb, id: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id },
    include: { cycle: { select: { id: true, code: true, status: true, periodStart: true, periodEnd: true, goalEnd: true } }, kpis: true },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  return a;
}

function assertGoalWindow(a: { cycle: { status: string; goalEnd: Date | null } }): void {
  if (a.cycle.status !== "GoalSetting") {
    throw new Error(`Fase penetapan target tidak aktif (siklus ${a.cycle.status}) — salin/ubah/submit target hanya sah saat GoalSetting (§35-3/24)`);
  }
  if (a.cycle.goalEnd && a.cycle.goalEnd.getTime() < Date.now() - DAY_MS) {
    throw new Error("Jendela fase penetapan target sudah tutup (goalEnd terlewat)");
  }
}

// ============================================================================
// DAFTAR PESERTA + DETAIL + PROGRES (§18.7 progress dipakai Command Center)
// ============================================================================

export async function listGoalParticipants(
  db: TenantDb, actor: GoalActor, opt: { cycleId: string; q?: string },
): Promise<Record<string, unknown>[]> {
  const rows = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, opt.cycleId) as never,
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnitId: true } },
      kpis: { select: { target: true, thresholdMin: true, weight: true, polarity: true, measureMode: true, metricLevelsJson: true, updatedAt: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });
  const q = (opt.q ?? "").toLowerCase();
  return rows
    .filter((r) => !q || r.employee.fullName.toLowerCase().includes(q) || r.employee.employeeNo.toLowerCase().includes(q))
    .map((r) => {
      const locked = (APPRAISAL_LOCKED as readonly string[]).includes(r.status);
      return {
        appraisalId: r.id, docNo: r.docNo, status: r.status,
        employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
        kpiCount: r.kpis.length,
        progressPct: progressOfRows(r.kpis).pct,
        hasProposal: r.status === "GoalProposed",
        goalsCopiedFrom: r.goalsCopiedFrom,
        locked,
        lastSavedAt: r.kpis.reduce<string | null>((m, k) => (!m || k.updatedAt.toISOString() > m ? k.updatedAt.toISOString() : m), null),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
}

/** Progres formulir target §18.7: per baris — metric lengkap (wajib) + bobot +
 *  (mode Numeric: target & ambang; mode Descriptor: dinilai 1–5 tanpa angka) +
 *  1 global (Σ=100). */
export function progressOfRows(
  kpis: { target: number | null; thresholdMin: number | null; weight: number; polarity: string; measureMode: string; metricLevelsJson: string | null }[],
): { pct: number; filledRows: number; totalRows: number; sumWeight: number } {
  const n = kpis.length;
  if (n === 0) return { pct: 0, filledRows: 0, totalRows: 0, sumWeight: 0 };
  let filled = 0;
  let filledRows = 0;
  for (const k of kpis) {
    let rowOk = 0;
    const metricOk = isMetricComplete(k.metricLevelsJson);
    if (metricOk) { filled++; rowOk++; }
    if (k.measureMode === "Descriptor") {
      // KPI kualitatif — target/ambang tidak berlaku (selalu "terisi")
      filled += 2; rowOk += 2;
    } else {
      if (k.target != null || k.polarity === "Boolean") { filled++; rowOk++; }
      if (k.thresholdMin != null || k.polarity === "Boolean") { filled++; rowOk++; }
    }
    if (k.weight != null && k.weight > 0) { filled++; rowOk++; }
    if (rowOk === 4) filledRows++;
  }
  const sumWeight = kpis.reduce((s, k) => s + (k.weight ?? 0), 0);
  if (Math.abs(sumWeight - 100) < 0.01) filled++;
  return { pct: Math.round((filled / (4 * n + 1)) * 100), filledRows, totalRows: n, sumWeight };
}

export async function goalDetail(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: { select: { id: true, code: true, name: true, status: true, goalStart: true, goalEnd: true, periodStart: true, periodEnd: true, weightsJson: true } },
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true, positionId: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  const unit = a.employee.orgUnitId
    ? await db.orgUnit.findUnique({ where: { id: a.employee.orgUnitId }, select: { name: true } })
    : null;
  const pos = a.employee.positionId
    ? await db.position.findUnique({ where: { id: a.employee.positionId }, select: { title: true } })
    : null;
  const progress = progressOfRows(a.kpis);
  const errors = validateDraft(a.kpis);
  return {
    appraisal: {
      id: a.id, docNo: a.docNo, status: a.status, goalsCopiedFrom: a.goalsCopiedFrom,
      employeeId: a.employee.id, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName,
      unit: unit?.name ?? null, position: pos?.title ?? null,
      managerId: a.managerId, managerName: a.manager?.fullName ?? null,
    },
    cycle: a.cycle,
    kpis: a.kpis,
    progress,
    draftErrors: a.status === "GoalApproved" ? [] : errors,
    locked: (APPRAISAL_LOCKED as readonly string[]).includes(a.status),
  };
}

/** Validasi RAMAH §18.1-4 — warning per baris (bukan guard keras). */
export function validateDraft(kpis: {
  id: string; title: string; polarity: string; unit: string; measureMode: string; metricLevelsJson: string | null; thresholdMin: number | null;
  target: number; stretchValue: number | null; weight: number; isCritical: boolean;
}[]): string[] {
  const errs: string[] = [];
  const n = kpis.length;
  if (n === 0) errs.push("Belum ada baris KPI — mulai dari titik awal di atas (salin periode lalu / template / pustaka / kosong)");
  if (n > 0 && n < 3) errs.push(`Baru ${n} KPI — ideal 3–8 item (pertimbangkan menggabungkan atau menambah)`);
  if (n > 8) errs.push(`${n} KPI — terlalu banyak; ideal 3–8 item (pertimbangkan memecah/menggabungkan)`);
  const sumW = kpis.reduce((s, k) => s + (k.weight ?? 0), 0);
  if (n > 0 && Math.abs(sumW - 100) > 0.01) {
    errs.push(`Total bobot ${formatNum(sumW)}% — harus tepat 100% (sisa ${formatNum(100 - sumW)}%${Math.abs(100 - sumW) % (n || 1) === 0 ? "" : ""})`);
  }
  // Metric / Measure of Success — INTEGRITAS BARIS KPI (permintaan user: diisi
  // saat membuat KPI pertama kali & dibawa di semua tempat): KPI TANPA metric
  // lengkap 1–5 tidak boleh dikunci — karyawan dinilai berdasarkan ukuran ini.
  const noMetric = kpis.filter((k) => !isMetricComplete(k.metricLevelsJson));
  if (noMetric.length > 0) {
    errs.push(`${noMetric.length} KPI belum memiliki Metric / Measure of Success lengkap (deskriptor level 1–5) — wajib dilengkapi sebelum submit`);
  }
  for (const k of kpis) {
    if (!(k.weight > 0)) errs.push(`"${k.title}": bobot harus > 0`);
    if (k.measureMode === "Descriptor") continue; // tanpa ambang/angka — dinilai 1–5
    if (k.polarity !== "Boolean" && k.thresholdMin == null) errs.push(`"${k.title}": ambang gagal belum diisi`);
    if (k.polarity === "Boolean" && k.target !== 0 && k.target !== 1) errs.push(`"${k.title}": KPI Boolean — target harus 1 (sukses) atau 0 (gagal)`);
  }
  return errs;
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

// ============================================================================
// SALIN DARI PERIODE SEBELUMNYA (§18.2 — 4 titik masuk, guard §35-24/25)
// ============================================================================

/** Daftar siklus SUMAH untuk satu peserta (D15): periodEnd < awal siklus aktif,
 *  peserta sama, ≥1 baris KPI terkunci. Urut terbaru dulu + rekomendasi. */
export async function copySources(db: TenantDb, appraisalId: string): Promise<{
  currentCycleCode: string;
  sources: {
    appraisalId: string; cycleId: string; code: string; name: string;
    periodStart: string; periodEnd: string; kpiCount: number; status: string;
    docNo: string; suggested: boolean;
  }[];
}> {
  const a = await mustAppraisal(db, appraisalId);
  const prior = await db.appraisalRecord.findMany({
    where: {
      employeeId: a.employeeId,
      id: { not: a.id },
      cycle: { periodEnd: { lt: a.cycle.periodStart } },
      status: { in: [...APPRAISAL_LOCKED] },
    },
    include: { cycle: { select: { id: true, code: true, name: true, periodStart: true, periodEnd: true } }, kpis: { select: { id: true } } },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  const withKpi = prior.filter((p) => p.kpis.length > 0);
  return {
    currentCycleCode: a.cycle.code,
    sources: withKpi.map((p, i) => ({
      appraisalId: p.id, cycleId: p.cycle.id, code: p.cycle.code, name: p.cycle.name,
      periodStart: p.cycle.periodStart.toISOString().slice(0, 10),
      periodEnd: p.cycle.periodEnd.toISOString().slice(0, 10),
      kpiCount: p.kpis.length, status: p.status, docNo: p.docNo, suggested: i === 0,
    })),
  };
}

/** Pratinjau salin — tabel baris KPI periode lalu + flag amber (§18.2). */
export async function copyPreview(db: TenantDb, actor: GoalActor, appraisalId: string, sourceAppraisalId: string) {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat menyalin target (§35-24)");
  }
  assertGoalWindow(a);
  if ((APPRAISAL_LOCKED as readonly string[]).includes(a.status)) {
    throw new Error("Target peserta ini sudah dikunci — salin hanya sah sebelum submit (§35-24)");
  }
  const src = await db.appraisalRecord.findUnique({
    where: { id: sourceAppraisalId },
    include: {
      cycle: { select: { code: true, periodStart: true, periodEnd: true } },
      kpis: { orderBy: { createdAt: "asc" }, include: { kpiDef: { select: { id: true, code: true, unit: true, active: true, status: true, dataSource: true, sourceKey: true } } } },
    },
  });
  if (!src || src.employeeId !== a.employeeId) throw new Error("Sumber salin tidak valid (peserta berbeda)");
  if (src.cycle.periodEnd >= a.cycle.periodStart) throw new Error("Sumber salin harus periode TERDAHULU (periodEnd < awal siklus aktif)");
  if (src.kpis.length === 0) throw new Error("Sumber salin tidak punya baris KPI terkunci");

  // flag penempatan berubah sejak periode sumber (§18.2 — pertimbangkan template baru)
  const movedAfter = src.cycle.periodEnd;
  const moves = await db.employeeAssignment.findMany({
    where: { employeeId: a.employeeId, validFrom: { gt: movedAfter }, changeReason: { not: "Initial" } },
    select: { changeReason: true, validFrom: true },
    orderBy: { validFrom: "desc" }, take: 1,
  });
  const placementChanged = moves.length > 0;

  const existingTitles = new Set(a.kpis.map((k) => k.title.toLowerCase()));

  const rows = src.kpis.map((k) => ({
    sourceKpiId: k.id,
    title: k.title, polarity: k.polarity, unit: k.unit,
    description: k.description, measureMode: k.measureMode, metricLevelsJson: k.metricLevelsJson,
    thresholdMin: k.thresholdMin, oldTarget: k.target, target: k.target,
    stretchValue: k.stretchValue, weight: k.weight, isCritical: k.isCritical,
    dataSource: k.dataSource, kpiDefId: k.kpiDefId,
    defCode: k.kpiDef?.code ?? null,
    auto: k.kpiDef?.sourceKey != null,
    // flag amber §18.2: definisi non-aktif / berubah sejak periode lalu
    defInactive: k.kpiDefId != null && (k.kpiDef?.active !== true || k.kpiDef?.status !== "Active"),
    unitChanged: k.kpiDef != null && k.kpiDef.unit !== k.unit,
    duplicate: existingTitles.has(k.title.toLowerCase()),
  }));

  return {
    appraisalId: a.id,
    source: { appraisalId: src.id, cycleCode: src.cycle.code, docNo: src.docNo, periodEnd: src.cycle.periodEnd.toISOString().slice(0, 10) },
    placementChanged,
    placementNote: placementChanged
      ? `Penempatan peserta berubah sejak periode sumber (${moves[0].changeReason} ${moves[0].validFrom.toISOString().slice(0, 10)}) — pertimbangkan template jabatan baru`
      : null,
    hasExistingRows: a.kpis.length > 0,
    rows,
    reminder: "Capaian & bukti TIDAK ikut disalin — periode baru selalu mulai bersih (§18.2)",
  };
}

export interface CopyRowInput {
  sourceKpiId: string;
  include: boolean;
  target?: number;
  weight?: number;
  isCritical?: boolean;
}

/** Salin per peserta (§18.2 a/b — empty state & toolbar; guard §35-24). */
export async function copyFromCycle(
  db: TenantDb, actor: GoalActor, appraisalId: string, sourceAppraisalId: string, rows: CopyRowInput[],
): Promise<{ created: number; cycleCode: string }> {
  const preview = await copyPreview(db, actor, appraisalId, sourceAppraisalId);
  const wanted = rows.filter((r) => r.include !== false);
  if (!wanted.length) throw new Error("Centang minimal satu baris untuk disalin");

  const byId = new Map(preview.rows.map((r) => [r.sourceKpiId, r]));
  let created = 0;
  for (const w of wanted) {
    const src = byId.get(w.sourceKpiId);
    if (!src) throw new Error("Baris sumber tidak ditemukan di pratinjau");
    await db.appraisalKpi.create({
      data: {
        appraisalId,
        kpiDefId: src.kpiDefId,
        title: src.title, polarity: src.polarity, unit: src.unit,
        description: src.description, measureMode: src.measureMode,
        metricLevelsJson: src.metricLevelsJson,
        thresholdMin: src.thresholdMin,
        target: w.target != null ? w.target : src.target,
        stretchValue: src.stretchValue,
        weight: w.weight != null ? w.weight : src.weight,
        isCritical: w.isCritical ?? src.isCritical,
        dataSource: src.dataSource,
        // provenance §18.2 — capaian selalu reset (midActual/finalActual/evidence null)
        origin: "CopiedFromCycle",
        copiedFromId: src.sourceKpiId,
      },
    });
    created++;
  }
  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { goalsCopiedFrom: preview.source.cycleCode },
  });
  return { created, cycleCode: preview.source.cycleCode };
}

/** Bulk tim (§18.2 c — "Salin tim dari PER-2025"; guard §35-25: hanya peserta tanpa baris). */
export async function copyTeam(
  db: TenantDb, actor: GoalActor, cycleId: string, sourceCycleId: string,
): Promise<{ filled: string[]; skipped: string[]; noSource: string[] }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "GoalSetting") throw new Error("Bulk tim hanya sah saat fase GoalSetting (§35-25)");
  const srcCycle = await db.performanceCycle.findUnique({ where: { id: sourceCycleId } });
  if (!srcCycle || srcCycle.periodEnd >= cycle.periodStart) throw new Error("Siklus sumber harus periode terdahulu");

  const participants = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, cycleId) as never,
    include: { kpis: { select: { id: true } }, employee: { select: { fullName: true, employeeNo: true } } },
    take: 500,
  });
  const filled: string[] = [], skipped: string[] = [], noSource: string[] = [];
  for (const p of participants) {
    if ((APPRAISAL_LOCKED as readonly string[]).includes(p.status) || p.kpis.length > 0) {
      skipped.push(`${p.employee.employeeNo} ${p.employee.fullName}`);
      continue;
    }
    const src = await db.appraisalRecord.findFirst({
      where: { employeeId: p.employeeId, cycleId: sourceCycleId, status: { in: [...APPRAISAL_LOCKED] } },
      include: { kpis: { orderBy: { createdAt: "asc" } } },
    });
    if (!src || src.kpis.length === 0) {
      noSource.push(`${p.employee.employeeNo} ${p.employee.fullName}`);
      continue;
    }
    for (const k of src.kpis) {
      await db.appraisalKpi.create({
        data: {
          appraisalId: p.id, kpiDefId: k.kpiDefId,
          title: k.title, polarity: k.polarity, unit: k.unit,
          description: k.description, measureMode: k.measureMode,
          metricLevelsJson: k.metricLevelsJson,
          thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
          weight: k.weight, isCritical: k.isCritical, dataSource: k.dataSource,
          origin: "CopiedFromCycle", copiedFromId: k.id,
        },
      });
    }
    await db.appraisalRecord.update({ where: { id: p.id }, data: { goalsCopiedFrom: srcCycle.code } });
    filled.push(`${p.employee.employeeNo} ${p.employee.fullName}`);
  }
  return { filled, skipped, noSource };
}

/** Prefill saat openGoal (§18.2 d — wizard pembukaan siklus, opsional HR).
 *  Peserta dengan sumber → baris salinan; tanpa sumber → tawarkan template
 *  (diterapkan bila diberikan templateId). */
export async function prefillFromPrevious(
  db: TenantDb, cycleId: string, templateId?: string,
): Promise<{ filled: number; templateFilled: number; noSource: number }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  const participants = await db.appraisalRecord.findMany({
    where: { cycleId, status: "Enrolled", goalsCopiedFrom: null },
    include: { kpis: { select: { id: true } } },
    take: 500,
  });
  // template items (fallback tanpa sumber)
  let tplItems: { kpiDefId: string | null; title: string; polarity: string; unit: string; description: string | null; measureMode: string; metricLevelsJson: string | null; weight: number }[] = [];
  if (templateId) {
    const tpl = await db.performanceTemplate.findUnique({
      where: { id: templateId },
      include: { items: { where: { kind: "Kpi" }, include: {} } },
    });
    if (!tpl) throw new Error("Template tidak ditemukan");
    const defs = await db.kpiDefinition.findMany({
      where: { status: "Active" },
      select: { id: true, code: true, name: true, polarity: true, unit: true, description: true, measureMode: true, metricLevelsJson: true },
    });
    const defById = new Map(defs.map((d) => [d.id, d]));
    tplItems = tpl.items
      .map((it) => {
        const d = defById.get(it.refId);
        return d ? { kpiDefId: d.id, title: d.name, polarity: d.polarity, unit: d.unit, description: d.description, measureMode: d.measureMode, metricLevelsJson: d.metricLevelsJson, weight: it.weight } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }

  let filled = 0, templateFilled = 0, noSource = 0;
  for (const p of participants) {
    if (p.kpis.length > 0) continue;
    const src = await db.appraisalRecord.findFirst({
      where: {
        employeeId: p.employeeId,
        cycle: { periodEnd: { lt: cycle.periodStart } },
        status: { in: [...APPRAISAL_LOCKED] },
      },
      include: { kpis: { orderBy: { createdAt: "asc" }, take: 8 }, cycle: { select: { code: true } } },
      orderBy: { updatedAt: "desc" },
    });
    if (src && src.kpis.length > 0) {
      for (const k of src.kpis) {
        await db.appraisalKpi.create({
          data: {
            appraisalId: p.id, kpiDefId: k.kpiDefId, title: k.title, polarity: k.polarity,
            unit: k.unit, description: k.description, measureMode: k.measureMode,
            metricLevelsJson: k.metricLevelsJson,
            thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
            weight: k.weight, isCritical: k.isCritical, dataSource: k.dataSource,
            origin: "CopiedFromCycle", copiedFromId: k.id,
          },
        });
      }
      await db.appraisalRecord.update({ where: { id: p.id }, data: { goalsCopiedFrom: src.cycle.code } });
      filled++;
    } else if (tplItems.length > 0) {
      for (const t of tplItems) {
        await db.appraisalKpi.create({
          data: {
            appraisalId: p.id, kpiDefId: t.kpiDefId, title: t.title, polarity: t.polarity,
            unit: t.unit, description: t.description, measureMode: t.measureMode,
            metricLevelsJson: t.metricLevelsJson,
            target: t.measureMode === "Descriptor" ? 5 : 0, weight: t.weight,
            dataSource: "Manual", origin: "Template",
          },
        });
      }
      templateFilled++;
    } else {
      noSource++;
    }
  }
  return { filled, templateFilled, noSource };
}

// ============================================================================
// PENETAPAN KPI — assignBatch / patchDraft (autosave) / MBO / approve / lock
// ============================================================================

export interface KpiItemInput {
  kpiDefId?: string | null;
  title: string;
  polarity?: string;
  unit?: string;
  /** Definisi KPI (apa yang dimaksud) — snapshot per baris. */
  description?: string | null;
  /** Cara dinilai: "Numeric" (ambang/target/stretch) | "Descriptor" (level 1–5). */
  measureMode?: string;
  /** Metric / Measure of Success — [{level:1..5, descriptor}]; kosong + kpiDefId ada → default pustaka. */
  metricLevels?: unknown;
  thresholdMin?: number | null;
  target?: number | null;
  stretchValue?: number | null;
  weight?: number;
  isCritical?: boolean;
}

async function resolveDef(db: TenantDb, kpiDefId: string) {
  const def = await db.kpiDefinition.findUnique({ where: { id: kpiDefId } });
  if (!def) throw new Error("Definisi KPI pustaka tidak ditemukan");
  return def;
}

/** Susun/ubah baris KPI satu peserta (§26-3 jalur manual: pustaka/template/custom).
 *  mode append = tambah; replace = ganti seluruh draf. */
export async function assignBatch(
  db: TenantDb, actor: GoalActor, appraisalId: string, items: KpiItemInput[], mode: "append" | "replace" = "append",
): Promise<{ created: number; removed: number }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat menetapkan target (§26)");
  }
  assertGoalWindow(a);
  if ((APPRAISAL_LOCKED as readonly string[]).includes(a.status)) throw new Error("Target sudah dikunci (GoalApproved) — ubah hanya lewat revisi mid-year (Alur 3)");

  if (items.length > 8) throw new Error("Maksimal 8 baris KPI per peserta (§35-3)");
  let removed = 0;
  if (mode === "replace" && a.kpis.length > 0) {
    // hanya draf milik Manager yang boleh dibuang — usulan karyawan ditandai skip (jangan hilangkan usulan orang)
    await db.appraisalKpi.deleteMany({ where: { appraisalId, proposedBy: "Manager" } });
    removed = a.kpis.filter((k) => k.proposedBy === "Manager").length;
  }
  let created = 0;
  for (const it of items) {
    // kpiDefId diberikan → definisi pustaka jadi sumber judul/polaritas/satuan
    // bila pemanggil tak menyertakan judul (robust API; UI tetap boleh override judul).
    let defPolarity: string | null = null;
    let defUnit: string | null = null;
    let defTitle: string | null = null;
    let defDescription: string | null = null;
    let defMeasureMode: string | null = null;
    let defMetric: string | null = null;
    if (it.kpiDefId) {
      const def = await resolveDef(db, it.kpiDefId);
      defPolarity = def.polarity;
      defUnit = def.unit;
      defTitle = def.name;
      defDescription = def.description;
      defMeasureMode = def.measureMode;
      defMetric = def.metricLevelsJson;
    }
    const title = reqStr(it.title ?? defTitle, "Judul KPI");
    let polarity = it.polarity ?? defPolarity ?? "Higher";
    let unit = it.unit ?? defUnit ?? "";
    if (!["Higher", "Lower", "Boolean"].includes(polarity)) throw new Error(`Polaritas tidak valid: ${polarity}`);
    // mode pengukuran: Descriptor = KPI kualitatif dinilai level 1–5 (tanpa angka)
    const measureMode = (it.measureMode ?? defMeasureMode) === "Descriptor" ? "Descriptor" : "Numeric";
    if (measureMode === "Descriptor") {
      polarity = "Higher";
      unit = "level";
    } else if (!unit) {
      throw new Error(`Satuan wajib untuk "${title}"`);
    }
    const weight = it.weight ?? 0;
    if (!(weight > 0) || weight > 100) throw new Error(`Bobot "${title}" harus 1–100`);
    // Metric / Measure of Success — WAJIB saat membuat KPI (permintaan user;
    // form UI meng-enforce di kedua mode). Server: mode Descriptor WAJIB lengkap
    // (KPI dinilai langsung dari deskriptor ini); mode Numeric boleh kosong di
    // sini (jalur pustaka/salin) TAPI gerbang lockGoals tetap menolak submit
    // KPI tanpa metric lengkap — baris tampil amber "lengkapi metric" di builder.
    const metricLevelsJson = metricLevelsJsonOf(it.metricLevels) ?? defMetric;
    if (measureMode === "Descriptor" && !isMetricComplete(metricLevelsJson)) {
      throw new Error(
        `Metric / Measure of Success "${title}" wajib diisi lengkap (deskriptor level 1–5) — KPI deskriptif dinilai langsung berdasarkan deskriptor ini`,
      );
    }
    await db.appraisalKpi.create({
      data: {
        appraisalId, kpiDefId: it.kpiDefId ?? null, title, polarity, unit,
        description: it.description != null && String(it.description).trim() ? String(it.description).trim() : defDescription,
        measureMode, metricLevelsJson,
        thresholdMin: measureMode === "Descriptor" ? null : (it.thresholdMin ?? null),
        target: measureMode === "Descriptor" ? 5 : (it.target ?? 0),
        stretchValue: measureMode === "Descriptor" ? null : (it.stretchValue ?? null),
        weight, isCritical: it.isCritical === true,
        dataSource: "Manual",
        origin: "Fresh", proposedBy: "Manager",
      },
    });
    created++;
  }
  return { created, removed };
}

/** Autosave draf §18.7 — PATCH perubahan baris (judul/definisi/mode/metric/
 *  target/ambang/stretch/bobot/kritis) + hapus baris. Sah selama
 *  Enrolled/GoalProposed & fase GoalSetting. */
export async function patchDraft(
  db: TenantDb, actor: GoalActor, appraisalId: string,
  rows: {
    id: string; title?: string; description?: string | null; measureMode?: string;
    metricLevels?: unknown; unit?: string; polarity?: string;
    target?: number | null; thresholdMin?: number | null; stretchValue?: number | null;
    weight?: number; isCritical?: boolean;
  }[],
  removedIds: string[] = [],
): Promise<{ updated: number; removed: number; savedAt: string }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat mengubah draf target");
  }
  if (a.status !== "Enrolled" && a.status !== "GoalProposed") {
    throw new Error("Draf hanya dapat diubah sebelum submit (status GoalApproved ke atas terkunci)");
  }
  assertGoalWindow(a);

  const byId = new Map(a.kpis.map((k) => [k.id, k]));
  let updated = 0;
  for (const r of rows) {
    const cur = byId.get(r.id);
    if (!cur) continue; // baris sudah dihapus panggilan sebelumnya — diam
    await db.appraisalKpi.update({
      where: { id: r.id },
      data: {
        ...(r.title !== undefined && String(r.title).trim() ? { title: String(r.title).trim() } : {}),
        ...(r.description !== undefined ? { description: String(r.description).trim() || null } : {}),
        ...(r.measureMode !== undefined ? { measureMode: r.measureMode === "Descriptor" ? "Descriptor" : "Numeric" } : {}),
        ...(r.metricLevels !== undefined ? { metricLevelsJson: metricLevelsJsonOf(r.metricLevels) } : {}),
        ...(r.unit !== undefined && String(r.unit).trim() ? { unit: String(r.unit).trim() } : {}),
        ...(r.polarity !== undefined && ["Higher", "Lower", "Boolean"].includes(r.polarity) ? { polarity: r.polarity } : {}),
        ...(r.target !== undefined ? { target: r.target ?? 0 } : {}),
        ...(r.thresholdMin !== undefined ? { thresholdMin: r.thresholdMin ?? null } : {}),
        ...(r.stretchValue !== undefined ? { stretchValue: r.stretchValue ?? null } : {}),
        ...(r.weight !== undefined ? { weight: r.weight } : {}),
        ...(r.isCritical !== undefined ? { isCritical: r.isCritical } : {}),
      },
    });
    updated++;
  }
  let removed = 0;
  for (const id of removedIds) {
    if (byId.has(id)) {
      await db.appraisalKpi.delete({ where: { id } }).catch(() => {});
      removed++;
    }
  }
  return { updated, removed, savedAt: new Date().toISOString() };
}

/** Usulan KPI karyawan (MBO §26-4 / §18.3 — dari ESS; guard §35-4). */
export async function proposeMbo(
  db: TenantDb, employeeId: string, appraisalId: string, items: KpiItemInput[],
): Promise<{ created: number }> {
  const a = await mustAppraisal(db, appraisalId);
  if (a.employeeId !== employeeId) throw new Error("Hanya peserta bersangkutan yang dapat mengusulkan KPI (§35-4)");
  if (a.cycle.status !== "GoalSetting") throw new Error("Usulan hanya sah saat fase GoalSetting (§35-4)");
  if ((APPRAISAL_LOCKED as readonly string[]).includes(a.status)) throw new Error("Target sudah dikunci — usulan ditutup (§35-4)");
  if (a.kpis.filter((k) => k.proposedBy === "Employee").length + items.length > 8) throw new Error("Maksimal 8 baris KPI per peserta");
  let created = 0;
  for (const it of items) {
    const title = reqStr(it.title, "Judul KPI usulan");
    let polarity = it.polarity ?? "Higher";
    let unit = it.unit ?? "";
    let defDescription: string | null = null;
    let defMeasureMode: string | null = null;
    let defMetric: string | null = null;
    if (it.kpiDefId) {
      const def = await resolveDef(db, it.kpiDefId);
      polarity = def.polarity; unit = def.unit;
      defDescription = def.description; defMeasureMode = def.measureMode; defMetric = def.metricLevelsJson;
    }
    if (!["Higher", "Lower", "Boolean"].includes(polarity)) throw new Error(`Polaritas tidak valid: ${polarity}`);
    if (!unit) unit = "%";
    const measureMode = (it.measureMode ?? defMeasureMode) === "Descriptor" ? "Descriptor" : "Numeric";
    const metricLevelsJson = metricLevelsJsonOf(it.metricLevels) ?? defMetric;
    await db.appraisalKpi.create({
      data: {
        appraisalId, kpiDefId: it.kpiDefId ?? null, title, polarity, unit,
        description: it.description != null && String(it.description).trim() ? String(it.description).trim() : defDescription,
        measureMode, metricLevelsJson,
        thresholdMin: measureMode === "Descriptor" ? null : (it.thresholdMin ?? null),
        target: measureMode === "Descriptor" ? 5 : (it.target ?? 0),
        stretchValue: measureMode === "Descriptor" ? null : (it.stretchValue ?? null),
        weight: it.weight ?? 10, isCritical: false,
        dataSource: "Manual", origin: "EmployeeProposal", proposedBy: "Employee",
      },
    });
    created++;
  }
  await db.appraisalRecord.update({ where: { id: appraisalId }, data: { status: "GoalProposed" } });
  return { created };
}

/** Keputusan atasan atas usulan MBO (§26-4: terima → masuk daftar resmi / tolak). */
export async function approveProposal(
  db: TenantDb, actor: GoalActor, appraisalId: string, decision: "approve" | "reject",
): Promise<{ kept: number; removed: number }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang memutuskan usulan KPI");
  }
  if (a.status !== "GoalProposed") throw new Error("Tidak ada usulan KPI yang menunggu keputusan");
  const proposals = a.kpis.filter((k) => k.proposedBy === "Employee");
  if (decision === "reject") {
    await db.appraisalKpi.deleteMany({ where: { appraisalId, proposedBy: "Employee" } });
    await db.appraisalRecord.update({ where: { id: appraisalId }, data: { status: "Enrolled" } });
    return { kept: 0, removed: proposals.length };
  }
  await db.appraisalKpi.updateMany({
    where: { appraisalId, proposedBy: "Employee" },
    data: { proposedBy: "Manager" }, // diterima → masuk daftar resmi (atasan kini pemilik baris)
  });
  await db.appraisalRecord.update({ where: { id: appraisalId }, data: { status: "Enrolled" } });
  return { kept: proposals.length, removed: 0 };
}

/** Submit target — kunci (§35-3: Σbobot=100, 3–8 item, satuan+ambang; Boolean
 *  wajib terdefinisi 0/1). Aktor: atasan snapshot / HR. */
export async function lockGoals(
  db: TenantDb, actor: GoalActor, appraisalId: string,
): Promise<{ docNo: string; kpiCount: number; notified: boolean }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat mengunci target (§35-3)");
  }
  assertGoalWindow(a);
  const errors = validateDraft(a.kpis);
  const hard = errors.filter((e) =>
    e.includes("Belum ada baris KPI") || e.includes("Total bobot") || e.includes("ideal 3–8") || e.includes("terlalu banyak") ||
    e.includes("ambang gagal belum diisi") || e.includes("bobot harus > 0") || e.includes("Boolean") ||
    e.includes("Metric / Measure of Success"));
  if (hard.length > 0) throw new Error(`Submit ditolak (§35-3): ${hard[0]}`);

  await db.appraisalRecord.update({
    where: { id: appraisalId },
    data: { status: "GoalApproved", kpiTotalWeight: a.kpis.reduce((s, k) => s + k.weight, 0) },
  });

  // §26-6 — ringkasan target ke karyawan: notifikasi in-app (ESS "Target Saya")
  let notified = false;
  const user = await db.appUser.findFirst({ where: { employeeId: a.employeeId }, select: { id: true } });
  if (user) {
    const n = await db.notification.create({
      data: {
        appUserId: user.id,
        title: `Target kinerja Anda terkunci — ${a.cycle.code}`,
        body: `Atasan Anda telah menetapkan ${a.kpis.length} KPI untuk periode ${a.cycle.code}. Buka Target Saya untuk melihat rincian target.`,
        kind: "performance",
        link: "ess:my-goals",
      },
    }).catch(() => null);
    notified = n != null;
  }
  return { docNo: a.docNo, kpiCount: a.kpis.length, notified };
}

// ============================================================================
// IMPOR EXCEL TARGET (§18.5 AM2 — D16: .xlsx ≤2MB ≤500 baris; commit hanya
// baris valid; error per sel dengan alasan; hasil = DRAF menunggu review+submit)
// ============================================================================

export const IMPORT_TARGET_MAX_ROWS = 500;
/** Formula dropdown kolom kritis (literal Excel — teknis, dwibahasa di dalamnya). */
const CRIT_DROPDOWN = '"Ya,Tidak,Yes,No"';
export const IMPORT_TARGET_MAX_BYTES = 2 * 1024 * 1024;

/** Header template dwibahasa — indeks kolom TETAP (parser mencari via normalisasi). */
export const TARGET_COLUMNS = [
  { key: "employeeNo", id: "Kode Karyawan", en: "Employee No" },
  { key: "fullName", id: "Nama Karyawan", en: "Employee Name" },
  { key: "kpi", id: "Judul / Kode KPI", en: "KPI Title / Code" },
  { key: "polarity", id: "Polaritas (Higher/Lower/Boolean)", en: "Polarity (Higher/Lower/Boolean)" },
  { key: "unit", id: "Satuan", en: "Unit" },
  { key: "threshold", id: "Ambang Gagal", en: "Threshold (Fail)" },
  { key: "target", id: "Target", en: "Target" },
  { key: "stretch", id: "Stretch (opsional)", en: "Stretch (optional)" },
  { key: "weight", id: "Bobot (%)", en: "Weight (%)" },
  { key: "critical", id: "Kritis (Ya/Tidak)", en: "Critical (Yes/No)" },
  { key: "metric", id: "Metric / Measure of Success\n(wajib — baris \"1: …\" s.d. \"5: …\"; kosong + kode pustaka → default pustaka)", en: "Metric / Measure of Success\n(required — lines \"1: …\" through \"5: …\"; blank + a library code → the library default)" },
] as const;

/** Buat workbook template .xlsx dwibahasa (sheet instruksi + data + contoh + dropdown). */
export async function buildTargetTemplateXlsx(cycleCode: string, example: {
  employeeNo: string; fullName: string; kpi: string; polarity: string; unit: string;
  threshold: string; target: string; stretch: string; weight: string; critical: string;
  metric: string;
}): Promise<Buffer> {
  // dinamis: exceljs di-import di route (server) — di sini dipakai via dynamic import
  // supaya service tetap murni logika.
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RekanKerja HRIS";

  const instr = wb.addWorksheet("Instruksi - Instructions");
  instr.columns = [{ width: 4 }, { width: 110 }];
  // judul dwibahasa (interpolasi kode siklus — di luar array konstanta)
  instr.addRow({ 1: "", 2: `TEMPLATE IMPOR TARGET KPI — SIKLUS ${cycleCode}` });
  instr.addRow({ 1: "", 2: `TARGET KPI IMPORT TEMPLATE — CYCLE ${cycleCode}` });
  // langkah instruksi pasangan dwibahasa [ID, EN] — konvensi R3 audit
  const INSTR_STEPS: Record<string, [string, string]> = {
    s1: [
      "1. Isi sheet \"Data\" — maksimal 500 baris; hanya kolom A–K yang boleh diisi.",
      "1. Fill the \"Data\" sheet — max 500 rows; only columns A–K.",
    ],
    s2: [
      "2. Kolom \"Kode Karyawan\" wajib sesuai data HR (employeeNo).",
      "2. The \"Employee No\" column must match HR data (employeeNo).",
    ],
    s3: [
      "3. Kolom \"Judul / Kode KPI\": isi KODE KPI pustaka (terikat tarikan otomatis bila bersumber) ATAU judul bebas.",
      "3. \"KPI Title / Code\": fill the library KPI CODE (auto-bound when sourced) OR a free-form title.",
    ],
    s4: [
      "4. Bobot per karyawan nantinya harus berjumlah tepat 100 — pratinjau memberi peringatan, submit atasan memvalidasi keras.",
      "4. Weights per employee must total exactly 100 — the preview warns; the manager submit enforces it.",
    ],
    s5: [
      "5. Kolom \"Metric / Measure of Success\" — deskriptor ukuran keberhasilan, satu baris per level 1–5 (format \"1: …\" s.d. \"5: …\"); kosong + kode pustaka → default pustaka. Submit menolak KPI tanpa metric lengkap.",
      "5. \"Metric / Measure of Success\" — the success-measure descriptors, one line per level 1–5 (format \"1: …\" through \"5: …\"); blank + a library code → the library default. Submit rejects KPIs with incomplete metrics.",
    ],
    s6: [
      "6. Hasil impor = DRAF (belum submit). Setiap peserta tetap menunggu review + submit oleh atasan.",
      "6. Import results are DRAFT rows (not submitted). Each participant still awaits manager review + submit.",
    ],
    s7: [
      "7. Baris yang tidak valid TIDAK membatalkan baris lain — perbaiki baris merah lalu unggah ulang.",
      "7. Invalid rows never cancel other rows — fix the red rows and re-upload.",
    ],
  };
  for (const steps of Object.values(INSTR_STEPS)) {
    instr.addRow({ 1: "", 2: steps[0] });
    instr.addRow({ 1: "", 2: steps[1] });
  }
  instr.addRow({ 1: "", 2: "" });
  instr.getRow(1).font = { bold: true, size: 13 };

  const data = wb.addWorksheet("Data");
  data.columns = [
    { header: TARGET_COLUMNS[0].id + "\n" + TARGET_COLUMNS[0].en, width: 16 },
    { header: TARGET_COLUMNS[1].id + "\n" + TARGET_COLUMNS[1].en, width: 26 },
    { header: TARGET_COLUMNS[2].id + "\n" + TARGET_COLUMNS[2].en, width: 34 },
    { header: TARGET_COLUMNS[3].id + "\n" + TARGET_COLUMNS[3].en, width: 16 },
    { header: TARGET_COLUMNS[4].id + "\n" + TARGET_COLUMNS[4].en, width: 10 },
    { header: TARGET_COLUMNS[5].id + "\n" + TARGET_COLUMNS[5].en, width: 14 },
    { header: TARGET_COLUMNS[6].id + "\n" + TARGET_COLUMNS[6].en, width: 12 },
    { header: TARGET_COLUMNS[7].id + "\n" + TARGET_COLUMNS[7].en, width: 14 },
    { header: TARGET_COLUMNS[8].id + "\n" + TARGET_COLUMNS[8].en, width: 12 },
    { header: TARGET_COLUMNS[9].id + "\n" + TARGET_COLUMNS[9].en, width: 14 },
    { header: TARGET_COLUMNS[10].id + "\n" + TARGET_COLUMNS[10].en, width: 70 },
  ];
  data.getRow(1).font = { bold: true };
  data.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  data.getRow(2).alignment = { wrapText: true, vertical: "top" };
  data.addRow([example.employeeNo, example.fullName, example.kpi, example.polarity, example.unit,
    example.threshold, example.target, example.stretch, example.weight, example.critical, example.metric]);
  data.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };

  // dropdown validasi: polaritas + kritis
  for (let r = 3; r <= 502; r++) {
    data.getCell(`D${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: ['"Higher,Lower,Boolean"'],
    };
    data.getCell(`J${r}`).dataValidation = {
      type: "list", allowBlank: true, formulae: [CRIT_DROPDOWN],
    };
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export interface ImportTargetRow {
  rowNo: number;
  employeeNo: string;
  fullName: string;
  kpi: string;
  polarity: string;
  unit: string;
  threshold: string;
  target: string;
  stretch: string;
  weight: string;
  critical: string;
  metric: string;
  measureMode: string; // Numeric | Descriptor
  valid: boolean;
  errors: { field: string; message: string }[];
  // terisi server saat valid:
  appraisalId?: string;
  kpiDefId?: string | null;
  skip?: string | null; // alasan lompati (sudah punya baris)
}

/** Normalisasi header seluler (pola machine-import: norm + kata kunci).
 *  Kamus parser teknis (bukan teks UI) — dibangun via .split agar kamus
 *  dwibahasa header Excel tidak dihitung audit sebagai string display. */
const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** Kamus nilai kritis Excel (Ya/Tidak/Yes/No — teknis parser). */
const CRIT_WORDS = "ya tidak yes no y n".split(" ");
const CRIT_YES = "ya yes y".split(" ");

const HEADER_KEYS: Record<string, string[]> = {
  employeeNo: "employeeno kodekaryawan employee idkaryawan karyawan no".split(" "),
  fullName: "nama namakaryawan employeename name".split(" "),
  kpi: "judulkodekpi judulkpi kpi kodekpi kpicode kpicodekpi".split(" "),
  polarity: "polaritas polarity".split(" "),
  unit: "satuan unit uom".split(" "),
  threshold: "ambanggagal ambang threshold ambanggagalthresholdfail".split(" "),
  target: "target".split(" "),
  stretch: "stretch stretchopsional".split(" "),
  weight: "bobot weight bobotpersen".split(" "),
  critical: "kritis critical krisisyatidak".split(" "),
  metric: "metric ukurankeberhasilan measureofsuccess metricukurankeberhasilan metricmeasureofsuccess".split(" "),
};

/** Pratinjau impor: parse .xlsx + validasi per sel (D16). */
export async function importTargetsPreview(
  db: TenantDb, actor: GoalActor, cycleId: string, file: { buffer: Buffer; name: string; type: string },
): Promise<{
  rows: ImportTargetRow[];
  counts: { valid: number; error: number; skip: number };
  cycleCode: string;
}> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "GoalSetting") throw new Error("Impor target hanya sah saat fase GoalSetting (§35-26)");
  if (file.buffer.byteLength > IMPORT_TARGET_MAX_BYTES) throw new Error("Ukuran file melebihi 2 MB (D16)");
  if (!/\.xlsx$/i.test(file.name) && file.type !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    throw new Error("Hanya file .xlsx yang diterima (D16)");
  }
  if (file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) {
    throw new Error("Berkas bukan .xlsx yang sah (magic number)");
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Data") ?? wb.worksheets[wb.worksheets.length - 1];
  if (!ws) throw new Error("Sheet \"Data\" tidak ditemukan");

  // peta header (baris 1) — dwibahasa via kata kunci
  const headerRow = ws.getRow(1);
  const colOf: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = norm(String(cell.text ?? ""));
    for (const [key, words] of Object.entries(HEADER_KEYS)) {
      if (colOf[key]) continue;
      if (words.some((w) => h === w || h.includes(w))) colOf[key] = col;
    }
  });
  for (const k of ["employeeNo", "kpi", "target", "weight"]) {
    if (!colOf[k]) throw new Error(`Kolom wajib tidak ditemukan: ${k} — gunakan template resmi (Unduh Template)`);
  }

  // peserta siklus (validasi cepat employeeNo → appraisal)
  const appraisals = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, cycleId) as never,
    include: { employee: { select: { employeeNo: true, fullName: true, status: true } }, kpis: { select: { id: true } } },
  });
  const byEmpNo = new Map(appraisals.map((a) => [a.employee.employeeNo.toUpperCase(), a]));
  const defs = await db.kpiDefinition.findMany({ where: { status: "Active" }, select: { id: true, code: true, name: true, polarity: true, unit: true, active: true } });
  const defByCode = new Map(defs.map((d) => [d.code.toUpperCase(), d]));
  const defByName = new Map(defs.map((d) => [d.name.toUpperCase(), d]));

  const rows: ImportTargetRow[] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1 || rn > IMPORT_TARGET_MAX_ROWS + 2) return;
    const get = (key: string): string => colOf[key] ? String(row.getCell(colOf[key]).text ?? "").trim() : "";
    const employeeNo = get("employeeNo");
    if (!employeeNo && !get("kpi")) return; // baris kosong dilewati
    const r: ImportTargetRow = {
      rowNo: rn, employeeNo, fullName: get("fullName"), kpi: get("kpi"),
      polarity: get("polarity"), unit: get("unit"), threshold: get("threshold"),
      target: get("target"), stretch: get("stretch"), weight: get("weight"), critical: get("critical"),
      metric: get("metric"),
      measureMode: "Numeric",
      valid: true, errors: [],
    };
    const err = (field: string, message: string) => { r.valid = false; r.errors.push({ field, message }); };

    // 1 — karyawan
    const ap = byEmpNo.get(employeeNo.toUpperCase());
    if (!employeeNo) err("employeeNo", "Kode karyawan kosong");
    else if (!ap) err("employeeNo", `Karyawan ${employeeNo} bukan peserta siklus / tidak ditemukan`);
    else if (ap.employee.status !== "Active") err("employeeNo", `Karyawan ${employeeNo} tidak aktif`);
    else if ((APPRAISAL_LOCKED as readonly string[]).includes(ap.status)) err("employeeNo", `Target ${employeeNo} sudah terkunci`);
    else r.appraisalId = ap.id;

    // 2 — KPI (kode pustaka → bind; selain itu judul bebas)
    if (!r.kpi) err("kpi", "Judul/kode KPI kosong");
    else {
      const d = defByCode.get(r.kpi.toUpperCase()) ?? defByName.get(r.kpi.toUpperCase());
      if (d) { r.kpiDefId = d.id; }
    }

    // 3 — polaritas
    const pol = r.polarity || (r.kpiDefId ? defByCode.get(r.kpi.toUpperCase())?.polarity ?? "Higher" : "Higher");
    if (!["Higher", "Lower", "Boolean"].includes(pol)) err("polarity", `Polaritas tidak valid: "${r.polarity}" (Higher/Lower/Boolean)`);

    // 4 — angka
    const target = numOrNull(r.target);
    if (r.target === "") err("target", "Target kosong");
    else if (target == null) err("target", `Target bukan angka: "${r.target}"`);
    const weight = numOrNull(r.weight);
    if (r.weight === "") err("weight", "Bobot kosong");
    else if (weight == null) err("weight", `Bobot bukan angka: "${r.weight}"`);
    else if (weight <= 0 || weight > 100) err("weight", `Bobot harus 1–100: "${r.weight}"`);
    const threshold = numOrNull(r.threshold);
    if (r.threshold !== "" && threshold == null) err("threshold", `Ambang bukan angka: "${r.threshold}"`);
    const stretch = numOrNull(r.stretch);
    if (r.stretch !== "" && stretch == null) err("stretch", `Stretch bukan angka: "${r.stretch}"`);
    // 4b — Metric / Measure of Success: parser baris "1: …" s.d. "5: …".
    // Kolom wajib sebelum submit — bila diisi, HARUS berisi 5 level lengkap;
    // kosong diperbolehkan HANYA bila kode pustaka punya metric default
    // (gerbang submit atasan tetap menolak KPI tanpa metric lengkap).
    if (r.metric !== "") {
      const levels = parseMetricExcel(r.metric);
      if (!isMetricComplete(levels)) {
        err("metric", "Metric harus berisi deskriptor level 1–5 — satu baris per level, format \"1: …\" s.d. \"5: …\"");
      }
    }

    // 5 — duplikat dalam file (karyawan+KPI)
    const dkey = `${employeeNo.toUpperCase()}|${r.kpi.toUpperCase()}`;
    if (seen.has(dkey)) err("kpi", `Duplikat baris (karyawan+KPI sama sudah ada di atas)`);
    else seen.add(dkey);

    // 6 — kritis
    const critRaw = norm(r.critical);
    if (r.critical !== "" && !CRIT_WORDS.includes(critRaw)) {
      err("critical", `Kritis harus Ya/Tidak: "${r.critical}"`);
    }

    // 7 — peserta sudah punya baris → default LOMPATI (D16 "menimpa harus eksplisit")
    if (r.valid && ap && ap.kpis.length > 0) {
      r.skip = `Sudah punya ${ap.kpis.length} baris KPI — lompati (timpa harus eksplisit)`;
    }
    rows.push(r);
  });
  if (rows.length > IMPORT_TARGET_MAX_ROWS) throw new Error(`Maksimal ${IMPORT_TARGET_MAX_ROWS} baris per file (D16)`);

  const valid = rows.filter((r) => r.valid && !r.skip).length;
  const skip = rows.filter((r) => r.valid && r.skip).length;
  return { rows, counts: { valid, error: rows.filter((r) => !r.valid).length, skip }, cycleCode: cycle.code };
}

/** Commit impor — HANYA baris valid (D16); hasil draf menunggu review+submit. */
export async function importTargetsCommit(
  db: TenantDb, actor: GoalActor, cycleId: string,
  rows: (Pick<ImportTargetRow, "employeeNo" | "kpi" | "kpiDefId" | "polarity" | "unit" | "threshold" | "target" | "stretch" | "weight" | "critical" | "metric"> & { rowNo: number })[],
): Promise<{ created: number; skipped: number; cycleCode: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "GoalSetting") throw new Error("Impor target hanya sah saat fase GoalSetting (§35-26)");
  if (rows.length > IMPORT_TARGET_MAX_ROWS) throw new Error(`Maksimal ${IMPORT_TARGET_MAX_ROWS} baris (D16)`);

  const appraisals = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, cycleId) as never,
    include: { employee: { select: { employeeNo: true } }, kpis: { select: { id: true } } },
  });
  const byEmpNo = new Map(appraisals.map((a) => [a.employee.employeeNo.toUpperCase(), a]));

  let created = 0, skipped = 0;
  for (const r of rows) {
    const ap = byEmpNo.get(r.employeeNo.toUpperCase());
    if (!ap) { skipped++; continue; }
    if ((APPRAISAL_LOCKED as readonly string[]).includes(ap.status) || ap.kpis.length > 0) { skipped++; continue; }
    const pol = ["Higher", "Lower", "Boolean"].includes(r.polarity) ? r.polarity : "Higher";
    const critRaw = norm(r.critical ?? "");
    // metric: eksplisit Excel menang; kosong + kode pustaka → default pustaka;
    // bila pustaka mode Descriptor → ikut (KPI kualitatif dinilai 1–5)
    let metricLevelsJson = metricLevelsJsonOf(parseMetricExcel(r.metric ?? ""));
    let measureMode: "Numeric" | "Descriptor" = "Numeric";
    if (r.kpiDefId) {
      const def = await db.kpiDefinition.findUnique({ where: { id: r.kpiDefId }, select: { metricLevelsJson: true, measureMode: true } });
      if (def) {
        if (metricLevelsJson == null) metricLevelsJson = def.metricLevelsJson;
        if (def.measureMode === "Descriptor") measureMode = "Descriptor";
      }
    }
    const descriptor = measureMode === "Descriptor";
    await db.appraisalKpi.create({
      data: {
        appraisalId: ap.id,
        kpiDefId: r.kpiDefId ?? null,
        title: r.kpi, polarity: descriptor ? "Higher" : pol,
        unit: descriptor ? "level" : (r.unit || "%"),
        measureMode,
        metricLevelsJson,
        thresholdMin: descriptor ? null : numOrNull(r.threshold),
        target: descriptor ? 5 : (numOrNull(r.target) ?? 0),
        stretchValue: descriptor ? null : numOrNull(r.stretch),
        weight: numOrNull(r.weight) ?? 10,
        isCritical: CRIT_YES.includes(critRaw),
        dataSource: "Manual",
        origin: "Imported", proposedBy: "Manager",
      },
    });
    created++;
  }
  return { created, skipped, cycleCode: cycle.code };
}

// ============================================================================
// PENGINGAT TERJADWAL (§18.8 — H-7 & H-1 sebelum jendela fase tutup; dedupe
// via ActivityLog "Reminder" pola scheduler)
// ============================================================================

export interface PerfReminderOut { cycleCode: string; phase: string; band: number; recipients: number }

/** Dipanggil scheduler-service per tenant. Nudge otomatis kanal default
 *  (in-app) ke atasan peserta tertinggal; dedupe per (cycle, phase, band, hari). */
export async function perfGoalReminders(db: TenantDb, push: (db: TenantDb, appraisalIds: string[], title: string) => Promise<number>): Promise<PerfReminderOut[]> {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const cycles = await db.performanceCycle.findMany({
    where: { status: { in: ["GoalSetting", "Ongoing", "Assessment"] } },
    include: { appraisals: { select: { id: true, status: true, managerId: true, acknowledgedAt: true } } },
  });
  const out: PerfReminderOut[] = [];
  const { lagOf } = await import("@/rekankerja/performance/services/perf-cycle-service");
  for (const c of cycles) {
    const ends: { phase: string; date: Date | null }[] = [
      { phase: "goal", date: dayOf(c.goalEnd) },
      { phase: "self", date: dayOf(c.selfEnd) },
      { phase: "manager", date: dayOf(c.mgrEnd) },
    ];
    for (const { phase, date } of ends) {
      if (!date) continue;
      const days = Math.round((date.getTime() - today.getTime()) / DAY_MS);
      const band = days === 7 || days === 1 ? days : days <= 0 ? 1 : null; // H-7 / H-1 (dan lewat tenggat → 1)
      if (band == null) continue;
      const key = `reminder:perf:${c.id}:${phase}:H-${band}`;
      const dueKey = date.toISOString().slice(0, 10);
      // klaim dedupe (pola ActivityLog Reminder — race aman antar proses via partial index bila ada)
      const claimed = await db.activityLog.findFirst({ where: { action: "Reminder", entity: "Scheduler", entityId: key } });
      if (claimed) continue;
      await db.activityLog.create({
        data: { actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key, detail: `Pengingat fase kinerja ${phase} ${c.code} (H-${band}, tenggat ${dueKey})` },
      }).catch(() => { /* dedupe best-effort */ });
      const lagging = c.appraisals
        .filter((a) => lagOf(a.status, c.status, a.acknowledgedAt != null).lagging)
        .map((a) => a.id);
      if (!lagging.length) continue;
      const sent = await push(db, lagging, `Pengingat: jendela ${phase === "goal" ? "penetapan target" : phase === "self" ? "penilaian diri" : "penilaian atasan"} siklus ${c.code} ditutup ${days <= 0 ? "hari ini" : `${days} hari lagi`}`);
      out.push({ cycleCode: c.code, phase, band, recipients: sent });
    }
  }
  return out;
}
