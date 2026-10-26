// Migrasi B8-BACKLOG (DEVELOPMENT-PLAN-BACKLOG.md §4 B8) — SEMUA idempoten
// (pola migrate-recruitment-b7-status-link):
//   1. ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralNote" TEXT
//      — konteks/pesan perujuk (kenapa merujuk; diisi HR lewat form pelamar).
//   2. ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralRewardNote"
//      TEXT — catatan insentif referral MANUAL HR — DI LUAR payroll (§5 risiko
//      "Insentif referral disalahpahami otomatis": CATATAN saja, tidak pernah
//      masuk perhitungan gaji; mutasi ter-audit ActivityLog di referral-service).
// Tanpa tabel/seed data lain (tanpa model baru — Applicant.referralEmployeeId
// sudah ada sejak F2). Dapat diimpor IN-PROCESS oleh parity-runner
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-recruitment-b8-referral.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const DDL: string[] = [
  // --- B8 — referral tracker (idempoten; paritas tenant-ddl.sql) ---
  `ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralNote" TEXT`,
  `ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "referralRewardNote" TEXT`,
];

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-b8-referral] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
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
      for (const col of ["referralNote", "referralRewardNote"] as const) {
        const r = await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'Applicant' AND column_name = $2`,
          [schemaName, col],
        );
        console.log(`    kolom Applicant.${col}: ${r.rows[0]?.n ? "ada" : "HILANG"}`);
      }
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
