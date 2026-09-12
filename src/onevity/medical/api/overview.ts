import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import { medicalStats } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/overview?year= — KPI ringkasan modul medis.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi).
    const stats = await medicalStats(db, year, await moneyViewForReq(req, db));
    return NextResponse.json({ ...stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
