import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const acct = await db.position.findFirstOrThrow({ where: { title: "Accountant" } });
console.log("accountant id:", acct.id);
