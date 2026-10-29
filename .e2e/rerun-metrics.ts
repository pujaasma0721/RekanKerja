import { getTenantClient } from "../src/rekankerja/shared/lib/tenant-db";
import { snapshotPerfMetrics } from "../src/rekankerja/performance/services/perf-metrics";
const db = getTenantClient("tenant_pt_mitra_industri_internasional");
const n = await snapshotPerfMetrics(db);
const rows = await db.metricSnapshot.findMany({ where: { metric: { startsWith: "perf_" } } });
console.log(`re-run wrote=${n}; total rows=${rows.length}`);
await db.$disconnect();
