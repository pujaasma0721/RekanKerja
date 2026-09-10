// Migrasi T41-M10 (scheduler race-safe) ke tenant existing — IDEMPOTEN:
//   1. Partial unique index dedupe Reminder pada ActivityLog:
//        CREATE UNIQUE INDEX IF NOT EXISTS "ActivityLog_dedu_reminder"
//        ON "ActivityLog"("action","entity","entityId")
//        WHERE "entityId" IS NOT NULL AND "action" = 'Reminder';
//      Index dipakai claimReminder() scheduler-service (INSERT … ON CONFLICT
//      DO NOTHING) sehingga dua proses scheduler (PM2 cluster / dev server +
//      skrip manual) tidak bisa menanam kunci dedupe yang sama → tidak ada
//      dobel email/notifikasi pengingat & baris Reminder ganda.
//
// PENTING (arsitektur):
//   - Index bersifat PARTIAL (predicate WHERE) — Prisma TIDAK bisa
//     mengekspresikannya, jadi sengaja TIDAK ditambahkan ke
//     prisma/schema-tenant.prisma (tenant-ddl.sql tidak memuatnya).
//     Tenant BARU harus menerima DDL ini dari provisioning setelah
//     prisma/tenant-ddl.sql dijalankan (wiring oleh orchestrator — lihat
//     laporan Task 41-f di worklog.md).
//   - Predicate menahan HANYA baris action='Reminder' (baris pengingat
//     scheduler, entity 'Scheduler', entityId = kunci dedupe). Baris
//     ActivityLog bisnis lain — mis. action 'Created'/'Updated'/'Approved'
//     dengan entityId sama yang muncul berulang — TIDAK terindeks sehingga
//     tidak terhalang.
//   - Nilai action yang benar-benar dipakai kode diverifikasi via grep:
//     satu-satunya penulis baris Reminder adalah claimReminder() dengan
//     action 'Reminder' (bukan 'REMINDER_…'), entity 'Scheduler'.
//
// Tenant dienumerasi dari registry platform (public."Tenant" status ACTIVE,
// query platform DB) — fallback ke 3 schema sandbox bila registry tak
// terbaca. Jalankan: bun scripts/migrate-scheduler-race.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
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

/** DDL partial unique index dedupe Reminder (idempoten). */
const DEDUPE_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityLog_dedu_reminder"
ON "ActivityLog"("action","entity","entityId")
WHERE "entityId" IS NOT NULL AND "action" = 'Reminder';`;

async function activeTenantSchemas(): Promise<{ slug: string; schemaName: string }[]> {
  const c = new Client({ connectionString: PLATFORM_URL });
  try {
    await c.connect();
    const r = await c.query<{ slug: string; schemaName: string }>(
      `SELECT "slug", "schemaName" FROM public."Tenant" WHERE "status" = 'ACTIVE' ORDER BY "slug"`,
    );
    if (r.rowCount && r.rowCount > 0) return r.rows;
  } catch (e) {
    console.warn(`[migrate-scheduler-race] registry tenant tak terbaca (${e instanceof Error ? e.message : e}) — fallback schema sandbox`);
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
  return FALLBACK_SCHEMAS.map((s) => ({ slug: s.replace(/^tenant_/, "").replace(/_/g, "-"), schemaName: s }));
}

async function migrateSchema(schemaName: string, slug: string): Promise<void> {
  console.log(`\n[${schemaName}] (${slug}) migrasi scheduler-race…`);
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    // pre-check: tabel ActivityLog ada? (tenant parsial pra-migrasi)
    const hasTable = await c.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'ActivityLog'`,
      [schemaName],
    );
    if (hasTable.rowCount === 0) {
      console.log("  SKIP — tabel ActivityLog belum ada di schema ini");
      return;
    }

    // pre-check duplikat: baris Reminder dengan kunci dedupe sama akan
    // membuat CREATE UNIQUE INDEX gagal — laporkan agar bisa dibersihkan
    // manual (sandbox: 0 duplikat, aman).
    const dup = await c.query<{ entityId: string; n: string }>(`
      SELECT "entityId", count(*)::text AS n FROM "ActivityLog"
      WHERE "entityId" IS NOT NULL AND "action" = 'Reminder'
      GROUP BY "entityId" HAVING count(*) > 1 ORDER BY n DESC LIMIT 5`);
    if (dup.rowCount && dup.rowCount > 0) {
      console.warn(
        `  PERINGATAN — ${dup.rowCount} kunci Reminder duplikat terdeteksi (mis. ${dup.rows[0]!.entityId} ×${dup.rows[0]!.n}); index mungkin gagal dibuat — bersihkan duplikat lalu jalankan ulang`,
      );
    }

    await c.query(DEDUPE_DDL);
    console.log('  ✓ index "ActivityLog_dedu_reminder" (action,entity,entityId) WHERE entityId IS NOT NULL AND action = \'Reminder\'');

    // verifikasi: index terpasang + statistik baris Reminder
    const idx = await c.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'ActivityLog' AND indexname = 'ActivityLog_dedu_reminder'`,
      [schemaName],
    );
    const stat = await c.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM "ActivityLog" WHERE "action" = 'Reminder' AND "entityId" IS NOT NULL`,
    );
    console.log(`  verifikasi: index terdaftar=${idx.rowCount === 1}, baris Reminder terindeks=${stat.rows[0]?.total ?? 0}`);
  } finally {
    await c.end();
  }
}

export async function main(schemas?: { slug: string; schemaName: string }[]): Promise<void> {
  const list = schemas ?? (await activeTenantSchemas());
  for (const t of list) {
    await migrateSchema(t.schemaName, t.slug);
  }
  console.log(`\nDONE — partial unique index dedupe Reminder diterapkan (idempoten) di ${list.length} tenant`);
  console.log("CATATAN: index TIDAK ada di prisma/schema-tenant.prisma (partial index tak ter-ekspresi Prisma)");
  console.log("         — provisioning tenant baru perlu DDL ini (wiring orchestrator).");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
