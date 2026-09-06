// OneVity tenant DB — client Prisma PER PostgreSQL schema (pemisahan data tenant).
// Pola: 1 tenant = 1 schema (tenant_<slug>). Koneksi di-cache per schema;
// URL = TENANT_DB_BASE_URL + ?schema=tenant_x (Prisma PostgreSQL default-schema).
import { PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import { db as platformDb } from "@/lib/db";
import { readVerifiedSession } from "./auth";

export type TenantDb = TenantPrismaClient;
export type { TenantPrismaClient };

// T3-TRAVEL: key diberi versi — regenerasi Prisma client (kolom baru
// TravelAdvance.status/givenAt nullable) mewajibkan instance client baru;
// instance lama (DMMF lama) di cache global tidak dipakai ulang.
// T7-ESS: versi dinaikkan lagi (V3) — model Notification + kolom
// AttendanceClockLog.latitude/longitude masuk client hasil generate;
// route lama maupun baru sama-sama mendapat instance DMMF baru.
// T5-TA-FIX: versi dinaikkan lagi (V4) — kolom AttendanceDaily.paidFlag
// masuk client hasil generate (recapPeriod/regenerateDaily menulis kolom ini).
const globalForTenants = globalThis as unknown as {
  onevityTenantClientsV4: Map<string, TenantPrismaClient> | undefined;
};

const tenantClients: Map<string, TenantPrismaClient> =
  globalForTenants.onevityTenantClientsV4 ?? new Map();
globalForTenants.onevityTenantClientsV4 = tenantClients;

function tenantBaseUrl(): string {
  const base = process.env.TENANT_DB_BASE_URL;
  if (!base) throw new Error("TENANT_DB_BASE_URL belum diset");
  return base;
}

/** Ambil (dan cache) client Prisma untuk schema tenant tertentu. */
export function getTenantClient(schemaName: string): TenantDb {
  let client = tenantClients.get(schemaName);
  if (!client) {
    const url = `${tenantBaseUrl()}?schema=${schemaName}&connection_limit=5&pool_timeout=10`;
    client = new TenantPrismaClient({ datasources: { db: { url } } });
    tenantClients.set(schemaName, client);
  }
  return client;
}

export function disconnectTenantClient(schemaName: string): void {
  const client = tenantClients.get(schemaName);
  if (client) {
    void client.$disconnect();
    tenantClients.delete(schemaName);
  }
}

/**
 * Resolusi tenant dari request:
 * 1. cookie session (uid + tid) → cek membership + status tenant di platform;
 * 2. return client schema tenant tersebut, atau null bila tidak sah (→ route balas 401).
 *
 * Route memakai pola:
 *   const db = await requireTenant(req);
 *   if (!db) return NextResponse.json({ error: "..." }, { status: 401 });
 */
export async function requireTenant(req: Request): Promise<TenantDb | null> {
  // T1-SECURITY: readVerifiedSession — token divalidasi terhadap User.sessionVersion
  // (logout/ganti sandi menaikkan versi → token lama 401).
  const payload = await readVerifiedSession(req);
  if (!payload?.uid || !payload.tid) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: { tenant: { select: { id: true, schemaName: true, status: true } } },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  return getTenantClient(membership.tenant.schemaName);
}

export const UNAUTHORIZED_MSG = "Sesi tidak valid atau berakhir — silakan masuk kembali.";
export const VIEWER_FORBIDDEN_MSG =
  "Akses ditolak: role Viewer hanya dapat melihat data, tidak melakukan aksi bisnis. Hubungi admin workspace.";

/** Identitas aktor sesi (untuk jejak keputusan — pengganti aktor hard-coded). */
export interface TenantActor {
  /** userId platform (User.id) */
  userId: string;
  name: string;
  email: string;
  /** role workspace: OWNER | ADMIN | HR | VIEWER */
  role: string;
  /** AppUser tenant bila ditemukan (dicocokkan via email) — untuk tautan ke karyawan */
  appUserId: string | null;
  appUsername: string | null;
  employeeId: string | null;
}

export type MutatorResult =
  | { ok: true; db: TenantDb; actor: TenantActor }
  | { ok: false; status: number; error: string };

/**
 * Guard untuk endpoint MUTASI BISNIS (approve/reject/cancel/settle/transfer/
 * confirm payroll/dsb) — fix audit BPA C-01/C-02:
 * 1. resolusi tenant seperti requireTenant;
 * 2. role VIEWER ditolak (403);
 * 3. mengembalikan identitas aktor NYATA dari sesi (bukan hard-coded),
 *    termasuk AppUser tenant (cocok email) untuk kolom decidedBy/approver.
 *
 * Pola pemakaian di route:
 *   const m = await requireMutator(req);
 *   if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
 *   // m.db, m.actor
 */
export async function requireMutator(req: Request): Promise<MutatorResult> {
  // T1-SECURITY: readVerifiedSession — revokasi sesi server-side diperhitungkan.
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
  if (membership.role === "VIEWER") {
    return { ok: false, status: 403, error: VIEWER_FORBIDDEN_MSG };
  }

  const db = getTenantClient(membership.tenant.schemaName);

  // Resolusi AppUser tenant via email (opsional — boleh null, mis. user platform tanpa AppUser)
  let appUser: { id: string; username: string; employeeId: string | null } | null = null;
  try {
    appUser = membership.user.email
      ? await db.appUser.findFirst({
          where: { email: membership.user.email },
          select: { id: true, username: true, employeeId: true },
        })
      : null;
  } catch {
    appUser = null; // schema legacy tanpa tabel appUser — aktor tetap valid dari sesi
  }

  return {
    ok: true,
    db,
    actor: {
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      appUserId: appUser?.id ?? null,
      appUsername: appUser?.username ?? null,
      employeeId: appUser?.employeeId ?? null,
    },
  };
}
