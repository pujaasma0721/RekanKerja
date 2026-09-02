import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { claimReport } from "@/lib/onevity/travel-service";

// GET /api/onevity/travel/reports?from=&to=&employeeId= — laporan klaim per
// rentang (padanan TravelClaim report + Summary per jenis biaya).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const now = new Date();
    const from = sp.get("from") ? new Date(String(sp.get("from"))) : new Date(now.getFullYear(), 0, 1);
    const to = sp.get("to") ? new Date(String(sp.get("to"))) : now;
    const rows = await claimReport(db, {
      from,
      to,
      employeeId: sp.get("employeeId") ?? undefined,
    });

    const byKind = new Map<string, { amount: number; lines: number }>();
    const byExpense = new Map<string, { amount: number; lines: number }>();
    let totalExpenses = 0;
    for (const r of rows) {
      for (const e of r.expenses) {
        totalExpenses += e.amount;
        const k = byKind.get(e.kind) ?? { amount: 0, lines: 0 };
        byKind.set(e.kind, { amount: k.amount + e.amount, lines: k.lines + 1 });
        const x = byExpense.get(e.expenseCode) ?? { amount: 0, lines: 0 };
        byExpense.set(e.expenseCode, { amount: x.amount + e.amount, lines: x.lines + 1 });
      }
    }
    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      rows,
      summary: {
        claims: rows.length,
        totalSettlement: rows.reduce((s, r) => s + r.totalSettlement, 0),
        totalExpenses: Math.round(totalExpenses),
        payableEmployee: rows.reduce((s, r) => s + r.payableEmployee, 0),
        payableCompany: rows.reduce((s, r) => s + r.payableCompany, 0),
        byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.amount - a.amount),
        byExpense: [...byExpense.entries()].map(([code, v]) => ({ code, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 12),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
