import pg from "pg";
const t = new pg.Client({ host: "localhost", port: 5432, user: "onevity", password: "onevity_dev", database: "onevity" });
await t.connect();
const s = "tenant_pt_mitra_industri_internasional";
const q = async (label, sql) => {
  const r = await t.query(sql.replaceAll("$S", s));
  console.log("== " + label);
  for (const row of r.rows) console.log("  ", JSON.stringify(row));
};
await q("Employee", 'SELECT "employeeNo", "fullName", status, "joinDate" FROM $S."Employee" WHERE "employeeNo"=\'MII00046\'');
await q("Assignment", 'SELECT p.title, ou.name, a."employmentStatus" FROM $S."EmployeeAssignment" a JOIN $S."Employee" e ON e.id=a."employeeId" JOIN $S."Position" p ON p.id=a."positionId" JOIN $S."OrgUnit" ou ON ou.id=a."orgUnitId" WHERE e."employeeNo"=\'MII00046\'');
await q("Kandidat", 'SELECT status FROM $S."JobCandidate" WHERE id=\'cmv4m1q0h001fobvotkgzkr3g\'');
await q("Pelamar", 'SELECT status FROM $S."Applicant" WHERE id=\'cmv4m1hfh0015obvode5dtek4\'');
await q("Pengangkatan", 'SELECT status, "employeeId" IS NOT NULL AS emp, "onboardingId" IS NOT NULL AS onb FROM $S."CandidateAppointment" WHERE id=\'cmv4m67sk0038obvofzhrizzc\'');
await q("Lamaran pelamar", 'SELECT a.status FROM $S."ApplicantApplication" a WHERE a."applicantId"=\'cmv4m1hfh0015obvode5dtek4\'');
await q("Surat", 'SELECT "letterNo", kind FROM $S."RecruitmentLetter" WHERE "candidateId"=\'cmv4m1q0h001fobvotkgzkr3g\'');
await q("ActivityLog hire", 'SELECT action, "entityId", LEFT(detail,120) AS detail FROM $S."ActivityLog" WHERE entity=\'Employee\' AND "entityId"=\'MII00046\'');
await q("Tabel onboarding", 'SELECT table_name FROM information_schema.tables WHERE table_schema=\''+s+'\' AND table_name ILIKE \'%nboard%\'');
await t.end();
