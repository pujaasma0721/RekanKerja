// Migrasi Task 47 — ENGINE RE-ENKRIPSI BRANKAS (kata sandi perusahaan) ====
// ========================================================================
// Inti permintaan produk: "ganti kata sandi = SEMUA data di-decrypt dahulu
// lalu di-simpan ulang dengan enkripsi kata sandi baru". Dipanggil IN-PROCESS
// oleh src/rekankerja/shared/lib/money-vault.ts saat:
//   · setupVault        — data legacy (v1 bootstrap / plaintext) → v2 dataKey
//   · changeVaultPassword — data kunci lama (v2 lama / v1 / plaintext) → v2 baru
//
// KEAMANAN TRANSAKSI: pemanggil membuka BEGIN + advisory lock di client pg
// yang sama, memasang baris MoneyVault baru, lalu memanggil rekeyVaultData().
// Satu transaksi ALL-OR-NOTHING — kegagalan di tengah TIDAK meninggalkan
// campuran kunci lama/baru (rollback bersih).
//
// Format hasil: enc:v2:<t|n>:<iv>:<tag>:<ct> = AES-256-GCM(dataKey baru,
// PBKDF2 kata sandi). Nilai sumber didekripsi per prefix:
//   · enc:v2 → dataKey LAMA (ctx.oldDataKey — wajib ada bila ada nilai v2)
//   · enc:v1 → kunci bootstrap legacy (legacyTenantKey — env/fallback)
//   · plaintext → passthrough (uang: parse angka, non-numerik di-skip)
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ENCRYPTED_COLUMNS } from "./lib/encrypted-columns";
import {
  decryptMoneyWithKey,
  decryptTextWithKey,
  encryptWithKey,
  legacyTenantKey,
} from "../src/rekankerja/shared/lib/field-crypto";

export interface RekeyContext {
  schema: string;
  /** dataKey LAMA (null = setup pertama — nilai v2 tidak mungkin ada). */
  oldDataKey: Buffer | null;
  /** dataKey BARU hasil PBKDF2 kata sandi baru. */
  newDataKey: Buffer;
}

export interface RekeyStats {
  tables: number;
  rows: number;
  skipped: number;
}

const BATCH = 200;

/**
 * Re-enkripsi seluruh kolom terenkripsi satu schema dengan dataKey baru.
 * Client HARUS dalam transaksi terbuka (BEGIN + pg_advisory_xact_lock sudah
 * dipasang pemanggil) dengan search_path belum di-set — fungsi ini yang set.
 * Idempoten: nilai sudah enc:v2 + oldDataKey == newDataKey akan dibaca
 * ulang dan ditulis ulang (hasil identik secara semantik).
 */
export async function rekeyVaultData(c: Client, ctx: RekeyContext): Promise<RekeyStats> {
  const { schema, oldDataKey, newDataKey } = ctx;
  await c.query(`SET search_path TO "${schema}"`);
  const legacyKey = legacyTenantKey(schema);
  let tables = 0;
  let rows = 0;
  let skipped = 0;

  for (const [table, col, kind] of ENCRYPTED_COLUMNS) {
    // ---- keberadaan tabel+kolom (schema legacy boleh tanpa beberapa tabel) ----
    const dt = await c.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
      [schema, table, col],
    );
    if (dt.rowCount === 0) continue;
    tables++;

    // ---- keyset pagination (id TEXT cuid — urut leksikografis konsisten) ----
    let lastId = "";
    for (;;) {
      const page = await c.query<{ id: string; v: string }>(
        `SELECT id, "${col}" AS v FROM "${table}"
          WHERE id > $1 AND "${col}" IS NOT NULL AND "${col}" <> ''
          ORDER BY id LIMIT ${BATCH}`,
        [lastId],
      );
      if (!page.rowCount || page.rows.length === 0) break;

      for (const row of page.rows) {
        const v = String(row.v);

        // ---- dekripsi nilai lama per prefix ----
        let plain: string | number | null;
        if (v.startsWith("enc:v2")) {
          if (!oldDataKey) {
            throw new Error(
              `[rekey:${schema}] ${table}.${col} memuat nilai enc:v2 tetapi dataKey lama tidak tersedia — ` +
                `baris MoneyVault rusak? (setup ulang tidak mungkin menghasilkan nilai v2)`,
            );
          }
          plain =
            kind === "n"
              ? decryptMoneyWithKey(v, oldDataKey)
              : decryptTextWithKey(v, oldDataKey);
        } else if (v.startsWith("enc:v1")) {
          plain =
            kind === "n"
              ? decryptMoneyWithKey(v, legacyKey)
              : decryptTextWithKey(v, legacyKey);
        } else {
          // plaintext legacy pra-migrasi
          if (kind === "n") {
            const n = parseFloat(v);
            if (!Number.isFinite(n)) {
              skipped++; // nilai non-numerik — biarkan apa adanya (mirror M-8)
              continue;
            }
            plain = n;
          } else {
            plain = v;
          }
        }
        if (plain == null || (typeof plain === "string" && plain === "")) {
          continue; // null hasil dekripsi / teks kosong — tidak ada yang di-enkripsi
        }

        // ---- enkripsi ulang dengan dataKey BARU (v2) ----
        const enc = encryptWithKey(kind, kind === "n" ? String(plain) : (plain as string), newDataKey);
        await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [enc, row.id]);
        rows++;
      }
      lastId = page.rows[page.rows.length - 1]!.id;
    }
  }

  return { tables, rows, skipped };
}

/**
 * Convenience CLI/manual: re-enkripsi satu schema dengan kata sandi baru
 * (derive kunci di sini + UPDATE baris MoneyVault — transaksi yang sama).
 * Dipakai pemulihan ops / verifikasi — bukan jalur produk (produk lewat
 * money-vault.ts dengan audit lengkap).
 */
export async function rekeySchemaWithPassword(schema: string, newPassword: string): Promise<RekeyStats> {
  const { deriveVaultKeys, computeVaultVerifier, wrapDataKey } = await import(
    "../src/rekankerja/shared/lib/vault-derive"
  );
  const c = new Client({
    connectionString:
      process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await c.connect();
  try {
    // dataKey lama + baris vault dari schema (bila ada)
    let oldDataKey: Buffer | null = null;
    let row: { id: string; dataKey: string | null } | null = null;
    const found = await c
      .query<{ id: string; dataKey: string | null }>(
        `SELECT id, "dataKey" FROM "${schema}"."MoneyVault" ORDER BY "createdAt" ASC LIMIT 1`,
      )
      .catch(() => ({ rows: [] as { id: string; dataKey: string | null }[] }));
    row = found.rows[0] ?? null;
    if (row && typeof row.dataKey === "string" && /^[0-9a-f]{64}$/i.test(row.dataKey)) {
      oldDataKey = Buffer.from(row.dataKey, "hex");
    }
    const keys = deriveVaultKeys(newPassword); // salt acak baru
    const verifier = computeVaultVerifier(keys.verifierKey);
    const wrappedKey = wrapDataKey(keys.kek, keys.dataKey);
    const dataKeyHex = keys.dataKey.toString("hex");

    await c.query("BEGIN");
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${schema}:vault-rekey`]);
    const stats = await rekeyVaultData(c, { schema, oldDataKey, newDataKey: keys.dataKey });
    if (row) {
      await c.query(
        `UPDATE "${schema}"."MoneyVault"
           SET salt = $1, verifier = $2, "wrappedKey" = $3, "dataKey" = $4, "updatedAt" = now()
           WHERE id = $5`,
        [keys.salt, verifier, wrappedKey, dataKeyHex, row.id],
      );
    } else {
      await c.query(
        `INSERT INTO "${schema}"."MoneyVault"
           (id, salt, verifier, "wrappedKey", "dataKey", "openUntil", "openByUserId", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, NULL, NULL, now(), now())`,
        [randomUUID(), keys.salt, verifier, wrappedKey, dataKeyHex],
      );
    }
    await c.query("COMMIT");
    return stats;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

// CLI guard — hanya auto-run saat dieksekusi langsung.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  const schema = process.argv[2];
  const password = process.argv[3];
  if (!schema || !password) {
    console.error("Pemakaian: bun run scripts/migrate-rekey-vault.ts <schema> <kata-sandi-baru>");
    process.exit(1);
  }
  rekeySchemaWithPassword(schema, password)
    .then((s) => {
      console.log(`DONE — ${s.tables} tabel · ${s.rows} baris di-enkripsi ulang · ${s.skipped} dilewati`);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
