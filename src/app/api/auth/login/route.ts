import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, verifyPassword, buildSessionInfo, currentSessionVersion,
} from "@/onevity/shared/lib/auth";
import { resolveLoginLockout, passwordStatusOfSession, touchLastLogin } from "@/onevity/shared/services/password-security";

// POST /api/auth/login { email, password } → session cookie (tid otomatis bila 1 workspace)
// Task 33: lockout percobaan gagal (policy tenant pertama), reset hitungan saat
// sukses, lastLogin AppUser, dan flag kedaluwarsa kata sandi (lifetime).
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    if (!email || !password) return NextResponse.json({ error: "Email dan kata sandi wajib diisi" }, { status: 400 });

    const user = await db.user.findUnique({ where: { email } });

    // ---- lockout aktif? ----
    if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      return NextResponse.json(
        { error: `Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ${minutes} menit atau minta admin mereset kata sandi Anda.` },
        { status: 423 },
      );
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
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

    // ---- sukses: reset hitungan + lastLogin + status umur sandi ----
    await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });

    const info = await buildSessionInfo(user.id, null);
    if (!info) return NextResponse.json({ error: "Sesi gagal dibangun" }, { status: 500 });

    // bila user hanya punya 1 workspace aktif → langsung pilih
    const tid = info.workspaces.length === 1 ? info.workspaces[0]!.id : null;
    const finalInfo = tid ? (await buildSessionInfo(user.id, tid))! : info;

    await touchLastLogin(email, tid, user.id);
    const pwStatus = await passwordStatusOfSession(user.id, tid, email);

    const res = NextResponse.json({
      ...finalInfo,
      ...(pwStatus ? { password: pwStatus } : {}),
    });
    // T1-SECURITY: token membawa sessionVersion user (dicek server-side saat verify;
    // dibaca raw agar juga benar pada proses dev dengan Prisma client cache lama).
    const sv = await currentSessionVersion(user.id);
    res.cookies.set(SESSION_COOKIE, freshSessionToken(user.id, tid, sv), sessionCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

