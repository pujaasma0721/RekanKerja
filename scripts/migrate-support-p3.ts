// Migrasi Online Support P3 (FEAT-SUPPORT-P3) — tambahan kolom pada tabel
// SupportAgentConfig per schema tenant (reproduksi browser headless):
//   · browserEnabled      (BOOLEAN NOT NULL DEFAULT true) — sakelar per tenant
//     untuk tool reproduce_browser + analyze_screenshot. Baris ABSEN /
//     kolom default = AKTIF (konsisten P2: guard ada di lapisan tool).
//   · browserLoginEmail   (TEXT NULL) — akun uji khusus reproduksi.
//   · browserLoginPassEnc (TEXT NULL) — kata sandi akun uji TERENKRIPSI
//     field-crypto (disetel via PUT agent-config — tidak pernah plaintext).
// Idempoten — ADD COLUMN IF NOT EXISTS. Tenant BARU menerima kolom yang sama
// lewat tenant-ddl.sql (regenerated dari schema-tenant.prisma); tenant LAMA
// menerima via skrip ini (parity step "support3"). Tanpa seed baris.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-support-p3.ts
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
        ALTER TABLE "SupportAgentConfig"
          ADD COLUMN IF NOT EXISTS "browserEnabled" BOOLEAN NOT NULL DEFAULT true`);
      await c.query(`
        ALTER TABLE "SupportAgentConfig"
          ADD COLUMN IF NOT EXISTS "browserLoginEmail" TEXT`);
      await c.query(`
        ALTER TABLE "SupportAgentConfig"
          ADD COLUMN IF NOT EXISTS "browserLoginPassEnc" TEXT`);
      migrated += 1;
      console.log(`[${schema}] kolom P3 SupportAgentConfig siap (FEAT-SUPPORT-P3)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`support3: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-support-p3")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
