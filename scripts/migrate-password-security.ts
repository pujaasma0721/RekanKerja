// Migrasi KEBIJAKAN KATA SANDI + tambah pengguna (Task 33) ke tenant existing:
//   1. DDL idempoten tenant: tabel PasswordPolicy + PasswordHistory (+ FK &
//      index) + kolom AppUser.passwordChangedAt (umur sandi)
//   2. DDL idempoten platform (public): User.failedAttempts + User.lockedUntil
//      (lockout login)
//   3. seed policy default per tenant (satu baris aktif — bila belum ada)
//   4. backfill AppUser.passwordChangedAt = sekarang (umur mulai terhitung)
//   5. riwayat awal akun demo MII (hrd@ + agus@, sandi onevity123) — sehingga
//      RESET ke sandi yang sama DITOLAK (aturan riwayat hidup di demo)
// Jalankan: bun run scripts/migrate-password-security.ts (idempoten)
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const DDL = `
CREATE TABLE IF NOT EXISTS "PasswordPolicy" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "minLength" INTEGER NOT NULL DEFAULT 8,
    "maxLength" INTEGER NOT NULL DEFAULT 64,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT true,
    "requireLowercase" BOOLEAN NOT NULL DEFAULT true,
    "requireNumber" BOOLEAN NOT NULL DEFAULT true,
    "requireSpecial" BOOLEAN NOT NULL DEFAULT true,
    "minUniqueChars" INTEGER NOT NULL DEFAULT 4,
    "maxRepeated" INTEGER NOT NULL DEFAULT 3,
    "maxSequential" INTEGER NOT NULL DEFAULT 3,
    "blockUsername" BOOLEAN NOT NULL DEFAULT true,
    "blockName" BOOLEAN NOT NULL DEFAULT true,
    "blockCommon" BOOLEAN NOT NULL DEFAULT true,
    "lifetimeDays" INTEGER NOT NULL DEFAULT 90,
    "warnDays" INTEGER NOT NULL DEFAULT 7,
    "historyCount" INTEGER NOT NULL DEFAULT 6,
    "maxFailedAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockoutMinutes" INTEGER NOT NULL DEFAULT 15,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PasswordPolicy_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PasswordHistory" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setById" TEXT,
    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PasswordHistory_appUserId_setAt_idx" ON "PasswordHistory"("appUserId", "setAt");
ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
`;

const FK = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PasswordHistory_appUserId_fkey'
                 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())) THEN
    ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_appUserId_fkey"
      FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
`;

const PLATFORM_DDL = `
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
`;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

// akun demo MII: email → sandi (riwayat awal agar aturan "6 terakhir" hidup)
const DEMO_ACCOUNTS: { email: string; password: string }[] = [
  { email: "hrd@mii.co.id", password: "onevity123" },
  { email: "agus@mii.co.id", password: "onevity123" },
];

async function main() {
  const client = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await client.connect();

  // ---- platform: kolom lockout ----
  await client.query(`SET search_path TO public`);
  await client.query(PLATFORM_DDL);
  console.log("[platform] kolom lockout User.failedAttempts/lockedUntil siap");

  for (const schema of SCHEMAS) {
    console.log(`[${schema}] migrasi kebijakan kata sandi…`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(DDL);
    try { await client.query(FK); } catch (e) { console.warn(`  (skip FK: ${(e as Error).message})`); }

    // seed policy default (satu baris aktif bila belum ada)
    const pol = await client.query(`SELECT 1 FROM "PasswordPolicy" WHERE "active" = true LIMIT 1`);
    if ((pol.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO "PasswordPolicy" ("id","active","updatedAt") VALUES (gen_random_uuid()::text, true, CURRENT_TIMESTAMP)`,
      );
      console.log("  seed kebijakan default (min 8, kombinasi lengkap, umur 90 hari, riwayat 6, lockout 5x/15m)");
    }

    // backfill umur sandi
    const back = await client.query(
      `UPDATE "AppUser" SET "passwordChangedAt" = CURRENT_TIMESTAMP WHERE "passwordChangedAt" IS NULL`,
    );
    if ((back.rowCount ?? 0) > 0) console.log(`  backfill passwordChangedAt: ${back.rowCount} pengguna`);

    // riwayat awal akun demo (MII saja)
    if (schema === "tenant_pt_mitra_industri_internasional") {
      for (const acc of DEMO_ACCOUNTS) {
        const r = await client.query(
          `INSERT INTO "PasswordHistory" ("id","appUserId","hash","setAt")
           SELECT gen_random_uuid()::text, u.id, $1, CURRENT_TIMESTAMP
           FROM "AppUser" u
           WHERE u.email = $2
             AND NOT EXISTS (SELECT 1 FROM "PasswordHistory" h WHERE h."appUserId" = u.id)`,
          [hashPassword(acc.password), acc.email],
        );
        if ((r.rowCount ?? 0) > 0) console.log(`  riwayat awal: ${acc.email} (reset ke sandi lama akan ditolak)`);
      }
    }
  }

  await client.end();
  console.log("DONE — kebijakan kata sandi + tambah pengguna siap (Task 33)");
}

main().catch((e) => { console.error(e); process.exit(1); });
