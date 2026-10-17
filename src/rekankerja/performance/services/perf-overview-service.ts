// ============================================================================
// PERFORMANCE — Overview service (dashboard Ringkasan modul).
// SATU agregat ringan utk halaman Ringkasan (pola REC-OV recruitment /
// leave / travel): siklus aktif + pipeline appraisal per status + kesehatan
// target + check-in + 360 (agregat saja — anonimitas ≥3) + kalibrasi + PIP +
// percobaan + merit (uang digerbang money-view) + OKR (bila aktif) + feed
// aktivitas terakhir. Menggantikan overview lama (peta fase pengembangan +
// 3 panggilan API terpisah) — kini SATU endpoint /overview.
//
// Prinsip (cermin overview-service rekrutmen):
//   · Semua query count/groupBy ringan dijalankan paralel (Promise.all) —
//     TANPA per-baris N+1 atas tabel besar.
//   · Take-caps wajar (8 feed aktivitas, 200 siklus, 500 merit).
//   · PIP/probasi: hanya ANGKA agregat — register rahasia tetap digerbang
//     menu performance:pip / performance:probation.
//   · 360: hanya hitungan status — identitas reviewer & skor per
//     kompetensi TIDAK pernah dikirim (anonimitas ≥3 reviewer).
//   · Uang (merit) hanya via decryptMoney saat canSee (pola
//     performance-reports.ts: moneyViewForReq → mv.canSee).
//   · Feed ActivityLog BUKAN vault-gated → nominal "Rp …" di detail
//     disamarkan "Rp •••" (pola personnel-actions-detail.ts, fix F-04).
//   · Empty-state safe: tanpa siklus sama sekali → cycle: null + nolan —
//     UI merender ajakan membuat siklus pertama.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { currentQuarter, objectiveScore } from "@/rekankerja/performance/services/okr-service";

// ============ tipe (bentuk JSON API) ============

export interface PerfOverviewCycle {
  id: string; code: string; name: string;
  status: string; cycleType: string;
  periodStart: string; periodEnd: string;
  goalEnd: string | null; selfEnd: string | null; mgrEnd: string | null; calibEnd: string | null;
  publishAt: string | null;
  feedback360: boolean;
  isActive: boolean; // false = siklus terakhir yang sudah berakhir (fallback tampilan)
  participants: number;
}

export interface PerfOverviewData {
  cycle: PerfOverviewCycle | null;
  totals: { cycles: number; activeCycles: number };
  /** Pipeline appraisal siklus aktif — jumlah peserta per status. */
  pipeline: { status: string; count: number }[];
  goals: {
    kpiRows: number; kpiWithActual: number;
    goalLocked: number; goalLockedPct: number | null;
    selfSubmitted: number; selfSubmittedPct: number | null;
  };
  checkins: { held30d: number; upcoming: number; missed: number };
  f360: { invited: number; submitted: number; declined: number; expired: number };
  calibration: { sessions: number; upcoming: number; decisions: number };
  pip: { draft: number; active: number; recovered: number; notRecovered: number; cancelled: number; recoveredPct: number | null };
  probation: { open: number; dueSoon: number; overdue: number };
  merit: {
    byStatus: { status: string; count: number }[];
    appliedCount: number; appliedTotal: number | null; // total = null bila uang disamarkan
    money: { canSee: boolean };
  };
  okr: { quarter: string; draft: number; posted: number; closed: number; avgProgressPct: number | null } | null;
  /** Feed aktivitas terakhir (8 baris) — nominal uang disamarkan "Rp •••". */
  activity: { action: string; entity: string; entityId: string | null; detail: string | null; createdAt: string }[];
}

// ============ konstanta & util ============

const DAY_MS = 86_400_000;

/** Status siklus yang masih berjalan (paduan ACTIVE_CYCLE performance-reports). */
const ACTIVE_CYCLE = "Draft GoalSetting Ongoing Assessment Calibration".split(" ");

/** Status appraisal = target TERKUNCI (APPRAISAL_LOCKED perf-cycle-service). */
const LOCKED = ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
/** Status appraisal = penilaian diri SUDAH disubmit. */
const SELF_DONE = ["SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];

/** PIP yang masih berjalan / menunggu keputusan. */
const PIP_OPEN = ["Open", "Assessed", "Recommended"] as const;

/** Entitas kinerja utk feed aktivitas (LOG bukan vault-gated → uang disamarkan). */
const PERF_ENTITIES = [
  "AppraisalRecord", "CheckIn", "CalibrationSession", "MeritRecommendation",
  "PipPlan", "ProbationEvaluation", "OkrObjective", "Feedback360", "PerformanceCycle",
];

/** Bersihkan teks jejak aktivitas utk feed Ringkasan (pola fix F-04 —
 * ActivityLog tidak digerbang brankas sehingga detail bisa memuat "Rp 12.000.000").
 * Selain nominal uang, referensi pasal internal ("§7.1") & kode keputusan teknis
 * ("(D9)", "(D-BL7)") disingkirkan — teks teknis internal tidak informatif bagi
 * pembaca dashboard. Data di DB TIDAK diubah (hanya tampilan feed Ringkasan). */
function sanitizeDetail(s: string | null): string | null {
  if (s == null) return null;
  return s
    .replace(/Rp\s?[\d.,]+/g, "Rp •••")
    .replace(/\s*§[\w.\-]+/g, "")
    .replace(/\s*\((?:D-BL\d+|D\d+|AM\d+)\)/g, "");
}

// ============ agregat ============

/**
 * Hitung SELURUH data dashboard Ringkasan modul Kinerja dalam SATU panggilan.
 * `canSeeMoney` berasal dari moneyViewForReq — false → nominal merit tidak
 * dikirim (null) dan UI menampilkan "•••".
 */
export async function overviewFor(db: TenantDb, opts: { canSeeMoney: boolean }): Promise<PerfOverviewData> {
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const due14 = new Date(now.getTime() + 14 * DAY_MS);

  // ---- siklus: pilih yang aktif (terbaru), fallback siklus terakhir apa pun ----
  const cycles = await db.performanceCycle.findMany({
    select: {
      id: true, code: true, name: true, status: true, cycleType: true,
      periodStart: true, periodEnd: true, goalEnd: true, selfEnd: true, mgrEnd: true,
      calibEnd: true, publishAt: true, feedback360: true,
    },
    orderBy: { periodStart: "desc" },
    take: 200,
  });
  const activeCycles = cycles.filter((c) => ACTIVE_CYCLE.includes(c.status));
  const picked = activeCycles[0] ?? cycles[0] ?? null;

  // ---- tanpa siklus sama sekali → empty state (nol penuh, aman di-render) ----
  if (!picked) {
    return {
      cycle: null,
      totals: { cycles: 0, activeCycles: 0 },
      pipeline: [],
      goals: { kpiRows: 0, kpiWithActual: 0, goalLocked: 0, goalLockedPct: null, selfSubmitted: 0, selfSubmittedPct: null },
      checkins: { held30d: 0, upcoming: 0, missed: 0 },
      f360: { invited: 0, submitted: 0, declined: 0, expired: 0 },
      calibration: { sessions: 0, upcoming: 0, decisions: 0 },
      pip: { draft: 0, active: 0, recovered: 0, notRecovered: 0, cancelled: 0, recoveredPct: null },
      probation: { open: 0, dueSoon: 0, overdue: 0 },
      merit: { byStatus: [], appliedCount: 0, appliedTotal: null, money: { canSee: opts.canSeeMoney } },
      okr: null,
      activity: [],
    };
  }
  const cycleId = picked.id;

  // ---- agregat paralel (count/groupBy ringan — tanpa N+1) ----
  const [
    participants, pipelineRows, kpiRows, kpiWithActual,
    held30d, upcomingCheckins, missedCheckins,
    f360Rows, calibSessions, calibUpcoming, calibDecisions,
    pipRows, probOpen, probDueSoon, probOverdue,
    meritGroup, meritAppliedRows, setting, activityRows,
  ] = await Promise.all([
    // peserta siklus terpilih
    db.appraisalRecord.count({ where: { cycleId } }),
    // pipeline: jumlah peserta per status appraisal
    db.appraisalRecord.groupBy({ by: ["status"], _count: { _all: true }, where: { cycleId } }),
    // kesehatan target: baris KPI siklus + yang realisasinya terisi
    db.appraisalKpi.count({ where: { appraisal: { cycleId } } }),
    db.appraisalKpi.count({ where: { appraisal: { cycleId }, finalActual: { not: null } } }),
    // check-in 1-on-1 (lingkup siklus terpilih)
    db.checkIn.count({ where: { appraisal: { cycleId }, status: "Held", heldAt: { gte: since30 } } }),
    db.checkIn.count({ where: { appraisal: { cycleId }, status: "Planned", heldAt: { gte: now } } }),
    db.checkIn.count({ where: { appraisal: { cycleId }, status: "Missed" } }),
    // 360: hitungan status saja (anonimitas — tanpa identitas reviewer/skor)
    db.feedback360.groupBy({ by: ["status"], _count: { _all: true }, where: { appraisal: { cycleId } } }),
    // kalibrasi (lingkup siklus terpilih)
    db.calibrationSession.count({ where: { cycleId } }),
    db.calibrationSession.count({ where: { cycleId, heldAt: { gte: now } } }),
    db.calibrationDecision.count({ where: { session: { cycleId } } }),
    // PIP: agregat status seluruh register (modul — bukan per siklus)
    db.pipPlan.groupBy({ by: ["status"], _count: { _all: true } }),
    // percobaan: terbuka + jatuh tempo ≤14 hari + lewat tenggat
    db.probationEvaluation.count({ where: { status: { in: [...PIP_OPEN] } } }),
    db.probationEvaluation.count({ where: { status: { in: [...PIP_OPEN] }, dueDate: { gte: now, lte: due14 } } }),
    db.probationEvaluation.count({ where: { status: { in: [...PIP_OPEN] }, dueDate: { lt: now } } }),
    // merit: status + (uang) baris Applied utk total vault-gate
    db.meritRecommendation.groupBy({ by: ["status"], _count: { _all: true } }),
    db.meritRecommendation.findMany({ where: { status: "Applied" }, select: { bonusAmount: true, raiseAmount: true }, take: 500 }),
    // pengaturan (flag OKR)
    db.performanceSetting.findFirst({ select: { okrEnabled: true } }),
    // feed aktivitas kinerja terakhir — nominal uang disamarkan di bawah
    db.activityLog.findMany({
      where: { entity: { in: PERF_ENTITIES } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { action: true, entity: true, entityId: true, detail: true, createdAt: true },
    }),
  ]);

  // ---- pipeline & kesehatan target ----
  const pipeCount = (statuses: string[]) =>
    pipelineRows.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
  const goalLocked = pipeCount(LOCKED);
  const selfSubmitted = pipeCount(SELF_DONE);
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

  // ---- merit: total HANYA bila aktor boleh melihat uang (pola performance-reports) ----
  const appliedCount = meritGroup.find((g) => g.status === "Applied")?._count._all ?? 0;
  let appliedTotal: number | null = null;
  if (opts.canSeeMoney) {
    const tc = tenantCryptoForDb(db);
    appliedTotal = meritAppliedRows.reduce(
      (s, x) => s + (tc.decryptMoney(x.bonusAmount) ?? 0) + (tc.decryptMoney(x.raiseAmount) ?? 0), 0);
  }

  // ---- PIP recovery ----
  const pipOf = (s: string) => pipRows.find((g) => g.status === s)?._count._all ?? 0;
  const closedPips = pipOf("Recovered") + pipOf("NotRecovered");

  // ---- OKR kuartal berjalan (HANYA bila okrEnabled — pola performance-reports) ----
  let okr: PerfOverviewData["okr"] = null;
  if (setting?.okrEnabled === true) {
    const quarter = currentQuarter();
    const objs = await db.okrObjective.findMany({
      where: { quarter },
      select: { status: true, keyResults: { select: { weight: true, polarity: true, baseline: true, target: true, current: true } } },
      take: 200,
    });
    const posted = objs.filter((o) => o.status === "Posted");
    okr = {
      quarter,
      draft: objs.filter((o) => o.status === "Draft").length,
      posted: posted.length,
      closed: objs.filter((o) => o.status === "Closed").length,
      avgProgressPct: posted.length
        ? Math.round((posted.reduce((s, o) => s + objectiveScore(o.keyResults), 0) / posted.length) * 100)
        : null,
    };
  }

  return {
    cycle: {
      id: picked.id, code: picked.code, name: picked.name,
      status: picked.status, cycleType: picked.cycleType,
      periodStart: picked.periodStart.toISOString(), periodEnd: picked.periodEnd.toISOString(),
      goalEnd: picked.goalEnd?.toISOString() ?? null,
      selfEnd: picked.selfEnd?.toISOString() ?? null,
      mgrEnd: picked.mgrEnd?.toISOString() ?? null,
      calibEnd: picked.calibEnd?.toISOString() ?? null,
      publishAt: picked.publishAt?.toISOString() ?? null,
      feedback360: picked.feedback360,
      isActive: ACTIVE_CYCLE.includes(picked.status),
      participants,
    },
    totals: { cycles: cycles.length, activeCycles: activeCycles.length },
    pipeline: pipelineRows
      .map((r) => ({ status: r.status, count: r._count._all }))
      .sort((a, b) => b.count - a.count),
    goals: {
      kpiRows, kpiWithActual,
      goalLocked, goalLockedPct: pct(goalLocked, participants),
      selfSubmitted, selfSubmittedPct: pct(selfSubmitted, participants),
    },
    checkins: { held30d, upcoming: upcomingCheckins, missed: missedCheckins },
    f360: {
      invited: f360Rows.find((g) => g.status === "Invited")?._count._all ?? 0,
      submitted: f360Rows.find((g) => g.status === "Submitted")?._count._all ?? 0,
      declined: f360Rows.find((g) => g.status === "Declined")?._count._all ?? 0,
      expired: f360Rows.find((g) => g.status === "Expired")?._count._all ?? 0,
    },
    calibration: { sessions: calibSessions, upcoming: calibUpcoming, decisions: calibDecisions },
    pip: {
      draft: pipOf("Draft"), active: pipOf("Active") + pipOf("Extended"),
      recovered: pipOf("Recovered"), notRecovered: pipOf("NotRecovered"), cancelled: pipOf("Cancelled"),
      recoveredPct: closedPips > 0 ? Math.round((pipOf("Recovered") / closedPips) * 100) : null,
    },
    probation: { open: probOpen, dueSoon: probDueSoon, overdue: probOverdue },
    merit: {
      byStatus: meritGroup.map((g) => ({ status: g.status, count: g._count._all })),
      appliedCount,
      appliedTotal,
      money: { canSee: opts.canSeeMoney },
    },
    okr,
    activity: activityRows.map((r) => ({
      action: r.action, entity: r.entity, entityId: r.entityId,
      detail: sanitizeDetail(r.detail), createdAt: r.createdAt.toISOString(),
    })),
  };
}
