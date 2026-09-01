import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

// GET /api/onevity/payroll-run?id= — detail run + lines + items
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const run = await db.payrollRun.findUnique({
      where: { id },
      include: {
        period: true,
        processType: true,
        lines: {
          orderBy: { employeeNo: "asc" },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!run) return NextResponse.json({ error: "Run tidak ditemukan" }, { status: 404 });

    // Overview payroll ringan: agregat komponen utama (utk kartu ringkasan).
    const aggByCode = new Map<string, { code: string; name: string; type: string; wageType: string; total: number }>();
    for (const line of run.lines) {
      for (const item of line.items) {
        const cur = aggByCode.get(item.code) ?? { code: item.code, name: item.name, type: item.type, wageType: item.wageType, total: 0 };
        cur.total += item.amount;
        aggByCode.set(item.code, cur);
      }
    }
    return NextResponse.json({
      run,
      componentTotals: [...aggByCode.values()].sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code)),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
