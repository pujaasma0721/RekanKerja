import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import { getPublicEsignInfo, submitPublicEsign } from "@/rekankerja/recruitment/services/recruitment-esign-service";

// ============================================================================
// RECRUITMENT F7 — PUBLIC e-sign kandidat (tanpa login; portal /sign/<token>).
//   GET  /api/public/recruitment/sign/<token>?t=<slug>
//        → info tanda tangan { status, purpose, signerName, letterNo, offerNo,
//          companyName, expiresAt } (TANPA email/PII lain). Rate-limit 30/mnt/IP.
//   POST /api/public/recruitment/sign/<token>?t=<slug>  { otp, typedName }
//        → submit tanda tangan (OTP 6 digit + nama persis). Rate-limit 5/10mnt/IP.
// Anti-enumeration: token tidak dikenal → 404 GENERIK (pesan sama dgn GET),
// tidak membocorkan ada/tidaknya permintaan.
// ============================================================================

const INFO_IP_LIMIT = 30;
const INFO_IP_WINDOW_MS = 60_000;
const SIGN_IP_LIMIT = 5;
const SIGN_IP_WINDOW_MS = 10 * 60_000;

const NOT_FOUND = "Tautan tanda tangan tidak valid atau kedaluwarsa";

function ipOf(req: NextRequest): string {
  return clientIpOf(req);
}

/** Resolusi tenant: ?t= → host → default-first (pola public-apply F2). */
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const rl = hitRateLimit(`esign-info:ip:${ipOf(req)}`, INFO_IP_LIMIT, INFO_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi nanti." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    const schema = await resolveSchema(req);
    if (!schema) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    const db = getTenantClient(schema);
    const info = await getPublicEsignInfo(db, token).catch(() => null);
    if (!info) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json(info);
  } catch {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const rl = hitRateLimit(`esign-sign:ip:${ipOf(req)}`, SIGN_IP_LIMIT, SIGN_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Silakan coba lagi nanti." }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    const schema = await resolveSchema(req);
    if (!schema) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    const db = getTenantClient(schema);

    const b = await req.json().catch(() => ({}));
    const otp = String((b as { otp?: unknown }).otp ?? "").trim();
    const typedName = String((b as { typedName?: unknown }).typedName ?? "").trim();
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "Kode OTP salah atau kedaluwarsa" }, { status: 400 });
    }
    if (!typedName) {
      return NextResponse.json({ error: "Nama wajib diketik sesuai nama pada surat" }, { status: 400 });
    }

    try {
      const res = await submitPublicEsign(db, { token, otp, typedName, ip: ipOf(req) });
      return NextResponse.json(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      // token tidak dikenal → 404 generik (anti-enumeration); salah lain 400
      if (msg.includes("tidak valid atau kedaluwarsa")) {
        return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
      }
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }
}
