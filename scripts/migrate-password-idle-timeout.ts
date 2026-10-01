// Task 64k — PasswordPolicy.idleTimeoutMinutes: batas idle sesi per tenant
// ===========================================================================
// 0 = nonaktif (default — perilaku lama); N>0 = sesi kedaluwarsa bila TIDAK ada
// interaksi keyboard/mouse/klik selama N menit di sisi client (server hanya
// menyimpan konfigurasi). Fresh tenant sudah punya kolom via tenant-ddl.sql;
// tenant existing ditambahkan di sini (idempoten: cek information_schema).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU dijalankan CLI.
import "./lib/env";
import { Client } from "pg";
import { tenantSchemas } from "../src/rekankerja/shared/lib/parity-runner";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas?.length ? schemas : await tenantSchemas();
  if (list.length === 0) {
    console.log("[idle-timeout] belum ada tenant — lewati");
    return;
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    for (const schema of list) {
      // Per-schem search_path dipulihkan tiap iterasi — SET tanpa LOCAL menempel
      // pada sesi dan bisa bocor ke iterasi berikutnya bila dilewati try/catch.
      try {
        await c.query(`SET search_path TO "${schema}"`);
        const hasTable = await c.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema = $1 AND table_name = 'PasswordPolicy'`,
          [schema],
        );
        if (hasTable.rowCount === 0) {
          console.log(`[${schema}] tabel PasswordPolicy belum ada — lewati (bukan tenant aktif)`);
          continue;
        }
        const exists = await c.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'PasswordPolicy' AND column_name = 'idleTimeoutMinutes'`,
          [schema],
        );
        if (exists.rowCount === 0) {
          await c.query(`ALTER TABLE "PasswordPolicy" ADD COLUMN "idleTimeoutMinutes" INTEGER NOT NULL DEFAULT 0`);
          console.log(`[${schema}] kolom PasswordPolicy.idleTimeoutMinutes ditambahkan`);
        } else {
          console.log(`[${schema}] kolom PasswordPolicy.idleTimeoutMinutes sudah ada (idempoten)`);
        }
      } catch (e) {
        // Satu tenant bermasalah tidak boleh menghentikan tenant lain (perilaku
        // parity: per-step never-throw; di dalam step, per-schema never-throw).
        console.error(`[${schema}] GAGAL: ${e instanceof Error ? e.message : String(e)} — lanjut`);
      }
    }
  } finally {
    await c.end();
  }
}

// CLI mandiri: npx tsx scripts/migrate-password-idle-timeout.ts
if (process.argv[1] && process.argv[1].includes("migrate-password-idle-timeout")) {
  main().then(
    () => process.exit(0),
    (e) => { console.error(e); process.exit(1); },
  );
}

export {};
