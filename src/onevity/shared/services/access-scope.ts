// OneVity — Mesin SKEMA AKSES DATA KARYAWAN (Task 30)
// =====================================================================
// Hak akses data karyawan berbasis parameter — selaras pola Approval
// Structure berjenjang. Akses efektif seorang pengguna = UNION:
//   1. OTOMATIS (tanpa perlu di-setting di menu Keamanan & Akses):
//      • Super Admin (AppUser.role = "Admin" ATAU role workspace platform
//        OWNER/ADMIN) → akses SEMUA data karyawan.
//      • Atasan langsung → akses seluruh bawahan aktifnya.
//      • Setiap user → akses data dirinya sendiri.
//   2. RULE parametrik (DataAccessRule aktif yang subjeknya cocok):
//      ROLE | USER | ACCESS_GROUP × kriteria penempatan (office, lokasi,
//      unit, posisi, grade, level jabatan, status kerja — AND).
//      Rule tanpa kriteria = akses penuh.
// Tanpa rule & tanpa otomatis → tidak dapat mengakses data karyawan lain.
// =====================================================================
import type { Prisma } from "@/generated/tenant";
import { getTenantClient, type TenantDb, type TenantActor } from "@/onevity/shared/lib/tenant-db";
import { readSessionCookie } from "@/onevity/shared/lib/auth";
import { db as platformDb } from "@/lib/db";

// ============ konstanta domain ============

export const ACCESS_SUBJECT_TYPES = ["ROLE", "USER", "ACCESS_GROUP"] as const;
export type AccessSubjectType = (typeof ACCESS_SUBJECT_TYPES)[number];

export const ACCESS_SUBJECT_LABEL: Record<AccessSubjectType, string> = {
  ROLE: "Semua pemegang role",
  USER: "Pengguna tertentu",
  ACCESS_GROUP: "Anggota access group",
};

/** AppUser.role yang otomatis super admin (akses semua tanpa setting). */
export const SUPER_ADMIN_APP_ROLES = ["Admin"];

/** Role workspace platform yang otomatis super admin. */
export const SUPER_ADMIN_PLATFORM_ROLES = ["OWNER", "ADMIN"];

/** Dimensi kriteria penempatan sasaran (target employee). */
export const ACCESS_DIMENSIONS = [
  "companyOfficeId", "workLocationId", "orgUnitId", "positionId",
  "gradeId", "positionLevelId", "employmentStatus",
] as const;
export type AccessDimension = (typeof ACCESS_DIMENSIONS)[number];

export const DIMENSION_LABEL: Record<AccessDimension, string> = {
  companyOfficeId: "Kantor",
  workLocationId: "Lokasi Kerja",
  orgUnitId: "Unit Organisasi",
  positionId: "Posisi",
  gradeId: "Grade",
  positionLevelId: "Level Jabatan",
  employmentStatus: "Status Kerja",
};

// ============ tipe hasil resolusi ============

export interface ScopeFilter {
  /** dimensi → nilai (id atau teks status kerja) */
  companyOfficeId?: string;
  workLocationId?: string;
  orgUnitId?: string;
  positionId?: string;
  gradeId?: string;
  positionLevelId?: string;
  employmentStatus?: string;
  /** rule asal (label utk simulasi) */
  source: string;
}

export interface DataAccessScope {
  /** true = akses penuh semua data karyawan (super admin / rule kosong). */
  all: boolean;
  /** sumber akses (deskriptif — untuk simulasi & audit tampilan). */
  sources: string[];
  selfEmployeeId: string | null;
  subordinateIds: string[];
  filters: ScopeFilter[];
}

const EMPTY_SCOPE: DataAccessScope = { all: false, sources: [], selfEmployeeId: null, subordinateIds: [], filters: [] };

/** Rule mentah dari DB (di-select dengan kriteria). */
interface RuleRow {
  code: string;
  name: string;
  subjectType: string;
  role: string | null;
  appUserId: string | null;
  accessGroupId: string | null;
  companyOfficeId: string | null;
  workLocationId: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  positionLevelId: string | null;
  employmentStatus: string | null;
}

// ============ resolusi scope ============

/**
 * Resolusi akses efektif untuk aktor sesi (platform user → AppUser tenant
 * via email, selaras requireMutator). Tidak melempar — error resolusi
 * (mis. tabel belum ada di schema lama) menghasilkan scope minimal.
 */
export async function resolveAccessScope(
  db: TenantDb,
  actor: { appUserId: string | null; employeeId: string | null; appUserRole: string | null; platformRole: string },
): Promise<DataAccessScope> {
  const sources: string[] = [];
  const filters: ScopeFilter[] = [];
  let all = false;

  // 1) super admin otomatis
  const isSuperAdmin =
    (actor.appUserRole != null && SUPER_ADMIN_APP_ROLES.includes(actor.appUserRole)) ||
    SUPER_ADMIN_PLATFORM_ROLES.includes(actor.platformRole);
  if (isSuperAdmin) {
    all = true;
    sources.push(
      actor.appUserRole === "Admin"
        ? "Super Admin — role pengguna Admin (akses semua, otomatis)"
        : "Super Admin — workspace OWNER/ADMIN (akses semua, otomatis)",
    );
  }

  // 2) bawahan langsung otomatis + diri sendiri
  const subordinateIds: string[] = [];
  if (actor.employeeId) {
    try {
      const subs = await db.employeeAssignment.findMany({
        where: { managerId: actor.employeeId, validTo: null },
        select: { employeeId: true },
        distinct: ["employeeId"],
      });
      for (const s of subs) subordinateIds.push(s.employeeId);
    } catch { /* schema lama tanpa kolom — biarkan kosong */ }
    if (subordinateIds.length > 0) {
      sources.push(`Atasan langsung — ${subordinateIds.length} bawahan aktif (otomatis)`);
    }
  }

  // 3) rule parametrik aktif yang cocok dengan aktor
  let rules: RuleRow[] = [];
  try {
    rules = await db.dataAccessRule.findMany({
      where: { active: true },
      select: {
        code: true, name: true, subjectType: true, role: true, appUserId: true, accessGroupId: true,
        companyOfficeId: true, workLocationId: true, orgUnitId: true, positionId: true,
        gradeId: true, positionLevelId: true, employmentStatus: true,
      },
      orderBy: { priority: "asc" },
    });
  } catch {
    rules = []; // schema tanpa tabel DataAccessRule — fallback otomatis saja
  }

  for (const r of rules) {
    const matched = await ruleMatchesActor(db, r, actor);
    if (!matched) continue;
    const hasCriteria =
      r.companyOfficeId || r.workLocationId || r.orgUnitId || r.positionId ||
      r.gradeId || r.positionLevelId || r.employmentStatus;
    if (!hasCriteria) {
      all = true;
      sources.push(`Rule ${r.code} — akses penuh (tanpa kriteria)`);
      continue;
    }
    sources.push(`Rule ${r.code} — ${r.name}`);
    filters.push({
      companyOfficeId: r.companyOfficeId ?? undefined,
      workLocationId: r.workLocationId ?? undefined,
      orgUnitId: r.orgUnitId ?? undefined,
      positionId: r.positionId ?? undefined,
      gradeId: r.gradeId ?? undefined,
      positionLevelId: r.positionLevelId ?? undefined,
      employmentStatus: r.employmentStatus ?? undefined,
      source: `${r.code} · ${r.name}`,
    });
  }

  return {
    all,
    sources,
    selfEmployeeId: actor.employeeId ?? null,
    subordinateIds,
    filters,
  };
}

/** Rule cocok dengan aktor? (subject ROLE / USER / ACCESS_GROUP) */
async function ruleMatchesActor(db: TenantDb, r: RuleRow, actor: { appUserId: string | null; appUserRole: string | null }): Promise<boolean> {
  if (r.subjectType === "ROLE") {
    return r.role != null && r.role === actor.appUserRole;
  }
  if (r.subjectType === "USER") {
    return r.appUserId != null && r.appUserId === actor.appUserId;
  }
  if (r.subjectType === "ACCESS_GROUP" && r.accessGroupId && actor.appUserId) {
    try {
      const m = await db.accessGroupMember.findFirst({
        where: { accessGroupId: r.accessGroupId, appUserId: actor.appUserId },
        select: { id: true },
      });
      return m != null;
    } catch {
      return false;
    }
  }
  return false;
}

// ============ konversi → Prisma where ============

/** where untuk satu filter kriteria (AND antar dimensi, relasi via assignment aktif). */
function filterWhere(f: ScopeFilter): Prisma.EmployeeWhereInput {
  const assign: Prisma.EmployeeAssignmentWhereInput = { validTo: null };
  if (f.companyOfficeId) assign.companyOfficeId = f.companyOfficeId;
  if (f.workLocationId) assign.workLocationId = f.workLocationId;
  if (f.orgUnitId) assign.orgUnitId = f.orgUnitId;
  if (f.positionId) assign.positionId = f.positionId;
  if (f.gradeId) assign.gradeId = f.gradeId;
  if (f.employmentStatus) assign.employmentStatus = f.employmentStatus;
  if (f.positionLevelId) assign.position = { positionLevelId: f.positionLevelId };
  return { assignments: { some: assign } };
}

/** Gabungan scope → kondisi WHERE Employee (OR antar sumber akses). */
export function scopeWhere(scope: DataAccessScope): Prisma.EmployeeWhereInput {
  if (scope.all) return {};
  const or: Prisma.EmployeeWhereInput[] = [];
  if (scope.selfEmployeeId) or.push({ id: scope.selfEmployeeId });
  if (scope.subordinateIds.length > 0) or.push({ id: { in: scope.subordinateIds } });
  for (const f of scope.filters) or.push(filterWhere(f));
  if (or.length === 0) return { id: "__none__" }; // tidak ada akses sama sekali
  return { OR: or };
}

/**
 * Apakah seorang karyawan masuk cakupan scope?
 * (dipakai endpoint detail: 403 bila false)
 */
export async function isEmployeeInScope(db: TenantDb, scope: DataAccessScope, employeeId: string): Promise<boolean> {
  if (scope.all) return true;
  if (scope.selfEmployeeId === employeeId) return true;
  if (scope.subordinateIds.includes(employeeId)) return true;
  if (scope.filters.length === 0) return false;

  // cek lewat assignment aktif — cukup ambil atribut penempatan lalu cocokkan
  const assigns = await db.employeeAssignment.findMany({
    where: { employeeId, validTo: null },
    select: {
      companyOfficeId: true, workLocationId: true, orgUnitId: true, positionId: true,
      gradeId: true, employmentStatus: true,
      position: { select: { positionLevelId: true } },
    },
  });
  if (assigns.length === 0) return false;
  for (const f of scope.filters) {
    for (const a of assigns) {
      const ok =
        (!f.companyOfficeId || a.companyOfficeId === f.companyOfficeId) &&
        (!f.workLocationId || a.workLocationId === f.workLocationId) &&
        (!f.orgUnitId || a.orgUnitId === f.orgUnitId) &&
        (!f.positionId || a.positionId === f.positionId) &&
        (!f.gradeId || a.gradeId === f.gradeId) &&
        (!f.positionLevelId || a.position?.positionLevelId === f.positionLevelId) &&
        (!f.employmentStatus || a.employmentStatus === f.employmentStatus);
      if (ok) return true;
    }
  }
  return false;
}

// ============ guard endpoint ber-scope ============

export type ScopedResult =
  | { ok: true; db: TenantDb; scope: DataAccessScope }
  | { ok: false; status: number; error: string };

/**
 * Guard endpoint BACA data karyawan dengan skema akses:
 * resolusi tenant (cookie) → AppUser (via email, seperti requireMutator)
 * → scope efektif. Route memakai:
 *   const s = await requireScoped(req);
 *   if (!s.ok) return NextResponse.json({ error: s.error }, { status: s.status });
 *   // s.db, s.scope
 */
export async function requireScoped(req: Request): Promise<ScopedResult> {
  const payload = readSessionCookie(req);
  if (!payload?.uid || !payload.tid) return { ok: false, status: 401, error: "Sesi tidak valid atau berakhir — silakan masuk kembali." };

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: {
      role: true,
      user: { select: { email: true } },
      tenant: { select: { schemaName: true, status: true } },
    },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") {
    return { ok: false, status: 401, error: "Sesi tidak valid atau berakhir — silakan masuk kembali." };
  }

  const db = getTenantClient(membership.tenant.schemaName);

  let appUser: { id: string; employeeId: string | null; role: string } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({
          where: { email: membership.user.email },
          select: { id: true, employeeId: true, role: true },
        })
      : null;
  } catch {
    appUser = null;
  }

  const scope = await resolveAccessScope(db, {
    appUserId: appUser?.id ?? null,
    employeeId: appUser?.employeeId ?? null,
    appUserRole: appUser?.role ?? null,
    platformRole: membership.role,
  });
  return { ok: true, db, scope };
}
