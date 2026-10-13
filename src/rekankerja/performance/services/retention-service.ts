// P9-PERF — job retensi arsip hasil penilaian (DEVELOPMENT-PLAN-PERFORMANCE.md
// §20 P9; §37 UU PDP; §15 PerformanceSetting.retentionYears default 5):
// AppraisalRecord milik siklus Closed yang periodEnd-nya melewati jendela
// retensi → ditandai archivedAt oleh job harian.
//
// PRINSIP: TANDAI saja — penghapusan permanen TIDAK otomatis (keputusan
// eksplisit HR; bukti keputusan kepegawaian wajib tersimpan PP 35/2021 §7.2).
// Idempoten by filter archivedAt: null — job ringan (updateMany), tidak perlu
// claim-dedupe (pola pola job light-weight §G).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Retensi default bila PerformanceSetting belum diatur (§15 — 5 tahun). */
export const DEFAULT_RETENTION_YEARS = 5;

/**
 * Scan retensi: tandai arsip data kinerja yang melewati jendela retensi.
 * Filter: cycle.status "Closed" AND cycle.periodEnd < now − retentionYears×365
 * hari AND archivedAt null. Return { archived } — jumlah baris yang baru
 * ditandai (0 = tidak ada perubahan; ActivityLog hanya bila N>0).
 */
export async function jobPerfRetentionScan(db: TenantDb): Promise<{ archived: number; retentionYears: number }> {
  const setting = await db.performanceSetting.findFirst({ select: { retentionYears: true } });
  const years = Number(setting?.retentionYears);
  const retentionYears = Number.isFinite(years) && years >= 1 ? years : DEFAULT_RETENTION_YEARS;
  const cutoff = new Date(Date.now() - retentionYears * 365 * 86_400_000);

  const r = await db.appraisalRecord.updateMany({
    where: {
      archivedAt: null,
      cycle: { status: "Closed", periodEnd: { lt: cutoff } },
    },
    data: { archivedAt: new Date() },
  });

  if (r.count > 0) {
    await db.activityLog.create({
      data: {
        actorType: "system",
        action: "Archived", entity: "AppraisalRecord",
        detail: `Retensi: ${r.count} data kinerja ditandai arsip (retensi ${retentionYears} th; batas ${cutoff.toISOString().slice(0, 10)}; penghapusan manual)`,
      },
    }).catch(() => { /* log agregat opsional — job tetap sah */ });
  }
  return { archived: r.count, retentionYears };
}
