// mini-services/postgres — Embedded PostgreSQL 17 untuk RekanKerja (multi-tenant schema-per-tenant)
// Idempotent: initdb (sekali) → start (jika mati) → pastikan database `onevity` ada.
// (Nama db/user `onevity` = identifier infrastruktur internal — dipertahankan agar cluster
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
const USER = "onevity";
const PASSWORD = process.env.PG_PASSWORD ?? "onevity_dev";
const PORT = 5432;

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
  const r = spawnSync(path.join(BIN, "pg_ctl"), ["-D", DATA, "-l", PGLOG, "-o", `-p ${PORT} -h 127.0.0.1`, "-w", "start"], { stdio: "inherit" });
  if (r.status !== 0) { console.error("[pg] start gagal — lihat pg.log"); process.exit(1); }
}

await ensureDatabase("onevity");
console.log(`[pg] OK — postgres@127.0.0.1:${PORT} db=onevity user=${USER} (data: ${path.relative(process.cwd(), DATA)})`);
process.exit(0);
