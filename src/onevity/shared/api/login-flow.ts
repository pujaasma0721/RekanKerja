import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, buildSessionInfo, currentSessionVersion, freshSessionToken, idleTimeoutOfSession, sessionCookieOptions,
} from "@/onevity/shared/lib/auth";
import { passwordStatusOfSession, touchLastLogin } from "@/onevity/shared/services/password-security";

/**
 * Tahap AKHIR login yang berhasil (T17-MFA — dipakai bersama):
 *   /api/auth/login (1-langkah, tanpa MFA)  dan  /api/auth/mfa/verify (2-langkah).
 * Langkah: buildSessionInfo → auto-pilih workspace tunggal → lastLogin →
 * status umur sandi → cookie sesi (sessionVersion dibaca raw — pola T1).
 * Identitas harus SUDAH terverifikasi (password / password+kode TOTP) sebelum
 * memanggil fungsi ini — di sini TIDAK ada pengecekan kredensial apa pun.
 */
export async function finishLogin(userId: string): Promise<NextResponse> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 500 });

  const info = await buildSessionInfo(user.id, null);
  if (!info) return NextResponse.json({ error: "Sesi gagal dibangun" }, { status: 500 });

  // bila user hanya punya 1 workspace aktif → langsung pilih
  const tid = info.workspaces.length === 1 ? info.workspaces[0]!.id : null;
  const finalInfo = tid ? (await buildSessionInfo(user.id, tid))! : info;

  await touchLastLogin(user.email, tid, user.id);
  const pwStatus = await passwordStatusOfSession(user.id, tid, user.email);
  // Task 64k — batas idle workspace terpilih utk timer sesi client.
  const idleTimeoutMinutes = await idleTimeoutOfSession(user.id, tid);

  const res = NextResponse.json({
    ...finalInfo,
    ...(pwStatus ? { password: pwStatus } : {}),
    ...(idleTimeoutMinutes != null ? { idleTimeoutMinutes } : {}),
  });
  // T1-SECURITY: token membawa sessionVersion user (dicek server-side saat verify;
  // dibaca raw agar juga benar pada proses dev dengan Prisma client cache lama).
  const sv = await currentSessionVersion(user.id);
  res.cookies.set(SESSION_COOKIE, freshSessionToken(user.id, tid, sv), sessionCookieOptions());
  return res;
}
