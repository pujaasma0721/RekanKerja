// RekanKerja — Online Support P5: provider AI KHUSUS layanan support (platform).
// =====================================================================
// Ketentuan P5-2: agent support TIDAK lagi memakai provider AI tenant
// (AiProviderConfig per-schema). Semua giliran support memakai provider
// milik PLATFORM (SupportProviderConfig, schema public) yang melayani SEMUA
// tenant berlayanan-aktif — kredensial terpusat, biaya terpusat, tenant tak
// pernah menanggung/mengontrol model yang melayani tiketnya.
//   · builtin  — LLM bawaan RekanKerja (z-ai-web-dev-sdk; default saat belum
//     dikonfigurasi — layanan support langsung jalan tanpa setup).
//   · openai   — endpoint OpenAI-compatible milik platform (baseUrl + model +
//     apiKey TERENKRIPSI platform-crypto, HANYA pemilik aplikasi yang bisa
//     mengaturnya via modul Platform Admin).
// Pemisahan VLM: analisa lampiran gambar & tangkapan layar TETAP memakai
// vision bawaan platform (createZaiClient) — provider OpenAI-compatible tidak
// dijamin punya kemampuan vision; kualitas OCR/vision tidak bergantung pilihan
// chat provider.
// Pemakaian token (P5 biaya): tiap completion melaporkan tokensIn/tokensOut —
// dipakai agent utk diatribusikan per giliran ke SupportUsageLog (per tenant).
import type { AiCompletionInput, AiCompletionResult } from "@/rekankerja/shared/services/ai-provider";
import { createZaiClient } from "@/rekankerja/shared/services/zai-client";
import { decryptPlatformSecret } from "@/rekankerja/shared/lib/platform-crypto";
import { db as platformDb } from "@/lib/db";

export interface SupportProviderRow {
  provider: string;
  apiKey: string | null; // terenkripsi "v1:…" — tidak pernah keluar server
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  priceInPerM: number;
  priceOutPerM: number;
  updatedAt: Date;
}

export interface SupportProviderPublic {
  provider: "builtin" | "openai";
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  priceInPerM: number;
  priceOutPerM: number;
  updatedAt: string;
}

/** Cache konfigurasi 10s — route agent memanggil ini per langkah LLM. */
const CFG_TTL_MS = 10_000;
let cfgCache: { val: SupportProviderRow | null; exp: number } | null = null;

/** Invalidate (dipanggil API Platform Admin setelah update). */
export function invalidateSupportProviderCache(): void {
  cfgCache = null;
}

/** Baca konfigurasi provider support platform (null = belum ada baris → builtin). */
export async function getSupportProviderRow(): Promise<SupportProviderRow | null> {
  if (cfgCache && cfgCache.exp > Date.now()) return cfgCache.val;
  let val: SupportProviderRow | null = null;
  try {
    const row = await platformDb.supportProviderConfig.findFirst();
    if (row) {
      val = {
        provider: row.provider, apiKey: row.apiKey, baseUrl: row.baseUrl, model: row.model,
        enabled: row.enabled, priceInPerM: row.priceInPerM, priceOutPerM: row.priceOutPerM,
        updatedAt: row.updatedAt,
      };
    }
  } catch {
    val = null; // tabel belum termigrasi → builtin
  }
  cfgCache = { val, exp: Date.now() + CFG_TTL_MS };
  return val;
}

/** Bentuk aman untuk client Platform Admin (apiKey TIDAK pernah keluar). */
export async function getSupportProviderPublic(): Promise<SupportProviderPublic> {
  const row = await getSupportProviderRow();
  if (!row) {
    return { provider: "builtin", baseUrl: null, model: null, enabled: true, hasApiKey: false, priceInPerM: 0, priceOutPerM: 0, updatedAt: new Date().toISOString() };
  }
  return {
    provider: row.provider === "openai" ? "openai" : "builtin",
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    hasApiKey: !!row.apiKey,
    priceInPerM: row.priceInPerM,
    priceOutPerM: row.priceOutPerM,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SupportCompletionResult extends AiCompletionResult {
  tokensIn: number;
  tokensOut: number;
}

/** Estimasi token kasar (chars/4) — fallback bila provider tak melaporkan usage. */
function estimateTokens(...texts: string[]): number {
  const chars = texts.reduce((n, t) => n + t.length, 0);
  return Math.ceil(chars / 4);
}

const TIMEOUT_MS = 45_000;

/**
 * Completion LLM utk layanan support — SELALU via provider platform
 * (terpisah dari provider tenant). Dipakai loop ReAct support-agent.
 */
export async function aiCompleteSupport(input: AiCompletionInput): Promise<SupportCompletionResult> {
  const row = await getSupportProviderRow();
  const useOpenai = row?.provider === "openai" && row.enabled === true && !!row.baseUrl && !!row.model;
  if (useOpenai) return completeSupportOpenai(row!, input);
  return completeSupportBuiltin(input);
}

/** LLM bawaan platform (pola completeBuiltin ai-provider.ts). */
async function completeSupportBuiltin(input: AiCompletionInput): Promise<SupportCompletionResult> {
  const zai = await createZaiClient();
  const messages = [{ role: "assistant" as const, content: input.system }, ...input.messages];
  const completion = await withTimeout(
    zai.chat.completions.create({ messages, thinking: { type: "disabled" } }),
    TIMEOUT_MS,
  );
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("AI bawaan mengembalikan jawaban kosong — coba ulangi");
  const usage = (completion as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return {
    text,
    provider: "builtin",
    tokensIn: usage?.prompt_tokens ?? estimateTokens(input.system, ...input.messages.map((m) => m.content)),
    tokensOut: usage?.completion_tokens ?? estimateTokens(text),
  };
}

/** Endpoint OpenAI-compatible milik platform (apiKey didekripsi per-request). */
async function completeSupportOpenai(row: SupportProviderRow, input: AiCompletionInput): Promise<SupportCompletionResult> {
  let apiKey = "";
  try {
    apiKey = decryptPlatformSecret(row.apiKey) ?? "";
  } catch {
    apiKey = "";
  }
  if (!apiKey) throw new Error("API key provider support belum disetel (atau gagal didekripsi) — isi di Platform Admin → Provider AI Support");

  const base = (row.baseUrl ?? "").replace(/\/+$/, "");
  const res = await withTimeout(
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: row.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        temperature: input.temperature ?? 0.4,
        stream: false, // proxy OpenAI-compatible bisa default SSE — parser hanya non-stream
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      }),
    }),
    TIMEOUT_MS,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider AI support (platform) merespons ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    | null;
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Provider AI support mengembalikan jawaban kosong");
  return {
    text,
    provider: "openai",
    tokensIn: json?.usage?.prompt_tokens ?? estimateTokens(input.system, ...input.messages.map((m) => m.content)),
    tokensOut: json?.usage?.completion_tokens ?? estimateTokens(text),
  };
}

/** Uji konektivitas provider support (tombol Tes Koneksi di Platform Admin). */
export async function testSupportProvider(): Promise<{ ok: boolean; reply: string; provider: string }> {
  const r = await aiCompleteSupport({
    system: "Kau adalah penguji koneksi layanan support RekanKerja. Balas PERSIS satu kalimat pendek: Koneksi AI support RekanKerja berhasil.",
    messages: [{ role: "user", content: "tes koneksi" }],
    temperature: 0,
    maxTokens: 2000,
  });
  return { ok: true, reply: r.text, provider: r.provider };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Provider AI support tidak merespons dalam ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}
