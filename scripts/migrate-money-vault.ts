// Migrasi Money Vault (Task 45-a) — GELOMBANG GERBANG VISIBILITAS UANG:
//   1. CREATE TABLE IF NOT EXISTS "MoneyVault" (satu baris per schema —
//      dijaga di kode: money-vault.ts findFirst; >1 baris → pakai pertama).
//      Kolom openUntil/openByUserId INFORMATIF (status open otoritatif di
//      memori proses — restart server = vault terkunci otomatis).
//   2. CREATE TABLE IF NOT EXISTS "MoneyViewGrant" (+ unique index userId) —
//      hak lihat uang tanpa sandi; AKTIF saat revokedAt IS NULL.
// Idempoten — CREATE TABLE/INDEX IF NOT EXISTS, aman di-rerun, TANPA mengubah
// baris data (setup vault hanya lewat API oleh admin workspace).
// Dapat diimpor IN-PROCESS oleh src/onevity/shared/lib/parity-runner.ts
// (main() tanpa efek samping) ATAU CLI: bun run scripts/migrate-money-vault.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

// Daftar schema tenant demo (sumber sama dengan migrate-encrypt-money.ts /
// parity-runner: registry Tenant.schemaName — skrip CLI memakai daftar statis
// 3 tenant demo bila tidak menerima parameter).
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
      console.log(`[${schema}] migrasi Money Vault (tabel MoneyVault + MoneyViewGrant)…`);

      // ---- MoneyVault (kolom identik model Prisma — PascalCase ter-quote) ----
      await c.query(`
        CREATE TABLE IF NOT EXISTS "MoneyVault" (
            "id" TEXT NOT NULL,
            "salt" TEXT NOT NULL,
            "verifier" TEXT NOT NULL,
            "wrappedKey" TEXT NOT NULL,
            "openUntil" TIMESTAMP(3),
            "openByUserId" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "MoneyVault_pkey" PRIMARY KEY ("id")
        );`);

      // ---- MoneyViewGrant ----
      await c.query(`
        CREATE TABLE IF NOT EXISTS "MoneyViewGrant" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "grantedBy" TEXT NOT NULL,
            "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "revokedAt" TIMESTAMP(3),
            CONSTRAINT "MoneyViewGrant_pkey" PRIMARY KEY ("id")
        );`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "MoneyViewGrant_userId_key" ON "MoneyViewGrant"("userId");`);

      // ---- verifikasi (information_schema — bukan asumsi) ----
      const check = await c.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name IN ('MoneyVault', 'MoneyViewGrant')`,
        [schema],
      );
      const found = new Set(check.rows.map((r: { table_name: string }) => r.table_name));
      if (!found.has("MoneyVault") || !found.has("MoneyViewGrant")) {
        throw new Error(`tabel belum lengkap pasca-DDL (ada: ${[...found].join(", ") || "none"})`);
      }
      console.log(`  OK: "MoneyVault" + "MoneyViewGrant" (index userId unik) tersedia`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE — rerun aman (idempoten, 0 perubahan)");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
