// Migrasi Online Support P2 (FEAT-SUPPORT-P2) — 1 tabel per schema tenant:
//   · SupportAgentConfig — sakelar tata kelola agen support (singleton):
//     toolsEnabled (default true) = izinkan agen memakai alat baca read-only
//     (search_code / read_file / query_db / read_logs) saat mendiagnosa.
// Baris TIDAK di-seed — baris ABSEN berarti tools AKTIF (default aman:
// seluruh tool hanya-baca dan diguard; lihat support/services/support-tools.ts).
// Idempoten — CREATE TABLE IF NOT EXISTS. Tenant BARU menerima tabel yang
// sama lewat tenant-ddl.sql (regenerated dari schema-tenant.prisma);
// tenant LAMA menerima via skrip ini (parity step "support2").
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-support-p2.ts
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
  let migrated = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "SupportAgentConfig" (
            "id" TEXT NOT NULL,
            "toolsEnabled" BOOLEAN NOT NULL DEFAULT true,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "SupportAgentConfig_pkey" PRIMARY KEY ("id")
        )`);
      migrated += 1;
      console.log(`[${schema}] tabel SupportAgentConfig siap (FEAT-SUPPORT-P2)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`support2: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-support-p2")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
