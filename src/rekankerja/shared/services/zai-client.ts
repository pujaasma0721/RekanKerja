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
//   Z_AI_BASE_URL / Z_AI_API_KEY — wajib (alias ZAI_* diterima)
//   Z_AI_MODEL / Z_AI_MODEL_VISION — model utama chat & vision
//   Z_AI_MODEL_FALLBACK / Z_AI_MODEL_VISION_FALLBACK — daftar model
//     cadangan (dipisah koma), dicoba berurutan bila model utama gagal
//     (429 ramai/saldo, 5xx, model hilang). 401/403 tidak di-fallback
//     (kredensial salah — ganti model percuma).
//
// Provider standar OpenAI-compatible (Zhipu dll.) MEWAJIBKAN field
// `model`, dan route `/chat/completions/vision` HANYA ada di gateway
// Z.AI — klien env ini menyuntik model default dan memakai endpoint
// standar untuk vision (konten image_url). Bentuk klien yang
// dikembalikan kompatibel dgn SDK (chat.completions.create +
// createVision) sehingga pemanggil tidak berubah perilaku.
// SERVER-SIDE ONLY — jangan diimpor dari client component.
// =====================================================================

interface ZaiEnvConfig {
  baseUrl: string;
  apiKey: string;
  /** Rantai model chat: [utama, ...cadangan]. */
  modelChain: string[];
  /** Rantai model vision: [utama, ...cadangan]. */
  modelVisionChain: string[];
  chatId?: string;
  userId?: string;
  token?: string;
}

function readChain(primary: string, fallbackRaw: string): string[] {
  const rest = fallbackRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((m) => m !== primary);
  return [primary, ...rest];
}

function readEnv(): ZaiEnvConfig | null {
  const baseUrl = (process.env.Z_AI_BASE_URL ?? process.env.ZAI_BASE_URL ?? "").trim();
  const apiKey = (process.env.Z_AI_API_KEY ?? process.env.ZAI_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;
  const chatPrimary = (process.env.Z_AI_MODEL ?? process.env.ZAI_MODEL ?? "").trim() || "glm-4.5-flash";
  const visionPrimary =
    (process.env.Z_AI_MODEL_VISION ?? process.env.ZAI_MODEL_VISION ?? "").trim() || "glm-4.6v-flash";
  const chatFallback =
    (process.env.Z_AI_MODEL_FALLBACK ?? process.env.ZAI_MODEL_FALLBACK ?? "").trim() || "glm-5.3-flash";
  const visionFallback =
    (process.env.Z_AI_MODEL_VISION_FALLBACK ?? process.env.ZAI_MODEL_VISION_FALLBACK ?? "").trim() || chatFallback;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    modelChain: readChain(chatPrimary, chatFallback),
    modelVisionChain: readChain(visionPrimary, visionFallback),
    chatId: (process.env.Z_AI_CHAT_ID ?? "").trim() || undefined,
    userId: (process.env.Z_AI_USER_ID ?? "").trim() || undefined,
    token: (process.env.Z_AI_TOKEN ?? "").trim() || undefined,
  };
}

type ChatCreateBody = Record<string, unknown>;

/** Error HTTP dari provider — status dipakai untuk memutuskan fallback. */
class ZaiApiError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`API request failed with status ${status}: ${detail.slice(0, 300)}`);
    this.name = "ZaiApiError";
    this.status = status;
  }
}

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
    throw new ZaiApiError(res.status, detail);
  }
  return (await res.json()) as { choices?: { message?: { content?: string } }[] };
}

/** Fallback model tak berguna bila yang salah kredensial, bukan modelnya. */
function isFallbackEligible(e: unknown): boolean {
  if (!(e instanceof ZaiApiError)) return true; // error jaringan dsb. → coba model cadangan
  return e.status !== 401 && e.status !== 403;
}

/** Model reasoning murni (mis. glm-5.3-flash) menolak thinking-nonaktif (kode 1210). */
function isAlwaysThinkingError(e: unknown): boolean {
  if (!(e instanceof ZaiApiError)) return false;
  const m = e.message;
  return m.includes("不支持关闭思考") || m.includes("cannot be disabled");
}

function withThinking(body: ChatCreateBody, thinking: { type: "enabled" }): ChatCreateBody {
  return { ...body, thinking };
}

/** Isi model pada tiap percobaan rantai (pemanggil tanpa `model` memakai default). */
function withModel(body: ChatCreateBody, model: string): ChatCreateBody {
  const existing = (body as { model?: unknown }).model;
  return existing ? body : { ...body, model };
}

/** Klien chat-completions dari ENV (tanpa file). */
function envClient(cfg: ZaiEnvConfig) {
  const attempt = async (url: string, chain: string[], body: ChatCreateBody) => {
    let lastErr: unknown;
    for (const model of chain) {
      try {
        return await postJson(url, cfg, withModel(body, model));
      } catch (e) {
        lastErr = e;
        if (isAlwaysThinkingError(e)) {
          // Ulang model yang sama dgn thinking aktif (default klien: disabled).
          try {
            return await postJson(url, cfg, withThinking(withModel(body, model), { type: "enabled" }));
          } catch (e2) {
            lastErr = e2;
          }
        }
        if (!isFallbackEligible(lastErr)) throw lastErr;
      }
    }
    throw lastErr;
  };
  return {
    chat: {
      completions: {
        create: (body: ChatCreateBody) => attempt(`${cfg.baseUrl}/chat/completions`, cfg.modelChain, body),
        // Endpoint standar OpenAI-compatible (konten image_url) — route khusus
        // `/chat/completions/vision` hanya ada di gateway Z.AI, tidak di Zhipu.
        createVision: (body: ChatCreateBody) => attempt(`${cfg.baseUrl}/chat/completions`, cfg.modelVisionChain, body),
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
