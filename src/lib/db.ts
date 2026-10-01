// Platform Prisma client (schema "public") — registry SaaS: Tenant / User / UserTenant.
// Data domain HRIS TIDAK di sini — lihat src/lib/rekankerja/tenant-db.ts (client per schema tenant).
import { PrismaClient } from "@/generated/platform";

const globalForPrisma = globalThis as unknown as {
  platformPrisma: PrismaClient | undefined;
};

export const db = globalForPrisma.platformPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.platformPrisma = db;
