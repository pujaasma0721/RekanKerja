// VERIFIKASI Task 58 — self-healing unwrapDeep di field-crypto.
// Repro double-encryption historis (via encryptWithKey — melewati guard
// idempoten write T55, mensimulasikan data lama yang terenkripsi 2-3 lapis),
// lalu pastikan SEMUA jalur baca mengembalikan plaintext:
//   decryptText / decryptMoney / decryptJson / maskNpwp.
// Read-only terhadap DB (hanya prime dataKey vault MII). Run:
//   bun scripts/test-unwrap-selfhealing.ts
import "./lib/env";
import { Client } from "pg";
import {
  tenantCrypto, primeTenantCrypto, encryptWithKey,
} from "../src/onevity/shared/lib/field-crypto";

const SCHEMA = "tenant_pt_mitra_industri_internasional";

// muat dataKey vault MII ke cache proses ini (seperti request path)
const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL! });
await c.connect();
const r = await c.query<{ dataKey: string | null }>(
  `SELECT "dataKey" FROM "${SCHEMA}"."MoneyVault" LIMIT 1`,
);
await c.end();
if (r.rows[0]?.dataKey) {
  // set manual — primeTenantCrypto menandai primed; di sini cukup set langsung
  const { setVaultDataKey } = await import("../src/onevity/shared/lib/field-crypto");
  setVaultDataKey(SCHEMA, Buffer.from(r.rows[0].dataKey, "hex"));
  console.log("dataKey vault MII termuat (enc:v2 aktif)");
} else {
  await primeTenantCrypto(SCHEMA);
  console.log("tanpa vault — jalur v1");
}

const tc = tenantCrypto(SCHEMA);
const key = Buffer.from(r.rows[0]!.dataKey!, "hex");

let pass = 0;
let fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗ GAGAL"} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// ==== repro double/triple encryption (bypass guard write — data historis) ====
const PLAIN = "091485262345"; // NPWP demo
const two = encryptWithKey("t", encryptWithKey("t", PLAIN, key), key);
const three = encryptWithKey("t", two, key);
const moneyTwo = encryptWithKey("n", encryptWithKey("n", "7500000", key), key);

console.log("\n— decryptText (PII: NPWP/rekening) —");
check("2 lapis → plaintext", tc.decryptText(two), PLAIN);
check("3 lapis → plaintext", tc.decryptText(three), PLAIN);
check("1 lapis → plaintext (regresi)", tc.decryptText(encryptWithKey("t", PLAIN, key)), PLAIN);
check("legacy plaintext pass-through (regresi)", tc.decryptText(PLAIN), PLAIN);

console.log("\n— decryptMoney (uang) —");
check("2 lapis → angka asli", tc.decryptMoney(moneyTwo), 7500000);
check("1 lapis (regresi)", tc.decryptMoney(encryptWithKey("n", "7500000", key)), 7500000);

console.log("\n— decryptJson (walker serializer) —");
const payload = { profile: { npwp: two, bankAccount: three, gaji: moneyTwo } };
const out = tc.decryptJson(payload) as unknown as { profile: { npwp: string; bankAccount: string; gaji: number } };
check("walker npwp 2 lapis", out.profile.npwp, PLAIN);
check("walker bankAccount 3 lapis", out.profile.bankAccount, PLAIN);
check("walker uang 2 lapis", out.profile.gaji, 7500000);

console.log("\n— maskNpwp (jalanur masking) —");
const masked = tc.maskNpwp(two);
check("mask dari nilai 2 lapis (4 digit akhir)", masked, "••••••••2345");

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
