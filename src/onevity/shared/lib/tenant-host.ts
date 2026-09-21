// OneVity — resolusi TENANT dari alamat web (Task 78, opsi ① subdomain).
// Tiap tenant punya alamat sendiri: <slug>.<base-domain>, mis. sayone.onevity.id.
// File ini PURE (tanpa import DB/server-only) — boleh diimpor proxy.ts (edge)
// maupun route server. Resolusi ke DB ada di tenant-host-server.ts.
//
// Konfigurasi: env ONEVITY_BASE_DOMAINS — daftar base domain milik aplikasi,
// dipisah koma. Contoh: "onevity.id,sayone.my.id".
//   · Host sayone.onevity.id  → slug "sayone" (subdomain tenant).
//   · Host onevity.id         → null (host utama — perilaku lama: pilih workspace).
//   · Host apa pun yang TIDAK berakhiran base domain (mis. IP, localhost,
//     onevity.sayone.my.id saat env belum diset) → null → perilaku lama.
//    (Fallback ini membuat rollout aman: tanpa env, aplikasi berperilaku
//     persis seperti sebelumnya; dengan env, hanya subdomain yang berubah.)

/** Base domain milik aplikasi dari env (lowercase, tanpa leading dot). */
export function baseDomains(): string[] {
  return (process.env.ONEVITY_BASE_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

export interface HostTenant {
  /** slug tenant dari subdomain (huruf kecil) — null bila host bukan subdomain tenant. */
  slug: string | null;
  /** true bila host = salah satu base domain (host utama aplikasi). */
  isBaseHost: boolean;
}

/**
 * Parsed host request → info tenant. Input: header Host atau x-forwarded-host
 * (sudah dipilih pemanggil). Host dengan port ("sayone.onevity.id:443") aman.
 */
export function hostTenantOf(rawHost: string | null | undefined): HostTenant {
  const bases = baseDomains();
  const host = (rawHost ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!host || bases.length === 0) return { slug: null, isBaseHost: false };
  if (bases.includes(host)) return { slug: null, isBaseHost: true };
  for (const base of bases) {
    if (host.endsWith(`.${base}`)) {
      const slug = host.slice(0, host.length - base.length - 1).replace(/\.$/, "");
      // Hanya label tunggal yang valid sebagai tenant — "a.b.onevity.id" bukan
      // slug (slug tenant tak pernah mengandung titik); abaikan agar aman.
      if (slug && !slug.includes(".")) return { slug, isBaseHost: false };
      return { slug: null, isBaseHost: false };
    }
  }
  return { slug: null, isBaseHost: false };
}

/** Host request dari NextRequest/Request: x-forwarded-host (proxy .6) → host. */
export function requestHostOf(req: { headers: { get(name: string): string | null } }): string | null {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host");
}
