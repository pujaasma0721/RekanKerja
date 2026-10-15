// Migrasi B7-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B7) — SEMUA idempoten
// (pola migrate-recruitment-b6-wa-meeting):
//   1. ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "statusLinkUsedAt"
//      TIMESTAMP(3) — magic-link cek status lamaran sekali-pakai (diisi saat
//      verifikasi token sukses = waktu pakai terakhir; token yang diterbitkan
//      setelahnya tetap valid — link lama → 410).
//   2. CREATE TABLE IF NOT EXISTS "CareerSiteConfig" + unique index tenantSlug
//      — branding portal karier per tenant (TANPA seed default — row absen =
//      fallback kode, keputusan backlog B7 §1 kompromi builder no-code).
//   3. Seed baris "EmailTemplate" event recruitment.status.link (INSERT …
//      ON CONFLICT DO NOTHING — edit admin TIDAK pernah ditimpa; self-heal
//      GET /api/rekankerja/email-templates hanya menulis saat tabel kosong,
//      jadi event BARU perlu seed eksplisit utk tenant existing — pola B6
//      WaTemplate).
// Tidak ada seed data domain lain. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-b7-status-link.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { DEFAULT_TEMPLATES_PLACEHOLDER } from "@/rekankerja/shared/services/email-defaults";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- B7 — kolom magic-link status lamaran (idempoten; paritas tenant-ddl.sql) ---
  `ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "statusLinkUsedAt" TIMESTAMP(3)`,
  // --- B7 — tabel branding portal karier per tenant ---
  `CREATE TABLE IF NOT EXISTS "CareerSiteConfig" (
      "id" TEXT NOT NULL,
      "tenantSlug" TEXT NOT NULL,
      "brandColor" TEXT NOT NULL DEFAULT '#0f766e',
      "logoUrl" TEXT,
      "heroTitle" TEXT,
      "heroSub" TEXT,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "CareerSiteConfig_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CareerSiteConfig_tenantSlug_key" ON "CareerSiteConfig"("tenantSlug")`,
];

// Template email event baru saja (self-heal GET hanya menulis tabel kosong).
const B7_TEMPLATES = DEFAULT_TEMPLATES_PLACEHOLDER.filter((t) => t.event === "recruitment.status.link");

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-b7-status-link] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      console.log(`  ${schemaName}:`);
      await c.query(`SET search_path TO "${schemaName}"`);
      for (const ddl of DDL) {
        try {
          await c.query(ddl);
        } catch (e: unknown) {
          const msg = String((e as Error)?.message ?? "");
          // 42710 = duplicate object (kolom/index sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      const col = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'Applicant' AND column_name = 'statusLinkUsedAt'`,
        [schemaName],
      );
      const tbl = await c.query<{ n: number }>(
        `SELECT to_regclass('"${schemaName}"."CareerSiteConfig"') IS NOT NULL AS n`,
      );
      console.log(`    kolom Applicant.statusLinkUsedAt: ${col.rows[0]?.n ? "ada" : "HILANG"}`);
      console.log(`    tabel CareerSiteConfig: ${tbl.rows[0]?.n ? "ada" : "HILANG"}`);
      let seeded = 0;
      for (const t of B7_TEMPLATES) {
        const r = await c.query(
          `INSERT INTO "EmailTemplate" ("id", "event", "label", "active", "notifyEmployee", "notifyApprover", "notifyHrd", "subject", "body", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, true, $3, $4, $5, $6, $7, now())
           ON CONFLICT ("event") DO NOTHING`,
          [t.event, t.label, t.notifyEmployee, t.notifyApprover, t.notifyHrd, t.subject, t.body],
        );
        seeded += r.rowCount ?? 0;
      }
      console.log(`    EmailTemplate ${B7_TEMPLATES.map((t) => t.event).join(", ")}: seed ${seeded} baru`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
