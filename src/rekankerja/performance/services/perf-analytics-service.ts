// ============================================================================
// RekanKerja PERFORMANCE P8 — Analytics & MetricSnapshot (DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P8 + §11.2 G4):
//   · snapshotMetrics     — hitung & upsert MetricSnapshot periode YYYY-MM
//                           berjalan (idempoten — re-run = overwrite periode
//                           sama; pola recruitment analytics-service F8):
//                           perf_completion (global % finalized + per-cycle),
//                           rating_distribution (per rating + per-cycle×rating),
//                           pip_recovery_rate (% Recovered dari PIP berakhir).
//                           Nilai null DIKOSONGKAN ("jangan tulis angka palsu").
//   · getSnapshotHistory — histori MetricSnapshot per metrik (dims null,
//                           period desc lalu dibalik — siap chart garis).
//
// Konvensi: agregat dari kolom polos (status/finalRating — bukan PII) → aman
// groupBy in-memory; take-caps di semua fetch. Dipanggil job scheduler harian
// `perf-metrics-snapshot` (scheduler-service) + skrip manual
// scripts/run-perf-snapshot.ts (bootstrap awal).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ============ konstanta & util ============

export const PERF_METRICS = ["perf_completion", "rating_distribution", "pip_recovery_rate"] as const;
export type PerfMetric = (typeof PERF_METRICS)[number];

/** Status appraisal yang skor/finalnya RESMI (SCORED_STATUSES P4). */
const SCORED = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const FINALIZED = ["Finalized", "Published", "Appealed", "Closed"];

/** Periode snapshot berjalan: YYYY-MM (UTC — stabil lintas siklus harian). */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Upsert satu baris snapshot (find-first → update/create; NULL dimsJson aman
 *  lintas dialek — unique index Postgres memperlakukan NULL sebagai berbeda). */
async function upsertSnapshot(
  db: TenantDb,
  metric: string,
  period: string,
  value: number,
  dimsJson: string | null,
): Promise<boolean> {
  const existing = await db.metricSnapshot.findFirst({ where: { metric, period, dimsJson } });
  if (existing) {
    await db.metricSnapshot.update({ where: { id: existing.id }, data: { value, computedAt: new Date() } });
  } else {
    await db.metricSnapshot.create({ data: { metric, period, dimsJson, value } });
  }
  return true;
}

// ============ snapshot metrik kinerja ============

/**
 * Hitung metrik kinerja → upsert MetricSnapshot periode YYYY-MM berjalan.
 * Idempoten (re-run = overwrite periode sama). Return jumlah baris tertulis.
 * Tanpa data → baris TIDAK ditulis (jangan tulis angka palsu).
 */
export async function snapshotMetrics(db: TenantDb): Promise<number> {
  const period = currentPeriod();
  let written = 0;

  const [cycles, apprs, pips] = await Promise.all([
    db.performanceCycle.findMany({ select: { id: true, code: true }, take: 100 }),
    db.appraisalRecord.findMany({ select: { id: true, cycleId: true, status: true, finalRating: true }, take: 500 }),
    db.pipPlan.findMany({ select: { id: true, status: true }, take: 500 }),
  ]);
  const cycleCodeOf = new Map(cycles.map((c) => [c.id, c.code]));

  // ---- perf_completion: % peserta ber-status final (global + per siklus) ----
  const total = apprs.length;
  if (total > 0) {
    const finalized = apprs.filter((a) => FINALIZED.includes(a.status)).length;
    written += (await upsertSnapshot(db, "perf_completion", period, round1((finalized / total) * 100), null)) ? 1 : 0;
    for (const c of cycles) {
      const part = apprs.filter((a) => a.cycleId === c.id);
      if (part.length === 0) continue;
      const fin = part.filter((a) => FINALIZED.includes(a.status)).length;
      written += (await upsertSnapshot(
        db, "perf_completion", period, round1((fin / part.length) * 100), JSON.stringify({ cycle: c.code }))) ? 1 : 0;
    }
  }

  // ---- rating_distribution: jumlah peserta per rating 1–5 (global + per siklus) ----
  const rated = apprs.filter((a) => a.finalRating != null && SCORED.includes(a.status));
  if (rated.length > 0) {
    // baris GLOBAL (dims null) = total peserta ber-rating — histori tren di dashboard
    written += (await upsertSnapshot(db, "rating_distribution", period, rated.length, null)) ? 1 : 0;
    for (let r = 1; r <= 5; r++) {
      const count = rated.filter((a) => a.finalRating === r).length;
      if (count === 0) continue; // tanpa data → jangan tulis angka palsu
      written += (await upsertSnapshot(db, "rating_distribution", period, count, JSON.stringify({ rating: String(r) }))) ? 1 : 0;
    }
    for (const c of cycles) {
      const part = rated.filter((a) => a.cycleId === c.id);
      if (part.length === 0) continue;
      for (let r = 1; r <= 5; r++) {
        const count = part.filter((a) => a.finalRating === r).length;
        if (count === 0) continue;
        written += (await upsertSnapshot(
          db, "rating_distribution", period, count, JSON.stringify({ cycle: c.code, rating: r }))) ? 1 : 0;
      }
    }
  }

  // ---- pip_recovery_rate: % Recovered dari PIP berakhir ----
  const closed = pips.filter((p) => ["Recovered", "NotRecovered"].includes(p.status));
  if (closed.length > 0) {
    const recovered = closed.filter((p) => p.status === "Recovered").length;
    written += (await upsertSnapshot(db, "pip_recovery_rate", period, round1((recovered / closed.length) * 100), null)) ? 1 : 0;
  }

  return written;
}

// ============ histori snapshot (chart garis) ============

export interface PerfSnapshotPoint { period: string; value: number; computedAt: string }

export async function getSnapshotHistory(
  db: TenantDb,
  metric: string,
  limit = 24,
): Promise<{ metric: string; points: PerfSnapshotPoint[] }> {
  const take = Math.min(Math.max(Math.trunc(limit) || 24, 1), 24);
  const rows = await db.metricSnapshot.findMany({
    where: { metric, dimsJson: null },
    orderBy: { period: "desc" },
    take,
  });
  return {
    metric,
    points: rows
      .reverse() // chart garis: periode naik (lama → baru)
      .map((r) => ({ period: r.period, value: r.value, computedAt: r.computedAt.toISOString() })),
  };
}
