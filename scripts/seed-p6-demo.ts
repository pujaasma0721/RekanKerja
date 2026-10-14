// Seed data demo E2E P6-PERF (PIP End-to-End) — idempoten:
//   • Siklus PER-2026-CAL (Closed, periode 2026) + 3 AppraisalRecord Closed
//     rating 2 (bahan usul PIP §35-20 via merit pipDecide P5):
//     — Tuti Gunawan (MII00013, pembina Bambang Prakoso)
//     — Andi Tanaka (MII00041, pembina Dewi Anggraini)
//     — Tuti Iskandar (MII00028, pembina Joko Susilo)
//   • Akun ESS tuti@mii.co.id / EssDemo123! (karyawan Tuti Gunawan — MII00013).
// Jalankan: bun run scripts/seed-p6-demo.ts
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/rekankerja/shared/lib/auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const ESS_EMAIL = "tuti@mii.co.id";
const ESS_PASSWORD = "EssDemo123!";

async function main() {
  const db = getTenantClient(SCHEMA);

  // ---------- 1. siklus Closed PER-2026-CAL ----------
  let cycle = await db.performanceCycle.findFirst({ where: { code: "PER-2026-CAL" } });
  if (!cycle) {
    cycle = await db.performanceCycle.create({
      data: {
        code: "PER-2026-CAL",
        name: "Penilaian Kinerja 2026 (Kalibrasi)",
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2026-09-30T00:00:00Z"),
        goalStart: new Date("2026-01-05T00:00:00Z"),
        goalEnd: new Date("2026-02-15T00:00:00Z"),
        selfStart: new Date("2026-10-01T00:00:00Z"),
        selfEnd: new Date("2026-10-05T00:00:00Z"),
        mgrStart: new Date("2026-10-06T00:00:00Z"),
        mgrEnd: new Date("2026-10-10T00:00:00Z"),
        weightsJson: JSON.stringify({ kpi: 70, competency: 20, core: 10 }),
        status: "Closed",
      },
    });
    console.log(`[Cycle] PER-2026-CAL dibuat (Closed)`);
  } else {
    console.log(`[Cycle] PER-2026-CAL sudah ada (${cycle.status})`);
  }

  // ---------- 2. appraisal Closed rating 2 (bahan usul PIP §35-20) ----------
  const demo: { no: string; score: number }[] = [
    { no: "MII00013", score: 48.2 }, // Tuti Gunawan — pembina Bambang
    { no: "MII00041", score: 52.7 }, // Andi Tanaka — pembina Dewi Anggraini
    { no: "MII00028", score: 44.9 }, // Tuti Iskandar — pembina Joko Susilo
  ];
  for (const d of demo) {
    const emp = await db.employee.findFirst({ where: { employeeNo: d.no } });
    if (!emp) throw new Error(`Karyawan ${d.no} tidak ditemukan — jalankan restore-demo dulu`);
    const existing = await db.appraisalRecord.findFirst({ where: { cycleId: cycle.id, employeeId: emp.id } });
    if (existing) { console.log(`[Appraisal] ${d.no} sudah ada (${existing.docNo})`); continue; }
    const mgr = await db.employeeAssignment.findFirst({
      where: { employeeId: emp.id, validTo: null, managerId: { not: null } },
      orderBy: { validFrom: "desc" },
      select: { managerId: true },
    });
    const seq = (await db.appraisalRecord.count({ where: { docNo: { startsWith: "PER-2026-" } } })) + 1;
    const docNo = `PER-2026-${String(seq).padStart(4, "0")}`;
    await db.appraisalRecord.create({
      data: {
        docNo,
        cycleId: cycle.id,
        employeeId: emp.id,
        managerId: mgr?.managerId ?? null,
        finalScore: d.score,
        finalRating: 2,
        managerScore: d.score,
        status: "Closed",
      },
    });
    console.log(`[Appraisal] ${docNo} — ${emp.fullName} (${d.no}) rating 2 Closed, atasan snapshot ${mgr?.managerId ?? "-"}`);
  }

  // ---------- 3. akun ESS Tuti Gunawan ----------
  const emp = await db.employee.findFirst({ where: { employeeNo: "MII00013" } });
  if (!emp) throw new Error("Karyawan MII00013 tidak ditemukan");
  let appUser = await db.appUser.findFirst({ where: { email: ESS_EMAIL } });
  if (!appUser) {
    appUser = await db.appUser.create({
      data: {
        username: emp.employeeNo,
        fullName: emp.fullName,
        email: ESS_EMAIL,
        role: "Approver",
        employeeId: emp.id,
        passwordChangedAt: new Date(),
      },
    });
    console.log(`[AppUser] ${appUser.fullName} (${appUser.username}) dibuat → ${ESS_EMAIL}`);
  } else {
    await db.appUser.update({ where: { id: appUser.id }, data: { employeeId: emp.id, email: ESS_EMAIL } });
    console.log(`[AppUser] sudah ada — di-refresh ke ${ESS_EMAIL}`);
  }
  const acc = await db.userMenuAccess.findUnique({ where: { appUserId: appUser.id } });
  if (!acc) {
    await db.userMenuAccess.create({ data: { appUserId: appUser.id, mode: "CUSTOM", menusJson: "{}" } });
    console.log("[MenuAccess] mode CUSTOM tanpa menu admin dibuat");
  } else if (acc.mode !== "CUSTOM") {
    await db.userMenuAccess.update({ where: { id: acc.id }, data: { mode: "CUSTOM", menusJson: "{}" } });
    console.log("[MenuAccess] diubah ke CUSTOM tanpa menu admin");
  }
  let user = await platform.user.findUnique({ where: { email: ESS_EMAIL } });
  if (!user) {
    user = await platform.user.create({ data: { email: ESS_EMAIL, name: emp.fullName, passwordHash: hashPassword(ESS_PASSWORD) } });
    console.log(`[Platform] user ${ESS_EMAIL} dibuat`);
  }
  const tenant = await platform.tenant.findFirst({ where: { slug: "pt-mitra-industri-internasional" } });
  if (!tenant) throw new Error("Tenant MII tidak ditemukan di registry platform");
  const m = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
  if (!m) {
    await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "HR" } });
    console.log("[Membership] MII (role HR) dibuat");
  }
  const hist = await db.passwordHistory.findFirst({ where: { appUserId: appUser.id } });
  if (!hist) {
    await db.passwordHistory.create({ data: { appUserId: appUser.id, hash: hashPassword(ESS_PASSWORD) } });
    console.log("[PasswordHistory] seed awal dicatat");
  }

  await platform.$disconnect();
  console.log(`\nSELESAI — E2E P6 siap: 3 appraisal Closed rating 2 (PER-2026-CAL) + ESS ${ESS_EMAIL} / ${ESS_PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
