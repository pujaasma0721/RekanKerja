import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { APPRAISAL_LOCKED } from "@/rekankerja/performance/services/perf-cycle-service";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";
import { aggregate360 } from "@/rekankerja/performance/services/perf-360-service";
import { scanComments, type BiasFlag } from "@/rekankerja/performance/services/bias-lexicon";

// ============================================================================
// PERFORMANCE — Service penilaian akhir periode (P3 — DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P3, Alur 5 §29, formula §16, guard §35-7/8/27/30/31):
//   • Fase SELF (ESS §29-2): submitSelf — kompetensi 1..5 wajib semua +
//     usulan finalActual utk KPI manual + bukti note → status SelfDone.
//   • Fase MANAGER (§29-4): saveManagerScore (AUTOSAVE draf §18.7 — tidak
//     mengubah status) → submitManager (guard keras §35-8: semua finalActual
//     terisi + Σbobot=100 + komentar wajib utk skor ekstrem ≤2/=5 + 360
//     selesai bila diaktifkan) → managerScore dihitung SERVER §16.
//   • PULL AUTO-SOURCES §18.6: 6 binding (attendance presence/late, overtime
//     verified, leave unplanned, recruitment time_to_fill, fulfilled_h) —
//     pratinjau nilai baru vs lama + bukti autoValueJson sebelum diterapkan.
//   • IMPOR REALISASI §18.5 (D16): template .xlsx dwibahasa + pratinjau per
//     sel + commit hanya baris valid (mengisi finalActual TANPA mengubah
//     status — impor ≠ submit).
//   • ESTIMASI DAMPAK §18.12 (guard §35-31): stateless previewImpact — pScore
//     §16 dari draf → RatingScale → MeritMatrix aktif → bulan bonus + %
//     kenaikan; TANPA nominal Rp (D21); hanya atasan/HR.
//   • AI ASSIST §18.11 (D20 + guard §35-30): compose-only dari poin penilai —
//     melarang menambah fakta/metrik, TIDAK menghasilkan angka skor; server-
//     side gateway (zai-client); rate-limit 20/jam/user via ActivityLog;
//     kegagalan TENANG (unavailable flag — form tetap 100% berfungsi).
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

/** Bulatkan 6 desimal — membersihkan noise float32 exceljs (mis. 99.2
 *  terbaca 99.19999694824219) tanpa mengubah nilai sahih. */
function roundImport(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

export interface AppraisalActor {
  /** employeeId aktor — null = akun HR tanpa data karyawan (akses penuh HR). */
  employeeId: string | null;
  /** true = super admin (akses semua peserta). */
  superAdmin: boolean;
}

/** Peserta yang terlihat aktor (row-level ringan §11.3). */
function visibleWhere(actor: AppraisalActor, cycleId: string): Record<string, unknown> {
  const base: Record<string, unknown> = { cycleId };
  if (!actor.superAdmin && actor.employeeId) base.managerId = actor.employeeId;
  return base;
}

/** Aktor boleh mengelola penilaian peserta ini (atasan snapshot / HR). */
function isManagerOf(actor: AppraisalActor, appraisal: { managerId: string | null }): boolean {
  if (actor.superAdmin) return true;
  return !!actor.employeeId && appraisal.managerId === actor.employeeId;
}

async function mustAppraisal(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: {
        select: {
          id: true, code: true, name: true, status: true,
          periodStart: true, periodEnd: true,
          selfStart: true, selfEnd: true, mgrStart: true, mgrEnd: true,
          weightsJson: true, feedback360: true, publishAt: true,
        },
      },
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true, positionId: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
      comps: { include: { competency: { select: { id: true, code: true, name: true, kind: true, levelsJson: true, active: true, status: true } } } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  return a;
}

// ============================================================================
// BOBOT KOMPONEN + BARIS KOMPETENSI (idempoten — tabel mulai kosong di P3)
// ============================================================================

export interface ComponentWeights { kpi: number; competency: number; core: number }

function parseWeights(raw: string | null | undefined): ComponentWeights | null {
  if (!raw) return null;
  try {
    const w = JSON.parse(raw) as { kpi?: number; competency?: number; core?: number };
    const out = { kpi: Number(w.kpi ?? 0), competency: Number(w.competency ?? 0), core: Number(w.core ?? 0) };
    if (![out.kpi, out.competency, out.core].every((x) => Number.isFinite(x) && x >= 0)) return null;
    if (out.kpi + out.competency + out.core !== 100) return null;
    return out;
  } catch {
    return null;
  }
}

/** Bobot komponen §16: override siklus → template peserta → default 70/20/10. */
export async function resolveWeights(db: TenantDb, appraisal: { templateId: string | null; cycle: { weightsJson: string } }): Promise<ComponentWeights> {
  const fromCycle = parseWeights(appraisal.cycle.weightsJson);
  if (fromCycle) return fromCycle;
  if (appraisal.templateId) {
    const tpl = await db.performanceTemplate.findUnique({ where: { id: appraisal.templateId }, select: { weightsJson: true } });
    const fromTpl = parseWeights(tpl?.weightsJson);
    if (fromTpl) return fromTpl;
  }
  return { kpi: 70, competency: 20, core: 10 };
}

/** Buat baris kompetensi bila belum ada (idempoten): dari template peserta
 *  bila ada, ELSE semua Competency aktif (12 di MII). Bobot dari template
 *  item, else rata 100/n — TIDAK disimpan di kolom (skema tanpa kolom weight
 *  §15) melainkan di-resolve ulang deterministik saat kalkulasi. */
export async function ensureCompRows(db: TenantDb, appraisal: { id: string; templateId: string | null }): Promise<number> {
  const existing = await db.appraisalCompetencyScore.count({ where: { appraisalId: appraisal.id } });
  if (existing > 0) return 0;
  let items: { competencyId: string }[] = [];
  if (appraisal.templateId) {
    const tpl = await db.performanceTemplate.findUnique({
      where: { id: appraisal.templateId },
      include: { items: { where: { kind: "Competency" } } },
    });
    if (tpl && tpl.items.length > 0) {
      const comps = await db.competency.findMany({
        where: { id: { in: tpl.items.map((i) => i.refId) }, active: true, status: "Active" },
        select: { id: true },
      });
      const activeIds = new Set(comps.map((c) => c.id));
      items = tpl.items.filter((i) => activeIds.has(i.refId)).map((i) => ({ competencyId: i.refId }));
    }
  }
  if (items.length === 0) {
    const comps = await db.competency.findMany({
      where: { active: true, status: "Active" },
      select: { id: true },
      orderBy: { code: "asc" },
    });
    items = comps.map((c) => ({ competencyId: c.id }));
  }
  let created = 0;
  for (const it of items) {
    await db.appraisalCompetencyScore
      .upsert({
        where: { appraisalId_competencyId: { appraisalId: appraisal.id, competencyId: it.competencyId } },
        create: { appraisalId: appraisal.id, competencyId: it.competencyId, score: 0 },
        update: {},
      })
      .catch(() => { /* race antar proses — baris sudah dibuat */ });
    created++;
  }
  return created;
}

/** Bobot kompetensi per baris (deterministik — dari template peserta bila
 *  ada, else rata 100/n). Dipakai formula self & manager §16. */
export async function compWeightsOf(
  db: TenantDb,
  appraisal: { id: string; templateId: string | null },
  compIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (compIds.length === 0) return map;
  let fromTpl: { competencyId: string; weight: number }[] = [];
  if (appraisal.templateId) {
    const tpl = await db.performanceTemplate.findUnique({
      where: { id: appraisal.templateId },
      include: { items: { where: { kind: "Competency" } } },
    });
    if (tpl) {
      const idSet = new Set(compIds);
      fromTpl = tpl.items.filter((i) => idSet.has(i.refId)).map((i) => ({ competencyId: i.refId, weight: i.weight }));
    }
  }
  const tplMap = new Map(fromTpl.map((t) => [t.competencyId, t.weight]));
  const covered = fromTpl.reduce((s, t) => s + (t.weight > 0 ? t.weight : 0), 0);
  const rest = compIds.filter((id) => !tplMap.has(id) || (tplMap.get(id) ?? 0) <= 0);
  // bobot sisa dibagi rata utk kompetensi di luar template (jarang — template
  // idealnya mencakup semua); total dinormalisasi tepat 100.
  const each = rest.length > 0 ? Math.max(100 - covered, 0) / rest.length : 0;
  for (const id of compIds) map.set(id, tplMap.get(id) ?? round(each));
  return map;
}

// ============================================================================
// FORMULA §16 (otoritatif server)
// ============================================================================

/** Skor satu KPI §16 — polaritas + stretch; clamp 0..120 (120 hanya stretch). */
export function scoreKpiItem(k: {
  polarity: string; thresholdMin: number | null; target: number; stretchValue: number | null; finalActual: number | null;
}): number {
  const A = k.finalActual;
  if (A == null) return 0; // guard §16: null → 0 di fase final
  if (k.polarity === "Boolean") return A >= 1 ? 100 : 0;
  const T = k.target;
  if (k.polarity === "Lower") {
    const F = k.thresholdMin ?? T;
    if (F === T) return A <= T ? 100 : 0;
    return clamp(((F - A) / (F - T)) * 100, 0, 100);
  }
  // Higher
  const F = k.thresholdMin ?? T;
  if (F === T) return A >= T ? 100 : 0;
  let s = ((A - F) / (T - F)) * 100;
  const S = k.stretchValue;
  if (S != null && S > T && A > T) {
    s = Math.min(120, 100 + ((A - T) / (S - T)) * 20);
  }
  return clamp(s, 0, S != null && S > T ? 120 : 100);
}

interface CalcKpi { polarity: string; thresholdMin: number | null; target: number; stretchValue: number | null; weight: number; finalActual: number | null }

/** Σ skor×bobot / Σbobot (nilai null dihitung 0 — pemanggil menandai kelengkapan). */
function kpiComponent(kpis: CalcKpi[]): number {
  if (kpis.length === 0) return 0;
  const sumW = kpis.reduce((s, k) => s + k.weight, 0);
  if (sumW <= 0) return 0;
  return kpis.reduce((s, k) => s + scoreKpiItem(k) * k.weight, 0) / sumW;
}

/** Σ (score/5×100 × bobot)/Σbobot — score 1..5 (0 = belum dinilai → dihitung 0). */
function compComponent(rows: { score: number; weight: number }[]): number {
  if (rows.length === 0) return 0;
  const sumW = rows.reduce((s, r) => s + r.weight, 0);
  if (sumW <= 0) return 0;
  return rows.reduce((s, r) => s + (clamp(r.score, 0, 5) / 5) * 100 * r.weight, 0) / sumW;
}

/** managerScore §16 = wKPI×kpi + wKomp×komp + wCore×core (bobot dinormalisasi
 *  atas komponen yang tersedia — fallback bila tenant tanpa kompetensi CoreValue). */
export function combineComponents(
  weights: ComponentWeights,
  comps: { kpi: number | null; competency: number | null; core: number | null },
): number {
  let num = 0;
  let den = 0;
  if (weights.kpi > 0 && comps.kpi != null) { num += weights.kpi * comps.kpi; den += weights.kpi; }
  if (weights.competency > 0 && comps.competency != null) { num += weights.competency * comps.competency; den += weights.competency; }
  if (weights.core > 0 && comps.core != null) { num += weights.core * comps.core; den += weights.core; }
  return den > 0 ? round(num / den, 2) : 0;
}

// ============================================================================
// LIST PESERTA + DETAIL (§17 GET appraisals)
// ============================================================================

/** Progress pengisian fase penilaian §18.7 (finalActual + skor kompetensi). */
export function appraisalProgressOf(kpis: { finalActual: number | null }[], comps: { score: number }[]): { pct: number; kpiFilled: number; kpiTotal: number; compScored: number; compTotal: number } {
  const kpiTotal = kpis.length;
  const kpiFilled = kpis.filter((k) => k.finalActual != null).length;
  const compTotal = comps.length;
  const compScored = comps.filter((c) => c.score >= 1 && c.score <= 5).length;
  const total = kpiTotal + compTotal;
  return {
    pct: total === 0 ? 0 : Math.round(((kpiFilled + compScored) / total) * 100),
    kpiFilled, kpiTotal, compScored, compTotal,
  };
}

export async function listAppraisals(
  db: TenantDb, actor: AppraisalActor, opt: { cycleId: string; q?: string; status?: string; mine?: boolean },
): Promise<Record<string, unknown>[]> {
  const where = visibleWhere(actor, opt.cycleId);
  if (opt.mine && actor.employeeId) where.employeeId = actor.employeeId;
  if (opt.status) where.status = opt.status;
  const rows = await db.appraisalRecord.findMany({
    where: where as never,
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnitId: true } },
      manager: { select: { fullName: true } },
      kpis: { select: { finalActual: true } },
      comps: { select: { score: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });
  const q = (opt.q ?? "").toLowerCase();
  return rows
    .filter((r) => !q || r.employee.fullName.toLowerCase().includes(q) || r.employee.employeeNo.toLowerCase().includes(q) || r.docNo.toLowerCase().includes(q))
    .map((r) => {
      const prog = appraisalProgressOf(r.kpis, r.comps);
      return {
        appraisalId: r.id, docNo: r.docNo, status: r.status,
        employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
        managerName: r.manager?.fullName ?? null,
        kpiCount: r.kpis.length, compCount: r.comps.length,
        progressPct: prog.pct,
        selfScore: r.selfScore, managerScore: r.managerScore, finalScore: r.finalScore, finalRating: r.finalRating,
        selfDone: r.selfScore != null, managerDone: r.managerScore != null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
}

export async function appraisalDetail(db: TenantDb, appraisalId: string) {
  const a = await mustAppraisal(db, appraisalId);
  await ensureCompRows(db, a); // self-healing (idempoten)
  const fresh = await mustAppraisal(db, appraisalId); // baris kompetensi baru terbaca
  const unit = fresh.employee.orgUnitId
    ? await db.orgUnit.findUnique({ where: { id: fresh.employee.orgUnitId }, select: { name: true } })
    : null;
  const pos = fresh.employee.positionId
    ? await db.position.findUnique({ where: { id: fresh.employee.positionId }, select: { title: true } })
    : null;
  const weights = await resolveWeights(db, fresh);
  const compIds = fresh.comps.map((c) => c.competencyId);
  const wOf = await compWeightsOf(db, fresh, compIds);

  const kpis = fresh.kpis.map((k) => ({
    id: k.id, kpiDefId: k.kpiDefId, title: k.title, polarity: k.polarity, unit: k.unit,
    metricText: k.metricText,
    thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
    weight: k.weight, isCritical: k.isCritical, dataSource: k.dataSource,
    autoValueJson: k.autoValueJson, midActual: k.midActual, finalActual: k.finalActual,
    evidenceJson: k.evidenceJson, proposedBy: k.proposedBy, origin: k.origin,
  }));
  const comps = fresh.comps.map((c) => {
    let levels: { level: number; label: string; descriptor: string }[] = [];
    try { levels = JSON.parse(c.competency.levelsJson) ?? []; } catch { /* rusak — kosong */ }
    return {
      id: c.id, competencyId: c.competencyId, code: c.competency.code,
      name: c.competency.name, kind: c.competency.kind,
      score: c.score, selfScore: c.selfScore, comment: c.comment, selfComment: c.selfComment,
      aiAssisted: c.aiAssisted, selfAiAssisted: c.selfAiAssisted,
      weight: wOf.get(c.competencyId) ?? 0, levels,
    };
  });
  const progress = appraisalProgressOf(kpis, fresh.comps.map((c) => ({ score: c.score })));
  const selfProgress = {
    total: comps.length,
    filled: fresh.comps.filter((c) => c.selfScore != null && c.selfScore >= 1 && c.selfScore <= 5).length,
  };

  // ringkasan 360 ter-agregasi §29-4 (anonim ≥3 reviewer per kategori)
  const feedback360 = fresh.cycle.feedback360 ? await aggregate360(db, appraisalId) : null;

  return {
    appraisal: {
      id: fresh.id, docNo: fresh.docNo, status: fresh.status, templateId: fresh.templateId,
      employeeId: fresh.employee.id, employeeNo: fresh.employee.employeeNo, fullName: fresh.employee.fullName,
      unit: unit?.name ?? null, position: pos?.title ?? null,
      managerId: fresh.managerId, managerName: fresh.manager?.fullName ?? null,
      selfScore: fresh.selfScore, managerScore: fresh.managerScore,
      finalScore: fresh.finalScore, finalRating: fresh.finalRating,
    },
    cycle: {
      id: fresh.cycle.id, code: fresh.cycle.code, name: fresh.cycle.name, status: fresh.cycle.status,
      periodStart: fresh.cycle.periodStart.toISOString().slice(0, 10),
      periodEnd: fresh.cycle.periodEnd.toISOString().slice(0, 10),
      selfStart: fresh.cycle.selfStart?.toISOString().slice(0, 10) ?? null,
      selfEnd: fresh.cycle.selfEnd?.toISOString().slice(0, 10) ?? null,
      mgrStart: fresh.cycle.mgrStart?.toISOString().slice(0, 10) ?? null,
      mgrEnd: fresh.cycle.mgrEnd?.toISOString().slice(0, 10) ?? null,
      feedback360: fresh.cycle.feedback360,
    },
    weights,
    kpis,
    comps,
    progress,
    selfProgress,
    feedback360,
    locked: (APPRAISAL_LOCKED as readonly string[]).includes(fresh.status),
  };
}

// ============================================================================
// FASE SELF — submitSelf (guard §35-7)
// ============================================================================

function assertSelfWindow(a: Awaited<ReturnType<typeof mustAppraisal>>): void {
  if (a.cycle.status !== "Assessment") {
    throw new Error(`Penilaian diri hanya sah saat fase Assessment — siklus ${a.cycle.code} saat ini ${a.cycle.status} (§35-7)`);
  }
  const now = Date.now();
  if (a.cycle.selfStart && a.cycle.selfStart.getTime() > now) throw new Error("Jendela penilaian diri belum dibuka (§35-7)");
  if (a.cycle.selfEnd && a.cycle.selfEnd.getTime() < now - DAY_MS) throw new Error("Jendela penilaian diri sudah tutup (§35-7)");
}

function assertMgrWindow(a: Awaited<ReturnType<typeof mustAppraisal>>): void {
  if (a.cycle.status !== "Assessment") {
    throw new Error(`Penilaian atasan hanya sah saat fase Assessment — siklus ${a.cycle.code} saat ini ${a.cycle.status} (§35-8)`);
  }
  const now = Date.now();
  if (a.cycle.mgrStart && a.cycle.mgrStart.getTime() > now) throw new Error("Jendela penilaian atasan belum dibuka (§35-8)");
  if (a.cycle.mgrEnd && a.cycle.mgrEnd.getTime() < now - DAY_MS) throw new Error("Jendela penilaian atasan sudah tutup (§35-8)");
}

export interface SubmitSelfInput {
  selfScores: { competencyId: string; score: number }[];
  selfComments?: { competencyId: string; comment: string }[];
  selfAiAssistedIds?: string[];
  /** Usulan finalActual utk KPI manual (dataSource=Manual) — diverifikasi atasan. */
  manualActuals?: { kpiId: string; finalActual: number }[];
  /** Bukti P3 = note saja: {type:"note", text} per KPI. */
  evidence?: { kpiId: string; note: string }[];
}

/** Submit penilaian diri (§29-2, guard §35-7) — SEMUA kompetensi wajib dinilai. */
export async function submitSelf(
  db: TenantDb, employeeId: string, appraisalId: string, input: SubmitSelfInput,
): Promise<{ docNo: string; selfScore: number; compCount: number; notified: boolean }> {
  const a = await mustAppraisal(db, appraisalId);
  if (a.employeeId !== employeeId) throw new Error("Hanya karyawan peserta yang dapat mengisi penilaian diri (§35-7)");
  assertSelfWindow(a);
  if (!(["GoalApproved", "Ongoing", "SelfDone"] as string[]).includes(a.status)) {
    throw new Error(`Target peserta belum terkunci (status ${a.status}) — penilaian diri menunggu target dikunci atasan (§35-7)`);
  }
  await ensureCompRows(db, a);
  const fresh = await mustAppraisal(db, appraisalId);

  const byId = new Map(fresh.comps.map((c) => [c.competencyId, c]));
  const scores = new Map((input.selfScores ?? []).map((s) => [s.competencyId, s.score]));
  const comments = new Map((input.selfComments ?? []).map((s) => [s.competencyId, s.comment?.trim() ?? ""]));
  const aiIds = new Set((input.selfAiAssistedIds ?? []).map(String));

  // §35-7: TOLAK bila ada kompetensi belum dinilai (semua baris wajib selfScore 1..5)
  const missing = [...byId.entries()].filter(([id]) => {
    const s = scores.get(id);
    return s == null || !Number.isInteger(s) || s < 1 || s > 5;
  });
  if (byId.size === 0) throw new Error("Baris kompetensi belum tersedia — hubungi HR");
  if (missing.length > 0) {
    throw new Error(`Masih ada ${missing.length} kompetensi belum dinilai (skor 1–5 wajib untuk semua baris — §35-7)`);
  }

  const compIds = [...byId.keys()];
  const wOf = await compWeightsOf(db, fresh, compIds);
  const sumW = compIds.reduce((s, id) => s + (wOf.get(id) ?? 0), 0);
  const selfScore = sumW > 0
    ? round(compIds.reduce((s, id) => s + (clamp(scores.get(id)!, 1, 5) / 5) * 100 * (wOf.get(id) ?? 0), 0) / sumW, 2)
    : 0;

  for (const id of compIds) {
    await db.appraisalCompetencyScore.update({
      where: { appraisalId_competencyId: { appraisalId, competencyId: id } },
      data: {
        selfScore: scores.get(id)!,
        selfComment: comments.get(id) || null,
        selfAiAssisted: aiIds.has(id), // AM3 §18.11 — flag audit internal
      },
    });
  }

  // usulan finalActual utk KPI MANUAL + bukti note (merge evidenceJson)
  const kpiById = new Map(fresh.kpis.map((k) => [k.id, k]));
  const evNote = new Map((input.evidence ?? []).map((e) => [e.kpiId, e.note?.trim() ?? ""]));
  for (const m of input.manualActuals ?? []) {
    const k = kpiById.get(m.kpiId);
    if (!k || k.dataSource !== "Manual") continue; // hanya KPI manual boleh diusulkan karyawan
    const finalActual = numOrNull(m.finalActual);
    if (finalActual == null) continue;
    await db.appraisalKpi.update({
      where: { id: m.kpiId },
      data: { finalActual, ...(evNote.has(m.kpiId) ? { evidenceJson: mergeEvidence(k.evidenceJson, evNote.get(m.kpiId)!) } : {}) },
    });
  }
  for (const e of input.evidence ?? []) {
    const k = kpiById.get(e.kpiId);
    if (!k || !e.note?.trim() || (input.manualActuals ?? []).some((m) => m.kpiId === e.kpiId)) continue;
    await db.appraisalKpi.update({ where: { id: e.kpiId }, data: { evidenceJson: mergeEvidence(k.evidenceJson, e.note.trim()) } });
  }

  await db.appraisalRecord.update({ where: { id: appraisalId }, data: { status: "SelfDone", selfScore } });

  // notifikasi in-app ke atasan (pola pushNotification — never-throw)
  let notified = false;
  if (a.managerId) {
    const u = await db.appUser.findFirst({ where: { employeeId: a.managerId }, select: { id: true } });
    if (u) {
      const nid = await pushNotification(db, {
        appUserId: u.id,
        title: `Penilaian diri selesai — ${a.employee.fullName} (${a.cycle.code})`,
        body: `Karyawan Anda telah men-submit self-assessment (${fresh.comps.length} kompetensi, skor ${fmtNum(selfScore)}). Buka Performance → Penilaian untuk melanjutkan penilaian atasan.`,
        kind: "performance",
        link: "performance:appraisals",
      });
      notified = nid != null;
    }
  }
  return { docNo: a.docNo, selfScore, compCount: compIds.length, notified };
}

/** Merge bukti note ke evidenceJson (P3: type note saja). */
function mergeEvidence(current: string | null, note: string): string {
  let arr: Record<string, unknown>[] = [];
  try { arr = JSON.parse(current ?? "[]") ?? []; } catch { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const cleared = arr.filter((x) => !(x && typeof x === "object" && (x as { type?: string }).type === "note"));
  cleared.push({ type: "note", text: note.slice(0, 2000), at: new Date().toISOString() });
  return JSON.stringify(cleared.slice(-10));
}

// ============================================================================
// FASE MANAGER — autosave draf §18.7 (guard ringan) → submitManager §35-8
// ============================================================================

export interface ManagerPatch {
  /** key kpiId → finalActual */
  kpiFinals?: { kpiId: string; finalActual: number | null }[];
  /** key compId → score (draf boleh parsial) */
  compScores?: { compId: string; score: number }[];
  compComments?: { compId: string; comment: string }[];
  /** kolom komentar yang disusun dgn AI lalu diedit (AM3 §18.11). */
  aiAssistedIds?: string[];
  managerComment?: string;
}

/** AUTOSAVE draf penilaian atasan §18.7 — TIDAK mengubah status; return
 *  progress % utk ProgressTrackerBar.
 *  B2-BL (D-BL7a): setiap compComment di-scan bias lexicon (deterministik,
 *  nol biaya) → respons menambah biasWarnings ADVISORI (banner amber di form
 *  atasan) — TIDAK disimpan flag, submit TIDAK pernah diblokir. */
export async function saveManagerScore(
  db: TenantDb, actor: AppraisalActor, appraisalId: string, patch: ManagerPatch,
): Promise<{ savedAt: string; progress: { pct: number; kpiFilled: number; kpiTotal: number; compScored: number; compTotal: number }; biasWarnings?: (BiasFlag & { compName?: string })[] }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!isManagerOf(actor, a)) throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat mengisi penilaian (§29-4)");
  assertMgrWindow(a);
  if (!(["GoalApproved", "Ongoing", "SelfDone"] as string[]).includes(a.status)) {
    throw new Error(`Penilaian atasan utk peserta ini sudah dikunci (status ${a.status})`);
  }
  await ensureCompRows(db, a);

  const kpiIds = new Set(a.kpis.map((k) => k.id));
  for (const f of patch.kpiFinals ?? []) {
    if (!kpiIds.has(f.kpiId)) continue;
    const v = numOrNull(f.finalActual);
    await db.appraisalKpi.update({
      where: { id: f.kpiId },
      data: { ...(v == null ? { finalActual: null } : { finalActual: v }) },
    });
  }
  // resolusi baris kompetensi — PATCH mengirim key ROW-id (form atasan) atau
  // competencyId (kontrak alternatif); keduanya di-resolve ke competencyId
  // unik (fix: sebelumnya keanggotaan dicek terhadap set competencyId → skor
  // atasan SELALU lolos tanpa tersimpan).
  const compRows = await db.appraisalCompetencyScore.findMany({ where: { appraisalId }, select: { id: true, competencyId: true } });
  const compByKey = new Map<string, string>();
  for (const r of compRows) {
    compByKey.set(r.id, r.competencyId);
    compByKey.set(r.competencyId, r.competencyId);
  }
  const aiIds = new Set((patch.aiAssistedIds ?? []).map(String));
  for (const s of patch.compScores ?? []) {
    const competencyId = compByKey.get(String(s.compId ?? ""));
    if (!competencyId) continue;
    const v = Math.round(numOrNull(s.score) ?? 0);
    if (v < 0 || v > 5) continue; // draf longgar — 0 = belum dinilai; 1..5 valid
    await db.appraisalCompetencyScore.update({
      where: { appraisalId_competencyId: { appraisalId, competencyId } },
      data: { score: v, ...(aiIds.has(String(s.compId)) || aiIds.has(competencyId) ? { aiAssisted: true } : {}) },
    });
  }
  for (const c of patch.compComments ?? []) {
    const competencyId = compByKey.get(String(c.compId ?? ""));
    if (!competencyId) continue;
    const txt = c.comment?.trim() ?? "";
    await db.appraisalCompetencyScore.update({
      where: { appraisalId_competencyId: { appraisalId, competencyId } },
      data: { comment: txt || null, ...(aiIds.has(String(c.compId)) || aiIds.has(competencyId) ? { aiAssisted: true } : {}) },
    });
  }
  // catatan: komentar global atasan TIDAK punya kolom di skema §15 (komentar
  // atasan hidup per kompetensi) — patch.managerComment diabaikan dengan sengaja.

  // B2-BL (D-BL7a) — scan bias advisori atas komentar yang barusan ditulis:
  // deterministik lexicon; hasil hanya di respons (TIDAK disimpan flag).
  const nameById = new Map(a.comps.map((c) => [c.competencyId, c.competency.name]));
  const { bySource } = scanComments(
    (patch.compComments ?? [])
      .filter((c) => (c.comment ?? "").trim())
      .map((c) => ({ source: String(c.compId ?? ""), text: c.comment ?? "" })),
  );
  const biasWarnings: (BiasFlag & { compName?: string })[] = [];
  const warnSeen = new Set<string>();
  for (const [compId, flags] of Object.entries(bySource)) {
    const compName = nameById.get(compByKey.get(compId) ?? "") ?? undefined;
    for (const f of flags) {
      const key = `${f.phrase}::${compName ?? ""}`;
      if (warnSeen.has(key)) continue;
      warnSeen.add(key);
      biasWarnings.push({ ...f, compName });
    }
  }

  // progress live (baca ulang ringan)
  const kpis = await db.appraisalKpi.findMany({ where: { appraisalId }, select: { finalActual: true } });
  const comps = await db.appraisalCompetencyScore.findMany({ where: { appraisalId }, select: { score: true } });
  return {
    savedAt: new Date().toISOString(),
    progress: appraisalProgressOf(kpis, comps),
    ...(biasWarnings.length ? { biasWarnings } : {}),
  };
}

/** Hitung managerScore §16 dari baris tersimpan (dipakai submitManager). */
async function computeManagerScore(
  db: TenantDb, a: Awaited<ReturnType<typeof mustAppraisal>>,
): Promise<{ managerScore: number; components: { kpi: number; competency: number; core: number } }> {
  const weights = await resolveWeights(db, a);
  const kpiScore = kpiComponent(a.kpis.map((k) => ({
    polarity: k.polarity, thresholdMin: k.thresholdMin, target: k.target,
    stretchValue: k.stretchValue, weight: k.weight, finalActual: k.finalActual,
  })));
  const compIds = a.comps.map((c) => c.competencyId);
  const wOf = await compWeightsOf(db, a, compIds);
  const compRows = a.comps.map((c) => ({ score: c.score, weight: wOf.get(c.competencyId) ?? 0, kind: c.competency.kind }));
  const competencyScore = compComponent(compRows.filter((r) => r.kind !== "CoreValue"));
  const coreRows = compRows.filter((r) => r.kind === "CoreValue");
  const coreScore = coreRows.length > 0 ? compComponent(coreRows) : null;
  // fallback §16: tenant tanpa pemisahan CoreValue → bobot core dinormalisasi
  const managerScore = combineComponents(weights, { kpi: kpiScore, competency: competencyScore, core: coreScore });
  return { managerScore, components: { kpi: round(kpiScore), competency: round(competencyScore), core: coreScore != null ? round(coreScore) : 0 } };
}

/** Submit penilaian atasan (guard keras §35-8) — status ManagerDone + skor server. */
export async function submitManager(
  db: TenantDb, actor: AppraisalActor, appraisalId: string,
): Promise<{ docNo: string; managerScore: number; notified: boolean }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!isManagerOf(actor, a)) throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat submit penilaian (§35-8)");
  assertMgrWindow(a);
  if (!(["GoalApproved", "Ongoing", "SelfDone"] as string[]).includes(a.status)) {
    throw new Error(`Penilaian sudah dikirim (status ${a.status}) — perubahan hasil hanya lewat jalur kalibrasi P4`);
  }
  await ensureCompRows(db, a);
  const fresh = await mustAppraisal(db, appraisalId);

  // §35-8 (1): semua finalActual terisi
  const emptyKpi = fresh.kpis.filter((k) => k.finalActual == null);
  if (fresh.kpis.length === 0) throw new Error("Peserta belum punya baris KPI — selesaikan target terlebih dahulu");
  if (emptyKpi.length > 0) {
    throw new Error(`Masih ada ${emptyKpi.length} KPI tanpa nilai aktual (mis. "${emptyKpi[0].title}") — isi semua final aktual sebelum submit (§35-8)`);
  }
  // §35-8 (2): Σbobot KPI = 100
  const sumW = fresh.kpis.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(sumW - 100) > 0.01) throw new Error(`Total bobot KPI ${fmtNum(sumW)}% — harus tepat 100% (§35-8)`);
  // §35-8 (3): komentar WAJIB utk skor ekstrem (≤2 atau =5)
  for (const c of fresh.comps) {
    const s = c.score;
    if (!(s >= 1 && s <= 5)) throw new Error(`Kompetensi "${c.competency.name}" belum dinilai (skor 1–5 wajib semua baris — §35-8)`);
    if ((s <= 2 || s === 5) && !c.comment?.trim()) {
      throw new Error(`Komentar WAJIB untuk skor ekstrem — kompetensi "${c.competency.name}" bernilai ${s} (≤2 atau 5) tanpa komentar (§35-8)`);
    }
  }
  // §35-8 (4): 360 selesai bila diaktifkan (undangan aktif → tolak)
  if (fresh.cycle.feedback360) {
    const activeInvites = await db.feedback360.count({
      where: { appraisalId, status: "Invited" },
    });
    if (activeInvites > 0) {
      throw new Error(`360 belum selesai (${activeInvites} undangan aktif) — hubungi HR untuk expire atau tunggu reviewer submit (§35-8)`);
    }
  }

  const { managerScore } = await computeManagerScore(db, fresh);
  await db.appraisalRecord.update({ where: { id: appraisalId }, data: { status: "ManagerDone", managerScore } });

  let notified = false;
  const u = await db.appUser.findFirst({ where: { employeeId: fresh.employeeId }, select: { id: true } });
  if (u) {
    const nid = await pushNotification(db, {
      appUserId: u.id,
      title: `Penilaian atasan selesai — ${a.cycle.code}`,
      body: `Atasan Anda telah menyelesaikan penilaian akhir periode ${a.cycle.code} (skor ${fmtNum(managerScore)}). Hasil final menunggu kalibrasi & publikasi HR.`,
      kind: "performance",
      link: "ess:my-appraisal",
    });
    notified = nid != null;
  }
  return { docNo: a.docNo, managerScore, notified };
}

// ============================================================================
// TARIK DATA OTOMATIS §18.6 (6 binding §16) — pratinjau → terapkan
// ============================================================================

export interface AutoSourceRow {
  kpiId: string;
  title: string;
  unit: string;
  sourceKey: string | null;
  currentFinal: number | null;
  newValue: number | null;
  sourceLabel: string;
  periodLabel: string;
  computedAt: string;
  /** ada input manual (finalActual terisi TANPA bukti auto) → perlu konfirmasi timpa. */
  isOverwrite: boolean;
  /** true = KPI tanpa sumber / gagal dihitung → perlu input manual. */
  needsManual: boolean;
  note: string | null;
}

const AUTO_SOURCE_LABELS: Record<string, string> = {
  attendance_presence_pct: "Attendance · Kehadiran",
  attendance_late_minutes: "Attendance · Keterlambatan",
  overtime_verified_hours: "Attendance · Lembur terverifikasi",
  leave_unplanned_days: "Leave · Cuti non-rencana",
  recruitment_time_to_fill: "Recruitment · Time-to-fill",
  recruitment_fulfilled_h: "Recruitment · Capaian MPP",
};

function periodLabelOf(periodStart: Date, periodEnd: Date): string {
  const f = (d: Date) => d.toISOString().slice(0, 7);
  return f(periodStart) === f(periodEnd) ? f(periodStart) : `${f(periodStart)} s/d ${f(periodEnd)}`;
}

/** Hitung satu nilai auto-source dari modul sumber (read-only lintas modul §19). */
async function computeAutoValue(
  db: TenantDb,
  sourceKey: string,
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ value: number; sourceLabel: string } | { error: string }> {
  const periodLabel = periodLabelOf(periodStart, periodEnd);
  if (sourceKey === "attendance_presence_pct" || sourceKey === "attendance_late_minutes") {
    const rows = await db.attendanceDaily.findMany({
      where: { employeeId, workDate: { gte: periodStart, lte: periodEnd } },
      select: { status: true, presence: true, lateMinutes: true },
      take: 4000,
    });
    if (sourceKey === "attendance_late_minutes") {
      const total = rows.reduce((s, r) => s + (r.lateMinutes ?? 0), 0);
      return { value: total, sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})` };
    }
    const scheduled = rows.filter((r) => r.status !== "Off" && r.status !== "Holiday").length;
    const present = rows.filter((r) => r.presence === 1).length;
    if (scheduled === 0) return { error: "Tidak ada hari kerja terjadwal pada periode siklus (data absensi kosong)" };
    return { value: round((present / scheduled) * 100), sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})` };
  }
  if (sourceKey === "overtime_verified_hours") {
    const ots = await db.overtimeOrder.findMany({
      where: { employeeId, overtimeDate: { gte: periodStart, lte: periodEnd }, status: "Paid" },
      select: { verifiedMinutes: true },
      take: 2000,
    });
    const minutes = ots.reduce((s, o) => s + (o.verifiedMinutes ?? 0), 0);
    return { value: round(minutes / 60), sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})` };
  }
  if (sourceKey === "leave_unplanned_days") {
    const lvs = await db.leaveRequest.findMany({
      where: {
        employeeId,
        status: "Approved",
        dateFrom: { lte: periodEnd },
        dateTo: { gte: periodStart },
        leaveType: { code: { not: "CT-THN" } }, // tahunan resmi = terencana
      },
      select: { workingDays: true },
      take: 1000,
    });
    return { value: round(lvs.reduce((s, l) => s + (l.workingDays ?? 0), 0)), sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})` };
  }
  if (sourceKey === "recruitment_time_to_fill") {
    const snaps = await db.metricSnapshot.findMany({
      where: { metric: "time_to_fill", computedAt: { gte: periodStart, lte: periodEnd } },
      select: { value: true },
      take: 500,
    });
    if (snaps.length === 0) return { error: "MetricSnapshot time_to_fill belum tersedia pada periode siklus — jalankan analitik rekrutmen atau isi manual" };
    return {
      value: round(snaps.reduce((s, x) => s + x.value, 0) / snaps.length, 1),
      sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})`,
    };
  }
  if (sourceKey === "recruitment_fulfilled_h") {
    // mirror mppAchievement (planning-service): Σ fulfilled ÷ Σ h × 100
    const plans = await db.recruitmentPlan.findMany({
      where: { status: "Applied" },
      select: { id: true, period: true, positionId: true, positionTitle: true, companyOfficeId: true, targetA: true, adjustB: true, empD: true, inE: true, outF: true },
      take: 500,
    });
    if (plans.length === 0) return { error: "Belum ada rencana rekrutmen status Applied — tidak ada kebutuhan (h) utk dihitung" };
    const sumH = plans.reduce((s, p) => s + (p.targetA + p.adjustB) - (p.empD + p.inE - p.outF), 0);
    if (sumH <= 0) return { error: "Total kebutuhan rekrut (Σh) = 0 pada rencana Applied" };
    const prs = await db.personnelRequisition.findMany({
      where: { status: { in: ["Submitted", "Approved", "OnHold", "Fulfilled"] } },
      select: { id: true, planId: true, positionId: true, companyOfficeId: true, requestDate: true, position: { select: { title: true } } },
      take: 2000,
    });
    const appts = await db.candidateAppointment.findMany({ select: { prId: true }, take: 5000 });
    const apptBy = new Map<string, number>();
    for (const x of appts) apptBy.set(x.prId, (apptBy.get(x.prId) ?? 0) + 1);
    const planIds = new Set(plans.map((p) => p.id));
    let sumFulfilled = 0;
    for (const pr of prs) {
      if (pr.planId && planIds.has(pr.planId)) { sumFulfilled += apptBy.get(pr.id) ?? 0; continue; }
      // fallback otomatis: posisi + kantor + tahun rencana (pola prAutoServesPlan)
      const served = plans.some((pl) => {
        const posOk = pl.positionId
          ? pl.positionId === pr.positionId
          : !!pr.position?.title && pl.positionTitle.toLowerCase() === pr.position.title.toLowerCase();
        if (!posOk) return false;
        if (pl.companyOfficeId && pl.companyOfficeId !== pr.companyOfficeId) return false;
        const year = /^(\d{4})/.exec(pl.period ?? "")?.[1];
        if (year && Number(year) !== pr.requestDate.getUTCFullYear()) return false;
        return true;
      });
      if (served) sumFulfilled += apptBy.get(pr.id) ?? 0;
    }
    return { value: round((sumFulfilled / sumH) * 100, 1), sourceLabel: `${AUTO_SOURCE_LABELS[sourceKey]} (${periodLabel})` };
  }
  return { error: `Sumber otomatis tidak dikenal: ${sourceKey}` };
}

/** Pratinjau (default) / terapkan (apply=true) tarikan otomatis §18.6.
 *  Keterbatasan P3: hanya fase Assessment (tombol mid-year menyusul — lihat worklog). */
export async function pullAutoSources(
  db: TenantDb, actor: AppraisalActor, appraisalId: string,
  opt: { apply?: boolean; overwrite?: boolean; kpiIds?: string[] } = {},
): Promise<{ rows: AutoSourceRow[]; applied: number; skippedManual: number }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!isManagerOf(actor, a)) throw new Error("Hanya atasan peserta (snapshot) atau HR yang dapat menarik data otomatis (§18.6)");
  if (a.cycle.status !== "Assessment") {
    throw new Error(`Tarikan otomatis hanya saat fase Assessment — siklus ${a.cycle.code} saat ini ${a.cycle.status} (§18.6)`);
  }

  // definisi pustaka → sourceKey
  const defIds = a.kpis.map((k) => k.kpiDefId).filter((x): x is string => !!x);
  const defs = defIds.length ? await db.kpiDefinition.findMany({ where: { id: { in: defIds } }, select: { id: true, sourceKey: true } }) : [];
  const keyOf = new Map(defs.map((d) => [d.id, d.sourceKey]));

  const only = opt.kpiIds ? new Set(opt.kpiIds) : null;
  const rows: AutoSourceRow[] = [];
  let applied = 0;
  let skippedManual = 0;

  for (const k of a.kpis) {
    if (only && !only.has(k.id)) continue;
    const sourceKey = k.kpiDefId ? keyOf.get(k.kpiDefId) ?? null : null;
    const base = {
      kpiId: k.id, title: k.title, unit: k.unit, sourceKey,
      currentFinal: k.finalActual, newValue: null as number | null,
      sourceLabel: "", periodLabel: periodLabelOf(a.cycle.periodStart, a.cycle.periodEnd),
      computedAt: new Date().toISOString(),
      isOverwrite: k.finalActual != null && k.autoValueJson == null,
      needsManual: false, note: null as string | null,
    };
    if (!sourceKey) {
      rows.push({ ...base, needsManual: true, note: "KPI manual — perlu input manual" });
      continue;
    }
    const res = await computeAutoValue(db, sourceKey, a.employeeId, a.cycle.periodStart, a.cycle.periodEnd);
    if ("error" in res) {
      rows.push({ ...base, needsManual: true, note: res.error });
      continue;
    }
    rows.push({ ...base, newValue: res.value, sourceLabel: res.sourceLabel });
    if (opt.apply) {
      if (base.isOverwrite && opt.overwrite !== true) { skippedManual++; continue; }
      await db.appraisalKpi.update({
        where: { id: k.id },
        data: {
          finalActual: res.value,
          autoValueJson: JSON.stringify({
            source: res.sourceLabel, sourceKey, period: base.periodLabel,
            value: res.value, computedAt: base.computedAt,
          }),
        },
      });
      applied++;
    }
  }
  return { rows, applied, skippedManual };
}

// ============================================================================
// IMPOR REALISASI §18.5 AM2 (D16 — mirror P1 target import; guard §35-27)
// ============================================================================

export const IMPORT_ACTUALS_MAX_ROWS = 500;
export const IMPORT_ACTUALS_MAX_BYTES = 2 * 1024 * 1024;

export const ACTUALS_COLUMNS = [
  { key: "employeeNo", id: "Kode Karyawan", en: "Employee No" },
  { key: "fullName", id: "Nama Karyawan", en: "Employee Name" },
  { key: "kpi", id: "Judul / Kode KPI", en: "KPI Title / Code" },
  { key: "target", id: "Target", en: "Target" },
  { key: "finalActual", id: "Final Aktual (isi)", en: "Final Actual (fill in)" },
  { key: "unit", id: "Satuan", en: "Unit" },
] as const;

/** Template .xlsx realisasi — sheet Instruksi dwibahasa + Data + contoh. */
export async function buildActualsTemplateXlsx(db: TenantDb, cycleId: string): Promise<{ buffer: Buffer; cycleCode: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  const sample = await db.appraisalRecord.findFirst({
    where: { cycleId },
    include: { employee: { select: { employeeNo: true, fullName: true } }, kpis: { take: 1 } },
  });
  const example = {
    employeeNo: sample?.employee.employeeNo ?? "MII00001",
    fullName: sample?.employee.fullName ?? "Nama Karyawan",
    kpi: sample?.kpis[0]?.title ?? "CUS-SLA-TICKET",
    target: sample?.kpis[0]?.target != null ? String(sample.kpis[0].target) : "95",
    finalActual: "",
    unit: sample?.kpis[0]?.unit ?? "%",
  };

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RekanKerja HRIS";

  const instr = wb.addWorksheet("Instruksi - Instructions");
  instr.columns = [{ width: 4 }, { width: 110 }];
  instr.addRow({ 1: "", 2: `TEMPLATE IMPOR REALISASI AKHIR — SIKLUS ${cycle.code}` });
  instr.addRow({ 1: "", 2: `FINAL ACTUALS IMPORT TEMPLATE — CYCLE ${cycle.code}` });
  const INSTR_STEPS: Record<string, [string, string]> = {
    s1: [
      "1. Isi kolom \"Final Aktual\" saja — kolom lain (karyawan, KPI, target, satuan) PESERTA yang terkunci sudah tercetak sebagai panduan.",
      "1. Fill the \"Final Actual\" column only — the other columns (employee, KPI, target, unit) are pre-printed from LOCKED participants as a guide.",
    ],
    s2: [
      "2. KPI dicocokkan berdasarkan KODE pustaka ATAU judul persis sesuai data peserta.",
      "2. KPIs are matched by library CODE or the participant's exact title.",
    ],
    s3: [
      "3. Baris karyawan yang bukan peserta / target belum terkunci akan ditolak per sel dengan alasan.",
      "3. Rows for non-participants / unlocked targets are rejected per-cell with reasons.",
    ],
    s4: [
      "4. Hasil impor mengisi Final Aktual TANPA mengubah status — submitManager tetap tindakan terpisah atasan.",
      "4. Import fills Final Actual WITHOUT changing status — manager submit remains a separate action.",
    ],
    s5: [
      "5. Baris tidak valid TIDAK membatalkan baris lain — perbaiki baris merah lalu unggah ulang.",
      "5. Invalid rows never cancel other rows — fix the red rows and re-upload.",
    ],
  };
  for (const steps of Object.values(INSTR_STEPS)) {
    instr.addRow({ 1: "", 2: steps[0] });
    instr.addRow({ 1: "", 2: steps[1] });
  }
  instr.addRow({ 1: "", 2: "" });
  instr.getRow(1).font = { bold: true, size: 13 };

  const data = wb.addWorksheet("Data");
  data.columns = ACTUALS_COLUMNS.map((c) => ({ header: `${c.id}\n${c.en}`, width: c.key === "kpi" ? 34 : c.key === "fullName" ? 26 : 14 }));
  data.getRow(1).font = { bold: true };
  data.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  data.addRow([example.employeeNo, example.fullName, example.kpi, example.target, example.finalActual, example.unit]);
  data.getRow(2).font = { italic: true, color: { argb: "FF6B7280" } };
  const buf = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(buf as ArrayBuffer), cycleCode: cycle.code };
}

export interface ImportActualRow {
  rowNo: number;
  employeeNo: string;
  fullName: string;
  kpi: string;
  target: string;
  finalActual: string;
  unit: string;
  valid: boolean;
  errors: { field: string; message: string }[];
  appraisalId?: string;
  kpiRowId?: string;
}

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ACTUALS_HEADER_KEYS: Record<string, string[]> = {
  employeeNo: "employeeno kodekaryawan employee idkaryawan karyawan no".split(" "),
  fullName: "nama namakaryawan employeename name".split(" "),
  kpi: "judulkodekpi judulkpi kpi kodekpi kpicode".split(" "),
  target: "target".split(" "),
  finalActual: "finalaktual finalaktualisi finalactual finalactualisi aktual actual realisasi".split(" "),
  unit: "satuan unit uom".split(" "),
};

/** Pratinjau impor realisasi: parse .xlsx + validasi per sel (D16 + §35-27). */
export async function importActualsPreview(
  db: TenantDb, actor: AppraisalActor, cycleId: string, file: { buffer: Buffer; name: string; type: string },
): Promise<{ rows: ImportActualRow[]; counts: { valid: number; error: number }; cycleCode: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "Assessment") throw new Error("Impor realisasi hanya saat jendela penilaian terbuka (fase Assessment) (§35-27)");
  const now = Date.now();
  if (cycle.mgrStart && cycle.mgrStart.getTime() > now) throw new Error("Jendela penilaian atasan belum dibuka (§35-27)");
  if (cycle.mgrEnd && cycle.mgrEnd.getTime() < now - DAY_MS) throw new Error("Jendela penilaian atasan sudah tutup (§35-27)");
  if (file.buffer.byteLength > IMPORT_ACTUALS_MAX_BYTES) throw new Error("Ukuran file melebihi 2 MB (D16)");
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

  const headerRow = ws.getRow(1);
  const colOf: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = norm(String(cell.text ?? ""));
    for (const [key, words] of Object.entries(ACTUALS_HEADER_KEYS)) {
      if (colOf[key]) continue;
      if (words.some((w) => h === w || h.includes(w))) colOf[key] = col;
    }
  });
  for (const k of ["employeeNo", "kpi", "finalActual"]) {
    if (!colOf[k]) throw new Error(`Kolom wajib tidak ditemukan: ${k} — gunakan template resmi (Unduh Template)`);
  }

  const appraisals = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, cycleId) as never,
    include: {
      employee: { select: { employeeNo: true, fullName: true, status: true } },
      kpis: { select: { id: true, title: true, kpiDefId: true, target: true, unit: true } },
    },
    take: 500,
  });
  const byEmpNo = new Map(appraisals.map((a) => [a.employee.employeeNo.toUpperCase(), a]));
  const defRows = await db.kpiDefinition.findMany({ where: { status: "Active" }, select: { id: true, code: true, name: true } });
  const defByCode = new Map(defRows.map((d) => [d.code.toUpperCase(), d]));

  const rows: ImportActualRow[] = [];
  const seen = new Set<string>();
  ws.eachRow({ includeEmpty: false }, (row, rn) => {
    if (rn === 1 || rn > IMPORT_ACTUALS_MAX_ROWS + 2) return;
    const get = (key: string): string => (colOf[key] ? String(row.getCell(colOf[key]).text ?? "").trim() : "");
    const employeeNo = get("employeeNo");
    if (!employeeNo && !get("kpi") && !get("finalActual")) return;
    const r: ImportActualRow = {
      rowNo: rn, employeeNo, fullName: get("fullName"), kpi: get("kpi"),
      target: get("target"), finalActual: get("finalActual"), unit: get("unit"),
      valid: true, errors: [],
    };
    const err = (field: string, message: string) => { r.valid = false; r.errors.push({ field, message }); };

    // 1 — peserta sah + terkunci (§35-27)
    const ap = byEmpNo.get(employeeNo.toUpperCase());
    if (!employeeNo) err("employeeNo", "Kode karyawan kosong");
    else if (!ap) err("employeeNo", `Karyawan ${employeeNo} bukan peserta siklus / tidak ditemukan`);
    else if (!(APPRAISAL_LOCKED as readonly string[]).includes(ap.status)) err("employeeNo", `Target ${employeeNo} belum terkunci (status ${ap.status})`);
    else r.appraisalId = ap.id;

    // 2 — KPI match by kpiDef code else title (§35-27)
    if (!r.kpi) err("kpi", "Judul/kode KPI kosong");
    else if (ap) {
      const def = defByCode.get(r.kpi.toUpperCase());
      const match = ap.kpis.find((k) => (def && k.kpiDefId === def.id) || k.title.toLowerCase() === r.kpi.toLowerCase());
      if (!match) err("kpi", `KPI "${r.kpi}" tidak ditemukan pada peserta ${employeeNo}`);
      else r.kpiRowId = match.id;
    }

    // 3 — angka valid (noise float exceljs dibulatkan 6 desimal — mis. 99.2
    //     terbaca 99.19999694824219 bila sel float32)
    const v = numOrNull(r.finalActual);
    if (r.finalActual === "") {
      err("finalActual", "Final aktual kosong");
    } else if (v == null) {
      err("finalActual", `Final aktual bukan angka: "${r.finalActual}"`);
    } else {
      r.finalActual = String(roundImport(v));
    }

    // 4 — duplikat dalam file
    const dkey = `${employeeNo.toUpperCase()}|${r.kpi.toUpperCase()}`;
    if (seen.has(dkey)) err("kpi", "Duplikat baris (karyawan+KPI sama sudah ada di atas)");
    else seen.add(dkey);
    rows.push(r);
  });
  if (rows.length > IMPORT_ACTUALS_MAX_ROWS) throw new Error(`Maksimal ${IMPORT_ACTUALS_MAX_ROWS} baris per file (D16)`);
  return {
    rows,
    counts: { valid: rows.filter((r) => r.valid).length, error: rows.filter((r) => !r.valid).length },
    cycleCode: cycle.code,
  };
}

/** Commit impor realisasi — hanya baris valid; mengisi finalActual TANPA status. */
export async function importActualsCommit(
  db: TenantDb, actor: AppraisalActor, cycleId: string,
  rows: (Pick<ImportActualRow, "employeeNo" | "kpi" | "finalActual"> & { rowNo: number })[],
): Promise<{ updated: number; skipped: number; cycleCode: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "Assessment") throw new Error("Impor realisasi hanya saat fase Assessment (§35-27)");
  if (rows.length > IMPORT_ACTUALS_MAX_ROWS) throw new Error(`Maksimal ${IMPORT_ACTUALS_MAX_ROWS} baris (D16)`);

  const appraisals = await db.appraisalRecord.findMany({
    where: visibleWhere(actor, cycleId) as never,
    include: { employee: { select: { employeeNo: true } }, kpis: { select: { id: true, title: true, kpiDefId: true } } },
    take: 500,
  });
  const byEmpNo = new Map(appraisals.map((a) => [a.employee.employeeNo.toUpperCase(), a]));
  const defRows = await db.kpiDefinition.findMany({ where: { status: "Active" }, select: { id: true, code: true } });
  const defByCode = new Map(defRows.map((d) => [d.code.toUpperCase(), d]));

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const ap = byEmpNo.get(r.employeeNo.toUpperCase());
    if (!ap || !(APPRAISAL_LOCKED as readonly string[]).includes(ap.status)) { skipped++; continue; }
    const def = defByCode.get((r.kpi ?? "").toUpperCase());
    const match = ap.kpis.find((k) => (def && k.kpiDefId === def.id) || k.title.toLowerCase() === (r.kpi ?? "").toLowerCase());
    if (!match) { skipped++; continue; }
    const v = numOrNull(r.finalActual);
    if (v == null) { skipped++; continue; }
    await db.appraisalKpi.update({ where: { id: match.id }, data: { finalActual: roundImport(v) } });
    updated++;
  }
  return { updated, skipped, cycleCode: cycle.code };
}

// ============================================================================
// ESTIMASI DAMPAK §18.12 (stateless — guard §35-31; TANPA nominal Rp D21)
// ============================================================================

export interface ImpactDraft {
  /** key kpiId → finalActual draf. */
  kpiFinals: Record<string, number | null>;
  /** key competencyId → skor draf (1..5). */
  compScores: Record<string, number | null>;
}

export async function previewImpact(
  db: TenantDb, actor: AppraisalActor, appraisalId: string, draft: ImpactDraft,
): Promise<{
  pScore: number;
  pRating: number | null;
  ratingLabel: { id: string; en: string } | null;
  ratingColor: string | null;
  bonusMonths: number | null;
  raisePct: [number, number] | null;
  criticalFailed: string[];
  kpiFilled: number; kpiTotal: number; compScored: number; compTotal: number;
  components: { kpi: number | null; competency: number | null; core: number | null };
  incomplete: boolean;
  weights: ComponentWeights;
}> {
  const a = await mustAppraisal(db, appraisalId);
  // §35-31: hanya atasan snapshot / HR (karyawan ESS & reviewer 360 DITOLAK 403)
  if (!isManagerOf(actor, a)) {
    throw new Error("Estimasi dampak hanya untuk atasan peserta atau HR — karyawan/reviewer 360 tidak melihat estimator (§35-31/D21)");
  }
  if (a.cycle.status !== "Assessment") {
    throw new Error(`Estimasi hanya saat fase Assessment — siklus ${a.cycle.code} saat ini ${a.cycle.status} (§35-31)`);
  }
  await ensureCompRows(db, a);
  const fresh = await mustAppraisal(db, appraisalId);
  const weights = await resolveWeights(db, fresh);

  // nilai draf meng-override baris tersimpan (yang belum diketik = null → 0)
  const kpis = fresh.kpis.map((k) => {
    const d = draft.kpiFinals?.[k.id];
    const finalActual = k.id in (draft.kpiFinals ?? {}) ? (d == null ? null : d) : k.finalActual;
    return {
      polarity: k.polarity, thresholdMin: k.thresholdMin, target: k.target,
      stretchValue: k.stretchValue, weight: k.weight, finalActual,
    };
  });
  const compIds = fresh.comps.map((c) => c.competencyId);
  const wOf = await compWeightsOf(db, fresh, compIds);
  const compRows = fresh.comps.map((c) => {
    const d = draft.compScores?.[c.competencyId];
    const score = c.competencyId in (draft.compScores ?? {}) ? (d == null ? 0 : Math.round(d)) : c.score;
    return { score: clamp(score, 0, 5), weight: wOf.get(c.competencyId) ?? 0, kind: c.competency.kind };
  });

  const kpiTotal = kpis.length;
  const kpiFilled = kpis.filter((k) => k.finalActual != null).length;
  const compTotal = compRows.length;
  const compScored = compRows.filter((r) => r.score >= 1 && r.score <= 5).length;

  const kpiComp = kpiComponent(kpis);
  const nonCore = compRows.filter((r) => r.kind !== "CoreValue");
  const coreRows = compRows.filter((r) => r.kind === "CoreValue");
  const competencyComp = nonCore.length > 0 ? compComponent(nonCore) : null;
  const coreComp = coreRows.length > 0 ? compComponent(coreRows) : null;
  const pScore = combineComponents(weights, {
    kpi: kpiTotal > 0 ? kpiComp : null,
    competency: competencyComp,
    core: coreComp,
  });

  // penaltas kritis §4.5: ∃ kritis Boolean gagal → rating maks 2
  const criticalFailed = fresh.kpis
    .filter((k) => {
      const d = draft.kpiFinals?.[k.id];
      const v = k.id in (draft.kpiFinals ?? {}) ? (d ?? null) : k.finalActual;
      return k.isCritical && k.polarity === "Boolean" && (v ?? 0) < 1;
    })
    .map((k) => k.title);

  // RatingScale lookup: minScore ≤ score → value tertinggi yang cocok
  const scales = await db.ratingScale.findMany({ orderBy: { minScore: "desc" } });
  let rating = scales.find((s) => pScore >= s.minScore) ?? null;
  if (criticalFailed.length > 0 && rating && rating.value > 2) {
    rating = scales.find((s) => s.value === 2) ?? rating; // dipatok maks 2 (§4.5)
  }

  // MeritMatrix aktif → bulan bonus + % kenaikan (TANPA nominal Rp — D21)
  let bonusMonths: number | null = null;
  let raisePct: [number, number] | null = null;
  if (rating) {
    const matrix = await db.meritMatrix.findFirst({ where: { active: true } });
    if (matrix) {
      try {
        const grid = JSON.parse(matrix.gridJson) as Record<string, { bonusMonths?: number; raisePct?: [number, number] }>;
        const cell = grid[String(rating.value)];
        if (cell) {
          bonusMonths = cell.bonusMonths ?? null;
          raisePct = Array.isArray(cell.raisePct) && cell.raisePct.length === 2 ? [cell.raisePct[0], cell.raisePct[1]] : null;
        }
      } catch { /* grid rusak — merit tak tersedia */ }
    }
  }

  return {
    pScore,
    pRating: rating?.value ?? null,
    ratingLabel: rating ? { id: rating.labelId, en: rating.labelEn } : null,
    ratingColor: rating?.color ?? null,
    bonusMonths,
    raisePct,
    criticalFailed,
    kpiFilled, kpiTotal, compScored, compTotal,
    components: {
      kpi: kpiTotal > 0 ? round(kpiComp) : null,
      competency: competencyComp != null ? round(competencyComp) : null,
      core: coreComp != null ? round(coreComp) : null,
    },
    incomplete: kpiFilled < kpiTotal || compScored < compTotal,
    weights,
  };
}

// ============================================================================
// AI ASSIST KOMPOSISI ULASAN §18.11 (D20 + guard §35-30 — compose-only)
// ============================================================================

export interface AiComposeInput {
  scope: "self" | "manager" | "360";
  appraisalId: string;
  competencyId?: string;
  /** poin pendek penilai 1–6 baris — bahasa seadanya. */
  points: string[];
  tone: "neutral" | "encouraging" | "firm";
  length: "short" | "medium";
  lang: "id" | "en";
}

export interface AiComposeResult {
  draft: string | null;
  unavailable: boolean;
  error?: string;
}

/** kata kunci payload yang mencoba minta AI menilai/menghasilkan skor (§35-30). */
const FORBIDDEN_POINT_RE = /\b(skora?|skor|score|rating|nilai|grade)\b/i;

const TONE_PROMPT: Record<AiComposeInput["tone"], string> = {
  neutral: "nada profesional netral",
  encouraging: "nada memberi semangat, tetap berbasis fakta poin",
  firm: "nada tegas namun konstruktif — fokus perilaku spesifik yang bisa diperbaiki",
};

/** Validasi aktor per scope (§35-30). */
async function assertAiActor(db: TenantDb, actor: AppraisalActor, input: AiComposeInput): Promise<{ competencyName: string; scoreForContext: number | null }> {
  const a = await mustAppraisal(db, input.appraisalId);
  let competencyName = "Ulasan kinerja";
  let scoreForContext: number | null = null;

  if (input.scope === "self") {
    if (a.employeeId !== actor.employeeId) throw new Error("AI assist ulasan diri hanya untuk karyawan peserta (§35-30)");
    assertSelfWindow(a);
    if (input.competencyId) {
      const c = a.comps.find((x) => x.competencyId === input.competencyId);
      competencyName = c?.competency.name ?? competencyName;
      scoreForContext = c?.selfScore ?? null;
    }
  } else if (input.scope === "manager") {
    if (!isManagerOf(actor, a)) throw new Error("AI assist ulasan atasan hanya untuk atasan peserta/HR (§35-30)");
    assertMgrWindow(a);
    if (input.competencyId) {
      const c = a.comps.find((x) => x.competencyId === input.competencyId);
      competencyName = c?.competency.name ?? competencyName;
      scoreForContext = c?.score ?? null;
    }
  } else {
    // 360 — aktor = reviewer dengan undangan aktif; ANONIM: identitas reviewer
    // TIDAK PERNAH dikirim ke model (D20).
    const fb = await db.feedback360.findFirst({
      where: { appraisalId: input.appraisalId, reviewerId: actor.employeeId ?? "__none__", status: "Invited" },
      include: { appraisal: { include: { comps: { include: { competency: true } } } } },
    });
    if (!fb) throw new Error("AI assist 360 hanya untuk reviewer dengan undangan aktif (§35-30)");
    const due = fb.dueAt ? fb.dueAt.getTime() < Date.now() : false;
    if (due) throw new Error("Undangan 360 sudah lewat tenggat (§35-30)");
    if (input.competencyId) {
      const c = fb.appraisal.comps.find((x) => x.competencyId === input.competencyId);
      competencyName = c?.competency.name ?? competencyName;
    }
  }
  return { competencyName, scoreForContext };
}

/** Compose draf ulasan dari poin penilai — compose-only (D20); kegagalan TENANG. */
export async function aiCompose(db: TenantDb, actor: AppraisalActor, actorKey: string, input: AiComposeInput): Promise<AiComposeResult> {
  // rate-limit 20/jam/user via ActivityLog (D20)
  const since = new Date(Date.now() - 3600 * 1000);
  const used = await db.activityLog.count({
    where: { action: "AiCompose", entityId: actorKey, createdAt: { gte: since } },
  });
  if (used >= 20) {
    throw new Error("Batas 20 susunan AI per jam tercapai — coba lagi nanti (D20)");
  }

  const points = (input.points ?? []).map((p) => String(p ?? "").trim()).filter(Boolean);
  if (points.length < 1 || points.length > 6) throw new Error("Tulis 1–6 poin pendek sebagai bahan ulasan (§18.11)");
  for (const p of points) {
    if (FORBIDDEN_POINT_RE.test(p)) {
      throw new Error("Poin tidak boleh meminta AI menilai/menghasilkan angka skor — tulis perilaku/fakta saja (§35-30)");
    }
  }
  const { competencyName, scoreForContext } = await assertAiActor(db, actor, input);

  // ActivityLog per panggilan — scope+tone saja, TANPA isi teks user (privasi)
  await db.activityLog.create({
    data: {
      action: "AiCompose",
      entity: "AppraisalRecord",
      entityId: actorKey,
      detail: `scope=${input.scope}; tone=${input.tone}; length=${input.length}; lang=${input.lang}; kompetensi=${competencyName} (compose-only §18.11 — isi poin tidak dicatat)`,
    },
  }).catch(() => { /* rate-limit best-effort */ });

  const langLine = input.lang === "en" ? "Write the draft in English." : "Tulis draf dalam Bahasa Indonesia.";
  const lengthLine = input.length === "short" ? "2–3 kalimat." : "4–6 kalimat.";
  const system =
    "Anda adalah editor ulasan kinerja di sistem HRIS. Tugas Anda SATU: merangkai POIN yang ditulis penilai menjadi kalimat ulasan profesional. " +
    "ATURAN KERAS (tidak boleh dilanggar): (1) JANGAN menambah fakta, metrik, pencapaian, atau pujian baru yang tidak ada di poin; " +
    "(2) JANGAN menghasilkan, menyarankan, atau membahas angka skor/rating/nilai dalam bentuk apapun; " +
    "(3) tetap SARA-safe — tanpa referensi agama, suku, gender, usia, kondisi fisik; tanpa janji karir/keuangan; " +
    "(4) fokus pada perilaku spesifik yang bisa diperbaiki/dipertahankan; (5) gunakan hanya bahan: poin penilai + nama kompetensi + skor terpilih sebagai konteks.";
  const user =
    `Kompetensi: ${competencyName}` +
    (scoreForContext != null ? `\nSkor terpilih penilai (konteks saja — JANGAN ditulis sebagai angka di hasil): ${scoreForContext} dari 5` : "") +
    `\nNada: ${TONE_PROMPT[input.tone]}\nPanjang: ${lengthLine}\n${langLine}` +
    `\n\nPoin penilai:\n${points.map((p, i) => `${i + 1}. ${p}`).join("\n")}` +
    `\n\nSusun ulasan dari poin di atas.`;

  try {
    const { createZaiClient } = await import("@/rekankerja/shared/services/zai-client");
    const zai = await createZaiClient();
    const res = await zai.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
    });
    const draft = res.choices?.[0]?.message?.content?.trim() ?? "";
    if (!draft) return { draft: null, unavailable: true, error: "AI mengembalikan hasil kosong — tulis manual, coba lagi nanti" };
    return { draft, unavailable: false };
  } catch (e) {
    // KEGAGALAN TENANG (§18.11-5): AI tidak pernah memblokir form
    return {
      draft: null,
      unavailable: true,
      error: `AI sedang tidak tersedia — tulis manual, coba lagi nanti (${e instanceof Error ? e.message.slice(0, 160) : "unknown"})`,
    };
  }
}

// ============================================================================
// ESS — penilaian saya (GET di route ess/my-appraisal; dipakai route)
// ============================================================================

/** Data self-assessment ESS: kompetensi utk diisi + KPI manual + jendela. */
export async function mySelfAssessment(db: TenantDb, employeeId: string, appraisalId: string) {
  const a = await mustAppraisal(db, appraisalId);
  if (a.employeeId !== employeeId) throw new Error("Bukan penilaian milik karyawan ini");
  await ensureCompRows(db, a);
  const fresh = await mustAppraisal(db, appraisalId);
  const unit = fresh.employee.orgUnitId
    ? await db.orgUnit.findUnique({ where: { id: fresh.employee.orgUnitId }, select: { name: true } })
    : null;
  const compIds = fresh.comps.map((c) => c.competencyId);
  const wOf = await compWeightsOf(db, fresh, compIds);
  return {
    appraisal: {
      id: fresh.id, docNo: fresh.docNo, status: fresh.status,
      employeeNo: fresh.employee.employeeNo, fullName: fresh.employee.fullName,
      unit: unit?.name ?? null,
      selfScore: fresh.selfScore, managerScore: fresh.managerScore,
      finalScore: fresh.finalScore, finalRating: fresh.finalRating,
    },
    cycle: {
      code: fresh.cycle.code, status: fresh.cycle.status,
      periodStart: fresh.cycle.periodStart.toISOString().slice(0, 10),
      periodEnd: fresh.cycle.periodEnd.toISOString().slice(0, 10),
      selfStart: fresh.cycle.selfStart?.toISOString().slice(0, 10) ?? null,
      selfEnd: fresh.cycle.selfEnd?.toISOString().slice(0, 10) ?? null,
    },
    selfWindowOpen: (() => {
      if (fresh.cycle.status !== "Assessment") return false;
      const now = Date.now();
      if (fresh.cycle.selfStart && fresh.cycle.selfStart.getTime() > now) return false;
      if (fresh.cycle.selfEnd && fresh.cycle.selfEnd.getTime() < now - DAY_MS) return false;
      return true;
    })(),
    canSubmit: ["GoalApproved", "Ongoing", "SelfDone"].includes(fresh.status),
    comps: fresh.comps.map((c) => {
      let levels: { level: number; label: string; descriptor: string }[] = [];
      try { levels = JSON.parse(c.competency.levelsJson) ?? []; } catch { /* rusak */ }
      return {
        competencyId: c.competencyId, code: c.competency.code, name: c.competency.name,
        kind: c.competency.kind,
        weight: wOf.get(c.competencyId) ?? 0, levels,
        selfScore: c.selfScore, selfComment: c.selfComment, selfAiAssisted: c.selfAiAssisted,
      };
    }),
    // KPI manual utk usulan finalActual (AUTO ditarik atasan — read-only di ESS)
    manualKpis: fresh.kpis.filter((k) => k.dataSource === "Manual").map((k) => ({
      id: k.id, title: k.title, unit: k.unit, target: k.target, midActual: k.midActual,
      finalActual: k.finalActual, evidenceJson: k.evidenceJson, metricText: k.metricText,
    })),
    autoKpis: fresh.kpis.filter((k) => k.dataSource !== "Manual").map((k) => ({
      id: k.id, title: k.title, unit: k.unit, target: k.target, finalActual: k.finalActual, metricText: k.metricText,
    })),
    progress: {
      total: fresh.comps.length,
      filled: fresh.comps.filter((c) => c.selfScore != null && c.selfScore >= 1 && c.selfScore <= 5).length,
    },
  };
}

/** Hasil final ESS (siklus Published/Closed) — read-only utk §31-1 + info
 *  acknowledge & jendela banding D6 (P4). */
export async function myPublishedResult(db: TenantDb, employeeId: string, appraisalId: string) {
  const a = await mustAppraisal(db, appraisalId);
  if (a.employeeId !== employeeId) throw new Error("Bukan penilaian milik karyawan ini");
  const scale = a.finalRating != null
    ? await db.ratingScale.findUnique({ where: { value: a.finalRating } })
    : null;
  // jendela banding D6: appealDays sejak publishAt (lazy — dihitung saat cek)
  const setting = await db.performanceSetting.findFirst({ select: { appealDays: true } });
  const appealDays = setting?.appealDays ?? 7;
  const publishAt = a.cycle.publishAt ?? null;
  const deadline = publishAt ? new Date(publishAt.getTime() + appealDays * DAY_MS) : null;
  const appealWindow = {
    days: appealDays,
    deadline: deadline?.toISOString() ?? null,
    open: deadline != null && Date.now() <= deadline.getTime(),
    daysLeft: deadline != null ? Math.ceil((deadline.getTime() - Date.now()) / DAY_MS) : null,
  };
  return {
    appraisal: {
      id: a.id, docNo: a.docNo, status: a.status,
      selfScore: a.selfScore, managerScore: a.managerScore,
      finalScore: a.finalScore, finalRating: a.finalRating,
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
      appealStatus: a.appealStatus ?? null,
      appealNote: a.appealNote ?? null,
      appealDecidedBy: a.appealDecidedBy ?? null,
    },
    cycle: {
      code: a.cycle.code, status: a.cycle.status,
      periodStart: a.cycle.periodStart.toISOString().slice(0, 10),
      periodEnd: a.cycle.periodEnd.toISOString().slice(0, 10),
    },
    rating: scale ? { value: scale.value, labelId: scale.labelId, labelEn: scale.labelEn, color: scale.color } : null,
    appealWindow,
    kpis: a.kpis.map((k) => ({
      title: k.title, unit: k.unit, target: k.target, finalActual: k.finalActual,
      midActual: k.midActual, weight: k.weight,
    })),
    comps: a.comps.map((c) => ({
      name: c.competency.name, kind: c.competency.kind,
      score: c.score, selfScore: c.selfScore, comment: c.comment, selfComment: c.selfComment,
    })),
    feedback360: a.cycle.feedback360 ? await aggregate360(db, appraisalId) : null,
  };
}
