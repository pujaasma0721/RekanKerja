// RekanKerja — Online Support (FEAT-SUPPORT-P1): stream lampiran chat. ========
// =====================================================================
// GET /api/rekankerja/support/attachments/[id] — stream isi lampiran pesan
// support (inline; ?download=1 → attachment). Otorisasi: pemilik tiket atau
// pemegang op support:service/manage — bukan endpoint lampiran generik
// (yang diguard menu entitas HR; lampiran support milik percakapan pribadi).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  resolveSupportActor, supportActorDenied, ticketAccess,
} from "@/rekankerja/support/api/support-auth";
import { getAttachmentById, readAttachmentFile } from "@/rekankerja/shared/services/attachment-service";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });

    const row = await getAttachmentById(a.db, id);
    if (!row || row.entityType !== "SupportMessage") {
      return NextResponse.json({ error: "Tiket tidak ditemukan" }, { status: 404 });
    }
    const message = await a.db.supportMessage.findUnique({
      where: { id: row.entityId },
      select: { ticketId: true },
    });
    const ticket = message
      ? await a.db.supportTicket.findUnique({ where: { id: message.ticketId } })
      : null;
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;

    let bytes: Buffer;
    try {
      bytes = await readAttachmentFile(row);
    } catch {
      return NextResponse.json({ error: "Berkas fisik lampiran tidak ditemukan di penyimpanan" }, { status: 404 });
    }

    const download = req.nextUrl.searchParams.get("download") === "1";
    // nama file aman ASCII + bentuk RFC 5987 utk karakter non-ASCII (pola T16).
    const ascii = row.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
    const disposition =
      `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.fileName)}`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": row.mimeType,
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
