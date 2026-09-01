import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/onevity/employee-options — select options for wizard/detail
export async function GET() {
  try {
    const [orgUnits, positions, grades, employees, companies, lookups] = await Promise.all([
      db.orgUnit.findMany({ where: { active: true }, select: { id: true, name: true, level: true, code: true }, orderBy: { code: "asc" } }),
      db.position.findMany({ where: { active: true }, select: { id: true, title: true, code: true, orgUnitId: true }, orderBy: { code: "asc" } }),
      db.grade.findMany({ where: { active: true }, select: { id: true, code: true, name: true, minSalary: true, maxSalary: true }, orderBy: { sortOrder: "asc" } }),
      db.employee.findMany({ where: { status: "Active" }, select: { id: true, fullName: true, employeeNo: true, position: { select: { title: true } }, orgUnitId: true }, orderBy: { employeeNo: "asc" } }),
      db.company.findMany({ select: { id: true, name: true, code: true, shortName: true } }),
      db.lookup.findMany({ where: { active: true }, select: { category: true, code: true, label: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    const lookupMap: Record<string, { code: string; label: string }[]> = {};
    for (const l of lookups) {
      (lookupMap[l.category] ??= []).push({ code: l.code, label: l.label });
    }

    return NextResponse.json({ orgUnits, positions, grades, managers: employees, companies, lookups: lookupMap });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
