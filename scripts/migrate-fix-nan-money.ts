// Migrasi FIX-NAN-MONEY (pasca-Task 50) — perbaiki nilai uang terenkripsi yang
// plaintext-nya non-finite ("NaN"/"Infinity") — sisa bug encryptMoney lama yang
// menerima NaN (fix di field-crypto.ts: non-finite kini disimpan sebagai 0).
//   Gejala: step parity travel-settlement GAGAL di tenant dengan
//   "[field-crypto:<schema>] nilai uang terenkripsi bukan angka: NaN" — satu
//   baris buruk memblokir seluruh migrasi tenant tersebut.
//   1. Pindai kolom uang terenkripsi (TARGETS = kolom M-8 + kolom payroll wave-1)
//      → cari enc:*:n:* yang plaintext-nya bukan angka finite (isMoneySane).
//   2. Tulis ulang → 0 (enc:v2/v1:n sesuai kunci tulis tenant saat ini).
//      Asumsi bisnis: nilai NaN bukan angka sah — diperlakukan 0 (idempoten).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun run scripts/migrate-fix-nan-money.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { tenantCrypto } from "../src/onevity/shared/lib/field-crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// Kolom uang terenkripsi — [table, column]. Sumber: migrate-encrypt-money.ts
// (M-8, 38 kolom) + kolom payroll/assignment/jurnal wave-1 (migrate-encrypt.ts).
const TARGETS: [string, string][] = [
  // ---- M-8: claim ----
  ["EmployeeLoan", "amount"],
  ["EmployeeLoan", "installmentAmount"],
  ["EmployeeLoan", "paidAmount"],
  ["EmployeeLoan", "outstanding"],
  ["LoanInstallment", "amount"],
  ["BenefitClaim", "amount"],
  ["BenefitClaim", "approvedAmount"],
  ["BenefitClaim", "limitUsed"],
  ["BenefitClaim", "limitRemaining"],
  ["LeaveEncashment", "amount"],
  ["MedicalBalance", "benefitAmount"],
  ["MedicalBalance", "adjustmentAmount"],
  ["MedicalBalance", "initialUsed"],
  ["MedicalBalance", "usedAmount"],
  ["MedicalBalance", "depBenefitAmount"],
  ["MedicalBalance", "depAdjustment"],
  ["MedicalBalance", "depUsed"],
  ["MedicalBalance", "carriedOver"],
  ["MedicalClaim", "totalBill"],
  ["MedicalClaim", "totalReimburse"],
  ["MedicalClaim", "totalApproved"],
  ["MedicalClaim", "totalNonRe"],
  ["MedicalClaimLine", "billAmount"],
  ["MedicalClaimLine", "reimburseAmount"],
  ["MedicalClaimLine", "approvedAmount"],
  ["MedicalClaimLine", "nonReAmount"],
  ["MedicalAdjustment", "amount"],
  ["TravelClaim", "otherCompanyExp"],
  ["TravelClaim", "exchangeLoss"],
  ["TravelClaim", "payableEmployee"],
  ["TravelClaim", "payableCompany"],
  ["TravelClaim", "totalSettlement"],
  ["TravelClaimExpense", "amount"],
  ["TravelAdvance", "amount"],
  ["TravelBudget", "totalBudget"],
  ["TravelBudgetItem", "amount"],
  // ---- Wave-1: payroll (Task 28-c) ----
  ["EmployeeAssignment", "baseSalary"],
  ["EmployeeComponentAssignment", "amount"],
  ["PayrollRunLine", "bruto"],
  ["PayrollRunLine", "deduction"],
  ["PayrollRunLine", "taxRegular"],
  ["PayrollRunLine", "taxIrregular"],
  ["PayrollRunLine", "net"],
  ["PayrollRunLine", "actualNetTax"],
  ["PayrollRun", "totalBruto"],
  ["PayrollRun", "totalDeduction"],
  ["PayrollRun", "totalTax"],
  ["PayrollRun", "totalNet"],
  ["PayrollJournal", "totalDebit"],
  ["PayrollJournal", "totalCredit"],
  ["PayrollJournalLine", "amount"],
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  let totalFixed = 0;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      // Query SELECT/UPDATE tidak memenuhi syarat skema — arahkan search_path
      // ke skema tenant (konvensi migrate-encrypt-money.ts).
      await c.query(`SET search_path TO "${schema}"`);
      const tc = tenantCrypto(schema);
      console.log(`\n[${schema}] pindai nilai uang terenkripsi non-finite…`);
      let fixed = 0;
      for (const [table, col] of TARGETS) {
        // kolom ada? (schema fresh bisa belum punya sebagian tabel)
        const dt = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
          [schema, table, col],
        );
        if (dt.rowCount === 0) continue;
        const rows = await c.query<{ id: string; v: string }>(
          `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" LIKE 'enc:%:n:%'`,
        );
        for (const r of rows.rows) {
          if (tc.isMoneySane(r.v)) continue; // nilai normal — biarkan
          // nilai non-finite (NaN/Infinity) → tulis ulang 0 dgn kunci tulis saat ini
          const enc = tc.encryptMoney(0) ?? "0";
          await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [enc, r.id]);
          console.log(`  [FIX] ${table}.${col} baris ${r.id}: plaintext "${Buffer.from(r.v.split(":")[5] ?? "", "base64").toString("utf8").slice(0, 12)}…" → 0`);
          fixed++;
        }
      }
      totalFixed += fixed;
      console.log(`  selesai: ${fixed} nilai diperbaiki`);
    } finally {
      await c.end();
    }
  }
  console.log(`\nTOTAL diperbaiki: ${totalFixed} nilai (0 = idempoten/rerun aman)`);
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
