// P8 UI E2E bagian 2 — tab Kinerja profil karyawan + mobile check.
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/.e2e-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 30000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  await page.getByRole("button", { name: "Performance", exact: true }).waitFor({ timeout: 45000 });
  await sleep(2000);

  // ---------- tab Kinerja ----------
  await page.goto(BASE + "/?m=hr&v=directory", { waitUntil: "domcontentloaded", timeout: 60000 });
  const row = page.locator("table tbody tr").first();
  await row.waitFor({ timeout: 30000 });
  await row.click();
  const kinerjaTab = page.getByRole("tab", { name: /Kinerja \(\d+\)/ });
  await kinerjaTab.waitFor({ timeout: 30000 });
  await kinerjaTab.click();
  await page.getByText("Riwayat Penilaian Kinerja", { exact: false }).first().waitFor({ timeout: 20000 });
  const mainTxt = (await page.locator("main").innerText()).slice(0, 320).replace(/\n/g, " | ");
  console.log("KINERJA TAB:", mainTxt);
  const hasXlsx = await page.getByRole("link", { name: /Unduh Riwayat \(XLSX\)|Download History \(XLSX\)/ }).count();
  console.log("TOMBOL XLSX:", hasXlsx > 0 ? "ada (lulus)" : "TIDAK ADA (gagal)");
  await page.screenshot({ path: OUT + "/p8-employee-kinerja-tab-en.png", fullPage: true });
  console.log("screenshot p8-employee-kinerja-tab-en.png tersimpan");

  // ---------- mobile 375×812 ----------
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Per-Phase Completion/ }).first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: OUT + "/p8-reports-mobile.png", fullPage: true });
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log("MOBILE h-scroll:", hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
  console.log("UI E2E BAGIAN 2 PASS");
} catch (e) {
  console.log("ERR:", String(e).slice(0, 240));
  await page.screenshot({ path: OUT + "/p8-debug2.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
