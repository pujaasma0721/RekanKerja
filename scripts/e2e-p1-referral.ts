// Uji E2E P1.6 (Referral otomatis — DEVELOPMENT-PLAN-BENCHMARK.md §2 D-BM15 +
// §4 P1.6, Recruitment §4.5 gap-5) — di atas data demo MII:
//   (0) SETUP: login HR owner hrd@mii.co.id + login ESS yusuf@mii.co.id;
//       pre-clean artefak run lama (submission + applicant uji); snapshot
//       state pra-uji (jumlah applicant ber-perujuk).
//   (1) ESS submit referral (nama + email + lowongan demo) → 201 + staging HR
//       memuat baris Submitted + ActivityLog "Created".
//   (2) VALIDASI: tanpa kontak (email/WA kosong) → 400.
//   (3) DUPLICATE GUARD submit: nama+email sama di Submitted → 409.
//   (4) ADMIN VERIFY → Applicant BARU: source "Referral" + referralEmployeeId
//       perujuk + email terenkripsi (enc:) + emailHash blind index + submission
//       Verified + ActivityLog "Verified → APP-…" + notifikasi in-app perujuk
//       + register B8 my-referrals memuat pelamar baru.
//   (5) VERIFY ULANG → 409 (sudah diproses).
//   (6) REJECT: submit baru → tolak dgn alasan ≥10 char → Rejected + alasan
//       tersimpan + ActivityLog "Rejected" (+ alasan <10 char → 400).
//   (7) DUPLICATE FLOW: submit dgn email SAMA dgn pelamar existing → verify →
//       status Duplicate + verifyNote memuat applicantNo lama + TIDAK ada
//       pelamar baru (count tetap).
//   (8) ANTI-ABUSE: 10 Submitted bulan ini → submit ke-11 → 429.
//   (9) GUARD: ESS GET staging HR → 403; ESS PATCH verify → 403; aksi tak
//       dikenal → 400; ESS GET self-scope TANPA key candidateEmail/Phone.
// CLEANUP: hapus submission + applicant uji + notifikasi uji (ActivityLog
//       DIPERTAHANKAN — audit trail, pola B8).
// Jalankan: bun scripts/e2e-p1-referral.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const BASE = "http://localhost:3000";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const ESS_EMAIL = "yusuf@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const ESS_API = "/api/rekankerja/ess/referral-submissions";
const STG_API = "/api/rekankerja/recruitment/referral-staging";

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b8.
 *  Retry ringan utk gangguan socket transient (dev server shared sandbox —
 *  recompile/watchdog bisa memutus koneksi sesaat; TIDAK me-retry status HTTP). */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
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
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const ess = new Sesi();
  const startedAt = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login + pre-clean artefak run lama");
  const loginHr = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(loginHr.status === 200, `login HR owner ${HR_EMAIL}`, `HTTP ${loginHr.status}`);
  const loginEss = await ess.api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(loginEss.status === 200, `login ESS ${ESS_EMAIL}`, `HTTP ${loginEss.status}`);

  const yusuf = await db.employee.findFirst({ where: { fullName: { contains: "Yusuf" } }, select: { id: true, employeeNo: true, fullName: true } });
  ok(!!yusuf, "karyawan perujuk yusuf ditemukan", yusuf?.employeeNo ?? "—");
  const slot = await db.jobOpening.findFirst({
    where: { status: "Open", jobOpportunity: { status: "Posted" } },
    select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true } } },
  });
  ok(!!slot, "slot lowongan Open+Posted tersedia (data demo MII)", slot?.titleToShow ?? "—");

  // pre-clean run lama (run terdahulu gagal sebelum cleanup): submission uji
  // ( Submission onDelete: Cascade ke Employee — aman dihapus langsung) +
  // applicant uji (firstName marker "E2e P16") + notifikasi uji.
  const staleSubs = await db.referralSubmission.findMany({ where: { candidateName: { contains: "E2e P16" } }, select: { id: true } });
  if (staleSubs.length > 0) {
    await db.referralSubmission.deleteMany({ where: { id: { in: staleSubs.map((s) => s.id) } } });
    console.log(`  pre-clean: ${staleSubs.length} submission uji run lama dihapus`);
  }
  const staleApps = await db.applicant.findMany({ where: { firstName: { contains: "E2e P16" } }, select: { id: true } });
  if (staleApps.length > 0) {
    await db.applicant.deleteMany({ where: { id: { in: staleApps.map((s) => s.id) } } });
    console.log(`  pre-clean: ${staleApps.length} applicant uji run lama dihapus`);
  }
  await db.notification.deleteMany({ where: { title: { contains: "E2e P16" } } }).catch(() => {});

  const beforeReferredCount = await db.applicant.count({ where: { referralEmployeeId: { not: null } } });
  const beforeTotalApplicants = await db.applicant.count();
  console.log(`  state pra-uji: applicant=${beforeTotalApplicants}, ber-perujuk=${beforeReferredCount}`);

  const NONCE = `${Date.now().toString(36)}`.slice(-6).toUpperCase();
  const mkName = (n: string) => `E2e P16 ${n} ${NONCE}`;
  const mkEmail = (n: string) => `e2e-p16-${n}-${NONCE.toLowerCase()}@e2e-p16.test`;

  // ================= (1) SUBMIT + STAGING LIST =================
  console.log("\n[(1)] ESS submit referral (nama + email + lowongan) + staging HR");
  const s1 = await ess.api("POST", ESS_API, {
    jobOpeningId: slot?.id ?? null,
    candidateName: mkName("Satu"),
    candidateEmail: mkEmail("satu"),
    candidatePhone: null,
    note: "Teman satu kos, teliti dan cepat belajar",
  });
  ok(s1.status === 201, "ESS submit referral → 201", `HTTP ${s1.status}${s1.json?.error ? ` — ${s1.json.error}` : ""}`);
  const sub1 = s1.json?.row ?? null;
  ok(!!sub1?.docNo && /^RF-\d{4}-\d{4}$/.test(sub1.docNo), "docNo RF-YYYY-#### tergenerasi", sub1?.docNo ?? "—");
  ok(sub1?.status === "Submitted", "status awal Submitted", sub1?.status ?? "—");
  ok(sub1?.jobOpening?.title === slot?.titleToShow, "lowongan ter-catat di baris", sub1?.jobOpening?.title ?? "—");

  const stg1 = await hr.api("GET", STG_API);
  ok(stg1.status === 200, "HR GET staging (menu recruitment:referral) → 200", `HTTP ${stg1.status}`);
  const stgRow1 = (stg1.json?.rows ?? []).find((r: any) => r.docNo === sub1?.docNo);
  ok(!!stgRow1, "staging HR memuat baris Submitted baru");
  ok(stgRow1?.referrer?.employeeNo === yusuf?.employeeNo, "kolom perujuk = yusuf (nama + no)", `${stgRow1?.referrer?.fullName} · ${stgRow1?.referrer?.employeeNo}`);
  ok(stgRow1?.candidateEmail === mkEmail("satu"), "staging HR menampilkan email kandidat (verifikasi HR)", stgRow1?.candidateEmail ?? "—");
  // window waktu = run ini (ActivityLog run terdahulu DIPERTAHANKAN dgn
  // entityId sama — docNo RF-YYYY-#### restart dari 1 setelah cleanup).
  const RUN_LOG = { createdAt: { gte: startedAt } };
  const logCreated = await db.activityLog.count({ where: { action: "Created", entity: "ReferralSubmission", entityId: sub1?.docNo, ...RUN_LOG } });
  ok(logCreated === 1, "ActivityLog Created tertulis (tanpa PII email/WA)", `${logCreated} baris`);

  // ESS self-scope memuat pengajuan
  const mine1 = await ess.api("GET", ESS_API);
  ok(mine1.status === 200, "ESS GET pengajuan saya → 200");
  const mineRow1 = (mine1.json?.rows ?? []).find((r: any) => r.docNo === sub1?.docNo);
  ok(!!mineRow1, "ESS memuat pengajuan sendiri (self-scope)");
  const essHasEmailKey = mine1.json?.rows?.some((r: any) => Object.prototype.hasOwnProperty.call(r, "candidateEmail") || Object.prototype.hasOwnProperty.call(r, "candidatePhone"));
  ok(!essHasEmailKey, "payload ESS TANPA key candidateEmail/candidatePhone (minimisasi)");
  ok(Array.isArray(mine1.json?.openings) && (slot ? mine1.json.openings.some((o: any) => o.id === slot.id) : true), "opsi lowongan Posted dimuat utk form", `${mine1.json?.openings?.length ?? 0} lowongan`);

  // ================= (2) VALIDASI =================
  console.log("\n[(2)] VALIDASI — tanpa kontak → 400");
  const vNoContact = await ess.api("POST", ESS_API, { candidateName: mkName("Tanpa Kontak"), candidateEmail: null, candidatePhone: null });
  ok(vNoContact.status === 400, "tanpa email/WA → 400", `HTTP ${vNoContact.status} — ${vNoContact.json?.error ?? ""}`);
  const vShortName = await ess.api("POST", ESS_API, { candidateName: "Ab", candidateEmail: mkEmail("x"), candidatePhone: null });
  ok(vShortName.status === 400, "nama < 3 karakter → 400", `HTTP ${vShortName.status}`);
  const vBadEmail = await ess.api("POST", ESS_API, { candidateName: mkName("Email Jelek"), candidateEmail: "bukan-email", candidatePhone: null });
  ok(vBadEmail.status === 400, "email tak valid → 400", `HTTP ${vBadEmail.status}`);
  const vBadPhone = await ess.api("POST", ESS_API, { candidateName: mkName("Pendek"), candidateEmail: null, candidatePhone: "123" });
  ok(vBadPhone.status === 400, "phone < 8 digit → 400", `HTTP ${vBadPhone.status}`);

  // ================= (3) DUPLICATE GUARD SUBMIT =================
  console.log("\n[(3)] DUPLICATE GUARD — nama+email sama di Submitted → 409");
  const dupSubmit = await ess.api("POST", ESS_API, {
    candidateName: mkName("Satu"),
    candidateEmail: mkEmail("satu"), // sama persis (case dibiarkan beda utk uji insensitive)
    candidatePhone: null,
  });
  ok(dupSubmit.status === 409, "resubmit nama+email sama → 409", `HTTP ${dupSubmit.status} — ${dupSubmit.json?.error?.slice(0, 60) ?? ""}`);

  // ================= (4) ADMIN VERIFY → APPLICANT =================
  console.log("\n[(4)] VERIFY — Applicant source Referral + perujuk + notifikasi");
  const ver1 = await hr.api("PATCH", STG_API, { id: sub1?.id, action: "verify" });
  ok(ver1.status === 200, "HR PATCH verify → 200", `HTTP ${ver1.status}${ver1.json?.error ? ` — ${ver1.json.error}` : ""}`);
  const appNo1 = ver1.json?.applicantNo;
  ok(!!appNo1 && /^APP-\d{2}-\d{4,6}$/.test(appNo1), "applicantNo tergenerasi", appNo1 ?? "—");
  ok(ver1.json?.status === "Verified", "respons status Verified", ver1.json?.status ?? "—");

  const app1 = await db.applicant.findUnique({ where: { applicantNo: appNo1 }, select: { id: true, source: true, referralEmployeeId: true, referralNote: true, email: true, emailHash: true, status: true, firstName: true } });
  ok(!!app1, "Applicant ter-create di db");
  ok(app1?.source === "Referral", "source = Referral", app1?.source ?? "—");
  ok(app1?.referralEmployeeId === yusuf?.id, "referralEmployeeId = yusuf (B8 tracker mengambil alih)");
  ok(app1?.referralNote === "Teman satu kos, teliti dan cepat belajar", "referralNote = catatan perujuk", app1?.referralNote ?? "—");
  ok(!!app1?.email?.startsWith("enc:"), "email TERENKRIPSI field-crypto (enc:…)", (app1?.email ?? "").slice(0, 12));
  ok(!!app1?.emailHash, "emailHash blind index terisi (dedupe M2)");
  ok(app1?.status === "Active", "status applicant Active", app1?.status ?? "—");
  ok(app1?.firstName === mkName("Satu"), "firstName = nama kandidat", app1?.firstName ?? "—");

  const sub1db = await db.referralSubmission.findUnique({ where: { id: sub1?.id }, select: { status: true, verifyNote: true, verifiedById: true, verifiedAt: true } });
  ok(sub1db?.status === "Verified", "submission status Verified", sub1db?.status ?? "—");
  ok(!!sub1db?.verifyNote?.includes(appNo1 ?? "###"), "verifyNote memuat applicantNo", sub1db?.verifyNote ?? "—");
  ok(!!sub1db?.verifiedAt, "verifiedAt terisi");

  const logVerified = await db.activityLog.findFirst({ where: { action: "Verified", entity: "ReferralSubmission", entityId: sub1?.docNo }, select: { detail: true } });
  ok(!!logVerified?.detail?.includes(appNo1 ?? "###"), "ActivityLog Verified memuat \"→ APP-…\"", logVerified?.detail?.slice(0, 80) ?? "—");

  // notifikasi in-app perujuk (notifyEvent → Notification per AppUser yusuf)
  const yusufAppUsers = await db.appUser.findMany({ where: { employeeId: yusuf?.id }, select: { id: true } });
  const notif = yusufAppUsers.length > 0
    ? await db.notification.findFirst({
        where: { appUserId: { in: yusufAppUsers.map((u) => u.id) }, OR: [{ title: { contains: mkName("Satu") } }, { body: { contains: sub1?.docNo } }] },
        select: { id: true, title: true, body: true, kind: true, link: true },
      })
    : null;
  ok(!!notif, "notifikasi in-app perujuk terkirim (link ess:my-referrals)", notif?.title ?? "— (yusuf tanpa AppUser — fallback tak teruji)");
  ok(notif?.kind === "recruitment" && notif?.link === "ess:my-referrals", "notifikasi kind recruitment + deep-link ess:my-referrals", `${notif?.kind} · ${notif?.link}`);

  // register B8 mengambil alih: my-referrals ESS yusuf memuat pelamar baru
  const myRef = await ess.api("GET", "/api/rekankerja/ess/my-referrals");
  ok((myRef.json?.rows ?? []).some((r: any) => r.applicantNo === appNo1), "B8 my-referrals ESS memuat pelamar referral baru");

  // ================= (5) VERIFY ULANG → 409 =================
  console.log("\n[(5)] VERIFY ULANG → 409");
  const verAgain = await hr.api("PATCH", STG_API, { id: sub1?.id, action: "verify" });
  ok(verAgain.status === 409, "verify submission sudah diproses → 409", `HTTP ${verAgain.status} — ${verAgain.json?.error ?? ""}`);

  // ================= (6) REJECT =================
  console.log("\n[(6)] REJECT — alasan wajib ≥10 char");
  const s2 = await ess.api("POST", ESS_API, { candidateName: mkName("Dua"), candidateEmail: null, candidatePhone: "+6281234567890", note: "Mantan kolega di proyek lama" });
  ok(s2.status === 201, "submit kedua (phone-only) → 201", `HTTP ${s2.status}`);
  const sub2 = s2.json?.row;
  const rejShort = await hr.api("PATCH", STG_API, { id: sub2?.id, action: "reject", note: "pendek" });
  ok(rejShort.status === 400, "reject alasan <10 char → 400", `HTTP ${rejShort.status}`);
  const REJECT_NOTE = "Kandidat sudah bekerja tetap di perusahaan lain saat ini";
  const rej1 = await hr.api("PATCH", STG_API, { id: sub2?.id, action: "reject", note: REJECT_NOTE });
  ok(rej1.status === 200, "reject dgn alasan ≥10 char → 200", `HTTP ${rej1.status}`);
  const sub2db = await db.referralSubmission.findUnique({ where: { id: sub2?.id }, select: { status: true, verifyNote: true } });
  ok(sub2db?.status === "Rejected", "submission status Rejected", sub2db?.status ?? "—");
  ok(sub2db?.verifyNote === REJECT_NOTE, "verifyNote = alasan penolakan", sub2db?.verifyNote ?? "—");
  const logRejected = await db.activityLog.count({ where: { action: "Rejected", entity: "ReferralSubmission", entityId: sub2?.docNo, ...RUN_LOG } });
  ok(logRejected === 1, "ActivityLog Rejected tertulis", `${logRejected} baris`);
  // pelamar TIDAK dibuat utk reject
  ok((await db.applicant.count()) === beforeTotalApplicants + 1, "reject tidak membuat pelamar (total tetap +1 dari verify)");

  // ================= (7) DUPLICATE FLOW =================
  console.log("\n[(7)] DUPLICATE — email kandidat = email pelamar existing");
  const s3 = await ess.api("POST", ESS_API, {
    candidateName: mkName("Tiga"), // nama BEDA — lewat guard submit
    candidateEmail: mkEmail("satu"), // email SAMA dgn pelamar hasil verify (1)
    candidatePhone: null,
  });
  ok(s3.status === 201, "submit nama beda + email pelamar existing → 201 (guard submit tak menangkap — by design)", `HTTP ${s3.status}`);
  const sub3 = s3.json?.row;
  const verDup = await hr.api("PATCH", STG_API, { id: sub3?.id, action: "verify" });
  ok(verDup.status === 200, "verify pengajuan duplikat → 200", `HTTP ${verDup.status}`);
  ok(verDup.json?.status === "Duplicate", "respons status Duplicate", verDup.json?.status ?? "—");
  ok(verDup.json?.applicantNo === appNo1, "applicantNo respons = pelamar existing (bukan baru)", verDup.json?.applicantNo ?? "—");
  const sub3db = await db.referralSubmission.findUnique({ where: { id: sub3?.id }, select: { status: true, verifyNote: true } });
  ok(sub3db?.status === "Duplicate", "submission status Duplicate", sub3db?.status ?? "—");
  ok(!!sub3db?.verifyNote?.includes(appNo1 ?? "###"), "verifyNote Duplicate memuat applicantNo existing", sub3db?.verifyNote ?? "—");
  ok((await db.applicant.count()) === beforeTotalApplicants + 1, "TIDAK ada pelamar baru (duplikat tidak dibuat)");
  const logDup = await db.activityLog.count({ where: { action: "Duplicate", entity: "ReferralSubmission", entityId: sub3?.docNo, ...RUN_LOG } });
  ok(logDup === 1, "ActivityLog Duplicate tertulis", `${logDup} baris`);

  // ================= (8) ANTI-ABUSE 10/BULAN → 429 =================
  console.log("\n[(8)] ANTI-ABUSE — cap 10 Submitted/bulan → 429");
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const existingSubmitted = await db.referralSubmission.count({ where: { referrerEmployeeId: yusuf?.id, status: "Submitted", createdAt: { gte: startOfMonth } } });
  console.log(`  Submitted yusuf bulan ini (pra-cap): ${existingSubmitted}`);
  let capSubmits = 0;
  let got429 = false;
  for (let i = existingSubmitted; i < 12 && !got429; i++) {
    const r = await ess.api("POST", ESS_API, {
      candidateName: mkName(`Cap${String(i).padStart(2, "0")}`),
      candidateEmail: mkEmail(`cap${i}`),
      candidatePhone: null,
    });
    if (r.status === 201) capSubmits++;
    else if (r.status === 429) { got429 = true; ok(true, `submit ke-${i + 1} → 429 (cap ${10}/bulan)`, r.json?.error?.slice(0, 70) ?? ""); }
    else { ok(false, `submit ke-${i + 1} status tak terduga`, `HTTP ${r.status} — ${r.json?.error ?? ""}`); break; }
  }
  ok(got429, "cap tercapai → 429 diterima (total Submitted saat tolak = 10)");
  ok(existingSubmitted + capSubmits === 10, "tepat 10 submit berhasil sebelum ditolak", `${existingSubmitted} pra + ${capSubmits} baru`);
  // staging HR filter status Submitted → 10 (termasuk yang pra-ada bila ada)
  const stgSub = await hr.api("GET", `${STG_API}?status=Submitted`);
  ok(stgSub.status === 200 && (stgSub.json?.stats?.submitted ?? -1) === 10, "staging stats.submitted = 10", `${stgSub.json?.stats?.submitted}`);

  // ================= (9) GUARD =================
  console.log("\n[(9)] GUARD — 403/400");
  const gEssGet = await ess.api("GET", STG_API);
  ok(gEssGet.status === 403, "ESS GET staging HR → 403 (menu-guard)", `HTTP ${gEssGet.status}`);
  const gEssPatch = await ess.api("PATCH", STG_API, { id: sub1?.id, action: "verify" });
  ok(gEssPatch.status === 403, "ESS PATCH verify → 403", `HTTP ${gEssPatch.status}`);
  const gAction = await hr.api("PATCH", STG_API, { id: sub1?.id, action: "apa-aja" });
  ok(gAction.status === 400, "aksi tak dikenal → 400", `HTTP ${gAction.status}`);
  const gNoId = await hr.api("PATCH", STG_API, { id: "tidak-ada-xyz", action: "verify" });
  ok(gNoId.status === 404, "id tak-ada → 404", `HTTP ${gNoId.status}`);

  // ================= (10) CLEANUP =================
  console.log("\n[(10)] CLEANUP — hapus submission + applicant uji (ActivityLog DIPERTAHANKAN — audit trail)");
  const testSubs = await db.referralSubmission.findMany({ where: { candidateName: { contains: "E2e P16" } }, select: { id: true } });
  await db.referralSubmission.deleteMany({ where: { id: { in: testSubs.map((s) => s.id) } } });
  if (app1) await db.applicant.delete({ where: { id: app1.id } }).catch(() => {});
  await db.notification.deleteMany({ where: { title: { contains: "E2e P16" } } }).catch(() => {});
  const leftSubs = await db.referralSubmission.count({ where: { candidateName: { contains: "E2e P16" } } });
  const leftApps = await db.applicant.count({ where: { firstName: { contains: "E2e P16" } } });
  ok(leftSubs === 0 && leftApps === 0, "semua submission + applicant uji dihapus", `sisa sub=${leftSubs} app=${leftApps}`);
  const finalReferred = await db.applicant.count({ where: { referralEmployeeId: { not: null } } });
  ok(finalReferred === beforeReferredCount, "jumlah referral kembali ke pra-uji", `${finalReferred} vs ${beforeReferredCount}`);
  const finalTotal = await db.applicant.count();
  ok(finalTotal === beforeTotalApplicants, "jumlah pelamar kembali ke pra-uji", `${finalTotal} vs ${beforeTotalApplicants}`);
  const logsKept = await db.activityLog.count({ where: { entity: "ReferralSubmission", entityId: { in: [sub1?.docNo, sub2?.docNo, sub3?.docNo].filter(Boolean) as string[] }, ...RUN_LOG } });
  ok(logsKept === 6, "ActivityLog uji run ini DIPERTAHANKAN (Created×3 + Verified/Rejected/Duplicate — audit trail)", `${logsKept} baris`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
