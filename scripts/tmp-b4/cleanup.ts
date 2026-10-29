import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
await db.successorCandidate.deleteMany({});
await db.successionPosition.deleteMany({});
console.log("cleaned:", await db.successionPosition.count(), await db.successorCandidate.count());
