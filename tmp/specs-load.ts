// Load test utk sizing server: 4 tenant (MII/Cahaya/Sentra/BENCH101 5000-emp),
// endpoint ringan+berat (termasuk F1 payroll detail & F2 sort gaji),
// staged VU 8→16→24→32 + pengukuran bytes/down per tahap (basis bandwidth).
import { loginAs } from "../scripts/qa/helpers";
import { Client } from "pg";

const B = "http://127.0.0.1:3000";
interface Sample { ep: string; ms: number; status: number; bytes: number; tenant: string; }

// bobot meniru aplikasi nyata: banyak navigasi ringan + beberapa query berat
const EPS: { ep: string; w: number; label: string }[] = [
  { ep: "/api/auth/me", w: 18, label: "me" },
  { ep: "/api/rekankerja/employees?page=1&pageSize=100", w: 15, label: "employees" },
  { ep: "/api/rekankerja/dashboard", w: 22, label: "dashboard" },
  { ep: "/api/rekankerja/notifications", w: 15, label: "notifications" },
  { ep: "/api/rekankerja/payroll-runs", w: 10, label: "payroll-runs" },
  { ep: "/api/rekankerja/payroll-run?id=run2", w: 5, label: "payroll-detail[F1]" },
  { ep: "/api/rekankerja/employees?sortBy=baseSalary&sortDir=desc", w: 5, label: "salary-sort[F2]" },
  { ep: "/api/rekankerja/attendance/overview", w: 10, label: "attendance-ov" },
];
function pick() {
  const tot = EPS.reduce((a, e) => a + e.w, 0); let r = Math.random() * tot;
  for (const e of EPS) { r -= e.w; if (r <= 0) return e; }
  return EPS[0]!;
}
function pct(s: number[], p: number) { return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0; }

const sessions = [
  { s: await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" }), t: "mii" },
  { s: await loginAs({ email: "ayu@cahaya.id", password: "cahaya12345", preferSlug: "cahaya-digital-nusantara" }), t: "cahaya" },
  { s: await loginAs({ email: "bambang@sentra.co.id", password: "sentra12345", preferSlug: "sentra-logistik-prima" }), t: "sentra" },
  { s: await loginAs({ email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" }), t: "bench101" },
];
console.log("4 sesi tenant siap (mii/cahaya/sentra/bench101-5000emp)");

const admin = new Client({ connectionString: process.env.TENANT_DB_URL! });
await admin.connect();
async function dbPeak() {
  const r = await admin.query(`SELECT count(*)::int t, count(*) FILTER (WHERE state='active')::int a FROM pg_stat_activity`);
  return r.rows[0];
}

const all: Sample[] = [];
// warm-up (tidak dihitung)
await runStage("warmup", 5, 8000);
const stages = [["S8", 8, 15000], ["S16", 16, 15000], ["S24", 24, 15000], ["S32", 32, 15000]] as const;
const stageStats: any[] = [];
for (const [nm, vu, dur] of stages) {
  const before = all.length;
  const t0 = performance.now();
  await runStage(nm, vu, dur);
  const st = all.slice(before);
  const ms = performance.now() - t0;
  const lat = st.map(x => x.ms).sort((a, b) => a - b);
  const err = st.filter(x => x.status >= 500 || x.status < 0).length;
  const bytes = st.reduce((a, x) => a + x.bytes, 0);
  stageStats.push({ stage: nm, vu, reqs: st.length, rps: +(st.length / (ms / 1000)).toFixed(1), p50: pct(lat, 50), p95: pct(lat, 95), err,
    mbpsDown: +((bytes * 8) / (ms / 1000) / 1e6).toFixed(2), peakConn: (globalThis as any)["__pk_" + nm] });
  console.log(`${nm} VU=${vu}: ${st.length} req | ${stageStats[stageStats.length - 1].rps} req/s | p50 ${pct(lat, 50)}ms p95 ${pct(lat, 95)}ms | err ${err} | down ${(bytes / 1048576).toFixed(1)}MB = ${stageStats[stageStats.length - 1].mbpsDown} Mbps`);
}

console.log("\n== RINGKASAN ==");
console.log(JSON.stringify(stageStats, null, 1));
import fs from "node:fs";
fs.writeFileSync("tmp/specs-load.json", JSON.stringify({ generatedAt: new Date().toISOString(), stageStats }, null, 2));

async function runStage(label: string, vus: number, durMs: number) {
  console.log(`\n── Tahap ${label}: ${vus} VU, ${durMs / 1000}s (think-time 150-450ms)`);
  const stopAt = Date.now() + durMs;
  let pk = 0;
  const iv = setInterval(async () => { try { const d = await dbPeak(); pk = Math.max(pk, d.t); } catch {} }, 2000);
  await Promise.all(Array.from({ length: vus }, async (_, i) => {
    const ctx = sessions[i % sessions.length]!;
    while (Date.now() < stopAt) {
      const { ep } = pick();
      const t0 = performance.now();
      try {
        const res = await fetch(`${B}${ep}`, { headers: { cookie: ctx.s.cookie } });
        const buf = await res.arrayBuffer();
        all.push({ ep, ms: performance.now() - t0, status: res.status, bytes: buf.byteLength, tenant: ctx.t });
      } catch (e) {
        all.push({ ep, ms: performance.now() - t0, status: -1, bytes: 0, tenant: ctx.t });
        console.error(`  [conn-err] ${ctx.t} ${ep}`);
      }
      await new Promise(r => setTimeout(r, 150 + Math.random() * 300));
    }
  }));
  clearInterval(iv);
  await new Promise(r => setTimeout(r, 2100));
  (globalThis as any)["__pk_" + label] = pk;
  console.log(`  pg koneksi puncak: ${pk}/300`);
}
