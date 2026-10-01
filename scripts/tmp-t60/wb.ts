import "../lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
async function main() {
  const db = getTenantClient("tenant_pt_mitra_industri_internasional");
  console.log("Whistleblow:", await db.whistleblowReport.count());
  console.log("CustomReport:", await db.customReport.count());
  console.log("LeaveRequests:", await db.leaveRequest.count());
  console.log("TravelRequests:", await db.travelRequest.count());
  console.log("MedicalClaims:", await db.medicalClaim.count());
  console.log("Notifications:", await db.notification.count());
  console.log("AssetsDetail:", JSON.stringify(await db.asset.findMany({ select: { code: true, name: true, category: true, status: true } })));
  console.log("LeaveTypes:", (await db.leaveType.findMany({ select: { code: true, entitlement: true } })).map(t=>t.code).join(","));
  console.log("TemplateDefault id:", await db.wageTemplate.findUnique({ where: { code: "DEFAULT" }, select: { id: true, _count: { select: { items: true } } } }));
  await db.$disconnect();
}
main();
