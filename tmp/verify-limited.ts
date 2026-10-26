// Tes LIMITED path proper: non-superadmin + menu hr:directory CUSTOM + company aktif
// → piiScope harus "limited" + NIK/NPWP mask. Semua perubahan di-revert di akhir.
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const B = "http://127.0.0.1:3000";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();

const ut = await c.query(`SELECT ut.id, ut.role FROM public."UserTenant" ut JOIN public."User" u ON u.id=ut."userId" JOIN public."Tenant" t ON t.id=ut."tenantId" WHERE u.email='hrd@mii.co.id' AND t.slug='pt-mitra-industri-internasional'`);
const utRow = ut.rows[0] as any;
const au = await c.query(`SELECT id, role FROM tenant_pt_mitra_industri_internasional."AppUser" WHERE email='hrd@mii.co.id'`);
const auRow = au.rows[0] as any;
console.log(`state awal: UserTenant.role=${utRow.role} | AppUser.role=${auRow.role}`);

// demote keduanya + menu CUSTOM dgn hr:directory view saja
await c.query(`UPDATE public."UserTenant" SET role='MEMBER' WHERE id='${utRow.id}'`);
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='HR' WHERE id='${auRow.id}'`);
const menus = JSON.stringify({ "hr:directory": { view: true, create: false, update: false, delete: false, ops: {} } });
await c.query(`DELETE FROM tenant_pt_mitra_industri_internasional."UserMenuAccess" WHERE "appUserId"='${auRow.id}'`);
await c.query(`INSERT INTO tenant_pt_mitra_industri_internasional."UserMenuAccess" (id, "appUserId", mode, "menusJson", "createdAt", "updatedAt") VALUES ('tmp-qa-limited', '${auRow.id}', 'CUSTOM', '${menus}', now(), now())`);

const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
const res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } });
const j = await res.json() as any;
const e0 = j.employees?.[0];
console.log(`[demoted HR+menu] HTTP ${res.status} | piiScope=${j.piiScope} | nationalId=${e0?.nationalId} | taxId=${e0?.taxId} | baseSalary=${e0?.baseSalary} | phone=${e0?.phone}`);

// REVERT SEMUA
await c.query(`DELETE FROM tenant_pt_mitra_industri_internasional."UserMenuAccess" WHERE id='tmp-qa-limited'`);
await c.query(`UPDATE public."UserTenant" SET role='${utRow.role}' WHERE id='${utRow.id}'`);
await c.query(`UPDATE tenant_pt_mitra_industri_internasional."AppUser" SET role='${auRow.role}' WHERE id='${auRow.id}'`);
const chk = await c.query(`SELECT (SELECT role FROM public."UserTenant" WHERE id='${utRow.id}') utrole, (SELECT role FROM tenant_pt_mitra_industri_internasional."AppUser" WHERE id='${auRow.id}') aurole, (SELECT count(*)::int FROM tenant_pt_mitra_industri_internasional."UserMenuAccess" WHERE id='tmp-qa-limited') leftover`);
console.log("revert:", JSON.stringify(chk.rows[0]));
await c.end();
