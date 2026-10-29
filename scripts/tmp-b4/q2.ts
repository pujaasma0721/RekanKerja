import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const rows = await db.appraisalRecord.findMany({
  where: { status: { in: ["Published", "Closed"] }, finalRating: { not: null }, potentialBand: { not: null } },
  select: { finalRating: true, potentialBand: true, employee: { select: { employeeNo: true, fullName: true, status: true } }, cycle: { select: { code: true, periodEnd: true, status: true } } },
  orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
});
console.log("placed:", rows.length);
for (const r of rows) console.log(`${r.employee.employeeNo} ${r.employee.fullName} (${r.employee.status}) r=${r.finalRating} p=${r.potentialBand} cyc=${r.cycle.code}/${r.cycle.status}`);
const tutiApr = await db.appraisalRecord.findFirst({
  where: { employee: { employeeNo: "MII00013" }, status: { in: ["Published", "Closed"] } },
  orderBy: [{ cycle: { periodEnd: "desc" } }, { createdAt: "desc" }],
  select: { finalRating: true, potentialBand: true, cycle: { select: { code: true, status: true } } },
});
console.log("TUTI latest:", JSON.stringify(tutiApr));
