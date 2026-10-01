// RekanKerja Webhook Service (T18-API) — kirim event HRIS ke endpoint tenant.
// =====================================================================
// dispatchWebhookEvent(db, tenant, event, payload): semua webhook AKTIF yang
// berlangganan event tsb → POST JSON dgn header:
//   X-RekanKerja-Event:    <event>
//   X-RekanKerja-Signature: hex HMAC-SHA256(secret, body) — verifikasi asal
// Timeout 5 detik (AbortSignal.timeout). Setiap kirim dicatat ke WebhookLog
// (status delivered|failed|dead + responseStatus + error; payload = body
// persis yang dikirim supaya penerima/supervisor bisa verifikasi ulang
// signature — dan dipakai ulang oleh job retry).
// T41-M14: RETRY/BACKOFF — kegagalan kirim tidak lagi "fire and forget":
//   · baris log gagal → status "failed" + nextRetryAt = now + backoff
//     [5m, 30m, 2h, 6h, 24h]; percobaan ke-5 gagal → status "dead".
//   · retryFailedWebhookDeliveries(db) — dipanggil job scheduler
//     "webhook-retry" tiap siklus: ambil max N baris jatuh tempo, kirim ULANG
//     payload tersimpan (re-sign HMAC dgn secret webhook saat ini) → sukses
//     = delivered, gagal = next backoff / dead.
// Housekeeping: maks 500 baris log per tenant (terlama dihapus).
// NEVER-THROW: aman dipanggil `void dispatchWebhookEvent(...)` di titik
// event bisnis — kegagalan kirim tidak pernah menggagalkan proses utama.
import { createHmac, randomBytes } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

/** Katalog event yang bisa dilanggan (csv Webhook.events). */
export const WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: "leave.submitted", label: "Cuti — pengajuan baru" },
  { key: "leave.approved", label: "Cuti — disetujui (final)" },
  { key: "leave.rejected", label: "Cuti — ditolak (final)" },
  { key: "payroll.confirmed", label: "Payroll — run dikonfirmasi" },
  { key: "payroll.paid", label: "Payroll — run ditandai dibayar" },
  { key: "workoff.approved", label: "Izin tidak masuk — disetujui (final)" },
  { key: "workoff.rejected", label: "Izin tidak masuk — ditolak (final)" },
  // T41-M14 (f) — event lintas modul yang engine-nya sudah mendukung:
  { key: "travel.request.approved", label: "Perjalanan dinas — disetujui (final)" },
  { key: "medical.claim.submitted", label: "Klaim medis — diajukan ke settlement" },
  { key: "overtime.approved", label: "Lembur — disetujui (final)" },
  { key: "loan.created", label: "Pinjaman karyawan — pengajuan baru" },
];

export function webhookEventLabel(key: string): string {
  return WEBHOOK_EVENTS.find((e) => e.key === key)?.label ?? key;
}

/** Timeout kirim webhook. */
const FETCH_TIMEOUT_MS = 5_000;
/** Maks baris WebhookLog per tenant (terlama dihapus). */
export const WEBHOOK_LOG_KEEP = 500;

// ---------- T41-M14: retry/backoff ----------

/** Backoff retry kumulatif setelah percobaan ke-N gagal (ms). */
export const WEBHOOK_BACKOFF_MS: readonly number[] = [
  5 * 60_000, // 5 menit — setelah percobaan 1
  30 * 60_000, // 30 menit — setelah percobaan 2
  2 * 3_600_000, // 2 jam — setelah percobaan 3
  6 * 3_600_000, // 6 jam — setelah percobaan 4
  24 * 3_600_000, // 24 jam — entri terakhir (jepit/clamp)
];
/** Maks total percobaan kirim (dispatch awal + retry) sebelum status dead. */
export const WEBHOOK_MAX_ATTEMPTS = 5;
/** Jumlah baris retry per siklus job scheduler webhook-retry. */
export const WEBHOOK_RETRY_BATCH = 20;

/** Durasi tunggu sebelum percobaan berikutnya, setelah percobaan ke-`attempt` gagal. */
function backoffAfter(attempt: number): number {
  const idx = Math.min(Math.max(attempt, 1), WEBHOOK_BACKOFF_MS.length) - 1;
  return WEBHOOK_BACKOFF_MS[idx]!;
}

/** Status kirim: delivered (2xx/3xx), failed (dijadwalkan retry), dead (max percobaan). */
export type WebhookDeliveryStatus = "delivered" | "failed" | "dead";

export interface WebhookPublic {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
  createdAt: Date;
}

function toPublic(row: { id: string; url: string; events: string; secret: string; isActive: boolean; createdAt: Date }): WebhookPublic {
  return {
    id: row.id,
    url: row.url,
    events: row.events.split(",").map((s) => s.trim()).filter(Boolean),
    secret: row.secret,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

/** Normalisasi daftar event: hanya key katalog, tanpa duplikat. */
export function normalizeEvents(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const known = WEBHOOK_EVENTS.map((e) => e.key);
  const out: string[] = [];
  for (const s of list) {
    const v = String(s).trim();
    if (known.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Secret baru: "whsec_" + 32 hex. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(16).toString("hex")}`;
}

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

// ============ CRUD ============

export async function listWebhooks(db: TenantDb): Promise<WebhookPublic[]> {
  const rows = await db.webhook.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => toPublic(r));
}

export async function createWebhook(
  db: TenantDb,
  input: { url: string; events: string[]; secret?: string; isActive?: boolean },
): Promise<WebhookPublic> {
  const url = input.url.trim();
  assertUrl(url);
  const events = normalizeEvents(input.events);
  if (events.length === 0) throw new Error("Pilih minimal satu event webhook");
  const row = await db.webhook.create({
    data: {
      url,
      events: events.join(","),
      secret: input.secret?.trim() || generateWebhookSecret(),
      isActive: input.isActive ?? true,
    },
  });
  return toPublic(row);
}

export async function updateWebhook(
  db: TenantDb,
  input: { id: string; url?: string; events?: string[]; secret?: string; isActive?: boolean },
): Promise<WebhookPublic> {
  const existing = await db.webhook.findUnique({ where: { id: input.id } });
  if (!existing) throw new Error("Webhook tidak ditemukan");
  const data: Record<string, unknown> = {};
  if (input.url !== undefined) {
    const url = String(input.url).trim();
    assertUrl(url);
    data.url = url;
  }
  if (input.events !== undefined) {
    const events = normalizeEvents(input.events);
    if (events.length === 0) throw new Error("Pilih minimal satu event webhook");
    data.events = events.join(",");
  }
  if (input.secret !== undefined && String(input.secret).trim() !== "") {
    data.secret = String(input.secret).trim();
  }
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  const row = await db.webhook.update({ where: { id: input.id }, data });
  return toPublic(row);
}

export async function deleteWebhook(db: TenantDb, id: string): Promise<void> {
  await db.webhook.delete({ where: { id } }).catch(() => {
    throw new Error("Webhook tidak ditemukan");
  });
}

// ============ log pengiriman ============

export interface WebhookLogRow {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  responseStatus: number | null;
  error: string | null;
  attempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  payload: string;
  createdAt: Date;
}

export async function listWebhookLogs(
  db: TenantDb,
  limit = 10,
  webhookId?: string,
): Promise<WebhookLogRow[]> {
  const rows = await db.webhookLog.findMany({
    where: webhookId ? { webhookId } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    webhookId: r.webhookId,
    event: r.event,
    status: r.status,
    responseStatus: r.responseStatus,
    error: r.error,
    attempts: r.attempts,
    nextRetryAt: r.nextRetryAt,
    lastError: r.lastError,
    payload: r.payload,
    createdAt: r.createdAt,
  }));
}

/** Housekeeping: pangkas WebhookLog ke maks N baris (terlama dihapus). */
async function trimLogs(db: TenantDb): Promise<void> {
  const overflow = await db.webhookLog.count() - WEBHOOK_LOG_KEEP;
  if (overflow <= 0) return;
  // hapus `overflow` baris tertua (subquery id — Prisma deleteMany tak
  // mendukung orderBy+take, jadi ambil dN id terlama lalu deleteMany)
  const oldest = await db.webhookLog.findMany({
    orderBy: { createdAt: "asc" },
    take: overflow,
    select: { id: true },
  });
  if (oldest.length > 0) {
    await db.webhookLog.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } });
  }
}

// ============ dispatch ============

/** Body yang dikirim: envelope event (persis string yang di-HMAC & dikirim). */
function buildBody(tenant: string, event: string, data: unknown): string {
  return JSON.stringify({
    event,
    tenant,
    timestamp: new Date().toISOString(),
    data,
  });
}

/** Label tenant utk envelope: eksplisit, atau nama perusahaan tenant (lazy). */
async function tenantLabel(db: TenantDb, tenant: string | null): Promise<string> {
  if (tenant) return tenant;
  try {
    const c = await db.company.findFirst({ select: { name: true } });
    if (c?.name) return c.name;
  } catch { /* tanpa tabel Company — fallback generik */ }
  return "tenant";
}

/** HMAC-SHA256 hex dari secret atas body persis yang dikirim. */
export function signWebhookBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Kirim body (sudah di-sign) ke URL — hasil normalisasi utk dispatch & retry. */
async function postWebhook(
  url: string,
  event: string,
  signature: string,
  body: string,
): Promise<{ ok: boolean; responseStatus: number | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RekanKerja-Event": event,
        "X-RekanKerja-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 400) {
      return { ok: false, responseStatus: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, responseStatus: res.status, error: null };
  } catch (e) {
    // timeout / DNS / koneksi ditolak — pesan singkat utk kolom error log
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, responseStatus: null, error: msg };
  }
}

/**
 * Data retry kolom WebhookLog setelah percobaan ke-`attempt` (1-based) gagal:
 * attempts < 5 → failed + nextRetryAt now+backoff; attempts = 5 → dead
 * (nextRetryAt NULL — tidak pernah diambil lagi oleh processor retry).
 */
function failureUpdate(attempt: number, error: string | null): {
  status: WebhookDeliveryStatus;
  attempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
} {
  const dead = attempt >= WEBHOOK_MAX_ATTEMPTS;
  return {
    status: dead ? "dead" : "failed",
    attempts: attempt,
    nextRetryAt: dead ? null : new Date(Date.now() + backoffAfter(attempt)),
    lastError: error,
  };
}

export interface DispatchResult {
  event: string;
  sent: number;
  failed: number;
  /** detail per webhook (utk log/testing). */
  details: { webhookId: string; url: string; status: WebhookDeliveryStatus; responseStatus: number | null; error: string | null }[];
}

/**
 * Kirim event ke semua webhook AKTIF yang berlangganan event tersebut.
 * `tenant`: label tenant utk envelope (null → nama perusahaan tenant, diresolusi
 * lazy HANYA bila ada penerima aktif). NEVER-THROW — selalu resolve dengan
 * ringkasan hasil.
 * T41-M14: kegagalan kirim kini meninggalkan baris log status "failed" dengan
 * nextRetryAt (backoff 5m→…→24h, maks 5 percobaan → dead) — dikirim ulang oleh
 * job scheduler webhook-retry (retryFailedWebhookDeliveries). Sukses →
 * "delivered" + nextRetryAt NULL. HMAC signing & timeout 5 dtk tetap.
 */
export async function dispatchWebhookEvent(
  db: TenantDb,
  tenant: string | null,
  event: string,
  data: unknown,
): Promise<DispatchResult> {
  const result: DispatchResult = { event, sent: 0, failed: 0, details: [] };
  try {
    const hooks = await db.webhook.findMany({
      where: { isActive: true, events: { contains: event } },
    });
    // filter tegas: "contains" csv bisa cocok substring — pastikan kata penuh
    const targets = hooks.filter((h) => h.events.split(",").map((s) => s.trim()).includes(event));
    if (targets.length === 0) return result; // tanpa penerima — tanpa query label
    const label = await tenantLabel(db, tenant);
    for (const hook of targets) {
      const body = buildBody(label, event, data);
      const signature = signWebhookBody(hook.secret, body);
      const send = await postWebhook(hook.url, event, signature, body);
      const status: WebhookDeliveryStatus = send.ok ? "delivered" : "failed";
      result.details.push({ webhookId: hook.id, url: hook.url, status, responseStatus: send.responseStatus, error: send.error });
      if (send.ok) result.sent += 1;
      else result.failed += 1;
      try {
        await db.webhookLog.create({
          data: send.ok
            ? {
                // percobaan pertama sukses — tanpa jadwal retry
                webhookId: hook.id, event, payload: body, status,
                responseStatus: send.responseStatus, error: null,
                attempts: 1, nextRetryAt: null, lastError: null,
              }
            : {
                // percobaan pertama gagal (non-2xx/timeout/error) → antre retry
                webhookId: hook.id, event, payload: body,
                responseStatus: send.responseStatus, error: send.error,
                ...failureUpdate(1, send.error),
              },
        });
      } catch {
        // log gagal ditulis — kirim tetap dianggap selesai (never-throw);
        // tanpa baris log tidak ada yang bisa di-retry (harga konsisten)
      }
    }
    if (targets.length > 0) {
      try {
        await trimLogs(db);
      } catch { /* housekeeping gagal — abaikan */ }
    }
  } catch (e) {
    // pertahanan terakhir — dispatch tidak boleh mengganggu proses bisnis
    console.warn("[webhook] dispatch gagal:", e instanceof Error ? e.message : e);
  }
  return result;
}

// ============ T41-M14: processor retry ============

export interface WebhookRetrySummary {
  /** baris due yang diproses siklus ini */
  eligible: number;
  retried: number;
  delivered: number;
  dead: number;
  /** baris ditunda (webhook nonaktif / berhenti berlangganan event) */
  deferred: number;
}

/**
 * Kirim ULANG pengiriman webhook yang gagal dan sudah jatuh tempo
 * (status 'failed' AND nextRetryAt <= now, maks `limit` baris terlama).
 * Payload adalah body JSON PERSIS yang tersimpan di log — di-sign ulang
 * dengan secret webhook SAAT INI (secret disimpan plaintext per tenant,
 * sama seperti dipakai dispatch) sehingga penerima bisa memverifikasi
 * signature konsisten. Sukses → delivered + nextRetryAt NULL; gagal →
 * attempts+1, nextRetryAt = now + backoff, percobaan ke-5 → dead.
 * Webhook yang sudah nonaktif / tidak lagi berlangganan event → baris
 * ditunda 24 jam (tidak dikirim, tidak dead — konfigurasi bisa berubah).
 * NEVER-THROW — dipanggil job scheduler per tenant.
 */
export async function retryFailedWebhookDeliveries(
  db: TenantDb,
  limit = WEBHOOK_RETRY_BATCH,
): Promise<WebhookRetrySummary> {
  const summary: WebhookRetrySummary = { eligible: 0, retried: 0, delivered: 0, dead: 0, deferred: 0 };
  try {
    const due = await db.webhookLog.findMany({
      where: { status: "failed", nextRetryAt: { lte: new Date() } },
      orderBy: { nextRetryAt: "asc" },
      take: Math.max(1, Math.min(limit, 100)),
    });
    summary.eligible = due.length;
    if (due.length === 0) return summary;

    for (const log of due) {
      try {
        const hook = await db.webhook.findUnique({ where: { id: log.webhookId } });
        if (!hook) continue; // FK cascade — nyaris mustahil; skip senyap
        const subscribed = hook.events.split(",").map((s) => s.trim()).includes(log.event);
        if (!hook.isActive || !subscribed) {
          // konfigurasi berubah — jangan kirim & jangan matikan; cek lagi besok
          await db.webhookLog.update({
            where: { id: log.id },
            data: { nextRetryAt: new Date(Date.now() + WEBHOOK_BACKOFF_MS[WEBHOOK_BACKOFF_MS.length - 1]!) },
          });
          summary.deferred++;
          continue;
        }

        // percobaan ke-(attempts+1): body tersimpan di re-sign dgn secret kini
        const attempt = (log.attempts ?? 1) + 1;
        const signature = signWebhookBody(hook.secret, log.payload);
        const send = await postWebhook(hook.url, log.event, signature, log.payload);
        summary.retried++;
        if (send.ok) {
          await db.webhookLog.update({
            where: { id: log.id },
            data: {
              status: "delivered",
              responseStatus: send.responseStatus,
              error: null,
              attempts: attempt,
              nextRetryAt: null,
              lastError: null,
            },
          });
          summary.delivered++;
        } else {
          await db.webhookLog.update({
            where: { id: log.id },
            data: {
              responseStatus: send.responseStatus,
              ...failureUpdate(attempt, send.error),
            },
          });
          if (attempt >= WEBHOOK_MAX_ATTEMPTS) summary.dead++;
        }
      } catch (e) {
        // satu baris gagal diproses → lanjut baris berikutnya (never-throw per log)
        console.warn(
          `[webhook] retry log ${log.id} gagal diproses: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  } catch (e) {
    // tabel WebhookLog belum termigrasi (kolom baru) → skip senyap siklus ini
    console.warn("[webhook] retry processor skip:", e instanceof Error ? e.message : e);
  }
  return summary;
}

/**
 * Uji kirim (ping): kirim event "webhook.test" LANGSUNG ke satu webhook
 * (tak peduli langganan event) — dipakai tombol "Uji Kirim" di settings.
 * Ping manual tidak masuk antrian retry (nextRetryAt NULL).
 */
export async function sendTestWebhook(
  db: TenantDb,
  id: string,
  tenant: string,
): Promise<{ ok: boolean; status: number | null; error: string | null; signature: string; payload: string }> {
  const hook = await db.webhook.findUnique({ where: { id } });
  if (!hook) throw new Error("Webhook tidak ditemukan");
  const body = buildBody(tenant, "webhook.test", {
    message: "Uji kirim webhook dari RekanKerja HRIS — konfigurasi signature & endpoint Anda benar.",
  });
  const signature = signWebhookBody(hook.secret, body);
  const send = await postWebhook(hook.url, "webhook.test", signature, body);
  try {
    await db.webhookLog.create({
      data: {
        webhookId: hook.id, event: "webhook.test", payload: body,
        status: send.ok ? "delivered" : "failed",
        responseStatus: send.responseStatus, error: send.error,
        attempts: 1, nextRetryAt: null, lastError: null,
      },
    });
    await trimLogs(db);
  } catch { /* never */ }
  return { ok: send.ok, status: send.responseStatus, error: send.error, signature, payload: body };
}
