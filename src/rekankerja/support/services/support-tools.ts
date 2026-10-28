// RekanKerja — Online Support P2 (FEAT-SUPPORT-P2): alat baca agen. =====
// =====================================================================
// 4 TOOL READ-ONLY yang boleh dipakai agen support (level otonomi L2)
// selama satu giliran menjawab — dijalankan loop ReAct di support-agent.ts
// (protokol teks TOOL_CALL/ARGS — provider tanpa native function calling):
//   1. search_code — cari teks literal di kode sumber aplikasi (src/,
//      prisma/, scripts/, *.md root). Case-insensitive, dibatasi.
//   2. read_file  — baca potongan file (path WAJIB relatif root proyek;
//      jendela maks ±250 baris per panggilan).
//   3. query_db   — SATU pernyataan SELECT/WITH read-only ke database
//      TENANT AKTIF (isolasi tenant tetap utuh — client schema-tenant).
//   4. read_logs  — baca ekor log server aplikasi (dibatasi + terscrub).
//
// PRINSIP KEAMANAN (audit-tested):
//   · Tidak ada tool yang menulis apa pun (murni baca).
//   · Path: relative-only, tanpa "..", deny dotfile/env/kunci/db/audit/tmp/
//     node_modules/.next/generated; ekstensi whitelist teks saja.
//   · SQL: satu pernyataan, wajib SELECT/WITH, token terlarang ditolak
//     (DML/DDL/session/pg_*), dibungkus subquery LIMIT, statement_timeout,
//     denylist TABEL RAHASIA (kredensial/privasi), redaksi nilai kolom
//     uang & kredensial ([DISENSOR]), sel + total output dibatasi.
//   · Log: hanya ekor file log aplikasi, substring rahasia di-scrub.
//   · Semua hasil hanya jadi konteks ephemeral giliran LLM — TIDAK
//     disimpan ke database; hanya balasan akhir agen yang tersimpan.
// =====================================================================
import { promises as fs } from "node:fs";
import path from "node:path";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// ------------------------------ registry ------------------------------

export interface SupportToolResult {
  ok: boolean;
  /** Teks hasil siap disuntikkan ke konteks LLM (sudah terpotong & aman). */
  output: string;
}

/** Nama tool yang dikenal (dipakai prompt + parser). */
export const SUPPORT_TOOL_NAMES = ["search_code", "read_file", "query_db", "read_logs"] as const;
export type SupportToolName = (typeof SUPPORT_TOOL_NAMES)[number];

/** Label ramah untuk pill transparansi di UI (SYSTEM). */
export const TOOL_LABELS: Record<SupportToolName, string> = {
  search_code: "kode sumber",
  read_file: "kode sumber",
  query_db: "basis data",
  read_logs: "log server",
};

/** Apakah tools read-only diaktifkan utk tenant ini? (SupportAgentConfig;
 *  baris ABSEN → true; tabel belum termigrasi / instance DMMF lama → true —
 *  default aman: seluruh tool hanya-baca + diguard berlapis.) */
export async function toolsEnabledFor(db: TenantDb): Promise<boolean> {
  try {
    const row = await db.supportAgentConfig.findFirst();
    return row ? row.toolsEnabled !== false : true;
  } catch {
    return true; // tabel belum ada (parity akan menyembuhkan) — default ON
  }
}

/** Jalankan satu tool berdasarkan nama + args JSON terurai. */
export async function runSupportTool(
  db: TenantDb,
  name: string,
  args: Record<string, unknown>,
): Promise<SupportToolResult> {
  switch (name) {
    case "search_code":
      return searchCode(args);
    case "read_file":
      return readFileTool(args);
    case "query_db":
      return queryDb(db, args);
    case "read_logs":
      return readLogs(args);
    default:
      return { ok: false, output: `Tool "${name}" tidak dikenal. Yang tersedia: ${SUPPORT_TOOL_NAMES.join(", ")}.` };
  }
}

// ============================ 1) search_code ==========================

/** Direktori root yang boleh dicari (relatif cwd proyek). */
const CODE_ROOTS = ["src", "prisma", "scripts"];

/** Ekstensi file teks yang boleh dibaca/dicari. */
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".prisma", ".sql", ".json", ".md"]);

/** Direktori yang selalu dilewati (rahasia/biner/build/privasi). */
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "dist", "build", "generated", "db", "audit", "tmp", ".turbo", "coverage",
]);

const SEARCH_MAX_FILES = 1200;
const SEARCH_MAX_FILE_BYTES = 300_000;
const SEARCH_MAX_MATCHES = 25;
const LINE_TRUNC = 220;

async function walkFiles(rootAbs: string, baseRel: string, out: string[], budget: { count: number }): Promise<void> {
  if (budget.count >= SEARCH_MAX_FILES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch {
    return; // direktori tak terbaca → lewati
  }
  for (const e of entries) {
    if (budget.count >= SEARCH_MAX_FILES) return;
    if (e.name.startsWith(".")) continue; // dotfile/dotdir apa pun
    const rel = baseRel ? `${baseRel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walkFiles(path.join(rootAbs, e.name), rel, out, budget);
    } else if (e.isFile()) {
      if (!TEXT_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      out.push(rel);
      budget.count += 1;
    }
  }
}

/** Filter "glob" toleran: model LLM sering mengirim pola glob asli
 *  (mis. "src/…​/*.ts,src/…​/*.tsx") — dipecah per koma & garis miring,
 *  karakter bintang dibuang, lalu path dianggap COCOK bila MENGANDUNG
 *  salah satu token (substring). Pola kosong → tanpa filter. */
function globMatches(relPath: string, glob: string): boolean {
  const tokens = glob
    .toLowerCase()
    .split(/[,/]/)
    .map((s) => s.replace(/\*+/g, "").trim())
    .filter((s) => s.length >= 2);
  if (tokens.length === 0) return true;
  const p = relPath.toLowerCase();
  return tokens.some((tok) => p.includes(tok));
}

async function searchCode(args: Record<string, unknown>): Promise<SupportToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { ok: false, output: "Parameter 'query' wajib diisi (teks yang dicari)." };
  if (query.length > 200) return { ok: false, output: "Query terlalu panjang (maks 200 karakter)." };
  const glob = args.glob ? String(args.glob).trim().slice(0, 120) : "";
  const needle = query.toLowerCase();
  const cwd = process.cwd();

  const files: string[] = [];
  const budget = { count: 0 };
  for (const root of CODE_ROOTS) await walkFiles(path.join(cwd, root), root, files, budget);
  // dokumen desain di root proyek (mis. DEVELOPMENT-PLAN-*.md)
  try {
    for (const e of await fs.readdir(cwd, { withFileTypes: true })) {
      if (e.isFile() && path.extname(e.name).toLowerCase() === ".md" && files.length < SEARCH_MAX_FILES) files.push(e.name);
    }
  } catch { /* ignore */ }

  const matches: string[] = [];
  let scanned = 0;
  for (const rel of files) {
    if (glob && !globMatches(rel, glob)) continue;
    let content: string;
    try {
      const st = await fs.stat(path.join(cwd, rel));
      if (st.size > SEARCH_MAX_FILE_BYTES) continue;
      content = await fs.readFile(path.join(cwd, rel), "utf8");
    } catch {
      continue;
    }
    scanned += 1;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && matches.length < SEARCH_MAX_MATCHES; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        matches.push(`${rel}:${i + 1} | ${lines[i].trim().slice(0, LINE_TRUNC)}`);
      }
    }
    if (matches.length >= SEARCH_MAX_MATCHES) break;
  }
  if (matches.length === 0) {
    return { ok: true, output: `Tidak ditemukan kecocokan untuk "${query}"${glob ? ` (filter file: ${glob})` : ""} pada ${scanned} file kode.` };
  }
  return {
    ok: true,
    output: `Ditemukan ${matches.length} kecocokan (dari ${scanned} file):\n${matches.join("\n")}`,
  };
}

// ============================= 2) read_file ===========================

const READ_MAX_LINES = 250;
const READ_MAX_FILE_BYTES = 500_000;

/** Validasi path relatif aman → path absolut terkurung root proyek.
 *  Return null bila ditolak. Hanya boleh: src/ prisma/ scripts/ +
 *  *.md & package.json di root. */
function safeResolve(relPath: string): string | null {
  const p = relPath.trim().replace(/\\/g, "/");
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\0")) return null;
  if (p.includes("..")) return null;
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  if (segs.some((sg) => sg.startsWith("."))) return null; // dotfile/dotdir apa pun (.env/.git/.z-ai-config/…)
  const top = segs[0];
  const allowedTop = CODE_ROOTS.includes(top) || (segs.length === 1 && (top.endsWith(".md") || top === "package.json"));
  if (!allowedTop) return null;
  if (SKIP_DIRS.has(top)) return null;
  if (!TEXT_EXTS.has(path.extname(p).toLowerCase())) return null;
  const abs = path.resolve(process.cwd(), p);
  if (!abs.startsWith(process.cwd() + path.sep)) return null; // belt & suspenders
  return abs;
}

async function readFileTool(args: Record<string, unknown>): Promise<SupportToolResult> {
  const rel = String(args.path ?? "").trim();
  const abs = safeResolve(rel);
  if (!abs) {
    return { ok: false, output: `Path "${rel.slice(0, 120)}" tidak diizinkan. Gunakan path relatif di dalam src/, prisma/, scripts/, atau *.md / package.json di root proyek.` };
  }
  let st: import("node:fs").Stats;
  try {
    st = await fs.stat(abs);
  } catch {
    return { ok: false, output: `File "${rel}" tidak ditemukan.` };
  }
  if (!st.isFile() || st.size > READ_MAX_FILE_BYTES) {
    return { ok: false, output: `File "${rel}" bukan file teks yang dapat dibaca (terlalu besar / bukan file reguler).` };
  }
  const startLine = Math.max(1, Math.floor(Number(args.startLine) || 1));
  let endLine = Math.floor(Number(args.endLine) || 0);
  if (!endLine || endLine - startLine + 1 > READ_MAX_LINES) endLine = startLine + READ_MAX_LINES - 1;

  const content = await fs.readFile(abs, "utf8").catch(() => null);
  if (content == null) return { ok: false, output: `Gagal membaca "${rel}".` };
  const lines = content.split("\n");
  const total = lines.length;
  const from = Math.min(startLine, total);
  const to = Math.min(endLine, total);
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${i} | ${lines[i - 1].slice(0, LINE_TRUNC)}`);
  }
  return {
    ok: true,
    output: `"${rel}" (baris ${from}-${to} dari ${total}):\n${out.join("\n")}${to < total ? `\n… (dipotong — minta jendela baris berikutnya bila perlu)` : ""}`,
  };
}

// ============================== 3) query_db ===========================

/** Tabel yang DILARANG dibaca agen (kredensial/privasi orang lain).
 *  Lowercase — perbandingan via sqlTableRefs() selalu lowercase. */
const DB_DENIED_TABLES = new Set([
  // kredensial & rahasia
  "appuser", "passwordhistory", "apikey", "webhook", "webhookendpoint",
  "aiproviderconfig", "moneyvault", "waconfig", "pushconfig", "pushsubscription",
  "emailconfig", "signaturekey", "signaturechallenge", "machineimportbatch",
  // privasi komunikasi & kasus sensitif
  "directmessage", "aichatmessage", "whistleblowreport", "supportticket",
  "supportmessage", "datasubjectrequest", "disciplinaryrecord",
  // dokumen & berkas pribadi
  "attachment", "employeedocument", "applicantdocument", "cvparseresult",
  "signaturerecord", "esignrequest",
  // data medis & keluarga
  "medicalclaim", "medicalclaimline", "medicaladjustment", "policymember",
  "employeefamily", "emergencycontact",
  // payload integrasi & jejak kirim berisi data sensitif
  "webhooklog", "walog",
]);

/** Token yang membuat pernyataan ditolak (DML/DDL/session/obfuscation). */
const SQL_BANNED_RE =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|analyze|analyse|explain|call|do|merge|replace|reindex|cluster|listen|notify|lock|set|reset|comment|discard|prepare|execute|deallocate|reassign|import|foreign|security|savepoint|release|rollback|begin|commit|start|abort|close|declare|fetch|move)\b|--|\/\*|\*\/|;|\bpg_|current_setting|set_config|dblink|lo_|largeobject|read_file|pg_read/i;

/** Nama kolom yang nilainya DISENSOR (kredensial). */
const COL_SECRET_RE = /(password|passphrase|secret|token|apikey|api_key|datakey|privatekey|private_key|signature|salt|credential)/i;

/** Nama kolom bernilai UANG yang DISENSOR (gaji/klaim/anggaran). */
const COL_MONEY_RE = /(salary|amount|nominal|gross|netto|takehome|deduction|allowance|cost|price|budget|premi|insentif|tunjangan|upah|bruto)/i;

const DB_ROW_CAP = 200;
const DB_CELL_TRUNC = 180;
const DB_OUTPUT_CAP = 24_000;
const DB_TIMEOUT_MS = 8_000;

/** Ekstrak semua target FROM/JOIN utk cek denylist (quoted & bare). */
function sqlTableRefs(sql: string): string[] {
  const refs: string[] = [];
  const re = /(?:from|join)\s+((?:"[^"]+")|(?:[A-Za-z_][A-Za-z0-9_]*))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) refs.push(m[1].replace(/"/g, "").toLowerCase());
  return refs;
}

function cellToString(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "bigint") return v.toString(); // COUNT(*) PostgreSQL → BigInt
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Redaksi nilai kolom sensitif + potong sel. */
function sanitizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (v == null) { out[k] = null; continue; }
      out[k] = COL_SECRET_RE.test(k) || COL_MONEY_RE.test(k) ? "[DISENSOR]" : cellToString(v).slice(0, DB_CELL_TRUNC);
    }
    return out;
  });
}

async function queryDb(db: TenantDb, args: Record<string, unknown>): Promise<SupportToolResult> {
  const raw = String(args.sql ?? "").trim();
  if (!raw) return { ok: false, output: "Parameter 'sql' wajib diisi." };
  let sql = raw.replace(/;\s*$/, "");
  if (sql.length > 4_000) return { ok: false, output: "SQL terlalu panjang (maks 4.000 karakter)." };
  if (SQL_BANNED_RE.test(sql)) {
    return { ok: false, output: "DITOLAK: hanya pernyataan SELECT/WITH baca-satu yang diizinkan (tanpa DML/DDL/session/komentar/multi-statement)." };
  }
  if (!/^(select|with)\b/i.test(sql)) {
    return { ok: false, output: "DITOLAK: pernyataan harus diawali SELECT atau WITH." };
  }

  // Koreksi otomatis nama tabel TANPA KUTIP (model LLM sering menulis
  // `FROM Employee` padahal PostgreSQL butuh `FROM "Employee"` — identifier
  // tanpa kutip dilipat ke lowercase dan tabelnya tak ditemukan). Referensi
  // bare dipetakan ke nama tabel ASLI schema aktif (case-insensitive).
  const bareRefs = [...sql.matchAll(/(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
  if (bareRefs.length > 0) {
    let tables: { table_name: string }[] = [];
    try {
      tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()",
      );
    } catch { /* katalog tak terbaca → biarkan SQL apa adanya */ }
    const actual = new Map(tables.map((t) => [t.table_name.toLowerCase(), t.table_name]));
    sql = sql.replace(/((?:from|join)\s+)([A-Za-z_][A-Za-z0-9_]*)/gi, (whole, pre: string, ident: string) => {
      const hit = actual.get(ident.toLowerCase());
      return hit && hit !== ident ? `${pre}"${hit}"` : whole;
    });
  }

  const denied = sqlTableRefs(sql).filter((t) => DB_DENIED_TABLES.has(t));
  if (denied.length > 0) {
    return { ok: false, output: `DITOLAK: tabel berisi data rahasia/privasi tidak dapat dibaca (${[...new Set(denied)].join(", ")}). Gunakan tabel lain yang relevan.` };
  }

  const wrapped = `SELECT * FROM (${sql}) AS _agent_q LIMIT ${DB_ROW_CAP}`;
  let rows: Record<string, unknown>[];
  try {
    // statement_timeout via SET LOCAL dalam satu transaksi interaktif —
    // query berat terpotong otomatis, koneksi dikembalikan bersih.
    rows = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = " + DB_TIMEOUT_MS);
      return tx.$queryRawUnsafe<Record<string, unknown>[]>(wrapped);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      output: `Query gagal: ${msg.slice(0, 400)}\nPETUNJUK PERBAIKAN: nama tabel & kolom di schema ini CASE-SENSITIVE dan PascalCase — selalu kutip ganda, mis. FROM "Employee" WHERE "fullName" ILIKE '%budi%'. Perbaiki lalu coba lagi.`,
    };
  }
  const clean = sanitizeRows(rows ?? []);
  if (clean.length === 0) return { ok: true, output: "0 baris." };
  const header = Object.keys(clean[0]).join(" | ");
  const body = clean.map((r) => Object.values(r).map((v) => (v == null ? "∅" : String(v))).join(" | ")).join("\n");
  let out = `${header}\n${body}`;
  if (out.length > DB_OUTPUT_CAP) out = out.slice(0, DB_OUTPUT_CAP) + "\n… (output dipotong)";
  return { ok: true, output: `${clean.length} baris (maks ${DB_ROW_CAP}):\n${out}` };
}

// ============================= 4) read_logs ===========================

const LOG_LINE_DEFAULT = 80;
const LOG_LINE_CAP = 200;
const LOG_TAIL_BYTES = 96_000;

/** Scrub substring rahasia dari baris log. */
function scrubLog(line: string): string {
  return line
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDAKSI]")
    .replace(/enc:v[12]:[A-Za-z0-9+/=]+/g, "[REDAKSI-TERENKRIPSI]")
    .replace(/(api[_-]?key|authorization|cookie|password|secret)["'=:\s]+[^,\s"']+/gi, "$1=[REDAKSI]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[REDAKSI]")
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDAKSI]");
}

async function readLogs(args: Record<string, unknown>): Promise<SupportToolResult> {
  const file = process.env.SUPPORT_LOG_PATH ?? path.join(process.cwd(), "dev.log");
  let content: string;
  try {
    const st = await fs.stat(file);
    const fh = await fs.open(file, "r");
    try {
      const len = Math.min(st.size, LOG_TAIL_BYTES);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, st.size - len);
      content = buf.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return { ok: false, output: "File log server tidak dapat dibaca di lingkungan ini." };
  }
  const filter = args.filter ? String(args.filter).trim().slice(0, 120) : "";
  const n = Math.min(LOG_LINE_CAP, Math.max(10, Math.floor(Number(args.lines) || LOG_LINE_DEFAULT)));
  let lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (filter) {
    const f = filter.toLowerCase();
    lines = lines.filter((l) => l.toLowerCase().includes(f));
  }
  const tail = lines.slice(-n).map(scrubLog);
  if (tail.length === 0) return { ok: true, output: `Tidak ada baris log${filter ? ` yang mengandung "${filter}"` : ""}.` };
  return { ok: true, output: `${tail.length} baris log terakhir${filter ? ` (filter: "${filter}")` : ""}:\n${tail.join("\n")}` };
}
