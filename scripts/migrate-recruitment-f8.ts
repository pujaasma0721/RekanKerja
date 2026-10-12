// Migrasi F8-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F8 — Analytics
// & Prediktif) ke tenant existing — idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×2 (MetricSnapshot, SavedReportView)
//      + unique/index/FK — selaras schema & tenant-ddl.sql.
//   2. Snapshot awal: hitung metrik inti sekali (job snapshotMetrics) utk
//      periode berjalan supaya dashboard historis langsung berisi.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dimsJson" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "SavedReportView" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "schedule" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedReportView_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "MetricSnapshot_metric_period_dimsJson_key" ON "MetricSnapshot"("metric", "period", "dimsJson")`,
  `CREATE INDEX IF NOT EXISTS "MetricSnapshot_metric_period_idx" ON "MetricSnapshot"("metric", "period")`,
  `CREATE INDEX IF NOT EXISTS "SavedReportView_ownerId_idx" ON "SavedReportView"("ownerId")`,
  `ALTER TABLE "SavedReportView" DROP CONSTRAINT IF EXISTS "SavedReportView_ownerId_fkey"`,
  `ALTER TABLE "SavedReportView" ADD CONSTRAINT "SavedReportView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f8] schema: ${list.join(", ")}`);
  // snapshot awal dijalankan SETELAH DDL semua schema (butuh service analitik —
  // dibuat task F8-backend; bila belum ada, dilewati aman)
  const analytics = await import("@/rekankerja/recruitment/services/analytics-service").catch(() => null);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    try {
      await c.connect();
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        // Race-safe: ADD CONSTRAINT paralel dua penulis → 42710 (idempoten)
        try {
          await c.query(ddl);
        } catch (e) {
          const pgCode = (e as { code?: string }).code;
          if (pgCode !== "42710" && !/already exists/.test(String(e))) throw e;
        }
      }
      console.log(`    2 tabel F8 siap (MetricSnapshot, SavedReportView)`);
    } finally {
      await c.end();
    }
    if (analytics) {
      const { getTenantClient } = await import("@/rekankerja/shared/lib/tenant-db");
      const db = getTenantClient(schemaName);
      const n = await analytics.snapshotMetrics(db).catch((e: unknown) => {
        console.warn(`    snapshot gagal (non-fatal): ${e instanceof Error ? e.message : e}`);
        return 0;
      });
      if (n > 0) console.log(`    snapshot awal: ${n} metrik periode berjalan`);
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
