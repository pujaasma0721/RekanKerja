// RekanKerja — Online Support (FEAT-SUPPORT-P1): daftar & buat tiket. =========
// =====================================================================
// GET  /api/rekankerja/support/tickets          — "Percakapan Saya" (aktor).
//      ?scope=all — SEMUA tiket tenant (op support:service/manage).
// POST /api/rekankerja/support/tickets          — buat percakapan baru {subject}.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import {
  resolveSupportActor, supportActorDenied, canManageAllTickets, type SupportActor,
} from "@/rekankerja/support/api/support-auth";
import { greetingBody, SUPPORT_AI_NAME } from "@/rekankerja/support/services/support-agent";

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
  _count: { select: { messages: true } },
} as const;

/** Nomor tiket berikutnya: SP-<tahun>-NNN (per tahun, gap-safe — pola WB). */
async function nextTicketNo(a: SupportActor): Promise<string> {
  const year = new Date().getFullYear();
  const start = `SP-${year}-`;
  const rows = await a.db.supportTicket.findMany({
    where: { ticketNo: { startsWith: start } },
    select: { ticketNo: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.ticketNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(3, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });

    const scope = req.nextUrl.searchParams.get("scope");
    if (scope === "all") {
      const manage = await canManageAllTickets(req);
      if (!manage) {
        return NextResponse.json(
          { error: "Akses ditolak: tiket ini bukan milik Anda dan Anda tidak memegang izin mengelola tiket seluruh pengguna" },
          { status: 403 },
        );
      }
    }
    const where = scope === "all" ? {} : { createdById: a.appUserId! };
    const tickets = await a.db.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      select: TICKET_SELECT,
      take: 100,
    });
    return NextResponse.json({ tickets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });

    // rate limit per sesi — cegah banjir tiket baru (pola whistleblow).
    const cookie = req.headers.get("cookie") ?? "anon";
    const bucketKey = `support:new-ticket:${cookie.length}:${Buffer.from(cookie).toString("base64").slice(-24)}`;
    const rl = hitRateLimit(bucketKey, 5, 30 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak percakapan baru dalam waktu singkat — coba lagi nanti" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = String(b.subject ?? "").trim();
    if (subject.length < 5) {
      return NextResponse.json({ error: "Judul percakapan minimal 5 karakter" }, { status: 400 });
    }
    if (subject.length > 120) {
      return NextResponse.json({ error: "Judul percakapan maksimum 120 karakter" }, { status: 400 });
    }

    const ticketNo = await nextTicketNo(a);
    const ticket = await a.db.supportTicket.create({
      data: {
        ticketNo,
        subject,
        createdById: a.appUserId,
        createdByName: a.appUserName,
      },
      select: { ...TICKET_SELECT, _count: true },
    });

    // sambutan agen — teks tetap (tanpa LLM): tiket langsung siap dipakai.
    await a.db.supportMessage.create({
      data: {
        ticketId: ticket.id,
        senderRole: "AI",
        senderName: SUPPORT_AI_NAME,
        body: greetingBody(a.appUserName),
      },
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
