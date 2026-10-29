import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
console.log("successionPosition model:", typeof db.successionPosition);
console.log("successorCandidate model:", typeof db.successorCandidate);
