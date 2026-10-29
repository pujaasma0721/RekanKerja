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
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await sleep(1000);
    found = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].some((t) => /Kinerja|Performance/.test(t.textContent || ""))).catch(() => false);
  }
  console.log("tab:", found);
  // klik pointer-event lengkap (mirror klik user nyata)
  const r1 = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const perf = tabs.find((t) => /Kinerja|Performance/.test(t.textContent || ""));
    if (!perf) return "no tab";
    const rect = perf.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0 };
    perf.dispatchEvent(new PointerEvent("pointerdown", opts));
    perf.dispatchEvent(new MouseEvent("mousedown", opts));
    perf.dispatchEvent(new PointerEvent("pointerup", opts));
    perf.dispatchEvent(new MouseEvent("mouseup", opts));
    perf.dispatchEvent(new MouseEvent("click", opts));
    return "dispatched";
  }).catch((e) => "CTX " + String(e).slice(0, 50));
  console.log("dispatch:", r1);
  await sleep(2500);
  const st = await page.evaluate(() => ({
    active: (document.querySelector('[role="tab"][data-state="active"]') || {}).textContent,
    hist: document.body.innerText.includes("Performance History") || document.body.innerText.includes("Riwayat Penilaian Kinerja"),
    rows: document.querySelectorAll("table tbody tr").length,
  })).catch((e) => "CTX " + String(e).slice(0, 50));
  console.log("state:", JSON.stringify(st));
  if (st && st.hist) {
    await page.screenshot({ path: "/home/z/my-project/.e2e-shots/p8-employee-kinerja-tab-en.png", fullPage: true });
    console.log("SCREENSHOT OK");
  }
} catch (e) { console.log("ERR:", String(e).slice(0, 200)); }
finally { await browser.close(); }
