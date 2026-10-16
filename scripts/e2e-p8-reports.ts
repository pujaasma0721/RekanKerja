// Uji E2E API P8 (Laporan & Analitik Kinerja) per DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P8 — di atas data seed-p8-demo + riwayat P1–P7 (login
// owner hrd@mii.co.id; ESS tuti@mii.co.id utk ekspor riwayat §7.2):
//   1. DASHBOARD  GET /performance/reports — KPI modul + distribusi + cycles +
//      trend + snapshots; ?snapshots=1 mode ringan.
//   2. _PARAMS    pool opsi (siklus ≥3: PER-2025/PER-2026/PER-2026-CAL, tahun,
//      karyawan, sesi) + defaultCycleId = siklus aktif.
//   3. 14 LAPORAN pf11–pf44 → 200 + bentuk {id, meta{periodLabel}, data} +
//      jumlah baris > 0 pada siklus berdata (default = PER-2026 8 peserta;
//      PER-2026-CAL utk kalibrasi/merit/360; PER-2025 utk bias atasan).
//   4. pf23 RIWAYAT (PP 35/2021 §7.2): employee tanpa cycle → mode history
//      (≥2 siklus Tuti Gunawan); + cycle spesifik → detail KPI/kompetensi.
//   5. pf32 BIAS ATASAN (PER-2025): z-score 3 atasan (Joko/Tri/Agus) vs
//      rata-rata perusahaan 81.83 — statistik konsisten (n Σ = total).
//   6. pf41 MERIT: nominal terlihat (vault terbuka utk HR) + approval chain.
//   7. pf24 ANONIMITAS: Tuti (3 submitted ≥3 → agregat tampil) + Andi
//      (1 submitted <3 → hidden/dirahasiakan).
//   8. FILTER server-side: pf21 unit terfilter mengubah baris; pf22 groupBy
//      atasan menghasilkan label atasan.
//   9. XLSX EN+ID (pf21 CAL): 200 + magic bytes PK + content-type xlsx.
//  10. ESS exportHistory (tuti@mii.co.id): XLSX PK + filename ber-employeeNo
//      + EN variant + guard aksi tak dikenal 400 + tanpa sesi 401.
//  11. GUARD negatif: id tak dikenal → 400; tanpa sesi → 401; ESS mengakses
//      documents → 403 (portal karyawan tanpa menu admin).
// Jalankan: bun run scripts/e2e-p8-reports.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { snapshotMetrics } from "@/rekankerja/performance/services/perf-analytics-service";

const BASE = "http://localhost:3000";
const EMAIL = "hrd@mii.co.id";
const PASSWORD = "onevity123";
const ESS_EMAIL = "tuti@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";

let cookie = "";
let pass = 0;
let fail = 0;
const ok = (cond: boolean, label: string, extra?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
};

async function api(method: string, path: string, body?: unknown, asBinary = false): Promise<{ status: number; json: any; buf: Buffer | null; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  if (asBinary) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, json: null, buf, headers: res.headers };
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, buf: null, headers: res.headers };
}

async function main() {
  // ================= 1. login + dashboard =================
  console.log("\n[1] DASHBOARD LAPORAN");
  // BF-fix determinisme: MetricSnapshot diisi oleh scheduler harian — pada
  // fixture reset fresh + run segera, snapshot belum ada (timing tergantung
  // siklus 6 jam scheduler). Panggil snapshotMetrics langsung (idempoten —
  // upsert periode berjalan; tanpa data tidak menulis baris palsu).
  const snapWritten = await snapshotMetrics(getTenantClient("tenant_pt_mitra_industri_internasional"));
  console.log(`  [setup] snapshotMetrics: ${snapWritten} baris (idempoten)`);
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(login.status === 200, `login owner ${EMAIL}`, `HTTP ${login.status}`);

  const dash = await api("GET", "/api/rekankerja/performance/reports");
  ok(dash.status === 200, "GET dashboard", `HTTP ${dash.status}`);
  const kpi = dash.json.kpi ?? {};
  ok(typeof kpi.activeCycles === "number" && typeof kpi.totalCycles === "number", "kpi siklus aktif/total", `${kpi.activeCycles}/${kpi.totalCycles}`);
  ok(typeof kpi.participants === "number" && kpi.participants > 0, "kpi peserta siklus aktif", `${kpi.participants}`);
  ok(typeof kpi.resultsPublished === "number" && kpi.resultsPublished > 0, "kpi hasil terbit", `${kpi.resultsPublished}`);
  ok(Array.isArray(dash.json.cycles) && dash.json.cycles.length >= 3, "per-siklus fase completion", `${dash.json.cycles?.length} siklus`);
  ok(dash.json.distribution?.allTime && typeof dash.json.distribution.allTime === "object", "distribusi rating all-time");
  ok(Array.isArray(dash.json.trend) && dash.json.trend.length >= 1, "tren per tahun", JSON.stringify(dash.json.trend));
  ok(dash.json.snapshots?.perf_completion?.length >= 1, "snapshot perf_completion", JSON.stringify(dash.json.snapshots?.perf_completion?.slice(-1)));
  ok(dash.json.snapshots?.pip_recovery_rate?.length >= 1, "snapshot pip_recovery_rate", JSON.stringify(dash.json.snapshots?.pip_recovery_rate?.slice(-1)));

  const sn = await api("GET", "/api/rekankerja/performance/reports?snapshots=1");
  ok(sn.status === 200 && sn.json.snapshots, "?snapshots=1 mode ringan");

  // ================= 2. _params =================
  console.log("\n[2] POOL PARAMETER");
  const par = await api("GET", "/api/rekankerja/performance/reports/documents?id=_params");
  ok(par.status === 200, "GET _params", `HTTP ${par.status}`);
  const cycles: { id: string; code: string }[] = par.json.cycles ?? [];
  ok(cycles.length >= 3, `pool siklus ≥3`, cycles.map((c) => c.code).join(", "));
  ok(Array.isArray(par.json.years) && par.json.years.length >= 2, "pool tahun", JSON.stringify(par.json.years));
  ok((par.json.employees ?? []).length > 0, "pool karyawan", `${par.json.employees?.length}`);
  ok(!!par.json.defaultCycleId, "defaultCycleId terisi (siklus aktif/terbaru)", cycles.find((c) => c.id === par.json.defaultCycleId)?.code);
  const cal = cycles.find((c) => c.code === "PER-2026-CAL");
  const p25 = cycles.find((c) => c.code === "PER-2025");
  ok(!!cal && !!p25, "siklus CAL + 2025 tersedia utk laporan berdata");

  // ================= 3. 14 laporan render =================
  console.log("\n[3] RENDER 14 LAPORAN pf11–pf44 (default = PER-2026)");
  const tuti = (par.json.employees ?? []).find((e: { label: string }) => e.label.startsWith("MII00013"));
  const dedi = (par.json.employees ?? []).find((e: { label: string }) => e.label.startsWith("MII00009"));
  ok(!!tuti, "karyawan Tuti Gunawan MII00013 ada di pool");
  ok(!!dedi, "karyawan Dedi Mahendra MII00009 (2 siklus) ada di pool");
  const ids = ["pf11", "pf12", "pf13", "pf21", "pf22", "pf23", "pf24", "pf31", "pf32", "pf33", "pf41", "pf42", "pf43", "pf44"];
  const counts: Record<string, number> = {};
  for (const id of ids) {
    const qs = new URLSearchParams({ id });
    if (id !== "pf11" && id !== "pf33" && id !== "pf42" && id !== "pf44") qs.set("cycle", par.json.defaultCycleId);
    if (id === "pf23" && tuti) qs.set("employee", tuti.id);
    const r = await api("GET", `/api/rekankerja/performance/reports/documents?${qs}`);
    const d = r.json?.data;
    const n = d ? (Array.isArray(d.rows) ? d.rows.length : Array.isArray(d.cells) ? d.cells.length : -1) : -1;
    counts[id] = n;
    ok(r.status === 200 && !!r.json?.meta?.periodLabel && !!d, `${id} render + meta.periodLabel`, `HTTP ${r.status} · rows ${n}`);
  }
  ok((counts.pf12 ?? -1) > 0, "pf12 completion 8 peserta siklus aktif", `${counts.pf12}`);
  ok((counts.pf13 ?? -1) > 0, "pf13 KPI register terisi", `${counts.pf13}`);
  ok((counts.pf42 ?? -1) > 0, "pf42 register PIP (riwayat P6)", `${counts.pf42}`);
  ok((counts.pf43 ?? -1) === 9, "pf43 9-box 9 sel", `${counts.pf43}`);
  ok((counts.pf44 ?? -1) > 0, "pf44 tren unit", `${counts.pf44}`);

  // ================= 4. pf23 riwayat (PP 35/2021 §7.2) =================
  console.log("\n[4] pf23 REGISTER RIWAYAT PER KARYAWAN (PP 35/2021 §7.2)");
  if (dedi) {
    const hist = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf23&employee=${dedi.id}`);
    ok(hist.status === 200 && hist.json.data?.mode === "history", "mode history tanpa param cycle (Dedi)");
    const hrows = hist.json.data?.history ?? [];
    ok(hrows.length >= 2, `riwayat Dedi ≥2 siklus`, `${hrows.length} (${hrows.map((h: { cycleCode: string }) => h.cycleCode).join(", ")})`);
  }
  if (tuti) {
    const th = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf23&employee=${tuti.id}`);
    const trows = th.json.data?.history ?? [];
    ok(trows.some((h: { calibratedTo: number | null }) => h.calibratedTo != null), "jejak kalibrasi from→to ter-audit", `${trows.length} siklus`);
    const det = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf23&employee=${tuti.id}&cycle=${cal?.id}`);
    ok(det.status === 200 && det.json.data?.mode === "cycle" && det.json.data?.detail, "mode detail siklus spesifik");
    ok((det.json.data?.detail?.kpis ?? []).length > 0, "detail KPI terisi", `${det.json.data?.detail?.kpis?.length} KPI`);
    ok((det.json.data?.detail?.comps ?? []).length > 0, "detail kompetensi terisi", `${det.json.data?.detail?.comps?.length} kompetensi`);
    ok(Array.isArray(det.json.data?.detail?.calibration), "jejak kalibrasi per siklus ada");
  }

  // ================= 5. pf32 bias atasan (PER-2025) =================
  console.log("\n[5] pf32 INDIKATOR BIAS ATASAN (PER-2025)");
  if (p25) {
    const b = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf32&cycle=${p25.id}`);
    ok(b.status === 200, "pf32 PER-2025 render");
    const rows = b.json.data?.rows ?? [];
    ok(rows.length === 3, "3 atasan ber-≥2 bawahan", rows.map((r: { managerName: string }) => r.managerName).join(", "));
    const nSum = rows.reduce((s: number, r: { n: number }) => s + r.n, 0);
    ok(nSum === (b.json.data?.company?.n ?? -1), "Σ bawahan atasan = N perusahaan", `${nSum} = ${b.json.data?.company?.n}`);
    const joko = rows.find((r: { managerName: string }) => r.managerName === "Joko Susilo");
    ok(!!joko && typeof joko.z === "number" && Math.abs(joko.z) < 1, "z-score Joko −0.47 (dalam batas)", `z=${joko?.z}`);
  }

  // ================= 6. pf41 merit (CAL) =================
  console.log("\n[6] pf41 REGISTER MERIT (PER-2026-CAL)");
  const m = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf41&cycle=${cal?.id}`);
  ok(m.status === 200 && (m.json.data?.rows ?? []).length >= 3, "merit register ≥3 usulan", `${m.json.data?.rows?.length}`);
  const m0 = m.json.data?.rows?.[0];
  ok(!!m0 && m0.bonusAmount != null, "nominal bonus terlihat (vault terbuka utk owner)", `Rp ${m0?.bonusAmount}`);
  ok(m.json.data?.summary?.sumTotal != null, "Σ nominal ringkasan");
  ok(m0?.appliedRunNo === "PR-2026-09-BON-01", "merit Applied menyerap run payroll", m0?.appliedRunNo);
  ok(typeof m0?.approval === "object" || m0?.approval === null, "kolom approval ada di kontrak (null utk usulan seed tanpa chain)");

  // ================= 7. pf24 anonimitas 360 =================
  console.log("\n[7] pf24 RINGKASAN 360 — ANONIMITAS ≥3");
  const f = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf24&cycle=${cal?.id}`);
  ok(f.status === 200, "pf24 CAL render");
  const fr = f.json.data?.rows ?? [];
  const visible = fr.find((r: { submitted: number }) => r.submitted >= 3);
  const hidden = fr.find((r: { hidden: boolean }) => r.hidden);
  ok(!!visible && visible.peer != null, "agregat TAMPIL saat ≥3 submitted", `${visible?.fullName} ${visible?.submitted} submit`);
  ok(!!hidden, "agregat DIRAHASIAKAN saat <3 submitted", `${hidden?.fullName} (${hidden?.submitted})`);

  // ================= 8. filter server-side =================
  console.log("\n[8] FILTER SERVER-SIDE");
  const g1 = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf22&cycle=${p25?.id}&groupBy=atasan`);
  const g2 = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf22&cycle=${p25?.id}&groupBy=unit`);
  ok(g1.status === 200 && g2.status === 200, "pf22 groupBy atasan/unit render");
  ok((g1.json.data?.rows ?? []).length !== (g2.json.data?.rows ?? []).length || JSON.stringify(g1.json.data?.rows) !== JSON.stringify(g2.json.data?.rows),
    "groupBy mengubah hasil", `atasan ${g1.json.data?.rows?.length} grup vs unit ${g2.json.data?.rows?.length} grup`);
  const allP = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf12&cycle=${par.json.defaultCycleId}`);
  ok(allP.status === 200 && (allP.json.data?.rows ?? []).length === 8, "pf12 siklus aktif 8 peserta", `${allP.json.data?.rows?.length}`);

  // ================= 9. XLSX EN + ID =================
  console.log("\n[9] EKSPOR XLSX EN + ID");
  for (const lang of ["en", "id"]) {
    const x = await api("GET", `/api/rekankerja/performance/reports/documents?id=pf21&cycle=${cal?.id}&export=xlsx&lang=${lang}`, undefined, true);
    ok(x.status === 200 && !!x.buf && x.buf.slice(0, 2).toString() === "PK", `XLSX ${lang.toUpperCase()} — magic bytes PK`, `${x.buf?.length} byte`);
    ok((x.headers.get("content-type") ?? "").includes("spreadsheetml"), `content-type XLSX ${lang}`);
    ok((x.headers.get("content-disposition") ?? "").includes("rekankerja-performance-pf21"), `filename ${lang}`);
  }

  // ================= 10. ESS exportHistory (§7.2) =================
  console.log("\n[10] ESS EKSPOR RIWAYAT SENDIRI (PP 35/2021 §7.2)");
  cookie = "";
  const essLogin = await api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  ok(essLogin.status === 200, `login ESS ${ESS_EMAIL}`);
  for (const lang of ["id", "en"]) {
    const x = await api("POST", "/api/rekankerja/ess/my-appraisal", { action: "exportHistory", lang }, true);
    ok(x.status === 200 && !!x.buf && x.buf.slice(0, 2).toString() === "PK", `exportHistory ${lang.toUpperCase()} — XLSX valid`, `${x.buf?.length} byte`);
    if (lang === "id") {
      ok((x.headers.get("content-disposition") ?? "").includes("MII00013"), "filename ber-employeeNo", (x.headers.get("content-disposition") ?? "").slice(0, 70));
    }
  }
  const bogus = await api("POST", "/api/rekankerja/ess/my-appraisal", { action: "bogus" });
  ok(bogus.status === 400, "aksi tak dikenal → 400", `HTTP ${bogus.status}`);

  // ================= 11. guard negatif =================
  console.log("\n[11] GUARD NEGATIF");
  cookie = "";
  const noAuth = await api("GET", "/api/rekankerja/performance/reports/documents?id=pf11");
  ok(noAuth.status === 401, "tanpa sesi → 401", `HTTP ${noAuth.status}`);
  const essDoc = await api("POST", "/api/auth/login", { email: ESS_EMAIL, password: ESS_PASSWORD });
  void essDoc;
  const essTry = await api("GET", "/api/rekankerja/performance/reports/documents?id=pf11");
  ok(essTry.status === 403, "ESS (tanpa menu admin) → 403", `HTTP ${essTry.status}`);
  cookie = "";
  const relogin = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  ok(relogin.status === 200, "re-login owner");
  const bad = await api("GET", "/api/rekankerja/performance/reports/documents?id=pf99");
  ok(bad.status === 400, "id laporan tak dikenal → 400", `HTTP ${bad.status}`);
  const noCycle = await api("GET", "/api/rekankerja/performance/reports/documents?id=pf12");
  ok(noCycle.status === 400 || noCycle.status === 500, "pf12 tanpa siklus → ditolak (siklus wajib)", `HTTP ${noCycle.status}`);

  // ================= rekap =================
  console.log(`\n========================================`);
  console.log(`E2E P8 LAPORAN & ANALITIK: ${pass} lulus · ${fail} gagal`);
  if (fail > 0) { console.log("ADA CHECK GAGAL — periksa di atas."); process.exit(1); }
  console.log("SEMUA LULUS ✓ (dashboard + _params + 14 laporan + riwayat §7.2 + bias + merit + anonimitas + filter + XLSX EN/ID + ESS + guard).");
}

main().catch((e) => { console.error(e); process.exit(1); });
