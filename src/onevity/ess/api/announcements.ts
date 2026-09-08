// OneVity ESS — Pengumuman (Task 27-f) =====================================
// GET  /api/onevity/ess/announcements — feed SAYA: pengumuman terbit (belum
//      kedaluwarsa) urut pinned desc lalu terbaru, dengan readByMe + total
//      dibaca per pengumuman + counts { total, unread } (badge header).
//      Guard requireEss (pola letters.ts).
// POST /api/onevity/ess/announcements — tandai sudah dibaca { id } → upsert
//      AnnouncementRead (idempoten — unik announcementId+employeeId).
//      Membuka detail pengumuman otomatis menandai dibaca.
import { NextResponse } from "next/server";
import { requireEss } from "@/onevity/ess/api/ess-auth";

// ================= GET — feed pengumuman saya =================
export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const now = new Date();
    const anns = await db.announcement.findMany({
      where: {
        publishedAt: { not: null, lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take: 100,
    });

    // tanda dibaca SAYA + total dibaca per pengumuman (2 query, tanpa N+1)
    const ids = anns.map((a) => a.id);
    const [myReads, readsGroup] = ids.length
      ? await Promise.all([
          db.announcementRead.findMany({
            where: { employeeId, announcementId: { in: ids } },
            select: { announcementId: true, readAt: true },
          }),
          db.announcementRead.groupBy({ by: ["announcementId"], _count: { _all: true } }),
        ])
      : [[], []];
    const myReadByAnn = new Map(myReads.map((r) => [r.announcementId, r.readAt]));
    const readsByAnn = new Map(readsGroup.map((g) => [g.announcementId, g._count._all]));

    const announcements = anns.map((a) => {
      const readAt = myReadByAnn.get(a.id) ?? null;
      return {
        id: a.id,
        code: a.code,
        title: a.title,
        body: a.body,
        category: a.category,
        pinned: a.pinned,
        publishedAt: a.publishedAt,
        expiresAt: a.expiresAt,
        readByMe: readAt != null,
        readAt,
        totalReads: readsByAnn.get(a.id) ?? 0,
      };
    });

    return NextResponse.json({
      announcements,
      counts: {
        total: announcements.length,
        unread: announcements.filter((a) => !a.readByMe).length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ================= POST — tandai sudah dibaca (idempoten) =================
export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id pengumuman wajib" }, { status: 400 });

    const ann = await db.announcement.findUnique({ where: { id }, select: { id: true, publishedAt: true, code: true } });
    if (!ann) return NextResponse.json({ error: "Pengumuman tidak ditemukan" }, { status: 404 });
    if (!ann.publishedAt) return NextResponse.json({ error: "Pengumuman belum diterbitkan" }, { status: 400 });

    // upsert idempoten — unik [announcementId, employeeId]
    const read = await db.announcementRead.upsert({
      where: { announcementId_employeeId: { announcementId: id, employeeId } },
      create: { announcementId: id, employeeId },
      update: { readAt: new Date() },
    });

    return NextResponse.json({ ok: true, readAt: read.readAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
