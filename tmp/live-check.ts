import { Client } from "pg";
import { loginAs } from "../scripts/qa/helpers";
const c = new Client({ connectionString: "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
await c.connect();
// vault state pasca user set password
for (const s of ["tenant_pt_mitra_industri_internasional", "tenant_bench_101"]) {
  const v = await c.query(`SELECT count(*)::int withkey FROM ${s}."MoneyVault" WHERE "dataKey" IS NOT NULL`).catch(()=>({rows:[{withkey:-1}]}));
  const e = await c.query(`SELECT count(*) FILTER (WHERE "nationalId" LIKE 'enc:v2%')::int v2, count(*) FILTER (WHERE "nationalId" LIKE 'enc:v1%')::int v1 FROM ${s}."Employee" WHERE "nationalId" IS NOT NULL`);
  console.log(`${s}: MoneyVault dataKey=${(v.rows[0] as any).withkey} | NIK enc:v1=${(e.rows[0] as any).v1} enc:v2=${(e.rows[0] as any).v2}`);
}
await c.end();
const B = "http://127.0.0.1:3000";
const mii = await loginAs({ email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" });
const res = await fetch(`${B}/api/rekankerja/employees?limit=1`, { headers: { cookie: mii.cookie } });
const j = await res.json() as any;
console.log(`\n[hrd@MII OWNER] piiScope=${j.piiScope} | nationalId=${j.employees[0]?.nationalId} | taxId=${j.employees[0]?.taxId} | baseSalary=${j.employees[0]?.baseSalary}`);
