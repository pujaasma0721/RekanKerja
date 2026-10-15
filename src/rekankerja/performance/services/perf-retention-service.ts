import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ============================================================================
// PERFORMANCE — Service retensi arsip hasil penilaian (P9 — DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P9; §37 UU PDP; §15 PerformanceSetting.retentionYears
// default 5): AppraisalRecord milik siklus Closed yang periodEnd-nya melewati
// jendela retensi → ditandai archivedAt oleh job harian perf-retention-scan
// (dan tombol "Jalankan Scan" di halaman Kepatuhan).
//
// PRINSIP: TANDA-TANPA-HAPUS — penghapusan permanen TIDAK otomatis
// (keputusan eksplisit HR; bukti keputusan kepegawaian wajib tersimpan
// PP 35/2021 §7.2 — data kinerja = dasar sah konversi/PA/sengketa).
// Idempoten by filter archivedAt: null — job ringan (updateMany), tidak perlu
// claim-dedupe (pola job light-weight §G; scan #2 = 0 baris baru).
// ============================================================================

/** Retensi default bila PerformanceSetting belum diatur (§15 — 5 tahun). */
export const DEFAULT_RETENTION_YEARS = 5;

const YEAR_MS = 365 * 86_400_000;

/**
 * Scan retensi: tandai arsip data kinerja yang melewati jendela retensi.
 * Filter: cycle.status "Closed" AND cycle.periodEnd < now − retentionYears
 * AND archivedAt null. Return ringkasan { archived, retentionYears, cutoff,
 * scannedAt } — archived = jumlah baris yang BARUNYA ditandai (0 = tidak ada
 * perubahan; ActivityLog agregat hanya ditulis bila N > 0 — ter-audit §37).
 */
export async function jobPerfRetentionScan(
  db: TenantDb,
): Promise<{ archived: number; retentionYears: number; cutoff: string; scannedAt: string }> {
  const setting = await db.performanceSetting.findFirst({ select: { retentionYears: true } });
  const years = Number(setting?.retentionYears);
  const retentionYears = Number.isFinite(years) && years >= 1 ? years : DEFAULT_RETENTION_YEARS;
  const cutoff = new Date(Date.now() - retentionYears * YEAR_MS);

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
        detail: `Retensi: ${r.count} data kinerja ditandai arsip (retensi ${retentionYears} th; batas ${cutoff.toISOString().slice(0, 10)}; penghapusan manual — PP 35/2021 §7.2)`,
      },
    }).catch(() => { /* log agregat opsional — job tetap sah */ });
  }
  return {
    archived: r.count,
    retentionYears,
    cutoff: cutoff.toISOString().slice(0, 10),
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Ringkasan retensi utk panel Kepatuhan (tanpa menjalankan scan): jumlah
 * data terarsip + data yang SUDAH melewati jendela retensi namun belum
 * terarsip (kandidat scan berikutnya) + sampel data terarsip terbaru.
 */
export async function retentionSummary(
  db: TenantDb,
): Promise<{
  retentionYears: number;
  archivedCount: number;
  pendingArchiveCount: number;
  archivedSample: {
    docNo: string; employeeNo: string; employeeName: string;
    cycleCode: string; periodEnd: string; archivedAt: string;
  }[];
}> {
  const setting = await db.performanceSetting.findFirst({ select: { retentionYears: true } });
  const years = Number(setting?.retentionYears);
  const retentionYears = Number.isFinite(years) && years >= 1 ? years : DEFAULT_RETENTION_YEARS;
  const cutoff = new Date(Date.now() - retentionYears * YEAR_MS);

  const [archivedCount, pendingArchiveCount, sample] = await Promise.all([
    db.appraisalRecord.count({ where: { archivedAt: { not: null } } }),
    db.appraisalRecord.count({
      where: { archivedAt: null, cycle: { status: "Closed", periodEnd: { lt: cutoff } } },
    }),
    db.appraisalRecord.findMany({
      where: { archivedAt: { not: null }, cycle: { status: "Closed" } },
      include: {
        employee: { select: { employeeNo: true, fullName: true } },
        cycle: { select: { code: true, periodEnd: true } },
      },
      orderBy: { archivedAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    retentionYears,
    archivedCount,
    pendingArchiveCount,
    archivedSample: sample.map((r) => ({
      docNo: r.docNo,
      employeeNo: r.employee.employeeNo,
      employeeName: r.employee.fullName,
      cycleCode: r.cycle.code,
      periodEnd: r.cycle.periodEnd.toISOString(),
      archivedAt: (r.archivedAt as Date).toISOString(),
    })),
  };
}

/**
 * Pulihkan satu baris dari arsip (aksi HR — mis. data ternyata masih dibutuhkan
 * utk sengketa/audit; ter-audit ActivityLog). Data terarsip TIDAK ikut
 * laporan berjalan; pemulihan mengembalikannya ke peredaran normal.
 */
export async function archiveRestore(
  db: TenantDb, docNo: string,
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<void> {
  const row = await db.appraisalRecord.findUnique({ where: { docNo } });
  if (!row) throw new Error("Data kinerja tidak ditemukan");
  if (!row.archivedAt) throw new Error("Data kinerja ini tidak berstatus terarsip");
  await db.appraisalRecord.update({ where: { id: row.id }, data: { archivedAt: null } });
  await db.activityLog.create({
    data: {
      actorType: "user", employeeId: actor?.employeeId ?? null,
      action: "Updated", entity: "AppraisalRecord", entityId: row.docNo,
      detail: `Retensi: data kinerja ${row.docNo} DIPULIHKAN dari arsip${actor?.name ? ` oleh ${actor.name}` : ""} — kembali ikut laporan berjalan`,
    },
  }).catch(() => {});
}
