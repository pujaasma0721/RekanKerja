// Migrasi Whistleblowing (Task 52-f — TPKS UU 12/2022) — tabel
// WhistleblowReport (kanal laporan pelanggaran & kekerasan seksual):
//   CREATE TABLE IF NOT EXISTS + index status/kategori/createdAt (idempoten).
// Tanpa seed demo — kanal mulai kosong (laporan nyata dari pengguna).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-whistleblow.ts
import "./lib/env";
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "WhistleblowReport" (
            "id" TEXT NOT NULL,
            "ticketNo" TEXT NOT NULL,
            "category" TEXT NOT NULL,
            "channel" TEXT NOT NULL DEFAULT 'ESS',
            "description" TEXT NOT NULL,
            "incidentDate" TIMESTAMP(3),
            "location" TEXT,
            "involvedHint" TEXT,
            "anonymous" BOOLEAN NOT NULL DEFAULT true,
            "reporterEmployeeId" TEXT,
            "reporterContact" TEXT,
            "status" TEXT NOT NULL DEFAULT 'Baru',
            "assignedToId" TEXT,
            "followUpNote" TEXT,
            "resolutionNote" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "WhistleblowReport_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "WhistleblowReport_ticketNo_key" ON "WhistleblowReport"("ticketNo")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "WhistleblowReport_status_idx" ON "WhistleblowReport"("status")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "WhistleblowReport_category_idx" ON "WhistleblowReport"("category")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "WhistleblowReport_createdAt_idx" ON "WhistleblowReport"("createdAt")`);
      console.log(`[${schema}] tabel WhistleblowReport siap (Task 52-f)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-whistleblow")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
