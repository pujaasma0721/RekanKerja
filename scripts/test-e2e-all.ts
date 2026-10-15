// ============================================================================
// B9-BL — AGREGATOR UJI E2E (DEVELOPMENT-PLAN-BACKLOG.md §4 B9)
// `bun run test:e2e` — menjalankan suite E2E stabil secara berurutan dengan
// ringkasan per-suite. Dirancang untuk pengulangan deterministik di atas
// fixture demo (3 tenant terpulihkan; setiap suite self-cleaning per
// konvensi proyek — residu data uji dibersihkan di akhir skrip masing-masing).
//
// Pemakaian:
//   bun run test:e2e                       → semua suite stabil (urut)
//   bun run test:e2e -- --list             → daftar suite tanpa menjalankan
//   bun run test:e2e -- b1 b5 referral     → subset (cocok kata di nama file)
//   bun run test:e2e -- --reset            → RESET fixture dulu (restore-demo
//                                            + migrasi berurut), lalu semua suite
//   bun run test:e2e -- --reset b6         → reset lalu subset
//
// Prasyarat: dev server JALAN di :3000 (`bun run dev` / watchdog watch-dev.sh)
// + PG embedded :5432. `--reset` TIDAK mematikan dev server — hanya membangun
// ulang data (restore-demo idempoten; parity runner di-boot dev server akan
// menyembuhkan sisa gap — namun urutan eksplisit di bawah sudah lengkap).
//
// Kriteria SUITE STABIL (kurasi): menarget localhost:3000 dengan fixture demo,
// self-cleaning, dan lolos berulang di HEAD saat B9 dikurasi. Suite yang
// menarget lingkungan lain (PROD URL / browser eksternal / DNS subdomain)
// DIKELUARKAN dan dicatat alasannya di bawah.
// ============================================================================
import { spawnSync } from "node:child_process";

interface SuiteDef {
  file: string;      // scripts/e2e-<file>.ts
  group: string;     // grup fungsional (label ringkasan)
  /** alasan eksklusi (bila null = stabil, dijalankan) */
  exclude?: string;
}

// Urutan eksekusi: fondasi (fixture-agnostik) → modul → backlog.
// Suite yang saling bergantung secara historis diletakkan berdekatan
// (medical wave berurutan; esign core sebelum turunannya).
const SUITES: SuiteDef[] = [
  // --- Payroll & Attendance ---
  { file: "e2e-basic-periodend", group: "Payroll" },
  { file: "e2e-bulk-periods", group: "Payroll" },
  { file: "e2e-recalc-partial", group: "Payroll" },
  { file: "e2e-payroll-sort", group: "Payroll" },
  // --- Keamanan ---
  { file: "e2e-menu-guard-403", group: "Keamanan" },
  // --- HR ---
  { file: "e2e-directory-sort", group: "HR" },
  { file: "e2e-transfer-no-pa", group: "HR" },
  { file: "e2e-server-sort-audit", group: "HR" },
  { file: "e2e-checklist", group: "HR" },
  { file: "e2e-checklist-recipients", group: "HR" },
  // --- Cuti ---
  { file: "e2e-leave-notify", group: "Cuti" },
  // --- Medis (wave berurutan — rangkaian klaim demo) ---
  { file: "e2e-medical-wave1", group: "Medis" },
  { file: "e2e-medical-wave1-settle2", group: "Medis" },
  { file: "e2e-medical-wave2", group: "Medis" },
  { file: "e2e-medical-wave3", group: "Medis" },
  { file: "e2e-medical-wave4", group: "Medis" },
  { file: "e2e-medical-umc-chain", group: "Medis" },
  // --- eSign ---
  { file: "e2e-esign", group: "eSign" },
  { file: "e2e-esign-pdf", group: "eSign" },
  { file: "e2e-esign-pa", group: "eSign" },
  { file: "e2e-esign-payroll", group: "eSign" },
  // --- Kinerja P0–P9 ---
  { file: "e2e-p7-probation", group: "Kinerja" },
  { file: "e2e-p8-reports", group: "Kinerja" },
  { file: "e2e-p9-compliance", group: "Kinerja" },
  // --- Backlog B1–B8 ---
  { file: "e2e-b1-okr", group: "Backlog" },
  { file: "e2e-b2-ai-bias", group: "Backlog" },
  { file: "e2e-b3-attrition", group: "Backlog" },
  { file: "e2e-b4-succession", group: "Backlog" },
  { file: "e2e-b5-benchmark", group: "Backlog" },
  { file: "e2e-b6-wa-meeting", group: "Backlog" },
  { file: "e2e-b7-portal-magic", group: "Backlog" },
  { file: "e2e-b8-referral", group: "Backlog" },
  // --- DIKECUALIKAN (bukan suite stabil localhost — hanya tercatat) ---
  { file: "e2e-smtp-connect", group: "—", exclude: "menarget PROD URL eksternal (Task 64m) — bukan fixture lokal" },
  { file: "e2e-browser-subdomain", group: "—", exclude: "skrip browser (.mjs) subdomain — butuh setup DNS eksternal" },
  { file: "e2e-subdomain-tenant", group: "—", exclude: "menarget resolusi subdomain lintas-host — lingkungan spesifik" },
];

// Urutan reset fixture — persis prosedur pemulihan terdokumentasi worklog
// (restore-demo → password-security → seed-ess → rekrutmen demo → kinerja →
// backlog). Semua idempoten; dev server TETAP HIDUP (data dibangun ulang).
const RESET_STEPS: string[] = [
  "scripts/restore-demo.ts",
  "scripts/migrate-password-security.ts",
  "scripts/seed-ess-demo-user.ts",
  "scripts/migrate-recruitment-f1.ts",
  "scripts/migrate-recruitment-f2.ts",
  "scripts/migrate-recruitment-f3.ts",
  "scripts/migrate-performance-p0.ts",
  "scripts/migrate-performance-p1.ts",
  "scripts/seed-p6-demo.ts",
  "scripts/seed-p7-demo.ts",
  "scripts/seed-p8-demo.ts",
  "scripts/migrate-performance-p9.ts",
  "scripts/migrate-performance-b1-okr.ts",
  "scripts/migrate-performance-b2-bias.ts",
  // B3 = stateless (tanpa migrasi — dihitung on-demand)
  "scripts/migrate-performance-b4-succession.ts",
  "scripts/migrate-performance-b5-benchmark.ts",
  "scripts/migrate-recruitment-b6-wa-meeting.ts",
  "scripts/migrate-recruitment-b7-status-link.ts",
  "scripts/migrate-recruitment-b8-referral.ts",
];

const SUITE_TIMEOUT_MS = 6 * 60_000; // per-suite 6 menit (suite berat: import+exceljs+pdf)
const RESET_TIMEOUT_MS = 10 * 60_000; // per-langkah reset 10 menit

function run(cmd: string, args: string[], timeoutMs: number): { status: number | null; timedOut: boolean } {
  const r = spawnSync(cmd, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  return { status: r.status, timedOut: r.signal === "SIGKILL" || (r.status === null && r.error !== undefined) };
}

function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doList = args.includes("--list");
  const doReset = args.includes("--reset");
  const filters = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

  if (doList) {
    console.log("Suite E2E stabil (urut eksekusi):\n");
    for (const s of SUITES) {
      if (s.exclude) console.log(`  ✗ ${s.file.padEnd(28)} DIKECUALIKAN — ${s.exclude}`);
      else console.log(`  ✓ ${s.file.padEnd(28)} [${s.group}]`);
    }
    const n = SUITES.filter((s) => !s.exclude).length;
    console.log(`\nTotal: ${n} suite stabil / ${SUITES.length} tercatat.`);
    console.log("\nPemakaian: bun run test:e2e [-- --reset | --list | <kata-kunci>...]");
    process.exit(0);
  }

  // pilih suite
  const selected = SUITES.filter((s) => {
    if (s.exclude) return false;
    if (filters.length === 0) return true;
    return filters.some((f) => s.file.toLowerCase().includes(f));
  });
  if (selected.length === 0) {
    console.error(`Tidak ada suite stabil yang cocok: ${filters.join(", ")} (lihat --list)`);
    process.exit(2);
  }

  // prasyarat: dev server hidup
  const probe = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "http://localhost:3000/api/health"]);
  if (String(probe.stdout ?? "").trim() !== "200") {
    console.error("[agregator] dev server :3000 TIDAK sehat — jalankan `bun run dev` (atau watchdog) dulu.\n");
    process.exit(2);
  }

  if (doReset) {
    console.log("\n=== RESET FIXTURE (restore-demo + migrasi berurut — dev server tetap hidup) ===");
    const t0 = Date.now();
    for (const step of RESET_STEPS) {
      process.stdout.write(`  [reset] ${step} … `);
      const t1 = Date.now();
      const r = run("bun", ["run", step], RESET_TIMEOUT_MS);
      console.log(r.status === 0 ? `OK (${fmtDur(Date.now() - t1)})` : `GAGAL (exit ${r.status})`);
      if (r.status !== 0) {
        console.error(`[agregator] reset gagal di ${step} — hentikan.`);
        process.exit(2);
      }
    }
    console.log(`  [reset] selesai (${fmtDur(Date.now() - t0)})\n`);
  }

  console.log(`=== UJI E2E — ${selected.length} suite ===\n`);
  const results: { file: string; group: string; ok: boolean; timeout: boolean; ms: number; tail: string }[] = [];
  const tAll = Date.now();
  for (const s of selected) {
    const t0 = Date.now();
    process.stdout.write(`▶ ${s.file.padEnd(28)} [${s.group}] … `);
    // stdout suite disalurkan ke file agar ringkas; tail disimpan utk diagnosis
    const out = spawnSync("bun", ["run", `scripts/${s.file}.ts`], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: SUITE_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 16 * 1024 * 1024,
    });
    const ms = Date.now() - t0;
    const timedOut = out.signal === "SIGKILL";
    const ok = out.status === 0 && !timedOut;
    const tail = String(out.stdout ?? "")
      .split("\n")
      .filter((l: string) => l.trim() !== "")
      .slice(-6)
      .join("\n");
    console.log(ok ? `LULUS (${fmtDur(ms)})` : timedOut ? `TIMEOUT (${fmtDur(ms)})` : `GAGAL (exit ${out.status}, ${fmtDur(ms)})`);
    if (!ok) console.log(tail.split("\n").map((l: string) => `    │ ${l}`).join("\n"));
    results.push({ file: s.file, group: s.group, ok, timeout: timedOut, ms, tail });
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== RINGKASAN (${fmtDur(Date.now() - tAll)}) ===`);
  const groups = [...new Set(results.map((r) => r.group))];
  for (const g of groups) {
    const rs = results.filter((r) => r.group === g);
    const line = rs.map((r) => `${r.ok ? "✓" : "✗"} ${r.file.replace("e2e-", "")} (${fmtDur(r.ms)})`).join("  ");
    console.log(`  [${g}] ${rs.filter((r) => r.ok).length}/${rs.length} — ${line}`);
  }
  console.log(`\nTOTAL: ${pass}/${results.length} LULUS${fail > 0 ? ` · ${fail} GAGAL` : ""}`);
  if (fail > 0) {
    console.log("\nSuite gagal (6 baris terakhir masing-masing):");
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`\n  ── ${r.file} ──\n${r.tail.split("\n").map((l: string) => `  ${l}`).join("\n")}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
