// Migrasi F0-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F0) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS × 10: RecruitmentMethod, AdMediaType,
//      EmploymentAgency, RecruitmentCostItem, Skill, RequiredDocument,
//      EvaluationCategory, EvaluationScale, SlaGroup, SelectionProcess
//      (+ unique code + index aktif/sortOrder selaras tenant-ddl.sql).
//   2. Seed default master rekrutmen + katalog tahap seleksi standar
//      (insert-only bila code belum ada):
//      · RecruitmentMethod: Internal Job Posting, Matching Recommendation
//        (Internal), Advertensi, Agency, Kampus, Referal, Portal Web.
//      · AdMediaType: Koran, Portal, LinkedIn, Media Sosial, Lainnya.
//      · RecruitmentCostItem: Iklan, Fee Agency, Psikotes, Medical Check-Up,
//        Bonus Referal, General (non-budget) — padanan oranHR.
//      · Skill: B. Inggris lisan/tulis, Komputer, Others.
//      · RequiredDocument: CV (wajib), KTP (wajib), Ijazah, Transkrip, NPWP,
//        SKCK, Pas Foto, Surat Lamaran, Paklaring.
//      · EvaluationCategory + EvaluationScale (1–5 ranking).
//      · SlaGroup: Interview 30 hari, Administrasi 7, Psikotes 14,
//        Offering 14, Medical 14.
//      · SelectionProcess (rantai default per plan F0): Interview HR →
//        Psikotes (manual) → Interview User → Offering Salary → Medical.
// Dapat diimpor IN-PROCESS oleh src/rekankerja/shared/lib/parity-runner.ts
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-f0.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

// Urutan kolom selaras prisma/schema-tenant.prisma (tenant-ddl.sql).
const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "RecruitmentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'External',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentMethod_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AdMediaType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdMediaType_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "EmploymentAgency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "contact" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmploymentAgency_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RecruitmentCostItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentCostItem_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Skill" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RequiredDocument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileType" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequiredDocument_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "EvaluationCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvaluationCategory_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "EvaluationScale" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ranking" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvaluationScale_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "SlaGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlaGroup_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "SelectionProcess" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "resultType" TEXT NOT NULL DEFAULT 'Qualitative',
    "appliesInternal" BOOLEAN NOT NULL DEFAULT true,
    "appliesExternal" BOOLEAN NOT NULL DEFAULT true,
    "minResultPass" DOUBLE PRECISION,
    "processOrder" INTEGER NOT NULL DEFAULT 1,
    "slaDays" INTEGER,
    "needAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SelectionProcess_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecruitmentMethod_code_key" ON "RecruitmentMethod"("code")`,
  `CREATE INDEX IF NOT EXISTS "RecruitmentMethod_active_sort_idx" ON "RecruitmentMethod"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AdMediaType_code_key" ON "AdMediaType"("code")`,
  `CREATE INDEX IF NOT EXISTS "AdMediaType_active_sort_idx" ON "AdMediaType"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EmploymentAgency_code_key" ON "EmploymentAgency"("code")`,
  `CREATE INDEX IF NOT EXISTS "EmploymentAgency_active_sort_idx" ON "EmploymentAgency"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecruitmentCostItem_code_key" ON "RecruitmentCostItem"("code")`,
  `CREATE INDEX IF NOT EXISTS "RecruitmentCostItem_active_sort_idx" ON "RecruitmentCostItem"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Skill_code_key" ON "Skill"("code")`,
  `CREATE INDEX IF NOT EXISTS "Skill_active_sort_idx" ON "Skill"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RequiredDocument_code_key" ON "RequiredDocument"("code")`,
  `CREATE INDEX IF NOT EXISTS "RequiredDocument_active_sort_idx" ON "RequiredDocument"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationCategory_code_key" ON "EvaluationCategory"("code")`,
  `CREATE INDEX IF NOT EXISTS "EvaluationCategory_active_sort_idx" ON "EvaluationCategory"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationScale_code_key" ON "EvaluationScale"("code")`,
  `CREATE INDEX IF NOT EXISTS "EvaluationScale_active_sort_idx" ON "EvaluationScale"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SlaGroup_code_key" ON "SlaGroup"("code")`,
  `CREATE INDEX IF NOT EXISTS "SlaGroup_active_sort_idx" ON "SlaGroup"("active", "sortOrder")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SelectionProcess_code_key" ON "SelectionProcess"("code")`,
  `CREATE INDEX IF NOT EXISTS "SelectionProcess_active_sort_idx" ON "SelectionProcess"("active", "sortOrder")`,
];

// ---- Seed default (insert-only bila code belum ada — idempoten) ----

type SeedRow = { table: string; code: string; cols: string[]; vals: (string | number | boolean | null)[] };

const MASTER_SEED: SeedRow[] = [
  // RecruitmentMethod (padanan oranHR Recruitment Method Desc)
  { table: "RecruitmentMethod", code: "IJP", cols: ["name", "scope", "sortOrder"], vals: ["Internal Job Posting", "Internal", 1] },
  { table: "RecruitmentMethod", code: "MATCHING", cols: ["name", "scope", "sortOrder"], vals: ["Matching Recommendation", "Internal", 2] },
  { table: "RecruitmentMethod", code: "ADVERT", cols: ["name", "scope", "sortOrder"], vals: ["Advertensi", "External", 3] },
  { table: "RecruitmentMethod", code: "AGENCY", cols: ["name", "scope", "sortOrder"], vals: ["Employment Agency", "External", 4] },
  { table: "RecruitmentMethod", code: "CAMPUS", cols: ["name", "scope", "sortOrder"], vals: ["Rekrutmen Kampus", "External", 5] },
  { table: "RecruitmentMethod", code: "REFERRAL", cols: ["name", "scope", "sortOrder"], vals: ["Referal Karyawan", "Both", 6] },
  { table: "RecruitmentMethod", code: "WEBPORTAL", cols: ["name", "scope", "sortOrder"], vals: ["Portal Web Perusahaan", "External", 7] },
  // AdMediaType (padanan oranHR Ad Media Type: Newspaper, Portal News…)
  { table: "AdMediaType", code: "KORAN", cols: ["name", "sortOrder"], vals: ["Koran", 1] },
  { table: "AdMediaType", code: "PORTAL", cols: ["name", "sortOrder"], vals: ["Portal Lowongan", 2] },
  { table: "AdMediaType", code: "LINKEDIN", cols: ["name", "sortOrder"], vals: ["LinkedIn", 3] },
  { table: "AdMediaType", code: "MEDSOS", cols: ["name", "sortOrder"], vals: ["Media Sosial", 4] },
  { table: "AdMediaType", code: "LAINNYA", cols: ["name", "sortOrder"], vals: ["Lainnya", 5] },
  // EmploymentAgency — contoh demo (tenant bebas mengubah/hapus)
  { table: "EmploymentAgency", code: "AGENCY-DEMO", cols: ["name", "address", "contact", "note", "sortOrder"], vals: ["PT Solusi Talenta Nusantara", "Jl. Gatot Subroto Kav. 21, Jakarta", "021-5550-889", "Vendor rekrutmen contoh (dapat diubah)", 1] },
  // RecruitmentCostItem (padanan oranHR Recruitment Cost Item)
  { table: "RecruitmentCostItem", code: "IKLAN", cols: ["name", "description", "sortOrder"], vals: ["Biaya Iklan", "Advertensi lowongan (media/portal)", 1] },
  { table: "RecruitmentCostItem", code: "FEE_AGENCY", cols: ["name", "description", "sortOrder"], vals: ["Fee Agency", "Fee konsultansi/penempatan vendor", 2] },
  { table: "RecruitmentCostItem", code: "PSIKOTES", cols: ["name", "description", "sortOrder"], vals: ["Psikotes", "Tes psikologi kandidat (vendor/manual)", 3] },
  { table: "RecruitmentCostItem", code: "MEDICAL", cols: ["name", "description", "sortOrder"], vals: ["Medical Check-Up", "Pemeriksaan kesehatan pra-kerja", 4] },
  { table: "RecruitmentCostItem", code: "BONUS_REFERRAL", cols: ["name", "description", "sortOrder"], vals: ["Bonus Referal", "Insentif karyawan perujuk", 5] },
  { table: "RecruitmentCostItem", code: "GENERAL", cols: ["name", "description", "sortOrder"], vals: ["General (non-budget)", "Biaya umum di luar anggaran rekrutmen", 6] },
  // Skill (padanan oranHR Skill: "Bahasa Inggris (menulis)", "Others")
  { table: "Skill", code: "INGGRIS_LISAN", cols: ["name", "sortOrder"], vals: ["Bahasa Inggris (lisan)", 1] },
  { table: "Skill", code: "INGGRIS_TULIS", cols: ["name", "sortOrder"], vals: ["Bahasa Inggris (menulis)", 2] },
  { table: "Skill", code: "KOMPUTER", cols: ["name", "sortOrder"], vals: ["Operasional Komputer", 3] },
  { table: "Skill", code: "OTHERS", cols: ["name", "sortOrder"], vals: ["Others", 4] },
  // RequiredDocument (padanan oranHR Requirement Document: CV & KTP mandatory)
  { table: "RequiredDocument", code: "CV", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Curriculum Vitae (CV)", "pdf,doc,docx", true, 1] },
  { table: "RequiredDocument", code: "KTP", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Kartu Tanda Penduduk (KTP)", "jpg,jpeg,png,pdf", true, 2] },
  { table: "RequiredDocument", code: "IJAZAH", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Ijazah Terakhir", "jpg,pdf", false, 3] },
  { table: "RequiredDocument", code: "TRANSKRIP", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Transkrip Nilai", "pdf", false, 4] },
  { table: "RequiredDocument", code: "NPWP", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Kartu NPWP", "jpg,pdf", false, 5] },
  { table: "RequiredDocument", code: "SKCK", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Surat Keterangan Catatan Kepolisian", "pdf", false, 6] },
  { table: "RequiredDocument", code: "FOTO", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Pas Foto Terbaru", "jpg,png", false, 7] },
  { table: "RequiredDocument", code: "SURAT_LAMARAN", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Surat Lamaran", "pdf,doc", false, 8] },
  { table: "RequiredDocument", code: "PAKLARING", cols: ["title", "fileType", "mandatory", "sortOrder"], vals: ["Surat Keterangan Bekerja (Paklaring)", "pdf", false, 9] },
  // EvaluationCategory
  { table: "EvaluationCategory", code: "TEKNIS", cols: ["name", "description", "sortOrder"], vals: ["Kemampuan Teknis", "Kompetensi teknis sesuai posisi", 1] },
  { table: "EvaluationCategory", code: "KOMUNIKASI", cols: ["name", "description", "sortOrder"], vals: ["Komunikasi", "Kemampuan komunikasi & presentasi", 2] },
  { table: "EvaluationCategory", code: "KERJASAMA", cols: ["name", "description", "sortOrder"], vals: ["Kerja Sama Tim", "Kolaborasi dalam tim", 3] },
  { table: "EvaluationCategory", code: "ANALITIS", cols: ["name", "description", "sortOrder"], vals: ["Berpikir Analitis", "Penalaran & pemecahan masalah", 4] },
  { table: "EvaluationCategory", code: "KEPEMIMPINAN", cols: ["name", "description", "sortOrder"], vals: ["Kepemimpinan", "Inisiatif & memimpin (untuk posisi supervisory)", 5] },
  // EvaluationScale (padanan oranHR Applicant Evaluation Scale: Low(1)…)
  { table: "EvaluationScale", code: "SK1", cols: ["name", "ranking", "sortOrder"], vals: ["Rendah", 1, 1] },
  { table: "EvaluationScale", code: "SK2", cols: ["name", "ranking", "sortOrder"], vals: ["Di Bawah Rata-rata", 2, 2] },
  { table: "EvaluationScale", code: "SK3", cols: ["name", "ranking", "sortOrder"], vals: ["Cukup", 3, 3] },
  { table: "EvaluationScale", code: "SK4", cols: ["name", "ranking", "sortOrder"], vals: ["Baik", 4, 4] },
  { table: "EvaluationScale", code: "SK5", cols: ["name", "ranking", "sortOrder"], vals: ["Sangat Baik", 5, 5] },
  // SlaGroup (padanan oranHR SLA Group: "Interview" 30 hari)
  { table: "SlaGroup", code: "ADMIN", cols: ["name", "days", "sortOrder"], vals: ["Administrasi", 7, 1] },
  { table: "SlaGroup", code: "PSIKOTES", cols: ["name", "days", "sortOrder"], vals: ["Psikotes", 14, 2] },
  { table: "SlaGroup", code: "OFFERING", cols: ["name", "days", "sortOrder"], vals: ["Offering", 14, 3] },
  { table: "SlaGroup", code: "MEDICAL", cols: ["name", "days", "sortOrder"], vals: ["Medical", 14, 4] },
  { table: "SlaGroup", code: "INTERVIEW", cols: ["name", "days", "sortOrder"], vals: ["Interview", 30, 5] },
];

// SelectionProcess — rantai default F0 (padanan oranHR sample MII:
// Psikotes / Interview HR / Interview User / Offering Salary / Medical Check Up).
const SELECTION_SEED: { code: string; name: string; description: string; resultType: string; processOrder: number; slaDays: number; needAck: boolean; minPass: number | null }[] = [
  { code: "INTERVIEW_HR", name: "Interview HR", description: "Wawancara awal oleh HR (penyaringan umum, kesesuaian ekspektasi)", resultType: "Qualitative", processOrder: 1, slaDays: 30, needAck: true, minPass: null },
  { code: "PSIKOTES", name: "Psikotes", description: "Tes psikologi (catat hasil manual / unggah laporan — engine online = backlog)", resultType: "Quantitative", processOrder: 2, slaDays: 14, needAck: true, minPass: null },
  { code: "INTERVIEW_USER", name: "Interview User", description: "Wawancara oleh user/atasan langsung bidangnya", resultType: "Qualitative", processOrder: 3, slaDays: 30, needAck: true, minPass: null },
  { code: "OFFERING", name: "Offering Salary", description: "Penawaran gaji & benefit (lanjut ke manajemen offer F4)", resultType: "Qualitative", processOrder: 4, slaDays: 14, needAck: false, minPass: null },
  { code: "MEDICAL", name: "Medical Check Up", description: "Pemeriksaan kesehatan pra-kerja (MCU)", resultType: "Qualitative", processOrder: 5, slaDays: 14, needAck: false, minPass: null },
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f0] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      // ---- 1. DDL idempoten ----
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        await c.query(ddl);
      }
      console.log(`    tabel master rekrutmen siap (10)`);

      // ---- 2. seed master (insert-only per code) ----
      let inserted = 0;
      for (const s of MASTER_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."${s.table}" WHERE code = $1`, [s.code]);
        if (dup.rowCount) continue;
        const cols = ["code", ...s.cols];
        const holders = cols.map((_, i) => `$${i + 1}`).join(", ");
        await c.query(
          `INSERT INTO "${schemaName}"."${s.table}" (id, ${cols.map((x) => `"${x}"`).join(", ")}, "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, ${holders}, now(), now())`,
          [s.code, ...s.vals],
        );
        inserted++;
      }

      // ---- 3. seed rantai tahap seleksi standar ----
      let steps = 0;
      for (const p of SELECTION_SEED) {
        const dup = await c.query(`SELECT 1 FROM "${schemaName}"."SelectionProcess" WHERE code = $1`, [p.code]);
        if (dup.rowCount) continue;
        await c.query(
          `INSERT INTO "${schemaName}"."SelectionProcess"
             (id, code, name, description, mandatory, "resultType", "appliesInternal", "appliesExternal",
              "minResultPass", "processOrder", "slaDays", "needAcknowledgement", active, "sortOrder", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, true, $4, true, true, $5::double precision, $6, $7, $8, true, $6, now(), now())`,
          [p.code, p.name, p.description, p.resultType, p.minPass, p.processOrder, p.slaDays, p.needAck],
        );
        steps++;
      }
      console.log(`    master baru: ${inserted}, tahap seleksi baru: ${steps}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung (bun scripts/migrate-recruitment-f0.ts),
// BUKAN saat diimpor aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
