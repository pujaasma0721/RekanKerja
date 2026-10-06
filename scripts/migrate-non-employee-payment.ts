// Migrasi Pembayaran Bukan Pegawai (PMK 168/2023) — 2 tabel per schema tenant:
//   1. NonEmployeePartner — master mitra Bukan Pegawai (tenaga ahli/pemberi jasa).
//   2. NonEmployeePayment — pembayaran honor/fee + PPh21 final (DPP 50% × Pasal 17).
// Idempoten — CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
// Tenant BARU menerima tabel yang sama lewat tenant-ddl.sql (regenerated dari
// schema-tenant.prisma); tenant LAMA menerima via skrip ini (parity step).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   npx tsx scripts/migrate-non-employee-payment.ts
// (pola sama dengan scripts/migrate-ai-chat.ts)
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
        CREATE TABLE IF NOT EXISTS "NonEmployeePartner" (
            "id" TEXT NOT NULL,
            "code" TEXT NOT NULL,
            "name" TEXT NOT NULL,
            "idType" TEXT NOT NULL DEFAULT 'npwp',
            "idNumber" TEXT,
            "address" TEXT,
            "serviceKind" TEXT NOT NULL DEFAULT 'Pekerjaan Bebas',
            "isCatering" BOOLEAN NOT NULL DEFAULT false,
            "bankName" TEXT,
            "bankAccount" TEXT,
            "notes" TEXT,
            "active" BOOLEAN NOT NULL DEFAULT true,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "NonEmployeePartner_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NonEmployeePartner_code_key" ON "NonEmployeePartner"("code")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "NonEmployeePartner_active_name_idx" ON "NonEmployeePartner"("active", "name")`);
      await c.query(`
        CREATE TABLE IF NOT EXISTS "NonEmployeePayment" (
            "id" TEXT NOT NULL,
            "docNo" TEXT NOT NULL,
            "partnerId" TEXT NOT NULL,
            "description" TEXT NOT NULL,
            "grossAmount" TEXT NOT NULL,
            "excludedNotes" TEXT,
            "excludedAmount" TEXT,
            "dpp" TEXT NOT NULL,
            "pph21" TEXT NOT NULL,
            "netAmount" TEXT NOT NULL,
            "paymentDate" TIMESTAMP(3) NOT NULL,
            "taxYear" INTEGER NOT NULL,
            "taxMonth" INTEGER NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'Draft',
            "paidAt" TIMESTAMP(3),
            "createdBy" TEXT,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL,
            CONSTRAINT "NonEmployeePayment_pkey" PRIMARY KEY ("id")
        )`);
      await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NonEmployeePayment_docNo_key" ON "NonEmployeePayment"("docNo")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "NonEmployeePayment_partnerId_paymentDate_idx" ON "NonEmployeePayment"("partnerId", "paymentDate")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "NonEmployeePayment_taxYear_taxMonth_idx" ON "NonEmployeePayment"("taxYear", "taxMonth")`);
      await c.query(`CREATE INDEX IF NOT EXISTS "NonEmployeePayment_status_idx" ON "NonEmployeePayment"("status")`);
      // T107 (audit PMK 168/2023) — kolom eksklusi numerik Pasal 12(4)(b):
      // komponen (gaji tenaga kerja mitra / barang-material / jasa pihak ketiga)
      // dikurangkan dari bruto SEBELUM ×50% (contoh resmi Lampiran V.4).
      await c.query(`ALTER TABLE "NonEmployeePayment" ADD COLUMN IF NOT EXISTS "excludedAmount" TEXT`);
      migrated += 1;
      console.log(`[${schema}] tabel Pembayaran Bukan Pegawai siap (PMK 168/2023)`);
    } finally {
      await c.end().catch(() => {});
    }
  }
  console.log(`non-employee-payment: ${migrated} schema diproses`);
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.replace(/\\/g, "/").includes("migrate-non-employee-payment")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
