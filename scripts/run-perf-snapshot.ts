// P8-PERF — bootstrap snapshot metrik kinerja (MetricSnapshot) utk SEMUA tenant.
// Idempoten: snapshotMetrics meng-upsert periode YYYY-MM berjalan (re-run =
// overwrite). Dipakai utk pengisian awal / debug tanpa menunggu job scheduler
// harian perf-metrics-snapshot (pola scripts/migrate-recruitment-f8.ts §F8).
//
// Metrik (perf-analytics-service):
//   perf_completion       — % peserta ber-status final (global + per siklus)
//   rating_distribution   — jumlah peserta per rating 1–5 (global + per siklus)
//   pip_recovery_rate     — % Recovered dari PIP berakhir (global)
//
// Jalankan: bun run scripts/run-perf-snapshot.ts
import "./lib/env";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { snapshotMetrics, PERF_METRICS } from "@/rekankerja/performance/services/perf-analytics-service";

async function main() {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true, name: true } });
  const schemas = tenants
    .map((t) => ({ schemaName: t.schemaName, name: t.name }))
    .filter((t): t is { schemaName: string; name: string } => !!t.schemaName)
    .sort((a, b) => a.schemaName.localeCompare(b.schemaName));

  console.log(`Snapshot metrik kinerja P8 (${PERF_METRICS.join(", ")}) — ${schemas.length} tenant:`);
  let total = 0;
  for (const t of schemas) {
    const db = getTenantClient(t.schemaName);
    const n = await snapshotMetrics(db).catch((e: unknown) => {
      console.warn(`  [${t.schemaName}] skip (tabel belum termigrasi?): ${e instanceof Error ? e.message : e}`);
      return 0;
    });
    total += n;
    console.log(`  [${t.schemaName}] ${t.name}: ${n} baris snapshot ditulis`);
  }
  console.log(`\nDONE — ${total} baris MetricSnapshot (idempoten — re-run menimpa periode berjalan).`);
}

// CLI guard — hanya auto-run saat dieksekusi langsung.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
