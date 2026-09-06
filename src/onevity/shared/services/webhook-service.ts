// OneVity Webhook Service (T18-API) — kirim event HRIS ke endpoint tenant.
// =====================================================================
// dispatchWebhookEvent(db, tenant, event, payload): semua webhook AKTIF yang
// berlangganan event tsb → POST JSON dgn header:
//   X-OneVity-Event:    <event>
//   X-OneVity-Signature: hex HMAC-SHA256(secret, body) — verifikasi asal
// Timeout 5 detik (AbortSignal.timeout). Setiap kirim dicatat ke WebhookLog
// (status Sent/Failed + responseStatus + error; payload = body persis yang
// dikirim supaya penerima/supervisor bisa verifikasi ulang signature).
// Housekeeping: maks 500 baris log per tenant (terlama dihapus).
// NEVER-THROW: aman dipanggil `void dispatchWebhookEvent(...)` di titik
// event bisnis — kegagalan kirim tidak pernah menggagalkan proses utama.
import { createHmac, randomBytes } from "node:crypto";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

/** Katalog event yang bisa dilanggan (csv Webhook.events). */
export const WEBHOOK_EVENTS: { key: string; label: string }[] = [
  { key: "leave.submitted", label: "Cuti — pengajuan baru" },
  { key: "leave.approved", label: "Cuti — disetujui (final)" },
  { key: "leave.rejected", label: "Cuti — ditolak (final)" },
  { key: "payroll.confirmed", label: "Payroll — run dikonfirmasi" },
  { key: "payroll.paid", label: "Payroll — run ditandai dibayar" },
  { key: "workoff.approved", label: "Izin tidak masuk — disetujui (final)" },
  { key: "workoff.rejected", label: "Izin tidak masuk — ditolak (final)" },
];

export function webhookEventLabel(key: string): string {
  return WEBHOOK_EVENTS.find((e) => e.key === key)?.label ?? key;
}

/** Timeout kirim webhook. */
const FETCH_TIMEOUT_MS = 5_000;
/** Maks baris WebhookLog per tenant (terlama dihapus). */
export const WEBHOOK_LOG_KEEP = 500;

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

export interface DispatchResult {
  event: string;
  sent: number;
  failed: number;
  /** detail per webhook (utk log/testing). */
  details: { webhookId: string; url: string; status: "Sent" | "Failed"; responseStatus: number | null; error: string | null }[];
}

/**
 * Kirim event ke semua webhook AKTIF yang berlangganan event tersebut.
 * `tenant`: label tenant utk envelope (null → nama perusahaan tenant, diresolusi
 * lazy HANYA bila ada penerima aktif). NEVER-THROW — selalu resolve dengan
 * ringkasan hasil.
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
      let status: "Sent" | "Failed" = "Sent";
      let responseStatus: number | null = null;
      let error: string | null = null;
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-OneVity-Event": event,
            "X-OneVity-Signature": signature,
          },
          body,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        responseStatus = res.status;
        if (res.status >= 400) {
          status = "Failed";
          error = `HTTP ${res.status}`;
        }
      } catch (e) {
        status = "Failed";
        error = e instanceof Error ? e.message : String(e);
      }
      result.details.push({ webhookId: hook.id, url: hook.url, status, responseStatus, error });
      if (status === "Sent") result.sent += 1;
      else result.failed += 1;
      try {
        await db.webhookLog.create({
          data: { webhookId: hook.id, event, payload: body, status, responseStatus, error },
        });
      } catch {
        // log gagal ditulis — kirim tetap dianggap selesai (never-throw)
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

/**
 * Uji kirim (ping): kirim event "webhook.test" LANGSUNG ke satu webhook
 * (tak peduli langganan event) — dipakai tombol "Uji Kirim" di settings.
 */
export async function sendTestWebhook(
  db: TenantDb,
  id: string,
  tenant: string,
): Promise<{ ok: boolean; status: number | null; error: string | null; signature: string; payload: string }> {
  const hook = await db.webhook.findUnique({ where: { id } });
  if (!hook) throw new Error("Webhook tidak ditemukan");
  const body = buildBody(tenant, "webhook.test", {
    message: "Uji kirim webhook dari OneVity HRIS — konfigurasi signature & endpoint Anda benar.",
  });
  const signature = signWebhookBody(hook.secret, body);
  let status: "Sent" | "Failed" = "Sent";
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OneVity-Event": "webhook.test",
        "X-OneVity-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    responseStatus = res.status;
    if (res.status >= 400) {
      status = "Failed";
      error = `HTTP ${res.status}`;
    }
  } catch (e) {
    status = "Failed";
    error = e instanceof Error ? e.message : String(e);
  }
  try {
    await db.webhookLog.create({
      data: { webhookId: hook.id, event: "webhook.test", payload: body, status, responseStatus, error },
    });
    await trimLogs(db);
  } catch { /* never */ }
  return { ok: status === "Sent", status: responseStatus, error, signature, payload: body };
}
