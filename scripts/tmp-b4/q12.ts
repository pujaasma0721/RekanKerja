import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const t = await db.employee.findFirstOrThrow({ where: { employeeNo: "MII00028" } });
console.log(t.id);
