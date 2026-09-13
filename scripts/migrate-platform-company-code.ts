// Migrasi Task 58-b — PLATFORM DDL: kolom Tenant.companyCode ================
// ===========================================================================
// Task 58 menambah kolom Tenant.companyCode di schema.prisma + form
// registrasi, tapi deploy lama TIDAK menjalankan prisma db push →
// prisma.tenant.create() gagal "The column companyCode does not exist in the
// current database" saat user membuat workspace baru di production.
// Step parity ini memastikan kolom ada (idempoten) — self-heal konvensi K-6.
//
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun run scripts/migrate-platform-company-code.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

export async function main(): Promise<void> {
  const url = process.env.PLATFORM_DB_URL ?? process.env.TENANT_DB_BASE_URL;
  if (!url) {
    console.log("[platform-company-code] PLATFORM_DB_URL tidak diset — lewati");
    return;
  }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const dt = await c.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'Tenant' AND column_name = 'companyCode'`,
    );
    if (dt.rowCount && dt.rowCount > 0) {
      console.log("[platform-company-code] kolom Tenant.companyCode sudah ada — idempoten");
      return;
    }
    await c.query(`ALTER TABLE "Tenant" ADD COLUMN "companyCode" TEXT`);
    console.log("[platform-company-code] kolom Tenant.companyCode DITAMBAHKAN (Task 58)");
  } finally {
    await c.end().catch(() => {});
  }
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("migrate-platform-company-code.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
