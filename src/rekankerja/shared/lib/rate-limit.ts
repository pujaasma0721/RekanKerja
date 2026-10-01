// RekanKerja — rate limiter IN-MEMORY sederhana (sliding window) =============
// ===========================================================================
// Tanpa dependency baru; state Map module-level — PER PROSES/INSTANCE.
// Pola mengikuti limiter percobaan MFA (shared/api/auth-mfa.ts): Map +
// jendela waktu; state reset saat proses restart.
//
// CATATAN KAPASITAS (M-3 audit 42): cukup untuk deployment single-node
// (PM2 1 instance) saat ini. Bila kelak berjalan multi-instance di belakang
// load balancer, tiap instance punya hitungan sendiri → batas efektif
// dikali jumlah instance; pindahkan ke store bersama (mis. Redis) —
// dicatat juga di worklog/runbook.
//
// Kunci bebas string — konvensi pemanggil: "<scope>:<dimensi>:<nilai>"
// (contoh: "register:ip:203.0.113.9", "register:email:a@b.co").

export interface RateLimitDecision {
  /** false = melewati batas → panggilan wajib ditolak (429 + Retry-After). */
  allowed: boolean;
  /** detik sampai hit tertua keluar jendela (header Retry-After); 0 bila allowed. */
  retryAfterSec: number;
  /** sisa slot dalam jendela saat ini. */
  remaining: number;
}

interface RateBucket {
  hits: number[]; // epoch ms
}

const buckets = new Map<string, RateBucket>();
const MAX_KEYS = 10_000; // guard pertumbuhan memori (key tak terbatas = DoS ringan)

/** Buang bucket kosong bila map membengkak (guard, bukan jaminan penuh). */
function sweep(windowMs: number): void {
  if (buckets.size <= MAX_KEYS) return;
  const cutoff = Date.now() - windowMs;
  for (const [key, b] of buckets) {
    b.hits = b.hits.filter((t) => t > cutoff);
    if (b.hits.length === 0) buckets.delete(key);
  }
}

/**
 * Catat SATU percobaan & putuskan boleh/terblokir (sliding window: hit tua
 * otomatis keluar jendela, jadi burst lalu idle → jendela bergeser maju).
 * Sinkron, tidak pernah throw — kegagalan pembatasan tidak boleh mengganggu
 * request (fail-open lebih aman daripada 500 di jalur auth).
 */
export function hitRateLimit(key: string, limit: number, windowMs: number): RateLimitDecision {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    buckets.set(key, { hits });
    const retryAfterSec = Math.max(1, Math.ceil((hits[0]! - cutoff) / 1000));
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, { hits });
  sweep(windowMs);
  return { allowed: true, retryAfterSec: 0, remaining: limit - hits.length };
}

/** Hapus seluruh state (test / reset manual). */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * PEEK: berapa hit jendela saat ini TANPA mencatat hit baru.
 * Dipakai pra-flight (mis. login: hanya percobaan GAGAL yang dicatat via
 * hitRateLimit; peek memeriksa blok tanpa menghukum login sukses).
 */
export function peekRateLimit(key: string, windowMs: number): { count: number; retryAfterSec: number } {
  const cutoff = Date.now() - windowMs;
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => t > cutoff);
  if (hits.length === 0) return { count: 0, retryAfterSec: 0 };
  return { count: hits.length, retryAfterSec: Math.max(1, Math.ceil((hits[0]! - cutoff) / 1000)) };
}
