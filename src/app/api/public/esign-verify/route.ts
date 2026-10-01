import { NextRequest, NextResponse } from "next/server";
import { verifySignature } from "@/rekankerja/shared/services/esign-service";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { db as platformDb } from "@/lib/db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";

// ============ E-SIGN VERIFIKASI PUBLIK (Task 80) ============================
// GET /api/public/esign-verify?id=…[&t=slug]
// Halaman /v/[id] memanggil ini tanpa login. Hanya MEMBUKTIKAN keabsahan
// tanda tangan + metadata penandatangan — TIDAK membuka isi dokumen.
// Tenant di-resolve dari ?t=slug, fallback subdomain host (Task 78).
// Task 82-T14: rate limit per IP — jalur fallback scan semua tenant membuat
// endpoint ini relatif mahal (query per schema); tanpa limit ia bisa dipakai
// utk hammering/enumeration. 30 req/menit/IP cukup utk verifikasi wajar.
// ============================================================================

export const runtime = "nodejs";

const VERIFY_IP_LIMIT = 30;
const VERIFY_IP_WINDOW_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = hitRateLimit(`esign-verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan verifikasi. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    // tenant: ?t=slug → subdomain → tidak ditemukan lewat SignatureRecord saja
    let tenant = null as { slug: string; schemaName: string } | null;
    const tParam = req.nextUrl.searchParams.get("t");
    if (tParam) {
      tenant = await platformDb.tenant.findUnique({ where: { slug: tParam }, select: { slug: true, schemaName: true } });
    }
    if (!tenant) {
      const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
      const byHost = await resolveTenantByHost(req).catch(() => null);
      if (byHost?.tenant) {
        // TenantHostRecord tak membawa schemaName — resolve ulang via registry
        const row = await platformDb.tenant.findUnique({ where: { slug: byHost.tenant.slug }, select: { slug: true, schemaName: true } });
        if (row) tenant = row;
      }
    }
    if (!tenant) {
      // terakhir: cari record di semua tenant ACTIVE (QR bisa dicetak di PDF
      // yang dibuka dari mana saja — tetap harus bisa diverifikasi)
      const tenants = await platformDb.tenant.findMany({
        where: { status: "ACTIVE" }, select: { slug: true, schemaName: true },
      });
      for (const tn of tenants) {
        const db = getTenantClient(tn.schemaName);
        const hit = await db.signatureRecord.findUnique({ where: { id }, select: { id: true } }).catch(() => null);
        if (hit) { tenant = tn; break; }
      }
    }
    if (!tenant) return NextResponse.json({ error: "Tanda tangan tidak ditemukan" }, { status: 404 });

    const db = getTenantClient(tenant.schemaName);
    const r = await verifySignature(db, tenant.slug, id);
    if (!r.found) return NextResponse.json({ error: "Tanda tangan tidak ditemukan" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
