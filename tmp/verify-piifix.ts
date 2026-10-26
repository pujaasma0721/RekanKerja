// Verifikasi fix QA-PII-FULLACCESS:
// 1. hrd@MII (OWNER) → piiScope=full, NIK/NPWP penuh, baseSalary terlihat (legacy)
// 2. employee-detail → NIK penuh
// 3. bench101 user42 (OWNER) → NIK penuh (tenant 5000 karyawan)
// 4. Demote platform-role hrd sementara → limited → TETAP MASK → revert
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const B = "http://127.0.0.1:3000";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });

const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
const bench = await loginAs({ email: "user42@bench101.test", password: "Bench101!", preferSlug: "bench101" });

console.log("── 1. LIST /employees (hrd@MII OWNER) ──");
let res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } });
let j = await res.json() as any;
const e0 = j.employees?.[0];
const isFullNik = /^\d{16}$/.test(e0?.nationalId ?? "");
console.log(`piiScope=${j.piiScope} | nationalId=${e0?.nationalId} (${isFullNik ? "16 DIGIT PENUH ✓" : "MASIH MASK ✗"}) | taxId=${e0?.taxId} | baseSalary=${e0?.baseSalary} | bankAccount=${e0?.bankAccount} | phone=${e0?.phone}`);

console.log("\n── 2. DETAIL employee-detail ──");
const empId = e0?.id;
res = await fetch(`${B}/api/rekankerja/employee-detail?id=${empId}`, { headers: { cookie: mii.cookie } });
j = await res.json() as any;
const pers = j.personal ?? j.employee?.personal ?? j.employee ?? {};
console.log(`keys: ${Object.keys(j).slice(0,10).join(",")}`);
console.log(`personal.nationalId=${pers.nationalId} | personal.taxId=${pers.taxId} | bankAccount=${pers.bankAccount ?? j.employee?.bankAccount}`);

console.log("\n── 3. LIST bench101 (user42 OWNER, 5000 karyawan) ──");
res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: bench.cookie } });
j = await res.json() as any;
const b0 = j.employees?.[0];
console.log(`piiScope=${j.piiScope} | nationalId=${b0?.nationalId} (${/^\d{16}$/.test(b0?.nationalId ?? "") ? "16 DIGIT PENUH ✓" : "MASK ✗"}) | baseSalary=${b0?.baseSalary}`);

console.log("\n── 4. LIMITED PATH (demote sementara → harus TETAP MASK) ──");
await c.connect();
const ut = await c.query(`SELECT ut.id, ut.role FROM public."UserTenant" ut JOIN public."User" u ON u.id=ut."userId" JOIN public."Tenant" t ON t.id=ut."tenantId" WHERE u.email='hrd@mii.co.id' AND t.slug='pt-mitra-industri-internasional'`);
const row = ut.rows[0] as any;
console.log(`UserTenant hrd@MII: role=${row?.role}`);
await c.query(`UPDATE public."UserTenant" SET role='MEMBER' WHERE id='${row.id}'`);
const mii2 = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii2.cookie } });
j = await res.json() as any;
const l0 = j.employees?.[0];
console.log(`[demoted MEMBER] piiScope=${j.piiScope} | nationalId=${l0?.nationalId} | taxId=${l0?.taxId} | baseSalary=${l0?.baseSalary}`);
await c.query(`UPDATE public."UserTenant" SET role='${row.role}' WHERE id='${row.id}'`);
const back = await c.query(`SELECT role FROM public."UserTenant" WHERE id='${row.id}'`);
console.log(`revert role → ${(back.rows[0] as any).role}`);
await c.end();
