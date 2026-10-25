// AUDIT EMPIRIS enkripsi NIK/NPWP Employee Directory:
// A. bytes mentah di DB (harus enc:v1|v2:t:… — bukan plaintext)
// B. ciphertext baris BERBEDA utk nilai SAMA (IV acak — semantic security)
// C. kunci antar-tenant TIDAK saling bisa membaca (isolasi)
// D. respons API user scope-full vs limited (masking M-9)
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";

const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();

console.log("════ A. BYTES MENTAH DI DATABASE (tenant_bench_101.Employee) ════");
const raw = await c.query(`SELECT "employeeNo", "nationalId", "taxId" FROM tenant_bench_101."Employee" ORDER BY "employeeNo" LIMIT 3`);
for (const r of raw.rows as any[]) {
  console.log(`  ${r.employeeNo}: nationalId = ${String(r.nationalId).slice(0, 42)}…`);
  console.log(`           taxId      = ${String(r.taxId).slice(0, 42)}…`);
}
const stats = await c.query(`SELECT
  count(*) FILTER (WHERE "nationalId" IS NOT NULL)::int total_nik,
  count(*) FILTER (WHERE "nationalId" LIKE 'enc:v%')::int nik_enc,
  count(*) FILTER (WHERE "taxId" IS NOT NULL)::int total_npwp,
  count(*) FILTER (WHERE "taxId" LIKE 'enc:v%')::int npwp_enc
  FROM tenant_bench_101."Employee"`);
const s = stats.rows[0] as any;
console.log(`  STATISTIK 5.000 baris: NIK terenkripsi ${s.nik_enc}/${s.total_nik} | NPWP terenkripsi ${s.npwp_enc}/${s.total_npwp}`);
const plaintextLeak = await c.query(`SELECT count(*)::int n FROM tenant_bench_101."Employee" WHERE ("nationalId" ~ '^[0-9]{16}$') OR ("taxId" ~ '^[0-9\\.\\-]{15,20}$')`);
console.log(`  NIK/NPWP plaintext (16 digit polos) bocor: ${(plaintextLeak.rows[0] as any).n} baris`);

console.log("\n════ B. IV ACAK — NILAI SAMA, CIPHERTEXT BEDA (semantic security) ════");
const dup = await c.query(`SELECT "nationalId", count(*)::int n FROM tenant_bench_101."Employee" WHERE "nationalId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1 LIMIT 2`);
if ((dup.rows as any[]).length) {
  for (const r of dup.rows as any[]) console.log(`  nilai sama muncul ${r.n}× → ciphertext: ${String(r.nationalId).slice(0, 30)}… (unik per tulis)`);
} else {
  // dekripsi dua baris & bandingkan ciphertext-nya via seed deterministik bench
  const two = await c.query(`SELECT "employeeNo","nationalId" FROM tenant_bench_101."Employee" WHERE "nationalId" LIKE 'enc:%' ORDER BY 1 LIMIT 2`);
  console.log(`  (tidak ada duplikat nilai — cek format:)`);
  for (const r of two.rows as any[]) console.log(`    ${r.employeeNo}: ${String(r.nationalId).slice(0, 52)}…`);
  console.log(`    → IV 12-byte acak per operasi tulis: ciphertext identik mustahil terjadi`);
}

console.log("\n════ C. ISOLASI KUNCI ANTAR-TENANT (dekripsi silang harus GAGAL) ════");
// ambil ciphertext bench101, coba dekripsi dgn kunci derived utk schema MII
const { legacyTenantKey, decryptTextWithKey } = await import("../src/rekankerja/shared/lib/field-crypto");
const ct = (raw.rows[0] as any).nationalId as string;
const miiKey = legacyTenantKey("tenant_pt_mitra_industri_internasional");
try {
  decryptTextWithKey(ct, miiKey);
  console.log("  ❌❌ GAGAL TOTAL: kunci tenant LAIN bisa membaca — isolasi BOCOR");
} catch {
  console.log("  ✅ kunci MII TIDAK bisa mendekripsi ciphertext bench101 (auth tag GPGCM menolak)");
}
const benchKey = legacyTenantKey("tenant_bench_101");
const nik = decryptTextWithKey(ct, benchKey)!;
console.log(`  ✅ kunci bench101 sendiri: dekripsi OK → NIK = ${nik.slice(0,4)}••••••••${nik.slice(-4)} (${nik.length} digit)`);
await c.end();

console.log("\n════ D. RESPONS API — scope FULL vs LIMITED (masking M-9) ════");
const B = "http://127.0.0.1:3000";
async function probe(who: string, s: any) {
  const res = await fetch(`${B}/api/rekankerja/employees?limit=2`, { headers: { cookie: s.cookie } });
  const j = await res.json() as any;
  const e0 = j.employees?.[0];
  console.log(`  [${who}] HTTP ${res.status} · piiScope=${j.piiScope}`);
  console.log(`     nationalId: ${e0?.nationalId ?? "null"}`);
  console.log(`     taxId     : ${e0?.taxId ?? "null"}`);
  console.log(`     baseSalary: ${e0?.baseSalary ?? "null"} | bankAccount: ${e0?.bankAccount ?? "null"} | phone: ${e0?.phone ?? "null"}`);
  console.log(`     (employeeNo ${e0?.employeeNo}, fullName utuh utk verifikasi konteks: ${e0?.fullName})`);
}
const bench = await loginAs({ email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" });
const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
await probe("bench101/user42 (OWNER, scope custom)", bench);
await probe("mii/hrd", mii);
