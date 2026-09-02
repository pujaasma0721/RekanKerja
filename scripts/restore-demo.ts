// Restore demo environment — pulihkan 3 tenant SaaS setelah reset environment:
// 1. MII: provision schema + seed penuh (44 karyawan + payroll + attendance) + registry + owner
// 2. Cahaya Digital Nusantara: provision + seed referensi + owner ayu@cahaya.id + admin hrd@mii.co.id
// 3. Sentra Logistik Prima: provision + seed referensi + owner bambang@sentra.co.id
// Idempotent: tenant yang sudah ada di-skip (data tidak dihapus).
// Jalankan: bun run scripts/restore-demo.ts
import { spawnSync } from "node:child_process";
import { db as platform } from "@/lib/db";
import { hashPassword } from "@/lib/onevity/auth";
import { provisionTenantSchema, seedTenantReference, slugify, schemaNameForSlug } from "@/lib/onevity/provisioning";
import { getTenantClient } from "@/lib/onevity/tenant-db";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

async function ensureTenant(name: string): Promise<{ id: string; schemaName: string; created: boolean }> {
  const slug = slugify(name);
  const schemaName = schemaNameForSlug(slug);
  const existing = await platform.tenant.findFirst({ where: { slug } });
  if (existing) return { id: existing.id, schemaName: existing.schemaName, created: false };
  await provisionTenantSchema(schemaName);
  const tenant = await platform.tenant.create({ data: { name, slug, schemaName } });
  return { id: tenant.id, schemaName, created: true };
}

async function ensureUser(email: string, name: string, password: string): Promise<string> {
  const existing = await platform.user.findUnique({ where: { email } });
  if (existing) return existing.id;
  const user = await platform.user.create({ data: { email, name, passwordHash: hashPassword(password) } });
  return user.id;
}

async function ensureMembership(userId: string, tenantId: string, role: "OWNER" | "ADMIN") {
  const existing = await platform.userTenant.findFirst({ where: { userId, tenantId } });
  if (!existing) await platform.userTenant.create({ data: { userId, tenantId, role } });
}

async function main() {
  console.log("== Restore demo multi-tenant OneVity ==");

  // ---------- 1. MII (data penuh dari seed) ----------
  const mii = await ensureTenant("PT Mitra Industri Internasional");
  if (mii.schemaName !== MII_SCHEMA) throw new Error(`Schema MII tidak terduga: ${mii.schemaName}`);
  const miiEmpCount = await getTenantClient(MII_SCHEMA).employee.count();
  if (miiEmpCount === 0) {
    console.log("[MII] provision + seed penuh…");
    const r = spawnSync("bun", ["prisma/seed.ts"], {
      env: { ...process.env, SEED_TENANT_SCHEMA: MII_SCHEMA },
      stdio: "inherit",
    });
    if (r.status !== 0) throw new Error("Seed MII gagal");
  } else {
    console.log(`[MII] data sudah ada (${miiEmpCount} karyawan) — skip seed`);
  }
  const hrdId = await ensureUser("hrd@mii.co.id", "Tri Handayani", "onevity123");
  await ensureMembership(hrdId, mii.id, "OWNER");

  // ---------- 2. Cahaya Digital Nusantara (tenant referensi) ----------
  const cahaya = await ensureTenant("Cahaya Digital Nusantara");
  if (cahaya.created) {
    console.log("[Cahaya] provision + seed referensi…");
    await seedTenantReference(getTenantClient(cahaya.schemaName));
  }
  const ayuId = await ensureUser("ayu@cahaya.id", "Ayu Kartika", "cahaya12345");
  await ensureMembership(ayuId, cahaya.id, "OWNER");
  await ensureMembership(hrdId, cahaya.id, "ADMIN"); // hrd MII juga admin di Cahaya

  // ---------- 3. Sentra Logistik Prima (tenant referensi) ----------
  const sentra = await ensureTenant("Sentra Logistik Prima");
  if (sentra.created) {
    console.log("[Sentra] provision + seed referensi…");
    await seedTenantReference(getTenantClient(sentra.schemaName));
  }
  const bambangId = await ensureUser("bambang@sentra.co.id", "Bambang Prakoso", "sentra12345");
  await ensureMembership(bambangId, sentra.id, "OWNER");

  // ---------- verifikasi ----------
  const tenants = await platform.tenant.findMany({ include: { memberships: { include: { user: true } } } });
  console.log("\n== Ringkasan ==");
  for (const t of tenants) {
    const users = t.memberships.map((m) => `${m.user.email} (${m.role})`).join(", ");
    console.log(`• ${t.name} — schema ${t.schemaName} [${t.status}] → ${users}`);
  }
  console.log("\nAkun demo: hrd@mii.co.id/onevity123 · ayu@cahaya.id/cahaya12345 · bambang@sentra.co.id/sentra12345");
  await platform.$disconnect();
  console.log("== SELESAI ==");
}

main().catch((e) => { console.error(e); process.exit(1); });
