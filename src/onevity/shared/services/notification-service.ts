// OneVity Notification Service (T7-ESS) — pusat emisi notifikasi in-app.
// =====================================================================
// Tabel tenant "Notification" (per AppUser). Helper pushNotification()
// dipakai lintas modul (leave/travel/medical/payroll/ESS/wave-3) —
// FIRE-AND-FORGET SAFE: tidak pernah melempar error ke pemanggil
// (kegagalan insert dicatat ke console saja; proses bisnis utama
// tidak boleh terganggu oleh notifikasi — pola sama dgn email-service).
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

export interface PushNotificationInput {
  /** AppUser tujuan (bukan employeeId — notifikasi per-pengguna aplikasi). */
  appUserId: string;
  title: string;
  body?: string | null;
  /** kategori emisi: leave | travel | medical | payroll | attendance | dsb. */
  kind?: string | null;
  /** tujuan navigasi saat notifikasi dibuka (mis. "/ess/leave"). */
  link?: string | null;
}

/**
 * Kirim notifikasi in-app ke seorang AppUser. Selalu resolve (tidak pernah
 * reject) — aman dipanggil `void pushNotification(...)` tanpa try-catch.
 * Mengembalikan id notifikasi bila berhasil, null bila gagal/di-skip.
 */
export async function pushNotification(
  db: TenantDb,
  input: PushNotificationInput,
): Promise<string | null> {
  try {
    if (!input.appUserId || !input.title?.trim()) return null;
    const row = await db.notification.create({
      data: {
        appUserId: input.appUserId,
        title: input.title.trim(),
        body: input.body?.trim() || null,
        kind: input.kind?.trim() || null,
        link: input.link?.trim() || null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    // schema belum termigrasi / DB down — bisnis utama tetap lanjut.
    console.warn("[notification] gagal mengirim:", e instanceof Error ? e.message : e);
    return null;
  }
}
