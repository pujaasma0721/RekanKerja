import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import {
  offerSelfServiceSummary, respondOfferSelfService,
  OfferSelfServiceError, OfferConflictError,
} from "@/rekankerja/recruitment/services/offer-service";

// ============================================================================
// RECRUITMENT P2.4-BM (D-BM19) — PUBLIC: putusan offer mandiri kandidat
// (tanpa login; portal /offer/<token>?t=<slug>).
//   GET  /api/public/recruitment/offer-respond?token=<hex>&t=<slug>
//        → ringkasan offer { offerNo, position, company, startDate, expiryDate,
//          status } — TANPA nominal gaji (kebijakan halaman status: surat resmi
//          via email). NO-STORE. Rate-limit 10/menit/IP.
//   POST /api/public/recruitment/offer-respond  { token, action: accept|decline,
//        note?, t? } → 200 { ok, offerNo, status } | 409 (sudah diputuskan /
//        race double-click) | 410 (token kedaluwarsa) | 404 (token tak dikenal —
//        netral anti-enumerasi lintas tenant). Rate-limit 10/menit/IP.
// ============================================================================

export const runtime = "nodejs";

const GET_IP_LIMIT = 10;
const POST_IP_LIMIT = 10;
const IP_WINDOW_MS = 60_000;

const NEUTRAL_404 = "Tautan putusan offer tidak valid atau tidak dikenali";

/** Resolusi tenant: ?t= → host → default-first (pola public-sign F7). */
async function resolveSchema(req: NextRequest, tParam: string | null): Promise<string | null> {
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
    const rl = hitRateLimit(`offer-respond-get:ip:${clientIpOf(req)}`, GET_IP_LIMIT, IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), ...noStore } },
      );
    }
    const token = (req.nextUrl.searchParams.get("token") ?? "").trim();
    if (!token || !/^[a-f0-9]{16,128}$/i.test(token)) {
      return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });
    }
    const schema = await resolveSchema(req, req.nextUrl.searchParams.get("t"));
    if (!schema) return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const db = getTenantClient(schema);
    try {
      const summary = await offerSelfServiceSummary(db, { token });
      return NextResponse.json(summary, { headers: noStore });
    } catch (e) {
      if (e instanceof OfferSelfServiceError) {
        return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });
  }
}

export async function POST(req: NextRequest) {
  const noStore = { "cache-control": "no-store" };
  try {
    const rl = hitRateLimit(`offer-respond-post:ip:${clientIpOf(req)}`, POST_IP_LIMIT, IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), ...noStore } },
      );
    }
    const b = await req.json().catch(() => ({}));
    const token = String((b as { token?: unknown }).token ?? "").trim();
    const action = String((b as { action?: unknown }).action ?? "").trim();
    const note = (b as { note?: unknown }).note != null ? String((b as { note?: unknown }).note) : null;
    if (!token || !/^[a-f0-9]{16,128}$/i.test(token)) {
      return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });
    }
    if (action !== "accept" && action !== "decline") {
      return NextResponse.json(
        { error: "Aksi tidak dikenal — gunakan accept atau decline" },
        { status: 400, headers: noStore },
      );
    }
    const schema = await resolveSchema(req, (b as { t?: unknown }).t ? String((b as { t?: unknown }).t) : req.nextUrl.searchParams.get("t"));
    if (!schema) return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const db = getTenantClient(schema);
    try {
      const res = await respondOfferSelfService(db, { token, action, note });
      return NextResponse.json({ ok: true, offerNo: res.offerNo, status: res.status }, { headers: noStore });
    } catch (e) {
      if (e instanceof OfferSelfServiceError) {
        return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
      }
      if (e instanceof OfferConflictError) {
        return NextResponse.json(
          { error: "Offer sudah diputuskan — keputusan hanya bisa dilakukan satu kali" },
          { status: 409, headers: noStore },
        );
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ error: NEUTRAL_404 }, { status: 404, headers: noStore });
  }
}
