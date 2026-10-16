// Migrasi KPI-METRIC (permintaan user: "pada saat pengisian KPI, seharusnya ada
// text field untuk mengisi Metric / Measure of Success") — SEMUA idempoten
// (pola migrate-recruitment-b8-referral):
//   1. ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "metricText" TEXT
//      — default rubrik Metric / Measure of Success pada pustaka KPI (umumnya
//      deskriptor peringkat 1–5; perubahan MINOR setara description §18.9 —
//      snapshot baris penilaian tetap melindungi riwayat).
//   2. ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "metricText" TEXT
//      — SNAPSHOT rubrik per baris penilaian: diisi atasan saat penetapan
//      target (default dari pustaka saat kpiDefId ada), bebas diedit per baris,
//      ikut disalin §18.2, terlihat karyawan di Target Saya & saat penilaian.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping modul)
// ATAU dijalankan CLI:
//   bun run scripts/migrate-kpi-metric-text.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- KPI-METRIC — Metric / Measure of Success (idempoten; paritas tenant-ddl.sql) ---
  `ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "metricText" TEXT`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "metricText" TEXT`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-kpi-metric-text] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      await c.query(`SET search_path TO "${schemaName}"`);
      for (const ddl of DDL) {
        try {
          await c.query(ddl);
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? "");
          // 42710 = duplicate object (kolom sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      for (const [table, col] of [["KpiDefinition", "metricText"], ["AppraisalKpi", "metricText"]] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schemaName, table, col],
        );
        console.log(`    kolom ${table}.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
