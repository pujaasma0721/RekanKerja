import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";

// GET /api/onevity/lookup-categories — distinct categories + counts
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const rows = await db.lookup.groupBy({ by: ["category"], _count: { _all: true } });
    const categories = rows
      .map((r) => ({ category: r.category, count: r._count._all }))
      .sort((a, b) => a.category.localeCompare(b.category));
    return NextResponse.json({ categories });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
