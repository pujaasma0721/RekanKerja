// Uji E2E B7 (Portal pelamar: magic-link status lamaran + branding CareerSiteConfig)
// per DEVELOPMENT-PLAN-BACKLOG.md §4 B7 + mitigasi §5 "Magic-link jadi vektor
// enumerasi email" — di atas data demo MII (login owner hrd@mii.co.id):
//   (0) SETUP: SMTP → smtp-catcher :2525 via PUT email-config (state lama
//       dicatat, direstore di cleanup); siapkan applicant uji via db (email
//       TERENKRIPSI + 1 ApplicantApplication ke slot Open + 1 lampiran).
//   (1) MINTA LINK: POST status-link email terdaftar → 200 {ok:true}; email
//       muncul di catch.jsonl (polling ≤10s) memuat /status/<token>; email
//       TIDAK-TERDAFTAR → 200 respons JSON IDENTIK (netral) + TIDAK ada email
//       baru; honeypot terisi → 200 netral.
//   (2) BUKA LINK: GET status?token → 200 payload (applicantNo, nama, slot,
//       tahapan, lampiran); SEKALI-PAKAI: GET ke-2 → 410; minta link baru →
//       token BERBEDA + link lama tetap 410 + link baru bekerja.
//   (3) KEDALUWARSA: token expired di-craft via helper service (exp masa lalu
//       — tanpa menunggu 6 jam nyata) → 410.
//   (4) RATE-LIMIT: 3/jam per EMAIL (IP berbeda-beda → ke-4 429) + 10/jam per
//       IP (email berbeda-beda → ke-11 429). Semua kunci rate-limit memakai
//       nonce per-run (email+IP unik) supaya run berulang tidak saling
//       menghalangi; helper __resetRateLimiterForTest dipanggil di cleanup
//       (in-process — KETERBATASAN: Map server Next.js terpisah, lihat worklog).
//   (5) BRANDING: admin MII simpan CareerSiteConfig (API settings op update)
//       + Cahaya via db (tidak ada login cahaya) → site-config publik per
//       tenant BERBEDA; portal :3010 /?t= memuat heroTitle + warna per tenant;
//       tenant tanpa row (sentra) → fallback default; validasi warna rusak 400.
//   (6) GUARD: status-link tanpa email valid → 400; token rusak "abc" → 400.
//   (7) CLEANUP: restore email-config lama, hapus CareerSiteConfig uji,
//       hapus applicant uji (+attachment), rate limiter reset.
// Jalankan: bun scripts/e2e-b7-portal-magic.ts
import "./lib/env";
import { readFileSync, existsSync } from "node:fs";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import {
  craftStatusToken, __resetRateLimiterForTest,
} from "@/rekankerja/recruitment/services/status-link-service";

const BASE = "http://localhost:3000";
const PORTAL = "http://localhost:3010";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const CAHAYA_SCHEMA = "tenant_cahaya_digital_nusantara";
const MII_SLUG = "pt-mitra-industri-internasional";
const CAHAYA_SLUG = "cahaya-digital-nusantara";
const SENTRA_SLUG = "sentra-logistik-prima";
const SETTINGS_API = "/api/rekankerja/recruitment/settings";
const CATCH = "mini-services/smtp-catcher/catch.jsonl";

// nonce per-run: kunci rate-limit (email + IP) tidak bertabrakan antar-run
const NONCE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const TEST_EMAIL = `e2e-b7-${NONCE}@test.example`;
const APPLICANT_NO = `APP-E2E-B7-${NONCE.slice(-8).toUpperCase()}`;
const ipOf = (n: number) => `203.0.113.${(parseInt(NONCE.slice(-3), 36) % 100) + 100 + n}`; // IP unik per-run per-n

let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

/** Sesi terpisah per aktor (jar cookie masing-masing) — pola e2e-b6. */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any; text: string }> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(headers ?? {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
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

interface CatchMsg { at: string; from: string; to: string[]; data: string }
function readCatch(): CatchMsg[] {
  if (!existsSync(CATCH)) return [];
  return readFileSync(CATCH, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l) as CatchMsg; } catch { return null; } })
    .filter((x): x is CatchMsg => x != null);
}

/** Decode ringan quoted-printable (nodemailer QP — link terpotong "=" + newline). */
function qpDecode(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Tunggu email BARU (baris ≥ after) utk penerima yang memuat /status/ (poll 250ms). */
async function waitForStatusEmail(to: string, after: number, ms = 10_000): Promise<string | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const lines = readCatch();
    for (const m of lines.slice(after)) {
      if (m.to.includes(to) && m.data.includes("/status/")) {
        const mm = /http[^\s"'<>]*\/status\/([0-9]+\.[a-f0-9]{64})/.exec(qpDecode(m.data));
        if (mm) return mm[1]!;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const owner = new Sesi();
  const startedAt = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — SMTP catcher + applicant uji");
  const login = await owner.api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  // state mentah utk restore eksak via db (PUT menolak active=true tanpa host —
  // state pra-uji persis begitu: baris seed active=true + host kosong)
  const oldRow = await db.emailConfig.findFirst();
  const put = await owner.api("PUT", "/api/rekankerja/email-config", {
    active: true, smtpHost: "127.0.0.1", smtpPort: 2525, smtpSecure: false,
    smtpUser: "", smtpPassword: "", fromEmail: "e2e-b7@rekankerja.test", fromName: "RekanKerja E2E B7",
  });
  ok(put.status === 200, "PUT email-config → smtp-catcher 127.0.0.1:2525", `HTTP ${put.status} ${put.json?.error ?? ""}`);
  const oldEmailCount = readCatch().length;

  // applicant uji: email terenkripsi + 1 lamaran slot + 1 lampiran
  const tc = tenantCryptoForDb(db);
  const slot = await db.jobOpening.findFirst({
    where: { status: "Open", jobOpportunity: { status: "Posted" } },
    select: { id: true, titleToShow: true, jobOpportunity: { select: { refNo: true } } },
  });
  ok(!!slot, "slot lowongan Open+Posted tersedia (data demo MII)", slot?.titleToShow ?? "—");
  const applicant = await db.applicant.create({
    data: {
      applicantNo: APPLICANT_NO,
      firstName: "E2e", lastName: "B7 Pelamar",
      email: tc.encryptText(TEST_EMAIL)!,
      applications: slot ? { create: { jobOpeningId: slot.id, status: "Received" } } : undefined,
    },
    select: { id: true },
  });
  const att = await db.attachment.create({
    data: {
      entityType: "Applicant", entityId: applicant.id,
      fileName: "cv-e2e-b7.pdf", mimeType: "application/pdf",
      sizeBytes: 12345, storagePath: "db/e2e-b7/cv-e2e-b7.pdf",
    },
  });
  await db.applicantDocument.create({
    data: { applicantId: applicant.id, title: "CV", attachmentId: att.id },
  });
  ok(true, `applicant uji dibuat ${APPLICANT_NO} + lamaran + lampiran`, TEST_EMAIL);

  // ================= (1) MINTA LINK =================
  console.log("\n[(1)] MINTA LINK — netral + email terkirim");
  const r1 = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: TEST_EMAIL }, { "x-forwarded-for": ipOf(1) });
  ok(r1.status === 200 && r1.json?.ok === true, "POST status-link email terdaftar → 200 {ok:true}", JSON.stringify(r1.json));

  const UNREG = `e2e-b7-nx-${NONCE}@test.example`;
  const r2 = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: UNREG }, { "x-forwarded-for": ipOf(2) });
  ok(r2.status === 200 && r2.json?.ok === true, "POST email TIDAK-terdaftar → 200 {ok:true}");
  ok(r1.text === r2.text, "respons NETRAL — JSON identik email ada/tidak", `${r1.text} vs ${r2.text}`);

  const honeypot = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: TEST_EMAIL, website: "http://bot.example" }, { "x-forwarded-for": ipOf(3) });
  ok(honeypot.status === 200 && honeypot.json?.ok === true, "honeypot terisi → respons netral 200 sama");

  const token1 = await waitForStatusEmail(TEST_EMAIL, oldEmailCount);
  ok(!!token1, "email masuk catch.jsonl (≤10s) memuat /status/<token>", token1?.slice(0, 24) ?? "—");
  await new Promise((r) => setTimeout(r, 1500));
  const unregMsgs = readCatch().filter((m) => m.to.includes(UNREG));
  ok(unregMsgs.length === 0, "TIDAK ada email utk alamat tak terdaftar (anti-enumerasi)");

  // ================= (2) BUKA LINK + SEKALI-PAKAI =================
  console.log("\n[(2)] BUKA LINK — payload + sekali-pakai + link baru");
  const s1 = await owner.api("GET", `/api/public/recruitment/status?token=${token1}&t=${MII_SLUG}`);
  ok(s1.status === 200, "GET status token#1 → 200");
  const p1 = s1.json ?? {};
  ok(p1.applicantNo === APPLICANT_NO, "payload.applicantNo benar", `${p1.applicantNo}`);
  ok(p1.fullName === "E2e B7 Pelamar", "payload.fullName benar", `${p1.fullName}`);
  ok(p1.appliedCount === 1, "payload.appliedCount = 1");
  ok(!!p1.latestApplication && p1.latestApplication.joRefNo === slot?.jobOpportunity.refNo && p1.latestApplication.title === slot?.titleToShow,
    "payload.latestApplication slot benar (title + joRefNo)", `${p1.latestApplication?.joRefNo} · ${p1.latestApplication?.title}`);
  ok(p1.selection === null && p1.offer === null, "payload tanpa kandidat/offer (applicant uji murni)");
  ok(Array.isArray(p1.attachments) && p1.attachments.length === 1 && p1.attachments[0].fileName === "cv-e2e-b7.pdf" && p1.attachments[0].sizeBytes === 12345,
    "payload.attachments benar (nama + ukuran)", JSON.stringify(p1.attachments));

  const s2 = await owner.api("GET", `/api/public/recruitment/status?token=${token1}&t=${MII_SLUG}`);
  ok(s2.status === 410, "SEKALI-PAKAI: GET ke-2 token#1 → 410", `HTTP ${s2.status}`);

  const catchBefore2 = readCatch().length;
  await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: TEST_EMAIL }, { "x-forwarded-for": ipOf(4) });
  const token2 = await waitForStatusEmail(TEST_EMAIL, catchBefore2);
  ok(!!token2 && token2 !== token1, "minta link baru → token BERBEDA masuk email", token2?.slice(0, 24) ?? "—");
  const sOld = await owner.api("GET", `/api/public/recruitment/status?token=${token1}&t=${MII_SLUG}`);
  const sNew = await owner.api("GET", `/api/public/recruitment/status?token=${token2}&t=${MII_SLUG}`);
  ok(sOld.status === 410, "link LAMA tetap invalid (410)");
  ok(sNew.status === 200 && sNew.json?.applicantNo === APPLICANT_NO, "link BARU bekerja → 200 payload");

  // ================= (3) KEDALUWARSA =================
  console.log("\n[(3)] KEDALUWARSA — token expired via helper service");
  const expired = craftStatusToken(SCHEMA, applicant.id, Date.now() - 60_000);
  const sExp = await owner.api("GET", `/api/public/recruitment/status?token=${expired}&t=${MII_SLUG}`);
  ok(sExp.status === 410, "token kedaluwarsa (exp masa lalu) → 410", `HTTP ${sExp.status} ${sExp.json?.error ?? ""}`);

  // ================= (4) RATE-LIMIT =================
  console.log("\n[(4)] RATE-LIMIT — 3/jam email + 10/jam IP (per tenant schema)");
  const RL_EMAIL = `e2e-b7-rl-${NONCE}@test.example`;
  let rlStatuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: RL_EMAIL }, { "x-forwarded-for": ipOf(10 + i) });
    rlStatuses.push(r.status);
  }
  ok(rlStatuses.slice(0, 3).every((s) => s === 200), "3 permintaan pertama email sama (IP beda) → 200", rlStatuses.join(","));
  ok(rlStatuses[3] === 429, "permintaan ke-4 email sama → 429 (batas 3/jam per email)", `HTTP ${rlStatuses[3]}`);

  const RL_IP = ipOf(200);
  const rlIpStatuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const r = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`,
      { email: `e2e-b7-ip${i}-${NONCE}@test.example` }, { "x-forwarded-for": RL_IP });
    rlIpStatuses.push(r.status);
  }
  ok(rlIpStatuses.slice(0, 10).every((s) => s === 200), "10 permintaan pertama IP sama (email beda) → 200", rlIpStatuses.join(","));
  ok(rlIpStatuses[10] === 429, "permintaan ke-11 IP sama → 429 (batas 10/jam per IP)", `HTTP ${rlIpStatuses[10]}`);

  // ================= (5) BRANDING =================
  console.log("\n[(5)] BRANDING — CareerSiteConfig per tenant + portal");
  const badSave = await owner.api("POST", SETTINGS_API, {
    action: "site-config-save", brandColor: "zzzzzz", logoUrl: null, heroTitle: null, heroSub: null,
  });
  ok(badSave.status === 400, "validasi: brandColor bukan hex 6 → 400", `HTTP ${badSave.status} ${badSave.json?.error ?? ""}`);
  const badLogo = await owner.api("POST", SETTINGS_API, {
    action: "site-config-save", brandColor: "#0f766e", logoUrl: "ftp://x.example/l.png", heroTitle: null, heroSub: null,
  });
  ok(badLogo.status === 400, "validasi: logoUrl bukan http(s) → 400", `HTTP ${badLogo.status}`);

  const saveMii = await owner.api("POST", SETTINGS_API, {
    action: "site-config-save", brandColor: "#b45309", logoUrl: null,
    heroTitle: "Gerbang Talenta MII", heroSub: "Jelajahi karier di PT Mitra Industri Internasional.",
  });
  ok(saveMii.status === 200 && saveMii.json?.siteConfig?.brandColor === "#b45309", "admin MII simpan branding (API settings op update)", saveMii.json?.siteConfig?.brandColor);

  // cahaya: tanpa login — tulis via db (portal publik tetap diuji lewat API+HTML)
  const cdb = getTenantClient(CAHAYA_SCHEMA);
  await cdb.careerSiteConfig.upsert({
    where: { tenantSlug: CAHAYA_SLUG },
    create: { tenantSlug: CAHAYA_SLUG, brandColor: "#0e7490", heroTitle: "Berkarya di Cahaya Digital", heroSub: "Karier digital yang berdampak." },
    update: { brandColor: "#0e7490", heroTitle: "Berkarya di Cahaya Digital", heroSub: "Karier digital yang berdampak." },
  });
  ok(true, "branding Cahaya ditulis via db (tanpa login cahaya di sandbox)");

  const cfgMii = await owner.api("GET", `/api/public/recruitment/site-config?t=${MII_SLUG}`);
  const cfgCahaya = await owner.api("GET", `/api/public/recruitment/site-config?t=${CAHAYA_SLUG}`);
  const cfgSentra = await owner.api("GET", `/api/public/recruitment/site-config?t=${SENTRA_SLUG}`);
  ok(cfgMii.status === 200 && cfgMii.json?.brandColor === "#b45309" && cfgMii.json?.heroTitle === "Gerbang Talenta MII", "site-config?t=MII sesuai set admin");
  ok(cfgCahaya.status === 200 && cfgCahaya.json?.brandColor === "#0e7490" && cfgCahaya.json?.heroTitle === "Berkarya di Cahaya Digital", "site-config?t=Cahaya beda nilai");
  ok(cfgMii.json?.brandColor !== cfgCahaya.json?.brandColor && cfgMii.json?.heroTitle !== cfgCahaya.json?.heroTitle, "branding 2 tenant BERBEDA");
  ok(cfgSentra.status === 200 && cfgSentra.json?.brandColor === "#0f766e" && cfgSentra.json?.heroTitle === null && cfgSentra.json?.companyName != null,
    "fallback: sentra tanpa row → default + companyName", JSON.stringify(cfgSentra.json));

  const htmlMii = await (await fetch(`${PORTAL}/?t=${MII_SLUG}`)).text();
  ok(htmlMii.includes("Gerbang Talenta MII"), "portal /?t=MII memuat heroTitle MII");
  ok(htmlMii.includes("--brand:#b45309"), "portal /?t=MII memuat warna brand MII");
  const htmlCahaya = await (await fetch(`${PORTAL}/?t=${CAHAYA_SLUG}`)).text();
  ok(htmlCahaya.includes("Berkarya di Cahaya Digital") && htmlCahaya.includes("--brand:#0e7490"), "portal /?t=Cahaya memuat branding cahaya");
  const htmlSentra = await (await fetch(`${PORTAL}/?t=${SENTRA_SLUG}`)).text();
  ok(!htmlSentra.includes("Gerbang Talenta MII") && htmlSentra.includes("--brand:#0f766e"), "portal /?t=Sentra fallback default site-config (#0f766e, tanpa row)");
  ok(htmlMii.includes("Cek Status Lamaran") && htmlMii.includes("status-form"), "portal memuat form Cek Status Lamaran");
  // token sekali-pakai: token2 SUDAH diverifikasi block (2) → minta link BARU
  // (hit ke-3 TEST_EMAIL — masih dalam batas 3/jam) untuk uji SSR portal
  const catchBefore3 = readCatch().length;
  await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: TEST_EMAIL }, { "x-forwarded-for": ipOf(60) });
  const token3 = await waitForStatusEmail(TEST_EMAIL, catchBefore3);
  ok(!!token3, "link segar utk uji SSR portal (token3)");
  const htmlStatus = await (await fetch(`${PORTAL}/status/${token3}?t=${MII_SLUG}`)).text();
  ok(htmlStatus.includes("Status Lamaran Anda") && htmlStatus.includes(APPLICANT_NO), "portal /status/<token> SSR memuat kartu status pelamar");
  const htmlStatusGone = await (await fetch(`${PORTAL}/status/${token1}?t=${MII_SLUG}`)).text();
  ok(htmlStatusGone.includes("kedaluwarsa atau pernah digunakan"), "portal /status token terpakai menampilkan pesan 410");

  // ================= (6) GUARD =================
  console.log("\n[(6)] GUARD — format salah");
  const g1 = await owner.api("POST", `/api/public/recruitment/status-link?t=${MII_SLUG}`, { email: "bukan-email" }, { "x-forwarded-for": ipOf(50) });
  ok(g1.status === 400, "status-link email format salah → 400", `HTTP ${g1.status}`);
  const g2 = await owner.api("GET", `/api/public/recruitment/status?token=abc&t=${MII_SLUG}`);
  ok(g2.status === 400, "token rusak \"abc\" → 400", `HTTP ${g2.status}`);

  // ================= (7) CLEANUP =================
  console.log("\n[(7)] CLEANUP — restore state");
  if (oldRow) {
    // restore eksak state pra-uji via db (self-heal seed: active=true + host
    // kosong = semua kirim email “Skipped” — perilaku pra-uji)
    await db.emailConfig.update({
      where: { id: oldRow.id },
      data: {
        active: oldRow.active, smtpHost: oldRow.smtpHost, smtpPort: oldRow.smtpPort,
        smtpSecure: oldRow.smtpSecure, smtpUser: oldRow.smtpUser,
        smtpPassword: oldRow.smtpPassword, fromEmail: oldRow.fromEmail, fromName: oldRow.fromName,
      },
    });
    const cfgNow = await db.emailConfig.findFirst({ select: { active: true, smtpHost: true, fromEmail: true } });
    ok(cfgNow?.active === oldRow.active && cfgNow?.smtpHost === oldRow.smtpHost, "email-config lama direstore via db", JSON.stringify(cfgNow));
  } else {
    ok(true, "email-config: tidak ada state lama (self-heal default)");
  }
  await db.applicant.delete({ where: { id: applicant.id } }).catch(() => {});
  await db.attachment.delete({ where: { id: att.id } }).catch(() => {});
  ok(true, "applicant uji + lampiran dihapus");
  await db.careerSiteConfig.delete({ where: { tenantSlug: MII_SLUG } }).catch(() => {});
  await cdb.careerSiteConfig.delete({ where: { tenantSlug: CAHAYA_SLUG } }).catch(() => {});
  const rowsLeft = await db.careerSiteConfig.count() + await cdb.careerSiteConfig.count();
  ok(rowsLeft === 0, "CareerSiteConfig uji dihapus (MII + Cahaya)");
  __resetRateLimiterForTest(); // in-process — server Next.js punya Map sendiri (kunci per-run nonce sudah menutup ini)
  const emailsNow = readCatch();
  ok(emailsNow.length >= oldEmailCount, `catch.jsonl utuh (${emailsNow.length} ≥ ${oldEmailCount} — email historis dipertahankan)`);

  console.log(`\nHASIL: ${pass}/${pass + fail} ${fail === 0 ? "PASS ✓" : "FAIL ✗"} — mulai ${startedAt.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
