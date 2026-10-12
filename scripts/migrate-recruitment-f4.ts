// Migrasi F4-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F4) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×2 (CandidateOffer, CandidateAppointment)
//      + unique/index/FK drop-add — selaras prisma/tenant-ddl.sql.
//   2. Referensi F4 untuk SEMUA tenant: template surat REC_OFFER / REC_APPOINT
//      / REC_REJECT (kategori "Recruitment" — letter-defaults) + struktur
//      approval AS-OFF-STD (docType RecruitmentOffer, 1 jenjang HR_ADMIN —
//      aktif; approval offer opsional by-value, bisa diubah/dimatikan di
//      Pengaturan → Approval Berjenjang).
//   3. Seed demo MII (insert-only bila CandidateOffer masih kosong) — SEMUA
//      lewat jalur produksi (nominateApplicant/scheduleStep/saveScorecard/
//      recordStepResult/createOffer/sendOffer/decideOfferApproval/
//      respondOffer/appoint/continueToOnboarding):
//        • PR-2026-0004 (Accountant, Contract, JO slot 6–9 jt):
//          – Rina Wulandari: LULUS 5 tahap → offer OFF 8,5 jt (dalam rentang
//            JO) → approval AS-OFF-STD → DIKIRIM (surat REC_OFFER + expiry
//            timer 5 hari) — TARGET E2E F4: terima → angkat → onboarding.
//          – Fajar Nugroho: LULUS 5 tahap → offer 7,5 jt → DITOLAK dengan
//            catatan counter (nego gaji — HRX E3 versi awal).
//        • PR-2026-0008 (CEO, Permanent): Siti Rahmawati LULUS 5 tahap →
//          offer DITERIMA → PENGANGKATAN (surat REC_APPOINT) → onboarding
//          → EMPLOYEE dibuat + PR otomatis FULFILLED (requiredNo=1) +
//          Applicant.status=Employed — funnel "Hired" & Direktori berisi.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU CLI: bun run scripts/migrate-recruitment-f4.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { LETTER_TEMPLATE_DEFAULTS } from "@/rekankerja/shared/lib/letter-defaults";
import { nominateApplicant } from "@/rekankerja/recruitment/services/candidate-service";
import { scheduleStep, recordStepResult } from "@/rekankerja/recruitment/services/selection-service";
import { saveScorecard } from "@/rekankerja/recruitment/services/scorecard-service";
import {
  createOffer, sendOffer, decideOfferApproval, respondOffer,
} from "@/rekankerja/recruitment/services/offer-service";
import { appoint, continueToOnboarding } from "@/rekankerja/recruitment/services/appointment-service";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "CandidateOffer" (
    "id" TEXT NOT NULL,
    "offerNo" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobOpeningId" TEXT,
    "salary" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "salaryUnit" TEXT NOT NULL DEFAULT 'Monthly',
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "letterNo" TEXT,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "appointedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateOffer_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CandidateAppointment" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "prId" TEXT NOT NULL,
    "appointmentDate" TIMESTAMP(3) NOT NULL,
    "positionId" TEXT,
    "orgUnitId" TEXT,
    "companyOfficeId" TEXT,
    "workLocationId" TEXT,
    "supervisorId" TEXT,
    "gradeId" TEXT,
    "employmentStatus" TEXT NOT NULL DEFAULT 'Permanent',
    "workShift" TEXT NOT NULL DEFAULT 'Regular',
    "letterNo" TEXT,
    "employeeId" TEXT,
    "onboardingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Appointed',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CandidateAppointment_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateOffer_offerNo_key" ON "CandidateOffer"("offerNo")`,
  `CREATE INDEX IF NOT EXISTS "CandidateOffer_status_expiryDate_idx" ON "CandidateOffer"("status", "expiryDate")`,
  `CREATE INDEX IF NOT EXISTS "CandidateOffer_prId_idx" ON "CandidateOffer"("prId")`,
  `CREATE INDEX IF NOT EXISTS "CandidateOffer_candidateId_idx" ON "CandidateOffer"("candidateId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CandidateAppointment_offerId_key" ON "CandidateAppointment"("offerId")`,
  `CREATE INDEX IF NOT EXISTS "CandidateAppointment_prId_idx" ON "CandidateAppointment"("prId")`,
  `CREATE INDEX IF NOT EXISTS "CandidateAppointment_employeeId_idx" ON "CandidateAppointment"("employeeId")`,
  // FK drop-add idempoten (pola F2/F3)
  `ALTER TABLE "CandidateOffer" DROP CONSTRAINT IF EXISTS "CandidateOffer_prId_fkey"`,
  `ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateOffer" DROP CONSTRAINT IF EXISTS "CandidateOffer_candidateId_fkey"`,
  `ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateOffer" DROP CONSTRAINT IF EXISTS "CandidateOffer_jobOpeningId_fkey"`,
  `ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateOffer" DROP CONSTRAINT IF EXISTS "CandidateOffer_createdById_fkey"`,
  `ALTER TABLE "CandidateOffer" ADD CONSTRAINT "CandidateOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_offerId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CandidateOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_candidateId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_prId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_prId_fkey" FOREIGN KEY ("prId") REFERENCES "PersonnelRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_positionId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_orgUnitId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_companyOfficeId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_workLocationId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_workLocationId_fkey" FOREIGN KEY ("workLocationId") REFERENCES "WorkLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_supervisorId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "CandidateAppointment" DROP CONSTRAINT IF EXISTS "CandidateAppointment_employeeId_fkey"`,
  `ALTER TABLE "CandidateAppointment" ADD CONSTRAINT "CandidateAppointment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

// ============ referensi F4 (SEMUA tenant — idempoten) ============

async function ensureF4Reference(db: ReturnType<typeof getTenantClient>): Promise<string[]> {
  const notes: string[] = [];

  // 1) template surat REC_OFFER / REC_APPOINT / REC_REJECT (kategori Recruitment)
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    if (t.category !== "Recruitment") continue;
    const before = await db.letterTemplate.findUnique({ where: { key: t.key }, select: { id: true } });
    if (before) continue;
    await db.letterTemplate.create({
      data: {
        key: t.key, category: t.category, name: t.name,
        description: t.description ?? null, subject: t.subject ?? null,
        body: t.body, signatoryTitle: t.signatoryTitle,
      },
    });
    notes.push(`template surat ${t.key}`);
  }

  // 2) struktur approval offer AS-OFF-STD (aktif, 1 jenjang HR_ADMIN —
  //    approval by value; ubah/matikan di Pengaturan → Approval Berjenjang)
  const before = await db.approvalStructure.findUnique({ where: { code: "AS-OFF-STD" }, select: { id: true } });
  if (!before) {
    await db.approvalStructure.create({
      data: {
        code: "AS-OFF-STD",
        name: "Persetujuan Offer Kandidat (default)",
        docType: "RecruitmentOffer",
        levels: { create: [{ levelNo: 1, approverType: "HR_ADMIN" }] },
      },
    });
    notes.push("struktur approval AS-OFF-STD (RecruitmentOffer)");
  }

  return notes;
}

// ============ demo MII (insert-only bila CandidateOffer kosong) ============

async function passAllStages(
  db: ReturnType<typeof getTenantClient>,
  candidateId: string,
  ctx: {
    ev1: { id: string };
    stages: { id: string; code: string; name: string }[];
    templates: { id: string; selectionProcessId: string | null; competencies: { id: string }[] }[];
    startDay: number;
  },
): Promise<void> {
  const steps = await db.candidateSelectionStep.findMany({ where: { candidateId }, orderBy: { seqNo: "asc" } });
  let i = 0;
  for (const s of steps) {
    const stg = ctx.stages.find((x) => x.id === s.selectionProcessId);
    if (!stg) continue;
    const tpl = ctx.templates.find((t) => t.selectionProcessId === stg.id);
    await scheduleStep(db, { stepId: s.id, planDate: new Date(Date.now() + (ctx.startDay + i * 2) * 86_400_000).toISOString(), performedById: ctx.ev1.id, actorName: "Demo Seed F4" });
    if (tpl) {
      const compIds = tpl.competencies.map((c) => c.id);
      await saveScorecard(db, {
        selectionStepId: s.id, evaluatorId: ctx.ev1.id, templateId: tpl.id,
        items: compIds.map((id, k) => ({ competencyId: id, score: k === 1 ? 5 : 4 })),
        recommendation: "Hire",
        overallComment: `Hasil ${stg.name} positif — direkomendasikan lanjut.`,
        submit: true,
      }, "Demo Seed F4");
    }
    await recordStepResult(db, {
      stepId: s.id, outcome: "Pass", performedById: ctx.ev1.id,
      score: stg.code === "PSIKOTES" ? 84 : null,
      result: stg.code === "PSIKOTES" ? "Skor 84 — di atas batas kelulusan" : "Memenuhi standar",
      actorName: "Demo Seed F4",
    });
    i++;
  }
}

async function seedDemoF4(schemaName: string): Promise<string> {
  const db = getTenantClient(schemaName);
  const existing = await db.candidateOffer.count();
  if (existing > 0) return "";

  const pr4 = await db.personnelRequisition.findUnique({ where: { prNo: "PR-2026-0004" } });
  const pr8 = await db.personnelRequisition.findUnique({ where: { prNo: "PR-2026-0008" } });
  if (!pr4 || !pr8) return "";
  const jo2 = await db.jobOpening.findFirst({ where: { prId: pr4.id }, include: { jobOpportunity: { select: { refNo: true } } } });

  const applicants = await db.applicant.findMany({
    where: { status: "Active" },
    select: { id: true, applicantNo: true, firstName: true, lastName: true },
    orderBy: { applicantNo: "asc" },
  });
  const byFirst = (n: string) => applicants.find((a) => a.firstName === n);

  const emps = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, fullName: true, employeeNo: true },
    orderBy: { employeeNo: "asc" }, take: 4,
  });
  if (emps.length < 1) return "";
  const ev1 = emps[0]!;
  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  const nominatorId = hrdUser?.employeeId ?? ev1.id;

  const stages = await db.selectionProcess.findMany({ where: { active: true }, orderBy: { processOrder: "asc" }, select: { id: true, code: true, name: true } });
  const templates = await db.scorecardTemplate.findMany({ include: { competencies: { orderBy: { orderNo: "asc" } } } });
  const ctx = { ev1, stages, templates, startDay: -20 };

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const days = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
  };

  // ---- 1) PR-2026-0004: Rina — offer DIKIRIM (target E2E: terima → angkat) ----
  const rina = byFirst("Rina");
  if (!rina) return "";
  const rinaCand = await nominateApplicant(db, { prId: pr4.id, applicantId: rina.id, nominatedById: nominatorId, actorName: "Demo Seed F4" });
  await passAllStages(db, rinaCand.id, ctx);
  const rinaOffer = await createOffer(db, {
    prId: pr4.id, candidateId: rinaCand.id, jobOpeningId: jo2?.id ?? null,
    salary: 8_500_000, startDate: iso(days(21)), expiryDate: iso(days(2)),
    note: "Sesuai rentang iklan JO — hasil negosiasi tahap offering.",
  }, { id: nominatorId, name: "Demo Seed F4" });
  const rinaSend = await sendOffer(db, { id: rinaOffer.id, actorId: nominatorId, actorName: "Demo Seed F4" });
  if (!rinaSend.sent) {
    // struktur approval aktif → putuskan (ADMIN memutus utk demo seed)
    await decideOfferApproval(db, {
      id: rinaOffer.id, action: "approve",
      note: "Gaji dalam rentang JO — disetujui.",
      actor: { role: "ADMIN", employeeId: nominatorId, name: "Demo Seed F4" },
    });
  }

  // ---- 2) PR-2026-0004: Fajar — offer DITOLAK + counter note ----
  const fajar = byFirst("Fajar");
  if (fajar) {
    const fajarCand = await nominateApplicant(db, { prId: pr4.id, applicantId: fajar.id, nominatedById: nominatorId, actorName: "Demo Seed F4" });
    await passAllStages(db, fajarCand.id, ctx);
    const fajarOffer = await createOffer(db, {
      prId: pr4.id, candidateId: fajarCand.id, jobOpeningId: jo2?.id ?? null,
      salary: 7_500_000, startDate: iso(days(21)), expiryDate: iso(days(7)),
      note: null,
    }, { id: nominatorId, name: "Demo Seed F4" });
    const fajarSend = await sendOffer(db, { id: fajarOffer.id, actorId: nominatorId, actorName: "Demo Seed F4" });
    if (!fajarSend.sent) {
      await decideOfferApproval(db, {
        id: fajarOffer.id, action: "approve",
        actor: { role: "ADMIN", employeeId: nominatorId, name: "Demo Seed F4" },
      });
    }
    await respondOffer(db, {
      id: fajarOffer.id, action: "decline",
      note: "Counter: minta Rp 8,5 jt + tunjangan transport — dipertimbangkan HR (catatan nego).",
      actorName: "Demo Seed F4",
    });
  }

  // ---- 3) PR-2026-0008: Siti — SIKLUS PENUH: offer diterima → pengangkatan
  //         → onboarding → Employee + PR otomatis FULFILLED (funnel Hired) ----
  const siti = byFirst("Siti");
  let hiredNote = "";
  if (siti) {
    const sitiCand = await nominateApplicant(db, { prId: pr8.id, applicantId: siti.id, nominatedById: nominatorId, actorName: "Demo Seed F4" });
    await passAllStages(db, sitiCand.id, ctx);
    const sitiOffer = await createOffer(db, {
      prId: pr8.id, candidateId: sitiCand.id, jobOpeningId: null,
      salary: 25_000_000, startDate: iso(days(14)), expiryDate: iso(days(7)),
      note: "Paket executive sesuai kebijakan direksi.",
    }, { id: nominatorId, name: "Demo Seed F4" });
    const sitiSend = await sendOffer(db, { id: sitiOffer.id, actorId: nominatorId, actorName: "Demo Seed F4" });
    if (!sitiSend.sent) {
      await decideOfferApproval(db, {
        id: sitiOffer.id, action: "approve",
        note: "Paket executive disetujui direksi.",
        actor: { role: "ADMIN", employeeId: nominatorId, name: "Demo Seed F4" },
      });
    }
    await respondOffer(db, { id: sitiOffer.id, action: "accept", actorName: "Demo Seed F4" });

    // pengangkatan — prefill dari PR (posisi CEO, status Permanent)
    const pr8Full = await db.personnelRequisition.findUnique({
      where: { id: pr8.id },
      select: { positionId: true, orgUnitId: true, companyOfficeId: true, employmentStatus: true },
    });
    const appt = await appoint(db, {
      offerId: sitiOffer.id,
      appointmentDate: iso(days(14)),
      positionId: pr8Full?.positionId ?? null,
      orgUnitId: pr8Full?.orgUnitId ?? null,
      companyOfficeId: pr8Full?.companyOfficeId ?? null,
      supervisorId: ev1.id,
      employmentStatus: pr8Full?.employmentStatus ?? "Permanent",
      note: "Pengangkatan hasil rekrutmen demo F4.",
    }, { id: nominatorId, name: "Demo Seed F4" });

    // lanjut ke onboarding → Employee + checklist (tanpa req → email dilewati)
    const onboard = await continueToOnboarding(db, {
      appointmentId: appt.appointmentId,
      actor: { id: nominatorId, name: "Demo Seed F4" },
    });
    hiredNote = ` · Siti → karyawan ${onboard.employeeNo} + onboarding (PR Fulfilled)`;
  }

  return `PR-2026-0004: Rina offer terkirim (expiry 2 hari — target E2E) + Fajar ditolak (counter)${hiredNote}`;
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f4] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        // Race-safe: ADD CONSTRAINT paralel dua penulis → 42710 (idempoten)
        try {
          await c.query(ddl);
        } catch (e) {
          const pgCode = (e as { code?: string }).code;
          if (pgCode !== "42710" && !/already exists/.test(String(e))) throw e;
        }
      }
      console.log(`    2 tabel F4 siap (CandidateOffer, CandidateAppointment)`);
    } finally {
      await c.end();
    }

    // referensi (semua tenant)
    const db = getTenantClient(schemaName);
    const notes = await ensureF4Reference(db);
    if (notes.length > 0) console.log(`    referensi: ${notes.join(" · ")}`);

    // demo hanya untuk tenant MII
    if (schemaName.includes("mitra_industri")) {
      const demo = await seedDemoF4(schemaName);
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
