// Migrasi RULE AKSES DATA KARYAWAN PER PENGGUNA (Task 30, dikaji ulang
// Task 31 — hak akses diatur per user, bukan per grup/role) ke tenant existing:
//   1. DDL idempoten — tabel DataAccessRule (+ FK & index) bila belum ada
//   2. seed rule per pengguna bermakna:
//      a. Bambang (MII000002) — parameter demo: unit Finance
//      b. Joko (MII000003)    — parameter demo: unit Production
// (super admin role Admin & workspace OWNER/ADMIN, atasan langsung, dan
//  data diri sendiri otomatis — tanpa rule, diterapkan mesin akses.)
// Jalankan: bun run scripts/migrate-access-scope.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const DDL = `
CREATE TABLE IF NOT EXISTS "DataAccessRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subjectType" TEXT NOT NULL,
    "appUserId" TEXT,
    "accessGroupId" TEXT,
    "role" TEXT,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "gradeId" TEXT,
    "positionLevelId" TEXT,
    "employmentStatus" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataAccessRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DataAccessRule_code_key" ON "DataAccessRule"("code");
CREATE INDEX IF NOT EXISTS "DataAccessRule_subjectType_active_idx" ON "DataAccessRule"("subjectType", "active");
`;

const FKS = [
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleUser" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleGroup" FOREIGN KEY ("accessGroupId") REFERENCES "AccessGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleOffice" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleLocation" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleOrgUnit" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRulePosition" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRuleGrade" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "DataAccessRule" ADD CONSTRAINT "AccessRulePositionLevel" FOREIGN KEY ("positionLevelId") REFERENCES "PositionLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

async function main() {
  const client = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await client.connect();

  for (const schema of SCHEMAS) {
    console.log(`[${schema}] migrasi skema akses data…`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(DDL);
    for (const fk of FKS) {
      // idempoten: cek constraint sudah ada
      const name = fk.match(/CONSTRAINT "([^"]+)"/)![1];
      const r = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`,
        [name, schema],
      );
      if (r.rowCount === 0) {
        try { await client.query(fk); } catch (e) { console.warn(`  (skip FK ${name}: ${(e as Error).message})`); }
      }
    }

    // ---- seed rule per pengguna (idempoten per kode rule) ----
    const seedUserRule = async (code: string, name: string, desc: string, username: string, orgUnitId: string | null) => {
      if (!orgUnitId) return false;
      const ex = await client.query(`SELECT 1 FROM "DataAccessRule" WHERE "code" = $1`, [code]);
      if ((ex.rowCount ?? 0) > 0) return false;
      const ins = await client.query(
        `INSERT INTO "DataAccessRule" ("id","code","name","description","subjectType","appUserId","orgUnitId","priority","active","updatedAt")
         SELECT gen_random_uuid()::text, $1,$2,$3,'USER', u."id", $4, 20, true, CURRENT_TIMESTAMP
         FROM "AppUser" u WHERE u."username" = $5 RETURNING "id"`,
        [code, name, desc, orgUnitId, username],
      );
      return (ins.rowCount ?? 0) > 0;
    };

    // unit organisasi demo (MII) — Finance & Production
    const fin = await client.query(`SELECT "id" FROM "OrgUnit" WHERE "code" LIKE '%FIN%' OR "name" ILIKE '%finance%' ORDER BY "level" ASC LIMIT 1`);
    const finId = fin.rows[0]?.id ?? null;
    const prod = await client.query(`SELECT "id" FROM "OrgUnit" WHERE "code" LIKE '%PROD%' OR "name" ILIKE '%production%' ORDER BY "level" ASC LIMIT 1`);
    const prodId = prod.rows[0]?.id ?? null;

    const a = await seedUserRule(
      "ACC-BAMBANG-FIN", "Bambang — Unit Finance",
      "Rule parametrik per pengguna: Bambang Prakoso dapat mengakses karyawan di unit organisasi Finance & Accounting.",
      "MII000002", finId,
    );
    const b = await seedUserRule(
      "ACC-JOKO-PROD", "Joko — Unit Produksi",
      "Rule parametrik per pengguna: Joko Susilo dapat mengakses karyawan di unit organisasi Production.",
      "MII000003", prodId,
    );
    if (a || b) console.log(`  seed rule per pengguna: ${a ? "ACC-BAMBANG-FIN " : ""}${b ? "ACC-JOKO-PROD" : ""}`.trim());
  }

  await client.end();
  console.log("DONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
