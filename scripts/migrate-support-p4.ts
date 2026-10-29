// Migrasi Online Support P4 (FEAT-SUPPORT-P4) — usulan patch agen + approval:
//   · TABEL BARU SupportPatchProposal per schema tenant — usulan perbaikan
//     kode yang diajukan agen support (propose_patch) beserta unified diff
//     yang DIHITUNG SERVER, hash isi file saat usulan (deteksi konflik), dan
//     keputusan reviewer manusia (status/decidedBy/decisionNote). Usulan
//     TIDAK pernah menulis file — penerapan hanya terjadi saat developer
//     (op support:service/manage) menyetujui lewat UI tiket.
//   · KOLOM SupportAgentConfig.patchEnabled (BOOLEAN NOT NULL DEFAULT true)
//     — sakelar per tenant (baris ABSEN = AKTIF; guard sesungguhnya ada di
//     approval manusia + whitelist path baca-saja).
// Idempoten — CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
// Tenant BARU menerima lewat tenant-ddl.sql (regenerated dari
// schema-tenant.prisma); tenant LAMA menerima via skrip ini (parity step
// "support4"). Tanpa seed baris.
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-support-p4.ts
import "./lib/env";
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  let migrated = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "SupportPatchProposal" (
            "id" TEXT NOT NULL,
            "ticketId" TEXT NOT NULL,
            "filePath" TEXT NOT NULL,
            "description" TEXT NOT NULL,
            "diffText" TEXT NOT NULL,
            "replacementsJson" TEXT NOT NULL,
            "baseHash" TEXT NOT NULL,
            "baseLineCount" INTEGER NOT NULL DEFAULT 0,
            "status" TEXT NOT NULL DEFAULT 'MENUNGGU',
            "decidedById" TEXT,
            "decidedByName" TEXT,
            "decidedAt" TIMESTAMP(3),
            "decisionNote" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "SupportPatchProposal_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`
        CREATE INDEX IF NOT EXISTS "SupportPatchProposal_ticketId_idx" ON "SupportPatchProposal"("ticketId")`);
      await c.query(`
        CREATE INDEX IF NOT EXISTS "SupportPatchProposal_status_idx" ON "SupportPatchProposal"("status")`);
      // FK ke tiket (ON DELETE CASCADE — usulan ikut terhapus bersama tiket).
      // Nama constraint dicek dulu supaya idempoten lintas rerun.
      const fk = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_constraint WHERE conname = 'SupportPatchProposal_ticketId_fkey'`,
      );
      if ((fk.rows[0]?.n ?? 0) === 0) {
        await c.query(`
          ALTER TABLE "SupportPatchProposal"
            ADD CONSTRAINT "SupportPatchProposal_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
      }
      await c.query(`
        ALTER TABLE "SupportAgentConfig"
          ADD COLUMN IF NOT EXISTS "patchEnabled" BOOLEAN NOT NULL DEFAULT true`);
      migrated += 1;
      console.log(`[${schema}] tabel SupportPatchProposal + patchEnabled siap (FEAT-SUPPORT-P4)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`support4: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-support-p4")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
