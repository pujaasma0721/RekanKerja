// RekanKerja tenant DB — client Prisma PER PostgreSQL schema (pemisahan data tenant).
// Pola: 1 tenant = 1 schema (tenant_<slug>). Koneksi di-cache per schema;
// URL = TENANT_DB_BASE_URL + ?schema=tenant_x (Prisma PostgreSQL default-schema).
import { PrismaClient as TenantPrismaClient } from "@/generated/tenant";
import { db as platformDb } from "@/lib/db";
import { readSessionCookie } from "./auth";

export type TenantDb = TenantPrismaClient;
export type { TenantPrismaClient };

const globalForTenants = globalThis as unknown as {
  rekankerjaTenantClients: Map<string, TenantPrismaClient> | undefined;
};

const tenantClients: Map<string, TenantPrismaClient> =
  globalForTenants.rekankerjaTenantClients ?? new Map();
globalForTenants.rekankerjaTenantClients = tenantClients;

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
  const payload = readSessionCookie(req);
  if (!payload?.uid || !payload.tid) return null;

  const membership = await platformDb.userTenant.findFirst({
    where: { userId: payload.uid, tenantId: payload.tid },
    select: { tenant: { select: { id: true, schemaName: true, status: true } } },
  });
  if (!membership || membership.tenant.status !== "ACTIVE") return null;

  return getTenantClient(membership.tenant.schemaName);
}

export const UNAUTHORIZED_MSG = "Sesi tidak valid atau berakhir — silakan masuk kembali.";
