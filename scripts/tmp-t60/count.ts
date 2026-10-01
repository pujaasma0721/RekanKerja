import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { db as platform } from "@/lib/db";

async function main() {
  const tenants = await platform.tenant.findMany({ select: { slug: true, schemaName: true } });
  for (const t of tenants) {
    const db = getTenantClient(t.schemaName!);
    try {
      const counts: [string, number][] = [
        ["Company", await db.company.count()],
        ["OrgUnit", await db.orgUnit.count()],
        ["Position", await db.position.count()],
        ["Job", await db.job.count()],
        ["Grade", await db.grade.count()],
        ["PositionLevel", await db.positionLevel.count()],
        ["CompanyOffice", await db.companyOffice.count()],
        ["WorkLocation", await db.workLocation.count()],
        ["Employee", await db.employee.count()],
        ["EmployeeActive", await db.employee.count({ where: { status: "Active" } })],
        ["Assignment", await db.employeeAssignment.count()],
        ["Family", await db.employeeFamily.count()],
        ["Education", await db.employeeEducation.count()],
        ["Experience", await db.employeeExperience.count()],
        ["Disciplinary", await db.disciplinaryRecord.count()],
        ["PayrollProfile", await db.employeePayrollProfile.count()],
        ["PersonnelAction", await db.personnelAction.count()],
        ["EmployeeDocument", await db.employeeDocument.count()],
      ];
      console.log(`\n=== ${t.slug} (${t.schemaName}) ===`);
      console.log(counts.map(([k, v]) => `${k}=${v}`).join(" "));
    } finally {
      await db.$disconnect();
    }
  }
  await platform.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
