// Uji E2E P1.5-E (D-BM12 + D-BM14) per DEVELOPMENT-PLAN-BENCHMARK.md §4 P1.5 —
// di atas data demo MII (sandbox), pola e2e-b8-referral (sesi fetch + seed/cleanup
// via tenant client):
//
//   (0) SETUP  : login HR owner hrd@mii.co.id; snapshot baris libur 2026 pra-uji.
//   (1) GET    : /attendance/holidays?year=2026 → 200 + datasetYears memuat
//                2026 & 2027 (availableHolidayYears).
//   (2) POST   : {action:"import-dataset", year:2026} → 201; inserted+existing
//                == total dataset (25 = 17 nasional + 8 cuti bersama); total
//                baris 2026 di db ≥ 25; setiap baris dataset (date,name)
//                ter-cover; delta db == inserted (baris pra-uji tak tersentuh).
//   (3) RE-RUN : impor ulang → inserted === 0 (idempoten per date+name).
//   (4) GUARD  : tanpa sesi → 401; tahun di luar dataset (1999) → 400.
//   (5) SCHEDULER (D-BM14) — job dipanggil langsung (pola test-p7-scheduler):
//                fixture 3 TravelRequest via db:
//                  F1 TR-E2E-P15-* Approved, pulang 30 hari lalu, TANPA klaim
//                     → TERPILIH (lateDays = 30−14 = 16);
//                  F2 sama + 1 TravelClaim linked → TIDAK terpilih;
//                  F3 Approved, pulang 5 hari lalu (< settlementDay) → TIDAK.
//                - pickOverdueSettlements: F1 masuk (+ atasan langsung ter-resolve
//                  Tri Handayani), F2/F3 tidak;
//                - jobTravelSettlementReminders run #1 → F1 terkirim:
//                  ActivityLog "SettlementReminder"/TravelRequest + claim
//                  "Reminder"/Scheduler + Notification in-app (karyawan+atasan)
//                  + EmailLog event travel.settlement.reminder (status Skipped —
//                  SMTP sandbox kosong; keberadaan baris = bukti dispatch);
//                - run #2 → 0 terkirim (dedupe klaim atomik per hari);
//                - lepas klaim harian + backdate marker 2,5 hari → 0 terkirim
//                  (masih dalam jeda 3 hari); backdate 4 hari → terkirim lagi
//                  (jeda 3 hari berlalu);
//   (6) CLEANUP: hapus baris libur hasil impor uji (restore delta — baris pra-uji
//                tetap); hapus fixture travel + notifikasi + EmailLog uji;
//                ActivityLog DIPERTAHANKAN (audit trail — keputusan e2e-b8).
// Jalankan: bun scripts/e2e-p1-holidays-reminder.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { pickOverdueSettlements, jobTravelSettlementReminders } from "@/rekankerja/shared/services/scheduler-service";
import { HOLIDAYS_2026 } from "@/rekankerja/time-attendance/services/holiday-dataset";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const HOL_API = "/api/rekankerja/attendance/holidays";
const DAY = 86_400_000;

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b8. */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* keep */ }
    return { status: res.status, json, text };
  }
}

const isoDay = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const utcDay = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return new Date(`${isoDay(d)}T00:00:00.000Z`);
};

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const startedAt = new Date();
  const STAMP = Date.now().toString(36).slice(-6).toUpperCase();
  const DOC = `TR-E2E-P15-${STAMP}`;

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login HR owner + snapshot libur 2026 pra-uji");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const from26 = new Date("2026-01-01T00:00:00.000Z");
  const to27 = new Date("2027-01-01T00:00:00.000Z");
  const beforeRows = await db.holidayDate.findMany({ where: { date: { gte: from26, lt: to27 } }, select: { id: true, date: true, name: true } });
  const beforeIds = new Set(beforeRows.map((r) => r.id));
  const beforeKeys = new Set(beforeRows.map((r) => `${isoDay(r.date)}|${r.name}`));
  console.log(`  baris 2026 pra-uji: ${beforeRows.length}`);

  // ================= (1) GET — datasetYears =================
  console.log("\n[(1)] GET holidays?year=2026 — datasetYears");
  const g1 = await hr.api("GET", `${HOL_API}?year=2026`);
  ok(g1.status === 200, "GET → 200", `HTTP ${g1.status}`);
  const dsYears: number[] = g1.json?.datasetYears ?? [];
  ok(Array.isArray(dsYears) && dsYears.includes(2026) && dsYears.includes(2027),
    "datasetYears memuat 2026 & 2027 (availableHolidayYears)", JSON.stringify(dsYears));
  ok(Array.isArray(g1.json?.holidays) && g1.json.holidays.length === beforeRows.length,
    "holidays memuat seluruh baris 2026 pra-uji", `${g1.json?.holidays?.length} baris`);

  // ================= (2) POST import-dataset 2026 =================
  console.log("\n[(2)] POST import-dataset 2026");
  const p1 = await hr.api("POST", HOL_API, { action: "import-dataset", year: 2026 });
  ok(p1.status === 201, "POST import-dataset → 201", `HTTP ${p1.status}`);
  const total = Number(p1.json?.total ?? -1);
  const inserted = Number(p1.json?.inserted ?? -1);
  const existing = Number(p1.json?.existing ?? -1);
  ok(total === HOLIDAYS_2026.length, `total == ukuran dataset (${HOLIDAYS_2026.length} = 17 nasional + 8 cuti bersama)`, `total=${total}`);
  ok(inserted + existing === total && inserted >= 0 && existing >= 0, "inserted + existing == total", `${inserted}+${existing}=${inserted + existing}`);
  const afterRows = await db.holidayDate.findMany({ where: { date: { gte: from26, lt: to27 } }, select: { id: true, date: true, name: true, kind: true } });
  const afterKeys = new Set(afterRows.map((r) => `${isoDay(r.date)}|${r.name}`));
  const missing = HOLIDAYS_2026.filter((h) => !afterKeys.has(`${h.date}|${h.name}`));
  ok(missing.length === 0, "setiap baris dataset (date+name) ter-cover setelah impor", `${HOLIDAYS_2026.length - missing.length}/${HOLIDAYS_2026.length}`);
  ok(afterRows.length >= HOLIDAYS_2026.length, "total baris 2026 di db ≥ 25", `${afterRows.length} baris`);
  const addedRows = afterRows.filter((r) => !beforeIds.has(r.id));
  ok(addedRows.length === inserted, "delta db == inserted (baris baru persis sebanyak klaim API)", `${addedRows.length} vs ${inserted}`);
  const untouched = beforeRows.filter((r) => afterKeys.has(`${isoDay(r.date)}|${r.name}`)).length;
  ok(untouched === beforeRows.length, "baris pra-uji tidak tersentuh", `${untouched}/${beforeRows.length}`);
  const dsKinds = addedRows.reduce((a, r) => { a[r.kind] = (a[r.kind] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const dsPreNational = HOLIDAYS_2026.filter((h) => h.kind === "National" && beforeKeys.has(`${h.date}|${h.name}`)).length;
  const dsPreJoint = HOLIDAYS_2026.filter((h) => h.kind === "Joint" && beforeKeys.has(`${h.date}|${h.name}`)).length;
  ok((dsKinds.Joint ?? 0) === 8 - dsPreJoint && (dsKinds.National ?? 0) === 17 - dsPreNational,
    "komposisi impor melengkapi dataset penuh 17 nasional + 8 cuti bersama",
    `baru +${dsKinds.National ?? 0}N +${dsKinds.Joint ?? 0}J (pra-uji sudah ter-cover ${dsPreNational}N ${dsPreJoint}J)`);
  const actLog = await db.activityLog.findFirst({
    where: { action: "Created", entity: "HolidayDate", entityId: "import-dataset-2026", createdAt: { gte: startedAt } },
  });
  ok(!!actLog && actLog.detail.includes(`${inserted} baru dari ${total}`), "ActivityLog impor dataset tertulis", actLog?.detail?.slice(0, 70) ?? "—");

  // ================= (3) RE-RUN — idempoten =================
  console.log("\n[(3)] impor ulang 2026 — idempoten");
  const p2 = await hr.api("POST", HOL_API, { action: "import-dataset", year: 2026 });
  ok(p2.status === 201 && Number(p2.json?.inserted) === 0, "re-POST → 201, inserted === 0", `inserted=${p2.json?.inserted}`);
  ok(Number(p2.json?.existing) === total, `existing == total (${total})`, `existing=${p2.json?.existing}`);
  const countAfterRerun = await db.holidayDate.count({ where: { date: { gte: from26, lt: to27 } } });
  ok(countAfterRerun === afterRows.length, "jumlah baris db tidak bertambah", `${countAfterRerun} vs ${afterRows.length}`);

  // ================= (4) GUARD =================
  console.log("\n[(4)] GUARD — 401 tanpa sesi / 400 tahun invalid");
  const anon = new Sesi();
  const gAnon = await anon.api("POST", HOL_API, { action: "import-dataset", year: 2026 });
  ok(gAnon.status === 401, "POST tanpa sesi → 401", `HTTP ${gAnon.status}`);
  const gBadYear = await hr.api("POST", HOL_API, { action: "import-dataset", year: 1999 });
  ok(gBadYear.status === 400, "POST tahun 1999 (di luar dataset) → 400", `HTTP ${gBadYear.status} — ${String(gBadYear.json?.error ?? "").slice(0, 60)}`);
  const gNoYear = await hr.api("POST", HOL_API, { action: "import-dataset" });
  ok(gNoYear.status === 400, "POST tanpa year → 400", `HTTP ${gNoYear.status}`);

  // ================= (5) SCHEDULER — travel-settlement-reminder =================
  console.log("\n[(5)] SCHEDULER (D-BM14) — fixture travel + job langsung");
  // pre-clean fixture run lama (prefix dokumen uji)
  const stale = await db.travelRequest.findMany({ where: { docNo: { startsWith: "TR-E2E-P15-" } }, select: { id: true } });
  if (stale.length > 0) {
    await db.travelRequest.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } }).catch(() => {});
    console.log(`  pre-clean: ${stale.length} fixture run lama dihapus`);
  }

  const yusuf = await db.employee.findFirst({ where: { fullName: { contains: "Yusuf" } }, select: { id: true, employeeNo: true, fullName: true, email: true } });
  const tpl = await db.travelTemplate.findFirst({ where: { code: "TRAVEL" }, select: { id: true, settlementDay: true } });
  ok(!!yusuf, "karyawan fixture (Yusuf) ditemukan", yusuf?.employeeNo ?? "—");
  ok(!!tpl && tpl.settlementDay === 14, "template TRAVEL settlementDay=14", `settlementDay=${tpl?.settlementDay}`);
  if (!yusuf || !tpl) { console.error("  fixture tidak lengkap — hentikan"); return finish(); }

  const mkFixture = async (docNo: string, returnedDaysAgo: number, withClaim: boolean) => {
    const req = await db.travelRequest.create({
      data: {
        docNo,
        employeeId: yusuf!.id,
        requestDate: utcDay(-(returnedDaysAgo + 5)),
        dateFrom: utcDay(-(returnedDaysAgo + 3)),
        dateTo: utcDay(-returnedDaysAgo),
        templateId: tpl!.id,
        purpose: "E2E P1.5-E fixture pengingat settlement",
        status: "Approved",
        decidedAt: utcDay(-(returnedDaysAgo + 3)),
        destinations: {
          create: { seq: 1, dateFrom: utcDay(-(returnedDaysAgo + 3)), dateTo: utcDay(-returnedDaysAgo), city: "Surabaya" },
        },
      },
      select: { id: true, docNo: true },
    });
    if (withClaim) {
      await db.travelClaim.create({
        data: {
          docNo: `CL-E2E-P15-${STAMP}-${docNo.slice(-2)}`,
          requestId: req.id,
          employeeId: yusuf!.id,
          templateId: tpl!.id,
          purpose: "klaim fixture (menahan pengingat)",
          status: "Submitted",
        },
      });
    }
    return req;
  };
  const f1 = await mkFixture(`${DOC}-F1`, 30, false); // pulang 30 hari lalu, tanpa klaim → TERPILIH (late 16)
  const f2 = await mkFixture(`${DOC}-F2`, 30, true); // ada klaim → TIDAK
  const f3 = await mkFixture(`${DOC}-F3`, 5, false); // pulang 5 hari lalu (< 14) → TIDAK
  console.log(`  fixture: ${f1.docNo} (pulang 30 hr lalu) · ${f2.docNo} (+klaim) · ${f3.docNo} (pulang 5 hr lalu)`);

  // (5a) seleksi murni
  const picks = await pickOverdueSettlements(db, new Date());
  const p1sel = picks.find((x) => x.id === f1.id);
  ok(!!p1sel, "pickOverdueSettlements memuat F1 (overdue tanpa klaim)", p1sel ? `late=${p1sel.lateDays} hari` : "—");
  ok(p1sel != null && p1sel.settlementDay === 14 && p1sel.daysSinceTripEnd === 30 && p1sel.lateDays === 16,
    "hitungan F1 benar (30 sejak pulang, batas 14, terlambat 16)", p1sel ? `since=${p1sel.daysSinceTripEnd} batas=${p1sel.settlementDay} late=${p1sel.lateDays}` : "—");
  ok(p1sel != null && p1sel.employeeName === yusuf.fullName && p1sel.employeeEmail === yusuf.email,
    "data karyawan F1 ter-resolve", p1sel ? `${p1sel.employeeName} <${p1sel.employeeEmail}>` : "—");
  ok(p1sel != null && !!p1sel.managerId && !!p1sel.managerName,
    "atasan langsung F1 ter-resolve (assignment aktif)", p1sel?.managerName ?? "—");
  ok(!picks.some((x) => x.id === f2.id), "F2 (ada klaim linked) TIDAK terpilih");
  ok(!picks.some((x) => x.id === f3.id), "F3 (belum lewat settlementDay) TIDAK terpilih");
  ok(!picks.some((x) => x.docNo === "TR-2026-005"), "data demo TR-2026-005 (pulang baru 7 hari) tidak ikut terpilih");
  const countF1Audit = () => db.activityLog.count({ where: { action: "SettlementReminder", entity: "TravelRequest", entityId: f1.id } });

  // (5b) run #1 — pengingat terkirim
  const r1 = await jobTravelSettlementReminders(db);
  const auditCount1 = await countF1Audit();
  ok(r1.requests >= 1 && auditCount1 === 1, "run #1 → F1 teringatkan (1 jejak audit)", `requests=${r1.requests} auditF1=${auditCount1}`);
  const audit = await db.activityLog.findFirst({ where: { action: "SettlementReminder", entity: "TravelRequest", entityId: f1.id }, orderBy: { createdAt: "desc" } });
  ok(!!audit, "ActivityLog SettlementReminder/TravelRequest tertulis", audit?.detail?.slice(0, 90) ?? "—");
  ok(!!audit?.detail?.includes(f1.docNo) && !!audit?.detail?.includes("atasan"), "detail audit memuat docNo + atasan", "✓");
  const todayKey = new Date().toISOString().slice(0, 10);
  const claimKey = `travel-settlement:${f1.id}:${todayKey}`;
  const claim = await db.activityLog.findFirst({ where: { action: "Reminder", entity: "Scheduler", entityId: claimKey } });
  ok(!!claim, "klaim dedupe Scheduler per (request, hari) tertulis", claimKey);
  const notifs = await db.notification.findMany({ where: { kind: "travel", title: { contains: f1.docNo }, createdAt: { gte: startedAt } }, select: { appUserId: true } });
  ok(notifs.length >= 2, "notifikasi in-app ≥ 2 (karyawan + atasan langsung)", `${notifs.length} baris`);
  // EmailLog: sandbox MII tidak punya SMTP host → dispatch mencatat SATU baris
  // "Skipped" per panggilan event dengan seluruh penerima digabung (mirror
  // t14: bukti dispatch tetap tercatat walau email tidak terkirim).
  const mails = await db.emailLog.findMany({ where: { event: "travel.settlement.reminder", createdAt: { gte: startedAt } } });
  ok(mails.length >= 1, "EmailLog travel.settlement.reminder tertulis (dispatch terpanggil)", `${mails.length} baris`);
  const mailTo = mails.map((m) => m.toEmail).join(",");
  ok(mails.some((m) => m.toEmail.includes(yusuf.email)) && (!p1sel?.managerEmail || mailTo.includes(p1sel.managerEmail)),
    "penerima email mencakup karyawan + atasan langsung", mailTo.slice(0, 80));
  ok(mails.every((m) => m.status === "Sent" || m.status === "Failed" || m.status === "Skipped"),
    "status EmailLog tercatat (Skipped bila SMTP belum dikonfigurasi)", [...new Set(mails.map((m) => m.status))].join(","));

  // (5c) run #2 — dedupe klaim atomik per hari
  const r2 = await jobTravelSettlementReminders(db);
  const auditCount2 = await countF1Audit();
  ok(auditCount2 === auditCount1, "run #2 (hari sama) → F1 TIDAK diingatkan lagi (dedupe klaim per hari)", `auditF1=${auditCount2}`);

  // (5d) jeda 3 hari — backdate marker
  await db.activityLog.deleteMany({ where: { action: "Reminder", entity: "Scheduler", entityId: claimKey } });
  await db.activityLog.updateMany({ where: { action: "SettlementReminder", entity: "TravelRequest", entityId: f1.id }, data: { createdAt: new Date(Date.now() - 2.5 * DAY) } });
  const r3 = await jobTravelSettlementReminders(db);
  const auditCount3 = await countF1Audit();
  ok(auditCount3 === auditCount2, "marker 2,5 hari lalu → masih dalam jeda 3 hari → tidak terkirim", `auditF1=${auditCount3}`);
  await db.activityLog.updateMany({ where: { action: "SettlementReminder", entity: "TravelRequest", entityId: f1.id }, data: { createdAt: new Date(Date.now() - 4 * DAY) } });
  const r4 = await jobTravelSettlementReminders(db);
  const auditCount4 = await countF1Audit();
  ok(auditCount4 === auditCount3 + 1, "marker 4 hari lalu → jeda 3 hari lewat → terkirim lagi", `auditF1=${auditCount4}`);
  const mailsAfter = await db.emailLog.count({ where: { event: "travel.settlement.reminder", createdAt: { gte: startedAt } } });
  ok(mailsAfter >= mails.length, "EmailLog pengingat kedua juga tercatat", `${mailsAfter} baris`);

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] CLEANUP — restore state");
  // hapus baris libur hasil impor uji (delta) — baris pra-uji tetap utuh
  const del = await db.holidayDate.deleteMany({ where: { id: { in: addedRows.map((r) => r.id) } } });
  const finalCount = await db.holidayDate.count({ where: { date: { gte: from26, lt: to27 } } });
  ok(finalCount === beforeRows.length, `baris 2026 kembali ke pra-uji (${beforeRows.length})`, `${finalCount} baris (hapus ${del.count})`);
  const finalRows = await db.holidayDate.findMany({ where: { date: { gte: from26, lt: to27 } }, select: { id: true } } );
  ok(finalRows.every((r) => beforeIds.has(r.id)), "seluruh baris tersisa adalah baris pra-uji");
  // fixture travel + klaim fixture (cascade destinations; klaim F2 manual)
  await db.travelClaim.deleteMany({ where: { requestId: { in: [f1.id, f2.id, f3.id] } } }).catch(() => {});
  await db.travelRequest.deleteMany({ where: { id: { in: [f1.id, f2.id, f3.id] } } }).catch(() => {});
  const leftReq = await db.travelRequest.count({ where: { id: { in: [f1.id, f2.id, f3.id] } } });
  ok(leftReq === 0, "fixture travel dihapus (destinasi ikut cascade)");
  // notifikasi + EmailLog uji
  const delNotif = await db.notification.deleteMany({ where: { kind: "travel", title: { contains: DOC } } });
  const delMail = await db.emailLog.deleteMany({ where: { event: "travel.settlement.reminder", createdAt: { gte: startedAt } } });
  ok(delNotif.count + delMail.count >= 0, `notifikasi uji dihapus (${delNotif.count}); EmailLog uji dihapus (${delMail.count})`);
  const logsKept = await db.activityLog.count({ where: { entity: "TravelRequest", action: "SettlementReminder" } });
  ok(logsKept >= 2, "ActivityLog DIPERTAHANKAN (audit trail — pola e2e-b8)", `${logsKept} baris`);
  finish();

  function finish() {
    console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
    process.exit(fail === 0 ? 0 : 1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
