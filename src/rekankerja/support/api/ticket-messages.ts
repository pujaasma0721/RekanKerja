// RekanKerja — Online Support (FEAT-SUPPORT-P1): pesan chat + lampiran. =======
// =====================================================================
// GET  /api/rekankerja/support/tickets/[id]/messages — riwayat percakapan
//      (+ metadata lampiran per pesan; pemilik tiket / op manage).
// POST /api/rekankerja/support/tickets/[id]/messages — kirim pesan user
//      (multipart/form-data: body + files[] 0–5 — JPG/PNG/WEBP/PDF ≤5MB;
//      lampiran via attachment-service generik, entityType "SupportMessage").
//      Pesan tersimpan TANPA memanggil LLM — giliran AI dipicu endpoint
//      terpisah (ticket-agent) supaya kegagalan provider tidak membuang
//      pesan pengguna dan bisa di-retry.
//      Kirim ke tiket SELESAI → otomatis dibuka kembali (AKTIF) + catatan;
//      tiket DITUTUP → 409 (buka kembali dulu lewat PATCH).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  resolveSupportActor, supportActorDenied, ticketAccess,
} from "@/rekankerja/support/api/support-auth";
import {
  saveAttachment, attachmentsByEntityIds, MAX_ATTACHMENT_BYTES,
} from "@/rekankerja/shared/services/attachment-service";
import { tenantSlugOfSession } from "@/rekankerja/shared/api/attachments";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILES = 5;

/** Infer MIME dari ekstensi (fallback bila browser tidak mengirim file.type). */
function inferMime(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  };
  return map[ext] ?? null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const ticket = await a.db.supportTicket.findUnique({ where: { id } });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;

    const messages = await a.db.supportMessage.findMany({
      where: { ticketId: id },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, senderRole: true, senderName: true, body: true, createdAt: true },
    });
    const attMap = await attachmentsByEntityIds(
      a.db,
      "SupportMessage",
      messages.map((m) => m.id),
    );
    return NextResponse.json({
      messages: messages.map((m) => ({ ...m, attachments: attMap.get(m.id) ?? [] })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const ticket = await a.db.supportTicket.findUnique({ where: { id } });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;
    const t = ticket!;

    if (t.status === "DITUTUP") {
      return NextResponse.json(
        { error: "Percakapan sudah ditutup — buka kembali untuk melanjutkan" },
        { status: 409 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Request harus multipart/form-data dengan field body" },
        { status: 400 },
      );
    }
    const body = String(form.get("body") ?? "").trim();
    if (!body) return NextResponse.json({ error: "Pesan tidak boleh kosong" }, { status: 400 });
    if (body.length > 4000) {
      return NextResponse.json({ error: "Pesan maksimum 4.000 karakter" }, { status: 400 });
    }
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Jumlah lampiran maksimum ${MAX_FILES} file per pesan` }, { status: 400 });
    }
    // pre-validasi ringan (validasi penuh — magic number — tetap di saveAttachment).
    for (const f of files) {
      const mime = f.type || inferMime(f.name);
      if (!mime || !ALLOWED_MIME.has(mime)) {
        return NextResponse.json(
          { error: `Jenis file tidak didukung (${f.name}) — hanya JPG/PNG/WEBP/PDF yang boleh dilampirkan` },
          { status: 400 },
        );
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json(
          { error: `Ukuran file melebihi 5 MB (${f.name}) — kecilkan atau kompres file` },
          { status: 400 },
        );
      }
    }

    const now = new Date();
    const message = await a.db.supportMessage.create({
      data: {
        ticketId: t.id,
        senderRole: "USER",
        senderName: a.appUserName,
        body,
      },
      select: { id: true, senderRole: true, senderName: true, body: true, createdAt: true },
    });

    // lampiran → uploads/{slug}/{yyyy}/… + baris Attachment (entityId = pesan).
    const attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[] = [];
    if (files.length > 0) {
      const slug = await tenantSlugOfSession(req);
      if (!slug) {
        // tanpa slug folder upload tak bisa ditentukan — pesan tetap tersimpan,
        // lampiran ditolak eksplisit (konsisten, tidak diam-diam dibuang).
        return NextResponse.json(
          { error: "Sesi tenant tidak dapat diselesaikan — lampiran gagal disimpan (pesan Anda sudah tersimpan)" },
          { status: 500 },
        );
      }
      for (const f of files) {
        const mime = f.type || inferMime(f.name) || "application/octet-stream";
        try {
          const row = await saveAttachment(a.db, slug, {
            file: Buffer.from(await f.arrayBuffer()),
            fileName: f.name,
            mimeType: mime,
            entityType: "SupportMessage",
            entityId: message.id,
            uploadedBy: a.appUserId,
          });
          attachments.push({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: row.sizeBytes });
        } catch (e) {
          return NextResponse.json(
            { error: `${e instanceof Error ? e.message : "unknown"} (pesan Anda sudah tersimpan)` },
            { status: 400 },
          );
        }
      }
    }

    // lanjut percakapan pada tiket SELESAI → buka kembali otomatis.
    if (t.status === "SELESAI") {
      const nama = a.appUserName?.trim() || "pengguna";
      await a.db.$transaction([
        a.db.supportTicket.update({
          where: { id: t.id },
          data: { status: "AKTIF", closedAt: null, lastMessageAt: now },
        }),
        a.db.supportMessage.create({
          data: {
            ticketId: t.id,
            senderRole: "SYSTEM",
            senderName: "Sistem",
            body: `Percakapan dilanjutkan kembali oleh ${nama}.`,
          },
        }),
      ]);
    } else {
      await a.db.supportTicket.update({ where: { id: t.id }, data: { lastMessageAt: now } });
    }

    return NextResponse.json({ message: { ...message, attachments } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
