// =====================================================================
// RekanKerja — KLIEN Z-AI TERPUSAT (env-first) =========================
// =====================================================================
// Masalah prod: `z-ai-web-dev-sdk` HANYA membaca file `.z-ai-config`
// (cwd → home → /etc), yang di-gitignore sehingga TIDAK PERNAH ikut
// deploy → `ZAI.create()` melempar "Configuration file not found" dan
// SEMUA fitur AI mati (chat, face-verify clock, OCR travel).
//
// Helper ini mengutamakan ENV (cocok untuk server/prod via .env.local
// + `pm2 restart --update-env`), fallback ke file bila env kosong:
//   Z_AI_BASE_URL / Z_AI_API_KEY (+ opsional Z_AI_CHAT_ID, Z_AI_USER_ID,
//   Z_AI_TOKEN). Alias tanpa underscore tengah juga diterima
//   (ZAI_BASE_URL / ZAI_API_KEY).
// Bentuk klien yang dikembalikan kompatibel dgn SDK (chat.completions.
// create + createVision) sehingga pemanggil tidak berubah perilaku.
// SERVER-SIDE ONLY — jangan diimpor dari client component.
// =====================================================================

interface ZaiEnvConfig {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
}

function readEnv(): ZaiEnvConfig | null {
  const baseUrl = (process.env.Z_AI_BASE_URL ?? process.env.ZAI_BASE_URL ?? "").trim();
  const apiKey = (process.env.Z_AI_API_KEY ?? process.env.ZAI_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    chatId: (process.env.Z_AI_CHAT_ID ?? "").trim() || undefined,
    userId: (process.env.Z_AI_USER_ID ?? "").trim() || undefined,
    token: (process.env.Z_AI_TOKEN ?? "").trim() || undefined,
  };
}

type ChatCreateBody = Record<string, unknown>;

async function postJson(url: string, cfg: ZaiEnvConfig, body: ChatCreateBody) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.chatId) headers["X-Chat-Id"] = cfg.chatId;
  if (cfg.userId) headers["X-User-Id"] = cfg.userId;
  if (cfg.token) headers["X-Token"] = cfg.token;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, thinking: (body as { thinking?: unknown }).thinking ?? { type: "disabled" } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`API request failed with status ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as { choices?: { message?: { content?: string } }[] };
}

/** Klien chat-completions dari ENV (tanpa file). */
function envClient(cfg: ZaiEnvConfig) {
  return {
    chat: {
      completions: {
        create: (body: ChatCreateBody) => postJson(`${cfg.baseUrl}/chat/completions`, cfg, body),
        createVision: (body: ChatCreateBody) => postJson(`${cfg.baseUrl}/chat/completions/vision`, cfg, body),
      },
    },
  };
}

/**
 * Buat klien Z-AI: ENV dulu, fallback file `.z-ai-config` (SDK).
 * Error dibuat ramah-ops bila keduanya kosong (menyebut ENV yang kurang).
 */
export async function createZaiClient() {
  const env = readEnv();
  if (env) return envClient(env);
  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    return await ZAI.create();
  } catch (e) {
    const hint =
      "Konfigurasi AI bawaan tidak ditemukan — set ENV Z_AI_BASE_URL + Z_AI_API_KEY " +
      "(via .env.local + `pm2 restart --update-env`) atau sediakan file .z-ai-config " +
      "{baseUrl, apiKey} di folder app. Alternatif: pakai provider OpenAI-Compatible " +
      "per tenant di Pengaturan → Provider AI.";
    throw new Error(`${hint} (detail: ${e instanceof Error ? e.message : String(e)})`);
  }
}
