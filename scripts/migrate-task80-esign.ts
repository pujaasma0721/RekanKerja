// Migrasi Task 80 (e-sign internal) ke tenant existing — IDEMPOTEN.
// Membuat tabel SignatureKey + SignatureRecord (kolom + index) bila belum ada.
// Tenant BARU tidak perlu skrip ini (sudah termuat prisma/tenant-ddl.sql).
// Jalankan: node --experimental-strip-types scripts/migrate-task80-esign.ts
//   (atau: npx tsx scripts/migrate-task80-esign.ts)
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const PLATFORM_URL =
  process.env.PLATFORM_DB_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const TABLES: [string, string][] = [
  [
    "SignatureKey",
    `CREATE TABLE IF NOT EXISTS "SignatureKey" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RSA-PSS-SHA256',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    CONSTRAINT "SignatureKey_pkey" PRIMARY KEY ("id")
)`,
  ],
  [
    "SignatureRecord",
    `CREATE TABLE IF NOT EXISTS "SignatureRecord" (
    "id" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docRef" TEXT NOT NULL,
    "docHash" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "signature" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'RSA-PSS-SHA256',
    "signerAppUserId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signerIp" TEXT,
    "signerUa" TEXT,
    "prevHash" TEXT NOT NULL,
    "ownHash" TEXT NOT NULL,
    CONSTRAINT "SignatureRecord_pkey" PRIMARY KEY ("id")
)`,
  ],
  [
    "SignatureChallenge",
    `CREATE TABLE IF NOT EXISTS "SignatureChallenge" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'sign',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignatureChallenge_pkey" PRIMARY KEY ("id")
)`,
  ],
];

const INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "SignatureKey_appUserId_key" ON "SignatureKey"("appUserId")`,
  `CREATE INDEX IF NOT EXISTS "SignatureRecord_docType_docId_idx" ON "SignatureRecord"("docType", "docId")`,
  `CREATE INDEX IF NOT EXISTS "SignatureRecord_signerAppUserId_idx" ON "SignatureRecord"("signerAppUserId")`,
  `CREATE INDEX IF NOT EXISTS "SignatureRecord_signedAt_idx" ON "SignatureRecord"("signedAt")`,
  `CREATE INDEX IF NOT EXISTS "SignatureChallenge_appUserId_createdAt_idx" ON "SignatureChallenge"("appUserId", "createdAt")`,
];

async function activeTenantSchemas(): Promise<string[]> {
  const c = new Client({ connectionString: PLATFORM_URL });
  try {
    await c.connect();
    const r = await c.query<{ schemaName: string }>(
      `SELECT "schemaName" FROM public."Tenant" WHERE "status" = 'ACTIVE' ORDER BY "slug"`,
    );
    return r.rows.map((x) => x.schemaName);
  } catch (e) {
    console.warn(`[warn] registry platform tak terbaca (${(e as Error).message}) — pakai fallback`);
    return [];
  } finally {
    await c.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  const schemas = await activeTenantSchemas();
  if (schemas.length === 0) return;
  let touched = 0;
  for (const schema of schemas) {
    const c = new Client({ connectionString: BASE_URL });
    try {
      await c.connect();
      await c.query(`SET search_path TO "${schema}"`);
      for (const [name, ddl] of TABLES) {
        const exists = await c.query(`SELECT to_regclass('"${name}"') AS r`);
        if (exists.rows[0]?.r) continue;
        await c.query(ddl);
        touched++;
        console.log(`  [${schema}] tabel ${name} dibuat`);
      }
      // kolom PIN (tenant yang tabelnya dibuat versi awal tanpa pin)
      const hasPin = await c.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='SignatureKey' AND column_name='pinHash'`,
      );
      if (hasPin.rowCount === 0) {
        await c.query(`ALTER TABLE "SignatureKey" ADD COLUMN "pinHash" TEXT`);
        await c.query(`ALTER TABLE "SignatureKey" ADD COLUMN "pinSetAt" TIMESTAMP(3)`);
        console.log(`  [${schema}] kolom pinHash/pinSetAt ditambahkan`);
      }
      for (const ddl of INDEXES) await c.query(ddl);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`Selesai — ${touched} tabel dibuat di ${schemas.length} schema tenant.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
