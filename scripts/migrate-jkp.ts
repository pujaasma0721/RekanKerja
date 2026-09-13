// Migrasi JKP — Jaminan Kehilangan Pekerjaan (Task 52-c, PP 6/2025):
//   1. ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS
//      jkpEmployeeRate (0.0024) / jkpCompanyRate (0.0022) / jkpSalaryCap
//      (5000000) — DEFAULT mengisi baris lama (Prisma default hanya baris baru).
//   2. INSERT komponen wage JKP_C (Earning, formula JKP_BASE*JKP_RATE_CO,
//      includeInTHP false, basis JKP) & JKP_E (Deduction, JKP_BASE*JKP_RATE_EMP)
//      — ON CONFLICT ("code") DO NOTHING.
//   3. Tambahkan JKP_C/JKP_E ke template DEFAULT & BS bila belum ada
//      (FREELANCE sengaja tanpa BPJS — di luar program).
// Idempoten — aman di-rerun. IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-jkp.ts
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
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);

      // (1) kolom parameter regulasi — DEFAULT langsung mengisi baris lama.
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0024`);
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0022`);
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpSalaryCap" DOUBLE PRECISION NOT NULL DEFAULT 5000000`);

      // (2) komponen wage JKP_C / JKP_E.
      const jkpC = await c.query(
        `INSERT INTO "WageComponent"
           ("id","code","name","type","wageType","calcMethod","amount","formula",
            "incomeTaxMethod","processMethod","roundingType","roundingValue","prorated",
            "taxable","includeInBasicIncome","includeInTHP","displayInPaySlip","applyThrRules",
            "jamsostekBasis","active","createdAt")
         VALUES ('wage_comp_jkp_c','JKP_C','BPJS JKP Perusahaan 0,22%','Earning','Jamsostek','Formula',0,
                 'JKP_BASE*JKP_RATE_CO','Regular','GrossToNet','Nearest',1,false,
                 true,false,false,true,false,'JKP',true,CURRENT_TIMESTAMP)
         ON CONFLICT ("code") DO NOTHING`,
      );
      const jkpE = await c.query(
        `INSERT INTO "WageComponent"
           ("id","code","name","type","wageType","calcMethod","amount","formula",
            "incomeTaxMethod","processMethod","roundingType","roundingValue","prorated",
            "taxable","includeInBasicIncome","includeInTHP","displayInPaySlip","applyThrRules",
            "jamsostekBasis","active","createdAt")
         VALUES ('wage_comp_jkp_e','JKP_E','Potongan BPJS JKP 0,24%','Deduction','Jamsostek','Formula',0,
                 'JKP_BASE*JKP_RATE_EMP','Regular','GrossToNet','Nearest',1,false,
                 true,false,false,true,false,'JKP',true,CURRENT_TIMESTAMP)
         ON CONFLICT ("code") DO NOTHING`,
      );

      // (3) daftarkan ke template DEFAULT & BS (bila belum ada item-nya).
      let tplItems = 0;
      for (const tplCode of ["DEFAULT", "BS"]) {
        const added = await c.query(
          `INSERT INTO "WageTemplateItem" ("id","wageTemplateId","wageComponentId","sortOrder")
           SELECT 'wti_jkp_c_' || t."code", t."id", wc."id", 99
           FROM "WageTemplate" t, "WageComponent" wc
           WHERE t."code" = $1 AND wc."code" = 'JKP_C'
             AND NOT EXISTS (
               SELECT 1 FROM "WageTemplateItem" i
               WHERE i."wageTemplateId" = t."id" AND i."wageComponentId" = wc."id"
             )
           ON CONFLICT DO NOTHING`,
          [tplCode],
        );
        tplItems += added.rowCount ?? 0;
        const addedE = await c.query(
          `INSERT INTO "WageTemplateItem" ("id","wageTemplateId","wageComponentId","sortOrder")
           SELECT 'wti_jkp_e_' || t."code", t."id", wc."id", 99
           FROM "WageTemplate" t, "WageComponent" wc
           WHERE t."code" = $1 AND wc."code" = 'JKP_E'
             AND NOT EXISTS (
               SELECT 1 FROM "WageTemplateItem" i
               WHERE i."wageTemplateId" = t."id" AND i."wageComponentId" = wc."id"
             )
           ON CONFLICT DO NOTHING`,
          [tplCode],
        );
        tplItems += addedE.rowCount ?? 0;
      }

      console.log(
        `[${schema}] JKP (Task 52-c): kolom regulasi siap · komponen ${(jkpC.rowCount ?? 0) + (jkpE.rowCount ?? 0)} baru · template item +${tplItems}`,
      );
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-jkp")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
