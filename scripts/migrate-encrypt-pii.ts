// Migrasi Task 52-d — enkripsi PII lanjutan (audit 51) — idempoten:
//   · Employee.bpjsHealth / Employee.bpjsEmpSkill (no. BPJS Kesehatan/TK)
//   · EmployeeDocument.docNumber (no. KTP/paspor/KK — PII identitas)
//   · MedicalClaimLine.treatment (diagnosis/perawatan — PII kesehatan)
// Encrypt-in-place: plaintext → enc:v1:t:… (AES-256-GCM per-tenant, kunci
// sama dengan aplikasi — tenantCrypto dari field-crypto). Kolom sudah TEXT;
// skip baris berprefiks enc: → rerun = 0 perubahan.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-encrypt-pii.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { tenantCrypto } from "../src/onevity/shared/lib/field-crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// [table, column] — semua kind "t" (teks identitas/PII)
const TARGETS: [string, string][] = [
  ["Employee", "bpjsHealth"],
  ["Employee", "bpjsEmpSkill"],
  ["EmployeeDocument", "docNumber"],
  ["MedicalClaimLine", "treatment"],
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
      let encrypted = 0;
      for (const [table, col] of TARGETS) {
        // ---- 1. kolom harus ada & bertipe TEXT ----
        const dt = await c.query(
          `SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
          [schema, table, col],
        );
        if (dt.rowCount === 0) { continue; }
        if (dt.rows[0].data_type !== "text") {
          await c.query(`ALTER TABLE "${table}" ALTER COLUMN "${col}" TYPE TEXT USING "${col}"::text`);
        }
        // ---- 2. encrypt-in-place (skip enc: prefix) ----
        const rows = await c.query(
          `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" NOT LIKE 'enc:%'`,
        );
        for (const r of rows.rows) {
          const enc = tc.encryptText(String(r.v));
          await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [enc, r.id]);
          encrypted++;
        }
        if (rows.rows.length > 0) console.log(`  [${schema}] ${table}.${col}: ${rows.rows.length} baris dienkripsi`);
      }
      console.log(`[${schema}] PII lanjutan (Task 52-d): ${encrypted} baris dienkripsi (idempoten)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-encrypt-pii")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
