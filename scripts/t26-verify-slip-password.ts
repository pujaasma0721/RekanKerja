// Verifikasi enkripsi payslip PDF (26-b P0) — roundtrip bukti:
//   1. buildPayslipPdf dgn password → bytes mengandung /Encrypt
//   2. load TANPA sandi → gagal (encrypted)
//   3. load sandi SALAH → gagal
//   4. load sandi BENAR (NIK) → sukses, halaman terbaca
//   5. buildPayslipPdf TANPA password → normal (regresi unduh UI)
//   6. letter-service masih berjalan (import @cantoo/pdf-lib drop-in)
// Jalankan: bun run scripts/t26-verify-slip-password.ts
import { PDFDocument } from "@cantoo/pdf-lib";
import { buildPayslipPdf, type PayslipSlip } from "@/onevity/payroll/services/payslip-pdf";

const mkSlip = (): PayslipSlip => ({
  lineId: "test", runId: "test", runNo: "PR-2026-09-SAL-01", runStatus: "Confirmed", paidAt: null,
  periodName: "September 2026", periodCode: "202609", processName: "Gaji Bulanan",
  employeeId: "e1", employeeNo: "MII00009", employeeName: "Siti Nurhaliza",
  positionName: "Recruiter", orgUnitName: "Recruitment",
  ptkpStatus: "TK/0", ptkpValue: 54000000, npwp: "12.345.678.9-012.345",
  bruto: 10000000, deduction: 1000000, taxRegular: 100000, taxIrregular: 0, net: 8900000,
  actualNetTax: null, notes: null,
  items: [
    { code: "GP", name: "Gaji Pokok", wageType: "Base", type: "Earning", amount: 8000000, note: null },
    { code: "PPH21", name: "PPh 21", wageType: "Tax", type: "Deduction", amount: 100000, note: null },
  ],
  company: { name: "PT Mitra Industri Internasional", address: "Jl. Raya Industri No. 1", city: "Jakarta Timur", phone: "021-123", email: null },
});

const NIK = "317207430555";
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); } };

console.log("[1] buildPayslipPdf dengan password (NIK)…");
const enc = await buildPayslipPdf(mkSlip(), { password: NIK });
ok("bytes mengandung /Encrypt", Buffer.from(enc.bytes).includes("/Encrypt"));
ok("result.encrypted = true", enc.encrypted);

console.log("[2] load TANPA sandi → harus gagal…");
try { await PDFDocument.load(enc.bytes); ok("load tanpa sandi ditolak", false); }
catch (e) { ok(`load tanpa sandi ditolak (${(e as Error).constructor.name})`, true); }

console.log("[3] load sandi SALAH → harus gagal…");
try { await PDFDocument.load(enc.bytes, { password: "salah123" }); ok("load sandi salah ditolak", false); }
catch (e) { ok("load sandi salah ditolak", true); }

console.log("[4] load sandi BENAR (NIK) → harus sukses…");
const opened = await PDFDocument.load(enc.bytes, { password: NIK });
ok(`dokumen terbuka (${opened.getPageCount()} halaman)`, opened.getPageCount() >= 1);

console.log("[5] regresi: buildPayslipPdf TANPA password…");
const plain = await buildPayslipPdf(mkSlip());
ok("bytes TIDAK mengandung /Encrypt", !Buffer.from(plain.bytes).includes("/Encrypt"));
const openedPlain = await PDFDocument.load(plain.bytes);
ok(`PDF biasa tetap terbuka (${openedPlain.getPageCount()} halaman)`, openedPlain.getPageCount() >= 1);

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
