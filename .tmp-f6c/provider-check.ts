import { PrismaClient } from "@/generated/tenant";
const db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_BASE_URL! + "?schema=tenant_pt_mitra_industri_internasional" } } } as never);
const rows = await db.aiProviderConfig.findMany();
console.log(JSON.stringify(rows, null, 2));
await db.$disconnect();
