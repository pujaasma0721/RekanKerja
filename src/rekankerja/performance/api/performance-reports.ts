import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { currentQuarter, objectiveScore } from "@/rekankerja/performance/services/okr-service";

// =============================================================================
// P8-PERF — DASHBOARD LAPORAN & ANALITIK KINERJA =================================
// =============================================================================
// GET /api/rekankerja/performance/reports (tanpa parameter) — ringkasan KPI
// modul utk tab "Ringkasan Analitik" + upgrade halaman Overview (§20 P8):
//   • kpi          — siklus aktif/total, peserta, completion %, hasil terbit,
//                    PIP aktif + tingkat pemulihan, percobaan terbuka, merit
//                    diterapkan + nominal (VAULT-gate money-view).
//   • distribution — sebaran rating 1..5 siklus final terbaru + all-time.
//   • cycles       — per siklus (aktif dulu): status, fase aktif, partisipan,
//                    completion % per fase (goal/self/mgr/calib — pola
//                    commandCenter §18.8).
//   • snapshots    — histori MetricSnapshot metrik perf (perf_completion /
//                    rating_distribution / pip_recovery_rate).
//   • trend        — rata-rata skor final per tahun siklus (mini chart).
// ?snapshots=1 → HANYA histori snapshot (e2e P8 — verifikasi job scheduler).
// Guard: requireMenuViewAny performance:reports + performance:overview.
// =============================================================================

const LOCKED = ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const SELF_DONE = ["SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const MGR_DONE = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const CALIB_DONE = ["Finalized", "Published", "Appealed", "Closed"];
const PUBLISHED = ["Published", "Appealed", "Closed"];
const ACTIVE_CYCLE = new Set("Draft GoalSetting Ongoing Assessment Calibration".split(" "));
const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

interface DistBucket { count: number; avgScore: number | null }

function emptyDist(): { r1: DistBucket; r2: DistBucket; r3: DistBucket; r4: DistBucket; r5: DistBucket } {
  return {
    r1: { count: 0, avgScore: null }, r2: { count: 0, avgScore: null }, r3: { count: 0, avgScore: null },
    r4: { count: 0, avgScore: null }, r5: { count: 0, avgScore: null },
  };
}
function addDist(
  dist: ReturnType<typeof emptyDist>,
  rating: number,
  score: number | null,
) {
  if (rating < 1 || rating > 5) return;
  const b = dist[`r${rating}` as "r1"];
  b.count++;
  if (score != null) b.avgScore = round2(((b.avgScore ?? 0) * (b.count - 1) + score) / b.count);
}

/** Histori MetricSnapshot per metrik (dimsJson null — runutan global). */
async function snapshotHistoryOf(db: TenantDb, metric: string, limit = 12) {
  const rows = await db.metricSnapshot.findMany({
    where: { metric, dimsJson: null },
    orderBy: { period: "desc" },
    take: Math.min(Math.max(limit, 1), 24),
  });
  return rows.reverse().map((r) => ({ period: r.period, value: r.value, computedAt: r.computedAt.toISOString() }));
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:reports", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    // ---- histori snapshot (mode ringan utk e2e) ----
    const sp = req.nextUrl.searchParams;
    if (sp.get("snapshots") === "1") {
      const [perfCompletion, ratingDist, pipRecovery] = await Promise.all([
        snapshotHistoryOf(db, "perf_completion").catch(() => []),
        snapshotHistoryOf(db, "rating_distribution").catch(() => []),
        snapshotHistoryOf(db, "pip_recovery_rate").catch(() => []),
      ]);
      return NextResponse.json({
        snapshots: { perf_completion: perfCompletion, rating_distribution: ratingDist, pip_recovery_rate: pipRecovery },
      });
    }

    const scope = await resolveAccessScope(db, {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      appUserRole: m.actor.appUserRole,
      platformRole: m.actor.role,
    });
    const scopeCond = scopeWhere(scope);
    const mv = await moneyViewForReq(req, db);
    const tc = tenantCryptoForDb(db);

    const [cycles, emps, apprs, pips, probations, merits, pipsAll] = await Promise.all([
      db.performanceCycle.findMany({ orderBy: { periodStart: "desc" }, take: 100 }),
      db.employee.findMany({ where: scopeCond, select: { id: true }, take: 1000 }),
      db.appraisalRecord.findMany({
        select: {
          id: true, cycleId: true, employeeId: true, finalScore: true, finalRating: true,
          status: true, managerScore: true,
        },
        take: 500,
      }),
      db.pipPlan.findMany({ select: { id: true, status: true }, take: 500 }),
      db.probationEvaluation.findMany({ select: { id: true, status: true }, take: 500 }),
      db.meritRecommendation.findMany({ select: { id: true, status: true, bonusAmount: true, raiseAmount: true }, take: 500 }),
      db.pipPlan.findMany({ select: { status: true }, take: 500 }),
    ]);
    void pipsAll;

    const scopedIds = new Set(emps.map((e) => e.id));
    const rows = apprs.filter((a) => scopedIds.has(a.employeeId));

    // ---- KPI modul ----
    const activeCycles = cycles.filter((c) => ACTIVE_CYCLE.has(c.status));
    const activeIds = new Set(activeCycles.map((c) => c.id));
    const participantsActive = rows.filter((a) => activeIds.has(a.cycleId)).length;
    const finalizedActive = rows.filter((a) => activeIds.has(a.cycleId) && CALIB_DONE.includes(a.status)).length;
    const completionPct = participantsActive > 0 ? Math.round((finalizedActive / participantsActive) * 100) : null;

    // hasil terbit (semua waktu, cakupan aktor)
    const resultsPublished = rows.filter((a) => PUBLISHED.includes(a.status)).length;

    // PIP
    const pipsActive = pips.filter((p) => ["Active", "Extended"].includes(p.status)).length;
    const closedPips = pips.filter((p) => ["Recovered", "NotRecovered"].includes(p.status));
    const pipsRecoveredPct = closedPips.length > 0
      ? Math.round((closedPips.filter((p) => p.status === "Recovered").length / closedPips.length) * 100)
      : null;
    const probationsOpen = probations.filter((p) => ["Open", "Assessed", "Recommended"].includes(p.status)).length;

    // merit diterapkan (nominal vault-gate)
    const appliedMerits = merits.filter((x) => x.status === "Applied");
    let meritAppliedTotalAmount: number | null = null;
    if (mv.canSee) {
      meritAppliedTotalAmount = appliedMerits.reduce(
        (s, x) => s + (tc.decryptMoney(x.bonusAmount) ?? 0) + (tc.decryptMoney(x.raiseAmount) ?? 0), 0);
    }

    // ---- distribusi rating: siklus final TERBARU + all-time ----
    const finalCycles = cycles
      .filter((c) => ["Published", "Closed"].includes(c.status))
      .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
    const latestFinal = finalCycles[0] ?? null;
    const distLatest = emptyDist();
    const distAll = emptyDist();
    for (const a of rows) {
      const sc = a.finalScore ?? a.managerScore;
      if (a.finalRating == null) continue;
      addDist(distAll, a.finalRating, sc);
      if (latestFinal && a.cycleId === latestFinal.id) addDist(distLatest, a.finalRating, sc);
    }

    // ---- per siklus: fase aktif + completion per fase ----
    const cycleRows = cycles.slice(0, 12).map((c) => {
      const part = rows.filter((a) => a.cycleId === c.id);
      const n = part.length || 1;
      const pct = (x: number) => (part.length ? Math.round((x / n) * 100) : null);
      const now = new Date();
      const inWin = (s: Date | null, e: Date | null) => !!(s && e && now >= s && now <= e);
      const activePhase = c.status === "GoalSetting" ? "Target"
        : c.status === "Ongoing" ? "Berjalan"
        : c.status === "Assessment" ? "Penilaian Diri & Atasan"
        : c.status === "Calibration" ? "Kalibrasi"
        : inWin(c.goalStart, c.goalEnd) ? "Target"
        : null;
      return {
        id: c.id, code: c.code, name: c.name, status: c.status, cycleType: c.cycleType,
        periodStart: c.periodStart.toISOString(), periodEnd: c.periodEnd.toISOString(),
        participants: part.length,
        phase: {
          goalPct: pct(part.filter((a) => LOCKED.includes(a.status)).length),
          selfPct: pct(part.filter((a) => SELF_DONE.includes(a.status)).length),
          mgrPct: pct(part.filter((a) => MGR_DONE.includes(a.status)).length),
          calibPct: pct(part.filter((a) => CALIB_DONE.includes(a.status)).length),
        },
        activePhase,
      };
    });

    // ---- trend: rata-rata skor final per tahun siklus ----
    const byYear = new Map<number, number[]>();
    for (const a of rows) {
      if (a.finalScore == null) continue;
      const c = cycles.find((x) => x.id === a.cycleId);
      if (!c) continue;
      const y = c.periodStart.getFullYear();
      const arr = byYear.get(y) ?? [];
      arr.push(a.finalScore);
      byYear.set(y, arr);
    }
    const trend = [...byYear.entries()]
      .map(([year, scores]) => ({ year, n: scores.length, avg: round2(mean(scores)) }))
      .sort((a, b) => a.year - b.year);

    // ---- snapshot historis (boleh kosong sebelum run scheduler pertama) ----
    const [perfCompletion, ratingDistHist, pipRecovery] = await Promise.all([
      snapshotHistoryOf(db, "perf_completion").catch(() => []),
      snapshotHistoryOf(db, "rating_distribution").catch(() => []),
      snapshotHistoryOf(db, "pip_recovery_rate").catch(() => []),
    ]);

    // ---- B1-BL: ringkasan OKR kuartal berjalan (HANYA bila okrEnabled —
    // D-BL2; terpisah dari penilaian — D-BL1, tidak menyentuh KPI di atas) ----
    let okrSummary: { quarter: string; posted: number; closed: number; avgProgressPct: number | null } | null = null;
    try {
      const okrOn = (await db.performanceSetting.findFirst({ select: { okrEnabled: true } }))?.okrEnabled === true;
      if (okrOn) {
        const q = currentQuarter();
        const objs = await db.okrObjective.findMany({
          where: { quarter: q },
          select: { status: true, keyResults: { select: { weight: true, polarity: true, baseline: true, target: true, current: true } } },
          take: 200,
        });
        const posted = objs.filter((o) => o.status === "Posted");
        okrSummary = {
          quarter: q,
          posted: posted.length,
          closed: objs.filter((o) => o.status === "Closed").length,
          avgProgressPct: posted.length
            ? Math.round((posted.reduce((s, o) => s + objectiveScore(o.keyResults), 0) / posted.length) * 100)
            : null,
        };
      }
    } catch { okrSummary = null; /* kolom belum termigrasi — overview tanpa kartu OKR */ }

    return NextResponse.json({
      kpi: {
        activeCycles: activeCycles.length,
        totalCycles: cycles.length,
        participants: participantsActive,
        completionPct,
        resultsPublished,
        pipsActive,
        pipsRecoveredPct,
        probationsOpen,
        meritAppliedCount: appliedMerits.length,
        meritAppliedTotalAmount,
        money: { canSee: mv.canSee },
      },
      okrSummary,
      distribution: {
        latestCycle: latestFinal ? { id: latestFinal.id, code: latestFinal.code } : null,
        latest: distLatest,
        allTime: distAll,
      },
      cycles: cycleRows,
      snapshots: { perf_completion: perfCompletion, rating_distribution: ratingDistHist, pip_recovery_rate: pipRecovery },
      trend,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
