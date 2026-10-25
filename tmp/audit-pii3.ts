// Bukti jalur scope FULL: naikkan role hrd@MII → Admin (superadmin) via SQL,
// probe API (harus NIK/NPWP terdekripsi penuh), lalu KEMBALIKAN role.
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();
const up = await c.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='Admin' WHERE email='hrd@mii.co.id' RETURNING role`);
console.log("role sementara →", (up.rows[0] as any).role);
await c.end();

const B = "http://127.0.0.1:3000";
const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
const res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } });
const j = await res.json() as any;
const e0 = j.employees?.[0];
console.log(`[scope=${j.piiScope}] HTTP ${res.status}`);
console.log(`  nationalId: ${e0?.nationalId}`);
console.log(`  taxId     : ${e0?.taxId}`);
console.log(`  baseSalary: ${e0?.baseSalary} | bankAccount: ${e0?.bankAccount} | phone: ${e0?.phone}`);

// kembalikan role OWNER
const c2 = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c2.connect();
const down = await c2.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='OWNER' WHERE email='hrd@mii.co.id' RETURNING role`);
console.log("role dikembalikan →", (down.rows[0] as any).role);
await c2.end();
