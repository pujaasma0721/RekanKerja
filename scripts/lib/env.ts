// K-7 (audit 42) — loader .env MINIMAL untuk skrip CLI (scripts/*.ts).
// =========================================================================
// Latar: skrip migrasi membaca process.env.PLATFORM_DB_URL /
// TENANT_DB_BASE_URL dengan fallback dev sandbox — bila dijalankan dari
// cron/systemd tanpa env yang diekspor, skrip diam-diam memakai fallback
// dev (atau gagal). dotenv BUKAN dependency project (jangan tambah dep) —
// loader ini cukup: baca .env di root project, isi HANYA key yang belum
// ada di process.env → env proses (PM2/systemd/`KEY=x bun ...`) SELALU
// menang, .env hanya berfungsi sebagai fallback.
//
// Pemakaian — import side-effect SEBAGAI BARIS PERTAMA skrip (ESM
// mengevaluasi import berurutan sebelum body modul, sehingga env terisi
// sebelum const module-level `process.env.X ?? fallback` dievaluasi):
//
//   import "./lib/env";
//   import { Client } from "pg";
//
// Format .env yang didukung: `KEY=VALUE` per baris; `#` komentar; awalan
// `export ` opsional; kutip tunggal/ganda dibuka; baris kosong/komentar
// diabaikan. Tidak pernah throw (missing .env → no-op) — aman di-embed
// oleh bundler Next saat skrip diimpor parity-runner in-process.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvLine(line: string): { key: string; value: string } | null {
  let s = line.trim();
  if (!s || s.startsWith("#")) return null;
  if (s.startsWith("export ")) s = s.slice(7).trim();
  const eq = s.indexOf("=");
  if (eq <= 0) return null;
  const key = s.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = s.slice(eq + 1).trim();
  // buka kutip tunggal/ganda pasangan penuh di ujung nilai
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadDotEnv(): void {
  // Kandidat lokasi .env: (1) cwd (CLI dari root project / cwd PM2 = folder
  // project), (2) relatif lokasi file ini (scripts/lib → naik 2 = root) —
  // menutupi skrip yang dijalankan dari cwd lain; (3) parent cwd.
  let root: string | null = null;
  const candidates: string[] = [join(process.cwd(), ".env")];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env"));
  } catch {
    /* import.meta.url bukan file: URL (bundled) — cwd path sudah cukup */
  }
  candidates.push(join(process.cwd(), "..", ".env"));
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        root = p;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!root) return; // tanpa .env → env proses apa adanya

  let text: string;
  try {
    text = readFileSync(root, "utf8");
  } catch {
    return; // unreadable → no-op
  }

  let applied = 0;
  for (const line of text.split(/\r?\n/)) {
    const kv = parseEnvLine(line);
    if (!kv) continue;
    if (process.env[kv.key] === undefined) {
      process.env[kv.key] = kv.value;
      applied++;
    }
  }
  if (applied > 0) {
    // keterangan singkat untuk log skrip (hanya jumlah — tidak membocorkan nilai)
    console.log(`[env] ${applied} var dimuat dari ${root} (env proses tetap menang)`);
  }
}

loadDotEnv();
