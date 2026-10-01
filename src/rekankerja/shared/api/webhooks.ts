// ============ WEBHOOKS (T18-API) — manajemen endpoint & log ============
// GET    ?webhookId=&logLimit= → daftar webhook + log pengiriman terakhir
// POST   → buat webhook { url, events[], secret?, isActive? }
//          ATAU { action: "test", id } → UJI KIRIM ping event "webhook.test"
// PATCH  → ubah { id, url?, events?, secret?, isActive? }
// DELETE ?id= → hapus webhook (+ log ikut terhapus, onDelete Cascade)
// Guard: menu settings:api + HANYA Admin platform / AppUser Admin (fail-closed).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, type MenuActor } from "@/rekankerja/shared/services/menu-access";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/rekankerja/shared/services/access-scope";
import {
  listWebhooks, listWebhookLogs, createWebhook, updateWebhook, deleteWebhook,
  sendTestWebhook, normalizeEvents, generateWebhookSecret, WEBHOOK_EVENTS,
} from "@/rekankerja/shared/services/webhook-service";

/** Fail-closed: hanya platform OWNER/ADMIN atau AppUser Admin. */
function isAdminActor(actor: MenuActor): boolean {
  return (
    SUPER_ADMIN_PLATFORM_ROLES.includes(actor.role) ||
    (actor.appUserRole != null && SUPER_ADMIN_APP_ROLES.includes(actor.appUserRole))
  );
}

const ADMIN_ONLY_MSG =
  "Akses ditolak: webhook hanya boleh dikelola oleh Admin platform / AppUser Admin (superadmin).";

async function audit(
  db: Parameters<typeof listWebhooks>[0],
  actor: MenuActor,
  action: string,
  detail: string,
): Promise<void> {
  await db.activityLog
    .create({ data: { appUserId: actor.appUserId ?? null, action, entity: "Webhook", detail } })
    .catch(() => { /* audit gagal — jangan gagalkan aksi */ });
}

// GET — daftar webhook + log pengiriman terakhir (default 10)
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:api", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const sp = req.nextUrl.searchParams;
    const webhookId = sp.get("webhookId") ?? undefined;
    const logLimit = sp.get("logLimit") ? Number(sp.get("logLimit")) : 10;
    const [webhooks, logs] = await Promise.all([
      listWebhooks(m.db),
      listWebhookLogs(m.db, Number.isFinite(logLimit) ? logLimit : 10, webhookId),
    ]);
    return NextResponse.json({ webhooks, logs, events: WEBHOOK_EVENTS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat webhook ATAU uji kirim (action: "test")
export async function POST(req: NextRequest | Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ---- Uji Kirim (ping event "webhook.test") — op:test menu settings:api ----
    if (b.action === "test") {
      const m = await requireMenuAction(req, "settings:api", "op:test");
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });
      const id = String(b.id ?? "");
      if (!id) return NextResponse.json({ error: "id webhook wajib" }, { status: 400 });
      const res = await sendTestWebhook(m.db, id, m.actor.name);
      await audit(
        m.db, m.actor, "Updated",
        `Uji kirim webhook ${id} oleh ${m.actor.name} → ${res.ok ? "Sent" : "Failed"}${res.status ? ` (HTTP ${res.status})` : ""}${res.error ? ` — ${res.error}` : ""}`,
      );
      return NextResponse.json(res, { status: res.ok ? 200 : 502 });
    }

    // ---- buat webhook baru ----
    const m = await requireMenuAction(req, "settings:api", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const url = String(b.url ?? "").trim();
    if (!url) return NextResponse.json({ error: "URL webhook wajib diisi" }, { status: 400 });
    const events = normalizeEvents(b.events);
    if (events.length === 0) {
      return NextResponse.json({ error: "Pilih minimal satu event webhook" }, { status: 400 });
    }
    const secret = b.secret === undefined ? generateWebhookSecret() : String(b.secret).trim() || generateWebhookSecret();
    const webhook = await createWebhook(m.db, {
      url, events, secret, isActive: b.isActive === undefined ? true : Boolean(b.isActive),
    });
    await audit(
      m.db, m.actor, "Created",
      `Webhook ${webhook.url} dibuat oleh ${m.actor.name} — events: ${events.join(", ")} (${webhook.isActive ? "aktif" : "nonaktif"})`,
    );
    return NextResponse.json({ webhook }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH — ubah webhook (url / events / secret / isActive)
export async function PATCH(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:api", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    try {
      const webhook = await updateWebhook(m.db, {
        id,
        url: b.url !== undefined ? String(b.url) : undefined,
        events: b.events !== undefined ? normalizeEvents(b.events) : undefined,
        secret: b.secret !== undefined ? String(b.secret) : undefined,
        isActive: b.isActive !== undefined ? Boolean(b.isActive) : undefined,
      });
      await audit(
        m.db, m.actor, "Updated",
        `Webhook ${webhook.url} diperbarui oleh ${m.actor.name} — ${webhook.isActive ? "aktif" : "nonaktif"}, events: ${webhook.events.join(", ")}`,
      );
      return NextResponse.json({ webhook });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE ?id= — hapus webhook
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:api", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    if (!isAdminActor(m.actor)) return NextResponse.json({ error: ADMIN_ONLY_MSG }, { status: 403 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const hooks = await listWebhooks(m.db);
    const target = hooks.find((h) => h.id === id);
    await deleteWebhook(m.db, id);
    await audit(m.db, m.actor, "Deleted", `Webhook ${target?.url ?? id} dihapus oleh ${m.actor.name} (riwayat log ikut terhapus)`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
