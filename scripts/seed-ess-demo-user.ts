// Seed akun demo PORTAL KARYAWAN MURNI (ESS) — idempoten.
// Platform user ess@mii.co.id (role HR — bukan super admin) + AppUser MII
// tertaut ke karyawan biasa + UserMenuAccess mode CUSTOM TANPA menu admin
// → canAdminApp=false → login mendarat langsung di Portal Karyawan (?area=ess).
// Jalankan: bun run scripts/seed-ess-demo-user.ts
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/rekankerja/shared/lib/auth";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const SCHEMA = "tenant_pt_mitra_industri_internasional";
const EMAIL = "yusuf@mii.co.id";
const PASSWORD = "EssDemo123!";

async function main() {
  const db = getTenantClient(SCHEMA);

  // karyawan target: Yusuf Rahayu (MII00010) — karyawan operasional biasa
  const emp = await db.employee.findFirst({ where: { employeeNo: "MII00010" } });
  if (!emp) throw new Error("Karyawan MII00010 tidak ditemukan — jalankan restore-demo dulu");

  // AppUser tenant (email disamakan dgn platform utk resolusi aktor sesi)
  let appUser = await db.appUser.findFirst({ where: { email: EMAIL } });
  if (!appUser) {
    appUser = await db.appUser.create({
      data: {
        username: emp.employeeNo,
        fullName: emp.fullName,
        email: EMAIL,
        role: "Approver",
        employeeId: emp.id,
        passwordChangedAt: new Date(),
      },
    });
    console.log(`[AppUser] ${appUser.fullName} (${appUser.username}) dibuat → ${EMAIL}`);
  } else {
    await db.appUser.update({ where: { id: appUser.id }, data: { employeeId: emp.id, email: EMAIL } });
    console.log(`[AppUser] ${appUser.fullName} sudah ada — di-refresh`);
  }

  // hak akses menu: CUSTOM tanpa menu admin → hanya Portal Karyawan
  const existing = await db.userMenuAccess.findUnique({ where: { appUserId: appUser.id } });
  if (!existing) {
    await db.userMenuAccess.create({ data: { appUserId: appUser.id, mode: "CUSTOM", menusJson: "{}" } });
    console.log("[MenuAccess] mode CUSTOM tanpa menu admin dibuat");
  } else if (existing.mode !== "CUSTOM") {
    await db.userMenuAccess.update({ where: { appUserId: appUser.id }, data: { mode: "CUSTOM", menusJson: "{}" } });
    console.log("[MenuAccess] diubah ke CUSTOM tanpa menu admin");
  } else {
    console.log("[MenuAccess] sudah CUSTOM");
  }

  // akun platform + membership MII (role HR — bukan OWNER/ADMIN)
  let user = await platform.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    user = await platform.user.create({ data: { email: EMAIL, name: emp.fullName, passwordHash: hashPassword(PASSWORD) } });
    console.log(`[Platform] user ${EMAIL} dibuat`);
  } else {
    console.log(`[Platform] user ${EMAIL} sudah ada`);
  }
  const tenant = await platform.tenant.findFirst({ where: { slug: "pt-mitra-industri-internasional" } });
  if (!tenant) throw new Error("Tenant MII tidak ditemukan di registry platform");
  const m = await platform.userTenant.findFirst({ where: { userId: user.id, tenantId: tenant.id } });
  if (!m) {
    await platform.userTenant.create({ data: { userId: user.id, tenantId: tenant.id, role: "HR" } });
    console.log("[Membership] MII (role HR) dibuat");
  } else {
    console.log(`[Membership] MII sudah ada (${m.role})`);
  }

  // riwayat sandi awal (kebijakan Task 33: blokir pemakaian ulang)
  const hist = await db.passwordHistory.findFirst({ where: { appUserId: appUser.id } });
  if (!hist) {
    await db.passwordHistory.create({ data: { appUserId: appUser.id, hash: hashPassword(PASSWORD) } });
    console.log("[PasswordHistory] seed awal dicatat");
  }

  await platform.$disconnect();
  console.log(`\nAkun demo ESS: ${EMAIL} / ${PASSWORD} (karyawan ${emp.fullName} — ${emp.employeeNo})`);
  console.log("Login karyawan murni → otomatis mendarat di Portal Karyawan.");
}

main().catch((e) => { console.error(e); process.exit(1); });
