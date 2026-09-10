// Migrasi PUBLIC API & WEBHOOK (T18-API) ke tenant existing:
//   1. DDL idempoten tenant: tabel ApiKey + Webhook + WebhookLog
//      (kunci API per tenant, endpoint webhook, riwayat pengiriman)
//   2. tanpa seed — kunci & webhook dibuat admin via menu Pengaturan →
//      API & Integrasi (atau REST /api/onevity/api-keys & /api/onevity/webhooks).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun scripts/migrate-api-webhook.ts (idempoten)
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const DDL = `
CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT 'employees',
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

CREATE TABLE IF NOT EXISTS "Webhook" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookLog" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WebhookLog_webhookId_createdAt_idx" ON "WebhookLog"("webhookId", "createdAt");
`;

// FK cascade (log ikut terhapus saat webhook dihapus) — idempoten manual:
// cek existence scoped ke tabel schema aktif (regclass ikut search_path).
const FK_CHECK = `SELECT 1 FROM pg_constraint WHERE conname = 'WebhookLog_webhookId_fkey' AND conrelid = '"WebhookLog"'::regclass`;
const FK_ADD = `ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE`;

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  const client = new Client({
    connectionString:
      process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
  });
  await client.connect();

  for (const schema of list) {
    // guard: schema tenant belum di-provision → skip (bukan error)
    const exists = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [schema],
    );
    if ((exists.rowCount ?? 0) === 0) {
      console.log(`[${schema}] schema belum ada — skip (jalankan provision tenant dulu)`);
      continue;
    }
    console.log(`[${schema}] migrasi tabel ApiKey / Webhook / WebhookLog…`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(DDL);
    // FK WebhookLog → Webhook (cascade delete) — tambah bila belum ada.
    // Baris log yatim (webhook terhapus pra-FK) dibersihkan dulu supaya
    // validasi ADD CONSTRAINT lolos.
    const fk = await client.query(FK_CHECK);
    if ((fk.rowCount ?? 0) === 0) {
      await client.query(`DELETE FROM "WebhookLog" WHERE "webhookId" NOT IN (SELECT "id" FROM "Webhook")`);
      await client.query(FK_ADD);
      console.log("  + FK WebhookLog→Webhook (ON DELETE CASCADE) ditambahkan");
    }
    console.log("  OK — ApiKey + Webhook + WebhookLog siap (tanpa seed — buat kunci via Pengaturan → API & Integrasi)");
  }

  await client.end();
  console.log("DONE — Public API & Webhook siap (T18-API)");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
