import { PrismaClient } from "../src/generated/platform/client";
const p = new PrismaClient({ datasources: { db: { url: "postgresql://onevity:onevity_dev@localhost:5432/onevity?schema=public" } } });
try {
  const u = await p.user.findUnique({ where: { email: "ayu.pip@mii.co.id" } });
  console.log("FOUND:", u?.id, u?.status);
} catch (e) {
  console.log("ERR:", (e as Error).message.slice(0, 200));
}
await p.$disconnect();
