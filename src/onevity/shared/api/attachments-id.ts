// OneVity — API lampiran per-id (T16-ATTACH). ==============================
// =====================================================================
// GET    /api/onevity/attachments/[id]            — stream file (inline;
//        ?download=1 → attachment) — otorisasi: user login tenant sama.
// DELETE /api/onevity/attachments/[id]            — hapus file+baris.
//        Diizinkan bagi: pengunggah, super admin, pemilik proses (karyawan
//        pemilik klaim utk TravelClaim/MedicalClaim), atau pemegang aksi
//        update menu terkait (HR). Role VIEWER ditolak.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  requireTenant, UNAUTHORIZED_MSG, VIEWER_FORBIDDEN_MSG,
} from "@/onevity/shared/lib/tenant-db";
import { resolveMenuPerms } from "@/onevity/shared/services/menu-access";
import { actionAllowed } from "@/onevity/shared/lib/menu-perms";
import {
  getAttachmentById, readAttachmentFile, deleteAttachmentByRow, DRAFT_ENTITY_PREFIX,
} from "@/onevity/shared/services/attachment-service";
import { ATTACHMENT_ENTITY_MENUS } from "@/onevity/shared/api/attachments";

// GET — stream isi file lampiran.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const row = await getAttachmentById(db, id);
    if (!row) return NextResponse.json({ error: "Lampiran tidak ditemukan" }, { status: 404 });

    let bytes: Buffer;
    try {
      bytes = await readAttachmentFile(row);
    } catch {
      return NextResponse.json({ error: "Berkas fisik lampiran tidak ditemukan di penyimpanan" }, { status: 404 });
    }

    const download = req.nextUrl.searchParams.get("download") === "1";
    // nama file aman ASCII + bentuk RFC 5987 utk karakter non-ASCII
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

// DELETE — hapus lampiran (pemilik proses / HR / pengunggah / super admin).
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const resolved = await resolveMenuPerms(req);
    if (!resolved) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    if (resolved.actor.role === "VIEWER") {
      return NextResponse.json({ error: VIEWER_FORBIDDEN_MSG }, { status: 403 });
    }

    const row = await getAttachmentById(resolved.db, id);
    if (!row) return NextResponse.json({ error: "Lampiran tidak ditemukan" }, { status: 404 });

    // ---- resolusi izin hapus (urut: super admin → pengunggah → aksi menu → pemilik klaim)
    let allowed = resolved.isSuperAdmin;
    if (!allowed && row.uploadedBy) {
      allowed = row.uploadedBy === resolved.actor.appUserId || row.uploadedBy === resolved.actor.userId;
    }
    if (!allowed) {
      const menuKey = ATTACHMENT_ENTITY_MENUS[row.entityType];
      if (menuKey) {
        allowed = resolved.all || actionAllowed(resolved.perms[menuKey], "update");
      }
    }
    if (
      !allowed &&
      (row.entityType === "TravelClaim" || row.entityType === "MedicalClaim") &&
      !row.entityId.startsWith(DRAFT_ENTITY_PREFIX) &&
      resolved.actor.employeeId
    ) {
      const claim =
        row.entityType === "TravelClaim"
          ? await resolved.db.travelClaim.findUnique({ where: { id: row.entityId }, select: { employeeId: true } })
          : await resolved.db.medicalClaim.findUnique({ where: { id: row.entityId }, select: { employeeId: true } });
      allowed = claim?.employeeId === resolved.actor.employeeId;
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Akses ditolak: hanya pengunggah, pemilik proses, atau HR (aksi ubah menu terkait) yang dapat menghapus lampiran ini" },
        { status: 403 },
      );
    }

    await deleteAttachmentByRow(resolved.db, row);

    // jejak audit — best-effort
    void resolved.db.activityLog
      .create({
        data: {
          appUserId: resolved.actor.appUserId ?? undefined,
          action: "Deleted",
          entity: "Attachment",
          entityId: row.id,
          detail: `Hapus lampiran ${row.fileName} (${row.entityType} ${row.entityId}) oleh ${resolved.actor.appUsername ?? resolved.actor.name}`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
