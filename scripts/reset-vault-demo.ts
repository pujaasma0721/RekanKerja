// Reset demo vault (Task 47) — kembalikan schema demo ke kondisi PRA-vault:
//   1. data enc:v2 (kunci kata sandi perusahaan) → di-decrypt dengan dataKey
//      dari baris MoneyVault lalu di-enkripsi ulang sebagai enc:v1 (kunci
//      bootstrap legacy) — data tetap terbaca tanpa vault;
//   2. hapus baris MoneyVault + MoneyViewGrant + ActivityLog vault;
//   3. RESTART server setelahnya wajib (cache dataKey in-memory harus
//      dilepas — prime ulang membaca "tidak ada baris" → jalur legacy).
// Pemakaian: bun run scripts/reset-vault-demo.ts [schema] (default: MII).
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Client } from "pg";
import { ENCRYPTED_COLUMNS } from "./lib/encrypted-columns";
import { legacyTenantKey } from "../src/rekankerja/shared/lib/field-crypto";

const DEFAULT_SCHEMA = "tenant_pt_mitra_industri_internasional";

/** Dekripsi enc:v2 dengan dataKey → plaintext. */
function decryptV2(stored: string, key: Buffer): string {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "enc" || parts[1] !== "v2") {
    throw new Error(`nilai bukan enc:v2 (${stored.slice(0, 24)}…)`);
  }
  const iv = Buffer.from(parts[3]!, "base64");
  const tag = Buffer.from(parts[4]!, "base64");
  const ct = Buffer.from(parts[5]!, "base64");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

/** Enkripsi sebagai enc:v1 (kunci bootstrap legacy) — mirror encryptWithKey. */
function encryptV1(kind: "t" | "n", plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return ["enc:v1", kind, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

async function main(schemaArg?: string): Promise<void> {
  const schema = schemaArg ?? DEFAULT_SCHEMA;
  const c = new Client({
    connectionString:
      process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schema}"`);
    const row = await c
      .query<{ dataKey: string | null }>(`SELECT "dataKey" FROM "MoneyVault" ORDER BY "createdAt" ASC LIMIT 1`)
      .catch(() => ({ rows: [] as { dataKey: string | null }[] }));
    const hex = row.rows[0]?.dataKey;
    if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
      console.log(`[${schema}] tidak ada baris vault dengan dataKey — tidak ada yang di-reset.`);
      return;
    }
    const dataKey = Buffer.from(hex, "hex");
    const legacyKey = legacyTenantKey(schema);

    let converted = 0;
    for (const [table, col, kind] of ENCRYPTED_COLUMNS) {
      const exists = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, table, col],
      );
      if (exists.rowCount === 0) continue;
      const rows = await c.query<{ id: string; v: string }>(
        `SELECT id, "${col}" AS v FROM "${table}" WHERE "${col}" LIKE 'enc:v2%' ORDER BY id`,
      );
      for (const r of rows.rows) {
        const plain = decryptV2(String(r.v), dataKey);
        const enc = encryptV1(kind, plain, legacyKey);
        await c.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [enc, r.id]);
        converted++;
      }
    }

    const delVault = await c.query(`DELETE FROM "MoneyVault"`);
    const delGrant = await c.query(`DELETE FROM "MoneyViewGrant"`);
    const delLog = await c.query(`DELETE FROM "ActivityLog" WHERE entity IN ('MoneyVault','MoneyViewGrant')`);

    console.log(
      `[${schema}] RESET selesai — ${converted} nilai v2 → v1 legacy · ` +
        `${delVault.rowCount} baris vault · ${delGrant.rowCount} grant · ${delLog.rowCount} log audit dihapus`,
    );
    console.log("PENTING: restart server sekarang (cache dataKey in-memory harus dilepas).");
  } finally {
    await c.end();
  }
}

// CLI guard + dukungan impor in-process (schemas arg diabaikan — skrip per-schema).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main(process.argv[2]).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
export { main };
