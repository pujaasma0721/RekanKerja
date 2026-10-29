/// <reference types="bun-types" />
// =====================================================================
// RekanKerja — Online Support P3: BROWSER-RUNNER (mini-service) ========
// =====================================================================
// Layanan headless-browser untuk tool `reproduce_browser` agen support
// (FEAT-SUPPORT-P3 — level otonomi L3). SATU AKSI per panggilan HTTP —
// pola ini cocok dengan loop ReAct di support-agent.ts (agen melihat
// hasil tiap aksi → memutuskan aksi berikutnya), bukan skrip panjang.
//
// Endpoint (semua JSON, server-ke-server — tidak diekspos via gateway):
//   GET  /health   → { ok, sessions }
//   POST /session  { key, login?: {email,password} }
//         → buat/restart sesi browser (key = id tiket). login opsional:
//           POST /api/auth/login aplikasi → cookie rekankerja_session
//           disemai ke konteks (agen TIDAK PERNAH melihat kata sandi).
//   POST /action   { key, action }
//         → satu aksi (auto-buat sesi tamu bila belum ada):
//           goto/snapshot/click/fill/select/press/check/uncheck/scroll/
//           wait/screenshot/console/close
//
// GUARDRAIL (prinsip "browser kurungan"):
//   · HANYA origin aplikasi sendiri (SUPPORT_APP_BASE_URL, default
//     http://127.0.0.1:3000) — request lintas-origin di-abort di level
//     context.route; path goto wajib relatif ("/..."), tanpa "..".
//   · Download dibatalkan, dialog JS otomatis ditolak.
//   · Budget: maks 2 sesi serentak · 24 aksi/sesi · 3 tangkapan layar ·
//     sesi idle > 3 menit ditutup otomatis (reaper).
//   · Viewport 1366×900, locale id-ID, timezone Asia/Jakarta.
//   · Playwright resolusi portabel (env SUPPORT_PLAYWRIGHT_PATH → node_modules
//     lokal mini-service → path global sandbox) — lihat PW_PATH_CANDIDATES.
// =====================================================================

const PORT = 3020;
const BASE = (process.env.SUPPORT_APP_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ---- playwright — resolusi PORTABEL (env → node_modules lokal → global sandbox).
//    Deploy di server baru: `cd mini-services/browser-runner && bun add playwright
//    && bunx playwright install chromium`, ATAU set SUPPORT_PLAYWRIGHT_PATH ke
//    instalasi playwright yang sudah ada (mis. global npm).
//    Opsional: SUPPORT_CHROMIUM_PATH → path executable chrome penuh
//    (chrome-linux64/chrome) — wajib di server yang headless-shell-nya crash
//    (mis: CPU QEMU emulated tua). ----
const PW_PATH_CANDIDATES = [
  process.env.SUPPORT_PLAYWRIGHT_PATH,
  new URL("./node_modules/playwright/index.mjs", import.meta.url).pathname,
  "/home/z/.npm-global/lib/node_modules/playwright/index.mjs",
].filter((p): p is string => Boolean(p));
const PW_INSTALL_HINT =
  "modul playwright tidak ditemukan — install di mini-service " +
  "(cd mini-services/browser-runner && bun add playwright && bunx playwright install chromium) " +
  "atau set env SUPPORT_PLAYWRIGHT_PATH ke path index.mjs instalasi playwright yang sudah ada";

const PW_EXEC = process.env.SUPPORT_CHROMIUM_PATH || undefined;
/** Tipe browser: "chromium" (default) atau "firefox" — server dgn CPU tua
 *  (mis. VM QEMU emulated) di mana chromium 156 segfault, pakai firefox. */
const PW_TYPE = process.env.SUPPORT_BROWSERTYPE === "firefox" ? "firefox" : "chromium";
let pwMod: { chromium: { launch(opts?: Record<string, unknown>): Promise<Any> }; firefox?: { launch(opts?: Record<string, unknown>): Promise<Any> } } | null = null;
async function playwright() {
  if (!pwMod) {
    let lastErr: unknown = null;
    for (const p of PW_PATH_CANDIDATES) {
      try {
        pwMod = (await import(p)) as NonNullable<typeof pwMod>;
        return pwMod;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`${PW_INSTALL_HINT} (terakhir dicoba: ${lastErr instanceof Error ? lastErr.message : String(lastErr)})`);
  }
  return pwMod;
}

// ---- batas & budget ----
const MAX_SESSIONS = 2;
const MAX_ACTIONS = 24;
const MAX_SHOTS = 3;
const SESSION_TTL_MS = 180_000;
const CONSOLE_CAP = 80;
const GOTO_TIMEOUT = 15_000;
const ACTION_TIMEOUT = 10_000;
const SETTLE_MS = 500;

interface ConsoleEntry { type: string; text: string }
interface Session {
  context: Any; page: Any;
  consoleBuf: ConsoleEntry[]; consoleSeen: number;
  actions: number; screenshots: number;
  lastUsed: number;
  loggedIn: boolean;
  identity: { name: string | null; email: string | null; tenantName: string | null } | null;
}


const sessions = new Map<string, Session>();
let browser: Any = null;
let lastBrowserUse = 0;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function keyOf(b: Record<string, unknown>): string | null {
  const k = String(b.key ?? "").trim();
  return /^[A-Za-z0-9_-]{1,80}$/.test(k) ? k : null;
}
function pushConsole(s: Session, type: string, text: string) {
  s.consoleBuf.push({ type, text: text.replace(/\s+/g, " ").slice(0, 240) });
  if (s.consoleBuf.length > CONSOLE_CAP) s.consoleBuf.splice(0, s.consoleBuf.length - CONSOLE_CAP);
}
function budgets(s: Session) {
  return { actions: `${s.actions}/${MAX_ACTIONS}`, screenshots: `${s.screenshots}/${MAX_SHOTS}` };
}
async function titleOf(s: Session): Promise<string> {
  try { return String(await s.page.title()); } catch { return ""; }
}
async function safeUrl(s: Session): Promise<string> {
  try { return String(s.page.url()); } catch { return ""; }
}

async function getBrowser() {
  if (browser) return browser;
  const pw = await playwright();
  const bt = pw[PW_TYPE];
  if (!bt) throw new Error(`tipe browser tidak tersedia di instalasi playwright: ${PW_TYPE}`);
  if (PW_TYPE === "firefox") {
    browser = await bt.launch({ headless: true });
  } else {
    browser = await bt.launch({
      headless: true,
      executablePath: PW_EXEC,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    });
  }
  lastBrowserUse = Date.now();
  return browser;
}

async function destroySession(key: string) {
  const s = sessions.get(key);
  sessions.delete(key);
  if (s) await s.context.close().catch(() => {});
}

/** Login via API aplikasi → semai cookie sesi ke konteks browser. */
async function doLogin(s: Session, email: string, password: string) {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({} as Record<string, unknown>));
    if (!res.ok) {
      return { ok: false as const, error: `login ditolak (HTTP ${res.status})${body?.error ? `: ${String(body.error).slice(0, 160)}` : ""}` };
    }
    if (body?.mfaRequired) {
      return { ok: false as const, error: "akun uji mengaktifkan MFA — tidak dapat dipakai untuk reproduksi otomatis" };
    }
    const m = res.headers.get("set-cookie")?.match(/rekankerja_session=([^;]+)/);
    if (!m) return { ok: false as const, error: "login berhasil namun sesi tidak diterima" };
    await s.context.addCookies([{ name: "rekankerja_session", value: m[1], url: BASE }]);
    const u = (body?.user ?? {}) as Record<string, unknown>;
    const tn = (body?.tenant ?? {}) as Record<string, unknown>;
    return {
      ok: true as const,
      identity: {
        name: typeof u.name === "string" ? u.name : null,
        email: typeof u.email === "string" ? u.email : email,
        tenantName: typeof tn.name === "string" ? tn.name : null,
      },
    };
  } catch (e) {
    return { ok: false as const, error: `login gagal: ${msg(e).slice(0, 200)}` };
  }
}

async function createSession(key: string, login?: { email: string; password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  await destroySession(key);
  if (sessions.size >= MAX_SESSIONS) {
    return { ok: false, error: "terlalu banyak sesi browser aktif — coba beberapa saat lagi" };
  }
  const b = await getBrowser();
  lastBrowserUse = Date.now();
  const context = await b.newContext({
    viewport: { width: 1366, height: 900 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });
  // Kurungan origin: hanya aplikasi sendiri yang boleh dihubungi.
  await context.route("**/*", (route: Any) => {
    try {
      const u = new URL(route.request().url());
      if (u.origin !== ORIGIN) return route.abort();
      return route.continue();
    } catch {
      return route.abort();
    }
  });
  const page = await context.newPage();
  const s: Session = {
    context, page, consoleBuf: [], consoleSeen: 0,
    actions: 0, screenshots: 0, lastUsed: Date.now(),
    loggedIn: false, identity: null,
  };
  page.on("console", (m: Any) => {
    const t = m.type();
    if (t === "error" || t === "warning") pushConsole(s, t, m.text());
  });
  page.on("pageerror", (err: Any) => pushConsole(s, "pageerror", String(err?.message ?? err)));
  page.on("response", (r: Any) => {
    if (r.status() >= 400) pushConsole(s, "http", `${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on("requestfailed", (r: Any) => pushConsole(s, "net", `GAGAL ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`.trim()));
  page.on("download", (d: Any) => void d.cancel().catch(() => {}));
  page.on("dialog", (d: Any) => void d.dismiss().catch(() => {}));
  sessions.set(key, s);

  if (login) {
    const r = await doLogin(s, login.email, login.password);
    if (!r.ok) {
      await destroySession(key);
      return { ok: false, error: r.error };
    }
    s.loggedIn = true;
    s.identity = r.identity;
  }
  return { ok: true };
}

function refSel(ref: unknown): string | null {
  const r = String(ref ?? "").trim();
  if (!/^e\d{1,4}$/.test(r)) return null;
  return `[data-sb-ref="${r}"]`;
}

/** Fungsi snapshot dijalankan DI DALAM halaman (self-contained — tanpa closure). */
const SNAPSHOT_FN = `(() => {
  const SEL = "a[href], button, input, select, textarea, [role='button'], [role='tab'], [role='menuitem'], [contenteditable='true'], summary";
  const els = Array.from(document.querySelectorAll(SEL));
  const items = [];
  let total = 0;
  for (const el of els) {
    if (items.length >= 48) break;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none") continue;
    total += 1;
    let label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "";
    if (!label && el.id) {
      try {
        const lb = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lb) label = lb.innerText;
      } catch (e) {}
    }
    const tag = el.tagName.toLowerCase();
    if (!label && (tag === "a" || tag === "button" || tag === "summary" || el.getAttribute("role"))) label = el.innerText || el.value || "";
    if (tag === "select") {
      const opts = Array.from(el.options).slice(0, 10).map((o) => o.value || o.text).filter(Boolean);
      if (!label) label = "opsi: " + opts.join(" | ");
    }
    label = String(label || "").replace(/\\s+/g, " ").trim().slice(0, 90);
    let kind = tag === "a" ? "link" : tag === "select" ? "select" : tag === "textarea" ? "textarea" : "button";
    if (tag === "input") kind = el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "textbox";
    const ref = "e" + total;
    el.setAttribute("data-sb-ref", ref);
    const dis = el.disabled || el.getAttribute("aria-disabled") === "true" ? " [nonaktif]" : "";
    items.push(ref + " " + kind + (label ? ' "' + label + '"' : "") + dis);
  }
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .filter((h) => h.getBoundingClientRect().height > 0)
    .slice(0, 6)
    .map((h) => String(h.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 90))
    .filter(Boolean);
  return { items, headings, skipped: Math.max(0, els.length - total) };
})()`;

const PRESS_KEYS = new Set(["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"]);

async function settle(s: Session) {
  await s.page.waitForTimeout(SETTLE_MS).catch(() => {});
}

async function executeAction(s: Session, action: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  const t = String(action.type ?? "").trim();
  try {
    switch (t) {
      case "goto": {
        const p = String(action.path ?? "/").trim();
        if (!p.startsWith("/") || p.length > 300 || p.includes("..") || /^[a-zA-Z]+:/.test(p.slice(1)) || p.includes("\\")) {
          return { ok: false, error: 'path harus relatif aplikasi, diawali "/" (tanpa host/protokol/..)' };
        }
        await s.page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT });
        await s.page.waitForTimeout(700); // hidrasi SPA
        return { ok: true, data: {} };
      }
      case "snapshot": {
        const r = await s.page.evaluate(SNAPSHOT_FN);
        return { ok: true, data: r as Record<string, unknown> };
      }
      case "click":
      case "check":
      case "uncheck": {
        const sel = refSel(action.ref);
        if (!sel) return { ok: false, error: 'parameter "ref" tidak valid — ambil snapshot dulu untuk daftar ref (e1, e2, …)' };
        await s.page[t](sel, { timeout: ACTION_TIMEOUT });
        await settle(s);
        return { ok: true, data: {} };
      }
      case "fill": {
        const sel = refSel(action.ref);
        if (!sel) return { ok: false, error: 'parameter "ref" tidak valid — ambil snapshot dulu untuk daftar ref (e1, e2, …)' };
        await s.page.fill(sel, String(action.value ?? ""), { timeout: ACTION_TIMEOUT });
        return { ok: true, data: {} };
      }
      case "select": {
        const sel = refSel(action.ref);
        if (!sel) return { ok: false, error: 'parameter "ref" tidak valid — ambil snapshot dulu untuk daftar ref (e1, e2, …)' };
        const v = String(action.value ?? "");
        try {
          await s.page.selectOption(sel, v, { timeout: ACTION_TIMEOUT });
        } catch {
          await s.page.selectOption(sel, { label: v }, { timeout: ACTION_TIMEOUT });
        }
        await settle(s);
        return { ok: true, data: {} };
      }
      case "press": {
        const k = String(action.key ?? "");
        if (!PRESS_KEYS.has(k)) return { ok: false, error: `tombol tidak diizinkan: gunakan salah satu ${[...PRESS_KEYS].join("/")}` };
        await s.page.keyboard.press(k);
        await settle(s);
        return { ok: true, data: {} };
      }
      case "scroll": {
        const dir = String(action.direction ?? "down") === "up" ? "up" : "down";
        const amt = Math.min(3000, Math.max(100, Math.floor(Number(action.amount) || 600)));
        await s.page.evaluate(`window.scrollBy(0, ${dir === "down" ? amt : -amt})`);
        await s.page.waitForTimeout(250).catch(() => {});
        return { ok: true, data: {} };
      }
      case "wait": {
        if (action.text != null) {
          const txt = JSON.stringify(String(action.text).slice(0, 120));
          await s.page.waitForFunction(`document.body && document.body.innerText.includes(${txt})`, undefined, { timeout: 8000, polling: 250 });
        } else if (action.url != null) {
          const frag = JSON.stringify(String(action.url).slice(0, 200));
          await s.page.waitForFunction(`location.href.includes(${frag})`, undefined, { timeout: 8000, polling: 250 });
        } else if (action.idle === true) {
          await s.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
        } else {
          const ms = Math.min(5000, Math.max(200, Math.floor(Number(action.ms) || 1200)));
          await s.page.waitForTimeout(ms);
        }
        return { ok: true, data: {} };
      }
      case "screenshot": {
        if (s.screenshots >= MAX_SHOTS) {
          return { ok: false, error: `kuota tangkapan layar habis (maks ${MAX_SHOTS} per sesi)` };
        }
        const buf = await s.page.screenshot({ type: "jpeg", quality: 72 });
        s.screenshots += 1;
        return { ok: true, data: { image: buf.toString("base64"), bytes: buf.length } };
      }
      case "console": {
        return { ok: true, data: { lines: s.consoleBuf.slice(-25) } };
      }
      case "close": {
        return { ok: true, data: { closed: true } };
      }
      default:
        return { ok: false, error: `aksi tidak dikenal "${t.slice(0, 40)}" — lihat daftar aksi yang valid` };
    }
  } catch (e) {
    return { ok: false, error: msg(e).slice(0, 300) };
  }
}

// ------------------------- HTTP handlers -----------------------------

async function handleSession(b: Record<string, unknown>): Promise<Response> {
  const key = keyOf(b);
  if (!key) return json({ ok: false, error: "key sesi tidak valid" });
  let login: { email: string; password: string } | undefined;
  if (b.login && typeof b.login === "object") {
    const l = b.login as Record<string, unknown>;
    const email = String(l.email ?? "").trim().slice(0, 200);
    const password = String(l.password ?? "").slice(0, 200);
    if (!email || !password) return json({ ok: false, error: "login.email dan login.password wajib diisi" });
    login = { email, password };
  }
  const r = await createSession(key, login);
  if (!r.ok) return json(r);
  const s = sessions.get(key);
  if (!s) return json({ ok: false, error: "sesi gagal dibuat" });
  await s.page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: GOTO_TIMEOUT }).catch(() => null);
  await s.page.waitForTimeout(600).catch(() => null);
  return json({
    ok: true, fresh: true, loggedIn: s.loggedIn, identity: s.identity,
    url: await safeUrl(s), title: await titleOf(s), budgets: budgets(s),
  });
}

async function handleAction(b: Record<string, unknown>): Promise<Response> {
  const key = keyOf(b);
  if (!key) return json({ ok: false, error: "key sesi tidak valid" });
  const action = (b.action && typeof b.action === "object" ? b.action : null) as Record<string, unknown> | null;
  if (!action) return json({ ok: false, error: "parameter action (objek) wajib" });

  let s = sessions.get(key);
  let fresh = false;
  if (!s) {
    const r = await createSession(key);
    if (!r.ok) return json(r);
    s = sessions.get(key)!;
    fresh = true;
  }
  s.lastUsed = Date.now();
  lastBrowserUse = Date.now();

  if (String(action.type) === "close") {
    await destroySession(key);
    return json({ ok: true, url: "", title: "", data: { closed: true }, fresh, consoleNew: [], budgets: null });
  }
  if (s.actions >= MAX_ACTIONS) {
    return json({ ok: false, error: `kuota aksi sesi habis (${MAX_ACTIONS}) — sesi dapat dibuat ulang bila perlu`, url: await safeUrl(s), title: await titleOf(s), fresh, consoleNew: [], budgets: budgets(s) });
  }
  s.actions += 1;
  const r = await executeAction(s, action);

  const consoleNew = s.consoleBuf.slice(s.consoleSeen, s.consoleSeen + 6);
  s.consoleSeen = s.consoleBuf.length;
  return json({
    ok: r.ok,
    error: r.error ?? null,
    url: await safeUrl(s),
    title: await titleOf(s),
    data: r.data ?? null,
    fresh,
    consoleNew,
    budgets: budgets(s),
  });
}

// ------------------------------ serve --------------------------------
// Runtime NETRAL: node (22+; dipanggil via tsx) ATAU bun — keduanya diuji.
// Server http atauong web-standards: Request/Response yang sama dipakai dua-duanya.

import http from "node:http";

async function route(req: Request): Promise<Response> {
  const u = new URL(req.url);
  try {
    if (req.method === "GET" && u.pathname === "/health") {
      return json({ ok: true, sessions: sessions.size, base: BASE });
    }
    if (req.method === "POST" && u.pathname === "/session") {
      return await handleSession((await req.json().catch(() => ({}))) as Record<string, unknown>);
    }
    if (req.method === "POST" && u.pathname === "/action") {
      return await handleAction((await req.json().catch(() => ({}))) as Record<string, unknown>);
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (e) {
    return json({ ok: false, error: msg(e).slice(0, 300) }, 500);
  }
}

http
  .createServer(async (nreq, nres) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of nreq) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks);
      const init: Record<string, any> = {
        method: nreq.method,
        headers: Object.fromEntries(Object.entries(nreq.headers).filter(([, v]) => !v || typeof v === "string")),
      };
      if (raw.length) init.body = new Uint8Array(raw);
      const wres = await route(new Request(`http://127.0.0.1:${PORT}${nreq.url ?? "/"}`, init));
      const body = Buffer.from(await wres.arrayBuffer());
      nres.writeHead(wres.status, { "Content-Type": wres.headers.get("content-type") ?? "application/json" });
      nres.end(body);
    } catch (e) {
      nres.writeHead(500, { "Content-Type": "application/json" });
      nres.end(JSON.stringify({ ok: false, error: msg(e).slice(0, 200) }));
    }
  })
  .listen(PORT, "127.0.0.1");

// Reaper: sesi idle > TTL ditutup; browser dihentikan saat tak terpakai.
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) {
    if (now - s.lastUsed > SESSION_TTL_MS) void destroySession(k);
  }
  if (sessions.size === 0 && browser && now - lastBrowserUse > 60_000) {
    const b = browser;
    browser = null;
    void b.close().catch(() => {});
  }
}, 15_000);

console.log(`[browser-runner] siap di :${PORT} (127.0.0.1 saja — server-ke-server) — target aplikasi ${BASE}`);
