// Task 65 — parity: tabel Onboarding + OnboardingTask + kolom OffboardingTask.completedVia
// Idempoten: cek information_schema/pg_tables sebelum buat. Never-throw per
// schema — satu tenant bermasalah tidak menghentikan tenant lain.
// Dapat diimpor dari parity-runner (import dinamis, tanpa efek samping).
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface TenantRow { schema: string }

function q(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/** Ambil blok CREATE TABLE "X" ( … ); dari tenant-ddl.sql (sumber tunggal). */
function ddlBlockOf(table: string): string | null {
  const ddl = readFileSync(join(process.cwd(), "prisma", "tenant-ddl.sql"), "utf8");
  const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?"${table}" \\([\\s\\S]*?\\);`, "m");
  const m = ddl.match(re);
  return m ? m[0].replace("CREATE TABLE", "CREATE TABLE IF NOT EXISTS") : null;
}

async function ensureTable(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, schema: string, table: string): Promise<boolean> {
  const exists = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2 LIMIT 1`,
    [schema, table],
  );
  if (exists.rows.length > 0) return false;
  const block = ddlBlockOf(table);
  if (!block) throw new Error(`DDL ${table} tidak ditemukan di tenant-ddl.sql`);
  await db.query(block.replace(`"${table}"`, `${q(schema)}.${q(table)}`));
  return true;
}

async function ensureColumn(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, schema: string, table: string, column: string, ddlType: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3 LIMIT 1`,
    [schema, table, column],
  );
  if (r.rows.length > 0) return false;
  await db.query(`ALTER TABLE ${q(schema)}.${q(table)} ADD COLUMN IF NOT EXISTS ${q(column)} ${ddlType}`);
  return true;
}

async function ensureIndex(db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, schema: string, table: string, column: string): Promise<void> {
  const idxName = `${table}_${column}_idx`;
  const r = await db.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2 LIMIT 1`,
    [schema, idxName],
  );
  if (r.rows.length === 0) {
    await db.query(`CREATE INDEX IF NOT EXISTS ${q(idxName)} ON ${q(schema)}.${q(table)} (${q(column)})`);
  }
}

export async function main(schemas?: string[] | ((msg: string) => void), log: (msg: string) => void = (m) => console.log(m)): Promise<void> {
  // parity-runner memanggil main(schemas: string[]); CLI bisa main(fn) —
  // normalisasi: argumen fungsi pertama dianggap logger.
  let list0: string[] = [];
  if (typeof schemas === "function") {
    log = schemas as (msg: string) => void;
  } else if (Array.isArray(schemas)) {
    list0 = schemas;
  }
  const { Client } = await import("pg");
  // env dieksplisitkan (parity-runner sudah memastikan env termuat)
  const base = process.env.TENANT_DB_BASE_URL;
  if (!base) throw new Error("TENANT_DB_BASE_URL kosong");
  const url = new URL(base);
  const urlBase = `${url.protocol}//${url.username}:${url.password}@${url.host}${url.pathname}`;

  // daftar schema: parameter parity-runner → fallback registry platform DB
  let list: string[] = list0;
  if (list.length === 0) {
    const platUrl = process.env.PLATFORM_DB_URL ?? base;
    const plat = new Client({ connectionString: platUrl });
    await plat.connect();
    const tenants = await plat.query<{ schema: string }>(
      `SELECT "schemaName" AS schema FROM "Tenant" WHERE status = 'ACTIVE'`,
    );
    await plat.end();
    list = tenants.rows.map((r) => r.schema);
  }

  let created = 0;
  let colAdded = 0;
  let errors = 0;

  for (const schema of list) {
    const client = new Client({ connectionString: `${urlBase}?schema=${schema}&connection_limit=2` });
    try {
      await client.connect();
      if (await ensureTable(client, schema, "Onboarding")) created += 1;
      if (await ensureTable(client, schema, "OnboardingTask")) created += 1;
      await ensureIndex(client, schema, "Onboarding", "employeeId");
      await ensureIndex(client, schema, "Onboarding", "status");
      await ensureIndex(client, schema, "OnboardingTask", "onboardingId");
      if (await ensureColumn(client, schema, "OffboardingTask", "completedVia", "TEXT")) colAdded += 1;
    } catch (e) {
      errors += 1;
      log(`  ${schema}: ${(e as Error).message}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  log(`checklist-tables: ${list.length} tenant, ${created} tabel dibuat, ${colAdded} kolom completedVia ditambah${errors ? `, ${errors} ERROR` : ""}`);
  if (errors > 0) throw new Error(`checklist-tables: ${errors} schema gagal (lihat log)`);
}

// jalankan langsung: npx tsx scripts/migrate-checklist-tables.ts
if (process.argv[1] && process.argv[1].endsWith("migrate-checklist-tables.ts")) {
  main((m) => console.log(m)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
