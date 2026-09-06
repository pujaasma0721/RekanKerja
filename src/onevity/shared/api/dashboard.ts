import { NextRequest, NextResponse } from "next/server";
import { requireScoped, scopeWhere } from "@/onevity/shared/services/access-scope";
import type { Prisma } from "@/generated/tenant";

// GET /api/onevity/dashboard — KPI ringkasan HR.
// T1-SECURITY:
//  • Skema akses data (Task 30) kini diterapkan — KPI karyawan dihitung HANYA
//    dari karyawan dalam cakupan akses efektif pengguna (super admin/atasan/
//    rule parametrik; pola sama dgn employees.ts). Sebelumnya semua user
//    melihat angka seluruh perusahaan.
//  • hireTrend.exits tidak lagi hard-coded 0 — keluar dihitung per bulan dari
//    Employee status Resigned/Terminated dengan endDate pada bulan tsb.
//  • hires menghitung SEMUA yang join di bulan itu (dulu hanya yang masih
//    Active → joiner yang kemudian resign hilang dari histori).
export async function GET(req: NextRequest) {
  try {
    const s = await requireScoped(req);
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
    const db = s.db;

    // kondisi scope akses data — dikombinasikan (AND) ke tiap query karyawan
    const scopeCond = scopeWhere(s.scope);
    const scoped = (extra: Prisma.EmployeeWhereInput): Prisma.EmployeeWhereInput =>
      Object.keys(scopeCond).length > 0 ? { AND: [scopeCond, extra] } : extra;
    const activeScoped = scoped({ status: "Active" });

    // data pekerjaan karyawan aktif diambil dari assignment aktif (validTo null)
    const [employees, activeEmps, pendingActions, actions, orgUnits, positions, newHiresThisYear, exitsYTD, activities, genderAgg, activeWithAssignments, lifecycleRows] = await Promise.all([
      db.employee.count({ where: scopeCond }),
      db.employee.count({ where: activeScoped }),
      db.personnelAction.count({ where: { status: "Submitted" } }),
      db.personnelAction.findMany({
        include: { employee: { select: { fullName: true, employeeNo: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      db.orgUnit.count({ where: { active: true } }),
      db.position.count({ where: { active: true } }),
      db.employee.count({ where: scoped({ joinDate: { gte: new Date(new Date().getFullYear(), 0, 1) } }) }),
      db.employee.count({
        where: scoped({
          status: { in: ["Resigned", "Terminated"] },
          endDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
        }),
      }),
      db.activityLog.findMany({
        include: { appUser: { select: { fullName: true, role: true } }, employee: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.employee.groupBy({ by: ["gender"], where: activeScoped, _count: true }),
      db.employee.findMany({
        where: activeScoped,
        select: { joinDate: true, assignments: { where: { validTo: null }, take: 1, select: { employmentStatus: true, orgUnitId: true, gradeId: true, baseSalary: true } } },
      }),
      // lifecycle untuk tren hires/exits 12 bulan: SEMUA karyawan dalam scope
      // (aktif maupun keluar) — joinDate + status + endDate.
      db.employee.findMany({
        where: scopeCond,
        select: { joinDate: true, endDate: true, status: true },
      }),
    ]);

    // agregasi pekerjaan (status/unit/gaji/grade) dihitung dari assignment aktif
    const cur = activeWithAssignments.map((e) => e.assignments[0]).filter(Boolean) as { employmentStatus: string; orgUnitId: string | null; gradeId: string | null; baseSalary: number }[];
    const empStatusCount: Record<string, number> = {};
    const unitCount: Record<string, number> = {};
    const gradeCount: Record<string, number> = {};
    let salarySum = 0;
    for (const a of cur) {
      empStatusCount[a.employmentStatus] = (empStatusCount[a.employmentStatus] ?? 0) + 1;
      if (a.orgUnitId) unitCount[a.orgUnitId] = (unitCount[a.orgUnitId] ?? 0) + 1;
      if (a.gradeId) gradeCount[a.gradeId] = (gradeCount[a.gradeId] ?? 0) + 1;
      salarySum += a.baseSalary;
    }
    const avgSalary = cur.length > 0 ? Math.round(salarySum / cur.length) : 0;

    // headcount per division (top org units level 3)
    const divisions = await db.orgUnit.findMany({
      where: { level: 3 },
      select: { id: true, name: true, code: true },
    });
    const divisionMap = new Map(divisions.map((d) => [d.id, d.name]));
    // map sub-units to divisions
    const subUnits = await db.orgUnit.findMany({ where: { level: 4 }, select: { id: true, parentId: true } });
    const subToDiv = new Map(subUnits.map((s) => [s.id, s.parentId]));
    const headcountByDivision: Record<string, number> = {};
    for (const [unitId, count] of Object.entries(unitCount)) {
      const divId = divisionMap.has(unitId) ? unitId : subToDiv.get(unitId) ?? unitId;
      const name = divisionMap.get(divId) ?? "Lainnya";
      headcountByDivision[name] = (headcountByDivision[name] ?? 0) + count;
    }

    // monthly hires & exits last 12 months (dari lifecycle rows — semua status)
    const EXIT_STATUSES = new Set(["Resigned", "Terminated"]);
    const now = new Date();
    const months: { month: string; hires: number; exits: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(d);
      months.push({
        month: label,
        hires: lifecycleRows.filter((e) => {
          const j = new Date(e.joinDate);
          return j.getFullYear() === d.getFullYear() && j.getMonth() === d.getMonth();
        }).length,
        exits: lifecycleRows.filter((e) => {
          if (!EXIT_STATUSES.has(e.status) || !e.endDate) return false;
          const x = new Date(e.endDate);
          return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth();
        }).length,
      });
    }

    // grade distribution
    const grades = await db.grade.findMany({ select: { id: true, code: true, name: true } });
    const gradeMap = new Map(grades.map((g) => [g.id, g]));
    const gradeDist = Object.entries(gradeCount)
      .map(([gid, count]) => ({ code: gradeMap.get(gid)?.code ?? "?", name: gradeMap.get(gid)?.name ?? "—", count }))
      .sort((a, b) => (a.code > b.code ? 1 : -1));

    return NextResponse.json({
      totalEmployees: employees,
      activeEmployees: activeEmps,
      pendingActions,
      orgUnits,
      positions,
      newHiresThisYear,
      exitsYTD,
      avgSalary,
      recentActions: actions,
      activities,
      genderSplit: genderAgg.map((g) => ({ gender: g.gender, count: g._count })),
      employmentStatusSplit: Object.entries(empStatusCount).map(([status, count]) => ({ status, count })),
      headcountByDivision: Object.entries(headcountByDivision).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      hireTrend: months,
      gradeDistribution: gradeDist,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
