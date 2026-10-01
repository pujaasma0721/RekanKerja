// RekanKerja TOTP — RFC 6238 MURNI tanpa dependency (T17-MFA). ================
// ============================================================================
// Implementasi lengkap pakai node:crypto bawaan:
//   • base32 encode/decode (RFC 4648, alphabet A-Z2-7)
//   • HOTP (RFC 4226) — HMAC-SHA1, dynamic truncation, 6 digit
//   • TOTP (RFC 6238) — time step 30 detik, window ±1 (±30 dtk clock drift)
// TANPA otplib — package `qrcode` hanya dipakai route setup utk QR data URL.
// Modul ini PURITY: hanya node:crypto, tanpa DB/env — mudah diuji unit.
// Semua pemakaian di server (node runtime). JANGAN impor dari komponen client.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** digit kode (RFC 6238 default 6). */
export const TOTP_DIGITS = 6;
/** periode time step detik (RFC 6238 default 30). */
export const TOTP_PERIOD = 30;
/** algoritma MAC (RFC 6238 default SHA-1). */
export const TOTP_ALGORITHM = "SHA1";
/** window counter ±1 (toleransi clock drift 30 dtk) — dipakai verifyCode. */
export const TOTP_WINDOW = 1;

// ============ base32 (RFC 4648) ============

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode Buffer → string base32 TANPA padding '=' (konvensi secret TOTP). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decode string base32 → Buffer. Toleran: huruf kecil, spasi, padding '='.
 * Throw Error bila ada karakter di luar alphabet (pemanggil menangkap).
 */
export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  if (clean.length === 0) throw new Error("secret base32 kosong");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`karakter base32 tidak valid: "${ch}"`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ============ HOTP (RFC 4226) ============

/** Kode HOTP 6 digit utk counter tertentu — dynamic truncation standar. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  // counter 8-byte big-endian (BigInt utk aman > 2^31)
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

// ============ TOTP (RFC 6238) ============

/** Counter TOTP utk waktu (ms epoch) — floor(unixSeconds / 30). */
export function totpCounter(forTimeMs = Date.now(), period = TOTP_PERIOD): number {
  return Math.floor(Math.floor(forTimeMs / 1000) / period);
}

/** Kode TOTP saat ini (dipakai harness uji/CLI — BUKAN jalur verifikasi). */
export function currentCode(secretBase32: string, forTimeMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpCounter(forTimeMs));
}

/**
 * Verifikasi token TOTP 6 digit terhadap secret base32.
 * Window ±1 step (±30 dtk drift). Perbandingan pakai timingSafeEqual.
 * Secret rusak/karakter ngawur → false (tidak throw).
 */
export function verifyCode(secretBase32: string, token: string, window = TOTP_WINDOW): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const counter = totpCounter();
  const expect = Buffer.from(token, "utf8");
  for (let w = -window; w <= window; w++) {
    const cand = Buffer.from(hotp(key, counter + w), "utf8");
    if (cand.length === expect.length && timingSafeEqual(cand, expect)) return true;
  }
  return false;
}

// ============ secret & otpauth ============

/** Secret baru: 20 byte acak (160-bit, standar Google Authenticator) → base32 32 char. */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/**
 * URL otpauth:// (dipindai aplikasi authenticator — Google/Authy/Microsoft).
 * Label "Issuer:account" + parameter eksplisit (algorithm/digits/period)
 * supaya aplikasi tidak menebak salah.
 */
export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const q = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: TOTP_ALGORITHM,
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
