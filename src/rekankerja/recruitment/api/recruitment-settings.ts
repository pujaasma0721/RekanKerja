import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuViewAny, requireMenuAction, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { tenantSchemaOfDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  getRecruitmentSetting, setRecruitmentSetting, listRecruitmentSettings,
  RECRUITMENT_SETTING_KEYS, getSiteConfig, saveSiteConfig, type SiteConfigRow,
} from "@/rekankerja/recruitment/services/recruitment-setting-service";
import {
  upsertWebhookEndpoint, deleteWebhookEndpoint, listWebhookEndpoints,
  listWebhookDeliveries, sendTestWebhook, processWebhookDeliveries,
  RECRUITMENT_WEBHOOK_EVENTS,
} from "@/rekankerja/recruitment/services/webhook-service";
import {
  createEsignRequest, resendEsignOtp, cancelEsignRequest, listEsignRequests,
} from "@/rekankerja/recruitment/services/recruitment-esign-service";

// ============================================================================
// RECRUITMENT F7 — API Pengaturan Rekrutmen (webhook + otomasi + preferensi
// notifikasi + e-sign kandidat). Guard: menu recruitment:settings
//   GET  → { webhooks, events, deliveries, settings, myPref, esignRequests,
//          siteConfig } (B7 — branding portal karier)
//   POST { action: webhook-save|webhook-delete|webhook-test (op:webhook) |
//                 automation-set|pref-set|site-config-save (op:update) |
//                 esign-request|esign-resend|esign-cancel (op:esign) }
// pref-set SELALU utk aktor sendiri (upsert NotificationPref employeeId).
// ============================================================================

/** Slug registry Tenant milik client Prisma tenant (CareerSiteConfig key). */
async function tenantSlugOf(db: TenantDb): Promise<string | null> {
  try {
    const row = await platformDb.tenant.findUnique({
      where: { schemaName: tenantSchemaOfDb(db) }, select: { slug: true },
    });
    return row?.slug ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:settings"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const [webhooks, deliveries, settings, esignRequests] = await Promise.all([
      listWebhookEndpoints(db),
      listWebhookDeliveries(db, 30),
      listRecruitmentSettings(db),
      listEsignRequests(db, 20),
    ]);

    // B7 — branding portal karier (row absen → default; slug tenant aktif)
    const slug = await tenantSlugOf(db);
    const siteConfig = slug ? await getSiteConfig(db, slug).catch(() => null) : null;

    let myPref = { inApp: true, email: true, digest: false };
    if (m.actor.employeeId) {
      const row = await db.notificationPref.findUnique({ where: { employeeId: m.actor.employeeId } }).catch(() => null);
      if (row) myPref = { inApp: row.inApp, email: row.email, digest: row.digest };
    }

    return NextResponse.json({
      webhooks,
      events: RECRUITMENT_WEBHOOK_EVENTS,
      deliveries,
      settings,
      settingKeys: RECRUITMENT_SETTING_KEYS,
      myPref,
      esignRequests,
      siteConfig: siteConfig ?? null,
      siteTenantSlug: slug,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  class GuardError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  }
  try {
    const b = await req.json();
    const action = String(b.action ?? "");
    const guard = async (op: "webhook" | "esign" | "update") => {
      // op kustom → "op:webhook"/"op:esign"; "update" adalah aksi standar
      const ref: MenuActionRef = op === "update" ? "update" : `op:${op}`;
      const m = await requireMenuAction(req, "recruitment:settings", ref);
      if (!m.ok) throw new GuardError(m.status, m.error);
      return m;
    };

    switch (action) {
      case "webhook-save": {
        const m = await guard("webhook");
        const row = await upsertWebhookEndpoint(m.db, {
          id: b.id ? String(b.id) : null,
          url: String(b.url ?? ""),
          events: Array.isArray(b.events) ? b.events.map(String) : [],
          active: Boolean(b.active),
          note: b.note ? String(b.note) : null,
          rotateSecret: Boolean(b.rotateSecret),
        }, { name: m.actor.name });
        return NextResponse.json({ webhook: row });
      }
      case "webhook-delete": {
        const m = await guard("webhook");
        await deleteWebhookEndpoint(m.db, String(b.id ?? ""));
        return NextResponse.json({ ok: true });
      }
      case "webhook-test": {
        const m = await guard("webhook");
        const res = await sendTestWebhook(m.db, String(b.id ?? ""));
        // coba langsung kirim antrean jatuh tempo (≤20 — termasuk test barusan)
        // supaya tombol Uji Kirim memberi umpan balik segera; job scheduler
        // tetap menjadi pengurai utama.
        const summary = await processWebhookDeliveries(m.db);
        return NextResponse.json({ ...res, summary });
      }
      case "automation-set": {
        const m = await guard("update");
        const key = String(b.key ?? "");
        if (!(RECRUITMENT_SETTING_KEYS as readonly string[]).includes(key)) {
          return NextResponse.json({ error: `Kunci pengaturan tidak dikenal: ${key}` }, { status: 400 });
        }
        const value = String(b.value ?? "").trim();
        if (value === "") return NextResponse.json({ error: "Nilai pengaturan wajib diisi" }, { status: 400 });
        if (key.startsWith("auto.")) {
          if (value !== "true" && value !== "false") {
            return NextResponse.json({ error: "Nilai otomasi harus \"true\" atau \"false\"" }, { status: 400 });
          }
        } else if (key.startsWith("retention.months.")) {
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 120) {
            return NextResponse.json({ error: "Retensi (bulan) harus bilangan bulat 1–120" }, { status: 400 });
          }
        } else if (key === "retention.anonymize") {
          if (value !== "true" && value !== "false") {
            return NextResponse.json({ error: "Nilai anonimisasi harus \"true\" atau \"false\"" }, { status: 400 });
          }
        }
        await setRecruitmentSetting(m.db, key, value, { employeeId: m.actor.employeeId, name: m.actor.name });
        return NextResponse.json({ ok: true, key, value: await getRecruitmentSetting(m.db, key, value) });
      }
      case "pref-set": {
        const m = await guard("update");
        if (!m.actor.employeeId) {
          return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan — preferensi tidak tersedia" }, { status: 400 });
        }
        const data: { inApp?: boolean; email?: boolean; digest?: boolean } = {};
        if (b.inApp !== undefined) data.inApp = Boolean(b.inApp);
        if (b.email !== undefined) data.email = Boolean(b.email);
        if (b.digest !== undefined) data.digest = Boolean(b.digest);
        if (Object.keys(data).length === 0) {
          return NextResponse.json({ error: "Tidak ada preferensi yang diubah (inApp/email/digest)" }, { status: 400 });
        }
        const row = await m.db.notificationPref.upsert({
          where: { employeeId: m.actor.employeeId },
          create: { employeeId: m.actor.employeeId, ...data },
          update: data,
        });
        return NextResponse.json({ myPref: { inApp: row.inApp, email: row.email, digest: row.digest } });
      }
      case "site-config-save": {
        // B7 — branding portal karier (warna/logo/hero per tenant)
        const m = await guard("update");
        const slug = await tenantSlugOf(m.db);
        if (!slug) {
          return NextResponse.json({ error: "Tenant aktif tidak teridentifikasi — branding tidak tersimpan" }, { status: 400 });
        }
        let row: SiteConfigRow;
        try {
          row = await saveSiteConfig(m.db, slug, {
            brandColor: String(b.brandColor ?? ""),
            logoUrl: b.logoUrl == null ? null : String(b.logoUrl ?? ""),
            heroTitle: b.heroTitle == null ? null : String(b.heroTitle ?? ""),
            heroSub: b.heroSub == null ? null : String(b.heroSub ?? ""),
          }, { employeeId: m.actor.employeeId, name: m.actor.name });
        } catch (e) {
          return NextResponse.json({ error: e instanceof Error ? e.message : "Validasi branding gagal" }, { status: 400 });
        }
        return NextResponse.json({ siteConfig: row });
      }
      case "esign-request": {
        const m = await guard("esign");
        if (!m.actor.employeeId) {
          return NextResponse.json({ error: "Akun Anda tidak tertaut karyawan — tidak bisa meminta e-sign" }, { status: 400 });
        }
        const res = await createEsignRequest(m.db, {
          offerId: String(b.offerId ?? ""),
          requestedById: m.actor.employeeId,
        });
        return NextResponse.json(res, { status: 201 });
      }
      case "esign-resend": {
        const m = await guard("esign");
        const res = await resendEsignOtp(m.db, String(b.id ?? ""), m.actor.employeeId);
        return NextResponse.json(res);
      }
      case "esign-cancel": {
        const m = await guard("esign");
        const res = await cancelEsignRequest(m.db, String(b.id ?? ""));
        return NextResponse.json(res);
      }
      default:
        return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof Error && "status" in e && typeof (e as { status?: unknown }).status === "number") {
      return NextResponse.json({ error: e.message }, { status: (e as unknown as { status: number }).status });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
