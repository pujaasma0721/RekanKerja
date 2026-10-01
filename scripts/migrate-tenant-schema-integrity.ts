// Task 64l — integritas schema tenant: heal tabel kritis yang hilang
// ===========================================================================
// Latar: tenant_demouser0229 dibuat saat tenant-ddl.sql belum memuat tabel
// PasswordPolicy (Task 33 belakangan) → schema cacat permanen: getTenantPolicy
// fallback diam-diam, parity gap permanen, cleaning manual diperlukan.
//
// Proteksi dua arah:
//   1. provisioning.ts — verifikasi tabel kritis SETELAH DDL; hilang → gagal-
//      bersih (schema di-drop, registrasi gagal jelas). Tenant BARU tak bisa
//      lagi cacat.
//   2. SKRIP INI — heal tenant EXISTING: tabel kritis hilang dibuat ulang dari
//      blok CREATE TABLE di prisma/tenant-ddl.sql (sumber tunggal, selalu
//      sinkron dengan kode). Idempoten: tabel yang sudah ada dilewati.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU dijalankan CLI.
import "./lib/env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { tenantSchemas } from "../src/rekankerja/shared/lib/parity-runner";
import { CRITICAL_TENANT_TABLES } from "../src/rekankerja/shared/lib/provisioning";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const DDL_PATH = path.join(process.cwd(), "prisma", "tenant-ddl.sql");

/**
 * Parse blok `CREATE TABLE "<nama>" (…);` dari tenant-ddl.sql → map nama→SQL.
 * Blok berakhir pada baris `);` pertama (format pg_dump/Prisma konsisten).
 */
function parseCreateTableBlocks(): Map<string, string> {
  const sql = readFileSync(DDL_PATH, "utf8");
  const map = new Map<string, string>();
  const re = /CREATE TABLE "(\w+)" \(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const start = m.index;
    const end = sql.indexOf("\n);", start);
    if (end === -1) continue;
    map.set(m[1]!, sql.slice(start, end + 3));
  }
  return map;
}

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[schema-integrity] belum ada tenant — lewati");
    return;
  }
  const blocks = parseCreateTableBlocks();
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      // Per-schema never-throw — satu tenant bermasalah tidak menghentikan lainnya.
      try {
        const placeholders = CRITICAL_TENANT_TABLES.map((_, i) => `$${i + 2}`).join(",");
        const r = await c.query<{ missing: string }>(
          `SELECT t.name AS missing FROM unnest(ARRAY[${placeholders}]::text[]) AS t(name)
           WHERE to_regclass($1 || '.' || '"' || t.name || '"') IS NULL`,
          [`"${schema}"`, ...CRITICAL_TENANT_TABLES],
        );
        const missing = r.rows.map((x) => x.missing);
        if (missing.length === 0) continue;
        for (const table of missing) {
          const ddl = blocks.get(table);
          if (!ddl) {
            console.error(`[${schema}] tabel ${table} hilang & tidak ada di tenant-ddl.sql — LEWATI (perlu perhatian manual)`);
            continue;
          }
          try {
            await c.query(`SET search_path TO "${schema}"`);
            await c.query(ddl);
            console.log(`[${schema}] tabel kritis ${table} DIBUAT ulang (heal)`);
          } catch (e) {
            console.error(`[${schema}] GAGAL membuat ${table}: ${e instanceof Error ? e.message : String(e)} — lanjut`);
          }
        }
      } catch (e) {
        console.error(`[${schema}] GAGAL memeriksa: ${e instanceof Error ? e.message : String(e)} — lanjut`);
      }
    }
  } finally {
    await c.end();
  }
}

// CLI mandiri: npx tsx scripts/migrate-tenant-schema-integrity.ts
if (process.argv[1] && process.argv[1].includes("migrate-tenant-schema-integrity")) {
  main().then(
    () => process.exit(0),
    (e) => { console.error(e); process.exit(1); },
  );
}

export {};
