import { Client } from "pg";
const c = new Client({ host: "127.0.0.1", port: 5432, user: "onevity", password: "onevity_dev", database: "postgres" });
await c.connect();
const dbs = await c.query("select datname from pg_database where datistemplate=false order by 1");
console.log("DATABASES:", dbs.rows.map(r=>r.datname).join(", "));
await c.end();
for (const db of dbs.rows.map(r=>r.datname)) {
  const c2 = new Client({ host: "127.0.0.1", port: 5432, user: "onevity", password: "onevity_dev", database: db });
  await c2.connect();
  const sch = await c2.query("select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema') order by 1");
  console.log(`${db} schemas: ${sch.rows.map(r=>r.nspname).join(", ") || "(none)"}`);
  await c2.end();
}
