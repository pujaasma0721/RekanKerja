// mini-services/postgres — Embedded PostgreSQL 17 untuk RekanKerja (multi-tenant schema-per-tenant)
// Idempotent: initdb (sekali) → start (jika mati) → pastikan database `rekankerja` ada.
// (Nama db/user `rekankerja` = identifier infrastruktur internal — dipertahankan agar cluster
// PG existing + .env + prosedur pemulihan sandbox tetap valid; bukan brand tampilan.)
// Port: 5432 (khusus internal, tidak diekspos gateway).
import { Client } from "pg";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const BIN = path.join(process.cwd(), "node_modules", "@embedded-postgres", "linux-x64", "native", "bin");
const DATA = path.join(process.cwd(), "data");
const PGLOG = path.join(process.cwd(), "pg.log");
const USER = "rekankerja";
const PASSWORD = process.env.PG_PASSWORD ?? "rekankerja_dev";
const PORT = 5432;
// QA-SCALING-100T: batas koneksi dinaikkan 100 → 300. Pola 1 PrismaClient per
// tenant (limit 2 koneksi) + evict idle (tenant-db.ts): 100 tenant aktif serentak
// = 200 koneksi + ±10 platform/admin — muat. Default 100 lama hanya menampung
// ±28–30 tenant aktif (terbukti empiris: benchmark 100 tenant, 211/300 query gagal
// "too many clients"). Naikkan via env bila node punya RAM lebih (tiap backend
// idle ~1–2MB).
const MAX_CONN = (() => {
  const raw = Number(process.env.PG_MAX_CONNECTIONS);
  return Number.isFinite(raw) && raw >= 20 ? Math.floor(raw) : 300;
})();
const START_OPTS = `-p ${PORT} -h 127.0.0.1 -c max_connections=${MAX_CONN}`;

async function isUp(): Promise<boolean> {
  try {
    const c = new Client({ host: "127.0.0.1", port: PORT, user: USER, password: PASSWORD, database: "postgres", connectionTimeoutMillis: 1500 });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

async function ensureDatabase(name: string) {
  const c = new Client({ host: "127.0.0.1", port: PORT, user: USER, password: PASSWORD, database: "postgres" });
  await c.connect();
  const r = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (r.rowCount === 0) await c.query(`CREATE DATABASE "${name}"`);
  await c.end();
}

if (!(await isUp())) {
  if (!existsSync(path.join(DATA, "PG_VERSION"))) {
    const pw = path.join(tmpdir(), `pgpw-${Date.now()}`);
    writeFileSync(pw, PASSWORD, { mode: 0o600 });
    console.log("[pg] initdb …");
    const r = spawnSync(path.join(BIN, "initdb"), ["-D", DATA, "-U", USER, "--pwfile", pw, "-E", "UTF8", "-A", "scram-sha-256"], { stdio: "inherit" });
    rmSync(pw, { force: true });
    if (r.status !== 0) { console.error("[pg] initdb gagal"); process.exit(1); }
  }
  console.log("[pg] starting …");
  const r = spawnSync(path.join(BIN, "pg_ctl"), ["-D", DATA, "-l", PGLOG, "-o", START_OPTS, "-w", "start"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("[pg] start gagal — lihat pg.log"); process.exit(1); }
} else {
  // QA-SCALING-100T: sudah jalan tapi max_connections lebih KECIL dari target
  // (cluster lama) → restart terkontrol supaya batas baru aktif. max_connections
  // tidak bisa di-ALTER SYSTEM tanpa restart. Data aman (restart ≠ drop).
  try {
    const c = new Client({ host: "127.0.0.1", port: PORT, user: USER, password: PASSWORD, database: "postgres" });
    await c.connect();
    const r = await c.query("SHOW max_connections");
    const cur = Number(r.rows[0]?.max_connections ?? 0);
    await c.end();
    if (cur < MAX_CONN) {
      console.log(`[pg] max_connections ${cur} < target ${MAX_CONN} — restart diperlukan …`);
      const rr = spawnSync(path.join(BIN, "pg_ctl"), ["-D", DATA, "-l", PGLOG, "-o", START_OPTS, "-m", "fast", "-w", "restart"], { stdio: "inherit" });
      if (rr.status !== 0) { console.error("[pg] restart gagal — lihat pg.log"); process.exit(1); }
    }
  } catch (e) {
    console.warn("[pg] cek max_connections gagal — lanjut tanpa restart:", (e as Error).message);
  }
}

await ensureDatabase("rekankerja");
console.log(`[pg] OK — postgres@127.0.0.1:${PORT} db=rekankerja user=${USER} (data: ${path.relative(process.cwd(), DATA)})`);
process.exit(0);
