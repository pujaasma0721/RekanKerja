// Migrasi Wave 1 Medical (fix 89) — kolom + FK baru modul medical:
//   1. MedicalClaim.prorateFactor  DOUBLE PRECISION — snapshot faktor prorata
//      masa kerja (W1-8 prorateFactorFor) saat klaim disubmit.
//   2. MedicalClaim.reversalOfId   TEXT + UNIQUE — tautan storno (W1-4);
//      @unique menjamin 1 klaim hanya pernah di-storno sekali (idempoten).
//   3. MedicalClaimLine.providerId TEXT + INDEX — master MedicalProvider (W1-6).
//   4. FK MedicalClaim_reversalOfId_fkey   → MedicalClaim(id)   ON DELETE SET NULL ON UPDATE CASCADE
//   5. FK MedicalClaimLine_providerId_fkey → MedicalProvider(id) ON DELETE SET NULL ON UPDATE CASCADE
// Idempoten — ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / FK dicek
// di pg_constraint dulu. Schema tanpa tabel medical DILEWATI (bukan error —
// ensureMedicalReference di provisioning yang membuat tabelnya saat dibutuhkan).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-medical-wave1.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  let migrated = 0;
  let skipped = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString:
        process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      // Tabel medical belum ada (instalasi pra-Task 21) → skip, bukan error.
      const hasMedical = await c.query(`SELECT to_regclass('"MedicalClaim"') IS NOT NULL AS ok`);
      if (!hasMedical.rows[0]?.ok) {
        skipped += 1;
        console.log(`[${schema}] tanpa tabel medical — skip (ensureMedicalReference akan membuatnya)`);
        continue;
      }
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "prorateFactor" DOUBLE PRECISION`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "reversalOfId" TEXT`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "MedicalClaim_reversalOfId_key" ON "MedicalClaim"("reversalOfId")`);
      await c.query(`ALTER TABLE "MedicalBalance" ADD COLUMN IF NOT EXISTS "prorateFactor" DOUBLE PRECISION`);
      await c.query(`ALTER TABLE "MedicalClaimLine" ADD COLUMN IF NOT EXISTS "providerId" TEXT`);
      await c.query(`CREATE INDEX IF NOT EXISTS "MedicalClaimLine_providerId_idx" ON "MedicalClaimLine"("providerId")`);
      // FK dibuat hanya bila belum ada (PostgreSQL tidak punya ADD CONSTRAINT IF NOT EXISTS).
      const fk1 = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'MedicalClaim_reversalOfId_fkey' AND conrelid = '"MedicalClaim"'::regclass`,
      );
      if (fk1.rowCount === 0) {
        await c.query(
          `ALTER TABLE "MedicalClaim" ADD CONSTRAINT "MedicalClaim_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "MedicalClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
        );
      }
      const fk2 = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'MedicalClaimLine_providerId_fkey' AND conrelid = '"MedicalClaimLine"'::regclass`,
      );
      if (fk2.rowCount === 0) {
        await c.query(
          `ALTER TABLE "MedicalClaimLine" ADD CONSTRAINT "MedicalClaimLine_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "MedicalProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
        );
      }
      migrated += 1;
      console.log(`[${schema}] wave1 medical siap: prorateFactor (Claim+Balance) + reversalOfId(unique) + providerId(idx) + 2 FK`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`medical-wave1: ${migrated} schema dimigrasi, ${skipped} dilewati (tanpa tabel medical)`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-medical-wave1")) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
