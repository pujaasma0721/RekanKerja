// QA-COMPANY-EDIT — verifikasi activityLog Company via PATCH by-id
import { Client } from "pg";
async function main() {
  const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
  await c.connect();
  const tenants = await c.query(`SELECT name, "schemaName" FROM "Tenant" ORDER BY "createdAt"`);
  for (const t of tenants.rows) {
    const sch = t.schemaName;
    const logs = await c.query(
      `SELECT "action", "detail", "createdAt" FROM "${sch}"."ActivityLog"
        WHERE "entity" = 'Company' ORDER BY "createdAt" DESC LIMIT 4`
    );
    console.log(`[${t.name}]`, logs.rows.length ? JSON.stringify(logs.rows) : "(tanpa log Company)");
  }
  const comp = await c.query(
    `SELECT code, name, phone, currency FROM "tenant_pt_mitra_industri_internasional"."Company"`
  );
  console.log("MII company:", JSON.stringify(comp.rows));
  await c.end();
}
main();
