// Sementara arahkan provider AI ke endpoint mati → aiComplete gagal → jalur simulated teruji.
import { PrismaClient } from "@/generated/tenant";
const db = new PrismaClient({ datasources: { db: { url: process.env.TENANT_DB_BASE_URL! + "?schema=tenant_pt_mitra_industri_internasional" } } } as never);
await db.aiProviderConfig.deleteMany({});
await db.aiProviderConfig.create({ data: { provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "dead", enabled: true } } as never);
console.log("provider AI diarahkan ke endpoint mati (simulasi kegagalan)");
await db.$disconnect();
