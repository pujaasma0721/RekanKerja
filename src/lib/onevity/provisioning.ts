// OneVity tenant provisioning — membuat schema PostgreSQL baru per tenant:
// 1. CREATE SCHEMA tenant_<slug>
// 2. eksekusi DDL template (prisma/tenant-ddl.sql — di-generate `bun run tenant:ddl`)
// 3. seed data REFERENSI (komponen gaji, parameter pajak UU HPP/TER, akun, process type,
//    lookup, template, jenis benefit) — TANPA company/karyawan (tenant onboarding sendiri).
// Data perusahaan & karyawan kosong: tenant baru masuk alur onboarding.
import { Client } from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TenantDb } from "./tenant-db";

const DDL_PATH = path.join(process.cwd(), "prisma", "tenant-ddl.sql");

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

export function schemaNameForSlug(slug: string): string {
  return `tenant_${slug.replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").slice(0, 40)}`;
}

/** Pastikan slug unik terhadap registry platform (append -2, -3, …). */
export async function uniqueSlug(baseSlug: string, excludeTenantId?: string): Promise<string> {
  const { db } = await import("@/lib/db");
  let slug = baseSlug;
  let i = 2;
  for (;;) {
    const clash = await db.tenant.findFirst({ where: { slug, ...(excludeTenantId ? { id: { not: excludeTenantId } } : {}) }, select: { id: true } });
    if (!clash) return slug;
    slug = `${baseSlug}-${i++}`.slice(0, 44);
  }
}

/**
 * Buat schema tenant + seluruh tabel (idempotent). Gagal di tengah → schema di-drop.
 */
export async function provisionTenantSchema(schemaName: string): Promise<void> {
  const ddl = readFileSync(DDL_PATH, "utf8");
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    const existing = await c.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1", [schemaName]);
    const hasTables = existing.rowCount
      ? (await c.query('SELECT to_regclass($1) AS r', [`"${schemaName}"."Employee"`])).rows[0]?.r != null
      : false;

    if (!hasTables) {
      await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await c.query(`CREATE SCHEMA "${schemaName}"`);
      // satu sesi: SET search_path lalu seluruh DDL (simple query protocol)
      await c.query(`SET search_path TO "${schemaName}";\n${ddl}`);
    }
  } catch (e) {
    await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

// ============ SEED REFERENSI (tenant baru) ============
// Identik dengan master data orisinal MII — supaya modul Payroll langsung fungsional.

const LOOKUPS: [string, string[]][] = [
  ["Religion", ["Islam", "Kristen Protestan", "Katolik", "Hindu", "Buddha", "Konghucu"]],
  ["MaritalStatus", ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"]],
  ["EmploymentStatus", ["Permanent", "Contract", "Probation", "Outsourcing"]],
  ["BloodType", ["A", "B", "AB", "O"]],
  ["WarningLevel", ["Verbal", "Written", "Final"]],
  ["Violation", ["Keterlambatan", "Absen tanpa izin", "Pelanggaran SOP", "Pelanggaran etika", "Kinerja buruk"]],
  ["EducationLevel", ["SMA", "D3", "S1", "S2", "S3"]],
  ["Relation", ["Spouse", "Child", "Parent", "Sibling"]],
  ["WorkShift", ["Regular", "Shift 1", "Shift 2", "Shift 3"]],
  ["CalcMethod", ["Fixed", "Formula", "Percentage"]],
  ["AccountType", ["Asset", "Liability", "Equity", "Revenue", "Expense"]],
];

type CompDef = {
  code: string; name: string; type: string; wageType: string; calcMethod: string;
  amount?: number; formula?: string; incomeTaxMethod?: string;
  includeInTHP?: boolean; includeInBasicIncome?: boolean; applyThrRules?: boolean;
  jamsostekBasis?: string; sptReference?: string; accountDebitCode?: string;
};

const COMP_DEFS: CompDef[] = [
  { code: "BASIC", name: "Gaji Pokok", type: "Earning", wageType: "BasicSalary", calcMethod: "Formula", formula: "BASE_SALARY", includeInBasicIncome: true, sptReference: "Gaji" },
  { code: "TJAB", name: "Tunjangan Jabatan", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY*0.1", sptReference: "Tunjangan" },
  { code: "TKEL", name: "Tunjangan Keluarga", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY*0.05", sptReference: "Tunjangan" },
  { code: "TTRANS", name: "Tunjangan Transport", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 750000, sptReference: "Tunjangan" },
  { code: "TMAKAN", name: "Tunjangan Makan", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 550000, sptReference: "Tunjangan" },
  { code: "THR", name: "Tunjangan Hari Raya (THR)", type: "Earning", wageType: "Compensation", calcMethod: "Formula", formula: "BASE_SALARY", incomeTaxMethod: "Irregular", applyThrRules: true, sptReference: "BonusTHR" },
  { code: "BONUS", name: "Bonus Kinerja", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", sptReference: "BonusTHR" },
  { code: "LEMBUR", name: "Lembur (Overtime)", type: "Earning", wageType: "Overtime", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable" },
  { code: "JHT_C", name: "BPJS JHT Perusahaan 3,7%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JHT_BASE*JHT_RATE_CO", includeInTHP: false, jamsostekBasis: "JHT" },
  { code: "JPK_C", name: "BPJS JPK Perusahaan 4%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JPK_BASE*JPK_RATE_CO", includeInTHP: false, jamsostekBasis: "JPK" },
  { code: "JKK_C", name: "BPJS JKK Perusahaan", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JKK_BASE*JKK_RATE", includeInTHP: false, jamsostekBasis: "JKK" },
  { code: "JKM_C", name: "BPJS JKM Perusahaan 0,3%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JKM_BASE*JKM_RATE", includeInTHP: false, jamsostekBasis: "JKM" },
  { code: "JP_C", name: "BPJS JP Perusahaan 2%", type: "Earning", wageType: "Jamsostek", calcMethod: "Formula", formula: "JP_BASE*JP_RATE_CO", includeInTHP: false, jamsostekBasis: "JP" },
  { code: "JHT_E", name: "Potongan BPJS JHT 2%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JHT_BASE*JHT_RATE_EMP", jamsostekBasis: "JHT" },
  { code: "JP_E", name: "Potongan BPJS JP 1%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JP_BASE*JP_RATE_EMP", jamsostekBasis: "JP" },
  { code: "JPK_E", name: "Potongan BPJS JPK 1%", type: "Deduction", wageType: "Jamsostek", calcMethod: "Formula", formula: "JPK_BASE*JPK_RATE_EMP", jamsostekBasis: "JPK" },
  { code: "PPH21", name: "PPh21 (PPh Pasal 21)", type: "Deduction", wageType: "IncomeTax", calcMethod: "Tax", amount: 0, sptReference: "PPh21" },
  { code: "LOAN", name: "Angsuran Pinjaman", type: "Deduction", wageType: "Loan", calcMethod: "Tax", amount: 0, incomeTaxMethod: "NonTaxable" },
  { code: "WORKDAYS", name: "Hari Kerja Period", type: "Informational", wageType: "Information", calcMethod: "Formula", formula: "WORKING_DAYS", includeInTHP: false },
  { code: "RAPEL", name: "Back Pay (Rapel)", type: "Earning", wageType: "BackPay", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", sptReference: "Gaji" },
  { code: "TLATE", name: "Potongan Keterlambatan", type: "Deduction", wageType: "Deduction", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable", accountDebitCode: "2105" },
  { code: "TABS", name: "Potongan Absen (Alpha)", type: "Deduction", wageType: "Deduction", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable", accountDebitCode: "2105" },
  { code: "TKEHADIRAN", name: "Tunjangan Kehadiran", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0, accountDebitCode: "5102" },
  { code: "BEN_MED", name: "Benefit Medis (Reimburse)", type: "Earning", wageType: "CompensationNatura", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable", accountDebitCode: "5104" },
  { code: "BEN_GEN", name: "Benefit Karyawan", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Irregular", accountDebitCode: "5104" },
];

const TPL_DEFS: { code: string; name: string; description: string; components: string[] }[] = [
  { code: "DEFAULT", name: "Template Standar Karyawan", description: "Gaji pokok + tunjangan + BPJS penuh", components: ["BASIC", "TJAB", "TKEL", "TTRANS", "TMAKAN", "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C", "JHT_E", "JP_E", "JPK_E", "WORKDAYS"] },
  { code: "BS", name: "Basic Salary Only", description: "Gaji pokok + potongan BPJS (tanpa tunjangan)", components: ["BASIC", "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C", "JHT_E", "JP_E", "JPK_E", "WORKDAYS"] },
  { code: "FREELANCE", name: "Kontrak/Freelance", description: "Gaji pokok + tunjangan transport-makan (tanpa BPJS)", components: ["BASIC", "TTRANS", "TMAKAN", "WORKDAYS"] },
];

export async function seedTenantReference(db: TenantDb): Promise<void> {
  // lookup master
  for (const [category, labels] of LOOKUPS) {
    await db.lookup.createMany({
      data: labels.map((label, i) => ({ category, code: label.toUpperCase().replace(/[^A-Z0-9]/g, ""), label, sortOrder: i })),
    });
  }

  // komponen gaji
  const compIds: Record<string, string> = {};
  for (const c of COMP_DEFS) {
    const created = await db.wageComponent.create({
      data: {
        code: c.code, name: c.name, type: c.type, wageType: c.wageType,
        calcMethod: c.calcMethod, amount: c.amount ?? 0, formula: c.formula ?? null,
        incomeTaxMethod: c.incomeTaxMethod ?? "Regular",
        prorated: false,
        taxable: (c.incomeTaxMethod ?? "Regular") !== "NonTaxable",
        includeInTHP: c.includeInTHP ?? true,
        includeInBasicIncome: c.includeInBasicIncome ?? false,
        applyThrRules: c.applyThrRules ?? false,
        jamsostekBasis: c.jamsostekBasis ?? null,
        sptReference: c.sptReference ?? null,
        accountDebitCode: c.accountDebitCode ?? null,
      },
    });
    compIds[c.code] = created.id;
  }

  // akuntansi (COA payroll)
  const ag1 = await db.accountGroup.create({ data: { code: "AG-PAY", name: "Payroll Expense", accountType: "Expense" } });
  const ag2 = await db.accountGroup.create({ data: { code: "AG-LIA", name: "Payroll Liability", accountType: "Liability" } });
  const ag3 = await db.accountGroup.create({ data: { code: "AG-CASH", name: "Kas & Bank", accountType: "Asset" } });
  await db.account.createMany({
    data: [
      { code: "1101", name: "Kas & Bank", accountGroupId: ag3.id, balance: 0 },
      { code: "5101", name: "Gaji & Upah", accountGroupId: ag1.id, balance: 0 },
      { code: "5102", name: "Tunjangan Karyawan", accountGroupId: ag1.id, balance: 0 },
      { code: "5103", name: "BPJS Perusahaan", accountGroupId: ag1.id, balance: 0 },
      { code: "5104", name: "Beban Benefit Karyawan", accountGroupId: ag1.id, balance: 0 },
      { code: "2101", name: "Hutang Gaji", accountGroupId: ag2.id, balance: 0 },
      { code: "2102", name: "Hutang PPh 21", accountGroupId: ag2.id, balance: 0 },
      { code: "2103", name: "Hutang BPJS", accountGroupId: ag2.id, balance: 0 },
      { code: "2104", name: "Pinjaman Karyawan", accountGroupId: ag2.id, balance: 0 },
      { code: "2105", name: "Potongan Lain-lain", accountGroupId: ag2.id, balance: 0 },
    ],
  });
  await db.postingEvent.createMany({
    data: [
      { code: "PE-001", name: "Post Monthly Payroll", trigger: "PayrollRun" },
      { code: "PE-002", name: "Post THR Payment", trigger: "THRRun" },
      { code: "PE-003", name: "Post BPJS Payment", trigger: "BPJSPay" },
    ],
  });

  // process type payroll
  await db.processType.createMany({
    data: [
      { code: "SALARY", name: "Gaji Bulanan (Salary)", sequence: 1, calculateTax: true },
      { code: "THR", name: "THR (Tunjangan Hari Raya)", sequence: 2, calculateTax: true },
      { code: "BONUS", name: "Bonus Kinerja", sequence: 3, calculateTax: true },
      { code: "TERMINATION", name: "Pesangon & Final Settlement", sequence: 4, calculateTax: true },
      { code: "YEAR_END_ADJ", name: "Penyesuaian Akhir Tahun", sequence: 5, calculateTax: true },
      { code: "RAPEL", name: "Rapel / Back-Pay", sequence: 6, calculateTax: true },
      { code: "BENEFIT", name: "Benefit", sequence: 50, calculateTax: true },
    ],
  });

  // regulasi + bracket pajak UU HPP
  await db.payrollRegulation.create({
    data: {
      code: "REG-2026-HPP",
      name: "Regulasi UU HPP & BPJS 2026",
      validFrom: new Date(new Date().getFullYear(), 0, 1),
      biayaJabatanRate: 0.05,
      biayaJabatanCapMonthly: 500000,
      jhtEmployeeRate: 0.02, jhtCompanyRate: 0.037,
      jpEmployeeRate: 0.01, jpCompanyRate: 0.02, jpSalaryCap: 10547400,
      jkkRate: 0.0024, jkmRate: 0.003,
      jpkCompanyRate: 0.04, jpkEmployeeRate: 0.01, jpkSalaryCap: 12000000,
      nonNpwpSurcharge: 0.2,
      useTer: false,
    },
  });
  const bracketDefs: [number, number | null, number][] = [
    [0, 60_000_000, 0.05],
    [60_000_000, 250_000_000, 0.15],
    [250_000_000, 500_000_000, 0.25],
    [500_000_000, 5_000_000_000, 0.30],
    [5_000_000_000, null, 0.35],
  ];
  await db.taxBracket.createMany({
    data: bracketDefs.map(([lowerLimit, upperLimit, rate]) => ({
      bracketType: "Income", lowerLimit, upperLimit,
      rateNpwp: rate, rateNonNpwp: rate * 1.2,
      validFrom: new Date(2022, 0, 1),
    })),
  });

  // TER PP 58/2023 (kategori A/B/C)
  const terA: [number, number | null, number][] = [
    [0, 5_400_000, 0], [5_400_000, 5_650_000, 0.0025], [5_650_000, 6_350_000, 0.005],
    [6_350_000, 6_800_000, 0.0075], [6_800_000, 7_500_000, 0.01], [7_500_000, 8_050_000, 0.0125],
    [8_050_000, 8_700_000, 0.015], [8_700_000, 9_350_000, 0.0175], [9_350_000, 9_950_000, 0.02],
    [9_950_000, 10_600_000, 0.0225], [10_600_000, 11_300_000, 0.025], [11_300_000, 12_400_000, 0.03],
    [12_400_000, 13_600_000, 0.035], [13_600_000, 14_850_000, 0.04], [14_850_000, 16_100_000, 0.045],
    [16_100_000, 17_350_000, 0.05], [17_350_000, 18_600_000, 0.055], [18_600_000, 19_850_000, 0.06],
    [19_850_000, 21_100_000, 0.065], [21_100_000, 22_350_000, 0.07], [22_350_000, 23_600_000, 0.075],
    [23_600_000, 24_850_000, 0.08], [24_850_000, 26_100_000, 0.085], [26_100_000, 27_400_000, 0.09],
    [27_400_000, 28_700_000, 0.095], [28_700_000, 32_100_000, 0.10], [32_100_000, 36_500_000, 0.11],
    [36_500_000, 41_200_000, 0.12], [41_200_000, 46_200_000, 0.13], [46_200_000, 51_200_000, 0.14],
    [51_200_000, 56_200_000, 0.15], [56_200_000, 61_200_000, 0.16], [61_200_000, 66_200_000, 0.17],
    [66_200_000, 71_200_000, 0.18], [71_200_000, 76_200_000, 0.19], [76_200_000, null, 0.20],
  ];
  const terB: [number, number | null, number][] = [
    [0, 5_600_000, 0], [5_600_000, 5_850_000, 0.0025], [5_850_000, 6_350_000, 0.005],
    [6_350_000, 6_850_000, 0.0075], [6_850_000, 7_550_000, 0.01], [7_550_000, 8_150_000, 0.0125],
    [8_150_000, 8_900_000, 0.015], [8_900_000, 9_600_000, 0.0175], [9_600_000, 10_150_000, 0.02],
    [10_150_000, 10_850_000, 0.0225], [10_850_000, 11_550_000, 0.025], [11_550_000, 12_700_000, 0.03],
    [12_700_000, 13_900_000, 0.035], [13_900_000, 15_150_000, 0.04], [15_150_000, 16_400_000, 0.045],
    [16_400_000, 17_650_000, 0.05], [17_650_000, 18_900_000, 0.055], [18_900_000, 20_150_000, 0.06],
    [20_150_000, 21_400_000, 0.065], [21_400_000, 22_650_000, 0.07], [22_650_000, 23_900_000, 0.075],
    [23_900_000, 25_150_000, 0.08], [25_150_000, 26_400_000, 0.085], [26_400_000, 27_700_000, 0.09],
    [27_700_000, 29_000_000, 0.095], [29_000_000, 32_500_000, 0.10], [32_500_000, 37_000_000, 0.11],
    [37_000_000, 41_700_000, 0.12], [41_700_000, 46_700_000, 0.13], [46_700_000, 51_700_000, 0.14],
    [51_700_000, 56_700_000, 0.15], [56_700_000, 61_700_000, 0.16], [61_700_000, 66_700_000, 0.17],
    [66_700_000, 71_700_000, 0.18], [71_700_000, 76_700_000, 0.19], [76_700_000, null, 0.20],
  ];
  const terC: [number, number | null, number][] = [
    [0, 6_600_000, 0], [6_600_000, 6_950_000, 0.0025], [6_950_000, 7_700_000, 0.005],
    [7_700_000, 8_200_000, 0.0075], [8_200_000, 8_950_000, 0.01], [8_950_000, 9_450_000, 0.0125],
    [9_450_000, 10_200_000, 0.015], [10_200_000, 10_700_000, 0.0175], [10_700_000, 11_450_000, 0.02],
    [11_450_000, 12_200_000, 0.025], [12_200_000, 13_550_000, 0.03], [13_550_000, 14_900_000, 0.035],
    [14_900_000, 16_250_000, 0.04], [16_250_000, 17_600_000, 0.045], [17_600_000, 18_950_000, 0.05],
    [18_950_000, 20_300_000, 0.055], [20_300_000, 21_650_000, 0.06], [21_650_000, 23_000_000, 0.065],
    [23_000_000, 24_350_000, 0.07], [24_350_000, 25_700_000, 0.075], [25_700_000, 27_050_000, 0.08],
    [27_050_000, 28_400_000, 0.085], [28_400_000, 29_750_000, 0.09], [29_750_000, 31_100_000, 0.095],
    [31_100_000, 35_500_000, 0.10], [35_500_000, 39_900_000, 0.11], [39_900_000, 44_300_000, 0.12],
    [44_300_000, 48_700_000, 0.13], [48_700_000, 53_100_000, 0.14], [53_100_000, 57_500_000, 0.15],
    [57_500_000, 61_900_000, 0.16], [61_900_000, 66_300_000, 0.17], [66_300_000, 70_700_000, 0.18],
    [70_700_000, 75_100_000, 0.19], [75_100_000, null, 0.20],
  ];
  await db.terRate.createMany({
    data: [
      ...terA.map(([lowerLimit, upperLimit, rate]) => ({ category: "A", lowerLimit, upperLimit, rate })),
      ...terB.map(([lowerLimit, upperLimit, rate]) => ({ category: "B", lowerLimit, upperLimit, rate })),
      ...terC.map(([lowerLimit, upperLimit, rate]) => ({ category: "C", lowerLimit, upperLimit, rate })),
    ],
  });

  // template gaji
  for (const t of TPL_DEFS) {
    await db.wageTemplate.create({
      data: {
        code: t.code, name: t.name, description: t.description,
        items: { create: t.components.map((code, i) => ({ wageComponentId: compIds[code]!, sortOrder: i })) },
      },
    });
  }

  // jenis benefit default
  await db.benefitType.create({ data: {
    code: "MEDICAL", name: "Reimburse Medis & Kesehatan", category: "Medical",
    description: "Rawat jalan, obat, lab & medical check-up. Natura kesehatan (non-objek pajak).",
    resetPeriod: "Monthly", maxClaimAmount: 2_000_000, needDocuments: true,
    autoApproveInLimit: true, payInPayroll: true, wageComponentId: compIds["BEN_MED"],
  } });
  await db.benefitType.create({ data: {
    code: "GLASSES", name: "Ganti Kacamata", category: "Kesehatan",
    description: "Penggantian kacamata + pemeriksaan mata (1x per tahun).",
    resetPeriod: "Yearly", maxClaimAmount: 1_500_000, needDocuments: true,
    autoApproveInLimit: false, payInPayroll: true, wageComponentId: compIds["BEN_GEN"],
  } });
  await db.benefitType.create({ data: {
    code: "SPORT", name: "Fasilitas Olahraga & Gym", category: "Rekreasi",
    description: "Reimburse keanggotaan gym/olahraga bulanan.",
    resetPeriod: "Monthly", maxClaimAmount: 500_000, allowOverlimit: true,
    autoApproveInLimit: true, payInPayroll: true, wageComponentId: compIds["BEN_GEN"],
  } });
  await db.benefitType.create({ data: {
    code: "WEDDING", name: "Bantuan Pernikahan Karyawan", category: "Perayaan",
    description: "Bantuan pernikahan pertama karyawan — dibayar langsung dari kas.",
    resetPeriod: "None", maxClaimAmount: 2_500_000, needDocuments: true,
    autoApproveInLimit: false, payInPayroll: false,
  } });

  await ensureAttendanceReference(db);
}

// ============ TIME ATTENDANCE REFERENCE (ref: ANALISA-ATTENDANCE.md) ============

const DAY_TYPE_DEFS: {
  code: string; name: string; color: string; category: string;
  timeIn?: string; timeOut?: string; nextDay?: boolean; breakMinutes?: number;
  normalMinutes?: number; toleranceLateMinutes?: number; toleranceEarlyMinutes?: number;
  flexible?: boolean;
}[] = [
  { code: "OFFICE", name: "Jam Kantor 08:00-17:00", color: "#99CCFF", category: "Workday", timeIn: "08:00", timeOut: "17:00", breakMinutes: 60, normalMinutes: 480, toleranceLateMinutes: 10, toleranceEarlyMinutes: 10 },
  { code: "FLEX", name: "Jam Fleksibel (min. 7 jam)", color: "#E7E5E4", category: "Workday", timeIn: "07:00", timeOut: "16:00", normalMinutes: 420, flexible: true, toleranceLateMinutes: 60, toleranceEarlyMinutes: 60 },
  { code: "SHIFT1", name: "Shift Pagi 06:00-14:00", color: "#A7F3D0", category: "Workday", timeIn: "06:00", timeOut: "14:00", breakMinutes: 30, normalMinutes: 450, toleranceLateMinutes: 5, toleranceEarlyMinutes: 5 },
  { code: "SHIFT2", name: "Shift Siang 14:00-22:00", color: "#FDE68A", category: "Workday", timeIn: "14:00", timeOut: "22:00", breakMinutes: 30, normalMinutes: 450, toleranceLateMinutes: 5, toleranceEarlyMinutes: 5 },
  { code: "SHIFT3", name: "Shift Malam 22:00-06:00", color: "#C7D2FE", category: "Workday", timeIn: "22:00", timeOut: "06:00", nextDay: true, breakMinutes: 30, normalMinutes: 450, toleranceLateMinutes: 5, toleranceEarlyMinutes: 5 },
  { code: "OFF", name: "Day Off", color: "#FCA5A5", category: "Off" },
  { code: "OFFSAT", name: "Libur Sabtu", color: "#86EFAC", category: "Off" },
  { code: "OFFSPH", name: "Libur Minggu & Hari Raya", color: "#FCA5A5", category: "Off" },
];

const SCHEDULE_DEFS: { code: string; name: string; cycleDays: number; days: string[] }[] = [
  { code: "OFFICE-STD", name: "Jadwal Kantor (Senin-Jumat)", cycleDays: 7, days: ["OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFSAT", "OFFSPH"] },
  { code: "ROTASI-3R", name: "Rotasi 3 Regu (Pagi-Siang-Malam-Off-Off)", cycleDays: 5, days: ["SHIFT1", "SHIFT2", "SHIFT3", "OFF", "OFF"] },
  { code: "ROTASI-2R", name: "Rotasi 2 Regu (Pagi-Siang-Off bergantian)", cycleDays: 4, days: ["SHIFT1", "SHIFT2", "OFF", "OFF"] },
];

// Master attendance idempoten — dipakai provisioning tenant baru DAN
// upgrade tenant existing (day type/jadwal/aturan hanya dibuat bila belum ada).
export async function ensureAttendanceReference(db: TenantDb): Promise<void> {
  for (const d of DAY_TYPE_DEFS) {
    await db.workDayType.upsert({
      where: { code: d.code },
      create: {
        code: d.code, name: d.name, color: d.color, category: d.category,
        timeIn: d.timeIn ?? null, timeOut: d.timeOut ?? null,
        nextDay: d.nextDay ?? false, breakMinutes: d.breakMinutes ?? 0,
        normalMinutes: d.normalMinutes ?? 0,
        toleranceLateMinutes: d.toleranceLateMinutes ?? 0,
        toleranceEarlyMinutes: d.toleranceEarlyMinutes ?? 0,
        flexible: d.flexible ?? false, needOvertimeOrder: true,
      },
      update: {},
    });
  }

  for (const s of SCHEDULE_DEFS) {
    const existing = await db.workSchedule.findUnique({ where: { code: s.code } });
    if (!existing) {
      const dayTypes = await db.workDayType.findMany({ where: { code: { in: s.days } } });
      const byCode = new Map(dayTypes.map((d) => [d.code, d.id]));
      await db.workSchedule.create({
        data: {
          code: s.code, name: s.name, cycleDays: s.cycleDays,
          days: {
            create: s.days.map((code, i) => ({ sequence: i + 1, dayTypeId: byCode.get(code)! })),
          },
        },
      });
    }
  }

  const ruleCount = await db.attendanceRule.count();
  if (ruleCount === 0) {
    await db.attendanceRule.create({
      data: {
        roundingMinutes: 5, minOvertimeMinutes: 30, overtimeRoundingMinutes: 30,
        nonClockingPolicy: "AssumeNormal",
        overtimeComponentCode: "LEMBUR", lateDeductionComponentCode: "TLATE",
        absenceDeductionComponentCode: "TABS", attendanceAllowanceComponentCode: "TKEHADIRAN",
        attendanceAllowanceAmount: 0, lateDeductionPerHour: 0, absenceDeductionPerDay: 0,
      },
    });
  }

  // pastikan komponen gaji absensi tersedia (tenant lama belum punya TLATE/TABS/TKEHADIRAN)
  const attendanceCodes = ["LEMBUR", "TLATE", "TABS", "TKEHADIRAN"];
  const have = await db.wageComponent.findMany({ where: { code: { in: attendanceCodes } }, select: { code: true } });
  const haveSet = new Set(have.map((c) => c.code));
  const fallbacks: Record<string, CompDef> = {
    LEMBUR: { code: "LEMBUR", name: "Lembur (Overtime)", type: "Earning", wageType: "Overtime", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable" },
    TLATE: { code: "TLATE", name: "Potongan Keterlambatan", type: "Deduction", wageType: "Deduction", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable" },
    TABS: { code: "TABS", name: "Potongan Absen (Alpha)", type: "Deduction", wageType: "Deduction", calcMethod: "Fixed", amount: 0, incomeTaxMethod: "NonTaxable" },
    TKEHADIRAN: { code: "TKEHADIRAN", name: "Tunjangan Kehadiran", type: "Earning", wageType: "Compensation", calcMethod: "Fixed", amount: 0 },
  };
  for (const code of attendanceCodes) {
    if (!haveSet.has(code)) {
      const c = fallbacks[code];
      await db.wageComponent.create({
        data: {
          code: c.code, name: c.name, type: c.type, wageType: c.wageType,
          calcMethod: c.calcMethod, amount: 0, formula: c.formula ?? null,
          incomeTaxMethod: c.incomeTaxMethod ?? "Regular",
          taxable: (c.incomeTaxMethod ?? "Regular") !== "NonTaxable",
          includeInTHP: true,
        },
      });
    }
  }
}
