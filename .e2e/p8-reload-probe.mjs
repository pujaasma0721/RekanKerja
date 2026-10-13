import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  await page.getByRole("button", { name: "Performance", exact: true }).waitFor({ timeout: 60000 });
  await page.goto(`${BASE}/?s=employee&v=detail&id=cmv3lphvk004hoby98zt2rkts`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  // di sapanavigation listener + poll body marker tiap 2 dtk selama 90 dtk TANPA klik apa pun
  let t0 = Date.now();
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const mark = await page.evaluate(() => document.body.innerText.includes("PER-2025-0001")).catch((e) => "CTX-DESTROYED");
    const nav = Date.now() - t0;
    if (mark === "CTX-DESTROYED") { console.log(`t+${(nav/1000).toFixed(0)}s CTX DESTROYED (reload)`); t0 = Date.now(); }
    else if (mark) { console.log(`t+${(nav/1000).toFixed(0)}s konten detail ada`); }
  }
} catch (e) { console.log("ERR:", String(e).slice(0, 150)); }
finally { await browser.close(); }
