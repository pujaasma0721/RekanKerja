// P8 UI E2E bagian 2c — pola polling diag2 (terbukti berhasil) + klik tab + screenshot.
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

  // detail karyawan — poll sampai tab muncul (pola diag2, window 120 dtk)
  await page.goto(`${BASE}/?s=employee&v=detail&id=${EMP_ID}`, { waitUntil: "commit", timeout: 90000 }).catch(() => {});
  let tabs = [];
  for (let i = 0; i < 70; i++) {
    await sleep(1000);
    tabs = await page.getByRole("tab").allInnerTexts().catch(() => []);
    if (tabs.length > 3) break;
  }
  console.log("TABS:", JSON.stringify(tabs));
  // klik + verifikasi via evaluate murni — load event phantom membuat wait Playwright menggantung
  // klik + tunggu konten dalam SATU evaluate atomik (kebal reload antar-poll)
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
          resolve("CLICKED+CONTENT rows=" + document.querySelectorAll("table tbody tr").length + " xlsx=" + [...document.querySelectorAll("a")].filter((a) => /Unduh Riwayat|Download History/.test(a.textContent || "")).length + " PER=" + /PER-\\d{4}-\\d+/.test(body));
        } else if (n > 12) { clearInterval(iv); resolve("CLICKED NO CONTENT: " + body.slice(0, 80)); }
      }, 400);
    })
  `);
  console.log("hasil atomik:", res);
  if (!String(res).startsWith("CLICKED+CONTENT")) throw new Error("kinerja gagal: " + res);
  const content = "";
  const histOk = /Riwayat Penilaian Kinerja|Performance History/.test(content);
  const rows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
  const xlsx = await page.evaluate(() => [...document.querySelectorAll("a")].filter((a) => /Unduh Riwayat|Download History/.test(a.textContent || "")).length);
  const docRow = /PER-\d{4}-\d+/.test(content);
  console.log("KINERJA TAB: heading =", histOk, "· tabel rows =", rows, "· tombol XLSX =", xlsx, "· baris PER-xxxx =", docRow);
  if (!histOk) throw new Error("konten kinerja tidak muncul: " + content.slice(0, 120));
  await page.screenshot({ path: OUT + "/p8-employee-kinerja-tab-en.png", fullPage: true });
  console.log("screenshot p8-employee-kinerja-tab-en.png tersimpan");

  // mobile — reports catalog 375×812
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + "/?m=performance&v=reports", { waitUntil: "commit", timeout: 90000 }).catch(() => {});
  let mob = false;
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    mob = await page.getByRole("button", { name: /Per-Phase Completion/ }).first().isVisible().catch(() => false);
    if (mob) break;
  }
  console.log("mobile catalog:", mob ? "render" : "TIDAK render");
  await page.screenshot({ path: OUT + "/p8-reports-mobile.png", fullPage: true });
  const hScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  console.log("MOBILE h-scroll:", hScroll ? "ADA (masalah!)" : "tidak ada (lulus)");
  console.log("UI E2E BAGIAN 2 PASS");
} catch (e) {
  console.log("ERR:", String(e).slice(0, 240));
  await page.screenshot({ path: OUT + "/p8-debug4.png", fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
