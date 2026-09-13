// Migrasi Task 55 — REPAIR DOUBLE-ENCRYPTION (akar bug screenshot direktori
// menampilkan "enc:v2:t:…" di field NIK/NPWP/No. Rekening).
//
// MEKANISME BUG: encryptText dulu TANPA guard — nilai ciphertext yang bocor ke
// UI (serializer pra-43-f) bisa di-round-trip balik ke write-path → nilai
// terenkripsi DUA LAPIS. decryptText melepas lapisan luar lalu "mengembalikan"
// ciphertext lapisan dalam seolah-plaintext → Personal tab menampilkan
// enc:… mentah. GUARD kini ada di encryptText (field-crypto, idempoten); skrip
// ini merapikan DATA historis: buka semua lapisan (maks 5) → tulis ulang
// SATU lapis. Uang (kind n) ikut dicek defensif: decryptMoney gagal kind-
// mismatch bila berisi teks ciphertext → unwrap lalu parse angka.
//
// Idempoten: baris berlapis tunggal tidak tersentuh (hasil unwrap = nilai
// sama). Dapat diimpor parity-runner atau CLI:
//   bun run scripts/migrate-unwrap-double-enc.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { tenantCrypto, isEncrypted } from "../src/onevity/shared/lib/field-crypto";
import { ENCRYPTED_COLUMNS } from "./lib/encrypted-columns";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const MAX_LAYERS = 5;

/** Buka semua lapisan enkripsi → { plain, layers } (layers=1 normal). */
function unwrapText(stored: string, dec: (s: string) => string | null): { plain: string | null; layers: number } {
  let cur: string | null = stored;
  let layers = 0;
  while (cur != null && isEncrypted(cur) && layers < MAX_LAYERS) {
    try {
      cur = dec(cur);
      layers++;
    } catch {
      // kunci lapisan berikutnya tak terbaca → berhenti di nilai saat ini
      break;
    }
  }
  return { plain: cur, layers };
}

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  let totalFixed = 0;
  let totalScanned = 0;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      const tc = tenantCrypto(schema);
      let fixed = 0;
      let scanned = 0;
      for (const [table, col, kind] of ENCRYPTED_COLUMNS) {
        // tabel/kolom opsional di tenant baru → skip senyap
        const dt = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
          [schema, table, col],
        );
        if (dt.rowCount === 0) continue;

        const rows = await c.query(
          `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL AND "${col}" LIKE 'enc:%'`,
        );
        scanned += rows.rowCount ?? 0;
        let fixedCol = 0;
        for (const r of rows.rows as { id: string; v: string }[]) {
          if (kind === "t") {
            const { plain, layers } = unwrapText(r.v, (s) => tc.decryptText(s));
            if (plain != null && layers > 1 && !isEncrypted(plain)) {
              // tulis ulang SATU lapis (idempoten dengan guard encryptText)
              await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [tc.encryptText(plain), r.id]);
              fixed++;
              fixedCol++;
            } else if (plain != null && isEncrypted(plain) && layers >= MAX_LAYERS) {
              console.warn(`  [${schema}] ${table}.${col} id=${r.id}: masih terenkripsi setelah ${MAX_LAYERS} lapis — kunci tidak cocok, DIBIARKAN (fail-closed).`);
            }
          } else {
            // kind "n" — uang: normal = decryptMoney angka. Double-enc / kind
            // mismatch → unwrap lalu parse. Simpan ulang enc single-layer.
            let value: number | null = null;
            try {
              value = tc.decryptMoney(r.v);
            } catch {
              const { plain, layers } = unwrapText(r.v, (s) => tc.decryptText(s));
              const n = plain != null && !isEncrypted(plain) ? parseFloat(plain) : NaN;
              if (Number.isFinite(n)) {
                await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [tc.encryptMoney(n), r.id]);
                fixed++;
                fixedCol++;
                if (layers > 1) console.warn(`  [${schema}] ${table}.${col} id=${r.id}: unwrap ${layers} lapis uang.`);
              } else {
                console.warn(`  [${schema}] ${table}.${col} id=${r.id}: nilai uang tak terbaca — DIBIARKAN.`);
              }
              continue;
            }
            if (value == null || !Number.isFinite(value)) {
              // NaN historis → 0 (konsisten fallback decryptMoney)
              await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [tc.encryptMoney(0), r.id]);
              fixed++;
              fixedCol++;
            }
          }
        }
        if (fixedCol > 0) console.log(`  [${schema}] ${table}.${col}: ${fixedCol} dari ${rows.rowCount ?? 0} baris diperbaiki`);
      }
      console.log(`[${schema}] unwrap double-enc: ${scanned} nilai terenkripsi dipindai, ${fixed} diperbaiki`);
      totalFixed += fixed;
      totalScanned += scanned;
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`migrate-unwrap-double-enc selesai: ${totalFixed} nilai diperbaiki dari ${totalScanned} yang dipindai (idempoten)`);
}

// CLI langsung (bukan diimpor parity-runner)
if (process.argv[1] && process.argv[1].endsWith("migrate-unwrap-double-enc.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
