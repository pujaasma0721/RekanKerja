// RekanKerja — RECRUITMENT SETTING SERVICE (F7 — Otomasi & Integrasi) ========
// ============================================================================
// Konfigurasi key-value per tenant (tabel RecruitmentSetting) utk otomasi
// F7 + retensi F9. Default dibaca caller bila baris tidak ada — seed migrasi
// (scripts/migrate-recruitment-f7.ts) memasang baris eksplisit supaya bisa
// diubah dari UI Pengaturan Rekrutmen.
//
// NEVER-THROW BACA: tabel belum termigrasi di tenant → kembalikan fallback
// (otomasi default-ON — perilaku pra-F7 tetap jalan).
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Kunci setting yang sah (whitelist aksi automation-set API). */
export const RECRUITMENT_SETTING_KEYS = [
  // otomasi (F7)
  "auto.reply.public-application", // email konfirmasi lamaran publik diterima
  "auto.reminder.selection", // reminder jadwal seleksi H-3/overdue
  "auto.reminder.offer", // reminder offer akan kedaluwarsa
  "auto.escalate.sla", // eskalasi tahap overdue 3/7/14 hari
  "auto.ack.email.candidate", // email undangan kandidat saat step dijadwalkan
  // retensi (F9 — dipakai modul retensi, didaftarkan di sini utk UI sama)
  "retention.months.rejected",
  "retention.months.outdated",
  "retention.anonymize",
] as const;

export type RecruitmentSettingKey = (typeof RECRUITMENT_SETTING_KEYS)[number];

/**
 * Baca satu setting; baris tidak ada / tabel belum termigrasi → `fallback`
 * (pemanggil menentukan default — biasanya "true" otomasi ON).
 */
export async function getRecruitmentSetting(
  db: TenantDb,
  key: string,
  fallback?: string,
): Promise<string> {
  try {
    const row = await db.recruitmentSetting.findUnique({ where: { key }, select: { value: true } });
    if (row && row.value.trim() !== "") return row.value.trim();
  } catch {
    // tabel/kolom belum termigrasi → jalur fallback (never-throw baca)
  }
  return fallback ?? "";
}

/** Setting boolean — helper pemanggil otomasi (default ON saat baris absen). */
export async function recruitmentAutomationOn(db: TenantDb, key: string): Promise<boolean> {
  return (await getRecruitmentSetting(db, key, "true")) !== "false";
}

/**
 * Upsert satu setting + jejak audit ActivityLog "RecruitmentSettingUpdated"
 * (actor = employee pemanggil bila diketahui — dari guard API).
 */
export async function setRecruitmentSetting(
  db: TenantDb,
  key: string,
  value: string,
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<void> {
  await db.recruitmentSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
  await db.activityLog.create({
    data: {
      actorType: actor?.employeeId || actor?.name ? "user" : "system",
      employeeId: actor?.employeeId ?? null,
      action: "RecruitmentSettingUpdated",
      entity: "RecruitmentSetting",
      entityId: key,
      detail: `Pengaturan rekrutmen "${key}" = "${value}"${actor?.name ? ` (oleh ${actor.name})` : ""}`,
    },
  }).catch(() => {
    // jejak audit gagal ditulis — nilai tetap tersimpan (never-throw)
  });
}

/** Semua setting sebagai map key→value (tabel belum ada → objek kosong). */
export async function listRecruitmentSettings(db: TenantDb): Promise<Record<string, string>> {
  try {
    const rows = await db.recruitmentSetting.findMany({ orderBy: { key: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}
