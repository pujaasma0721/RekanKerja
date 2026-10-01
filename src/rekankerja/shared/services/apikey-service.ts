// RekanKerja API Key Service (T18-API) — kunci per tenant utk Public REST API.
// =====================================================================
// Kunci format: "ov_" + 32 hex acak (crypto.randomBytes). Disimpan HANYA
// hash SHA-256 + prefix (12 karakter pertama) utk display & identitas aktor
// audit "apikey:{prefix}". Kunci penuh ditampilkan SEKALI saat dibuat.
//
// verifyApiKey(req): resolusi TENANT dari hash — kunci dicari di semua schema
// tenant ACTIVE (umumnya 3) lewat cache in-memory; baris revoked (revokedAt
// terisi) → 401. lastUsedAt diperbarui throttled (≤1×/30 dtk per kunci).
// Rate limit ringan in-memory: 60 request/menit per kunci (jendela tetap).
import { createHash, randomBytes } from "node:crypto";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Scope yang dikenal Public API. */
export const API_SCOPES = ["employees", "leave", "payroll"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Rate limit: 60 request/menit per kunci (in-memory, jendela tetap 60 dtk). */
export const RATE_LIMIT_PER_MIN = 60;
const RATE_WINDOW_MS = 60_000;
/** lastUsedAt dibaca-cuci paling sering 1×/30 dtk per kunci (anti write spam). */
const LAST_USED_THROTTLE_MS = 30_000;
/** Cache resolusi keyHash → tenant (TTL; dicabut saat revoke/di luar TTL). */
const RESOLVE_CACHE_TTL_MS = 5 * 60_000;

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

/** Bentuk publik (tanpa hash) utk API & UI. */
export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

function toPublic(row: ApiKeyRow): ApiKeyPublic {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Normalisasi input scopes: lowercase, buang duplikat, hanya yang dikenal. */
export function normalizeScopes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const out: string[] = [];
  for (const s of list) {
    const v = String(s).trim().toLowerCase();
    if ((API_SCOPES as readonly string[]).includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

// ============ generate + revoke + list ============

export interface CreatedApiKey {
  /** Kunci PENUH — hanya dikembalikan sekali di sini (tidak pernah tersimpan). */
  key: string;
  record: ApiKeyPublic;
}

/** Buat kunci baru: "ov_" + 32 hex acak; simpan SHA-256 + prefix. */
export async function generateApiKey(
  db: TenantDb,
  input: { name: string; scopes: string[] },
): Promise<CreatedApiKey> {
  const name = input.name.trim().slice(0, 100) || "Kunci API";
  const scopes = input.scopes.length > 0 ? input.scopes : ["employees"];
  const raw = `ov_${randomBytes(16).toString("hex")}`; // ov_ + 32 hex
  const row = await db.apiKey.create({
    data: {
      name,
      prefix: raw.slice(0, 12),
      keyHash: hashApiKey(raw),
      scopes: scopes.join(","),
    },
  });
  return { key: raw, record: toPublic(row as ApiKeyRow) };
}

/** Cabut kunci (revokedAt = now) — request berikutnya 401. */
export async function revokeApiKey(db: TenantDb, id: string): Promise<ApiKeyPublic | null> {
  const row = await db.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  }).catch(() => null);
  if (!row) return null;
  invalidateResolveCache(row.keyHash);
  return toPublic(row as ApiKeyRow);
}

export async function listApiKeys(db: TenantDb): Promise<ApiKeyPublic[]> {
  const rows = await db.apiKey.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => toPublic(r as ApiKeyRow));
}

// ============ resolusi tenant dari hash (dengan cache) ============

interface ResolvedEntry {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  schemaName: string;
  apiKeyId: string;
  prefix: string;
  scopes: string[];
  keyHash: string;
  cachedAt: number;
}

// globalThis — tahan HMR reload modul di dev.
const g = globalThis as unknown as {
  rekankerjaApiKeyResolveCache?: Map<string, ResolvedEntry>;
  rekankerjaApiKeyRate?: Map<string, { count: number; windowStart: number }>;
  rekankerjaApiKeyLastUsed?: Map<string, number>;
};
const resolveCache = (g.rekankerjaApiKeyResolveCache ??= new Map());
const rateMap = (g.rekankerjaApiKeyRate ??= new Map());
const lastUsedMap = (g.rekankerjaApiKeyLastUsed ??= new Map());

/** Hapus entri cache resolusi (dipanggil saat revoke supaya langsung efektif). */
export function invalidateResolveCache(keyHash: string): void {
  resolveCache.delete(keyHash);
}

/** Cari kunci di SEMUA schema tenant ACTIVE (umumnya 3) berdasarkan hash. */
async function resolveByHash(keyHash: string): Promise<ResolvedEntry | null> {
  // cache segar?
  const hit = resolveCache.get(keyHash);
  if (hit && Date.now() - hit.cachedAt < RESOLVE_CACHE_TTL_MS) return hit;

  const tenants = await platformDb.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, slug: true, schemaName: true },
  });
  for (const t of tenants) {
    try {
      const db = getTenantClient(t.schemaName);
      const row = await db.apiKey.findUnique({ where: { keyHash } });
      if (row) {
        const entry: ResolvedEntry = {
          tenantId: t.id,
          tenantName: t.name,
          tenantSlug: t.slug,
          schemaName: t.schemaName,
          apiKeyId: row.id,
          prefix: row.prefix,
          scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
          keyHash,
          cachedAt: Date.now(),
        };
        resolveCache.set(keyHash, entry);
        return entry;
      }
    } catch {
      // schema tanpa tabel ApiKey (belum termigrasi) → lanjut tenant berikutnya
    }
  }
  return null;
}

// ============ rate limit + verify ============

/**
 * Rate limit in-memory: jendela tetap 60 dtk per keyHash.
 * Return sisa kuota pada jendela ini (0 = habis → 429).
 */
export function consumeRate(keyHash: string, limit = RATE_LIMIT_PER_MIN): { ok: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const cur = rateMap.get(keyHash);
  if (!cur || now - cur.windowStart >= RATE_WINDOW_MS) {
    rateMap.set(keyHash, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1, resetInMs: RATE_WINDOW_MS };
  }
  cur.count += 1;
  const remaining = Math.max(0, limit - cur.count);
  return { ok: cur.count <= limit, remaining, resetInMs: RATE_WINDOW_MS - (now - cur.windowStart) };
}

export type ApiKeyVerifyResult =
  | {
      ok: true;
      db: TenantDb;
      tenant: { id: string; name: string; slug: string };
      key: { id: string; name: string; prefix: string; scopes: string[]; actor: string };
    }
  | { ok: false; status: 401 | 429; error: string };

/**
 * Verifikasi header x-api-key:
 * 1. hash SHA-256 → cari kunci di tenant ACTIVE (cache 5 menit);
 * 2. tidak ketemu / revoked → 401;
 * 3. rate limit 60 req/menit per kunci → 429;
 * 4. lastUsedAt diperbarui throttled (fire-and-forget, tak pernah gagalkan).
 */
export async function verifyApiKey(req: Request): Promise<ApiKeyVerifyResult> {
  const raw = req.headers.get("x-api-key")?.trim() ?? "";
  if (!raw) {
    return { ok: false, status: 401, error: "Header x-api-key wajib diisi" };
  }
  const keyHash = hashApiKey(raw);

  const rate = consumeRate(keyHash);
  if (!rate.ok) {
    return {
      ok: false,
      status: 429,
      error: `Rate limit terlampaui: maksimum ${RATE_LIMIT_PER_MIN} request/menit per kunci — coba lagi dalam ${Math.ceil(rate.resetInMs / 1000)} detik`,
    };
  }

  const entry = await resolveByHash(keyHash);
  if (!entry) {
    return { ok: false, status: 401, error: "Kunci API tidak dikenali" };
  }
  // cek revoked langsung dari DB (bukan cache) supaya revoke berlaku seketika
  const db = getTenantClient(entry.schemaName);
  const row = await db.apiKey.findUnique({ where: { keyHash } }).catch(() => null);
  if (!row || row.revokedAt) {
    invalidateResolveCache(keyHash);
    return { ok: false, status: 401, error: row ? "Kunci API telah dicabut" : "Kunci API tidak dikenali" };
  }

  // lastUsed throttled — fire-and-forget, tak pernah mengganggu request
  const last = lastUsedMap.get(keyHash) ?? 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    lastUsedMap.set(keyHash, Date.now());
    void db.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => { /* housekeeping gagal — abaikan */ });
  }

  return {
    ok: true,
    db,
    tenant: { id: entry.tenantId, name: entry.tenantName, slug: entry.tenantSlug },
    key: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: entry.scopes,
      actor: `apikey:${row.prefix}`,
    },
  };
}
