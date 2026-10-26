// Migrasi PLAN-LINK — tautan eksplisit MPP (RecruitmentPlan) ↔ PR
// (PersonnelRequisition) ke tenant existing — SEMUA idempoten:
//   1. ALTER TABLE PersonnelRequisition ADD COLUMN IF NOT EXISTS "planId" TEXT
//   2. CREATE INDEX IF NOT EXISTS PersonnelRequisition_planId_idx
//   3. FK drop-add idempoten → RecruitmentPlan(id) ON DELETE SET NULL
// Selaras prisma/schema-tenant.prisma & prisma/tenant-ddl.sql.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping modul)
// ATAU CLI: bun run scripts/migrate-plan-link.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  `ALTER TABLE "PersonnelRequisition" ADD COLUMN IF NOT EXISTS "planId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "PersonnelRequisition_planId_idx" ON "PersonnelRequisition"("planId")`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_planId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RecruitmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-plan-link] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of DDL) {
        await c.query(`SET search_path TO "${schemaName}"`);
        try {
          await c.query(ddl);
        } catch (e) {
          if ((e as { code?: string }).code === "23505" && /pg_class_relname_nsp_index/.test(String(e))) {
            await new Promise((r) => setTimeout(r, 300));
            await c.query(ddl);
          } else throw e;
        }
      }
      console.log(`    kolom PersonnelRequisition.planId + index + FK siap (PLAN-LINK)`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, BUKAN saat diimpor
// aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
