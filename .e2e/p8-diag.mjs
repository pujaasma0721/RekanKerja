import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 30000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  await page.getByRole("button", { name: "Performance", exact: true }).waitFor({ timeout: 45000 });
  console.log("login OK");
  await page.goto(`${BASE}/?m=employee&v=detail&id=cmv3lphvk004hoby98zt2rkts`, { waitUntil: "commit", timeout: 60000 });
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const tabs = await page.getByRole("tab").allInnerTexts().catch(() => []);
    if (tabs.length > 0) { console.log("TABS:", JSON.stringify(tabs)); break; }
    const mainTxt = await page.locator("main").innerText().catch(() => "");
    if (mainTxt.includes("Performance Reports") || mainTxt.includes("Katalog")) continue;
    if (i % 5 === 4) console.log("wait", i, mainTxt.slice(0, 60).replace(/\n/g, "|"));
  }
  const body = await page.locator("body").innerText().catch(() => "");
  console.log("HAS 'Kinerja':", body.includes("Kinerja"));
  console.log("BODY sample:", body.slice(0, 150).replace(/\n/g, " | "));
} catch (e) {
  console.log("ERR:", String(e).slice(0, 200));
} finally { await browser.close(); }
