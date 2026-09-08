// Migrasi 28-c — enkripsi field sensitif SAMPAI LEVEL DATABASE (idempoten):
//   1. ALTER money Float → TEXT (PayrollRun/RunLine/RunItem/Journal totals/
//      JournalLine/EmployeeAssignment.baseSalary/EmployeeComponentAssignment.amount).
//   2. Encrypt-in-place: kolom uang → enc:v1:n:…, kolom identitas
//      (Employee.nationalId/taxId/bankAccount + EmployeePayrollProfile.npwp/
//      bankAccount) → enc:v1:t:… — AES-256-GCM per-tenant, kunci SAMA dgn
//      aplikasi (import tenantCrypto dari field-crypto langsung).
//   3. Skip baris yang sudah enc:v1 → rerun = 0 perubahan.
// Dapat diimpor IN-PROCESS oleh src/onevity/shared/lib/parity-runner.ts
// (main() tanpa efek samping) ATAU CLI: bun run scripts/migrate-encrypt.ts
import { Client } from "pg";
import { tenantCrypto } from "../src/onevity/shared/lib/field-crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// [table, column, kind] — kind "n" = uang, "t" = teks identitas
const TARGETS: [string, string, "n" | "t"][] = [
  ["PayrollRun", "totalBruto", "n"],
  ["PayrollRun", "totalDeduction", "n"],
  ["PayrollRun", "totalTax", "n"],
  ["PayrollRun", "totalNet", "n"],
  ["PayrollRunLine", "bruto", "n"],
  ["PayrollRunLine", "deduction", "n"],
  ["PayrollRunLine", "taxRegular", "n"],
  ["PayrollRunLine", "taxIrregular", "n"],
  ["PayrollRunLine", "net", "n"],
  ["PayrollRunLine", "actualNetTax", "n"],
  ["PayrollRunItem", "amount", "n"],
  ["PayrollJournal", "totalDebit", "n"],
  ["PayrollJournal", "totalCredit", "n"],
  ["PayrollJournalLine", "amount", "n"],
  ["EmployeeAssignment", "baseSalary", "n"],
  ["EmployeeComponentAssignment", "amount", "n"],
  ["Employee", "nationalId", "t"],
  ["Employee", "taxId", "t"],
  ["Employee", "bankAccount", "t"],
  ["EmployeePayrollProfile", "npwp", "t"],
  ["EmployeePayrollProfile", "bankAccount", "t"],
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
    console.log(`\n[${schema}] migrasi enkripsi 28-c…`);
    let altered = 0, encrypted = 0, skippedEnc = 0;

    for (const [table, col, kind] of TARGETS) {
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
      // ---- 2. encrypt-in-place (skip enc:v1) ----
      const rows = await c.query(
        `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" NOT LIKE 'enc:v1%'`,
      );
      for (const r of rows.rows) {
        const enc = kind === "n" ? tc.encryptMoney(Number(r.v)) : tc.encryptText(String(r.v));
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
