// RekanKerja — Online Support P5: admin provider AI support (platform). =====
// =====================================================================
// GET  /api/rekankerja/platform/admin/support-provider — konfigurasi provider
//      (bentuk aman — apiKey tidak pernah keluar server, hanya hasApiKey).
// PUT  /api/rekankerja/platform/admin/support-provider — simpan konfigurasi
//      { provider, baseUrl?, model?, apiKey? (write-only), enabled,
//        priceInPerM?, priceOutPerM? } — apiKey TERENKRIPSI platform-crypto.
// POST /api/rekankerja/platform/admin/support-provider — uji koneksi (satu
//      completion kecil via aiCompleteSupport).
// Semua diguard requirePlatformAdmin (pemilik aplikasi — BUKAN admin tenant).
import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { requirePlatformAdmin } from "@/rekankerja/platform/api/platform-admin-auth";
import {
  getSupportProviderPublic, invalidateSupportProviderCache, testSupportProvider,
} from "@/rekankerja/support/services/support-provider";
import { encryptPlatformSecret, decryptPlatformSecret } from "@/rekankerja/shared/lib/platform-crypto";

export async function GET(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;
    return NextResponse.json({ provider: await getSupportProviderPublic() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = b.provider === "openai" ? "openai" : "builtin";
    const enabled = b.enabled !== false;
    const baseUrl = typeof b.baseUrl === "string" && b.baseUrl.trim() ? b.baseUrl.trim().slice(0, 300) : null;
    const model = typeof b.model === "string" && b.model.trim() ? b.model.trim().slice(0, 120) : null;
    const priceInPerM = Math.max(0, Number(b.priceInPerM) || 0);
    const priceOutPerM = Math.max(0, Number(b.priceOutPerM) || 0);

    if (provider === "openai" && (!baseUrl || !model)) {
      return NextResponse.json({ error: "Provider OpenAI-compatible membutuhkan Base URL dan Model" }, { status: 400 });
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ error: "Base URL harus diawali http:// atau https://" }, { status: 400 });
    }

    // API key: string kosong "" → hapus; undefined/null → pertahankan yang lama.
    let apiKeyEnc: string | null | undefined;
    if (typeof b.apiKey === "string") {
      const key = b.apiKey.trim();
      apiKeyEnc = key.length === 0 ? null : encryptPlatformSecret(key);
    } else {
      const cur = await platformDb.supportProviderConfig.findFirst({ select: { apiKey: true } });
      apiKeyEnc = cur?.apiKey ?? null;
      // validasi kebolehbacaan key lama (bisa rusak pasca-rotasi SESSION_SECRET)
      if (apiKeyEnc && decryptPlatformSecret(apiKeyEnc) == null) {
        apiKeyEnc = null;
      }
    }

    const row = await platformDb.supportProviderConfig.upsert({
      where: { id: (await platformDb.supportProviderConfig.findFirst({ select: { id: true } }))?.id ?? "_" },
      create: { provider, baseUrl, model, enabled, priceInPerM, priceOutPerM, apiKey: apiKeyEnc ?? null },
      update: { provider, baseUrl, model, enabled, priceInPerM, priceOutPerM, apiKey: apiKeyEnc ?? null },
    });
    invalidateSupportProviderCache();

    console.log(
      `[platform-admin] ${g.actor.email} menyimpan provider AI support: ${provider}${provider === "openai" ? ` (${baseUrl} · ${model})` : ""} — enabled=${enabled}`,
    );
    return NextResponse.json({ ok: true, updatedAt: row.updatedAt.toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;
    const r = await testSupportProvider();
    return NextResponse.json({ ok: r.ok, reply: r.reply, provider: r.provider });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
