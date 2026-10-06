// AUDIT PMK 168/2023 — verifikasi kalkulasi modul Pembayaran Bukan Pegawai
// Contoh resmi: Lampiran PMK 168/2023 V.3 (Tuan T) & V.4 (Tuan V).
// Jalankan: bun scripts/audit-non-employee-pmk168.ts
import { computeNonEmployeeTax, ledgerOfPayments, canTransition, taxPeriodOf } from "@/rekankerja/payroll/services/non-employee-payment-service";
import { progressiveTax } from "@/rekankerja/payroll/services/payroll-engine";
import type { EngineBracket } from "@/rekankerja/payroll/services/payroll-engine";

// Bracket seed UU HPP (provisioning.ts:325-331) + surcharge ×1.2
const BR: EngineBracket[] = [
  { lowerLimit: 0, upperLimit: 60_000_000, rateNpwp: 0.05, rateNonNpwp: 0.06 },
  { lowerLimit: 60_000_000, upperLimit: 250_000_000, rateNpwp: 0.15, rateNonNpwp: 0.18 },
  { lowerLimit: 250_000_000, upperLimit: 500_000_000, rateNpwp: 0.25, rateNonNpwp: 0.30 },
  { lowerLimit: 500_000_000, upperLimit: 5_000_000_000, rateNpwp: 0.30, rateNonNpwp: 0.36 },
  { lowerLimit: 5_000_000_000, upperLimit: null, rateNpwp: 0.35, rateNonNpwp: 0.42 },
];

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (ok) { pass++; } else { fail++; }
  console.log(`${ok ? "PASS" : "FAIL"} | ${label}: got=${got} want=${want}`);
}

console.log("== Contoh Lampiran V.3 (Tuan T): bruto 7.000.000, NPWP ==");
const t = computeNonEmployeeTax(7_000_000, { brackets: BR, hasNpwp: true });
eq("DPP (50% × bruto)", t.dpp, 3_500_000);
eq("PPh21 (5% × DPP)", t.pph21, 175_000); // resmi: Rp175.000
eq("Neto", t.net, 6_825_000);
eq("Lapisan terpakai", t.brackets.length, 1);

console.log("== Contoh Lampiran V.4 (Tuan V): bruto setelah eksklusi 4.500.000, NPWP ==");
const v = computeNonEmployeeTax(4_500_000, { brackets: BR, hasNpwp: true }, "upah ahli kelistrikan 4,5jt + komponen AC 1jt (kontrak & faktur)");
eq("DPP (50% × 4,5jt)", v.dpp, 2_250_000);
eq("PPh21 (5% × DPP)", v.pph21, 112_500); // resmi: Rp112.500

console.log("== T107: eksklusi numerik Pasal 12(4)(b) dikurangkan SEBELUM ×50% ==");
const v4 = computeNonEmployeeTax(10_000_000, { brackets: BR, hasNpwp: true }, "upah ahli kelistrikan 4,5jt + komponen AC 1jt — kontrak & faktur terlampir", 5_500_000);
eq("Bruto (penuh)", v4.gross, 10_000_000);
eq("Eksklusi", v4.excluded, 5_500_000);
eq("Bruto kena pajak", v4.taxableGross, 4_500_000);
eq("DPP (50% × 4,5jt)", v4.dpp, 2_250_000);
eq("PPh21 = 5% × 2,25jt", v4.pph21, 112_500); // resmi Lampiran V.4: Rp112.500
eq("Neto dibayar (10jt − 112,5rb)", v4.net, 9_887_500);

console.log("== T107: guard katering (Pasal 12(4)(a) — eksklusi DILARANG) ==");
let cateringThrew = false;
try {
  computeNonEmployeeTax(10_000_000, { brackets: BR, hasNpwp: true, isCatering: true }, null, 1_000_000);
} catch { cateringThrew = true; }
eq("Katering + eksklusi → throw", cateringThrew, true);
const cat = computeNonEmployeeTax(10_000_000, { brackets: BR, hasNpwp: true, isCatering: true });
eq("Katering tanpa eksklusi → DPP 50% × bruto penuh", cat.dpp, 5_000_000);

console.log("== T107: eksklusi > bruto → di-clamp ke bruto (DPP=0) ==");
const over = computeNonEmployeeTax(3_000_000, { brackets: BR, hasNpwp: true }, null, 9_000_000);
eq("Eksklusi di-clamp", over.excluded, 3_000_000);
eq("DPP = 0", over.dpp, 0);
eq("PPh21 = 0", over.pph21, 0);

console.log("== Non-NPWP (surcharge 20% UU HPP Ps.17(1a)) ==");
const n = computeNonEmployeeTax(7_000_000, { brackets: BR, hasNpwp: false });
eq("PPh21 non-NPWP (6% × 3,5jt)", n.pph21, 210_000);

console.log("== Lintas lapisan: bruto 800.000.000 NPWP ==");
const big = computeNonEmployeeTax(800_000_000, { brackets: BR, hasNpwp: true });
eq("DPP", big.dpp, 400_000_000);
eq("PPh21 (5%×60jt + 15%×190jt + 25%×150jt)", big.pph21, 69_000_000);
eq("Lapisan terpakai", big.brackets.length, 3);

console.log("== Pembulatan ke bawah ==");
const odd = computeNonEmployeeTax(10_000_123, { brackets: BR, hasNpwp: true });
eq("PPh21 dibulatkan ke bawah (5.000.061×5%→250.003,05→? )", odd.pph21, Math.floor(5_000_061.5 * 0.05));

console.log("== Status/periode/transisi ==");
eq("taxPeriodOf 2026-03-15", JSON.stringify(taxPeriodOf(new Date("2026-03-15"))), '{"year":2026,"month":3}');
eq("Draft→Paid", canTransition("Draft", "Paid"), true);
eq("Paid→Draft (dilarang)", canTransition("Paid", "Draft"), false);
eq("Paid→Cancelled (boleh)", canTransition("Paid", "Cancelled"), true);
eq("Cancelled→Draft (dilarang)", canTransition("Cancelled", "Draft"), false);

const led = ledgerOfPayments([
  { taxYear: 2026, taxMonth: 1, gross: 7_000_000, dpp: 3_500_000, pph21: 175_000 },
  { taxYear: 2026, taxMonth: 1, gross: 4_500_000, dpp: 2_250_000, pph21: 112_500 },
  { taxYear: 2026, taxMonth: 2, gross: 7_000_000, dpp: 3_500_000, pph21: 175_000 },
]);
eq("Ledger Jan: jumlah pembayaran", led[1].paymentCount, 2);
eq("Ledger Jan: total PPh21", led[1].totalPph21, 287_500);

console.log(`\n=== HASIL: ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
