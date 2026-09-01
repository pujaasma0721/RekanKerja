import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/lib/onevity/tenant-db";
import { flattenEmployee } from "@/lib/onevity/assignment";

// GET /api/onevity/employee-options — select options for wizard/detail
export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [orgUnits, positions, grades, employeesRaw, companies, lookups] = await Promise.all([
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, name: true, level: true, code: true }, orderBy: { code: "asc" } }),
      db.position.findMany({ where: { active: true }, select: { id: true, title: true, code: true, orgUnitId: true }, orderBy: { code: "asc" } }),
      db.grade.findMany({ where: { active: true }, select: { id: true, code: true, name: true, minSalary: true, maxSalary: true }, orderBy: { sortOrder: "asc" } }),
      db.employee.findMany({
        where: { status: "Active" },
        include: {
          assignments: {
            where: { validTo: null },
            orderBy: { validFrom: "desc" },
            take: 1,
            include: { position: { select: { title: true } } },
          },
        },
        orderBy: { employeeNo: "asc" },
      }),
      db.company.findMany({ select: { id: true, name: true, code: true, shortName: true } }),
      db.lookup.findMany({ where: { active: true }, select: { category: true, code: true, label: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    // flatten assignment aktif → bentuk lama (position/orgUnitId)
    const employees = employeesRaw.map((e) => {
      const flat = flattenEmployee(e);
      const { assignments, ...rest } = flat as Record<string, unknown>;
      return rest;
    });

    const lookupMap: Record<string, { code: string; label: string }[]> = {};
    for (const l of lookups) {
      (lookupMap[l.category] ??= []).push({ code: l.code, label: l.label });
    }

    return NextResponse.json({ orgUnits, positions, grades, managers: employees, companies, lookups: lookupMap });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
