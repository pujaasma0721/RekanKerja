// RekanKerja — resolusi tenant SUBDOMAIN sisi server (Task 78).
// Pasangan tenant-host.ts (pure). Di sini slug dari host dicocokkan ke registry
// platform (tabel Tenant) — cache in-memory TTL singkat agar host header tidak
// memicu query di setiap request, namun tenant baru/suspended terlihat ≤60 dtk.
import { db } from "@/lib/db";
import { hostTenantOf, requestHostOf, type HostTenant } from "./tenant-host";

export interface TenantHostRecord {
  id: string;
  slug: string;
  status: string;
}

interface CacheEntry {
  /** tenant ATAU null (slug tidak dikenal — juga di-cache agar probing murah). */
  tenant: TenantHostRecord | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 1 menit — perubahan status/slug tenant terlihat cepat
const globalForHost = globalThis as unknown as {
  rekankerjaTenantHostCache?: Map<string, CacheEntry>;
};
const cache: Map<string, CacheEntry> = (globalForHost.rekankerjaTenantHostCache ??= new Map());

/** Slug tenant dari host + verifikasi ke registry platform (cache TTL 60 dtk). */
export async function resolveTenantByHost(
  req: { headers: { get(name: string): string | null } },
): Promise<{ host: HostTenant; tenant: TenantHostRecord | null }> {
  const host = hostTenantOf(requestHostOf(req));
  if (!host.slug) return { host, tenant: null };

  const slug = host.slug;
  const hit = cache.get(slug);
  if (hit && hit.expiresAt > Date.now()) return { host, tenant: hit.tenant };

  let tenant: TenantHostRecord | null = null;
  try {
    const row = await db.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    // Hanya tenant AKTIF yang bisa di-alamat-kan — SUSPENDED diperlakukan
    // seperti slug tidak dikenal (fallback ke perilaku pilih-workspace).
    tenant = row && row.status === "ACTIVE" ? { id: row.id, slug: row.slug, status: row.status } : null;
  } catch {
    tenant = null; // DB belum siap → perilaku lama (jangan pernah 500 di sini)
  }
  cache.set(slug, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
  return { host, tenant };
}

/** Hapus entri cache (dipakai tes/registrasi slug baru — opsional). */
export function invalidateTenantHost(slug: string): void {
  cache.delete(slug);
}
