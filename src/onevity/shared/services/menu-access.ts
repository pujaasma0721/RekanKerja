// OneVity — Guard HAK AKSI MENU (server) (Task 32) ========================
// =====================================================================
// requireMenuAction(req, menuKey, action) — pengganti requireMutator untuk
// endpoint mutasi, dengan cek tambahan hak AKSI menu per pengguna:
//   1. resolusi sesi + tenant (401 bila invalid) — sama dgn requireMutator
//   2. role platform VIEWER ditolak (403 — aturan lama tetap)
//   3. super admin (AppUser.role Admin / platform OWNER|ADMIN) → lolos
//   4. mode ALL / tanpa baris konfigurasi → lolos (default semua aksi)
//   5. CUSTOM → cek perms[menuKey]: aksi CRUD (view/create/update/delete)
//      atau operasi khusus "op:<key>" (mis. op:approve, op:calculate)
// Hasil kompatibel MutatorResult ({ ok: true, db, actor }) sehingga route
// tinggal menukar pemanggilan guard-nya.
// =====================================================================
import { NextRequest } from "next/server";
import { getTenantClient, UNAUTHORIZED_MSG, VIEWER_FORBIDDEN_MSG, type TenantDb } from "../lib/tenant-db";
import { readSessionCookie } from "../lib/auth";
import { db as platformDb } from "@/lib/db";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "./access-scope";
import { normalizeMenusJson, ACTION_LABEL, actionAllowed, opsOf, type MenuAction, type MenusMap } from "../lib/menu-perms";

export interface MenuActor {
  userId: string;
  name: string;
  email: string;
  /** role workspace platform: OWNER | ADMIN | HR | VIEWER */
  role: string;
  appUserId: string | null;
  appUsername: string | null;
  employeeId: string | null;
}

export type MenuActionResult =
  | { ok: true; db: TenantDb; actor: MenuActor }
  | { ok: false; status: number; error: string };

/** Aksi CRUD atau operasi khusus ("op:approve" dst.). */
export type MenuActionRef = MenuAction | `op:${string}`;

/** Pesan penolakan (Bahasa Indonesia) untuk response 403. */
function forbiddenMsg(menuKey: string, action: MenuActionRef): string {
  const [mod, ...rest] = menuKey.split(":");
  const item = rest.join(":");
  const label = action.startsWith("op:")
    ? `operasi "${opsOf(menuKey).find((o) => o.key === action.slice(3))?.label ?? action.slice(3)}"`
    : `aksi "${ACTION_LABEL[action as MenuAction]}"`;
  return (
    `Akses ditolak: Anda tidak memiliki ${label} pada menu ${mod}:${item}. ` +
    "Hak aksi diatur per pengguna — hubungi admin bila memerlukan akses."
  );
}

/** Resolusi konfigurasi aksi menu pengguna sesi (null = sesi invalid). */
export async function resolveMenuPerms(
  req: Request,
): Promise<
  | {
      db: TenantDb;
      actor: MenuActor;
      isSuperAdmin: boolean;
      all: boolean;
      perms: MenusMap;
    }
  | null
> {
  const payload = readSessionCookie(req);
  if (!payload?.uid || !payload.tid) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
      tenant: { select: { schemaName: true, status: true } },
    },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  const db = getTenantClient(membership.tenant.schemaName);

  // AppUser tenant (cocok email) — sumber relasi karyawan + role aplikasi
  let appUser: { id: string; username: string; employeeId: string | null; role: string } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({
          where: { email: membership.user.email },
          select: { id: true, username: true, employeeId: true, role: true },
        })
      : null;
  } catch {
    appUser = null; // schema tanpa tabel AppUser
  }

  const actor: MenuActor = {
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    appUserId: appUser?.id ?? null,
    appUsername: appUser?.username ?? null,
    employeeId: appUser?.employeeId ?? null,
  };

  const isSuperAdmin =
    (appUser != null && SUPER_ADMIN_APP_ROLES.includes(appUser.role)) ||
    SUPER_ADMIN_PLATFORM_ROLES.includes(membership.role);

  if (isSuperAdmin || appUser == null) {
    // super admin / tanpa AppUser → default semua menu & aksi
    return { db, actor, isSuperAdmin, all: true, perms: {} };
  }

  let row: { mode: string; menusJson: string } | null = null;
  try {
    row = await db.userMenuAccess.findUnique({
      where: { appUserId: appUser.id },
      select: { mode: true, menusJson: true },
    });
  } catch {
    row = null; // tabel belum termigrasi → default semua
  }

  if (!row || row.mode === "ALL") return { db, actor, isSuperAdmin, all: true, perms: {} };
  return { db, actor, isSuperAdmin, all: false, perms: normalizeMenusJson(row.menusJson) };
}

/**
 * Guard mutasi + hak AKSI menu per pengguna.
 * Ganti `requireMutator` di route dengan:
 *   const m = await requireMenuAction(req, "hr:directory", "create");
 *   if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
 * Untuk operasi khusus: requireMenuAction(req, "leave:leave-approval", "op:approve").
 */
export async function requireMenuAction(req: NextRequest | Request, menuKey: string, action: MenuActionRef): Promise<MenuActionResult> {
  const resolved = await resolveMenuPerms(req);
  if (!resolved) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  if (resolved.actor.role === "VIEWER") {
    return { ok: false, status: 403, error: VIEWER_FORBIDDEN_MSG };
  }
  if (!resolved.all) {
    const perm = resolved.perms[menuKey];
    const allowed = action.startsWith("op:")
      ? perm != null && perm.view && perm.ops[action.slice(3)] !== false
      : perm != null && perm.view && actionAllowed(perm, action as MenuAction);
    if (!allowed) {
      return { ok: false, status: 403, error: forbiddenMsg(menuKey, action) };
    }
  }
  return { ok: true, db: resolved.db, actor: resolved.actor };
}
