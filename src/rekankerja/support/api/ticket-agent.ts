// RekanKerja — Online Support (FEAT-SUPPORT-P1): giliran AI support agent. ====
// =====================================================================
// POST /api/rekankerja/support/tickets/[id]/agent — picu satu giliran AI:
//   · dipanggil UI setelah pesan user tersimpan (POST messages) atau saat
//     retry (provider gagal → 502; pesan user TIDAK hilang);
//   · hanya bila pesan non-SYSTEM terakhir adalah USER (mencegah balasan ganda);
//   · tiket DITUTUP → 409 (buka kembali dulu).
// Proses: analisa lampiran gambar (VLM) → aiComplete (provider tenant) →
//   parse marker triase [[META:…]] → simpan pesan AI + perbarui kategori/
//   prioritas/lastMessageAt. Bisa makan waktu (timeout provider 45s) — UI
//   menampilkan indikator "mengetik".
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  resolveSupportActor, supportActorDenied, ticketAccess,
} from "@/rekankerja/support/api/support-auth";
import { agentRespond } from "@/rekankerja/support/services/support-agent";

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

    // cek pesan terakhir non-SYSTEM harus dari USER (AI belum menjawabnya).
    const last = await a.db.supportMessage.findFirst({
      where: { ticketId: t.id, senderRole: { in: ["USER", "AI"] } },
      orderBy: { createdAt: "desc" },
      select: { senderRole: true },
    });
    if (!last || last.senderRole !== "USER") {
      return NextResponse.json(
        { error: "AI sudah menjawab pesan terakhir — kirim pesan baru terlebih dahulu" },
        { status: 409 },
      );
    }

    const result = await agentRespond(a.db, t);
    return NextResponse.json(
      { message: result.message, category: result.category, priority: result.priority },
      { status: 201 },
    );
  } catch (e) {
    // provider AI gagal (key salah, timeout, kuota) → 502 ramah — pesan user
    // sudah tersimpan; UI menawarkan tombol coba lagi (POST ulang endpoint ini).
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
