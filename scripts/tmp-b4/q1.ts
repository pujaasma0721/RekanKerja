import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const ps = await db.position.findMany({ where: { active: true }, select: { id: true, title: true, orgUnit: { select: { name: true } } }, orderBy: { title: "asc" } });
console.log(ps.map(p => `${p.title} [${p.orgUnit?.name}]`).join("\n"));
const acct = ps.find(p => p.title === "Accountant");
if (acct) {
  const inc = await db.employeeAssignment.findFirst({ where: { positionId: acct.id, validTo: null }, include: { employee: { select: { employeeNo: true, fullName: true } } } });
  console.log("INCUMBENT:", JSON.stringify(inc?.employee));
} else console.log("NO ACCOUNTANT");
