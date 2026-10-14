// ============================================================================
// RekanKerja PERFORMANCE P4 — Kalibrasi & Finalisasi (DEVELOPMENT-PLAN-
// PERFORMANCE.md §30 Alur 6 + §18.10 Bell Curve + §8 antipola bias D19):
//   • distribution  — dashboard distribusi rating/skor per unit & per atasan
//     + flag anomali (leniency/strictness/central tendency §8).
//   • bellCurve    — histogram skor (bin 5 poin) + overlay kurva normal
//     (μ,σ dari data) + tabel z per atasan (D19: z≤−1 pelis / z≥+1 royal
//     amber; |z|≥2 merah; σ_tim < ½ σ_perusahaan = central tendency) +
//     toggle sebelum/sesudah kalibrasi. Kurva = LENSA KEWAJARAN, bukan
//     kuota (D2 forced-distribution tetap OFF).
//   • openSession / decide / closeSession — CalibrationSession + SETIAP
//     perubahan hasil = CalibrationDecision (alasan WAJIB §35-9; ter-audit).
//   • finalize      — batch submit approval docType PerformanceAppraisal
//     (§11.1 AS-PERF-STD; PEMOHON = KARYAWAN YANG DINILAI §23-D4; L3 Direktur
//     KONDISIONAL: hanya rating ekstrem 1/2/5, pemicu PIP, atau grade/level
//     tinggi — via includeLevels engine).
//   • decidePerfApproval — keputusan approver jenjang (approve/reject) →
//     Finalized (finalScore/finalRating RESMI) / kembali ManagerDone.
//
// Status appraisal terkait: ManagerDone → (finalize) → Calibrating (chain
// PerformanceAppraisal berjalan) → (approved) → Finalized → [P4 results
// publish → Published …]. Chain Rejected → kembali ManagerDone + alasan.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  startApprovalChain, getApprovalChain, decideApprovalChain, attachChainSummaries,
  type ChainView, type ChainSummary, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";

export const PERF_DOC_TYPE = "PerformanceAppraisal";
export const PERF_STRUCTURE_CODE = "AS-PERF-STD";

/** peserta ber-skor (ManagerDone+) — basis distribusi & bell curve. */
export const SCORED_STATUSES = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"] as const;

export interface CalibrationActor {
  /** employeeId aktor — null = akun HR tanpa data karyawan (akses penuh). */
  employeeId: string | null;
  /** true = super admin (OWNER/ADMIN platform / AppUser Admin). */
  superAdmin: boolean;
  /** nama tampilan utk audit. */
  name: string;
}

// ============ util ============

const round2 = (n: number) => Math.round(n * 100) / 100;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** pdf normal (guard σ=0 → 0). */
function normalPdf(x: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0;
  return (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));
}

/** Skor peserta utk lensa tertentu: sebelum kalibrasi = managerScore;
 *  sesudah = finalScore (fallback managerScore bila belum ada keputusan). */
function scoreOf(a: { managerScore: number | null; finalScore: number | null }, mode: "before" | "after"): number | null {
  if (mode === "before") return a.managerScore;
  return a.finalScore ?? a.managerScore;
}

/** RatingScale lookup (§4.4): minScore ≤ skor → value tertinggi yang cocok.
 *  Penaltas kritis §4.5 (∃ KPI Boolean kritis gagal → maks rating 2) diterapkan
 *  pada kandidat final — konsisten formula previewImpact P3. */
async function ratingForScore(
  db: TenantDb,
  score: number,
  criticalFailed = false,
): Promise<number | null> {
  const scales = await db.ratingScale.findMany({ orderBy: { minScore: "desc" } });
  let rating = scales.find((s) => score >= s.minScore) ?? null;
  if (criticalFailed && rating && rating.value > 2) {
    rating = scales.find((s) => s.value === 2) ?? rating;
  }
  return rating?.value ?? null;
}

// ============ struktur approval AS-PERF-STD (§11.1) ============

/**
 * Struktur default PerformanceAppraisal — NON-nominal (BUKAN AMOUNT_DOC_TYPES):
 *   L1 ATASAN_LANGSUNG  — atasan penilai (penempatan karyawan YANG DINILAI — §23-D4)
 *   L2 HR_ADMIN          — verifikasi proses kalibrasi
 *   L3 POSISI Direktur   — KONDISIONAL: hanya rating ekstrem 1/2/5, pemicu PIP,
 *                         atau grade/level tinggi (aktif via includeLevels).
 * Idempoten insert-only per code (pola seed AS-PR-STD rekrutmen); tanpa skrip
 * migrasi terpisah — dijamin ada saat finalisasi pertama dijalankan.
 */
export async function ensurePerfApprovalStructure(db: TenantDb): Promise<{ code: string; levels: number }> {
  const existing = await db.approvalStructure.findUnique({
    where: { code: PERF_STRUCTURE_CODE },
    include: { levels: { select: { levelNo: true } } },
  });
  if (existing) return { code: existing.code, levels: existing.levels.length };

  // resolusi posisi "Direktur": prefer kode P-CEO → judul ber-"director"/
  // "direktur" pada positionLevel tertinggi → position apa pun di level
  // tertinggi (fallback tenant tanpa posisi direksi).
  let dirPosition = await db.position.findFirst({ where: { code: "P-CEO" }, select: { id: true, title: true } });
  if (!dirPosition) {
    dirPosition = await db.position.findFirst({
      where: { title: { contains: "director", mode: "insensitive" }, active: true },
      orderBy: { positionLevel: { sortOrder: "desc" } },
      select: { id: true, title: true },
    });
  }
  if (!dirPosition) {
    dirPosition = await db.position.findFirst({
      where: { active: true },
      orderBy: { positionLevel: { sortOrder: "desc" } },
      select: { id: true, title: true },
    });
  }

  const levels: { levelNo: number; approverType: string; approverPositionId?: string; note: string }[] = [
    { levelNo: 1, approverType: "ATASAN_LANGSUNG", note: "Atasan penilai — penempatan karyawan yang dinilai (§23-D4)" },
    { levelNo: 2, approverType: "HR_ADMIN", note: "Verifikasi proses kalibrasi" },
  ];
  if (dirPosition) {
    levels.push({
      levelNo: 3, approverType: "POSISI", approverPositionId: dirPosition.id,
      note: "Direktur — kondisional §11.1: rating ekstrem (1/2/5) / pemicu PIP / grade-tinggi (aktif via includeLevels saat finalisasi)",
    });
  }

  await db.approvalStructure.create({
    data: {
      code: PERF_STRUCTURE_CODE,
      name: "Persetujuan Finalisasi Penilaian Kinerja (default)",
      docType: PERF_DOC_TYPE,
      levels: { create: levels },
    },
  });
  return { code: PERF_STRUCTURE_CODE, levels: levels.length };
}

/** Grade ≥ G6 / positionLevel sortOrder ≥ 6 (Senior Manager ke atas) = penempatan tinggi. */
function isHighPlacementOf(
  emp: { gradeId: string | null; positionLevelId: string | null },
  gradeNoOf: Map<string, number>,
  plSortOf: Map<string, number>,
): boolean {
  const g = emp.gradeId ? (gradeNoOf.get(emp.gradeId) ?? 0) : 0;
  const pl = emp.positionLevelId ? (plSortOf.get(emp.positionLevelId) ?? 0) : 0;
  return g >= 6 || pl >= 6;
}

// ============ distribusi (§30-1) ============

export interface DistributionGroup {
  key: string;
  label: string;
  sublabel: string | null;
  n: number;
  avg: number;
  sigma: number;
  ratings: { r1: number; r2: number; r3: number; r4: number; r5: number };
  z: number | null;
  flag: "leniency" | "strictness" | "extreme" | null;
  flagLevel: "amber" | "red" | null;
  centralTendency: boolean;
}

/** Dashboard distribusi: rating per atasan + per unit, rata-rata skor, flag §8/D19. */
export async function distribution(
  db: TenantDb,
  opt: { cycleId: string; unitId?: string; mode?: "before" | "after" },
): Promise<{
  cycle: { code: string; status: string };
  mode: "before" | "after";
  company: { n: number; mean: number; sigma: number };
  byManager: DistributionGroup[];
  byUnit: DistributionGroup[];
  participants: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    unitName: string | null; managerName: string | null; status: string;
    score: number | null; rating: number | null;
  }[];
}> {
  const mode = opt.mode === "after" ? "after" : "before";
  const cycle = await db.performanceCycle.findUnique({ where: { id: opt.cycleId }, select: { code: true, status: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: opt.cycleId, status: { in: [...SCORED_STATUSES] } },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true } },
      manager: { select: { id: true, fullName: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });

  const unitIds = [...new Set(rows.map((r) => r.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));

  const allScores = rows.map((r) => scoreOf(r, mode)).filter((s): s is number => s != null);
  const cMean = mean(allScores);
  const cSigma = stdev(allScores);

  const buildGroups = (
    keyOf: (r: (typeof rows)[number]) => string | null,
    labelOf: (r: (typeof rows)[number]) => { label: string; sublabel: string | null },
  ): DistributionGroup[] => {
    const map = new Map<string, { rows: typeof rows; label: string; sublabel: string | null }>();
    for (const r of rows) {
      if (scoreOf(r, mode) == null) continue;
      const k = keyOf(r);
      if (!k) continue;
      if (!map.has(k)) map.set(k, { rows: [], ...labelOf(r) });
      map.get(k)!.rows.push(r);
    }
    const out: DistributionGroup[] = [];
    for (const [key, g] of map) {
      const scores = g.rows.map((r) => scoreOf(r, mode) as number);
      const gm = mean(scores);
      const gs = stdev(scores);
      const z = cSigma > 0 ? round2((gm - cMean) / cSigma) : null;
      let flag: DistributionGroup["flag"] = null;
      let flagLevel: DistributionGroup["flagLevel"] = null;
      if (z != null) {
        if (Math.abs(z) >= 2) { flag = z < 0 ? "strictness" : "leniency"; flagLevel = "red"; }
        else if (z <= -1) { flag = "strictness"; flagLevel = "amber"; }
        else if (z >= 1) { flag = "leniency"; flagLevel = "amber"; }
      }
      const ratings = { r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 };
      for (const r of g.rows) {
        const rt = r.finalRating;
        if (rt != null && rt >= 1 && rt <= 5) ratings[`r${rt}` as "r1"]++;
      }
      out.push({
        key, label: g.label, sublabel: g.sublabel, n: scores.length,
        avg: round2(gm), sigma: round2(gs), ratings, z, flag, flagLevel,
        centralTendency: cSigma > 0 && gs > 0 && gs < cSigma / 2,
      });
    }
    return out.sort((a, b) => b.n - a.n);
  };

  const byManager = buildGroups(
    (r) => r.manager?.id ?? null,
    (r) => ({ label: r.manager?.fullName ?? "(tanpa atasan)", sublabel: null }),
  );
  const byUnit = buildGroups(
    (r) => r.employee.orgUnitId,
    (r) => ({ label: unitNameOf.get(r.employee.orgUnitId ?? "") ?? "(tanpa unit)", sublabel: null }),
  );

  const scoped = opt.unitId ? rows.filter((r) => r.employee.orgUnitId === opt.unitId) : rows;
  return {
    cycle,
    mode,
    company: { n: allScores.length, mean: round2(cMean), sigma: round2(cSigma) },
    byManager,
    byUnit,
    participants: scoped.map((r) => ({
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unitName: unitNameOf.get(r.employee.orgUnitId ?? "") ?? null, managerName: r.manager?.fullName ?? null,
      status: r.status, score: scoreOf(r, mode), rating: r.finalRating,
    })),
  };
}

// ============ bell curve (§18.10 / D19) ============

export interface BellCurveOut {
  cycle: { code: string; status: string };
  mode: "before" | "after";
  scope: { unitId?: string; managerId?: string; companyN: number };
  company: { mean: number; sigma: number };
  histogram: { from: number; to: number; label: string; count: number }[];
  curve: { x: number; y: number }[];
  n: number;
  zTable: {
    managerId: string | null; managerName: string; n: number; mean: number; sigmaTeam: number;
    z: number | null; flag: "leniency" | "strictness" | "extreme" | null; flagLevel: "amber" | "red" | null;
    centralTendency: boolean;
  }[];
  participants: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    unitName: string | null; managerName: string | null; score: number; binIndex: number;
  }[];
  tooltip: string;
}

/**
 * Kurva nilai: histogram skor (bin per 5 poin) + overlay kurva normal (μ,σ
 * data) + tabel z per atasan (D19). Statistik "perusahaan" SELALU dihitung dari
 * seluruh peserta ber-skor siklus (z pembanding); histogram/tabel mengikuti
 * lingkup (perusahaan / unit / atasan).
 */
export async function bellCurve(
  db: TenantDb,
  opt: { cycleId: string; unitId?: string; managerId?: string; mode?: "before" | "after" },
): Promise<BellCurveOut> {
  const mode = opt.mode === "after" ? "after" : "before";
  const cycle = await db.performanceCycle.findUnique({ where: { id: opt.cycleId }, select: { code: true, status: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: opt.cycleId, status: { in: [...SCORED_STATUSES] } },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true } },
      manager: { select: { id: true, fullName: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });
  const unitIds = [...new Set(rows.map((r) => r.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));

  // statistik perusahaan — dari SEMUA peserta ber-skor siklus (pembanding z)
  const companyScores = rows.map((r) => scoreOf(r, mode)).filter((s): s is number => s != null);
  const cMean = mean(companyScores);
  const cSigma = stdev(companyScores);

  // lingkup histogram/tabel
  const scoped = rows.filter((r) => {
    if (scoreOf(r, mode) == null) return false;
    if (opt.unitId && r.employee.orgUnitId !== opt.unitId) return false;
    if (opt.managerId && r.manager?.id !== opt.managerId) return false;
    return true;
  });
  const scopedScores = scoped.map((r) => scoreOf(r, mode) as number);

  // histogram bin 5 poin — rentang minimal 40..100 (diperluas mengikuti data)
  const lo = Math.min(40, Math.floor((scopedScores[0] ?? 40) / 5) * 5);
  const hi = Math.max(100, Math.ceil((scopedScores[scopedScores.length - 1] ?? 100) / 5) * 5);
  const histogram: { from: number; to: number; label: string; count: number }[] = [];
  for (let x = lo; x < hi; x += 5) histogram.push({ from: x, to: x + 5, label: `${x}–${x + 5}`, count: 0 });
  const binIndexOf = (s: number) => {
    const i = Math.floor((s - lo) / 5);
    return Math.max(0, Math.min(histogram.length - 1, i));
  };
  for (const s of scopedScores) histogram[binIndexOf(s)].count++;

  // overlay kurva normal diskalakan ke jumlah per bin (y = pdf × n × lebar-bin)
  const curve: { x: number; y: number }[] = [];
  if (cSigma > 0 && scopedScores.length >= 2 && histogram.length > 0) {
    const steps = Math.max(40, histogram.length * 4);
    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      curve.push({ x: round2(x), y: round2(normalPdf(x, cMean, cSigma) * scopedScores.length * 5) });
    }
  }

  // tabel z per atasan (lingkup aktif) — D19
  const byMgr = new Map<string, { name: string; scores: number[] }>();
  for (const r of scoped) {
    const k = r.manager?.id ?? "__none__";
    if (!byMgr.has(k)) byMgr.set(k, { name: r.manager?.fullName ?? "(tanpa atasan)", scores: [] });
    byMgr.get(k)!.scores.push(scoreOf(r, mode) as number);
  }
  const zTable: BellCurveOut["zTable"] = [...byMgr.entries()].map(([managerId, g]) => {
    const gm = mean(g.scores);
    const gs = stdev(g.scores);
    const z = cSigma > 0 ? round2((gm - cMean) / cSigma) : null;
    let flag: BellCurveOut["zTable"][number]["flag"] = null;
    let flagLevel: BellCurveOut["zTable"][number]["flagLevel"] = null;
    if (z != null) {
      if (Math.abs(z) >= 2) { flag = z < 0 ? "strictness" : "leniency"; flagLevel = "red"; }
      else if (z <= -1) { flag = "strictness"; flagLevel = "amber"; }
      else if (z >= 1) { flag = "leniency"; flagLevel = "amber"; }
    }
    return {
      managerId: managerId === "__none__" ? null : managerId, managerName: g.name,
      n: g.scores.length, mean: round2(gm), sigmaTeam: round2(gs), z, flag, flagLevel,
      centralTendency: cSigma > 0 && gs > 0 && gs < cSigma / 2,
    };
  }).sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return {
    cycle, mode,
    scope: { unitId: opt.unitId, managerId: opt.managerId, companyN: companyScores.length },
    company: { mean: round2(cMean), sigma: round2(cSigma) },
    histogram, curve, n: scopedScores.length, zTable,
    participants: scoped.map((r) => ({
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      unitName: unitNameOf.get(r.employee.orgUnitId ?? "") ?? null, managerName: r.manager?.fullName ?? null,
      score: scoreOf(r, mode) as number, binIndex: binIndexOf(scoreOf(r, mode) as number),
    })),
    tooltip: "Kurva adalah lensa kewajaran antar-unit, BUKAN kuota (D2 forced-distribution OFF). z = (rata-rata tim − rata-rata perusahaan) / sebaran perusahaan; z ≤ −1 cenderung pelis, z ≥ +1 cenderung royal (amber), |z| ≥ 2 merah. Penyesuaian nilai tetap hanya lewat keputusan kalibrasi beralasan (ter-audit).",
  };
}

// ============ sesi kalibrasi (§30-2/3, §35-9) ============

/** participantsJson — objek meta (kompatibel array legacy): peserta = ATASAN-
 *  ATASAN yang hadir forum; closeSession menandai closedAt di meta ini
 *  (skema tanpa kolom status — keputusan desain, dicatat di worklog). */
interface SessionMeta {
  participants: string[];
  closedAt?: string;
  closedBy?: string;
  closeNote?: string;
}

function parseSessionMeta(raw: string): SessionMeta {
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return { participants: v.map(String) };
    if (v && typeof v === "object" && Array.isArray((v as SessionMeta).participants)) {
      const m = v as SessionMeta;
      return { participants: m.participants.map(String), closedAt: m.closedAt, closedBy: m.closedBy, closeNote: m.closeNote };
    }
  } catch { /* rusak — kosong */ }
  return { participants: [] };
}

export async function openSession(
  db: TenantDb,
  actor: CalibrationActor,
  input: { cycleId: string; orgUnitId?: string | null; heldAt: string | Date; participants: string[]; chairId?: string | null; notes?: string | null },
): Promise<{ sessionId: string }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { id: true, code: true, status: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status === "Closed") throw new Error("Siklus sudah ditutup — sesi kalibrasi tidak dapat dibuka");

  const participants = [...new Set((input.participants ?? []).map(String).filter(Boolean))];
  if (participants.length === 0) throw new Error("Sesi wajib punya peserta (atasan-atasan yang hadir — §30-2)");
  const known = await db.employee.count({ where: { id: { in: participants } } });
  if (known !== participants.length) throw new Error("Ada peserta sesi yang bukan karyawan valid");

  if (input.orgUnitId) {
    const unit = await db.orgUnit.findUnique({ where: { id: input.orgUnitId }, select: { id: true } });
    if (!unit) throw new Error("Unit organisasi tidak ditemukan");
  }

  const meta: SessionMeta = { participants };
  const session = await db.calibrationSession.create({
    data: {
      cycleId: input.cycleId,
      orgUnitId: input.orgUnitId ?? null,
      heldAt: input.heldAt instanceof Date ? input.heldAt : new Date(input.heldAt),
      participantsJson: JSON.stringify(meta),
      chairId: input.chairId ?? null,
      notes: input.notes?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "CalibrationSession", entityId: session.id,
      detail: `Sesi kalibrasi dibuka utk siklus ${cycle.code}${input.orgUnitId ? " (per unit)" : ""} — ${participants.length} peserta atasan${input.chairId ? ", berketua" : ""} (${actor.name})`,
    },
  });
  return { sessionId: session.id };
}

export async function listSessions(
  db: TenantDb,
  opt: { cycleId: string },
): Promise<{
  sessions: {
    id: string; heldAt: string; orgUnitName: string | null; chairName: string | null;
    notes: string | null; participants: string[]; participantNames: string[];
    decisionCount: number; closedAt: string | null; closedBy: string | null; closeNote: string | null;
  }[];
}> {
  const sessions = await db.calibrationSession.findMany({
    where: { cycleId: opt.cycleId },
    include: { decisions: { select: { decidedAt: true } } },
    orderBy: { heldAt: "desc" },
  });
  const empIds = [...new Set(sessions.flatMap((s) => parseSessionMeta(s.participantsJson).participants))];
  const emps = empIds.length > 0
    ? await db.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true } })
    : [];
  const nameOf = new Map(emps.map((e) => [e.id, e.fullName]));
  const chairIds = [...new Set(sessions.map((s) => s.chairId).filter((x): x is string => !!x))];
  const chairs = chairIds.length > 0
    ? await db.employee.findMany({ where: { id: { in: chairIds } }, select: { id: true, fullName: true } })
    : [];
  const chairOf = new Map(chairs.map((c) => [c.id, c.fullName]));
  const unitIds = [...new Set(sessions.map((s) => s.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitOf = new Map(units.map((u) => [u.id, u.name]));

  return {
    sessions: sessions.map((s) => {
      const meta = parseSessionMeta(s.participantsJson);
      return {
        id: s.id, heldAt: s.heldAt.toISOString(), orgUnitName: s.orgUnitId ? unitOf.get(s.orgUnitId) ?? null : null,
        chairName: s.chairId ? chairOf.get(s.chairId) ?? null : null,
        notes: s.notes, participants: meta.participants,
        participantNames: meta.participants.map((p) => nameOf.get(p) ?? p),
        decisionCount: s.decisions.length,
        closedAt: meta.closedAt ?? null, closedBy: meta.closedBy ?? null, closeNote: meta.closeNote ?? null,
      };
    }),
  };
}

/** Aktor boleh memutus dalam sesi: HR/superadmin, ketua, atau peserta forum. */
function mayDecideSession(actor: CalibrationActor, session: { chairId: string | null }, meta: SessionMeta): boolean {
  if (actor.superAdmin) return true;
  if (!actor.employeeId) return false;
  return session.chairId === actor.employeeId || meta.participants.includes(actor.employeeId);
}

export async function decide(
  db: TenantDb,
  actor: CalibrationActor,
  input: {
    sessionId: string; appraisalId: string;
    newScore?: number | null; newRating?: number | null; potentialBand?: number | null;
    reason: string;
  },
): Promise<{
  appraisalId: string; docNo: string; decisionId: string;
  oldScore: number | null; newScore: number | null; oldRating: number | null; newRating: number | null;
  potentialBand: number | null;
}> {
  const reason = (input.reason ?? "").trim();
  if (!reason) throw new Error("Alasan keputusan kalibrasi WAJIB diisi (§35-9)");

  const session = await db.calibrationSession.findUnique({ where: { id: input.sessionId } });
  if (!session) throw new Error("Sesi kalibrasi tidak ditemukan");
  const meta = parseSessionMeta(session.participantsJson);
  if (meta.closedAt) throw new Error("Sesi kalibrasi sudah ditutup — buka sesi baru untuk keputusan lanjutan");
  if (!mayDecideSession(actor, session, meta)) {
    throw new Error("Hanya HR, ketua sesi, atau peserta forum yang dapat memutus kalibrasi (§35-9)");
  }

  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { code: true } },
      employee: { select: { fullName: true } },
      kpis: { select: { isCritical: true, polarity: true, finalActual: true } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.cycleId !== session.cycleId) throw new Error("Peserta bukan bagian dari siklus sesi ini");
  if (["Published", "Appealed", "Closed"].includes(a.status)) {
    throw new Error(`Peserta berstatus ${a.status} — perubahan hasil hanya lewat jalur banding (§35-9)`);
  }
  if (a.status === "Finalized") throw new Error("Peserta sudah difinalisasi — tarik melalui penolakan approval atau jalur banding (§35-9)");
  if (a.status === "Calibrating") throw new Error("Finalisasi peserta sedang menunggu approval — keputusan kalibrasi ditunda hingga chain selesai");
  if (a.status !== "ManagerDone") throw new Error(`Keputusan kalibrasi hanya untuk peserta ManagerDone (status saat ini ${a.status} — §35-9)`);

  const hasScore = input.newScore != null;
  const hasRating = input.newRating != null;
  const hasBand = input.potentialBand != null;
  if (!hasScore && !hasRating && !hasBand) {
    throw new Error("Tidak ada perubahan — isi skor/rating baru atau potential band 9-box");
  }
  if (hasScore && (input.newScore! < 0 || input.newScore! > 120)) throw new Error("Skor baru harus 0–120 (§16)");
  if (hasRating && (input.newRating! < 1 || input.newRating! > 5)) throw new Error("Rating baru harus 1–5");
  if (hasBand && (input.potentialBand! < 1 || input.potentialBand! > 3)) throw new Error("Potential band 9-box harus 1–3");

  const criticalFailed = a.kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
  const oldScore = a.finalScore ?? a.managerScore;
  const oldRating = a.finalRating ?? (oldScore != null ? await ratingForScore(db, oldScore, criticalFailed) : null);
  const newScore: number | null = hasScore ? round2(input.newScore!) : null;
  // rating: eksplisit bila diberikan; else re-lookup dari skor baru §4.4 (bila skor berubah)
  let newRating: number | null = hasRating ? input.newRating! : null;
  if (!hasRating && hasScore) {
    newRating = await ratingForScore(db, round2(input.newScore!), criticalFailed);
  }

  const decision = await db.calibrationDecision.create({
    data: {
      sessionId: session.id, appraisalId: a.id,
      oldScore, newScore: hasScore ? newScore : null,
      oldRating, newRating: hasRating ? newRating : null,
      potentialBand: hasBand ? input.potentialBand! : null,
      reason, decidedBy: actor.name,
    },
  });
  await db.appraisalRecord.update({
    where: { id: a.id },
    data: {
      ...(hasScore ? { finalScore: newScore } : {}),
      ...(newRating != null ? { finalRating: newRating } : {}),
      ...(hasBand ? { potentialBand: input.potentialBand! } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `Keputusan kalibrasi ${a.docNo} (${a.employee.fullName}): skor ${oldScore ?? "—"}→${hasScore ? newScore : "—"}, rating ${oldRating ?? "—"}→${newRating ?? "—"}${hasBand ? `, 9-box band ${input.potentialBand}` : ""} — alasan: ${reason} (${actor.name}, §35-9)`,
    },
  });
  return {
    appraisalId: a.id, docNo: a.docNo, decisionId: decision.id,
    // P4-E2E fix: newRating kini mengembalikan rating TURUNAN dari skor baru
    // (re-lookup §4.4) juga — sebelumnya null bila tidak diberikan eksplisit,
    // padahal nilai tersimpan di DB (finalRating) — respons tidak jujur.
    oldScore, newScore: hasScore ? newScore : null, oldRating, newRating,
    potentialBand: hasBand ? input.potentialBand! : null,
  };
}

export async function closeSession(
  db: TenantDb,
  actor: CalibrationActor,
  sessionId: string,
  notes?: string | null,
): Promise<{ sessionId: string; decisionCount: number }> {
  const session = await db.calibrationSession.findUnique({
    where: { id: sessionId },
    include: { decisions: { select: { id: true } }, cycle: { select: { code: true } } },
  });
  if (!session) throw new Error("Sesi kalibrasi tidak ditemukan");
  const meta = parseSessionMeta(session.participantsJson);
  if (meta.closedAt) throw new Error("Sesi sudah ditutup");
  if (!mayDecideSession(actor, session, meta)) {
    throw new Error("Hanya HR, ketua sesi, atau peserta forum yang dapat menutup sesi");
  }
  meta.closedAt = new Date().toISOString();
  meta.closedBy = actor.name;
  if (notes?.trim()) meta.closeNote = notes.trim();
  await db.calibrationSession.update({
    where: { id: sessionId },
    data: {
      participantsJson: JSON.stringify(meta),
      ...(notes?.trim() ? { notes: session.notes ? `${session.notes}\n\n[penutupan] ${notes.trim()}` : `[penutupan] ${notes.trim()}` } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "CalibrationSession", entityId: sessionId,
      detail: `Sesi kalibrasi ${session.cycle.code} DITUTUP — ${session.decisions.length} keputusan ter-audit${notes?.trim() ? ` — ${notes.trim()}` : ""} (${actor.name})`,
    },
  });
  return { sessionId, decisionCount: session.decisions.length };
}

// ============ finalisasi (§30-4/5, §35-10/11) ============

/** Board finalisasi: peserta ManagerDone (siap submit) + Calibrating (chain
 *  berjalan — kotak approval) + Finalized (selesai). Row-level §11.3: atasan
 *  hanya timnya sendiri. */
export async function finalizeBoard(
  db: TenantDb,
  actor: CalibrationActor,
  opt: { cycleId: string },
): Promise<{
  cycle: { code: string; status: string };
  structure: { code: string; levels: number } | null;
  managerDone: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    managerName: string | null; candidateScore: number | null; candidateRating: number | null;
    highPlacement: boolean; needL3: boolean; calibrated: boolean;
  }[];
  pending: {
    appraisalId: string; docNo: string; fullName: string; employeeNo: string;
    candidateScore: number | null; candidateRating: number | null; needL3: boolean;
    chain: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null };
  }[];
  finalized: { appraisalId: string; docNo: string; fullName: string; finalScore: number | null; finalRating: number | null }[];
}> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: opt.cycleId }, select: { code: true, status: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const where: Record<string, unknown> = { cycleId: opt.cycleId, status: { in: ["ManagerDone", "Calibrating", "Finalized"] } };
  if (!actor.superAdmin && actor.employeeId) where.managerId = actor.employeeId;
  const rows = await db.appraisalRecord.findMany({
    where: where as never,
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, gradeId: true, positionLevelId: true } },
      manager: { select: { fullName: true } },
      kpis: { select: { isCritical: true, polarity: true, finalActual: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });

  // peta grade/positionLevel (batch — utk deteksi penempatan tinggi)
  const gradeIds = [...new Set(rows.map((r) => r.employee.gradeId).filter((x): x is string => !!x))];
  const plIds = [...new Set(rows.map((r) => r.employee.positionLevelId).filter((x): x is string => !!x))];
  const [grades, pls] = await Promise.all([
    gradeIds.length > 0 ? db.grade.findMany({ where: { id: { in: gradeIds } }, select: { id: true, code: true } }) : Promise.resolve([]),
    plIds.length > 0 ? db.positionLevel.findMany({ where: { id: { in: plIds } }, select: { id: true, sortOrder: true } }) : Promise.resolve([]),
  ]);
  const gradeNoOf = new Map(grades.map((g): [string, number] => [g.id, Number((g.code.match(/\d+/) ?? ["0"])[0])]));
  const plSortOf = new Map(pls.map((p): [string, number] => [p.id, p.sortOrder]));

  const structure = await ensurePerfApprovalStructure(db);

  // rating kandidat (lookup RatingScale §4.4 + penaltas kritis §4.5) — batch
  const scales = await db.ratingScale.findMany({ orderBy: { minScore: "desc" } });
  const scaleOf = (score: number | null, critical: boolean): number | null => {
    if (score == null) return null;
    let s = scales.find((x) => score >= x.minScore) ?? null;
    if (critical && s && s.value > 2) s = scales.find((x) => x.value === 2) ?? s;
    return s?.value ?? null;
  };

  const managerDone = rows.filter((r) => r.status === "ManagerDone").map((r) => {
    const criticalFailed = r.kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
    const candidateScore = r.finalScore ?? r.managerScore;
    const high = isHighPlacementOf(r.employee, gradeNoOf, plSortOf);
    const candidateRating = r.finalRating ?? (candidateScore != null ? scaleOf(candidateScore, criticalFailed) : null);
    return {
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      managerName: r.manager?.fullName ?? null,
      candidateScore, candidateRating,
      highPlacement: high, needL3: (candidateRating != null && [1, 2, 5].includes(candidateRating)) || high,
      calibrated: r.finalScore != null,
    };
  });

  const pendingRows = rows.filter((r) => r.status === "Calibrating");
  const chains = await attachChainSummaries(db, PERF_DOC_TYPE, pendingRows.map((r) => ({ id: r.id })));
  const pending = pendingRows.map((r) => {
    const c = chains.get(r.id) ?? null;
    return {
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      candidateScore: r.finalScore ?? r.managerScore, candidateRating: r.finalRating, needL3: (c?.totalLevels ?? 0) >= 3,
      chain: c ? { status: c.status, currentLevel: c.currentLevel, totalLevels: c.totalLevels, currentApprover: c.currentApprover } :
        { status: "NoChain", currentLevel: 0, totalLevels: 0, currentApprover: null },
    };
  });

  return {
    cycle, structure: { code: structure.code, levels: structure.levels },
    managerDone,
    pending,
    finalized: rows.filter((r) => r.status === "Finalized").map((r) => ({
      appraisalId: r.id, docNo: r.docNo, fullName: r.employee.fullName,
      finalScore: r.finalScore, finalRating: r.finalRating,
    })),
  };
}

/** Submit finalisasi batch: tiap peserta ManagerDone → dokumen approval
 *  PerformanceAppraisal (pemohon = karyawan yang dinilai §23-D4; L3 Direktur
 *  hanya bila rating ekstrem 1/2/5 / pemicu PIP / penempatan tinggi §11.1). */
export async function finalize(
  db: TenantDb,
  actor: CalibrationActor,
  input: { appraisalIds?: string[]; cycleId?: string },
): Promise<{
  structureCode: string;
  submitted: { docNo: string; fullName: string; levels: number; firstApprover: string | null; needL3: boolean }[];
  skipped: { docNo: string; reason: string }[];
}> {
  const structure = await ensurePerfApprovalStructure(db);

  let targets: string[];
  if (input.appraisalIds && input.appraisalIds.length > 0) {
    targets = input.appraisalIds.map(String);
  } else if (input.cycleId) {
    const rows = await db.appraisalRecord.findMany({
      where: { cycleId: input.cycleId, status: "ManagerDone" }, select: { id: true }, take: 500,
    });
    targets = rows.map((r) => r.id);
  } else {
    throw new Error("Berikan appraisalIds atau cycleId");
  }

  const submitted: { docNo: string; fullName: string; levels: number; firstApprover: string | null; needL3: boolean }[] = [];
  const skipped: { docNo: string; reason: string }[] = [];

  for (const id of targets) {
    const a = await db.appraisalRecord.findUnique({
      where: { id },
      include: {
        cycle: { select: { code: true, status: true } },
        employee: { select: { id: true, fullName: true, gradeId: true, positionLevelId: true } },
        kpis: { select: { isCritical: true, polarity: true, finalActual: true } },
      },
    });
    if (!a) { skipped.push({ docNo: id, reason: "peserta tidak ditemukan" }); continue; }
    if (a.status === "Calibrating") { skipped.push({ docNo: a.docNo, reason: "sudah menunggu approval (chain berjalan)" }); continue; }
    if (a.status === "Finalized") { skipped.push({ docNo: a.docNo, reason: "sudah final" }); continue; }
    if (a.status !== "ManagerDone") { skipped.push({ docNo: a.docNo, reason: `status ${a.status} — finalisasi hanya dari ManagerDone (§35-10)` }); continue; }
    // row-level: atasan hanya timnya sendiri (HR semua)
    if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
      skipped.push({ docNo: a.docNo, reason: "bukan bawahan langsung aktor" });
      continue;
    }

    const candidateScore = a.finalScore ?? a.managerScore;
    if (candidateScore == null) { skipped.push({ docNo: a.docNo, reason: "belum ada skor atasan — selesaikan penilaian dahulu" }); continue; }

    const criticalFailed = a.kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
    const candidateRating = a.finalRating ?? await ratingForScore(db, candidateScore, criticalFailed);

    // deteksi penempatan tinggi (grade/level) — cache kecil per panggilan
    let gradeNo = 0;
    if (a.employee.gradeId) {
      const g = await db.grade.findUnique({ where: { id: a.employee.gradeId }, select: { code: true } });
      gradeNo = Number((g?.code.match(/\d+/) ?? ["0"])[0]);
    }
    let plSort = 0;
    const plId = a.employee.positionLevelId;
    if (plId) {
      const p = await db.positionLevel.findUnique({ where: { id: plId }, select: { sortOrder: true } });
      plSort = p?.sortOrder ?? 0;
    }
    const highPlacement = gradeNo >= 6 || plSort >= 6;
    const needL3 = (candidateRating != null && [1, 2, 5].includes(candidateRating)) || highPlacement;
    const includeLevels = needL3 ? [1, 2, 3] : [1, 2];

    // chain lama terminal (Rejected/Cancelled) → bersihkan utk pengajuan ulang
    // (audit tetap utuh di ActivityLog; ApprovalChain = entitas operasional)
    const existing = await getApprovalChain(db, PERF_DOC_TYPE, a.id);
    if (existing && (existing.status === "Rejected" || existing.status === "Cancelled")) {
      await db.approvalChain.delete({ where: { docType_docId: { docType: PERF_DOC_TYPE, docId: a.id } } });
      await db.activityLog.create({
        data: {
          action: "Updated", entity: "AppraisalRecord", entityId: a.docNo,
          detail: `Finalisasi ${a.docNo} diajukan ULANG setelah chain sebelumnya ${existing.status}`,
        },
      });
    } else if (existing && existing.status === "InProgress") {
      skipped.push({ docNo: a.docNo, reason: "sudah menunggu approval (chain berjalan)" });
      continue;
    }

    const chain = await startApprovalChain(db, {
      docType: PERF_DOC_TYPE as never, docId: a.id, employeeId: a.employeeId,
      includeLevels, createdBy: actor.name,
    });
    await db.appraisalRecord.update({ where: { id: a.id }, data: { status: "Calibrating" } });
    await db.activityLog.create({
      data: {
        action: "Submitted", entity: "AppraisalRecord", entityId: a.docNo,
        detail: `Finalisasi ${a.docNo} (${a.employee.fullName}) diajukan ke approval ${PERF_DOC_TYPE} — ${chain.totalLevels} jenjang${needL3 ? " (L3 Direktur aktif: rating ekstrem/PIP/penempatan tinggi §11.1)" : ""} (${actor.name}, §35-10)`,
      },
    });
    // notifikasi approver jenjang pertama (fire-and-forget)
    const first = chain.steps.find((s) => s.status === "Current") ?? null;
    void notifyEvent(db, {
      to: "nextApprover", docType: PERF_DOC_TYPE, docNo: a.docNo, docId: a.id,
      title: `Finalisasi penilaian ${a.docNo} menunggu persetujuan Anda`,
      body: `${a.employee.fullName} — skor kandidat ${candidateScore} (rating ${candidateRating ?? "—"}) · siklus ${a.cycle.code}`,
      kind: "performance", link: "performance:calibration",
    }).catch(() => { /* never */ });
    submitted.push({
      docNo: a.docNo, fullName: a.employee.fullName, levels: chain.totalLevels,
      firstApprover: first?.approverLabel ?? null, needL3,
    });
  }

  return { structureCode: structure.code, submitted, skipped };
}

/** Keputusan approver jenjang (approve/reject) atas dokumen PerformanceAppraisal
 *  — padanan decidePr: approve final → Finalized + finalScore/finalRating RESMI;
 *  reject final → kembali ManagerDone + alasan. */
export async function decidePerfApproval(
  db: TenantDb,
  actor: DecideActor,
  input: { appraisalId: string; action: "approve" | "reject"; note?: string | null },
): Promise<{ docNo: string; status: string; final: boolean; approval: ChainSummary | null }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { code: true } },
      employee: { select: { id: true, fullName: true } },
      kpis: { select: { isCritical: true, polarity: true, finalActual: true } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  if (a.status !== "Calibrating") throw new Error(`${a.docNo} berstatus ${a.status} — tidak menunggu keputusan approval`);

  const chain = await getApprovalChain(db, PERF_DOC_TYPE, a.id);
  if (!chain) throw new Error("Jalur persetujuan tidak ditemukan — ajukan finalisasi ulang");

  const res = await decideApprovalChain(db, {
    docType: PERF_DOC_TYPE as never, docId: a.id,
    action: input.action, note: input.note ?? undefined, actor,
  });
  const summary: ChainSummary = {
    status: res.chain.status, currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
    currentApprover: res.chain.steps.find((s) => s.status === "Current")?.approverLabel ?? null,
  };

  if (!res.final) {
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "AppraisalRecord", entityId: a.docNo,
        detail: `Finalisasi ${a.docNo} disetujui jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} (${actor.name}) — lanjut ke ${summary.currentApprover ?? "-"}`,
      },
    });
    void notifyEvent(db, {
      to: "nextApprover", docType: PERF_DOC_TYPE, docNo: a.docNo, docId: a.id,
      title: `Finalisasi penilaian ${a.docNo} menunggu persetujuan Anda (jenjang berikutnya)`,
      body: `${a.employee.fullName} · siklus ${a.cycle.code}`,
      kind: "performance", link: "performance:calibration",
    }).catch(() => { /* never */ });
    return { docNo: a.docNo, status: "Calibrating", final: false, approval: summary };
  }

  if (input.action === "approve") {
    // hasil final RESMI §30-5: finalScore = hasil kalibrasi (bila ada) else skor atasan
    const finalScore = a.finalScore ?? a.managerScore;
    const criticalFailed = a.kpis.some((k) => k.isCritical && k.polarity === "Boolean" && (k.finalActual ?? 0) < 1);
    const finalRating = a.finalRating ?? (finalScore != null ? await ratingForScore(db, finalScore, criticalFailed) : null);
    await db.appraisalRecord.update({
      where: { id: a.id },
      data: { status: "Finalized", finalScore, finalRating },
    });
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "AppraisalRecord", entityId: a.docNo,
        detail: `Finalisasi ${a.docNo} (${a.employee.fullName}) DISETUJUI PENUH (${res.chain.totalLevels} jenjang, keputusan akhir ${actor.name}) — finalScore ${finalScore} · rating ${finalRating ?? "—"} RESMI (§30-5)`,
      },
    });
    return { docNo: a.docNo, status: "Finalized", final: true, approval: summary };
  }

  // reject final → kembali ManagerDone (skor kalibrasi tetap tersimpan sbg kandidat)
  await db.appraisalRecord.update({ where: { id: a.id }, data: { status: "ManagerDone" } });
  await db.activityLog.create({
    data: {
      action: "Rejected", entity: "AppraisalRecord", entityId: a.docNo,
      detail: `Finalisasi ${a.docNo} DITOLAK (${actor.name}) — kembali ke ManagerDone${input.note?.trim() ? ` — alasan: ${input.note.trim()}` : ""}`,
    },
  });
  void notifyEvent(db, {
    to: "admins", docType: PERF_DOC_TYPE, docNo: a.docNo, docId: a.id,
    title: `Finalisasi penilaian ${a.docNo} ditolak`,
    body: `${a.employee.fullName} · siklus ${a.cycle.code} — kembali ke ManagerDone${input.note?.trim() ? ` (${input.note.trim()})` : ""}`,
    kind: "performance", link: "performance:calibration",
  }).catch(() => { /* never */ });
  return { docNo: a.docNo, status: "ManagerDone", final: true, approval: summary };
}
