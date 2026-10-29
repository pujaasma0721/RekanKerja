// RekanKerja — Online Support P5: guard API khusus PEMILIK APLIKASI. ========
// =====================================================================
// FEAT-SUPPORT-P5: seluruh endpoint /api/rekankerja/platform/admin/* hanya
// boleh dipanggil oleh User.isSuperadmin (pemilik aplikasi) — BUKAN admin
// tenant. Ini beda fundamental dari guard lain di aplikasi:
//   · requireTenant / requireMenuAction → otorisasi DALAM tenant (membership)
//   · requirePlatformAdmin → otorisasi LINTAS tenant (pemilik aplikasi)
// Admin/OWNER tenant yang mencoba endpoint ini → 403 (mereka pelanggan —
// tidak punya urusan mengelola tenant lain maupun aktivasi layanan).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readVerifiedSession } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";

export interface PlatformAdminActor {
  userId: string;
  email: string;
  name: string;
}

/**
 * Validasi sesi sebagai pemilik aplikasi (User.isSuperadmin).
 * Return { ok: true, actor } atau { ok: false, res } siap kirim.
 * 401 bila tanpa sesi valid; 403 bila sesi valid tapi bukan pemilik aplikasi.
 */
export async function requirePlatformAdmin(
  req: NextRequest | Request,
): Promise<{ ok: true; actor: PlatformAdminActor } | { ok: false; res: NextResponse }> {
  let payload: Awaited<ReturnType<typeof readVerifiedSession>> = null;
  try {
    payload = await readVerifiedSession(req);
  } catch {
    payload = null;
  }
  if (!payload?.uid) {
    return { ok: false, res: NextResponse.json({ error: "Sesi tidak valid — masuk kembali" }, { status: 401 }) };
  }
  const user = await platformDb.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, email: true, name: true, isSuperadmin: true },
  });
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: "Sesi tidak valid — masuk kembali" }, { status: 401 }) };
  }
  if (user.isSuperadmin !== true) {
    return { ok: false, res: NextResponse.json({ error: "Halaman ini hanya untuk pemilik aplikasi (platform)" }, { status: 403 }) };
  }
  return { ok: true, actor: { userId: user.id, email: user.email, name: user.name } };
}
