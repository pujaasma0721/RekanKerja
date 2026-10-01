// GET/POST /api/rekankerja/money-vault · GET /api/rekankerja/money-vault/members
// ========================================================================
// MONEY VAULT (Task 45-a · rev 47) — backend core. Kata sandi enkripsi
// PERUSAHAAN (sumber kunci data terenkripsi) dikelola admin workspace via
// UI; anggota lain diberi HAK LIHAT (MoneyViewGrant) tanpa sandi.
//
//   GET  /api/rekankerja/money-vault          → status (semua anggota workspace;
//        tanpa menu key — vault bukan modul ber-menu; resolusi sesi style
//        requireAppUser/requireTenant: session → membership → client schema)
//   POST /api/rekankerja/money-vault {action} → setup | unlock | lock |
//        change-password | grant | revoke (semuanya canManage OWNER/ADMIN)
//        — setup & change-password me-re-enkripsi SELURUH data (respons
//        membawa reEncrypted {tables, rows})
//   GET  /api/rekankerja/money-vault/members  → daftar anggota + flag granted
//        (hanya canManage — 403 selainnya)
//
// Audit: ActivityLog entity "MoneyVault" (VaultSetup/VaultUnlock/VaultLock/
// VaultPasswordChange) + entity "MoneyViewGrant" (VaultGrant/VaultRevoke,
// entityId = userId sasaran). Unlock/lock hanya dicatat saat status benar-benar
// berubah (idempoten tidak menggelap log). Detail Bahasa Indonesia — sandi
// TIDAK PERNAH masuk log.
import { NextResponse } from "next/server";
import { readVerifiedSession } from "@/rekankerja/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, UNAUTHORIZED_MSG, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import {
  VaultError,
  VAULT_ERROR_MESSAGES,
  changeVaultPassword,
  grantUserIds,
  lockVault,
  memberList,
  setGrant,
  setupVault,
  unlockVault,
  vaultInfo,
  type VaultActor,
} from "@/rekankerja/shared/lib/money-vault";
import { primeTenantCrypto } from "@/rekankerja/shared/lib/field-crypto";

// Role workspace yang boleh mengelola vault (mirror access-scope:
// SUPER_ADMIN_PLATFORM_ROLES — OWNER/ADMIN).
const VAULT_ADMIN_ROLES = ["OWNER", "ADMIN"];

// ============ resolusi sesi (tanpa menu key) ============

export type VaultSessionResult =
  | {
      ok: true;
      db: TenantDb;
      tenantId: string;
      schemaName: string;
      actor: VaultActor;
      actorName: string;
      appUserId: string | null;
      canManage: boolean;
    }
  | { ok: false; status: number; error: string };

/** Sesi + tenant + role membership (tanpa menu key — vault bukan modul menu).
 *  appUserId (tenant AppUser, cocok email) untuk jejak audit ActivityLog. */
export async function requireVaultSession(req: Request): Promise<VaultSessionResult> {
  // T1-SECURITY: readVerifiedSession — token divalidasi terhadap sessionVersion.
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
      tenant: { select: { id: true, schemaName: true, status: true } },
    },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") {
    return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  }

  const db = getTenantClient(membership.tenant.schemaName);
  // Task 47: pastikan dataKey vault termuat sebelum operasi vault membaca
  // status / menulis nilai terenkripsi.
  await primeTenantCrypto(membership.tenant.schemaName).catch(() => {});

  // AppUser tenant via email (opsional — audit log; schema legacy → null)
  let appUserId: string | null = null;
  try {
    const appUser = membership.user.email
      ? await db.appUser.findFirst({ where: { email: membership.user.email }, select: { id: true } })
      : null;
    appUserId = appUser?.id ?? null;
  } catch {
    appUserId = null;
  }

  return {
    ok: true,
    db,
    tenantId: membership.tenant.id,
    schemaName: membership.tenant.schemaName,
    actor: { userId: membership.user.id, membershipRole: membership.role },
    actorName: membership.user.name,
    appUserId,
    canManage: VAULT_ADMIN_ROLES.includes(membership.role),
  };
}

/** Anggota workspace ini? (validasi target grant/revoke → 404 NOT_MEMBER). */
async function isMember(tenantId: string, userId: string): Promise<boolean> {
  const m = await platformDb.userTenant.findFirst({
    where: { tenantId, userId },
    select: { id: true },
  });
  return m != null;
}

/** Aktivitas audit (inline, best-effort — pola route lain; sandi tak pernah). */
function audit(
  db: TenantDb,
  appUserId: string | null,
  entity: string,
  action: string,
  detail: string,
  entityId?: string,
): Promise<unknown> {
  return db.activityLog
    .create({
      data: { appUserId: appUserId ?? null, action, entity, entityId: entityId ?? null, detail },
    })
    .catch(() => undefined); // audit tidak boleh menggagalkan mutasi
}

const vaultHttpError = (e: VaultError) =>
  NextResponse.json({ error: e.message, code: e.code }, { status: e.status });

// ============ GET — status vault ============

export async function GET(req: Request) {
  try {
    const r = await requireVaultSession(req);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const { db, actor, canManage } = r;

    const info = await vaultInfo(db);
    const grants = await grantUserIds(db);

    // myView: unconfigured → admin (bisa mengatur) / legacy (visibility lama);
    // configured → admin | granted | none (status open dipantau lewat field `open`).
    let myView: "admin" | "granted" | "none" | "legacy";
    if (!info.configured) myView = canManage ? "admin" : "legacy";
    else if (canManage) myView = "admin";
    else if (grants.has(actor.userId)) myView = "granted";
    else myView = "none";

    // 45-d: openBy user id platform → nama tampilan (hindari id mentah di UI).
    let openByName: string | null = null;
    if (info.openBy) {
      const opener = await platformDb.user.findUnique({
        where: { id: info.openBy },
        select: { name: true, email: true },
      });
      openByName = opener?.name ?? opener?.email ?? null;
    }

    return NextResponse.json({
      configured: info.configured,
      open: info.open,
      openUntil: info.openUntil,
      openBy: openByName ?? info.openBy,
      canManage,
      myView,
      grantsCount: grants.size,
      lockoutUntil: info.lockoutUntil,
      serverNow: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ POST — aksi vault ============

export async function POST(req: Request) {
  try {
    const r = await requireVaultSession(req);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    const { db, tenantId, actor, actorName, appUserId, canManage } = r;

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "").trim();
    const requireAdmin = () => {
      if (!canManage) throw new VaultError("NOT_ADMIN", 403);
    };

    switch (action) {
      case "setup": {
        requireAdmin();
        const password = String(b.password ?? "");
        const res = await setupVault(db, actor, password);
        await audit(
          db, appUserId, "MoneyVault", "VaultSetup",
          `Vault uang dikonfigurasi oleh ${actorName}${appUserId ? ` (AppUser ${appUserId.slice(0, 12)}…)` : ""} — seluruh data (${res.reEncrypted.rows} baris di ${res.reEncrypted.tables} tabel) dienkripsi ulang dengan kunci kata sandi perusahaan; sandi TIDAK dicatat`,
        );
        return NextResponse.json({ ok: true, reEncrypted: res.reEncrypted });
      }

      case "unlock": {
        requireAdmin();
        const password = String(b.password ?? "");
        const before = await vaultInfo(db); // audit hanya saat status berubah
        const res = await unlockVault(db, password, actor);
        if (!before.open) {
          await audit(
            db, appUserId, "MoneyVault", "VaultUnlock",
            `Vault uang dibuka oleh ${actorName} hingga ${res.openUntil.toISOString()}`,
          );
        }
        return NextResponse.json({ ok: true, openUntil: res.openUntil });
      }

      case "lock": {
        requireAdmin();
        const before = await vaultInfo(db); // idempoten: ulang lock tidak spam log
        await lockVault(db);
        if (before.open) {
          await audit(db, appUserId, "MoneyVault", "VaultLock", `Vault uang dikunci oleh ${actorName}`);
        }
        return NextResponse.json({ ok: true });
      }

      case "change-password": {
        requireAdmin();
        const currentPassword = String(b.currentPassword ?? "");
        const newPassword = String(b.newPassword ?? "");
        const res = await changeVaultPassword(db, currentPassword, newPassword);
        await audit(
          db, appUserId, "MoneyVault", "VaultPasswordChange",
          `Kata sandi enkripsi diganti oleh ${actorName} — seluruh data (${res.reEncrypted.rows} baris di ${res.reEncrypted.tables} tabel) didekripsi lalu dienkripsi ulang dengan kunci kata sandi baru; sandi lama & baru TIDAK dicatat`,
        );
        return NextResponse.json({ ok: true, reEncrypted: res.reEncrypted });
      }

      case "grant":
      case "revoke": {
        requireAdmin();
        const userId = String(b.userId ?? "").trim();
        if (!userId) {
          return NextResponse.json({ error: "userId anggota workspace wajib diisi", code: "INVALID_BODY" }, { status: 400 });
        }
        if (!(await isMember(tenantId, userId))) {
          throw new VaultError("NOT_MEMBER", 404);
        }
        await setGrant(db, actor, userId, action === "grant");
        const detail =
          action === "grant"
            ? `Hak lihat nilai uang diberikan kepada pengguna ${userId} oleh ${actorName} (tanpa kata sandi vault)`
            : `Hak lihat nilai uang ditarik dari pengguna ${userId} oleh ${actorName}`;
        await audit(db, appUserId, "MoneyViewGrant", action === "grant" ? "VaultGrant" : "VaultRevoke", detail, userId);
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          {
            error: `Aksi tidak dikenal: "${action || "(kosong)"}" — gunakan setup, unlock, lock, change-password, grant, atau revoke`,
            code: "UNKNOWN_ACTION",
          },
          { status: 400 },
        );
    }
  } catch (e) {
    if (e instanceof VaultError) return vaultHttpError(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ GET /members — daftar anggota + granted (admin saja) ============

export async function membersGET(req: Request) {
  try {
    const r = await requireVaultSession(req);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    if (!r.canManage) {
      return NextResponse.json({ error: VAULT_ERROR_MESSAGES.NOT_ADMIN, code: "NOT_ADMIN" }, { status: 403 });
    }
    const members = await memberList(r.db, r.tenantId);
    return NextResponse.json({ members });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
