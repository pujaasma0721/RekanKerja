// Migrasi modul Travel ke tenant existing (Task 19):
//   1. applyTravelDdl — CREATE TABLE travel (idempoten, hanya tabel yang belum ada)
//   2. ensureTravelReference (master: 4 zona, 5 template, 14 jenis biaya + limit + akun,
//      komponen upah UTRP/TRVSTLIN, budget 2026)
//   3. seedTravelDemoData MII (request + destinasi + advance + klaim + klaim Transferred)
// Jalankan: bun run scripts/migrate-travel.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { getTenantClient } from "@/lib/onevity/tenant-db";
import { ensureTravelReference } from "@/lib/onevity/provisioning";
import { seedTravelDemoData } from "@/lib/onevity/travel-seed";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const TRAVEL_TABLES = [
  "TravelZone", "TravelTemplate", "TravelExpenseType", "TravelBudget", "TravelBudgetItem",
  "TravelRequest", "TravelDestination", "TravelAdvance", "TravelClaim", "TravelClaimExpense",
];

/** CREATE TABLE + FK travel saja (search_path = schema tenant), skip yang sudah ada. */
export async function applyTravelDdl(schemaName: string): Promise<number> {
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
    const missing = TRAVEL_TABLES.filter((t) => !existing.has(t));
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
  console.log(`\n[${schema}] migrasi travel…`);
  const created = await applyTravelDdl(schema);
  console.log(`  ${created} tabel travel dibuat`);
  const db = getTenantClient(schema);
  await ensureTravelReference(db);
  const res = await seedTravelDemoData(db);
  if (res.skipped) {
    console.log("  data demo travel sudah ada — skip");
  } else {
    console.log(`  ${res.requests} permintaan, ${res.claims} klaim (1 Transferred), budget ${res.budgetYear}`);
  }
  await db.$disconnect();
}
console.log("\nDONE");
