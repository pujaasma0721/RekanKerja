// next-day check: base rotation untouched after swap date
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { resolveDayType } from "@/onevity/time-attendance/services/attendance-service";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
for (const d of ["2026-09-10", "2026-09-11"]) {
  const date = new Date(`${d}T00:00:00`);
  const y = await resolveDayType(db, "cmtr63qit0055qim1taopehma", date);
  const a = await resolveDayType(db, "cmtr63qk10061qim1oyhqchjd", date);
  console.log(`${d}: Yusuf=${y.dayType?.name ?? "-"} Ayu=${a.dayType?.name ?? "-"}`);
}
