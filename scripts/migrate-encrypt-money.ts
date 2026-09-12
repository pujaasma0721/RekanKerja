// Migrasi M-8 (Task 44) — GELOMBANG ENKRIPSI KEDUA: uang modul claim (idempoten):
//   1. ALTER money Float → TEXT untuk 38 kolom uang personal di modul
//      loan / benefit / leave-encashment / medical / travel (daftar TARGETS).
//      Kolom config/master (routing approval, katalog komponen upah, bracket
//      pajak, regulation, grade band, rate multiplier) TIDAK disentuh — bukan
//      uang personal karyawan dan dipakai mesin aturan.
//   2. Encrypt-in-place: enc:v1:n:… — AES-256-GCM per-tenant (tenantCrypto,
//      kunci SAMA dengan aplikasi; wave-1 = scripts/migrate-encrypt.ts).
//   3. Skip baris yang sudah enc:v1 → rerun = 0 perubahan.
// Dapat diimpor IN-PROCESS oleh src/onevity/shared/lib/parity-runner.ts
// (main() tanpa efek samping) ATAU CLI: bun run scripts/migrate-encrypt-money.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { tenantCrypto } from "../src/onevity/shared/lib/field-crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// [table, column] — SEMUA kind "n" (uang). Lihat worklog Task 44-0 untuk
// klasifikasi lengkap kolom yang sengaja di-skip.
const TARGETS: [string, string][] = [
  // ---- Loan ----
  ["EmployeeLoan", "amount"],
  ["EmployeeLoan", "installmentAmount"],
  ["EmployeeLoan", "paidAmount"],
  ["EmployeeLoan", "outstanding"],
  ["LoanInstallment", "amount"],
  // ---- Benefit ----
  ["BenefitClaim", "amount"],
  ["BenefitClaim", "approvedAmount"],
  ["BenefitClaim", "limitUsed"],
  ["BenefitClaim", "limitRemaining"],
  // ---- Leave encashment ----
  ["LeaveEncashment", "amount"],
  // ---- Medical ----
  ["MedicalBalance", "benefitAmount"],
  ["MedicalBalance", "adjustmentAmount"],
  ["MedicalBalance", "initialUsed"],
  ["MedicalBalance", "usedAmount"],
  ["MedicalBalance", "depBenefitAmount"],
  ["MedicalBalance", "depAdjustment"],
  ["MedicalBalance", "depUsed"],
  ["MedicalBalance", "carriedOver"],
  ["MedicalClaim", "maxBenefitAt"],
  ["MedicalClaim", "usedAt"],
  ["MedicalClaim", "totalBill"],
  ["MedicalClaim", "totalReimburse"],
  ["MedicalClaim", "totalApproved"],
  ["MedicalClaim", "totalNonRe"],
  ["MedicalClaimLine", "billAmount"],
  ["MedicalClaimLine", "reimburseAmount"],
  ["MedicalClaimLine", "approvedAmount"],
  ["MedicalClaimLine", "nonReAmount"],
  ["MedicalAdjustment", "amount"],
  // ---- Travel ----
  ["TravelClaim", "otherCompanyExp"],
  ["TravelClaim", "exchangeLoss"],
  ["TravelClaim", "payableEmployee"],
  ["TravelClaim", "payableCompany"],
  ["TravelClaim", "totalSettlement"],
  ["TravelClaimExpense", "amount"],
  ["TravelAdvance", "amount"],
  ["TravelBudget", "totalBudget"],
  ["TravelBudgetItem", "amount"],
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      const tc = tenantCrypto(schema);
      console.log(`\n[${schema}] migrasi enkripsi M-8 (gelombang kedua, 38 kolom uang)…`);
      let altered = 0, encrypted = 0, skippedEnc = 0;

      for (const [table, col] of TARGETS) {
        // ---- 1. tipe kolom: pastikan TEXT ----
        const dt = await c.query(
          `SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
          [schema, table, col],
        );
        if (dt.rowCount === 0) { console.log(`  [!] ${table}.${col} tidak ada — lewati`); continue; }
        if (dt.rows[0].data_type !== "text") {
          await c.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE TEXT USING "${col}"::text`);
          altered++;
        }
        // ---- 2. encrypt-in-place (skip enc:v1 & string kosong) ----
        const rows = await c.query(
          `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" NOT LIKE 'enc:v1%' AND "${col}" <> ''`,
        );
        for (const r of rows.rows) {
          const n = Number(r.v);
          if (!Number.isFinite(n)) {
            console.log(`  [!] ${table}.${col} baris ${r.id}: nilai non-numerik "${String(r.v).slice(0, 24)}" — lewati`);
            continue;
          }
          const enc = tc.encryptMoney(n);
          await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [enc, r.id]);
          encrypted++;
        }
        const already = await c.query(
          `SELECT count(*)::int n FROM "${table}" WHERE "${col}" LIKE 'enc:v1%'`,
        );
        skippedEnc += already.rows[0].n;
        if (rows.rows.length > 0) console.log(`  ${table}.${col}: ${rows.rows.length} baris dienkripsi`);
      }
      console.log(`  ALTER type: ${altered} kolom · enkripsi baru: ${encrypted} baris · total sudah terenkripsi: ${skippedEnc} baris`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE — rerun utk verifikasi idempotensi (semua 0)");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
