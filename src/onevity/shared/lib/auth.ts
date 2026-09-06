// OneVity SaaS auth — password (scrypt) + session cookie (HMAC-SHA256, httpOnly).
// Session payload: { uid, tid, exp } — tid = tenant terpilih (setelah login / select-tenant).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "onevity_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 hari

export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  HR: "HR",
  VIEWER: "Viewer",
};

// ============ password ============

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const target = Buffer.from(hash, "hex");
  return test.length === target.length && timingSafeEqual(test, target);
}

// ============ session token ============

export interface SessionPayload {
  uid: string;
  tid: string | null;
  exp: number; // epoch ms
  /** versi sesi server-side (T1-SECURITY) — mismatch dengan User.sessionVersion → token invalid. */
  sv: number;
}

// Fail-fast produksi (T1-SECURITY): tanpa SESSION_SECRET yang eksplisit, token
// bisa dipalsukan karena fallback secret dev hard-coded. Di production kita
// MENOLAK menyala (throw saat modul dimuat) — bukan melanjutkan dengan rahasia lemah.
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SESSION_SECRET belum diset — aplikasi produksi menolak berjalan tanpa kunci tanda tangan sesi. " +
        "Set env SESSION_SECRET (mis. 32+ karakter acak) lalu restart.",
      );
    }
    return "onevity-dev-secret"; // dev saja — jangan pernah dipakai di production
  }
  return secret;
}

export function signSession(p: SessionPayload): string {
  const body = Buffer.from(JSON.stringify({ uid: p.uid, tid: p.tid, exp: p.exp, sv: p.sv })).toString("base64url");
  const mac = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function parseSession(token?: string | null): SessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expect = createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  if (mac.length !== expect.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (!p.uid || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    if (typeof p.sv !== "number") return null; // token lama (pra-revokasi) tidak sah
    return { uid: p.uid, tid: p.tid ?? null, exp: p.exp, sv: p.sv };
  } catch {
    return null;
  }
}

export function readSessionCookie(req: Request): SessionPayload | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)onevity_session=([^;]+)/);
  return parseSession(m?.[1] ? decodeURIComponent(m[1]) : null);
}

/**
 * Baca + VERIFIKASI sesi terhadap server (T1-SECURITY):
 * cookie HMAC → cocokkan payload.sv dengan User.sessionVersion di DB.
 * Mismatch (logout / ganti sandi / revokasi admin) → null → 401.
 *
 * Catatan teknis: kolom dibaca via $queryRaw (bukan model Prisma) supaya tetap
 * bekerja pada proses dev yang cache-nya masih memegang Prisma client LAMA
 * (src/generated di-gitignore → regenerasi pasca db:push tidak selalu di-HMR).
 */
export async function readVerifiedSession(req: Request): Promise<SessionPayload | null> {
  const payload = readSessionCookie(req);
  if (!payload) return null;
  try {
    const rows = await db.$queryRaw<Array<{ sessionVersion: number }>>`
      SELECT "sessionVersion" FROM "User" WHERE id = ${payload.uid} LIMIT 1`;
    if (rows.length === 0 || Number(rows[0]!.sessionVersion) !== payload.sv) return null;
  } catch {
    return null; // kolom belum ada (pra-migrasi) → anggap token tidak sah
  }
  return payload;
}

/** Versi sesi user saat ini dari DB (raw — alasan sama dgn readVerifiedSession). */
export async function currentSessionVersion(userId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ sessionVersion: number }>>`
    SELECT "sessionVersion" FROM "User" WHERE id = ${userId} LIMIT 1`;
  return rows.length > 0 ? Number(rows[0]!.sessionVersion) : 0;
}

/**
 * Revokasi SEMUA sesi user (T1-SECURITY): naikkan sessionVersion — token lama
 * (payload.sv lebih rendah) otomatis ditolak readVerifiedSession. Dipakai
 * logout & ganti kata sandi. Return versi baru utk token segar.
 */
export async function bumpSessionVersion(userId: string): Promise<number> {
  const rows = await db.$queryRaw<Array<{ sessionVersion: number }>>`
    UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1, "updatedAt" = now()
    WHERE id = ${userId} RETURNING "sessionVersion"`;
  return rows.length > 0 ? Number(rows[0]!.sessionVersion) : 0;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

// ============ session info (dipakai /api/auth/me & login/register/select) ============

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isSuperadmin: boolean;
}
export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
}
export interface SessionInfo {
  user: SessionUser;
  tenant: SessionTenant | null;
  workspaces: SessionTenant[];
}

export async function buildSessionInfo(userId: string, tenantId: string | null): Promise<SessionInfo | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, isSuperadmin: true },
  });
  if (!user) return null;

  const memberships = await db.userTenant.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { tenant: { select: { id: true, name: true, slug: true, plan: true, status: true } } },
  });

  const workspaces = memberships
    .filter((m) => m.tenant.status === "ACTIVE")
    .map((m) => ({ id: m.tenant.id, name: m.tenant.name, slug: m.tenant.slug, plan: m.tenant.plan, role: m.role }));

  const tenant = tenantId ? (workspaces.find((w) => w.id === tenantId) ?? null) : null;
  return { user, tenant, workspaces };
}

export async function getSessionFromRequest(req: Request): Promise<{ payload: SessionPayload; info: SessionInfo } | null> {
  const payload = await readVerifiedSession(req);
  if (!payload) return null;
  const info = await buildSessionInfo(payload.uid, payload.tid);
  if (!info) return null;
  return { payload, info };
}

// Token segar (exp diperpanjang) — dipakai login/register/select-tenant.
// sessionVersion wajib eksplisit (T1-SECURITY) agar token selalu terikat versi sesi user.
export function freshSessionToken(uid: string, tid: string | null, sessionVersion: number): string {
  return signSession({ uid, tid, exp: Date.now() + SESSION_MAX_AGE * 1000, sv: sessionVersion });
}
