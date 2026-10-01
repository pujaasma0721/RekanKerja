// RekanKerja Payroll Engine — kalkulasi payroll per karyawan (murni TypeScript, tanpa IO).
// Acuan desain: ANALISA-PAYROLL.md (modul Payroll oranHR) + regulasi Indonesia:
// - PPh21 progresif UU HPP (bracket NPWP/non-NPWP, PTKP, biaya jabatan, annualized)
// - TER PP 58/2023 (opsional via regulation.useTer, kategori A/B/C)
// - BPJS: JHT 3,7%/2%, JP 2%/1% (cap), JKK, JKM, JPK 4%/1% (cap)
// - NetToGross: gross-up iteratif (tax allowance) — catat actualNetTax
// Formula evaluator: ekspresi dengan variabel (BASE_SALARY, JHT_BASE, rate regulasi,
// dan kode komponen lain yang sudah dihitung).

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
  includeInTHP: boolean;
  includeInBasicIncome: boolean;
  jamsostekBasis?: string | null; // JHT|JP|JKK|JKM|JPK
  roundingType: string; // RoundingUp|RoundingDown|Nearest
  roundingValue: number;
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
}

export interface EngineLoanDue {
  loanId: string;
  letterNo: string;
  installmentId?: string;
  sequence: number;
  amount: number;
}

export interface EngineRow {
  employee: EngineEmployee;
  components: { comp: EngineComponent; overrideAmount?: number }[];
  loans: EngineLoanDue[];
  workingDays: number;
  prorateFactor: number; // 0..1 (1 = penuh)
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

// Kategori TER (PP 58/2023): A = TK0-1/K0-1, B = TK2-3/K2-3/KI0-1, C = KI2-3.
export function terCategoryOf(taxStatus: string): "A" | "B" | "C" {
  if (["KI2", "KI3"].includes(taxStatus)) return "C";
  if (["TK2", "TK3", "K2", "K3", "KI0", "KI1"].includes(taxStatus)) return "B";
  return "A";
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

// ============ ENGINE UTAMA ============

interface TaxComputation {
  taxRegular: number;
  taxIrregular: number;
  biayaJabatan: number;
  terUsed: boolean;
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
    const jhtBase = emp.baseSalary;
    const jpBase = Math.min(emp.baseSalary, reg.jpSalaryCap);
    const jpkBase = Math.min(emp.baseSalary, reg.jpkSalaryCap);
    const jkkBase = emp.baseSalary;
    const jkmBase = emp.baseSalary;

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
      PTKP_VALUE: ptkpValue,
    };

    // --- 2. Komponen upah (Fixed/Formula/Percentage; Tax dihitung belakangan) ---
    const workingSet = row.components.filter((c) => c.comp.wageType !== "IncomeTax");
    let sortOrder = 0;
    for (const { comp, overrideAmount } of workingSet) {
      if (comp.calcMethod === "Tax") continue;
      let amount: number;
      if (overrideAmount != null) {
        amount = overrideAmount;
      } else if (comp.calcMethod === "Fixed") {
        amount = comp.amount;
      } else {
        const env = { ...baseEnv, ...computedByCode };
        amount = evalFormula(comp.formula ?? "0", env);
      }
      if (comp.prorated && row.prorateFactor < 1) {
        amount *= row.prorateFactor;
      }
      amount = roundAmount(amount, comp);
      const item: EngineItem = {
        code: comp.code, name: comp.name, wageType: comp.wageType, type: comp.type,
        incomeTaxMethod: comp.incomeTaxMethod, amount, sortOrder: sortOrder++,
        note: comp.prorated && row.prorateFactor < 1 ? `Prorata ${(row.prorateFactor * 100).toFixed(0)}%` : null,
      };
      items.push(item);
      computedByCode[comp.code] = amount;
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
    const regularIncome = items.filter((i) => i.type === "Earning" && i.incomeTaxMethod === "Regular").reduce((s, i) => s + i.amount, 0);
    const irregularIncome = items.filter((i) => i.type === "Earning" && i.incomeTaxMethod === "Irregular").reduce((s, i) => s + i.amount, 0);
    // Iuran JSTK yang dibayar pegawai (JHT/JP) — deductible dari bruto utk pajak.
    const taxDeductibleIuran = items
      .filter((i) => i.wageType === "Jamsostek" && i.type === "Deduction")
      .reduce((s, i) => s + i.amount, 0); // seeded: JHT_EMP + JP_EMP saja (JPK non-deductible per komponen)

    const computeTaxOn = (bruto: number): TaxComputation => {
      if (!opts.calculateTax) return { taxRegular: 0, taxIrregular: 0, biayaJabatan: 0, terUsed: false };
      const biayaJabatan = Math.min(bruto * reg.biayaJabatanRate, reg.biayaJabatanCapMonthly);
      const netoMonthly = bruto - taxDeductibleIuran - biayaJabatan;
      const netoAnnual = netoMonthly * 12;
      const ptkp = ptkpValue;
      const pkpAnnual = Math.max(0, floorToThousand(netoAnnual - ptkp));
      const annualRegularTax = progressiveTax(pkpAnnual, brackets, emp.hasNpwp);

      let taxRegular: number;
      let terUsed = false;
      if (reg.useTer && emp.hasNpwp) {
        const rate = terRateFor(bruto, emp.taxStatus, ter);
        if (rate != null) {
          taxRegular = Math.max(0, bruto * rate);
          terUsed = true;
        } else {
          taxRegular = 0;
        }
      } else {
        taxRegular = Math.max(0, annualRegularTax / 12);
      }

      // Pajak irregular (THR/Bonus): progresif atas (neto tahunan + irregular) dikurangi pajak regular.
      let taxIrregular = 0;
      if (irregularIncome > 0) {
        const pkpWithIrr = Math.max(0, floorToThousand(netoAnnual + irregularIncome - ptkp));
        const annualWithIrr = progressiveTax(pkpWithIrr, brackets, emp.hasNpwp);
        taxIrregular = Math.max(0, annualWithIrr - annualRegularTax);
      }
      return { taxRegular: Math.round(taxRegular), taxIrregular: Math.round(taxIrregular), biayaJabatan, terUsed };
    };

    const grossBeforeTax = regularIncome; // bruto regular sebelum gross-up
    let taxInfo = computeTaxOn(grossBeforeTax);
    let actualNetTax: number | null = null;
    let taxAllowance = 0;

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

    const empTaxTotal = taxInfo.taxRegular + taxInfo.taxIrregular;

    // --- 6. Item PPh21 ---
    if (opts.calculateTax && empTaxTotal > 0) {
      items.push({
        code: "PPH21", name: "PPh21 (PPh Pasal 21)", wageType: "IncomeTax",
        type: "Deduction", incomeTaxMethod: "NonTaxable", amount: empTaxTotal,
        note: taxInfo.terUsed ? "Metode TER (PP 58/2023)" : "Progresif annualized",
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
