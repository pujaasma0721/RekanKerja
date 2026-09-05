// OneVity — pemicu seed demo jarak jauh (remote demo seeding).
// Dipakai oleh: src/instrumentation.ts (auto-seed saat server boot & DB kosong)
// dan /api/admin/seed-demo (pemicu manual + status; dijaga token).
//
// Menjalankan scripts/restore-demo.ts SEBAGAI SUBPROSES bun — logika seeding
// tidak diduplikasi (satu sumber kebenaran), idempoten (tenant yang sudah ada
// di-skip), dan mewarisi env server (PLATFORM_DB_URL / TENANT_DB_BASE_URL).
//
// Token default di bawah HANYA untuk repo privat + keperluan demo (endpoint
// idempoten; salah token → 401). Override via env DEMO_SEED_TOKEN di server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Client } from "pg";

const DEFAULT_TOKEN = "ovseed_58ee69daad5e4e915d55ecf2";
const SCRIPT = "scripts/restore-demo.ts";
const MAX_LOG = 4000;

let child: ChildProcess | null = null;
let lastLog = "";
let lastExit: number | null = null;
let startedAt: number | null = null;

export function demoSeedToken(): string {
  return process.env.DEMO_SEED_TOKEN || DEFAULT_TOKEN;
}

function appendLog(chunk: Buffer | string) {
  lastLog = (lastLog + String(chunk)).slice(-MAX_LOG);
}

/** Hitung tenant & user platform — pakai pg mentah (ringan, tanpa Prisma). */
export async function platformCounts(): Promise<{ tenants: number; users: number }> {
  const c = new Client({ connectionString: process.env.PLATFORM_DB_URL });
  await c.connect();
  try {
    const t = await c.query('SELECT COUNT(*)::int AS n FROM "Tenant"');
    const u = await c.query('SELECT COUNT(*)::int AS n FROM "User"');
    return { tenants: t.rows[0].n ?? 0, users: u.rows[0].n ?? 0 };
  } finally {
    await c.end();
  }
}

export type SeedSpawnResult = {
  ok: boolean;
  running: boolean;
  note: string;
};

/**
 * Jalankan restore-demo sebagai subproses latar belakang (fire-and-forget).
 * Aman dipanggil berkali-kali: saat masih berjalan → tolak; selesai → boleh lagi.
 */
export function spawnRestoreDemo(): SeedSpawnResult {
  const isRunning = !!child && child.exitCode === null && !child.killed;
  if (isRunning) {
    return { ok: false, running: true, note: "Seed demo masih berjalan — tunggu hingga selesai." };
  }
  if (!existsSync(SCRIPT)) {
    return {
      ok: false,
      running: false,
      note: `${SCRIPT} tidak ditemukan di CWD (${process.cwd()}) — jalankan manual di server: bun ${SCRIPT}`,
    };
  }
  // bun tersedia bila server dijalankan dengan bun; selain itu andalkan PATH.
  const isBun = !!process.versions?.bun || /bun/i.test(process.execPath);
  const cmd = isBun ? process.execPath : "bun";
  lastLog = "";
  lastExit = null;
  startedAt = Date.now();
  child = spawn(cmd, [SCRIPT], {
    cwd: process.cwd(),
    env: process.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);
  child.on("exit", (code) => {
    lastExit = code ?? -1;
    appendLog(`\n[exit ${lastExit} dalam ${Math.round((Date.now() - (startedAt ?? Date.now())) / 1000)}s]`);
    console.log(`[demo-seed] subproses selesai (exit ${lastExit})`);
  });
  child.on("error", (e) => {
    lastExit = -1;
    appendLog(`\n[spawn error] ${e instanceof Error ? e.message : String(e)}`);
  });
  console.log(`[demo-seed] subproses dimulai: ${cmd} ${SCRIPT}`);
  return { ok: true, running: true, note: `Seed demo dimulai di latar belakang (${cmd} ${SCRIPT}).` };
}

export function seedRuntimeStatus() {
  return {
    running: !!child && child.exitCode === null && !child.killed,
    startedAt,
    lastExit,
    logTail: lastLog.trim().slice(-2000),
  };
}
