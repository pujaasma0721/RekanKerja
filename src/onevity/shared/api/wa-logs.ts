import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// ============ RIWAYAT KIRIM WHATSAPP (Task 28-a) ============
// GET ?limit=50&offset=0&event=&status= — log pengiriman terbaru
// (Sent/Failed/Skipped), paginated + filter event/status + statistik.

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get("limit")) || 50)));
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
    const event = (url.searchParams.get("event") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim();

    const where: Record<string, string> = {};
    if (event) where.event = event;
    if (status) where.status = status;

    const [logs, total, byStatus] = await Promise.all([
      db.waLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
      db.waLog.count({ where }),
      db.waLog.groupBy({ by: ["status"], _count: { _all: true }, where: status ? { status } : undefined }),
    ]);
    const stats = { Sent: 0, Failed: 0, Skipped: 0, ...Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) };

    // daftar event unik untuk filter dropdown
    const events = await db.waLog.groupBy({ by: ["event"] });
    const eventList = events.map((e) => e.event).sort();

    return NextResponse.json({ logs, total, stats, events: eventList, limit, offset });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
