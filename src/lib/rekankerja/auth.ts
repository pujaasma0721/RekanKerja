// RekanKerja SaaS auth — password (scrypt) + session cookie (HMAC-SHA256, httpOnly).
// Session payload: { uid, tid, exp } — tid = tenant terpilih (setelah login / select-tenant).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "rekankerja_session";
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
}

function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "rekankerja-dev-secret";
}

export function signSession(p: SessionPayload): string {
  const body = Buffer.from(JSON.stringify({ uid: p.uid, tid: p.tid, exp: p.exp })).toString("base64url");
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
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!p.uid || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function readSessionCookie(req: Request): SessionPayload | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|;\s*)rekankerja_session=([^;]+)/);
  return parseSession(m?.[1] ? decodeURIComponent(m[1]) : null);
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
  const payload = readSessionCookie(req);
  if (!payload) return null;
  const info = await buildSessionInfo(payload.uid, payload.tid);
  if (!info) return null;
  return { payload, info };
}

// Token segar (exp diperpanjang) — dipakai login/register/select-tenant.
export function freshSessionToken(uid: string, tid: string | null): string {
  return signSession({ uid, tid, exp: Date.now() + SESSION_MAX_AGE * 1000 });
}
