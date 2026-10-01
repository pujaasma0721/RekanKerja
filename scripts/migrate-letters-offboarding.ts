// Migrasi TEMPLATE SURAT + OFFBOARDING ke tenant existing (Task Admin-6):
//   1. applyLettersDdl — 4 tabel baru (LetterTemplate, LetterDocument,
//      Offboarding, OffboardingTask) + kolom CompanyOffice.npwp (idempoten)
//   2. seedLetterTemplates — default template surat (idempoten per key;
//      TIDAK menimpa template yang sudah diedit user)
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun run scripts/migrate-letters-offboarding.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { LETTER_TEMPLATE_DEFAULTS } from "@/rekankerja/shared/lib/letter-defaults";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const NEW_TABLES = ["LetterTemplate", "LetterDocument", "Offboarding", "OffboardingTask"];

const NEW_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "CompanyOffice", column: "npwp", ddl: "TEXT" },
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
export async function applyLettersDdl(schemaName: string): Promise<{ tables: number; columns: number }> {
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

/** Seed template surat default — idempoten (skip key yang sudah ada). */
export async function seedLetterTemplates(db: TenantDb): Promise<number> {
  let seeded = 0;
  for (const t of LETTER_TEMPLATE_DEFAULTS) {
    const before = await db.letterTemplate.findUnique({ where: { key: t.key }, select: { id: true } });
    if (before) continue;
    await db.letterTemplate.create({
      data: {
        key: t.key,
        category: t.category,
        name: t.name,
        description: t.description ?? null,
        subject: t.subject ?? null,
        body: t.body,
        signatoryTitle: t.signatoryTitle,
      },
    });
    seeded++;
  }
  return seeded;
}

// ============ main ============

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
  console.log(`\n[${schema}] migrasi template surat + offboarding…`);
  const ddl = await applyLettersDdl(schema);
  console.log(`  DDL: ${ddl.tables} tabel baru, ${ddl.columns} kolom baru`);
  const db = getTenantClient(schema);
  const templates = await seedLetterTemplates(db);
  console.log(`  Template surat: ${templates} template default di-seed`);
  await db.$disconnect();
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
