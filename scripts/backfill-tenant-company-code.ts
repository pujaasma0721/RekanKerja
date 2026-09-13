// Backfill satu-kali: isi Tenant.companyCode (registry platform) dari
// Company.code di schema tenant masing-masing. Tenant lama dibuat sebelum
// kolom companyCode ada di form registrasi. Jalankan: bun scripts/backfill-tenant-company-code.ts
import { Client } from "pg";

const PLATFORM_URL = process.env.PLATFORM_DB_URL;
const BASE_URL = process.env.TENANT_DB_BASE_URL;
if (!PLATFORM_URL || !BASE_URL) throw new Error("PLATFORM_DB_URL / TENANT_DB_BASE_URL wajib di .env");

const sanitize = (raw: string) => String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

const platform = new Client({ connectionString: PLATFORM_URL });
await platform.connect();
const { rows: tenants } = await platform.query('SELECT id, name, "schemaName", "companyCode" FROM "Tenant" ORDER BY "createdAt"');
for (const t of tenants) {
  const schemaName: string = t.schemaName;
  if (t.companyCode) {
    console.log(`= ${schemaName}: sudah ${t.companyCode} — dilewati`);
    continue;
  }
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  const { rows } = await c.query(`SELECT code FROM "${schemaName}"."Company" LIMIT 1`);
  await c.end();
  const code = rows[0]?.code ? sanitize(rows[0].code) : null;
  if (code) {
    await platform.query('UPDATE "Tenant" SET "companyCode" = $1 WHERE id = $2', [code, t.id]);
    console.log(`+ ${schemaName} (${t.name}): companyCode = ${code}`);
  } else {
    console.log(`- ${schemaName} (${t.name}): tanpa Company.code — tetap null`);
  }
}
await platform.end();
console.log("selesai.");
