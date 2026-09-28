import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { requireMenuViewAny } from "@/onevity/shared/services/menu-access";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import { medicalStats } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/overview?year= — KPI ringkasan modul medis.
export async function GET(req: NextRequest) {
  try {
    // Task 82-T5: guard view menu (dulu requireTenant — anggota tenant tanpa hak
    // modul terkait tidak lagi bisa membaca endpoint ini).
    const m = await requireMenuViewAny(req, ["medical:claims", "medical:medical-info", "medical:medical-claim", "medical:medical-approval", "medical:medical-adjustment"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getFullYear());
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi).
    const stats = await medicalStats(db, year, await moneyViewForReq(req, db));
    return NextResponse.json({ ...stats });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
