// RekanKerja — layanan KEBIJAKAN KATA SANDI (server) (Task 33) ==================
// =====================================================================
// Bagian server dari password-policy.ts: baca/self-heal kebijakan tenant,
// cek riwayat sandi (N terakhir), catat sandi baru (riwayat + umur + hash
// platform User), lockout login, status umur utk /api/auth/me, dan sentuh
// lastLogin. Hash sandi tetap tunggal di platform User.passwordHash —
// tenant menyimpan META (PasswordHistory + passwordChangedAt).
// =====================================================================
import { db as platformDb } from "@/lib/db";
import { getTenantClient, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { hashPassword, verifyPassword } from "@/rekankerja/shared/lib/auth";
import {
  DEFAULT_PASSWORD_POLICY,
  platformRoleOfAppRole,
  passwordAge,
  type PasswordPolicyData,
} from "@/rekankerja/shared/lib/password-policy";

// ---------- kebijakan tenant ----------

/**
 * Baca kebijakan aktif tenant — SELF-HEAL: baris belum ada → seed default.
 * Gagal total (tabel belum termigrasi) → DEFAULT (tidak melempar error).
 */
export async function getTenantPolicy(db: TenantDb): Promise<PasswordPolicyData> {
  try {
    const row = await db.passwordPolicy.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } });
    if (row) return { ...DEFAULT_PASSWORD_POLICY, ...row } as PasswordPolicyData;
    const created = await db.passwordPolicy.create({ data: { active: true } });
    return { ...DEFAULT_PASSWORD_POLICY, ...created } as PasswordPolicyData;
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY };
  }
}

// ---------- riwayat sandi ----------

export interface HistoryCheckResult {
  ok: boolean;
  /** index riwayat yang cocok (1 = terbaru) — utk pesan "sama dengan sandi lama ke-N" */
  matchedIndex: number | null;
}

/**
 * Cek sandi baru terhadap N hash terakhir pengguna (larangan pakai ulang).
 */
export async function checkPasswordHistory(
  db: TenantDb,
  appUserId: string,
  newPassword: string,
  historyCount: number,
): Promise<HistoryCheckResult> {
  if (historyCount <= 0) return { ok: true, matchedIndex: null };
  try {
    const rows = await db.passwordHistory.findMany({
      where: { appUserId },
      orderBy: { setAt: "desc" },
      take: historyCount,
      select: { hash: true },
    });
    for (let i = 0; i < rows.length; i++) {
      if (verifyPassword(newPassword, rows[i]!.hash)) {
        return { ok: false, matchedIndex: i + 1 };
      }
    }
    return { ok: true, matchedIndex: null };
  } catch {
    return { ok: true, matchedIndex: null }; // tabel belum ada → longgar
  }
}

// ---------- mencatat sandi baru ----------

export interface RecordPasswordOpts {
  db: TenantDb;
  appUserId: string;
  /** email login platform (kunci User.passwordHash) */
  email: string;
  newPassword: string;
  /** AppUser admin yang menyetel (reset) — null bila pengguna mengganti sendiri */
  setByAppUserId?: string | null;
  /** role AppUser — dipakai bila user platform harus dibuat (self-healing link) */
  appRole?: string;
  /** nama utk user platform baru */
  fullName?: string;
  /** tenantId platform (session tid) — membership utk user platform baru */
  tenantId?: string | null;
}

/**
 * Setel sandi baru seorang pengguna (create/reset/ganti):
 * 1. hash → platform User (buat user+membership bila belum ada — self-heal);
 * 2. push PasswordHistory + pangkas ke historyCount;
 * 3. AppUser.passwordChangedAt = sekarang.
 * Gagal langkah platform tidak menggagalkan penyimpanan meta tenant (best-effort,
 * utk schema legacy) — kecuali pembuatan user BARU (dipanggil route create secara eksplisit).
 */
export async function recordPasswordSet(opts: RecordPasswordOpts): Promise<void> {
  const { db, appUserId, email, newPassword } = opts;
  const policy = await getTenantPolicy(db);
  const hash = hashPassword(newPassword);
  const now = new Date();

  // 1) platform User — buat bila belum ada (admin tenant membuat pengguna baru)
  try {
    const existing = await platformDb.user.findUnique({ where: { email } });
    if (existing) {
      await platformDb.user.update({
        where: { id: existing.id },
        data: { passwordHash: hash, failedAttempts: 0, lockedUntil: null },
      });
    } else {
      const user = await platformDb.user.create({
        data: { email, name: opts.fullName ?? email, passwordHash: hash },
      });
      // membership ke tenant pengelola — role dipetakan dari AppUser.role
      if (opts.tenantId) {
        const mem = await platformDb.userTenant.findFirst({ where: { userId: user.id, tenantId: opts.tenantId } });
        if (!mem) {
          await platformDb.userTenant.create({
            data: { userId: user.id, tenantId: opts.tenantId, role: platformRoleOfAppRole(opts.appRole ?? "Viewer") },
          });
        }
      }
    }
  } catch {
    // platform tak tersedia → meta tenant tetap dicatat
  }

  // 2) riwayat + pangkas + umur
  try {
    await db.passwordHistory.create({
      data: { appUserId, hash, setById: opts.setByAppUserId ?? null },
    });
    if (policy.historyCount > 0) {
      const keep = await db.passwordHistory.findMany({
        where: { appUserId },
        orderBy: { setAt: "desc" },
        take: policy.historyCount,
        select: { id: true },
      });
      const keepIds = keep.map((k) => k.id);
      if (keepIds.length > 0) {
        await db.passwordHistory.deleteMany({ where: { appUserId, id: { notIn: keepIds } } });
      }
    }
    await db.appUser.update({ where: { id: appUserId }, data: { passwordChangedAt: now } });
  } catch {
    // tabel belum termigrasi — dilewati
  }
}

// ---------- lockout & status login ----------

/** Resolusi schema tenant aktif dari seorang platform user (email). */
async function activeSchemasOfUser(userId: string): Promise<string[]> {
  const memberships = await platformDb.userTenant.findMany({
    where: { userId },
    select: { tenant: { select: { schemaName: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.filter((m) => m.tenant.status === "ACTIVE").map((m) => m.tenant.schemaName);
}

/**
 * Kebijakan lockout utk login: policy workspace PERTAMA user yang aktif
 * (praktik wajar multi-tenant demo); fallback default 5x/15m.
 */
export async function resolveLoginLockout(userId: string): Promise<{ maxFailedAttempts: number; lockoutMinutes: number }> {
  try {
    const schemas = await activeSchemasOfUser(userId);
    if (schemas.length === 0) return { maxFailedAttempts: DEFAULT_PASSWORD_POLICY.maxFailedAttempts, lockoutMinutes: DEFAULT_PASSWORD_POLICY.lockoutMinutes };
    const policy = await getTenantPolicy(getTenantClient(schemas[0]!));
    return { maxFailedAttempts: policy.maxFailedAttempts, lockoutMinutes: policy.lockoutMinutes };
  } catch {
    return { maxFailedAttempts: DEFAULT_PASSWORD_POLICY.maxFailedAttempts, lockoutMinutes: DEFAULT_PASSWORD_POLICY.lockoutMinutes };
  }
}

export interface PasswordStatus {
  expired: boolean;
  remainingDays: number | null;
  warn: boolean;
  label: string;
}

/**
 * Status umur sandi pengguna sesi (utk /api/auth/me + toast shell) —
 * best-effort: tanpa AppUser/policy/lifetime → null (tidak pernah gagal request).
 */
export async function passwordStatusOfSession(
  userId: string,
  tenantId: string | null,
  email: string,
): Promise<PasswordStatus | null> {
  try {
    const schemas: string[] = [];
    if (tenantId) {
      const m = await platformDb.userTenant.findFirst({
        where: { userId, tenantId },
        select: { tenant: { select: { schemaName: true, status: true } } },
      });
      if (m?.tenant.status === "ACTIVE") schemas.push(m.tenant.schemaName);
    }
    if (schemas.length === 0) schemas.push(...(await activeSchemasOfUser(userId)));
    if (schemas.length === 0) return null;

    const db = getTenantClient(schemas[0]!);
    const policy = await getTenantPolicy(db);
    const appUser = await db.appUser.findFirst({
      where: { email },
      select: { passwordChangedAt: true },
    });
    if (!appUser?.passwordChangedAt || policy.lifetimeDays <= 0) return null;
    const age = passwordAge(appUser.passwordChangedAt, policy);
    return { expired: age.expired, remainingDays: age.remainingDays, warn: age.warn, label: age.label };
  } catch {
    return null;
  }
}

/** Update AppUser.lastLogin (kolum yang dulu selalu NULL) — best-effort. */
export async function touchLastLogin(email: string, tenantId: string | null, userId: string): Promise<void> {
  try {
    let schemas: string[];
    if (tenantId) {
      const m = await platformDb.userTenant.findFirst({
        where: { userId, tenantId },
        select: { tenant: { select: { schemaName: true } } },
      });
      schemas = m?.tenant.schemaName ? [m.tenant.schemaName] : [];
    } else {
      schemas = await activeSchemasOfUser(userId);
    }
    for (const schema of schemas) {
      try {
        await getTenantClient(schema).appUser.updateMany({ where: { email }, data: { lastLogin: new Date() } });
      } catch {
        // schema tanpa tabel AppUser — skip
      }
    }
  } catch {
    // best-effort
  }
}
