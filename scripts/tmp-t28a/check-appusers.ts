// t28a throwaway: AppUser admin/HR roles + employee link (approver phone resolution)
import { PrismaClient as T } from "@/generated/tenant";
import * as fs from "node:fs";
const env = fs.readFileSync(".env", "utf8");
const line = env.split("\n").find((l) => l.startsWith("TENANT_DB_BASE_URL="))!;
const u = new URL(line.slice("TENANT_DB_BASE_URL=".length).trim());
const db = new T({ datasources: { db: { url: `${u.protocol}//${u.username}:${u.password}@${u.host}${u.pathname}?schema=tenant_pt_mitra_industri_internasional` } } });
const users = await db.appUser.findMany({
  where: { active: true },
  select: { username: true, email: true, role: true, employeeId: true },
  orderBy: { username: "asc" },
});
const ids = users.map((x) => x.employeeId).filter((x): x is string => !!x);
const emps = ids.length ? await db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phone: true } }) : [];
const empById = new Map(emps.map((e) => [e.id, e]));
for (const u2 of users) {
  const e = u2.employeeId ? empById.get(u2.employeeId) : undefined;
  console.log(`${u2.username} | role=${u2.role} | email=${u2.email} | emp=${e?.fullName ?? "-"} | phone=${e?.phone ?? "-"}`);
}
await db.$disconnect();
