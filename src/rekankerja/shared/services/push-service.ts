// RekanKerja — SERVICE WEB PUSH (P2.2-BM · D-BM17) =======================
// =====================================================================
// Web push notification per AppUser (opt-in), self-hosted tanpa layanan
// pihak ketiga (VAPID):
//   · getPushConfig(db)          — self-seed pasangan kunci VAPID tenant;
//                                   vapidPrivate TERENKRIPSI enc:v1:t:…
//   · pushStatusForUser(db, id)  — {enabled, subscribed} utk chip UI;
//   · subscribePush(db, …)       — upsert idempoten (endpoint terenkripsi +
//                                   endpointHash blind-index utk keunikan);
//   · unsubscribePush/All(db, …) — opt-out perlangganan;
//   · sendWebPushToUser(db, …)   — kirim payload {title, body, link, tag}
//                                   ke semua langganan aktif user.
//
// Prinsip (pola email-service): NEVER-THROW di jalur emisi — kegagalan
// push TIDAK PERNAH mengganggu proses bisnis utama (approval dsb.).
// Subscription mati (push service 404/410) dibersihkan otomatis.
// Library web-push diimput LAZY saat runtime (server-only) — paket tak
// terpasang → fitur didegradasi tenang, aplikasi tetap jalan.
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, tenantSchemaOfDb } from "@/rekankerja/shared/lib/field-crypto";
import { createHash } from "node:crypto";

// ---- lazy import web-push (server-only; pola createTransport email-service) ----
type WebPushModule = typeof import("web-push");

async function loadWebPush(): Promise<WebPushModule> {
  let mod: WebPushModule;
  try {
    mod = await import("web-push");
  } catch {
    throw new Error("Library web push (web-push) belum terpasang — jalankan `bun install` lalu restart server dev");
  }
  // interop CJS: implementasi asli berada di .default (namespace juga valid)
  return (mod as unknown as { default?: WebPushModule }).default ?? mod;
}

/** Error bawaan web-push — statusCode HTTP push service (404/410 = mati). */
interface WebPushLikeError extends Error {
  statusCode?: number;
}

// ============ KONFIGURASI VAPID (self-seed per schema tenant) ============

export interface PushConfigResolved {
  publicKey: string;
  privateKey: string;
  row: { id: string; vapidPublic: string; updatedAt: Date };
}

/** Cache kecil hasil resolve config per schema (pola tenant-db cache —
 *  key = nama schema; SELF-HEAL: baris DB yang berubah/hilang akan
 *  terbaca ulang bila privateKey tak bisa didekripsi). */
const configCache = new Map<string, { publicKey: string; privateKey: string; checkedAt: number }>();
const CONFIG_TTL_MS = 5 * 60 * 1000; // re-validasi baris DB tiap 5 menit

/** Tulis ActivityLog aktor SYSTEM — never-throw (pola writeActivity job scheduler). */
async function logSystem(
  db: TenantDb,
  data: { action: string; entity: string; entityId?: string | null; appUserId?: string | null; detail: string },
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        actorType: "system",
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        appUserId: data.appUserId ?? null,
        detail: data.detail,
      },
    });
  } catch {
    // audit trail tidak boleh mengganggu fitur — senyap
  }
}

/**
 * Ambil (atau self-seed) konfigurasi VAPID tenant. Baris pertama
 * PushConfig dibuat otomatis bila belum ada — kunci privat disimpan
 * TERENKRIPSI (enc:v1:t:…) via field-crypto; kunci publik plaintext
 * (memang dibagikan ke browser utk pushManager.subscribe).
 */
export async function getPushConfig(db: TenantDb): Promise<PushConfigResolved | null> {
  try {
    const tc = tenantCryptoForDb(db);

    // jalur cepat: cache segar + baris masih ada (self-heal via TTL re-check)
    let row = await db.pushConfig.findFirst();
    if (!row) {
      // self-seed: generate pasangan kunci VAPID baru
      const webpush = await loadWebPush();
      const keys = webpush.generateVAPIDKeys();
      row = await db.pushConfig.create({
        data: {
          vapidPublic: keys.publicKey,
          vapidPrivate: tc.encryptText(keys.privateKey) ?? keys.privateKey,
        },
      });
      await logSystem(db, {
        action: "Created",
        entity: "PushConfig",
        entityId: row.id,
        detail: "Self-seed pasangan kunci VAPID web push tenant (private terenkripsi)",
      });
    }

    // dekripsi kunci privat — bila gagal (rotasi kunci dsb.) → regenerasi
    let privateKey = tc.decryptText(row.vapidPrivate);
    if (!privateKey) {
      const webpush = await loadWebPush();
      const keys = webpush.generateVAPIDKeys();
      const updated = await db.pushConfig.update({
        where: { id: row.id },
        data: {
          vapidPublic: keys.publicKey,
          vapidPrivate: tc.encryptText(keys.privateKey) ?? keys.privateKey,
        },
      });
      row = updated;
      privateKey = keys.privateKey;
      await logSystem(db, {
        action: "Updated",
        entity: "PushConfig",
        entityId: row.id,
        detail: "Regenerasi kunci VAPID (private lama tak terdekripsi)",
      });
    }

    configCache.set(schemaOf(db), { publicKey: row.vapidPublic, privateKey, checkedAt: Date.now() });
    return { publicKey: row.vapidPublic, privateKey, row: { id: row.id, vapidPublic: row.vapidPublic, updatedAt: row.updatedAt } };
  } catch (e) {
    console.warn("[push] getPushConfig gagal:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Kunci config ter-cache (atau resolve ulang bila kosong/lama). */
async function vapidKeysOf(db: TenantDb): Promise<{ publicKey: string; privateKey: string } | null> {
  const schema = schemaOf(db);
  const cached = schema ? configCache.get(schema) : undefined;
  if (cached && Date.now() - cached.checkedAt < CONFIG_TTL_MS) return cached;
  const cfg = await getPushConfig(db);
  return cfg ? { publicKey: cfg.publicKey, privateKey: cfg.privateKey } : null;
}

/** Nama schema tenant dari instance db ("" bila client transaksi tanpa brand). */
function schemaOf(db: TenantDb): string {
  try {
    return tenantSchemaOfDb(db);
  } catch {
    return "";
  }
}

// ============ STATUS ============

export interface PushStatus {
  /** push service siap (config VAPID self-seed sukses). */
  enabled: boolean;
  /** user punya ≥1 langganan aktif. */
  subscribed: boolean;
}

/** Status opt-in utk UI (GET chip). */
export async function pushStatusForUser(db: TenantDb, appUserId: string): Promise<PushStatus> {
  try {
    const keys = await vapidKeysOf(db);
    if (!keys) return { enabled: false, subscribed: false };
    const n = await db.pushSubscription.count({ where: { appUserId } });
    return { enabled: true, subscribed: n > 0 };
  } catch {
    return { enabled: false, subscribed: false };
  }
}

// ============ SUBSCRIBE / UNSUBSCRIBE ============

const B64URL_RE = /^[A-Za-z0-9_-]{16,512}$/;

/** Endpoint valid: https://… atau http://127.0.0.1… (test harness lokal). */
function validEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && u.hostname === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

export interface SubscribeInput {
  appUserId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Daftarkan (upsert idempoten) langganan push. endpoint + p256dh + auth
 * disimpan TERENKRIPSI; endpointHash = blind-index utk constraint unik
 * [appUserId, endpointHash] — endpoint sama tidak menumpuk baris.
 */
export async function subscribePush(db: TenantDb, input: SubscribeInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const endpoint = (input.endpoint ?? "").trim();
    const p256dh = (input.p256dh ?? "").trim();
    const auth = (input.auth ?? "").trim();
    if (!input.appUserId) return { ok: false, error: "Pengguna tidak valid" };
    if (!validEndpoint(endpoint)) return { ok: false, error: "Endpoint push tidak valid" };
    if (!B64URL_RE.test(p256dh) || !B64URL_RE.test(auth)) {
      return { ok: false, error: "Kunci langganan push (p256dh/auth) tidak valid" };
    }

    const tc = tenantCryptoForDb(db);
    // blind-index utk keunikan; fallback sha256 hex bila konteks tak tersedia
    const endpointHash =
      tc.blindIndex(endpoint) ??
      "sha256:" + createHash("sha256").update(endpoint).digest("hex");

    // upsert idempoten: kombinasi [appUserId, endpointHash] dihapus dulu
    // lalu dibuat ulang (kunci p256dh/auth bisa berubah utk endpoint sama)
    const existing = await db.pushSubscription.findFirst({
      where: { appUserId: input.appUserId, endpointHash },
      select: { id: true },
    });
    if (existing) {
      const row = await db.pushSubscription.update({
        where: { id: existing.id },
        data: {
          endpoint: tc.encryptText(endpoint) ?? endpoint,
          p256dh: tc.encryptText(p256dh) ?? p256dh,
          auth: tc.encryptText(auth) ?? auth,
        },
        select: { id: true },
      });
      return { ok: true, id: row.id };
    }
    const row = await db.pushSubscription.create({
      data: {
        appUserId: input.appUserId,
        endpoint: tc.encryptText(endpoint) ?? endpoint,
        endpointHash,
        p256dh: tc.encryptText(p256dh) ?? p256dh,
        auth: tc.encryptText(auth) ?? auth,
      },
      select: { id: true },
    });
    // ActivityLog TANPA endpoint penuh — host saja (minimisasi PII)
    const host = (() => { try { return new URL(endpoint).host; } catch { return "?"; } })();
    await logSystem(db, {
      action: "Created",
      entity: "PushSubscription",
      entityId: row.id,
      appUserId: input.appUserId,
      detail: `Langganan web push baru (endpoint host: ${host})`,
    });
    return { ok: true, id: row.id };
  } catch (e) {
    console.warn("[push] subscribePush gagal:", e instanceof Error ? e.message : e);
    return { ok: false, error: "Gagal menyimpan langganan push" };
  }
}

/** Hapus SATU langganan (endpoint spesifik — opt-out per browser). */
export async function unsubscribePush(db: TenantDb, input: { appUserId: string; endpoint: string }): Promise<number> {
  try {
    const endpoint = (input.endpoint ?? "").trim();
    if (!input.appUserId || !endpoint) return 0;
    const tc = tenantCryptoForDb(db);
    const endpointHash =
      tc.blindIndex(endpoint) ??
      "sha256:" + createHash("sha256").update(endpoint).digest("hex");
    const removed = await db.pushSubscription.deleteMany({
      where: { appUserId: input.appUserId, endpointHash },
    });
    if (removed.count > 0) {
      const host = (() => { try { return new URL(endpoint).host; } catch { return "?"; } })();
      await logSystem(db, {
        action: "Deleted",
        entity: "PushSubscription",
        appUserId: input.appUserId,
        detail: `Opt-out web push (endpoint host: ${host}) — ${removed.count} baris`,
      });
    }
    return removed.count;
  } catch {
    return 0;
  }
}

/** Hapus SEMUA langganan seorang user (opt-out total). */
export async function unsubscribeAll(db: TenantDb, appUserId: string): Promise<number> {
  try {
    if (!appUserId) return 0;
    const removed = await db.pushSubscription.deleteMany({ where: { appUserId } });
    if (removed.count > 0) {
      await logSystem(db, {
        action: "Deleted",
        entity: "PushSubscription",
        appUserId,
        detail: `Opt-out web push semua perangkat — ${removed.count} baris`,
      });
    }
    return removed.count;
  } catch {
    return 0;
  }
}

// ============ KIRIM ============

export interface WebPushPayload {
  title: string;
  body?: string;
  /** link navigasi "section:view" (bell admin) / "ess:…" — SW membuka root. */
  link?: string;
  /** tag utk coalesce notifikasi di perangkat (mis. kind emisi). */
  tag?: string;
}

export interface SendResultCounters {
  /** jumlah push sukses terkirim. */
  sent: number;
  /** jumlah langganan mati yang dibersihkan (404/410). */
  pruned: number;
}

/**
 * Kirim web push ke SEMUA langganan aktif seorang AppUser. NEVER-THROW:
 * error per-langganan ditelan (kecuali 404/410 → baris dihapus — dead
 * subscription cleanup); return {sent, pruned}.
 */
export async function sendWebPushToUser(db: TenantDb, appUserId: string, payload: WebPushPayload): Promise<SendResultCounters> {
  const out: SendResultCounters = { sent: 0, pruned: 0 };
  try {
    if (!appUserId || !payload?.title?.trim()) return out;
    const keys = await vapidKeysOf(db);
    if (!keys) return out; // config VAPID tak tersedia → fitur off tenang

    const rows = await db.pushSubscription.findMany({
      where: { appUserId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
      take: 50,
    });
    if (rows.length === 0) return out;

    const tc = tenantCryptoForDb(db);
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? "",
      link: payload.link ?? undefined,
      tag: payload.tag ?? "app",
    });

    for (const row of rows) {
      const endpoint = tc.decryptText(row.endpoint);
      const p256dh = tc.decryptText(row.p256dh);
      const auth = tc.decryptText(row.auth);
      if (!endpoint || !p256dh || !auth) continue; // baris korup → skip tenang
      try {
        await __webpushSend(
          { endpoint, keys: { p256dh, auth } },
          body,
          {
            vapidDetails: {
              subject: "mailto:hr@rekankerja.local",
              publicKey: keys.publicKey,
              privateKey: keys.privateKey,
            },
            TTL: 3600,
          },
        );
        out.sent++;
      } catch (e) {
        const statusCode = (e as WebPushLikeError)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // push service menyatakan langganan mati → bersihkan baris
          await db.pushSubscription.delete({ where: { id: row.id } }).catch(() => {});
          out.pruned++;
        }
        // error lain (jaringan dsb.) → swallow — never-throw keseluruhan
      }
    }
    return out;
  } catch (e) {
    console.warn("[push] sendWebPushToUser gagal:", e instanceof Error ? e.message : e);
    return out;
  }
}

/**
 * Wrapper tipis webpush.sendNotification — diekspor agar harness e2e bisa
 * mengirim/menguji langsung (assert header VAPID di receiver lokal).
 */
export async function __webpushSend(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options?: import("web-push").RequestOptions,
): Promise<void> {
  const webpush = await loadWebPush();
  await webpush.sendNotification(subscription, payload, options);
}
