// RekanKerja shared export util — XLSX (exceljs) + CSV fallback.
// T12-REPORTS: helper terpusat agar semua modul (HR reports, payroll BPJS/
// register, leave/attendance CSV) punya format & header respons konsisten.
//
// Pola respons route (lihat payroll-run-export.ts):
//   const buf = await toXlsx("Sheet", columns, rows);
//   return xlsxResponse(buf, "nama-file.xlsx");
// atau CSV:
//   return csvResponse(toCsv(columns, rows), "nama-file.csv");
//
// BL-4 (bilingual): semua helper menerima `lang` ("id" | "en", default "id" —
// perilaku lama TIDAK berubah bila ops tidak dikirim). lang "en" → nama sheet,
// judul, header kolom & sel string yang exact-match kamus BASE_EN diterjemahkan
// via trFor (fallback identity — data user seperti nama karyawan tak tersentuh);
// locFor menukar nama bulan ID→EN pada judul komposit (mis. "… — Oktober 2026").
import { NextResponse } from "next/server";
import * as ExcelJS from "exceljs";
import { trFor, locFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";

export interface ExportColumn {
  header: string;
  /** lebar kolom Excel (karakter) — opsional di CSV. */
  width?: number;
}

export type ExportCell = number | string | Date | null | undefined;

/** Definisi satu sheet utk toXlsxMulti(). */
export interface ExportSheet {
  name: string;
  title?: string;
  columns: ExportColumn[];
  rows: ExportCell[][];
}

/**
 * Susun workbook XLSX satu sheet dari kolom + baris data.
 * Baris header = bold, freeze panes, auto-filter.
 * `rows` = array dua dimensi (nilai sel — number/string/Date/null).
 * Angka dikirim apa adanya (bukan string) agar Excel bisa dijumlahkan.
 */
export async function toXlsx(
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportCell[][],
  opts: { title?: string; lang?: Lang } = {},
): Promise<Buffer> {
  return toXlsxMulti([{ name: sheetName, title: opts.title, columns, rows }], { lang: opts.lang });
}

/** Susun workbook XLSX BANYAK sheet (laporan agregat multi-tabel). */
export async function toXlsxMulti(
  sheets: ExportSheet[],
  opts: { lang?: Lang } = {},
): Promise<Buffer> {
  const lang: Lang = opts.lang ?? "id";
  const wb = new ExcelJS.Workbook();
  wb.creator = "RekanKerja HRIS";
  wb.created = new Date();
  for (const def of sheets) buildSheet(wb, localizeSheet(def, lang));
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** BL-4: terjemahkan definisi sheet ke EN (nama, judul, header kolom, sel string
 *  yang exact-match kamus). lang "id" → jalan cepat tanpa lookup (perilaku lama). */
function localizeSheet(def: ExportSheet, lang: Lang): ExportSheet {
  if (lang !== "en") return def;
  // Judul komposit: trFor dulu (exact-match kamus), lalu locFor pada hasilnya
  // utk swap nama bulan ID→EN (aman dijalankan keduanya — keduanya idempoten).
  const title = def.title == null ? undefined : locFor("en", trFor("en", def.title));
  return {
    name: trFor("en", def.name),
    title,
    columns: def.columns.map((c) => ({ ...c, header: trFor("en", c.header) })),
    // Sel string HANYA diterjemahkan bila exact-match kamus (trFor fallback
    // identity) — nama karyawan dsb. tak tersentuh; number/Date/null diabaikan.
    rows: def.rows.map((r) => r.map((cell) => (typeof cell === "string" ? trFor("en", cell) : cell))),
  };
}

/** Tulis satu sheet ke workbook (dipakai toXlsx & toXlsxMulti). */
function buildSheet(wb: ExcelJS.Workbook, def: ExportSheet): ExcelJS.Worksheet {
  const { columns, rows, title } = def;
  const ws = wb.addWorksheet(def.name.slice(0, 31) || "Sheet1");

  // baris ditulis eksplisit — kolom TIDAK memakai properti `header` exceljs
  // (exceljs menambah header row otomatis bila di-set → bakal dobel).
  const headerRowIndex = title ? 2 : 1;
  if (title) {
    ws.addRow([title]);
    ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.getRow(1).height = 20;
  }
  ws.addRow(columns.map((c) => c.header));
  for (const r of rows) ws.addRow(r);
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? 16;
  });

  const header = ws.getRow(headerRowIndex);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF1F4" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFB7BEC6" } } };
  });
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: headerRowIndex }];
  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: Math.max(1, columns.length) },
  };

  // format angka utk kolom yang seluruh barisnya number (rapi di Excel)
  columns.forEach((_, i) => {
    const col = i + 1;
    const numeric =
      rows.some((r) => r[i] !== null && r[i] !== undefined) &&
      rows.every((r) => r[i] === null || r[i] === undefined || typeof r[i] === "number");
    if (numeric) ws.getColumn(col).numFmt = "#,##0";
  });

  return ws;
}

/**
 * CSV delimiter ";" + BOM UTF-8 (Excel locale ID default ";" + BOM agar
 * karakter non-ASCII tampil benar saat dibuka langsung).
 * Nilai di-quote bila mengandung ; " atau newline.
 */
export function toCsv(columns: ExportColumn[], rows: ExportCell[][], lang: Lang = "id"): string {
  const esc = (v: ExportCell): string => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    // AUD-DEPLOY (2-b MED-4) — CSV formula injection: string user yang
    // diawali = + - @ (atau tab/CR) diprefix "'" agar tidak dieksekusi
    // Excel/Sheets saat file dibuka. Hanya sel type string — angka
    // (termasuk negatif) & tanggal tidak tersentuh. Jalur XLSX exceljs
    // aman (string ditulis dengan tipe eksplisit, bukan formula —
    // diverifikasi round-trip write+load).
    const guarded = typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${s}` : s;
    return /[";\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  // BL-4: hanya header kolom diterjemahkan saat EN — baris CSV = data user.
  const cols = lang === "en" ? columns.map((c) => ({ ...c, header: trFor("en", c.header) })) : columns;
  const head = cols.map((c) => esc(c.header)).join(";");
  const body = rows.map((r) => r.map(esc).join(";")).join("\n");
  return `\uFEFF${head}\n${body}\n`;
}

/** Respons XLSX (attachment) — buffer dari toXlsx()/toXlsxMulti(). */
export function xlsxResponse(buf: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Respons CSV (attachment, UTF-8 + BOM via body toCsv()). */
export function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Nama file aman (tanpa karakter aneh) + stamp tanggal. */
export function exportFilename(prefix: string, ext: "xlsx" | "csv", suffix?: string): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const safe = String(prefix).replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
  return suffix ? `${safe}-${suffix}-${stamp}.${ext}` : `${safe}-${stamp}.${ext}`;
}
