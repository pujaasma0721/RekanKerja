import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { clientIpOf } from "@/rekankerja/recruitment/services/public-recruitment-service";
import {
  requestStatusLink, StatusLinkRateLimitError,
} from "@/rekankerja/recruitment/services/status-link-service";

// ============================================================================
// RECRUITMENT B7 — PUBLIC: minta tautan cek status lamaran (magic-link tanpa
// password). POST /api/public/recruitment/status-link?t=<slug>  JSON:
//   { email, website? }   — website = HONEYPOT (terisi = bot → respons SAMA)
// Anti-enumerasi (§5): respons { ok:true } SELALU IDENTIK untuk email ada /
// tidak — email terkirim hanya bila pelamar terdaftar. 429 rate-limit dicek
// SEBELUM lookup (3/jam per email + 10/jam per IP, per tenant schema); 400
// hanya untuk format email salah. NO-STORE.
// ============================================================================

export const runtime = "nodejs";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    // ---- resolusi tenant (?t= → subdomain → default 1 aktif; pola apply F2) ----
    let schemaName: string | null = null;
    const tParam = req.nextUrl.searchParams.get("t");
    const bySlug = tParam ? await platformDb.tenant.findUnique({ where: { slug: tParam }, select: { schemaName: true, status: true } }) : null;
    if (bySlug?.status === "ACTIVE") schemaName = bySlug.schemaName;
    if (!schemaName) {
      const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
      const byHost = await resolveTenantByHost(req).catch(() => null);
      if (byHost?.tenant) {
        const row = await platformDb.tenant.findUnique({ where: { slug: byHost.tenant.slug }, select: { schemaName: true, status: true } });
        if (row?.status === "ACTIVE") schemaName = row.schemaName;
      }
    }
    if (!schemaName) {
      const active = await platformDb.tenant.findMany({ where: { status: "ACTIVE" }, select: { schemaName: true }, orderBy: { createdAt: "asc" } });
      if (active.length > 0) schemaName = active[0]!.schemaName;
    }
    if (!schemaName) {
      return bad("Perusahaan tidak ditemukan. Pilih perusahaan pada halaman karier.", 404);
    }

    // ---- parsing body (JSON ringan — bukan multipart) ----
    const b = (await req.json().catch(() => ({}))) as { email?: unknown; website?: unknown };
    const email = String(b.email ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return bad("Email valid wajib diisi");
    }
    // honeypot terisi = bot → respons NETRAL sama (tidak kirim email, tidak
    // pakai kuota rate-limit manusia)
    if (String(b.website ?? "").trim().length > 0) {
      return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    }

    // ---- minta link (rate-limit dicek DI AWAL di dalam service) ----
    const db = getTenantClient(schemaName);
    try {
      await requestStatusLink(db, { email, ip: clientIpOf(req) });
    } catch (e) {
      if (e instanceof StatusLinkRateLimitError) {
        return NextResponse.json(
          { error: e.message },
          { status: 429, headers: { "Retry-After": String(e.retryAfterSec), "cache-control": "no-store" } },
        );
      }
      throw e;
    }
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    // kegagalan tak terduga pun TIDAK membocorkan ada/tidaknya email —
    // balas netral sama seperti sukses
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  }
}
