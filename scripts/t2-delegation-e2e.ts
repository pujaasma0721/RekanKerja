// T2-ENGINE — setup E2E delegasi approval (idempoten, tenant MII sandbox).
//
// Menyiapkan pengguna delegate agus@mii.co.id agar perjalanan E2E benar-benar
// melalui jalur otorisasi ENGINE (bukan lolos karena role privileged):
//   1. reset kata sandi platform → "onevity123" (hash scrypt ala auth.ts);
//   2. role workspace UserTenant HR → "Approver" (non-OWNER/ADMIN/HR supaya
//      canActorDecideCurrentStep TIDAK bypass, non-VIEWER supaya lolos cek
//      VIEWER di requireMenuAction);
//   3. UserMenuAccess mode CUSTOM + hak op:approve pada leave:leave-approval &
//      hr:inbox (guard menu tetap ketat — hanya dua menu itu).
// Jalankan: bun run scripts/t2-delegation-e2e.ts
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Client } from "pg";

const PLATFORM_URL = process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";
const DELEGATE_EMAIL = "agus@mii.co.id";
const DELEGATE_PASSWORD = "onevity123";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

async function main() {
  const c = new Client({ connectionString: PLATFORM_URL });
  await c.connect();
  const q = async (sql: string, params: unknown[] = []) => (await c.query(sql, params as never[])).rows;

  // ---- 1. platform user: password + reset lockout ----
  const user = (await q(`SELECT id FROM "User" WHERE email = $1`, [DELEGATE_EMAIL]))[0] as { id: string } | undefined;
  if (!user) throw new Error(`User platform ${DELEGATE_EMAIL} tidak ditemukan`);
  const pwHash = hashPassword(DELEGATE_PASSWORD);
  await q(
    `UPDATE "User" SET "passwordHash" = $2, "failedAttempts" = 0, "lockedUntil" = NULL WHERE id = $1`,
    [user.id, pwHash],
  );
  // read-back + verify lokal (guard bila agen paralel menimpa baris yang sama)
  const rb = (await q(`SELECT "passwordHash" FROM "User" WHERE id = $1`, [user.id]))[0] as { passwordHash: string };
  const [alg, s2, h2] = String(rb.passwordHash).split("$");
  const okHash = alg === "scrypt" && timingSafeEqual(scryptSync(DELEGATE_PASSWORD, s2, 64), Buffer.from(h2, "hex"));
  if (!okHash) throw new Error("Verifikasi hash password gagal setelah update — baris ditimpa proses lain, jalankan ulang");
  console.log(`OK: password ${DELEGATE_EMAIL} → ${DELEGATE_PASSWORD} (scrypt, terverifikasi), lockout direset`);

  // ---- 2. role workspace: HR → Approver (non-privileged, non-VIEWER) ----
  const tenant = (await q(`SELECT id FROM "Tenant" WHERE "schemaName" = $1`, [MII_SCHEMA]))[0] as { id: string };
  const upd = await q(
    `UPDATE "UserTenant" SET role = 'Approver' WHERE "userId" = $1 AND "tenantId" = $2 AND role <> 'Approver' RETURNING role`,
    [user.id, tenant.id],
  );
  console.log(upd.length > 0 ? "OK: role workspace agus → Approver (non-privileged)" : "OK: role workspace sudah Approver");

  // ---- 3. tenant MII: AppUser + UserMenuAccess op:approve ----
  await c.query(`SET search_path TO "${MII_SCHEMA}"`);
  const appUser = (await q(`SELECT id, username, "fullName", "employeeId" FROM "AppUser" WHERE email = $1`, [DELEGATE_EMAIL]))[0] as
    | { id: string; username: string; fullName: string; employeeId: string | null }
    | undefined;
  if (!appUser) throw new Error(`AppUser ${DELEGATE_EMAIL} tidak ditemukan di tenant MII`);

  const PERMS = {
    "leave:leave-approval": { view: true, create: false, update: false, delete: false, ops: { approve: true } },
    "hr:inbox": { view: true, create: false, update: false, delete: false, ops: { approve: true } },
  } as const;

  const existing = (await q(`SELECT mode, "menusJson" FROM "UserMenuAccess" WHERE "appUserId" = $1`, [appUser.id]))[0] as
    | { mode: string; menusJson: string }
    | undefined;
  const menus = existing ? (JSON.parse(existing.menusJson) as Record<string, Record<string, unknown>>) : {};
  let changed = 0;
  for (const [key, perm] of Object.entries(PERMS)) {
    if (JSON.stringify(menus[key]) !== JSON.stringify(perm)) {
      menus[key] = { ...perm };
      changed++;
    }
  }
  if (!existing) {
    await q(
      `INSERT INTO "UserMenuAccess" (id, "appUserId", mode, "menusJson", "updatedAt") VALUES ($1, $2, 'CUSTOM', $3, now())`,
      [`t2uma-${appUser.id.slice(0, 20)}`, appUser.id, JSON.stringify(menus)],
    );
    console.log(`OK: UserMenuAccess dibuat (CUSTOM) utk ${appUser.username} + op:approve leave:leave-approval & hr:inbox`);
  } else if (changed > 0) {
    await q(
      `UPDATE "UserMenuAccess" SET "menusJson" = $2, "updatedAt" = now() WHERE "appUserId" = $1`,
      [appUser.id, JSON.stringify(menus)],
    );
    console.log(`OK: UserMenuAccess diperbarui (+${changed} menu op:approve) utk ${appUser.username}`);
  } else {
    console.log("OK: UserMenuAccess sudah memuat op:approve leave:leave-approval & hr:inbox");
  }

  // ---- info untuk alur curl ----
  const bambang = (await q(`SELECT id, username, "fullName", "employeeId" FROM "AppUser" WHERE username = 'MII000002'`))[0] as
    | { id: string; username: string; fullName: string; employeeId: string | null }
    | undefined;
  const leave = (await q(`SELECT id, "docNo", status FROM "LeaveRequest" WHERE "docNo" = 'LR-2026-007'`))[0] as
    | { id: string; docNo: string; status: string }
    | undefined;
  console.log("\n--- payload curl ---");
  console.log(`approverId (Bambang MII000002): ${bambang?.id}`);
  console.log(`delegateId (Agus ${appUser.username}): ${appUser.id}`);
  console.log(`leaveId (LR-2026-007): ${leave?.id} (status ${leave?.status})`);
  await c.end();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
