// P8-PERF — snapshot metrik Performance ke MetricSnapshot (§19 MetricSnapshot;
// §20 P8): job harian perf-metrics-snapshot menulis metrik modul kinerja ke
// tabel yang sama dengan analitik rekrutmen (pola analytics-service F8):
//   · perf_completion          — % peserta berstatus Closed dari seluruh peserta
//                                semua siklus (indikator tuntas proses).
//   · perf_rating_distribution  — distribusi rating final; SATU baris per
//                                rating dgn dims {"rating":"1..5"} (pola
//                                breakdown source_effectiveness — kolom value
//                                Float tidak bisa menampung JSON utuh).
//   · perf_pip_recovery_rate   — Recovered / (Recovered + NotRecovered) %.
// Idempoten: upsert per (metric, period, dimsJson) periode YYYY-MM berjalan —
// re-run = overwrite periode sama (pola snapshotMetrics rekrutmen).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Periode snapshot berjalan: YYYY-MM (UTC — stabil lintas siklus harian). */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Upsert idempoten (pola analytics-service.upsertSnapshot). */
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

/**
 * Hitung 3 metrik Performance → upsert MetricSnapshot periode YYYY-MM berjalan.
 * Return jumlah baris tertulis.
 */
export async function snapshotPerfMetrics(db: TenantDb): Promise<number> {
  const period = currentPeriod();
  let written = 0;

  // perf_completion — % peserta Closed lintas semua siklus.
  const [total, closed, ratingRows, pipRows] = await Promise.all([
    db.appraisalRecord.count(),
    db.appraisalRecord.count({ where: { status: "Closed" } }),
    db.appraisalRecord.groupBy({ by: ["finalRating"], _count: { _all: true }, where: { finalRating: { not: null } } }),
    db.pipPlan.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  if (total > 0) {
    written += (await upsertSnapshot(db, "perf_completion", period, round1((closed / total) * 100), null)) ? 1 : 0;
  }

  // perf_rating_distribution — satu baris per rating (dims {"rating": N}).
  for (const r of ratingRows) {
    if (r.finalRating == null) continue;
    written += (await upsertSnapshot(db, "perf_rating_distribution", period, r._count._all, JSON.stringify({ rating: String(r.finalRating) }))) ? 1 : 0;
  }

  // perf_pip_recovery_rate — Recovered / (Recovered + NotRecovered) %.
  const recovered = pipRows.find((r) => r.status === "Recovered")?._count._all ?? 0;
  const notRecovered = pipRows.find((r) => r.status === "NotRecovered")?._count._all ?? 0;
  if (recovered + notRecovered > 0) {
    written += (await upsertSnapshot(db, "perf_pip_recovery_rate", period, round1((recovered / (recovered + notRecovered)) * 100), null)) ? 1 : 0;
  }

  return written;
}
