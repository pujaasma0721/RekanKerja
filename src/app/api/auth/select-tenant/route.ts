import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE, effectiveTenantIdOf, freshSessionToken, sessionCookieOptions, buildSessionInfo, readVerifiedSession,
} from "@/onevity/shared/lib/auth";

// POST /api/auth/select-tenant { tenantId } — pilih workspace aktif untuk sesi ini
export async function POST(req: NextRequest) {
  try {
    // T1-SECURITY: sesi diverifikasi terhadap User.sessionVersion — token lama
    // (pasca-logout / ganti sandi) ditolak di sini juga.
    const payload = await readVerifiedSession(req);
    if (!payload) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });

    const b = await req.json().catch(() => ({}));
    let tenantId = String(b.tenantId ?? "");
    if (!tenantId) return NextResponse.json({ error: "tenantId wajib diisi" }, { status: 400 });

    // Task 78: di subdomain tenant, workspace terkunci ke host — percobaan
    // memilih workspace lain via API DITOLAK (403) walau user anggotanya.
    // Subdomain TIDAK terdaftar (parkiran/typo) → 404 alamat tak dikenal.
    const eff = await effectiveTenantIdOf(payload.uid, null, req);
    if (eff.fromHost) {
      if (!eff.tenantId) {
        return NextResponse.json({ error: "Alamat workspace tidak dikenal. Masuk lewat alamat perusahaan Anda atau alamat utama." }, { status: 404 });
      }
      if (tenantId !== eff.tenantId) {
        return NextResponse.json({ error: "Alamat ini khusus workspace lain" }, { status: 403 });
      }
      tenantId = eff.tenantId;
    }

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
    // Token baru mempertahankan sessionVersion yang sudah terverifikasi.
    res.cookies.set(SESSION_COOKIE, freshSessionToken(payload.uid, tenantId, payload.sv), sessionCookieOptions(req));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
