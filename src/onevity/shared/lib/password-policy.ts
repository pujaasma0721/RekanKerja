// OneVity — KEBIJAKAN KATA SANDI (Task 33) ================================
// =====================================================================
// Aturan validasi kata sandi BARU (tambah pengguna / reset / ganti sendiri
// / register) — "setting rules" lengkap: panjang minimum-maksimum, kombinasi
// huruf besar/kecil/angka/karakter khusus, karakter unik minimum, larangan
// karakter berulang & berurutan, larangan memuat username/nama, daftar sandi
// umum, umur (lifetime), riwayat N sandi terakhir, dan lockout login.
//
// Berkas ini CLIENT-SAFE (murni, tanpa import server): dipakai UI (checklist
// live + meter kekuatan) DAN API (validasi otoritatif) — satu sumber kebenaran.
// Riwayat & lockout dicek di sisi server (butuh DB) — lihat shared/api.
// =====================================================================

// ---------- bentuk kebijakan (selaras model tenant PasswordPolicy) ----------

export interface PasswordPolicyData {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecial: boolean;
  minUniqueChars: number;
  maxRepeated: number;
  maxSequential: number;
  blockUsername: boolean;
  blockName: boolean;
  blockCommon: boolean;
  lifetimeDays: number;
  warnDays: number;
  historyCount: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

/** Kebijakan default — nilai seed migrasi & fallback saat baris belum ada. */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicyData = {
  minLength: 8,
  maxLength: 64,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  minUniqueChars: 4,
  maxRepeated: 3,
  maxSequential: 3,
  blockUsername: true,
  blockName: true,
  blockCommon: true,
  lifetimeDays: 90,
  warnDays: 7,
  historyCount: 6,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
};

// ---------- daftar kata sandi umum + brand (blockCommon) ----------

const COMMON_PASSWORDS = [
  "password", "password1", "passw0rd", "p@ssw0rd", "passwort",
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm",
  "abc123", "abcd1234", "1q2w3e", "1qaz2wsx", "qazwsx",
  "111111", "000000", "121212", "123123", "123321", "654321", "666666", "696969", "112233",
  "iloveyou", "letmein", "welcome", "monkey", "dragon", "sunshine", "princess", "football",
  "admin", "admin123", "administrator", "root", "toor", "master", "guest", "user",
  "test", "test123", "demo", "demo123", "secret", "changeme", "temp", "qwerty123",
  "onevity", "onevity123", "oranhr", "hris", "hrd123", "payroll123",
  "sandi", "sandilemah", "indonesia", "jakarta", "merdeka", "budi123",
];

// ---------- hasil validasi ----------

export interface PasswordCheck {
  key: string;
  label: string;
  pass: boolean;
}

export interface PasswordValidateCtx {
  /** username pengguna (utk aturan blockUsername) */
  username?: string | null;
  /** nama lengkap (utk aturan blockName) */
  fullName?: string | null;
  /** email (utk aturan blockUsername — bagian lokal juga dicek) */
  email?: string | null;
}

export interface PasswordValidation {
  ok: boolean;
  checks: PasswordCheck[];
  /** pesan aturan yang GAGAL (Bahasa Indonesia) — dipakai error API & UI */
  errors: string[];
}

// ---------- util deteksi pola ----------

/** Panjang run karakter sama berturut-turut terpanjang (aaa → 3). */
function longestRepeat(s: string): number {
  let best = 0;
  let run = 0;
  let prev = "";
  for (const ch of s) {
    run = ch === prev ? run + 1 : 1;
    prev = ch;
    if (run > best) best = run;
  }
  return best;
}

/** Panjang run berurutan naik/turun terpanjang (abc → 3, 4321 → 4). */
function longestSequential(s: string): number {
  let best = 0;
  let up = 0;
  let down = 0;
  let prevCode: number | null = null;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const delta = prevCode == null ? 0 : code - prevCode;
    up = delta === 1 ? up + 1 : 1;
    down = delta === -1 ? down + 1 : 1;
    prevCode = code;
    best = Math.max(best, up, down);
  }
  return best;
}

/** Normalisasi utk pencocokan: huruf kecil + hanya alfanumerik. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function containsIgnoreCase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return norm(haystack).includes(norm(needle));
}

// ---------- validasi utama ----------

/**
 * Validasi sandi terhadap kebijakan — SEMUA aturan kompleksitas.
 * `policy` boleh parsial (digabung dengan default) — register memakai default.
 * Riwayat & umur tidak di sini (butuh data server).
 */
export function validatePassword(
  policy: Partial<PasswordPolicyData>,
  password: string,
  ctx: PasswordValidateCtx = {},
): PasswordValidation {
  const p = { ...DEFAULT_PASSWORD_POLICY, ...policy };
  const checks: PasswordCheck[] = [];
  const add = (key: string, label: string, pass: boolean) => checks.push({ key, label, pass });

  // panjang
  if (p.minLength > 0) add("length", `Minimal ${p.minLength} karakter`, password.length >= p.minLength);
  if (p.maxLength > 0) add("maxLength", `Maksimal ${p.maxLength} karakter`, password.length <= p.maxLength);

  // kombinasi karakter
  if (p.requireUppercase) add("upper", "Mengandung huruf besar (A–Z)", /[A-Z]/.test(password));
  if (p.requireLowercase) add("lower", "Mengandung huruf kecil (a–z)", /[a-z]/.test(password));
  if (p.requireNumber) add("number", "Mengandung angka (0–9)", /[0-9]/.test(password));
  if (p.requireSpecial) add("special", "Mengandung karakter khusus (!@#$% dll.)", /[^A-Za-z0-9]/.test(password));

  // keunikan & pola
  if (p.minUniqueChars > 0) {
    const uniq = new Set(password.toLowerCase()).size;
    add("unique", `Minimal ${p.minUniqueChars} karakter berbeda`, uniq >= p.minUniqueChars);
  }
  if (p.maxRepeated > 0) {
    const rep = longestRepeat(password);
    add("repeated", `Tidak lebih dari ${p.maxRepeated} karakter sama berturut-turut (contoh: aaaa)`, rep <= p.maxRepeated);
  }
  if (p.maxSequential > 0) {
    const seq = longestSequential(password);
    add("sequential", `Tidak lebih dari ${p.maxSequential} karakter berurutan (contoh: abcd / 4321)`, seq <= p.maxSequential);
  }

  // larangan identitas
  if (p.blockUsername) {
    const username = (ctx.username ?? "").trim();
    const emailLocal = (ctx.email ?? "").split("@")[0]?.trim() ?? "";
    const hit = [username, emailLocal].filter((t) => t.length >= 3)
      .some((t) => containsIgnoreCase(password, t));
    add("username", "Tidak mengandung username / email", !hit);
  }
  if (p.blockName) {
    const parts = (ctx.fullName ?? "").split(/[\s.@_-]+/).map((t) => t.trim()).filter((t) => t.length >= 3);
    const hit = parts.some((t) => containsIgnoreCase(password, t));
    add("name", "Tidak mengandung nama pengguna", !hit);
  }
  if (p.blockCommon) {
    const hit = COMMON_PASSWORDS.some((t) => containsIgnoreCase(password, t));
    add("common", "Bukan kata sandi umum / mudah ditebak", !hit);
  }

  const errors = checks.filter((c) => !c.pass).map((c) => c.label);
  return { ok: errors.length === 0, checks, errors };
}

// ---------- meter kekuatan (indikatif, bukan aturan) ----------

export type StrengthLabel = "Lemah" | "Sedang" | "Kuat" | "Sangat Kuat";

export function passwordStrength(password: string): { score: number; label: StrengthLabel; pct: number } {
  if (!password) return { score: 0, label: "Lemah", pct: 0 };
  let score = 0;
  score += Math.min(32, Math.floor(password.length * 3)); // panjang → maks 32
  if (/[a-z]/.test(password)) score += 8;
  if (/[A-Z]/.test(password)) score += 8;
  if (/[0-9]/.test(password)) score += 8;
  if (/[^A-Za-z0-9]/.test(password)) score += 12;
  score += Math.min(12, new Set(password.toLowerCase()).size * 2); // keragaman
  if (longestRepeat(password) <= 2) score += 10; // tanpa run panjang
  if (longestSequential(password) <= 2) score += 10; // tanpa pola urut
  if (COMMON_PASSWORDS.some((t) => containsIgnoreCase(password, t))) score = Math.min(score, 24);
  const pct = Math.max(0, Math.min(100, score));
  const label: StrengthLabel = pct >= 85 ? "Sangat Kuat" : pct >= 67 ? "Kuat" : pct >= 40 ? "Sedang" : "Lemah";
  return { score, label, pct };
}

// ---------- umur kata sandi (lifetime) ----------

export interface PasswordAge {
  /** null = tidak bisa dihitung (belum pernah disetel / lifetime nonaktif) */
  remainingDays: number | null;
  expired: boolean;
  warn: boolean;
  label: string;
}

/** Status umur sandi: label utk tabel pengguna + toast shell. */
export function passwordAge(changedAt: string | Date | null | undefined, policy: Pick<PasswordPolicyData, "lifetimeDays" | "warnDays">): PasswordAge {
  if (!changedAt || policy.lifetimeDays <= 0) {
    return { remainingDays: null, expired: false, warn: false, label: "Tanpa batas umur" };
  }
  const set = changedAt instanceof Date ? changedAt : new Date(changedAt);
  const ageDays = (Date.now() - set.getTime()) / 86_400_000;
  const remainingDays = Math.ceil(policy.lifetimeDays - ageDays);
  const expired = remainingDays <= 0;
  const warn = !expired && remainingDays <= policy.warnDays;
  const label = expired
    ? "Kedaluwarsa"
    : remainingDays === 1
      ? "Kedaluwarsa besok"
      : `Berlaku ${remainingDays} hari lagi`;
  return { remainingDays, expired, warn, label };
}

// ---------- pemetaan role aplikasi → role membership platform ----------

/**
 * AppUser.role (tenant) → role UserTenant (platform).
 * HANYA "Admin" → ADMIN (super admin otomatis). HR Manager/HR Staff/Approver
 * → HR (boleh mutasi, hak menu tetap diatur per pengguna), Viewer → VIEWER.
 */
export function platformRoleOfAppRole(appRole: string): "ADMIN" | "HR" | "VIEWER" {
  switch (appRole) {
    case "Admin":
      return "ADMIN";
    case "HR Manager":
    case "HR Staff":
    case "Approver":
      return "HR";
    default:
      return "VIEWER";
  }
}
