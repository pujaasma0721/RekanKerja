// Migrasi KPI-METRIC (rombakan — permintaan user: "Metric / Measure of Success
// diisi ketika membuat KPI pertama kali, KPI tidak selalu berbicara angka") —
// SEMUA idempoten (pola migrate-recruitment-b8-referral):
//   1. Kolom baru — AppraisalKpi.description (definisi KPI snapshot) +
//      AppraisalKpi.measureMode ("Numeric"|"Descriptor") + metricLevelsJson
//      (deskriptor terstruktur level 1–5 = Metric / Measure of Success) +
//      KpiDefinition.measureMode + metricLevelsJson (default pustaka).
//   2. DROP metricText (kolom iterasi-1 sesi ini — belum rilis, hanya data uji;
//      diganti model terstruktur metricLevelsJson).
//   3. Seed pustaka contoh: KPI "INNOVATION" (LNG-INNOVATION) mode Descriptor
//      dengan Metric / Measure of Success persis contoh user — dilewati bila
//      kode sudah ada (idempoten; HR bebas mengubah/hapus lewat Master Kinerja).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping modul)
// ATAU dijalankan CLI:
//   bun run scripts/migrate-kpi-metric.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- KPI-METRIC — Metric / Measure of Success terstruktur (idempoten; paritas tenant-ddl.sql) ---
  `ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "measureMode" TEXT NOT NULL DEFAULT 'Numeric'`,
  `ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "metricLevelsJson" TEXT`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "description" TEXT`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "measureMode" TEXT NOT NULL DEFAULT 'Numeric'`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "metricLevelsJson" TEXT`,
  // iterasi-1 sesi ini (belum rilis — hanya data uji) → model terstruktur pengganti
  `ALTER TABLE "KpiDefinition" DROP COLUMN IF EXISTS "metricText"`,
  `ALTER TABLE "AppraisalKpi" DROP COLUMN IF EXISTS "metricText"`,
];

/** Seed contoh pustaka — Metric / Measure of Success persis contoh user (INNOVATION). */
const INNOVATION_LEVELS = [
  { level: 1, descriptor: "Tidak submit / submit ulang usulan; Inovasi adalah inovasi yang sama persis dengan inovasi tahun sebelumnya." },
  { level: 2, descriptor: "Usulan inovasi telah disetujui oleh atasan dan Division Manager/Direktur, kurang berkualitas dan kurang berdampak terhadap perubahan/perbaikan." },
  { level: 3, descriptor: "Usulan inovasi telah disetujui oleh atasan dan Division Manager/Direktur, berkualitas baik dan memiliki dampak terhadap perubahan/perbaikan." },
  { level: 4, descriptor: "Inovasi telah dijalankan dan diimplementasi dalam lingkup departemen." },
  { level: 5, descriptor: "Inovasi telah dijalankan dan diimplementasi dalam lingkup yang lebih luas, dan terukur dan hasilnya tepat guna bagi divisi atau perusahaan." },
];

async function seedInnovation(c: Client): Promise<"seeded" | "exists"> {
  const found = await c.query<{ id: string }>(`SELECT "id" FROM "KpiDefinition" WHERE "code" = 'LNG-INNOVATION' LIMIT 1`);
  if (found.rows.length > 0) return "exists";
  await c.query(
    `INSERT INTO "KpiDefinition" ("id","code","name","category","polarity","unit","dataSource","description","measureMode","metricLevelsJson","active","versionNo","effectiveYear","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, 'LNG-INNOVATION', 'INNOVATION', 'LearningGrowth', 'Higher', 'level', 'Manual',
       'Suatu usulan terkait perbaikan atau pengembangan, atau suatu hal baru yang memiliki value added secara kreatif dalam semua aspek.',
       'Descriptor', $1::jsonb::text, true, 1, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [JSON.stringify(INNOVATION_LEVELS)],
  );
  return "seeded";
}

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-kpi-metric] schema: ${list.join(", ")}`);
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
      for (const [table, col] of [
        ["KpiDefinition", "measureMode"], ["KpiDefinition", "metricLevelsJson"],
        ["AppraisalKpi", "description"], ["AppraisalKpi", "measureMode"], ["AppraisalKpi", "metricLevelsJson"],
      ] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schemaName, table, col],
        );
        console.log(`    kolom ${table}.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
      const dropped = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'AppraisalKpi' AND column_name = 'metricText'`,
        [schemaName],
      );
      console.log(`    kolom AppraisalKpi.metricText (lama): ${dropped.rows[0]?.n ? "MASIH ADA" : "ter-drop"}`);
      const seeded = await seedInnovation(c);
      console.log(`    seed KPI INNOVATION (Descriptor, metric 5 level): ${seeded}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
