import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const asg = await db.employeeAssignment.findMany({
  where: { employeeId: "cmv8uvc3c005hsd91vb9z1h2z" },
  include: { position: { select: { title: true } }, orgUnit: { select: { name: true } } },
  orderBy: { validFrom: "desc" },
});
for (const a of asg) console.log(a.validFrom.toISOString().slice(0,10), "→", a.validTo?.toISOString().slice(0,10) ?? "AKTIF", a.position?.title, a.changeReason, a.orgUnit?.name);
