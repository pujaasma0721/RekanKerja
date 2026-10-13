// P8 UI debug — cek tiap tahap.
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("1. loaded:", await page.title());
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 30000 });
  console.log("2. login form terlihat");
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 30000 });
  console.log("3. workspace list terlihat");
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  await sleep(4000);
  console.log("4. setelah klik workspace — url:", page.url());
  console.log("   main:", (await page.locator("main").innerText().catch(() => "no-main")).slice(0, 120).replace(/\n/g, " | "));
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(8000);
  console.log("5. reports — main:", (await page.locator("main").innerText().catch(() => "no-main")).slice(0, 200).replace(/\n/g, " | "));
  const n = await page.locator("main button").count().catch(() => -1);
  console.log("   tombol di main:", n);
} catch (e) {
  console.log("ERR:", String(e).slice(0, 220));
  await page.screenshot({ path: "/home/z/my-project/.e2e-shots/p8-debug.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
