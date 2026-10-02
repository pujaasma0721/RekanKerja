// =====================================================================
// RekanKerja — PROVIDER AI PER-TENANT (Task 96) =======================
// =====================================================================
// Setiap tenant bisa memakai provider AI sendiri (Pengaturan → Provider
// AI). Dua pilihan:
//   • builtin — LLM bawaan RekanKerja (z-ai-web-dev-sdk, server-side
//     only; tanpa konfigurasi — default saat baris config tidak ada).
//   • openai  — endpoint OpenAI-compatible milik tenant (baseUrl + model
//     + apiKey TERENKRIPSI enc:v1:t:… via field-crypto per-tenant).
// Satu fungsi completion dipakai semua mode chat (assistant | hr_expert).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

export type AiProviderKind = "builtin" | "openai";

export interface AiProviderRow {
  id: string;
  provider: string;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  updatedAt: Date;
}

export interface AiProviderPublic {
  provider: AiProviderKind;
  baseUrl: string | null;
  model: string | null;
  enabled: boolean;
  hasApiKey: boolean;
  updatedAt: string;
}

/** Baca konfigurasi provider tenant (null = belum ada baris → builtin). */
export async function getProviderRow(db: TenantDb): Promise<AiProviderRow | null> {
  try {
    return await db.aiProviderConfig.findFirst();
  } catch {
    return null; // tabel belum termigrasi → fallback builtin
  }
}

/** Bentuk aman untuk dikirim ke client (apiKey TIDAK pernah keluar). */
export async function getProviderPublic(db: TenantDb): Promise<AiProviderPublic> {
  const row = await getProviderRow(db);
  if (!row) {
    return { provider: "builtin", baseUrl: null, model: null, enabled: true, hasApiKey: false, updatedAt: new Date().toISOString() };
  }
  return {
    provider: row.provider === "openai" ? "openai" : "builtin",
    baseUrl: row.baseUrl,
    model: row.model,
    enabled: row.enabled,
    hasApiKey: !!row.apiKey,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AiCompletionInput {
  /** Instruksi sistem — ATURAN SCOPE + konteks (menu akses, data sendiri, KB). */
  system: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionResult {
  text: string;
  provider: AiProviderKind;
}

const TIMEOUT_MS = 45_000;

/** Jalankan completion via provider aktif tenant. */
export async function aiComplete(db: TenantDb, input: AiCompletionInput): Promise<AiCompletionResult> {
  const row = await getProviderRow(db);
  const useOpenai = row?.provider === "openai" && row.enabled === true && !!row.baseUrl && !!row.model;
  if (useOpenai) return completeOpenai(db, row!, input);
  return completeBuiltin(input);
}

/** LLM bawaan RekanKerja (z-ai-web-dev-sdk — SERVER-SIDE ONLY). */
async function completeBuiltin(input: AiCompletionInput): Promise<AiCompletionResult> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  // Pola SDK: system prompt dikirim sebagai pesan 'assistant' PERTAMA.
  const messages = [{ role: "assistant" as const, content: input.system }, ...input.messages];
  const completion = await withTimeout(
    zai.chat.completions.create({ messages, thinking: { type: "disabled" } }),
    TIMEOUT_MS,
  );
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("AI bawaan mengembalikan jawaban kosong — coba ulangi");
  return { text, provider: "builtin" };
}

/** Endpoint OpenAI-compatible milik tenant (apiKey didekripsi per-request). */
async function completeOpenai(db: TenantDb, row: AiProviderRow, input: AiCompletionInput): Promise<AiCompletionResult> {
  let apiKey = "";
  try {
    apiKey = tenantCryptoForDb(db).decryptText(row.apiKey) ?? "";
  } catch {
    apiKey = "";
  }
  if (!apiKey) throw new Error("API key provider AI belum disetel (atau gagal didekripsi) — isi di Pengaturan → Provider AI");

  const base = (row.baseUrl ?? "").replace(/\/+$/, "");
  const res = await withTimeout(
    fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: row.model,
        messages: [{ role: "system", content: input.system }, ...input.messages],
        temperature: input.temperature ?? 0.4,
        ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      }),
    }),
    TIMEOUT_MS,
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider AI tenant merespons ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[] }
    | null;
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Provider AI tenant mengembalikan jawaban kosong");
  return { text, provider: "openai" };
}

/** Uji konektivitas provider (tombol Tes Koneksi di Pengaturan). */
export async function testProvider(db: TenantDb): Promise<{ ok: boolean; reply: string }> {
  const r = await aiComplete(db, {
    system: "Kau adalah penguji koneksi RekanKerja. Balas PERSIS satu kalimat pendek: Koneksi AI RekanKerja berhasil.",
    messages: [{ role: "user", content: "tes koneksi" }],
    temperature: 0,
    maxTokens: 2000,
  });
  return { ok: true, reply: r.text };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Provider AI tidak merespons dalam ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}
