import { PrismaClient } from "../src/generated/tenant/client";
const p = new PrismaClient({ datasources: { db: { url: "postgresql://onevity:onevity_dev@localhost:5432/onevity?schema=tenant_pt_mitra_industri_internasional" } } });
const rows = await p.metricSnapshot.findMany({ where: { metric: { startsWith: "perf_" } }, orderBy: { metric: "asc" } });
console.log("perf_ snapshots:", rows.length);
for (const r of rows) console.log(`- ${r.metric} ${r.period} dims=${r.dimsJson} value=${r.value} @${r.computedAt.toISOString().slice(0, 16)}`);
await p.$disconnect();
