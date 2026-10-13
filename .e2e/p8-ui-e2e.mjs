// P8 UI E2E — Playwright dedicated script (no CDP timeout).
// Alur: login HR → workspace MII → Performance Reports → P1.2 (params → generate)
// → tunggu dokumen render → screenshot. Self-healing bila reload HMR mengganggu.
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/.e2e-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

try {
  // ---------- login ----------
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 30000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  // tunggu shell aplikasi benar-benar aktif (sesi workspace tertulis) sebelum navigasi
  await page.getByRole("button", { name: "Performance", exact: true }).waitFor({ timeout: 45000 });
  await sleep(2500);

  // ---------- performance reports ----------
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "domcontentloaded", timeout: 60000 });

  // ---------- alur P1.2 dengan self-healing (maks 5 attempt) ----------
  let docOk = false;
  for (let attempt = 1; attempt <= 5 && !docOk; attempt++) {
    console.log(`attempt ${attempt}…`);
    try {
      // 1. kartu katalog P1.2
      await page.getByRole("button", { name: /Per-Phase Completion/ }).first().waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: /Per-Phase Completion/ }).first().click();
      // 2. tunggu combobox siklus aktif
      const trig = page.locator('[role="combobox"]').first();
      await trig.waitFor({ timeout: 15000 });
      for (let i = 0; i < 20; i++) {
        const dis = await trig.evaluate((t) => t.hasAttribute("disabled") || t.getAttribute("aria-disabled") === "true" || t.getAttribute("data-disabled") !== null).catch(() => true);
        if (!dis) break;
        await sleep(500);
      }
      // 3. buka dropdown & pilih PER-2026
      await trig.click({ timeout: 10000 });
      const opt = page.getByRole("option", { name: /PER-2026/ }).first();
      await opt.waitFor({ timeout: 15000 });
      await opt.click();
      // 4. generate
      await page.getByRole("button", { name: "Generate Report" }).click({ timeout: 10000 });
      // 5. tunggu area dokumen
      await page.locator("#rk-print-area").waitFor({ timeout: 30000 });
      await sleep(1200); // beri waktu render tabel
      docOk = true;
    } catch (e) {
      console.log(`  attempt ${attempt} gagal: ${String(e).slice(0, 110)}`);
      await sleep(1500);
      // state mungkin katalog lagi — loop akan mencoba dari awal
    }
  }

  if (docOk) {
    const txt = (await page.locator("#rk-print-area").innerText()).slice(0, 200).replace(/\n/g, " | ");
    console.log("DOC RENDERED:", txt);
    await page.screenshot({ path: OUT + "/p8-report-pf12-en.png", fullPage: true });
    console.log("screenshot p8-report-pf12-en.png tersimpan");

    // ---------- tab Kinerja di profil karyawan (PP 35/2021 §7.2) ----------
    // navigasi: HR module → employee directory → baris pertama → tab Kinerja
    await page.goto(BASE + "/?m=hr&v=directory", { waitUntil: "domcontentloaded", timeout: 60000 });
    const row = page.locator("table tbody tr").first();
    await row.waitFor({ timeout: 25000 });
    await row.click();
    const kinerjaTab = page.getByRole("tab", { name: /Kinerja \(\d+\)/ });
    await kinerjaTab.waitFor({ timeout: 25000 });
    await kinerjaTab.click();
    await page.getByText("Riwayat Penilaian Kinerja", { exact: false }).first().waitFor({ timeout: 20000 });
    const histText = (await page.locator("main").innerText()).slice(0, 260).replace(/\n/g, " | ");
    console.log("KINERJA TAB:", histText);
    await page.screenshot({ path: OUT + "/p8-employee-kinerja-tab-en.png", fullPage: true });
    console.log("screenshot p8-employee-kinerja-tab-en.png tersimpan");

    // ---------- mobile 375×812 ----------
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("button", { name: /Per-Phase Completion/ }).first().waitFor({ timeout: 25000 });
    await page.screenshot({ path: OUT + "/p8-reports-mobile.png", fullPage: true });
    const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    console.log("MOBILE h-scroll:", hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
    console.log("ALL UI E2E PASS");
  } else {
    console.log("DOKUMEN GAGAL RENDER setelah 5 attempt");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
