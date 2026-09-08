// Task 27-g E2E verification — BEFORE/AFTER engine state for a swap date.
// Usage: bun run scripts/t27g-verify.ts [phase-label]
// Prints: resolved dayType per employee via the real engine (resolveDayType),
// 1-day override assignments, and AttendanceDaily recap rows for the date.
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { resolveDayType } from "@/onevity/time-attendance/services/attendance-service";

const label = process.argv[2] ?? "phase";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const YUSUF = "cmtr63qit0055qim1taopehma";
const AYU = "cmtr63qk10061qim1oyhqchjd";
const DATE = new Date("2026-09-09T00:00:00");
const DAY_END = new Date("2026-09-10T00:00:00");

console.log(`===== [${label}] resolveDayType 2026-09-09 =====`);
for (const [name, id] of [["Yusuf (MII00010)", YUSUF], ["Ayu (MII00018)", AYU]] as const) {
  const r = await resolveDayType(db, id, DATE);
  console.log(`  ${name}: ${r.dayType?.name ?? "(null)"} | timeIn=${r.dayType?.timeIn ?? "-"} timeOut=${r.dayType?.timeOut ?? "-"} | assignment=${r.assignment.id ? r.assignment.id.slice(-6) : "NONE"}`);
}

const ov = await db.scheduleAssignment.findMany({ where: { validFrom: DATE, validTo: DATE } });
console.log(`===== [${label}] override assignments (validFrom=validTo=2026-09-09) =====`);
if (ov.length === 0) console.log("  (none)");
for (const o of ov) {
  console.log(`  id=${o.id.slice(-6)} employee=${o.employeeId.slice(-6)} schedule=${o.scheduleId.slice(-6)} anchor=${o.anchorMonday.toISOString().slice(0, 10)}#seq${o.anchorSequence} clocking=${o.clockingRequired} notes="${o.notes}"`);
}

const daily = await db.attendanceDaily.findMany({
  where: { workDate: { gte: DATE, lt: DAY_END }, employeeId: { in: [YUSUF, AYU] } },
  include: { dayType: true },
  orderBy: { employeeId: "asc" },
});
console.log(`===== [${label}] AttendanceDaily 2026-09-09 (kedua karyawan) =====`);
if (daily.length === 0) console.log("  (none)");
for (const d of daily) {
  console.log(`  emp=${d.employeeId.slice(-6)} dayType=${d.dayType?.name ?? "-"} status=${d.status} presence=${d.presence} notes="${d.notes ?? "-"}"`);
}
