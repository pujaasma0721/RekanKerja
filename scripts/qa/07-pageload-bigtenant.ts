// SUITE 07 — PAGE-LOAD BENCHMARK TENANT BESAR (5.000 karyawan) =================
// Uji "kecepatan per page load, query besar-besar + performance system" via
// aplikasi NYATA (dev server :3000, tenant bench101 — schema tenant_bench_101
// di PG live 5432, 597k baris, enkripsi field asli).
//
// Fase:
//   cold  — 1 hit pertama per endpoint (server baru direstart: kompilasi route
//           + spin-up Prisma client tenant + koneksi awal);
//   warm  — N hit sekuensial per endpoint → p50/p95/p99;
//   paced — 8 VU browsing 30 dtk (think-time 150–450ms, mix realistis bobot);
//   burst — 12 VU tanpa think-time 15 dtk (langit-langit throughput);
//   sys   — sampling /proc tiap 2 dtk selama paced+burst: CPU/RSS next-server
//           + postgres(5432), loadavg, MemAvailable + koneksi pg_stat_activity.
//
// Jalankan: bun scripts/qa/07-pageload-bigtenant.ts  (dev server HARUS fresh:
// restart dulu supaya fase cold akurat).
// Hasil: qa/pageload-bigtenant-results.json
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { loginAs, readEnvVar } from "./helpers";

export {};

const BASE = "http://127.0.0.1:3000";
const CREDS = { email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" };
// BENCH_MODE=part2 — di server fresh TANPA fase cold (cold sudah diukur di run penuh):
// warm hanya endpoint ringan-sedang (2 endpoint [BERAT] dikecualikan — payload 9MB +
// full-scan 6-9s adalah bom memori di mesin 4GB; angka mereka dari replay terpisah),
// lalu paced+burst. Hasil → *-part2.json.
const MODE = process.env.BENCH_MODE ?? "full";

interface Ep {
  name: string;
  path: string;
  weight?: number; // frekuensi di fase paced (0 = hanya cold+warm)
  warmN?: number; // override jumlah iterasi warm
  burst?: boolean; // ikut fase burst
}

// Halaman + endpoint utama aplikasi (payload nyata, query besar-besar tenant 5.000 karyawan)
const EPS: Ep[] = [
  { name: "auth/me (shell tiap page)", path: "/api/auth/me", weight: 2, burst: true },
  { name: "directory-p1 (50/baris)", path: "/api/rekankerja/employees?limit=50&offset=0", weight: 3, burst: true },
  { name: "directory-search q=Sant", path: "/api/rekankerja/employees?q=Sant&limit=25", weight: 3, burst: true },
  { name: "directory-deep offset=4950", path: "/api/rekankerja/employees?limit=50&offset=4950", burst: true },
  { name: "directory-sort-salary [BERAT]", path: "/api/rekankerja/employees?sortBy=baseSalary&sortDir=desc", weight: 1, warmN: 3 },
  { name: "attendance-overview KPI bulan", path: "/api/rekankerja/attendance/overview", weight: 2, burst: true },
  { name: "payroll-runs list", path: "/api/rekankerja/payroll-runs", weight: 2, burst: true },
  { name: "payroll-run-detail run2 [BERAT 9MB]", path: "/api/rekankerja/payroll-run?id=run2", weight: 1, warmN: 3 },
  { name: "ess-attendance rekap pribadi", path: "/api/rekankerja/ess/attendance", weight: 2, burst: true },
  { name: "ess-notifications", path: "/api/rekankerja/ess/notifications", weight: 2, burst: true },
  { name: "ess-payslips", path: "/api/rekankerja/ess/payslips", burst: true },
  { name: "dashboard-hr agregat", path: "/api/rekankerja/dashboard", weight: 2, burst: true },
  { name: "employee-options dropdown shell", path: "/api/rekankerja/employee-options", weight: 1, burst: true },
];

const RUN = MODE === "part2" ? EPS.filter((e) => !e.name.includes("[BERAT")) : EPS;
const OUT = path.resolve(
  process.cwd(),
  "qa",
  MODE === "part2" ? "pageload-bigtenant-part2.json" : "pageload-bigtenant-results.json",
);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}
function stats(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    p50: +(pct(s, 50).toFixed(1)),
    p95: +(pct(s, 95).toFixed(1)),
    p99: +(pct(s, 99).toFixed(1)),
    max: +(s[s.length - 1]?.toFixed(1) ?? 0),
    avg: +(sum / (s.length || 1)).toFixed(1),
  };
}

// ===================== sampling system (/proc) =====================
const CLK_TCK = 100;
function pidsOf(pattern: string): number[] {
  try {
    const r = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
    return r.stdout
      .split("\n")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x) && x > 0);
  } catch {
    return [];
  }
}
interface ProcSample {
  pids: number;
  rssMB: number;
  cpuPct1Core: number; // % dari SATU core (0–200 di mesin 2 core)
}
function sampleProcs(pattern: string, prev?: { t: number; ticks: number; rss: number }): { now: ProcSample; raw: { t: number; ticks: number; rss: number } } {
  const pids = pidsOf(pattern);
  let ticks = 0;
  let rss = 0;
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const after = stat.split(") ")[1] ?? "";
      const f = after.split(" ");
      ticks += Number(f[11]) + Number(f[12]); // utime + stime (field 14/15)
      const st = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const m = st.match(/VmRSS:\s+(\d+)/);
      if (m) rss += Number(m[1]);
    } catch {}
  }
  const t = performance.now();
  let cpu = 0;
  if (prev) {
    const dt = (t - prev.t) / 1000;
    if (dt > 0) cpu = ((ticks - prev.ticks) / CLK_TCK / dt) * 100;
  }
  return { now: { pids: pids.length, rssMB: +(rss / 1024).toFixed(0), cpuPct1Core: +cpu.toFixed(0) }, raw: { t, ticks, rss } };
}
function memAvailMB(): number {
  try {
    const m = fs.readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/);
    return m ? Math.round(Number(m[1]) / 1024) : -1;
  } catch {
    return -1;
  }
}

// ===================== HTTP helper =====================
async function hit(cookie: string, ep: string): Promise<{ ms: number; status: number; bytes: number; err?: string }> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${BASE}${ep}`, { headers: { cookie } });
    const body = await r.text();
    const ms = performance.now() - t0;
    return { ms, status: r.status, bytes: Buffer.byteLength(body), err: r.status !== 200 ? body.slice(0, 180) : undefined };
  } catch (e) {
    return { ms: performance.now() - t0, status: 0, bytes: 0, err: (e as Error).message.slice(0, 180) };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const machine = { cpus: os.cpus().length, ramMB: Math.round(os.totalmem() / 1048576) };
  log(`[meta] mesin ${machine.cpus} CPU / ${machine.ramMB}MB — login ${CREDS.email}`);

  const session = await loginAs(CREDS);
  log(`[login] OK — tenant ${session.tenant?.slug}`);

  // ================= fase COLD (1 hit per endpoint, urut) =================
  const cold: Record<string, { ms: number; bytes: number; status: number; err?: string }> = {};
  if (MODE === "part2") {
    log("[cold] DILEWATI (part2 — sudah diukur di run penuh)");
  } else {
    log("[cold] 1 hit pertama per endpoint (kompilasi route + spin-up Prisma client) …");
    for (const ep of RUN) {
      const r = await hit(session.cookie, ep.path);
      cold[ep.name] = { ms: +r.ms.toFixed(1), bytes: r.bytes, status: r.status, err: r.err };
      log(`  ${String(r.status).padStart(3)} ${r.ms.toFixed(0).padStart(6)}ms ${(r.bytes / 1024).toFixed(0).padStart(6)}KB  ${ep.name}`);
    }
  }

  // ================= fase WARM (sekuensial per endpoint) =================
  const warm: Record<string, unknown> = {};
  log("[warm] hit sekuensial per endpoint …");
  for (const ep of RUN) {
    const N = ep.warmN ?? 20;
    const lat: number[] = [];
    let bytes = 0;
    let bad = 0;
    let firstErr = "";
    for (let i = 0; i < N; i++) {
      const r = await hit(session.cookie, ep.path);
      if (r.status !== 200) {
        bad++;
        if (!firstErr) firstErr = `HTTP ${r.status}: ${r.err ?? ""}`;
      }
      lat.push(r.ms);
      bytes += r.bytes;
    }
    warm[ep.name] = { ...stats(lat), bytesAvg: Math.round(bytes / N / 1024), errors: bad, ...(firstErr ? { firstErr: firstErr.slice(0, 220) } : {}) };
    const s = warm[ep.name] as { p50: number; p95: number };
    log(`  p50 ${String(s.p50).padStart(7)}ms  p95 ${String(s.p95).padStart(7)}ms  ${ep.name}`);
  }

  // ================= sampling system (interval 2 dtk selama paced+burst) =====
  const sysSamples: Array<Record<string, number | string>> = [];
  let nextRaw: { t: number; ticks: number; rss: number } | undefined;
  let pgRaw: { t: number; ticks: number; rss: number } | undefined;
  let sampling = false;
  let stopSampler = false;
  let samplerResolve: (() => void) | null = null;
  const samplerFinished = new Promise<void>((res) => (samplerResolve = res));
  const sampler = (async () => {
    while (true) {
      if (stopSampler) {
        samplerResolve!();
        return;
      }
      if (!sampling) {
        await sleep(200);
        continue;
      }
      const n = sampleProcs("next dev|next-server", nextRaw);
      nextRaw = n.raw;
      const p = sampleProcs("mini-services/postgres", pgRaw);
      pgRaw = p.raw;
      sysSamples.push({
        t: +((performance.now() - tConc0) / 1000).toFixed(1),
        nextRssMB: n.now.rssMB,
        nextCpuPct: n.now.cpuPct1Core,
        pgRssMB: p.now.rssMB,
        pgCpuPct: p.now.cpuPct1Core,
        load1: +os.loadavg()[0].toFixed(2),
        memAvailMB: memAvailMB(),
      });
      await sleep(2000);
    }
  })();

  // koneksi PG di awal/akhir (satu koneksi admin singkat)
  const pgUrl = readEnvVar("TENANT_DB_BASE_URL") ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
  async function pgConns(): Promise<number> {
    try {
      const c = new Client({ connectionString: pgUrl });
      await c.connect();
      const r = await c.query("SELECT COUNT(*)::int c FROM pg_stat_activity");
      await c.end();
      return r.rows[0].c;
    } catch {
      return -1;
    }
  }

  // mix berbobot utk fase paced/burst
  function mixEps(): Ep[] {
    const out: Ep[] = [];
    for (const ep of RUN) for (let k = 0; k < (ep.weight ?? 0); k++) out.push(ep);
    return out;
  }

  // ================= fase PACED (8 VU × 30 dtk, think-time) =================
  const PACED_VUS = 8;
  const PACED_SEC = 30;
  let tConc0 = performance.now();
  const pacedLat: Record<string, number[]> = {};
  const pacedErr: Record<string, string[]> = {};
  let pacedTotal = 0;
  const connsStart = await pgConns();
  log(`[paced] ${PACED_VUS} VU × ${PACED_SEC}s (think-time 150–450ms), koneksi PG=${connsStart}`);
  sampling = true;
  await Promise.all(
    Array.from({ length: PACED_VUS }, async () => {
      const mix = mixEps();
      while (performance.now() - tConc0 < PACED_SEC * 1000) {
        const ep = mix[Math.floor(Math.random() * mix.length)];
        const r = await hit(session.cookie, ep.path);
        (pacedLat[ep.name] ??= []).push(r.ms);
        pacedTotal++;
        if (r.status !== 200) (pacedErr[ep.name] ??= []).push(`HTTP ${r.status}: ${r.err ?? ""}`);
        await sleep(150 + Math.floor(Math.random() * 300));
      }
    }),
  );
  const pacedWall = (performance.now() - tConc0) / 1000;

  // ================= fase BURST (12 VU tanpa think-time, 15 dtk) ============
  const BURST_VUS = 12;
  const BURST_SEC = 15;
  const burstLat: Record<string, number[]> = {};
  let burstTotal = 0;
  const burstErr: Record<string, string[]> = [];
  const burstMix = EPS.filter((e) => e.burst);
  log(`[burst] ${BURST_VUS} VU × ${BURST_SEC}s TANPA think-time (endpoint ringan-sedang) …`);
  const tBurst0 = performance.now();
  await Promise.all(
    Array.from({ length: BURST_VUS }, async () => {
      while (performance.now() - tBurst0 < BURST_SEC * 1000) {
        const ep = burstMix[Math.floor(Math.random() * burstMix.length)];
        const r = await hit(session.cookie, ep.path);
        (burstLat[ep.name] ??= []).push(r.ms);
        burstTotal++;
        if (r.status !== 200) (burstErr[ep.name] ??= []).push(`HTTP ${r.status}: ${r.err ?? ""}`);
      }
    }),
  );
  sampling = false;
  const burstWall = (performance.now() - tBurst0) / 1000;
  const connsEnd = await pgConns();
  await sleep(2500); // biarkan sampler terakhir masuk
  stopSampler = true;
  await samplerFinished;

  // ================= rangkuman =================
  const pacedPerEp: Record<string, ReturnType<typeof stats> & { errors: number }> = {};
  for (const [k, v] of Object.entries(pacedLat)) pacedPerEp[k] = { ...stats(v), errors: pacedErr[k]?.length ?? 0 };
  const burstPerEp: Record<string, ReturnType<typeof stats> & { errors: number }> = {};
  for (const [k, v] of Object.entries(burstLat)) burstPerEp[k] = { ...stats(v), errors: burstErr[k]?.length ?? 0 };

  const allPaced = Object.values(pacedLat).flat();
  const allBurst = Object.values(burstLat).flat();
  const result = {
    meta: {
      date: new Date().toISOString(),
      machine,
      tenant: "bench101 (tenant_bench_101, 5.000 karyawan, ±597k baris, 212MB)",
      note: "dev server Next.js 16 (Turbopack) di-restart tepat sebelum run — cold = kompilasi+spin-up; warm = perilaku steady",
    },
    cold,
    warm,
    paced: {
      vus: PACED_VUS,
      durationSec: +pacedWall.toFixed(1),
      thinkTimeMs: "150-450",
      totalRequests: pacedTotal,
      rps: +(pacedTotal / pacedWall).toFixed(1),
      errors: Object.values(pacedErr).reduce((a, b) => a + b.length, 0),
      latencyMs: stats(allPaced),
      perEndpoint: pacedPerEp,
      sampleErrors: Object.entries(pacedErr).slice(0, 3),
    },
    burst: {
      vus: BURST_VUS,
      durationSec: +burstWall.toFixed(1),
      totalRequests: burstTotal,
      rps: +(burstTotal / burstWall).toFixed(1),
      errors: Object.values(burstErr).reduce((a, b) => a + b.length, 0),
      latencyMs: stats(allBurst),
      perEndpoint: burstPerEp,
    },
    system: {
      pgConnections: { start: connsStart, end: connsEnd },
      samples: sysSamples,
      peak: {
        nextRssMB: Math.max(...sysSamples.map((s) => s.nextRssMB as number)),
        nextCpuPct1Core: Math.max(...sysSamples.map((s) => s.nextCpuPct as number)),
        pgRssMB: Math.max(...sysSamples.map((s) => s.pgRssMB as number)),
        pgCpuPct1Core: Math.max(...sysSamples.map((s) => s.pgCpuPct as number)),
        load1: Math.max(...sysSamples.map((s) => s.load1 as number)),
        memAvailMinMB: Math.min(...sysSamples.map((s) => s.memAvailMB as number)),
      },
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log(`→ ${OUT} tertulis`);

  console.log("\n================ RINGKASAN PAGE-LOAD (tenant 5.000 karyawan) ================");
  console.log("endpoint                                      |   cold |    p50 |    p95 |  bytes");
  for (const ep of RUN) {
    const c = cold[ep.name] ?? { ms: -1 };
    const w = warm[ep.name] as { p50: number; p95: number; bytesAvg: number };
    console.log(
      `${ep.name.padEnd(45)} | ${String(Math.round(c.ms)).padStart(6)} | ${String(Math.round(w.p50)).padStart(6)} | ${String(Math.round(w.p95)).padStart(6)} | ${String(w.bytesAvg).padStart(5)}KB`,
    );
  }
  console.log(`\nPACED 8VU: ${pacedTotal} req / ${pacedWall.toFixed(0)}s = ${(pacedTotal / pacedWall).toFixed(1)} req/s | error ${result.paced.errors} | latensi agregat p50 ${result.paced.latencyMs.p50}ms p95 ${result.paced.latencyMs.p95}ms`);
  console.log(`BURST 12VU: ${burstTotal} req / ${burstWall.toFixed(0)}s = ${(burstTotal / burstWall).toFixed(1)} req/s | error ${result.burst.errors} | latensi agregat p50 ${result.burst.latencyMs.p50}ms p95 ${result.burst.latencyMs.p95}ms`);
  console.log(`SYSTEM peak: next RSS ${result.system.peak.nextRssMB}MB CPU ${result.system.peak.nextCpuPct1Core}%/core | PG RSS ${result.system.peak.pgRssMB}MB CPU ${result.system.peak.pgCpuPct1Core}%/core | load1 ${result.system.peak.load1} | MemAvail min ${result.system.peak.memAvailMinMB}MB | PG conns ${connsStart}→${connsEnd}`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
