// throwaway check (Task 28-a): WA state + employees with phone in MII tenant
import { PrismaClient as T } from "@/generated/tenant";
import * as fs from "node:fs";
const env = fs.readFileSync(".env", "utf8");
const line = env.split("\n").find((l) => l.startsWith("TENANT_DB_BASE_URL="))!;
const u = new URL(line.slice("TENANT_DB_BASE_URL=".length).trim());
const db = new T({
  datasources: { db: { url: `${u.protocol}//${u.username}:${u.password}@${u.host}${u.pathname}?schema=tenant_pt_mitra_industri_internasional` } },
});

const emps = await db.employee.findMany({
  where: { phone: { not: null } },
  select: { employeeNo: true, fullName: true, phone: true },
  orderBy: { employeeNo: "asc" },
});
console.log("employees WITH phone:", emps.length);
for (const e of emps.slice(0, 6)) console.log(`  ${e.employeeNo} ${e.fullName} ${e.phone}`);
console.log("yusuf:", JSON.stringify(emps.find((e) => e.employeeNo === "MII00010")));

const cfg = await db.waConfig.findFirst();
console.log("waConfig:", cfg ? { active: cfg.active, provider: cfg.provider, endpoint: cfg.endpoint, token: cfg.token, lastTestOk: cfg.lastTestOk, lastTestMessage: cfg.lastTestMessage } : null);
const tpl = await db.waTemplate.findMany({ orderBy: { event: "asc" } });
console.log("waTemplate:", tpl.length, tpl.map((t) => `${t.event}:${t.active ? "on" : "off"}`).join(" "));
const logs = await db.waLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
console.log("waLog total (last 30):", logs.length);
for (const l of logs) console.log(`  ${l.createdAt.toISOString()} ${l.event} ${l.toPhone} ${l.status} ${l.error ?? ""} ${l.body?.slice(0, 60) ?? ""}`);
await db.$disconnect();
