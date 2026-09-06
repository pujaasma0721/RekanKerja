// OneVity Settlement Service (T19) — Final Settlement PHK (UU 13/2003 jo. UU 11/2020)
// =====================================================================
// Kalkulasi hak karyawan saat pemutusan hubungan kerja:
//   (a) masa kerja (tahun + bulan, joinDate → tanggal efektif)
//   (b) pesangon dasar — UPMK No. 6/PHK/2004/PU-IX/2004:
//       <1th 1 bln · 1-2th 2 bln · 2-3th 3 bln · 3-6th 4 bln
//       6-9th 6 bln · 9-12th 8 bln · ≥12th 9 bln  → × upah
//   (c) faktor UPMK × multiplier manual (0,5 / 1 / 1,5 / 2 — default 1)
//   (d) uang pisah — % dari pesangon (default 15% bila PHK efisiensi)
//   (e) uang pengganti cuti belum diambil — hari × upah/25 (CT-THN)
//   (f) THR prorata — masa kerja tahun berjalan/12 × upah (≥1 th → penuh)
//   (g) penggantian hak — bonus pro-rata (opsional)
//   (h) potongan — sisa pinjaman karyawan aktif + saldo cuti negatif
//   (i) PPh21 FINAL (UU 36/2008 Pasal 17(1)(d) / PP 68/2009 Pasal 5(3)):
//       0-50jt 0% · 50-100jt 10% · 100-500jt 20% · >500jt 25%
//       atas kelompok pesangon (pesangon + uang pisah + penggantian hak).
//
// Hasil breakdown dipetakan ke EmployeeComponentAssignment Specific
// (period × ProcessType TERMINATION) — komponen standar find-or-create:
// PESANGON, UANG_PISAH, THR_PRORATA, CUTI_CASH, PHK_POT_LOAN, PHK_TAX
// (incomeTaxMethod SeveranceFinal → engine payroll TIDAK memotong pajak
// progresif; pajak final dihitung di sini sebagai komponen potongan).
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { nextRunNo } from "@/onevity/payroll/services/payroll-service";

// ============ tipe hasil ============

export interface SettlementRow {
  /** kode komponen wage (PESANGON | UANG_PISAH | THR_PRORATA | CUTI_CASH | BONUS_PRO_RATA | PHK_POT_LOAN | PHK_POT_CUTI | PHK_TAX) */
  code: string;
  label: string;
  kind: "Earning" | "Deduction";
  /** nilai POSITIF (tanda ditentukan kind) */
  amount: number;
  /** penjelasan rumus per baris (audit + UI) */
  note: string;
}

export interface SettlementTaxBracketRow {
  lowerLimit: number;
  upperLimit: number | null;
  rate: number;
  taxable: number;
  tax: number;
}

export interface SettlementResult {
  employee: { id: string; employeeNo: string; fullName: string; joinDate: string };
  effectiveDate: string;
  /** masa kerja (joinDate → effectiveDate) */
  masaKerja: { years: number; months: number; totalMonths: number; label: string };
  /** upah PHK = gaji pokok assignment + tunjangan tetap (Periodic Earning) */
  upah: { baseSalary: number; fixedAllowances: number; total: number; note: string };
  params: SettlementParams;
  rows: SettlementRow[];
  /** total komponen Earning sebelum potongan & pajak */
  gross: number;
  /** kelompok pesangon (dasar pajak final) */
  taxBase: number;
  taxBrackets: SettlementTaxBracketRow[];
  tax: number;
  /** total potongan non-pajak (pinjaman + cuti negatif) */
  deductions: number;
  /** grand net = gross − deductions − tax */
  net: number;
  notes: string[];
}

export interface SettlementParams {
  /** faktor UPMK (0,5 tanpa alasan pengurangan / 1 efisiensi / 1,5-2 tanpa alasan) */
  pesangonMultiplier: number;
  /** % uang pisah dari pesangon (0 = tidak ada; default 15 utk PHK efisiensi) */
  uangPisahPct: number;
  /** penggantian hak: bonus pro-rata masa kerja tahun berjalan */
  includeBonusProRata: boolean;
}

export interface SettlementApplyResult {
  result: SettlementResult;
  period: { id: string; code: string; name: string } | null;
  processType: { id: string; code: string; name: string } | null;
  assignmentsCreated: number;
  assignmentsUpdated: number;
  runNo: string | null;
  runId: string | null;
}

// ============ konstanta regulasi ============

// UPMK 6/2004 — bulan pesangon dasar berdasarkan masa kerja.
const PESANGON_MONTHS: { minYear: number; months: number }[] = [
  { minYear: 12, months: 9 },
  { minYear: 9, months: 8 },
  { minYear: 6, months: 6 },
  { minYear: 3, months: 4 },
  { minYear: 2, months: 3 },
  { minYear: 1, months: 2 },
  { minYear: 0, months: 1 },
];

function pesangonMonthsFor(totalMonths: number): number {
  const years = totalMonths / 12;
  for (const b of PESANGON_MONTHS) {
    if (years >= b.minYear) return b.months;
  }
  return 0;
}

// PPh21 FINAL kelompok pesangon (UU 36/2008 — iuran final, tanpa PTKP).
const FINAL_TAX_BRACKETS: { lower: number; upper: number | null; rate: number }[] = [
  { lower: 0, upper: 50_000_000, rate: 0 },
  { lower: 50_000_000, upper: 100_000_000, rate: 0.1 },
  { lower: 100_000_000, upper: 500_000_000, rate: 0.2 },
  { lower: 500_000_000, upper: null, rate: 0.25 },
];

export function finalTerminationTax(base: number): { tax: number; brackets: SettlementTaxBracketRow[] } {
  const brackets: SettlementTaxBracketRow[] = [];
  let tax = 0;
  for (const b of FINAL_TAX_BRACKETS) {
    const taxable = Math.max(0, Math.min(base, b.upper ?? Infinity) - b.lower);
    const t = Math.round(taxable * b.rate);
    brackets.push({ lowerLimit: b.lower, upperLimit: b.upper, rate: b.rate, taxable, tax: t });
    tax += t;
  }
  return { tax, brackets };
}

const fmtRp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

// ============ utilitas masa kerja ============

/** Selisih (tahun, bulan) antara dua tanggal — kalender penuh (utk masa kerja). */
export function tenureBetween(from: Date, to: Date): { years: number; months: number; totalMonths: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months -= 1;
  if (months < 0) { months += 12; years -= 1; }
  if (years < 0 || (years === 0 && months < 0)) return { years: 0, months: 0, totalMonths: 0 };
  return { years, months, totalMonths: years * 12 + months };
}

/** Bulan kerja tahun berjalan (pecahan bulan 2 desimal, 0..12) — basis prorata THR PMK 168. */
function monthsWorkedThisYear(joinDate: Date, effectiveDate: Date): number {
  const yearStart = new Date(effectiveDate.getFullYear(), 0, 1);
  const from = joinDate > yearStart ? joinDate : yearStart;
  if (from > effectiveDate) return 0;
  let months = (effectiveDate.getFullYear() - from.getFullYear()) * 12 + (effectiveDate.getMonth() - from.getMonth());
  const dayFrac = (effectiveDate.getDate() - from.getDate()) / 30;
  months += dayFrac;
  return Math.max(0, Math.min(12, Math.round(months * 100) / 100));
}

/** Bulan penuh terhitung (mirror earnedMonths leave-service): jumlah bulan
 *  kalender dari max(joinDate, from) hingga asOf, bulan berjalan dihitung (+1),
 *  dibatasi 0..12 — dipakai prorata saldo cuti tahunan. */
function earnedMonthsUntil(from: Date, joinDate: Date, asOf: Date): number {
  const start = joinDate > from ? joinDate : from;
  const m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth()) + 1;
  return Math.max(0, Math.min(12, m));
}

// ============ parameter ============

export function normalizeSettlementParams(input: Record<string, unknown> | null | undefined): SettlementParams {
  const raw = input ?? {};
  const mult = Number(raw.pesangonMultiplier ?? raw.multiplier ?? 1);
  const pct = Number(raw.uangPisahPct ?? (raw.uangPisah ? 15 : 0));
  return {
    pesangonMultiplier: Number.isFinite(mult) && mult > 0 && mult <= 3 ? mult : 1,
    uangPisahPct: Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 0,
    includeBonusProRata: raw.includeBonusProRata === true || raw.includeBonusProRata === "true",
  };
}

// ============ kalkulasi utama ============

/**
 * computeTerminationSettlement — kalkulasi MURNI (tanpa mutasi DB):
 * masa kerja, upah, pesangon + UPMK, uang pisah, cuti, THR prorata,
 * potongan pinjaman, PPh21 final, breakdown + grand net.
 */
export async function computeTerminationSettlement(
  db: TenantDb,
  employeeId: string,
  effectiveDate: Date,
  params: SettlementParams,
  reason?: string | null,
): Promise<SettlementResult> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      assignments: { orderBy: { validFrom: "desc" }, take: 1, include: { orgUnit: true, position: true } },
    },
  });
  if (!employee) throw new Error("Karyawan tidak ditemukan");
  // assignment TERAKHIR (bukan hanya aktif) — settlement dihitung saat/jl. karyawan keluar
  const assignment = employee.assignments[0];
  if (!assignment) throw new Error("Karyawan tidak memiliki penempatan (assignment) — upah PHK tidak dapat ditentukan");

  // --- (a) masa kerja ---
  const tenure = tenureBetween(employee.joinDate, effectiveDate);
  const masaLabel = tenure.years > 0
    ? `${tenure.years} tahun ${tenure.months} bulan`
    : `${tenure.totalMonths} bulan`;

  // --- upah: gaji pokok assignment + tunjangan tetap (Periodic Earning) ---
  const baseSalary = assignment.baseSalary;
  const periodic = await db.employeeComponentAssignment.findMany({
    where: { employeeId, kind: "Periodic", active: true, wageComponent: { type: "Earning", active: true } },
    include: { wageComponent: { select: { code: true, name: true } } },
  });
  const fixedAllowances = periodic.reduce((s, p) => s + p.amount, 0);
  const upah = baseSalary + fixedAllowances;
  const upahNote = fixedAllowances > 0
    ? `Gaji pokok ${fmtRp(baseSalary)} + tunjangan tetap ${periodic.map((p) => `${p.wageComponent.name} ${fmtRp(p.amount)}`).join(", ")}`
    : `Gaji pokok ${fmtRp(baseSalary)} (tanpa tunjangan tetap Periodic)`;

  const rows: SettlementRow[] = [];
  const notes: string[] = [];

  // --- (b)+(c) pesangon: bulan UPMK × upah × multiplier ---
  const pesangonMonths = pesangonMonthsFor(tenure.totalMonths);
  const multiplier = params.pesangonMultiplier;
  const pesangon = Math.round(pesangonMonths * upah * multiplier);
  if (pesangon > 0) {
    rows.push({
      code: "PESANGON",
      label: "Pesangon",
      kind: "Earning",
      amount: pesangon,
      note: `${pesangonMonths} bln (masa kerja ${masaLabel}) × ${fmtRp(upah)} × faktor UPMK ${multiplier}`,
    });
  } else {
    notes.push(`Masa kerja ${masaLabel} — pesangon dasar 0 bulan (UPMK: <1 tahun = 1 bulan upah prorata dihitung manual bila perlu)`);
  }

  // --- (d) uang pisah: % dari pesangon ---
  const uangPisah = params.uangPisahPct > 0 ? Math.round(pesangon * params.uangPisahPct / 100) : 0;
  if (uangPisah > 0) {
    rows.push({
      code: "UANG_PISAH",
      label: "Uang Pisah",
      kind: "Earning",
      amount: uangPisah,
      note: `${params.uangPisahPct}% × pesangon (Pasal 156(4) — PHK efisiensi)`,
    });
  }

  // --- (f) THR prorata: masa kerja tahun berjalan/12 × upah; ≥1 th → penuh ---
  const mWorked = monthsWorkedThisYear(employee.joinDate, effectiveDate);
  let thrAmount: number;
  let thrNote: string;
  if (tenure.totalMonths >= 12) {
    thrAmount = Math.round(upah);
    thrNote = `Masa kerja ≥ 1 tahun → 1 × upah penuh (PMK 168/2023)`;
  } else if (tenure.totalMonths >= 3) {
    const factor = Math.min(1, tenure.totalMonths / 12);
    thrAmount = Math.round(upah * factor);
    thrNote = `Masa kerja ${tenure.totalMonths} bln / 12 × ${fmtRp(upah)} (PMK 168 — prorata)`;
  } else {
    thrAmount = 0;
    thrNote = "Masa kerja < 3 bulan — belum berhak THR";
  }
  if (thrAmount > 0) {
    rows.push({ code: "THR_PRORATA", label: "THR Prorata", kind: "Earning", amount: thrAmount, note: thrNote });
  }

  // --- (e) uang pengganti cuti: saldo CT-THN tersisa × upah/25 ---
  // Saldo dihitung LOKAL (bukan listBalances leave-service): settlement dihitung
  // SETELAH status karyawan menjadi Terminated — listBalances memfilter hanya
  // karyawan Active. Semantik identik computeParts leave-service (CALENDAR),
  // dengan asOf = tanggal efektif PHK.
  const dailyWage = upah / 25; // 25 hari kerja per bulan (pasal 155 UU 13/2003)
  const effYear = effectiveDate.getFullYear();
  let leaveDays = 0;
  let leaveNote = "";
  try {
    const bal = await db.leaveBalance.findFirst({
      where: { employeeId, leaveType: { code: "CT-THN" }, year: effYear },
      include: { leaveType: true },
    });
    if (bal) {
      const from = employee.joinDate > new Date(effYear, 0, 1) ? employee.joinDate : new Date(effYear, 0, 1);
      const earned = bal.leaveType.prorateMonthly
        ? (bal.leaveType.entitlement * earnedMonthsUntil(from, employee.joinDate, effectiveDate)) / 12
        : bal.leaveType.entitlement;
      const reqs = await db.leaveRequest.findMany({
        where: { employeeId, leaveTypeId: bal.leaveTypeId, year: effYear, status: { in: ["Approved", "MassLeave"] } },
        select: { workingDays: true, dateTo: true },
      });
      let taken = 0;
      let applied = 0;
      const effDayStart = new Date(effectiveDate);
      effDayStart.setHours(0, 0, 0, 0);
      for (const r of reqs) {
        const to = new Date(r.dateTo);
        to.setHours(0, 0, 0, 0);
        if (to.getTime() < effDayStart.getTime()) taken += r.workingDays;
        else applied += r.workingDays;
      }
      leaveDays = Math.round((bal.carriedOver + earned + bal.adjustment - bal.cashed - taken - applied) * 100) / 100;
      leaveNote = `saldo ${bal.carriedOver} bawa + ${Math.round(earned * 100) / 100} earned − ${taken + applied} terpakai`;
    } else {
      leaveNote = `tidak ada baris saldo CT-THN ${effYear}`;
    }
  } catch {
    leaveNote = "saldo cuti tahunan tidak dapat dibaca";
  }
  const cutiCash = leaveDays > 0 ? Math.round(leaveDays * dailyWage) : 0;
  const cutiNegatif = leaveDays < 0 ? Math.round(-leaveDays * dailyWage) : 0;
  if (cutiCash > 0) {
    rows.push({
      code: "CUTI_CASH",
      label: "Uang Pengganti Cuti",
      kind: "Earning",
      amount: cutiCash,
      note: `${leaveDays} hari cuti belum diambil (CT-THN ${effYear} — ${leaveNote}) × ${fmtRp(upah)}/25`,
    });
  }
  if (cutiNegatif > 0) {
    rows.push({
      code: "PHK_POT_CUTI",
      label: "Potongan Cuti Lebih",
      kind: "Deduction",
      amount: cutiNegatif,
      note: `Saldo cuti negatif ${Math.abs(leaveDays)} hari × ${fmtRp(upah)}/25`,
    });
  }

  if (leaveDays === 0) {
    notes.push(`Uang pengganti cuti: 0 hari (${leaveNote || "saldo CT-THN habis"})`);
  }

  // --- (g) penggantian hak: bonus pro-rata (opsional) ---
  if (params.includeBonusProRata) {
    const factor = Math.min(1, mWorked / 12);
    const bonusProRata = Math.round(upah * factor);
    if (bonusProRata > 0) {
      rows.push({
        code: "BONUS_PRO_RATA",
        label: "Bonus Pro-rata (Penggantian Hak)",
        kind: "Earning",
        amount: bonusProRata,
        note: `${mWorked}/12 bulan tahun berjalan × ${fmtRp(upah)} — estimasi penggantian hak`,
      });
    }
  }

  // --- (h) potongan: sisa pinjaman aktif ---
  const loans = await db.employeeLoan.findMany({
    where: { employeeId, status: "Active" },
    select: { letterNo: true, outstanding: true },
  });
  const loanOutstanding = loans.reduce((s, l) => s + l.outstanding, 0);
  if (loanOutstanding > 0) {
    rows.push({
      code: "PHK_POT_LOAN",
      label: "Potongan Sisa Pinjaman",
      kind: "Deduction",
      amount: Math.round(loanOutstanding),
      note: `Sisa outstanding pinjaman ${loans.map((l) => `${l.letterNo} ${fmtRp(l.outstanding)}`).join(", ")}`,
    });
  }

  // --- (i) PPh21 final atas kelompok pesangon ---
  // (pesangon + uang pisah + seluruh penggantian hak — PP 68/2009 Pasal 5(3))
  const pesangonGroup = rows.filter((r) => r.kind === "Earning").reduce((s, r) => s + r.amount, 0);
  const { tax, brackets } = finalTerminationTax(pesangonGroup);
  if (tax > 0) {
    rows.push({
      code: "PHK_TAX",
      label: "PPh21 Final PHK",
      kind: "Deduction",
      amount: tax,
      note: `Iuran final atas ${fmtRp(pesangonGroup)}: 0-50jt 0% · 50-100jt 10% · 100-500jt 20% · >500jt 25% (UU 36/2008)`,
    });
  }

  const gross = rows.filter((r) => r.kind === "Earning").reduce((s, r) => s + r.amount, 0);
  const deductions = rows.filter((r) => r.kind === "Deduction" && r.code !== "PHK_TAX").reduce((s, r) => s + r.amount, 0);
  const net = gross - deductions - tax;

  if (reason) notes.push(`Alasan PA: ${reason}`);

  return {
    employee: {
      id: employee.id,
      employeeNo: employee.employeeNo,
      fullName: employee.fullName,
      joinDate: employee.joinDate.toISOString().slice(0, 10),
    },
    effectiveDate: effectiveDate.toISOString().slice(0, 10),
    masaKerja: { years: tenure.years, months: tenure.months, totalMonths: tenure.totalMonths, label: masaLabel },
    upah: { baseSalary, fixedAllowances, total: upah, note: upahNote },
    params,
    rows,
    gross,
    taxBase: pesangonGroup,
    taxBrackets: brackets,
    tax,
    deductions,
    net,
    notes,
  };
}

// ============ provisioning komponen standar ============

interface SettlementCompDef {
  code: string;
  name: string;
  type: "Earning" | "Deduction";
  wageType: string;
  incomeTaxMethod: string;
  accountDebitCode?: string;
  accountCreditCode?: string;
}

// Komponen settlement (find-or-create, idempoten per kode).
// incomeTaxMethod SeveranceFinal → engine payroll tidak memotong pajak progresif
// atas baris-baris ini (pajak final dihitung settlement-service sebagai PHK_TAX).
const SETTLEMENT_COMPONENTS: SettlementCompDef[] = [
  { code: "PESANGON", name: "Pesangon (PHK)", type: "Earning", wageType: "Compensation", incomeTaxMethod: "SeveranceFinal", accountDebitCode: "5101" },
  { code: "UANG_PISAH", name: "Uang Pisah (PHK)", type: "Earning", wageType: "Compensation", incomeTaxMethod: "SeveranceFinal", accountDebitCode: "5101" },
  { code: "THR_PRORATA", name: "THR Prorata (PHK)", type: "Earning", wageType: "Compensation", incomeTaxMethod: "SeveranceFinal", accountDebitCode: "5102" },
  { code: "CUTI_CASH", name: "Uang Pengganti Cuti (PHK)", type: "Earning", wageType: "Compensation", incomeTaxMethod: "SeveranceFinal", accountDebitCode: "5102" },
  { code: "BONUS_PRO_RATA", name: "Bonus Pro-rata (PHK)", type: "Earning", wageType: "Compensation", incomeTaxMethod: "SeveranceFinal", accountDebitCode: "5102" },
  { code: "PHK_POT_CUTI", name: "Potongan Cuti Lebih (PHK)", type: "Deduction", wageType: "Deduction", incomeTaxMethod: "NonTaxable", accountCreditCode: "2105" },
  { code: "PHK_POT_LOAN", name: "Potongan Sisa Pinjaman (PHK)", type: "Deduction", wageType: "Deduction", incomeTaxMethod: "NonTaxable", accountCreditCode: "2104" },
  { code: "PHK_TAX", name: "PPh21 Final PHK", type: "Deduction", wageType: "FinalTax", incomeTaxMethod: "NonTaxable", accountCreditCode: "2102" },
];

/** Temukan/buat komponen wage standar settlement — idempoten per kode. */
export async function ensureSettlementWageComponents(db: TenantDb): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const def of SETTLEMENT_COMPONENTS) {
    const existing = await db.wageComponent.findUnique({ where: { code: def.code } });
    const comp = existing ?? await db.wageComponent.create({
      data: {
        code: def.code, name: def.name, type: def.type, wageType: def.wageType,
        calcMethod: "Fixed", amount: 0, incomeTaxMethod: def.incomeTaxMethod,
        taxable: def.incomeTaxMethod !== "NonTaxable",
        includeInTHP: true, displayInPaySlip: true, prorated: false,
        accountDebitCode: def.accountDebitCode ?? null,
        accountCreditCode: def.accountCreditCode ?? null,
        sptReference: def.type === "Earning" ? "Gaji" : null,
      },
    });
    map.set(def.code, comp.id);
  }
  return map;
}

// ============ penerapan (assignment Specific × TERMINATION) ============

/** Period payroll berjalan: jendela memuat tanggal efektif, fallback terbaru non-Locked. */
async function currentPeriodFor(db: TenantDb, effectiveDate: Date) {
  const containing = await db.payrollPeriod.findFirst({
    where: { startDate: { lte: effectiveDate }, endDate: { gte: effectiveDate } },
    orderBy: { startDate: "desc" },
    select: { id: true, code: true, name: true, status: true },
  });
  if (containing) return containing;
  const latest = await db.payrollPeriod.findFirst({
    where: { status: { not: "Locked" } },
    orderBy: { endDate: "desc" },
    select: { id: true, code: true, name: true, status: true },
  });
  return latest;
}

/**
 * applyTerminationSettlement — hitung settlement lalu tulis EmployeeComponentAssignment
 * Specific (period berjalan × ProcessType TERMINATION) + ActivityLog breakdown + run
 * TERMINATION Draft (terbayar saat HR klik Hitung di UI runs — pola alur runs existing).
 * Idempoten per karyawan: assignment yang sudah ada di-update nilainya (bukan diduplikasi).
 * Dipanggil dari proses PA Termination (best-effort — pemanggil wajib try/catch).
 */
export async function applyTerminationSettlement(
  db: TenantDb,
  input: {
    employeeId: string;
    effectiveDate: Date;
    params: Record<string, unknown> | SettlementParams;
    paDocNo?: string;
    /** link ActivityLog ke dokumen PA (muncul di jejak aktivitas PA) */
    paId?: string;
    actor?: { appUserId: string | null; name: string };
  },
): Promise<SettlementApplyResult> {
  const params = input.params as SettlementParams & Record<string, unknown>;
  const norm: SettlementParams = "pesangonMultiplier" in params && "uangPisahPct" in params
    ? { pesangonMultiplier: params.pesangonMultiplier, uangPisahPct: params.uangPisahPct, includeBonusProRata: !!params.includeBonusProRata }
    : normalizeSettlementParams(params as Record<string, unknown>);

  // komputasi MURNI dulu — gagal hitung = tidak menulis apa pun
  const result = await computeTerminationSettlement(db, input.employeeId, input.effectiveDate, norm);

  // processType TERMINATION (provisioning fallback — pola rapel)
  let processType = await db.processType.findFirst({ where: { code: "TERMINATION" } });
  if (!processType) {
    const maxSeq = await db.processType.aggregate({ _max: { sequence: true } });
    processType = await db.processType.create({
      data: { code: "TERMINATION", name: "Pesangon & Final Settlement", sequence: (maxSeq._max.sequence ?? 5) + 1, calculateTax: true },
    });
  }

  const period = await currentPeriodFor(db, input.effectiveDate);
  if (!period) {
    throw new Error("Tidak ada period payroll — settlement tidak dapat dijadwalkan ke run TERMINATION");
  }

  const comps = await ensureSettlementWageComponents(db);

  // tulis assignment — idempoten: (employee × component × period × TERMINATION)
  let created = 0;
  let updated = 0;
  const notePrefix = `Final settlement PHK${input.paDocNo ? ` — PA ${input.paDocNo}` : ""} (${result.masaKerja.label}, efektif ${result.effectiveDate})`;
  for (const row of result.rows) {
    if (row.amount <= 0) continue;
    const wageComponentId = comps.get(row.code);
    if (!wageComponentId) continue;
    const existing = await db.employeeComponentAssignment.findFirst({
      where: {
        employeeId: input.employeeId, wageComponentId, kind: "Specific",
        periodId: period.id, processTypeId: processType.id, active: true,
      },
    });
    if (existing) {
      await db.employeeComponentAssignment.update({
        where: { id: existing.id },
        data: { amount: row.amount, notes: `${notePrefix}: ${row.note}` },
      });
      updated += 1;
    } else {
      await db.employeeComponentAssignment.create({
        data: {
          employeeId: input.employeeId, wageComponentId, kind: "Specific",
          amount: row.amount, periodId: period.id, processTypeId: processType.id,
          basedDate: input.effectiveDate, notes: `${notePrefix}: ${row.note}`,
        },
      });
      created += 1;
    }
  }

  // run TERMINATION Draft (bila belum ada) — dihitung HR via UI runs (guard op:calculate)
  let runId: string | null = null;
  let runNo: string | null = null;
  const existingRun = await db.payrollRun.findFirst({
    where: { periodId: period.id, processTypeId: processType.id, status: { not: "Cancelled" } },
    select: { id: true, runNo: true, status: true },
  });
  if (!existingRun) {
    runNo = await nextRunNo(db, period.code, processType.code);
    const run = await db.payrollRun.create({
      data: {
        runNo, periodId: period.id, processTypeId: processType.id,
        calculateTax: true, allEmployee: true,
        notes: `Final settlement PHK — ${result.employee.fullName} (${result.employee.employeeNo})${input.paDocNo ? ` — PA ${input.paDocNo}` : ""}`,
      },
      select: { id: true, runNo: true },
    });
    runId = run.id;
    await db.activityLog.create({
      data: {
        action: "Created", entity: "PayrollRun", entityId: run.id,
        appUserId: input.actor?.appUserId ?? undefined,
        detail: `Run settlement PHK ${runNo} dibuat (${period.name} × ${processType.name}) — siap dihitung dari menu Proses & Hasil`,
      },
    });
  } else {
    runId = existingRun.id;
    runNo = existingRun.runNo;
  }

  // ActivityLog breakdown (audit + jejak lengkap per komponen)
  const breakdownText = result.rows
    .map((r) => `  · ${r.label}: ${fmtRp(r.amount)} — ${r.note}`)
    .join("\n");
  await db.activityLog.create({
    data: {
      action: "Created", entity: "EmployeeComponentAssignment", entityId: input.employeeId,
      employeeId: input.employeeId,
      appUserId: input.actor?.appUserId ?? undefined,
      personnelActionId: input.paId ?? undefined,
      detail:
        `Final settlement PHK ${result.employee.fullName} (${result.employee.employeeNo}) — PA ${input.paDocNo ?? "-"}, efektif ${result.effectiveDate}, masa kerja ${result.masaKerja.label}, upah ${fmtRp(result.upah.total)}\n` +
        `${breakdownText}\n` +
        `  Bruto ${fmtRp(result.gross)} − potongan ${fmtRp(result.deductions)} − PPh21 final ${fmtRp(result.tax)} = NET ${fmtRp(result.net)}\n` +
        `${created} komponen dibuat, ${updated} diperbarui → ${period.name} × ${processType.name}${runNo ? ` (run ${runNo})` : ""}`,
    },
  });

  return {
    result,
    period: { id: period.id, code: period.code, name: period.name },
    processType: { id: processType.id, code: processType.code, name: processType.name },
    assignmentsCreated: created,
    assignmentsUpdated: updated,
    runNo,
    runId,
  };
}
