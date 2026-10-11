// RekanKerja — RECRUITMENT WEBHOOK SERVICE (F7 — Otomasi & Integrasi) ========
// ============================================================================
// Webhook REKRUTMENT (tabel WebhookEndpoint/WebhookDelivery — TERPISAH dari
// webhook HRIS T41 yang memakai Webhook/WebhookLog): endpoint tenant berlangganan
// event rekrutmen (pr.approved | application.received | offer.accepted |
// candidate.hired | *), secret TERENKRIPSI field-crypto (secretEnc).
//
// Arsitektur DB-BACKED QUEUE (beda dgn T41 sync-dispatch):
//   emitWebhookEvent()        → hanya INSERT baris WebhookDelivery Pending
//                               (fire-and-forget aman; payload TANPA PII —
//                               UU PDP minimisasi).
//   processWebhookDeliveries() → kirim ≤20 baris jatuh tempo per siklus (job
//                               scheduler "recruitment-webhook"): POST JSON +
//                               header X-RekanKerja-{Event,Delivery,Timestamp,
//                               Signature}. Signature = HMAC-SHA256(secret,
//                               `${deliveryId}.${timestamp}.${payloadJson}`).
//                               2xx → Success; gagal → attempts++ + backoff
//                               [5m,30m,2h,8h,24j]; attempts ≥ 6 → Dead.
//                               NEVER-THROW per delivery.
// ============================================================================
import { createHmac, randomBytes } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

/** Katalog event webhook rekrutmen yang bisa dilanggan. */
export const RECRUITMENT_WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: "pr.approved", label: "PR disetujui penuh (lowongan siap tayang)" },
  { key: "application.received", label: "Lamaran publik masuk (staging)" },
  { key: "offer.accepted", label: "Kandidat menerima offer" },
  { key: "candidate.hired", label: "Kandidat resmi jadi karyawan" },
  { key: "*", label: "SEMUA event rekrutmen" },
];

export function recruitmentWebhookEventLabel(key: string): string {
  return RECRUITMENT_WEBHOOK_EVENTS.find((e) => e.key === key)?.label ?? key;
}

/** Timeout kirim (AbortController). */
const FETCH_TIMEOUT_MS = 10_000;
/** Backoff menit setelah percobaan ke-N gagal (1-based). */
export const WEBHOOK_BACKOFF_MINUTES = [5, 30, 120, 480, 1440] as const;
/** Maks percobaan kirim sebelum Dead. */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Jumlah baris diproses per siklus job scheduler. */
export const WEBHOOK_PROCESS_BATCH = 20;

// ============ validasi & normalisasi ============

function assertUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("URL webhook tidak valid");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL webhook harus http:// atau https://");
  }
}

/** Normalisasi daftar event: hanya katalog + "*", tanpa duplikat. */
export function normalizeWebhookEvents(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const known = [...RECRUITMENT_WEBHOOK_EVENTS.map((e) => e.key)];
  const out: string[] = [];
  for (const s of list) {
    const v = String(s).trim();
    if (known.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Secret baru: "whsec_" + 32 hex char. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(16).toString("hex")}`;
}

// ============ serializer ============

export interface WebhookEndpointRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  note: string | null;
  hasSecret: boolean;
  /** 6 karakter pertama secret (hint — secret penuh TIDAK pernah keluar). */
  secretHint: string | null;
  createdAt: string;
  updatedAt: string;
}

function serializeEndpoint(
  db: TenantDb,
  row: { id: string; url: string; eventsJson: string; active: boolean; note: string | null; createdAt: Date; updatedAt: Date },
  secretEnc: string,
): WebhookEndpointRow {
  let secret: string | null = null;
  try {
    secret = tenantCryptoForDb(db).decryptText(secretEnc);
  } catch {
    secret = null; // vault belum termuat — hint kosong, bukan error fatal
  }
  return {
    id: row.id,
    url: row.url,
    events: parseEvents(row.eventsJson),
    active: row.active,
    note: row.note,
    hasSecret: true,
    secretHint: secret ? secret.slice(0, 6) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseEvents(eventsJson: string): string[] {
  try {
    const arr = JSON.parse(eventsJson);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

// ============ CRUD ============

export async function listWebhookEndpoints(db: TenantDb): Promise<WebhookEndpointRow[]> {
  const rows = await db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => serializeEndpoint(db, r, r.secretEnc));
}

export interface UpsertWebhookInput {
  id?: string | null;
  url: string;
  events: string[];
  active: boolean;
  note?: string | null;
  /** true → ganti secret baru (rotasi); create selalu generate secret. */
  rotateSecret?: boolean;
}

export async function upsertWebhookEndpoint(
  db: TenantDb,
  input: UpsertWebhookInput,
  actor?: { name?: string | null } | null,
): Promise<WebhookEndpointRow> {
  const url = String(input.url ?? "").trim();
  assertUrl(url);
  const events = normalizeWebhookEvents(input.events);
  if (events.length === 0) throw new Error("Pilih minimal satu event webhook");

  if (input.id) {
    const existing = await db.webhookEndpoint.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("Endpoint webhook tidak ditemukan");
    const data: { url: string; eventsJson: string; active: boolean; note: string | null; secretEnc?: string } = {
      url,
      eventsJson: JSON.stringify(events),
      active: Boolean(input.active),
      note: input.note?.trim() || null,
    };
    if (input.rotateSecret) data.secretEnc = tenantCryptoForDb(db).encryptText(generateWebhookSecret())!;
    const row = await db.webhookEndpoint.update({ where: { id: input.id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "WebhookEndpoint", entityId: url,
        detail: `Endpoint webhook diperbarui (${url}, event: ${events.join(", ")})${input.rotateSecret ? " — secret DIROTASI" : ""}${actor?.name ? ` oleh ${actor.name}` : ""}`,
      },
    }).catch(() => {});
    return serializeEndpoint(db, row, row.secretEnc);
  }

  const row = await db.webhookEndpoint.create({
    data: {
      url,
      eventsJson: JSON.stringify(events),
      secretEnc: tenantCryptoForDb(db).encryptText(generateWebhookSecret())!,
      active: Boolean(input.active),
      note: input.note?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "WebhookEndpoint", entityId: url,
      detail: `Endpoint webhook baru (${url}, event: ${events.join(", ")})${actor?.name ? ` oleh ${actor.name}` : ""}`,
    },
  }).catch(() => {});
  return serializeEndpoint(db, row, row.secretEnc);
}

export async function deleteWebhookEndpoint(db: TenantDb, id: string): Promise<void> {
  const existing = await db.webhookEndpoint.findUnique({ where: { id }, select: { url: true } });
  if (!existing) throw new Error("Endpoint webhook tidak ditemukan");
  await db.webhookEndpoint.delete({ where: { id } }); // delivery cascade
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "WebhookEndpoint", entityId: existing.url,
      detail: `Endpoint webhook dihapus (${existing.url}) beserta riwayat delivery`,
    },
  }).catch(() => {});
}

export interface WebhookDeliveryRow {
  id: string;
  endpointId: string;
  endpointUrl: string;
  event: string;
  status: string;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export async function listWebhookDeliveries(db: TenantDb, limit = 30): Promise<WebhookDeliveryRow[]> {
  const rows = await db.webhookDelivery.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include: { endpoint: { select: { url: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    endpointId: r.endpointId,
    endpointUrl: r.endpoint.url,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
    lastError: r.lastError,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ============ emit (queue) ============

/**
 * Catat event ke antrean delivery semua endpoint AKTIF yang berlangganan event
 * (eventsJson memuat event atau "*"). Payload HARUS bebas PII kandidat
 * (UU PDP minimisasi — pemanggil bertanggung jawab menyusun payload).
 * Fire-and-forget aman: `void emitWebhookEvent(...).catch(() => {})`.
 */
export async function emitWebhookEvent(
  db: TenantDb,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { active: true } });
    const targets = endpoints.filter((e) => {
      const evts = parseEvents(e.eventsJson);
      return evts.includes(event) || evts.includes("*");
    });
    if (targets.length === 0) return 0;
    const payloadJson = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    for (const ep of targets) {
      await db.webhookDelivery.create({
        data: { endpointId: ep.id, event, payloadJson, status: "Pending" },
      }).catch(() => {
        // satu antrean gagal ditulis → lanjut endpoint berikutnya
      });
    }
    return targets.length;
  } catch (e) {
    // tabel belum termigrasi / DB down — emisi tidak boleh mengganggu bisnis
    console.warn(`[webhook-rec] emit ${event} gagal diantrekan: ${e instanceof Error ? e.message : e}`);
    return 0;
  }
}

// ============ processor (job scheduler) ============

export interface WebhookProcessSummary {
  sent: number;
  failed: number;
  dead: number;
}

/** Data update setelah percobaan ke-`attempts` (1-based) gagal. */
function failureUpdate(attempts: number, error: string): {
  status: string; attempts: number; nextRetryAt: Date | null; lastError: string;
} {
  const dead = attempts >= WEBHOOK_MAX_ATTEMPTS;
  const backoffMin = WEBHOOK_BACKOFF_MINUTES[Math.min(attempts, WEBHOOK_BACKOFF_MINUTES.length) - 1]!;
  return {
    status: dead ? "Dead" : "Failed",
    attempts,
    nextRetryAt: dead ? null : new Date(Date.now() + backoffMin * 60_000),
    lastError: error.slice(0, 300),
  };
}

/**
 * Proses antrean: ≤20 delivery Pending|Failed jatuh tempo (nextRetryAt null
 * atau ≤ now), urut createdAt asc. Signature HMAC-SHA256 atas
 * `${deliveryId}.${timestamp}.${payloadJson}` dgn secret endpoint (decrypt).
 * 2xx/3xx → Success; gagal → backoff; attempts ≥ 6 → Dead. Endpoint nonaktif
 * → baris ditunda 24 jam (konfigurasi bisa berubah — tidak dibunuh).
 * NEVER-THROW per delivery; resolve ringkasan counter.
 */
export async function processWebhookDeliveries(db: TenantDb): Promise<WebhookProcessSummary> {
  const summary: WebhookProcessSummary = { sent: 0, failed: 0, dead: 0 };
  try {
    const due = await db.webhookDelivery.findMany({
      where: {
        status: { in: ["Pending", "Failed"] },
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: WEBHOOK_PROCESS_BATCH,
      include: { endpoint: true },
    });
    if (due.length === 0) return summary;

    const tc = tenantCryptoForDb(db);
    for (const d of due) {
      try {
        if (!d.endpoint || !d.endpoint.active) {
          // endpoint dihapus/nonaktif — tunda, cek lagi besok
          await db.webhookDelivery.update({
            where: { id: d.id },
            data: { nextRetryAt: new Date(Date.now() + WEBHOOK_BACKOFF_MINUTES[WEBHOOK_BACKOFF_MINUTES.length - 1]! * 60_000) },
          });
          continue;
        }
        let secret: string | null = null;
        try {
          secret = tc.decryptText(d.endpoint.secretEnc);
        } catch {
          secret = null;
        }
        if (!secret) {
          // vault tidak bisa membaca secret — jangan matikan antrean, tunda
          await db.webhookDelivery.update({
            where: { id: d.id },
            data: { nextRetryAt: new Date(Date.now() + WEBHOOK_BACKOFF_MINUTES[0]! * 60_000), lastError: "secret tidak terbaca (vault belum termuat)" },
          });
          continue;
        }

        const ts = new Date().toISOString();
        const signature = createHmac("sha256", secret).update(`${d.id}.${ts}.${d.payloadJson}`).digest("hex");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let ok = false;
        let error: string | null = null;
        try {
          const res = await fetch(d.endpoint.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-RekanKerja-Event": d.event,
              "X-RekanKerja-Delivery": d.id,
              "X-RekanKerja-Timestamp": ts,
              "X-RekanKerja-Signature": `sha256=${signature}`,
            },
            body: d.payloadJson,
            signal: controller.signal,
          });
          if (res.ok) ok = true;
          else {
            error = `HTTP ${res.status}`;
            // drain body supaya socket bisa direuse
            await res.text().catch(() => "");
          }
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        } finally {
          clearTimeout(timer);
        }

        const attempts = d.attempts + 1;
        if (ok) {
          await db.webhookDelivery.update({
            where: { id: d.id },
            data: { status: "Success", attempts, nextRetryAt: null, lastError: null },
          });
          summary.sent++;
        } else {
          const upd = failureUpdate(attempts, error ?? "unknown");
          await db.webhookDelivery.update({ where: { id: d.id }, data: upd });
          summary.failed++;
          if (upd.status === "Dead") summary.dead++;
        }
      } catch (e) {
        // satu baris gagal diproses → lanjut baris berikutnya (never-throw)
        console.warn(`[webhook-rec] delivery ${d.id} gagal diproses: ${e instanceof Error ? e.message : e}`);
      }
    }
  } catch (e) {
    // tabel belum termigrasi / DB error — siklus berikutnya dicoba lagi
    console.warn(`[webhook-rec] processor skip: ${e instanceof Error ? e.message : e}`);
  }
  return summary;
}

/**
 * Uji kirim: antrekan delivery event "webhook.test" (payload {hello}) ke satu
 * endpoint — TANPA peduli langganan event (ping manual). Dikirim oleh processor
 * (job scheduler / pemanggil manual processWebhookDeliveries).
 */
export async function sendTestWebhook(db: TenantDb, id: string): Promise<{ deliveryId: string }> {
  const ep = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!ep) throw new Error("Endpoint webhook tidak ditemukan");
  const payloadJson = JSON.stringify({
    event: "webhook.test",
    sentAt: new Date().toISOString(),
    data: { hello: "rekankerja" },
  });
  const row = await db.webhookDelivery.create({
    data: { endpointId: ep.id, event: "webhook.test", payloadJson, status: "Pending" },
  });
  return { deliveryId: row.id };
}
