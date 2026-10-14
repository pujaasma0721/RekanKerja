// Uji E2E scheduler P6 (pipReminders) — data waktu disiapkan langsung (status
// Active — alur aktivasi sudah diverifikasi E2E API), lalu job dipanggil 2×
// untuk membuktikan pengingat terkirim + dedupe ActivityLog:
//   PIP-SCHED-A (Joko Lubis MII00012): CP1 due HARI INI → pengingat (a)
//   PIP-SCHED-B (Joko Ramadhan MII00014): endDate 4 hari lalu → pengingat (b)
//   PIP-SCHED-C (Dewi Halim MII00011): endDate 13 hari lalu → eskalasi (c)
// Jalankan: bun run scripts/test-p6-scheduler.ts
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { pipReminders } from "@/rekankerja/performance/services/perf-pip-service";

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

async function main() {
  const db = getTenantClient(SCHEMA);

  const demo: { no: string; docNo: string; start: Date; months: number }[] = [
    { no: "MII00012", docNo: "PIP-SCHED-A", start: daysAgo(30), months: 2 }, // CP1 due hari ini
    { no: "MII00014", docNo: "PIP-SCHED-B", start: daysAgo(65), months: 2 }, // endDate 5 hari lalu
    { no: "MII00011", docNo: "PIP-SCHED-C", start: daysAgo(74), months: 2 }, // endDate 14 hari lalu (+7 lewat)
  ];
  for (const d of demo) {
    const emp = await db.employee.findFirst({ where: { employeeNo: d.no } });
    if (!emp) throw new Error(`Karyawan ${d.no} tidak ditemukan`);
    if (await db.pipPlan.findUnique({ where: { docNo: d.docNo } })) { console.log(`[seed] ${d.docNo} sudah ada`); continue; }
    const mgr = await db.employeeAssignment.findFirst({
      where: { employeeId: emp.id, validTo: null, managerId: { not: null } },
      orderBy: { validFrom: "desc" }, select: { managerId: true },
    });
    const end = new Date(d.start.getTime() + d.months * 30 * DAY);
    await db.pipPlan.create({
      data: {
        docNo: d.docNo,
        employeeId: emp.id,
        startDate: d.start,
        endDate: end,
        targetsJson: JSON.stringify([
          { title: "Kepatuhan SOP", metric: "audit", target: "100%", weight: 50 },
          { title: "Output harian", metric: "unit", target: "≥100", weight: 30 },
          { title: "Pelaporan akurat", metric: "error", target: "0", weight: 20 },
        ]),
        reviewerId: mgr?.managerId ?? emp.id,
        status: "Active",
        checkpoints: {
          create: [30, 60, 90].map((n) => ({ seq: n / 30, dueDate: new Date(d.start.getTime() + n * DAY), status: "Pending" })),
        },
      },
    });
    console.log(`[seed] ${d.docNo} — ${emp.fullName} ${iso(d.start).slice(0, 10)} → ${iso(end).slice(0, 10)} (Active, CP due ${[30, 60, 90].map((n) => iso(new Date(d.start.getTime() + n * DAY)).slice(0, 10)).join(", ")})`);
  }

  console.log("\n[pipReminders #1]", await pipReminders(db));
  console.log("[pipReminders #2 — dedupe]", await pipReminders(db));

  // bukti notifikasi + log
  const notifs = await db.notification.count({ where: { kind: "performance", title: { contains: "PIP" } } });
  const logs = await db.activityLog.count({ where: { entity: "Scheduler", entityId: { startsWith: "reminder:perf-pip-" } } });
  console.log(`\n[bukti] notifikasi performance ber-judul PIP: ${notifs} · ActivityLog reminder:perf-pip-*: ${logs}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
