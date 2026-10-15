// Migrasi B2-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B2; D-BL7/D-BL9) —
// SEMUA idempoten (pola migrate-performance-p0/p9/b1):
//   1. ALTER TABLE "Feedback360Answer" ADD COLUMN IF NOT EXISTS "flaggedJson"
//      TEXT — [{category, phrase}] hasil scanBias (flag menempel pada Answer,
//      anonimitas reviewer utuh — D-BL9).
//   2. ALTER TABLE "Feedback360Answer" ADD COLUMN IF NOT EXISTS "moderated"
//      TEXT — Pending|Approved|Redacted (NULL = legacy pra-B2 / bersih →
//      dianggap Approved).
//   3. Index "Feedback360Answer_moderated_idx" utk antrean moderasi HR.
// Selaras prisma/schema-tenant.prisma + prisma/tenant-ddl.sql. Tidak ada seed
// data (baris legacy dibiarkan NULL = Approved). Dapat diimpor IN-PROCESS
// oleh parity-runner (main() tanpa efek samping modul) ATAU CLI:
//   bun run scripts/migrate-performance-b2-bias.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- Feedback360Answer.flaggedJson + moderated (B2-BL — D-BL7/D-BL9) ---
  `ALTER TABLE "Feedback360Answer" ADD COLUMN IF NOT EXISTS "flaggedJson" TEXT`,
  `ALTER TABLE "Feedback360Answer" ADD COLUMN IF NOT EXISTS "moderated" TEXT`,
  // --- index antrean moderasi HR (moderated="Pending") ---
  `CREATE INDEX IF NOT EXISTS "Feedback360Answer_moderated_idx" ON "Feedback360Answer"("moderated")`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-performance-b2-bias] schema: ${list.join(", ")}`);
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
          // 42710 = duplicate object (constraint/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      console.log(`    kolom Feedback360Answer.flaggedJson/moderated + index siap`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
