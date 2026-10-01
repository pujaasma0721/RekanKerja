// RekanKerja Payroll Engine — kalkulasi payroll per karyawan (murni TypeScript, tanpa IO).
// Acuan desain: ANALISA-PAYROLL.md (modul Payroll) + regulasi Indonesia:
// - PPh21 progresif UU HPP (bracket NPWP/non-NPWP, PTKP, biaya jabatan, annualized)
// - TER PP 58/2023 (opsional via regulation.useTer, kategori A/B/C)
// - BPJS: JHT 3,7%/2%, JP 2%/1% (cap), JKK, JKM, JPK 4%/1% (cap)
// - NetToGross: gross-up iteratif (tax allowance) — catat actualNetTax
// Formula evaluator: ekspresi dengan variabel (BASE_SALARY, JHT_BASE, rate regulasi,
// dan kode komponen lain yang sudah dihitung).
// Task 32: rule diferensiasi besaran komponen per parameter karyawan
// (organisasi/posisi/office/lokasi/status/agama/dst.) — evaluasi INI di engine
// supaya prorata & rounding tetap diterapkan SETELAH besaran rule ditentukan.

import {
  ComponentRuleLite,
  RuleContext,
  matchFirstRule,
  applyRuleAmount,
} from "@/rekankerja/payroll/services/component-rules";

// ============ TIPE INPUT/OUTPUT ============

export interface EngineRegulation {
  biayaJabatanRate: number;
  biayaJabatanCapMonthly: number;
  jhtEmployeeRate: number;
  jhtCompanyRate: number;
  jpEmployeeRate: number;
  jpCompanyRate: number;
  jpSalaryCap: number;
  jkkRate: number;
  jkmRate: number;
  jpkCompanyRate: number;
  jpkEmployeeRate: number;
  jpkSalaryCap: number;
  // Task 52-c — JKP (PP 6/2025).
  jkpEmployeeRate: number;
  jkpCompanyRate: number;
  jkpSalaryCap: number;
  nonNpwpSurcharge: number;
  useTer: boolean;
}

export interface EngineBracket {
  lowerLimit: number;
  upperLimit: number | null;
  rateNpwp: number;
  rateNonNpwp: number;
}

export interface EngineTer {
  category: string;
  lowerLimit: number;
  upperLimit: number | null;
  rate: number;
}

export interface EngineComponent {
  code: string;
  name: string;
  type: string; // Earning|Deduction|Informational (wageCategory)
  wageType: string; // BasicSalary|Compensation|...|IncomeTax|Loan|Jamsostek|Information
  calcMethod: string; // Fixed|Formula|Percentage|Tax
  amount: number;
  formula?: string | null;
  incomeTaxMethod: string; // NonTaxable|Regular|Irregular|FixedRateFinal|...
  prorated: boolean;
  // Task 64b — basis prorata: null/"Calendar" = hari kalender;
  // "WorkingDays" = hari kerja jadwal (WorkSchedule + libur; fallback Sen–Jum).
  prorateBasis?: string | null;
  includeInTHP: boolean;
  includeInBasicIncome: boolean;
  jamsostekBasis?: string | null; // JHT|JP|JKK|JKM|JPK
  roundingType: string; // RoundingUp|RoundingDown|Nearest
  roundingValue: number;
  // Task 32: aturan diferensiasi besaran per parameter karyawan — evaluasi
  // by engine (lihat component-rules.ts). Null/kosong = perilaku lama.
  rules?: ComponentRuleLite[];
}

export interface EngineEmployee {
  id: string;
  employeeNo: string;
  fullName: string;
  orgUnitName?: string | null;
  positionName?: string | null;
  baseSalary: number;
  employmentStatus: string;
  hasNpwp: boolean;
  taxStatus: string; // TK0..KI3
  dependents: number;
  processMethod: string; // GrossToNet|NetToGross
  // Task 32: konteks parameter utk evaluasi rule komponen (kode entitas,
  // atribut personal, angka tahun). Nilai dihitung payroll-service per
  // karyawan terhadap AKHIR period. Lihat component-rules.ts RULE_PARAMS.
  companyCode?: string | null;
  orgUnitCode?: string | null;
  positionCode?: string | null;
  gradeCode?: string | null;
  positionLevelCode?: string | null;
  officeCode?: string | null;
  workLocationCode?: string | null;
  workShift?: string | null;
  employeeStatus?: string | null;
  gender?: string | null;
  religion?: string | null;
  maritalStatus?: string | null;
  bloodType?: string | null;
  city?: string | null;
  ageYears?: number | null;
  tenureYears?: number | null;
}

export interface EngineLoanDue {
  loanId: string;
  letterNo: string;
  installmentId?: string;
  sequence: number;
  amount: number;
}

/**
 * Task 64 — segmen efektif karyawan dalam satu period payroll: satu versi
 * penempatan × versi template upah yang berlaku pada rentang hari tertentu.
 * Dibentuk payroll-service dari EmployeeAssignment + EmployeeWageTemplateHistory
 * yang menyentuh period; engine mengevaluasi komponen versi tiap segmen
 * (konteks rule & gaji segmennya sendiri), prorate bobot hari, lalu menggabung
 * per kode komponen. BPJS memakai rata-rata tertimbang (plafon per segmen),
 * PPh21 dihitung dari total bruto gabungan (TER bulanan).
 */
export interface EngineSegment {
  days: number; // hari kalender segmen dalam period (inklusif)
  baseSalary: number; // gaji pokok versi segmen (plaintext number)
  templateId?: string | null; // versi template segmen (dipakai service, engine abaikan)
  // Task 64b — hari kerja jadwal segmen (utk komponen prorate basis WorkingDays).
  workingDays?: number;
  orgUnitCode?: string | null;
  positionCode?: string | null;
  gradeCode?: string | null;
  officeCode?: string | null;
  workLocationCode?: string | null;
  employmentStatus?: string | null;
  components: { comp: EngineComponent; overrideAmount?: number }[];
}

/** Task 63 — entri log kejadian run payroll (parameter kurang / anomali / skip). */
export interface RunLogEntry {
  employeeId?: string | null;
  employeeNo?: string | null;
  employeeName?: string | null;
  level: "warning" | "error" | "info";
  code: string;
  message: string;
}

export interface EngineRow {
  employee: EngineEmployee;
  components: { comp: EngineComponent; overrideAmount?: number }[];
  loans: EngineLoanDue[];
  workingDays: number;
  prorateFactor: number; // 0..1 (1 = penuh)
  // K-1: konteks penghasilan regular kumulatif masa pajak (YTD) untuk run
  // suplemental (THR/BONUS/RAPEL — processType ≠ SALARY): Σ bruto THP & Σ iuran
  // pegawai Jamsostek + jumlah bulan dari run SALARY Confirmed/Paid tahun
  // pajak berjalan Jan s.d. period ini (dirakit payroll-service; fallback gaji
  // bulanan profil). Dipakai engine HANYA untuk pajak ireguler run suplemental.
  regularIncomeYtd?: number;
  regularIuranYtd?: number;
  regularMonthsYtd?: number;
  // F-04 BPA-AUDIT-53 — true-up MASA PAJAK TERAKHIR (PMK 168/2023):
  // run SALARY Desember ATAU period terakhir karyawan yang berhenti.
  // brutoYtd/iuranYtd/taxWithheldYtd = Σ dari run Confirmed/Paid periode
  // Jan s.d. SEBELUM period ini (dirakit payroll-service; run TERMINATION
  // & YEAR_END_ADJ dikecualikan — pesangon dipajaki final terpisah).
  lastTaxPeriod?: boolean;
  brutoYtd?: number;
  iuranYtd?: number;
  taxWithheldYtd?: number;
  // Task 64 — segmen efektif (multi-versi penempatan/template dalam period).
  // Bila terisi DAN hasOverride false, komponen dievaluasi per segmen
  // (row.components diabaikan); bila tidak, jalur tunggal lama dipakai
  // persis seperti sebelumnya (karyawan dgn komponen override one-off
  // selalu jalur tunggal — nilai Specific tidak boleh terpengaruh segmen).
  segments?: EngineSegment[];
  hasOverride?: boolean;
  // Task 64b — hari kerja jadwal (utk komponen prorate basis WorkingDays di
  // jalur tunggal): periodWorkingDays = hari kerja dalam masa kerja karyawan;
  // periodWorkingDaysFull = hari kerja period penuh (penyebut faktor).
  periodWorkingDays?: number;
  periodWorkingDaysFull?: number;
}

export interface EngineItem {
  code: string;
  name: string;
  wageType: string;
  type: string;
  incomeTaxMethod: string;
  amount: number;
  note?: string | null;
  sortOrder: number;
  // Klasifikasi iuran Jamsostek (JHT|JP|JKK|JKM|JPK) — dipakai engine untuk
  // menentukan status objek pajak BPJS (M-1). Tidak dipersist ke snapshot run.
  jamsostekBasis?: string | null;
}

export interface EngineLineResult {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  orgUnitName?: string | null;
  positionName?: string | null;
  ptkpStatus: string;
  ptkpValue: number; // tahunan
  items: EngineItem[];
  bruto: number; // penghasilan bruto (Income, masuk THP)
  deduction: number; // total potongan (Deduction masuk THP)
  taxRegular: number;
  taxIrregular: number;
  net: number; // THP
  actualNetTax?: number | null; // pajak efektif untuk N2G
  notes?: string | null;
  // D-4: peringatan mesin (bukan catatan slip) — mis. fallback TER →
  // dipersist oleh payroll-service sebagai ActivityLog agar ter-audit.
  warnings?: string[];
  // F-04 BPA-AUDIT-53: baris ini dihitung dengan true-up masa pajak terakhir.
  lastTaxPeriod?: boolean;
}

export interface EngineRunResult {
  lines: EngineLineResult[];
  totalBruto: number;
  totalDeduction: number;
  totalTax: number;
  totalNet: number;
}

// ============ PTKP & TER ============

// PTKP tahunan (PMK 101/2016, masih berlaku di UU HPP).
export const PTKP_ANNUAL: Record<string, number> = {
  TK0: 54_000_000, TK1: 58_500_000, TK2: 63_000_000, TK3: 67_500_000,
  K0: 58_500_000, K1: 63_000_000, K2: 67_500_000, K3: 72_000_000,
  KI0: 63_000_000, KI1: 67_500_000, KI2: 72_000_000, KI3: 76_500_000,
};

export function ptkpValueOf(taxStatus: string): number {
  return PTKP_ANNUAL[taxStatus] ?? PTKP_ANNUAL.TK0;
}

// Kategori TER (Lampiran PMK 168/2023 hlm. 9 — PTKP menentukan kategori):
//   TER A = TK/0 (54jt); TK/1 & K/0 (58,5jt)
//   TER B = TK/2 & K/1 (63jt); TK/3 & K/2 (67,5jt)   [+ K/I/0 (63jt), K/I/1 (67,5jt)]
//   TER C = K/3 (72jt)                                [+ K/I/2 (72jt), K/I/3 (76,5jt)]
// F-03 BPA-AUDIT-53: K1 salah di A (harus B), K3 salah di B (harus C).
export function terCategoryOf(taxStatus: string): "A" | "B" | "C" {
  if (["K3", "KI2", "KI3"].includes(taxStatus)) return "C";
  if (["TK2", "TK3", "K1", "K2", "KI0", "KI1"].includes(taxStatus)) return "B";
  return "A"; // TK0, TK1, K0
}

export const TAX_STATUS_LABEL: Record<string, string> = {
  TK0: "TK/0", TK1: "TK/1", TK2: "TK/2", TK3: "TK/3",
  K0: "K/0", K1: "K/1", K2: "K/2", K3: "K/3",
  KI0: "K/I/0", KI1: "K/I/1", KI2: "K/I/2", KI3: "K/I/3",
};

// ============ FORMULA EVALUATOR ============
// expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)*
// factor := NUMBER | IDENT | '(' expr ')' | '-' factor

export function evalFormula(expr: string, env: Record<string, number>): number {
  const src = expr.replace(/\s+/g, "");
  let pos = 0;

  const peek = () => src[pos];
  const match = (ch: string) => {
    if (src[pos] === ch) { pos++; return true; }
    return false;
  };

  const parseNumber = (): number => {
    const start = pos;
    while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
    if (start === pos) throw new Error(`Karakter tak dikenal di posisi ${pos}: '${peek()}'`);
    return parseFloat(src.slice(start, pos));
  };

  const parseIdent = (): string => {
    const start = pos;
    while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos])) pos++;
    return src.slice(start, pos).toUpperCase();
  };

  const parseFactor = (): number => {
    if (match("-")) return -parseFactor();
    if (match("(")) {
      const v = parseExpr();
      if (!match(")")) throw new Error("Kurung tutup hilang");
      return v;
    }
    if (pos < src.length && /[A-Za-z_]/.test(src[pos])) {
      const ident = parseIdent();
      if (!(ident in env)) throw new Error(`Variabel '${ident}' tidak dikenal`);
      return env[ident];
    }
    return parseNumber();
  };

  const parseTerm = (): number => {
    let v = parseFactor();
    while (pos < src.length && (src[pos] === "*" || src[pos] === "/")) {
      const op = src[pos]; pos++;
      const rhs = parseFactor();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  };

  function parseExpr(): number {
    let v = parseTerm();
    while (pos < src.length && (src[pos] === "+" || src[pos] === "-")) {
      const op = src[pos]; pos++;
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }

  const result = parseExpr();
  if (pos < src.length) throw new Error(`Sisa ekspresi tak terpakai di posisi ${pos}: '${src.slice(pos)}'`);
  if (!isFinite(result)) throw new Error("Hasil formula tidak berhingga (div/0?)");
  return result;
}

// ============ PAJAK PROGRESIF ============

export function progressiveTax(pkp: number, brackets: EngineBracket[], hasNpwp: boolean): number {
  let tax = 0;
  const sorted = [...brackets].sort((a, b) => a.lowerLimit - b.lowerLimit);
  for (const b of sorted) {
    if (pkp <= b.lowerLimit) break;
    const upper = b.upperLimit ?? Infinity;
    const taxable = Math.min(pkp, upper) - b.lowerLimit;
    if (taxable <= 0) break;
    const rate = hasNpwp ? b.rateNpwp : b.rateNonNpwp;
    tax += taxable * rate;
  }
  return tax;
}

const floorToThousand = (n: number) => Math.floor(n / 1000) * 1000;

function terRateFor(brutoMonthly: number, taxStatus: string, ter: EngineTer[]): number | null {
  const cat = terCategoryOf(taxStatus);
  const rows = ter.filter((t) => t.category === cat).sort((a, b) => a.lowerLimit - b.lowerLimit);
  for (const t of rows) {
    const upper = t.upperLimit ?? Infinity;
    if (brutoMonthly > t.lowerLimit && brutoMonthly <= upper) return t.rate;
  }
  return null;
}

// ============ ROUNDING ============

function roundAmount(n: number, comp: EngineComponent): number {
  const step = Math.max(1, comp.roundingValue || 1);
  switch (comp.roundingType) {
    case "RoundingUp": return Math.ceil(n / step) * step;
    case "RoundingDown": return Math.floor(n / step) * step;
    default: return Math.round(n / step) * step;
  }
}

// Task 32: konteks rule dari EngineEmployee (key sesuai RULE_PARAMS).
function ruleContextOf(emp: EngineEmployee): RuleContext {
  return {
    company: emp.companyCode ?? null,
    orgUnit: emp.orgUnitCode ?? null,
    position: emp.positionCode ?? null,
    grade: emp.gradeCode ?? null,
    positionLevel: emp.positionLevelCode ?? null,
    office: emp.officeCode ?? null,
    workLocation: emp.workLocationCode ?? null,
    employmentStatus: emp.employmentStatus,
    workShift: emp.workShift ?? null,
    tenureYears: emp.tenureYears ?? null,
    employeeStatus: emp.employeeStatus ?? null,
    gender: emp.gender ?? null,
    religion: emp.religion ?? null,
    maritalStatus: emp.maritalStatus ?? null,
    bloodType: emp.bloodType ?? null,
    city: emp.city ?? null,
    ageYears: emp.ageYears ?? null,
    taxStatus: emp.taxStatus,
    dependents: emp.dependents,
    hasNpwp: emp.hasNpwp,
  };
}

// ============ ENGINE UTAMA ============

interface TaxComputation {
  taxRegular: number;
  taxIrregular: number;
  biayaJabatan: number;
  terUsed: boolean;
  // D-4: tabel TER tidak punai rate utk bruto/status ini → pajak dihitung
  // dengan Pasal 17 progresif (bukan 0 senyap).
  terFallback: boolean;
}

export function runPayroll(
  rows: EngineRow[],
  reg: EngineRegulation,
  brackets: EngineBracket[],
  ter: EngineTer[],
  opts: { calculateTax: boolean }
): EngineRunResult {
  const lines: EngineLineResult[] = [];
  let totalBruto = 0, totalDeduction = 0, totalTax = 0, totalNet = 0;

  for (const row of rows) {
    const { employee: emp } = row;
    const ptkpValue = ptkpValueOf(emp.taxStatus);
    const items: EngineItem[] = [];
    const computedByCode: Record<string, number> = {};

    // --- 1. Basis BPJS dari regulasi (variabel formula) ---
    // Task 64 — segmen: basis BPJS = rata-rata tertimbang hari (plafon per
    // segmen, cap total diterapkan setelah rata-rata). Jalur tunggal (tanpa
    // segmen): persis nilai lama (emp.baseSalary).
    const segs = row.segments;
    const segDayTotal = segs?.reduce((s, x) => s + x.days, 0) ?? 0;
    // Task 64b — total hari kerja jadwal (basis prorata "WorkingDays") dan
    // faktor prorata hari-kerja jalur tunggal: hari kerja masa kerja karyawan /
    // hari kerja period penuh (0..1 — bulan penuh = 1). Tanpa data jadwal →
    // fallback faktor kalender (perilaku lama).
    const segWdTotal = segs?.reduce((s, x) => s + (x.workingDays ?? 0), 0) ?? 0;
    const periodWdFactor = row.periodWorkingDays != null && row.periodWorkingDaysFull
      ? Math.max(0, Math.min(1, row.periodWorkingDays / row.periodWorkingDaysFull))
      : row.prorateFactor;
    const wavg = (pick: (s: EngineSegment) => number): number =>
      segs && segDayTotal > 0 ? segs.reduce((s, x) => s + pick(x) * x.days, 0) / segDayTotal : emp.baseSalary;
    const jhtBase = wavg((s) => s.baseSalary);
    const jpBase = Math.min(wavg((s) => Math.min(s.baseSalary, reg.jpSalaryCap)), reg.jpSalaryCap);
    const jpkBase = Math.min(wavg((s) => Math.min(s.baseSalary, reg.jpkSalaryCap)), reg.jpkSalaryCap);
    const jkkBase = wavg((s) => s.baseSalary);
    const jkmBase = wavg((s) => s.baseSalary);
    // Task 52-c — basis JKP: upah dibatasi plafon (PP 6/2025: Rp 5jt default).
    const jkpBase = Math.min(wavg((s) => Math.min(s.baseSalary, reg.jkpSalaryCap)), reg.jkpSalaryCap);

    const baseEnv: Record<string, number> = {
      BASE_SALARY: emp.baseSalary,
      BPJS_BASE: emp.baseSalary,
      WORKING_DAYS: row.workingDays,
      PRORATE: row.prorateFactor,
      JHT_BASE: jhtBase, JP_BASE: jpBase, JPK_BASE: jpkBase, JKK_BASE: jkkBase, JKM_BASE: jkmBase,
      JHT_RATE_CO: reg.jhtCompanyRate, JHT_RATE_EMP: reg.jhtEmployeeRate,
      JP_RATE_CO: reg.jpCompanyRate, JP_RATE_EMP: reg.jpEmployeeRate,
      JKK_RATE: reg.jkkRate, JKM_RATE: reg.jkmRate,
      JPK_RATE_CO: reg.jpkCompanyRate, JPK_RATE_EMP: reg.jpkEmployeeRate,
      JKP_BASE: jkpBase, JKP_RATE_CO: reg.jkpCompanyRate, JKP_RATE_EMP: reg.jkpEmployeeRate,
      PTKP_VALUE: ptkpValue,
    };

    // --- 2. Komponen upah (Fixed/Formula/Percentage; Tax dihitung belakangan) ---
    // Task 32: presedensi besaran — assignment karyawan (overrideAmount) >
    // rule parameter > besaran dasar. Rule dievaluasi engine INI (bukan di
    // service) agar prorata & rounding tetap bekerja di atas hasil rule.
    const ruleCtx = ruleContextOf(emp);
    const workingSet = row.components.filter((c) => c.comp.wageType !== "IncomeTax");
    let sortOrder = 0;
    // Task 64 — evaluasi komponen per segmen efektif (kenaikan gaji/template/
    // pindah office di tengah period): setiap segmen dievaluasi dengan konteks
    // rule & gaji versinya sendiri, hasilnya DIJUMLAHKAN per kode komponen
    // (prorate = bobot hari segmen). Formula antar-komponen (TOTAL_*, dsb.)
    // antar segmen mengalir via computedByCode — nilai sementara, hasil akhir
    // tetap diambil dari segmen TERAKHIR (versi aktif). Khusus komponen
    // Specific/override (one-off, bukan formula) hanya dievaluasi SEKALI di
    // segmen pertama agar tidak dobel-hitung antar segmen.
    const merged = new Map<string, EngineItem>();
    // Task 64 — kode yang pernah diberi override (Specific/Periodic one-off)
    // DIKUNCI: segmen berikutnya tidak boleh menghitung ulang/menimpanya.
    const overriddenCodes = new Set<string>();
    // Task 64-fix — akumulasi komponen Fixed ter-prorate antar segmen:
    // setiap segmen menyumbang bagian harinya (office lama + office baru),
    // hasil akhir = jumlah seluruh segmen. Tanpa ini segmen pertama hilang
    // karena merged baru terisi di segmen terakhir.
    const fixedAcc = new Map<string, number>();
    if (segs && segs.length > 0 && segDayTotal > 0 && !row.hasOverride) {
      for (let si = 0; si < segs.length; si++) {
        const sg = segs[si];
        const isLast = si === segs.length - 1;
        const segFactor = sg.days / segDayTotal;
        const segCtx: RuleContext = {
          ...ruleCtx,
          orgUnit: sg.orgUnitCode ?? ruleCtx.orgUnit,
          position: sg.positionCode ?? ruleCtx.position,
          grade: sg.gradeCode ?? ruleCtx.grade,
          office: sg.officeCode ?? ruleCtx.office,
          workLocation: sg.workLocationCode ?? ruleCtx.workLocation,
          employmentStatus: sg.employmentStatus ?? ruleCtx.employmentStatus,
        };
        const segEnv: Record<string, number> = { ...baseEnv, BASE_SALARY: sg.baseSalary, BPJS_BASE: sg.baseSalary, PRORATE: segFactor };
        for (const { comp, overrideAmount } of sg.components) {
          if (comp.wageType === "IncomeTax" || comp.calcMethod === "Tax") continue;
          // Override dikunci di segmen tempat ia didefinisikan — segmen lain skip.
          if (overrideAmount != null) overriddenCodes.add(comp.code);
          else if (overriddenCodes.has(comp.code)) continue;
          // Task 64h — GAJI POKOK TIDAK DIPRORATA antar versi: baris slip
          // BasicSalary selalu = gaji versi berlaku pada AKHIR period (aturan
          // bisnis: perubahan gaji di tengah bulan berlaku penuh pada run
          // period-end, bukan dibagi hari). Segmen non-terakhir hanya menyuplai
          // nilai antara utk formula segmen berikutnya.
          if (comp.wageType === "BasicSalary") {
            if (!isLast) { computedByCode[comp.code] = sg.baseSalary; continue; }
          }
          let amount: number;
          let ruleNote: string | null = null;
          if (overrideAmount != null) {
            amount = overrideAmount;
          } else {
            const base = comp.calcMethod === "Fixed"
              ? comp.amount
              : evalFormula(comp.formula ?? "0", { ...segEnv, ...computedByCode });
            const matched = (comp.rules?.length ?? 0) > 0 ? matchFirstRule(comp.rules ?? [], segCtx) : null;
            if (matched) {
              amount = applyRuleAmount(matched.rule.actionType, matched.rule.value, base);
              ruleNote = `Aturan: ${matched.rule.name}`;
            } else {
              amount = base;
            }
          }
          if (comp.prorated && comp.wageType !== "BasicSalary") {
            // Task 64b — faktor per basis: "WorkingDays" memakai rasio hari kerja
            // jadwal segmen terhadap total hari kerja period; lainnya hari kalender.
            const f = comp.prorateBasis === "WorkingDays" && segWdTotal > 0 && sg.workingDays != null
              ? Math.max(0, Math.min(1, sg.workingDays / segWdTotal))
              : segFactor;
            if (f < 1) amount *= f;
          }
          amount = roundAmount(amount, comp);
          if (!isLast) {
            // Segmen non-terakhir: hanya dorong nilai antara utk formula
            // segmen berikutnya; komponen Specific (override) TIDAK ditumpuk
            // antar segmen (one-off); Fixed ter-prorate diakumulasi.
            if (overrideAmount == null) {
              computedByCode[comp.code] = amount;
              if (comp.calcMethod === "Fixed") {
                fixedAcc.set(comp.code, (fixedAcc.get(comp.code) ?? 0) + amount);
              }
            }
            continue;
          }
          // Segmen terakhir (versi aktif): Fixed ter-prorate = jumlah seluruh
          // segmen (office lama + baru); formula & override ambil nilai
          // segmen terakhir apa adanya; Fixed non-prorate nilai penuh aktif.
          let segNote: string | null = null;
          if (overrideAmount != null) {
            amount = roundAmount(overrideAmount, comp);
          } else if (comp.calcMethod === "Fixed" && comp.prorated && segFactor < 1) {
            const prior = fixedAcc.get(comp.code) ?? 0;
            amount = roundAmount(prior + amount, comp);
            segNote = comp.prorateBasis === "WorkingDays" && segWdTotal > 0
              ? `Prorata hari kerja per segmen (${segs!.map((s) => s.workingDays ?? s.days).join(" + ")} hari kerja)`
              : `Prorata per segmen (${segs!.map((s) => s.days).join(" + ")} hari)`;
          }
          const note = ruleNote
            ?? (comp.prorated && comp.wageType !== "BasicSalary" && segFactor < 1 ? `Prorata ${(segFactor * 100).toFixed(0)}%` : null)
            ?? (comp.wageType === "BasicSalary" && segs!.length > 1 ? "Gaji pokok = versi berlaku akhir period (tidak diprorata)" : null);
          const prev = merged.get(comp.code);
          if (prev) {
            prev.amount = amount;
            if (note) prev.note = prev.note ? `${prev.note}; ${note}` : note;
          } else {
            merged.set(comp.code, {
              code: comp.code, name: comp.name, wageType: comp.wageType, type: comp.type,
              incomeTaxMethod: comp.incomeTaxMethod, amount, sortOrder: sortOrder++,
              jamsostekBasis: comp.jamsostekBasis ?? null,
              note,
            });
          }
          computedByCode[comp.code] = amount;
        }
      }
    } else {
      for (const { comp, overrideAmount } of workingSet) {
        if (comp.calcMethod === "Tax") continue;
        let amount: number;
        let ruleNote: string | null = null;
        if (overrideAmount != null) {
          amount = overrideAmount;
        } else {
          const base = comp.calcMethod === "Fixed"
            ? comp.amount
            : evalFormula(comp.formula ?? "0", { ...baseEnv, ...computedByCode });
          const matched = (comp.rules?.length ?? 0) > 0 ? matchFirstRule(comp.rules ?? [], ruleCtx) : null;
          if (matched) {
            amount = applyRuleAmount(matched.rule.actionType, matched.rule.value, base);
            ruleNote = `Aturan: ${matched.rule.name}`;
          } else {
            amount = base;
          }
        }
        if (comp.prorated && comp.wageType !== "BasicSalary") {
          // Task 64b — basis "WorkingDays": faktor = hari kerja period / hari
          // kalender period; basis lain (null/Calendar) = faktor kalender lama.
          // Task 64h — BasicSalary dikecualikan: gaji pokok selalu penuh versi
          // akhir period (aturan bisnis), tidak ikut faktor prorata apa pun.
          const f = comp.prorateBasis === "WorkingDays" ? periodWdFactor : row.prorateFactor;
          if (f < 1) amount *= f;
        }
        amount = roundAmount(amount, comp);
        const item: EngineItem = {
          code: comp.code, name: comp.name, wageType: comp.wageType, type: comp.type,
          incomeTaxMethod: comp.incomeTaxMethod, amount, sortOrder: sortOrder++,
          jamsostekBasis: comp.jamsostekBasis ?? null,
          note: ruleNote
            ?? (comp.prorated && comp.wageType !== "BasicSalary" && row.prorateFactor < 1 ? `Prorata ${(row.prorateFactor * 100).toFixed(0)}%` : null),
        };
        items.push(item);
        computedByCode[comp.code] = amount;
      }
    }
    const items2 = [...merged.values()];
    for (const it of items2) {
      computedByCode[it.code] = it.amount;
      items.push(it);
    }

    // --- 3. Pinjaman (Loan) — potongan NonTaxable ---
    for (const loan of row.loans) {
      items.push({
        code: "LOAN", name: `Angsuran Pinjaman ${loan.letterNo}`, wageType: "Loan",
        type: "Deduction", incomeTaxMethod: "NonTaxable", amount: loan.amount,
        note: `Cicilan ke-${loan.sequence}`, sortOrder: sortOrder++,
      });
    }

    // --- 4. Kalkulasi pajak PPh21 ---
    // M-1 (PMK 16/PMK.03/2021 jo. PP 85/2021): iuran JKK/JKM/JPK yang dibayar
    // PERUSAHAAN bukan objek PPh21 → dikeluarkan dari penghasilan kena pajak
    // (dan basis TER) sekalipun master komponen lama masih menyimpan
    // incomeTaxMethod "Regular" — klasifikasi diperbaiki di engine berdasar
    // wageType Jamsostek + jamsostekBasis, data live tidak di-reseed.
    // Iuran JHT/JP perusahaan tetap objek pajak (iuran pensiun pemberi kerja).
    const NON_OBJEK_BPJS = new Set(["JKK", "JKM", "JPK", "JKP"]);
    const isNonObjekBpjs = (i: EngineItem) =>
      i.type === "Earning" && i.wageType === "Jamsostek" && NON_OBJEK_BPJS.has(i.jamsostekBasis ?? "");
    const regularIncome = items
      .filter((i) => i.type === "Earning" && i.incomeTaxMethod === "Regular" && !isNonObjekBpjs(i))
      .reduce((s, i) => s + i.amount, 0);
    const irregularIncome = items
      .filter((i) => i.type === "Earning" && i.incomeTaxMethod === "Irregular" && !isNonObjekBpjs(i))
      .reduce((s, i) => s + i.amount, 0);
    // M-1 (UU PPh Pasal 21 ayat (3) huruf a): pengurang penghasilan neto hanya
    // iuran pensiun yang dibayar sendiri oleh PEGAWAI (JHT + JP). Iuran JPK
    // pegawai bukan pengurang neto pajak (tetap dipotong dari THP).
    // Task 52-c — iuran JKP pegawai ikut pengurang penghasilan bruto (perlakuan
    // iuran jaminan sosial ketenagakerjaan seperti JP — PP 6/2025 jo. PMK PPh).
    const DEDUCTIBLE_IURAN = new Set(["JHT", "JP", "JKP"]);
    const taxDeductibleIuran = items
      .filter((i) => i.wageType === "Jamsostek" && i.type === "Deduction" && DEDUCTIBLE_IURAN.has(i.jamsostekBasis ?? ""))
      .reduce((s, i) => s + i.amount, 0);

    // D-2 (PP 58/2023 Pasal 15 ayat (4) & Penjelasan Pasal 15 huruf c):
    // tabel TER HANYA boleh dipakai pada bulan TANPA penghasilan ireguler.
    // Bulan yang membayar komponen incomeTaxMethod Irregular (THR/bonus/rapel
    // yang dibayar dalam run gaji bulanan) WAJIB memotong PPh21 penghasilan
    // regularnya dengan Pasal 17 progresif full (annualized) bulan itu juga.
    const irregularMonth = reg.useTer && emp.hasNpwp && irregularIncome > 0;
    const terWarnings: string[] = [];

    const computeTaxOn = (bruto: number): TaxComputation => {
      if (!opts.calculateTax) return { taxRegular: 0, taxIrregular: 0, biayaJabatan: 0, terUsed: false, terFallback: false };
      // Peringatan mencerminkan pemanggilan TERAKHIR (loop gross-up NetToGross
      // memanggil ini berulang — jangan menumpuk duplikat).
      terWarnings.length = 0;
      const biayaJabatan = Math.min(bruto * reg.biayaJabatanRate, reg.biayaJabatanCapMonthly);
      const netoMonthly = bruto - taxDeductibleIuran - biayaJabatan;
      const netoAnnual = netoMonthly * 12;
      const ptkp = ptkpValue;
      const pkpAnnual = Math.max(0, floorToThousand(netoAnnual - ptkp));
      const annualRegularTax = progressiveTax(pkpAnnual, brackets, emp.hasNpwp);

      let taxRegular: number;
      let terUsed = false;
      let terFallback = false;
      if (reg.useTer && emp.hasNpwp && !irregularMonth) {
        const rate = terRateFor(bruto, emp.taxStatus, ter);
        if (rate != null) {
          taxRegular = Math.max(0, bruto * rate);
          terUsed = true;
        } else {
          // D-4: rate TER tidak ditemukan utk (bruto, kategori status pajak)
          // ini — SEBELUMnya pajak diam-diam jadi 0 (pajak lenyap).
          // Fallback: Pasal 17 progresif + peringatan utk jejak audit.
          taxRegular = Math.max(0, annualRegularTax / 12);
          terFallback = true;
        }
      } else {
        // Non-TER, non-NPWP, ATAU bulan ireguler (D-2) → Pasal 17 progresif.
        taxRegular = Math.max(0, annualRegularTax / 12);
      }

      // Pajak irregular (THR/Bonus): progresif atas (neto tahunan + irregular) dikurangi pajak regular.
      let taxIrregular = 0;
      if (irregularIncome > 0) {
        const pkpWithIrr = Math.max(0, floorToThousand(netoAnnual + irregularIncome - ptkp));
        const annualWithIrr = progressiveTax(pkpWithIrr, brackets, emp.hasNpwp);
        taxIrregular = Math.max(0, annualWithIrr - annualRegularTax);
      }
      if (terFallback) {
        terWarnings.push(
          `TER tidak ditemukan untuk ${emp.employeeNo} ${emp.fullName} (bruto ${bruto}, kategori ${terCategoryOf(emp.taxStatus)}) — fallback kalkulasi progresif Pasal 17`
        );
      }
      return { taxRegular: Math.round(taxRegular), taxIrregular: Math.round(taxIrregular), biayaJabatan, terUsed, terFallback };
    };

    const grossBeforeTax = regularIncome; // bruto regular run ini sebelum gross-up

    // K-1: run suplemental (THR/BONUS/RAPEL — processType ≠ SALARY) tidak memuat
    // gaji regular (regularIncome = 0) → tanpa konteks, neto disetahunkan = 0 →
    // pajak ireguler = progresif(irregular − PTKP) ≈ 0 (under-withholding
    // sistemik). Konteks = rata-rata bruto & iuran run SALARY Confirmed/Paid
    // Jan s.d. period ini (fallback gaji bulanan profil saat ini).
    const ytdBruto = row.regularIncomeYtd ?? 0;
    const ytdIuran = row.regularIuranYtd ?? 0;
    const ytdMonths = Math.max(1, row.regularMonthsYtd ?? 0);
    const supplementalCtx = regularIncome <= 0 && ytdBruto > 0
      ? { bruto: ytdBruto / ytdMonths, iuran: ytdIuran / ytdMonths }
      : null;

    // K-1 (PMK 168/2023 — PPh21 atas penghasilan tidak teratur): Pasal 17
    // progresif atas (neto penghasilan regular disetahunkan + ireguler) dikurangi
    // pajak atas neto regular saja. Pajak REGULER sengaja 0 pada jalur ini —
    // sudah dipotong di run gaji bulanan; memotong ulang = double-withholding.
    const computeSupplementalTaxOn = (irregular: number): TaxComputation => {
      if (!opts.calculateTax) return { taxRegular: 0, taxIrregular: 0, biayaJabatan: 0, terUsed: false, terFallback: false };
      const bruto = supplementalCtx!.bruto;
      const iuran = Math.min(supplementalCtx!.iuran, bruto);
      const biayaJabatan = Math.min(bruto * reg.biayaJabatanRate, reg.biayaJabatanCapMonthly);
      const netoAnnual = (bruto - iuran - biayaJabatan) * 12;
      const pkpRegular = Math.max(0, floorToThousand(netoAnnual - ptkpValue));
      const annualRegularTax = progressiveTax(pkpRegular, brackets, emp.hasNpwp);
      const pkpWithIrr = Math.max(0, floorToThousand(netoAnnual + irregular - ptkpValue));
      const annualWithIrr = progressiveTax(pkpWithIrr, brackets, emp.hasNpwp);
      return {
        taxRegular: 0,
        taxIrregular: Math.round(Math.max(0, annualWithIrr - annualRegularTax)),
        biayaJabatan, terUsed: false, terFallback: false,
      };
    };

    let taxInfo: TaxComputation;
    let actualNetTax: number | null = null;
    let taxAllowance = 0;

    // --- 5t. F-04 BPA-AUDIT-53 — MASA PAJAK TERAKHIR (PMK 168/2023) -------
    // Run SALARY Desember ATAU period terakhir karyawan berhenti (leaver):
    // PPh21 masa ini = PPh21 SETAHUN (Pasal 17 atas bruto setahun aktual −
    // biaya jabatan 5% capped 6jt/TAHUN − iuran pensiun pegawai setahun −
    // PTKP) DIKURANGI PPh21 yang telah dipotong masa pajak sebelumnya
    // (YTD Jan–Nov + run suplemental, dirakit payroll-service). Seluruh
    // penghasilan ireguler bulan ini ikut basis setahun (tidak dihitung
    // progresif terpisah — PMK 168: Desember selalu Pasal 17 penuh).
    // Catatan: zakat/sumbangan wajib resmi ikut pengurang neto — belum
    // dimodelkan RekanKerja (komponen zakat dapat ditambahkan di masa depan).
    const isLastTaxPeriod = row.lastTaxPeriod === true && opts.calculateTax;
    const computeTrueUpOn = (bruto: number): TaxComputation => {
      const annualBruto = (row.brutoYtd ?? 0) + bruto + irregularIncome;
      const annualIuran = (row.iuranYtd ?? 0) + taxDeductibleIuran;
      const biayaJabatanAnnual = Math.min(
        annualBruto * reg.biayaJabatanRate,
        reg.biayaJabatanCapMonthly * 12,
      );
      const pkpAnnual = Math.max(0, floorToThousand(annualBruto - annualIuran - biayaJabatanAnnual - ptkpValue));
      const taxAnnual = progressiveTax(pkpAnnual, brackets, emp.hasNpwp);
      return {
        taxRegular: Math.max(0, Math.round(taxAnnual - (row.taxWithheldYtd ?? 0))),
        taxIrregular: 0,
        biayaJabatan: biayaJabatanAnnual,
        terUsed: false,
        terFallback: false,
      };
    };

    if (isLastTaxPeriod) {
      taxInfo = computeTrueUpOn(grossBeforeTax);
      if (emp.processMethod === "NetToGross") {
        // Gross-up iteratif: tunjangan pajak menambah bruto setahun → pajak
        // tahunan naik → iterasi hingga konvergen (≤ 0,5 rupiah).
        let extra = 0;
        for (let i = 0; i < 30; i++) {
          const t = computeTrueUpOn(grossBeforeTax + extra);
          const nextExtra = t.taxRegular;
          if (Math.abs(nextExtra - extra) < 0.5) { extra = nextExtra; taxInfo = t; break; }
          extra = nextExtra;
          taxInfo = computeTrueUpOn(grossBeforeTax + extra);
        }
        taxAllowance = Math.round(extra);
        if (taxAllowance > 0) {
          items.push({
            code: "TAX_ALLOW", name: "Tunjangan PPh21 Ditanggung Perusahaan", wageType: "Compensation",
            type: "Earning", incomeTaxMethod: "Regular", amount: taxAllowance,
            note: "Gross-up pajak masa pajak terakhir (NetToGross)", sortOrder: sortOrder++,
          });
        }
        actualNetTax = taxInfo.taxRegular;
      }
    } else if (supplementalCtx && irregularIncome > 0) {
      // --- 5a. K-1: run suplemental dengan konteks kumulatif masa pajak ---
      taxInfo = computeSupplementalTaxOn(irregularIncome);
      if (emp.processMethod === "NetToGross" && opts.calculateTax) {
        // Gross-up iteratif atas pajak ireguler saja (THR/bonus netto).
        let extra = 0;
        for (let i = 0; i < 30; i++) {
          const t = computeSupplementalTaxOn(irregularIncome + extra);
          const nextExtra = t.taxIrregular;
          if (Math.abs(nextExtra - extra) < 0.5) { extra = nextExtra; taxInfo = t; break; }
          extra = nextExtra;
          taxInfo = computeSupplementalTaxOn(irregularIncome + extra);
        }
        taxAllowance = Math.round(extra);
        if (taxAllowance > 0) {
          items.push({
            code: "TAX_ALLOW", name: "Tunjangan PPh21 Ditanggung Perusahaan", wageType: "Compensation",
            type: "Earning", incomeTaxMethod: "Irregular", amount: taxAllowance,
            note: "Gross-up pajak ireguler (NetToGross)", sortOrder: sortOrder++,
          });
        }
        actualNetTax = taxInfo.taxIrregular;
      }
    } else {
      taxInfo = computeTaxOn(grossBeforeTax);

      // --- 5. NetToGross: gross-up iteratif (pajak ditanggung perusahaan) ---
      if (emp.processMethod === "NetToGross" && opts.calculateTax) {
        let extra = 0;
        for (let i = 0; i < 30; i++) {
          const t = computeTaxOn(grossBeforeTax + extra);
          const nextExtra = t.taxRegular + t.taxIrregular;
          if (Math.abs(nextExtra - extra) < 0.5) { extra = nextExtra; taxInfo = t; break; }
          extra = nextExtra;
          taxInfo = computeTaxOn(grossBeforeTax + extra);
        }
        taxAllowance = Math.round(extra);
        if (taxAllowance > 0) {
          items.push({
            code: "TAX_ALLOW", name: "Tunjangan PPh21 Ditanggung Perusahaan", wageType: "Compensation",
            type: "Earning", incomeTaxMethod: "Regular", amount: taxAllowance,
            note: "Gross-up pajak (NetToGross)", sortOrder: sortOrder++,
          });
        }
        actualNetTax = taxInfo.taxRegular + taxInfo.taxIrregular;
      }
    }

    const empTaxTotal = taxInfo.taxRegular + taxInfo.taxIrregular;

    // --- 6. Item PPh21 ---
    if (opts.calculateTax && empTaxTotal > 0) {
      items.push({
        code: "PPH21", name: "PPh21 (PPh Pasal 21)", wageType: "IncomeTax",
        type: "Deduction", incomeTaxMethod: "NonTaxable", amount: empTaxTotal,
        note: isLastTaxPeriod
          ? "Masa pajak terakhir — Pasal 17 atas penghasilan setahun dikurangi PPh21 yang telah dipotong (PMK 168/2023)"
          : taxInfo.terUsed
          ? "Metode TER (PMK 168/2023)"
          : taxInfo.terFallback
            ? "Progresif Pasal 17 (fallback — TER tidak ditemukan)"
            : irregularMonth
              ? "Progresif Pasal 17 (bulan ireguler — PMK 168/2023)"
              : "Progresif annualized",
        sortOrder: sortOrder++,
      });
    }

    // --- 7. Total ---
    // Komponen non-THP (mis. iuran JSTK ditanggung perusahaan) dikeluarkan dari bruto slip.
    const nonThpCodes = new Set(
      row.components.filter((c) => !c.comp.includeInTHP).map((c) => c.comp.code)
    );
    const brutoTHP = items
      .filter((i) => i.type === "Earning" && !nonThpCodes.has(i.code))
      .reduce((s, i) => s + i.amount, 0);
    const deduction = items.filter((i) => i.type === "Deduction").reduce((s, i) => s + i.amount, 0);
    const net = Math.round(brutoTHP - deduction);

    const line: EngineLineResult = {
      employeeId: emp.id,
      employeeNo: emp.employeeNo,
      employeeName: emp.fullName,
      orgUnitName: emp.orgUnitName,
      positionName: emp.positionName,
      ptkpStatus: emp.taxStatus,
      ptkpValue,
      items,
      bruto: Math.round(brutoTHP),
      deduction: Math.round(deduction),
      taxRegular: taxInfo.taxRegular,
      taxIrregular: taxInfo.taxIrregular,
      net,
      actualNetTax,
      notes: row.prorateFactor < 1 ? `Prorata masa kerja ${(row.prorateFactor * 100).toFixed(0)}%` : null,
      ...(terWarnings.length ? { warnings: terWarnings } : {}),
      ...(isLastTaxPeriod ? { lastTaxPeriod: true } : {}),
    };
    lines.push(line);
    totalBruto += line.bruto;
    totalDeduction += line.deduction;
    totalTax += line.taxRegular + line.taxIrregular;
    totalNet += line.net;
  }

  return {
    lines,
    totalBruto: Math.round(totalBruto),
    totalDeduction: Math.round(totalDeduction),
    totalTax: Math.round(totalTax),
    totalNet: Math.round(totalNet),
  };
}

// Jumlah hari kerja (Senin–Jumat) dalam rentang period.
export function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
