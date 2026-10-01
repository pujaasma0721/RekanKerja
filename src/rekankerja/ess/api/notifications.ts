// GET /api/rekankerja/ess/notifications — pusat notifikasi saya
// (kontrak T8-ESS-FRONTEND): 50 terbaru + jumlah belum dibaca.
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m.actor;

  try {
    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { appUserId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, title: true, body: true, readAt: true, createdAt: true },
      }),
      db.notification.count({ where: { appUserId, readAt: null } }),
    ]);

    return NextResponse.json({ items, unread });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
