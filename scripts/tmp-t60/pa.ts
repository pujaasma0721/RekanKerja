import "../lib/env";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
async function main() {
  const db = getTenantClient("tenant_pt_mitra_industri_internasional");
  const pas = await db.personnelAction.findMany({ select: { docNo: true, type: true, status: true, employeeId: true, currentLayer: true } });
  console.log("PAs:", pas.map(p => `${p.docNo}|${p.type}|${p.status}|L${p.currentLayer}`).join("\n"));
  const periods = await db.payrollPeriod.findMany({ select: { code: true, startDate: true, endDate: true, status: true } });
  console.log("PERIODS:", JSON.stringify(periods));
  const pt = await db.processType.findMany({ select: { code: true, name: true } });
  console.log("PTYPES:", pt.map(p => p.code).join(","));
  const emps = await db.employee.findMany({ where: { status: { not: "Active" } }, select: { employeeNo: true, fullName: true, status: true, endDate: true } });
  console.log("LEAVERS:", JSON.stringify(emps));
  const pls = await db.employee.groupBy({ by: ["status"], _count: true });
  console.log("STATUS COUNTS:", JSON.stringify(pls));
  const esc = await db.employeeAssignment.groupBy({ by: ["employmentStatus"], _count: true });
  console.log("EMP STATUS:", JSON.stringify(esc));
  const tpls = await db.wageTemplate.findMany({ select: { code: true, id: true } });
  console.log("TEMPLATES:", JSON.stringify(tpls));
  await db.$disconnect();
}
main();
