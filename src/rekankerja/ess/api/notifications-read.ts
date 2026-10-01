// POST /api/rekankerja/ess/notifications/read — tandai dibaca
// (kontrak T8-ESS-FRONTEND). Body: { id } ATAU { all: true }.
// Ownership dijaga: id milik pengguna lain diabaikan (404).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";

export async function POST(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, appUserId } = m.actor;

  try {
    const b = await req.json().catch(() => ({}));
    const now = new Date();

    if (b.all === true) {
      await db.notification.updateMany({
        where: { appUserId, readAt: null },
        data: { readAt: now },
      });
      return NextResponse.json({ ok: true });
    }

    const id = String(b.id ?? "");
    if (!id) return NextResponse.json({ error: "id wajib diisi (atau all: true)" }, { status: 400 });

    const updated = await db.notification.updateMany({
      where: { id, appUserId, readAt: null },
      data: { readAt: now },
    });
    if (updated.count === 0) {
      const exists = await db.notification.findFirst({ where: { id, appUserId } });
      if (!exists) return NextResponse.json({ error: "Notifikasi tidak ditemukan" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
