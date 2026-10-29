import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.type() + ": " + m.text().slice(0, 150)); });
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 200)));
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
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await sleep(1000);
    found = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].some((t) => /Kinerja|Performance/.test(t.textContent || ""))).catch(() => false);
  }
  console.log("tab ditemukan:", found);
  await sleep(500);
  const after = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const perf = tabs.find((t) => /Kinerja|Performance/.test(t.textContent || ""));
    if (!perf) return "no tab";
    perf.click();
    return "clicked " + perf.textContent;
  }).catch((e) => "CTX " + String(e).slice(0, 60));
  console.log("klik:", after);
  await sleep(4000);
  const state = await page.evaluate(() => {
    const active = document.querySelector('[role="tab"][data-state="active"]');
    const panels = [...document.querySelectorAll('[role="tabpanel"]')].map((p) => (p.getAttribute("data-state") || "?") + ":" + (p.textContent || "").slice(0, 60));
    return { activeTab: active ? active.textContent : "none", panels, hasHist: document.body.innerText.includes("Performance History") || document.body.innerText.includes("Riwayat Penilaian Kinerja") };
  }).catch((e) => "CTX " + String(e).slice(0, 60));
  console.log("state:", JSON.stringify(state).slice(0, 400));
  console.log("console errors:", errs.length ? errs.slice(0, 5) : "tidak ada");
} catch (e) { console.log("ERR:", String(e).slice(0, 200)); }
finally { await browser.close(); }
