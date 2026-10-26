// Migrasi SB-RC-BL (tahapan seleksi kustom per PR — user-defined selection
// process, jawaban desain "setiap rekrutmen punya selection process berbeda")
// — SEMUA idempoten (pola migrate-recruitment-b7-status-link):
//   1. CREATE TABLE IF NOT EXISTS "PrSelectionStage" + unique index
//      [prId, selectionProcessId] + index prId + 2 FK — daftar urut tahap
//      yang dipilih HR per PersonnelRequisition. Kosong = standar tenant
//      (katalog SelectionProcess aktif penuh — perilaku F3 lama).
// Tidak ada seed data (baris dibuat lewat UI board seleksi / API selection).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-sb-stages.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- SB-RC-BL — tabel tahapan seleksi kustom per PR ---
  `CREATE TABLE IF NOT EXISTS "PrSelectionStage" (
      "id" TEXT NOT NULL,
      "prId" TEXT NOT NULL,
      "selectionProcessId" TEXT NOT NULL,
      "seqNo" INTEGER NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PrSelectionStage_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PrSelectionStage_prId_selectionProcessId_key" ON "PrSelectionStage"("prId", "selectionProcessId")`,
  `CREATE INDEX IF NOT EXISTS "PrSelectionStage_prId_idx" ON "PrSelectionStage"("prId")`,
  `ALTER TABLE "PrSelectionStage" ADD CONSTRAINT "PrSelectionStage_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "PrSelectionStage" ADD CONSTRAINT "PrSelectionStage_selectionProcessId_fkey" FOREIGN KEY ("selectionProcessId") REFERENCES "SelectionProcess"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-sb-stages] schema: ${list.join(", ")}`);
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
          // 42710 = duplicate object (tabel/index/constraint sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      const tbl = await c.query<{ n: boolean }>(
        `SELECT to_regclass('"${schemaName}"."PrSelectionStage"') IS NOT NULL AS n`,
      );
      console.log(`    tabel PrSelectionStage: ${tbl.rows[0]?.n ? "ada" : "HILANG"}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI langsung (bukan import parity-runner) — pola b7/b8
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
