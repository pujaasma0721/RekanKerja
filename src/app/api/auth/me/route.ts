import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE, buildSessionInfo, currentSessionVersion, effectiveTenantIdOf, freshSessionToken,
  idleTimeoutOfSession, readVerifiedSession, sessionCookieOptions, SESSION_MAX_AGE,
} from "@/rekankerja/shared/lib/auth";
import { passwordStatusOfSession } from "@/rekankerja/shared/services/password-security";

// GET /api/auth/me — session saat ini (user + tenant terpilih + daftar workspace)
// Task 33: + status umur kata sandi (best-effort) utk toast peringatan shell.
// T1-SECURITY: readVerifiedSession — token dicek terhadap User.sessionVersion
// (logout menaikkan versi → me langsung 401, bukan hanya cookie dihapus).
// Task 64k (sliding refresh): bila sisa umur token < 50% (mis. login 7 hari
// lalu), terbitkan token SEGAR dgn exp baru + set cookie ulang — pengguna yang
// aktif terus tidak lagi ter-logout kaku di hari ke-7. Refresh hanya pada
// permintaan BERHASIL (token sah) — token invalid tetap 401.
const REFRESH_THRESHOLD_MS = (SESSION_MAX_AGE / 2) * 1000;

export async function GET(req: NextRequest) {
  try {
    const payload = await readVerifiedSession(req);
    if (!payload) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
    // Task 78: subdomain tenant memaksa konteks tenant host.
    const { tenantId } = await effectiveTenantIdOf(payload.uid, payload.tid, req);
    const info = await buildSessionInfo(payload.uid, tenantId);
    if (!info) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });
    const pwStatus = info.user.email
      ? await passwordStatusOfSession(payload.uid, payload.tid, info.user.email)
      : null;
    // Task 64k — kirim batas idle workspace aktif utk timer sesi client.
    const idleTimeoutMinutes = await idleTimeoutOfSession(payload.uid, payload.tid);

    const res = NextResponse.json({ ...info, ...(pwStatus ? { password: pwStatus } : {}), ...(idleTimeoutMinutes != null ? { idleTimeoutMinutes } : {}) });

    // ---- sliding refresh (Task 64k) ----
    if (payload.exp - Date.now() < REFRESH_THRESHOLD_MS) {
      const sv = await currentSessionVersion(payload.uid);
      res.cookies.set(SESSION_COOKIE, freshSessionToken(payload.uid, payload.tid, sv), sessionCookieOptions(req));
    }
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
