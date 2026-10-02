import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";

// ============ BASIS PENGETAHUAN AI (Task 96 — admin) ================
//   GET                       → daftar dokumen (tanpa isi penuh di list)
//   POST { title, content, active? }        → tambah (guard update)
//   PATCH { id, title?, content?, active? }  → ubah (guard update)
//   DELETE ?id=                              → hapus (guard delete)
// =====================================================================

const MAX_CONTENT = 8000;

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const docs = await db.aiKnowledgeDoc.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, content: true, active: true, updatedBy: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ docs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-knowledge", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(b.title ?? "").trim().slice(0, 160);
    const content = String(b.content ?? "").trim().slice(0, MAX_CONTENT);
    if (!title) return NextResponse.json({ error: "Judul wajib diisi" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Isi dokumen wajib diisi" }, { status: 400 });

    const doc = await m.db.aiKnowledgeDoc.create({
      data: { title, content, active: b.active !== false, updatedBy: m.actor.name },
    });
    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Created", entity: "AiKnowledgeDoc", entityId: doc.id,
        detail: `Dokumen basis pengetahuan "${title}" ditambahkan oleh ${m.actor.name}`,
      },
    }).catch(() => {});
    return NextResponse.json({ doc }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-knowledge", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const doc = await m.db.aiKnowledgeDoc.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });

    const title = b.title !== undefined ? String(b.title).trim().slice(0, 160) : doc.title;
    const content = b.content !== undefined ? String(b.content).trim().slice(0, MAX_CONTENT) : doc.content;
    const active = b.active !== undefined ? Boolean(b.active) : doc.active;
    if (!title) return NextResponse.json({ error: "Judul tidak boleh kosong" }, { status: 400 });
    if (!content) return NextResponse.json({ error: "Isi tidak boleh kosong" }, { status: 400 });

    const saved = await m.db.aiKnowledgeDoc.update({
      where: { id },
      data: { title, content, active, updatedBy: m.actor.name },
    });
    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Updated", entity: "AiKnowledgeDoc", entityId: id,
        detail: `Dokumen basis pengetahuan "${title}" diperbarui oleh ${m.actor.name}${b.active !== undefined ? ` — ${active ? "diaktifkan" : "dinonaktifkan"}` : ""}`,
      },
    }).catch(() => {});
    return NextResponse.json({ doc: saved });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "settings:ai-knowledge", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Parameter ?id= wajib" }, { status: 400 });
    const doc = await m.db.aiKnowledgeDoc.findUnique({ where: { id } });
    if (!doc) return NextResponse.json({ error: "Dokumen tidak ditemukan" }, { status: 404 });
    await m.db.aiKnowledgeDoc.delete({ where: { id } });
    await m.db.activityLog.create({
      data: {
        appUserId: m.actor.appUserId ?? null,
        action: "Deleted", entity: "AiKnowledgeDoc", entityId: id,
        detail: `Dokumen basis pengetahuan "${doc.title}" dihapus oleh ${m.actor.name}`,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
