import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { moneyViewForReq } from "@/onevity/shared/lib/money-view-req";
import { claimReport, medicalStats } from "@/onevity/medical/services/medical-service";

// GET /api/onevity/medical/reports?from=&to=&employeeId=&year= — laporan klaim
// rentang (padanan MedicalBenefitSummaryEmployee) + rekap per jenis (SummaryType).
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? new Date().getFullYear());
    const from = sp.get("from") ?? `${year}-01-01`;
    const to = sp.get("to") ?? `${year}-12-31`;
    // 45-b: gerbang vault uang (requireTenant → resolve via sesi; sekali utk kedua builder).
    const mv = await moneyViewForReq(req, db);
    const [rows, stats, employees] = await Promise.all([
      claimReport(db, {
        from,
        to,
        employeeId: sp.get("employeeId") ?? undefined,
      }, mv),
      medicalStats(db, year, mv),
      db.employee.findMany({
        where: { status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
        orderBy: { employeeNo: "asc" },
      }),
    ]);
    return NextResponse.json({ rows, byType: stats.byType, year, employees });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
