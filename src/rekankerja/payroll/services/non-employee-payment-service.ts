// RekanKerja — PEMBAYARAN BUKAN PEGAWAI (PMK 168/2023) ========================
// =====================================================================
// Kategori penerima "Bukan Pegawai" (Pasal 1 & 3(2) PMK 168/2023): tenaga ahli
// yang melakukan Pekerjaan Bebas (konsultan, akuntan, dokter, notaris, dsb.),
// pemberi jasa, agen, influencer — dibayar honorarium/komisi/fee, BUKAN gaji.
// Mereka bukan Pegawai Tetap/Tidak Tetap, jadi TIDAK lewat mesin payroll
// karyawan (PTKP, biaya jabatan, TER bulanan tidak berlaku).
//
// PPh21 (Pasal 12(3) + 16(3) PMK 168/2023):
//   DPP  = 50% × penghasilan bruto
//   PPh  = tarif Pasal 17 UU PPh (bracket progresif) × DPP  — sifatnya FINAL
// Rate non-NPWP (surcharge ×120% UU HPP) dibaca dari baris TaxBracket tenant →
// yurisdiksi tarif tetap SATU sumber kebenaran dengan mesin payroll.
//
// Bukti potong dilaporkan sebagai bupot "Pembayaran kepada Pihak Lain"
// (e-Bupot 21/26 / Coretax) — BUKAN 1721-A1. Ledger per masa pajak di sini
// adalah kertas kerja pemotong (kewajiban Pasal 20 ayat (1) huruf c).
// =====================================================================
import { progressiveTax, type EngineBracket } from "@/rekankerja/payroll/services/payroll-engine";

/** DPP Bukan Pegawai = 50% × bruto (Pasal 12(3) PMK 168/2023). */
export const NON_EMPLOYEE_DPP_RATE = 0.5;

export interface NonEmployeeTaxItem {
  code: string; name: string; kind: "Earning" | "Deduction" | "Information" | "Tax";
  amount: number; note?: string;
}

export interface NonEmployeeTaxResult {
  gross: number;
  excludedNotes: string; // catatan komponen yang dikeluarkan dari bruto (Pasal 12(4)-(5))
  dpp: number; // 50% × gross
  dppRate: number;
  pph21: number; // tarif Pasal 17 × DPP — FINAL
  net: number; // gross − PPh21
  brackets: { lower: number; upper: number | null; rate: number; taxable: number; tax: number }[]; // kertas kerja lapisan
  hasNpwp: boolean;
  items: NonEmployeeTaxItem[]; // baris slip untuk UI
}

export interface TaxContext {
  brackets: EngineBracket[];
  hasNpwp: boolean;
}

/** Tahun/masa pajak dari tanggal pembayaran — kunci ledger bukti potong. */
export function taxPeriodOf(date: Date): { year: number; month: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * Kalkulasi MURNI (tanpa mutasi DB) PPh21 final pembayaran Bukan Pegawai.
 * `ctx.brackets` dari tabel TaxBracket tenant (sumber sama dengan engine
 * payroll) — pembulatan: PPh21 KE BAWAH rupiah penuh (PMK 168/2023 — "dibulatkan
 * ke bawah dalam rupiah penuh"); bruto/DPP rupiah penuh (tanpa pembulatan ribuan —
 * itu konsep PKP karyawan progresif, tidak berlaku di sini).
 */
export function computeNonEmployeeTax(gross: number, ctx: TaxContext, excludedNotes?: string | null): NonEmployeeTaxResult {
  const g = Math.max(0, Math.round(gross));
  const dpp = Math.round(g * NON_EMPLOYEE_DPP_RATE); // Pasal 12(3)
  const rate = (b: EngineBracket) => (ctx.hasNpwp ? b.rateNpwp : b.rateNonNpwp);
  const pph21 = Math.floor(progressiveTax(dpp, ctx.brackets, ctx.hasNpwp)); // ke bawah rupiah penuh
  const items: NonEmployeeTaxItem[] = [
    { code: "NEP_FEE", name: "Imbalan (honorarium/komisi/fee)", kind: "Earning", amount: g, note: "Penghasilan bruto Bukan Pegawai" },
    ...(excludedNotes ? [{ code: "NEP_EXCL", name: "Dikeluarkan dari bruto", kind: "Information" as const, amount: 0, note: excludedNotes }] : []),
    { code: "NEP_DPP", name: "Dasar Pengenaan Pajak (50% bruto)", kind: "Information", amount: dpp, note: "Pasal 12(3) PMK 168/2023" },
    { code: "NEP_PPH", name: "PPh21 Final (tarif Pasal 17 UU PPh)", kind: "Tax", amount: pph21, note: "Pasal 16(3) PMK 168/2023 — sifat final" },
    { code: "NEP_NET", name: "Dibayarkan ke Bukan Pegawai", kind: "Information", amount: g - pph21 },
  ];
  // breakdown lapisan (kertas kerja Pasal 20(1)(c))
  const brackets: NonEmployeeTaxResult["brackets"] = [];
  const sorted = [...ctx.brackets].sort((a, b) => a.lowerLimit - b.lowerLimit);
  for (const b of sorted) {
    if (dpp <= b.lowerLimit) break;
    const upper = b.upperLimit ?? Infinity;
    const taxable = Math.min(dpp, upper) - b.lowerLimit;
    if (taxable <= 0) break;
    brackets.push({ lower: b.lowerLimit, upper: b.upperLimit, rate: rate(b), taxable, tax: Math.floor(taxable * rate(b)) });
  }
  return { gross: g, excludedNotes: excludedNotes ?? "", dpp, dppRate: NON_EMPLOYEE_DPP_RATE, pph21, net: g - pph21, brackets, hasNpwp: ctx.hasNpwp, items };
}

// ============ nomor dokumen ============
// BPNP-2026-0001 berurutan per tenant per tahun (pola sama dengan modul
// medical/leave: max-scan prefix — PM2 fork single-instance, tanpa race nyata).

export async function nextDocNo(db: { nonEmployeePayment: { findMany(a: object): Promise<{ docNo: string }[]> } }, year: number): Promise<string> {
  const start = `BPNP-${year}-`;
  const rows = await db.nonEmployeePayment.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

// ============ ledger bukti potong per masa pajak ============

export interface TaxPeriodLedgerRow {
  year: number;
  month: number;
  paymentCount: number;
  totalGross: number;
  totalDpp: number;
  totalPph21: number;
}

/** Kertas kerja rekap per masa pajak dari pembayaran (status Paid) tenant. */
export function ledgerOfPayments(rows: { taxYear: number; taxMonth: number; gross: number; dpp: number; pph21: number }[]): TaxPeriodLedgerRow[] {
  const map = new Map<string, TaxPeriodLedgerRow>();
  for (const r of rows) {
    const k = `${r.taxYear}-${String(r.taxMonth).padStart(2, "0")}`;
    const cur = map.get(k) ?? { year: r.taxYear, month: r.taxMonth, paymentCount: 0, totalGross: 0, totalDpp: 0, totalPph21: 0 };
    cur.paymentCount += 1;
    cur.totalGross += r.gross;
    cur.totalDpp += r.dpp;
    cur.totalPph21 += r.pph21;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

/** Validasi transisi status pembayaran Bukan Pegawai. */
export function canTransition(from: string, to: string): boolean {
  const allowed: Record<string, string[]> = {
    Draft: ["Draft", "Paid", "Cancelled"], // Draft→Draft = kalkulasi ulang
    Paid: ["Paid", "Cancelled"], // pembayaran final tidak kembali Draft
    Cancelled: ["Cancelled"],
  };
  return (allowed[from] ?? []).includes(to);
}

/** Nama bulan masa pajak (ledger & ekspor). */
export const TAX_MONTH_LABELS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
