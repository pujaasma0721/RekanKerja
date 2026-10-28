// Migrasi Online Support (FEAT-SUPPORT-P1) — 2 tabel per schema tenant:
//   1. SupportTicket  — tiket percakapan support (SP-<tahun>-NNN).
//   2. SupportMessage — pesan chat dalam tiket (USER | AI | SYSTEM).
// Lampiran memakai tabel generik Attachment (entityType "SupportMessage") —
// sudah ada sejak T16-ATTACH, tidak perlu DDL baru.
// Idempoten — CREATE TABLE/INDEX IF NOT EXISTS. Tenant BARU menerima tabel
// yang sama lewat tenant-ddl.sql (regenerated dari schema-tenant.prisma);
// tenant LAMA menerima via skrip ini (parity step). Tanpa seed demo — kanal
// mulai kosong (percakapan nyata dari pengguna).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-support.ts
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
        CREATE TABLE IF NOT EXISTS "SupportTicket" (
            "id" TEXT NOT NULL,
            "ticketNo" TEXT NOT NULL,
            "subject" TEXT NOT NULL,
            "category" TEXT NOT NULL DEFAULT 'LAINNYA',
            "priority" TEXT NOT NULL DEFAULT 'SEDANG',
            "status" TEXT NOT NULL DEFAULT 'AKTIF',
            "createdById" TEXT,
            "createdByName" TEXT,
            "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "closedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_ticketNo_key" ON "SupportTicket"("ticketNo")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "SupportTicket_createdById_idx" ON "SupportTicket"("createdById")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "SupportTicket_lastMessageAt_idx" ON "SupportTicket"("lastMessageAt")`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "SupportMessage" (
            "id" TEXT NOT NULL,
            "ticketId" TEXT NOT NULL,
            "senderRole" TEXT NOT NULL,
            "senderName" TEXT,
            "body" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId","createdAt")`);
      // FK relasi (onDelete: Cascade — hapus tiket membersihkan pesannya).
      await c.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportMessage_ticketId_fkey') THEN
            ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey"
              FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE;
          END IF;
        END $$;
      `);
      migrated += 1;
      console.log(`[${schema}] tabel Online Support (SupportTicket/SupportMessage) siap (FEAT-SUPPORT-P1)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`support: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-support")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
