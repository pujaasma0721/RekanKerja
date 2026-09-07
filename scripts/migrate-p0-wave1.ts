// Migrasi P0 WAVE-1 (audit domain-first GAP-ANALYSIS-DEEP.md) ke tenant existing:
//   1. applyP0Ddl — 2 tabel baru (LetterRequest, MinimumWage)
//      + kolom baru: Employee.contractStart/contractEnd/renewalCount (PKWT PP 35/2021)
//      + PayrollRun.slipPassword (slip gaji email berpassword)
//   2. Tidak menimpa template surat — seed template EMP_* dilakukan oleh
//      scripts/resync-letter-templates.ts setelah letter-defaults.ts diperluas.
// Jalankan: bun run scripts/migrate-p0-wave1.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const NEW_TABLES = ["LetterRequest", "MinimumWage"];

const NEW_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "Employee", column: "contractStart", ddl: "TIMESTAMP(3)" },
  { table: "Employee", column: "contractEnd", ddl: "TIMESTAMP(3)" },
  { table: "Employee", column: "renewalCount", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "PayrollRun", column: "slipPassword", ddl: "BOOLEAN NOT NULL DEFAULT false" },
];

/** Parse statement DDL dari tenant-ddl.sql. */
function ddlStatements(): string[] {
  const ddl = readFileSync(path.join(process.cwd(), "prisma", "tenant-ddl.sql"), "utf8");
  const statements: string[] = [];
  let cur = "";
  for (const line of ddl.split("\n")) {
    if (line.startsWith("--")) continue;
    cur += line + "\n";
    if (line.trim().endsWith(";")) { statements.push(cur.trim()); cur = ""; }
  }
  return statements;
}

/** CREATE TABLE/INDEX/FK untuk tabel baru; ADD COLUMN untuk tabel existing. */
async function applyP0Ddl(schemaName: string): Promise<{ tables: number; columns: number }> {
  const statements = ddlStatements();
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);
    const existing = new Set(
      (await c.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schemaName])).rows.map((r) => r.table_name),
    );
    let tables = 0;
    for (const stmt of statements) {
      const create = stmt.match(/^CREATE TABLE "([A-Za-z]+)"/);
      if (create && NEW_TABLES.includes(create[1])) {
        if (existing.has(create[1])) continue; // idempoten
        await c.query(stmt); tables++; continue;
      }
      const idx = stmt.match(/^CREATE (?:UNIQUE )?INDEX "[A-Za-z0-9_]+" ON "([A-Za-z]+)"/);
      if (idx && NEW_TABLES.includes(idx[1])) {
        try { await c.query(stmt); } catch { /* index sudah ada */ }
        continue;
      }
      const fk = stmt.match(/^ALTER TABLE (?:ONLY )?"([A-Za-z]+)"/);
      if (fk && NEW_TABLES.includes(fk[1]) && stmt.includes("ADD CONSTRAINT")) {
        const conName = stmt.match(/ADD CONSTRAINT "([A-Za-z0-9_]+)"/)?.[1];
        const has = conName ? await c.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [conName]) : null;
        if (has && has.rowCount === 0) await c.query(stmt);
        continue;
      }
    }
    // ADD COLUMN untuk tabel existing (idempoten)
    let columns = 0;
    for (const { table, column, ddl } of NEW_COLUMNS) {
      const has = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schemaName, table, column],
      );
      if (has.rowCount === 0) {
        await c.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`);
        columns++;
      }
    }
    return { tables, columns };
  } finally {
    await c.end();
  }
}

// ============ main ============

for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi P0 wave-1 (LetterRequest, MinimumWage, PKWT, slipPassword)…`);
  const ddl = await applyP0Ddl(schema);
  console.log(`  DDL: ${ddl.tables} tabel baru, ${ddl.columns} kolom baru`);
}
console.log("\nDONE");
