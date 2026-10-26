// Migrasi REC-AUDIT-FIX (audit mendalam modul Rekrutmen — M2 dedupe pelamar)
// SEMUA idempoten (pola migrate-recruitment-b7/b8):
//   1. ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "emailHash" TEXT +
//      CREATE INDEX IF NOT EXISTS "Applicant_emailHash_idx" — blind index
//      email ("bi1:<hmac legacyTenantKey>") utk dedupe equality search tanpa
//      membongkar enkripsi field (verifyPublicApplication → talent pool).
//   2. BACKFILL emailHash utk pelamar existing: decrypt email (field-crypto
//      tenant — legacy plaintext di-passthrough), normalisasi (trim+lower),
//      hash → update baris yang masih NULL. Idempoten: hanya baris NULL yang
//      disentuh; re-run aman.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-audit-fix.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { primeTenantCrypto, tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- REC-AUDIT-FIX M2 — blind index email pelamar (paritas tenant-ddl.sql) ---
  `ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "emailHash" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Applicant_emailHash_idx" ON "Applicant"("emailHash")`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-audit-fix] schema: ${list.join(", ")}`);

  // 1) DDL idempoten per schema
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}: DDL…`);
      await c.query(`SET search_path TO "${schemaName}"`);
      for (const ddl of DDL) {
        try {
          await c.query(ddl);
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? "");
          // 42710 = duplicate object (kolom/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      const r = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'Applicant' AND column_name = 'emailHash'`,
        [schemaName],
      );
      console.log(`    kolom Applicant.emailHash: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
    } finally {
      await c.end();
    }
  }

  // 2) Backfill emailHash via Prisma (decrypt + hmac di proses — idempoten)
  for (const schemaName of list) {
    const db = getTenantClient(schemaName);
    await primeTenantCrypto(schemaName).catch(() => {});
    const tc = tenantCryptoForDb(db);
    const rows = await db.applicant.findMany({
      where: { email: { not: null }, emailHash: null },
      select: { id: true, applicantNo: true, email: true },
      take: 5000,
    });
    let n = 0;
    for (const a of rows) {
      // email tersimpan TERENKRIPSI; legacy plaintext di-passthrough decryptText.
      const plain = tc.decryptText(a.email);
      const norm = plain?.trim().toLowerCase();
      if (!norm) continue;
      await db.applicant.update({
        where: { id: a.id },
        data: { emailHash: tc.blindIndex(norm) },
      });
      n++;
    }
    console.log(`  ${schemaName}: backfill emailHash → ${n} pelamar (total tanpa hash tersisa: ${rows.length - n})`);
  }

  console.log("\nDONE");
}

// CLI langsung (bukan import parity-runner) — pola b7/b8
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
