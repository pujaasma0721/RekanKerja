import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { leaveStats } from "@/rekankerja/leave/services/leave-service";

// GET /api/rekankerja/leave/overview — KPI ringkasan modul cuti
// Task 99: guard menu-view — view default modul (cukup salah satu menu leave).
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, [
      "leave:leave-info", "leave:leave-request", "leave:leave-approval", "leave:leave-mass",
      "leave:leave-type", "leave:leave-encashment", "leave:leave-reports",
    ]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const stats = await leaveStats(m.db);
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
