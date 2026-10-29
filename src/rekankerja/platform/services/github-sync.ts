// RekanKerja — Online Support P8 (FEAT-SUPPORT-P8): sinkronisasi GitHub ======
// =====================================================================
// Fitur pull & push GitHub untuk pemilik aplikasi, dari konsol platform:
//   · STATUS — cabang aktif, remote (URL dimask), ahead/behind vs
//     upstream, file yang berubah (belum di-commit), commit terakhir.
//   · PUSH   — commit SEMUA perubahan yang tertunda (git add -A + git
//     commit) lalu git push ke remote terpilih (default: semua remote).
//     Pemicu utama: patch yang baru DISETUJUI menulis file aplikasi —
//     perubahan itu "hidup" di server dan perlu diselamatkan ke GitHub.
//   · PULL   — tarik perubahan terbaru (git pull --ff-only; autostash
//     opsional bila ada perubahan lokal yang belum di-commit).
//   · AUTO-PUSH — setelan (PlatformSetting "github.autopush"): setelah
//     usulan patch DISETUJUI, perubahan langsung di-commit & di-push
//     dengan pesan yang merujuk nomor tiket. Best-effort — kegagalan
//     sync TIDAK PERNAH menggagalkan persetujuan patch itu sendiri.
//
// KEAMANAN (oleh konstruksi):
//   · TIDAK ADA input pengguna yang menjadi nama perintah git — hanya
//     sub-perintah tetap (status/log/remote/add/commit/push/pull).
//     Satu-satunya data bebas adalah pesan commit (dibersihkan: tanpa
//     karakter kontrol, max 300 karakter) dan NAMA remote yang divalidasi
//     terhadap daftar remote aktual repo.
//   · Semua output/error git DIMASK dulu (token pada URL remote seperti
//     https://user:TOKEN@github.com/... → https://user:***@...) sebelum
//     dikirim ke klien ATAU disimpan ke GithubSyncLog.
//   · execFile (bukan shell) — argumen ter-escape per parameter; timeout
//     per perintah; lock in-memory mencegah dua operasi bersamaan.
//   · Direktori artefak sandbox TIDAK ikut di-commit: `git add` memakai
//     pathspec exclude `repo` (gitlink submodul legacy yang selalu tampak
//     dirty); file lain (log, db, data postgres) sudah di-cover .gitignore.
// =====================================================================
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db as platformDb } from "@/lib/db";

const execFileAsync = promisify(execFile);

// ------------------------------ konstanta ------------------------------

const GIT_TIMEOUT_LOCAL_MS = 15_000;
const GIT_TIMEOUT_NETWORK_MS = 120_000;
const MAX_COMMIT_MESSAGE = 300;
const MAX_DIRTY_FILES_SHOWN = 400;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/** Kunci PlatformSetting untuk auto-push pasca-persetujuan patch. */
export const SETTING_AUTO_PUSH = "github.autopush";

/** Gitlink submodul legacy di root proyek — SELALU tampak "-dirty" di
 *  git status (isi salinan lama berubah), tapi gitlink-nya sendiri tidak
 *  pernah berubah. Dikecualikan dari add & dari hitungan file kotor. */
const PATHSPEC_EXCLUDES = [":(exclude)repo"];

// ------------------------------ util git ------------------------------

/** Mask kredensial yang tertanam di URL (https://user:TOKEN@host/... →
 *  https://user:***@host/...) — berlaku untuk SEMUA teks yang keluar
 *  dari proses git sebelum menyentuh klien / database. */
export function maskGitSecrets(text: string): string {
  return text.replace(/([a-zA-Z0-9._~()-]+):([^@/\s]+)@/g, "$1:***@");
}

/** Bersihkan pesan commit dari karakter kontrol & baris baru. */
function cleanCommitMessage(raw: string): string {
  return (
    raw
      .split(/[\r\n]+/)
      .join(" ")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, MAX_COMMIT_MESSAGE)
  );
}

interface GitRun {
  ok: boolean;
  out: string;
  err: string;
}

/** Jalankan satu perintah git (execFile — tanpa shell, argumen terpisah). */
async function runGit(args: string[], timeoutMs: number): Promise<GitRun> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
    });
    return { ok: true, out: stdout, err: stderr };
  } catch (e) {
    const err = e as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string; killed?: boolean };
    if (err.killed) {
      return { ok: false, out: "", err: "Perintah git melebihi batas waktu (timeout)" };
    }
    const tail = (b?: string | Buffer) => (b == null ? "" : Buffer.from(b).toString("utf8"));
    const text = maskGitSecrets((tail(err.stderr) || tail(err.message)).trim());
    return { ok: false, out: tail(err.stdout), err: text || "Perintah git gagal" };
  }
}

// ------------------------------ lock ------------------------------

let syncInFlight = false;

/** Error khusus: operasi sync lain sedang berjalan. */
export class SyncBusyError extends Error {
  constructor() {
    super("Operasi sinkronisasi lain sedang berjalan — tunggu sebentar lalu coba lagi");
    this.name = "SyncBusyError";
  }
}

async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  if (syncInFlight) throw new SyncBusyError();
  syncInFlight = true;
  try {
    return await fn();
  } finally {
    syncInFlight = false;
  }
}

// ------------------------------ tipe publik ------------------------------

export interface GitRemoteInfo {
  name: string;
  url: string; // sudah dimask
}

export interface GitDirtyFile {
  path: string;
  /** kode XY git status --porcelain, mis. "M ", " M", "??", "A " */
  status: string;
  staged: boolean;
  untracked: boolean;
}

export interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export interface GitRepoStatus {
  /** false bila bukan repo git / git tidak tersedia — error diikuti. */
  ok: boolean;
  error?: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  remotes: GitRemoteInfo[];
  dirtyFiles: GitDirtyFile[];
  /** jumlah file berubah TANPA gitlink artefak `repo`. */
  dirtyCount: number;
  recentCommits: GitCommitInfo[];
}

export interface GitPushRemoteResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GitPushResult {
  /** true bila ada commit baru yang dibuat. */
  committed: boolean;
  commitHash: string | null;
  commitMessage: string;
  filesCommitted: number;
  /** true bila TIDAK ada yang bisa di-push (bersih & tidak ahead). */
  nothingToDo: boolean;
  remotes: GitPushRemoteResult[];
}

export interface GitPullResult {
  /** true bila HEAD berpindah (ada commit baru masuk). */
  updated: boolean;
  newCommits: GitCommitInfo[];
  output: string;
}

// ------------------------------ log DB (best-effort) ------------------------------

async function logSync(entry: {
  action: "PUSH" | "PULL" | "AUTO_PUSH";
  status: "OK" | "GAGAL";
  branch: string;
  message: string;
  detail: string;
  byName: string;
}): Promise<void> {
  try {
    await platformDb.githubSyncLog.create({
      data: {
        action: entry.action,
        status: entry.status,
        branch: entry.branch.slice(0, 120),
        message: entry.message.slice(0, 500),
        detail: maskGitSecrets(entry.detail).slice(0, 2_000),
        byName: entry.byName.slice(0, 120),
      },
    });
  } catch {
    /* audit best-effort — operasi sync tetap sah */
  }
}

// ------------------------------ STATUS ------------------------------

/** Ambil daftar remote aktual (untuk validasi nama & tampilan). */
async function listRemoteNames(): Promise<string[]> {
  const r = await runGit(["remote"], GIT_TIMEOUT_LOCAL_MS);
  if (!r.ok) return [];
  return r.out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Status repo lengkap — best-effort per bagian (satu bagian gagal tidak
 *  membatalkan yang lain). */
export async function getRepoStatus(): Promise<GitRepoStatus> {
  const status: GitRepoStatus = {
    ok: true,
    branch: "",
    upstream: null,
    ahead: 0,
    behind: 0,
    remotes: [],
    dirtyFiles: [],
    dirtyCount: 0,
    recentCommits: [],
  };

  const [branchR, remoteVR, statusR, logR] = await Promise.all([
    runGit(["-c", "core.quotepath=false", "rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT_LOCAL_MS),
    runGit(["-c", "core.quotepath=false", "remote", "-v"], GIT_TIMEOUT_LOCAL_MS),
    runGit(["-c", "core.quotepath=false", "status", "--porcelain=v1"], GIT_TIMEOUT_LOCAL_MS),
    runGit(["-c", "core.quotepath=false", "log", "-5", "--pretty=format:%h%x09%an%x09%ad%x09%s", "--date=short"], GIT_TIMEOUT_LOCAL_MS),
  ]);

  if (!branchR.ok) {
    return { ...status, ok: false, error: branchR.err };
  }
  status.branch = branchR.out.trim() || "(detached)";

  // remote -v → pasangan (fetch) saja, URL dimask
  for (const line of remoteVR.out.split("\n")) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (m) status.remotes.push({ name: m[1], url: maskGitSecrets(m[2]) });
  }

  // file kotor (tanpa gitlink artefak `repo`)
  for (const line of statusR.out.split("\n")) {
    if (!line) continue;
    const p = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
    if (!p || p === "repo") continue; // gitlink submodul legacy — selalu dirty
    if (status.dirtyFiles.length < MAX_DIRTY_FILES_SHOWN) {
      status.dirtyFiles.push({
        path: p,
        status: line.slice(0, 2),
        staged: line[0] !== " " && line[0] !== "?",
        untracked: line.slice(0, 2) === "??",
      });
    }
    status.dirtyCount += 1;
  }

  // ahead/behind vs upstream default
  const upR = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], GIT_TIMEOUT_LOCAL_MS);
  if (upR.ok && upR.out.trim()) {
    status.upstream = upR.out.trim();
    const abR = await runGit(["rev-list", "--left-right", "--count", `${status.upstream}...HEAD`], GIT_TIMEOUT_LOCAL_MS);
    if (abR.ok) {
      const [behind, ahead] = abR.out.trim().split(/\s+/).map((n) => Number.parseInt(n, 10));
      status.behind = Number.isFinite(behind) ? behind : 0;
      status.ahead = Number.isFinite(ahead) ? ahead : 0;
    }
  }

  // commit terakhir
  for (const line of logR.out.split("\n")) {
    const [hash, author, date, ...rest] = line.split("\t");
    if (!hash || !author) continue;
    status.recentCommits.push({ hash, author, date, subject: rest.join("\t").slice(0, 160) });
  }

  return status;
}

// ------------------------------ PUSH ------------------------------

/** Pastikan identitas commit tersedia — bila belum di-set di config,
 *  pakai identitas platform per-command (tanpa mengubah config). */
async function commitArgs(): Promise<string[]> {
  const emailR = await runGit(["config", "user.email"], GIT_TIMEOUT_LOCAL_MS);
  if (emailR.ok && emailR.out.trim()) return [];
  return ["-c", "user.name=RekanKerja Platform", "-c", "user.email=platform@rekankerja.local"];
}

/** Commit semua perubahan tertunda + push ke remote terpilih.
 *  `remotes` kosong = SEMUA remote. */
export async function pushChanges(opts: {
  message: string;
  remotes?: string[];
  byName: string;
  action?: "PUSH" | "AUTO_PUSH";
}): Promise<GitPushResult> {
  return withSyncLock(async () => {
    const action = opts.action ?? "PUSH";
    const message = cleanCommitMessage(opts.message) || "chore: sinkronisasi perubahan aplikasi (konsol platform)";
    const byName = (opts.byName || "konsol platform").slice(0, 120);

    // daftar remote valid (input divalidasi terhadap kenyataan repo)
    const available = await listRemoteNames();
    if (available.length === 0) {
      await logSync({ action, status: "GAGAL", branch: "", message, detail: "Tidak ada remote git yang terdaftar", byName });
      throw new Error("Tidak ada remote git yang terdaftar pada repo ini");
    }
    const wanted = (opts.remotes?.length ? opts.remotes : available).filter((r) => available.includes(r));
    if (wanted.length === 0) {
      throw new Error("Nama remote tidak dikenal");
    }

    const branchR = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT_LOCAL_MS);
    const branch = branchR.ok ? branchR.out.trim() : "";

    // 1) commit bila ada file kotor (tanpa artefak `repo`)
    const pre = await getRepoStatus();
    let committed = false;
    let commitHash: string | null = null;
    let filesCommitted = 0;

    if (pre.ok && pre.dirtyCount > 0) {
      const addR = await runGit(["add", "-A", "--", ".", ...PATHSPEC_EXCLUDES], GIT_TIMEOUT_LOCAL_MS);
      if (!addR.ok) {
        await logSync({ action, status: "GAGAL", branch, message, detail: `git add gagal: ${addR.err}`, byName });
        throw new Error(`Gagal men-stage perubahan: ${addR.err}`);
      }
      filesCommitted = pre.dirtyCount;
      const idArgs = await commitArgs();
      const commitR = await runGit([...idArgs, "commit", "-m", message], GIT_TIMEOUT_LOCAL_MS);
      if (commitR.ok) {
        committed = true;
        const hashR = await runGit(["rev-parse", "--short", "HEAD"], GIT_TIMEOUT_LOCAL_MS);
        commitHash = hashR.ok ? hashR.out.trim() : null;
      } else if (commitR.err.includes("nothing to commit") || commitR.err.includes("no changes added")) {
        committed = false; // race: perubahan sudah ter-commit di antaranya
      } else {
        await logSync({ action, status: "GAGAL", branch, message, detail: `git commit gagal: ${commitR.err}`, byName });
        throw new Error(`Gagal membuat commit: ${commitR.err}`);
      }
    }

    // 2) push per remote (commit baru MAUPUN commit lama yang belum terkirim)
    const remotes: GitPushRemoteResult[] = [];
    for (const name of wanted) {
      const pushR = await runGit(["push", name, branch || "HEAD"], GIT_TIMEOUT_NETWORK_MS);
      if (pushR.ok) {
        remotes.push({
          name,
          ok: true,
          detail: committed
            ? `Commit ${commitHash ?? "?"} terkirim (${filesCommitted} file)`
            : "Semua commit lokal sudah terkirim",
        });
      } else if (pushR.err.includes("no upstream") || pushR.err.includes("--set-upstream")) {
        const upR = await runGit(["push", "-u", name, branch || "HEAD"], GIT_TIMEOUT_NETWORK_MS);
        remotes.push(
          upR.ok
            ? { name, ok: true, detail: `Commit terkirim (upstream baru ${name}/${branch})` }
            : { name, ok: false, detail: upR.err.slice(0, 400) },
        );
      } else {
        remotes.push({ name, ok: false, detail: pushR.err.slice(0, 400) });
      }
    }

    const anyOk = remotes.some((r) => r.ok);
    const nothingToDo = !committed && !anyOk;

    // 3) log hasil
    await logSync({
      action,
      status: anyOk ? "OK" : "GAGAL",
      branch,
      message,
      detail: remotes.map((r) => `${r.name}: ${r.ok ? "OK" : "GAGAL"} — ${r.detail}`).join(" | "),
      byName,
    });

    return {
      committed,
      commitHash,
      commitMessage: message,
      filesCommitted,
      nothingToDo,
      remotes,
    };
  });
}

// ------------------------------ PULL ------------------------------

/** Tarik perubahan terbaru (ff-only; autostash opsional bila worktree
 *  kotor). Menolak (error jelas) bila kotor TANPA autostash — mencegah
 *  kehilangan perubahan patch yang belum di-commit. */
export async function pullChanges(opts: {
  remote?: string;
  autostash?: boolean;
  byName: string;
}): Promise<GitPullResult> {
  return withSyncLock(async () => {
    const byName = (opts.byName || "konsol platform").slice(0, 120);
    const remoteName = opts.remote?.trim() || "origin";

    const available = await listRemoteNames();
    if (available.length === 0) throw new Error("Tidak ada remote git yang terdaftar pada repo ini");
    if (!available.includes(remoteName)) throw new Error(`Remote "${remoteName}" tidak dikenal`);

    const branchR = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT_LOCAL_MS);
    if (!branchR.ok) throw new Error(`Gagal membaca cabang aktif: ${branchR.err}`);
    const branch = branchR.out.trim();

    const pre = await getRepoStatus();
    if (pre.ok && pre.dirtyCount > 0 && !opts.autostash) {
      throw new Error(
        `Ada ${pre.dirtyCount} file berubah yang belum di-commit. Push dulu, atau aktifkan "simpan sementara (autostash)" lalu tarik ulang.`,
      );
    }

    const oldHeadR = await runGit(["rev-parse", "HEAD"], GIT_TIMEOUT_LOCAL_MS);
    const oldHead = oldHeadR.ok ? oldHeadR.out.trim() : "";

    const args = ["pull", "--ff-only"];
    if (opts.autostash) args.push("--autostash");
    args.push(remoteName, branch);
    const pullR = await runGit(args, GIT_TIMEOUT_NETWORK_MS);
    if (!pullR.ok) {
      await logSync({
        action: "PULL",
        status: "GAGAL",
        branch,
        message: remoteName,
        detail: pullR.err,
        byName,
      });
      throw new Error(`Pull gagal: ${pullR.err}`);
    }

    const newCommits: GitCommitInfo[] = [];
    let updated = false;
    if (oldHead) {
      const logR = await runGit(
        ["-c", "core.quotepath=false", "log", "--pretty=format:%h%x09%an%x09%ad%x09%s", "--date=short", `${oldHead}..HEAD`],
        GIT_TIMEOUT_LOCAL_MS,
      );
      if (logR.ok) {
        for (const line of logR.out.split("\n")) {
          const [hash, author, date, ...rest] = line.split("\t");
          if (!hash || !author) continue;
          newCommits.push({ hash, author, date, subject: rest.join("\t").slice(0, 160) });
        }
        updated = newCommits.length > 0;
      }
    }

    const output = maskGitSecrets((pullR.out || pullR.err).trim().split("\n").filter(Boolean).join(" · ")).slice(0, 600);
    await logSync({
      action: "PULL",
      status: "OK",
      branch,
      message: remoteName,
      detail: updated ? `${newCommits.length} commit baru ditarik dari ${remoteName}/${branch}` : "Sudah terbaru (up to date)",
      byName,
    });

    return { updated, newCommits, output };
  });
}

// ------------------------------ setelan + auto-push ------------------------------

/** Baca setelan auto-push (default: nonaktif). */
export async function getAutoPushEnabled(): Promise<boolean> {
  try {
    const row = await platformDb.platformSetting.findUnique({ where: { key: SETTING_AUTO_PUSH } });
    return row?.value === "true";
  } catch {
    return false;
  }
}

/** Ubah setelan auto-push. */
export async function setAutoPushEnabled(enabled: boolean): Promise<void> {
  await platformDb.platformSetting.upsert({
    where: { key: SETTING_AUTO_PUSH },
    update: { value: enabled ? "true" : "false" },
    create: { key: SETTING_AUTO_PUSH, value: enabled ? "true" : "false" },
  });
}

/**
 * AUTO-PUSH pasca-persetujuan patch (P8). Dipanggil best-effort dari
 * decidePatchProposal SETELAH file diterapkan & transaksi DB sukses —
 * kegagalan di sini TIDAK PERNAH menggagalkan persetujuan patch.
 * Pesan commit merujuk nomor tiket agar jejak GitHub ↔ tiket nyambung.
 */
export async function maybeAutoPushAfterPatch(
  ticketNo: string,
  filePath: string,
  deciderName: string,
): Promise<void> {
  if (!(await getAutoPushEnabled())) return;
  try {
    await pushChanges({
      message: `fix(${ticketNo}): ${filePath} — patch disetujui oleh ${deciderName} [auto]`,
      byName: `Auto (${deciderName})`,
      action: "AUTO_PUSH",
    });
  } catch (e) {
    console.warn("[github-sync] auto-push pasca-patch gagal (best-effort):", e instanceof Error ? e.message : e);
  }
}
