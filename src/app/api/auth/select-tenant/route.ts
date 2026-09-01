import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, freshSessionToken, sessionCookieOptions, buildSessionInfo, readSessionCookie,
} from "@/lib/onevity/auth";

// POST /api/auth/select-tenant { tenantId } — pilih workspace aktif untuk sesi ini
export async function POST(req: NextRequest) {
  try {
    const payload = readSessionCookie(req);
    if (!payload) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });

    const b = await req.json().catch(() => ({}));
    const tenantId = String(b.tenantId ?? "");
    if (!tenantId) return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });

    const membership = await db.userTenant.findFirst({
      where: { userId: payload.uid, tenantId },
      include: { tenant: { select: { status: true } } },
    });
    if (!membership || membership.tenant.status !== "ACTIVE") {
      return NextResponse.json({ error: "Anda bukan anggota workspace ini" }, { status: 403 });
    }

    const info = await buildSessionInfo(payload.uid, tenantId);
    if (!info) return NextResponse.json({ error: "Sesi tidak valid" }, { status: 401 });

    const res = NextResponse.json(info);
    res.cookies.set(SESSION_COOKIE, freshSessionToken(payload.uid, tenantId), sessionCookieOptions());
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
