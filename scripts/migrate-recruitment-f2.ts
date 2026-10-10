// Migrasi F2-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F2) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×11 (JobOpportunity, JobOpening,
//      JobOpeningMethod, Applicant, ApplicantEducation, ApplicantExperience,
//      ApplicantSkill, ApplicantDocument, ApplicantApplication,
//      PublicApplication, ApplicantConsent) + unique/index/FK — selaras
//      prisma/tenant-ddl.sql.
//   2. Seed demo dwibahasa untuk tenant MII (insert-only bila tabel JO masih
//      kosong) — SEMUA lewat jalur produksi (createJo/postJo/
//      autoPostForApprovedPr/createApplicant/applyToOpening/
//      submitPublicApplication/verifyPublicApplication):
//        • JO#1 Posted (AUTO-POST dari PR-2026-0003 Approved+autoPostOpening)
//          + kanal WEBPORTAL(otomatis) + ADVERT berbiaya terencana/aktual
//        • JO#2 Posted (createJo Draft → postJo) slot PR-2026-0004
//        • JO#3 Draft slot PR-2026-0008
//        • 6 pelamar talent pool (1 berumur keep-on-file lewat → Outdated
//          oleh scheduler) + 3 lamaran slot + 1 hasil verifikasi staging
//        • staging PublicApplication: 1 Pending+CV, 1 Verified (Fajar — jadi
//          pelamar), 1 Rejected, 1 Spam (honeypot)
// Dapat diimpor IN-PROCESS oleh src/rekankerja/shared/lib/parity-runner.ts
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-f2.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import {
  createJo, postJo, upsertMethod, autoPostForApprovedPr,
} from "@/rekankerja/recruitment/services/opening-service";
import {
  createApplicant, applyToOpening, submitPublicApplication, verifyPublicApplication,
} from "@/rekankerja/recruitment/services/applicant-service";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "JobOpportunity" (
    "id" TEXT NOT NULL,
    "refNo" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "preparedById" TEXT,
    "datePrepared" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "datePosted" TIMESTAMP(3),
    "content" TEXT,
    "contactPerson" TEXT,
    "lastAcceptDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobOpportunity_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "JobOpening" (
    "id" TEXT NOT NULL,
    "jobOpportunityId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "titleToShow" TEXT NOT NULL,
    "workLocationId" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "jobDescSummary" TEXT,
    "jobSpecSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "postedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobOpening_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "JobOpeningMethod" (
    "id" TEXT NOT NULL,
    "jobOpportunityId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "adMediaTypeId" TEXT,
    "agencyId" TEXT,
    "costItemId" TEXT,
    "plannedCost" TEXT,
    "actualCost" TEXT,
    "datePosted" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobOpeningMethod_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Applicant" (
    "id" TEXT NOT NULL,
    "applicantNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "blacklist" BOOLEAN NOT NULL DEFAULT false,
    "blacklistNote" TEXT,
    "blacklistAt" TIMESTAMP(3),
    "blacklistById" TEXT,
    "suspend" BOOLEAN NOT NULL DEFAULT false,
    "suspendNote" TEXT,
    "suspendUntil" TIMESTAMP(3),
    "dateApplied" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateAvailable" TIMESTAMP(3),
    "expectedSalary" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "keepOnFileMonths" INTEGER NOT NULL DEFAULT 12,
    "keepOnFileUntil" TIMESTAMP(3),
    "source" TEXT,
    "adMediaTypeId" TEXT,
    "agencyId" TEXT,
    "institutionName" TEXT,
    "referralEmployeeId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "placeOfBirth" TEXT,
    "identityNo" TEXT,
    "birthDate" TIMESTAMP(3),
    "gender" TEXT,
    "maritalStatus" TEXT,
    "notes" TEXT,
    "highestEduLevel" TEXT,
    "highestGpa" DOUBLE PRECISION,
    "totalExpMonths" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantEducation" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "fieldOfStudy" TEXT,
    "institution" TEXT,
    "graduationYear" INTEGER,
    "gpa" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicantEducation_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantExperience" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "company" TEXT,
    "position" TEXT,
    "field" TEXT,
    "startYear" INTEGER,
    "endYear" INTEGER,
    "months" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicantExperience_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantSkill" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicantSkill_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantDocument" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "requiredDocumentId" TEXT,
    "title" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attachmentId" TEXT,
    CONSTRAINT "ApplicantDocument_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantApplication" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "dateApplied" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Received',
    "sourceNote" TEXT,
    "rejectionLetterNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicantApplication_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "PublicApplication" (
    "id" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "payloadJson" TEXT NOT NULL,
    "cvFileName" TEXT,
    "cvStoragePath" TEXT,
    "ipHash" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectNote" TEXT,
    "consentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicApplication_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ApplicantConsent" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT,
    "purpose" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApplicantConsent_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  // unique
  `CREATE UNIQUE INDEX IF NOT EXISTS "JobOpportunity_refNo_key" ON "JobOpportunity"("refNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "JobOpening_jobOpportunityId_prId_key" ON "JobOpening"("jobOpportunityId", "prId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Applicant_applicantNo_key" ON "Applicant"("applicantNo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ApplicantApplication_applicantId_jobOpeningId_key" ON "ApplicantApplication"("applicantId", "jobOpeningId")`,
  // index
  `CREATE INDEX IF NOT EXISTS "JobOpportunity_status_idx" ON "JobOpportunity"("status")`,
  `CREATE INDEX IF NOT EXISTS "JobOpportunity_datePosted_idx" ON "JobOpportunity"("datePosted")`,
  `CREATE INDEX IF NOT EXISTS "JobOpening_prId_idx" ON "JobOpening"("prId")`,
  `CREATE INDEX IF NOT EXISTS "JobOpening_status_idx" ON "JobOpening"("status")`,
  `CREATE INDEX IF NOT EXISTS "JobOpeningMethod_jobOpportunityId_idx" ON "JobOpeningMethod"("jobOpportunityId")`,
  `CREATE INDEX IF NOT EXISTS "Applicant_status_idx" ON "Applicant"("status")`,
  `CREATE INDEX IF NOT EXISTS "Applicant_keepOnFileUntil_idx" ON "Applicant"("keepOnFileUntil")`,
  `CREATE INDEX IF NOT EXISTS "Applicant_source_idx" ON "Applicant"("source")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantEducation_applicantId_idx" ON "ApplicantEducation"("applicantId")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantExperience_applicantId_idx" ON "ApplicantExperience"("applicantId")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantSkill_applicantId_idx" ON "ApplicantSkill"("applicantId")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantSkill_skillId_idx" ON "ApplicantSkill"("skillId")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantDocument_applicantId_idx" ON "ApplicantDocument"("applicantId")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantApplication_jobOpeningId_idx" ON "ApplicantApplication"("jobOpeningId")`,
  `CREATE INDEX IF NOT EXISTS "PublicApplication_status_submittedAt_idx" ON "PublicApplication"("status", "submittedAt")`,
  `CREATE INDEX IF NOT EXISTS "ApplicantConsent_applicantId_purpose_idx" ON "ApplicantConsent"("applicantId", "purpose")`,
  // FK (drop-add aman — idempoten)
  `ALTER TABLE "JobOpportunity" DROP CONSTRAINT IF EXISTS "JobOpportunity_preparedById_fkey"`,
  `ALTER TABLE "JobOpportunity" ADD CONSTRAINT "JobOpportunity_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpening" DROP CONSTRAINT IF EXISTS "JobOpening_jobOpportunityId_fkey"`,
  `ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_jobOpportunityId_fkey" FOREIGN KEY ("jobOpportunityId") REFERENCES "JobOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpening" DROP CONSTRAINT IF EXISTS "JobOpening_prId_fkey"`,
  `ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpening" DROP CONSTRAINT IF EXISTS "JobOpening_workLocationId_fkey"`,
  `ALTER TABLE "JobOpening" ADD CONSTRAINT "JobOpening_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpeningMethod" DROP CONSTRAINT IF EXISTS "JobOpeningMethod_jobOpportunityId_fkey"`,
  `ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_jobOpportunityId_fkey" FOREIGN KEY ("jobOpportunityId") REFERENCES "JobOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpeningMethod" DROP CONSTRAINT IF EXISTS "JobOpeningMethod_methodId_fkey"`,
  `ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "RecruitmentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpeningMethod" DROP CONSTRAINT IF EXISTS "JobOpeningMethod_adMediaTypeId_fkey"`,
  `ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_adMediaTypeId_fkey" FOREIGN KEY ("adMediaTypeId") REFERENCES "AdMediaType"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpeningMethod" DROP CONSTRAINT IF EXISTS "JobOpeningMethod_agencyId_fkey"`,
  `ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "EmploymentAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "JobOpeningMethod" DROP CONSTRAINT IF EXISTS "JobOpeningMethod_costItemId_fkey"`,
  `ALTER TABLE "JobOpeningMethod" ADD CONSTRAINT "JobOpeningMethod_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "RecruitmentCostItem"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "Applicant" DROP CONSTRAINT IF EXISTS "Applicant_adMediaTypeId_fkey"`,
  `ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_adMediaTypeId_fkey" FOREIGN KEY ("adMediaTypeId") REFERENCES "AdMediaType"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "Applicant" DROP CONSTRAINT IF EXISTS "Applicant_agencyId_fkey"`,
  `ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "EmploymentAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "Applicant" DROP CONSTRAINT IF EXISTS "Applicant_referralEmployeeId_fkey"`,
  `ALTER TABLE "Applicant" ADD CONSTRAINT "Applicant_referralEmployeeId_fkey" FOREIGN KEY ("referralEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantEducation" DROP CONSTRAINT IF EXISTS "ApplicantEducation_applicantId_fkey"`,
  `ALTER TABLE "ApplicantEducation" ADD CONSTRAINT "ApplicantEducation_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantExperience" DROP CONSTRAINT IF EXISTS "ApplicantExperience_applicantId_fkey"`,
  `ALTER TABLE "ApplicantExperience" ADD CONSTRAINT "ApplicantExperience_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantSkill" DROP CONSTRAINT IF EXISTS "ApplicantSkill_applicantId_fkey"`,
  `ALTER TABLE "ApplicantSkill" ADD CONSTRAINT "ApplicantSkill_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantSkill" DROP CONSTRAINT IF EXISTS "ApplicantSkill_skillId_fkey"`,
  `ALTER TABLE "ApplicantSkill" ADD CONSTRAINT "ApplicantSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantDocument" DROP CONSTRAINT IF EXISTS "ApplicantDocument_applicantId_fkey"`,
  `ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantDocument" DROP CONSTRAINT IF EXISTS "ApplicantDocument_requiredDocumentId_fkey"`,
  `ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_requiredDocumentId_fkey" FOREIGN KEY ("requiredDocumentId") REFERENCES "RequiredDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantDocument" DROP CONSTRAINT IF EXISTS "ApplicantDocument_attachmentId_fkey"`,
  `ALTER TABLE "ApplicantDocument" ADD CONSTRAINT "ApplicantDocument_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantApplication" DROP CONSTRAINT IF EXISTS "ApplicantApplication_applicantId_fkey"`,
  `ALTER TABLE "ApplicantApplication" ADD CONSTRAINT "ApplicantApplication_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantApplication" DROP CONSTRAINT IF EXISTS "ApplicantApplication_jobOpeningId_fkey"`,
  `ALTER TABLE "ApplicantApplication" ADD CONSTRAINT "ApplicantApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PublicApplication" DROP CONSTRAINT IF EXISTS "PublicApplication_jobOpeningId_fkey"`,
  `ALTER TABLE "PublicApplication" ADD CONSTRAINT "PublicApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PublicApplication" DROP CONSTRAINT IF EXISTS "PublicApplication_verifiedById_fkey"`,
  `ALTER TABLE "PublicApplication" ADD CONSTRAINT "PublicApplication_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "ApplicantConsent" DROP CONSTRAINT IF EXISTS "ApplicantConsent_applicantId_fkey"`,
  `ALTER TABLE "ApplicantConsent" ADD CONSTRAINT "ApplicantConsent_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "Applicant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

// ============ demo seed (MII saja — insert-only bila kosong) ============

/** PDF demo minimal (lolos magic-number %PDF — isi bukan template produksi). */
function demoCvPdf(name: string): Buffer {
  const body = `BT /F1 16 Tf 50 780 Td (${name} — Curriculum Vitae) Tj ET\nBT /F1 10 Tf 50 750 Td (Demo CV untuk modul rekrutmen RekanKerja.) Tj ET`;
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    "utf8",
  );
}

async function seedDemoF2(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.jobOpportunity.count();
  if (existing > 0) return "";

  const tenantSlug = "pt-mitra-industri-internasional";

  // master pendukung (F0 — semua tenant sudah punya)
  const methods = await db.recruitmentMethod.findMany({ select: { id: true, code: true } });
  const media = await db.adMediaType.findMany({ select: { id: true, name: true } });
  const costItems = await db.recruitmentCostItem.findMany({ select: { id: true, name: true } });
  const skills = await db.skill.findMany({ select: { id: true, code: true } });
  const locations = await db.workLocation.findMany({ select: { id: true, name: true } });
  const skillId = (code: string) => skills.find((s) => s.code === code)?.id ?? null;

  // PR Approved yang belum punya slot (urut nomor)
  const prs = await db.personnelRequisition.findMany({
    where: { status: "Approved" },
    select: { id: true, prNo: true, autoPostOpening: true, position: { select: { title: true } } },
    orderBy: { prNo: "asc" },
  });
  if (prs.length < 1) return "";

  const days = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // ---- 1) JO#1 — AUTO-POST dari PR Approved + autoPostOpening (jalur produksi) ----
  const autoPr = prs.find((p) => p.autoPostOpening) ?? prs[0]!;
  const autoJo = await autoPostForApprovedPr(db, {
    id: autoPr.id, prNo: autoPr.prNo, positionId: null, jobId: null, orgUnitId: null, companyOfficeId: null,
    requiredNo: 1, employmentStatus: "Permanent", miscSpec: null, additionalQualification: null, latestDate: null,
  }, { actorName: "Demo Seed F2 (auto-post)" });
  // kanal tambahan: ADVERT berbiaya (planned/actual terenkripsi vault)
  if (autoJo) {
    const jo = await db.jobOpportunity.findUnique({ where: { refNo: autoJo.joRefNo }, select: { id: true } });
    if (jo) {
      await upsertMethod(db, {
        jobOpportunityId: jo.id,
        methodId: methods.find((m) => m.code === "ADVERT")?.id ?? methods[0]!.id,
        adMediaTypeId: media[0]?.id ?? null,
        plannedCost: 4_500_000,
        actualCost: 4_320_000,
        datePosted: days(-5),
        note: "Iklan lowongan kuartal berjalan",
      }, "Demo Seed F2");
    }
  }

  // ---- 2) JO#2 — createJo Draft → postJo (slot PR Approved kedua) ----
  const pr2 = prs.find((p) => p.id !== autoPr.id);
  let slot2Id: string | null = null;
  if (pr2) {
    const jo2 = await createJo(db, {
      title: `Rekrutmen ${pr2.position?.title ?? pr2.prNo} ${new Date().getFullYear()}`,
      contactPerson: "Tim Rekrutmen MII",
      lastAcceptDate: days(30),
      content: "Bergabunglah dengan tim kami — kandidat berintegritas, siap berkembang, dan berorientasi hasil.",
      slots: [{
        prId: pr2.id,
        workLocationId: locations[0]?.id ?? null,
        salaryMin: 6_000_000,
        salaryMax: 9_000_000,
        jobDescSummary: "Menangani pencatatan transaksi harian, rekonsiliasi bank, dan penyusunan laporan keuangan bulanan.",
        jobSpecSummary: "S1/D3 Akuntansi, terampil software akuntansi, teliti, min. 2 tahun pengalaman.",
      }],
    }, "Demo Seed F2");
    await postJo(db, jo2.id, "Demo Seed F2");
    slot2Id = jo2.slots[0]?.id ?? null;
  }

  // ---- 3) JO#3 — Draft (belum tayang) dari PR Approved ketiga ----
  const pr3 = prs.find((p) => p.id !== autoPr.id && p.id !== pr2?.id);
  if (pr3) {
    await createJo(db, {
      title: `Lowongan ${pr3.position?.title ?? pr3.prNo} (draft)`,
      contactPerson: null,
      content: null,
      slots: [{ prId: pr3.id, workLocationId: null }],
    }, "Demo Seed F2");
  }

  // ---- 4) talent pool — 6 pelamar via createApplicant (jalur produksi) ----
  const referral = await db.employee.findFirst({
    where: { status: "Active" },
    select: { id: true }, orderBy: { employeeNo: "asc" },
  });
  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });

  const dewi = await createApplicant(db, {
    firstName: "Dewi", lastName: "Lestari",
    dateApplied: days(-12), dateAvailable: days(14),
    expectedSalary: 8_500_000,
    source: "Advertisement",
    email: "dewi.lestari@example.com", phone: "081234500001", city: "Jakarta",
    placeOfBirth: "Bandung", birthDate: "1996-04-12", gender: "P", maritalStatus: "Belum menikah",
    notes: "Kandidat kuat — pengalaman audit internal 5 tahun.",
    educations: [{ level: "S1", fieldOfStudy: "Akuntansi", institution: "Universitas Indonesia", graduationYear: 2018, gpa: 3.55 }],
    experiences: [
      { company: "PT Sinar Audit Nusantara", position: "Junior Auditor", field: "Audit", startYear: 2018, endYear: 2021, months: 36 },
      { company: "PT Unilever Indonesia", position: "Accounting Staff", field: "Akuntansi", startYear: 2021, endYear: null, months: 42 },
    ],
    skills: [
      { skillId: skillId("KOMPUTER")!, level: "Advanced" },
      { skillId: skillId("INGGRIS_TULIS")!, level: "Advanced" },
    ],
  }, "Demo Seed F2");

  const ahmad = await createApplicant(db, {
    firstName: "Ahmad", lastName: "Fauzi",
    dateApplied: days(-9), expectedSalary: 5_500_000, source: "Web",
    email: "ahmad.fauzi@example.com", phone: "081234500002", city: "Bekasi",
    birthDate: "1992-09-30", gender: "L",
    notes: null,
    educations: [{ level: "SMK", fieldOfStudy: "Teknik Mesin", institution: "SMK Negeri 1 Bekasi", graduationYear: 2011, gpa: null }],
    experiences: [{ company: "PT Sentra Logistik Prima", position: "Operator Produksi", field: "Manufaktur", startYear: 2015, endYear: null, months: 96 }],
    skills: [{ skillId: skillId("KOMPUTER")!, level: "Intermediate" }],
  }, "Demo Seed F2");

  const maria = await createApplicant(db, {
    firstName: "Maria", lastName: "Fransisca",
    dateApplied: days(-7), expectedSalary: 6_500_000, source: "Referral",
    referralEmployeeId: referral?.id ?? null,
    email: "maria.fransisca@example.com", phone: "081234500003", city: "Depok",
    birthDate: "1998-01-22", gender: "P",
    notes: "Dirujuk karyawan internal — antusias pada budaya perusahaan.",
    educations: [{ level: "S1", fieldOfStudy: "Psikologi", institution: "Universitas Gunadharma", graduationYear: 2021, gpa: 3.4 }],
    experiences: [{ company: "PT Cahaya Digital Nusantara", position: "HR Staff", field: "SDM", startYear: 2021, endYear: 2023, months: 24 }],
    skills: [{ skillId: skillId("INGGRIS_LISAN")!, level: "Intermediate" }],
  }, "Demo Seed F2");

  const budi = await createApplicant(db, {
    firstName: "Budi", lastName: "Santoso",
    dateApplied: days(-5), expectedSalary: 6_000_000, source: "Web",
    email: "budi.santoso@example.com", phone: "081234500004", city: "Jakarta",
    birthDate: "1994-07-17", gender: "L",
    notes: null,
    educations: [{ level: "D3", fieldOfStudy: "Manajemen Informatika", institution: "Politeknik Negeri Jakarta", graduationYear: 2016, gpa: 3.1 }],
    experiences: [{ company: "PT Mitra Industri Internasional (vendor IT)", position: "IT Support", field: "Teknologi Informasi", startYear: 2017, endYear: null, months: 84 }],
    skills: [{ skillId: skillId("KOMPUTER")!, level: "Expert" }],
  }, "Demo Seed F2");

  const rina = await createApplicant(db, {
    firstName: "Rina", lastName: "Wulandari",
    dateApplied: days(-3), expectedSalary: 4_500_000, source: "Agency",
    email: "rina.wulandari@example.com", phone: "081234500005", city: "Tangerang",
    birthDate: "2000-11-05", gender: "P",
    notes: null,
    educations: [{ level: "S1", fieldOfStudy: "Sastra Inggris", institution: "Universitas Terbuka", graduationYear: 2023, gpa: 3.2 }],
    experiences: [{ company: "CV Kreatif Media", position: "Administrasi", field: "Administrasi", startYear: 2023, endYear: 2024, months: 12 }],
    skills: [
      { skillId: skillId("INGGRIS_LISAN")!, level: "Expert" },
      { skillId: skillId("INGGRIS_TULIS")!, level: "Expert" },
    ],
  }, "Demo Seed F2");

  await createApplicant(db, {
    firstName: "Agus", lastName: "Salim",
    dateApplied: days(-8 * 30), // 8 bulan lalu — keep-on-file 6 bulan sudah lewat
    keepOnFileMonths: 6,
    expectedSalary: 5_000_000, source: "Advertisement",
    email: "agus.salim@example.com", phone: "081234500006", city: "Karawang",
    birthDate: "1990-03-08", gender: "L",
    notes: "Kandidat lama — akan otomatis Outdated oleh scheduler keep-on-file.",
    educations: [{ level: "SMA", fieldOfStudy: "IPA", institution: "SMA Negeri 2 Karawang", graduationYear: 2009, gpa: null }],
    experiences: [{ company: "PT Karawang Jaya", position: "Admin Gudang", field: "Logistik", startYear: 2010, endYear: 2014, months: 48 }],
    skills: [],
  }, "Demo Seed F2");

  // ---- 5) lamaran slot (multi-lamar) ----
  if (slot2Id) {
    await applyToOpening(db, { applicantId: dewi.id, jobOpeningId: slot2Id, sourceNote: "Diteruskan dari seleksi berkas" }, "Demo Seed F2");
    await applyToOpening(db, { applicantId: maria.id, jobOpeningId: slot2Id, sourceNote: "Referral karyawan" }, "Demo Seed F2");
  }
  if (autoJo?.slotId) {
    await applyToOpening(db, { applicantId: budi.id, jobOpeningId: autoJo.slotId }, "Demo Seed F2");
  }

  // ---- 6) staging PublicApplication (form publik → verifikasi HR) ----
  const actor = { employeeId: hrdUser?.employeeId ?? null, name: "Demo HR (seed)" };

  // 6a. Fajar — pending → DIVERIFIKASI → jadi pelamar + lamaran + CV pindah
  const fajar = await submitPublicApplication(db, tenantSlug, {
    jobOpeningId: autoJo?.slotId ?? null,
    payload: {
      firstName: "Fajar", lastName: "Nugroho",
      email: "fajar.nugroho@example.com", phone: "081234500007", city: "Jakarta",
      birthDate: "1995-06-14", gender: "L",
      educationLevel: "S1", fieldOfStudy: "Teknik Industri", institution: "ITB", graduationYear: 2018, gpa: 3.45,
      expYears: 6, lastPosition: "Supply Chain Analyst", lastCompany: "PT Karya Logistik",
      expectedSalary: 9_000_000,
      notes: "Melamar melalui portal karir perusahaan.",
    },
    cv: { buffer: demoCvPdf("Fajar Nugroho"), fileName: "CV Fajar Nugroho.pdf", mimeType: "application/pdf" },
  });
  await verifyPublicApplication(db, tenantSlug, { id: fajar.id, action: "verify", actor });

  // 6b. Gita — pending (menunggu verifikasi HR) + CV
  await submitPublicApplication(db, tenantSlug, {
    jobOpeningId: slot2Id,
    payload: {
      firstName: "Gita", lastName: "Savitri",
      email: "gita.savitri@example.com", phone: "081234500008", city: "Bogor",
      birthDate: "1999-02-27", gender: "P",
      educationLevel: "S1", fieldOfStudy: "Manajemen", institution: "Universitas Bogor", graduationYear: 2022, gpa: 3.6,
      expYears: 2, lastPosition: "Finance Officer", lastCompany: "PT Boga Nusantara",
      expectedSalary: 7_000_000,
      notes: null,
    },
    cv: { buffer: demoCvPdf("Gita Savitri"), fileName: "CV Gita Savitri.pdf", mimeType: "application/pdf" },
  });

  // 6c. Rudi — pending → DITOLAK dengan alasan
  const rudi = await submitPublicApplication(db, tenantSlug, {
    jobOpeningId: null, // lamaran umum (tanpa slot)
    payload: {
      firstName: "Rudi", lastName: "Hartanto",
      email: "rudi.hartanto@example.com", phone: "081234500009", city: "Jakarta",
      educationLevel: "SMA", expYears: 1, lastPosition: "Kurir", lastCompany: "Swasta",
      expectedSalary: 3_000_000,
      notes: "Lamaran umum.",
    },
  });
  await verifyPublicApplication(db, tenantSlug, {
    id: rudi.id, action: "reject", note: "Kualifikasi belum memenuhi kebutuhan saat ini.",
    actor,
  });

  // 6d. spam (honeypot terisi — form bot)
  await submitPublicApplication(db, tenantSlug, {
    jobOpeningId: null,
    payload: { firstName: "Bot", lastName: "Spam", email: "bot@spam.example", expYears: 0 },
    spam: true,
  });

  return `${prs.length} PR → 3 JO (2 Posted + 1 Draft), 6 pelamar + 4 lamaran slot, staging: 1 Pending+CV / 1 Verified / 1 Rejected / 1 Spam`;
}

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f2] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        await c.query(ddl);
      }
      console.log(`    11 tabel F2 siap (JobOpportunity … ApplicantConsent)`);
    } finally {
      await c.end();
    }
    // demo hanya untuk tenant MII (schema demo utama, data dwibahasa)
    const isMii = schemaName.includes("mitra_industri");
    if (isMii) {
      const demo = await seedDemoF2(schemaName);
      if (demo) console.log(`    demo: ${demo}`);
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung (bun scripts/migrate-recruitment-f2.ts),
// BUKAN saat diimpor aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
