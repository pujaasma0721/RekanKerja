// RekanKerja — Online Support (FEAT-SUPPORT-P1): detail & status tiket. ========
// =====================================================================
// GET   /api/rekankerja/support/tickets/[id] — metadata tiket (pemilik/manage).
// PATCH /api/rekankerja/support/tickets/[id] — ubah status {status}:
//       AKTIF → SELESAI | DITUTUP; SELESAI → DITUTUP | AKTIF (buka kembali);
//       DITUTUP → AKTIF (buka kembali). Jejak: pesan SYSTEM + ActivityLog.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  resolveSupportActor, supportActorDenied, ticketAccess,
} from "@/rekankerja/support/api/support-auth";

const TICKET_SELECT = {
  id: true,
  ticketNo: true,
  subject: true,
  category: true,
  priority: true,
  status: true,
  createdById: true,
  createdByName: true,
  lastMessageAt: true,
  createdAt: true,
  closedAt: true,
  _count: { select: { messages: true } },
} as const;

const TRANSITIONS: Record<string, string[]> = {
  AKTIF: ["SELESAI", "DITUTUP"],
  SELESAI: ["DITUTUP", "AKTIF"],
  DITUTUP: ["AKTIF"],
};

const STATUS_NOTES: Record<string, string> = {
  SELESAI: "Percakapan ditandai SELESAI",
  DITUTUP: "Percakapan DITUTUP",
  AKTIF: "Percakapan dibuka kembali",
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const ticket = await a.db.supportTicket.findUnique({ where: { id }, select: TICKET_SELECT });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;
    return NextResponse.json({ ticket });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(b.status ?? "").trim();
    if (!["AKTIF", "SELESAI", "DITUTUP"].includes(status)) {
      return NextResponse.json({ error: "Status tiket tidak dikenal" }, { status: 400 });
    }

    const ticket = await a.db.supportTicket.findUnique({ where: { id } });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;
    const t = ticket!;

    if (!TRANSITIONS[t.status]?.includes(status)) {
      return NextResponse.json(
        { error: `Status tiket tidak bisa berubah dari ${t.status} ke ${status}` },
        { status: 409 },
      );
    }

    const now = new Date();
    const updated = await a.db.supportTicket.update({
      where: { id: t.id },
      data: {
        status,
        closedAt: status === "DITUTUP" ? now : null,
        updatedAt: now,
      },
      select: TICKET_SELECT,
    });

    // catatan sistem di alur chat + jejak audit (pola triage whistleblow).
    const nama = a.appUserName?.trim() || "pengguna";
    await a.db.supportMessage.create({
      data: {
        ticketId: t.id,
        senderRole: "SYSTEM",
        senderName: "Sistem",
        body: `${STATUS_NOTES[status]} oleh ${nama}.`,
      },
    });
    void a.db.activityLog
      .create({
        data: {
          action: "Updated",
          entity: "SupportTicket",
          entityId: t.ticketNo,
          appUserId: a.appUserId ?? undefined,
          detail: `Status ${t.status} → ${status} — oleh ${nama}`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ticket: updated });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
