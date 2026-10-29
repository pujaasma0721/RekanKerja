// RekanKerja — Online Support P4 (FEAT-SUPPORT-P4): usulan patch tiket. =======
// =====================================================================
// GET  /api/rekankerja/support/tickets/[id]/patches — daftar usulan patch
//      pada tiket (pemilik tiket / op manage; diff utk tinjauan manusia).
//      Respons memuat `canDecide` — pemegang op support:service/manage
//      (developer/admin) boleh memutuskan; pelapor hanya melihat status.
// POST /api/rekankerja/support/tickets/[id]/patches — keputusan developer
//      { proposalId, decision: "approve"|"reject", note? }:
//        · approve → verifikasi hash isi file (tak berubah sejak usulan)
//          → terapkan replacements → tulis file atomik → status DISETUJUI
//          + pesan SYSTEM di utas + ActivityLog (Approved).
//        · reject  → status DITOLAK + pesan SYSTEM + ActivityLog (Rejected).
//      Seluruh efek tulis HANYA lewat endpoint ini — tool agen (propose_patch)
//      tidak punya jalur menulis apa pun (separation of duties).
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import {
  resolveSupportActor, supportActorDenied, supportServiceDenied, ticketAccess, canManageAllTickets,
} from "@/rekankerja/support/api/support-auth";
import { decidePatchProposal } from "@/rekankerja/support/services/support-patch";
import { runPatchVerificationTurn } from "@/rekankerja/support/services/support-agent";

const PATCH_SELECT = {
  id: true,
  filePath: true,
  description: true,
  diffText: true,
  status: true,
  decidedByName: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
} as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;
    const ticket = await a.db.supportTicket.findUnique({ where: { id }, select: { id: true, createdById: true } });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;

    let patches: unknown[] = [];
    try {
      patches = await a.db.supportPatchProposal.findMany({
        where: { ticketId: id },
        orderBy: { createdAt: "asc" },
        select: PATCH_SELECT,
      });
    } catch {
      // tabel belum termigrasi (pra-parity) → kosong, bukan error
    }
    return NextResponse.json({ patches, canDecide: await canManageAllTickets(req) });
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
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;
    // Keputusan HANYA utk pemegang op manage (developer/admin) — pelapor
    // tiket TIDAK boleh menyetujui usulan atas tiketnya sendiri.
    if (!(await canManageAllTickets(req))) {
      return NextResponse.json(
        { error: "Akses ditolak: keputusan atas usulan patch hanya untuk pengelola support/developer" },
        { status: 403 },
      );
    }
    const ticket = await a.db.supportTicket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) return NextResponse.json({ error: "Tiket tidak ditemukan" }, { status: 404 });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const proposalId = typeof b.proposalId === "string" ? b.proposalId.trim() : "";
    const decision = b.decision === "approve" || b.decision === "reject" ? b.decision : null;
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : null;
    if (!proposalId || !decision) {
      return NextResponse.json({ error: "Body wajib { proposalId, decision: \"approve\"|\"reject\", note? }" }, { status: 400 });
    }

    const reviewer = { id: a.appUserId, name: a.appUserName ?? a.email ?? "developer" };
    const result = await decidePatchProposal(a.db, id, proposalId, decision, reviewer, note);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });

    // P7.3 — verifikasi pasca-patch (fire-and-forget): setelah patch DITERAPKAN,
    // agent mereproduksi ulang langkah pelapor utk membuktikan error hilang;
    // hasilnya ditulis ke utas. Request keputusan tetap instan (verifikasi
    // berjalan di latar, browser bisa 30-120 dtk) & tidak memakai kuota tenant.
    if (result.status === "DISETUJUI") {
      void runPatchVerificationTurn(a.db, id).catch(() => { /* best-effort */ });
    }
    return NextResponse.json({ proposal: { id: proposalId, status: result.status } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
