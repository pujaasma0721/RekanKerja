import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";

// ============ RIWAYAT KIRIM EMAIL (Task 34) ============
// GET ?limit=50 — log pengiriman terbaru (Sent/Failed/Skipped)

export async function GET(req: NextRequest) {
  try {
    // AUD-DEPLOY (2-b MED-2): guard menu — sebelumnya requireTenant saja,
    // log email (penerima + subject berisi OTP e-sign) terbaca semua anggota.
    const m = await requireMenuViewAny(req, ["settings:email"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get("limit")) || 50)));
    // Task 76 — sort server-side (whitelist; default terbaru dulu)
    const sortByParam = url.searchParams.get("sortBy") ?? "";
    const sortDirParam = url.searchParams.get("sortDir") === "desc" ? "desc" : "asc";
    const EMAIL_SORT: Record<string, string> = { createdAt: "createdAt", event: "event", toEmail: "toEmail", subject: "subject", status: "status" };
    const emailOrderBy: Record<string, unknown>[] = [
      ...(EMAIL_SORT[sortByParam] ? [{ [EMAIL_SORT[sortByParam]]: sortDirParam }] : []),
      { createdAt: "desc" },
    ];
    const logs = await db.emailLog.findMany({ orderBy: emailOrderBy, take: limit });
    const total = await db.emailLog.count();

    const byStatus = await db.emailLog.groupBy({ by: ["status"], _count: { _all: true } });
    const stats = { Sent: 0, Failed: 0, Skipped: 0, ...Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) };

    return NextResponse.json({ logs, total, stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
