import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { DEFAULT_TEMPLATES_PLACEHOLDER } from "@/onevity/shared/services/email-defaults";

// ============ TEMPLATE EMAIL (Task 34) ============
// GET  — daftar template (self-heal seed default bila kosong)
// PUT  — perbarui satu template (guard aksi update menu settings:email)

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // self-heal: seed template default bila tabel kosong
    const count = await db.emailTemplate.count();
    if (count === 0) {
      for (const t of DEFAULT_TEMPLATES_PLACEHOLDER) {
        await db.emailTemplate.upsert({ where: { event: t.event }, update: {}, create: t });
      }
    }

    const templates = await db.emailTemplate.findMany({ orderBy: { event: "asc" } });
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest | Request) {
  try {
    const m = await requireMenuAction(req, "settings:email", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const event = String(b.event ?? "");
    const tpl = await db.emailTemplate.findUnique({ where: { event } });
    if (!tpl) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });

    const subject = String(b.subject ?? tpl.subject).slice(0, 300);
    const body = String(b.body ?? tpl.body).slice(0, 5000);
    const active = b.active !== undefined ? Boolean(b.active) : tpl.active;
    const notifyEmployee = b.notifyEmployee !== undefined ? Boolean(b.notifyEmployee) : tpl.notifyEmployee;
    const notifyApprover = b.notifyApprover !== undefined ? Boolean(b.notifyApprover) : tpl.notifyApprover;
    const notifyHrd = b.notifyHrd !== undefined ? Boolean(b.notifyHrd) : tpl.notifyHrd;

    if (active && !subject.trim()) {
      return NextResponse.json({ error: "Subjek template tidak boleh kosong" }, { status: 400 });
    }

    const saved = await db.emailTemplate.update({
      where: { event },
      data: { subject, body, active, notifyEmployee, notifyApprover, notifyHrd },
    });

    await db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "EmailTemplate", entityId: saved.id,
        detail: `Template email "${saved.label}" ${active ? "diaktifkan" : "dinonaktifkan"} oleh ${m.actor.name}`,
      },
    });

    return NextResponse.json({ template: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
