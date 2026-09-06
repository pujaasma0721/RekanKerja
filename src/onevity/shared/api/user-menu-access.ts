import { NextRequest, NextResponse } from "next/server";
import { requireTenant, requireMutator, UNAUTHORIZED_MSG } from "@/onevity/shared/lib/tenant-db";
import { getTenantClient, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { SUPER_ADMIN_APP_ROLES, SUPER_ADMIN_PLATFORM_ROLES } from "@/onevity/shared/services/access-scope";
import { normalizeMenusJson, sanitizeMenusInput, viewListOf, type MenusMap } from "@/onevity/shared/lib/menu-perms";

// ============ HAK AKSI MENU PER PENGGUNA (Task 31 + 32) =================
// =====================================================================
// Hak akses MENU secara INDIVIDUAL, turun ke level AKSI (Task 32):
//   • mode ALL    → semua menu & seluruh aksi (default bila tanpa baris)
//   • mode CUSTOM → hanya menu pada menusJson, tiap menu membawa
//     { view, create, update, delete, ops: { approve, calculate, … } }
//   • Super Admin (AppUser.role Admin / platform OWNER|ADMIN) otomatis
//     semua menu, data, & aksi — TANPA perlu diatur di sini.
// Endpoints:
//   GET  ?action=me            → konfigurasi pengguna sesi (AppShell)
//   GET  (default)             → daftar pengguna + konfigurasi (admin)
//   POST { appUserId, mode, menus } → upsert; menus bisa string[] lama
//        (izin penuh) ATAU object { key: {create,update,delete,ops} }
//   DELETE ?userId=            → hapus konfigurasi (kembali default)
// =====================================================================

interface MeResolution {
  db: TenantDb;
  appUserId: string | null;
  appUserRole: string | null;
  isSuperAdmin: boolean;
}

/** Resolusi konfigurasi menu pengguna sesi (cookie → tenant → AppUser). */
async function resolveMe(req: Request): Promise<MeResolution | null> {
  // T1-SECURITY: readVerifiedSession — token divalidasi vs User.sessionVersion.
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: { role: true, user: { select: { email: true } }, tenant: { select: { schemaName: true, status: true } } },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  const db = getTenantClient(membership.tenant.schemaName);

  let appUser: { id: string; role: string } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({ where: { email: membership.user.email }, select: { id: true, role: true } })
      : null;
  } catch {
    appUser = null; // schema tanpa tabel AppUser
  }

  const isSuperAdmin =
    (appUser != null && SUPER_ADMIN_APP_ROLES.includes(appUser.role)) ||
    SUPER_ADMIN_PLATFORM_ROLES.includes(membership.role);

  return { db, appUserId: appUser?.id ?? null, appUserRole: appUser?.role ?? null, isSuperAdmin };
}

/** Baca menusJson aman → MenusMap (legacy string[] → izin penuh). */
function parseMenusMap(json: string): MenusMap {
  return normalizeMenusJson(json);
}

// GET /api/onevity/user-menu-access            → daftar pengguna + konfigurasi (admin)
// GET /api/onevity/user-menu-access?action=me  → konfigurasi pengguna sesi (AppShell)
export async function GET(req: NextRequest) {
  try {
    // ---- konfigurasi pengguna sesi (ringan — dipakai shell tiap load) ----
    if (req.nextUrl.searchParams.get("action") === "me") {
      const me = await resolveMe(req);
      if (!me) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

      if (me.isSuperAdmin) {
        // Super admin otomatis semua menu & aksi.
        return NextResponse.json({ all: true, menus: [], perms: {}, isSuperAdmin: true });
      }
      if (me.appUserId == null) {
        // T1-SECURITY — fail-closed (dulu fail-open all:true): tanpa AppUser,
        // hanya platform OWNER/ADMIN (isSuperAdmin di atas) yang dapat semua menu.
        // Pengguna lain → tanpa menu (mode ESS menyusul) — mutasi API ikut ditolak
        // oleh resolveMenuPerms yang memakai aturan yang sama.
        return NextResponse.json({ all: false, menus: [], perms: {}, isSuperAdmin: false });
      }
      let row: { mode: string; menusJson: string } | null = null;
      try {
        row = await me.db.userMenuAccess.findUnique({ where: { appUserId: me.appUserId }, select: { mode: true, menusJson: true } });
      } catch {
        row = null; // tabel belum termigrasi → default semua
      }
      if (!row || row.mode === "ALL") {
        return NextResponse.json({ all: true, menus: [], perms: {}, isSuperAdmin: false });
      }
      const perms = parseMenusMap(row.menusJson);
      return NextResponse.json({ all: false, menus: viewListOf(perms), perms, isSuperAdmin: false });
    }

    // ---- daftar pengguna + konfigurasi (untuk editor Hak Akses) ----
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const [users, configs, ruleRows, assignRows] = await Promise.all([
      db.appUser.findMany({
        orderBy: { username: "asc" },
        select: { id: true, username: true, fullName: true, email: true, role: true, active: true, employeeId: true },
      }),
      db.userMenuAccess.findMany({ select: { appUserId: true, mode: true, menusJson: true } }).catch(() => [] as { appUserId: string; mode: string; menusJson: string }[]),
      db.dataAccessRule.findMany({ where: { active: true, subjectType: "USER" }, select: { appUserId: true } }).catch(() => [] as { appUserId: string | null }[]),
      db.employeeAssignment.findMany({ where: { validTo: null, managerId: { not: null } }, select: { managerId: true, employeeId: true }, distinct: ["employeeId", "managerId"] }).catch(() => [] as { managerId: string | null; employeeId: string }[]),
    ]);

    // karyawan terkait (nama untuk identitas pengguna)
    const empIds = users.map((u) => u.employeeId).filter((x): x is string => x != null);
    const employees = empIds.length > 0
      ? await db.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, fullName: true, employeeNo: true } }).catch(() => [] as { id: string; fullName: string; employeeNo: string }[])
      : [];
    const empById = new Map(employees.map((e) => [e.id, e]));

    // role platform per email (untuk badge super admin workspace)
    const emails = users.map((u) => u.email).filter((x): x is string => x != null);
    const platformUsers = emails.length > 0
      ? await platformDb.user.findMany({
          where: { email: { in: emails } },
          select: { email: true, memberships: { select: { role: true } } },
        })
      : [];
    const platformRoleByEmail = new Map<string, string>();
    for (const pu of platformUsers) {
      // membership mana pun OWNER/ADMIN dianggap super admin workspace
      const admin = pu.memberships.some((m) => SUPER_ADMIN_PLATFORM_ROLES.includes(m.role));
      platformRoleByEmail.set(pu.email, admin ? "ADMIN" : pu.memberships[0]?.role ?? "");
    }

    // hitung bawahan langsung per manager
    const subCount = new Map<string, number>();
    for (const a of assignRows) {
      if (a.managerId) subCount.set(a.managerId, (subCount.get(a.managerId) ?? 0) + 1);
    }
    // hitung rule aktif per pengguna
    const ruleCount = new Map<string, number>();
    for (const r of ruleRows) {
      if (r.appUserId) ruleCount.set(r.appUserId, (ruleCount.get(r.appUserId) ?? 0) + 1);
    }

    const configByUser = new Map(configs.map((c) => [c.appUserId, c]));
    const out = users.map((u) => {
      const cfg = configByUser.get(u.id);
      const platformRole = u.email ? platformRoleByEmail.get(u.email) ?? "" : "";
      const isSuperAdmin = SUPER_ADMIN_APP_ROLES.includes(u.role) || SUPER_ADMIN_PLATFORM_ROLES.includes(platformRole);
      return {
        id: u.id,
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        active: u.active,
        employee: u.employeeId ? (empById.get(u.employeeId) ?? null) : null,
        isSuperAdmin,
        subordinateCount: u.employeeId ? subCount.get(u.employeeId) ?? 0 : 0,
        menuMode: cfg?.mode === "CUSTOM" ? "CUSTOM" : "ALL",
        menus: cfg?.mode === "CUSTOM" ? viewListOf(parseMenusMap(cfg.menusJson)) : [],
        perms: cfg?.mode === "CUSTOM" ? parseMenusMap(cfg.menusJson) : {},
        ruleCount: ruleCount.get(u.id) ?? 0,
      };
    });

    return NextResponse.json({
      users: out,
      stats: {
        total: out.length,
        restricted: out.filter((u) => u.menuMode === "CUSTOM").length,
        superAdmins: out.filter((u) => u.isSuperAdmin).length,
        rules: ruleRows.length,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// POST /api/onevity/user-menu-access { appUserId, mode, menus }
// menus: string[] (izin penuh) | Record<key, {create,update,delete,ops}>
export async function POST(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const b = await req.json();
    const appUserId = b.appUserId ? String(b.appUserId) : "";
    if (!appUserId) return NextResponse.json({ error: "appUserId wajib" }, { status: 400 });
    const user = await db.appUser.findUnique({ where: { id: appUserId }, select: { id: true, username: true, fullName: true, role: true } });
    if (!user) return NextResponse.json({ error: "Pengguna tidak ditemukan" }, { status: 404 });
    if (SUPER_ADMIN_APP_ROLES.includes(user.role)) {
      return NextResponse.json({ error: "Super admin otomatis punya akses semua menu — tidak perlu dibatasi." }, { status: 400 });
    }

    const mode = b.mode === "CUSTOM" ? "CUSTOM" : "ALL";
    let perms: MenusMap = {};
    if (mode === "CUSTOM") {
      // string[] lama (izin penuh) atau object aksi eksplisit (Task 32)
      perms = sanitizeMenusInput(b.menus);
      const keys = Object.keys(perms);
      if (keys.length === 0) {
        return NextResponse.json({ error: "Pilih minimal satu menu, atau gunakan mode Semua Menu." }, { status: 400 });
      }
      // menu aktif harus bisa dilihat — kehadiran key sudah berarti view
      for (const k of keys) perms[k] = { ...perms[k], view: true };
    }

    const row = await db.userMenuAccess.upsert({
      where: { appUserId },
      create: { appUserId, mode, menusJson: JSON.stringify(mode === "CUSTOM" ? perms : {}) },
      update: { mode, menusJson: JSON.stringify(mode === "CUSTOM" ? perms : {}) },
    });

    // ringkasan aksi utk activity log (CRUD aktif + operasi nonaktif)
    let detail: string;
    if (mode !== "CUSTOM") {
      detail = `Hak akses menu ${user.fullName} (${user.username}) → semua menu & seluruh aksi`;
    } else {
      const restricted = Object.values(perms).filter((p) => !p.create || !p.update || !p.delete).length;
      const opOff = Object.values(perms).reduce((n, p) => n + Object.values(p.ops).filter((v) => !v).length, 0);
      detail = `Hak akses menu ${user.fullName} (${user.username}) → ${Object.keys(perms).length} menu` +
        (restricted > 0 ? `, ${restricted} menu tanpa aksi penuh` : "") +
        (opOff > 0 ? `, ${opOff} operasi dinonaktifkan` : " (semua aksi aktif)");
    }
    await db.activityLog.create({
      data: { action: "Updated", entity: "UserMenuAccess", entityId: appUserId, detail },
    });
    return NextResponse.json({ config: { appUserId: row.appUserId, mode: row.mode, menus: viewListOf(perms), perms } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// DELETE /api/onevity/user-menu-access?userId= → hapus konfigurasi (default semua menu)
export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMutator(req);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "userId wajib" }, { status: 400 });
    const cur = await db.userMenuAccess.findUnique({ where: { appUserId: userId } });
    if (!cur) return NextResponse.json({ error: "Konfigurasi tidak ditemukan (pengguna sudah default semua menu)" }, { status: 404 });

    await db.userMenuAccess.delete({ where: { appUserId: userId } });
    const user = await db.appUser.findUnique({ where: { id: userId }, select: { username: true, fullName: true } });
    await db.activityLog.create({
      data: {
        action: "Deleted",
        entity: "UserMenuAccess",
        entityId: userId,
        detail: `Batasan menu ${user?.fullName ?? userId} dihapus — kembali ke default semua menu`,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
