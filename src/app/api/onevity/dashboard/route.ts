import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const [
      employees,
      activeEmps,
      pendingActions,
      actions,
      orgUnits,
      positions,
      newHiresThisYear,
      exitsYTD,
      activities,
      genderAgg,
      statusAgg,
      unitAgg,
      monthlyHires,
    ] = await Promise.all([
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
      db.employee.groupBy({ by: ["employmentStatus"], where: { status: "Active" }, _count: true }),
      db.employee.groupBy({
        by: ["orgUnitId"],
        where: { status: "Active" },
        _count: true,
      }),
      db.employee.findMany({ where: { status: "Active" }, select: { joinDate: true } }),
    ]);

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
    for (const { orgUnitId, _count } of unitAgg) {
      if (!orgUnitId) continue;
      const divId = divisionMap.has(orgUnitId) ? orgUnitId : subToDiv.get(orgUnitId) ?? orgUnitId;
      const name = divisionMap.get(divId) ?? "Lainnya";
      headcountByDivision[name] = (headcountByDivision[name] ?? 0) + _count;
    }

    // monthly hires last 12 months
    const now = new Date();
    const months: { month: string; hires: number; exits: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = new Intl.DateTimeFormat("id-ID", { month: "short" }).format(d);
      months.push({
        month: label,
        hires: monthlyHires.filter((e) => {
          const j = new Date(e.joinDate);
          return j.getFullYear() === d.getFullYear() && j.getMonth() === d.getMonth();
        }).length,
        exits: 0,
      });
    }

    // avg salary
    const avgSalaryAgg = await db.employee.aggregate({ where: { status: "Active" }, _avg: { baseSalary: true } });

    // grade distribution
    const gradeAgg = await db.employee.groupBy({ by: ["gradeId"], where: { status: "Active" }, _count: true });
    const grades = await db.grade.findMany({ select: { id: true, code: true, name: true } });
    const gradeMap = new Map(grades.map((g) => [g.id, g]));
    const gradeDist = gradeAgg
      .map((g) => ({ code: gradeMap.get(g.gradeId ?? "")?.code ?? "?", name: gradeMap.get(g.gradeId ?? "")?.name ?? "—", count: g._count }))
      .sort((a, b) => (a.code > b.code ? 1 : -1));

    return NextResponse.json({
      totalEmployees: employees,
      activeEmployees: activeEmps,
      pendingActions,
      orgUnits,
      positions,
      newHiresThisYear,
      exitsYTD,
      avgSalary: Math.round(avgSalaryAgg._avg.baseSalary ?? 0),
      recentActions: actions,
      activities,
      genderSplit: genderAgg.map((g) => ({ gender: g.gender, count: g._count })),
      employmentStatusSplit: statusAgg.map((s) => ({ status: s.employmentStatus, count: s._count })),
      headcountByDivision: Object.entries(headcountByDivision).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      hireTrend: months,
      gradeDistribution: gradeDist,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
