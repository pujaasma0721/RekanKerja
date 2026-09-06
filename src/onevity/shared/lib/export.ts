// OneVity shared export util — XLSX (exceljs) + CSV fallback.
// T12-REPORTS: helper terpusat agar semua modul (HR reports, payroll BPJS/
// register, leave/attendance CSV) punya format & header respons konsisten.
//
// Pola respons route (lihat payroll-run-export.ts):
//   const buf = await toXlsx("Sheet", columns, rows);
//   return xlsxResponse(buf, "nama-file.xlsx");
// atau CSV:
//   return csvResponse(toCsv(columns, rows), "nama-file.csv");
import { NextResponse } from "next/server";
import * as ExcelJS from "exceljs";

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
  opts: { title?: string } = {},
): Promise<Buffer> {
  return toXlsxMulti([{ name: sheetName, title: opts.title, columns, rows }]);
}

/** Susun workbook XLSX BANYAK sheet (laporan agregat multi-tabel). */
export async function toXlsxMulti(sheets: ExportSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "OneVity HRIS";
  wb.created = new Date();
  for (const def of sheets) buildSheet(wb, def);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
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
export function toCsv(columns: ExportColumn[], rows: ExportCell[][]): string {
  const esc = (v: ExportCell): string => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.header)).join(";");
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
