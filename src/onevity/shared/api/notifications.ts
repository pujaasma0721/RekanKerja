// GET /api/onevity/notifications — pusat notifikasi UMUM non-ESS (T11-NOTIF).
// =====================================================================
// Kontrak admin shell bell: 20 notifikasi terbaru + jumlah belum dibaca utk
// AppUser yang cocok dgn email sesi login (aktif). User platform tanpa
// AppUser tenant → feed kosong (200) supaya bell UI tetap elegan, bukan error.
import { NextResponse } from "next/server";
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";

export type AppUserResolution =
  | { ok: true; db: TenantDb; appUserId: string | null }
  | { ok: false; status: number; error: string };

/** Resolusi AppUser aktif dari sesi (email match — pola requireMutator).
 *  appUserId null bila user login tidak punya AppUser di tenant (bukan error). */
export async function requireAppUser(req: Request): Promise<AppUserResolution> {
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: {
      user: { select: { email: true } },
      tenant: { select: { schemaName: true, status: true } },
    },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") {
    return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  }

  const db = getTenantClient(membership.tenant.schemaName);
  try {
    const appUser = membership.user.email
      ? await db.appUser.findFirst({
          where: { email: membership.user.email, active: true },
          select: { id: true },
        })
      : null;
    return { ok: true, db, appUserId: appUser?.id ?? null };
  } catch {
    // schema legacy tanpa tabel AppUser — feed kosong
    return { ok: true, db, appUserId: null };
  }
}

export async function GET(req: Request) {
  const m = await requireAppUser(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

  try {
    if (!m.appUserId) return NextResponse.json({ items: [], unread: 0 });
    const [items, unread] = await Promise.all([
      m.db.notification.findMany({
        where: { appUserId: m.appUserId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, title: true, body: true, kind: true, link: true, readAt: true, createdAt: true },
      }),
      m.db.notification.count({ where: { appUserId: m.appUserId, readAt: null } }),
    ]);
    return NextResponse.json({ items, unread });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
