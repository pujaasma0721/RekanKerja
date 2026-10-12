// Migrasi F7-RECRUITMENT (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F7 — Otomasi,
// Integrasi & E-Sign) ke tenant existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS ×5 (WebhookEndpoint, WebhookDelivery,
//      NotificationPref, RecruitmentSetting, EsignRequest) + index + FK
//      drop-add — selaras prisma/schema-tenant.prisma & tenant-ddl.sql.
//   2. Referensi: default RecruitmentSetting (otomasi ON + retensi 24 bln utk
//      F9) — insert-only per key.
//   3. Demo MII (insert-only bila belum ada endpoint): 1 webhook endpoint
//      contoh (non-aktif — ubah URL lalu aktifkan via UI Pengaturan) +
//      preferensi notifikasi digest utk HRD.
import "./lib/env";
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const DEFAULT_SCHEMAS = async () => {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
};

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "NotificationPref" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "digest" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "RecruitmentSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentSetting_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "EsignRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "letterId" TEXT,
    "offerId" TEXT,
    "purpose" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmailEnc" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "otpHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "typedName" TEXT,
    "pdfSha256" TEXT,
    "requestedById" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EsignRequest_pkey" PRIMARY KEY ("id")
  )`,
];

const AFTER_TABLE: string[] = [
  `CREATE INDEX IF NOT EXISTS "WebhookEndpoint_active_idx" ON "WebhookEndpoint"("active")`,
  `CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_nextRetryAt_idx" ON "WebhookDelivery"("status", "nextRetryAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPref_employeeId_key" ON "NotificationPref"("employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "RecruitmentSetting_key_key" ON "RecruitmentSetting"("key")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "EsignRequest_token_key" ON "EsignRequest"("token")`,
  `CREATE INDEX IF NOT EXISTS "EsignRequest_status_idx" ON "EsignRequest"("status")`,
  // FK drop-add idempoten
  `ALTER TABLE "WebhookDelivery" DROP CONSTRAINT IF EXISTS "WebhookDelivery_endpointId_fkey"`,
  `ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "NotificationPref" DROP CONSTRAINT IF EXISTS "NotificationPref_employeeId_fkey"`,
  `ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "EsignRequest" DROP CONSTRAINT IF EXISTS "EsignRequest_letterId_fkey"`,
  `ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "RecruitmentLetter"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "EsignRequest" DROP CONSTRAINT IF EXISTS "EsignRequest_offerId_fkey"`,
  `ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CandidateOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  `ALTER TABLE "EsignRequest" DROP CONSTRAINT IF EXISTS "EsignRequest_requestedById_fkey"`,
  `ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
];

// Default otomasi + retensi (dibaca service bila baris tidak ada — baris ini
// membuat eksplisit & bisa diubah dari UI Pengaturan).
const SETTING_DEFAULTS: [string, string][] = [
  ["auto.reply.public-application", "true"], // email konfirmasi lamaran publik diterima
  ["auto.reminder.selection", "true"], // reminder jadwal seleksi H-3/overdue
  ["auto.reminder.offer", "true"], // reminder offer akan kedaluwarsa
  ["auto.escalate.sla", "true"], // eskalasi tahap overdue 3/7/14 hari
  ["auto.ack.email.candidate", "true"], // email undangan kandidat saat step dijadwalkan
  ["retention.months.rejected", "24"], // F9: retensi pelamar ditolak
  ["retention.months.outdated", "24"], // F9: retensi keep-on-file lewat
  ["retention.anonymize", "true"], // F9: anonimisasi otomatis pasca retensi
];

async function seedDemoF7(schema: string): Promise<string> {
  const db = getTenantClient(schema);
  const existing = await db.webhookEndpoint.count();
  let made = "";

  if (existing === 0) {
    const secret = `whsec_demo_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    await db.webhookEndpoint.create({
      data: {
        url: "https://example.com/hooks/rekankerja-demo",
        eventsJson: JSON.stringify(["pr.approved", "offer.accepted", "candidate.hired"]),
        secretEnc: tenantCryptoForDb(db).encryptText(secret),
        active: false, // contoh non-aktif — aktifkan + ubah URL via UI Pengaturan
        note: "Contoh endpoint (non-aktif) — ganti URL tujuan lalu aktifkan.",
      },
    });
    made += "endpoint webhook contoh (non-aktif)";
  }

  // preferensi digest utk HRD (contoh notification hub)
  const hrdUser = await db.appUser.findFirst({ where: { email: "hrd@mii.co.id" }, select: { employeeId: true } });
  if (hrdUser?.employeeId) {
    const pref = await db.notificationPref.findUnique({ where: { employeeId: hrdUser.employeeId } });
    if (!pref) {
      await db.notificationPref.create({ data: { employeeId: hrdUser.employeeId, digest: true } });
      made += (made ? " + " : "") + "pref digest HRD";
    }
  }

  return made;
}

// ============ main ============

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas && schemas.length > 0 ? schemas : await DEFAULT_SCHEMAS();
  console.log(`[migrate-recruitment-f7] schema: ${list.join(", ")}`);
  for (const schemaName of list) {
    const c = new Client({
      connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    try {
      await c.connect();
      console.log(`  ${schemaName}:`);
      for (const ddl of [...CREATE_TABLES, ...AFTER_TABLE]) {
        await c.query(`SET search_path TO "${schemaName}"`);
        // DDL race-safe: pembuatan index paralel dua penulis dapat memicu
        // pg_class_relname_nsp_index (pg syscache flush) — beri satu coba lagi;
        // ADD CONSTRAINT paralel → 42710 "already exists" (idempoten).
        try {
          await c.query(ddl);
        } catch (e) {
          const pgCode = (e as { code?: string }).code;
          if (pgCode === "42710" || /already exists/.test(String(e))) continue; // idempoten
          if (pgCode === "23505" && /pg_class_relname_nsp_index/.test(String(e))) {
            await new Promise((r) => setTimeout(r, 300));
            await c.query(ddl);
          } else throw e;
        }
      }
      console.log(`    5 tabel F7 siap (WebhookEndpoint, WebhookDelivery, NotificationPref, RecruitmentSetting, EsignRequest)`);

      // referensi: default setting (insert-only). Race-safe: upsert P2002
      // (baris dibuat penulis paralel sejak tepas where) diperlakukan sudah-ada.
      const db = getTenantClient(schemaName);
      for (const [key, value] of SETTING_DEFAULTS) {
        await db.recruitmentSetting
          .upsert({ where: { key }, create: { key, value }, update: {} })
          .catch((e) => {
            if ((e as { code?: string }).code === "P2002") return null; // sudah terpasang oleh pemicu paralel
            throw e;
          });
      }

      if (schemaName.includes("mitra_industri")) {
        const demo = await seedDemoF7(schemaName);
        if (demo) console.log(`    demo: ${demo}`);
      }
    } catch (e) {
      // never-throw antar-tenant: kegagalan transient ("Engine is not yet
      // connected" dsb.) tidak boleh menghentikan tenant berikutnya —
      // parity tetap lanjut; gap-check di akhir menandai sisa yang impas.
      console.error(`  ✗ ${schemaName}: ${e instanceof Error ? (e.message || "").slice(0, 120) : String(e)}`);
    } finally {
      await c.end();
    }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, BUKAN saat diimpor.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
