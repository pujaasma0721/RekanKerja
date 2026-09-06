import { NextResponse } from "next/server";
import { SESSION_COOKIE, readSessionCookie, bumpSessionVersion } from "@/onevity/shared/lib/auth";

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
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
