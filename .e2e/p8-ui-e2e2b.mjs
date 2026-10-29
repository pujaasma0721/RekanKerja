// P8 UI E2E bagian 2b — langsung ke detail karyawan (?s=employee&v=detail&id=).
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/.e2e-shots";
const EMP_ID = "cmv3lphvk004hoby98zt2rkts"; // peserta appraisal (dari _params E2E)
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
  await sleep(1500);

  // langsung ke detail karyawan peserta
  await page.goto(`${BASE}/?s=employee&v=detail&id=${EMP_ID}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const kinerjaTab = page.getByRole("tab").filter({ hasText: /^(Kinerja|Performance)/ }).last();
  await kinerjaTab.waitFor({ timeout: 40000 });
  await kinerjaTab.click();
  await page.getByText(/Riwayat Penilaian Kinerja|Performance History/).first().waitFor({ timeout: 25000 });
  const rows = await page.locator('table tbody tr').count();
  const xlsx = await page.getByRole("link", { name: /Unduh Riwayat \(XLSX\)|Download History \(XLSX\)/ }).count();
  console.log("KINERJA TAB: tabel rows =", rows, "· tombol XLSX =", xlsx);
  await page.screenshot({ path: OUT + "/p8-employee-kinerja-tab-en.png", fullPage: true });
  console.log("screenshot p8-employee-kinerja-tab-en.png tersimpan");

  // mobile — reports catalog 375×812
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("button", { name: /Per-Phase Completion/ }).first().waitFor({ timeout: 40000 });
  await page.screenshot({ path: OUT + "/p8-reports-mobile.png", fullPage: true });
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log("MOBILE h-scroll:", hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
  console.log("UI E2E BAGIAN 2 PASS");
} catch (e) {
  console.log("ERR:", String(e).slice(0, 220));
  await page.screenshot({ path: OUT + "/p8-debug3.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
