// Migrasi modul Medical ke tenant existing (Task 21):
//   1. applyMedicalDdl — CREATE TABLE medical (idempoten, hanya tabel belum ada)
//   2. ensureMedicalReference (master: 8 jenis benefit, 8 provider, akun 5106,
//      komponen UMC)
//   3. seedMedicalDemoData MII (generate saldo + klaim + penyesuaian)
// Jalankan: bun run scripts/migrate-medical.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { ensureMedicalReference } from "@/onevity/shared/lib/provisioning";
import { seedMedicalDemoData } from "@/onevity/medical/services/medical-seed";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const MEDICAL_TABLES = [
  "MedicalBenefitType", "MedicalProvider", "MedicalBalance",
  "MedicalClaim", "MedicalClaimLine", "MedicalAdjustment",
];

/** CREATE TABLE + FK medical saja (search_path = schema tenant), skip yang sudah ada. */
export async function applyMedicalDdl(schemaName: string): Promise<number> {
  const ddl = readFileSync(path.join(process.cwd(), "prisma", "tenant-ddl.sql"), "utf8");
  const statements: string[] = [];
  let cur = "";
  for (const line of ddl.split("\n")) {
    if (line.startsWith("--")) continue;
    cur += line + "\n";
    if (line.trim().endsWith(";")) { statements.push(cur.trim()); cur = ""; }
  }
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);
    const existing = new Set(
      (await c.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schemaName]))
        .rows.map((r) => r.table_name)
    );
    const missing = MEDICAL_TABLES.filter((t) => !existing.has(t));
    if (missing.length === 0) return 0;
    let n = 0;
    for (const stmt of statements) {
      const create = stmt.match(/^CREATE TABLE "([A-Za-z]+)"/);
      if (create && missing.includes(create[1])) { await c.query(stmt); n++; continue; }
      const fk = stmt.match(/^ALTER TABLE ONLY "([A-Za-z]+)"/);
      if (fk && missing.includes(fk[1])) { await c.query(stmt); }
    }
    return n;
  } finally {
    await c.end();
  }
}

for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi medical…`);
  const created = await applyMedicalDdl(schema);
  console.log(`  ${created} tabel medical dibuat`);
  const db = getTenantClient(schema);
  await ensureMedicalReference(db);
  const res = await seedMedicalDemoData(db);
  if (res.skipped) {
    console.log("  data demo medical sudah ada — skip");
  } else {
    console.log(`  ${res.balances} saldo · ${res.claims} klaim · ${res.adjustments} penyesuaian`);
  }
  await db.$disconnect();
}
console.log("\nDONE");
