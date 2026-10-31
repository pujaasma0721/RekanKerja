// RekanKerja — Online Support P4 (FEAT-SUPPORT-P4): usulan patch + approval =
// =====================================================================
// LEVEL 4 agen support — mengusulkan PERBAIKAN KODE (patch), BUKAN
// menerapkannya. Alur aman oleh konstruksi:
//   1. propose_patch (tool, dipanggil agen di loop ReAct): agen mengirim
//      path + deskripsi + replacements [{search, replace}] persis. SERVER
//      membaca isi file sendiri (teks dari model tidak pernah dipercaya
//      sebagai "isi file"), memverifikasi tiap cuplikan search muncul
//      TEPAT SATU kali, lalu menyimpan usulan berikut:
//        · unified diff (dihitung server — utk review manusia di UI),
//        · hash sha256 isi file saat usulan (baseHash — deteksi konflik),
//        · snapshot replacementsJson (audit + penerapan ulang).
//      TIDAK ADA file yang ditulis pada tahap ini.
//   2. Keputusan manusia (API ticket-patches, op support:service/manage):
//        · approve → re-verifikasi hash (file tak berubah sejak usulan) →
//          terapkan replacements → tulis file (temp+rename, atomic) →
//          status DISETUJUI + pesan SYSTEM di utas + ActivityLog.
//        · reject  → status DITOLAK + pesan SYSTEM + ActivityLog.
//        · hash tak cocok / cuplikan tak unik lagi → status KONFLIK
//          (file berubah setelah usulan — usul ulang diperlukan).
//   3. Agen melihat keputusan sebagai pesan [catatan sistem] pada giliran
//      berikutnya → umpan balik jujur (tak pernah mengklaim "sudah
//      diperbaiki" tanpa persetujuan nyata).
// GUARD PATH (lebih ketat dari read_file): hanya src/ prisma/ scripts/,
// tanpa dotfile/segmen direktori terlarang (generated/db/audit/…), tanpa
// file infrastruktur (schema*.prisma, tenant-ddl*.sql, package.json).
// =====================================================================
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import type { SupportToolResult } from "@/rekankerja/support/services/support-tools";
import { maybeAutoPushAfterPatch } from "@/rekankerja/platform/services/github-sync";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/rekankerja/shared/services/access-scope";
import { db as platformDb } from "@/lib/db";
import { tenantSchemaOfDb } from "@/rekankerja/shared/lib/field-crypto";

const execFileAsync = promisify(execFile);

// ------------------------------ konstanta ------------------------------

/** Ukuran file maksimal yang boleh diusulkan patch-nya. */
const PATCH_MAX_FILE_BYTES = 400_000;
/** Maksimum penggantian per usulan. */
const PATCH_MAX_REPLACEMENTS = 3;
/** Panjang cuplikan search/replace (karakter). */
const PATCH_MAX_SEARCH_CHARS = 600;
const PATCH_MAX_REPLACE_CHARS = 2_400;
/** Maksimum usulan berstatus MENUNGGU per tiket (anti-spam). */
const PATCH_MAX_OPEN_PER_TICKET = 3;
/** Baris konteks kiri/kanan tiap hunk diff. */
const DIFF_CONTEXT_LINES = 3;
/** Batas total baris diff yang disimpan/ditampilkan. */
const DIFF_MAX_LINES = 400;

/** Ekstensi file yang boleh dipatch (sama dengan TEXT_EXTS read_file). */
const PATCH_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".prisma", ".sql", ".json", ".md"]);

/** Segmen direktori yang DILARANG ada di path usulan patch ( generated/
 *  db/audit/… — hasil build, data, atau artefak rahasia). */
const PATCH_SKIP_SEGMENTS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "generated", "db", "audit", "tmp", ".turbo", "coverage",
]);

/** File infrastruktur yang butuh langkah lanjutan (regen client / migrasi /
 *  instalasi) — di luar kemampuan patch atomik, wajib lewat developer. */
const PATCH_DENIED_FILES = new Set([
  "package.json",
  "prisma/schema.prisma",
  "prisma/schema-tenant.prisma",
  "prisma/tenant-ddl.sql",
  "prisma/tenant-ddl-attendance.sql",
]);

// ------------------------------ tata kelola ------------------------------

/** Apakah usulan patch (L4) diaktifkan utk tenant ini? (SupportAgentConfig;
 *  baris ABSEN / kolom belum termigrasi → true — konsisten P2/P3; guard
 *  sesungguhnya: approval manusia + whitelist + verifikasi hash.) */
export async function patchEnabledFor(db: TenantDb): Promise<boolean> {
  try {
    const row = await db.supportAgentConfig.findFirst();
    return row ? row.patchEnabled !== false : true;
  } catch {
    return true; // tabel/kolom belum ada (parity akan menyembuhkan)
  }
}

// ------------------------------ validasi path ------------------------------

/** Validasi path relatif aman KHUSUS patch (lebih ketat dari safeResolve
 *  read_file: segmen direktori terlarang dicek di SEMUA tingkat, plus
 *  denylist file infrastruktur). Return absolut path bila lolos. */
function patchSafeResolve(relPath: string): string | null {
  const p = relPath.trim().replace(/\\/g, "/");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\0")) return null;
  if (p.includes("..")) return null;
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.some((sg) => sg.startsWith(".") || PATCH_SKIP_SEGMENTS.has(sg))) return null;
  const top = segs[0];
  if (top !== "src" && top !== "scripts" && top !== "prisma") return null;
  if (PATCH_DENIED_FILES.has(p)) return null;
  if (!PATCH_EXTS.has(path.extname(p).toLowerCase())) return null;
  const abs = path.resolve(process.cwd(), p);
  if (!abs.startsWith(process.cwd() + path.sep)) return null; // belt & suspenders
  return abs;
}

// ------------------------------ diff builder ------------------------------

export interface PatchReplacement {
  search: string;
  replace: string;
}

/** Hitung unified diff per-replacement terhadap isi file asli.
 *  Line number sisi "+" dihitung presisi lewat delta kumulatif hunk
 *  sebelumnya. Return null bila cuplikan tak unik (seharusnya sudah
 *  diverifikasi pemanggil — sabuk pengaman). */
export function buildUnifiedDiff(filePath: string, original: string, reps: PatchReplacement[]): string | null {
  let work = original;
  let cumDelta = 0; // delta baris bersih dari hunk sebelumnya
  const hunks: string[] = [];
  for (const rep of reps) {
    const hits = work.split(rep.search).length - 1;
    if (hits !== 1) return null;
    const idx = work.indexOf(rep.search);
    // baris tempat match berada (1-based)
    const startLine = work.slice(0, idx).split("\n").length;
    const matchLineCount = rep.search.split("\n").length;
    const endLine = startLine + matchLineCount - 1;

    const lines = work.split("\n");
    const first = startLine - 1; // 0-based baris pertama blok
    const last = endLine - 1; // 0-based baris terakhir blok
    // blok penuh (baris utuh yang memuat cuplikan) + hasil penggantian
    const blockOld = lines.slice(first, last + 1).join("\n");
    const blockNew = blockOld.replace(rep.search, rep.replace);
    const oldCount = blockOld.split("\n").length;
    const newCount = blockNew.split("\n").length;

    // konteks ±3 baris (di luar blok)
    const ctxStart = Math.max(0, first - DIFF_CONTEXT_LINES);
    const ctxEnd = Math.min(lines.length - 1, last + DIFF_CONTEXT_LINES);
    const body: string[] = [];
    for (let i = ctxStart; i < first; i++) body.push(` ${lines[i]}`);
    for (const l of blockOld.split("\n")) body.push(`-${l}`);
    for (const l of blockNew.split("\n")) body.push(`+${l}`);
    for (let i = last + 1; i <= ctxEnd; i++) body.push(` ${lines[i]}`);

    // header hunk presisi: panjang sisi lama/baru = konteks + blok
    const ctxBefore = first - ctxStart;
    const ctxAfter = ctxEnd - last;
    hunks.push(`@@ -${ctxStart + 1},${ctxBefore + oldCount + ctxAfter} +${ctxStart + 1 + cumDelta},${ctxBefore + newCount + ctxAfter} @@`);
    hunks.push(...body);
    cumDelta += newCount - oldCount;

    // terapkan ke kerja (hunk berikutnya dihitung terhadap hasil sementara)
    work = work.slice(0, idx) + rep.replace + work.slice(idx + rep.search.length);
  }
  let diff = [`--- a/${filePath}`, `+++ b/${filePath}`, ...hunks].join("\n");
  const total = diff.split("\n").length;
  if (total > DIFF_MAX_LINES) {
    diff = diff.split("\n").slice(0, DIFF_MAX_LINES).join("\n") + "\n… (diff dipotong — lihat selengkapnya di detail usulan)";
  }
  return diff;
}

// ------------------------------ notifikasi ------------------------------

/**
 * FIX discoverability (insiden "admin tidak melihat tiket utk di-approve"):
 * daftar AppUser yang berhak memutuskan usulan patch — SEMANTIK SAMA dengan
 * canManageAllTickets (support-auth):
 *   1. super admin aplikasi (AppUser.role Admin),
 *   2. platform OWNER/ADMIN tenant ini (diresolusi lewat brand schema client
 *      → registry Tenant → UserTenant; hrd@mii.co.id di demo MII ber-role
 *      AppUser "HR Manager" namun OWNER platform — tanpa jalur ini dia
 *      TIDAK akan ternotifikasi padahal dialah pemegang keputusan),
 *   3. pengguna UserMenuAccess mode ALL, atau CUSTOM yang memberi op manage
 *      pada menu support:service (ops absen = boleh — pola opAllowed).
 * Maksimum 15 penerima. Never-throw; query gagal → lewati sumber itu.
 */
async function supportManagerUserIds(db: TenantDb): Promise<string[]> {
  const out = new Set<string>();
  // (1) super admin aplikasi
  try {
    const supers = await db.appUser.findMany({
      where: { active: true, role: { in: SUPER_ADMIN_APP_ROLES } },
      select: { id: true },
      take: 15,
    });
    for (const s of supers) out.add(s.id);
  } catch {
    // tabel AppUser tak terbaca → lanjut polos
  }
  // (2) platform OWNER/ADMIN tenant ini — cari via email keanggotaan
  try {
    const schemaName = tenantSchemaOfDb(db);
    const tenant = await platformDb.tenant.findUnique({
      where: { schemaName },
      select: { id: true },
    });
    if (tenant) {
      const memberships = await platformDb.userTenant.findMany({
        where: { tenantId: tenant.id, role: { in: SUPER_ADMIN_PLATFORM_ROLES } },
        select: { user: { select: { email: true } } },
        take: 25,
      });
      const emails = memberships
        .map((m) => m.user?.email)
        .filter((e): e is string => !!e);
      if (emails.length > 0) {
        const owners = await db.appUser.findMany({
          where: { active: true, email: { in: emails } },
          select: { id: true },
          take: 15,
        });
        for (const o of owners) out.add(o.id);
      }
    }
  } catch {
    // brand schema tak tersedia (mis. client transaksi) / platform DB tak
    // terbaca → sumber ini dilewati — super admin + menu access tetap jalan
  }
  // (3) hak akses menu eksplisit
  try {
    const rows = await db.userMenuAccess.findMany({
      select: { appUserId: true, mode: true, menusJson: true },
      take: 500,
    });
    for (const r of rows) {
      if (r.mode === "ALL") {
        out.add(r.appUserId);
        continue;
      }
      try {
        const v = JSON.parse(r.menusJson) as Record<string, unknown>;
        const perm = v?.["support:service"];
        if (perm && typeof perm === "object") {
          const p = perm as { view?: unknown; ops?: Record<string, unknown> };
          if (p.view !== false && p.ops?.["op:manage"] !== false) out.add(r.appUserId);
        }
      } catch {
        // JSON rusak → lewati baris ini
      }
    }
  } catch {
    // tabel belum termigrasi → dua sumber di atas saja
  }
  return Array.from(out).slice(0, 15);
}

/**
 * Kirim notifikasi in-app "usulan patch menunggu keputusan" ke semua
 * pengelola support (fire-and-forget — TIDAK boleh mengganggu tool result;
 * kegagalan total dicatat console saja, pola notification-service).
 */
async function notifyPatchProposed(
  db: TenantDb,
  ticketId: string,
  filePath: string,
  description: string,
): Promise<void> {
  try {
    const [ticket, userIds] = await Promise.all([
      db.supportTicket.findUnique({ where: { id: ticketId }, select: { ticketNo: true, subject: true } }),
      supportManagerUserIds(db),
    ]);
    if (!ticket || userIds.length === 0) return;
    const desc = description.length > 120 ? `${description.slice(0, 117)}…` : description;
    await Promise.all(
      userIds.map((appUserId) =>
        pushNotification(db, {
          appUserId,
          title: `Usulan patch baru menunggu keputusan — ${ticket.ticketNo}`,
          body: `${filePath} — ${desc}`,
          kind: "support",
          link: "support:service",
        }),
      ),
    );
  } catch (e) {
    console.warn("[support-patch] notifikasi usulan gagal:", e instanceof Error ? e.message : e);
  }
}

// ------------------------------ tool agen ------------------------------

/** Tool 7 — propose_patch: simpan USULAN perbaikan (tidak menulis file). */
export async function proposePatchTool(
  db: TenantDb,
  ticketId: string,
  args: Record<string, unknown>,
): Promise<SupportToolResult> {
  if (!(await patchEnabledFor(db))) {
    return {
      ok: false,
      output: "DITOLAK: mode usulan patch sedang DIMATIKAN admin tenant Anda. Jangan mengaku telah mengajukan usulan — jelaskan jujur bahwa fitur ini nonaktif dan arahkan ke admin/developer.",
    };
  }

  const filePath = String(args.path ?? "").trim();
  const description = String(args.description ?? "").trim();
  const repsRaw = args.replacements;

  if (!filePath) return { ok: false, output: "Parameter 'path' wajib diisi (path relatif file yang diperbaiki)." };
  if (description.length < 10 || description.length > 500) {
    return { ok: false, output: "Parameter 'description' wajib 10–500 karakter (ringkasan perbaikan & alasannya untuk reviewer)." };
  }
  if (!Array.isArray(repsRaw) || repsRaw.length < 1 || repsRaw.length > PATCH_MAX_REPLACEMENTS) {
    return { ok: false, output: `Parameter 'replacements' wajib array 1–${PATCH_MAX_REPLACEMENTS} objek {"search":"…","replace":"…"}.` };
  }
  const reps: PatchReplacement[] = [];
  for (let i = 0; i < repsRaw.length; i++) {
    const r = repsRaw[i] as Record<string, unknown> | null;
    const search = typeof r?.search === "string" ? r.search : "";
    const replace = typeof r?.replace === "string" ? r.replace : "";
    if (!search || search.length > PATCH_MAX_SEARCH_CHARS) {
      return { ok: false, output: `replacements[${i}].search wajib diisi 1–${PATCH_MAX_SEARCH_CHARS} karakter (cuplikan kode PERSIS dari file).` };
    }
    if (replace.length > PATCH_MAX_REPLACE_CHARS) {
      return { ok: false, output: `replacements[${i}].replace maksimal ${PATCH_MAX_REPLACE_CHARS} karakter — pecah menjadi beberapa usulan bila perlu.` };
    }
    if (search === replace) {
      return { ok: false, output: `replacements[${i}]: search dan replace identik (tidak ada perubahan).` };
    }
    reps.push({ search, replace });
  }

  const abs = patchSafeResolve(filePath);
  if (!abs) {
    return {
      ok: false,
      output: `Path "${filePath.slice(0, 120)}" tidak diizinkan untuk usulan patch. Gunakan path relatif file kode di dalam src/, prisma/, atau scripts/ (bukan file infrastruktur seperti schema*.prisma / tenant-ddl.sql / package.json).`,
    };
  }
  let st: import("node:fs").Stats;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, output: `File "${filePath}" tidak ditemukan — WAJIB membaca file dengan read_file terlebih dulu, lalu salin cuplikan PERSIS darinya.` };
  }
  if (!st.isFile() || st.size > PATCH_MAX_FILE_BYTES) {
    return { ok: false, output: `File "${filePath}" tidak dapat dipatch (terlalu besar / bukan file reguler).` };
  }
  const original = await fs.readFile(abs, "utf8").catch(() => null);
  if (original == null) return { ok: false, output: `Gagal membaca "${filePath}".` };

  // verifikasi tiap cuplikan muncul TEPAT SATU kali (berurutan pada hasil
  // kerja sementara — sehingga penggantian saling berkelanjutan pun aman)
  let work = original;
  for (let i = 0; i < reps.length; i++) {
    const hits = work.split(reps[i].search).length - 1;
    if (hits === 0) {
      return {
        ok: false,
        output: `GAGAL: cuplikan search #${i + 1} TIDAK ditemukan di "${filePath}". Salin PERSIS hasil read_file (termasuk spasi/indentasi/tab) — jangan mengetik ulang dari ingatan.`,
      };
    }
    if (hits > 1) {
      return { ok: false, output: `GAGAL: cuplikan search #${i + 1} ditemukan ${hits}× di "${filePath}" — perluas cuplikan (sertakan baris sekitar) agar menjadi unik.` };
    }
    work = work.replace(reps[i].search, reps[i].replace);
  }

  const diff = buildUnifiedDiff(filePath, original, reps);
  if (diff == null) return { ok: false, output: "GAGAL: cuplikan tidak unik saat diff dihitung — perluas cuplikan search." };

  // anti-spam: maksimum N usulan terbuka per tiket
  let open = 0;
  try {
    open = await db.supportPatchProposal.count({ where: { ticketId, status: "MENUNGGU" } });
  } catch {
    return { ok: false, output: "DITOLAK: penyimpanan usulan gagal (tabel usulan belum siap — minta admin menjalankan parity)." };
  }
  if (open >= PATCH_MAX_OPEN_PER_TICKET) {
    return { ok: false, output: `DITOLAK: sudah ada ${open} usulan menunggu keputusan pada tiket ini (maksimum ${PATCH_MAX_OPEN_PER_TICKET}). Tunggu developer meninjau usulan sebelumnya, lalu ajukan ulang bila perlu.` };
  }

  const added = diff.split("\n").filter((l) => l.startsWith("+")).length;
  const removed = diff.split("\n").filter((l) => l.startsWith("-")).length;
  const proposal = await db.supportPatchProposal.create({
    data: {
      ticketId,
      filePath,
      description,
      diffText: diff,
      replacementsJson: JSON.stringify(reps),
      baseHash: createHash("sha256").update(original, "utf8").digest("hex"),
      baseLineCount: original.split("\n").length,
    },
    select: { id: true },
  });

  // FIX discoverability — begitu usulan tersimpan, pengelola support langsung
  // dikirimi notifikasi in-app (sebelumnya usulan HANYA terlihat bila admin
  // kebetulan membuka tiketnya satu per satu — akar insiden "admin login tapi
  // tidak ada tiket utk di-approve"). Fire-and-forget, never-throw.
  void notifyPatchProposed(db, ticketId, filePath, description);

  return {
    ok: true,
    output:
      `USULAN PATCH TERSIMPAN (#${proposal.id.slice(-6).toUpperCase()}) — status MENUNGGU PERSETUJUAN DEVELOPER.\n` +
      `File: ${filePath} · ${reps.length} perubahan (+${added}/-${removed} baris).\n` +
      `PENTING: file BELUM diubah sedikit pun — perubahan baru diterapkan SETELAH developer manusia menyetujuinya. ` +
      `Sampaikan ke pengguna bahwa Anda telah mengajukan usulan perbaikan yang sedang menunggu tinjauan developer. ` +
      `JANGAN PERNAH mengklaim bahwa perbaikan sudah diterapkan/diperbaiki.`,
  };
}

// ------------------------- verifikasi pra-terap (R3 audit-2) -------------------------

/** Batas waktu tsc --noEmit utk verifikasi pra-terap (proyek besar ±15 dtk). */
const VERIFY_TIMEOUT_MS = 180_000;

/** Jalankan `tsc --noEmit` atas SALINAN sementara isi hasil patch.
 *
 *  R3 (audit-2): patch yang merujuk identifier tak terdefinisi (mis.
 *  memakai t() tanpa import — kasus NYATA saat audit 2026-10-30: usulan
 *  #N9BWJ9 pasti merusak build bila disetujui) akan tertangkap SEBELUM
 *  file asli ditulis. Mekanisme:
 *    1. salinan isi-pasca-patch ditulis sebagai <nama>.__verify__.<ext> DI
 *       SEBELAH file asli (resolusi import relatif identik),
 *    2. dibuat tsconfig SEMENTARA (extends root) yang include HANYA
 *       salinan itu — tsc memeriksa salinan + seluruh rantai dependensinya.
 *       Program terbatas closure jauh lebih ringan daripada seluruh proyek
 *       (uji nyata: proyek penuh OOM di server RAM 4GB; closure = ±3 dtk),
 *    3. HANYA error yang menunjuk file salinan yang dianggap gagal —
 *       error di file lain = noise pra-ada, tidak menghalangi,
 *    4. salinan + tsconfig sementara SELALU dihapus (try/finally) —
 *       pattern-nya juga di-gitignore.
 *
 *  Best-effort: typescript tak terpasang (deploy standalone tanpa devDeps)
 *  / timeout / OOM → verifikasi DILEWATI (perilaku pra-R3) dan alasannya
 *  dikembalikan sebagai `skipped` — approval tidak diblok oleh lingkungan.
 */
async function typecheckPatchedFile(
  relPath: string,
  abs: string,
  patchedContent: string,
): Promise<{ errors: string[]; skipped?: string }> {
  const tscJs = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc");
  try {
    await fs.access(tscJs);
  } catch {
    return { errors: [], skipped: "typescript tidak terpasang di lingkungan ini" };
  }
  const ext = path.extname(abs);
  const tmpAbs = abs.slice(0, abs.length - ext.length) + ".__verify__" + ext;
  const tmpRel = relPath.slice(0, relPath.length - ext.length) + ".__verify__" + ext;
  const cfgName = `.tsc-verify.${Date.now().toString(36)}.json`;
  const cfgPath = path.join(process.cwd(), cfgName);
  try {
    await fs.writeFile(tmpAbs, patchedContent, "utf8");
    await fs.writeFile(
      cfgPath,
      JSON.stringify({ extends: "./tsconfig.json", include: [tmpRel], exclude: [], compilerOptions: { incremental: false } }),
      "utf8",
    );
    const stdout = await runTsc([tscJs, "-p", cfgName, "--noEmit", "--pretty", "false"]);
    const errors = String(stdout)
      .split("\n")
      .filter((l) => l.includes(".__verify__") && / error TS\d+: /.test(l))
      .slice(0, 8)
      .map((l) => l.trim().slice(0, 240));
    return { errors };
  } catch (e) {
    return { errors: [], skipped: e instanceof Error ? e.message : String(e) };
  } finally {
    await fs.rm(tmpAbs, { force: true }).catch(() => { /* best-effort */ });
    await fs.rm(cfgPath, { force: true }).catch(() => { /* best-effort */ });
  }
}

/** Jalankan binary tsc. Runtime utama = `node` (membaca NODE_OPTIONS
 *  --max-old-space-size; tsc di bawah bun OOM pada server RAM kecil);
 *  fallback process.execPath bila node tidak ada. Exit code != 0 dengan
 *  stdout terisi = tsc menemukan error — stdout dikembalikan utk diparse. */
async function runTsc(args: string[]): Promise<string> {
  const opts = {
    cwd: process.cwd(),
    timeout: VERIFY_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
  };
  const parse = (stdout?: string | Buffer) => (typeof stdout === "string" && stdout.length > 0 ? stdout : null);
  try {
    const r = await execFileAsync("node", args, opts);
    return String(r.stdout);
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string | Buffer; killed?: boolean };
    if (err.code === "ENOENT") {
      // node tak ada → coba runtime proses ini (bun di dev sandbox)
      try {
        const r = await execFileAsync(process.execPath, args, opts);
        return String(r.stdout);
      } catch (e2) {
        const err2 = e2 as NodeJS.ErrnoException & { stdout?: string | Buffer; killed?: boolean };
        const out2 = parse(err2.stdout);
        if (out2) return out2;
        throw new Error(err2.killed ? "tsc berakhir karena timeout/OOM" : err2.message ?? "tsc gagal dijalankan");
      }
    }
    const out = parse(err.stdout);
    if (out) return out;
    throw new Error(err.killed ? "tsc berakhir karena timeout/OOM" : err.message ?? "tsc gagal dijalankan");
  }
}

// ------------------------------ keputusan manusia ------------------------------

export interface PatchReviewer {
  id: string | null;
  name: string;
}

/** Hasil keputusan — dipakai route utk kode HTTP. */
export type PatchDecisionResult =
  | { ok: true; status: "DISETUJUI" | "DITOLAK" | "KONFLIK" }
  | { ok: false; httpStatus: number; error: string; typecheckErrors?: string[] };

/** Terapkan/tolak usulan (dipanggil route patches — op support:service/manage).
 *  Semua efek samping (file, status, pesan SYSTEM, ActivityLog) terjadi
 *  HANYA di sini — tool agen tidak punya jalur tulis apa pun. */
export async function decidePatchProposal(
  db: TenantDb,
  ticketId: string,
  proposalId: string,
  decision: "approve" | "reject",
  reviewer: PatchReviewer,
  note: string | null,
): Promise<PatchDecisionResult> {
  let p;
  try {
    p = await db.supportPatchProposal.findUnique({ where: { id: proposalId } });
  } catch {
    return { ok: false, httpStatus: 500, error: "Tabel usulan patch tidak siap (parity belum berjalan)" };
  }
  if (!p || p.ticketId !== ticketId) return { ok: false, httpStatus: 404, error: "Usulan patch tidak ditemukan" };
  if (p.status !== "MENUNGGU") {
    return { ok: false, httpStatus: 409, error: `Usulan sudah diputuskan sebelumnya (status: ${p.status})` };
  }
  const noteClean = note?.trim().slice(0, 500) || null;
  const nama = reviewer.name.trim() || "developer";

  // ---------- TOLAK ----------
  if (decision === "reject") {
    await db.$transaction([
      db.supportPatchProposal.update({
        where: { id: p.id },
        data: {
          status: "DITOLAK",
          decidedById: reviewer.id,
          decidedByName: nama,
          decidedAt: new Date(),
          decisionNote: noteClean,
        },
      }),
      db.supportMessage.create({
        data: {
          ticketId,
          senderRole: "SYSTEM",
          senderName: "Sistem",
          body: `Usulan patch "${p.filePath}" DITOLAK oleh ${nama}${noteClean ? ` — catatan: ${noteClean}` : ""}.`,
        },
      }),
      db.supportTicket.update({ where: { id: ticketId }, data: { lastMessageAt: new Date() } }),
    ]);
    await db.activityLog.create({
      data: {
        action: "Rejected",
        entity: "SupportPatchProposal",
        entityId: p.id,
        appUserId: reviewer.id ?? undefined,
        detail: `Usulan patch "${p.filePath}" ditolak oleh ${nama}${noteClean ? ` (${noteClean})` : ""}`,
      },
    }).catch(() => { /* audit best-effort — keputusan tetap sah */ });
    return { ok: true, status: "DITOLAK" };
  }

  // ---------- SETUJUI (+ terapkan) ----------
  const abs = patchSafeResolve(p.filePath);
  if (!abs) {
    return {
      ok: false,
      httpStatus: 409,
      error: "Path usulan tidak lagi lolos kebijakan patch (file infrastruktur/terlarang) — tolak usulan ini dan minta agen mengusulkan ulang",
    };
  }
  let current: string;
  try {
    const stNow = await fs.stat(abs);
    if (!stNow.isFile()) throw new Error("bukan file");
    current = await fs.readFile(abs, "utf8");
  } catch {
    await db.supportPatchProposal.update({
      where: { id: p.id },
      data: { status: "KONFLIK", decidedById: reviewer.id, decidedByName: nama, decidedAt: new Date(), decisionNote: "File tidak lagi dapat dibaca" },
    });
    return { ok: false, httpStatus: 409, error: "File usulan tidak lagi dapat dibaca — tandai KONFLIK" };
  }
  const hashNow = createHash("sha256").update(current, "utf8").digest("hex");
  if (hashNow !== p.baseHash) {
    await db.$transaction([
      db.supportPatchProposal.update({
        where: { id: p.id },
        data: { status: "KONFLIK", decidedById: reviewer.id, decidedByName: nama, decidedAt: new Date(), decisionNote: noteClean ?? "Isi file berubah sejak usulan dibuat" },
      }),
      db.supportMessage.create({
        data: {
          ticketId,
          senderRole: "SYSTEM",
          senderName: "Sistem",
          body: `Usulan patch "${p.filePath}" batal ditinjau — isi file telah berubah sejak usulan dibuat (KONFLIK). Agen diminta mengusulkan ulang berdasarkan isi terbaru.`,
        },
      }),
    ]);
    return { ok: false, httpStatus: 409, error: "Isi file telah berubah sejak usulan dibuat — usulan ditandai KONFLIK; agen dapat mengajukan ulang" };
  }

  // terapkan replacements (re-verifikasi keunikan pada isi terkini)
  let reps: PatchReplacement[] = [];
  try {
    const parsed = JSON.parse(p.replacementsJson) as PatchReplacement[];
    if (Array.isArray(parsed)) reps = parsed;
  } catch { /* json korup → konflik */ }
  let next = current;
  for (const rep of reps) {
    const hits = next.split(rep.search).length - 1;
    if (hits !== 1) {
      await db.supportPatchProposal.update({
        where: { id: p.id },
        data: { status: "KONFLIK", decidedById: reviewer.id, decidedByName: nama, decidedAt: new Date(), decisionNote: "Cuplikan tidak lagi unik saat penerapan" },
      });
      return { ok: false, httpStatus: 409, error: "Cuplikan patch tidak lagi persis unik di file — usulan ditandai KONFLIK" };
    }
    next = next.replace(rep.search, rep.replace);
  }
  if (next === current) {
    return { ok: false, httpStatus: 409, error: "Patch menghasilkan isi identik — tidak ada yang diterapkan" };
  }

  // ---------- R3 (audit-2): VERIFIKASI TYPECHECK PRA-TERAPAN ----------
  // Hanya file TS di bawah src/ (bagian yang benar2 di-check oleh build).
  // Gagal → usulan TETAP MENUNGGU (bukan KONFLIK — file belum tersentuh);
  // reviewer melihat error TypeScript-nya dan bisa menolak/minta usul ulang.
  if (/^src\//.test(p.filePath) && /\.(ts|tsx)$/.test(p.filePath)) {
    const verify = await typecheckPatchedFile(p.filePath, abs, next);
    if (verify.skipped) {
      console.warn(`[support-patch] verifikasi pra-terap DILEWATI (${p.filePath}): ${verify.skipped}`);
    }
    if (verify.errors.length > 0) {
      return {
        ok: false,
        httpStatus: 422,
        error:
          `Verifikasi typecheck GAGAL — patch TIDAK diterapkan, file belum diubah, usulan tetap menunggu. ` +
          `Perbaiki usulan (atau tolak): ${verify.errors.slice(0, 3).join(" · ")}`,
        typecheckErrors: verify.errors,
      };
    }
  }

  // tulis file secara atomik (temp + rename di direktori yang sama)
  try {
    const tmp = abs + ".patch-tmp";
    await fs.writeFile(tmp, next, "utf8");
    await fs.rename(tmp, abs);
  } catch (e) {
    return { ok: false, httpStatus: 500, error: `Gagal menulis file: ${e instanceof Error ? e.message : "unknown"}` };
  }

  await db.$transaction([
    db.supportPatchProposal.update({
      where: { id: p.id },
      data: {
        status: "DISETUJUI",
        decidedById: reviewer.id,
        decidedByName: nama,
        decidedAt: new Date(),
        decisionNote: noteClean,
      },
    }),
    db.supportMessage.create({
      data: {
        ticketId,
        senderRole: "SYSTEM",
        senderName: "Sistem",
        body: `Usulan patch "${p.filePath}" DISETUJUI oleh ${nama} dan telah diterapkan ke file aplikasi.${noteClean ? ` Catatan: ${noteClean}` : ""}`,
      },
    }),
    db.supportTicket.update({ where: { id: ticketId }, data: { lastMessageAt: new Date() } }),
  ]);
  await db.activityLog.create({
    data: {
      action: "Approved",
      entity: "SupportPatchProposal",
      entityId: p.id,
      appUserId: reviewer.id ?? undefined,
      detail: `Usulan patch "${p.filePath}" disetujui & diterapkan oleh ${nama}${noteClean ? ` (${noteClean})` : ""}`,
    },
  }).catch(() => { /* audit best-effort */ });

  // P8 — auto-push (bila pemilik aplikasi mengaktifkannya): commit + push
  // perubahan (termasuk file patch ini) ke GitHub dengan pesan yang merujuk
  // nomor tiket. Fire-and-forget — kegagalan sync TIDAK menggagalkan
  // persetujuan yang sudah sah (file diterapkan & pesan sistem terkirim).
  try {
    const tk = await db.supportTicket.findUnique({ where: { id: ticketId }, select: { ticketNo: true } });
    if (tk) void maybeAutoPushAfterPatch(tk.ticketNo, p.filePath, nama).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }

  return { ok: true, status: "DISETUJUI" };
}
