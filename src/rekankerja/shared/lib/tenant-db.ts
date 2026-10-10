// RekanKerja tenant DB — client Prisma PER PostgreSQL schema (pemisahan data tenant).
// Pola: 1 tenant = 1 schema (tenant_<slug>). Koneksi di-cache per schema;
// URL = TENANT_DB_BASE_URL + ?schema=tenant_x (Prisma PostgreSQL default-schema).
import { PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import { db as platformDb } from "@/lib/db";
import { effectiveTenantIdOf, readVerifiedSession } from "./auth";
import { TENANT_SCHEMA_BRAND, primeTenantCrypto } from "./field-crypto";

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
// T16-ATTACH: versi dinaikkan lagi (V5) — model Attachment + EmployeeDocument
// masuk client hasil generate (route lampiran & dokumen karyawan memakainya).
// T9-HOLIDAY: versi dinaikkan lagi (V6H) — model HolidayDate masuk client hasil
// generate (overlay engine resolveDayType meng-query tabel ini); agen paralel
// lain memakai V5 — key V6H milik T9, instance lama tidak dipakai ulang.
// T18-API: versi dinaikkan lagi (V7) — model ApiKey + Webhook + WebhookLog
// masuk client hasil generate (apikey/webhook-service & route public
// memakai model ini); instance DMMF lama (pra-V7) tidak dipakai ulang.
// T15-CHAIN-EXT: versi dinaikkan lagi (V15T) — kolom AttendanceRule.
// maxOvertimeHours/maxOvertimeHoursMonthly masuk client hasil generate
// (validasi cap lembur PP 35/2021 saat submit/approve perintah lembur);
// agen lain memakai V7/V6H — key V15T milik T15, instance lama tidak dipakai.
// WAVE-27: versi dinaikkan (W27) — 10 model baru (Asset/AssetAssignment,
// Announcement/AnnouncementRead, ShiftSwapRequest, MachineImportBatch,
// WaConfig/WaTemplate/WaLog, CustomReport) + kolom WorkLocation geofence +
// AttendanceRule.geofenceMode masuk client hasil generate; instance lama
// (pra-W27, DMMF tanpa model baru) tidak dipakai ulang.
// TASK 28-c: versi dinaikkan (W28) — field uang payroll FLIP Float→String
// (PayrollRun/RunLine/RunItem, EmployeeAssignment.baseSalary,
// EmployeeComponentAssignment.amount, PayrollJournal[Line]) — DMMF lama
// (pra-W28, tipe Float) tidak boleh dipakai ulang. Instance juga kini
// membawa brand symbol schema (TENANT_SCHEMA_BRAND) utk field-crypto.
// TASK 45-A: versi dinaikkan lagi (T45A) — model MoneyVault + MoneyViewGrant
// (gerbang visibilitas uang terenkripsi) masuk client hasil generate; instance
// lama (pra-T45A, DMMF tanpa db.moneyVault/moneyViewGrant) tidak dipakai ulang.
// TASK 47: versi dinaikkan lagi (T47A) — kolom MoneyVault.dataKey (kunci
// enkripsi kata sandi perusahaan) masuk client hasil generate.
// TASK 49: versi dinaikkan lagi (T49A) — kolom EmployeePayrollProfile.ptkpSource
// (sumber PTKP auto|manual — turunan data keluarga) masuk client hasil generate.
// TASK 52: versi dinaikkan lagi (T52A) — PayrollRegulation +jkp* (JKP PP 6/2025)
// dan tabel WhistleblowReport (Task 52-f) masuk client hasil generate.
// F0-REC: versi dinaikkan lagi (F0REC) — 10 model master Recruitment (F0
// DEVELOPMENT-PLAN-RECRUITMENT.md) masuk client hasil generate; instance lama
// (pra-F0REC, DMMF tanpa db.recruitmentMethod dst.) tidak boleh dipakai ulang.
// F1-REC: versi dinaikkan lagi (F1REC) — model PersonnelRequisition (PR
// rekrutmen — F1) masuk client hasil generate; instance lama (pra-F1REC,
// DMMF tanpa db.personnelRequisition) tidak boleh dipakai ulang.
const globalForTenants = globalThis as unknown as {
  rekankerjaTenantClientsF1REC: Map<string, TenantPrismaClient> | undefined;
};

const tenantClients: Map<string, TenantPrismaClient> =
  globalForTenants.rekankerjaTenantClientsF1REC ?? new Map();
globalForTenants.rekankerjaTenantClientsF1REC = tenantClients;

function tenantBaseUrl(): string {
  const base = process.env.TENANT_DB_BASE_URL;
  if (!base) throw new Error("TENANT_DB_BASE_URL belum diset");
  return base;
}

// =========================================================================
// M-19 (audit 42) — MATEMATIKA POOL KONEKSI vs PostgreSQL max_connections.
// =========================================================================
// Setiap schema tenant mendapat SATU client Prisma di-cache selama proses
// hidup (Map globalThis di atas — client idle TIDAK PERNAH ditutup).
// Anggaran koneksi (default embedded-PG max_connections=100):
//   · platform client (src/lib/db, schema public, tanpa connection_limit
//     eksplisit → default Prisma ~ num_cpus×2+1, ± 5-9 koneksi);
//   · N tenant × TENANT_CONNECTION_LIMIT koneksi per client;
//   · + koneksi administratif postgres itu sendiri + skrip/worker paralel.
// Dengan limit 5/client → (100 − ~10) / 5 ≈ **± 19 schema tenant per node**
// sebelum pool habis (error pool_timeout / koneksi ditolak). Dengan limit 3
// (default sejak fix ini) → ± 30 schema per node. Demo 44-karyawan memakai
// 3 tenant = 9 koneksi tenant — jauh di bawah batas.
// CATATAN PENTING long-lived process: cache client TIDAK menutup client yang
// idle — node yang melayani BANYAK tenant menumpuk koneksi secara permanen
// (tenant tidak pernah "keluar"). Mitigasi bila jumlah tenant tumbuh:
//   1. naikkan max_connections PostgreSQL; ATAU
//   2. letakkan PgBouncer (transaction pooling) di depan & arahkan
//      TENANT_DB_BASE_URL ke-nya (Prisma + pgbouncer: disable prepared
//      statements / pgbouncer di transaction mode);
//   3. skala horizontal: bagi tenant lintas node (registry schemaName tetap
//      satu sumber kebenaran);
//   4. tuning per-deploy lewat env TENANT_DB_CONNECTION_LIMIT (1..20).
// Dipilih 3 (turun dari 5) + env override: beban request per-tenant demo/
// SMB sekuensial dan pendek (query ms-level, pool_timeout 10s menampung
// antrean Promise.all seperti employee-options 6-query paralel).
// =========================================================================
const TENANT_CONNECTION_LIMIT = (() => {
  const raw = Number(process.env.TENANT_DB_CONNECTION_LIMIT);
  return Number.isFinite(raw) && raw >= 1 && raw <= 20 ? Math.floor(raw) : 3;
})();

/** Ambil (dan cache) client Prisma untuk schema tenant tertentu. */
export function getTenantClient(schemaName: string): TenantDb {
  let client = tenantClients.get(schemaName);
  if (!client) {
    const url = `${tenantBaseUrl()}?schema=${schemaName}&connection_limit=${TENANT_CONNECTION_LIMIT}&pool_timeout=10`;
    client = new TenantPrismaClient({ datasources: { db: { url } } });
    // 28-c: brand schema pada instance — sumber konteks kunci enkripsi field
    // (tenantCryptoForDb). Non-enumerable supaya tidak ikut ke JSON log.
    Object.defineProperty(client, TENANT_SCHEMA_BRAND, {
      value: schemaName,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    tenantClients.set(schemaName, client);
    // Task 47: muat dataKey vault (kunci kata sandi perusahaan) ke cache
    // field-crypto — fire-and-forget (request path menunggu versi await
    // di requireTenant/requireMutator; ini menutup celah jalur sync).
    void primeTenantCrypto(schemaName).catch(() => {});
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

  // Task 78: subdomain tenant (<slug>.<base>) MEMAKSA konteks tenant host —
  // tid cookie workspace lain diabaikan; sesi belum punya akses di tenant
  // host (bukan anggota) → null → 401.
  const { tenantId } = await effectiveTenantIdOf(payload.uid, payload.tid, req);
  if (!tenantId) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId },
    select: { tenant: { select: { id: true, schemaName: true, status: true } } },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  const db = getTenantClient(membership.tenant.schemaName);
  // Task 47: pastikan dataKey vault termuat (sekali per proses per schema)
  // sebelum serializer membaca nilai enc:v2.
  await primeTenantCrypto(membership.tenant.schemaName).catch(() => {});
  return db;
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

  // Task 78: subdomain tenant memaksa konteks tenant host (sama dgn requireTenant).
  const { tenantId } = await effectiveTenantIdOf(payload.uid, payload.tid, req);
  if (!tenantId) return { ok: false, status: 401, error: UNAUTHORIZED_MSG };

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId },
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
  // Task 47: pastikan dataKey vault termuat sebelum mutasi membaca/menulis
  // nilai terenkripsi.
  await primeTenantCrypto(membership.tenant.schemaName).catch(() => {});

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
