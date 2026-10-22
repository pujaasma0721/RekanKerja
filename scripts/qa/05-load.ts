// SUITE 05 — PILAR 3b: Load Test Multi-Tenant (Bun harness) =================
// Target: PF-04, PF-05 pada QA-TEST-PLAN.md.
// Dijalankan: bun scripts/qa/05-load.ts  (dev server :3000 harus hidup)
//
// Mensimulasikan beban puncak lintas 3 tenant nyata (MII/Cahaya/Sentra) dengan
// campuran endpoint ringan→berat + sampling pg_stat_activity utk membuktikan
// pool koneksi stabil (jauh di bawah max_connections=100).
export {};

import fs from "node:fs";
import { loginAs, USERS, readEnvVar, type Session } from "./helpers";
import { Client } from "pg";

interface Sample {
  ep: string;
  ms: number;
  status: number;
  tenant: string;
}

const ENDPOINTS: { ep: string; weight: number; label: string }[] = [
  { ep: "/api/auth/me", weight: 20, label: "me" },
  { ep: "/api/rekankerja/companies", weight: 15, label: "companies" },
  { ep: "/api/rekankerja/employees?limit=50", weight: 20, label: "employees" },
  { ep: "/api/rekankerja/dashboard", weight: 30, label: "dashboard" },
  { ep: "/api/rekankerja/notifications", weight: 15, label: "notifications" },
];

function pickEndpoint(): { ep: string; label: string } {
  const total = ENDPOINTS.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  for (const e of ENDPOINTS) {
    r -= e.weight;
    if (r <= 0) return { ep: e.ep, label: e.label };
  }
  return { ep: ENDPOINTS[0]!.ep, label: ENDPOINTS[0]!.label };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function dbStats(): Promise<{ total: number; active: number }> {
  const c = new Client({ connectionString: readEnvVar("DATABASE_URL") });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'active')::int AS active FROM pg_stat_activity`,
    );
    return r.rows[0] ?? { total: 0, active: 0 };
  } finally {
    await c.end();
  }
}

async function runStage(
  label: string,
  vus: number,
  durationMs: number,
  sessions: { session: Session; tenant: string }[],
  samples: Sample[],
): Promise<void> {
  console.log(`\n── Tahap ${label}: ${vus} VU selama ${durationMs / 1000}s (think-time 150–450ms)`);
  const stopAt = Date.now() + durationMs;
  let dbPeak = { total: 0, active: 0 };
  const dbSampler = setInterval(async () => {
    try {
      const s = await dbStats();
      dbPeak = { total: Math.max(dbPeak.total, s.total), active: Math.max(dbPeak.active, s.active) };
    } catch { /* sampling best-effort */ }
  }, 2000);

  await Promise.all(
    Array.from({ length: vus }, async (_, i) => {
      const ctx = sessions[i % sessions.length]!;
      while (Date.now() < stopAt) {
        const { ep } = pickEndpoint();
        const t0 = performance.now();
        try {
          const res = await fetch(`http://127.0.0.1:3000${ep}`, { headers: { cookie: ctx.session.cookie } });
          samples.push({ ep, ms: performance.now() - t0, status: res.status, tenant: ctx.tenant });
          await res.arrayBuffer().catch(() => {}); // drain body
        } catch (e) {
          samples.push({ ep, ms: performance.now() - t0, status: -1, tenant: ctx.tenant });
          console.error(`  [conn-error] ${ctx.tenant} ${ep}: ${e instanceof Error ? e.message : "?"}`);
        }
        // F-07: think-time realistis — pengguna nyata tidak menembak tanpa jeda;
        // tanpa pacing beban berubah jadi connection-storm (bukan load test valid).
        await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));
      }
    }),
  );
  clearInterval(dbSampler);
  await new Promise((r) => setTimeout(r, 2100));
  console.log(`  pg_stat_activity puncak: total=${dbPeak.total} active=${dbPeak.active} (batas max_connections=100)`);
  (globalThis as Record<string, unknown>)[`__dbPeak_${label}`] = dbPeak;
}

function report(samples: Sample[], totalMs: number): void {
  console.log("\n================ LAPORAN LOAD TEST ================");
  const total = samples.length;
  const rps = total / (totalMs / 1000);
  const byEp = new Map<string, Sample[]>();
  for (const s of samples) byEp.set(s.ep, [...(byEp.get(s.ep) ?? []), s]);

  console.log(`Total request: ${total} · throughput: ${rps.toFixed(1)} req/s · durasi: ${(totalMs / 1000).toFixed(0)}s`);
  console.log("\nPer endpoint:");
  for (const [ep, list] of byEp) {
    const lat = list.map((x) => x.ms).sort((a, b) => a - b);
    const errors = list.filter((x) => x.status >= 500 || x.status < 0).length;
    const label = ENDPOINTS.find((e) => e.ep === ep)?.label ?? ep;
    console.log(
      `  ${label.padEnd(14)} n=${String(list.length).padStart(5)}  p50=${percentile(lat, 50).toFixed(0).padStart(5)}ms  p95=${percentile(lat, 95).toFixed(0).padStart(5)}ms  p99=${percentile(lat, 99).toFixed(0).padStart(6)}ms  max=${lat[lat.length - 1]!.toFixed(0).padStart(6)}ms  err5xx=${errors}`,
    );
  }
  const statusCounts = new Map<number, number>();
  for (const s of samples) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
  console.log(`\nDistribusi status: ${[...statusCounts.entries()].map(([k, v]) => `${k}×${v}`).join(" · ")}`);
  const errCount = samples.filter((s) => s.status >= 500 || s.status < 0).length;
  const errRate = total > 0 ? (errCount / total) * 100 : 100;
  console.log(`Error rate (5xx + conn): ${errRate.toFixed(2)}% (ambang PASS < 1%)`);
  const dash = byEp.get("/api/rekankerja/dashboard") ?? [];
  const dashLat = dash.map((x) => x.ms).sort((a, b) => a - b);
  const dashP95 = percentile(dashLat, 95);
  console.log(`Dashboard p95: ${dashP95.toFixed(0)}ms (ambang PASS < 1500ms)`);
  console.log(`\nVERDIKT: ${errRate < 1 && dashP95 < 1500 ? "✅ PASS (PF-04)" : "❌ PERLU INVESTIGASI"}`);

  // simpan JSON utk artefak
  const summary = {
    generatedAt: new Date().toISOString(),
    totalRequests: total,
    throughputRps: Number(rps.toFixed(1)),
    errorRatePct: Number(errRate.toFixed(2)),
    dashboardP95Ms: Number(dashP95.toFixed(0)),
    perEndpoint: [...byEp.entries()].map(([ep, list]) => {
      const lat = list.map((x) => x.ms).sort((a, b) => a - b);
      return {
        endpoint: ENDPOINTS.find((e) => e.ep === ep)?.label ?? ep,
        n: list.length,
        p50: Number(percentile(lat, 50).toFixed(0)),
        p95: Number(percentile(lat, 95).toFixed(0)),
        p99: Number(percentile(lat, 99).toFixed(0)),
        max: Number((lat[lat.length - 1] ?? 0).toFixed(0)),
      };
    }),
    statusDistribution: Object.fromEntries(statusCounts),
    dbPeak: (globalThis as Record<string, unknown>)["__dbPeak_S3"] ?? null,
  };
  fs.mkdirSync("qa", { recursive: true });
  fs.writeFileSync("qa/load-results.json", JSON.stringify(summary, null, 2));
  console.log("Hasil lengkap: qa/load-results.json");
}

// ============================ EKSEKUSI ============================
const t0 = Date.now();
console.log("Login 3 tenant (MII / Cahaya / Sentra)…");
const sessions = [
  { session: await loginAs(USERS.mii), tenant: "MII" },
  { session: await loginAs(USERS.cahaya), tenant: "Cahaya" },
  { session: await loginAs(USERS.sentra), tenant: "Sentra" },
];
console.log("Sesi siap: " + sessions.map((s) => `${s.tenant}(${s.session.tenant?.slug})`).join(" · "));

const samples: Sample[] = [];
// warm-up singkat (memicu lazy-compile Next bila ada route belum ter-compile)
await runStage("warmup", 5, 8000, sessions, samples);
samples.length = 0; // warm-up tidak dihitung
await runStage("S1", 10, 20000, sessions, samples);
await runStage("S2", 20, 20000, sessions, samples);
await runStage("S3", 40, 25000, sessions, samples);
report(samples, Date.now() - t0);
