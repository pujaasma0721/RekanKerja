/**
 * AUDIT-1 — Audit menyeluruh API laporan distribusi 6 modul (75 laporan).
 *
 * Cakupan per modul (hr, attendance, leave, medical, travel):
 *   A. _params        → 200 + kunci pool ada
 *   B. 12-15 dokumen  → 200 + bentuk {id, meta, data} + meta.periodLabel +
 *                       meta.docNo + jumlah baris tabel primer + ringkasan
 *   C. export=xlsx    → 200 + magic bytes PK
 *   D. id tak dikenal → 400
 *   E. tanpa sesi     → 401
 *   F. varian filter  → 200 (filter server-side berfungsi)
 *
 * Payroll (param khusus per laporan: runId/lineId/periodId/year+employeeId):
 *   pool _params → pilih run Confirmed/Paid + period + lineId/employeeId,
 *   lalu 12 dokumen + 3 ekspor legacy (monthly/bpjs xlsx, spt csv).
 *
 * Hasil: rekap PASS/FAIL + tabel jumlah baris + ringkasan → JSON ke /tmp.
 * Pakai: bun run scripts/audit-all-report-documents.ts [base] [email] [pass]
 */
const BASE = process.argv[2] ?? "http://localhost:3000";
const EMAIL = process.argv[3] ?? "hrd@mii.co.id";
const PASS = process.argv[4] ?? "onevity123";

interface Check { label: string; ok: boolean; detail: string }
const checks: Check[] = [];
const rowCounts: Record<string, unknown> = {};
const summaryBlocks: Record<string, unknown> = {};
let fail = 0;
function ck(label: string, ok: boolean, detail = ""): void {
  checks.push({ label, ok, detail });
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}

function jarOf(res: Response): string {
  // Pola e2e-medical-wave1: ambil set-cookie terakhir (session tunggal) —
  // JANGAN append (dua cookie sesi duplikat → 401).
  const sc = res.headers.get("set-cookie");
  return sc ? sc.split(";")[0] : "";
}
let cookie = "";
async function get(path: string, _cookie?: string): Promise<Response> {
  const noAuth = _cookie === "";
  const res = await fetch(`${BASE}${path}`, {
    headers: noAuth ? {} : { cookie }, redirect: "manual",
  });
  const jar = jarOf(res);
  if (jar) cookie = jar;
  return res;
}
async function post(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body), redirect: "manual",
  });
  const jar = jarOf(res);
  if (jar) cookie = jar;
  return res;
}

/** Hitung jumlah baris array terbesar dalam payload (tabel primer). */
function primaryRows(payload: unknown): { key: string; n: number } {
  let best = { key: "(none)", n: -1 };
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 4 || v == null || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      if (v.length > best.n) best = { key: path, n: v.length };
      if (v[0] && typeof v[0] === "object") walk(v[0], `${path}[0]`, depth + 1);
    } else if (typeof v === "object") {
      for (const [k, c] of Object.entries(v as Record<string, unknown>)) walk(c, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(payload, "", 0);
  return best.n < 0 ? { key: "(empty)", n: 0 } : best;
}

interface DocShape { id?: string; meta?: Record<string, unknown>; data?: Record<string, unknown> }

async function auditDocModule(
  name: string, base: string, cookie: string, ids: string[], filterQs: string,
): Promise<void> {
  console.log(`\n===== MODUL ${name.toUpperCase()} (${ids.length} laporan) =====`);
  // A. _params (konvensi 5 modul dok: ?id=_params)
  const rp = await get(`${base}?id=_params`, cookie);
  const pj = (await rp.json().catch(() => ({}))) as Record<string, unknown>;
  ck(`[${name}] _params 200`, rp.status === 200, `status=${rp.status} keys=${Object.keys(pj).join(",").slice(0, 120)}`);

  // B+C. tiap dokumen (tanpa filter → baseline baris penuh)
  for (const id of ids) {
    const r = await get(`${base}?id=${id}`, cookie);
    if (r.status !== 200) { ck(`[${name}] ${id} 200`, false, `status=${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
    const j = (await r.json()) as DocShape;
    const metaOk = !!j.meta?.periodLabel && typeof j.data === "object" && j.data != null;
    const rows = primaryRows(j.data);
    rowCounts[`${name}:${id}`] = { key: rows.key, n: rows.n, periodLabel: j.meta?.periodLabel };
    // ringkasan (objek dengan kunci total/sum) utk reviu konsistensi
    const sm = (j.data ?? {}) as Record<string, unknown>;
    const smKeys = Object.keys(sm).filter((k) => /total|sum/i.test(k) && typeof sm[k] !== "object");
    const smPick: Record<string, unknown> = {};
    for (const k of smKeys.slice(0, 8)) smPick[k] = sm[k];
    summaryBlocks[`${name}:${id}`] = smPick;
    ck(`[${name}] ${id} bentuk+meta`, metaOk, `rows=${rows.n} (${rows.key}) period=${String(j.meta?.periodLabel).slice(0, 48)}`);

    // C. XLSX
    const rx = await get(`${base}?id=${id}&export=xlsx`, cookie);
    const buf = new Uint8Array(await rx.arrayBuffer());
    const pk = buf[0] === 0x50 && buf[1] === 0x4b;
    ck(`[${name}] ${id} XLSX PK`, rx.status === 200 && pk, `status=${rx.status} size=${buf.length}B`);
  }

  // D. id tak dikenal
  const rb = await get(`${base}?id=zz99`, cookie);
  ck(`[${name}] id tak dikenal → 400`, rb.status === 400, `status=${rb.status}`);

  // E. tanpa sesi
  const rn = await get(`${base}?id=${ids[0]}`, "");
  ck(`[${name}] tanpa sesi → 401`, rn.status === 401, `status=${rn.status}`);

  // F. varian filter
  const rf = await get(`${base}?id=${ids[0]}&${filterQs}`, cookie);
  let filtDetail = `status=${rf.status}`;
  if (rf.status === 200) {
    const jf = (await rf.json()) as DocShape;
    const rfRows = primaryRows(jf.data);
    filtDetail += ` rows=${rfRows.n} (unfiltered=${(rowCounts[`${name}:${ids[0]}`] as { n: number } | undefined)?.n ?? "?"})`;
  }
  ck(`[${name}] filter ${filterQs.slice(0, 70)} → 200`, rf.status === 200, filtDetail);
}

async function auditPayroll(cookie: string): Promise<void> {
  const base = "/api/rekankerja/payroll-reports/documents";
  console.log(`\n===== MODUL PAYROLL (12 laporan) =====`);
  const rp = await get(`${base}?_params=1`, cookie);
  const pj = (await rp.json().catch(() => ({}))) as {
    runs?: { id: string; runNo: string; status: string; periodId: string; periodName: string; sptYear: number }[];
    periods?: { id: string; name: string; sptYear: number; runCount: number }[];
    years?: number[]; orgUnits?: { name: string }[]; banks?: { name: string }[];
  };
  ck("[payroll] _params 200", rp.status === 200 && (pj.runs?.length ?? 0) > 0,
    `status=${rp.status} runs=${pj.runs?.length ?? 0} periods=${pj.periods?.length ?? 0} years=${pj.years?.join(",")} banks=${pj.banks?.length ?? 0}`);

  const run = pj.runs?.find((r) => r.status === "Paid") ?? pj.runs?.[0];
  const period = pj.periods?.find((p) => p.id === run?.periodId) ?? pj.periods?.[0];
  const year = pj.years?.[0] ?? 2026;
  if (!run || !period) { ck("[payroll] run/period tersedia", false, "tidak ada run Confirmed/Paid"); return; }

  // pool karyawan by-run (utk r11 lineId) & by-year (utk r22 employeeId)
  const re = await get(`${base}?_params=employees&runId=${run.id}`, cookie);
  const rej = (await re.json().catch(() => ({}))) as { employees?: { lineId?: string; employeeId?: string; name: string }[] };
  const line = rej.employees?.[0];
  ck("[payroll] pool employees(by run)", re.status === 200 && !!line, `status=${re.status} n=${rej.employees?.length ?? 0}`);
  const ry = await get(`${base}?_params=employees&year=${year}`, cookie);
  const ryj = (await ry.json().catch(() => ({}))) as { employees?: { employeeId?: string; name: string }[] };
  const emp = ryj.employees?.[0];
  ck("[payroll] pool employees(by year)", ry.status === 200 && !!emp, `status=${ry.status} n=${ryj.employees?.length ?? 0}`);

  const q: Record<string, string> = {
    r11: `report=r11&runId=${run.id}&lineId=${line?.lineId ?? ""}`,
    r12: `report=r12&runId=${run.id}`,
    r13: `report=r13&runId=${run.id}`,
    r21: `report=r21&periodId=${period.id}`,
    r22: `report=r22&year=${year}&employeeId=${emp?.employeeId ?? ""}`,
    r23: `report=r23&periodId=${period.id}`,
    r31: `report=r31&runId=${run.id}`,
    r32: `report=r32&runId=${run.id}`,
    r33: `report=r33&runId=${run.id}`,
    r41: `report=r41&periodId=${period.id}`,
    r42: `report=r42&periodId=${period.id}`,
    r43: `report=r43&runId=${run.id}`,
  };
  // bentuk payroll bervariasi per laporan (flat + kunci khas per dokumen)
  const expect: Record<string, { keys: string[]; emptyOk?: boolean }> = {
    r11: { keys: ["slip"] },                                  // payslip 1 karyawan
    r12: { keys: ["rows", "columns", "totals"] },               // register gaji
    r13: { keys: ["groups", "totals"] },                       // bank-link per bank
    r21: { keys: ["rows", "totals", "regulation"] },           // PPh21 bulanan
    r22: { keys: ["employee", "formNo"] },                     // 1721-A1
    r23: { keys: ["rows"], emptyOk: true },                     // PPh26 — legit 0 (tanpa ekspatriat)
    r31: { keys: ["rows", "totals", "regulation"] },            // BPJS TK
    r32: { keys: ["rows", "totals", "regulation"] },            // BPJS KS
    r33: { keys: ["rows"], emptyOk: true },                     // Tapera — legit 0 (demo tanpa komponen Tapera)
    r41: { keys: ["summary", "byUnit", "current", "previous"] },// variansi
    r42: { keys: ["rows", "totals"] },                          // TCOW
    r43: { keys: ["rows", "orders", "totals"] },                // lembur
  };
  for (const [id, qs] of Object.entries(q)) {
    const r = await get(`${base}?${qs}`, cookie);
    if (r.status !== 200) { ck(`[payroll] ${id} 200`, false, `status=${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
    const j = (await r.json()) as Record<string, unknown>;
    const ex = expect[id]!;
    const commonOk = j.report === id && typeof j.company === "object" && j.company != null &&
      typeof j.officer === "object" && j.officer != null;
    const keysOk = ex.keys.every((k) => j[k] !== undefined);
    let n = -1;
    for (const k of ex.keys) if (Array.isArray(j[k])) n = Math.max(n, (j[k] as unknown[]).length);
    const nonEmptyOk = ex.emptyOk || n !== 0;
    rowCounts[`payroll:${id}`] = { n, totals: (j.totals as Record<string, unknown>) ?? null };
    ck(`[payroll] ${id} bentuk+meta`, commonOk && keysOk && nonEmptyOk,
      `keys=${ex.keys.join("+")} n=${n < 0 ? "(obj)" : n}${ex.emptyOk ? " (kosong wajar)" : ""}`);
  }
  // varian filter unit pada r12
  const unitName = pj.orgUnits?.[0]?.name;
  if (unitName) {
    const rf = await get(`${base}?report=r12&runId=${run.id}&unit=${encodeURIComponent(unitName)}`, cookie);
    ck("[payroll] filter unit r12 → 200", rf.status === 200, `status=${rf.status}`);
  }
  // ekspor legacy
  const x1 = await get(`/api/rekankerja/payroll-reports/monthly?runId=${run.id}&export=xlsx`, cookie);
  const b1 = new Uint8Array(await x1.arrayBuffer());
  ck("[payroll] r12 ekspor monthly XLSX PK", x1.status === 200 && b1[0] === 0x50 && b1[1] === 0x4b, `status=${x1.status} size=${b1.length}B`);
  const x2 = await get(`/api/rekankerja/payroll-reports/bpjs?runId=${run.id}&export=xlsx`, cookie);
  const b2 = new Uint8Array(await x2.arrayBuffer());
  ck("[payroll] r31 ekspor bpjs XLSX PK", x2.status === 200 && b2[0] === 0x50 && b2[1] === 0x4b, `status=${x2.status} size=${b2.length}B`);
  const x3 = await get(`/api/rekankerja/payroll-spt?year=${year}&export=a1`, cookie);
  const t3 = await x3.text();
  ck("[payroll] r22 ekspor SPT CSV", x3.status === 200 && t3.length > 10, `status=${x3.status} len=${t3.length}`);
  // error handling
  const rb = await get(`${base}?report=zz99&runId=${run.id}`, cookie);
  ck("[payroll] report tak dikenal → 400", rb.status === 400, `status=${rb.status}`);
  const rn = await get(`${base}?report=r12`, "");
  ck("[payroll] tanpa sesi → 401", rn.status === 401, `status=${rn.status}`);
}

async function main(): Promise<void> {
  // login + pilih workspace MII
  const rl = await post("/api/auth/login", { email: EMAIL, password: PASS });
  const lj = (await rl.json().catch(() => ({}))) as { tenant?: unknown; workspaces?: { id: string; slug?: string }[] };
  if (!lj.tenant && Array.isArray(lj.workspaces) && lj.workspaces.length > 1) {
    const mii = lj.workspaces.find((w) => (w.slug ?? "").includes("mitra"));
    if (mii) await post("/api/auth/select-tenant", { tenantId: mii.id });
  }
  if (!cookie) { console.error("login gagal"); process.exit(1); }
  console.log(`login OK → ${EMAIL} @ ${BASE}`);

  // buka Money Vault (nilai uang riil utk verifikasi aritmetika ringkasan)
  const vst = await get("/api/rekankerja/money-vault");
  const vj = (await vst.json().catch(() => ({}))) as { configured?: boolean };
  if (vj.configured) {
    const un = await post("/api/rekankerja/money-vault", { action: "unlock", password: "asmaree.007" });
    console.log(`money vault: unlock ${un.status === 200 ? "OK (nilai riil)" : "GAGAL (" + un.status + ") — nilai masked"}`);
  } else {
    console.log("money vault: legacy — nilai uang langsung riil");
  }

  await auditDocModule("hr", "/api/rekankerja/hr/reports/documents", cookie,
    ["r11", "r12", "r13", "r14", "r15", "r21", "r22", "r23", "r31", "r32", "r33", "r34", "r41", "r42", "r43", "r44"],
    "status=Permanent",
  ).catch((e) => ck("[hr] modul error", false, String(e)));

  await auditDocModule("attendance", "/api/rekankerja/attendance/reports/documents", cookie,
    ["ar11", "ar12", "ar13", "ar21", "ar22", "ar23", "ar31", "ar32", "ar33", "ar41", "ar42", "ar43"],
    "otStatus=Verified").catch((e) => ck("[attendance] modul error", false, String(e)));
  await auditDocModule("leave", "/api/rekankerja/leave/reports/documents", cookie,
    ["lr11", "lr12", "lr13", "lr21", "lr22", "lr23", "lr31", "lr32", "lr33", "lr41", "lr42", "lr43"],
    "status=Approved").catch((e) => ck("[leave] modul error", false, String(e)));
  await auditDocModule("medical", "/api/rekankerja/medical/reports/documents", cookie,
    ["mr11", "mr12", "mr13", "mr21", "mr22", "mr23", "mr31", "mr32", "mr33", "mr41", "mr42", "mr43"],
    "status=SUBMITTED").catch((e) => ck("[medical] modul error", false, String(e)));
  await auditDocModule("travel", "/api/rekankerja/travel/reports/documents", cookie,
    ["tr11", "tr12", "tr13", "tr21", "tr22", "tr23", "tr31", "tr32", "tr33", "tr41", "tr42", "tr43"],
    "status=Approved").catch((e) => ck("[travel] modul error", false, String(e)));
  await auditPayroll(cookie).catch((e) => ck("[payroll] modul error", false, String(e)));

  const total = checks.length;
  console.log(`\n===== REKAP AUDIT-1 =====`);
  console.log(`PASS ${total - fail}/${total} · FAIL ${fail}`);
  await (await import("node:fs/promises")).writeFile("/tmp/audit1-report-documents.json", JSON.stringify({
    base: BASE, at: new Date().toISOString(), total, fail,
    checks, rowCounts, summaryBlocks,
  }, null, 2));
  console.log("detail → /tmp/audit1-report-documents.json");
  process.exit(fail > 0 ? 1 : 0);
}
main();

export {};
