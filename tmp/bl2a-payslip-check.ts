// BL2-a — VERIFIKASI dwibahasa PDF payslip (pola scripts/t26-verify-slip-password.ts)
//   1. buildPayslipPdf lang "id" (default) → PDF valid + marker label Indonesia +
//      grouping uang id-ID ("Rp 8.000.000") + nama file "Slip-Gaji-…".
//   2. buildPayslipPdf lang "en" → PDF valid + marker label EN
//      ("PAYSLIP", "Employee Name", "TOTAL GROSS EARNINGS", "Generated automatically",
//      grouping "Rp 8,000,000") + nama file "Payslip-…".
//   3. locFor swap nama bulan period: "Periode Agustus 2026" → "Period August 2026".
//   4. default tanpa opts.lang → identik ID (by-design slip/email massal).
// Jalankan: bun run tmp/bl2a-payslip-check.ts
import { inflateSync } from "node:zlib";
import { PDFDocument } from "@cantoo/pdf-lib";
import { buildPayslipPdf, type PayslipSlip } from "@/rekankerja/payroll/services/payslip-pdf";

const mkSlip = (): PayslipSlip => ({
  lineId: "test", runId: "test", runNo: "PR-2026-08-SAL-01", runStatus: "Paid", paidAt: new Date("2026-08-31T03:00:00Z"),
  periodName: "Periode Agustus 2026", periodCode: "202608", processName: "Gaji Bulanan",
  employeeId: "e1", employeeNo: "MII00009", employeeName: "Siti Nurhaliza",
  positionName: "Recruiter", orgUnitName: "Recruitment",
  ptkpStatus: "TK/0", ptkpValue: 54000000, npwp: "12.345.678.9-012.345",
  bruto: 10000000, deduction: 1000000, taxRegular: 100000, taxIrregular: 0, net: 8900000,
  actualNetTax: null, notes: null,
  items: [
    { code: "GP", name: "Gaji Pokok", wageType: "Base", type: "Earning", amount: 8000000, note: null },
    { code: "JP_C", name: "Jaminan Pensiun", wageType: "Jamsostek", type: "Earning", amount: 200000, note: null },
    { code: "PPH21", name: "PPh 21", wageType: "Tax", type: "Deduction", amount: 100000, note: null },
  ],
  company: { name: "PT Mitra Industri Internasional", address: "Jl. Raya Industri No. 1", city: "Jakarta Timur", phone: "021-123", email: null },
});

/** Teks konten PDF (raw + stream flate) + dekode hex-string <…> Tj (pola e2e-esign-pdf). */
function pdfText(raw: Buffer): string {
  const parts: string[] = [];
  let idx = 0;
  for (;;) {
    const s = raw.indexOf("stream", idx);
    if (s < 0) break;
    const e = raw.indexOf("endstream", s);
    if (e < 0) break;
    let p = s + 6;
    while (p < e && (raw[p] === 0x0a || raw[p] === 0x0d)) p++;
    const chunk = raw.subarray(p, e);
    if (chunk.length > 0) {
      try { parts.push(inflateSync(chunk).toString("latin1")); } catch { parts.push(chunk.toString("latin1")); }
    }
    idx = e + 9;
  }
  parts.push(raw.toString("latin1"));
  const all = parts.join("\n");
  const decoded: string[] = [];
  for (const m of all.matchAll(/<([0-9A-Fa-f]+)>\s*(?:Tj|')/g)) {
    const h = m[1];
    let out = "";
    for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
    decoded.push(out);
  }
  return decoded.join("\n");
}

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

async function main(): Promise<void> {
  console.log("== BL2-a payslip-pdf dwibahasa ==");

  // ---------- ID (default) ----------
  const idBuilt = await buildPayslipPdf(mkSlip());
  const idTxt = pdfText(Buffer.from(idBuilt.bytes));
  ok("[id] PDF valid (load roundtrip)", (await PDFDocument.load(idBuilt.bytes)).getPageCount() >= 1);
  ok("[id] filename Slip-Gaji-…", idBuilt.filename.startsWith("Slip-Gaji-MII00009-202608"));
  ok('[id] judul "SLIP GAJI"', idTxt.includes("SLIP GAJI"));
  ok('[id] label "Nama Karyawan"', idTxt.includes("Nama Karyawan"));
  ok('[id] label "Unit / Departemen"', idTxt.includes("Unit / Departemen"));
  ok('[id] label "Status Pajak (PTKP)"', idTxt.includes("Status Pajak (PTKP)"));
  ok('[id] header tabel "KOMPONEN"/"JUMLAH"', idTxt.includes("KOMPONEN") && idTxt.includes("JUMLAH"));
  ok('[id] seksi "PENGHASILAN"/"POTONGAN"', idTxt.includes("PENGHASILAN") && idTxt.includes("POTONGAN"));
  ok('[id] subtotal "JUMLAH PENGHASILAN (BRUTO)"', idTxt.includes("JUMLAH PENGHASILAN (BRUTO)"));
  ok('[id] chip status "DIBAYAR"', idTxt.includes("DIBAYAR"));
  ok('[id] iuran perusahaan', idTxt.includes("(iuran perusahaan)"));
  ok('[id] catatan PPh21', idTxt.includes("Termasuk PPh21 sebesar"));
  ok('[id] footer "Dokumen dibuat otomatis"', idTxt.includes("Dokumen dibuat otomatis"));
  ok('[id] footer RAHASIA', idTxt.includes("RAHASIA"));
  ok('[id] grouping uang id-ID "Rp 8.000.000"', idTxt.includes("Rp 8.000.000"));
  ok('[id] period "Periode Agustus 2026" utuh', idTxt.includes("Periode Agustus 2026"));
  ok('[id] TIDAK memuat label EN', !idTxt.includes("PAYSLIP") && !idTxt.includes("Employee Name") && !idTxt.includes("TOTAL GROSS EARNINGS"));

  // ---------- EN ----------
  const enBuilt = await buildPayslipPdf(mkSlip(), { lang: "en" });
  const enTxt = pdfText(Buffer.from(enBuilt.bytes));
  ok("[en] PDF valid (load roundtrip)", (await PDFDocument.load(enBuilt.bytes)).getPageCount() >= 1);
  ok("[en] filename Payslip-…", enBuilt.filename.startsWith("Payslip-MII00009-202608"));
  ok('[en] judul "PAYSLIP"', enTxt.includes("PAYSLIP"));
  ok('[en] label "Employee Name"', enTxt.includes("Employee Name"));
  ok('[en] label "Employee No."', enTxt.includes("Employee No."));
  ok('[en] label "Position"', enTxt.includes("Position"));
  ok('[en] label "Unit / Department"', enTxt.includes("Unit / Department"));
  ok('[en] label "Tax Status (PTKP)"', enTxt.includes("Tax Status (PTKP)"));
  ok('[en] header tabel "COMPONENT"/"AMOUNT"', enTxt.includes("COMPONENT") && enTxt.includes("AMOUNT"));
  ok('[en] seksi "EARNINGS"/"DEDUCTIONS"', enTxt.includes("EARNINGS") && enTxt.includes("DEDUCTIONS"));
  ok('[en] subtotal "TOTAL GROSS EARNINGS"/"TOTAL DEDUCTIONS"', enTxt.includes("TOTAL GROSS EARNINGS") && enTxt.includes("TOTAL DEDUCTIONS"));
  ok('[en] chip status "PAID"', enTxt.includes("PAID"));
  ok("[en] company contribution", enTxt.includes("(company contribution)"));
  ok('[en] catatan PPh21 EN', enTxt.includes("Includes PPh21 (Article 21) withholding"));
  ok('[en] footer "Generated automatically"', enTxt.includes("Generated automatically"));
  ok("[en] footer CONFIDENTIAL", enTxt.includes("CONFIDENTIAL"));
  ok('[en] grouping uang en-US "Rp 8,000,000"', enTxt.includes("Rp 8,000,000"));
  ok('[en] period swap "Period August 2026"', enTxt.includes("Period August 2026"));
  ok('[en] tanggal paidAt "31 August 2026"', enTxt.includes("31 August 2026"));
  ok('[en] TIDAK memuat label ID', !enTxt.includes("SLIP GAJI") && !enTxt.includes("Nama Karyawan") && !enTxt.includes("KOMPONEN"));

  // ---------- default tanpa lang = identik ID ----------
  const defBuilt = await buildPayslipPdf(mkSlip(), {});
  const defTxt = pdfText(Buffer.from(defBuilt.bytes));
  ok("[default] tanpa opts.lang → label ID (by-design)", defTxt.includes("SLIP GAJI") && defTxt.includes("KOMPONEN"));

  console.log(`\n${fail === 0 ? "SEMUA PASS" : "ADA FAIL"}: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
