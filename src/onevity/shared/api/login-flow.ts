import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, buildSessionInfo, currentSessionVersion, effectiveTenantIdOf, freshSessionToken, idleTimeoutOfSession, sessionCookieOptions,
} from "@/onevity/shared/lib/auth";
import { passwordStatusOfSession, touchLastLogin } from "@/onevity/shared/services/password-security";

/**
 * Tahap AKHIR login yang berhasil (T17-MFA — dipakai bersama):
 *   /api/auth/login (1-langkah, tanpa MFA)  dan  /api/auth/mfa/verify (2-langkah).
 * Langkah: buildSessionInfo → auto-pilih workspace tunggal → lastLogin →
 * status umur sandi → cookie sesi (sessionVersion dibaca raw — pola T1).
 * Identitas harus SUDAH terverifikasi (password / password+kode TOTP) sebelum
 * memanggil fungsi ini — di sini TIDAK ada pengecekan kredensial apa pun.
 *
 * Task 78 (subdomain): bila login lewat <slug>.<base> → workspace otomatis
 * tenant host (bukan auto-pilih tunggal). Tiga kasus bila user bukan anggota:
 * a) punya workspace lain → cookie SAMA sekali tidak di-set, kirim host
 *    (403) agar UI mengarahkan ke alamat yang benar;
 * b) tidak punya workspace apa pun (baru daftar via subdomain, provisioning
 *    dijalankan sebagai anonim) → { noWorkspaces: true } (403, tanpa cookie);
 * c) host tidak dikenal/bukan subdomain → perilaku lama utuh.
 */
export async function finishLogin(userId: string, req?: NextRequest): Promise<NextResponse> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 500 });

  // ---- Task 78: auto-select workspace dari subdomain ----
  let tid: string | null = null;
  if (req) {
    const eff = await effectiveTenantIdOf(userId, null, req);
    if (eff.fromHost) {
      // Subdomain TIDAK terdaftar (parkiran/typo) → login DITOLAK: user tidak
      // boleh memakai workspace-nya di alamat semaangan (binding ketat).
      if (!eff.tenantId) {
        return NextResponse.json(
          { error: "Alamat workspace tidak dikenal. Masuk lewat alamat perusahaan Anda atau alamat utama." },
          { status: 404 },
        );
      }
      const member = await db.userTenant.findFirst({
        where: { userId, tenantId: eff.tenantId },
        select: { id: true },
      });
      if (member) {
        tid = eff.tenantId; // anggota → langsung konteks tenant host
      } else {
        const hasAny = (await db.userTenant.count({ where: { userId } })) > 0;
        if (hasAny) {
          const info = await buildSessionInfo(userId, null);
          return NextResponse.json(
            { ...(info ?? { user: { id: user.id, email: user.email, name: user.name, isSuperadmin: false }, workspaces: [] }), host: true, error: "Akun ini bukan anggota workspace alamat ini. Masuk lewat alamat workspace Anda." },
            { status: 403 },
          );
        }
        return NextResponse.json({ noWorkspaces: true, error: "Selesaikan pendaftaran workspace Anda di alamat ini." }, { status: 403 });
      }
    }
  }

  if (!tid) {
    // perilaku lama: bila user hanya punya 1 workspace aktif → langsung pilih
    const info = await buildSessionInfo(user.id, null);
    if (!info) return NextResponse.json({ error: "Sesi gagal dibangun" }, { status: 500 });
    tid = info.workspaces.length === 1 ? info.workspaces[0]!.id : null;
  }
  const finalInfo = tid ? (await buildSessionInfo(user.id, tid))! : (await buildSessionInfo(user.id, null))!;

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
  res.cookies.set(SESSION_COOKIE, freshSessionToken(user.id, tid, sv), req ? sessionCookieOptions(req) : sessionCookieOptions());
  return res;
}
