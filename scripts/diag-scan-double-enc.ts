// DIAGNOSTIK Task 56 — pindai SEMUA kolom terenkripsi: temukan nilai yang
// akan TAMPIL SEBAGAI CIPHERTEXT di UI (double-encryption tersisa) atau gagal
// dekripsi (kunci tak cocok). Read-only — tidak menulis apa pun.
//   bun run scripts/diag-scan-double-enc.ts
import "./lib/env";
import { Client } from "pg";
import { tenantCrypto, primeTenantCrypto, isEncrypted } from "../src/rekankerja/shared/lib/field-crypto";
import { ENCRYPTED_COLUMNS } from "./lib/encrypted-columns";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

async function main() {
  for (const schema of SCHEMAS) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      // muat dataKey vault (enc:v2) ke cache proses ini — tanpa ini semua nilai v2 gagal
      await primeTenantCrypto(schema);
      const tc = tenantCrypto(schema);
      let doubleEnc = 0;
      let failDecrypt = 0;
      let scanned = 0;
      const problems: string[] = [];
      for (const [table, col, kind] of ENCRYPTED_COLUMNS) {
        const dt = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
          [schema, table, col],
        );
        if (dt.rowCount === 0) continue;
        const rows = await c.query(
          `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" LIKE 'enc:%'`,
        );
        scanned += rows.rowCount ?? 0;
        for (const r of rows.rows as { id: string; v: string }[]) {
          // satu lapisan dekripsi — hasil masih enc: = DOUBLE-ENCRYPTION
          try {
            const oneLayer = kind === "t" ? tc.decryptText(r.v) : String(tc.decryptMoney(r.v));
            if (oneLayer != null && isEncrypted(oneLayer)) {
              doubleEnc++;
              if (problems.length < 25) {
                problems.push(`DOUBLE-ENC ${table}.${col} id=${r.id} → ${String(oneLayer).slice(0, 40)}…`);
              }
            }
          } catch (e) {
            failDecrypt++;
            if (problems.length < 25) {
              problems.push(`FAIL-DECRYPT ${table}.${col} id=${r.id} — ${(e as Error).message.slice(0, 80)}`);
            }
          }
        }
      }
      console.log(`\n[${schema}] scanned=${scanned} doubleEnc=${doubleEnc} failDecrypt=${failDecrypt}`);
      for (const p of problems) console.log(`  ${p}`);
    } finally {
      await c.end().catch(() => {});
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
