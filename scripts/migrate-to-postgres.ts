// Migrasi sekali-jalan: SQLite legacy (db/custom.db) → PostgreSQL multi-tenant.
// 1. Baca seluruh data lama via client legacy (schema-legacy-sqlite.prisma)
// 2. Provision schema tenant_pt_mitra_industri_internasional (DDL + tanpa seed — data dibawa penuh)
// 3. Insert seluruh baris (ID asli dipertahankan) dalam urutan dependensi FK
// 4. Registry platform: Tenant + User owner (hrd@mii.co.id / onevity123) + UserTenant OWNER
// Jalankan: bun run scripts/migrate-to-postgres.ts
import { PrismaClient as Legacy } from "@/generated/legacy";
import { PrismaClient as Platform } from "@/generated/platform";
import { provisionTenantSchema, slugify, schemaNameForSlug } from "@/lib/rekankerja/provisioning";
import { getTenantClient } from "@/lib/rekankerja/tenant-db";
import { hashPassword } from "@/lib/rekankerja/auth";

const legacy = new Legacy({ datasources: { db: { url: process.env.LEGACY_SQLITE_URL ?? "file:/home/z/my-project/db/custom.db" } } });
const platform = new Platform();

const OWNER_EMAIL = "hrd@mii.co.id";
const OWNER_PASSWORD = "onevity123";

async function main() {
  console.log("== Migrasi SQLite → PostgreSQL multi-tenant ==");

  // ---------- 1. baca data lama ----------
  const company = (await legacy.company.findMany())[0]!;
  console.log(`Perusahaan: ${company.name}`);

  const [
    lookups, orgUnits, grades, jobs, positions, employees, assignments, families, educations,
    experiences, disciplinaries, appUsers, accessGroups, accessGroupMembers, approvalTemplates,
    temporaryApprovers, wageComponents, accountGroups, accounts, postingEvents, processTypes,
    payrollPeriods, taxBrackets, terRates, payrollRegulations, wageTemplates, wageTemplateItems,
    employeePayrollProfiles, employeeComponentAssignments, employeeLoans, loanInstallments,
    payrollRuns, payrollRunLines, payrollRunItems, payrollJournals, payrollJournalLines,
    benefitTypes, benefitClaims, personnelActions, approvalLayers, activityLogs,
  ] = await Promise.all([
    legacy.lookup.findMany(),
    legacy.orgUnit.findMany(),
    legacy.grade.findMany(),
    legacy.job.findMany(),
    legacy.position.findMany(),
    legacy.employee.findMany(),
    legacy.employeeAssignment.findMany(),
    legacy.employeeFamily.findMany(),
    legacy.employeeEducation.findMany(),
    legacy.employeeExperience.findMany(),
    legacy.disciplinaryRecord.findMany(),
    legacy.appUser.findMany(),
    legacy.accessGroup.findMany(),
    legacy.accessGroupMember.findMany(),
    legacy.approvalTemplate.findMany(),
    legacy.temporaryApprover.findMany(),
    legacy.wageComponent.findMany(),
    legacy.accountGroup.findMany(),
    legacy.account.findMany(),
    legacy.postingEvent.findMany(),
    legacy.processType.findMany(),
    legacy.payrollPeriod.findMany(),
    legacy.taxBracket.findMany(),
    legacy.terRate.findMany(),
    legacy.payrollRegulation.findMany(),
    legacy.wageTemplate.findMany(),
    legacy.wageTemplateItem.findMany(),
    legacy.employeePayrollProfile.findMany(),
    legacy.employeeComponentAssignment.findMany(),
    legacy.employeeLoan.findMany(),
    legacy.loanInstallment.findMany(),
    legacy.payrollRun.findMany(),
    legacy.payrollRunLine.findMany(),
    legacy.payrollRunItem.findMany(),
    legacy.payrollJournal.findMany(),
    legacy.payrollJournalLine.findMany(),
    legacy.benefitType.findMany(),
    legacy.benefitClaim.findMany(),
    legacy.personnelAction.findMany(),
    legacy.approvalLayer.findMany(),
    legacy.activityLog.findMany(),
  ]);

  const total = [company, lookups, orgUnits, grades, jobs, positions, employees, assignments, families, educations, experiences, disciplinaries, appUsers, accessGroups, accessGroupMembers, approvalTemplates, temporaryApprovers, wageComponents, accountGroups, accounts, postingEvents, processTypes, payrollPeriods, taxBrackets, terRates, payrollRegulations, wageTemplates, wageTemplateItems, employeePayrollProfiles, employeeComponentAssignments, employeeLoans, loanInstallments, payrollRuns, payrollRunLines, payrollRunItems, payrollJournals, payrollJournalLines, benefitTypes, benefitClaims, personnelActions, approvalLayers, activityLogs].reduce((a, x) => a + (Array.isArray(x) ? x.length : 1), 0);
  console.log(`Total baris terbaca: ${total} (termasuk PayrollRunItem ${payrollRunItems.length})`);

  // ---------- 2. provision schema tenant ----------
  const slug = slugify(company.name); // pt-mitra-industri-internasional
  const schemaName = schemaNameForSlug(slug);
  console.log(`Provision schema: ${schemaName} …`);
  // reset-safe (idempotent): drop dulu agar re-run bersih
  {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    await c.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await c.end();
  }
  await provisionTenantSchema(schemaName);
  const db = getTenantClient(schemaName);

  // ---------- 3. insert (urutan dependensi FK; self-ref diurutkan per level) ----------
  const sortedOrgUnits = [...orgUnits].sort((a, b) => a.level - b.level);
  const sortedPositions = [...positions].sort((a, b) => a.level - b.level);

  await db.company.create({ data: company });
  await db.lookup.createMany({ data: lookups });
  await db.orgUnit.createMany({ data: sortedOrgUnits });
  await db.grade.createMany({ data: grades });
  await db.job.createMany({ data: jobs });
  await db.position.createMany({ data: sortedPositions });
  await db.employee.createMany({ data: employees });
  await db.employeeAssignment.createMany({ data: assignments });
  await db.employeeFamily.createMany({ data: families });
  await db.employeeEducation.createMany({ data: educations });
  await db.employeeExperience.createMany({ data: experiences });
  await db.disciplinaryRecord.createMany({ data: disciplinaries });
  await db.appUser.createMany({ data: appUsers });
  await db.accessGroup.createMany({ data: accessGroups });
  await db.accessGroupMember.createMany({ data: accessGroupMembers });
  await db.approvalTemplate.createMany({ data: approvalTemplates });
  await db.temporaryApprover.createMany({ data: temporaryApprovers });
  await db.wageComponent.createMany({ data: wageComponents });
  await db.accountGroup.createMany({ data: accountGroups });
  await db.account.createMany({ data: accounts });
  await db.postingEvent.createMany({ data: postingEvents });
  await db.processType.createMany({ data: processTypes });
  await db.payrollPeriod.createMany({ data: payrollPeriods });
  await db.taxBracket.createMany({ data: taxBrackets });
  await db.terRate.createMany({ data: terRates });
  await db.payrollRegulation.createMany({ data: payrollRegulations });
  await db.wageTemplate.createMany({ data: wageTemplates });
  await db.wageTemplateItem.createMany({ data: wageTemplateItems });
  await db.employeePayrollProfile.createMany({ data: employeePayrollProfiles });
  await db.employeeComponentAssignment.createMany({ data: employeeComponentAssignments });
  await db.employeeLoan.createMany({ data: employeeLoans });
  await db.loanInstallment.createMany({ data: loanInstallments });
  await db.payrollRun.createMany({ data: payrollRuns });
  await db.payrollRunLine.createMany({ data: payrollRunLines });
  await db.payrollRunItem.createMany({ data: payrollRunItems });
  await db.payrollJournal.createMany({ data: payrollJournals });
  await db.payrollJournalLine.createMany({ data: payrollJournalLines });
  await db.benefitType.createMany({ data: benefitTypes });
  await db.benefitClaim.createMany({ data: benefitClaims });
  await db.personnelAction.createMany({ data: personnelActions });
  await db.approvalLayer.createMany({ data: approvalLayers });
  await db.activityLog.createMany({ data: activityLogs });

  // ---------- 4. registry platform ----------
  const existingTenant = await platform.tenant.findFirst({ where: { slug } });
  const tenant = existingTenant ?? (await platform.tenant.create({
    data: { name: company.name, slug, schemaName },
  }));

  let user = await platform.user.findUnique({ where: { email: OWNER_EMAIL } });
  if (!user) {
    user = await platform.user.create({
      data: { email: OWNER_EMAIL, name: "Tri Handayani", passwordHash: hashPassword(OWNER_PASSWORD) },
    });
  }
  const membership = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
  if (!membership) {
    await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "OWNER" } });
  }

  // ---------- 5. verifikasi ----------
  const [empN, runN, itemN, claimN, journalN] = await Promise.all([
    db.employee.count(), db.payrollRun.count(), db.payrollRunItem.count(),
    db.benefitClaim.count(), db.payrollJournal.count(),
  ]);
  console.log("== Verifikasi tenant schema ==");
  console.log(`Employee ${empN}/${employees.length} · Run ${runN}/${payrollRuns.length} · RunItem ${itemN}/${payrollRunItems.length} · BenefitClaim ${claimN}/${benefitClaims.length} · Journal ${journalN}/${payrollJournals.length}`);
  console.log(`Platform: tenant=${tenant.slug} (schema ${schemaName}) owner=${OWNER_EMAIL}`);

  await legacy.$disconnect();
  await platform.$disconnect();
  console.log("== SELESAI ==");
}

main().catch((e) => { console.error(e); process.exit(1); });
