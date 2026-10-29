// RekanKerja — SESI REALM PLATFORM ADMIN (mandiri, P5-SEC). ==================
// =====================================================================
// Prinsip pemisahan (respons audit keamanan P5): konsol pemilik aplikasi
// TIDAK BOLEH menumpang realm sesi tenant. Dua garis pemisahan keras:
//   1. KUNCI BEDA — token sesi platform ditandatangani HMAC dgn kunci
//      SHA-256(SESSION_SECRET + domain tag platform), BERBEDA dari kunci
//      token tenant (auth.ts memakai sessionSecret() mentah). Token tenant
//      tidak pernah bisa dipalsukan jadi token platform & sebaliknya.
//   2. COOKIE BEDA + PATH-SCOPED — cookie `rk_platform_admin` HANYA
//      dikirim browser ke /api/rekankerja/platform/** — tidak pernah
//      menyertai request API tenant manapun (dan cookie tenant tidak
//      pernah terbaca oleh guard platform). Kompromi satu realm tidak
//      otomatis membuka realm lain.
// Revokasi server-side: payload membawa sessionVersion PlatformAdmin;
// logout/ganti sandi menaikkannya → semua token lama gugur (pola T1).
// TTL 8 jam (lebih pendek dari sesi tenant — konsol lintas-tenant adalah
// permukaan paling sensitif di aplikasi).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/rekankerja/shared/lib/auth";

export const PLATFORM_ADMIN_COOKIE = "rk_platform_admin";

/** TTL sesi platform: 8 jam. */
export const PLATFORM_SESSION_MAX_AGE = 8 * 60 * 60;

const PLATFORM_TOKEN_DOMAIN = "rekankerja:platform-admin-session:v1";

/** Kunci tanda tangan realm platform — DIBEDAKAN dari kunci token tenant. */
function platformSessionKey(): Buffer {
  return createHash("sha256").update(`${sessionSecret()}::${PLATFORM_TOKEN_DOMAIN}`).digest();
}

export interface PlatformSessionPayload {
  /** id baris PlatformAdmin. */
  aid: string;
  exp: number;
  /** sessionVersion saat login — dicocokkan ke DB tiap request. */
  sv: number;
}

export function signPlatformSession(p: PlatformSessionPayload): string {
  const body = Buffer.from(JSON.stringify({ aid: p.aid, exp: p.exp, sv: p.sv })).toString("base64url");
  const mac = createHmac("sha256", platformSessionKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** Verifikasi tanda tangan + kedaluwarsa; null bila token rusak/dipalsukan. */
export function parsePlatformSession(token?: string | null): PlatformSessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = createHmac("sha256", platformSessionKey()).update(body).digest("base64url");
  if (mac.length !== expect.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<PlatformSessionPayload>;
    if (!p.aid || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    if (typeof p.sv !== "number") return null;
    return { aid: p.aid, exp: p.exp, sv: p.sv };
  } catch {
    return null;
  }
}

/** Baca cookie sesi platform dari request (hanya realm ini — bukan cookie tenant). */
export function readPlatformSessionCookie(req: Request): PlatformSessionPayload | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${PLATFORM_ADMIN_COOKIE}=([^;]+)`));
  return parsePlatformSession(m?.[1] ? decodeURIComponent(m[1]) : null);
}

/** Opsi Set-Cookie sesi platform — path TERKURUNG ke prefix API platform. */
export function platformSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/rekankerja/platform/", // ⬅ TIDAK pernah dikirim ke endpoint lain
    maxAge: PLATFORM_SESSION_MAX_AGE,
  };
}

/** Opsi penghapusan cookie (logout) — path sama, maxAge 0. */
export function platformSessionClearOptions() {
  return { ...platformSessionCookieOptions(), maxAge: 0 };
}
