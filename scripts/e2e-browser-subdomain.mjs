/**
 * Task 78 — Uji manual (browser) subdomain tenant: buka sayone.sayone.my.id,
 * login lewat UI asli, verifikasi shell aplikasi, sweep API semua modul,
 * simpan screenshot. Headless Chrome + CDP (Node 22 WebSocket native).
 * Pemakaian: node scripts/e2e-browser-subdomain.mjs <url> <email> <password>
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "https://sayone.sayone.my.id";
const EMAIL = process.argv[3] ?? "";
const PASSWORD = process.argv[4] ?? "";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const PROFILE = "C:/Users/pujaasmara/AppData/Local/Temp/rekankerja-e2e-profile";
const SHOT_DIR = "screenshots";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: res, reject: rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  onEvent(fn) { this.handlers.push(fn); }
}

async function waitEvent(cdp, method, timeoutMs = 30000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout menunggu ${method}`)), timeoutMs);
    cdp.onEvent((m) => {
      if (m.method === method) { clearTimeout(t); res(m.params); }
    });
  });
}

async function evalJs(cdp, expression, awaitPromise = true) {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? "").slice(0, 300));
  return r.result?.value;
}

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,900",
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) RekanKerjaE2E/1.0",
    "about:blank",
  ], { stdio: "ignore" });
  chrome.unref();

  try {
    // tunggu devtools siap
    let target = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        target = list.find((t) => t.type === "page");
        if (target) break;
      } catch { /* belum siap */ }
    }
    if (!target) throw new Error("Chrome devtools tidak siap");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    const cdp = new Cdp(ws);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    // ---------- 1. buka subdomain ----------
    const loaded = waitEvent(cdp, "Page.loadEventFired");
    await cdp.send("Page.navigate", { url: BASE });
    await loaded;
    await sleep(2500); // SPA hydrate

    const title = await evalJs(cdp, "document.title");
    const hasLoginForm = await evalJs(cdp, `!!document.querySelector('input[type="email"],input[type="password"]')`);
    check(`halaman login terbuka di ${BASE}`, !!title && hasLoginForm, `title=${title}`);

    // ---------- 2. login via UI ----------
    // PENTING: tab "Masuk" juga <button> — klik HARUS tombol type=submit di
    // DALAM form yang memuat input login (bukan tab, bukan tombol register).
    const fillAndSubmit = `(() => {
      const setNative = (el, v) => {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const email = document.querySelector('#login-email, form input[type="email"], form input[autocomplete="username"]');
      const pass = document.querySelector('#login-password, form input[type="password"]');
      if (!email || !pass) return "input tidak ditemukan";
      const form = email.closest("form");
      if (!form) return "form induk tidak ditemukan";
      setNative(email, ${JSON.stringify(EMAIL)});
      setNative(pass, ${JSON.stringify(PASSWORD)});
      const btn = form.querySelector('button[type="submit"]');
      if (!btn) return "tombol submit tidak ditemukan";
      btn.click();
      return "ok";
    })()`;
    const submit = await evalJs(cdp, fillAndSubmit);
    check("form login terisi & disubmit", submit === "ok", String(submit));

    // tunggu sesi siap (fetch /api/auth/me 200 dari konteks halaman)
    let sessionOk = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const st = await evalJs(cdp, `fetch("/api/auth/me").then(r => r.status).catch(() => 0)`);
        if (st === 200) { sessionOk = true; break; }
      } catch { /* halaman mungkin navigasi */ }
    }
    check("sesi aktif setelah login UI (/api/auth/me = 200)", sessionOk);

    // shell aplikasi tampil & layar login hilang
    await sleep(2000);
    const shellInfo = await evalJs(cdp, `(() => ({
      loginGone: !document.querySelector('#login-password, form input[type="password"]'),
      text: document.body.innerText.slice(0, 200),
    }))()`);
    check("shell aplikasi tampil (layar login hilang)", shellInfo.loginGone);

    const shot1 = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(SHOT_DIR, "rekankerja-sayone-dashboard.png"), Buffer.from(shot1.data, "base64"));
    console.log("      screenshot → screenshots/rekankerja-sayone-dashboard.png");

    // tenant konteks benar (dari UI session)
    const meInfo = await evalJs(cdp, `fetch("/api/auth/me").then(r => r.json())`);
    check("workspace aktif = SAYONE", meInfo?.tenant?.slug === "sayone", `tenant=${meInfo?.tenant?.slug ?? "null"} name=${meInfo?.tenant?.name ?? "-"}`);

    // ---------- 3. sweep API semua modul (cookie sesi asli browser) ----------
    const sweep = await evalJs(cdp, `(async () => {
      const eps = [
        "/api/rekankerja/dashboard", "/api/rekankerja/hr/reports", "/api/rekankerja/meta",
        "/api/rekankerja/employees?page=1", "/api/rekankerja/employee-options",
        "/api/rekankerja/positions", "/api/rekankerja/position-levels", "/api/rekankerja/grades",
        "/api/rekankerja/org-units", "/api/rekankerja/companies", "/api/rekankerja/company-offices",
        "/api/rekankerja/work-locations", "/api/rekankerja/personnel-actions",
        "/api/rekankerja/offboarding", "/api/rekankerja/onboarding",
        "/api/rekankerja/payroll-periods", "/api/rekankerja/payroll-runs", "/api/rekankerja/payroll-profiles",
        "/api/rekankerja/payroll-journals", "/api/rekankerja/payroll-spt",
        "/api/rekankerja/wage-components", "/api/rekankerja/wage-templates",
        "/api/rekankerja/minimum-wages", "/api/rekankerja/tax-parameters", "/api/rekankerja/accounts",
        "/api/rekankerja/attendance/overview", "/api/rekankerja/leave/overview", "/api/rekankerja/medical/overview",
        "/api/rekankerja/medical/claims", "/api/rekankerja/medical/types", "/api/rekankerja/travel/overview",
        "/api/rekankerja/travel/requests", "/api/rekankerja/travel/claims", "/api/rekankerja/leave/requests",
        "/api/rekankerja/leave/balances", "/api/rekankerja/leave/types", "/api/rekankerja/attendance/overtime",
        "/api/rekankerja/attendance/workoffs", "/api/rekankerja/attendance/assignments", "/api/rekankerja/attendance/holidays",
        "/api/rekankerja/announcements", "/api/rekankerja/assets", "/api/rekankerja/letters",
        "/api/rekankerja/letter-templates", "/api/rekankerja/loans", "/api/rekankerja/disciplinary",
        "/api/rekankerja/notifications", "/api/rekankerja/activity-logs",
        "/api/rekankerja/app-users", "/api/rekankerja/user-menu-access", "/api/rekankerja/lookups",
        "/api/rekankerja/process-types", "/api/rekankerja/approval-structures",
        "/api/rekankerja/ess/me", "/api/rekankerja/ess/dashboard", "/api/rekankerja/ess/notifications",
        "/api/rekankerja/ess/announcements", "/api/rekankerja/ess/attendance", "/api/rekankerja/ess/leave",
        "/api/rekankerja/ess/claims", "/api/rekankerja/ess/assets", "/api/rekankerja/ess/letters",
      ];
      const out = [];
      for (const e of eps) {
        try { const r = await fetch(e, { headers: { accept: "application/json" } }); out.push([e, r.status]); }
        catch { out.push([e, 0]); }
      }
      return out;
    })()`, true);

    // ESS = portal karyawan dgn sesi AppUser terpisah — sesi platform OWNER
    // memang ditolak 403 oleh guard ess-auth (akun tanpa tautan karyawan).
    // 403 di endpoint ESS = GUARD AKTIF (perilaku benar), bukan masalah.
    const isEss = (e) => e.includes("/ess/");
    const bad = sweep.filter(([e, s]) => !(s === 200 || s === 405) && !(isEss(e) && s === 403));
    const guardOk = sweep.filter(([e, s]) => isEss(e) && s === 403);
    const okCount = sweep.length - bad.length;
    console.log(`\n== Sweep ${sweep.length} endpoint modul (via browser session) ==`);
    for (const [e, s] of sweep) console.log(`  ${String(s).padEnd(4)} ${e}`);
    check(`endpoint modul sehat — ${okCount}/${sweep.length} (ESS ${guardOk.length}× 403 = guard sesi terpisah)`, bad.length === 0,
      bad.length ? `masalah: ${bad.map(([e, s]) => `${e}=${s}`).join(", ")}` : "");

    // ---------- 4. isolasi: menu API bukan milik SAYONE tetap aman ----------
    // (logout lalu akses employees → harus 401)
    await evalJs(cdp, `fetch("/api/auth/logout", { method: "POST" })`);
    await sleep(800);
    const afterLogout = await evalJs(cdp, `fetch("/api/rekankerja/employees?page=1").then(r => r.status)`);
    check("logout → API data terlindungi (401)", afterLogout === 401, `status=${afterLogout}`);

    const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(SHOT_DIR, "rekankerja-sayone-after-logout.png"), Buffer.from(shot2.data, "base64"));

    console.log(`\n${fail === 0 ? "✅ SEMUA PASS" : "❌ ADA GAGAL"} — ${pass} pass, ${fail} fail`);
    if (fail > 0) process.exit(1);
  } finally {
    try { spawn("taskkill", ["/F", "/T", "/PID", String(chrome.pid)], { stdio: "ignore" }); } catch { /* abaikan */ }
  }
}

main().catch((e) => { console.error("fatal:", e?.message ?? e); process.exit(1); });

export {};
