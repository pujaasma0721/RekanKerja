// Migrasi PTKP Otomatis (Task 49) — kolom EmployeePayrollProfile.ptkpSource:
//   ALTER TABLE ... ADD COLUMN IF NOT EXISTS "ptkpSource" TEXT NOT NULL DEFAULT 'manual'
// Idempoten — aman di-rerun, TIDAK mengubah nilai taxStatus/dependents yang
// sudah tersimpan (baris lama tetap "manual" = nilai yang admin tetapkan;
// admin beralih ke "auto" via UI Data Gaji Karyawan atau tombol Sinkronkan).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-ptkp-auto.ts
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
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      // Task 49: ptkpSource auto|manual — default 'manual' (baris lama tidak
      // berubah perilaku; schema Prisma default sama → konsisten).
      await c.query(`ALTER TABLE "EmployeePayrollProfile" ADD COLUMN IF NOT EXISTS "ptkpSource" TEXT NOT NULL DEFAULT 'manual'`);
      console.log(`[${schema}] kolom EmployeePayrollProfile.ptkpSource siap (Task 49)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-ptkp-auto")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
