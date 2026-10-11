// Migrasi F5-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F5) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×3 (RecruitmentPlan, RecruitmentBudget,
//      EmpJobApplication) + ALTER TABLE JobOpportunity ADD COLUMN IF NOT
//      EXISTS internalOnly/internalFirstUntil + unique/index/FK drop-add —
//      selaras prisma/schema-tenant.prisma.
//   2. Demo seed MII (insert-only bila RecruitmentPlan masih kosong) — SEMUA
//      lewat jalur produksi (createPlan/applyPlan/upsertBudget/upsertMethod/
//      createPr→applyPr→decidePr/createJo/applyInternalJob):
//        • Rencana 2026 (3 baris — Applied): Accountant (d sinkron headcount),
//          Chief Executive Officer (e=1 rekrut Siti via PR-0008), Software
//          Engineer (h=2 tanpa PR — ajukan PR) + rekonsiliasi PR otomatis.
//        • Anggaran 2026: 50 jt + penyesuaian 5 jt; realisasi (used) =
//          Σ actualCost method JO 2026 (ADVERT 4,32 jt + AGENCY 7,5 jt baru)
//          = 11,82 jt → sisa 43,18 jt.
//        • Posting internal-first: PR Digital Marketing Staff (Approved via
//          engine) → JO Posted internalFirstUntil +7 hari (TIDAK tayang di
//          portal publik selama jendela; hanya ESS Lowongan Internal) + kanal
//          IJP + lamaran internal Yusuf Rahayu (MII00010) via applyInternalJob
//          (JobCandidate source Internal + steps + notifikasi).
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping
// modul) ATAU CLI: bun run scripts/migrate-recruitment-f5.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { createPlan, applyPlan, upsertBudget } from "@/rekankerja/recruitment/services/planning-service";
import { createJo, upsertMethod } from "@/rekankerja/recruitment/services/opening-service";
import { createPr, applyPr, decidePr } from "@/rekankerja/recruitment/services/pr-service";
import { applyInternalJob } from "@/rekankerja/recruitment/services/internal-apply-service";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "RecruitmentPlan" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "seqNo" INTEGER NOT NULL DEFAULT 1,
    "positionId" TEXT,
    "positionTitle" TEXT NOT NULL,
    "companyOfficeId" TEXT,
    "targetA" INTEGER NOT NULL DEFAULT 0,
    "adjustB" INTEGER NOT NULL DEFAULT 0,
    "empD" INTEGER NOT NULL DEFAULT 0,
    "inE" INTEGER NOT NULL DEFAULT 0,
    "outF" INTEGER NOT NULL DEFAULT 0,
    "salaryBudget" TEXT,
    "basePeriod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "note" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentPlan_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RecruitmentBudget" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalBudget" TEXT NOT NULL,
    "adjust" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentBudget_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "EmpJobApplication" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "jobOpeningId" TEXT NOT NULL,
    "candidateId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmpJobApplication_pkey" PRIMARY KEY ("id")
  )`,
  // F5 — jendela internal-first pada JobOpportunity (portal publik memfilter)
  `ALTER TABLE "JobOpportunity" ADD COLUMN IF NOT EXISTS "internalOnly" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "JobOpportunity" ADD COLUMN IF NOT EXISTS "internalFirstUntil" TIMESTAMP(3)`,
];

const AFTER_TABLE: string[] = [
  `CREATE INDEX IF NOT EXISTS "RecruitmentPlan_period_idx" ON "RecruitmentPlan"("period")`,
  `CREATE INDEX IF NOT EXISTS "RecruitmentPlan_status_idx" ON "RecruitmentPlan"("status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecruitmentBudget_period_key" ON "RecruitmentBudget"("period")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EmpJobApplication_employeeId_jobOpeningId_key" ON "EmpJobApplication"("employeeId", "jobOpeningId")`,
  `CREATE INDEX IF NOT EXISTS "EmpJobApplication_employeeId_idx" ON "EmpJobApplication"("employeeId")`,
  `CREATE INDEX IF NOT EXISTS "EmpJobApplication_jobOpeningId_idx" ON "EmpJobApplication"("jobOpeningId")`,
  // FK drop-add idempoten (pola F2–F4)
  `ALTER TABLE "RecruitmentPlan" DROP CONSTRAINT IF EXISTS "RecruitmentPlan_positionId_fkey"`,
  `ALTER TABLE "RecruitmentPlan" ADD CONSTRAINT "RecruitmentPlan_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "RecruitmentPlan" DROP CONSTRAINT IF EXISTS "RecruitmentPlan_companyOfficeId_fkey"`,
  `ALTER TABLE "RecruitmentPlan" ADD CONSTRAINT "RecruitmentPlan_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "EmpJobApplication" DROP CONSTRAINT IF EXISTS "EmpJobApplication_employeeId_fkey"`,
  `ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EmpJobApplication" DROP CONSTRAINT IF EXISTS "EmpJobApplication_jobOpeningId_fkey"`,
  `ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_jobOpeningId_fkey" FOREIGN KEY ("jobOpeningId") REFERENCES "JobOpening"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EmpJobApplication" DROP CONSTRAINT IF EXISTS "EmpJobApplication_candidateId_fkey"`,
  `ALTER TABLE "EmpJobApplication" ADD CONSTRAINT "EmpJobApplication_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "JobCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

// ============ demo seed (MII saja — insert-only bila plan kosong) ============

async function seedDemoF5(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.recruitmentPlan.count();
  if (existing > 0) return "";

  const year = String(new Date().getFullYear());
  const days = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  const hrdEmployeeId = hrdUser?.employeeId ?? null;
  if (!hrdEmployeeId) return "";

  const position = async (title: string) => db.position.findFirst({
    where: { title: { equals: title, mode: "insensitive" }, active: true },
    select: { id: true, orgUnitId: true },
  });

  // ---- 1) Rencana 2026 — 3 baris (semua di-Apply via jalur produksi) ----
  const accountant = await position("Accountant");
  const row1 = await createPlan(db, {
    period: year,
    positionId: accountant?.id ?? null,
    positionTitle: "Accountant",
    targetA: 2, adjustB: 1, // (a)+(b) = 3 target
    empD: 2, // karyawan awal (Tuti MII00013, Joko MII00014 — Rina W. rekrut periode ini)
    inE: 1, outF: 0, // (e) Rina Wulandari MII00049 via PR-2026-0004 → (g)=3 → (h)=0
    salaryBudget: 21_000_000,
    basePeriod: String(Number(year) - 1),
    note: "Ekspansi tim keuangan — target tercapai lewat rekrutmen PR-2026-0004.",
  }, "Demo Seed F5");
  await applyPlan(db, row1.id, "Demo Seed F5");

  const ceo = await position("Chief Executive Officer");
  const row2 = await createPlan(db, {
    period: year,
    positionId: ceo?.id ?? null,
    positionTitle: "Chief Executive Officer",
    targetA: 2, adjustB: 0,
    empD: 1, // Hartono MII00001 di awal periode
    inE: 1, outF: 0, // (e) Siti Rahmawati MII00048 via PR-2026-0008 → (g)=2 → (h)=0
    salaryBudget: 60_000_000,
    note: "Penambahan co-CEO lini operasional — PR-2026-0003 masih terbuka (1 slot).",
  }, "Demo Seed F5");
  await applyPlan(db, row2.id, "Demo Seed F5");

  const se = await position("Software Engineer");
  const row3 = await createPlan(db, {
    period: year,
    positionId: se?.id ?? null,
    positionTitle: "Software Engineer",
    targetA: 5, adjustB: -1, // efisiensi: (c)=4
    empD: 3, inE: 0, outF: 1, // (g)=2 → (h)=2 kebutuhan rekrut
    salaryBudget: 32_000_000,
    note: "Rotasi keluar 1 orang — butuh 2 rekrut; PR sebelumnya ditolak/dibatalkan, ajukan PR baru.",
  }, "Demo Seed F5");
  await applyPlan(db, row3.id, "Demo Seed F5");

  // ---- 2) Anggaran 2026 + realisasi method (AGENCY 7,5 jt di JO-2026-0002) ----
  await upsertBudget(db, {
    period: year,
    totalBudget: 50_000_000,
    adjust: 5_000_000,
    note: "Anggaran rekrutmen tahunan + penyesuaian Q3 (approval direksi).",
  }, "Demo Seed F5");

  const jo2 = await db.jobOpportunity.findUnique({ where: { refNo: `JO-${year}-0002` }, select: { id: true } });
  const methods = await db.recruitmentMethod.findMany({ select: { id: true, code: true } });
  const agencies = await db.employmentAgency.findMany({ select: { id: true }, take: 1 });
  const costItems = await db.recruitmentCostItem.findMany({ select: { id: true, name: true } });
  if (jo2) {
    await upsertMethod(db, {
      jobOpportunityId: jo2.id,
      methodId: methods.find((m) => m.code === "AGENCY")?.id ?? methods[0]!.id,
      agencyId: agencies[0]?.id ?? null,
      costItemId: costItems.find((c) => c.name.toLowerCase().includes("agency"))?.id ?? null,
      plannedCost: 8_000_000,
      actualCost: 7_500_000,
      datePosted: days(-4),
      note: "Fee agency penempatan Accountant (realisasi).",
    }, "Demo Seed F5");
  }

  // ---- 3) Posting internal-first: PR Digital Marketing Staff → JO ESS-only window ----
  const dms = await position("Digital Marketing Staff");
  if (!dms) return `3 baris rencana ${year} + anggaran`;
  const pr = await createPr(db, {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedById: hrdEmployeeId,
    positionId: dms.id,
    orgUnitId: dms.orgUnitId,
    requiredNo: 1,
    employmentStatus: "Permanent",
    preferredSource: "Internal",
    earliestDate: days(7), latestDate: days(45),
    reason: "Kebutuhan Digital Marketing Staff diisi lewat mobilitas internal (IJP) sebelum dibuka ke publik.",
    miscSpec: "Prioritas karyawan internal — jendela internal-first 7 hari.",
    additionalQualification: "Paham tools ads & analytics; portofolio campaign digital.",
    salaryBudget: 7_500_000,
    autoPostOpening: false, slaTargetDays: 40,
  }, { submit: false, actorName: "Demo Seed F5" });
  await applyPr(db, pr.id, "Demo Seed F5");
  await decidePr(db, {
    id: pr.id, action: "approve",
    note: "Disetujui — jalankan internal job posting (IJP) lebih dulu.",
    actor: { role: "HR", employeeId: hrdEmployeeId, name: "Demo HR (seed)" },
  });

  const jo = await createJo(db, {
    title: "Mobilitas Internal — Digital Marketing Staff",
    contactPerson: "Tim Rekrutmen MII",
    lastAcceptDate: days(14),
    content: "Peluang bagi karyawan MII untuk berpindah/mengembangkan karier ke tim Digital Marketing. Dibuka khusus internal selama 7 hari pertama.",
    postNow: true,
    internalOnly: false,
    internalFirstUntil: days(7), // jendela internal-first aktif — ESS saja
    slots: [{
      prId: pr.id,
      titleToShow: "Digital Marketing Staff",
      workLocationId: null,
      salaryMin: 6_000_000,
      salaryMax: 9_000_000,
      jobDescSummary: "Menjalankan campaign digital, konten media sosial, dan analitik performa iklan.",
      jobSpecSummary: "Min. 1 tahun di marketing/konten; kuat di ads & analytics; komunikatif.",
    }],
  }, "Demo Seed F5");

  // kanal IJP (Internal Job Posting — tanpa biaya)
  const joRow = await db.jobOpportunity.findUnique({ where: { refNo: jo.refNo }, select: { id: true } });
  if (joRow) {
    await upsertMethod(db, {
      jobOpportunityId: joRow.id,
      methodId: methods.find((m) => m.code === "IJP")?.id ?? methods[0]!.id,
      costItemId: null,
      note: "Internal job posting via Portal Karyawan (ESS).",
    }, "Demo Seed F5");
  }

  // lamaran internal: Yusuf Rahayu MII00010 (akun ESS demo yusuf@mii.co.id)
  const yusuf = await db.employee.findFirst({ where: { employeeNo: "MII00010" }, select: { id: true } });
  const slot = jo.slots[0];
  let applied = "";
  if (yusuf && slot) {
    await applyInternalJob(db, {
      employeeId: yusuf.id,
      jobOpeningId: slot.id,
      note: "Tertarik pindah jalur karier ke digital marketing — portofolio campaign internal 2025.",
      actorName: "Demo Seed F5",
    });
    applied = ` + lamaran internal Yusuf (MII00010) ke ${jo.refNo}`;
  }

  return `rencana ${year} (3 baris Applied) + anggaran (50+5 jt, used 11,82 jt) + posting internal-first ${jo.refNo}${applied}`;
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f5] schema: ${list.join(", ")}`);
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
      console.log(`    3 tabel F5 siap (RecruitmentPlan, RecruitmentBudget, EmpJobApplication) + 2 kolom JO internal`);
    } finally {
      await c.end();
    }

    // demo hanya untuk tenant MII
    if (schemaName.includes("mitra_industri")) {
      const demo = await seedDemoF5(schemaName);
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
