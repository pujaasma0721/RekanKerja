// Migrasi HAK AKSES PER PENGGUNA (Task 31) ke tenant existing:
//   1. DDL idempoten — tabel UserMenuAccess (+ FK & unique index) bila belum ada
//   2. bersihkan rule akses data lama bertipe grup/role (subjek harus per
//      pengguna — Task 31: hak akses diatur PER USER, bukan per grup)
//   3. seed konfigurasi menu per pengguna (demo MII — 3 Approver level sama
//      dengan hak BERBEDA + 1 Viewer minimal — persis kasus user:
//      "masing-masing user punya hak yang berbeda walaupun levelnya sama")
//   4. akun demo platform agus@mii.co.id (role workspace HR — BUKAN super
//      admin) tertaut ke AppUser Agus Salim → batasan menu bisa dilihat
//      langsung dengan login akun tersebut.
// Super admin (AppUser role Admin / platform OWNER|ADMIN) & atasan langsung
// otomatis — tanpa konfigurasi. Jalankan: bun run scripts/migrate-user-menu-access.ts
import { Client } from "pg";
import { randomBytes, scryptSync } from "node:crypto";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const DDL = `
CREATE TABLE IF NOT EXISTS "UserMenuAccess" (
    "id" TEXT NOT NULL,
    "appUserId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ALL',
    "menusJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMenuAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserMenuAccess_appUserId_key" ON "UserMenuAccess"("appUserId");
`;

const FK = `ALTER TABLE "UserMenuAccess" ADD CONSTRAINT "UserMenuAccess_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE`;

// Seed konfigurasi menu MII — 3 Approver (level SAMA, hak BERBEDA) + Viewer.
const MENU_SEEDS: { username: string; label: string; menus: string[] }[] = [
  {
    username: "MII000002", label: "Bambang Prakoso (Approver · Finance Manager)",
    menus: [
      "hr:overview", "hr:directory",
      "hr:inbox", "hr:all",
      "payroll:overview", "payroll:periods", "payroll:runs", "payroll:transactions", "payroll:spt",
      "travel:requests", "travel:travel-approval", "travel:travel-claim",
    ],
  },
  {
    username: "MII000003", label: "Joko Susilo (Approver · Production Manager)",
    menus: [
      "hr:overview", "hr:directory",
      "hr:inbox", "hr:all",
      "attendance:schedules", "attendance:clocking", "attendance:overtime", "attendance:absence",
      "leave:balances", "leave:leave-request", "leave:leave-approval",
    ],
  },
  {
    username: "MII000004", label: "Sri Wahyuni (Approver · HR Director)",
    menus: [
      "hr:overview", "hr:directory",
      "hr:inbox", "hr:all",
      "leave:balances", "leave:leave-info", "leave:leave-request", "leave:leave-approval",
      "medical:claims", "medical:medical-approval",
    ],
  },
  {
    username: "MII000006", label: "Agus Salim (Viewer · IT Staff)",
    menus: [
      "hr:overview", "hr:directory",
      "hr:inbox", "hr:all",
      "leave:balances", "leave:leave-info", "leave:leave-request",
    ],
  },
];

const AGUS_EMAIL = "agus@mii.co.id";
const AGUS_PASSWORD = "onevity123";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const client = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await client.connect();

  for (const schema of SCHEMAS) {
    console.log(`[${schema}] migrasi hak akses per pengguna…`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(DDL);

    // FK idempoten
    const fkName = "UserMenuAccess_appUserId_fkey";
    const hasFk = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`,
      [fkName, schema],
    );
    if (fkName && hasFk.rowCount === 0) {
      try { await client.query(FK); } catch (e) { console.warn(`  (skip FK: ${(e as Error).message})`); }
    }

    // 2) bersihkan rule legacy bertipe grup/role (subjek kini per pengguna)
    const del = await client.query(
      `DELETE FROM "DataAccessRule" WHERE "subjectType" <> 'USER' OR ("subjectType" = 'USER' AND "appUserId" IS NULL)`,
    );
    if (del.rowCount && del.rowCount > 0) {
      console.log(`  hapus ${del.rowCount} rule legacy (ROLE/ACCESS_GROUP / tanpa pengguna) — hak akses kini per pengguna`);
    }

    // 3) seed konfigurasi menu per pengguna (idempoten — skip bila sudah ada)
    for (const seed of MENU_SEEDS) {
      const exists = await client.query(
        `SELECT 1 FROM "UserMenuAccess" uma JOIN "AppUser" u ON u.id = uma."appUserId" WHERE u.username = $1`,
        [seed.username],
      );
      if ((exists.rowCount ?? 0) > 0) continue;
      const ins = await client.query(
        `INSERT INTO "UserMenuAccess" ("id","appUserId","mode","menusJson","updatedAt")
         SELECT gen_random_uuid()::text, u.id, 'CUSTOM', $2, CURRENT_TIMESTAMP
         FROM "AppUser" u WHERE u.username = $1
         RETURNING "appUserId"`,
        [seed.username, JSON.stringify(seed.menus)],
      );
      if (ins.rowCount && ins.rowCount > 0) {
        console.log(`  seed menu: ${seed.label} — ${seed.menus.length} menu`);
      }
    }
  }

  // 4) akun demo platform Agus (bukan super admin → batasan menu terlihat)
  await client.query(`SET search_path TO public`);
  const mii = await client.query(`SELECT "id" FROM "Tenant" WHERE "schemaName" = 'tenant_pt_mitra_industri_internasional' LIMIT 1`);
  const tenantId = mii.rows[0]?.id as string | undefined;
  if (tenantId) {
    // tautkan email AppUser Agus (bila kosong)
    await client.query(
      `UPDATE "tenant_pt_mitra_industri_internasional"."AppUser" SET "email" = $1 WHERE "username" = 'MII000006' AND ("email" IS NULL OR "email" = '')`,
      [AGUS_EMAIL],
    );
    // buat user platform bila belum ada
    const pu = await client.query(`SELECT "id" FROM "User" WHERE "email" = $1`, [AGUS_EMAIL]);
    let userId = pu.rows[0]?.id as string | undefined;
    if (!userId) {
      const ins = await client.query(
        `INSERT INTO "User" ("id","email","name","passwordHash","isSuperadmin","createdAt","updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING "id"`,
        [AGUS_EMAIL, "Agus Salim", hashPassword(AGUS_PASSWORD)],
      );
      userId = ins.rows[0].id;
      console.log(`[platform] akun demo dibuat: ${AGUS_EMAIL} (role workspace HR — bukan super admin)`);
    }
    // membership MII (role HR — bukan OWNER/ADMIN agar tidak super admin)
    const mem = await client.query(
      `SELECT 1 FROM "UserTenant" WHERE "userId" = $1 AND "tenantId" = $2`,
      [userId, tenantId],
    );
    if ((mem.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO "UserTenant" ("id","userId","tenantId","role","createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, 'HR', CURRENT_TIMESTAMP)`,
        [userId, tenantId],
      );
      console.log(`[platform] membership MII (role HR) dibuat untuk ${AGUS_EMAIL}`);
    }
  }

  await client.end();
  console.log("DONE — hak akses menu & rule data kini PER PENGGUNA");
}

main().catch((e) => { console.error(e); process.exit(1); });
