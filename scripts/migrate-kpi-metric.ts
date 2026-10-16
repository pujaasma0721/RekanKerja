// Migrasi KPI-METRIC v2 (iterasi user: "field Metric / Measure of Success itu
// hanya berupa TEXTAREA, bukan dipecah-pecah") — SEMUA idempoten:
//   1. Kolom baru "metric" TEXT (satu teks bebas) di KpiDefinition + AppraisalKpi.
//   2. Konversi data lama: metricLevelsJson ([{level,descriptor}]) → metric
//      (teks berbaris "1: …\n2: … …\n5: …"); metricText iterasi-1 (bila ada) → metric.
//   3. DROP kolom lama: metricLevelsJson + metricText (keduanya pra-rilis,
//      hanya data uji — bukan data produksi).
//   4. Seed pustaka contoh: KPI "INNOVATION" (LNG-INNOVATION) mode Descriptor
//      dengan Metric / Measure of Success persis contoh user (satu teks) —
//      dilewati bila kode sudah ada (idempoten).
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
  // --- KPI-METRIC v2 — satu kolom teks bebas (idempoten; paritas tenant-ddl.sql) ---
  `ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "measureMode" TEXT NOT NULL DEFAULT 'Numeric'`,
  `ALTER TABLE "KpiDefinition" ADD COLUMN IF NOT EXISTS "metric" TEXT`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "description" TEXT`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "measureMode" TEXT NOT NULL DEFAULT 'Numeric'`,
  `ALTER TABLE "AppraisalKpi" ADD COLUMN IF NOT EXISTS "metric" TEXT`,
];

/** [{level,descriptor}] → teks berbaris "1: desc\n2: desc…" (untuk konversi data lama). */
function levelsJsonToText(raw: string | null | undefined): string | null {
  if (raw == null || !raw.trim()) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return raw.trim() ? raw : null; } // sudah teks — pakai apa adanya
  if (!Array.isArray(v)) return null;
  const pairs = (v as { level?: unknown; descriptor?: unknown }[])
    .filter((l) => Number(l?.level) >= 1 && Number(l?.level) <= 5 && String(l?.descriptor ?? "").trim())
    .map((l) => ({ level: Number(l.level), line: `${Number(l.level)}: ${String(l.descriptor).trim()}` }))
    .sort((a, b) => a.level - b.level);
  return pairs.length > 0 ? pairs.map((p) => p.line).join("\n") : null;
}

/** Konversi data lama → kolom "metric" (hanya baris yang metric-nya masih NULL). */
async function convertLegacy(c: Client, table: string): Promise<number> {
  const hasOld = await c.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'metricLevelsJson'`,
    [table],
  );
  if (!hasOld.rows[0]?.n) return 0;
  const rows = await c.query<{ id: string; metricLevelsJson: string | null }>(
    `SELECT "id", "metricLevelsJson" FROM "${table}" WHERE "metric" IS NULL AND "metricLevelsJson" IS NOT NULL`,
  );
  let n = 0;
  for (const r of rows.rows) {
    const text = levelsJsonToText(r.metricLevelsJson);
    if (text) {
      await c.query(`UPDATE "${table}" SET "metric" = $1::text WHERE "id" = $2`, [text, r.id]);
      n++;
    }
  }
  return n;
}

/** Seed contoh pustaka — Metric / Measure of Success persis contoh user (satu teks). */
const INNOVATION_METRIC = `1: Tidak submit / submit ulang usulan; inovasi sama persis dengan tahun sebelumnya
2: Disetujui atasan & Division Manager/Direktur, kurang berkualitas dan kurang berdampak
3: Disetujui, berkualitas baik, berdampak terhadap perubahan/perbaikan
4: Inovasi dijalankan dan diimplementasi dalam lingkup departemen
5: Dijalankan dalam lingkup lebih luas, terukur, hasilnya tepat guna bagi divisi/perusahaan`;

async function seedInnovation(c: Client): Promise<"seeded" | "exists"> {
  const found = await c.query<{ id: string }>(`SELECT "id" FROM "KpiDefinition" WHERE "code" = 'LNG-INNOVATION' LIMIT 1`);
  if (found.rows.length > 0) return "exists";
  await c.query(
    `INSERT INTO "KpiDefinition" ("id","code","name","category","polarity","unit","dataSource","description","measureMode","metric","active","versionNo","effectiveYear","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, 'LNG-INNOVATION', 'INNOVATION', 'LearningGrowth', 'Higher', 'level', 'Manual',
       'Suatu usulan terkait perbaikan atau pengembangan, atau suatu hal baru yang memiliki value added secara kreatif dalam semua aspek.',
       'Descriptor', $1::text, true, 1, EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [INNOVATION_METRIC],
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
        ["KpiDefinition", "measureMode"], ["KpiDefinition", "metric"],
        ["AppraisalKpi", "description"], ["AppraisalKpi", "measureMode"], ["AppraisalKpi", "metric"],
      ] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schemaName, table, col],
        );
        console.log(`    kolom ${table}.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
      // konversi data lama SEBELUM drop kolom
      const convDef = await convertLegacy(c, "KpiDefinition");
      const convKpi = await convertLegacy(c, "AppraisalKpi");
      console.log(`    konversi metricLevelsJson → metric: KpiDefinition ${convDef} baris · AppraisalKpi ${convKpi} baris`);
      // drop kolom lama (iterasi-1 metricText + iterasi-2 metricLevelsJson — pra-rilis)
      for (const ddl of [
        `ALTER TABLE "KpiDefinition" DROP COLUMN IF EXISTS "metricText"`,
        `ALTER TABLE "AppraisalKpi" DROP COLUMN IF EXISTS "metricText"`,
        `ALTER TABLE "KpiDefinition" DROP COLUMN IF EXISTS "metricLevelsJson"`,
        `ALTER TABLE "AppraisalKpi" DROP COLUMN IF EXISTS "metricLevelsJson"`,
      ]) {
        await c.query(ddl).catch(() => { /* IF EXISTS — tak mungkin gagal */ });
      }
      const dropped = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'AppraisalKpi' AND column_name = 'metricLevelsJson'`,
        [schemaName],
      );
      console.log(`    kolom AppraisalKpi.metricLevelsJson (lama): ${dropped.rows[0]?.n ? "MASIH ADA" : "ter-drop"}`);
      const seeded = await seedInnovation(c);
      console.log(`    seed KPI INNOVATION (Descriptor, metric satu teks): ${seeded}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
