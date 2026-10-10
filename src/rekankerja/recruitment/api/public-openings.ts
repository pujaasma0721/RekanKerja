import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { listPublicOpenings } from "@/rekankerja/recruitment/services/public-recruitment-service";

// ============================================================================
// RECRUITMENT F2 — PUBLIC: daftar slot lowongan Posted (tanpa login).
// GET /api/public/recruitment/openings?t=slug&limit=50
//   → { tenant: { slug, companyName } | null, tenants?: [...], openings: [...] }
// Tenant: ?t=slug → subdomain host → fallback: bila HANYA 1 tenant ACTIVE
// pakai itu; bila banyak → daftar tenant utk picker di portal (sandbox preview
// tanpa subdomain). Tidak ada PII/data internal — hanya iklan publik.
// Rate limit 60/menit/IP (pola esign-verify — jalur fallback scan mahal).
// ============================================================================

export const runtime = "nodejs";

const LIST_IP_LIMIT = 60;
const LIST_IP_WINDOW_MS = 60 * 1000;

interface TenantLite { slug: string; schemaName: string; name: string }

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rl = hitRateLimit(`recruitment-openings:ip:${ip}`, LIST_IP_LIMIT, LIST_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }

    // resolusi tenant: ?t= → subdomain → jumlah tenant aktif
    let tenant: TenantLite | null = null;
    const tParam = req.nextUrl.searchParams.get("t");
    if (tParam) {
      const row = await platformDb.tenant.findUnique({
        where: { slug: tParam }, select: { slug: true, schemaName: true, name: true },
      });
      if (row && (await platformDb.tenant.findUnique({ where: { slug: tParam }, select: { status: true } }))?.status === "ACTIVE") tenant = row;
    }
    if (!tenant) {
      const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
      const byHost = await resolveTenantByHost(req).catch(() => null);
      if (byHost?.tenant) {
        tenant = await platformDb.tenant.findUnique({ where: { slug: byHost.tenant.slug }, select: { slug: true, schemaName: true, name: true } });
      }
    }
    let tenants: TenantLite[] | null = null;
    if (!tenant) {
      const active = await platformDb.tenant.findMany({
        where: { status: "ACTIVE" }, select: { slug: true, schemaName: true, name: true }, orderBy: { createdAt: "asc" },
      });
      if (active.length === 1) tenant = active[0]!;
      else if (active.length > 1) {
        tenants = active;
        tenant = active[0]!; // default pertama + picker di UI
      }
    }
    if (!tenant) {
      return NextResponse.json({ tenant: null, tenants: [], openings: [] });
    }

    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
    const db = getTenantClient(tenant.schemaName);
    const openings = await listPublicOpenings(db, Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({
      tenant: { slug: tenant.slug, companyName: tenant.name },
      ...(tenants ? { tenants: tenants.map((t) => ({ slug: t.slug, companyName: t.name })) } : {}),
      openings,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
