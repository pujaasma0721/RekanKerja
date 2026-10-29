import "../scripts/lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const rows = await db.emailLog.findMany({
  where: { OR: [{ subject: { contains: "Uji" } }, { body: { contains: "Uji F-13" } }, { body: { contains: "MII00046" } }, { body: { contains: "MII00047" } }] },
  select: { id: true, subject: true, createdAt: true },
  orderBy: { createdAt: "desc" },
});
console.log("MATCHING_EMAILS=" + rows.length);
for (const r of rows.slice(0, 5)) console.log(r.subject);
process.exit(0);
