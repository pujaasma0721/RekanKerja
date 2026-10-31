// RekanKerja — Online Support (FEAT-SUPPORT-P1): daftar & buat tiket. =========
// =====================================================================
// GET  /api/rekankerja/support/tickets          — "Percakapan Saya" (aktor).
//      ?scope=all — SEMUA tiket tenant (op support:service/manage).
//      Tiap baris tiket memuat `pendingPatches` (jumlah usulan patch status
//      MENUNGGU) — dasar badge "perlu keputusan" di daftar tiket. Untuk
//      pemegang op manage, respons juga memuat `pendingPatchTotal` (seluruh
//      tiket tenant) supaya admin tahu ada usulan menunggu WALAU sedang di
//      scope "Milik Saya" (lalu bisa berpindah scope "Semua Tiket").
// POST /api/rekankerja/support/tickets          — buat percakapan baru {subject}.
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import {
  resolveSupportActor, supportActorDenied, supportServiceDenied, canManageAllTickets, type SupportActor,
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

/** AUDIT-SUPPORT — pisahkan create utk retry pelanggaran UNIQUE ticketNo. */
async function createTicketRow(a: SupportActor, ticketNo: string, subject: string) {
  return a.db.supportTicket.create({
    data: {
      ticketNo,
      subject,
      createdById: a.appUserId,
      createdByName: a.appUserName,
    },
    select: { ...TICKET_SELECT, _count: true },
  });
}

export async function GET(req: NextRequest) {
  try {
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;

    const scope = req.nextUrl.searchParams.get("scope");
    if (scope === "all" && !(await canManageAllTickets(req))) {
      return NextResponse.json(
        { error: "Akses ditolak: tiket ini bukan milik Anda dan Anda tidak memegang izin mengelola tiket seluruh pengguna" },
        { status: 403 },
      );
    }
    const where = scope === "all" ? {} : { createdById: a.appUserId! };
    const tickets = await a.db.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      select: TICKET_SELECT,
      take: 100,
    });

    // FIX discoverability usulan patch: jumlah usulan MENUNGGU per tiket
    // (query terpisah + try/catch — schema pra-migrasi P4 → peta kosong,
    // daftar tiket TIDAK boleh ikut gagal). Pola sama dgn route patches.
    const pendingByTicket = new Map<string, number>();
    try {
      const groups = await a.db.supportPatchProposal.groupBy({
        by: ["ticketId"],
        where: { status: "MENUNGGU" },
        _count: { _all: true },
      });
      for (const g of groups) pendingByTicket.set(g.ticketId, g._count._all);
    } catch {
      // tabel belum termigrasi → kosong
    }
    const withPending = tickets.map((tk) => ({
      ...tk,
      pendingPatches: pendingByTicket.get(tk.id) ?? 0,
    }));

    // Total seluruh tenant utk pemegang op manage — dasar chip "Perlu
    // Keputusan" yang tetap terlihat WALAU admin sedang di scope "Milik
    // Saya". Guard manage hanya di- resolve bila memang ada usulan menunggu
    // (scope=all sudah pasti lolos guard di atas → tak perlu cek ulang).
    let pendingPatchTotal = 0;
    if (pendingByTicket.size > 0) {
      const manage = scope === "all" || (await canManageAllTickets(req));
      if (manage) {
        try {
          pendingPatchTotal = await a.db.supportPatchProposal.count({ where: { status: "MENUNGGU" } });
        } catch {
          pendingPatchTotal = 0;
        }
      }
    }
    return NextResponse.json({ tickets: withPending, pendingPatchTotal });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;

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

    // AUDIT-SUPPORT — nomor tiket dihitung max+1 (bukan sequence DB): dua
    // pembuatan tiket PARALEL bisa menghitung nomor sama → pelanggaran UNIQUE
    // ticketNo. Coba ulang hitung+simpan hingga 3× sebelum menyerah (rate-limit
    // 5 tiket/30 menit membuat tabrakan nyata sangat jarang).
    let ticket: Awaited<ReturnType<typeof createTicketRow>> | null = null;
    for (let attempt = 0; attempt < 3 && !ticket; attempt++) {
      const ticketNo = await nextTicketNo(a);
      try {
        ticket = await createTicketRow(a, ticketNo, subject);
      } catch (e) {
        const conflict = /unique constraint|duplicate key|P2002/i.test(e instanceof Error ? e.message : "");
        if (!conflict || attempt === 2) throw e;
      }
    }
    // audit-FIX: null-guard eksplisit — tiap jalur gagal di loop seharusnya
    // sudah throw; ini sabuk pengaman agar tidak TypeError di bawah.
    if (!ticket) {
      return NextResponse.json({ error: "Gagal membuat nomor tiket unik — coba lagi sebentar" }, { status: 500 });
    }

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
