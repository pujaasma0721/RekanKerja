// RekanKerja — Online Support P5: guard API khusus PEMILIK APLIKASI. ========
// =====================================================================
// FEAT-SUPPORT-P5-SEC (pemisahan realm, respons audit keamanan): guard ini
// kini MANDIRI dari realm tenant —
//   · Identitas: tabel PlatformAdmin di PUBLIC schema (bukan User platform
//     yang kebetulan member tenant, bukan AppUser tenant). Pemilik aplikasi
//     tidak perlu menjadi anggota tenant mana pun.
//   · Sesi: cookie realm platform (rk_platform_admin) yang ditandatangani
//     kunci BERBEDA dan path-scoped /api/rekankerja/platform/** — sesi
//     tenant (rekankerja_session) TIDAK PERNAH diterima di sini, WALAUPUN
//     user-nya ber-flag isSuperadmin. Satu arah saja: kredensial PlatformAdmin
//     + sesi platform.
// Dengan demikian: akun tenant yang dikompromikan tidak bisa mencapai API
// platform; cookie platform yang dicuri tidak membuka akses tenant.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readPlatformSessionCookie } from "@/rekankerja/shared/lib/platform-session";
import { db as platformDb } from "@/lib/db";

export interface PlatformAdminActor {
  adminId: string;
  email: string;
  name: string;
}

/**
 * Validasi sesi REALM PLATFORM ADMIN (cookie rk_platform_admin + cocokkan
 * sessionVersion di DB — pola T1-SECURITY). TIDAK ada fallback ke sesi tenant.
 * Return { ok: true, actor } atau { ok: false, res } siap kirim.
 */
export async function requirePlatformAdmin(
  req: NextRequest | Request,
): Promise<{ ok: true; actor: PlatformAdminActor } | { ok: false; res: NextResponse }> {
  const payload = readPlatformSessionCookie(req);
  if (!payload) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Masuk dulu sebagai pemilik aplikasi (konsol platform)", code: "PLATFORM_LOGIN_REQUIRED" },
        { status: 401 },
      ),
    };
  }
  // Baca via $queryRaw agar tetap bekerja saat cache Prisma client lama
  // (pola readVerifiedSession auth.ts).
  let row: { id: string; email: string; name: string; active: boolean; sessionVersion: number } | null = null;
  try {
    const rows = await platformDb.$queryRaw<Array<{ id: string; email: string; name: string; active: boolean; sessionVersion: number }>>`
      SELECT id, email, name, active, "sessionVersion" FROM "PlatformAdmin" WHERE id = ${payload.aid} LIMIT 1`;
    row = rows[0] ?? null;
  } catch {
    row = null;
  }
  if (!row || row.active !== true || Number(row.sessionVersion) !== payload.sv) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "Sesi platform tidak sah — masuk kembali", code: "PLATFORM_LOGIN_REQUIRED" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, actor: { adminId: row.id, email: row.email, name: row.name } };
}
