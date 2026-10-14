import { Client } from "pg";
const c = new Client({ host: "127.0.0.1", port: 5432, user: "onevity", password: "onevity_dev", database: "onevity" });
await c.connect();
const schemas = await c.query("select nspname from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema') order by 1");
console.log("SCHEMAS:", schemas.rows.map(r=>r.nspname).join(", "));
for (const s of schemas.rows.map(r=>r.nspname)) {
  const t = await c.query(`select count(*)::int n from "${s}"."PipPlan"`);
  const cyc = await c.query(`select count(*)::int n from "${s}"."PerformanceCycle"`);
  const mer = await c.query(`select count(*)::int n from "${s}"."MeritRecommendation"`);
  console.log(`${s}: PipPlan=${t.rows[0].n} Cycle=${cyc.rows[0].n} Merit=${mer.rows[0].n}`);
}
await c.end();
