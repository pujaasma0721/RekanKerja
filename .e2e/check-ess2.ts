import { PrismaClient } from "../src/generated/platform/client";
const p = new PrismaClient({ datasources: { db: { url: "postgresql://onevity:onevity_dev@localhost:5432/onevity?schema=public" } } });
const u = await p.user.findUnique({ where: { email: "ayu.pip@mii.co.id" } });
console.log("user:", u?.id, "status:", u?.status, "pwdHash prefix:", u?.passwordHash?.slice(0, 10));
const ut = await p.userTenant.findFirst({ where: { userId: u?.id }, select: { tenantId: true, role: true, status: true } });
console.log("tenant:", JSON.stringify(ut));
await p.$disconnect();
