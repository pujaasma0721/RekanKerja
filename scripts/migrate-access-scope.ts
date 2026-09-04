// Migrasi SKEMA AKSES DATA (Task 30) ke tenant existing:
//   1. DDL idempoten — tabel DataAccessRule (+ FK & index) bila belum ada
//   2. seed rule default bermakna:
//      a. ROLE "HR Manager"  → akses penuh (tanpa kriteria)
//      b. ROLE "HR Staff"    → akses penuh (tanpa kriteria)
//      c. ROLE "Approver"    → parameter demo: unit organisasi Production
// (super admin role Admin & workspace OWNER/ADMIN, atasan langsung, dan
//  data diri sendiri otomatis — tanpa rule, diterapkan mesin akses.)
// Jalankan: bun run scripts/migrate-access-scope.ts
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

    // ---- seed rule default (idempoten via code unik) ----
    const exists = await client.query(`SELECT COUNT(*)::int AS n FROM "DataAccessRule"`);
    if (exists.rows[0].n > 0) {
      console.log(`  rule akses sudah ada (${exists.rows[0].n}) — skip seed`);
      continue;
    }

    // unit organisasi Production (MII) — untuk rule demo parameter Approver
    const prod = await client.query(`SELECT "id" FROM "OrgUnit" WHERE "code" = 'PROD' OR "name" ILIKE '%production%' LIMIT 1`);
    const prodId = prod.rows[0]?.id ?? null;

    await client.query(
      `INSERT INTO "DataAccessRule" ("id","code","name","description","subjectType","role","priority","active","updatedAt")
       VALUES (gen_random_uuid()::text, $1,$2,$3,'ROLE','HR Manager',10,true, CURRENT_TIMESTAMP)`,
      ["ACC-HR-FULL", "Akses Penuh — HR Manager", "Semua pemegang role HR Manager dapat mengakses seluruh data karyawan (HR ops penuh)."],
    );
    await client.query(
      `INSERT INTO "DataAccessRule" ("id","code","name","description","subjectType","role","priority","active","updatedAt")
       VALUES (gen_random_uuid()::text, $1,$2,$3,'ROLE','HR Staff',10,true, CURRENT_TIMESTAMP)`,
      ["ACC-HRSTAFF-FULL", "Akses Penuh — HR Staff", "Semua pemegang role HR Staff dapat mengakses seluruh data karyawan (operasional HR)."],
    );
    if (prodId) {
      await client.query(
        `INSERT INTO "DataAccessRule" ("id","code","name","description","subjectType","role","orgUnitId","priority","active","updatedAt")
         VALUES (gen_random_uuid()::text, $1,$2,$3,'ROLE','Approver',$4,20,true, CURRENT_TIMESTAMP)`,
        ["ACC-APPROVER-PROD", "Approver — Unit Produksi", "Contoh rule parametrik: pemegang role Approver hanya dapat mengakses karyawan di unit organisasi Production.", prodId],
      );
    }
    console.log(`  seed: ACC-HR-FULL, ACC-HRSTAFF-FULL${prodId ? ", ACC-APPROVER-PROD" : ""}`);
  }

  await client.end();
  console.log("DONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
