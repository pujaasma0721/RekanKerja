import "../lib/env";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
async function main() {
  const db = getTenantClient("tenant_pt_mitra_industri_internasional");
  const aus = await db.appUser.findMany({ select: { id: true, username: true, fullName: true, role: true, employeeId: true } });
  console.log(JSON.stringify(aus, null, 1));
  await db.$disconnect();
}
main();
