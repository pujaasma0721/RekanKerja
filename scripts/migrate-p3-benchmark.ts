// Migrasi P3-BENCHMARK (DEVELOPMENT-PLAN-BENCHMARK.md §4 P3) — SEMUA idempoten
// (pola migrate-p1/p2-benchmark):
//   1. Tabel baru: JobFamily (D-BM23 — family jabatan tree 2-level),
//      SkillCatalog + EmployeeSkill (D-BM24 — skills foundation),
//      CareerPath (D-BM27 — jalur karier posisi→posisi).
//   2. Kolom baru: Job.familyId/mission/dutiesJson/qualificationsJson/
//      minEducation/workingConditions (job profile D-BM23) +
//      Position.requiredSkillsJson (syarat keahlian per posisi D-BM24).
//   3. BACKFILL non-destruktif (D-BM23): setiap nilai Job.category berbeda →
//      JobFamily baru (kode JF-<slug>); Job yang punya category di-nautkan ke
//      family-nya. Kolom category DIPERTAHANKAN (tidak dihapus) — UI memakai
//      family; tanpa category → familyId null (tidak difabrikasi).
//   4. SEED starter: SkillCatalog default (skill-defaults.ts — satu sumber
//      bersama provisioning) — only-if-not-exists per kode.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU dijalankan CLI: bun run scripts/migrate-p3-benchmark.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { DEFAULT_SKILL_CATALOG } from "@/rekankerja/shared/lib/skill-defaults";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- tabel baru (idempoten) ---
  `CREATE TABLE IF NOT EXISTS "JobFamily" (
    "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
    "parentId" TEXT, "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobFamily_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "SkillCatalog" (
    "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
    "category" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SkillCatalog_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "EmployeeSkill" (
    "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL, "evidence" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "CareerPath" (
    "id" TEXT NOT NULL, "fromPositionId" TEXT NOT NULL, "toPositionId" TEXT NOT NULL,
    "requiredSkillsJson" TEXT, "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CareerPath_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "ReportSchedule" (
    "id" TEXT NOT NULL, "reportId" TEXT NOT NULL, "frequency" TEXT NOT NULL,
    "dayOfWeek" INTEGER, "dayOfMonth" INTEGER, "hour" INTEGER NOT NULL DEFAULT 7,
    "recipients" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3), "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id"))`,
  // --- kolom baru (idempoten) ---
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "familyId" TEXT`,
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "mission" TEXT`,
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "dutiesJson" TEXT`,
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "qualificationsJson" TEXT`,
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "minEducation" TEXT`,
  `ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "workingConditions" TEXT`,
  `ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "requiredSkillsJson" TEXT`,
  // --- index + unique (idempoten) ---
  `CREATE UNIQUE INDEX IF NOT EXISTS "JobFamily_code_key" ON "JobFamily"("code")`,
  `CREATE INDEX IF NOT EXISTS "JobFamily_parentId_idx" ON "JobFamily"("parentId")`,
  `CREATE INDEX IF NOT EXISTS "Job_familyId_idx" ON "Job"("familyId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SkillCatalog_code_key" ON "SkillCatalog"("code")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeSkill_employeeId_skillId_key" ON "EmployeeSkill"("employeeId", "skillId")`,
  `CREATE INDEX IF NOT EXISTS "EmployeeSkill_employeeId_idx" ON "EmployeeSkill"("employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CareerPath_fromPositionId_toPositionId_key" ON "CareerPath"("fromPositionId", "toPositionId")`,
  `CREATE INDEX IF NOT EXISTS "CareerPath_fromPositionId_idx" ON "CareerPath"("fromPositionId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ReportSchedule_reportId_key" ON "ReportSchedule"("reportId")`,
  // --- FK (drop-if-exists lalu add — idempoten) ---
  `ALTER TABLE "JobFamily" DROP CONSTRAINT IF EXISTS "JobFamily_parentId_fkey"`,
  `ALTER TABLE "JobFamily" ADD CONSTRAINT "JobFamily_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "JobFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "Job" DROP CONSTRAINT IF EXISTS "Job_familyId_fkey"`,
  `ALTER TABLE "Job" ADD CONSTRAINT "Job_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "JobFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "EmployeeSkill" DROP CONSTRAINT IF EXISTS "EmployeeSkill_employeeId_fkey"`,
  `ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EmployeeSkill" DROP CONSTRAINT IF EXISTS "EmployeeSkill_skillId_fkey"`,
  `ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "SkillCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CareerPath" DROP CONSTRAINT IF EXISTS "CareerPath_fromPositionId_fkey"`,
  `ALTER TABLE "CareerPath" ADD CONSTRAINT "CareerPath_fromPositionId_fkey" FOREIGN KEY ("fromPositionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CareerPath" DROP CONSTRAINT IF EXISTS "CareerPath_toPositionId_fkey"`,
  `ALTER TABLE "CareerPath" ADD CONSTRAINT "CareerPath_toPositionId_fkey" FOREIGN KEY ("toPositionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ReportSchedule" DROP CONSTRAINT IF EXISTS "ReportSchedule_reportId_fkey"`,
  `ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CustomReport"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

/** Slug kode family dari nama kategori: "Teknis & IT" → "TEKNIS-IT" (prefix JF-). */
export function familyCodeOf(category: string): string {
  const slug = category
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `JF-${slug || "LAINNYA"}`;
}

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-p3-benchmark] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
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
          // 42710 = duplicate object (kolom/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }

      // --- BACKFILL D-BM23: Job.category → JobFamily (non-destruktif) ---
      const cats = await c.query<{ category: string }>(
        `SELECT DISTINCT category FROM "Job" WHERE category IS NOT NULL AND TRIM(category) <> ''`,
      );
      let families = 0;
      const codeToId = new Map<string, string>();
      for (const { category } of cats.rows) {
        const name = category.trim();
        const code = familyCodeOf(name);
        const existing = await c.query<{ id: string }>(
          `SELECT id FROM "JobFamily" WHERE code = $1 LIMIT 1`, [code],
        );
        let id = existing.rows[0]?.id;
        if (!id) {
          const ins = await c.query<{ id: string }>(
            `INSERT INTO "JobFamily" (id, code, name, "parentId", "sortOrder", "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, NULL, 0, now(), now()) RETURNING id`,
            [code, name],
          );
          id = ins.rows[0].id;
          families++;
        }
        codeToId.set(code, id);
      }
      // Link job → family (deterministik per kategori — kode family dari peta
      // codeToId yang sama dengan pencipta family di atas, bukan regexp SQL)
      let linked = 0;
      for (const { category } of cats.rows) {
        const famId = codeToId.get(familyCodeOf(category.trim()));
        if (!famId) continue;
        const r = await c.query<{ n: number }>(
          `UPDATE "Job" SET "familyId" = $1 WHERE "familyId" IS NULL AND category = $2 RETURNING 1`,
          [famId, category],
        );
        linked += r.rows.length;
      }

      // --- SEED D-BM24: SkillCatalog starter (only-if-not-exists per kode) ---
      let skills = 0;
      for (const s of DEFAULT_SKILL_CATALOG) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM "SkillCatalog" WHERE code = $1`, [s.code],
        );
        if (!r.rows[0]?.n) {
          await c.query(
            `INSERT INTO "SkillCatalog" (id, code, name, category, active, "sortOrder", "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, true, 0, now(), now())`,
            [s.code, s.name, s.category],
          );
          skills++;
        }
      }

      console.log(`    backfill: ${families} family baru, ${linked} job ter-naut; seed ${skills} skill baru`);
      for (const tbl of ["JobFamily", "SkillCatalog", "EmployeeSkill", "CareerPath", "ReportSchedule"]) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
          [schemaName, tbl],
        );
        console.log(`    tabel ${tbl}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
      for (const [tbl, col] of [
        ["Job", "familyId"],
        ["Job", "mission"],
        ["Position", "requiredSkillsJson"],
      ] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
          [schemaName, tbl, col],
        );
        console.log(`    kolom ${tbl}.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI: bun run scripts/migrate-p3-benchmark.ts [schema1 schema2 ...]
if (process.argv[1] && process.argv[1].includes("migrate-p3-benchmark")) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
