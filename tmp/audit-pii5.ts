// Jalur (2): superadmin murni — nonaktifkan Company MII sesaat, probe, revert.
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const B = "http://127.0.0.1:3000";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."Company" SET active=false`);
console.log("Company MII → active=false (sementara)");

// naikkan hrd ke Admin (superadmin) — dua jalur superadmin aktif bersamaan
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='Admin' WHERE email='hrd@mii.co.id'`);

const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
const res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } });
const j = await res.json() as any;
const e0 = j.employees?.[0];
console.log(`[scope=${j.piiScope}] HTTP ${res.status}`);
console.log(`  nationalId: ${e0?.nationalId}  ← full path (harus 16 digit penuh)`);
console.log(`  taxId     : ${e0?.taxId}`);
console.log(`  baseSalary: ${e0?.baseSalary} | bankAccount: ${e0?.bankAccount} | phone: ${e0?.phone}`);

// REVERT SEMUA
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."Company" SET active=true`);
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='OWNER' WHERE email='hrd@mii.co.id'`);
const chk = await c.query(`SELECT (SELECT count(*) FILTER (WHERE active)::int act FROM tenant_pt_mitra_industri_internasional."Company"), (SELECT role FROM tenant_pt_mitra_industri_internasional."AppUser" WHERE email='hrd@mii.co.id') role`);
console.log("REVERT:", JSON.stringify(chk.rows[0]));
await c.end();
