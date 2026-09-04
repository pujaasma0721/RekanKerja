import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// ============ RIWAYAT KIRIM EMAIL (Task 34) ============
// GET ?limit=50 — log pengiriman terbaru (Sent/Failed/Skipped)

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get("limit")) || 50)));
    const logs = await db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    const total = await db.emailLog.count();

    const byStatus = await db.emailLog.groupBy({ by: ["status"], _count: { _all: true } });
    const stats = { Sent: 0, Failed: 0, Skipped: 0, ...Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) };

    return NextResponse.json({ logs, total, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
