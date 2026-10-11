import pg from "pg";
const c = new pg.Client({ host: "localhost", port: 5432, user: "onevity", password: "onevity_dev", database: "onevity" });
await c.connect();
const dbs = (await c.query("SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','onevity') ORDER BY 1")).rows.map(r => r.datname);
console.log("DBS:", dbs.join(","));
for (const db of dbs) {
  if (!db.includes("mii")) continue;
  await c.end();
  const c2 = new pg.Client({ host: "localhost", port: 5432, user: "onevity", password: "onevity_dev", database: db });
  await c2.connect();
  const jo = await c2.query("SELECT \"refNo\", status, \"closedAt\" FROM \"JobOpportunity\" WHERE \"refNo\" IN ('JO-2026-0001','JO-2026-0002') ORDER BY \"refNo\"");
  console.log(db, JSON.stringify(jo.rows));
  const logs = await c2.query("SELECT \"createdAt\", action, entity, \"entityId\", detail FROM \"ActivityLog\" WHERE \"entity\"='JobOpportunity' ORDER BY \"createdAt\" DESC LIMIT 6");
  for (const l of logs.rows) console.log(" -", l.createdAt.toISOString(), l.action, l.entityId, (l.detail||"").slice(0,90));
  await c2.end();
  break;
}
