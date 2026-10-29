import { PrismaClient } from "../src/generated/platform/client";
import { randomBytes, scryptSync } from "node:crypto";
const p = new PrismaClient({ datasources: { db: { url: "postgresql://onevity:onevity_dev@localhost:5432/onevity?schema=public" } } });
const salt = randomBytes(16).toString("hex");
const hash = `scrypt$${salt}$${scryptSync("EssDemo123!", salt, 64).toString("hex")}`;
const u = await p.user.findUnique({ where: { email: "ayu.pip@mii.co.id" } });
if (!u) { console.log("user tidak ada"); process.exit(1); }
await p.user.update({ where: { id: u.id }, data: { passwordHash: hash, failedAttempts: 0, lockedUntil: null } });
console.log("reset OK → EssDemo123!");
await p.$disconnect();
