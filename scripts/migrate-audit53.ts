// Migrasi BPA-AUDIT-53 (Task 54 — "perbaiki semua") — remediasi audit
// kepatuhan Task 49-52 terhadap peraturan pemerintah:
//   F-02  Re-seed TABEL TER RESMI Lampiran PMK 168/2023 (44/40/41 lapisan,
//         maksimum 34%) — tabel lama 36 baris/kategori menyimpang dari
//         lampiran resmi (brutto & batas salah, max 20%). DELETE + INSERT
//         penuh (TerRate tidak direferensikan FK — run item snapshot).
//   F-07  Cuti melahirkan 3+3 bersyarat UU KIA 4/2024 Ps.4(3)(a): hak dasar
//         3 bulan (bukan 6 flat) + perpanjangan bulan 4-6 HANYA dengan surat
//         keterangan dokter (gerbang note di leave-service). Keguguran 1,5
//         bln + perpanjangan sesuai rekomendasi dokter (max 3 bln).
//   F-08  Kutipan regulasi deskripsi jenis cuti (CT-LAHIR suami & CT-GUGUR-I
//         — dasar UU 13/2003 Ps.93, bukan "PP 35/2021").
//   F-06  Komponen PKWT_KOMP: incomeTaxMethod NonTaxable → SeveranceFinal
//         (PPh final lapisan PP 36/2021 dihitung settlement-service sebagai
//         baris PKWT_TAX) + komponen PKWT_TAX baru.
// Idempoten — aman di-rerun. IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-audit53.ts
import "./lib/env";
import { Client } from "pg";
// F-02 — sumber tunggal tabel TER resmi (pure data, tanpa dependency).
import { TER_OFFICIAL } from "../src/onevity/payroll/services/ter-official";

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

      // (1) F-02 — re-seed tabel TER resmi (replace penuh).
      const del = await c.query(`DELETE FROM "TerRate"`);
      const values = TER_OFFICIAL.map(
        (r) =>
          `('ter_${r.category.toLowerCase()}_${r.lowerLimit}','${r.category}',${r.lowerLimit},${r.upperLimit ?? "NULL"},${r.rate})`,
      ).join(",");
      await c.query(
        `INSERT INTO "TerRate" ("id","category","lowerLimit","upperLimit","rate") VALUES ${values}`,
      );
      const cnt = await c.query<{ a: number; b: number; c: number }>(
        `SELECT COUNT(*) FILTER (WHERE "category"='A')::int AS a,
                COUNT(*) FILTER (WHERE "category"='B')::int AS b,
                COUNT(*) FILTER (WHERE "category"='C')::int AS c
         FROM "TerRate"`,
      );
      const r = cnt.rows[0];

      // (2) F-07 — cuti melahirkan 3+3 bersyarat (UU KIA 4/2024 Ps.4(3)(a)).
      await c.query(
        `UPDATE "LeaveType" SET
           "entitlement" = 3,
           "maxPerRequest" = 6,
           "allowAdvance" = true,
           "description" = '3 bulan pertama (UU KIA 4/2024 Ps.4(3)(a)) — perpanjangan s.d. 3 bulan berikutnya HANYA dengan kondisi khusus medis (wajib surat keterangan dokter, isi di catatan pengajuan)'
         WHERE "code" = 'CT-LAHIR-P'`,
      );
      await c.query(
        `UPDATE "LeaveType" SET
           "maxPerRequest" = 3,
           "allowAdvance" = true,
           "description" = '1,5 bulan (UU 13/2003 Ps.82(2) & UU KIA 4/2024 Ps.4(3)(b)) — dapat lebih lama sesuai rekomendasi dokter kandungan/psikiater (wajib catatan surat)'
         WHERE "code" = 'CT-GUGUR-P'`,
      );

      // (3) F-08 — kutipan regulasi deskripsi (dasar UU 13/2003 Ps.93).
      await c.query(
        `UPDATE "LeaveType" SET
           "description" = 'Istri sah karyawan melahirkan (UU 13/2003 Ps.93 — suami beristirahat 2 hari; UU KIA 4/2024 Ps.8 suami ikut beristirahat)'
         WHERE "code" = 'CT-LAHIR'`,
      );
      await c.query(
        `UPDATE "LeaveType" SET
           "description" = 'Istri keguguran — untuk suami (UU 13/2003 Ps.93)'
         WHERE "code" = 'CT-GUGUR-I'`,
      );

      // (4) F-06 — komponen settlement: PKWT_KOMP SeveranceFinal + PKWT_TAX.
      // PKWT_KOMP find-or-create (tenant lama belum pernah memproses settlement
      // → komponen dibuat di sini dengan definisi benar, bukan menunggu
      // ensureSettlementWageComponents lazy).
      const pkwtKomp = await c.query(
        `UPDATE "WageComponent" SET "incomeTaxMethod" = 'SeveranceFinal', "taxable" = true
         WHERE "code" = 'PKWT_KOMP'`,
      );
      const pkwtKompNew = await c.query(
        `INSERT INTO "WageComponent"
           ("id","code","name","type","wageType","calcMethod","amount","formula",
            "incomeTaxMethod","processMethod","roundingType","roundingValue","prorated",
            "taxable","includeInBasicIncome","includeInTHP","displayInPaySlip","applyThrRules",
            "jamsostekBasis","accountDebitCode","sptReference","active","createdAt")
         VALUES ('wage_comp_pkwt_komp','PKWT_KOMP','Uang Kompensasi PKWT (PP 35/2021)','Earning','Compensation','Fixed',0,NULL,
                 'SeveranceFinal','GrossToNet','Nearest',1,false,
                 true,false,true,true,false,
                 NULL,'5102','Gaji',true,CURRENT_TIMESTAMP)
         ON CONFLICT ("code") DO NOTHING`,
      );
      const pkwtTax = await c.query(
        `INSERT INTO "WageComponent"
           ("id","code","name","type","wageType","calcMethod","amount","formula",
            "incomeTaxMethod","processMethod","roundingType","roundingValue","prorated",
            "taxable","includeInBasicIncome","includeInTHP","displayInPaySlip","applyThrRules",
            "jamsostekBasis","accountCreditCode","active","createdAt")
         VALUES ('wage_comp_pkwt_tax','PKWT_TAX','PPh21 Final atas Kompensasi PKWT','Deduction','FinalTax','Fixed',0,NULL,
                 'NonTaxable','GrossToNet','Nearest',1,false,
                 false,false,true,true,false,
                 NULL,'2102',true,CURRENT_TIMESTAMP)
         ON CONFLICT ("code") DO NOTHING`,
      );

      console.log(
        `[${schema}] audit53: TER ${del.rowCount ?? 0} lama dihapus → resmi A:${r.a} B:${r.b} C:${r.c} baris · CT-LAHIR-P 3+3 · deskripsi Ps.93 · PKWT_KOMP SeveranceFinal (${pkwtKomp.rowCount ?? 0} update / ${pkwtKompNew.rowCount ?? 0} baru) · PKWT_TAX ${pkwtTax.rowCount ?? 0} baru`,
      );
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-audit53")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
