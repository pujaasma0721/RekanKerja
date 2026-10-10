// Migrasi F1-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F1) ke tenant
// existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS PersonnelRequisition (+ unique prNo + index
//      status/requestDate/requestedById + FK dimensi — selaras tenant-ddl.sql).
//   2. Seed struktur approval default AS-PR-STD (docType RecruitmentPR,
//      1 lapis ATASAN_LANGSUNG — insert-only bila code belum ada).
//   3. Seed demo PR dwibahasa untuk tenant MII (insert-only bila tabel masih
//      kosong): 1 Draft + 1 Submitted (chain hidup via engine) + 1 Approved
//      (diputuskan via engine) — jalur data SAMA dengan produksi.
// Dapat diimpor IN-PROCESS oleh src/rekankerja/shared/lib/parity-runner.ts
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-f1.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import {
  createPr, applyPr, decidePr,
} from "@/rekankerja/recruitment/services/pr-service";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "PersonnelRequisition" (
    "id" TEXT NOT NULL,
    "prNo" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT NOT NULL,
    "positionId" TEXT,
    "jobId" TEXT,
    "orgUnitId" TEXT,
    "companyOfficeId" TEXT,
    "requiredNo" INTEGER NOT NULL DEFAULT 1,
    "employmentStatus" TEXT NOT NULL DEFAULT 'Permanent',
    "preferredSource" TEXT,
    "earliestDate" TIMESTAMP(3),
    "latestDate" TIMESTAMP(3),
    "recruitmentOfficerId" TEXT,
    "reason" TEXT,
    "miscSpec" TEXT,
    "additionalQualification" TEXT,
    "salaryBudget" TEXT,
    "autoPostOpening" BOOLEAN NOT NULL DEFAULT false,
    "slaTargetDays" INTEGER,
    "replacedEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonnelRequisition_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "PersonnelRequisition_prNo_key" ON "PersonnelRequisition"("prNo")`,
  `CREATE INDEX IF NOT EXISTS "PersonnelRequisition_status_requestDate_idx" ON "PersonnelRequisition"("status", "requestDate")`,
  `CREATE INDEX IF NOT EXISTS "PersonnelRequisition_requestedById_idx" ON "PersonnelRequisition"("requestedById")`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_requestedById_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_positionId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_jobId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_orgUnitId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_companyOfficeId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_companyOfficeId_fkey" FOREIGN KEY ("companyOfficeId") REFERENCES "CompanyOffice"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_recruitmentOfficerId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_recruitmentOfficerId_fkey" FOREIGN KEY ("recruitmentOfficerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "PersonnelRequisition" DROP CONSTRAINT IF EXISTS "PersonnelRequisition_replacedEmployeeId_fkey"`,
  `ALTER TABLE "PersonnelRequisition" ADD CONSTRAINT "PersonnelRequisition_replacedEmployeeId_fkey" FOREIGN KEY ("replacedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
];

/** Seed struktur approval PR default (insert-only per code — via Prisma,
 *  konsisten dengan provisioning.ts defaultStructures). */
async function seedStructure(schema: string): Promise<boolean> {
  const db = getTenantClient(schema);
  const before = await db.approvalStructure.findUnique({ where: { code: "AS-PR-STD" }, select: { id: true } });
  if (before) return false;
  await db.approvalStructure.create({
    data: {
      code: "AS-PR-STD",
      name: "Persetujuan Permintaan Karyawan (default)",
      docType: "RecruitmentPR",
      levels: { create: [{ levelNo: 1, approverType: "ATASAN_LANGSUNG" }] },
    },
  });
  return true;
}

/** Seed demo PR MII — hanya bila tabel kosong (insert-only). */
async function seedDemoPrs(schema: string): Promise<number> {
  const db = getTenantClient(schema);
  const existing = await db.personnelRequisition.count();
  if (existing > 0) return 0;

  // karyawan demo: HR (linked AppUser hrd@mii.co.id) + 2 karyawan ber-atasan
  const hrdUser = await db.appUser.findFirst({
    where: { email: "hrd@mii.co.id" },
    select: { employeeId: true },
  });
  const hrdEmployeeId = hrdUser?.employeeId ?? null;
  const employees = await db.employee.findMany({
    where: { status: "Active" },
    select: { id: true, fullName: true, employeeNo: true },
    orderBy: [{ employeeNo: "asc" }],
    take: 30,
  });
  // karyawan dengan atasan valid (assignment aktif + managerId terisi)
  const withManager = await db.employeeAssignment.findMany({
    where: { validTo: null, managerId: { not: null }, employee: { status: "Active" } },
    select: { employeeId: true, employee: { select: { fullName: true } } },
    take: 20,
  });
  const positions = await db.position.findMany({
    where: { active: true },
    select: { id: true, title: true, orgUnitId: true },
    orderBy: [{ code: "asc" }],
    take: 6,
  });
  if (positions.length < 3 || employees.length === 0) return 0;

  const year = new Date().getFullYear();
  const plus = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  let created = 0;

  // 1) DRAFT — Staff Accounting (2 orang, Contract)
  await createPr(db, {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedById: employees[0]!.id,
    positionId: positions[0]!.id,
    orgUnitId: positions[0]!.orgUnitId,
    requiredNo: 2,
    employmentStatus: "Contract",
    preferredSource: "External",
    earliestDate: plus(30), latestDate: plus(90),
    reason: "Ekspansi lini produksi 2 — tambahan shift malam mulai kuartal depan.",
    miscSpec: "Siap kerja shift; domisili Bekasi/Cikarang diprioritaskan.",
    additionalQualification: "Paham basic accounting software (Accurate/Jurnal).",
    salaryBudget: 6_500_000,
    autoPostOpening: false, slaTargetDays: 45,
  }, { submit: false, actorName: "Demo Seed F1" });
  created++;

  // 2) SUBMITTED — chain hidup menunggu atasan pengaju (IT Support, 1 orang)
  const requester2 = withManager[0]?.employeeId ?? employees[0]!.id;
  const submitted = await createPr(db, {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedById: requester2,
    positionId: positions[1]?.id ?? positions[0]!.id,
    orgUnitId: positions[1]?.orgUnitId ?? null,
    requiredNo: 1,
    employmentStatus: "Permanent",
    preferredSource: "Any",
    earliestDate: plus(14), latestDate: plus(60),
    reason: "Rotasi karyawan ke cabang baru — kebutuhan pengganti segera.",
    miscSpec: null, additionalQualification: null,
    salaryBudget: 5_500_000,
    autoPostOpening: true, slaTargetDays: 30,
  }, { submit: false, actorName: "Demo Seed F1" });
  await applyPr(db, submitted.id, "Demo Seed F1");
  created++;
  void year;

  // 3) APPROVED — diputuskan via engine (Sales Executive, 1 orang, budget vault)
  const requester3 = hrdEmployeeId ?? employees[1]?.id ?? employees[0]!.id;
  const approved = await createPr(db, {
    requestDate: new Date().toISOString().slice(0, 10),
    requestedById: requester3,
    positionId: positions[2]?.id ?? positions[0]!.id,
    orgUnitId: positions[2]?.orgUnitId ?? null,
    requiredNo: 1,
    employmentStatus: "Permanent",
    preferredSource: "Internal",
    earliestDate: plus(7), latestDate: plus(45),
    reason: "Pertumbuhan portofolio klien kawasan timur — perlu account executive tambahan.",
    miscSpec: "Menggunakan mobil dinas perusahaan.",
    additionalQualification: "Minimal 2 tahun pengalaman B2B sales industri manufaktur.",
    salaryBudget: 8_500_000,
    autoPostOpening: true, slaTargetDays: 40,
  }, { submit: false, actorName: "Demo Seed F1" });
  await applyPr(db, approved.id, "Demo Seed F1");
  await decidePr(db, {
    id: approved.id, action: "approve", note: "Disetujui — silakan lanjut rekrutmen.",
    actor: { role: "HR", employeeId: hrdEmployeeId, name: "Demo HR (seed)" },
  });
  created++;

  return created;
}

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f1] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    let structured = false;
    try {
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        await c.query(ddl);
      }
      structured = await seedStructure(schemaName);
    } finally {
      await c.end();
    }
    // demo PR hanya untuk tenant MII (schema demo utama, data dwibahasa)
    const isMii = schemaName.includes("mitra_industri");
    const demo = isMii ? await seedDemoPrs(schemaName) : 0;
    console.log(`    tabel PersonnelRequisition siap${structured ? " + struktur AS-PR-STD" : ""}${demo ? ` + ${demo} PR demo` : ""}`);
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung (bun scripts/migrate-recruitment-f1.ts),
// BUKAN saat diimpor aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
