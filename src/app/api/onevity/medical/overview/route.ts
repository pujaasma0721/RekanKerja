import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { medicalStats } from "@/lib/onevity/medical-service";

// GET /api/onevity/medical/overview?year= — KPI ringkasan modul medis.
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    const stats = await medicalStats(db, year);
    return NextResponse.json({ ...stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
