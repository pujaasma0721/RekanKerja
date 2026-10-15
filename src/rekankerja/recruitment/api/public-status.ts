import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import { verifyStatusToken, StatusLinkTokenError } from "@/rekankerja/recruitment/services/status-link-service";

// ============================================================================
// RECRUITMENT B7 — PUBLIC: buka status lamaran via token magic-link.
// GET /api/public/recruitment/status?token=<exp>.<hmac>&t=<slug>
//   → 200 payload status pelamar (TANPA data internal sensitif) ATAU
//     410 (kedaluwarsa / sudah dipakai — pesan netral sama) /
//     400 (format token rusak). Resolusi tenant pola public-sign (?t= salah →
//     404 netral). Rate-limit 30/menit/IP (pola esign-info). NO-STORE.
// ============================================================================

export const runtime = "nodejs";

const STATUS_IP_LIMIT = 30;
const STATUS_IP_WINDOW_MS = 60_000;

const NEUTRAL_404 = "Tautan tidak valid atau tidak dikenali";

/** Resolusi tenant: ?t= → host → default-first (pola public-sign F7). */
async function resolveSchema(req: NextRequest): Promise<string | null> {
  const tParam = req.nextUrl.searchParams.get("t");
  const bySlug = tParam
    ? await platformDb.tenant.findUnique({ where: { slug: tParam }, select: { schemaName: true, status: true } }).catch(() => null)
    : null;
  if (bySlug?.status === "ACTIVE") return bySlug.schemaName;
  if (tParam) return null; // slug eksplisit salah → jangan fallback diam-diam

  const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
  const byHost = await resolveTenantByHost(req).catch(() => null);
  if (byHost?.tenant) {
    const row = await platformDb.tenant.findUnique({ where: { slug: byHost.tenant.slug }, select: { schemaName: true, status: true } }).catch(() => null);
    if (row?.status === "ACTIVE") return row.schemaName;
  }
  const active = await platformDb.tenant.findMany({
    where: { status: "ACTIVE" },
    select: { schemaName: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  }).catch(() => []);
  return active[0]?.schemaName ?? null;
}

export async function GET(req: NextRequest) {
  const noStore = { "cache-control": "no-store" };
  try {
    const rl = hitRateLimit(`status-view:ip:${clientIpOf(req)}`, STATUS_IP_LIMIT, STATUS_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), ...noStore } },
      );
    }
    const token = (req.nextUrl.searchParams.get("token") ?? "").trim();
    if (!token) return NextResponse.json({ error: NEUTRAL_404 }, { status: 400, headers: noStore });

    const schema = await resolveSchema(req);
    if (!schema) return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const db = getTenantClient(schema);
    try {
      const payload = await verifyStatusToken(db, token);
      return NextResponse.json(payload, { headers: noStore });
    } catch (e) {
      if (e instanceof StatusLinkTokenError) {
        return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });
  }
}
