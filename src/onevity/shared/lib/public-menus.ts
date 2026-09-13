// Task 52-f — daftar menu yang terbuka BAGI SEMUA pengguna terautentikasi
// (view-only, tanpa perlu konfigurasi Hak Akses / UserMenuAccess).
// Dipisah ke lib murni (tanpa import server) supaya bisa dipakai komponen
// client (page.tsx auto-deteksi mode ESS) DAN services/menu-access.ts.
//
// · whistleblowing:report — kanal pelaporan TPKS (UU 12/2022 Ps.22): kanal
//   wajib tersedia bagi seluruh pekerja tanpa seleksi akses; submit API hanya
//   menuntut sesi valid (bukan aksi menu).
// Perhatian: key di sini HARUS id di nav (app-shell) dengan section module.
export const PUBLIC_MENU_KEYS: readonly string[] = ["whistleblowing:report"];

/** true bila key termasuk menu publik (dipakai memfilter mode UI ESS). */
export function isPublicMenuKey(key: string): boolean {
  return PUBLIC_MENU_KEYS.includes(key);
}
