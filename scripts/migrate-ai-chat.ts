// Migrasi AI Assistant (Task 96) — 4 tabel per schema tenant:
//   1. AiProviderConfig  — konfigurasi provider AI per tenant (singleton).
//   2. AiKnowledgeDoc    — basis pengetahuan AI (RAG system prompt).
//   3. AiChatMessage     — riwayat chat AI per AppUser × mode.
//   4. DirectMessage     — pesan langsung antar pengguna (bawahan/atasan).
// Idempoten — CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
// Tenant BARU menerima tabel yang sama lewat tenant-ddl.sql (regenerated dari
// schema-tenant.prisma); tenant LAMA menerima via skrip ini (parity step).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-ai-chat.ts
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
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "AiProviderConfig" (
            "id" TEXT NOT NULL,
            "provider" TEXT NOT NULL DEFAULT 'builtin',
            "apiKey" TEXT,
            "baseUrl" TEXT,
            "model" TEXT,
            "enabled" BOOLEAN NOT NULL DEFAULT true,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "AiKnowledgeDoc" (
            "id" TEXT NOT NULL,
            "title" TEXT NOT NULL,
            "content" TEXT NOT NULL,
            "active" BOOLEAN NOT NULL DEFAULT true,
            "updatedBy" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "AiKnowledgeDoc_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "AiKnowledgeDoc_active_idx" ON "AiKnowledgeDoc"("active")`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "AiChatMessage" (
            "id" TEXT NOT NULL,
            "appUserId" TEXT NOT NULL,
            "mode" TEXT NOT NULL DEFAULT 'assistant',
            "role" TEXT NOT NULL,
            "content" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "AiChatMessage_appUserId_mode_createdAt_idx" ON "AiChatMessage"("appUserId","mode","createdAt")`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "DirectMessage" (
            "id" TEXT NOT NULL,
            "senderId" TEXT NOT NULL,
            "recipientId" TEXT NOT NULL,
            "body" TEXT NOT NULL,
            "readAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE INDEX IF NOT EXISTS "DirectMessage_senderId_recipientId_createdAt_idx" ON "DirectMessage"("senderId","recipientId","createdAt")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "DirectMessage_recipientId_readAt_idx" ON "DirectMessage"("recipientId","readAt")`);
      migrated += 1;
      console.log(`[${schema}] tabel AI (ProviderConfig/KnowledgeDoc/ChatMessage/DirectMessage) siap (Task 96)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`ai-chat: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-ai-chat")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
