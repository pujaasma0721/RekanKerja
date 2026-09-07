import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/onevity/shared/services/menu-access";
import { LETTER_TEMPLATE_DEFAULTS } from "@/onevity/shared/lib/letter-defaults";

// GET (daftar template) | PATCH (edit template) | POST {action:"reset"} —
// Task 3-LETTERS: menu hr:templates (Dokumen & Surat → Template Surat).
// Template per tenant — isi bisa disesuaikan perusahaan, tombol reset
// mengembalikan ke bawaan sistem (LETTER_TEMPLATE_DEFAULTS).

const BODY_MAX = 20000;

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:templates", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const templates = await m.db.letterTemplate.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
    });
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:templates", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    if (typeof b.body === "string" && b.body.length > BODY_MAX) {
      return NextResponse.json({ error: `Isi surat maksimal ${BODY_MAX} karakter` }, { status: 400 });
    }
    const tpl = await db.letterTemplate.findUnique({ where: { id: b.id } });
    if (!tpl) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
    if (typeof b.description === "string") data.description = b.description.trim() || null;
    if (typeof b.subject === "string") data.subject = b.subject.trim() || null;
    if (typeof b.body === "string" && b.body.trim()) data.body = b.body;
    if (typeof b.signatoryName === "string") data.signatoryName = b.signatoryName.trim() || null; // "" → kosong (garis tanda tangan)
    if (typeof b.signatoryTitle === "string" && b.signatoryTitle.trim()) data.signatoryTitle = b.signatoryTitle.trim();
    if (typeof b.active === "boolean") data.active = b.active;

    const updated = await db.letterTemplate.update({ where: { id: tpl.id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "LetterTemplate", entityId: tpl.id,
        appUserId: actor.appUserId ?? undefined,
        detail: `Template surat ${updated.name} (${tpl.key}) diperbarui`,
      },
    });
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:templates", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const { db, actor } = m;

    const b = await req.json();
    if (b.action !== "reset" || !b.id) {
      return NextResponse.json({ error: "Hanya aksi reset yang didukung" }, { status: 400 });
    }
    const tpl = await db.letterTemplate.findUnique({ where: { id: b.id } });
    if (!tpl) return NextResponse.json({ error: "Template tidak ditemukan" }, { status: 404 });
    const def = LETTER_TEMPLATE_DEFAULTS.find((d) => d.key === tpl.key);
    if (!def) {
      return NextResponse.json({ error: `Tidak ada bawaan sistem untuk template ${tpl.key}` }, { status: 400 });
    }

    // kembalikan identitas + isi ke bawaan (active & signatoryName custom dibiarkan)
    const updated = await db.letterTemplate.update({
      where: { id: tpl.id },
      data: {
        name: def.name,
        description: def.description ?? null,
        subject: def.subject ?? null,
        body: def.body,
        signatoryTitle: def.signatoryTitle,
      },
    });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "LetterTemplate", entityId: tpl.id,
        appUserId: actor.appUserId ?? undefined,
        detail: `Template surat ${updated.name} (${tpl.key}) dikembalikan ke bawaan sistem`,
      },
    });
    return NextResponse.json({ template: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
