// OneVity MFA TOTP API (T17-MFA) ============================================
// ============================================================================
// Route handlers MFA (dipanggil lewat thin-route di src/app/api/auth/mfa/*):
//   • mfaStatus  GET  /api/auth/mfa/setup   → { enabled } (status utk kartu UI)
//   • mfaSetup   POST /api/auth/mfa/setup   → generate secret (terenkripsi at-rest),
//                simpan, kembalikan { secret, otpauthUrl, qrDataUrl } (QR server-side
//                pakai package `qrcode` — SATU-SATUNYA dependency eksternal MFA).
//   • mfaEnable  POST /api/auth/mfa/enable  { token }  → verifikasi kode → aktif.
//   • mfaDisable POST /api/auth/mfa/disable { password } → verifikasi sandi → reset.
//   • mfaVerify  POST /api/auth/mfa/verify  { mfaToken, token } → langkah-2 login:
//                kode benar → cookie sesi normal (reuse finishLogin).
// Login 2-langkah: /api/auth/login TIDAK men-set cookie bila user.totpEnabled —
// hanya mfaToken HMAC 5 menit (auth.ts signMfaToken/verifyMfaToken).
// Anti brute-force kode: hitungan gagal in-memory per uid (5× → 423 15 menit)
// + jeda kecil tiap kegagalan. State modul reset saat proses restart — pola
// sederhana sesuai scope (lockout DB permanen hanya bila dibutuhkan nanti).
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import {
  clearUserMfa, decryptTotpSecret, encryptTotpSecret, readUserMfa,
  readVerifiedSession, verifyMfaToken, verifyPassword, writeUserMfaEnabled, writeUserMfaSecret,
} from "@/onevity/shared/lib/auth";
import { generateSecret, otpauthUrl, verifyCode } from "@/onevity/shared/lib/totp";
import { finishLogin } from "@/onevity/shared/api/login-flow";

const TOTP_ISSUER = "OneVity";
const MFA_MAX_FAILED = 5; // percobaan kode salah sebelum kunci
const MFA_LOCK_MS = 15 * 60 * 1000; // 15 menit
const MFA_FAIL_DELAY_MS = 300; // jeda kecil tiap kegagalan (damping brute-force)

// ---- limiter percobaan salah (in-memory, per proses) ----
interface MfaAttempt { count: number; until: number }
const mfaAttempts = new Map<string, MfaAttempt>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Terkunci? (hitungan ≥ 5 dan masih dalam jendela kunci). */
function mfaLocked(uid: string): boolean {
  const a = mfaAttempts.get(uid);
  return !!a && a.count >= MFA_MAX_FAILED && Date.now() < a.until;
}

function recordMfaFail(uid: string): void {
  const a = mfaAttempts.get(uid);
  if (!a || Date.now() >= a.until) mfaAttempts.set(uid, { count: 1, until: Date.now() + MFA_LOCK_MS });
  else mfaAttempts.set(uid, { count: a.count + 1, until: a.until });
}

function resetMfaFails(uid: string): void {
  mfaAttempts.delete(uid);
}

/** Sisa percobaan sebelum kunci (utk pesan ramah). */
function mfaRemaining(uid: string): number {
  const a = mfaAttempts.get(uid);
  if (!a || Date.now() >= a.until) return MFA_MAX_FAILED;
  return Math.max(0, MFA_MAX_FAILED - a.count);
}

/** Ambil + dekripsi secret base32 user; null bila tidak ada/rusak. */
async function totpSecretOf(uid: string): Promise<string | null> {
  const mfa = await readUserMfa(uid);
  if (!mfa?.secret) return null;
  return decryptTotpSecret(mfa.secret);
}

// ============ GET /api/auth/mfa/setup — status ============

export async function mfaStatus(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload?.uid) return NextResponse.json({ error: "Sesi tidak valid — silakan masuk kembali." }, { status: 401 });
    const mfa = await readUserMfa(payload.uid);
    // secret tersimpan tapi belum aktif → setup menunggu verifikasi (UI tahu)
    return NextResponse.json({ enabled: mfa?.enabled === true, pending: !!(mfa?.secret) && !mfa?.enabled });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST /api/auth/mfa/setup — generate secret + QR ============

export async function mfaSetup(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload?.uid) return NextResponse.json({ error: "Sesi tidak valid — silakan masuk kembali." }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, email: true },
    });
    if (!user?.email) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });

    const mfa = await readUserMfa(user.id);
    if (mfa?.enabled) {
      return NextResponse.json(
        { error: "Autentikasi dua faktor sudah aktif — nonaktifkan terlebih dahulu bila ingin mengatur ulang." },
        { status: 400 },
      );
    }

    const secret = generateSecret(); // base32 32 char (160-bit)
    const ok = await writeUserMfaSecret(user.id, encryptTotpSecret(secret));
    if (!ok) return NextResponse.json({ error: "Gagal menyimpan secret MFA" }, { status: 500 });

    const url = otpauthUrl(secret, user.email, TOTP_ISSUER);
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    return NextResponse.json({ secret, otpauthUrl: url, qrDataUrl }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST /api/auth/mfa/enable { token } ============

export async function mfaEnable(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload?.uid) return NextResponse.json({ error: "Sesi tidak valid — silakan masuk kembali." }, { status: 401 });

    if (mfaLocked(payload.uid)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan kode verifikasi salah — coba lagi dalam 15 menit." },
        { status: 423 },
      );
    }

    const b = await req.json().catch(() => ({}));
    const token = String(b.token ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: "Kode verifikasi harus 6 digit angka." }, { status: 400 });
    }

    const mfa = await readUserMfa(payload.uid);
    if (mfa?.enabled) {
      return NextResponse.json({ error: "Autentikasi dua faktor sudah aktif." }, { status: 400 });
    }
    const secret = await totpSecretOf(payload.uid);
    if (!secret) {
      return NextResponse.json({ error: "Secret MFA belum disiapkan — mulai dari langkah setelan (QR)." }, { status: 400 });
    }

    if (!verifyCode(secret, token)) {
      recordMfaFail(payload.uid);
      await sleep(MFA_FAIL_DELAY_MS);
      const remaining = mfaRemaining(payload.uid);
      if (remaining === 0) {
        return NextResponse.json(
          { error: "Terlalu banyak percobaan kode verifikasi salah — coba lagi dalam 15 menit." },
          { status: 423 },
        );
      }
      return NextResponse.json(
        { error: remaining > 1 ? `Kode verifikasi salah (sisa ${remaining} percobaan).` : "Kode verifikasi salah." },
        { status: 401 },
      );
    }

    const ok = await writeUserMfaEnabled(payload.uid, true);
    if (!ok) return NextResponse.json({ error: "Gagal mengaktifkan MFA" }, { status: 500 });
    resetMfaFails(payload.uid);
    return NextResponse.json({ ok: true, message: "Autentikasi dua faktor aktif." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST /api/auth/mfa/disable { password } ============

export async function mfaDisable(req: NextRequest): Promise<NextResponse> {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload?.uid) return NextResponse.json({ error: "Sesi tidak valid — silakan masuk kembali." }, { status: 401 });

    const b = await req.json().catch(() => ({}));
    const password = String(b.password ?? "");
    if (!password) return NextResponse.json({ error: "Kata sandi wajib diisi untuk menonaktifkan MFA." }, { status: 400 });

    const user = await db.user.findUnique({ where: { id: payload.uid } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Kata sandi salah — MFA tidak dinonaktifkan." }, { status: 401 });
    }

    const ok = await clearUserMfa(payload.uid);
    if (!ok) return NextResponse.json({ error: "Gagal menonaktifkan MFA" }, { status: 500 });
    resetMfaFails(payload.uid);
    return NextResponse.json({ ok: true, message: "Autentikasi dua faktor dinonaktifkan — login kembali 1 langkah." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST /api/auth/mfa/verify { mfaToken, token } — langkah-2 login ============

export async function mfaVerify(req: NextRequest): Promise<NextResponse> {
  try {
    const b = await req.json().catch(() => ({}));
    const mfaToken = String(b.mfaToken ?? "");
    const token = String(b.token ?? "").replace(/\s+/g, "");

    if (!mfaToken) return NextResponse.json({ error: "Token verifikasi MFA wajib diisi." }, { status: 400 });
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: "Kode verifikasi harus 6 digit angka." }, { status: 400 });
    }

    const uid = verifyMfaToken(mfaToken);
    if (!uid) {
      // token palsu/kedaluwarsa (> 5 menit) — mulai dari login ulang
      return NextResponse.json(
        { error: "Sesi verifikasi kedaluwarsa atau tidak valid — silakan masuk kembali." },
        { status: 401 },
      );
    }

    if (mfaLocked(uid)) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan kode verifikasi salah — coba lagi dalam 15 menit." },
        { status: 423 },
      );
    }

    const mfa = await readUserMfa(uid);
    if (!mfa?.enabled) {
      // user menonaktifkan MFA di tengah jalan → suruh login normal 1-langkah
      return NextResponse.json({ error: "MFA tidak aktif pada akun ini — silakan masuk kembali." }, { status: 401 });
    }
    const secret = decryptTotpSecret(mfa.secret);
    if (!secret || !verifyCode(secret, token)) {
      recordMfaFail(uid);
      await sleep(MFA_FAIL_DELAY_MS);
      const remaining = mfaRemaining(uid);
      if (remaining === 0) {
        return NextResponse.json(
          { error: "Terlalu banyak percobaan kode verifikasi salah — coba lagi dalam 15 menit." },
          { status: 423 },
        );
      }
      return NextResponse.json(
        { error: remaining > 1 ? `Kode verifikasi salah (sisa ${remaining} percobaan).` : "Kode verifikasi salah." },
        { status: 401 },
      );
    }

    // kode benar → selesaikan login PERSIS seperti login 1-langkah (cookie + info)
    resetMfaFails(uid);
    return finishLogin(uid, req); // Task 78: req utk auto-select subdomain
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
