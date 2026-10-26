// RESEED DEMO REKRUTMENT MII (sekali pakai, pasca-insiden parity ter-interupsi).
// Latar: boot pertama dev server kena panic Turbopack di tengah pipeline parity —
// demo F2 terputus setelah membuat JO (sebelum pelamar), sehingga guard idempotensi
// (jobOpportunity.count() > 0) mem-block re-seed di boot bersih berikutnya.
// Akibat: pelamar eksternal F2 kosong → demo F3 hanya kandidat internal → demo F4
// (offer) ter-skip.
// Solusi: TRUNCATE 36 tabel bounded-context rekrutmen HANYA di schema MII
// (RESTART IDENTITY CASCADE — aman: tak ada tabel non-rekrutmen yang ber-FK ke
// tabel ini; ActivityLog/Notification memakai entityType+entityId string), lalu
// jalankan ulang migrasi F0–F5 (semuanya idempoten: tabel ada → skip DDL;
// seed referensi & demo jalan karena tabel kosong).
//
// PENTING (pelajaran race attempt #1): modul migrasi punya CLI guard
// `if (process.argv[1]?.includes("/scripts/")) main()` — skrip ini sendiri ada
// di /scripts/, sehingga argv[1] milik proses INI membuat modul ter-impor
// AUTO-RUN main() utk SEMUA tenant (fire-and-forget) dan berlomba dengan
// panggilan eksplisit. Netralkan argv[1] SEBELUM impor dinamis.
process.argv[1] = "/tmp/reseed-runner";

import "./lib/env";
import { Client } from "pg";

const TABLES = [
  "RecruitmentMethod",
  "AdMediaType",
  "EmploymentAgency",
  "RecruitmentCostItem",
  "Skill",
  "RequiredDocument",
  "EvaluationCategory",
  "EvaluationScale",
  "SlaGroup",
  "SelectionProcess",
  "PersonnelRequisition",
  "JobOpportunity",
  "JobOpening",
  "JobOpeningMethod",
  "Applicant",
  "ApplicantEducation",
  "ApplicantExperience",
  "ApplicantSkill",
  "ApplicantDocument",
  "ApplicantApplication",
  "PublicApplication",
  "ApplicantConsent",
  "JobCandidate",
  "CandidateSelectionStep",
  "ScorecardTemplate",
  "ScorecardCompetency",
  "CandidateScorecard",
  "ScorecardItem",
  "RecruitmentLetter",
  "CandidateOffer",
  "CandidateAppointment",
  "RecruitmentPlan",
  "RecruitmentBudget",
  "EmpJobApplication",
];

const MII = "tenant_pt_mitra_industri_internasional";

async function reseed() {
  console.log("== Reseed demo rekrutmen MII ==");
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja" });
  await c.connect();
  const list = TABLES.map((t) => `${MII}."${t}"`).join(", ");
  await c.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`TRUNCATE ${TABLES.length} tabel rekrutmen @ ${MII} OK`);
  await c.end();

  console.log("\n-- F0 --");
  await (await import("./migrate-recruitment-f0")).main([MII]);
  console.log("\n-- F1 --");
  await (await import("./migrate-recruitment-f1")).main([MII]);
  console.log("\n-- F2 --");
  await (await import("./migrate-recruitment-f2")).main([MII]);
  console.log("\n-- F3 --");
  await (await import("./migrate-recruitment-f3")).main([MII]);
  console.log("\n-- F4 --");
  await (await import("./migrate-recruitment-f4")).main([MII]);
  console.log("\n-- F5 --");
  await (await import("./migrate-recruitment-f5")).main([MII]);

  // Verifikasi data demo
  const { getTenantClient } = await import("@/rekankerja/shared/lib/tenant-db");
  const db = getTenantClient(MII);
  const [pr, jo, app, cand, offer, plan, budget, emp] = await Promise.all([
    db.personnelRequisition.count(),
    db.jobOpportunity.count(),
    db.applicant.count(),
    db.jobCandidate.count(),
    db.candidateOffer.count(),
    db.recruitmentPlan.count(),
    db.recruitmentBudget.count(),
    db.empJobApplication.count(),
  ]);
  console.log(`\n== HASIL: PR=${pr} JO=${jo} Applicant=${app} Kandidat=${cand} Offer=${offer} Plan=${plan} Budget=${budget} LamaranInternal=${emp}`);
  if (app < 5 || cand < 6 || offer < 1) {
    console.error("!! Verifikasi GAGAL — demo tidak lengkap");
    process.exit(1);
  }
}

// Akun ESS demo rina.ess (Rina Maulida MII00006) — replikasi state final F5
// (worklog F5-UI: "buat akun ESS demo rina.ess@mii.co.id — platform+AppUser
// role ESS+membership MII"). Idempoten.
async function seedRinaEss() {
  const { db: platform } = await import("@/lib/db");
  const { hashPassword } = await import("@/rekankerja/shared/lib/auth");
  const { getTenantClient } = await import("@/rekankerja/shared/lib/tenant-db");
  const db = getTenantClient(MII);
  const EMAIL = "rina.ess@mii.co.id";
  const PASSWORD = "EssDemo123!";

  const emp = await db.employee.findFirst({ where: { employeeNo: "MII00006" } });
  if (!emp) throw new Error("Karyawan MII00006 (Rina) tidak ditemukan");

  let appUser = await db.appUser.findFirst({ where: { email: EMAIL } });
  if (!appUser) {
    appUser = await db.appUser.create({
      data: { username: emp.employeeNo, fullName: emp.fullName, email: EMAIL, role: "Approver", employeeId: emp.id, passwordChangedAt: new Date() },
    });
    console.log(`[rina.ess] AppUser ${emp.fullName} (${emp.employeeNo}) dibuat`);
  } else {
    await db.appUser.update({ where: { id: appUser.id }, data: { employeeId: emp.id, email: EMAIL } });
    console.log("[rina.ess] AppUser sudah ada — di-refresh");
  }

  const existing = await db.userMenuAccess.findUnique({ where: { appUserId: appUser.id } });
  if (!existing) await db.userMenuAccess.create({ data: { appUserId: appUser.id, mode: "CUSTOM", menusJson: "{}" } });

  let user = await platform.user.findUnique({ where: { email: EMAIL } });
  if (!user) user = await platform.user.create({ data: { email: EMAIL, name: emp.fullName, passwordHash: hashPassword(PASSWORD) } });
  const tenant = await platform.tenant.findFirst({ where: { slug: "pt-mitra-industri-internasional" } });
  if (!tenant) throw new Error("Tenant MII tidak ditemukan");
  const m = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
  if (!m) await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "HR" } });

  const hist = await db.passwordHistory.findFirst({ where: { appUserId: appUser.id } });
  if (!hist) await db.passwordHistory.create({ data: { appUserId: appUser.id, hash: hashPassword(PASSWORD) } });

  console.log(`[rina.ess] Akun demo ESS siap: ${EMAIL} / ${PASSWORD}`);
  await platform.$disconnect();
}

async function main() {
  await reseed();
  console.log("\n== Akun ESS demo ==");
  await seedRinaEss();
  console.log("\n== RESEED SELESAI ==");
  process.exit(0);
}

main().catch((e) => {
  console.error("RESEED GAGAL:", e);
  process.exit(1);
});
