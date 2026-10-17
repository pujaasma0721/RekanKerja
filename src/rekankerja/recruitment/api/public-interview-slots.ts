import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import { getPublicSlotInfo, bookSlotByToken, SlotBookingError } from "@/rekankerja/recruitment/services/selection-service";

// ============================================================================
// RECRUITMENT P2.3 (D-BM18) — PUBLIC: kandidat memilih slot jadwal wawancara
// via token undangan (hash SHA-256 di CandidateSelectionStep).
//   GET  /api/public/recruitment/interview-slots?token=<hex>&t=<slug>
//        → 200 {ok:true, position, companyName, tahap, slots:[{id,startAt,
//               durationMin,status}]} — TANPA nama evaluator / PII kandidat.
//        → 404/410 {ok:false, error:"notfound"} (netral — token salah/expired
//               tidak dibedakan supaya tidak bisa di-probe), 429 rate-limit.
//   POST {token, slotId, t?} → 200 {ok:true, startAt} | 409 {error:"taken"}
//        | 410 {error:"expired"} | 404 {error:"notfound"} | 429.
// Resolusi tenant pola public-status (?t= → host → default-first; slug salah
// → 404 netral). Rate-limit 10/menit/IP per method. Cache-control no-store.
// ============================================================================

export const runtime = "nodejs";

const SLOT_IP_LIMIT = 10;
const SLOT_IP_WINDOW_MS = 60_000;
const NEUTRAL_404 = "notfound";

/** Resolusi tenant: ?t= → host → default-first (pola public-status). */
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
    const rl = hitRateLimit(`slot-view:ip:${clientIpOf(req)}`, SLOT_IP_LIMIT, SLOT_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), ...noStore } },
      );
    }
    const token = (req.nextUrl.searchParams.get("token") ?? "").trim();
    if (!token) return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const schema = await resolveSchema(req, req.nextUrl.searchParams.get("t"));
    if (!schema) return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const db = getTenantClient(schema);
    const info = await getPublicSlotInfo(db, token);
    if (info === null) return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });
    if (info === "expired") return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 410, headers: noStore });
    return NextResponse.json(info, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });
  }
}

export async function POST(req: NextRequest) {
  const noStore = { "cache-control": "no-store" };
  try {
    const rl = hitRateLimit(`slot-book:ip:${clientIpOf(req)}`, SLOT_IP_LIMIT, SLOT_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Terlalu banyak permintaan. Coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), ...noStore } },
      );
    }
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const token = String(b.token ?? "").trim();
    const slotId = String(b.slotId ?? "").trim();
    if (!token || !slotId) {
      return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });
    }

    // tenant: body.t (portal POST JSON) → query ?t (fallback) → host
    const schema = await resolveSchema(req, b.t != null && b.t !== "" ? String(b.t) : req.nextUrl.searchParams.get("t"));
    if (!schema) return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });

    const db = getTenantClient(schema);
    try {
      const res = await bookSlotByToken(db, { token, slotId });
      return NextResponse.json({ ok: true, startAt: res.startAt }, { headers: noStore });
    } catch (e) {
      if (e instanceof SlotBookingError) {
        return NextResponse.json({ ok: false, error: e.code }, { status: e.status, headers: noStore });
      }
      throw e;
    }
  } catch {
    return NextResponse.json({ ok: false, error: NEUTRAL_404 }, { status: 404, headers: noStore });
  }
}
