// Migrasi HAK AKSI MENU PER PENGGUNA (Task 31 + 32) ke tenant existing:
//   1. DDL idempoten — tabel UserMenuAccess (+ FK & unique index)
//   2. bersihkan rule akses data lama bertipe grup/role (subjek per pengguna)
//   3. UPGRADE format lama: menusJson array string (Task 31) → peta aksi
//      { view, create, update, delete, ops } (Task 32, izin penuh) — idempoten
//   4. seed konfigurasi AKSI per pengguna (demo MII — level sama, hak AKSI
//      berbeda: 3 Approver dengan kombinasi aksi/operasi berbeda + Viewer
//      read-only yang tetap bisa mengajukan cutinya sendiri)
//   5. akun demo platform agus@mii.co.id (role workspace HR — BUKAN super
//      admin) tertaut ke AppUser Agus Salim → batasan aksi bisa dilihat
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

// ================= seed AKSI (Task 32) =================
// Bentuk: { [menuKey]: { view, create, update, delete, ops: { opKey: bool } } }
// Nilai yang tidak ditulis = true (default izin). false = dinegaskan.
// Operasi khusus ditulis EKSPLISIT untuk menu katalog agar deterministik.

type Crud = { view?: boolean; create?: boolean; update?: boolean; delete?: boolean; ops?: Record<string, boolean> };
type Seed = { username: string; label: string; menus: Record<string, Crud> };

const full = (): Crud => ({});
const viewOnly = (): Crud => ({ create: false, update: false, delete: false });

const MENU_SEEDS: Seed[] = [
  {
    // Finance Manager: payroll penuh aksi proses, direktori hanya lihat+ubah
    username: "MII000002", label: "Bambang Prakoso (Approver · Finance Manager)",
    menus: {
      "hr:overview": full(),
      "hr:directory": { create: false, update: true, delete: false },
      "hr:inbox": { ops: { approve: true } },
      "hr:all": { ops: { approve: true } },
      "payroll:overview": full(),
      "payroll:periods": full(),
      "payroll:runs": { create: true, update: true, delete: false, ops: { calculate: true, confirm: true, markPaid: true, cancel: true, export: true } },
      "payroll:transactions": full(),
      "payroll:spt": viewOnly(),
      "travel:requests": { create: true, update: true, delete: false, ops: { cancel: true } },
      "travel:travel-approval": { ops: { approve: true } },
      "travel:travel-claim": viewOnly(),
    },
  },
  {
    // Production Manager: atasan produksi — approve lembur/cuti, tanpa hapus
    username: "MII000003", label: "Joko Susilo (Approver · Production Manager)",
    menus: {
      "hr:overview": full(),
      "hr:directory": viewOnly(),
      "hr:inbox": { ops: { approve: true } },
      "hr:all": { ops: { approve: true } },
      "attendance:schedules": full(),
      "attendance:clocking": { create: false, update: true, delete: false },
      "attendance:overtime": { create: true, update: true, delete: false, ops: { approve: true } },
      "attendance:absence": viewOnly(),
      "leave:balances": viewOnly(),
      "leave:leave-request": { create: true, update: true, delete: false, ops: { cancel: true } },
      "leave:leave-approval": { ops: { approve: true } },
    },
  },
  {
    // HR Director: direktori penuh (incl. hapus), approve cuti + settlement medis
    username: "MII000004", label: "Sri Wahyuni (Approver · HR Director)",
    menus: {
      "hr:overview": full(),
      "hr:directory": full(),
      "hr:inbox": { ops: { approve: true } },
      "hr:all": { ops: { approve: true } },
      "leave:balances": viewOnly(),
      "leave:leave-info": viewOnly(),
      "leave:leave-request": { create: true, update: true, delete: false, ops: { cancel: true } },
      "leave:leave-approval": { ops: { approve: true } },
      "leave:leave-encashment": { create: true, update: true, delete: false, ops: { approve: true } },
      "medical:claims": viewOnly(),
      "medical:medical-claim": { create: true, update: true, delete: false, ops: { submit: true, cancel: true } },
      "medical:medical-approval": { ops: { approve: true, settle: true } },
    },
  },
  {
    // IT Staff (Viewer): direktori READ-ONLY, tapi tetap bisa mengajukan cuti
    // miliknya sendiri (create + cancel), tanpa aksi persetujuan apa pun.
    username: "MII000006", label: "Agus Salim (Viewer · IT Staff)",
    menus: {
      "hr:overview": viewOnly(),
      "hr:directory": viewOnly(),
      "leave:balances": viewOnly(),
      "leave:leave-info": viewOnly(),
      "leave:leave-request": { create: true, update: false, delete: false, ops: { cancel: true } },
    },
  },
];

/** Lengkapi seed → peta aksi eksplisit (semua boolean + ops katalog eksplisit). */
function expandSeed(menus: Record<string, Crud>): string {
  const out: Record<string, Crud> = {};
  for (const [key, partial] of Object.entries(menus)) {
    const ops: Record<string, boolean> = {};
    // katalog ops menu ini → default nilai seed (tidak ditulis = true)
    const catalog = MENU_OPS_KEYS[key] ?? [];
    for (const op of catalog) ops[op] = partial.ops?.[op] ?? true;
    // ops non-katalog yang ditulis manual tetap dibawa
    for (const [k, v] of Object.entries(partial.ops ?? {})) ops[k] = v;
    out[key] = {
      view: true,
      create: partial.create ?? true,
      update: partial.update ?? true,
      delete: partial.delete ?? true,
      ops,
    };
  }
  return JSON.stringify(out);
}

// kunci operasi katalog (selaras src/onevity/shared/lib/menu-perms.ts)
const MENU_OPS_KEYS: Record<string, string[]> = {
  "hr:inbox": ["approve"],
  "hr:all": ["approve"],
  "payroll:runs": ["calculate", "confirm", "markPaid", "cancel", "export"],
  "payroll:benefits": ["approve", "schedule", "markPaid"],
  "attendance:overtime": ["approve"],
  "attendance:workoff": ["approve"],
  "attendance:assignment-schedule": ["end"],
  "leave:leave-request": ["cancel"],
  "leave:leave-approval": ["approve"],
  "leave:leave-encashment": ["approve"],
  "travel:travel-request": ["cancel"],
  "travel:travel-approval": ["approve"],
  "travel:travel-claim": ["cancel"],
  "travel:travel-claim-approval": ["approve", "transfer"],
  "medical:medical-claim": ["submit", "cancel"],
  "medical:medical-approval": ["approve", "settle"],
  "medical:medical-adjustment": ["approve"],
};

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
    console.log(`[${schema}] migrasi hak aksi menu per pengguna…`);
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

    // 3) UPGRADE format lama: array string → peta aksi izin penuh (idempoten)
    const legacy = await client.query(
      `SELECT "appUserId", "menusJson" FROM "UserMenuAccess" WHERE "menusJson" LIKE '[%'`,
    );
    for (const row of legacy.rows as { appUserId: string; menusJson: string }[]) {
      try {
        const arr = JSON.parse(row.menusJson);
        if (!Array.isArray(arr)) continue;
        const map: Record<string, Crud> = {};
        for (const k of arr) {
          if (typeof k === "string" && k.includes(":")) {
            const ops: Record<string, boolean> = {};
            for (const op of MENU_OPS_KEYS[k] ?? []) ops[op] = true;
            map[k] = { view: true, create: true, update: true, delete: true, ops };
          }
        }
        await client.query(
          `UPDATE "UserMenuAccess" SET "menusJson" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "appUserId" = $1`,
          [row.appUserId, JSON.stringify(map)],
        );
        console.log(`  upgrade format aksi: ${row.appUserId} (${arr.length} menu → peta aksi penuh)`);
      } catch {
        // JSON rusak — biarkan (mode ALL default aman)
      }
    }

    // 4) seed konfigurasi AKSI per pengguna — upsert (deterministik, idempoten)
    for (const seed of MENU_SEEDS) {
      const json = expandSeed(seed.menus);
      const up = await client.query(
        `INSERT INTO "UserMenuAccess" ("id","appUserId","mode","menusJson","updatedAt")
         SELECT gen_random_uuid()::text, u.id, 'CUSTOM', $2, CURRENT_TIMESTAMP
         FROM "AppUser" u WHERE u.username = $1
         ON CONFLICT ("appUserId") DO UPDATE SET "mode" = 'CUSTOM', "menusJson" = $2, "updatedAt" = CURRENT_TIMESTAMP`,
        [seed.username, json],
      );
      if (up.rowCount && up.rowCount > 0) {
        console.log(`  seed aksi: ${seed.label} — ${Object.keys(seed.menus).length} menu`);
      }
    }
  }

  // 5) akun demo platform Agus (bukan super admin → batasan aksi terlihat)
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
  console.log("DONE — hak aksi menu kini PER PENGGUNA hingga level aksi & operasi");
}

main().catch((e) => { console.error(e); process.exit(1); });
