// Migrasi JKP — Jaminan Kehilangan Pekerjaan (Task 52-c, PP 6/2025; REVISI
// F-01 BPA-AUDIT-53 Task 54 — struktur iuran yang benar):
//   PP 6/2025 Pasal 11 (perubahan PP 37/2021): iuran JKP 0,36% dari upah
//   sebulan (basis plafon Rp5jt) — 0,22% DITANGGUNG PEMERINTAH (APBN) dan
//   0,14% dari REKOMPOSISI iuran JKK yang sudah dibayar pemberi kerja.
//   Konsekuensi: TIDAK ADA iuran pekerja (porsi 0,10% pada PP 37/2021 lama
//   DIHAPUS) dan TIDAK ADA beban iuran baru perusahaan (0,14% dipotong dari
//   premi JKK yang sudah ada). Versi lama skrip ini memasang potongan THP
//   0,24% + beban perusahaan 0,22% — SALAH struktur & besaran (audit F-01).
// Langkah (idempoten, aman di-rerun):
//   1. ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS
//      jkpEmployeeRate (0 — tanpa potongan pekerja) / jkpCompanyRate
//      (0.0014 — rekomposisi JKK, informatif) / jkpSalaryCap (5000000).
//   2. UPDATE semua baris PayrollRegulation → nilai benar (memperbaiki
//      instalasi lama yang memuat 0.0024/0.0022).
//   3. NONAKTIFKAN komponen JKP_C/JKP_E bila ada (installasi Task 52-c lama)
//      + HAPUS item template DEFAULT/BS yang memuatnya — run berikutnya
//      tidak lagi memotong THP / menambah beban fiktif. Baris komponen
//      dibiarkan (active=false) agar snapshot run historis tetap terbaca.
// IN-PROCESS oleh parity-runner ATAU CLI:
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
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpEmployeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpCompanyRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0014`);
      await c.query(`ALTER TABLE "PayrollRegulation" ADD COLUMN IF NOT EXISTS "jkpSalaryCap" DOUBLE PRECISION NOT NULL DEFAULT 5000000`);

      // (2) F-01 — nilai struktur benar utk instalasi lama (0,24%/0,22% salah).
      const reg = await c.query(
        `UPDATE "PayrollRegulation" SET "jkpEmployeeRate" = 0, "jkpCompanyRate" = 0.0014, "jkpSalaryCap" = 5000000`,
      );

      // (3) F-01 — nonaktifkan komponen JKP_C/JKP_E instalasi lama.
      const comp = await c.query(
        `UPDATE "WageComponent" SET "active" = false WHERE "code" IN ('JKP_C','JKP_E') AND "active" = true`,
      );
      // hapus item template DEFAULT/BS yang memuat JKP (run berikutnya bersih).
      const items = await c.query(
        `DELETE FROM "WageTemplateItem" wti
         USING "WageTemplate" wt, "WageComponent" wc
         WHERE wti."wageTemplateId" = wt.id AND wti."wageComponentId" = wc.id
           AND wt."code" IN ('DEFAULT','BS') AND wc."code" IN ('JKP_C','JKP_E')`,
      );

      console.log(
        `[${schema}] jkp-fix (F-01): PayrollRegulation → pegawai 0% + rekomposisi JKK 0,14% (${reg.rowCount ?? 0} baris) · komponen JKP dinonaktifkan (${comp.rowCount ?? 0}) · item template JKP dihapus (${items.rowCount ?? 0})`,
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
