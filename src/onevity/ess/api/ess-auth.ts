// ESS auth helper (T7-ESS-BACKEND) — resolusi aktor EMPLOYEE SELF-SERVICE.
// =====================================================================
// Pola requireTenant (tenant-db.ts) + tautan AppUser.employeeId:
//   1. sesi platform (readVerifiedSession — revokasi server-side dihormati);
//   2. membership + status tenant ACTIVE → client Prisma schema tenant;
//   3. AppUser tenant dicocokkan via email sesi → WAJIB punya employeeId
//      (akun tanpa tautan karyawan tidak bisa masuk ESS → 403).
import { readVerifiedSession } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, UNAUTHORIZED_MSG, type TenantDb } from "@/onevity/shared/lib/tenant-db";

/** Pesan 403 bila AppUser tidak tertaut data karyawan (kontrak ESS). */
export const ESS_NO_EMPLOYEE_MSG = "Akun tidak terhubung data karyawan";

export interface EssActor {
  db: TenantDb;
  /** tenant id platform. */
  tenantId: string;
  /** User.id platform. */
  platformUserId: string;
  /** role workspace platform: OWNER|ADMIN|HR|VIEWER|Approver|… */
  platformRole: string;
  email: string;
  /** AppUser.id tenant. */
  appUserId: string;
  /** AppUser.role: Admin|HR Manager|HR Staff|Approver|Viewer. */
  appUserRole: string;
  /** Employee.id aktor — dasar seluruh data ESS. */
  employeeId: string;
  /** nama karyawan (display). */
  fullName: string;
}

export type EssAuthResult =
  | { ok: true; actor: EssActor }
  | { ok: false; status: number; error: string };

/**
 * Guard semua endpoint ESS: 401 sesi invalid, 403 akun tanpa employeeId.
 * Pola route:
 *   const m = await requireEss(req);
 *   if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
 *   // m.actor.db, m.actor.employeeId, …
 */
export async function requireEss(req: Request): Promise<EssAuthResult> {
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: {
      role: true,
      user: { select: { id: true, email: true } },
      tenant: { select: { id: true, schemaName: true, status: true } },
    },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") {
    return { ok: false, status: 401, error: UNAUTHORIZED_MSG };
  }

  const db = getTenantClient(membership.tenant.schemaName);

  // AppUser tenant via email sesi (pola requireMutator).
  let appUser: { id: string; role: string; employeeId: string | null } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({
          where: { email: membership.user.email },
          select: { id: true, role: true, employeeId: true },
        })
      : null;
  } catch {
    appUser = null; // schema legacy tanpa tabel AppUser
  }
  if (!appUser?.employeeId) {
    return { ok: false, status: 403, error: ESS_NO_EMPLOYEE_MSG };
  }

  const emp = await db.employee.findUnique({
    where: { id: appUser.employeeId },
    select: { id: true, fullName: true, status: true },
  });
  if (!emp) return { ok: false, status: 403, error: ESS_NO_EMPLOYEE_MSG };

  return {
    ok: true,
    actor: {
      db,
      tenantId: membership.tenant.id,
      platformUserId: membership.user.id,
      platformRole: membership.role,
      email: membership.user.email,
      appUserId: appUser.id,
      appUserRole: appUser.role,
      employeeId: emp.id,
      fullName: emp.fullName,
    },
  };
}

/** Aktor boleh membuka area admin? (role workspace platform / AppUser role HR-admin). */
export function essCanAdmin(actor: EssActor): boolean {
  if (["OWNER", "ADMIN", "HR"].includes(actor.platformRole)) return true;
  return ["Admin", "HR Manager", "HR Staff"].includes(actor.appUserRole);
}

// ============ util format kontrak ESS ============

/** "YYYY-MM-DD" lokal (tanpa timezone shift). */
export function fmtIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "HH:MM" lokal. */
export function fmtHhMm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Label tanggal singkat id-ID: "6 Sep 2026". */
export function fmtDateId(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Label rentang id-ID: sama → "6 Sep 2026"; beda → "6–10 Sep 2026" / lintas bulan penuh. */
export function fmtRangeId(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return fmtDateId(from);
  const sameMonth = from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth();
  if (sameMonth) {
    return `${from.getDate()}–${fmtDateId(to)}`;
  }
  return `${fmtDateId(from)} – ${fmtDateId(to)}`;
}
