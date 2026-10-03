import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";
import { readVerifiedSession, effectiveTenantIdOf } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// Task 100 F1 (G17, impl-E) — token QR kios presensi (ADMIN-side generator).
// =====================================================================
// GET /api/rekankerja/attendance/kiosk-token
// Guard VIEW menu attendance:liveboard (papan kehadiran — menu operasional
// kios). Mengembalikan payload QR yang ditampilkan kios fisik:
//   { payload: "ovqr:{schemaName}:{token}", expiresAt }
// token = base64url(HMAC_SHA256(secret, `ovqr|{schemaName}|{bucket}`)) —
// LOGIKA PERSIS validator ess/api/clock.ts G17 (disalin ke file ini, TIDAK
// diimpor dari ess — file ess milik agen paralel dan clock.ts tidak
// mengekspor helper-nya; token TIDAK BOLEH dihitung client karena
// secret = sha256(SESSION_SECRET + "|" + schemaName)).
// bucket = floor(epochSec / 30) — berputar tiap 30 detik; validator ESS
// menerima bucket sekarang ±1 (skew jam kios).
const BUCKET_SEC = 30;

/** Secret QR per tenant: sha256(SESSION_SECRET + "|" + schemaName) — hex. */
function qrSecretHex(schemaName: string): string {
  return createHash("sha256").update(`${process.env.SESSION_SECRET ?? ""}|${schemaName}`).digest("hex");
}

export async function GET(req: NextRequest) {
  try {
    // guard menu (VIEW papan kehadiran) — sesi admin wajib; kios adalah mode
    // tampilan DALAM sesi admin, bukan halaman publik.
    const m = await requireMenuViewAny(req, ["attendance:liveboard"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    if (!process.env.SESSION_SECRET) {
      return NextResponse.json(
        { error: "SESSION_SECRET belum dikonfigurasi — token QR kios tidak bisa dihitung" },
        { status: 500 },
      );
    }

    // resolve schemaName tenant efektif sesi (pola tenant-db: subdomain host
    // boleh memaksa konteks tenant lain — effectiveTenantIdOf).
    const payload = await readVerifiedSession(req);
    if (!payload?.uid || !payload.tid) {
      return NextResponse.json({ error: "Sesi tidak valid atau berakhir — silakan masuk kembali." }, { status: 401 });
    }
    const { tenantId } = await effectiveTenantIdOf(payload.uid, payload.tid, req);
    if (!tenantId) {
      return NextResponse.json({ error: "Sesi tidak valid atau berakhir — silakan masuk kembali." }, { status: 401 });
    }
    const tenant = await platformDb.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true, status: true },
    });
    if (!tenant || tenant.status !== "ACTIVE") {
      return NextResponse.json({ error: "Workspace tidak ditemukan / tidak aktif" }, { status: 403 });
    }

    const bucket = Math.floor(Date.now() / 1000 / BUCKET_SEC);
    const token = createHmac("sha256", qrSecretHex(tenant.schemaName))
      .update(`ovqr|${tenant.schemaName}|${bucket}`)
      .digest()
      .toString("base64url");

    return NextResponse.json(
      {
        payload: `ovqr:${tenant.schemaName}:${token}`,
        expiresAt: new Date((bucket + 1) * BUCKET_SEC * 1000).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
