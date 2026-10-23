import { Client } from "pg";
const c = new Client({ connectionString: process.env.TENANT_DB_URL! });
await c.connect();
for (const k of ["shared_buffers", "work_mem", "effective_cache_size", "max_connections", "maintenance_work_mem"]) {
  const r = await c.query(`SHOW ${k}`);
  console.log(`${k} = ${r.rows[0][k]}`);
}
await c.end();
