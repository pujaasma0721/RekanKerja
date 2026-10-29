// E2E FEAT-SUPPORT-P4 — usulan patch agen + approval developer (live UI). ==
// Alur: login MII (hrd) → tiket baru "bug pajak THR" di scripts/tmp-p4-demo.ts
// → agen read_file + propose_patch → kartu usulan (MENUNGGU) → verifikasi file
// BELUM berubah → buka diff → Setujui & Terapkan (dialog + catatan) → status
// DISETUJUI + pesan SYSTEM → verifikasi file BERUBAH → tindak-lanjut kejujuran
// agen → governance (patchEnabled OFF → agen jujur menolak) → screenshot.
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/audit/support-p4";
const DEMO = "/home/z/my-project/scripts/tmp-p4-demo.ts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.setDefaultTimeout(45000);

const log = (...a) => console.log("[p4-e2e]", ...a);
const fail = (msg) => { console.log("[p4-e2e] GAGAL:", msg); process.exitCode = 1; };

async function login() {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 30000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  // Bisa muncul layar pilih workspace (multi-workspace) ATAU langsung masuk
  // (single-workspace auto-select) — tunggu salah satu.
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes("Select workspace") || t.includes("Dashboard") || t.includes("Human Resource");
    },
    { timeout: 45000 },
  );
  const sel = page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" });
  if (await sel.count()) await sel.click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Dashboard") || document.body.innerText.includes("Human Resource"),
    { timeout: 45000 },
  );
  await sleep(2000);
}

/** Kirim pesan ke utas terbuka & tunggu balasan AI final (typing hilang). */
async function sendMessage(text) {
  const box = page.getByRole("textbox", { name: /Pesan|Message/ });
  await box.fill(text);
  await box.press("Enter");
}

/** Tunggu hingga teks muncul di area log chat (poll — giliran AI bisa lama). */
async function waitForThread(contains, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const typing = await page.locator('[aria-label="AI sedang mengetik"]').count();
    const hit = await page.locator('[role="log"]').getByText(contains, { exact: false }).count();
    if (hit > 0 && typing === 0) return true;
    await sleep(4000);
  }
  return false;
}

try {
  await login();
  log("login OK");

  // ---------- 1. buka Support Service & buat tiket ----------
  await page.goto(BASE + "/?m=support&v=service", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Percakapan Baru|New Conversation/ }).first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /Percakapan Baru|New Conversation/ }).first().click();
  const subj = page.getByRole("textbox", { name: /Judul|Title/ });
  await subj.fill("Uji P4: bug tarif pajak THR (demo)");
  await page.getByRole("button", { name: /Buat Tiket|Create Ticket/ }).click();
  await page.getByRole("textbox", { name: /Pesan|Message/ }).waitFor({ timeout: 20000 });
  log("tiket dibuat");

  // ---------- 2. laporkan bug → agen usulkan patch ----------
  await sendMessage(
    "Tolong periksa file scripts/tmp-p4-demo.ts — fungsi hitungPajakThr di sana memakai tarif 25 persen padahal PPh 21 atas THR seharusnya 2,5 persen. " +
    "Setelah kamu membaca filenya, ajukan usulan patch untuk memperbaiki bug ini (ganti 0.25 menjadi 0.025).",
  );
  const gotCard = await waitForThread(/Usulan Perbaikan Kode|Code Patch Proposal/, 260000);
  if (!gotCard) fail("kartu usulan patch tidak muncul dalam 260 dtk");
  else log("kartu usulan patch MUNCUL");

  // ---------- 3. kartu: status MENUNGGU + file belum berubah ----------
  const st = await page.getByText(/Menunggu Persetujuan|Pending Approval/).count();
  log("badge menunggu:", st > 0 ? "ada" : "TIDAK ADA");
  if (st === 0) fail("badge status MENUNGGU tidak tampil");
  const demo1 = readFileSync(DEMO, "utf8");
  const masihBug = demo1.includes("bruto * 0.25");
  log("file demo masih memakai 0.25 (belum diubah):", masihBug ? "YA (benar — menunggu approval)" : "TIDAK (file berubah terlalu dini!)");
  if (!masihBug) fail("file terubah sebelum approval!");

  // ---------- 4. buka diff ----------
  await page.getByRole("button", { name: /Lihat perubahan|View changes/ }).first().click();
  await page.locator('[role="log"] pre').first().waitFor({ timeout: 10000 });
  const diffTxt = (await page.locator('[role="log"] pre').first().innerText()).slice(0, 400);
  log("diff terlihat, cuplikan:", JSON.stringify(diffTxt.slice(0, 160)));
  await page.screenshot({ path: OUT + "/p4-card-diff.png", fullPage: true });

  // ---------- 5. setujui via dialog ----------
  await page.getByRole("button", { name: /Setujui & Terapkan|Approve & Apply/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByRole("textbox", { name: /Catatan keputusan|Decision note/ }).fill("Sudah saya verifikasi — tarif benar 2,5% (uji E2E P4).");
  await page.screenshot({ path: OUT + "/p4-review-dialog.png" });
  await dlg.getByRole("button", { name: /Setujui & Terapkan|Approve & Apply/ }).click();
  const approved = await page.getByText(/Disetujui & Diterapkan|Approved & Applied/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  log("status DISETUJUI:", approved ? "YA" : "TIDAK");
  if (!approved) fail("status tidak berubah menjadi DISETUJUI");
  const sysMsg = await page.getByText(/DISETUJUI oleh/).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  log("pesan SYSTEM persetujuan:", sysMsg ? "ada" : "TIDAK");
  if (!sysMsg) fail("pesan SYSTEM persetujuan tidak muncul");

  // ---------- 6. file kini berubah ----------
  await sleep(2500); // beri jeda penulisan file
  const demo2 = readFileSync(DEMO, "utf8");
  const fixed = demo2.includes("0.025") && !demo2.includes("bruto * 0.25");
  log("file demo diperbaiki (0.025, tanpa 0.25):", fixed ? "YA" : "TIDAK");
  if (!fixed) fail("file tidak diperbaiki setelah approval: " + JSON.stringify(demo2.split("\n").slice(4, 8)));
  await page.screenshot({ path: OUT + "/p4-approved.png", fullPage: true });

  // ---------- 7. tindak lanjut: agen harus jujur merujuk persetujuan ----------
  await sendMessage("Terima kasih! Konfirmasi singkat ya: apakah perbaikannya sudah benar-benar diterapkan ke file sekarang?");
  const followOk = await waitForThread(/diterapkan|applied|DITERAPKAN/, 180000);
  const threadTxt = (await page.locator('[role="log"]').innerText()).slice(0, 3000);
  log("tindak lanjut agen:", JSON.stringify(threadTxt.split("\n").slice(-8).join(" ¶ ").slice(0, 400)));
  if (!followOk) log("(tindak lanjut: kata kunci tidak persis — periksa screenshot)");

  // ---------- 8. mobile check ----------
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(800);
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  log("mobile 390px h-scroll:", hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
  await page.screenshot({ path: OUT + "/p4-card-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---------- 9. governance: patchEnabled OFF → agen jujur ----------
  const putRes = await page.evaluate(async () => {
    const r = await fetch("/api/rekankerja/support/agent-config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patchEnabled: false }),
    });
    return r.status;
  });
  log("PUT patchEnabled=false →", putRes);
  await page.getByRole("button", { name: /Percakapan Baru|New Conversation/ }).first().click();
  await page.getByRole("textbox", { name: /Judul|Title/ }).fill("Uji P4: governance usulan patch");
  await page.getByRole("button", { name: /Buat Tiket|Create Ticket/ }).click();
  await page.getByRole("textbox", { name: /Pesan|Message/ }).waitFor({ timeout: 20000 });
  await sendMessage(
    "Coba periksa file scripts/tmp-p4-demo.ts dan AJUKAN usulan patch untuk mengubah angka 0.025 menjadi 0.05 di fungsi hitungPajakThr (permintaan uji).",
  );
  const govWait = await waitForThread(/nonaktif|dimatikan|disabled|tidak dapat mengajukan|TIDAK dapat/i, 200000);
  const cardsGov = await page.getByText(/Usulan Perbaikan Kode|Code Patch Proposal/).count();
  const threadTxt2 = (await page.locator("[role=log]").innerText()).slice(-1500);
  log("governance: jawaban jujur:", govWait ? "terdeteksi" : "kata kunci tak persis", "| kartu usulan di utas ini:", cardsGov);
  log("cuplikan jawaban gov:", JSON.stringify(threadTxt2.split("\n").slice(-6).join(" ¶ ").slice(0, 300)));
  await page.screenshot({ path: OUT + "/p4-governance-off.png", fullPage: true });

  // nyalakan kembali
  const putRes2 = await page.evaluate(async () => {
    const r = await fetch("/api/rekankerja/support/agent-config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patchEnabled: true }),
    });
    return r.status;
  });
  log("PUT patchEnabled=true →", putRes2);

  log("SELESAI — status keseluruhan:", process.exitCode ? "ADA KEGAGALAN" : "LULUS");
} catch (e) {
  console.log("[p4-e2e] ERR:", String(e).slice(0, 300));
  await page.screenshot({ path: OUT + "/p4-debug.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
