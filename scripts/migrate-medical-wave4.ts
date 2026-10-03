// Migrasi Wave 4 Medical (fix 93) — kolom baru pelacakan piutang asuransi:
//   G-3 (audit BPA-medical): jurnal settle sudah memecah bagian asuransi ke
//   piutang 13xx (fix M-7 wave 1), tetapi tidak ada proses klaim ke asuransi.
//   Kolom MedicalClaim:
//     insState       — siklus NONE → SUBMITTED → PAID / WRITTEN_OFF
//     insRefNo       — nomor klaim pada asuransi
//     insAmount      — snapshot piutang saat settle (terenkripsi)
//     insSubmittedAt — waktu dikirim ke asuransi
//     insPaidAt      — waktu pembayaran asuransi diterima
//     insPaidAmount  — nilai yang dibayarkan asuransi (terenkripsi)
// Idempoten — ADD COLUMN IF NOT EXISTS. Schema tanpa tabel medical DILEWATI
// (bukan error — ensureMedicalReference di provisioning yang membuat
// tabelnya saat dibutuhkan; tenant-ddl.sql fresh-install sudah memuat kolom).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-medical-wave4.ts
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
        console.log(`[${schema}] tanpa tabel MedicalClaim — skip (ensureMedicalReference akan membuatnya)`);
        continue;
      }
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insState" TEXT NOT NULL DEFAULT 'NONE'`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insRefNo" TEXT`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insAmount" TEXT NOT NULL DEFAULT '0'`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insSubmittedAt" TIMESTAMP(3)`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insPaidAt" TIMESTAMP(3)`);
      await c.query(`ALTER TABLE "MedicalClaim" ADD COLUMN IF NOT EXISTS "insPaidAmount" TEXT`);
      migrated += 1;
      console.log(`[${schema}] medical-wave4 OK — MedicalClaim.insState/insRefNo/insAmount/insSubmittedAt/insPaidAt/insPaidAmount siap`);
    } catch (e) {
      console.error(`[${schema}] GAGAL:`, e instanceof Error ? e.message : e);
      throw e;
    } finally {
      await c.end();
    }
  }
  console.log(`medical-wave4 selesai: ${migrated} schema dimigrasi, ${skipped} dilewati`);
}

// CLI langsung: bun run scripts/migrate-medical-wave4.ts
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
