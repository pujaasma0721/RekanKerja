// RekanKerja — SIMULASI THP stateless (P1.4-BM, D-BM9) ========================
// ============================================================================
// Estimasi take-home-pay HYPOTHETICAL — TIDAK persist domain payroll apa pun
// (satu baris ActivityLog tanpa nominal). Memakai FUNGSI & SUMBER DATA yang
// SAMA dgn engine run nyata supaya simulasi ≠ janji gaji, tapi sekadar
// estimasi yang konsisten dgn mesin statutori:
//   • PTKP_ANNUAL + terCategoryOf + progressiveTax + floorToThousand +
//     terRateFor — diekspor dari payroll-engine.ts (sumber kebenaran tunggal;
//     diekspor behavior-neutral, lihat komentar di engine).
//   • Tabel TER resmi (Lampiran PMK 168/2023) + bracket Pasal 17 — dibaca dari
//     DB tenant (getTerRates/getBrackets — sumber yang sama dgn calculateRun).
//   • Biaya jabatan (default 5% cap 500rb/bln = 6jt/thn) — dari regulasi aktif.
//
// Semantik (mirror engine):
//   • Bulan REGULER: neto disetahunkan ×12 → PKP dibulatkan ribuan → Pasal 17
//     progresif dibagi 12; TER = rate tabel × bruto (hanya utk NPWP — engine
//     memaksa Pasal 17 utk non-NPWP; rate tidak ditemukan → fallback Pasal 17,
//     mirror D-4 engine).
//   • Bulan IREGULER (THR/bonus): TER TIDAK BOLEH dipakai (PP 58/2023 Pasal 15
//     ayat (4) — D-2 engine). PPh21 = Pasal 17 atas (penghasilan − iuran −
//     biaya jabatan − PTKP setahun) PENUH — asumsi simulasi TANPA penghasilan
//     regular lain tahun berjalan (estimasi konservatif; run nyata memakai
//     konteks YTD — lihat computeSupplementalTaxOn).
//   • Gross-up (NetToGross): iterasi ≤30× konvergen ≤ Rp 0,5 — mirror loop
//     gross-up engine (payroll-engine.ts "5. NetToGross").
//   • Iuran pensiun pegawai (JHT+JP+JKP) = pengurang neto pajak (UU PPh 21(3)
//     (a) + PP 6/2025) DAN potongan THP; potongan non-pajak (pinjaman dsb.)
//     hanya memotong THP.
// ============================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  PTKP_ANNUAL,
  TAX_STATUS_LABEL,
  terCategoryOf,
  progressiveTax,
  floorToThousand,
  terRateFor,
  type EngineBracket,
  type EngineTer,
} from "@/rekankerja/payroll/services/payroll-engine";
import { getActiveRegulation, getBrackets, getTerRates } from "@/rekankerja/payroll/services/payroll-service";

// ============ tipe input/output ============

export interface SimulationComponentInput {
  name: string;
  amount: number;
}

export interface SimulationInput {
  /** Komponen bruto (pendapatan reguler bulanan) — hypothetical, manual. */
  components: SimulationComponentInput[];
  /** Potongan non-pajak (pinjaman, dsb.) — hanya memotong THP, bukan basis pajak. */
  deductionsNonTaxable?: SimulationComponentInput[];
  /** Iuran pensiun pegawai (JHT+JP+JKP) — pengurang neto pajak + potongan THP. */
  iuranPensiun?: number;
  /** Override biaya jabatan (default dari regulasi aktif: 5% cap 500rb/bln). */
  biayaJabatan?: { rate?: number; capMonthly?: number };
  /** Status PTKP manual (TK0..KI3). */
  ptkpCategory: string;
  npwp: boolean;
  month: "regular" | "irregular";
  grossUp: boolean;
  method: "TER" | "Pasal17";
}

export interface SimulationBreakdownRow {
  /** kunci stabil utk terjemahan UI (biayaJabatan|ptkp|pkp|tax|taxAllow). */
  key: string;
  /** label tampil (ID — UI menerjemahkan via key bila dikenal). */
  name: string;
  amount: number;
  /** earn = menambah THP · deduct = memotong THP · info = keterangan pajak. */
  tone: "earn" | "deduct" | "info";
}

export interface SimulationResult {
  /** Σ komponen bruto yang dimasukkan (sebelum tunjangan pajak). */
  bruto: number;
  /** Tunjangan PPh21 ditanggung perusahaan (gross-up; 0 bila bukan N2G). */
  taxAllowance: number;
  /** Basis pajak = bruto + taxAllowance. */
  grossTotal: number;
  deductions: { name: string; amount: number; kind: "IuranPensiun" | "NonTaxable" }[];
  netBeforeTax: number;
  ptkp: number;
  pkpMonthly: number;
  taxMonthly: number;
  netAfterTax: number;
  terCategory: "A" | "B" | "C";
  terRate: number | null;
  biayaJabatan: number;
  ptkpAnnual: number;
  pkpAnnual: number;
  methodUsed: "TER" | "Pasal17";
  methodRequested: "TER" | "Pasal17";
  grossUpApplied: boolean;
  terFallback: boolean;
  breakdown: SimulationBreakdownRow[];
}

// ============ validasi input ============

const PTKP_KEYS = Object.keys(PTKP_ANNUAL);

export function validateSimulationInput(b: unknown): { input?: SimulationInput; error?: string } {
  if (typeof b !== "object" || b === null) return { error: "Body wajib objek JSON" };
  const raw = b as Record<string, unknown>;
  const comps = Array.isArray(raw.components) ? raw.components : [];
  if (comps.length === 0) return { error: "Minimal 1 komponen bruto wajib diisi" };
  const components: SimulationComponentInput[] = [];
  for (const c of comps) {
    if (typeof c !== "object" || c === null) return { error: "Komponen bruto tidak valid" };
    const { name, amount } = c as { name?: unknown; amount?: unknown };
    const amt = Number(amount);
    if (typeof name !== "string" || !name.trim()) return { error: "Nama komponen bruto wajib diisi" };
    if (!Number.isFinite(amt) || amt < 0) return { error: `Nominal komponen "${name}" tidak valid (≥ 0)` };
    components.push({ name: name.trim(), amount: amt });
  }
  const deds = Array.isArray(raw.deductionsNonTaxable) ? raw.deductionsNonTaxable : [];
  const deductionsNonTaxable: SimulationComponentInput[] = [];
  for (const c of deds) {
    if (typeof c !== "object" || c === null) return { error: "Potongan non-pajak tidak valid" };
    const { name, amount } = c as { name?: unknown; amount?: unknown };
    const amt = Number(amount);
    if (typeof name !== "string" || !name.trim()) return { error: "Nama potongan non-pajak wajib diisi" };
    if (!Number.isFinite(amt) || amt < 0) return { error: `Nominal potongan "${name}" tidak valid (≥ 0)` };
    deductionsNonTaxable.push({ name: name.trim(), amount: amt });
  }
  const iuranPensiun = raw.iuranPensiun == null ? 0 : Number(raw.iuranPensiun);
  if (!Number.isFinite(iuranPensiun) || iuranPensiun < 0) {
    return { error: "Iuran pensiun tidak valid (≥ 0)" };
  }
  const ptkpCategory = String(raw.ptkpCategory ?? "");
  if (!PTKP_KEYS.includes(ptkpCategory)) {
    return { error: "Status PTKP tidak dikenal (pilih TK0..KI3)" };
  }
  const npwp = raw.npwp !== false;
  const month = raw.month === "irregular" ? "irregular" : "regular";
  const grossUp = raw.grossUp === true;
  const method = raw.method === "Pasal17" ? "Pasal17" : "TER";
  let biayaJabatan: SimulationInput["biayaJabatan"] | undefined;
  if (raw.biayaJabatan != null && typeof raw.biayaJabatan === "object") {
    const bj = raw.biayaJabatan as { rate?: unknown; capMonthly?: unknown };
    const rate = bj.rate == null ? undefined : Number(bj.rate);
    const capMonthly = bj.capMonthly == null ? undefined : Number(bj.capMonthly);
    if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
      return { error: "Tarif biaya jabatan tidak valid (0..1, mis. 0.05)" };
    }
    if (capMonthly != null && (!Number.isFinite(capMonthly) || capMonthly < 0)) {
      return { error: "Cap biaya jabatan tidak valid (≥ 0)" };
    }
    biayaJabatan = { ...(rate != null ? { rate } : {}), ...(capMonthly != null ? { capMonthly } : {}) };
  }
  return { input: { components, deductionsNonTaxable, iuranPensiun, biayaJabatan, ptkpCategory, npwp, month, grossUp, method } };
}

// ============ kalkulasi (murni — tanpa mutasi) ============

interface TaxCtx {
  reg: { biayaJabatanRate: number; biayaJabatanCapMonthly: number };
  brackets: EngineBracket[];
  ter: EngineTer[];
}

/**
 * Satu kalkulasi pajak atas `gross` (mirror computeTaxOn engine untuk bulan
 * reguler tanpa komponen ireguler + jalur ireguler tanpa konteks regular).
 */
function computeTaxOn(gross: number, input: SimulationInput, ctx: TaxCtx): {
  taxMonthly: number; biayaJabatan: number; terRate: number | null; terFallback: boolean;
} {
  const biayaJabatan = Math.min(gross * ctx.reg.biayaJabatanRate, ctx.reg.biayaJabatanCapMonthly);
  const ptkpAnnual = PTKP_ANNUAL[input.ptkpCategory] ?? PTKP_ANNUAL.TK0;
  let taxMonthly: number;
  let terRate: number | null = null;
  let terFallback = false;

  if (input.month === "irregular") {
    // D-2 engine: bulan ireguler WAJIB Pasal 17 (TER dilarang). Asumsi simulasi
    // tanpa penghasilan regular lain → PPh21 = Pasal 17 atas (penghasilan − iuran
    // − biaya jabatan − PTKP SETAHUN) penuh (bukan /12).
    const pkp = Math.max(0, floorToThousand(gross - input.iuranPensiun - biayaJabatan - ptkpAnnual));
    taxMonthly = Math.max(0, progressiveTax(pkp, ctx.brackets, input.npwp));
  } else if (input.method === "TER" && input.npwp) {
    // TER hanya utk pemotong NPWP (mirror engine: non-NPWP → Pasal 17).
    const rate = terRateFor(gross, input.ptkpCategory, ctx.ter);
    if (rate != null) {
      terRate = rate;
      taxMonthly = Math.max(0, gross * rate);
    } else {
      // D-4 engine: lapisan TER tak ditemukan → fallback Pasal 17 (bukan 0 senyap).
      terFallback = true;
      const netoAnnual = (gross - input.iuranPensiun - biayaJabatan) * 12;
      const pkp = Math.max(0, floorToThousand(netoAnnual - ptkpAnnual));
      taxMonthly = Math.max(0, progressiveTax(pkp, ctx.brackets, input.npwp) / 12);
    }
  } else {
    // Pasal 17 progresif annualized (jalur reguler engine).
    const netoAnnual = (gross - input.iuranPensiun - biayaJabatan) * 12;
    const pkp = Math.max(0, floorToThousand(netoAnnual - ptkpAnnual));
    taxMonthly = Math.max(0, progressiveTax(pkp, ctx.brackets, input.npwp) / 12);
  }
  return { taxMonthly: Math.round(taxMonthly), biayaJabatan, terRate, terFallback };
}

/** Jalankan simulasi THP (stateless — hanya baca regulasi/tabel pajak tenant). */
export async function runThpSimulation(db: TenantDb, input: SimulationInput): Promise<SimulationResult> {
  const [regFull, brackets, ter] = await Promise.all([getActiveRegulation(db), getBrackets(db), getTerRates(db)]);
  const ctx: TaxCtx = {
    reg: {
      biayaJabatanRate: input.biayaJabatan?.rate ?? regFull.biayaJabatanRate,
      biayaJabatanCapMonthly: input.biayaJabatan?.capMonthly ?? regFull.biayaJabatanCapMonthly,
    },
    brackets,
    ter,
  };

  const bruto = input.components.reduce((s, c) => s + c.amount, 0);
  const ptkpAnnual = PTKP_ANNUAL[input.ptkpCategory] ?? PTKP_ANNUAL.TK0;

  // Gross-up iteratif (mirror loop "5. NetToGross" engine — konvergen ≤0,5 rupiah).
  let taxAllowance = 0;
  let info = computeTaxOn(bruto, input, ctx);
  if (input.grossUp) {
    let extra = 0;
    for (let i = 0; i < 30; i++) {
      const t = computeTaxOn(bruto + extra, input, ctx);
      const nextExtra = t.taxMonthly;
      if (Math.abs(nextExtra - extra) < 0.5) { extra = nextExtra; info = t; break; }
      extra = nextExtra;
      info = computeTaxOn(bruto + extra, input, ctx);
    }
    taxAllowance = Math.round(extra);
    info = computeTaxOn(bruto + taxAllowance, input, ctx);
  }

  const grossTotal = bruto + taxAllowance;
  const deductions: SimulationResult["deductions"] = [];
  if (input.iuranPensiun > 0) {
    deductions.push({ name: "Iuran Pensiun (JHT + JP + JKP pegawai)", amount: input.iuranPensiun, kind: "IuranPensiun" });
  }
  for (const d of input.deductionsNonTaxable ?? []) {
    if (d.amount > 0) deductions.push({ name: d.name, amount: d.amount, kind: "NonTaxable" });
  }
  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const netBeforeTax = grossTotal - totalDeductions;
  const netAfterTax = netBeforeTax - info.taxMonthly;

  const methodUsed: "TER" | "Pasal17" =
    input.month === "irregular" || !input.npwp || info.terFallback || input.method === "Pasal17" || info.terRate == null
      ? "Pasal17"
      : "TER";

  const pkpAnnual =
    input.month === "irregular"
      ? Math.max(0, floorToThousand(grossTotal - input.iuranPensiun - info.biayaJabatan - ptkpAnnual))
      : Math.max(0, floorToThousand((grossTotal - input.iuranPensiun - info.biayaJabatan) * 12 - ptkpAnnual));

  const breakdown: SimulationBreakdownRow[] = [
    ...input.components.map((c) => ({ key: "component", name: c.name, amount: c.amount, tone: "earn" as const })),
    ...(taxAllowance > 0
      ? [{ key: "taxAllow", name: "Tunjangan PPh21 Ditanggung Perusahaan", amount: taxAllowance, tone: "earn" as const }]
      : []),
    ...deductions.map((d) => ({ key: d.kind === "IuranPensiun" ? "iuran" : "deduction", name: d.name, amount: d.amount, tone: "deduct" as const })),
    { key: "biayaJabatan", name: "Biaya jabatan (pengurang neto pajak)", amount: info.biayaJabatan, tone: "info" },
    { key: "ptkp", name: `PTKP ${TAX_STATUS_LABEL[input.ptkpCategory] ?? input.ptkpCategory}`, amount: ptkpAnnual, tone: "info" },
    { key: "pkp", name: "PKP setahun (dibulatkan ribuan)", amount: pkpAnnual, tone: "info" },
    { key: "tax", name: `PPh21 (${methodUsed === "TER" ? "TER" : "Pasal 17"})`, amount: info.taxMonthly, tone: "deduct" },
  ];

  return {
    bruto,
    taxAllowance,
    grossTotal,
    deductions,
    netBeforeTax,
    ptkp: ptkpAnnual / 12,
    // Bulan reguler: PKP setahun ÷ 12. Bulan ireguler: pembayaran tunggal —
    // basis kena pajak pembayaran INI (tidak dibagi 12).
    pkpMonthly: input.month === "irregular" ? pkpAnnual : Math.round(pkpAnnual / 12),
    taxMonthly: info.taxMonthly,
    netAfterTax,
    terCategory: terCategoryOf(input.ptkpCategory),
    terRate: info.terRate,
    biayaJabatan: info.biayaJabatan,
    ptkpAnnual,
    pkpAnnual,
    methodUsed,
    methodRequested: input.method,
    grossUpApplied: input.grossUp && taxAllowance > 0,
    terFallback: info.terFallback,
    breakdown: breakdown.map((b) => ({ ...b, amount: Math.round(b.amount) })),
  };
}
