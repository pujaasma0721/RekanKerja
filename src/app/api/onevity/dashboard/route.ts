import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    // data pekerjaan karyawan aktif diambil dari assignment aktif (validTo null)
    const [employees, activeEmps, pendingActions, actions, orgUnits, positions, newHiresThisYear, exitsYTD, activities, genderAgg, activeWithAssignments] = await Promise.all([
      db.employee.count(),
      db.employee.count({ where: { status: "Active" } }),
      db.personnelAction.count({ where: { status: "Submitted" } }),
      db.personnelAction.findMany({
        include: { employee: { select: { fullName: true, employeeNo: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      db.orgUnit.count({ where: { active: true } }),
      db.position.count({ where: { active: true } }),
      db.employee.count({ where: { joinDate: { gte: new Date(new Date().getFullYear(), 0, 1) } } }),
      db.employee.count({ where: { status: { in: ["Resigned", "Terminated"] }, endDate: { gte: new Date(new Date().getFullYear(), 0, 1) } } }),
      db.activityLog.findMany({
        include: { appUser: { select: { fullName: true, role: true } }, employee: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.employee.groupBy({ by: ["gender"], where: { status: "Active" }, _count: true }),
      db.employee.findMany({
        where: { status: "Active" },
        select: { joinDate: true, assignments: { where: { validTo: null }, take: 1, select: { employmentStatus: true, orgUnitId: true, gradeId: true, baseSalary: true } } },
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

    // monthly hires last 12 months
    const now = new Date();
    const months: { month: string; hires: number; exits: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(d);
      months.push({
        month: label,
        hires: activeWithAssignments.filter((e) => {
          const j = new Date(e.joinDate);
          return j.getFullYear() === d.getFullYear() && j.getMonth() === d.getMonth();
        }).length,
        exits: 0,
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
