// Migrasi T41-M14 (webhook retry/backoff) ke tenant existing — IDEMPOTEN:
//   1. Kolom baru WebhookLog (schema Prisma sudah diperbarui —
//      prisma/schema-tenant.prisma; regenerasi client via `bun run db:generate`
//      dan DDL tenant baru via `bun run tenant:ddl`):
//        ALTER TABLE "WebhookLog" ADD COLUMN IF NOT EXISTS "attempts"    INTEGER NOT NULL DEFAULT 1;
//        ALTER TABLE "WebhookLog" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
//        ALTER TABLE "WebhookLog" ADD COLUMN IF NOT EXISTS "lastError"   TEXT;
//      (payload body JSON sudah tersimpan sejak awal di kolom "payload" —
//      tidak perlu kolom baru untuk retry.)
//   2. Paritas default status dengan DDL tenant baru:
//        ALTER TABLE "WebhookLog" ALTER COLUMN "status" SET DEFAULT 'delivered';
//      (kolom status SUDAH ADA — hanya defaultnya yang diparitaskan.)
//   3. Index pencarian antrian retry (sama dgn tenant-ddl.sql hasil
//      `bun run tenant:ddl`):
//        CREATE INDEX IF NOT EXISTS "WebhookLog_status_nextRetryAt_idx"
//        ON "WebhookLog"("status","nextRetryAt");
//
// Semantik nilai status (baru): delivered | failed | dead (+ pending,
// + legacy Sent/Failed pada baris lama). Baris LAMA pra-migrasi memakai
// nilai legacy 'Sent'/'Failed' dengan nextRetryAt NULL → tidak pernah
// diambil job webhook-retry (sengaja: kegagalan historis tidak di-replay).
//
// Tenant dienumerasi dari registry platform (public."Tenant" status ACTIVE)
// — fallback ke 3 schema sandbox bila registry tak terbaca.
// Jalankan: bun scripts/migrate-webhook-retry.ts
import { Client } from "pg";

const PLATFORM_URL =
  process.env.PLATFORM_DB_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const FALLBACK_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

async function activeTenantSchemas(): Promise<{ slug: string; schemaName: string }[]> {
  const c = new Client({ connectionString: PLATFORM_URL });
  try {
    await c.connect();
    const r = await c.query<{ slug: string; schemaName: string }>(
      `SELECT "slug", "schemaName" FROM public."Tenant" WHERE "status" = 'ACTIVE' ORDER BY "slug"`,
    );
    if (r.rowCount && r.rowCount > 0) return r.rows;
  } catch (e) {
    console.warn(`[migrate-webhook-retry] registry tenant tak terbaca (${e instanceof Error ? e.message : e}) — fallback schema sandbox`);
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
  return FALLBACK_SCHEMAS.map((s) => ({ slug: s.replace(/^tenant_/, "").replace(/_/g, "-"), schemaName: s }));
}

async function migrateSchema(schemaName: string, slug: string): Promise<void> {
  console.log(`\n[${schemaName}] (${slug}) migrasi webhook-retry…`);
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    // pre-check: tabel WebhookLog ada? (tenant tanpa modul T18-API)
    const hasTable = await c.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'WebhookLog'`,
      [schemaName],
    );
    if (hasTable.rowCount === 0) {
      console.log("  SKIP — tabel WebhookLog belum ada di schema ini");
      return;
    }

    await c.query(`
      ALTER TABLE "WebhookLog"
        ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
        ADD COLUMN IF NOT EXISTS "lastError" TEXT;`);
    console.log('  ✓ kolom attempts (default 1), nextRetryAt, lastError');

    // paritas default status dgn tenant-ddl.sql baru (kolom sudah ada)
    await c.query(`ALTER TABLE "WebhookLog" ALTER COLUMN "status" SET DEFAULT 'delivered';`);
    console.log("  ✓ DEFAULT status = 'delivered'");

    await c.query(`
      CREATE INDEX IF NOT EXISTS "WebhookLog_status_nextRetryAt_idx"
      ON "WebhookLog"("status","nextRetryAt");`);
    console.log('  ✓ index "WebhookLog_status_nextRetryAt_idx" (status,nextRetryAt)');

    // verifikasi
    const cols = await c.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'WebhookLog' ORDER BY ordinal_position`,
      [schemaName],
    );
    const names = cols.rows.map((r) => r.column_name);
    const ok = ["attempts", "nextRetryAt", "lastError"].every((k) => names.includes(k));
    const stat = await c.query<{ total: string; failed: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE "status" = 'failed')::text AS failed
       FROM "WebhookLog"`,
    );
    console.log(`  verifikasi: kolom lengkap=${ok} (${names.join(",")})`);
    console.log(`  baris WebhookLog=${stat.rows[0]?.total ?? 0}, status 'failed' terjadwal=${stat.rows[0]?.failed ?? 0}`);
  } finally {
    await c.end();
  }
}

export async function main(schemas?: { slug: string; schemaName: string }[]): Promise<void> {
  const list = schemas ?? (await activeTenantSchemas());
  for (const t of list) {
    await migrateSchema(t.schemaName, t.slug);
  }
  console.log(`\nDONE — kolom retry WebhookLog diterapkan (idempoten) di ${list.length} tenant`);
  console.log("CATATAN: baris lama memakai status legacy Sent/Failed + nextRetryAt NULL → tidak di-retry (sengaja).");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
