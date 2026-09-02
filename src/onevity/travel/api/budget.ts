import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { listBudgets, upsertBudget } from "@/onevity/travel/services/travel-service";

// GET /api/onevity/travel/budget — daftar budget tahunan + terpakai
// (padanan TravelPeriod.jsp: Total Budget | Used | Unused + Budget Per Cost Center).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const budgets = await listBudgets(db);
    return NextResponse.json({ budgets });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST — buat/ubah budget (items = rincian per cost center).
export async function POST(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const b = await req.json();
    const year = parseInt(b.year, 10);
    if (!Number.isFinite(year)) return NextResponse.json({ error: "Tahun wajib valid" }, { status: 400 });
    const res = await upsertBudget(db, {
      id: b.id ? String(b.id) : undefined,
      year,
      totalBudget: Math.max(0, Number(b.totalBudget ?? 0)),
      note: b.note ? String(b.note) : undefined,
      items: Array.isArray(b.items)
        ? b.items.map((i: Record<string, unknown>) => ({
            costCenter: String(i.costCenter ?? ""),
            amount: Math.max(0, Number(i.amount ?? 0)),
            note: i.note ? String(i.note) : undefined,
          }))
        : undefined,
    });
    return NextResponse.json({ id: res }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
