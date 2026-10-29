// RekanKerja — Online Support P5-SEC: sesi login PEMILIK APLIKASI. ==========
// =====================================================================
// GET   /api/rekankerja/platform/admin/session — whoami ({ admin } | { admin: null }).
// POST  /api/rekankerja/platform/admin/session — login { email, password }
//       → Set-Cookie rk_platform_admin (realm mandiri: kunci HMAC beda +
//       path /api/rekankerja/platform/** — cookie ini tidak pernah dikirim
//       ke API tenant). Lockout 5 gagal / 15 menit + rate-limit per IP/email.
// DELETE /api/rekankerja/platform/admin/session — logout: naikkan
//       sessionVersion (semua sesi platform admin itu gugur) + hapus cookie.
// Kredensial hidup HANYA di tabel PlatformAdmin (public schema) — bukan
// User platform/member tenant, bukan AppUser tenant.
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/rekankerja/shared/lib/auth";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import {
  PLATFORM_SESSION_MAX_AGE, signPlatformSession,
  readPlatformSessionCookie, platformSessionCookieOptions, platformSessionClearOptions,
} from "@/rekankerja/shared/lib/platform-session";
import { db as platformDb } from "@/lib/db";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function cookieHeader(token: string | null): Record<string, string> {
  const opts = token == null ? platformSessionClearOptions() : platformSessionCookieOptions();
  const parts = [
    `${token == null ? "rk_platform_admin=" : `rk_platform_admin=${encodeURIComponent(token)}`}`,
    `Path=${opts.path}`,
    `Max-Age=${opts.maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(opts.secure ? ["Secure"] : []),
  ];
  return { "Set-Cookie": parts.join("; ") };
}

function publicAdmin(row: { email: string; name: string; lastLoginAt: Date | null }) {
  return { email: row.email, name: row.name, lastLoginAt: row.lastLoginAt?.toISOString() ?? null };
}

export async function GET(req: NextRequest) {
  try {
    const payload = readPlatformSessionCookie(req);
    if (!payload) return NextResponse.json({ admin: null });
    const rows = await platformDb.$queryRaw<Array<{ email: string; name: string; active: boolean; sessionVersion: number; lastLoginAt: Date | null }>>`
      SELECT email, name, active, "sessionVersion", "lastLoginAt" FROM "PlatformAdmin" WHERE id = ${payload.aid} LIMIT 1`;
    const row = rows[0];
    if (!row || row.active !== true || Number(row.sessionVersion) !== payload.sv) {
      return NextResponse.json({ admin: null }, { headers: cookieHeader(null) });
    }
    return NextResponse.json({ admin: publicAdmin(row) });
  } catch {
    return NextResponse.json({ admin: null });
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const password = typeof b.password === "string" ? b.password : "";
    if (!email || !password) {
      return NextResponse.json({ error: "Email dan kata sandi wajib diisi" }, { status: 400 });
    }

    // Rate-limit brute force (per IP+email): 10 percobaan / 10 menit.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const rl = hitRateLimit(`platform-admin:login:${ip}:${email}`, 10, 10 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan masuk — coba lagi beberapa saat lagi" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    const rows = await platformDb.$queryRaw<Array<{
      id: string; email: string; name: string; passwordHash: string; active: boolean;
      failedAttempts: number; lockedUntil: Date | null; sessionVersion: number; lastLoginAt: Date | null;
    }>>`
      SELECT id, email, name, "passwordHash", active, "failedAttempts", "lockedUntil", "sessionVersion", "lastLoginAt"
      FROM "PlatformAdmin" WHERE email = ${email} LIMIT 1`;
    const row = rows[0];
    // Pesan gagal generik — tidak membocorkan keberadaan email.
    const GENERIC = "Email atau kata sandi salah";
    if (!row || row.active !== true) {
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }
    if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
      return NextResponse.json(
        { error: `Akun terkunci sementara — coba lagi dalam ~${Math.ceil((new Date(row.lockedUntil).getTime() - Date.now()) / 60_000)} menit` },
        { status: 423 },
      );
    }
    if (!verifyPassword(password, row.passwordHash)) {
      // hitung gagal → kunci bila mencapai ambang (pola lockout User auth).
      const failed = Number(row.failedAttempts) + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await platformDb.$executeRaw`
        UPDATE "PlatformAdmin" SET "failedAttempts" = ${failed}, "lockedUntil" = ${lock}, "updatedAt" = now()
        WHERE id = ${row.id}`;
      if (lock) console.warn(`[platform-admin] login ${email} TERKUNCI ${LOCK_MINUTES}m (${failed}x gagal)`);
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    // sukses: reset hitungan + catat login.
    const sessionVersion = Number(row.sessionVersion);
    await platformDb.$executeRaw`
      UPDATE "PlatformAdmin" SET "failedAttempts" = 0, "lockedUntil" = NULL, "lastLoginAt" = now(), "updatedAt" = now()
      WHERE id = ${row.id}`;
    const token = signPlatformSession({
      aid: row.id,
      exp: Date.now() + PLATFORM_SESSION_MAX_AGE * 1000,
      sv: sessionVersion,
    });
    console.log(`[platform-admin] login sukses: ${email}`);
    return NextResponse.json(
      { admin: { email: row.email, name: row.name, lastLoginAt: new Date().toISOString() } },
      { headers: cookieHeader(token) },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const payload = readPlatformSessionCookie(req);
    if (payload) {
      // Revokasi server-side: naikkan sessionVersion → SEMUA sesi admin ini
      // (device lain termasuk) otomatis tidak sah (pola T1-SECURITY).
      await platformDb.$executeRaw`
        UPDATE "PlatformAdmin" SET "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now()
        WHERE id = ${payload.aid}`;
      console.log(`[platform-admin] logout: sesi admin ${payload.aid} direvokasi`);
    }
    return NextResponse.json({ ok: true }, { headers: cookieHeader(null) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
