// T14-SCHED — UJI BACKGROUND JOB SCHEDULER (tenant MII, sandbox) =========
// =========================================================================
// Menyiapkan kondisi pemicu SEMUA job di tenant MII, menjalankan runAllJobs()
// langsung (export khusus testing), memverifikasi hasil + DEDUPE, lalu
// membersihkan data uji. Idemponen terhadap data demo — hanya menyentuh
// baris ber-prefix T14.
//
//   bun scripts/t14-test-scheduler.ts              → uji penuh (default)
//   bun scripts/t14-test-scheduler.ts --interval   → demo timer interval
//                                                    (env kecil: 7.2 dtk)
//   bun scripts/t14-test-scheduler.ts --off        → verifikasi guard
//                                                    SCHEDULER=off
//
// Data uji yang dibuat (dihapus lagi saat cleanup):
//   - T14TEST01 karyawan Active + endDate 5 hari LALU      → job a (resign
//     terjadwal: status → Terminated + ActivityLog)
//   - T14TEST02 karyawan Active + endDate 30 hari LAGI     → job b (pengingat
//     kontrak band 30 → notif Admin/HR + email + dedupe)
//   - T14TEST03 karyawan Probation, joinDate 60 hari lalu  → job b (evaluasi
//     probation 90 hari = 30 hari lagi)
//   - tabel EmployeeDocument (T16 paralel; dibuat sementara) + 1 dokumen
//     kedaluwarsa 10 hari lagi milik T14TEST02              → job c
//   - ApprovalChain Leave "…T14SLA" tua 5 hari, step Current
//     approver Sri Wahyuni                                  → job d (SLA)
//   - PayrollPeriod "2026-T14" Open, payday 3 hari lagi     → job e (D-3)
//   - Notification 200 hari tua milik Tri                    → job f (hapus)
//
// SMTP sandbox mati → EmailLog berstatus "Failed" (ECONNREFUSED) — bukti
// dispatch tetap tercatat (pola sama payslip T10).
// =========================================================================
import { tenantCrypto } from "../src/rekankerja/shared/lib/field-crypto";
import { Client } from "pg";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { initScheduler, runAllJobs, schedulerStatus } from "@/rekankerja/shared/services/scheduler-service";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";
const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string) => `  ${s}`;
let failures = 0;
function check(label: string, ok: boolean, extra = ""): void {
  console.log(`${ok ? "✓" : "✗ GAGAL"}: ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

// ---------- mode: verifikasi guard SCHEDULER=off ----------
async function modeOff(): Promise<void> {
  process.env.NEXT_RUNTIME = "nodejs"; // simulasi runtime server (guard initScheduler)
  process.env.SCHEDULER = "off";
  initScheduler();
  const s = schedulerStatus();
  check("SCHEDULER=off → scheduler tidak aktif (guard env)", !s.active);
}

// ---------- mode: demo timer interval (env override kecil) ----------
async function modeInterval(): Promise<void> {
  process.env.NEXT_RUNTIME = "nodejs"; // simulasi runtime server (guard initScheduler)
  process.env.SCHEDULER_INTERVAL_HOURS = "0.002"; // 7.2 detik
  process.env.SCHEDULER_FIRST_DELAY_MS = "1500";
  initScheduler();
  const s0 = schedulerStatus();
  check("initScheduler → handle aktif di proses ini", s0.active);
  console.log(pad("menunggu 26 dtk (3+ siklus kecil)…"));
  await sleep(26_000);
  const s1 = schedulerStatus();
  check("interval memicu ≥3 siklus (run pertama + interval)", s1.cycles >= 3, `cycles=${s1.cycles}`);
  check("tidak ada siklus yang tumpang tindih (running=false saat idle)", !s1.running);
}

// ---------- mode utama: uji penuh ----------
async function main(): Promise<void> {
  const db = getTenantClient(MII_SCHEMA);
  const pg = new Client({
    connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await pg.connect();
  const q = async (sql: string, params: unknown[] = []) => (await pg.query(sql, params as never[])).rows;

  const today = startOfDay(new Date());
  const stamp = Date.now().toString(36);

  // ---- referensi data demo (tidak diubah) ----
  const company = (await q(`SELECT id FROM "${MII_SCHEMA}"."Company" LIMIT 1`))[0] as { id: string };
  const triApp = (await q(`SELECT id FROM "${MII_SCHEMA}"."AppUser" WHERE username='MII000001'`))[0] as { id: string };
  const sriEmp = (await q(
    `SELECT e.id, e."fullName", e.email FROM "${MII_SCHEMA}"."Employee" e
     JOIN "${MII_SCHEMA}"."AppUser" a ON a."employeeId" = e.id WHERE a.username='MII000004'`,
  ))[0] as { id: string; fullName: string; email: string | null };
  const agusEmp = (await q(`SELECT id, "fullName" FROM "${MII_SCHEMA}"."Employee" WHERE "employeeNo"='MII00007'`))[0] as
    | { id: string; fullName: string }
    | undefined;
  console.log(`[setup] approver SLA: ${sriEmp.fullName} · pemohon: ${agusEmp?.fullName ?? "Agus (fallback)"}`);

  // ============ 1. SETUP KONDISI PEMICU ============
  console.log("\n=== 1. SETUP DATA UJI ===");

  const e1 = await db.employee.create({
    data: {
      employeeNo: "T14TEST01",
      fullName: "T14 Test Resign",
      gender: "M",
      companyId: company.id,
      joinDate: new Date(today.getTime() - 2 * 365 * DAY_MS),
      endDate: new Date(today.getTime() - 5 * DAY_MS), // 5 hari LALU, masih Active
      status: "Active",
    },
    select: { id: true },
  });
  console.log(pad(`T14TEST01 (${e1.id}) Active + endDate 5 hari lalu`));

  const e2 = await db.employee.create({
    data: {
      employeeNo: "T14TEST02",
      fullName: "T14 Test Kontrak",
      gender: "F",
      companyId: company.id,
      joinDate: new Date(today.getTime() - 365 * DAY_MS),
      endDate: new Date(today.getTime() + 30 * DAY_MS), // band 30
      status: "Active",
      email: "t14-kontrak@mii.co.id",
    },
    select: { id: true },
  });
  console.log(pad(`T14TEST02 (${e2.id}) Active + endDate 30 hari lagi`));

  const e3 = await db.employee.create({
    data: {
      employeeNo: "T14TEST03",
      fullName: "T14 Test Probation",
      gender: "M",
      companyId: company.id,
      joinDate: new Date(today.getTime() - 60 * DAY_MS), // eval = join+90 = 30 hari lagi
      status: "Active",
    },
    select: { id: true },
  });
  await db.employeeAssignment.create({
    data: {
      employeeId: e3.id,
      employmentStatus: "Probation",
      validFrom: new Date(today.getTime() - 60 * DAY_MS),
      validTo: null,
      changeReason: "Initial",
      baseSalary: tenantCrypto(process.env.SEED_TENANT_SCHEMA ?? "tenant_seed").encryptMoney(0),
    },
  });
  console.log(pad(`T14TEST03 (${e3.id}) Probation, joinDate 60 hari lalu (evaluasi 30 hari lagi)`));

  // tabel EmployeeDocument — dibuat agen T16 secara paralel; buat bila belum
  // ada (dicatat supaya di-DROP lagi saat cleanup, TIDAK mengganggu milik T16)
  const docTableExisted = (
    await q(`SELECT 1 FROM information_schema.tables WHERE table_schema='${MII_SCHEMA}' AND table_name='EmployeeDocument'`)
  ).length > 0;
  let createdDocTable = false;
  if (!docTableExisted) {
    await pg.query(`SET search_path TO "${MII_SCHEMA}"`);
    await pg.query(`
      CREATE TABLE IF NOT EXISTS "EmployeeDocument" (
        "id" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "docType" TEXT NOT NULL,
        "docNumber" TEXT,
        "issuedAt" TIMESTAMP(3),
        "expiresAt" TIMESTAMP(3),
        "notes" TEXT,
        "attachmentId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
      )`);
    createdDocTable = true;
    console.log(pad("tabel EmployeeDocument dibuat sementara (belum ada — milik T16)"));
  } else {
    console.log(pad("tabel EmployeeDocument SUDAH ada (T16) — pakai apa adanya"));
  }
  const docRow = (
    await q(
      `INSERT INTO "${MII_SCHEMA}"."EmployeeDocument" ("id","employeeId","docType","docNumber","issuedAt","expiresAt","updatedAt")
       VALUES ($1,$2,'Paspor','T14-PASSPORT-001',$3,$4,CURRENT_TIMESTAMP) RETURNING id`,
      [`t14doc${stamp}`, e2.id, new Date(today.getTime() - 80 * DAY_MS), new Date(today.getTime() + 10 * DAY_MS)],
    )
  )[0] as { id: string };
  console.log(pad(`EmployeeDocument Paspor T14-PASSPORT-001 kedaluwarsa 10 hari lagi (${docRow.id})`));

  const chain = await db.approvalChain.create({
    data: {
      docType: "Leave",
      docId: `t14-chain-${stamp}T14SLA`,
      employeeId: agusEmp?.id ?? e1.id, // pemohon (resolusi nama utk body notif)
      status: "InProgress",
      currentLevel: 1,
      totalLevels: 2,
      createdAt: new Date(Date.now() - 5 * DAY_MS), // TUA: 5 hari
      steps: {
        create: [
          {
            levelNo: 1,
            approverType: "Employee",
            approverLabel: "Sri Wahyuni — HR Manager",
            approverEmployeeId: sriEmp.id,
            status: "Current",
          },
          {
            levelNo: 2,
            approverType: "Position",
            approverLabel: "Direksi",
            approverPositionCode: "DIRECTION",
            status: "Waiting",
          },
        ],
      },
    },
    select: { id: true, docId: true },
  });
  console.log(pad(`ApprovalChain Leave ${chain.docId} InProgress, step Current menunggu 5 hari`));

  const period = await db.payrollPeriod.create({
    data: {
      code: `2026-T14-${stamp.slice(-4)}`,
      name: "T14 TEST PERIODE",
      payType: "Monthly",
      startDate: new Date(today.getTime() - 10 * DAY_MS),
      endDate: new Date(today.getTime() + 3 * DAY_MS), // D-3, tanpa run Confirmed
      payPeriod: 0,
      sptMonth: 9,
      sptYear: 2026,
      status: "Open",
    },
    select: { id: true, code: true },
  });
  console.log(pad(`PayrollPeriod ${period.code} Open, payday 3 hari lagi, tanpa run Confirmed`));

  const oldNotif = await db.notification.create({
    data: {
      appUserId: triApp.id,
      title: "[T14] notifikasi 200 hari lama (housekeeping)",
      createdAt: new Date(Date.now() - 200 * DAY_MS),
    },
    select: { id: true },
  });
  console.log(pad(`Notification tua 200 hari (${oldNotif.id}) milik Tri`));

  const notifBefore = await db.notification.findMany({ select: { id: true } });
  const idsBefore = new Set(notifBefore.map((n) => n.id));

  // ============ 2. RUN #1 ============
  console.log("\n=== 2. RUN #1 — runAllJobs(MII) ===");
  const r1 = await runAllJobs(db, { tenant: "mii-t14-test" });
  console.log(JSON.stringify(r1, null, 2));
  await sleep(3_000); // beri waktu dispatch email fire-and-forget → EmailLog

  // ============ 3. VERIFIKASI ============
  console.log("\n=== 3. VERIFIKASI HASIL ===");

  // (a) resign terjadwal
  const e1After = await db.employee.findUnique({ where: { id: e1.id }, select: { status: true } });
  check("job a — T14TEST01 status Active→Terminated", e1After?.status === "Terminated", `status=${e1After?.status}`);
  const logResign = await db.activityLog.findFirst({
    where: { entity: "Employee", entityId: e1.id, action: "Terminated" },
    select: { detail: true },
  });
  check(
    "job a — ActivityLog decisionNote 'Resign terjadwal otomatis oleh scheduler'",
    !!logResign?.detail && logResign.detail.includes("Resign terjadwal otomatis oleh scheduler"),
    (logResign?.detail ?? "").slice(0, 90),
  );

  // helper: notifikasi baru (id belum ada sebelum run)
  const notifAfter = await db.notification.findMany({
    where: { id: { notIn: [...idsBefore] } },
    select: { id: true, appUserId: true, title: true, body: true, link: true, kind: true, readAt: true },
  });
  const newTitles = notifAfter.map((n) => n.title);
  const cnt = (prefix: string) => newTitles.filter((t) => t.startsWith(prefix)).length;

  // (b) kontrak + probation
  check("job b — notif kontrak T14TEST02 ke Admin/HR (Tri+Hartono)", cnt("Kontrak T14 Test Kontrak") === 2, `n=${cnt("Kontrak T14 Test Kontrak")}`);
  check("job b — notif probation T14TEST03 ke Admin/HR", cnt("Probation T14 Test Probation") === 2, `n=${cnt("Probation T14 Test Probation")}`);
  const keyContract = `reminder:contract:${e2.id}:30`;
  const remContract = await db.activityLog.findFirst({ where: { entity: "Scheduler", entityId: keyContract } });
  check(`job b — dedupe key ${keyContract} tercatat di ActivityLog`, remContract != null);
  const remProb = await db.activityLog.findFirst({ where: { entity: "Scheduler", entityId: `reminder:probation:${e3.id}:30` } });
  check("job b — dedupe key reminder:probation tercatat", remProb != null);

  // (c) dokumen kedaluwarsa
  check("job c — notif dokumen Paspor ke Admin/HR", cnt("Dokumen Paspor T14 Test Kontrak") === 2, `n=${cnt("Dokumen Paspor T14 Test Kontrak")}`);
  const remDoc = await db.activityLog.findFirst({ where: { entity: "Scheduler", entityId: `reminder:doc:${docRow.id}:30` } });
  check("job c — dedupe key reminder:doc tercatat", remDoc != null);

  // (d) SLA
  check("job d — notif SLA ke approver Sri (nextApprover)", cnt("Cuti Leave-") === 1, `n=${cnt("Cuti Leave-")}`);
  const slaNotif = notifAfter.find((n) => n.title.startsWith("Cuti Leave-"));
  check("job d — notif SLA bertanda 'menunggu 5 hari'", !!slaNotif?.body?.includes("menunggu di jenjang") && slaNotif.body.includes("5 hari"));
  const remSla = await db.activityLog.findFirst({
    where: { entity: "Scheduler", entityId: `reminder:sla:${chain.id}:${today.toISOString().slice(0, 10)}` },
  });
  check("job d — dedupe key reminder:sla per hari tercatat", remSla != null);

  // (e) payroll D-3
  check("job e — notif payroll D-3 ke Admin/HR", cnt("Payroll periode T14 TEST PERIODE") === 2, `n=${cnt("Payroll periode T14 TEST PERIODE")}`);
  const remPay = await db.activityLog.findFirst({
    where: { entity: "Scheduler", entityId: `reminder:payroll:${period.id}:${today.toISOString().slice(0, 10)}` },
  });
  check("job e — dedupe key reminder:payroll per hari tercatat", remPay != null);

  // (f) housekeeping
  const oldGone = (await db.notification.findUnique({ where: { id: oldNotif.id } })) == null;
  check("job f — notifikasi 200 hari terhapus (housekeeping)", oldGone);

  // ringkasan ActivityLog (1 baris per siklus)
  const summary = await db.activityLog.findFirst({
    where: { action: "Scheduled", entity: "Scheduler", detail: { contains: "mii-t14-test" } },
    orderBy: { createdAt: "desc" },
    select: { detail: true },
  });
  check("ringkasan ActivityLog 'n job, n notifikasi' (1 baris per siklus)", !!summary?.detail && /\d+ job, \d+ notifikasi/.test(summary.detail), summary?.detail ?? "");

  // email dispatch → EmailLog (SMTP sandbox mati → Failed, tetap tercatat)
  const mails = await db.emailLog.findMany({
    where: { event: { startsWith: "scheduler." }, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
    select: { event: true, toEmail: true, subject: true, status: true },
    orderBy: { event: "asc" },
  });
  for (const ev of ["scheduler.contract-expiry", "scheduler.doc-expiry", "scheduler.approval-sla", "scheduler.payroll-reminder"]) {
    const rows = mails.filter((m) => m.event === ev);
    check(`email ${ev} ter-dispatch (EmailLog)`, rows.length > 0, rows.map((r) => `${r.toEmail}:${r.status}`).join(","));
  }
  const unrendered = mails.filter((m) => m.subject.includes("{{"));
  check("subject email ter-render penuh (tanpa placeholder {{ }})", unrendered.length === 0, unrendered[0]?.subject ?? "");
  const sample = mails.find((m) => m.event === "scheduler.contract-expiry");
  console.log(pad(`contoh subject: ${sample?.subject ?? "-"} → ${sample?.toEmail ?? "-"} [${sample?.status ?? "-"}]`));

  // template self-heal
  const tpl = await db.emailTemplate.findMany({ where: { event: { startsWith: "scheduler." } }, select: { event: true } });
  check("4 template scheduler.* ter-seed di EmailTemplate (self-heal)", tpl.length === 4, tpl.map((t) => t.event).join(","));

  // ============ 4. RUN #2 — DEDUPE ============
  console.log("\n=== 4. RUN #2 (dedupe) — runAllJobs(MII) LAGI ===");
  const r2 = await runAllJobs(db, { tenant: "mii-t14-test" });
  console.log(JSON.stringify({ jobs: r2.jobs, notificationsSent: r2.notificationsSent, errors: r2.errors }));
  const total2 = Object.values(r2.jobs).reduce((a, b) => a + b, 0);
  check("run #2 — nol job terpicu ulang (dedupe + idempoten)", total2 === 0, `total=${total2}`);
  check("run #2 — nol notifikasi baru", r2.notificationsSent === 0);
  // hitung ULANG per judul pengingat uji — jumlah harus sama persis dgn run #1
  // (notif lama 200 hari sudah terhapus housekeeping; aktivitas agen paralel
  // tak memengaruhi hitungan prefix judul ini).
  const titles2 = (await db.notification.findMany({ select: { title: true } })).map((n) => n.title);
  const cnt2 = (prefix: string) => titles2.filter((t) => t.startsWith(prefix)).length;
  check(
    "run #2 — notifikasi pengingat TIDAK dobel (judul uji tak bertambah)",
    cnt2("Kontrak T14 Test Kontrak") === 2 &&
      cnt2("Probation T14 Test Probation") === 2 &&
      cnt2("Dokumen Paspor T14 Test Kontrak") === 2 &&
      cnt2("Cuti Leave-") === 1 &&
      cnt2("Payroll periode T14 TEST PERIODE") === 2,
    `kontrak=${cnt2("Kontrak T14 Test Kontrak")} probation=${cnt2("Probation T14 Test Probation")} sla=${cnt2("Cuti Leave-")}`,
  );
  const r1Again = await runAllJobs(db, { tenant: "mii-t14-test" });
  check("job a idempoten — T14TEST01 tidak diproses ulang", r1Again.jobs.resignTerminated === 0);

  // ============ 5. CLEANUP ============
  console.log("\n=== 5. CLEANUP DATA UJI ===");

  // hapus notifikasi uji (id yang muncul saat run) — bell demo tetap bersih
  const delNotif = await db.notification.deleteMany({ where: { id: { in: notifAfter.map((n) => n.id) } } });
  console.log(pad(`notifikasi uji dihapus: ${delNotif.count}`));

  await pg.query(`DELETE FROM "${MII_SCHEMA}"."EmployeeDocument" WHERE id = $1`, [docRow.id]);
  if (createdDocTable) {
    await pg.query(`DROP TABLE IF EXISTS "${MII_SCHEMA}"."EmployeeDocument"`);
    console.log(pad("tabel EmployeeDocument (buatan uji) di-DROP — T16 bebas membuat sendiri"));
  } else {
    console.log(pad("tabel EmployeeDocument milik T16 dibiarkan (hanya baris uji dihapus)"));
  }

  await db.approvalChain.delete({ where: { id: chain.id } }); // steps ikut cascade
  await db.payrollPeriod.delete({ where: { id: period.id } });
  for (const e of [e1, e2, e3]) {
    await db.employee.delete({ where: { id: e.id } }); // assignment ikut cascade
  }
  console.log(pad("chain SLA, periode payroll, 3 karyawan uji dihapus"));

  const leftover = await q(
    `SELECT COUNT(*)::int AS n FROM "${MII_SCHEMA}"."Employee" WHERE "employeeNo" LIKE 'T14TEST%'`,
  );
  check("tidak ada data uji tersisa (Employee T14TEST* = 0)", leftover[0].n === 0);

  await pg.end();
  await getTenantClient(MII_SCHEMA).$disconnect();

  console.log(`\n${failures === 0 ? "SEMUA UJI LULUS ✓" : `${failures} UJI GAGAL ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

const mode = process.argv[2] ?? "";
if (mode === "--off") {
  void modeOff().then(() => process.exit(failures === 0 ? 0 : 1));
} else if (mode === "--interval") {
  void modeInterval().then(() => process.exit(failures === 0 ? 0 : 1));
} else {
  void main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
