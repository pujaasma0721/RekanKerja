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

// ============================================================================
// B7-BL — BRANDING PORTAL KARIER (CareerSiteConfig per tenant)
// Row ABSEN = fallback kode (default berikut) — migrasi TIDAK menge-seed.
// ============================================================================

export interface SiteConfigInput {
  brandColor: string;
  logoUrl: string | null;
  heroTitle: string | null;
  heroSub: string | null;
}

export interface SiteConfigRow extends SiteConfigInput {
  updatedAt: string | null;
}

export const SITE_CONFIG_DEFAULTS: SiteConfigInput = {
  brandColor: "#0f766e",
  logoUrl: null,
  heroTitle: null,
  heroSub: null,
};

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

/** Baca branding portal (row absen → default; tabel belum termigrasi → default). */
export async function getSiteConfig(db: TenantDb, tenantSlug: string): Promise<SiteConfigRow> {
  try {
    const row = await db.careerSiteConfig.findUnique({ where: { tenantSlug } });
    if (row) {
      return {
        brandColor: HEX6_RE.test(row.brandColor) ? row.brandColor : SITE_CONFIG_DEFAULTS.brandColor,
        logoUrl: row.logoUrl ?? null,
        heroTitle: row.heroTitle ?? null,
        heroSub: row.heroSub ?? null,
        updatedAt: row.updatedAt.toISOString(),
      };
    }
  } catch {
    // tabel/kolom belum termigrasi → jalur fallback (never-throw baca)
  }
  return { ...SITE_CONFIG_DEFAULTS, updatedAt: null };
}

/**
 * Simpan branding portal + jejak audit ActivityLog "CareerSiteConfigSaved"
 * (menu recruitment:settings op update — HR/admin).
 * Validasi: brandColor hex 6 (#rrggbb), logoUrl http(s), heroTitle ≤120,
 * heroSub ≤200 — invalid → throw Error (dipetakan 400 oleh API).
 */
export async function saveSiteConfig(
  db: TenantDb,
  tenantSlug: string,
  input: SiteConfigInput,
  actor?: { employeeId?: string | null; name?: string | null } | null,
): Promise<SiteConfigRow> {
  const brandColor = input.brandColor.trim();
  if (!HEX6_RE.test(brandColor)) {
    throw new Error("Warna brand harus kode hex 6 digit (contoh #0f766e)");
  }
  let logoUrl = input.logoUrl?.trim() || null;
  if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
    throw new Error("Logo harus URL http(s)");
  }
  if (logoUrl && logoUrl.length > 500) logoUrl = logoUrl.slice(0, 500);
  const heroTitle = input.heroTitle?.trim() || null;
  if (heroTitle && heroTitle.length > 120) {
    throw new Error("Judul hero maksimal 120 karakter");
  }
  const heroSub = input.heroSub?.trim() || null;
  if (heroSub && heroSub.length > 200) {
    throw new Error("Sub judul hero maksimal 200 karakter");
  }

  const row = await db.careerSiteConfig.upsert({
    where: { tenantSlug },
    create: { tenantSlug, brandColor, logoUrl, heroTitle, heroSub },
    update: { brandColor, logoUrl, heroTitle, heroSub },
  });
  await db.activityLog.create({
    data: {
      actorType: actor?.employeeId || actor?.name ? "user" : "system",
      employeeId: actor?.employeeId ?? null,
      action: "CareerSiteConfigSaved",
      entity: "CareerSiteConfig",
      entityId: tenantSlug,
      detail: `Branding portal karier disimpan — warna ${brandColor}, logo ${logoUrl ? "diatur" : "tanpa logo"}, hero ${heroTitle ?? "(default)"}`,
    },
  }).catch(() => {
    // jejak audit gagal ditulis — nilai tetap tersimpan (never-throw)
  });
  return {
    brandColor: row.brandColor,
    logoUrl: row.logoUrl ?? null,
    heroTitle: row.heroTitle ?? null,
    heroSub: row.heroSub ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
