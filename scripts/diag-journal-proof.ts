// Bukti split jurnal settle 60/40 dari DB (read-only):
//   TENANT_DB_BASE_URL=... bun scripts/diag-journal-proof.ts JV-2026-0011
import { Client } from "pg";
import { createHash, createHmac, createDecipheriv } from "node:crypto";

const MII = "tenant_pt_mitra_industri_internasional";
const JN = process.argv[2] ?? "JV-2026-0011";
const c = new Client({
  connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
});
await c.connect();

const master = createHash("sha256").update("onevity-dev-fallback:postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity").digest();
const key = createHmac("sha256", master).update(`field-crypto:${MII}`).digest();
const dec = (v: string | null): number | null => {
  if (!v) return null;
  if (!v.startsWith("enc:v1:n:")) return Number(v) || null;
  const [, , , iv, tag, ct] = v.split(":");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Number(Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString());
  } catch {
    return null;
  }
};

const r = await c.query(
  `select l.position, l."accountCode", l."accountName", l."amount", l.memo
   from "${MII}"."PayrollJournal" j join "${MII}"."PayrollJournalLine" l on l."journalId" = j.id
   where j."journalNo" = $1 order by l.sequence`,
  [JN],
);
console.log(`== ${JN} ==`);
let dBe = 0, dPi = 0, cKas = 0;
for (const x of r.rows) {
  const amt = dec(x.amount) ?? 0;
  console.log(`  ${x.position} ${x.accountCode} ${x.accountName}: Rp ${amt.toLocaleString("id-ID")}`);
  if (x.position === "Debit" && x.accountCode === "5106") dBe += amt;
  if (x.position === "Debit" && x.accountCode === "1301") dPi += amt;
  if (x.position === "Credit" && x.accountCode === "1101") cKas += amt;
}
console.log(`\nBeban 5106=${dBe} (target 120000) | Piutang 1301=${dPi} (target 80000) | Kas 1101=${cKas} (target 200000)`);
console.log(dBe === 120000 && dPi === 80000 && cKas === 200000 ? "SPLIT 60/40 BENAR ✔" : "SPLIT TIDAK SESUAI ✗");
await c.end();
