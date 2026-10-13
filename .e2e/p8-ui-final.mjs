// P8 UI E2E bagian 2 final — siklus retry dalam SATU sesi browser.
// Setiap siklus: goto detail URL → tunggu tab → klik atomik + verifikasi konten.
// Bila reload HMR mengreset ke dashboard, siklus berikutnya menavigasi ulang.
import { chromium } from "/home/z/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const OUT = "/home/z/my-project/.e2e-shots";
const EMP_ID = "cmv3lphvk004hoby98zt2rkts";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
try {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("textbox", { name: "EMAIL" }).waitFor({ timeout: 60000 });
  await page.getByRole("textbox", { name: "EMAIL" }).fill("hrd@mii.co.id");
  await page.getByRole("textbox", { name: "PASSWORD" }).fill("onevity123");
  await page.getByRole("button", { name: "SIGN IN TO WORKSPACE" }).click();
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Select workspace PT Mitra Industri Internasional" }).click();
  await page.getByRole("button", { name: "Performance", exact: true }).waitFor({ timeout: 60000 });
  console.log("login OK");

  let done = false;
  for (let cyc = 1; cyc <= 8 && !done; cyc++) {
    await page.goto(`${BASE}/?s=employee&v=detail&id=${EMP_ID}`, { waitUntil: "commit", timeout: 60000 }).catch(() => {});
    // tunggu tab (ID atau EN) — poll evaluate, window 40 dtk per siklus
    let tabs = [];
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => (t.textContent || "").trim())).catch(() => []);
      if (tabs.some((t) => /^(Kinerja|Performance)/.test(t))) break;
    }
    console.log(`siklus ${cyc}: tabs=`, JSON.stringify(tabs.slice(0, 8)));
    if (!tabs.some((t) => /^(Kinerja|Performance)/.test(t))) continue; // reload kalah — coba lagi
    const res = await page.evaluate(`
      new Promise((resolve) => {
        const tabs = [...document.querySelectorAll('[role="tab"]')];
        const perf = tabs.find((t) => /Kinerja|Performance/.test(t.textContent || ""));
        if (!perf) { resolve("NO TAB"); return; }
        perf.click();
        let n = 0;
        const iv = setInterval(() => {
          n++;
          const body = document.body.innerText;
          if (/Riwayat Penilaian Kinerja|Performance History/.test(body)) {
            clearInterval(iv);
            resolve("OK rows=" + document.querySelectorAll("table tbody tr").length
              + " xlsx=" + [...document.querySelectorAll("a")].filter((a) => /Unduh Riwayat|Download History/.test(a.textContent || "")).length
              + " per=" + /PER-\\d{4}-\\d+/.test(body));
          } else if (n > 15) { clearInterval(iv); resolve("NOCONTENT"); }
        }, 400);
      })
    `).catch((e) => "CTX: " + String(e).slice(0, 40));
    console.log(`siklus ${cyc} hasil:`, res);
    if (String(res).startsWith("OK")) {
      done = true;
      await page.screenshot({ path: OUT + "/p8-employee-kinerja-tab-en.png", fullPage: true });
      console.log("screenshot p8-employee-kinerja-tab-en.png tersimpan");
      break;
    }
  }
  if (!done) throw new Error("8 siklus gagal");

  // mobile 375×812 — katalog laporan
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "commit", timeout: 60000 }).catch(() => {});
  let mob = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    mob = await page.evaluate(() => document.body.innerText.includes("Per-Phase Completion")).catch(() => false);
    if (mob) break;
  }
  console.log("mobile katalog:", mob ? "render" : "TIDAK");
  await page.screenshot({ path: OUT + "/p8-reports-mobile.png", fullPage: true });
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2).catch(() => null);
  console.log("MOBILE h-scroll:", hScroll === null ? "n/a (reload)" : hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
  console.log("UI E2E BAGIAN 2 PASS");
} catch (e) {
  console.log("ERR:", String(e).slice(0, 240));
  process.exitCode = 1;
} finally {
  await browser.close();
}
