// Migrasi B6-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B6) — SEMUA idempoten
// (pola migrate-performance-b4/b5):
//   1. ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS
//      "meetingUrl" TEXT — link meeting video-call tahap seleksi (kompromi
//      micro §1: video interview platform penuh di-defer).
//   2. Seed baris "WaTemplate" event rekrutmen (INSERT … ON CONFLICT DO
//      NOTHING — edit admin TIDAK pernah ditimpa; paritas antar-tenant
//      tanpa harus GET /api/rekankerja/wa-templates per schema). TANPA
//      recruitment.esign.otp — OTP tidak lewat WhatsApp (risiko §5).
// Tidak ada seed data domain. Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-b6-wa-meeting.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { WA_DEFAULT_TEMPLATES } from "@/rekankerja/shared/services/wa-defaults";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- B6 — kolom link meeting (idempoten; paritas dgn tenant-ddl.sql) ---
  `ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT`,
];

// Template WA rekrutmen saja (sisanya self-heal GET /api/rekankerja/wa-templates).
const REC_TEMPLATES = WA_DEFAULT_TEMPLATES.filter((t) => t.event.startsWith("recruitment."));

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-b6-wa-meeting] schema: ${list.join(", ")}`);
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
          // 42710 = duplicate object (kolom sudah ada) — abaikan
          if (!msg.includes("42710") && !msg.toLowerCase().includes("already exists")) throw e;
        }
      }
      console.log(`    kolom CandidateSelectionStep.meetingUrl siap`);
      let seeded = 0;
      for (const t of REC_TEMPLATES) {
        const r = await c.query(
          `INSERT INTO "WaTemplate" ("id", "event", "label", "active", "body", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now())
           ON CONFLICT ("event") DO NOTHING`,
          [t.event, t.label, t.active, t.body],
        );
        seeded += r.rowCount ?? 0;
      }
      const n = await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "WaTemplate" WHERE "event" LIKE 'recruitment.%'`);
      console.log(`    WaTemplate rekrutmen: ${n.rows[0]?.n ?? 0} baris (seed ${seeded} baru)`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
