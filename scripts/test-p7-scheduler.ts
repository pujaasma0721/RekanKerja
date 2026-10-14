// Uji E2E scheduler P7 (probationReminders) — data waktu disiapkan langsung
// (status Open — alur keputusan sudah diverifikasi E2E API), lalu job dipanggil
// 2× untuk membuktikan pengingat terkirim + dedupe ActivityLog:
//   PRB-SCHED-A (Eka Putri): due H-10 → pengingat h14 SAJA (10 ≤ 14, 10 > 3)
//   PRB-SCHED-B (Rizky): due H-2 → pengingat h14 + h3 (2 ≤ 3)
//   PRB-SCHED-C (Laila): due H-6 → eskalasi mingguan overdue (HR + direktur)
// Baris uji diberi prefix docNo PRB-SCHED-* agar mudah dikenali; dievaluasi
// lalu dibiarkan (terminal Open — tidak mengganggu data demo: tak muncul di
// register karena dicap sebagai data uji scheduler; bandingkan pola P6).
// Jalankan: bun run scripts/test-p7-scheduler.ts
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { probationReminders } from "@/rekankerja/performance/services/perf-probation-service";

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const DAY = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

async function main() {
  const db = getTenantClient(SCHEMA);

  const demo: { no: string; docNo: string; due: Date }[] = [
    { no: "MII00047", docNo: "PRB-SCHED-A", due: daysFromNow(10) },  // H-10 → h14 saja (10 ≤ 14, 10 > 3)
    { no: "MII00048", docNo: "PRB-SCHED-B", due: daysFromNow(2) },   // H-2 → h14 + h3 (2 ≤ 3)
    { no: "MII00049", docNo: "PRB-SCHED-C", due: daysFromNow(-6) }, // LEWAT 6 hari → eskalasi mingguan
  ];
  for (const d of demo) {
    const emp = await db.employee.findFirst({ where: { employeeNo: d.no } });
    if (!emp) throw new Error(`Karyawan ${d.no} tidak ditemukan`);
    if (await db.probationEvaluation.findUnique({ where: { docNo: d.docNo } })) { console.log(`[seed] ${d.docNo} sudah ada`); continue; }
    await db.probationEvaluation.create({
      data: {
        docNo: d.docNo,
        employeeId: emp.id,
        dueDate: d.due,
        criteriaJson: JSON.stringify([
          { title: "Penguasaan tugas & kualitas kerja", weight: 40 },
          { title: "Kepatuhan SOP & disiplin", weight: 30 },
          { title: "Kolaborasi & komunikasi tim", weight: 30 },
        ]),
        status: "Open",
      },
    });
    console.log(`[seed] ${d.docNo} — ${emp.fullName} due ${d.due.toISOString().slice(0, 10)} (Open)`);
  }

  console.log("\n[probationReminders #1]", await probationReminders(db));
  console.log("[probationReminders #2 — dedupe]", await probationReminders(db));

  // bukti notifikasi + log (klaim h14/h3/over per docNo uji)
  const h14 = await db.activityLog.count({ where: { entity: "Scheduler", entityId: { startsWith: "reminder:perf-prob:PRB-SCHED", endsWith: ":h14" } } });
  const h3 = await db.activityLog.count({ where: { entity: "Scheduler", entityId: { startsWith: "reminder:perf-prob:PRB-SCHED", endsWith: ":h3" } } });
  const over = await db.activityLog.count({ where: { entity: "Scheduler", entityId: { startsWith: "reminder:perf-prob:PRB-SCHED", contains: ":over:w" } } });
  const notifs = await db.notification.count({ where: { kind: "performance", title: { contains: "percobaan" } } });
  console.log(`\n[bukti] ActivityLog reminder:perf-prob:PRB-SCHED-* h14=${h14} h3=${h3} over=${over} · notifikasi performance ber-kata percobaan: ${notifs}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
