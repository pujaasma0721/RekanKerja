// Uji E2E B8 (Referral tracker) per DEVELOPMENT-PLAN-BACKLOG.md §4 B8 +
// mitigasi §5 "Insentif referral disalahpahami otomatis" (insentif = catatan
// MANUAL HR — DI LUAR payroll) — di atas data demo MII:
//   (0) SETUP: login HR owner hrd@mii.co.id + login ESS yusuf@mii.co.id;
//       catat jumlah referral existing utk delta; SEED via db 3 Applicant:
//       A1 (perujuk yusuf, Active + 1 lamaran slot demo + referralNote),
//       A2 (perujuk yusuf, Employed — terkonversi), A3 (perujuk Joko MII00005).
//   (1) ESS SELF-SCOPE: yusuf GET my-referrals → 2 baris (A1+A2), TANPA A3,
//       TANPA field referralRewardNote (assert key tidak ada), stats benar.
//   (2) REGISTER HR: GET referrals → memuat 3 baris uji (delta +3); filter
//       q nama A1 → 1; rewardOnly=1 → 0 (belum ada insentif).
//   (3) CATAT INSENTIF (manual — di luar payroll): POST updateReward A2 →
//       200 + db tersimpan + ActivityLog "ReferralRewardNote" + rewardOnly=1
//       → 1; update kedua (ubah teks) → ActivityLog bertambah; clear kosong
//       → null + rewardOnly → 0.
//   (4) GUARD: ESS yusuf POST updateReward → 403; ESS yusuf GET referrals →
//       403 (menu-guard tanpa menu admin); applicantId tak-ada → 404;
//       payload >500 char → 400.
//   (5) LINTAS TENANT: Applicant di schema cahaya ber-referralEmployeeId
//       karyawan MII yusuf (via db — di dunia nyata mustahil lewat UI);
//       register MII TIDAK memuatnya (resolusi tenant via SESSION, bukan input).
//   (6) CLEANUP: hapus Applicant uji (MII 3 + cahaya 1); ActivityLog TIDAK
//       dihapus (audit trail — keputusan backlog B8).
// Jalankan: bun scripts/e2e-b8-referral.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const CAHAYA_SCHEMA = "tenant_cahaya_digital_nusantara";
const REF_API = "/api/rekankerja/recruitment/referrals";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b7. */
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

async function main() {
  const db = getTenantClient(SCHEMA);
  const cdb = getTenantClient(CAHAYA_SCHEMA);
  const hr = new Sesi();
  const ess = new Sesi();
  const startedAt = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + seed 3 Applicant uji via db");
  const loginHr = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(loginHr.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${loginHr.status}`);
  const loginEss = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(loginEss.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${loginEss.status}`);

  const yusuf = await db.employee.findFirst({ where: { fullName: { contains: "Yusuf" } }, select: { id: true, employeeNo: true, fullName: true } });
  const joko = await db.employee.findFirst({ where: { fullName: { contains: "Joko" } }, select: { id: true, employeeNo: true, fullName: true } });
  ok(!!yusuf, "karyawan perujuk yusuf ditemukan", yusuf?.employeeNo ?? "—");
  ok(!!joko, "karyawan perujuk lain (Joko) ditemukan", joko?.employeeNo ?? "—");

  const slot = await db.jobOpening.findFirst({
    where: { status: "Open", jobOpportunity: { status: "Posted" } },
    select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true } } },
  });
  ok(!!slot, "slot lowongan Open+Posted tersedia (data demo MII)", slot?.titleToShow ?? "—");

  // pre-clean DULU (sebelum snapshot state): applicant uji run terdahulu
  // yang gagal sebelum cleanup — supaya delta pra-uji akurat.
  const stale = await db.applicant.findMany({ where: { applicantNo: { startsWith: "APP-E2E-B8-" } }, select: { id: true } });
  if (stale.length > 0) {
    await db.applicant.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    console.log(`  pre-clean: ${stale.length} applicant uji run lama dihapus`);
  }

  const beforeReferralCount = await db.applicant.count({ where: { referralEmployeeId: { not: null } } });
  const beforeRewardedCount = await db.applicant.count({ where: { referralEmployeeId: { not: null }, referralRewardNote: { not: null } } });
  const beforeLogCount = await db.activityLog.count({ where: { action: "ReferralRewardNote" } });
  console.log(`  state pra-uji: referral=${beforeReferralCount}, ber-insentif=${beforeRewardedCount}, log=${beforeLogCount}`);

  const NONCE = `${Date.now().toString(36)}`;
  const mkNo = (n: string) => `APP-E2E-B8-${NONCE.slice(-6).toUpperCase()}-${n}`;
  const mkName = (n: string) => `E2e B8 ${n} ${NONCE.slice(-4).toUpperCase()}`;

  const a1 = await db.applicant.create({
    data: {
      applicantNo: mkNo("A1"), firstName: mkName("Referral Satu"),
      status: "Active", referralEmployeeId: yusuf!.id, referralNote: "Teman kuliah, rajin",
      applications: slot ? { create: { jobOpeningId: slot.id, status: "Received" } } : undefined,
    },
    select: { id: true, applicantNo: true },
  });
  const a2 = await db.applicant.create({
    data: {
      applicantNo: mkNo("A2"), firstName: mkName("Referral Dua"),
      status: "Employed", referralEmployeeId: yusuf!.id,
    },
    select: { id: true, applicantNo: true },
  });
  const a3 = await db.applicant.create({
    data: {
      applicantNo: mkNo("A3"), firstName: mkName("Referral Tiga"),
      status: "Active", referralEmployeeId: joko!.id,
    },
    select: { id: true, applicantNo: true },
  });
  ok(!!a1 && !!a2 && !!a3, "3 Applicant uji dibuat (A1 yusuf Active+lamaran, A2 yusuf Employed, A3 joko)",
    `${a1.applicantNo} / ${a2.applicantNo} / ${a3.applicantNo}`);

  // ================= (1) ESS SELF-SCOPE =================
  console.log("\n[(1)] ESS — my-referrals yusuf (self-scope, tanpa rewardNote)");
  const essR = await ess.api("GET", "/api/rekankerja/ess/my-referrals");
  ok(essR.status === 200, "GET my-referrals → 200", `HTTP ${essR.status}`);
  const essRows: any[] = essR.json?.rows ?? [];
  const essNos = essRows.map((r) => r.applicantNo);
  ok(essRows.filter((r) => [a1.applicantNo, a2.applicantNo].includes(r.applicantNo)).length === 2,
    "my-referrals memuat 2 baris yusuf (A1 + A2)", essNos.join(","));
  ok(!essNos.includes(a3.applicantNo), "TANPA A3 (perujuk Joko — bukan milik yusuf)");
  const a1Row = essRows.find((r) => r.applicantNo === a1.applicantNo);
  ok(!!a1Row && a1Row.referralNote === "Teman kuliah, rajin", "referralNote A1 tampil utk perujuk", a1Row?.referralNote ?? "—");
  ok(!!a1Row?.latestApplication && a1Row.latestApplication.slotTitle === slot?.titleToShow,
    "slot dilamar A1 tampil (title)", a1Row?.latestApplication?.slotTitle ?? "—");
  const essStats = essR.json?.stats ?? {};
  const expectedTotal = await db.applicant.count({ where: { referralEmployeeId: yusuf!.id } });
  ok(essStats.total === expectedTotal, "stats ESS total benar (semua referral yusuf)", `${essStats.total} vs ${expectedTotal}`);
  ok(essStats.employed === (await db.applicant.count({ where: { referralEmployeeId: yusuf!.id, status: "Employed" } })),
    "stats ESS employed benar", `${essStats.employed}`);
  // TIDAK ada field referralRewardNote di payload ESS — assert key tidak ada
  const hasRewardKey = essRows.some((r) => Object.prototype.hasOwnProperty.call(r, "referralRewardNote"));
  ok(!hasRewardKey, "payload ESS TIDAK memuat key referralRewardNote (internal HR)");
  const essText = JSON.stringify(essR.json);
  ok(!essText.includes("ReferralRewardNote") && !/"referralRewardNote"/.test(essText), "tidak ada jejak rewardNote di respons ESS");

  // ================= (2) REGISTER HR =================
  console.log("\n[(2)] REGISTER HR — GET referrals + filter");
  const regR = await hr.api("GET", REF_API);
  ok(regR.status === 200, "GET referrals (HR owner) → 200", `HTTP ${regR.status}`);
  const regRows: any[] = regR.json?.rows ?? [];
  const regNos = regRows.map((r) => r.applicantNo);
  ok(regNos.includes(a1.applicantNo) && regNos.includes(a2.applicantNo) && regNos.includes(a3.applicantNo),
    "register memuat SEMUA 3 baris uji (delta +3)");
  ok((regR.json?.stats?.total ?? -1) === beforeReferralCount + 3, "stats.total = pra-uji + 3", `${regR.json?.stats?.total} vs ${beforeReferralCount + 3}`);
  ok(regR.json?.stats?.employed >= 1 && (regR.json?.stats?.rewarded ?? -1) === beforeRewardedCount, "stats.employed/rewarded baseline benar",
    `employed=${regR.json?.stats?.employed} rewarded=${regR.json?.stats?.rewarded}`);
  const a1Reg = regRows.find((r) => r.applicantNo === a1.applicantNo);
  ok(!!a1Reg?.referrer && a1Reg.referrer.employeeNo === yusuf?.employeeNo, "kolom perujuk A1 = yusuf (no + nama)", `${a1Reg?.referrer?.employeeNo} — ${a1Reg?.referrer?.fullName}`);
  ok(a1Reg?.referralNote === "Teman kuliah, rajin", "register menampilkan referralNote A1");
  ok(a1Reg?.latestApplication?.joRefNo === slot?.jobOpportunity.refNo, "register menampilkan slot A1 (joRefNo)", a1Reg?.latestApplication?.joRefNo ?? "—");
  const qR = await hr.api("GET", `${REF_API}?q=${encodeURIComponent(mkName("Referral Satu"))}`);
  const qRows: any[] = qR.json?.rows ?? [];
  ok(qR.status === 200 && qRows.length === 1 && qRows[0]?.applicantNo === a1.applicantNo, "filter q nama A1 → tepat 1 baris", `${qRows.length} baris`);
  const ro0 = await hr.api("GET", `${REF_API}?rewardOnly=1`);
  ok(ro0.status === 200 && (ro0.json?.rows ?? []).length === beforeRewardedCount, `filter rewardOnly=1 → ${beforeRewardedCount} (belum ada insentif baru)`, `${(ro0.json?.rows ?? []).length} baris`);

  // ================= (3) CATAT INSENTIF (manual — di luar payroll) =================
  console.log("\n[(3)] INSENTIF — updateReward A2 + ActivityLog");
  const NOTE1 = "Bonus Rp 2.000.000 — dibayar manual via kasir Q4";
  const rw1 = await hr.api("POST", REF_API, { action: "updateReward", applicantId: a2.id, referralRewardNote: NOTE1 });
  ok(rw1.status === 200 && rw1.json?.row?.referralRewardNote === NOTE1, "POST updateReward A2 → 200 + catatan kembali", `HTTP ${rw1.status}`);
  const a2db1 = await db.applicant.findUnique({ where: { id: a2.id }, select: { referralRewardNote: true } });
  ok(a2db1?.referralRewardNote === NOTE1, "db tersimpan persis", a2db1?.referralRewardNote ?? "—");
  const log1 = await db.activityLog.count({ where: { action: "ReferralRewardNote", entityId: a2.applicantNo } });
  ok(log1 === 1, "ActivityLog ReferralRewardNote tertulis (set)", `${log1} baris`);
  const logDetail = await db.activityLog.findFirst({ where: { action: "ReferralRewardNote", entityId: a2.applicantNo }, select: { detail: true } });
  ok(!!logDetail?.detail && logDetail.detail.includes(NOTE1) && logDetail.detail.toLowerCase().includes("payroll"),
    "detail log memuat catatan + penegasan di luar payroll", logDetail?.detail?.slice(0, 80) ?? "—");
  const ro1 = await hr.api("GET", `${REF_API}?rewardOnly=1`);
  ok((ro1.json?.rows ?? []).length === beforeRewardedCount + 1, "rewardOnly=1 → +1 (A2 ber-insentif)", `${(ro1.json?.rows ?? []).length} baris`);
  const regAfter = await hr.api("GET", REF_API);
  ok(regAfter.json?.stats?.rewarded === beforeRewardedCount + 1, "stats.rewarded bertambah 1", `${regAfter.json?.stats?.rewarded}`);

  // ESS yusuf TIDAK melihat insentif yang baru dicatat (self-scope tanpa rewardNote)
  const essAfter = await ess.api("GET", "/api/rekankerja/ess/my-referrals");
  ok(!JSON.stringify(essAfter.json).includes(NOTE1), "insentif TIDAK bocor ke my-referrals ESS");

  const NOTE2 = "Bonus Rp 2.500.000 — dibayar manual via kasir Q4 (revisi)";
  const rw2 = await hr.api("POST", REF_API, { action: "updateReward", applicantId: a2.id, referralRewardNote: NOTE2 });
  ok(rw2.status === 200 && rw2.json?.row?.referralRewardNote === NOTE2, "update kedua (ubah teks) → 200");
  const log2 = await db.activityLog.count({ where: { action: "ReferralRewardNote", entityId: a2.applicantNo } });
  ok(log2 === 2, "ActivityLog BERTAMBAH (mutasi ke-2 ter-audit)", `${log2} baris`);
  const rw3 = await hr.api("POST", REF_API, { action: "updateReward", applicantId: a2.id, referralRewardNote: "" });
  ok(rw3.status === 200 && rw3.json?.row?.referralRewardNote === null, "clear (note kosong) → null", `HTTP ${rw3.status}`);
  const a2db2 = await db.applicant.findUnique({ where: { id: a2.id }, select: { referralRewardNote: true } });
  ok(a2db2?.referralRewardNote === null, "db rewardNote null setelah clear");
  const log3 = await db.activityLog.count({ where: { action: "ReferralRewardNote", entityId: a2.applicantNo } });
  ok(log3 === 3, "ActivityLog clear juga ter-audit (before → kosong)", `${log3} baris`);

  // ================= (4) GUARD =================
  console.log("\n[(4)] GUARD — 403/404/400");
  const gEssPost = await ess.api("POST", REF_API, { action: "updateReward", applicantId: a2.id, referralRewardNote: "coba bobol" });
  ok(gEssPost.status === 403, "ESS yusuf POST updateReward → 403", `HTTP ${gEssPost.status}`);
  const gEssGet = await ess.api("GET", REF_API);
  ok(gEssGet.status === 403, "ESS yusuf GET referrals → 403 (menu-guard tanpa menu admin)", `HTTP ${gEssGet.status}`);
  const gNoUser = await hr.api("POST", REF_API, { action: "updateReward", applicantId: "tidak-ada-xyz", referralRewardNote: "x" });
  ok(gNoUser.status === 404, "updateReward applicantId tak-ada → 404", `HTTP ${gNoUser.status}`);
  const gLong = await hr.api("POST", REF_API, { action: "updateReward", applicantId: a1.id, referralRewardNote: "x".repeat(501) });
  ok(gLong.status === 400, "payload >500 char → 400", `HTTP ${gLong.status}`);
  const gAction = await hr.api("POST", REF_API, { action: "apa-aja", applicantId: a1.id });
  ok(gAction.status === 400, "aksi tak dikenal → 400", `HTTP ${gAction.status}`);

  // ================= (5) LINTAS TENANT =================
  console.log("\n[(5)] LINTAS TENANT — applicant cahaya ber-perujuk MII yusuf");
  // FK Applicant.referralEmployeeId mencegah tulis langsung lintas schema
  // (temuan bagus — defense-in-depth di DB). Untuk mensimulasikan ID karyawan
  // MII yusuf hadir di schema cahaya, buat Employee cahaya dgn ID SAMA persis
  // lalu Applicant cahaya ber-referralEmployeeId itu (di dunia nyata mustahil
  // lewat UI — resolusi tenant via SESSION membership, bukan input).
  const cahayaCompanyExisted = await cdb.company.findFirst({ select: { id: true } });
  const cahayaCompany = cahayaCompanyExisted
    ?? (await cdb.company.create({
      // schema cahaya kosong (0 company/employee) — buat company minimal utk FK
      data: { code: `X-B8-${NONCE.slice(-6).toUpperCase()}`, name: "E2E B8 Tenant Cahaya (uji)" },
      select: { id: true },
    }));
  ok(!!cahayaCompany, "company cahaya tersedia utk FK Employee", cahayaCompanyExisted ? "existing" : "dibuat utk uji");
  const CAHAYA_NO = `APP-E2E-B8-X-${NONCE.slice(-6).toUpperCase()}`;
  const cahayaEmp = await cdb.employee.create({
    data: {
      id: yusuf!.id, // ID karyawan MII yusuf — sama persis, di schema cahaya
      employeeNo: `X-B8-${NONCE.slice(-6).toUpperCase()}`,
      fullName: "Yusuf Rahayu (MII)",
      companyId: cahayaCompany!.id,
    },
    select: { id: true },
  });
  const cahayaApp = await cdb.applicant.create({
    data: {
      applicantNo: CAHAYA_NO, firstName: "E2e B8 Cross", status: "Active",
      referralEmployeeId: cahayaEmp.id,
    },
    select: { id: true },
  });
  const regCross = await hr.api("GET", REF_API);
  const crossRows: any[] = regCross.json?.rows ?? [];
  ok(!crossRows.some((r) => r.applicantNo === CAHAYA_NO), "register MII TIDAK memuat applicant cahaya (resolusi tenant via SESSION)");
  ok(crossRows.some((r) => r.applicantNo === a1.applicantNo), "register MII tetap memuat data MII");
  const essCross = await ess.api("GET", "/api/rekankerja/ess/my-referrals");
  ok(!(essCross.json?.rows ?? []).some((r: { applicantNo: string }) => r.applicantNo === CAHAYA_NO),
    "my-referrals yusuf TIDAK memuat applicant cahaya");

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] CLEANUP — hapus applicant uji (ActivityLog DIPERTAHANKAN — audit trail)");
  await db.applicant.deleteMany({ where: { id: { in: [a1.id, a2.id, a3.id] } } }).catch(() => {});
  await cdb.applicant.delete({ where: { id: cahayaApp.id } }).catch(() => {});
  await cdb.employee.delete({ where: { id: cahayaEmp.id } }).catch(() => {});
  if (!cahayaCompanyExisted) {
    await cdb.company.delete({ where: { id: cahayaCompany.id } }).catch(() => {}); // company uji ikut dibersihkan
  }
  const leftMii = await db.applicant.count({ where: { id: { in: [a1.id, a2.id, a3.id] } } });
  const leftCahaya = await cdb.applicant.count({ where: { id: cahayaApp.id } });
  ok(leftMii === 0 && leftCahaya === 0, "semua applicant uji dihapus (MII 3 + cahaya 1)", `sisa ${leftMii + leftCahaya}`);
  const finalReferral = await db.applicant.count({ where: { referralEmployeeId: { not: null } } });
  ok(finalReferral === beforeReferralCount, "jumlah referral kembali ke pra-uji", `${finalReferral} vs ${beforeReferralCount}`);
  const logsKept = await db.activityLog.count({ where: { action: "ReferralRewardNote", entityId: a2.applicantNo } });
  ok(logsKept === 3, "ActivityLog uji DIPERTAHANKAN (3 baris — audit trail, tidak dihapus)", `${logsKept} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
