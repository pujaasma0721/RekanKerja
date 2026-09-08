// OneVity Payroll — PENGENANG PDF SLIP GAJI (T10-PAYSLIP-PDF) ============
// =====================================================================
// Generator PDF slip gaji per karyawan (PayrollRunLine + PayrollRunItem
// snapshot) — A4 portrait, standard fonts pdf-lib (pure JS, aman di bawah
// bun; TANPA file font eksternal — WinAnsi/Helvetica saja).
//
// Digunakan oleh:
//   - GET /api/onevity/payslip/[lineId]?download=1|0  (unduh / inline)
//   - aksi send-slips run payroll (lampiran email massal)
//
// Struktur data dipelajari dari PaySlipDialog (payroll-run-detail.tsx) &
// payroll-spt.ts: items.type Earning|Deduction|Informational, kode _C =
// iuran perusahaan (di luar bruto/THP), PPH21 termasuk dalam potongan.
// =====================================================================
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";

// ---------- tipe data snapshot ----------

interface SlipItem {
  code: string;
  name: string;
  wageType: string;
  type: string; // Earning|Deduction|Informational
  amount: number;
  note: string | null;
}

export interface PayslipSlip {
  lineId: string;
  runId: string;
  runNo: string;
  runStatus: string;
  paidAt: Date | null;
  periodName: string;
  periodCode: string;
  processName: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  positionName: string | null;
  orgUnitName: string | null;
  ptkpStatus: string;
  ptkpValue: number;
  npwp: string | null;
  bruto: number;
  deduction: number;
  taxRegular: number;
  taxIrregular: number;
  net: number;
  actualNetTax: number | null;
  notes: string | null;
  items: SlipItem[];
  company: { name: string; address: string | null; city: string | null; phone: string | null; email: string | null } | null;
}

/** Ambil seluruh data slip untuk satu PayrollRunLine (null bila tak ada). */
export async function loadPayslipSlip(db: TenantDb, lineId: string): Promise<PayslipSlip | null> {
  // 28-c: nilai uang & identitas tersimpan terenkripsi — dekripsi di sini;
  // PDF/kontrak PayslipSlip tetap memakai angka & teks polos.
  const tc = tenantCryptoForDb(db);
  const dm = (v: string | null) => tc.decryptMoney(v) ?? 0;
  const line = await db.payrollRunLine.findUnique({
    where: { id: lineId },
    include: {
      run: { include: { period: true, processType: true } },
      employee: { select: { taxId: true, payrollProfile: { select: { npwp: true } } } },
      items: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!line) return null;

  const company = await db.company.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { name: true, address: true, city: true, phone: true, email: true },
  });

  return {
    lineId: line.id,
    runId: line.runId,
    runNo: line.run.runNo,
    runStatus: line.run.status,
    paidAt: line.run.paidAt,
    periodName: line.run.period.name,
    periodCode: line.run.period.code,
    processName: line.run.processType.name,
    employeeId: line.employeeId,
    employeeNo: line.employeeNo,
    employeeName: line.employeeName,
    positionName: line.positionName,
    orgUnitName: line.orgUnitName,
    ptkpStatus: line.ptkpStatus,
    ptkpValue: line.ptkpValue,
    npwp: tc.decryptText(line.employee?.payrollProfile?.npwp) ?? tc.decryptText(line.employee?.taxId) ?? null,
    bruto: dm(line.bruto),
    deduction: dm(line.deduction),
    taxRegular: dm(line.taxRegular),
    taxIrregular: dm(line.taxIrregular),
    net: dm(line.net),
    actualNetTax: tc.decryptMoney(line.actualNetTax),
    notes: line.notes,
    items: line.items.map((i) => ({
      code: i.code, name: i.name, wageType: i.wageType, type: i.type,
      amount: dm(i.amount), note: i.note,
    })),
    company: company ?? null,
  };
}

// ---------- util format & sanitasi teks (WinAnsi-safe) ----------

/** Rupiah Indonesia: 23678526 → "Rp 23.678.526". */
export function fmtRupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Tanggal panjang Indonesia: "31 Agustus 2026". */
function fmtDateId(d: Date): string {
  const bulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

/** Jam "HH:MM". */
function fmtTimeId(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// karakter tipografi umum → padanan WinAnsi
const CHAR_MAP: Record<string, string> = {
  "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
  "\u2026": "...", "\u00B7": "\u00B7", "\u2022": "-", "\u00A0": " ", "\u20AC": "EUR",
  "\u2212": "-", "\u2264": "<=", "\u2265": ">=", "\u00D7": "x",
};

/** Sanitasi teks agar aman di-encode font standard pdf-lib (WinAnsi). */
function safe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (CHAR_MAP[ch] !== undefined) out += CHAR_MAP[ch];
    else {
      const code = ch.codePointAt(0) ?? 63;
      out += code >= 0x20 && code <= 0xff ? ch : "?"; // buang karakter eksotis
    }
  }
  return out;
}

// ---------- palet warna (selaras nuansa UI stone) ----------
const INK = rgb(0.13, 0.12, 0.11);        // teks utama (#21201B-ish)
const INK_SOFT = rgb(0.42, 0.40, 0.38);   // teks sekunder
const INK_FAINT = rgb(0.60, 0.58, 0.55);  // teks kecil/footer
const ACCENT = rgb(0.13, 0.29, 0.24);     // hijau gelap OneVity (header/THP)
const ACCENT_SOFT = rgb(0.93, 0.96, 0.94);// latar baris selang-seling hijau muda
const TABLE_HEAD = rgb(0.17, 0.16, 0.15); // header tabel
const ROW_ALT = rgb(0.965, 0.96, 0.95);   // baris selang-seling
const RULE = rgb(0.85, 0.84, 0.82);       // garis pemisah
const RED = rgb(0.64, 0.14, 0.14);        // angka potongan
const GREEN = rgb(0.06, 0.40, 0.27);      // angka penghasilan
const WHITE = rgb(1, 1, 1);

// ---------- konstanta layout ----------
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 42;
const CONTENT_W = A4[0] - MARGIN * 2;
const LABEL_COL_W = 300; // kolom nama komponen (sisanya kolom jumlah)

/** Hasil generator: bytes PDF + nama file unduhan. */
export interface PayslipPdfResult {
  bytes: Uint8Array;
  filename: string;
  /** true bila PDF dienkripsi kata sandi (26-b P0). */
  encrypted: boolean;
}

/** Opsi proteksi slip (26-b P0): userPassword = NIK karyawan (fallback employeeNo). */
export interface PayslipPdfOptions {
  password?: string | null;
}

/**
 * Bangun PDF slip gaji A4 portrait dari data PayslipSlip.
 * Desain: header perusahaan + judul SLIP GAJI + periode, blok identitas
 * karyawan, tabel penghasilan & potongan (subtotal masing-masing), band
 * TAKE HOME PAY besar, footer kecil otomatis. Multi-halaman bila komponen
 * banyak (footer + band THP selalu di halaman terakhir).
 * Opsi password (kirim slip via email): PDF dienkripsi AES-256 — hanya bisa
 * dibuka karyawan pemilik NIK; unduhan UI tetap tanpa sandi (sudah login).
 */
export async function buildPayslipPdf(slip: PayslipSlip, opts: PayslipPdfOptions = {}): Promise<PayslipPdfResult> {
  const password = opts.password?.trim() || null;
  const doc = await PDFDocument.create();
  doc.setTitle(`Slip Gaji ${slip.employeeName} — ${slip.periodName}`);
  doc.setSubject(`${slip.runNo} · ${slip.periodName} · ${slip.processName}`);
  doc.setProducer("OneVity HRIS");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;

  // ---- helper ----
  const txt = (text: string, x: number, yy: number, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) => {
    const size = opts.size ?? 9;
    const font = opts.font ?? regular;
    const s = safe(text);
    const w = font.widthOfTextAtSize(s, size);
    let xx = x;
    if (opts.align === "right") xx = x - w;
    if (opts.align === "center") xx = x - w / 2;
    page.drawText(s, { x: xx, y: yy, size, font, color: opts.color ?? INK });
  };
  const textW = (text: string, size: number, font: PDFFont) => font.widthOfTextAtSize(safe(text), size);
  /** Pastikan ruang vertikal cukup — pindah halaman bila perlu. */
  const ensure = (need: number) => {
    if (y - need < MARGIN + 56) { // sisakan ruang band THP + footer di halaman terakhir
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };

  // ================= HEADER =================
  const company = slip.company;
  const companyName = company?.name ?? "OneVity HRIS";
  txt(companyName, MARGIN, y, { size: 15, font: bold, color: ACCENT });
  if (company) {
    const parts = [company.address, company.city].filter((p): p is string => !!p).join(", ");
    y -= 13;
    if (parts) txt(parts, MARGIN, y, { size: 8, color: INK_SOFT });
    const contact = [company.phone, company.email].filter((p): p is string => !!p).join(" · ");
    if (contact) { y -= 10; txt(contact, MARGIN, y, { size: 8, color: INK_FAINT }); }
  }

  // sisi kanan: judul + periode + run
  txt("SLIP GAJI", A4[0] - MARGIN, y + 26, { size: 19, font: bold, color: INK, align: "right" });
  txt(safe(slip.periodName), A4[0] - MARGIN, y + 11, { size: 10, font: bold, color: INK_SOFT, align: "right" });
  txt(`${slip.runNo} · ${slip.processName}`, A4[0] - MARGIN, y - 1, { size: 8, color: INK_FAINT, align: "right" });
  y -= 16;

  // garis tebal aksen
  page.drawRectangle({ x: MARGIN, y: y - 4, width: CONTENT_W, height: 2.4, color: ACCENT });
  y -= 18;

  // ================= IDENTITAS KARYAWAN =================
  const idRows: [string, string][] = [
    ["Nama Karyawan", slip.employeeName],
    ["No. Karyawan", slip.employeeNo],
    ["Posisi", slip.positionName ?? "-"],
    ["Unit / Departemen", slip.orgUnitName ?? "-"],
    ["Status Pajak (PTKP)", slip.ptkpStatus],
    ["NPWP", slip.npwp ?? "-"],
  ];
  const idBoxH = idRows.length * 12 + 16;
  page.drawRectangle({ x: MARGIN, y: y - idBoxH, width: CONTENT_W, height: idBoxH, color: ROW_ALT, borderWidth: 0.6, borderColor: RULE });
  let iy = y - 16;
  for (let i = 0; i < idRows.length; i += 2) {
    const [l1, v1] = idRows[i];
    const [l2, v2] = idRows[i + 1];
    txt(l1, MARGIN + 12, iy, { size: 7.5, font: bold, color: INK_FAINT });
    txt(v1, MARGIN + 12, iy - 9.5, { size: 9, font: bold });
    txt(l2, MARGIN + CONTENT_W / 2 + 8, iy, { size: 7.5, font: bold, color: INK_FAINT });
    txt(v2, MARGIN + CONTENT_W / 2 + 8, iy - 9.5, { size: 9, font: bold });
    iy -= 24;
  }
  y -= idBoxH + 14;

  // status run (Paid/Confirmed) — chip kecil kanan
  const statusLabel = slip.runStatus === "Paid" ? "DIBAYAR" : slip.runStatus === "Confirmed" ? "DIKONFIRMASI" : slip.runStatus.toUpperCase();
  const stTxt = slip.paidAt ? `${statusLabel} — ${fmtDateId(slip.paidAt)}` : statusLabel;
  txt(stTxt, MARGIN, y + 2, { size: 7.5, font: bold, color: slip.runStatus === "Paid" ? GREEN : INK_SOFT });
  y -= 8;

  // ================= TABEL PENGHASILAN & POTONGAN =================
  const earnings = slip.items.filter((i) => i.type === "Earning");
  const deductions = slip.items.filter((i) => i.type === "Deduction");
  const infos = slip.items.filter((i) => i.type === "Informational");

  const drawTableSection = (title: string, rows: SlipItem[], subtotalLabel: string, subtotalValue: number, opts: { amountColor: ReturnType<typeof rgb>; alt: ReturnType<typeof rgb> }) => {
    ensure(34 + rows.length * 13 + 30);
    txt(title, MARGIN, y, { size: 9, font: bold, color: opts.amountColor });
    y -= 5;
    // header kolom
    page.drawRectangle({ x: MARGIN, y: y - 12.5, width: CONTENT_W, height: 13, color: TABLE_HEAD });
    txt("KOMPONEN", MARGIN + 8, y - 9, { size: 7.5, font: bold, color: WHITE });
    txt("JUMLAH", MARGIN + CONTENT_W - 8, y - 9, { size: 7.5, font: bold, color: WHITE, align: "right" });
    y -= 13;

    if (rows.length === 0) {
      txt("—", MARGIN + 8, y - 9, { size: 8, color: INK_FAINT });
      y -= 13;
    }
    rows.forEach((it, idx) => {
      ensure(13);
      if (idx % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - 12.5, width: CONTENT_W, height: 13, color: opts.alt });
      const isCo = it.code.endsWith("_C");
      const label = it.name + (isCo ? "  (iuran perusahaan)" : "") + (it.note ? `  — ${it.note}` : "");
      txt(label, MARGIN + 8, y - 9, { size: 8.5, font: isCo ? oblique : regular, color: isCo ? INK_SOFT : INK });
      txt(fmtRupiah(it.amount), MARGIN + CONTENT_W - 8, y - 9, { size: 8.5, font: isCo ? regular : bold, color: isCo ? INK_SOFT : opts.amountColor, align: "right" });
      y -= 13;
    });

    // subtotal
    page.drawRectangle({ x: MARGIN, y: y - 13.5, width: CONTENT_W, height: 14, color: RULE });
    txt(subtotalLabel, MARGIN + 8, y - 10, { size: 8, font: bold, color: INK });
    txt(fmtRupiah(subtotalValue), MARGIN + CONTENT_W - 8, y - 10, { size: 9, font: bold, color: opts.amountColor, align: "right" });
    y -= 24;
  };

  drawTableSection("PENGHASILAN", earnings, "JUMLAH PENGHASILAN (BRUTO)", slip.bruto, { amountColor: GREEN, alt: ACCENT_SOFT });
  drawTableSection("POTONGAN", deductions, "JUMLAH POTONGAN", slip.deduction, { amountColor: RED, alt: ROW_ALT });

  // catatan: PPh21 termasuk potongan + net-to-gross
  const taxTotal = slip.taxRegular + slip.taxIrregular;
  const notes: string[] = [];
  if (taxTotal > 0) notes.push(`Termasuk PPh21 sebesar ${fmtRupiah(taxTotal)} (PPh Pasal 21).`);
  if (slip.actualNetTax != null) notes.push("PPh21 ditanggung penuh perusahaan (metode Net-to-Gross).");
  if (slip.notes) notes.push(safe(slip.notes));
  if (notes.length > 0) {
    ensure(notes.length * 10 + 6);
    for (const n of notes) {
      txt(`* ${n}`, MARGIN, y, { size: 7.5, font: oblique, color: INK_SOFT });
      y -= 10;
    }
    y -= 4;
  }

  // item informational (bila ada)
  if (infos.length > 0) {
    ensure(14);
    const infoLine = infos.map((i) => `${i.name}: ${i.code.match(/[^0-9]/) ? fmtRupiah(i.amount) : String(i.amount)}`).join("   |   ");
    const trimmed = infoLine.length > 110 ? `${infoLine.slice(0, 107)}...` : infoLine;
    txt(`Informasi: ${trimmed}`, MARGIN, y, { size: 7.5, color: INK_FAINT });
    y -= 16;
  }

  // ================= TAKE HOME PAY =================
  ensure(64);
  const bandH = 34;
  const bandTop = y + 6;
  page.drawRectangle({ x: MARGIN, y: bandTop - bandH, width: CONTENT_W, height: bandH, color: ACCENT });
  const bandMid = bandTop - bandH / 2;
  txt("TAKE HOME PAY", MARGIN + 12, bandMid - 4, { size: 11, font: bold, color: WHITE });
  txt(fmtRupiah(slip.net), MARGIN + CONTENT_W - 12, bandMid - 5.5, { size: 16, font: bold, color: WHITE, align: "right" });
  y -= bandH + 10;

  // ================= FOOTER =================
  // selalu di halaman terakhir, ditempel ke dasar halaman
  const footerPage = page;
  const now = new Date();
  const footerY = MARGIN - 22;
  footerPage.drawRectangle({ x: MARGIN, y: footerY + 10, width: CONTENT_W, height: 0.7, color: RULE });
  const footer1 = `Dokumen dibuat otomatis oleh OneVity HRIS — ${fmtDateId(now)}, ${fmtTimeId(now)} · ${slip.runNo}`;
  const footer2 = "Slip gaji bersifat RAHASIA — hanya untuk karyawan yang bersangkutan. Pertanyaan: hubungi HRD.";
  footerPage.drawText(safe(footer1), { x: MARGIN, y: footerY - 2, size: 7, font: regular, color: INK_FAINT });
  footerPage.drawText(safe(footer2), { x: MARGIN, y: footerY - 11, size: 7, font: regular, color: INK_FAINT });
  if (password) {
    const footer3 = "Dokumen ini diproteksi kata sandi (NIK Anda) — slip tidak dapat dibuka pihak lain.";
    footerPage.drawText(safe(footer3), { x: MARGIN, y: footerY - 20, size: 7, font: bold, color: INK_FAINT });
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (pages.length > 1) {
      const label = `Halaman ${i + 1} dari ${pages.length}`;
      p.drawText(safe(label), { x: A4[0] - MARGIN - textW(label, 7, regular), y: MARGIN - 33, size: 7, font: regular, color: INK_FAINT });
    }
  });

  // 26-b P0 — enkripsi AES-256 sebelum save (hanya saat kirim via email):
  // userPassword = NIK karyawan; ownerPassword acak per file; izin hanya
  // cetak + aksesibilitas konten (salin/modifikasi/isi-form diblokir).
  if (password) {
    doc.encrypt({
      userPassword: password,
      ownerPassword: ownerSecret(),
      permissions: {
        printing: "highResolution",
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });
  }

  const bytes = await doc.save();
  return {
    bytes,
    filename: `Slip-Gaji-${slip.employeeNo}-${slip.periodCode}.pdf`,
    encrypted: Boolean(password),
  };
}

/** Kata sandi pemilik acak per file (hex) — tidak pernah dibagikan. */
function ownerSecret(): string {
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  return Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Muat data + bangun PDF satu line (gabungan praktis untuk route & email). */
export async function buildPayslipPdfByLineId(
  db: TenantDb,
  lineId: string,
  opts: PayslipPdfOptions = {},
): Promise<PayslipPdfResult & { slip: PayslipSlip } | null> {
  const slip = await loadPayslipSlip(db, lineId);
  if (!slip) return null;
  return { ...(await buildPayslipPdf(slip, opts)), slip };
}
