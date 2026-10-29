import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { WA_DEFAULT_TEMPLATES } from "@/onevity/shared/services/wa-defaults";

// ============ TEMPLATE WHATSAPP (Task 28-a) ============
// GET   — daftar template (self-heal seed default insert-if-missing,
//         event-keyed, edit admin aman — upsert update:{} kosong)
// PATCH — perbarui satu template { id, label?, body?, active? }
//         (guard aksi update menu settings:whatsapp)

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // self-heal: insert-if-missing per event (edit admin tidak pernah ditimpa)
    for (const t of WA_DEFAULT_TEMPLATES) {
      await db.waTemplate
        .upsert({ where: { event: t.event }, update: {}, create: { event: t.event, label: t.label, active: t.active, body: t.body } })
        .catch(() => { /* best-effort */ });
    }

    const templates = await db.waTemplate.findMany({ orderBy: { event: "asc" } });
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:whatsapp", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id template wajib" }, { status: 400 });
    const tpl = await db.waTemplate.findUnique({ where: { id } });
    if (!tpl) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });

    const label = b.label !== undefined ? String(b.label).trim().slice(0, 100) : tpl.label;
    const body = b.body !== undefined ? String(b.body).slice(0, 1000) : tpl.body;
    const active = b.active !== undefined ? Boolean(b.active) : tpl.active;

    if (!label) return NextResponse.json({ error: "Label template tidak boleh kosong" }, { status: 400 });
    if (body.length > 1000) {
      return NextResponse.json({ error: "Isi pesan maksimal 1.000 karakter (batas praktis WhatsApp)" }, { status: 400 });
    }
    if (active && !body.trim()) {
      return NextResponse.json({ error: "Isi pesan tidak boleh kosong saat template aktif" }, { status: 400 });
    }

    const saved = await db.waTemplate.update({ where: { id }, data: { label, body, active } });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "WaTemplate", entityId: saved.id,
        detail: `Template WhatsApp "${saved.label}" ${active ? "diaktifkan" : "dinonaktifkan"} oleh ${m.actor.name}${b.body !== undefined ? " (isi pesan diubah)" : ""}`,
      },
    }).catch(() => { /* audit best-effort */ });

    return NextResponse.json({ template: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
