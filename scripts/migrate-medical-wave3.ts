// Migrasi Wave 3 Medical (fix 92) — kolom baru modul medical:
//   1. MedicalBenefitType.needLetter BOOLEAN NOT NULL DEFAULT false —
//      G-2 (audit BPA-medical): jenis benefit yang mewajibkan nomor surat
//      rujukan dokter/RS pada pengajuan klaim (pad oranHR letter_no —
//      praktik rawat inap). Enforce di submitClaim/updateClaim (jalur admin
//      & ESS memakai service yang sama).
// Idempoten — ADD COLUMN IF NOT EXISTS. Schema tanpa tabel medical DILEWATI
// (bukan error — ensureMedicalReference di provisioning yang membuat
// tabelnya saat dibutuhkan; tenant-ddl.sql fresh-install sudah memuat kolom).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-medical-wave3.ts
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
      const hasMedical = await c.query(`SELECT to_regclass('"MedicalBenefitType"') IS NOT NULL AS ok`);
      if (!hasMedical.rows[0]?.ok) {
        skipped += 1;
        console.log(`[${schema}] tanpa tabel medical — skip (ensureMedicalReference akan membuatnya)`);
        continue;
      }
      await c.query(`ALTER TABLE "MedicalBenefitType" ADD COLUMN IF NOT EXISTS "needLetter" BOOLEAN NOT NULL DEFAULT false`);
      migrated += 1;
      console.log(`[${schema}] medical-wave3 OK — MedicalBenefitType.needLetter siap`);
    } catch (e) {
      console.error(`[${schema}] GAGAL:`, e instanceof Error ? e.message : e);
      throw e;
    } finally {
      await c.end();
    }
  }
  console.log(`medical-wave3 selesai: ${migrated} schema dimigrasi, ${skipped} dilewati`);
}

// CLI langsung: bun run scripts/migrate-medical-wave3.ts
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
