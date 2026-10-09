// =============================================================================
// AUDIT-BILINGUAL — skrip audit penerapan bilingual (ID/EN) di seluruh UI.
// Pendekatan AST (typescript parser): jauh lebih akurat daripada regex.
//
// Aturan konvensi kode RekanKerja (shared/lib/i18n-core.ts):
//   · Teks sumber = Bahasa Indonesia, dibungkus t("...") / t("...", "EN")
//   · Semua teks statis user-visible HARUS lewat t() agar ikut bahasa aktif.
//
// Yang di-flag sebagai GAP:
//   1. JsxText (teks literal antar tag > ... <) berisi huruf → hardcoded.
//   2. Atribut JSX string literal berisi kata Indonesia (label/title/placeholder/
//      description/...) → hardcoded.
//   3. Argumen pertama toast()/toast.success()/Error()/confirm() dsb. berupa
//      string literal → hardcoded.
//   4. String di array items/opsi (mis. ["Aktif","Nonaktif"]) dengan kata
//      Indonesia → hardcoded (harus t() saat render).
// Pengecualian (bukan gap):
//   · Sudah di dalam panggilan t()/translate()/tr() — termasuk map EN (nilai).
//   · Komentar (dihilangkan parser? tidak — AST tidak memuat komentar).
//   · Teks tanpa huruf (angka, simbol, "—", "%").
//   · Istilah/proper noun netral bahasa (RekanKerja, HR, Payroll, NPWP, XLSX…).
//   · className, href, key, value data teknis, console.*, test id.
//   · File design-lab (mockup terisolasi, bukan produksi).
//
// Output: laporan per file + ringkasan jumlah gap. Exit code = jumlah gap
// (maks 100) agar bisa dipakai CI/regresi: 0 gap = LULUS.
// Jalankan: bun scripts/audit-bilingual.ts [--dir src] [--verbose]
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

// ---------- Konfigurasi ----------
const ROOT = process.argv.includes("--dir")
  ? process.argv[process.argv.indexOf("--dir") + 1]!
  : "src";
const VERBOSE = process.argv.includes("--verbose");

// Folder/file yang dikecualikan: mockup desain terisolasi (?mockup=...) — bukan
// kode produksi yang dilihat end-user dalam alur normal.
const EXCLUDE_PATH_PARTS = ["/design/", "-design-lab", "menu-design-lab"];

// File yang string Indonesinya diterjemahkan SECARA TERPUSAT saat runtime:
// - doc-kit.tsx TH/TotalRow/DocSection/SummaryBox auto-t (children string)
// - export.ts localizeSheet (header/sheet-name/sel exact-match) utk 6 API
//   dokumen laporan + payroll monthly — sel & header diterjemahkan di
//   toXlsxMulti, bukan di file builder.
// Audit statis tidak bisa melihat hal ini → file-file berikut di-skip agar
// laporan menampilkan gap NYATA saja.
const RUNTIME_TRANSLATED = [
  "src/rekankerja/human-resource/api/report-documents.ts",
  "src/rekankerja/leave/api/leave-report-documents.ts",
  "src/rekankerja/medical/api/medical-report-documents.ts",
  "src/rekankerja/time-attendance/api/attendance-report-documents.ts",
  "src/rekankerja/travel/api/travel-report-documents.ts",
  "src/rekankerja/payroll/api/reports-monthly.ts",
  "src/rekankerja/shared/lib/export.ts",
  // — Task BL-5 (tier-2 export): 10 API ekspor tier-2 — header/nama sheet/
  //   judul/sel label diterjemahkan terpusat oleh export.ts (localizeSheet /
  //   toCsv) + trFor eksplisit di dalam builder; audit statis tak bisa
  //   melihat ?lang= → di-skip (pola sama dgn 6 API dokumen laporan BL-4). —
  "src/rekankerja/time-attendance/api/reports.ts",
  "src/rekankerja/time-attendance/api/absence-export.ts",
  "src/rekankerja/payroll/api/payroll-run-export.ts",
  "src/rekankerja/payroll/api/reports-register.ts",
  "src/rekankerja/payroll/api/non-employee-payments.ts",
  "src/rekankerja/human-resource/api/reports.ts",
  "src/rekankerja/human-resource/api/employees.ts",
  "src/rekankerja/leave/api/reports.ts",
  "src/rekankerja/medical/api/reports.ts",
  "src/rekankerja/travel/api/reports.ts",
  // Kamus itu sendiri = sumber terjemahan (ID key + EN value per baris).
  "src/rekankerja/shared/lib/i18n-core.ts",
  // Data internal (bukan UI runtime): blueprint PRD (tidak diimpor komponen).
  "src/lib/prd-data.ts",
  // Format REGULATOR wajib Indonesia: upload BPJS + e-SPT/SPT 1721-A1.
  "src/rekankerja/payroll/api/reports-bpjs.ts",
  "src/rekankerja/payroll/api/payroll-spt.ts",
  "src/rekankerja/payroll/services/payroll-spt.ts",
  // Prompt AI & seed master data — by-design Indonesia (AI menjawab ID;
  // data master tenant milik tenant).
  "src/rekankerja/shared/services/ai-chat-service.ts",
  "src/rekankerja/shared/lib/provisioning.ts",
  "src/rekankerja/travel/api/ocr.ts",
];

// Komponen doc-kit yang auto-translate children/label string-nya di runtime.
const RUNTIME_TR_COMPONENTS = new Set(["TH", "TotalRow", "DocSection", "SummaryBox", "DocBadge"]);

// Kata/istilah yang BUKAN penanda bahasa Indonesia (proper noun, istilah asli
// bahasa netral, singkatan, format). Case-sensitive per entri bila perlu.
const NEUTRAL_TOKENS = new Set([
  "rekanerja", "hr", "payroll", "onboarding", "offboarding", "whistleblowing",
  "dashboard", "approval", "personnel", "action", "grade", "level", "status",
  "email", "telepon", "bank", "npwp", "ptkp", "pph21", "bpjs", "tk", "pkps",
  "export", "import", "xlsx", "csv", "pdf", "ess", "qr", "wa", "whatsapp",
  "api", "totp", "otp", "mfa", "login", "logout", "clock", "in", "out",
  "template", "memo", "deduction", "run", "runs", "take", "home", "report",
  "reports", "custom", "approval", "claim", "claims", "umc", "outstanding",
  "verbal", "final", "probation", "outsourcing", "headcount", "turnover",
  "tenure", "hires", "exits", "ytd", "avg", "gender", "divisi", "bank",
  "kiosk", "ai", "e-sign", "esign", "slip", "a1", "1721", "spt", "sptt",
  "monitoring", "preview", "print", "help", "faq", "go", "to", "detail",
  "master", "demo", "test", "id", "en",
]);

// Kata kunci khas Bahasa Indonesia untuk deteksi konten.
const ID_WORD_RE =
  /\b(dan|atau|yang|tidak|akan|dengan|untuk|pada|dari|ke|di|ini|itu|adalah|bisa|akan|sudah|belum|sedang|hanya|semua|silakan|harus|wajib|gagal|berhasil|simpan|hapus|tambah|ubah|cari|kosong|terjadi|kesalahan|karyawan|pengajuan|persetujuan|menunggu|catatan|total|nama|tanggal|karyawan|departemen|jabatan|perusahaan|surat|dokumen|laporan|pengaturan|aktif|nonaktif|ditolak|disetujui|dibatalkan|selesai|diproses|bulan|tahun|hari|jam|menit|sandI|masuk|keluar|versi|batal|tutup|unduh|unggah|salin|konfirmasi|ya|tidak|lihat|pilih|semua|buka|baru|lama|banyak|jumlah|kode|tipe|jenis|deskripsi|informasi|riwayat|proses|terapkan|reset|filter|segarkan|muat|memuat|menyimpan|menghapus|gajI|gajikan|cuti|lembur|absensi|kehadiran|jadwal|shift|saldo|klaim|medis|travel|perjalanan|dinas|budget|jenis|rumah|sakit|asuransi|penyesuaian|massal|template|notifikasi|pengumuman|komunikasi|organisasi|kantor|lokasi|posisi|katalog|direktori|disiplin|pelanggaran|peringatan|masa|percobaan|kontrak|permanen|tetap|magang|aset|pengembalian|offboarding|whistleblow|pelanggar|anonim|identitas|bukti|lampiran|uraian|nilai|batas|sisa|permintaan|persetuju|verifikasi|kode|token|tautan|tautan|berakhir|kedaluwarsa|terbit|draf|draft|menunggu|proses|selesai|batal|terkirim|terbaru|terlama|naik|turun|asc|desc|baris|kolom|sel|isi|firma|ttd|paraf|hlm|hal|no|nomor|rekening|cabang|pemilik|pemegang|referensi|keperluan|tujuan|kategori|grup|divisi|segmen|entitas|satuan|frekuensi|per|sekali|harian|bulanan|tahunan|mingguan|jam|lembur|izin|sakit|alpa|hadir|terlambat|cepat|pulang|masuk|libur|kerja|normal|shift|malam|hari|jam|ist|wib|wita|wit)\b/i;

// Atribut yang umum menampung teks user-visible.
const TEXTUAL_ATTRS = new Set([
  "label", "title", "placeholder", "description", "tooltip", "content",
  "message", "text", "caption", "helperText", "emptyText", "alt", "aria-label",
  "confirmTitle", "successTitle", "subtitle", "header", "name",
]);

// Panggilan yang argumen string pertamanya = teks user-visible.
const CALL_WATCH = new Set([
  "toast", "toastSuccess", "toastError", "toastInfo", "toastWarning",
  "alert", "confirm", "prompt", "Error",
]);

// ---------- Helper ----------
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** true bila string mengandung huruf & kata berbau Indonesia. */
function looksIndonesian(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (!/[a-zA-Z]/.test(t)) return false; // tanpa huruf → simbol/angka
  return ID_WORD_RE.test(t);
}

/** Cek apakah node berada di dalam argumen panggilan t()/translate()/tr(). */
function insideTCall(node: ts.Node): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression.getText();
      if (/^(t|translate|tr|loc|locActivity|fmtDate|fmtIDR|fmtNum)$/.test(callee.split("(")[0] ?? "")) {
        return true;
      }
    }
    // Properti bernama "en"/"id" dari map terjemahan (VALIDATION_EN dll.) → nilai
    // string adalah terjemahan EN (disengaja dua bahasa per baris).
    if (ts.isPropertyAssignment(cur) && ts.isIdentifier(cur.name)) {
      const n = cur.name.text;
      if (n === "en" || n === "id" || /^.+_EN$/.test(n)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

/** true bila ini file yang dikecualikan (design lab / mockup). */
function excluded(p: string): boolean {
  if (RUNTIME_TRANSLATED.some((f) => p.endsWith(f))) return true;
  return EXCLUDE_PATH_PARTS.some((part) => p.includes(part));
}

/** true bila JsxText berada langsung di dalam elemen doc-kit yang
 *  auto-translate (mis. <TH>No. Karyawan</TH>) — bukan gap. */
function insideRuntimeTrComponent(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent && ts.isJsxElement(parent)) {
    const tag = parent.openingElement.tagName.getText();
    return RUNTIME_TR_COMPONENTS.has(tag);
  }
  return false;
}

// ---------- Scanner ----------
interface Gap { file: string; line: number; kind: string; text: string }

const gaps: Gap[] = [];
const files = walkFiles(ROOT).filter((f) => !excluded(f));
let scanned = 0;

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  scanned++;
  const rel = path.relative(process.cwd(), file);

  const visit = (node: ts.Node): void => {
    // 1) JsxText literal berbahasa Indonesia (bukan bagian {t(...)} — JsxText
    //    memang TIDAK mungkin berada dalam ekspresi, jadi apapun berhuruf = gap;
    //    KECUALI berada di komponen doc-kit yang auto-translate saat runtime).
    if (ts.isJsxText(node)) {
      const txt = node.getText().replace(/\s+/g, " ").trim();
      if (looksIndonesian(txt) && !insideRuntimeTrComponent(node)) {
        gaps.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: "jsx-text", text: txt.slice(0, 90) });
      }
    }

    // 2) Atribut JSX dengan string literal berbahasa Indonesia.
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const attr = node.name.text;
      const val = node.initializer.text;
      if (TEXTUAL_ATTRS.has(attr) && looksIndonesian(val) && !insideTCall(node)) {
        gaps.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: `attr:${attr}`, text: val.slice(0, 90) });
      }
    }

    // 3) Panggilan toast()/alert()/Error() dengan arg string literal.
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      const fn = callee.split(".").pop() ?? callee;
      if (CALL_WATCH.has(fn) && node.arguments.length > 0) {
        const a0 = node.arguments[0]!;
        if (ts.isStringLiteral(a0) && looksIndonesian(a0.text) && !insideTCall(node)) {
          gaps.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind: `call:${fn}`, text: a0.text.slice(0, 90) });
        }
      }
    }

    // 4) Array literal string berbahasa Indonesia (opsi dropdown dsb.) — hanya
    //    bila parentnya bukan bagian dari t() dan berada di level komponen UI.
    if (ts.isArrayLiteralExpression(node) && node.elements.length <= 40) {
      for (const el of node.elements) {
        if (ts.isStringLiteral(el) && looksIndonesian(el.text) && !insideTCall(el)) {
          gaps.push({ file: rel, line: sf.getLineAndCharacterOfPosition(el.getStart()).line + 1, kind: "array-item", text: el.text.slice(0, 90) });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  sf.forEachChild(visit);
}

// ---------- Laporan ----------
const perFile = new Map<string, Gap[]>();
for (const g of gaps) {
  const arr = perFile.get(g.file) ?? [];
  arr.push(g);
  perFile.set(g.file, arr);
}

console.log(`\n=== AUDIT BILINGUAL — ${scanned} file dipindai, ${perFile.size} file dengan gap, ${gaps.length} temuan ===\n`);
for (const [file, list] of [...perFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file} (${list.length})`);
  if (VERBOSE) for (const g of list) console.log(`   L${g.line} [${g.kind}] ${g.text}`);
}
if (!VERBOSE) console.log(`\n(gunakan --verbose untuk detail per baris)`);

console.log(`\nTOTAL_GAP=${gaps.length}`);
process.exitCode = Math.min(gaps.length, 100);
