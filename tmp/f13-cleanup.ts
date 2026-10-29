// F-13 cleanup — hapus karyawan uji MII00046 & MII00047 + relasi yang dibuat
// wizard POST (assignment, onboarding + tasks, activity log, email log).
import "../scripts/lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";
const TARGET_NOS = ["MII00046", "MII00047"];

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const targets = await db.employee.findMany({
    where: { employeeNo: { in: TARGET_NOS } },
    select: { id: true, employeeNo: true, fullName: true },
  });
  if (targets.length === 0) {
    console.log("Tidak ada karyawan uji tersisa — bersih.");
  }
  const ids = targets.map((t) => t.id);
  console.log("Menghapus:", targets.map((t) => `${t.employeeNo} (${t.fullName})`).join(", "));

  // relasi yang dibuat jalur wizard POST /employees:
  const ob = await db.onboarding.findMany({ where: { employeeId: { in: ids } }, select: { id: true } });
  const obIds = ob.map((o) => o.id);
  const t1 = await db.onboardingTask.deleteMany({ where: { onboardingId: { in: obIds } } });
  const t2 = await db.onboarding.deleteMany({ where: { employeeId: { in: ids } } });
  const t3 = await db.emergencyContact.deleteMany({ where: { employeeId: { in: ids } } });
  const t4 = await db.employeeAssignment.deleteMany({ where: { employeeId: { in: ids } } });
  const t5 = await db.activityLog.deleteMany({ where: { employeeId: { in: ids } } });
  // EmailLog tanpa FK employeeId — sapu berdasarkan subject yang menyebut nama uji.
  const t6 = await db.emailLog.deleteMany({ where: { OR: TARGET_NOS.map((no) => ({ subject: { contains: no } })).concat([{ subject: { contains: "Uji F-13" } }]) } });
  const t7 = await db.employee.deleteMany({ where: { id: { in: ids } } });
  console.log(`onboardingTask=${t1.count} onboarding=${t2.count} emergencyContact=${t3.count} assignment=${t4.count} activityLog=${t5.count} emailLog=${t6.count} employee=${t7.count}`);

  const total = await db.employee.count();
  const last = await db.employee.findFirst({
    where: { employeeNo: { startsWith: "MII" } },
    orderBy: { employeeNo: "desc" },
    select: { employeeNo: true },
  });
  console.log(`FINAL_TOTAL=${total} NEXT_NUMBER_HINT=${last?.employeeNo}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
