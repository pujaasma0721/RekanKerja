import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { getProviderPublic, testProvider } from "@/rekankerja/shared/services/ai-provider";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

// ============ KONFIGURASI PROVIDER AI (Task 96 — admin) =============
//   GET  ?action=test → tes koneksi (butuh update-perm provider)
//   GET              → konfigurasi saat ini (apiKey TIDAK ikut — hanya hasApiKey)
//   PUT              → simpan { provider, apiKey?, baseUrl?, model?, enabled? }
//                     (guard aksi update menu settings:ai-provider)
// =====================================================================

interface ProviderConfigRow {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
}

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("action") === "test") {
      const m = await requireMenuAction(req, "settings:ai-provider", "update");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const res = await testProvider(m.db);
      return NextResponse.json(res);
    }
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const config = await getProviderPublic(db);
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-provider", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const provider = b.provider === "openai" ? "openai" : "builtin";
    const enabled = b.enabled !== false;
    const baseUrl = b.baseUrl ? String(b.baseUrl).trim().slice(0, 300) : null;
    const model = b.model ? String(b.model).trim().slice(0, 120) : null;

    if (provider === "openai") {
      if (!baseUrl || !/^https?:\/\/.+/.test(baseUrl)) {
        return NextResponse.json({ error: "Base URL wajib dan harus diawali http(s)://" }, { status: 400 });
      }
      if (!model) return NextResponse.json({ error: "Model wajib diisi (mis. gpt-4o-mini)" }, { status: 400 });
    }

    // baca baris lama (apiKey lama dipertahankan bila input kosong/null = tidak diubah)
    const existing = await db.aiProviderConfig.findFirst().catch(() => null);

    let apiKeyEnc: string | null = existing?.apiKey ?? null;
    if (b.apiKey !== undefined && b.apiKey !== null && String(b.apiKey).length > 0) {
      apiKeyEnc = tenantCryptoForDb(db).encryptText(String(b.apiKey).trim().slice(0, 300));
    } else if (b.clearApiKey === true) {
      apiKeyEnc = null;
    }

    if (provider === "openai" && !apiKeyEnc) {
      return NextResponse.json({ error: "API key wajib diisi untuk provider OpenAI-compatible" }, { status: 400 });
    }

    const data: ProviderConfigRow & { apiKey: string | null } = { provider, baseUrl, model, enabled, apiKey: provider === "openai" ? apiKeyEnc : null };
    const saved = existing
      ? await db.aiProviderConfig.update({ where: { id: existing.id }, data })
      : await db.aiProviderConfig.create({ data: { ...data, id: undefined } });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "AiProviderConfig", entityId: saved.id,
        detail: `Provider AI disetel ke ${provider}${provider === "openai" ? ` (${baseUrl} · ${model})` : " (bawaan RekanKerja)"} oleh ${m.actor.name} — ${enabled ? "aktif" : "nonaktif"}`,
      },
    }).catch(() => { /* audit best-effort */ });

    const config = await getProviderPublic(db);
    return NextResponse.json({ config });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
