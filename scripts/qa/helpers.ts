// QA helpers — RekanKerja multi-tenant test suite (pure fetch, tanpa import src/)
// Dijalankan oleh bun test / bun scripts/qa/*.ts melawan dev server :3000.
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, scryptSync } from "node:crypto";

export {};

export const BASE = "http://127.0.0.1:3000";
export const BASE_DOMAIN = "rekankerja.id";

export const USERS = {
  mii: { email: "hrd@mii.co.id", password: "onevity123", preferSlug: "pt-mitra-industri-internasional" },
  cahaya: { email: "ayu@cahaya.id", password: "cahaya12345", preferSlug: "cahaya-digital-nusantara" },
  sentra: { email: "bambang@sentra.co.id", password: "sentra12345", preferSlug: "sentra-logistik-prima" },
  ess: { email: "yusuf@mii.co.id", password: "EssDemo123!" },
} as const;

export interface TenantRef {
  id: string;
  name: string;
  slug: string;
  role: string;
}
export interface Session {
  cookie: string;
  tenant: TenantRef | null;
  workspaces: TenantRef[];
}

/** Baca variabel dari .env proyek (white-box — suite berjalan di mesin yang sama). */
export function readEnvVar(name: string): string | undefined {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return undefined;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Ambil cookie pertama dari header Set-Cookie (pasangan name=value saja). */
function firstCookie(res: Response): string {
  const all = res.headers.getSetCookie?.() ?? [];
  return all[0]?.split(";")[0] ?? "";
}

export async function api(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(extraHeaders ?? {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Login + (bila perlu) pilih workspace — return cookie sesi aktif + info tenant. */
export async function loginAs(u: { email: string; password: string; preferSlug?: string }): Promise<Session> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  if (res.status !== 200) throw new Error(`login ${u.email} → HTTP ${res.status}`);
  let cookie = firstCookie(res);
  const j = (await res.json()) as {
    tenant?: TenantRef | null;
    workspaces?: TenantRef[];
  };
  let tenant = j.tenant ?? null;
  const workspaces = j.workspaces ?? [];
  if (!tenant || (u.preferSlug && tenant.slug !== u.preferSlug)) {
    const target = u.preferSlug ? workspaces.find((w) => w.slug === u.preferSlug) : workspaces[0];
    if (!target) throw new Error(`workspace ${u.preferSlug ?? "(pertama)"} tidak tersedia utk ${u.email}`);
    const sel = await fetch(`${BASE}/api/auth/select-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ tenantId: target.id }),
    });
    if (sel.status !== 200) throw new Error(`select-tenant ${target.slug} → HTTP ${sel.status}`);
    const c2 = firstCookie(sel);
    if (c2) cookie = c2;
    const sj = (await sel.json()) as { tenant?: TenantRef | null };
    tenant = sj.tenant ?? target;
  }
  return { cookie, tenant, workspaces };
}

/** Login + ambil header Set-Cookie mentah (untuk inspeksi flag keamanan). */
export async function loginRaw(u: { email: string; password: string }): Promise<{ res: Response; cookie: string; setCookie: string[] }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: u.email, password: u.password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { res, cookie: setCookie[0]?.split(";")[0] ?? "", setCookie };
}

// ============ white-box: pembuatan token sesi (mirror auth.ts) ============

/** HMAC-SHA256 base64url — format identik signSession() di auth.ts. */
export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** scrypt hash format "scrypt$salt$hash" (mirror hashPassword). */
export function scryptHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** Escape string utk literal SQL (dipakai setup/teardown user QA via pg). */
export function sqlLit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
