// Diagnostik timeline vault MII — kapan setup/ganti sandi, dan log aktivitas terakhir.
import { Client } from "pg";

const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL });
await c.connect();
const { rows } = await c.query(
  `SELECT "createdAt", "updatedAt", "openUntil", LEFT("dataKey", 16) AS dk_prefix FROM "tenant_pt_mitra_industri_internasional"."MoneyVault"`,
);
console.log("MoneyVault:", JSON.stringify(rows, null, 2));

const { rows: log } = await c.query(
  `SELECT "createdAt", action, entity, LEFT(detail, 90) AS detail
   FROM "tenant_pt_mitra_industri_internasional"."ActivityLog"
   WHERE "createdAt" > now() - interval '48 hours'
   ORDER BY "createdAt" DESC LIMIT 15`,
);
console.log("ActivityLog 48 jam terakhir:");
for (const l of log) console.log(` ${l.createdAt.toISOString()} ${l.action} ${l.entity} — ${l.detail}`);
await c.end();
