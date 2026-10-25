// Bukti jalur FULL: (1) ESS self-scope (profil sendiri = full by design)
// (2) superadmin dgn company switcher non-aktif sementara (lalu revert)
import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();
const comp = await c.query(`SELECT id, name, active FROM tenant_pt_mitra_industri_internasional."Company"`);
console.log("Company MII:", JSON.stringify(comp.rows));
const ess = await c.query(`SELECT a.email, e."fullName" FROM tenant_pt_mitra_industri_internasional."AppUser" a JOIN tenant_pt_mitra_industri_internasional."Employee" e ON e."appUserId" = a.id WHERE a.role = 'ESS' OR a.role = 'EMPLOYEE' OR a.role = 'SELF' LIMIT 3`).catch(()=>({rows:[]}));
console.log("AppUser ESS-terhubung:", JSON.stringify(ess.rows));
await c.end();
