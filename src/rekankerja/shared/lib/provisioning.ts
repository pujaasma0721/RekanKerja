// RekanKerja tenant provisioning — membuat schema PostgreSQL baru per tenant:
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
 * Gagal-bersih: HAPUS schema tenant (beserta seluruh isinya) dari DB.
 * Dipakai bila provisioning/registrasi gagal SETELAH schema dibuat — schema
 * setengah jadi TIDAK BOLEH tertinggal (registrasi ulang dengan slug sama
 * akan menabrak seed duplikat unik, mis. Lookup(category,code)).
 * Aman dipanggil untuk schema yang tidak ada (IF EXISTS). Never-throw.
 */
export async function dropTenantSchema(schemaName: string): Promise<void> {
  // Validasi ketat: hanya identifier schema buatan sendiri (hasil
  // schemaNameForSlug) yang boleh masuk query — anti SQL injection.
  if (!/^tenant_[a-z0-9_]+$/.test(schemaName)) return;
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  try {
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
  } catch {
    // never-throw — pembersih terbaik; kegagalan drop tidak menimpa error asli
  } finally {
    await c.end().catch(() => {});
  }
}

/**
 * Tabel inti yang WAJIB ada di setiap schema tenant setelah provisioning.
 * Dipakai verifikasi pasca-DDL (provisionTenantSchema) & deteksi gap parity
 * (checkParityGap). Tabel hilang = schema setengah jadi → provisioning gagal-
 * bersih (drop), tenant existing di-heal parity runner.
 */
export const CRITICAL_TENANT_TABLES = [
  "Employee", "PayrollRun", "PasswordPolicy", "WorkSchedule",
] as const;

/**
 * Daftar tabel kritis yang HILANG pada satu schema tenant (pg Client).
 * Return [] bila semua utuh. Never-throw (error koneksi → anggap bermasalah?
 * tidak — caller memutuskan; di sini null = tidak bisa memeriksa).
 */
export async function missingCriticalTables(c: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ missing: string }> }> }, schemaName: string): Promise<string[] | null> {
  try {
    const placeholders = CRITICAL_TENANT_TABLES.map((_, i) => `$${i + 2}`).join(",");
    const r = await c.query(
      `SELECT t.name AS missing FROM unnest(ARRAY[${placeholders}]::text[]) AS t(name)
       WHERE to_regclass($1 || '.' || '"' || t.name || '"') IS NULL`,
      [`"${schemaName}"`, ...CRITICAL_TENANT_TABLES],
    );
    return r.rows.map((x) => x.missing);
  } catch {
    return null; // tidak bisa memeriksa (koneksi/izin) — caller memutuskan
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
      // Fix audit 40 M-10 — partial unique index dedupe Reminder (tidak
      // ter-express di Prisma schema → tidak ikut tenant-ddl.sql). Tenant BARU
      // harus punya index yang sama dengan tenant existing (migrate-scheduler-race.ts)
      // supaya INSERT ... ON CONFLICT DO NOTHING scheduler bekerja lintas proses.
      await c.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "ActivityLog_dedu_reminder"
        ON "ActivityLog"("action","entity","entityId")
        WHERE "entityId" IS NOT NULL AND "action" = 'Reminder'`);
      // Fix audit 42 M-20 — partial unique index run payroll AKTIF per (period ×
      // jenis proses): dua run aktif (status <> 'Cancelled') period+jenis sama
      // mustahil di level DB (anti gaji dobel). Partial index tak ter-express di
      // Prisma schema → tidak ikut tenant-ddl.sql; tenant existing menerima DDL
      // yang sama via scripts/migrate-task43-indexes.ts.
      await c.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "uniq_payrollrun_active"
        ON "PayrollRun"("processTypeId","periodId")
        WHERE "status" <> 'Cancelled'`);

      // ---- Proteksi konsistensi (Task 64l) — verifikasi tabel kritis ----
      // tenant_demouser0229 dulu lolos provisioning TANPA PasswordPolicy (DDL
      // lama pra-Task 33) → tenant bocor: getTenantPolicy fallback diam-diam,      // parity gap permanen. Sekarang: tabel kritis hilang = provisioning
      // GAGAL-BERSIH (schema di-drop → registrasi gagal jelas, bukan tenant
      // cacat yang tersisa). Pemeriksaan SETELAH seluruh DDL.
      const missing = await missingCriticalTables(c, schemaName);
      if (missing === null) {
        throw new Error("Verifikasi tabel kritis gagal dijalankan (koneksi DB)");
      }
      if (missing.length > 0) {
        throw new Error(
          `Provisioning schema ${schemaName} menghasilkan tabel kritis hilang: ${missing.join(", ")} ` +
          `(tenant-ddl.sql tidak sinkron dengan kode — periksa prisma/tenant-ddl.sql)`,
        );
      }
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
  // F-01 BPA-AUDIT-53 — JKP PP 6/2025: iuran 0,36% = 0,22% APBN + 0,14%
  // REKOMPOSISI iuran JKK yang sudah dibayar perusahaan. TIDAK ADA potongan
  // pekerja (porsi 0,10% PP 37/2021 lama dihapus) dan TIDAK ADA beban iuran
  // baru perusahaan → komponen JKP_C/JKP_E TIDAK dibuat/dipasang di template;
  // baris informatif rekomposisi ada di laporan BPJS (reports-bpjs.ts).
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
  // F-01 BPA-AUDIT-53 — JKP_C/JKP_E dihapus dari template: iuran JKP 0,36%
  // (0,22% APBN + 0,14% rekomposisi JKK — PP 6/2025 Ps.11) tidak memotong
  // pekerja dan tidak menambah beban iuran perusahaan.
  { code: "DEFAULT", name: "Template Standar Karyawan", description: "Gaji pokok + tunjangan + BPJS penuh (JHT/JP/JKK/JKM/JPK; JKP via rekomposisi JKK — PP 6/2025)", components: ["BASIC", "TJAB", "TKEL", "TTRANS", "TMAKAN", "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C", "JHT_E", "JP_E", "JPK_E", "WORKDAYS"] },
  { code: "BS", name: "Basic Salary Only", description: "Gaji pokok + potongan BPJS (tanpa tunjangan; JKP via rekomposisi JKK — PP 6/2025)", components: ["BASIC", "JHT_C", "JPK_C", "JKK_C", "JKM_C", "JP_C", "JHT_E", "JP_E", "JPK_E", "WORKDAYS"] },
  { code: "FREELANCE", name: "Kontrak/Freelance", description: "Gaji pokok + tunjangan transport-makan (tanpa BPJS — non-pekerja tetap, di luar program JKP)", components: ["BASIC", "TTRANS", "TMAKAN", "WORKDAYS"] },
];

import { LETTER_TEMPLATE_DEFAULTS } from "@/rekankerja/shared/lib/letter-defaults";
// F-02 BPA-AUDIT-53 — tabel TER resmi Lampiran PMK 168/2023 (sumber tunggal).
import { TER_OFFICIAL } from "@/rekankerja/payroll/services/ter-official";

export async function seedTenantReference(db: TenantDb): Promise<void> {
  // lookup master
  for (const [category, labels] of LOOKUPS) {
    await db.lookup.createMany({
      data: labels.map((label, i) => ({ category, code: label.toUpperCase().replace(/[^A-Z0-9]/g, ""), label, sortOrder: i })),
    });
  }

  // template surat default (Task Admin-6) — idempoten per key
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    const before = await db.letterTemplate.findUnique({ where: { key: t.key }, select: { id: true } });
    if (!before) {
      await db.letterTemplate.create({
        data: {
          key: t.key, category: t.category, name: t.name,
          description: t.description ?? null, subject: t.subject ?? null,
          body: t.body, signatoryTitle: t.signatoryTitle,
        },
      });
    }
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
      // F-01 BPA-AUDIT-53 — JKP PP 6/2025 Ps.11: total 0,36% dari upah s.d.
      // plafon 5jt = 0,22% ditanggung APBN + 0,14% rekomposisi iuran JKK.
      // TIDAK ADA iuran pekerja (jkpEmployeeRate = 0) dan TIDAK ADA beban
      // iuran baru perusahaan — jkpCompanyRate 0,0014 semata-mata nilai
      // informatif rekomposisi utk laporan BPJS (bukan komponen gaji).
      jkpEmployeeRate: 0, jkpCompanyRate: 0.0014, jkpSalaryCap: 5000000,
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

  // F-02 BPA-AUDIT-53 — TER resmi Lampiran PMK 168/2023 (pajak.go.id
  // hlm. 10-12): 44/40/41 lapisan, maksimum 34%. Sumber tunggal ter-official.ts.
  await db.terRate.createMany({ data: TER_OFFICIAL });

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

  // level jabatan + struktur approval berjenjang default (Task 25)
  await db.positionLevel.createMany({
    data: [
      { code: "PL1", name: "Officer", sortOrder: 1 },
      { code: "PL2", name: "Senior Officer", sortOrder: 2 },
      { code: "PL3", name: "Supervisor", sortOrder: 3 },
      { code: "PL4", name: "Assistant Manager", sortOrder: 4 },
      { code: "PL5", name: "Manager", sortOrder: 5 },
      { code: "PL6", name: "Senior Manager", sortOrder: 6 },
      { code: "PL7", name: "General Manager", sortOrder: 7 },
      { code: "PL8", name: "Director", sortOrder: 8 },
    ],
  });
  const defaultStructures: { code: string; name: string; docType: string; levels: { approverType: string; minAmount?: number; note?: string }[] }[] = [
    { code: "AS-LEAVE-STD", name: "Persetujuan Cuti (default)", docType: "Leave", levels: [{ approverType: "ATASAN_LANGSUNG" }] },
    { code: "AS-TRAVEL-STD", name: "Persetujuan Perjalanan Dinas (default)", docType: "Travel", levels: [{ approverType: "ATASAN_LANGSUNG" }] },
    { code: "AS-MED-STD", name: "Persetujuan Klaim Medis (default)", docType: "Medical", levels: [{ approverType: "ATASAN_LANGSUNG" }] },
    {
      code: "AS-LOAN-STD", name: "Persetujuan Pinjaman (default)", docType: "Loan",
      levels: [
        { approverType: "ATASAN_LANGSUNG" },
        { approverType: "HR_ADMIN", minAmount: 10_000_000, note: "≥ Rp 10 jt: Admin/HR" },
      ],
    },
  ];
  for (const s of defaultStructures) {
    await db.approvalStructure.create({
      data: {
        code: s.code, name: s.name, docType: s.docType,
        levels: { create: s.levels.map((l, i) => ({ levelNo: i + 1, approverType: l.approverType, minAmount: l.minAmount ?? null, note: l.note ?? null })) },
      },
    });
  }

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

  await ensureLeaveReference(db);
}

// Master leave idempoten — 12 jenis cuti inti Indonesia (UU 13/2003 + PP 35/2021)
// + komponen UCT (uang pengganti cuti). Dipakai provisioning & upgrade tenant.
export const LEAVE_TYPE_DEFS: {
  code: string; name: string; description?: string; unit?: string; entitlement: number;
  maxPerRequest?: number; paid?: boolean; cashable?: boolean; periodMode?: string;
  prorateMonthly?: boolean; carryOverMax?: number; waitingMonths?: number;
  allowAdvance?: boolean; allowHalfDay?: boolean; needDocs?: boolean;
}[] = [
  { code: "CT-THN", name: "Cuti Tahunan", description: "12 hari kerja setelah 12 bulan kerja berlanjut (UU 13/2003 pasal 79)", entitlement: 12, prorateMonthly: true, carryOverMax: 6, waitingMonths: 6, allowAdvance: true, cashable: true },
  { code: "CT-ANNIV", name: "Cuti Tahunan Anniversarry", description: "Periode per tanggal join karyawan", entitlement: 12, periodMode: "ANNIVERSARY", prorateMonthly: true, carryOverMax: 0, waitingMonths: 6, allowAdvance: true },
  { code: "CT-BESAR", name: "Cuti Besar (Long Service)", description: "Cuti panjang masa kerja — periode per tanggal join", entitlement: 12, periodMode: "ANNIVERSARY", waitingMonths: 72, allowAdvance: false, needDocs: true },
  { code: "CT-NIKAH", name: "Cuti Pernikahan", description: "Pernikahan karyawan sendiri (UU 13/2003 pasal 81)", entitlement: 3, waitingMonths: 0, needDocs: true },
  { code: "CT-NIKAH-A", name: "Cuti Pernikahan Anak", description: "Pernikahan anak sah karyawan (PP 35/2021)", entitlement: 2, needDocs: true },
  { code: "CT-KHITAN", name: "Cuti Baptis/Khitanan Anak", description: "Baptis/khitanan anak sah karyawan (PP 35/2021)", entitlement: 2, needDocs: true },
  { code: "CT-LAHIR", name: "Cuti Kelahiran Anak", description: "Istri sah karyawan melahirkan (UU 13/2003 Ps.93 — suami beristirahat 2 hari; UU KIA 4/2024 Ps.8 suami ikut beristirahat)", entitlement: 2, needDocs: true },
  { code: "CT-GUGUR-I", name: "Cuti Istri Keguguran", description: "Istri keguguran — untuk suami (UU 13/2003 Ps.93)", entitlement: 2, needDocs: true },
  { code: "CT-MATI-I", name: "Cuti Kematian Keluarga Inti", description: "Kematian suami/istri, anak, orang tua, mertua (PP 35/2021)", entitlement: 2, needDocs: true },
  { code: "CT-MATI-S", name: "Cuti Kematian Serumah/Saudara", description: "Kematian saudara/kakek/nenek/kenalan serumah (PP 35/2021)", entitlement: 1, needDocs: true },
  { code: "CT-HAJI", name: "Cuti Haji", description: "Ibadah haji (perusahaan menanggung upah penuh)", entitlement: 40, needDocs: true },
  { code: "CT-HAID", name: "Cuti Haid", description: "Cuti haid (UU 13/2003 pasal 81)", entitlement: 2, allowHalfDay: true },
  // Task 52-a + F-07/F-08 BPA-AUDIT-53 — UU 13/2003 Ps.82 & UU KIA 4/2024
  // Ps.4 ayat (3) huruf a: cuti melahirkan = 3 bulan PERTAMA (hak dasar) +
  // paling lama 3 bulan BERIKUTNYA HANYA bila ada kondisi khusus yang
  // dibuktikan SURAT KETERANGAN DOKTER. Saldo dasar 3 bulan; perpanjangan
  // bulan ke-4 s.d. 6 via allowAdvance + gerbang wajib catatan surat dokter
  // (leave-service submitRequest). Satuan MONTH (konversi 21 hr/bln).
  { code: "CT-LAHIR-P", name: "Cuti Melahirkan (Pekerja Perempuan)", description: "3 bulan pertama (UU KIA 4/2024 Ps.4(3)(a)) — perpanjangan s.d. 3 bulan berikutnya HANYA dengan kondisi khusus medis (wajib surat keterangan dokter, isi di catatan pengajuan)", unit: "MONTH", entitlement: 3, maxPerRequest: 6, allowAdvance: true, needDocs: true },
  { code: "CT-GUGUR-P", name: "Cuti Keguguran (Pekerja Perempuan)", description: "1,5 bulan (UU 13/2003 Ps.82(2) & UU KIA 4/2024 Ps.4(3)(b)) — dapat lebih lama sesuai rekomendasi dokter kandungan/psikiater (wajib catatan surat)", unit: "MONTH", entitlement: 1.5, maxPerRequest: 3, allowAdvance: true, needDocs: true },
];

export async function ensureLeaveReference(db: TenantDb): Promise<void> {
  for (const t of LEAVE_TYPE_DEFS) {
    await db.leaveType.upsert({
      where: { code: t.code },
      create: {
        code: t.code, name: t.name, description: t.description ?? null,
        unit: t.unit === "MONTH" ? "MONTH" : "DAY",
        entitlement: t.entitlement,
        maxPerRequest: t.maxPerRequest ?? 0,
        paid: t.paid !== false,
        cashable: Boolean(t.cashable),
        periodMode: t.periodMode === "ANNIVERSARY" ? "ANNIVERSARY" : "CALENDAR",
        prorateMonthly: Boolean(t.prorateMonthly),
        carryOverMax: t.carryOverMax ?? 0,
        waitingMonths: t.waitingMonths ?? 0,
        allowAdvance: Boolean(t.allowAdvance),
        allowHalfDay: t.allowHalfDay !== false,
        needDocs: Boolean(t.needDocs),
      },
      update: {},
    });
  }

  // komponen UCT (padanan wage code UCT "Cashable Leave")
  const uct = await db.wageComponent.findUnique({ where: { code: "UCT" } });
  if (!uct) {
    await db.wageComponent.create({
      data: {
        code: "UCT", name: "Uang Pengganti Cuti", type: "Earning", wageType: "Compensation",
        calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Regular",
        taxable: true, includeInTHP: true, accountDebitCode: "5102",
      },
    });
  }

  await ensureTravelReference(db);
  await ensureMedicalReference(db);
}

// ============ MEDICAL REFERENCE (ref: ANALISA-MEDICAL.md) ============

// Master medis idempoten — padanan General Setting (Medical Benefit Type:
// 12 jenis MII + Hospital/InsuranceCompany). Jenis: limit UNLIMITED/NOMINAL/FACTOR×gaji,
// frekuensi, kebijakan saldo tak terpakai (FORFEITED/CASH/CARRY), dependent.
// Komponen UMC (padanan cash_wage_code "unused balance in cash") + akun 5106.
export const MEDICAL_TYPE_DEFS: {
  code: string; name: string; description?: string;
  limitRule: string; limitValue?: number; wageCode?: string;
  freqUnlimited?: boolean; freqValue?: number; freqPeriod?: string;
  unusedRule?: string; maxCarryOver?: number;
  dependentEnabled?: boolean; maxDependents?: number; maxChildAge?: number; depLimitRule?: string;
  pctCompany?: number; pctInsurance?: number;
}[] = [
  { code: "RAWAT_INAP", name: "Rawat Inap", description: "Perawatan menginap di rumah sakit — 1× gaji pokok/tahun", limitRule: "FACTOR", limitValue: 1, freqUnlimited: true, unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 3, maxChildAge: 21, depLimitRule: "SHARED" },
  { code: "RAWAT_JALAN", name: "Rawat Jalan", description: "Poliklinik, obat, lab — sisa boleh ditarik tunai akhir tahun", limitRule: "NOMINAL", limitValue: 25_000_000, freqUnlimited: true, unusedRule: "CASH", dependentEnabled: true, maxDependents: 3, maxChildAge: 21, depLimitRule: "SHARED" },
  { code: "GIGI_MULUT", name: "Gigi & Mulut", description: "Perawatan gigi & mulut — 5 juta/tahun", limitRule: "NOMINAL", limitValue: 5_000_000, freqUnlimited: true, unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 3, maxChildAge: 21, depLimitRule: "SHARED" },
  { code: "KACAMATA", name: "Kacamata", description: "Kacamata + lensa — 1× setiap 2 tahun (padanan Year Period)", limitRule: "NOMINAL", limitValue: 1_500_000, freqUnlimited: false, freqValue: 1, freqPeriod: "YEAR", unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 3, maxChildAge: 21, depLimitRule: "SHARED" },
  { code: "MEDICAL_UMUM", name: "Medical Umum", description: "Pemeriksaan umum & konsultasi", limitRule: "NOMINAL", limitValue: 6_500_000, freqUnlimited: true, unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 3, maxChildAge: 21, depLimitRule: "SHARED" },
  { code: "IMUNISASI", name: "Imunisasi Anak", description: "Vaksinasi anak (dep. masing-masing)", limitRule: "NOMINAL", limitValue: 2_000_000, freqUnlimited: true, unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 3, maxChildAge: 12, depLimitRule: "EACH" },
  { code: "PERSALINAN", name: "Persalinan", description: "Melahirkan (karyawan/pasangan) — 8 juta sekali per kelahiran", limitRule: "NOMINAL", limitValue: 8_000_000, freqUnlimited: false, freqValue: 1, freqPeriod: "YEAR", unusedRule: "FORFEITED", dependentEnabled: true, maxDependents: 1, maxChildAge: 99, depLimitRule: "TOTAL_SEPARATE" },
  { code: "KHUSUS_PJK", name: "Khusus Penyakit Kerja", description: "Perawatan akibat kecelakaan/penyakit kerja (CK) — unlimited", limitRule: "UNLIMITED", freqUnlimited: true, unusedRule: "FORFEITED", dependentEnabled: false },
];

export const MEDICAL_PROVIDER_DEFS: {
  code: string; name: string; kind: string; city?: string; address?: string; phone?: string;
}[] = [
  { code: "RS-SIL", name: "RS Siloam Surabaya", kind: "HOSPITAL", city: "Surabaya", address: "Jl. Raya Gubeng No. 70", phone: "031-9933-111" },
  { code: "RS-ADH", name: "RS Aditya Husada", kind: "HOSPITAL", city: "Surabaya", address: "Jl. Manyar Kertoarjo V No. 11", phone: "031-594-1555" },
  { code: "RS-HER", name: "RS Hertoni Bagyo", kind: "HOSPITAL", city: "Gresik", address: "Jl. Bagyo Husodo No. 10", phone: "031-397-2111" },
  { code: "KLINK-MII", name: "Klinik Mitra Sehat", kind: "HOSPITAL", city: "Sidoarjo", address: "Kawasan Industri MII Blok C-12", phone: "031-801-2345" },
  { code: "APOT-KP", name: "Apotek Kimia Farma", kind: "HOSPITAL", city: "Sidoarjo", address: "Jl. Basuki Rahmat 20", phone: "031-802-1199" },
  { code: "ASR-AIA", name: "PT AIA Financial", kind: "INSURANCE", city: "Jakarta", address: "Menara AIA, Jl. Casablanca Raya Kav. 88", phone: "021-2978-8888" },
  { code: "ASR-AXA", name: "PT Asuransi AXA Indonesia", kind: "INSURANCE", city: "Jakarta", address: "AXA Tower, Jl. Prof. Satrio Kav. 18", phone: "021-3003-8888" },
  { code: "BPJS", name: "BPJS Kesehatan", kind: "INSURANCE", city: "Jakarta", address: "Jl. Letjen Suprapto No. 7", phone: "1500-400" },
];

export async function ensureMedicalReference(db: TenantDb): Promise<void> {
  let sortOrder = 0;
  for (const t of MEDICAL_TYPE_DEFS) {
    sortOrder++;
    await db.medicalBenefitType.upsert({
      where: { code: t.code },
      create: {
        code: t.code, name: t.name, description: t.description ?? null,
        active: true, needReceipt: true,
        limitRule: t.limitRule,
        limitValue: t.limitValue ?? 0,
        wageCode: t.wageCode ?? null,
        freqUnlimited: t.freqUnlimited ?? false,
        freqValue: t.freqValue ?? 0,
        freqPeriod: t.freqPeriod ?? "YEAR",
        pctCompany: t.pctCompany ?? 100,
        pctInsurance: t.pctInsurance ?? 0,
        unusedRule: t.unusedRule ?? "FORFEITED",
        cashWageCode: (t.unusedRule ?? "FORFEITED") === "CASH" ? "UMC" : null,
        maxCarryOver: t.maxCarryOver ?? 0,
        dependentEnabled: t.dependentEnabled ?? true,
        maxDependents: t.maxDependents ?? 2,
        maxChildAge: t.maxChildAge ?? 21,
        depLimitRule: t.depLimitRule ?? "SHARED",
        sortOrder,
      },
      update: {},
    });
  }

  for (const p of MEDICAL_PROVIDER_DEFS) {
    await db.medicalProvider.upsert({
      where: { code: p.code },
      create: {
        code: p.code, name: p.name, kind: p.kind,
        city: p.city ?? null, address: p.address ?? null, phone: p.phone ?? null,
      },
      update: {},
    });
  }

  // akun beban medis (fallback klaim tanpa akun khusus)
  const acc = await db.account.findUnique({ where: { code: "5106" } });
  if (!acc) {
    const ag = await db.accountGroup.findFirst({ where: { code: { startsWith: "5" } } });
    await db.account.create({
      data: { code: "5106", name: "Beban Kesejahteraan Medis", accountGroupId: ag?.id ?? null, balance: 0 },
    });
  }

  // komponen UMC — padanan cash_wage_code (unused medical balance in cash)
  const umc = await db.wageComponent.findUnique({ where: { code: "UMC" } });
  if (!umc) {
    await db.wageComponent.create({
      data: {
        code: "UMC", name: "Uang Sisa Saldo Medis", type: "Earning", wageType: "Compensation",
        calcMethod: "Fixed", amount: 0, incomeTaxMethod: "Regular",
        taxable: true, includeInTHP: true, accountDebitCode: "5106",
      },
    });
  }
}

// ============ TRAVEL REFERENCE (ref: ANALISA-TRAVEL.md) ============

// Master travel idempoten — padanan General Setting (12 halaman → master RekanKerja):
// 4 zona (Domestic Zone), 5 template (ClaimTmpl — settlement day 14), 14 jenis biaya
// (Expense Definition + Rules: limit & akun), komponen upah UTRP/TRVSTLIN (Wage
// Definition: compensation & deduction), akun 5105, budget tahun berjalan.
const TRAVEL_ZONE_DEFS: { code: string; name: string; overseas: boolean }[] = [
  { code: "LOCAL", name: "Lokal / Dalam Kota", overseas: false },
  { code: "JABAR", name: "Jawa Barat (Bandung)", overseas: false },
  { code: "ASIA", name: "Asia (kecuali Jepang)", overseas: true },
  { code: "OTHERS", name: "Jepang, US, Eropa, dll.", overseas: true },
];

export const TRAVEL_TEMPLATE_DEFS: {
  code: string; name: string; description?: string; isDefault?: boolean;
  settlementDay: number; settlementMethod: string;
}[] = [
  { code: "TRAVEL", name: "Perjalanan Dinas Standar", description: "Template default semua perjalanan dinas", isDefault: true, settlementDay: 14, settlementMethod: "Kas" },
  { code: "TRAVEL-LOCAL", name: "Perjalanan Dinas Lokal", description: "Perjalanan dalam kota / radius dekat", settlementDay: 14, settlementMethod: "Kas" },
  { code: "TRAVEL-LOCAL-150", name: "Perjalanan Lokal ≤150 km", description: "Padanan TRAVEL LOCAL 150KM — settled by cash", settlementDay: 14, settlementMethod: "Kas" },
  { code: "TRAVEL-OVERSEAS", name: "Perjalanan Dinas Luar Negeri", description: "Dinas ke luar negeri (expense O-*, kurs)", settlementDay: 14, settlementMethod: "Kas" },
  { code: "TRAVEL-KA", name: "Perjalanan Dinas Kereta", description: "Padanan TRAVEL_KA — transportasi KA", settlementDay: 14, settlementMethod: "Kas" },
];

export const TRAVEL_EXPENSE_DEFS: {
  code: string; name: string; kind: string; description?: string;
  limitAmount?: number; needDocs?: boolean; compWageCode?: string;
}[] = [
  // General Expense — lokal (padanan L-*)
  { code: "L-HOTEL", name: "Hotel (Dalam Negeri)", kind: "GENERAL", description: "Penginapan perjalanan domestik", limitAmount: 2_000_000, needDocs: true },
  { code: "L-TRANSPORT", name: "Transportasi (Dalam Negeri)", kind: "GENERAL", description: "Tiket pesawat/KA/taksi perjalanan domestik", needDocs: true },
  { code: "L-MEALS", name: "Makan (Dalam Negeri)", kind: "GENERAL" },
  { code: "L-PHONE", name: "Komunikasi (Dalam Negeri)", kind: "GENERAL", limitAmount: 500_000 },
  { code: "L-LAUNDRY", name: "Laundry (Dalam Negeri)", kind: "GENERAL", limitAmount: 300_000 },
  // General Expense — luar negeri (padanan O-*)
  { code: "O-HOTEL", name: "Hotel (Luar Negeri)", kind: "GENERAL", description: "Penginapan perjalanan luar negeri", needDocs: true },
  { code: "O-TRANSPORT", name: "Transportasi (Luar Negeri)", kind: "GENERAL", needDocs: true },
  { code: "O-MEALS", name: "Makan (Luar Negeri)", kind: "GENERAL" },
  { code: "O-LICENSE", name: "Visa & Dokumen Perjalanan", kind: "GENERAL", needDocs: true },
  // Allowance (padanan L-POCKET MONEY)
  { code: "L-POCKET", name: "Uang Saku Harian", kind: "ALLOWANCE", description: "Pocket money per hari perjalanan", limitAmount: 500_000 },
  // Mileage (padanan L_BBM / L_SAKU / L-TRANSPORTJARAK)
  { code: "L-BBM", name: "BBM Kendaraan Dinas", kind: "MILEAGE", limitAmount: 125_000 },
  { code: "L-JARAK", name: "Biaya Jarak Tempuh", kind: "MILEAGE", description: "Reimburse per km kendaraan pribadi" },
  // Entertainment (padanan E-*)
  { code: "E-RESTAURANT", name: "Entertainment — Restoran", kind: "ENTERTAINMENT", limitAmount: 1_500_000, needDocs: true },
  { code: "E-GIFT", name: "Entertainment — Hadiah", kind: "ENTERTAINMENT", limitAmount: 800_000, needDocs: true },
];

export async function ensureTravelReference(db: TenantDb): Promise<void> {
  for (const z of TRAVEL_ZONE_DEFS) {
    await db.travelZone.upsert({
      where: { code: z.code },
      create: { code: z.code, name: z.name, overseas: z.overseas },
      update: {},
    });
  }

  for (const t of TRAVEL_TEMPLATE_DEFS) {
    await db.travelTemplate.upsert({
      where: { code: t.code },
      create: {
        code: t.code, name: t.name, description: t.description ?? null,
        isDefault: Boolean(t.isDefault), settlementDay: t.settlementDay,
        settlementMethod: t.settlementMethod,
      },
      update: {},
    });
  }

  for (const e of TRAVEL_EXPENSE_DEFS) {
    await db.travelExpenseType.upsert({
      where: { code: e.code },
      create: {
        code: e.code, name: e.name, kind: e.kind, description: e.description ?? null,
        needDocs: Boolean(e.needDocs), limitAmount: e.limitAmount ?? 0,
        debitAccount: "5105", creditAccount: "1101",
      },
      update: {},
    });
  }

  // akun beban perjalanan (Expense Chart of Account fallback)
  const acc = await db.account.findUnique({ where: { code: "5105" } });
  if (!acc) {
    const ag = await db.accountGroup.findFirst({ where: { code: { startsWith: "5" } } });
    await db.account.create({
      data: { code: "5105", name: "Beban Perjalanan Dinas", accountGroupId: ag?.id ?? null, balance: 0 },
    });
  }

  // komponen upah interface payroll (padanan Travel Wage Definition:
  // Wage for Compensation UTRP + Wage for Deduction TRVSTLIN)
  for (const c of [
    { code: "UTRP", name: "Kompensasi Perjalanan Dinas", type: "Earning", wageType: "Compensation", tax: "Regular" as const, debit: "5105" },
    { code: "TRVSTLIN", name: "Potongan Settlement Travel", type: "Deduction", wageType: "Deduction", tax: "NonTaxable" as const, debit: null },
  ]) {
    const comp = await db.wageComponent.findUnique({ where: { code: c.code } });
    if (!comp) {
      await db.wageComponent.create({
        data: {
          code: c.code, name: c.name, type: c.type, wageType: c.wageType,
          calcMethod: "Fixed", amount: 0, incomeTaxMethod: c.tax,
          taxable: c.tax !== "NonTaxable", includeInTHP: true,
          accountDebitCode: c.debit,
        },
      });
    }
  }
}
