// Ukur memori per tenant-client (Node-side) + per koneksi (PG-side) secara empiris.
// Membuat 30 schema sementara berisi tabel "Employee" kosong, lalu 30 PrismaClient
// (pola identik produksi: ?schema=X&connection_limit=2&pool_timeout=10).
import { Client } from "pg";
import { PrismaClient } from "../src/generated/tenant";

const base = process.env.TENANT_DB_BASE_URL || process.env.TENANT_DB_URL!.replace(/\/[^/]+$/, "/onevity");
const N = 30;
const schemas = Array.from({ length: N }, (_, i) => `specs_mem_${String(i + 1).padStart(2, "0")}`);

function rss(): number {
  return Number(require("node:fs").readFileSync("/proc/self/status", "utf8").match(/VmRSS:\s+(\d+)/)![1]);
}
async function pgBackends(admin: Client): Promise<{ n: number; rssMB: number }> {
  const r = await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname='onevity'`);
  const procs = require("node:child_process").execSync(
    `ps -o rss= -C postgres --no-headers`, { encoding: "utf8" }
  ).trim().split("\n").map(Number).filter(Boolean);
  return { n: r.rows[0].n, rssMB: procs.reduce((a: number, b: number) => a + b, 0) / 1024 };
}

async function main() {
  const admin = new Client({ connectionString: process.env.TENANT_DB_URL });
  await admin.connect();
  await admin.query(`SELECT set_config('search_path','public',false)`);
  for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE; CREATE SCHEMA ${s}; CREATE TABLE ${s}."Employee" (id TEXT PRIMARY KEY);`);
  const before = { node: rss(), pg: await pgBackends(admin) };
  console.log(`BEFORE : node RSS ${before.node} KB | PG total RSS ${before.pg.rssMB.toFixed(0)} MB (${before.pg.n} backends)`);

  const clients: any[] = [];
  const marks: number[] = [before.node];
  for (const s of schemas) {
    const c = new PrismaClient({ datasources: { db: { url: `${base}?schema=${s}&connection_limit=2&pool_timeout=10` } } });
    await c.employee.count(); // paksa buka pool 2 koneksi + engine
    clients.push(c);
    marks.push(rss());
  }
  const after = { node: rss(), pg: await pgBackends(admin) };
  console.log(`AFTER  : node RSS ${after.node} KB | PG total RSS ${after.pg.rssMB.toFixed(0)} MB (${after.pg.n} backends)`);

  // regresi linear RSS vs jumlah client aktif (KB per client)
  const xs = marks.map((_, i) => i); const ys = marks;
  const n = xs.length, sx = xs.reduce((a, b) => a + b), sy = ys.reduce((a, b) => a + b);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i]!), sxx = xs.reduce((a, x) => a + x * x);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  console.log(`\nNODE-SIDE : ${(slope / 1024).toFixed(2)} MB per tenant-client (regresi ${n} titik, R=${correlation(xs, ys).toFixed(4)})`);
  const dBackends = after.pg.n - before.pg.n, dPgMB = after.pg.rssMB - before.pg.rssMB;
  console.log(`PG-SIDE   : ${dBackends} koneksi baru (+${dPgMB.toFixed(0)} MB) = ${(dPgMB / Math.max(dBackends, 1)).toFixed(2)} MB per koneksi backend`);

  for (const c of clients) await c.$disconnect();
  await new Promise(r => setTimeout(r, 1500));
  const post = await pgBackends(admin);
  console.log(`DISCONNECT: node RSS ${rss()} KB | PG total RSS ${post.rssMB.toFixed(0)} MB (${post.n} backends)`);
  for (const s of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  await admin.end();
  function correlation(a: number[], b: number[]) {
    const ma = a.reduce((x, y) => x + y) / a.length, mb2 = b.reduce((x, y) => x + y) / b.length;
    const num = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb2), 0);
    const da = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0)), dbb = Math.sqrt(b.reduce((s, x) => s + (x - mb2) ** 2, 0));
    return num / (da * dbb);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
