import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const asg = await db.employeeAssignment.findMany({
  where: { positionId: "cmv8uvbzq003hsd91g1ejrcrs", validTo: null },
  include: { employee: { select: { employeeNo: true, fullName: true } } },
  orderBy: { validFrom: "desc" },
});
for (const a of asg) console.log(a.employee.employeeNo, a.employee.fullName, "from", a.validFrom.toISOString().slice(0,10));
