// OneVity — pemicu seed demo jarak jauh (remote demo seeding).
// Dipakai oleh: src/instrumentation.ts (auto-seed saat server boot) dan
// /api/admin/seed-demo (pemicu manual + status; dijaga token).
//
// REWRITE (wave seed-remote, Task 30): server produksi menjalankan app di
// bawah NODE — spawn "bun" gagal ENOENT sehingga mekanisme lama (subproses
// scripts/restore-demo.ts) TIDAK PERNAH jalan di sana. Dua jalur baru:
//   A. IN-PROCESS (utama, node & bun): parity-runner menjalankan seluruh
//      migrasi idempoten pasca-7987fe8 untuk SEMUA tenant registry —
//      menyehatkan deployment lama "kode baru + DB lama" (tabel/kolom
//      wave-26/27/28 + seed demo + enkripsi).
//   B. SPAWN restore-demo (pelengkap, HANYA bila bun tersedia): provisioning
//      fresh-install (3 tenant + seed MII penuh + migrasi 1b-1g). Di server
//      tanpa bun → dilewati dengan catatan (fresh install: jalankan
//      `bun scripts/restore-demo.ts` sekali via shell).
// Urutan saat POST penuh: spawn (bila ada) DULU → parity SETELAHnya selesai —
// menghindari race DDL dua penulis bersamaan.
//
// Token default di bawah HANYA untuk repo privat + keperluan demo (endpoint
// idempoten; salah token → 401). Override via env DEMO_SEED_TOKEN di server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Client } from "pg";
import { parityRunnerStatus, runParityPipeline } from "@/onevity/shared/lib/parity-runner";

const DEFAULT_TOKEN = "ovseed_58ee69daad5e4e915d55ecf2";
const SCRIPT = "scripts/restore-demo.ts";
const MAX_LOG = 4000;

let child: ChildProcess | null = null;
let busy = false;
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
 * Mulai seed demo di latar belakang (fire-and-forget; status via
 * seedRuntimeStatus()). Aman dipanggil berkali-kali: saat masih berjalan →
 * tolak; selesai → boleh lagi (semua langkah idempoten).
 *
 * @param opts.parityOnly — lewati jalur spawn fresh-install (dipakai
 *        instrumentation saat tenant sudah ada: hanya upgrade migrasi).
 */
export function startDemoSeed(opts: { parityOnly?: boolean } = {}): SeedSpawnResult {
  const childRunning = !!child && child.exitCode === null && !child.killed;
  if (busy || childRunning || parityRunnerStatus().running) {
    return { ok: false, running: true, note: "Seed demo masih berjalan — tunggu hingga selesai." };
  }
  startedAt = Date.now();
  lastLog = "";
  lastExit = null;
  busy = true;

  void (async () => {
    try {
      // ---- B. fresh-install via spawn (hanya bila bun tersedia) ----
      if (!opts.parityOnly && existsSync(SCRIPT)) {
        const isBun = !!process.versions?.bun || /bun/i.test(process.execPath);
        const cmd = isBun ? process.execPath : "bun";
        appendLog(`[demo-seed] subproses dimulai: ${cmd} ${SCRIPT}\n`);
        child = spawn(cmd, [SCRIPT], {
          cwd: process.cwd(),
          env: process.env as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout?.on("data", appendLog);
        child.stderr?.on("data", appendLog);
        await new Promise<void>((resolve) => {
          const c = child!;
          c.on("error", (e) => {
            appendLog(`\n[spawn error] ${e instanceof Error ? e.message : String(e)} — server tanpa bun: jalur fresh-seed dilewati, lanjut parity in-process.\n`);
            resolve();
          });
          c.on("exit", () => resolve());
        });
      }

      // ---- A. parity in-process (node & bun) ----
      const report = await runParityPipeline((line) => appendLog(`${line}\n`));
      lastExit = report.ok ? 0 : 1;
      appendLog(`\n[exit ${lastExit} dalam ${Math.round((Date.now() - (startedAt ?? Date.now())) / 1000)}s]\n`);
      console.log(`[demo-seed] pipeline parity selesai (exit ${lastExit})`);
    } catch (e) {
      lastExit = 1;
      appendLog(`\n[fatal] ${e instanceof Error ? e.message : String(e)}\n`);
      console.error("[demo-seed] gagal:", e);
    } finally {
      busy = false;
    }
  })();

  return {
    ok: true,
    running: true,
    note: opts.parityOnly
      ? "Parity runner dimulai in-process di latar belakang (migrasi semua tenant)."
      : "Seed demo dimulai di latar belakang (fresh-seed bila bun tersedia + parity in-process).",
  };
}

export function seedRuntimeStatus() {
  const { running: parityRunning, lastReport } = parityRunnerStatus();
  const childRunning = !!child && child.exitCode === null && !child.killed;
  return {
    running: busy || childRunning || parityRunning,
    startedAt,
    lastExit,
    logTail: lastLog.trim().slice(-2000),
    parity: lastReport,
  };
}
