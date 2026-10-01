import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  readUserMfa, signMfaToken, verifyPassword,
} from "@/rekankerja/shared/lib/auth";
import { finishLogin } from "@/rekankerja/shared/api/login-flow";
import { resolveLoginLockout } from "@/rekankerja/shared/services/password-security";
import { hitRateLimit, peekRateLimit } from "@/rekankerja/shared/lib/rate-limit";

// POST /api/auth/login { email, password } → session cookie (tid otomatis bila 1 workspace)
// Task 33: lockout percobaan gagal (policy tenant pertama), reset hitungan saat
// sukses, lastLogin AppUser, dan flag kedaluwarsa kata sandi (lifetime).
// T17-MFA: 2-LANGKAH bila user.totpEnabled — password benar → JANGAN set cookie;
// kembalikan { mfaRequired: true, mfaToken } (HMAC 5 menit). Cookie hanya di-set
// /api/auth/mfa/verify setelah kode 6 digit TOTP benar (finishLogin dipakai bersama).
//
// Task 82-T2: rate limit IP-level anti password-spraying — HANYA percobaan GAGAL
// (email/sandi salah atau akun terkunci) yang dihitung; login sukses tidak. Batas
// longgar (30/15 mnt) agar kantor dengan NAT/IP bersama tidak terganggu, namun
// spraying lintas akun (banyak akun × sedikit percobaan) terhenti di batas ini.
const LOGIN_IP_FAIL_LIMIT = 30;
const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

/** IP klien: nilai PERTAMA x-forwarded-for (proxy/load balancer menempatkannya), fallback "unknown". */
function clientIp(req: NextRequest): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    if (!email || !password) return NextResponse.json({ error: "Email dan kata sandi wajib diisi" }, { status: 400 });

    // ---- Task 82-T2: blok IP bila sudah kebanyakan percobaan GAGAL ----
    const ipKey = `login:fail:ip:${clientIp(req)}`;
    const peek = peekRateLimit(ipKey, LOGIN_IP_WINDOW_MS);
    if (peek.count >= LOGIN_IP_FAIL_LIMIT) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan masuk gagal dari jaringan ini. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(peek.retryAfterSec) } },
      );
    }
    const ipFail = () => hitRateLimit(ipKey, LOGIN_IP_FAIL_LIMIT, LOGIN_IP_WINDOW_MS);

    const user = await db.user.findUnique({ where: { email } });

    // ---- lockout aktif? ----
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      ipFail(); // hitung sebagai percobaan gagal dari IP ini
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      return NextResponse.json(
        { error: `Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ${minutes} menit atau minta admin mereset kata sandi Anda.` },
        { status: 423 },
      );
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      ipFail(); // hitung sebagai percobaan gagal dari IP ini
      // ---- hitung percobaan gagal (+ kunci bila melewati batas policy) ----
      if (user) {
        const { maxFailedAttempts, lockoutMinutes } = await resolveLoginLockout(user.id);
        const attempts = (user.failedAttempts ?? 0) + 1;
        const lock = maxFailedAttempts > 0 && attempts >= maxFailedAttempts;
        await db.user.update({
          where: { id: user.id },
          data: {
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock && lockoutMinutes > 0 ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
          },
        });
        if (lock) {
          return NextResponse.json(
            { error: `Terlalu banyak percobaan gagal — akun terkunci ${lockoutMinutes} menit.` },
            { status: 423 },
          );
        }
        const remaining = Math.max(0, maxFailedAttempts - attempts);
        return NextResponse.json(
          {
            error: remaining > 0
              ? `Email atau kata sandi salah (sisa ${remaining} percobaan sebelum akun terkunci).`
              : "Email atau kata sandi salah.",
          },
          { status: 401 },
        );
      }
      return NextResponse.json({ error: "Email atau kata sandi salah" }, { status: 401 });
    }

    // ---- sukses: reset hitungan gagal (lastLogin + cookie ada di finishLogin) ----
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });

    // ---- T17-MFA: akun ber-MFA → langkah 2 (kode TOTP), cookie BELUM di-set ----
    // Kolom dibaca raw (pola T1 sessionVersion) agar benar juga pada proses dev
    // yang Prisma client-nya masih cache lama (pra kolom totpSecret/totpEnabled).
    const mfa = await readUserMfa(user.id);
    if (mfa?.enabled && mfa.secret) {
      return NextResponse.json({ mfaRequired: true, mfaToken: signMfaToken(user.id) });
    }

    return finishLogin(user.id, req); // Task 78: req utk auto-select subdomain
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

