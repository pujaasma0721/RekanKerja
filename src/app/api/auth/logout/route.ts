import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionCookie, bumpSessionVersion, sessionCookieOptions } from "@/rekankerja/shared/lib/auth";

// POST /api/auth/logout — hapus cookie session.
// T1-SECURITY — revokasi server-side: User.sessionVersion dinaikkan sehingga
// SEMUA token lama (cookie ini maupun salinannya di perangkat lain) ditolak
// readVerifiedSession → 401, bukan sekadar cookie dihapus client.
export async function POST(req: Request) {
  try {
    const payload = readSessionCookie(req);
    if (payload?.uid) {
      await bumpSessionVersion(payload.uid);
    }
  } catch {
    // kegagalan bump tidak menghalangi pembersihan cookie — token tetap invalid
    // begitu bump berhasil pada percobaan berikutnya; cookie tetap dihapus.
  }
  const res = NextResponse.json({ ok: true });
  // M-1: bersihkan cookie dengan opsi yang sama (Secure/SameSite konsisten
  // dgn sessionCookieOptions) — hanya maxAge: 0 yang menghapusnya.
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
