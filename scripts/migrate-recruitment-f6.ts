// Migrasi F6-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F6 — AI
// Intelligence) ke tenant existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×4 (KnockoutQuestion, ApplicationAnswer,
//      CvParseResult, CandidateAiScore) + ALTER TABLE PersonnelRequisition
//      ADD COLUMN IF NOT EXISTS rubricJson + unique/index/FK drop-add —
//      selaras prisma/schema-tenant.prisma & prisma/tenant-ddl.sql.
//   2. Demo seed MII (insert-only bila KnockoutQuestion masih kosong) via
//      JALUR PRODUKSI (service AI rekrutmen — dynamic import):
//        • Knockout questions slot CEO (JO-0001) & Accountant (JO-0002).
//        • Rubrik skor per PR (PR-2026-0003: 4 faktor berbobot).
//        • Parse CV demo (mode simulated berlabel) + skor AI explainable
//          kandidat PR-2026-0003.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU CLI: bun run scripts/migrate-recruitment-f6.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "KnockoutQuestion" (
    "id" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'Equals',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "orderNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnockoutQuestion_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicationAnswer_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CvParseResult" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "storagePath" TEXT,
    "fieldsJson" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CvParseResult_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CandidateAiScore" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "rubricJson" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "factorsJson" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,
    CONSTRAINT "CandidateAiScore_pkey" PRIMARY KEY ("id")
  )`,
  // F6 — rubrik skor AI no-code per PR (HRX B2)
  `ALTER TABLE "PersonnelRequisition" ADD COLUMN IF NOT EXISTS "rubricJson" TEXT`,
];

const AFTER_TABLE: string[] = [
  `CREATE INDEX IF NOT EXISTS "KnockoutQuestion_jobOpeningId_idx" ON "KnockoutQuestion"("jobOpeningId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ApplicationAnswer_applicationId_questionId_key" ON "ApplicationAnswer"("applicationId", "questionId")`,
  `CREATE INDEX IF NOT EXISTS "CvParseResult_applicantId_idx" ON "CvParseResult"("applicantId")`,
  `CREATE INDEX IF NOT EXISTS "CandidateAiScore_candidateId_generatedAt_idx" ON "CandidateAiScore"("candidateId", "generatedAt")`,
  // FK drop-add idempoten (pola F2–F5)
  `ALTER TABLE "KnockoutQuestion" DROP CONSTRAINT IF EXISTS "KnockoutQuestion_jobOpeningId_fkey"`,
  `ALTER TABLE "KnockoutQuestion" ADD CONSTRAINT "KnockoutQuestion_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicationAnswer" DROP CONSTRAINT IF EXISTS "ApplicationAnswer_applicationId_fkey"`,
  `ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ApplicantApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicationAnswer" DROP CONSTRAINT IF EXISTS "ApplicationAnswer_questionId_fkey"`,
  `ALTER TABLE "ApplicationAnswer" ADD CONSTRAINT "ApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "KnockoutQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CvParseResult" DROP CONSTRAINT IF EXISTS "CvParseResult_applicantId_fkey"`,
  `ALTER TABLE "CvParseResult" ADD CONSTRAINT "CvParseResult_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CvParseResult" DROP CONSTRAINT IF EXISTS "CvParseResult_verifiedById_fkey"`,
  `ALTER TABLE "CvParseResult" ADD CONSTRAINT "CvParseResult_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAiScore" DROP CONSTRAINT IF EXISTS "CandidateAiScore_candidateId_fkey"`,
  `ALTER TABLE "CandidateAiScore" ADD CONSTRAINT "CandidateAiScore_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAiScore" DROP CONSTRAINT IF EXISTS "CandidateAiScore_generatedById_fkey"`,
  `ALTER TABLE "CandidateAiScore" ADD CONSTRAINT "CandidateAiScore_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

// ============ demo seed (MII saja — insert-only bila knockout kosong) ============

async function seedDemoF6(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.knockoutQuestion.count();
  if (existing > 0) return "";

  // service AI rekrutmen — dynamic import per-service (dibuat tugas F6-backend;
  // bila belum ada, demo dilewati dengan aman, tidak menggagalkan DDL).
  // F6a: turbopackIgnore WAJIB — Turbopack (dev) menganalisis import()
  // literal secara STATIS dan menggagalkan build seluruh app saat salah satu
  // service belum dibuat agent lain (instrumentation → parity-runner → sini),
  // padahal .catch(() => null) memang dirancang utk degradasi grasi. CLI bun
  // tetap me-resolve path ini normal saat runtime.
  const cvSvc = await import(/* turbopackIgnore: true */ "@/rekankerja/recruitment/services/ai-cv-service").catch(() => null);
  const scoreSvc = await import(/* turbopackIgnore: true */ "@/rekankerja/recruitment/services/ai-score-service").catch(() => null);
  const openSvc = await import(/* turbopackIgnore: true */ "@/rekankerja/recruitment/services/opening-service").catch(() => null);

  const year = String(new Date().getFullYear());

  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  const hrdEmployeeId = hrdUser?.employeeId ?? null;
  if (!hrdEmployeeId) return "";

  // ---- 1) Knockout questions per slot (JO-0001 CEO, JO-0002 Accountant) ----
  const jo1 = await db.jobOpening.findFirst({
    where: { jobOpportunity: { refNo: `JO-${year}-0001` } },
    select: { id: true },
  });
  const jo2 = await db.jobOpening.findFirst({
    where: { jobOpportunity: { refNo: `JO-${year}-0002` } },
    select: { id: true },
  });
  if (!jo1 && !jo2) return "";
  const made: string[] = [];
  if (jo1 && openSvc) {
    await openSvc.upsertKnockouts(db, jo1.id, [
      { question: "Bersedia ditempatkan penuh di kantor Jakarta Pusat?", expectedValue: "Ya", mode: "Equals" },
      { question: "Punya pengalaman minimal 8 tahun di level manajerial?", expectedValue: "Ya", mode: "Equals" },
    ]).catch(() => null);
    made.push("CEO");
  }
  if (jo2 && openSvc) {
    await openSvc.upsertKnockouts(db, jo2.id, [
      { question: "Bersedia bekerja full-time WFO di Jakarta Selatan?", expectedValue: "Ya", mode: "Equals" },
      { question: "Menguasai pembukuan dan pelaporan pajak (e-SPT/e-Filing)?", expectedValue: "Ya", mode: "Equals" },
    ]).catch(() => null);
    made.push("Accountant");
  }

  // ---- 2) Rubrik skor PR-...-0003 (4 faktor — snapshot ke setiap skor) ----
  const pr = await db.personnelRequisition.findFirst({ where: { prNo: { contains: "-0003" } } });
  let rubricInfo = "";
  if (pr) {
    await db.personnelRequisition.update({
      where: { id: pr.id },
      data: {
        rubricJson: JSON.stringify([
          { name: "Pendidikan & Sertifikasi", weight: 0.25, guide: "Relevansi jenjang & bidang studi dengan kebutuhan posisi" },
          { name: "Relevansi Pengalaman", weight: 0.35, guide: "Lama & kedekatan pengalaman kerja dengan peran yang dilamar" },
          { name: "Keahlian Teknis", weight: 0.25, guide: "Penguasaan tools/metode kunci posisi" },
          { name: "Kesesuaian Gaji & Motivasi", weight: 0.15, guide: "Ekspektasi gaji vs rentang + alasan melamar" },
        ]),
      },
    });
    rubricInfo = " + rubrik PR-0003";

    // ---- 3) Skor AI explainable (simulated — deterministik utk demo) ----
    if (scoreSvc) {
      const cands = await db.jobCandidate.findMany({
        where: { prId: pr.id, status: { in: ["Nominated", "InProcess", "Passed", "Failed"] } },
        take: 4,
      });
      for (const c of cands) {
        await scoreSvc.generateAiScore(db, {
          candidateId: c.id,
          mode: "simulated",
          generatedById: hrdEmployeeId,
        }).catch(() => null);
      }
    }
  }

  // ---- 4) Parse CV demo (simulated berlabel) utk pelamar Dewi ----
  if (cvSvc) {
    const dewi = await db.applicant.findFirst({ where: { firstName: "Dewi" }, select: { id: true } });
    if (dewi) {
      await cvSvc.parseCvText(db, {
      applicantId: dewi.id,
      sourceKind: "paste",
      text: `Dewi Lestari
Email: dewi.lestari@email.com | Telepon: 0812-3456-7890 | Jakarta
Lahir: Bandung, 12 Maret 1995
Pendidikan: S1 Akuntansi — Universitas Padjadjaran (2017), IPK 3.62
Pengalaman: Staff Accountant di PT Maju Bersama (2017-2021); Senior Accountant di PT Nusantara Logistik (2021-sekarang)
Keahlian: Pembukuan, e-SPT, e-Filing, SAP FI, Excel lanjutan
Ekspektasi gaji: Rp 12.000.000/bulan`,
      mode: "simulated",
      }).catch(() => null);
    }
  }

  return `knockout ${made.join(" & ")}${rubricInfo} + skor kandidat + parse CV`;
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f6] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        // DDL race-safe: pembuatan index paralel dua penulis dapat memicu
        // pg_class_relname_nsp_index (pg syscache flush) — beri satu coba lagi.
        try {
          await c.query(ddl);
        } catch (e) {
          if ((e as { code?: string }).code === "23505" && /pg_class_relname_nsp_index/.test(String(e))) {
            await new Promise((r) => setTimeout(r, 300));
            await c.query(ddl);
          } else throw e;
        }
      }
      console.log(`    4 tabel F6 siap (KnockoutQuestion, ApplicationAnswer, CvParseResult, CandidateAiScore) + kolom rubricJson PR`);
    } finally {
      await c.end();
    }

    // demo hanya untuk tenant MII
    if (schemaName.includes("mitra_industri")) {
      const demo = await seedDemoF6(schemaName);
      if (demo) console.log(`    demo: ${demo}`);
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, BUKAN saat diimpor
// aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
