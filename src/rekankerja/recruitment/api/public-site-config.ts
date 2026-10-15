import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import { getSiteConfig } from "@/rekankerja/recruitment/services/recruitment-setting-service";

// ============================================================================
// RECRUITMENT B7 — PUBLIC: branding portal karier per tenant.
// GET /api/public/recruitment/site-config?t=<slug>
//   → { brandColor, logoUrl, heroTitle, heroSub, companyName }
// Row CareerSiteConfig absen → FALLBACK DEFAULT (200, TANPA 404); tenant tak
// dikenal pun tetap 200 + default + companyName null (portal merender tenang
// saat aplikasi utama hidup tapi tenant tak resolve). Rate-limit 60/mnt/IP.
// ============================================================================

export const runtime = "nodejs";

const LIST_IP_LIMIT = 60;
const LIST_IP_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  try {
    const rl = hitRateLimit(`site-config:ip:${clientIpOf(req)}`, LIST_IP_LIMIT, LIST_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), "cache-control": "no-store" } },
      );
    }

    // resolusi tenant: ?t= (WAJIB cocok — tak fallback diam-diam) → host →
    // default pertama aktif (konsisten /openings — portal selalu mengirim ?t=)
    const tParam = req.nextUrl.searchParams.get("t");
    let tenant: { slug: string; schemaName: string; name: string } | null = null;
    if (tParam) {
      const row = await platformDb.tenant.findUnique({
        where: { slug: tParam }, select: { slug: true, schemaName: true, name: true, status: true },
      });
      if (row?.status === "ACTIVE") tenant = row;
    }
    if (!tenant) {
      const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
      const byHost = await resolveTenantByHost(req).catch(() => null);
      if (byHost?.tenant) {
        const row = await platformDb.tenant.findUnique({
          where: { slug: byHost.tenant.slug }, select: { slug: true, schemaName: true, name: true, status: true },
        });
        if (row?.status === "ACTIVE") tenant = row;
      }
    }
    if (!tenant) {
      const active = await platformDb.tenant.findMany({
        where: { status: "ACTIVE" }, select: { slug: true, schemaName: true, name: true }, orderBy: { createdAt: "asc" },
      });
      if (active.length > 0) tenant = active[0]!;
    }

    if (!tenant) {
      return NextResponse.json(
        { brandColor: "#0f766e", logoUrl: null, heroTitle: null, heroSub: null, companyName: null },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const db = getTenantClient(tenant.schemaName);
    const cfg = await getSiteConfig(db, tenant.slug).catch(() => null);
    return NextResponse.json(
      {
        brandColor: cfg?.brandColor ?? "#0f766e",
        logoUrl: cfg?.logoUrl ?? null,
        heroTitle: cfg?.heroTitle ?? null,
        heroSub: cfg?.heroSub ?? null,
        companyName: tenant.name,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    // fallback tenang — portal merender default saat bermasalah
    return NextResponse.json(
      { brandColor: "#0f766e", logoUrl: null, heroTitle: null, heroSub: null, companyName: null },
      { headers: { "cache-control": "no-store" } },
    );
  }
}
