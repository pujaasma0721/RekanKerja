// Verifikasi 28-c — enkripsi NIK/NPWP/nilai uang payroll sampai level database.
// Aserasi:
//   1. DB-level: nilai mentah di PostgreSQL ber-prefix enc:v1 (bukan plaintext).
//   2. Roundtrip: dekripsi via field-crypto (kunci sama dgn aplikasi) menghasilkan
//      nilai pra-migrasi (snapshot PR-2026-09-SAL-01).
//   3. Idempotensi: rerun migrasi tidak mengubah apa pun (dicek manual terpisah).
// Jalankan: bun run scripts/t28-verify-encryption.ts
import { Client } from "pg";
import { tenantCrypto, isEncrypted } from "../src/rekankerja/shared/lib/field-crypto";

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const SNAP = { totalNet: 537595241, lineNet: 63111526, bruto: 83203508, nik: "3176363464506", npwp: "091485262345", baseSalary: 54900000 };

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✓ ${name} — ${detail}`); }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`); }
}

const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
await c.connect();
await c.query(`SET search_path TO "${SCHEMA}"`);
const tc = tenantCrypto(SCHEMA);

console.log("[1] DB-level — nilai mentah terenkripsi");
const run = await c.query(`SELECT "runNo", "totalNet" FROM "PayrollRun" WHERE "runNo"='PR-2026-09-SAL-01'`);
check("PayrollRun.totalNet", isEncrypted(run.rows[0]?.totalNet), String(run.rows[0]?.totalNet).slice(0, 30) + "…");
const line = await c.query(`SELECT l.bruto, l.net FROM "PayrollRunLine" l JOIN "PayrollRun" r ON r.id = l."runId" WHERE r."runNo"='PR-2026-09-SAL-01' AND l."employeeNo"='MII00001'`);
check("PayrollRunLine.bruto", isEncrypted(line.rows[0]?.bruto), String(line.rows[0]?.bruto).slice(0, 30) + "…");
const item = await c.query(`SELECT i.amount FROM "PayrollRunItem" i JOIN "PayrollRunLine" l ON l.id = i."lineId" JOIN "PayrollRun" r ON r.id = l."runId" WHERE r."runNo"='PR-2026-09-SAL-01' AND l."employeeNo"='MII00001' LIMIT 1`);
check("PayrollRunItem.amount", isEncrypted(item.rows[0]?.amount), String(item.rows[0]?.amount).slice(0, 30) + "…");
const emp = await c.query(`SELECT "nationalId", "taxId", "bankAccount" FROM "Employee" WHERE "employeeNo"='MII00001'`);
check("Employee.nationalId (NIK)", isEncrypted(emp.rows[0]?.nationalId), String(emp.rows[0]?.nationalId).slice(0, 30) + "…");
check("Employee.taxId (NPWP)", isEncrypted(emp.rows[0]?.taxId), String(emp.rows[0]?.taxId).slice(0, 30) + "…");
check("Employee.bankAccount", isEncrypted(emp.rows[0]?.bankAccount), String(emp.rows[0]?.bankAccount).slice(0, 30) + "…");
const sal = await c.query(`SELECT a."baseSalary" FROM "EmployeeAssignment" a JOIN "Employee" e ON e.id = a."employeeId" WHERE e."employeeNo"='MII00001' AND a."validTo" IS NULL ORDER BY a."validFrom" DESC LIMIT 1`);
check("EmployeeAssignment.baseSalary", isEncrypted(sal.rows[0]?.baseSalary), String(sal.rows[0]?.baseSalary).slice(0, 30) + "…");

console.log("[2] Roundtrip — dekripsi = nilai pra-migrasi");
check("totalNet", tc.decryptMoney(run.rows[0]?.totalNet) === SNAP.totalNet, `${tc.decryptMoney(run.rows[0]?.totalNet)} = ${SNAP.totalNet}`);
check("lineNet", tc.decryptMoney(line.rows[0]?.net) === SNAP.lineNet, `${tc.decryptMoney(line.rows[0]?.net)} = ${SNAP.lineNet}`);
check("bruto", tc.decryptMoney(line.rows[0]?.bruto) === SNAP.bruto, `${tc.decryptMoney(line.rows[0]?.bruto)} = ${SNAP.bruto}`);
check("NIK", tc.decryptText(emp.rows[0]?.nationalId) === SNAP.nik, tc.decryptText(emp.rows[0]?.nationalId) ?? "");
check("NPWP", tc.decryptText(emp.rows[0]?.taxId) === SNAP.npwp, tc.decryptText(emp.rows[0]?.taxId) ?? "");
check("baseSalary", tc.decryptMoney(sal.rows[0]?.baseSalary) === SNAP.baseSalary, `${tc.decryptMoney(sal.rows[0]?.baseSalary)} = ${SNAP.baseSalary}`);
check("mask NIK", (tc.maskNik(emp.rows[0]?.nationalId) ?? "").endsWith("06") && (tc.maskNik(emp.rows[0]?.nationalId) ?? "").startsWith("31"), `mask: ${tc.maskNik(emp.rows[0]?.nationalId)}`);

// tidak ada NIK plaintext tersisa di tenant berdata
const leak = await c.query(`SELECT count(*)::int n FROM "Employee" WHERE "nationalId" IS NOT NULL AND "nationalId" NOT LIKE 'enc:v1%'`);
check("tanpa NIK plaintext tersisa", leak.rows[0].n === 0, `${leak.rows[0].n} baris`);
const leak2 = await c.query(`SELECT count(*)::int n FROM "PayrollRunLine" WHERE net NOT LIKE 'enc:v1%'`);
check("tanpa net plaintext tersisa", leak2.rows[0].n === 0, `${leak2.rows[0].n} baris`);

await c.end();
console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
