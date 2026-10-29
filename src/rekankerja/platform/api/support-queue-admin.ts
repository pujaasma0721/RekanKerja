// RekanKerja — Online Support P7.2: antrean Bug & Usulan Patch lintas tenant. =
// =====================================================================
// GET /api/rekankerja/platform/admin/support-queue
//   Feed + antrean untuk tab "Bug & Patch" konsol pemilik aplikasi:
//     · alerts        — PlatformAlert (badge belum-dibaca + feed)
//     · bugs          — tiket kategori BUG masih AKTIF dari SEMUA tenant
//     · patches       — usulan patch MENUNGGU keputusan dari semua tenant
//   (Guard: requirePlatformAdmin — pemilik aplikasi saja; tenant tidak
//   pernah bisa menyentuh endpoint ini.)
// POST /api/rekankerja/platform/admin/support-queue
//   { action: "read-alerts", alertIds?: string[] }
//     Tandai alert dibaca (semua yang belum dibaca bila alertIds kosong).
//   { action: "decide-patch", tenantId, ticketId, proposalId,
//     decision: "approve"|"reject", note? }
//     Keputusan usulan patch DARI SISI PLATFORM (patch menyentuh kode
//     aplikasi yang melayani semua tenant — pemilik aplikasi berhak
//     memutuskan). Setujui → file diterapkan (decidePatchProposal) +
//     verifikasi pasca-patch otomatis (P7.3) + alert terkait dibaca.
import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { requirePlatformAdmin } from "@/rekankerja/platform/api/platform-admin-auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { decidePatchProposal } from "@/rekankerja/support/services/support-patch";
import { runPatchVerificationTurn } from "@/rekankerja/support/services/support-agent";

const PRIORITY_WEIGHT: Record<string, number> = { KRITIS: 4, TINGGI: 3, SEDANG: 2, RENDAH: 1 };

export async function GET(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const [alerts, unreadCount, tenants] = await Promise.all([
      platformDb.platformAlert.findMany({
        orderBy: [{ readAt: "desc" }, { createdAt: "desc" }],
        take: 50,
      }),
      platformDb.platformAlert.count({ where: { readAt: null } }),
      platformDb.tenant.findMany({
        select: { id: true, name: true, schemaName: true, status: true },
        orderBy: { name: "asc" },
      }),
    ]);

    // Antrean lintas tenant: tiap schema di-query terpisah (isolasi tetap
    // utuh). Per-tenant try/catch — schema lama tanpa tabel support dilewati
    // (bukan error konsol).
    const bugs: Array<{
      tenantId: string; tenantName: string; id: string; ticketNo: string; subject: string;
      priority: string; createdByName: string | null; lastMessageAt: string; messages: number;
    }> = [];
    const patches: Array<{
      tenantId: string; tenantName: string; id: string; ticketId: string; ticketNo: string;
      ticketSubject: string; filePath: string; description: string; diffText: string;
      createdAt: string;
    }> = [];

    await Promise.all(
      tenants.map(async (ten) => {
        try {
          const db = getTenantClient(ten.schemaName);
          const [bugRows, patchRows] = await Promise.all([
            db.supportTicket.findMany({
              where: { status: "AKTIF", category: "BUG" },
              select: {
                id: true, ticketNo: true, subject: true, priority: true,
                createdByName: true, lastMessageAt: true, _count: { select: { messages: true } },
              },
              orderBy: { lastMessageAt: "desc" },
              take: 50,
            }),
            db.supportPatchProposal.findMany({
              where: { status: "MENUNGGU" },
              select: {
                id: true, ticketId: true, filePath: true, description: true, diffText: true,
                createdAt: true,
                ticket: { select: { ticketNo: true, subject: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 100,
            }),
          ]);
          for (const b of bugRows) {
            bugs.push({
              tenantId: ten.id, tenantName: ten.name, id: b.id, ticketNo: b.ticketNo,
              subject: b.subject, priority: b.priority, createdByName: b.createdByName,
              lastMessageAt: b.lastMessageAt.toISOString(), messages: b._count.messages,
            });
          }
          for (const p of patchRows) {
            patches.push({
              tenantId: ten.id, tenantName: ten.name, id: p.id, ticketId: p.ticketId,
              ticketNo: p.ticket.ticketNo, ticketSubject: p.ticket.subject,
              filePath: p.filePath, description: p.description, diffText: p.diffText,
              createdAt: p.createdAt.toISOString(),
            });
          }
        } catch (e) {
          console.warn(
            `[support-queue] tenant ${ten.name}: tabel support tidak siap — dilewati:`,
            e instanceof Error ? e.message : e,
          );
        }
      }),
    );

    // bug paling urgent di atas (KRITIS → RENDAH, lalu aktivitas terbaru)
    bugs.sort(
      (a, b) =>
        (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0) ||
        b.lastMessageAt.localeCompare(a.lastMessageAt),
    );

    return NextResponse.json({
      alerts: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        tenantName: a.tenantName,
        ticketNo: a.ticketNo,
        subject: a.subject,
        priority: a.priority,
        message: a.message,
        read: a.readAt != null,
        createdAt: a.createdAt.toISOString(),
      })),
      unreadCount,
      bugs,
      patches,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requirePlatformAdmin(req);
    if (!g.ok) return g.res;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = typeof b.action === "string" ? b.action : "";

    // ---- tandai alert dibaca ----
    if (action === "read-alerts") {
      const ids = Array.isArray(b.alertIds)
        ? b.alertIds.filter((x): x is string => typeof x === "string").slice(0, 100)
        : [];
      await platformDb.platformAlert.updateMany({
        where: ids.length > 0 ? { id: { in: ids }, readAt: null } : { readAt: null },
        data: { readAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- keputusan usulan patch (dari sisi platform) ----
    if (action === "decide-patch") {
      const tenantId = typeof b.tenantId === "string" ? b.tenantId.trim() : "";
      const ticketId = typeof b.ticketId === "string" ? b.ticketId.trim() : "";
      const proposalId = typeof b.proposalId === "string" ? b.proposalId.trim() : "";
      const decision = b.decision === "approve" || b.decision === "reject" ? b.decision : null;
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : null;
      if (!tenantId || !ticketId || !proposalId || !decision) {
        return NextResponse.json(
          { error: "Body wajib { tenantId, ticketId, proposalId, decision: \"approve\"|\"reject\", note? }" },
          { status: 400 },
        );
      }
      const ten = await platformDb.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, schemaName: true },
      });
      if (!ten) return NextResponse.json({ error: "Tenant tidak ditemukan" }, { status: 404 });

      const db = getTenantClient(ten.schemaName);
      // Patch menyentuh KODE APLIKASI milik platform — reviewer dicatat
      // jelas berasal dari realm konsol (bukan developer tenant).
      const reviewer = { id: null, name: "Pemilik Aplikasi (Konsol Platform)" };
      const result = await decidePatchProposal(db, ticketId, proposalId, decision, reviewer, note);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });

      // P7.3 — verifikasi pasca-patch (fire-and-forget; hanya saat diterapkan)
      if (result.status === "DISETUJUI") {
        void runPatchVerificationTurn(db, ticketId).catch(() => { /* best-effort */ });
      }
      // alert usulan terkait → dibaca (sudah ditindaklanjuti)
      try {
        await platformDb.platformAlert.updateMany({
          where: { type: "PATCH_PROPOSED", ticketRef: `${tenantId}:${ticketId}`, readAt: null },
          data: { readAt: new Date() },
        });
      } catch {
        /* best-effort */
      }
      return NextResponse.json({ ok: true, status: result.status });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
