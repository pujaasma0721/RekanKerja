// RekanKerja — Guard HAK AKSI MENU (server) (Task 32) ========================
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
import { readVerifiedSession } from "../lib/auth";
import { db as platformDb } from "@/lib/db";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES, ESS_ONLY_APP_ROLES } from "./access-scope";
import { normalizeMenusJson, ACTION_LABEL, actionAllowed, opsOf, type MenuAction, type MenusMap } from "../lib/menu-perms";

export interface MenuActor {
  userId: string;
  name: string;
  email: string;
  /** role workspace platform: OWNER | ADMIN | HR | VIEWER */
  role: string;
  appUserId: string | null;
  appUsername: string | null;
  /** role AppUser tenant (Admin/HR Manager/Viewer/…) — utk resolusi scope data. */
  appUserRole: string | null;
  employeeId: string | null;
}

export type MenuActionResult =
  | { ok: true; db: TenantDb; actor: MenuActor }
  | { ok: false; status: number; error: string };

// ---------- M-7 (audit 42): default-DENY utk menu tak terdaftar ----------

/**
 * Menu yang SENGAJA terbuka untuk semua pengguna AppUser tanpa konfigurasi
 * (escape hatch default-Deny M-7). Definisi dipindah ke lib murni
 * shared/lib/public-menus.ts (Task 52-f — supaya komponen client bisa
 * memfilter tanpa menarik kode server):
 * • whistleblowing:report — kanal pelaporan TPKS (UU 12/2022 Ps.22-24),
 *   wajib tersedia bagi seluruh pekerja (view-only; submit via sesi).
 * Selain itu portal ESS tetap lewat guard requireEss (self-scope).
 */
export { PUBLIC_MENU_KEYS } from "@/rekankerja/shared/lib/public-menus";
import { PUBLIC_MENU_KEYS as PUBLIC_KEYS } from "@/rekankerja/shared/lib/public-menus";

/** Izin efektif pengguna tanpa konfigurasi: hanya menu publik, view-only. */
export function publicMenuPerms(): MenusMap {
  const map: MenusMap = {};
  for (const k of PUBLIC_KEYS) {
    map[k] = { view: true, create: false, update: false, delete: false, ops: {} };
  }
  return map;
}

/** AppUser yang sudah diperingatkan (console.warn sekali per proses). */
const warnedNoMenuConfig = new Set<string>();

/**
 * Peringatan sekali per AppUser: konfigurasi UserMenuAccess tidak ada
 * (belum diatur / tabel belum termigrasi) → izin default DENY (M-7).
 * Admin harus mengatur Hak Akses (mode Semua Menu / CUSTOM) di
 * Pengaturan → Keamanan & Akses untuk membuka menu.
 */
export function warnNoMenuConfig(appUserId: string, appUsername: string | null, tableMissing: boolean): void {
  if (warnedNoMenuConfig.has(appUserId)) return;
  warnedNoMenuConfig.add(appUserId);
  console.warn(
    `[menu-access] AppUser ${appUsername ?? appUserId} tanpa konfigurasi UserMenuAccess` +
      (tableMissing ? " (tabel belum termigrasi)" : "") +
      " → izin default DENY (M-7). Atur Hak Akses di Pengaturan → Keamanan & Akses.",
  );
}

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
  const payload = await readVerifiedSession(req);
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
    appUserRole: appUser?.role ?? null,
    employeeId: appUser?.employeeId ?? null,
  };

  const isSuperAdmin =
    (appUser != null && SUPER_ADMIN_APP_ROLES.includes(appUser.role)) ||
    SUPER_ADMIN_PLATFORM_ROLES.includes(membership.role);

  // Role ESS — TERKUNCI ke portal ESS (halaman ESS saja): seluruh menu & aksi
  // admin ditolak APAPUN konfigurasi UserMenuAccess (mode ALL/CUSTOM) maupun
  // membership platform (bahkan OWNER/ADMIN) — keputusan eksplisit workspace
  // bahwa pengguna ini hanya mengakses portal ESS. Auto-deteksi mode UI
  // (user-menu-access action=me) memakai aturan yang sama → pengguna masuk
  // langsung ke Mode Karyawan. Endpoint ESS tidak memakai guard menu, jadi
  // portal ESS tetap berfungsi penuh.
  if (appUser != null && ESS_ONLY_APP_ROLES.includes(appUser.role)) {
    return { db, actor, isSuperAdmin: false, all: false, perms: {} };
  }

  if (isSuperAdmin) {
    // Super admin (AppUser.role Admin / platform OWNER|ADMIN) → semua menu & aksi.
    return { db, actor, isSuperAdmin, all: true, perms: {} };
  }
  if (appUser == null) {
    // T1-SECURITY — fail-closed (dulu fail-open all:true): pengguna TANPA AppUser
    // tidak lagi otomatis dapat semua menu. Hanya platform OWNER/ADMIN (sudah
    // tercakup isSuperAdmin di atas) yang bypass. Pengguna lain → tanpa menu
    // (UI mode ESS nanti) & seluruh mutasi API ditolak guard CUSTOM di bawah.
    return { db, actor, isSuperAdmin: false, all: false, perms: {} };
  }

  let row: { mode: string; menusJson: string } | null = null;
  let tableMissing = false;
  try {
    row = await db.userMenuAccess.findUnique({
      where: { appUserId: appUser.id },
      select: { mode: true, menusJson: true },
    });
  } catch {
    row = null;
    tableMissing = true; // tabel belum termigrasi → fail-closed (M-7)
  }

  // Mode ALL EKSPLISIT (dipilih admin di editor Hak Akses) → semua menu & aksi.
  if (row?.mode === "ALL") return { db, actor, isSuperAdmin, all: true, perms: {} };
  // M-7 (audit 42) — default DENY: pengguna TANPA baris konfigurasi tidak
  // lagi otomatis mendapat semua menu (dulu: all:true fail-open). Hanya menu
  // publik eksplisit (PUBLIC_MENU_KEYS) yang terbuka; selain itu menu tak
  // terdaftar → tolak. ESS/notifikasi/dashboard tidak terdampak (tanpa guard
  // menu — lihat komentar PUBLIC_MENU_KEYS).
  if (!row) {
    warnNoMenuConfig(appUser.id, appUser.username, tableMissing);
    return { db, actor, isSuperAdmin, all: false, perms: publicMenuPerms() };
  }
  return { db, actor, isSuperAdmin, all: false, perms: normalizeMenusJson(row.menusJson) };
}

/** Pesan 403 bila tidak punya LIHAT pada salah satu menu (multi-menu). */
function viewAnyForbiddenMsg(menuKeys: string[]): string {
  return (
    `Akses ditolak: Anda tidak memiliki aksi "Lihat" pada menu ${menuKeys.join(" / ")}. ` +
    "Hak aksi diatur per pengguna — hubungi admin bila memerlukan akses."
  );
}

/**
 * Guard BACA untuk endpoint list/detail yang melayani BEBERAPA menu sekaligus
 * (mis. daftar klaim dipakai halaman Klaim Medis DAN Persetujuan & Settlement).
 * Lolos bila pengguna punya aksi "view" pada SALAH SATU menuKey.
 * Semantik sama dengan requireMenuAction: 401 sesi invalid, VIEWER 403,
 * super admin / mode ALL lolos, CUSTOM → cek view per menu (M-6 audit 42).
 */
export async function requireMenuViewAny(
  req: NextRequest | Request,
  menuKeys: string[],
): Promise<MenuActionResult> {
  const resolved = await resolveMenuPerms(req);
  if (!resolved) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  if (resolved.actor.role === "VIEWER") {
    return { ok: false, status: 403, error: VIEWER_FORBIDDEN_MSG };
  }
  if (!resolved.all) {
    const allowed = menuKeys.some((k) => resolved.perms[k]?.view === true);
    if (!allowed) {
      return { ok: false, status: 403, error: viewAnyForbiddenMsg(menuKeys) };
    }
  }
  return { ok: true, db: resolved.db, actor: resolved.actor };
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
