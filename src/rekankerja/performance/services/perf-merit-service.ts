// ============================================================================
// RekanKerja PERFORMANCE P5 — Merit, PA & Surat (DEVELOPMENT-PLAN-PERFORMANCE.md
// §32 Alur 8 + §6 Konsekuensi + §33 Alur 9 keputusan awal PIP):
//   • meritBoard         — papan usulan merit per siklus (join appraisal +
//     employee + chain summary + DEKRIPSI nominal utk tampilan menu-guard
//     performance:results, pola payroll vault-gate getMoneyView).
//   • recommendMerit     — §32-1: draf OTOMATIS peserta Closed × matrix aktif
//     (guard §35-17: unique appraisalId → skip, rating null → skip, tanpa
//     baseSalary → laporan noSalary). Nominal = matrix × baseSalary assignment
//     aktif (decryptMoney) → disimpan VAULT enc:v1 (encryptMoney).
//   • patchMerit         — HR adjust draf (bonusMonths/raisePct/note) + recompute
//     nominal terenkripsi.
//   • submitMerit        — Draft → Submitted + approval docType "MeritRecommendation"
//     (NOMINAL tier D12 §11.1: L2 Direktur aktif bila total ≥ Rp 10 jt).
//   • decideMeritApproval — keputusan approver jenjang: approve penuh → Approved;
//     reject → kembali Draft (alasan ter-ActivityLog).
//   • cancelMerit        — Draft/Submitted → Cancelled (+ cancel chain).
//   • applyMerit/toPayroll — §32-3(a) (guard §35-18): injeksi EmployeeComponentAssignment
//     kind Specific ke period Open — bonus → processType BONUS komponen "BONUS"
//     (run dibuat+hitung bila belum ada — pola bonus-massal autoRun), raise →
//     processType SALARY komponen "RAPEL" (run sudah Calculated → hitung ulang).
//     Status Applied + appliedRunNo (BUKTI jurnal payroll menyerap).
//   • toPersonnelAction  — §32-3(b) (guard §35-19): draft PA SalaryAdjustment /
//     Promotion (promosi WAJIB rating ≥4 + potentialBand 3; override hanya
//     superAdmin + alasan → ter-ActivityLog sebagai override direksi).
//   • pipCandidates      — §32-5/§35-20: peserta Closed rating ≤2 TANPA PIP aktif.
//   • decidePip          — HR memutuskan jalankan Alur 9 (PipPlan Draft 30/60/90 +
//     SK PIP + notif pembina) ATAU menolak dengan alasan (ter-ActivityLog).
//     Aktivasi/checkpoint/extend/outcome = P6 — P5 hanya create Draft.
//   • issueResultLetter(s) — Surat Hasil Penilaian PERF_RESULT per karyawan
//     (idempoten via metaJson appraisalNo; massal per siklus) + listPerfLetters.
//
// Nominal uang HANYA via encryptMoney/decryptMoney (vault enc:v1 — §37 merit
// vault). THR tidak disentuh (§7.1). ActivityLog SETIAP mutasi (pola modul).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { getMoneyView } from "@/rekankerja/shared/lib/money-view";
import {
  startApprovalChain, getApprovalChain, decideApprovalChain, cancelApprovalChain, attachChainSummaries,
  type ChainView, type ChainSummary, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { issueLetter, fmtDateIdLong } from "@/rekankerja/shared/services/letter-service";
import { nextPerfNo } from "@/rekankerja/performance/services/perf-master-service";
import { scoreKpiItem } from "@/rekankerja/performance/services/perf-appraisal-service";
import { calculateAndSaveRun, nextRunNo } from "@/rekankerja/payroll/services/payroll-service";
import { validateSalaryAgainstGrade } from "@/rekankerja/human-resource/services/pa-targets";

export const MERIT_DOC_TYPE = "MeritRecommendation";
export const MERIT_STRUCTURE_CODE = "AS-MERIT-STD";
/** D12: jenjang Direktur aktif bila total usulan (bonus+raise) ≥ Rp 10 jt. */
export const MERIT_L2_MIN_AMOUNT = 10_000_000;
export const PERF_RESULT_KEY = "PERF_RESULT";
export const PERF_PIP_KEY = "PERF_PIP";
/** status PIP yang menghalangi usulan baru (§35-20) — derivasi Object.keys agar literal status tak masuk array label (konvensi perf-cycle STATUS_ORDER). */
const PIP_ACTIVE_STATUS_SET: Record<string, true> = { Draft: true, Active: true, Extended: true };
const PIP_ACTIVE_STATUSES: string[] = Object.keys(PIP_ACTIVE_STATUS_SET);
/** status PayrollRun yang masih bisa menyerap komponen baru (Draft/Calculated). */
const OPEN_RUN_STATUS_SET: Record<string, true> = { Draft: true, Calculated: true };
const OPEN_RUN_STATUSES: string[] = Object.keys(OPEN_RUN_STATUS_SET);

const round0 = (n: number) => Math.round(n);

// ============ aktor (pola CalibrationActor P4) ============

export interface MeritActor {
  /** employeeId aktor — null = akun HR tanpa data karyawan (akses penuh). */
  employeeId: string | null;
  /** true = super admin (OWNER/ADMIN platform / AppUser Admin). */
  superAdmin: boolean;
  /** nama tampilan utk audit. */
  name: string;
  /** vault gate (pola payroll) — AppUser id + role membership platform. */
  userId: string;
  role: string;
}

// ============ util matrix & gaji ============

interface MeritCell { bonusMonths?: number; raisePct?: [number, number]; note?: string }

/** Parse gridJson matrix (rating → cell) dengan aman. */
function parseMeritGrid(gridJson: string): Record<string, MeritCell> {
  try {
    const v = JSON.parse(gridJson) as Record<string, unknown>;
    if (!v || typeof v === "object" && !Array.isArray(v)) return v as Record<string, MeritCell>;
  } catch { /* grid rusak */ }
  return {};
}

/** raisePct MID dari range (mis. [8,12] → 10) — nilai yang diusulkan draf. */
function raiseMidOf(cell: MeritCell): number {
  const r = cell.raisePct;
  if (!Array.isArray(r) || r.length !== 2) return 0;
  return Math.round(((Number(r[0]) + Number(r[1])) / 2) * 100) / 100;
}

/** Gaji pokok assignment aktif (validTo null) terbaru — DEKRIPSI (28-c). */
async function activeBaseSalaryOf(db: TenantDb, employeeId: string): Promise<number | null> {
  const a = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { baseSalary: true },
  });
  if (!a || a.baseSalary == null) return null;
  return tenantCryptoForDb(db).decryptMoney(a.baseSalary);
}

/** Nilai merit (raw decrypt — kalkulasi bisnis JALAN walau vault tertutup). */
function meritAmountsOf(
  merit: { bonusAmount: string | null; raiseAmount: string | null },
  tc: { decryptMoney(s: string | null): number | null },
): { bonus: number; raise: number; total: number } {
  const bonus = tc.decryptMoney(merit.bonusAmount) ?? 0;
  const raise = tc.decryptMoney(merit.raiseAmount) ?? 0;
  return { bonus, raise, total: bonus + raise };
}

// ============ struktur approval AS-MERIT-STD (§11.1 D12) ============

/**
 * Struktur default MeritRecommendation — NOMINAL (AMOUNT_DOC_TYPES):
 *   L1 HR_ADMIN       — verifikasi usulan HR (selalu aktif)
 *   L2 POSISI Direktur — minAmount Rp 10.000.000 (D12): aktif hanya bila total
 *     usulan (bonus+raise) ≥ Rp 10 jt (mekanisme tier uang Travel/Medical/Loan).
 * Idempoten insert-only per code (pola ensurePerfApprovalStructure P4).
 */
export async function ensureMeritApprovalStructure(db: TenantDb): Promise<{ code: string; levels: number }> {
  const existing = await db.approvalStructure.findUnique({
    where: { code: MERIT_STRUCTURE_CODE },
    include: { levels: { select: { levelNo: true } } },
  });
  if (existing) return { code: existing.code, levels: existing.levels.length };

  // resolusi posisi "Direktur" (copy P4): prefer kode P-CEO → judul ber-"director"/
  // "direktur" pada positionLevel tertinggi → position apa pun di level tertinggi.
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

  const levels: { levelNo: number; approverType: string; approverPositionId?: string; minAmount: number | null; note: string }[] = [
    { levelNo: 1, approverType: "HR_ADMIN", minAmount: null, note: "Verifikasi usulan merit HR" },
  ];
  if (dirPosition) {
    levels.push({
      levelNo: 2, approverType: "POSISI", approverPositionId: dirPosition.id,
      minAmount: MERIT_L2_MIN_AMOUNT,
      note: `Direktur — aktif bila total usulan ≥ Rp ${(MERIT_L2_MIN_AMOUNT / 1_000_000).toFixed(0)} jt (tier nominal D12 §11.1)`,
    });
  }

  await db.approvalStructure.create({
    data: {
      code: MERIT_STRUCTURE_CODE,
      name: "Persetujuan Usulan Merit (default)",
      docType: MERIT_DOC_TYPE,
      levels: { create: levels },
    },
  });
  return { code: MERIT_STRUCTURE_CODE, levels: levels.length };
}

// ============ papan merit (GET) ============

/** Siklus default utk merit: Closed terbaru (pasca-publikasi §32). */
export async function defaultMeritCycleId(db: TenantDb): Promise<string | null> {
  const c = await db.performanceCycle.findFirst({
    where: { status: "Closed" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return c?.id ?? (await db.performanceCycle.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ?? null;
}

export interface MeritBoardRow {
  id: string; docNo: string; status: string;
  appraisalId: string; appraisalNo: string;
  employeeId: string; employeeNo: string; fullName: string;
  unitName: string | null; managerName: string | null; positionName: string | null;
  finalScore: number | null; finalRating: number | null; potentialBand: number | null;
  ratingLabel: string | null; ratingLabelEn: string | null; ratingColor: string | null;
  bonusMonths: number | null; bonusAmount: number;
  raisePct: number | null; raiseAmount: number;
  /** gaji pokok assignment aktif (vault-gate utk pratinjau dialog patch/PA). */
  baseSalary: number;
  totalAmount: number; note: string | null;
  matrixCode: string | null;
  personnelActionId: string | null; appliedRunNo: string | null;
  approval: { status: string; currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
  approvalSteps: { levelNo: number; approverLabel: string; status: string; note: string | null; decidedBy: string | null }[];
}

/** Papan merit lengkap satu siklus (menu-guard performance:results). */
export async function meritBoard(
  db: TenantDb,
  actor: MeritActor,
  opt: { cycleId?: string },
): Promise<{
  cycle: { id: string; code: string; name: string; status: string; periodStart: string | null; periodEnd: string | null };
  structure: { code: string; levels: number };
  matrix: { id: string; code: string; name: string; grid: Record<string, MeritCell> } | null;
  recommendations: MeritBoardRow[];
  stats: { byStatus: Record<string, number>; totalBonus: number; totalRaise: number; totalAmount: number };
  candidates: { appraisalId: string; docNo: string; employeeNo: string; fullName: string; finalRating: number | null }[];
  pipCandidates: Awaited<ReturnType<typeof pipCandidates>>["rows"];
  letters: Awaited<ReturnType<typeof listPerfLetters>>["letters"];
  openRuns: { id: string; runNo: string; status: string; periodCode: string; periodName: string; processTypeCode: string; processTypeName: string }[];
  money: { canSee: boolean };
}> {
  const cycleId = opt.cycleId || (await defaultMeritCycleId(db));
  const cycle = cycleId
    ? await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { id: true, code: true, name: true, status: true, periodStart: true, periodEnd: true } })
    : null;
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const structure = await ensureMeritApprovalStructure(db);

  // matrix aktif (atau terbaru bila tidak ada yang aktif)
  const matrixRow = (await db.meritMatrix.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } }))
    ?? (await db.meritMatrix.findFirst({ orderBy: { updatedAt: "desc" } }));

  // vault gate (pola payroll bonus-massal): tampilan nominal mengikuti vault
  const mv = await getMoneyView(db, { userId: actor.userId, membershipRole: actor.role });

  // usulan merit siklus ini
  const merits = await db.meritRecommendation.findMany({
    where: { appraisal: { cycleId: cycle.id } },
    include: {
      appraisal: {
        select: {
          id: true, docNo: true, status: true, finalScore: true, finalRating: true, potentialBand: true,
          employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true, positionId: true } },
          manager: { select: { fullName: true } },
        },
      },
      matrix: { select: { code: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });

  const unitIds = [...new Set(merits.map((m) => m.appraisal.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0
    ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } })
    : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));
  const posIds = [...new Set(merits.map((m) => m.appraisal.employee.positionId).filter((x): x is string => !!x))];
  const positions = posIds.length > 0
    ? await db.position.findMany({ where: { id: { in: posIds } }, select: { id: true, title: true } })
    : [];
  const posNameOf = new Map(positions.map((p) => [p.id, p.title]));
  const scales = await db.ratingScale.findMany();
  const scaleOf = new Map(scales.map((s) => [s.value, s]));

  const chains = await attachChainSummaries(db, MERIT_DOC_TYPE, merits.map((m) => ({ id: m.id })));
  const chainViews = new Map<string, ChainView>();
  for (const m of merits) {
    const v = await getApprovalChain(db, MERIT_DOC_TYPE, m.id);
    if (v) chainViews.set(m.id, v);
  }

  // gaji pokok aktif per karyawan (utk pratinjau nominal dialog — vault-gate)
  const empIds = [...new Set(merits.map((m) => m.appraisal.employee.id))];
  const baseRows = empIds.length > 0
    ? await db.employeeAssignment.findMany({
        where: { employeeId: { in: empIds }, validTo: null },
        orderBy: { validFrom: "desc" },
        select: { employeeId: true, baseSalary: true },
      })
    : [];
  const baseOf = new Map<string, number>();
  for (const b of baseRows) {
    if (!baseOf.has(b.employeeId)) baseOf.set(b.employeeId, mv.dec0(b.baseSalary));
  }

  const recommendations: MeritBoardRow[] = merits.map((m) => {
    const c = chains.get(m.id) ?? null;
    const bonus = mv.dec0(m.bonusAmount);
    const raise = mv.dec0(m.raiseAmount);
    const sc = m.appraisal.finalRating != null ? scaleOf.get(m.appraisal.finalRating) : undefined;
    return {
      id: m.id, docNo: m.docNo, status: m.status,
      appraisalId: m.appraisal.id, appraisalNo: m.appraisal.docNo,
      employeeId: m.appraisal.employee.id, employeeNo: m.appraisal.employee.employeeNo, fullName: m.appraisal.employee.fullName,
      unitName: unitNameOf.get(m.appraisal.employee.orgUnitId ?? "") ?? null,
      managerName: m.appraisal.manager?.fullName ?? null,
      positionName: posNameOf.get(m.appraisal.employee.positionId ?? "") ?? null,
      finalScore: m.appraisal.finalScore, finalRating: m.appraisal.finalRating, potentialBand: m.appraisal.potentialBand,
      ratingLabel: sc?.labelId ?? null, ratingLabelEn: sc?.labelEn ?? null, ratingColor: sc?.color ?? null,
      bonusMonths: m.bonusMonths, bonusAmount: bonus,
      raisePct: m.raisePct, raiseAmount: raise,
      baseSalary: baseOf.get(m.appraisal.employee.id) ?? 0,
      totalAmount: bonus + raise, note: m.note,
      matrixCode: m.matrix?.code ?? null,
      personnelActionId: m.personnelActionId, appliedRunNo: m.appliedRunNo,
      approval: c ? { status: c.status, currentLevel: c.currentLevel, totalLevels: c.totalLevels, currentApprover: c.currentApprover } : null,
      approvalSteps: (chainViews.get(m.id)?.steps ?? []).map((s) => ({
        levelNo: s.levelNo, approverLabel: s.approverLabel, status: s.status, note: s.note, decidedBy: s.decidedBy,
      })),
    };
  });

  const byStatus: Record<string, number> = {};
  for (const r of recommendations) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  // kandidat usulan baru: peserta Closed ber-rating TANPA merit (§35-17)
  const closedRows = await db.appraisalRecord.findMany({
    where: { cycleId: cycle.id, status: "Closed" },
    select: { id: true, docNo: true, finalRating: true, employee: { select: { employeeNo: true, fullName: true } } },
    orderBy: { docNo: "asc" },
  });
  const haveMerit = new Set(merits.map((m) => m.appraisal.id));
  const candidates = closedRows
    .filter((r) => !haveMerit.has(r.id) && r.finalRating != null)
    .map((r) => ({
      appraisalId: r.id, docNo: r.docNo,
      employeeNo: r.employee.employeeNo, fullName: r.employee.fullName, finalRating: r.finalRating,
    }));

  // run terbuka (Draft/Calculated) di period Open — target penerapan payroll
  const openRuns = await db.payrollRun.findMany({
    where: { status: { in: OPEN_RUN_STATUSES }, period: { status: "Open" } },
    include: { period: { select: { code: true, name: true } }, processType: { select: { code: true, name: true } } },
    orderBy: [{ period: { startDate: "desc" } }, { createdAt: "asc" }],
    take: 20,
  });

  return {
    cycle: {
      id: cycle.id, code: cycle.code, name: cycle.name, status: cycle.status,
      periodStart: cycle.periodStart?.toISOString() ?? null, periodEnd: cycle.periodEnd?.toISOString() ?? null,
    },
    structure: { code: structure.code, levels: structure.levels },
    matrix: matrixRow ? { id: matrixRow.id, code: matrixRow.code, name: matrixRow.name, grid: parseMeritGrid(matrixRow.gridJson) } : null,
    recommendations,
    stats: {
      byStatus,
      totalBonus: recommendations.reduce((s, r) => s + r.bonusAmount, 0),
      totalRaise: recommendations.reduce((s, r) => s + r.raiseAmount, 0),
      totalAmount: recommendations.reduce((s, r) => s + r.totalAmount, 0),
    },
    candidates,
    pipCandidates: (await pipCandidates(db, actor, { cycleId: cycle.id })).rows,
    letters: (await listPerfLetters(db, { cycleId: cycle.id })).letters,
    openRuns: openRuns.map((r) => ({
      id: r.id, runNo: r.runNo, status: r.status,
      periodCode: r.period.code, periodName: r.period.name,
      processTypeCode: r.processType.code, processTypeName: r.processType.name,
    })),
    money: { canSee: mv.canSee },
  };
}

// ============ 1. rekomendasi otomatis (§32-1, guard §35-17) ============

export async function recommendMerit(
  db: TenantDb,
  actor: MeritActor,
  input: { cycleId: string; matrixId?: string },
): Promise<{
  matrixCode: string;
  created: { docNo: string; employeeNo: string; fullName: string; finalRating: number | null; bonusMonths: number; raisePct: number; bonusAmount: number; raiseAmount: number }[];
  skippedExisting: { docNo: string; employeeNo: string; fullName: string; meritDocNo: string }[];
  skippedNoRating: { docNo: string; employeeNo: string; fullName: string }[];
  noSalary: { docNo: string; employeeNo: string; fullName: string }[];
}> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { id: true, code: true } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const matrix = input.matrixId
    ? await db.meritMatrix.findUnique({ where: { id: input.matrixId } })
    : await db.meritMatrix.findFirst({ where: { active: true } });
  if (!matrix || !matrix.active) {
    throw new Error(`Matrix merit aktif tidak ditemukan — aktifkan matriks di menu Master Kinerja (§35-17)`);
  }
  const grid = parseMeritGrid(matrix.gridJson);

  const tc = tenantCryptoForDb(db);
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: cycle.id, status: "Closed" }, // guard §35-17: peserta Closed
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } }, merit: { select: { id: true, docNo: true } } },
    orderBy: { docNo: "asc" },
    take: 500,
  });

  const created: { docNo: string; employeeNo: string; fullName: string; finalRating: number | null; bonusMonths: number; raisePct: number; bonusAmount: number; raiseAmount: number }[] = [];
  const skippedExisting: { docNo: string; employeeNo: string; fullName: string; meritDocNo: string }[] = [];
  const skippedNoRating: { docNo: string; employeeNo: string; fullName: string }[] = [];
  const noSalary: { docNo: string; employeeNo: string; fullName: string }[] = [];

  for (const a of rows) {
    if (a.merit) {
      skippedExisting.push({ docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName, meritDocNo: a.merit.docNo });
      continue; // unique appraisalId §35-17
    }
    if (a.finalRating == null) {
      skippedNoRating.push({ docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName });
      continue;
    }
    const base = await activeBaseSalaryOf(db, a.employeeId);
    if (base == null) {
      noSalary.push({ docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName });
      continue;
    }
    const cell = grid[String(a.finalRating)];
    const bonusMonths = cell?.bonusMonths ?? 0;
    const raisePct = cell ? raiseMidOf(cell) : 0;
    const bonusAmount = round0(bonusMonths * base);
    const raiseAmount = round0((base * raisePct) / 100);

    const docNo = await nextPerfNo(db, "MER");
    await db.meritRecommendation.create({
      data: {
        docNo,
        appraisalId: a.id,
        matrixId: matrix.id,
        bonusMonths,
        bonusAmount: tc.encryptMoney(bonusAmount), // VAULT enc:v1
        raisePct,
        raiseAmount: tc.encryptMoney(raiseAmount), // VAULT enc:v1
        status: "Draft",
      },
    });
    await db.activityLog.create({
      data: {
        action: "Created", entity: "MeritRecommendation", entityId: docNo,
        employeeId: a.employeeId,
        detail: `Usulan merit ${docNo} (${a.employee.fullName} · ${a.docNo} rating ${a.finalRating}) dibuat otomatis dari matrix ${matrix.code}: bonus ${bonusMonths} bln + raise ${raisePct}% atas gaji pokok — nominal tersimpan terenkripsi (vault enc:v1) (${actor.name}, §32-1)`,
      },
    });
    created.push({
      docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName, finalRating: a.finalRating,
      bonusMonths, raisePct, bonusAmount, raiseAmount,
    });
  }

  return { matrixCode: matrix.code, created, skippedExisting, skippedNoRating, noSalary };
}

// ============ 2. patch draf (recompute nominal terenkripsi) ============

export async function patchMerit(
  db: TenantDb,
  actor: MeritActor,
  input: { id: string; patch: { bonusMonths?: number; raisePct?: number; note?: string } },
): Promise<{ docNo: string; bonusMonths: number | null; raisePct: number | null; bonusAmount: number; raiseAmount: number }> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: { appraisal: { select: { id: true, docNo: true, employeeId: true, employee: { select: { fullName: true } } } } },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status !== "Draft") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — hanya draf yang dapat diubah (§35-17)`);
  }
  // patch kosong (tidak ada field yang dikirim) → tolak eksplisit, bukan sukses
  // senyap tanpa perubahan (pelajaran bug UI: payload bentuk salah lolos tanpa pesan).
  if (input.patch.bonusMonths == null && input.patch.raisePct == null && input.patch.note === undefined) {
    throw new Error("Tidak ada perubahan yang dikirim — isi bonus bulan / kenaikan % / catatan");
  }

  const bonusMonths = input.patch.bonusMonths != null
    ? Math.max(0, Math.min(24, Number(input.patch.bonusMonths)))
    : merit.bonusMonths;
  const raisePct = input.patch.raisePct != null
    ? Math.max(0, Math.min(100, Number(input.patch.raisePct)))
    : merit.raisePct;

  const base = await activeBaseSalaryOf(db, merit.appraisal.employeeId);
  const tc = tenantCryptoForDb(db);
  const bonusAmount = bonusMonths != null && base != null ? round0(bonusMonths * base) : 0;
  const raiseAmount = raisePct != null && base != null ? round0((base * raisePct) / 100) : 0;

  await db.meritRecommendation.update({
    where: { id: merit.id },
    data: {
      bonusMonths,
      raisePct,
      bonusAmount: tc.encryptMoney(bonusAmount),
      raiseAmount: tc.encryptMoney(raiseAmount),
      ...(input.patch.note !== undefined ? { note: input.patch.note } : {}),
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "MeritRecommendation", entityId: merit.docNo,
      employeeId: merit.appraisal.employeeId,
      detail: `Usulan merit ${merit.docNo} (${merit.appraisal.employee.fullName}) diubah: bonus ${bonusMonths ?? 0} bln (Rp ${bonusAmount.toLocaleString("id-ID")}) + raise ${raisePct ?? 0}% (Rp ${raiseAmount.toLocaleString("id-ID")}) — nominal vault dihitung ulang (${actor.name})`,
    },
  });
  return { docNo: merit.docNo, bonusMonths, raisePct, bonusAmount, raiseAmount };
}

// ============ 3. submit → approval chain (D12 nominal tier) ============

export async function submitMerit(
  db: TenantDb,
  actor: MeritActor,
  input: { id: string },
): Promise<{ docNo: string; status: string; levels: number; firstApprover: string | null; amount: number; needL2: boolean; chain: ChainView }> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: {
      appraisal: {
        select: { id: true, docNo: true, employeeId: true, cycle: { select: { code: true } }, employee: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status === "Submitted") throw new Error(`${merit.docNo} sudah menunggu keputusan approval`);
  if (merit.status !== "Draft") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — pengajuan hanya dari Draft (§35-17)`);
  }

  await ensureMeritApprovalStructure(db);

  // total nominal (RAW decrypt — tier D12 dihitung walau vault tampilan tertutup)
  const tc = tenantCryptoForDb(db);
  const amount = meritAmountsOf(merit, tc).total;

  // chain lama terminal → bersihkan utk pengajuan ulang (audit tetap di ActivityLog)
  const existing = await getApprovalChain(db, MERIT_DOC_TYPE, merit.id);
  if (existing && (existing.status === "Rejected" || existing.status === "Cancelled")) {
    await db.approvalChain.delete({ where: { docType_docId: { docType: MERIT_DOC_TYPE, docId: merit.id } } });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "MeritRecommendation", entityId: merit.docNo,
        detail: `Usulan merit ${merit.docNo} diajukan ULANG setelah chain sebelumnya ${existing.status}`,
      },
    });
  } else if (existing && existing.status === "InProgress") {
    throw new Error(`${merit.docNo} sudah menunggu keputusan approval`);
  }

  const chain = await startApprovalChain(db, {
    docType: MERIT_DOC_TYPE as never, docId: merit.id,
    employeeId: merit.appraisal.employeeId, // pemohon = karyawan yang dinilai (§23-D4)
    amount,
    createdBy: actor.name,
  });
  await db.meritRecommendation.update({ where: { id: merit.id }, data: { status: "Submitted" } });
  const needL2 = amount >= MERIT_L2_MIN_AMOUNT;
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "MeritRecommendation", entityId: merit.docNo,
      employeeId: merit.appraisal.employeeId,
      detail: `Usulan merit ${merit.docNo} (${merit.appraisal.employee.fullName} · ${merit.appraisal.docNo}) diajukan ke approval ${MERIT_DOC_TYPE} — total Rp ${amount.toLocaleString("id-ID")} · ${chain.totalLevels} jenjang${needL2 ? " (L2 Direktur AKTIF — nominal ≥ Rp 10 jt, tier D12 §11.1)" : ""} (${actor.name}, §32-2)`,
    },
  });

  const first = chain.steps.find((s) => s.status === "Current") ?? null;
  void notifyEvent(db, {
    to: "nextApprover", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
    title: `Usulan merit ${merit.docNo} menunggu persetujuan Anda`,
    body: `${merit.appraisal.employee.fullName} · siklus ${merit.appraisal.cycle.code} — total Rp ${amount.toLocaleString("id-ID")}${needL2 ? " (jenjang Direktur aktif)" : ""}`,
    kind: "performance", link: "performance:results",
  }).catch(() => { /* never */ });

  return { docNo: merit.docNo, status: "Submitted", levels: chain.totalLevels, firstApprover: first?.approverLabel ?? null, amount, needL2, chain };
}

// ============ 4. keputusan approval (approve → Approved / reject → Draft) ============

export async function decideMeritApproval(
  db: TenantDb,
  input: { docId: string; action: "approve" | "reject"; note?: string | null; actor: DecideActor },
): Promise<{ docNo: string; status: string; final: boolean; approval: ChainSummary | null }> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.docId },
    include: {
      appraisal: {
        select: { id: true, docNo: true, employeeId: true, cycle: { select: { code: true } }, employee: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status !== "Submitted") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — tidak menunggu keputusan approval`);
  }
  const chain = await getApprovalChain(db, MERIT_DOC_TYPE, merit.id);
  if (!chain) throw new Error("Jalur persetujuan tidak ditemukan — ajukan ulang usulan");

  const res = await decideApprovalChain(db, {
    docType: MERIT_DOC_TYPE as never, docId: merit.id,
    action: input.action, note: input.note ?? undefined, actor: input.actor,
  });
  const summary: ChainSummary = {
    status: res.chain.status, currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
    currentApprover: res.chain.steps.find((s) => s.status === "Current")?.approverLabel ?? null,
  };

  if (!res.final) {
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "MeritRecommendation", entityId: merit.docNo,
        employeeId: merit.appraisal.employeeId,
        detail: `Usulan merit ${merit.docNo} disetujui jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} (${input.actor.name}) — lanjut ke ${summary.currentApprover ?? "-"}`,
      },
    });
    void notifyEvent(db, {
      to: "nextApprover", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
      title: `Usulan merit ${merit.docNo} menunggu persetujuan Anda (jenjang berikutnya)`,
      body: `${merit.appraisal.employee.fullName} · siklus ${merit.appraisal.cycle.code}`,
      kind: "performance", link: "performance:results",
    }).catch(() => { /* never */ });
    return { docNo: merit.docNo, status: "Submitted", final: false, approval: summary };
  }

  if (input.action === "approve") {
    await db.meritRecommendation.update({ where: { id: merit.id }, data: { status: "Approved" } });
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "MeritRecommendation", entityId: merit.docNo,
        employeeId: merit.appraisal.employeeId,
        detail: `Usulan merit ${merit.docNo} (${merit.appraisal.employee.fullName}) DISETUJUI PENUH (${res.chain.totalLevels} jenjang, keputusan akhir ${input.actor.name}) — siap diterapkan ke payroll / Personnel Action (§32-2)`,
      },
    });
    // milestone: notif admin HR
    void notifyEvent(db, {
      to: "admins", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
      title: `Usulan merit ${merit.docNo} disetujui penuh`,
      body: `${merit.appraisal.employee.fullName} · siklus ${merit.appraisal.cycle.code} — silakan terapkan ke payroll / Personnel Action`,
      kind: "performance", link: "performance:results",
    }).catch(() => { /* never */ });
    return { docNo: merit.docNo, status: "Approved", final: true, approval: summary };
  }

  // reject final → kembali Draft (alasan ter-ActivityLog)
  await db.meritRecommendation.update({ where: { id: merit.id }, data: { status: "Draft" } });
  await db.activityLog.create({
    data: {
      action: "Rejected", entity: "MeritRecommendation", entityId: merit.docNo,
      employeeId: merit.appraisal.employeeId,
      detail: `Usulan merit ${merit.docNo} DITOLAK (${input.actor.name}) — kembali ke Draft${input.note?.trim() ? ` — alasan: ${input.note.trim()}` : ""}`,
    },
  });
  void notifyEvent(db, {
    to: "admins", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
    title: `Usulan merit ${merit.docNo} ditolak`,
    body: `${merit.appraisal.employee.fullName} · siklus ${merit.appraisal.cycle.code} — kembali ke Draft${input.note?.trim() ? ` (${input.note.trim()})` : ""}`,
    kind: "performance", link: "performance:results",
  }).catch(() => { /* never */ });
  return { docNo: merit.docNo, status: "Draft", final: true, approval: summary };
}

// ============ 5. batalkan ============

export async function cancelMerit(
  db: TenantDb,
  actor: MeritActor,
  input: { id: string },
): Promise<{ docNo: string; status: string }> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: { appraisal: { select: { docNo: true, employeeId: true, employee: { select: { fullName: true } } } } },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status !== "Draft" && merit.status !== "Submitted") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — pembatalan hanya dari Draft/Submitted`);
  }
  await cancelApprovalChain(db, MERIT_DOC_TYPE, merit.id, actor.name); // pola perf-calibration L821
  await db.meritRecommendation.update({ where: { id: merit.id }, data: { status: "Cancelled" } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "MeritRecommendation", entityId: merit.docNo,
      employeeId: merit.appraisal.employeeId,
      detail: `Usulan merit ${merit.docNo} (${merit.appraisal.employee.fullName}) DIBATALKAN oleh ${actor.name}`,
    },
  });
  return { docNo: merit.docNo, status: "Cancelled" };
}

// ============ 6. terapkan ke payroll (§32-3a — guard §35-18) ============

/**
 * toPayroll / applyMerit: injeksi nominal ke run payroll period Open.
 *   bonus → processType BONUS · komponen "BONUS" (run dibuat+hitung bila belum
 *          ada — pola autoRun bonus-massal);
 *   raise → processType SALARY · komponen "RAPEL" (run sudah Calculated →
 *          hitung ulang calculateAndSaveRun).
 * Idempoten per dokumen: status Applied + appliedRunNo (guard §35-18).
 */
export async function applyMerit(
  db: TenantDb,
  actor: MeritActor,
  input: { id: string; includeBonus?: boolean; includeRaise?: boolean },
): Promise<{
  docNo: string; status: string;
  period: { code: string; name: string };
  bonusRun: { runNo: string; status: string; created: boolean; recalculated: boolean } | null;
  raiseRun: { runNo: string; status: string; created: boolean; recalculated: boolean } | null;
  assignments: { component: string; amount: number }[];
}> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: {
      appraisal: {
        select: { id: true, docNo: true, employeeId: true, cycle: { select: { code: true } }, employee: { select: { id: true, employeeNo: true, fullName: true } } },
      },
    },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status === "Applied") {
    throw new Error(`${merit.docNo} sudah diterapkan ke payroll (run ${merit.appliedRunNo ?? "-"}) — tidak boleh apply dua kali (§35-18)`);
  }
  if (merit.status !== "Approved") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — penerapan payroll hanya dari Approved (§35-18)`);
  }

  const includeBonus = input.includeBonus !== false;
  const includeRaise = input.includeRaise !== false;
  if (!includeBonus && !includeRaise) {
    throw new Error("Pilih minimal satu: bonus atau kenaikan (raise)");
  }

  const tc = tenantCryptoForDb(db);
  const amounts = meritAmountsOf(merit, tc);
  const actions: { key: "bonus" | "raise"; enabled: boolean; amount: number }[] = [
    { key: "bonus", enabled: includeBonus && amounts.bonus > 0, amount: amounts.bonus },
    { key: "raise", enabled: includeRaise && amounts.raise > 0, amount: amounts.raise },
  ];
  if (!actions.some((a) => a.enabled)) {
    throw new Error(`Tidak ada nominal untuk diterapkan (bonus Rp ${amounts.bonus.toLocaleString("id-ID")} · raise Rp ${amounts.raise.toLocaleString("id-ID")}) — pilih komponen lain atau perbaiki usulan (§35-18)`);
  }

  // period Open terbaru (guard §35-18)
  const period = await db.payrollPeriod.findFirst({
    where: { status: "Open" },
    orderBy: { startDate: "desc" },
  });
  if (!period) throw new Error("Tidak ada period payroll berstatus Open — buka period dahulu (§35-18)");

  const out: {
    bonusRun: { runNo: string; status: string; created: boolean; recalculated: boolean } | null;
    raiseRun: { runNo: string; status: string; created: boolean; recalculated: boolean } | null;
    assignments: { component: string; amount: number }[];
  } = { bonusRun: null, raiseRun: null, assignments: [] };

  /** cari run terbuka (Draft/Calculated) period × processType — Confirmed/Paid menolak. */
  const findOpenRun = async (processTypeId: string) => {
    const run = await db.payrollRun.findFirst({
      where: { periodId: period.id, processTypeId, status: { not: "Cancelled" } },
      include: { period: true, processType: true },
      orderBy: { createdAt: "desc" },
    });
    if (run && (run.status === "Confirmed" || run.status === "Paid")) {
      throw new Error(`Run ${run.runNo} (${run.processType.code}) pada ${period.name} sudah ${run.status} — pilih period lain atau batalkan run (§35-18)`);
    }
    return run;
  };

  // ---- bonus: processType BONUS + komponen "BONUS" ----
  if (actions[0].enabled) {
    const [processType, component] = await Promise.all([
      db.processType.findFirst({ where: { code: "BONUS", active: true } }),
      db.wageComponent.findFirst({ where: { code: "BONUS", active: true } }),
    ]);
    if (!processType) throw new Error("ProcessType BONUS tidak ditemukan (§35-18)");
    if (!component) throw new Error("Komponen upah BONUS tidak ditemukan (§35-18)");

    let run = await findOpenRun(processType.id);
    const created = !run;
    if (!run) {
      // buat + hitung run (pola autoRun bonus-massal)
      run = await db.payrollRun.create({
        data: {
          runNo: await nextRunNo(db, period.code, processType.code),
          periodId: period.id,
          processTypeId: processType.id,
          calculateTax: processType.calculateTax,
          allEmployee: true,
          notes: `Merit ${merit.docNo} — ${merit.appraisal.employee.fullName}`,
        },
        include: { period: true, processType: true },
      });
      await db.activityLog.create({
        data: {
          action: "Created", entity: "PayrollRun", entityId: run.id,
          detail: `Run ${run.runNo} dibuat otomatis dari penerapan merit ${merit.docNo} (${period.name} × ${processType.code})`,
        },
      });
    }
    const wasCalculated = run.status === "Calculated";
    // idempoten: hapus assignment lama dgn notes sama (re-apply tidak mendobel)
    await db.employeeComponentAssignment.deleteMany({
      where: { employeeId: merit.appraisal.employeeId, notes: `Merit ${merit.docNo}` },
    });
    await db.employeeComponentAssignment.create({
      data: {
        employeeId: merit.appraisal.employeeId,
        wageComponentId: component.id,
        kind: "Specific",
        amount: tc.encryptMoney(amounts.bonus), // VAULT enc:v1
        periodId: period.id,
        processTypeId: processType.id,
        basedDate: new Date(),
        notes: `Merit ${merit.docNo}`,
      },
    });
    out.assignments.push({ component: "BONUS", amount: amounts.bonus });
    await calculateAndSaveRun(db, run.id); // Draft/Calculated → hitung (ulang)
    const fresh = await db.payrollRun.findUnique({ where: { id: run.id }, select: { runNo: true, status: true } });
    out.bonusRun = { runNo: fresh?.runNo ?? run.runNo, status: fresh?.status ?? "Calculated", created, recalculated: wasCalculated };
  }

  // ---- raise: processType SALARY + komponen "RAPEL" ----
  if (actions[1].enabled) {
    const [processType, component] = await Promise.all([
      db.processType.findFirst({ where: { code: "SALARY", active: true } }),
      db.wageComponent.findFirst({ where: { code: "RAPEL", active: true } }),
    ]);
    if (!processType) throw new Error("ProcessType SALARY tidak ditemukan (§35-18)");
    if (!component) throw new Error("Komponen upah RAPEL tidak ditemukan (§35-18)");

    let run = await findOpenRun(processType.id);
    const created = !run;
    if (!run) {
      run = await db.payrollRun.create({
        data: {
          runNo: await nextRunNo(db, period.code, processType.code),
          periodId: period.id,
          processTypeId: processType.id,
          calculateTax: processType.calculateTax,
          allEmployee: true,
          notes: `Merit raise ${merit.docNo} — ${merit.appraisal.employee.fullName}`,
        },
        include: { period: true, processType: true },
      });
      await db.activityLog.create({
        data: {
          action: "Created", entity: "PayrollRun", entityId: run.id,
          detail: `Run ${run.runNo} dibuat otomatis dari penerapan merit raise ${merit.docNo} (${period.name} × ${processType.code})`,
        },
      });
    }
    const wasCalculated = run.status === "Calculated";
    await db.employeeComponentAssignment.deleteMany({
      where: { employeeId: merit.appraisal.employeeId, notes: `Merit raise ${merit.docNo}` },
    });
    await db.employeeComponentAssignment.create({
      data: {
        employeeId: merit.appraisal.employeeId,
        wageComponentId: component.id,
        kind: "Specific",
        amount: tc.encryptMoney(amounts.raise), // VAULT enc:v1
        periodId: period.id,
        processTypeId: processType.id,
        basedDate: new Date(),
        notes: `Merit raise ${merit.docNo}`,
      },
    });
    out.assignments.push({ component: "RAPEL", amount: amounts.raise });
    await calculateAndSaveRun(db, run.id); // bila sudah Calculated → hitung ulang
    const fresh = await db.payrollRun.findUnique({ where: { id: run.id }, select: { runNo: true, status: true } });
    out.raiseRun = { runNo: fresh?.runNo ?? run.runNo, status: fresh?.status ?? "Calculated", created, recalculated: wasCalculated };
  }

  // update merit: Applied + appliedRunNo (bukti penerapan §32-3a)
  const appliedRunNo = out.bonusRun?.runNo ?? out.raiseRun?.runNo ?? null;
  await db.meritRecommendation.update({
    where: { id: merit.id },
    data: { status: "Applied", appliedRunNo },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "MeritRecommendation", entityId: merit.docNo,
      employeeId: merit.appraisal.employeeId,
      detail:
        `Merit ${merit.docNo} (${merit.appraisal.employee.fullName}) DITERAPKAN ke payroll oleh ${actor.name} — ` +
        actions.filter((a) => a.enabled).map((a) =>
          a.key === "bonus"
            ? `bonus Rp ${amounts.bonus.toLocaleString("id-ID")} → komponen BONUS${out.bonusRun ? ` run ${out.bonusRun.runNo} (${period.name})` : ""}`
            : `raise Rp ${amounts.raise.toLocaleString("id-ID")} → komponen RAPEL${out.raiseRun ? ` run ${out.raiseRun.runNo} (${period.name})` : ""}`,
        ).join(" · ") + ` (§32-3a, §35-18)`,
    },
  });
  // milestone notif admin HR
  void notifyEvent(db, {
    to: "admins", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
    title: `Merit ${merit.docNo} diterapkan ke payroll`,
    body: `${merit.appraisal.employee.fullName} · ${period.name} — run ${appliedRunNo} menyerap usulan ini`,
    kind: "performance", link: "performance:results",
  }).catch(() => { /* never */ });

  return { docNo: merit.docNo, status: "Applied", period: { code: period.code, name: period.name }, ...out };
}

/** Alias kontrak §17 (toPayroll = applyMerit). */
export const toPayroll = applyMerit;

// ============ 7. Personnel Action (§32-3b — guard §35-19) ============

export async function toPersonnelAction(
  db: TenantDb,
  actor: MeritActor,
  input: { id: string; type: "SalaryAdjustment" | "Promotion"; effectiveDate?: string | null; force?: boolean; reason?: string | null },
): Promise<{ docNo: string; paId: string; type: string; override: boolean }> {
  const merit = await db.meritRecommendation.findUnique({
    where: { id: input.id },
    include: {
      appraisal: {
        select: {
          id: true, docNo: true, finalRating: true, potentialBand: true, managerId: true,
          employee: { select: { id: true, employeeNo: true, fullName: true, status: true, joinDate: true } },
        },
      },
    },
  });
  if (!merit) throw new Error("Usulan merit tidak ditemukan");
  if (merit.status !== "Approved" && merit.status !== "Applied") {
    throw new Error(`${merit.docNo} berstatus ${merit.status} — PA hanya dari merit Approved/Applied (§35-19)`);
  }
  if (merit.personnelActionId) {
    throw new Error(`${merit.docNo} sudah memiliki Personnel Action — tidak boleh duplikat (§35-19)`);
  }
  const emp = merit.appraisal.employee;
  if (emp.status !== "Active") {
    throw new Error(`Personnel Action hanya untuk karyawan Active (status ${emp.status}) (§35-19)`);
  }

  // ---- guard promosi: rating ≥ 4 + potentialBand 3 (override = superAdmin + alasan) ----
  let override = false;
  if (input.type === "Promotion") {
    const ratingOk = (merit.appraisal.finalRating ?? 0) >= 4;
    const bandOk = merit.appraisal.potentialBand === 3;
    if ((!ratingOk || !bandOk) && !(input.force === true && actor.superAdmin && input.reason?.trim())) {
      throw new Error(
        `Promosi hanya bila rating ≥ 4 dan potentialBand tinggi (band 3) — ${emp.fullName}: rating ${merit.appraisal.finalRating ?? "—"} · band ${merit.appraisal.potentialBand ?? "—"}. ` +
        `Override direksi: force=true + alasan wajib oleh superAdmin (§35-19)`,
      );
    }
    if (!ratingOk || !bandOk) override = true; // ter-log sebagai override direksi
  }

  // ---- PA duplikat aktif utk karyawan + jenis sama ----
  const dup = await db.personnelAction.findFirst({
    where: { employeeId: emp.id, type: input.type, status: { in: ["Prepared", "Submitted"] } },
    select: { docNo: true },
  });
  if (dup) {
    throw new Error(`Masih ada PA ${input.type} aktif ${dup.docNo} untuk ${emp.fullName} — selesaikan dahulu (§35-19)`);
  }

  // ---- mekanika (copy personnel-actions.ts POST) ----
  const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : new Date();
  if (Number.isNaN(effectiveDate.getTime())) throw new Error("Tanggal efektif tidak valid");
  if (effectiveDate.getTime() < emp.joinDate.getTime()) {
    throw new Error(`Tanggal efektif tidak boleh mendahului tanggal bergabung (${emp.joinDate.toISOString().slice(0, 10)})`);
  }

  const base = await activeBaseSalaryOf(db, emp.id);
  const detail: Record<string, unknown> =
    input.type === "SalaryAdjustment"
      ? {
          newSalary: base != null && merit.raisePct != null ? round0(base * (1 + merit.raisePct / 100)) : null,
          raisePct: merit.raisePct,
          meritDocNo: merit.docNo,
          source: "Merit",
        }
      : {
          meritDocNo: merit.docNo,
          fromRating: merit.appraisal.finalRating,
          potentialBand: merit.appraisal.potentialBand,
          source: "Merit",
        };

  // validasi gaji dalam rentang grade (SalaryAdjustment — M-05/M-06)
  if (input.type === "SalaryAdjustment" && detail.newSalary != null) {
    await validateSalaryAgainstGrade(db, Number(detail.newSalary), detail, emp.id);
  }

  // docNo PA-YYYY-NNNN max-suffix
  const last = await db.personnelAction.findFirst({ orderBy: { docNo: "desc" }, select: { docNo: true } });
  const nextNo = last ? Number(last.docNo.split("-").pop()) + 1 : 1;
  const docNo = `PA-${new Date().getFullYear()}-${String(nextNo).padStart(4, "0")}`;

  // layers template AT-PA-STD + resolusi approver (Dept Head = atasan langsung)
  const template = await db.approvalTemplate.findFirst({ where: { code: "AT-PA-STD" } });
  const layersDef: { layer: number; role: string }[] = template ? JSON.parse(template.layersJson) : [{ layer: 1, role: "HR Manager" }];
  const cur = await db.employeeAssignment.findFirst({
    where: { employeeId: emp.id, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { managerId: true },
  });
  let managerApproverId: string | null = null;
  if (cur?.managerId) {
    const mgrUser = await db.appUser.findFirst({ where: { employeeId: cur.managerId, active: true }, select: { id: true } });
    managerApproverId = mgrUser?.id ?? null;
  }
  const otherRoles = [...new Set(layersDef.map((l) => l.role).filter((r) => r !== "Dept Head"))];
  const roleApprover: Record<string, string | null> = {};
  for (const r of otherRoles) {
    const u = await db.appUser.findFirst({ where: { role: r, active: true }, select: { id: true } });
    roleApprover[r] = u?.id ?? null;
  }

  const action = await db.personnelAction.create({
    data: {
      docNo, employeeId: emp.id, type: input.type,
      effectiveDate,
      reason: input.reason ?? null,
      detailJson: JSON.stringify(detail),
      status: "Prepared",
      createdBy: actor.name,
      layers: {
        create: layersDef.map((l) => ({
          layerNo: l.layer, approverRole: l.role,
          approverId: l.role === "Dept Head" ? managerApproverId : (roleApprover[l.role] ?? null),
          status: "Pending",
        })),
      },
    },
  });
  await db.meritRecommendation.update({ where: { id: merit.id }, data: { personnelActionId: action.id } });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PersonnelAction", entityId: action.id,
      employeeId: emp.id, personnelActionId: action.id,
      detail:
        `${input.type} ${docNo} digulirkan dari merit ${merit.docNo} (${emp.fullName}) oleh ${actor.name}` +
        (input.type === "SalaryAdjustment" && detail.newSalary != null
          ? ` — gaji baru Rp ${Number(detail.newSalary).toLocaleString("id-ID")} (+${merit.raisePct ?? 0}%)` : "") +
        (override ? ` — OVERRIDE DIREKSI atas syarat promosi (rating/band) — alasan: ${input.reason?.trim()}` : "") +
        ` (§32-3b, §35-19)`,
    },
  });
  void notifyEvent(db, {
    to: "admins", docType: MERIT_DOC_TYPE, docNo: merit.docNo, docId: merit.id,
    title: `PA ${input.type} ${docNo} dibuat dari merit ${merit.docNo}`,
    body: `${emp.fullName}${override ? " (override direksi)" : ""} — status Prepared, menunggu proses Personnel Action`,
    kind: "performance", link: "hr:all",
  }).catch(() => { /* never */ });

  return { docNo, paId: action.id, type: input.type, override };
}

// ============ 8. kandidat PIP (§32-5, guard §35-20) ============

export async function pipCandidates(
  db: TenantDb,
  _actor: MeritActor,
  opt: { cycleId?: string },
): Promise<{
  rows: {
    appraisalId: string; docNo: string; finalScore: number | null; finalRating: number | null;
    ratingLabel: string | null; ratingLabelEn: string | null;
    employeeId: string; employeeNo: string; fullName: string; positionName: string | null; unitName: string | null;
    managerId: string | null; managerName: string | null;
    lowestKpis: { title: string; unit: string; target: number; finalActual: number | null; score: number; weight: number }[];
    activePip: boolean;
  }[];
}> {
  // peserta Closed rating ≤2 (semua siklus bila tanpa cycleId — daftar "usul PIP")
  const rows = await db.appraisalRecord.findMany({
    where: { status: "Closed", finalRating: { lte: 2 }, ...(opt.cycleId ? { cycleId: opt.cycleId } : {}) },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true, positionId: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: { select: { title: true, unit: true, target: true, finalActual: true, thresholdMin: true, stretchValue: true, polarity: true, weight: true, measureMode: true, metricLevelsJson: true } },
    },
    orderBy: { docNo: "asc" },
    take: 200,
  });

  // PIP aktif per karyawan (§35-20)
  const employeeIds = rows.map((r) => r.employee.id);
  const activePips = employeeIds.length > 0
    ? await db.pipPlan.findMany({
        where: { employeeId: { in: employeeIds }, status: { in: [...PIP_ACTIVE_STATUSES] } },
        select: { employeeId: true, docNo: true },
      })
    : [];
  const activePipOf = new Set(activePips.map((p) => p.employeeId));

  const unitIds = [...new Set(rows.map((r) => r.employee.orgUnitId).filter((x): x is string => !!x))];
  const units = unitIds.length > 0 ? await db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : [];
  const unitNameOf = new Map(units.map((u) => [u.id, u.name]));
  const posIds = [...new Set(rows.map((r) => r.employee.positionId).filter((x): x is string => !!x))];
  const positions = posIds.length > 0 ? await db.position.findMany({ where: { id: { in: posIds } }, select: { id: true, title: true } }) : [];
  const posNameOf = new Map(positions.map((p) => [p.id, p.title]));
  const scales = await db.ratingScale.findMany();
  const scaleOf = new Map(scales.map((s) => [s.value, s]));

  // Riwayat keputusan "tidak dijalankan" (§32-5) — penolakan hanya ter-ActivityLog
  // (tanpa kolom status di appraisal); ambil keputusan TERAKHIR per dokNo agar UI
  // bisa membedakan usulan yang sudah diputuskan vs yang masih menunggu (keputusan
  // boleh diulang bila HR berubah pikiran — bukan state terminal).
  const docNos = rows.map((r) => r.docNo);
  const rejectLogs = docNos.length > 0
    ? await db.activityLog.findMany({
        where: { entity: "AppraisalRecord", entityId: { in: docNos }, action: "Updated", detail: { contains: "Usul PIP" } },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, detail: true, createdAt: true },
        take: 400,
      })
    : [];
  const pipRejectOf = new Map<string, { at: Date; reason: string }>();
  for (const l of rejectLogs) {
    const detail = l.detail ?? "";
    // P7 baseline-fix: ActivityLog.entityId bertipe nullable — skip baris tanpa
    // entityId (logika sama, tipe kini eksplisit non-null utk Map).
    if (!l.entityId || pipRejectOf.has(l.entityId) || !detail.includes("DITOLAK")) continue;
    const m = /— alasan: (.+) \(§32-5\)\s*$/.exec(detail);
    pipRejectOf.set(l.entityId, { at: l.createdAt, reason: m?.[1] ?? "—" });
  }

  return {
    rows: rows
      .filter((r) => !activePipOf.has(r.employee.id)) // tanpa PIP aktif §35-20
      .map((r) => {
        const sc = r.finalRating != null ? scaleOf.get(r.finalRating) : undefined;
        // 3 KPI skor terendah (§16) — prefill target PIP
        const lowestKpis = [...r.kpis]
          .sort((a, b) => scoreKpiItem(a) - scoreKpiItem(b))
          .slice(0, 3)
          .map((k) => ({
            title: k.title, unit: k.unit, target: k.target, finalActual: k.finalActual,
            score: Math.round(scoreKpiItem(k)), weight: k.weight,
          }));
        const rejected = pipRejectOf.get(r.docNo) ?? null;
        return {
          appraisalId: r.id, docNo: r.docNo, finalScore: r.finalScore, finalRating: r.finalRating,
          ratingLabel: sc?.labelId ?? null, ratingLabelEn: sc?.labelEn ?? null,
          employeeId: r.employee.id, employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
          positionName: posNameOf.get(r.employee.positionId ?? "") ?? null,
          unitName: unitNameOf.get(r.employee.orgUnitId ?? "") ?? null,
          managerId: r.manager?.id ?? null, managerName: r.manager?.fullName ?? null,
          lowestKpis,
          activePip: false,
          pipRejectedAt: rejected?.at.toISOString() ?? null,
          pipRejectReason: rejected?.reason ?? null,
        };
      }),
  };
}

// ============ 9. keputusan PIP (jalankan Alur 9 / tolak) ============

export interface PipTargetInput { title?: string; metric?: string; target?: string | number; weight?: number }

export async function decidePip(
  db: TenantDb,
  actor: MeritActor,
  input: { appraisalId: string; run: boolean; reason?: string | null; input?: { startDate?: string; months?: number; reviewerId?: string; hrAdvisorId?: string | null; targets?: PipTargetInput[] } | null },
): Promise<
  | { run: true; pip: { id: string; docNo: string; status: string; startDate: string; endDate: string; reviewerId: string; checkpoints: { seq: number; dueDate: string }[] }; letter: { id: string; refNo: string } }
  | { run: false; appraisalNo: string; reason: string }
> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { id: true, code: true, name: true } },
      employee: { select: { id: true, employeeNo: true, fullName: true } },
      kpis: { select: { title: true, unit: true, target: true, finalActual: true, thresholdMin: true, stretchValue: true, polarity: true, weight: true, measureMode: true, metricLevelsJson: true } },
    },
  });
  if (!a) throw new Error("Peserta penilaian tidak ditemukan");

  // ================= TOLAK (alasan wajib) =================
  if (!input.run) {
    const reason = input.reason?.trim();
    if (!reason) throw new Error("Alasan penolakan usul PIP wajib diisi (§32-5)");
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "AppraisalRecord", entityId: a.docNo,
        employeeId: a.employee.id,
        detail: `Usul PIP utk ${a.employee.fullName} (${a.docNo} · rating ${a.finalRating ?? "—"}) DITOLAK oleh ${actor.name} — alasan: ${reason} (§32-5)`,
      },
    });
    return { run: false, appraisalNo: a.docNo, reason };
  }

  // ================= JALANKAN (PipPlan Draft + SK PIP) =================
  if (a.status !== "Closed") {
    throw new Error(`${a.docNo} berstatus ${a.status} — usul PIP hanya dari hasil Closed (§35-20)`);
  }
  if ((a.finalRating ?? 5) > 2) {
    throw new Error(`${a.docNo} rating ${a.finalRating} — PIP hanya untuk rating ≤ 2 (§35-20)`);
  }
  const dup = await db.pipPlan.findFirst({
    where: { employeeId: a.employee.id, status: { in: [...PIP_ACTIVE_STATUSES] } },
    select: { docNo: true },
  });
  if (dup) {
    throw new Error(`${a.employee.fullName} masih memiliki PIP aktif ${dup.docNo} — tidak boleh duplikat (§35-20)`);
  }

  const inp = input.input ?? {};
  const startDate = inp.startDate ? new Date(inp.startDate) : new Date();
  if (Number.isNaN(startDate.getTime())) throw new Error("Tanggal mulai PIP tidak valid");
  const months = Math.max(1, Math.min(3, Number.isFinite(Number(inp.months)) ? Number(inp.months) : 2)); // D7: 1–3 bln, default 2
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + months);

  const reviewerId = inp.reviewerId?.trim() || a.managerId;
  if (!reviewerId) throw new Error("Pembina (reviewer) wajib dipilih — peserta tidak punya atasan snapshot");
  const reviewer = await db.employee.findUnique({ where: { id: reviewerId }, select: { id: true, fullName: true } });
  if (!reviewer) throw new Error("Pembina (reviewer) tidak ditemukan");

  // target 3–5 item (prefill: 3 KPI skor terendah bila tidak diberikan)
  let targets = (inp.targets ?? []).filter((t) => (t.title ?? "").trim());
  if (targets.length === 0) {
    targets = [...a.kpis]
      .sort((x, y) => scoreKpiItem(x) - scoreKpiItem(y))
      .slice(0, 3)
      .map((k) => ({ title: k.title, metric: k.unit, target: k.target, weight: undefined }));
  }
  if (targets.length < 3 || targets.length > 5) {
    throw new Error(`Target PIP harus 3–5 item (diberikan ${targets.length}) — prefill 3 KPI terendah tersedia (§33-2)`);
  }
  const normTargets = targets.map((t, i) => ({
    title: String(t.title ?? "").trim(),
    metric: String(t.metric ?? "").trim() || (a.kpis.find((k) => k.title === t.title)?.unit ?? ""),
    target: t.target ?? "",
    weight: t.weight != null && Number.isFinite(Number(t.weight)) ? Number(t.weight) : undefined,
    seq: i + 1,
  }));

  const docNo = await nextPerfNo(db, "PIP");
  const pip = await db.pipPlan.create({
    data: {
      docNo,
      employeeId: a.employee.id,
      appraisalId: a.id,
      startDate,
      endDate,
      targetsJson: JSON.stringify(normTargets),
      reviewerId,
      hrAdvisorId: inp.hrAdvisorId?.trim() || null,
      status: "Draft", // aktivasi = P6 (approval PipPlan AS-PIP-STD) — P5 hanya Draft
    },
  });
  // checkpoint 30/60/90 hari (seq 1..3)
  const DAY = 86_400_000;
  const checkpoints: { seq: number; dueDate: string }[] = [];
  for (const seq of [1, 2, 3]) {
    const due = new Date(startDate.getTime() + seq * 30 * DAY);
    await db.pipCheckpoint.create({ data: { pipId: pip.id, seq, dueDate: due } });
    checkpoints.push({ seq, dueDate: due.toISOString() });
  }

  // ---- terbitkan SK PIP (template PERF_PIP — kategori Performance) ----
  const scales = await db.ratingScale.findMany();
  const sc = a.finalRating != null ? scales.find((s) => s.value === a.finalRating) : undefined;
  const pipTargetsText = normTargets
    .map((t, i) => `${i + 1}. ${t.title} — target: ${t.target}${t.metric ? ` (${t.metric})` : ""}`)
    .join("\n");
  const letter = await issueLetter(db, {
    category: "Performance",
    templateKey: PERF_PIP_KEY,
    employeeId: a.employee.id,
    extraCtx: {
      appraisal_no: a.docNo,
      cycle_name: a.cycle.name,
      final_score: a.finalScore != null ? String(a.finalScore) : "—",
      rating_label: sc?.labelId ?? String(a.finalRating ?? "—"),
      pip_start: fmtDateIdLong(startDate),
      pip_end: fmtDateIdLong(endDate),
      pip_reviewer: reviewer.fullName,
      pip_targets: pipTargetsText,
    },
  });
  // meta idempoten: appraisalNo + cycleId (pola PERF_RESULT)
  const existingMeta = await db.letterDocument.findUnique({ where: { id: letter.id }, select: { metaJson: true } });
  try {
    const meta = existingMeta?.metaJson ? (JSON.parse(existingMeta.metaJson) as Record<string, unknown>) : {};
    await db.letterDocument.update({
      where: { id: letter.id },
      data: { metaJson: JSON.stringify({ ...meta, appraisalNo: a.docNo, cycleId: a.cycle.id, pipDocNo: docNo }) },
    });
  } catch { /* metaJson korup — biarkan */ }

  await db.activityLog.create({
    data: {
      action: "Created", entity: "PipPlan", entityId: docNo,
      employeeId: a.employee.id,
      detail:
        `PIP ${docNo} (${a.employee.fullName} · dari ${a.docNo} rating ${a.finalRating}) DIBUAT Draft oleh ${actor.name} — ${months} bulan (${fmtDateIdLong(startDate)} s.d. ${fmtDateIdLong(endDate)}), pembina ${reviewer.fullName}, ${normTargets.length} target, checkpoint 30/60/90 hari + SK PIP ${letter.refNo} terbit (§32-5, §33; aktivasi = P6)`,
    },
  });
  // notif pembina (atasan) — deep-link modul PIP
  void notifyEvent(db, {
    to: "employee", employeeId: reviewerId, docType: "PipPlan", docNo,
    title: `PIP ${docNo} menunggu aktivasi — Anda ditetapkan pembina`,
    body: `${a.employee.fullName} · ${fmtDateIdLong(startDate)} s.d. ${fmtDateIdLong(endDate)} — SK PIP ${letter.refNo} terbit`,
    kind: "performance", link: "performance:pip",
  }).catch(() => { /* never */ });

  return {
    run: true,
    pip: {
      id: pip.id, docNo, status: "Draft",
      startDate: startDate.toISOString(), endDate: endDate.toISOString(),
      reviewerId, checkpoints,
    },
    letter: { id: letter.id, refNo: letter.refNo },
  };
}

// ============ 10. surat hasil penilaian (§32-4) ============

/** Cek surat PERF_RESULT sudah terbit utk appraisal (idempoten via metaJson). */
async function findResultLetter(db: TenantDb, appraisalNo: string): Promise<{ id: string; refNo: string } | null> {
  const doc = await db.letterDocument.findFirst({
    where: { templateKey: PERF_RESULT_KEY, metaJson: { contains: `"appraisalNo":"${appraisalNo}"` } },
    select: { id: true, refNo: true },
    orderBy: { issuedAt: "desc" },
  });
  return doc ?? null;
}

async function perfResultExtraCtx(
  db: TenantDb,
  a: {
    docNo: string; finalScore: number | null; finalRating: number | null;
    cycle: { id: string; name: string; periodStart: Date | null; periodEnd: Date | null };
    manager: { fullName: string } | null;
  },
): Promise<Record<string, string>> {
  const scales = await db.ratingScale.findMany();
  const sc = a.finalRating != null ? scales.find((s) => s.value === a.finalRating) : undefined;
  const fmt = (d: Date | null) => (d ? fmtDateIdLong(d) : "—");
  return {
    appraisal_no: a.docNo,
    cycle_name: a.cycle.name,
    cycle_period: `${fmt(a.cycle.periodStart)} – ${fmt(a.cycle.periodEnd)}`,
    final_score: a.finalScore != null ? String(a.finalScore) : "—",
    rating_label: sc?.labelId ?? String(a.finalRating ?? "—"),
    manager_name: a.manager?.fullName ?? "—",
  };
}

/** Terbitkan Surat Hasil Penilaian (PERF_RESULT) utk satu peserta — idempoten. */
export async function issueResultLetter(
  db: TenantDb,
  actor: MeritActor,
  input: { appraisalId: string },
): Promise<{ issued: boolean; letter: { id: string; refNo: string; employeeName: string } }> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { id: true, name: true, periodStart: true, periodEnd: true } },
      employee: { select: { id: true, fullName: true } },
      manager: { select: { fullName: true } },
    },
  });
  if (!a) throw new Error("Peserta penilaian tidak ditemukan");
  if (!["Published", "Appealed", "Closed"].includes(a.status)) {
    throw new Error(`${a.docNo} berstatus ${a.status} — surat hasil hanya pasca-publikasi (§32-4)`);
  }
  if (a.finalScore == null && a.finalRating == null) {
    throw new Error(`${a.docNo} belum memiliki skor/rating final — surat hasil tidak dapat terbit`);
  }

  const existing = await findResultLetter(db, a.docNo);
  if (existing) {
    return { issued: false, letter: { id: existing.id, refNo: existing.refNo, employeeName: a.employee.fullName } };
  }

  const letter = await issueLetter(db, {
    category: "Performance",
    templateKey: PERF_RESULT_KEY,
    employeeId: a.employee.id,
    extraCtx: await perfResultExtraCtx(db, a),
  });
  // meta idempoten: appraisalNo + cycleId (dicek sebelum issue berikutnya)
  const existingMeta = await db.letterDocument.findUnique({ where: { id: letter.id }, select: { metaJson: true } });
  try {
    const meta = existingMeta?.metaJson ? (JSON.parse(existingMeta.metaJson) as Record<string, unknown>) : {};
    await db.letterDocument.update({
      where: { id: letter.id },
      data: { metaJson: JSON.stringify({ ...meta, appraisalNo: a.docNo, cycleId: a.cycle.id }) },
    });
  } catch { /* metaJson korup — biarkan */ }

  await db.activityLog.create({
    data: {
      action: "Created", entity: "AppraisalRecord", entityId: a.docNo,
      employeeId: a.employee.id,
      detail: `Surat Hasil Penilaian ${letter.refNo} (PERF_RESULT) utk ${a.employee.fullName} (${a.docNo}) diterbitkan oleh ${actor.name} (§32-4)`,
    },
  });
  return { issued: true, letter: { id: letter.id, refNo: letter.refNo, employeeName: a.employee.fullName } };
}

/** Terbitkan massal utk seluruh peserta Closed siklus — laporan idempoten. */
export async function issueResultLetters(
  db: TenantDb,
  actor: MeritActor,
  input: { cycleId: string },
): Promise<{ issued: { appraisalNo: string; employeeName: string; refNo: string }[]; skippedExisting: { appraisalNo: string; employeeName: string; refNo: string }[]; skippedNotClosed: { appraisalNo: string; employeeName: string }[] }> {
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId: input.cycleId },
    include: {
      cycle: { select: { id: true, name: true, periodStart: true, periodEnd: true } },
      employee: { select: { id: true, fullName: true } },
      manager: { select: { fullName: true } },
    },
    orderBy: { docNo: "asc" },
    take: 500,
  });

  const issued: { appraisalNo: string; employeeName: string; refNo: string }[] = [];
  const skippedExisting: { appraisalNo: string; employeeName: string; refNo: string }[] = [];
  const skippedNotClosed: { appraisalNo: string; employeeName: string }[] = [];

  for (const a of rows) {
    if (a.status !== "Closed") {
      skippedNotClosed.push({ appraisalNo: a.docNo, employeeName: a.employee.fullName });
      continue;
    }
    const existing = await findResultLetter(db, a.docNo);
    if (existing) {
      skippedExisting.push({ appraisalNo: a.docNo, employeeName: a.employee.fullName, refNo: existing.refNo });
      continue;
    }
    if (a.finalScore == null && a.finalRating == null) continue;
    const letter = await issueLetter(db, {
      category: "Performance",
      templateKey: PERF_RESULT_KEY,
      employeeId: a.employee.id,
      extraCtx: await perfResultExtraCtx(db, a),
    });
    const existingMeta = await db.letterDocument.findUnique({ where: { id: letter.id }, select: { metaJson: true } });
    try {
      const meta = existingMeta?.metaJson ? (JSON.parse(existingMeta.metaJson) as Record<string, unknown>) : {};
      await db.letterDocument.update({
        where: { id: letter.id },
        data: { metaJson: JSON.stringify({ ...meta, appraisalNo: a.docNo, cycleId: a.cycle.id }) },
      });
    } catch { /* abaikan */ }
    issued.push({ appraisalNo: a.docNo, employeeName: a.employee.fullName, refNo: letter.refNo });
  }

  await db.activityLog.create({
    data: {
      action: "Created", entity: "LetterDocument", entityId: input.cycleId,
      detail: `Surat Hasil Penilaian massal oleh ${actor.name}: ${issued.length} terbit · ${skippedExisting.length} sudah ada · ${skippedNotClosed.length} belum Closed (§32-4)`,
    },
  });
  return { issued, skippedExisting, skippedNotClosed };
}

/** Daftar surat kinerja (PERF_RESULT + PERF_PIP) — filter siklus via metaJson. */
export async function listPerfLetters(
  db: TenantDb,
  opt: { cycleId?: string },
): Promise<{
  letters: { id: string; refNo: string; templateKey: string; subject: string | null; issuedAt: string; appraisalNo: string | null; pipDocNo: string | null; cycleId: string | null; employeeName: string; employeeNo: string }[];
}> {
  const rows = await db.letterDocument.findMany({
    where: {
      templateKey: { in: [PERF_RESULT_KEY, PERF_PIP_KEY] },
      ...(opt.cycleId ? { metaJson: { contains: `"cycleId":"${opt.cycleId}"` } } : {}),
    },
    include: { employee: { select: { fullName: true, employeeNo: true } } },
    orderBy: { issuedAt: "desc" },
    take: 500,
  });
  return {
    letters: rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(r.metaJson ?? "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
      } catch { /* abaikan */ }
      return {
        id: r.id, refNo: r.refNo, templateKey: r.templateKey, subject: r.subject,
        issuedAt: r.issuedAt.toISOString(),
        appraisalNo: typeof meta.appraisalNo === "string" ? meta.appraisalNo : null,
        pipDocNo: typeof meta.pipDocNo === "string" ? meta.pipDocNo : null,
        cycleId: typeof meta.cycleId === "string" ? meta.cycleId : null,
        employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo,
      };
    }),
  };
}
