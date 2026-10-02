// Migrasi Task 99 — policy engine v2 ringan modul Leave (audit Leave G10):
//   1. LeaveType.noticeDays INT NOT NULL DEFAULT 0 — minimal hari pemberitahuan
//      sebelum tanggal mulai cuti (notice period; 0 = bebas).
//   2. LeaveType.maxConsecutiveDays DOUBLE PRECISION NOT NULL DEFAULT 0 —
//      batas hari kerja BERTURUT lintas permintaan berdampingan (0 = bebas).
//   3. LeaveType.blackoutDates TEXT NOT NULL DEFAULT '[]' — JSON array
//      [{from,to,note?}] periode sibuk yang tidak boleh diambil cuti.
// Idempoten — ADD COLUMN IF NOT EXISTS. LeaveType adalah tabel inti (semua
// tenant memilikinya), penyebut gap = seluruh schema registry.
// Dapat diimpor IN-PROCESS oleh parity-runner (main() tanpa efek samping)
// ATAU CLI: bun run scripts/migrate-leave-advance.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
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
  let skipped = 0;
  for (const schema of list) {
    const c = new Client({
      connectionString:
        process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity",
    });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      // Tabel LeaveType hilang (instalasi pra-leave) → skip, bukan error.
      const hasLeave = await c.query(`SELECT to_regclass('"LeaveType"') IS NOT NULL AS ok`);
      if (!hasLeave.rows[0]?.ok) {
        skipped += 1;
        console.log(`[${schema}] tanpa tabel LeaveType — skip`);
        continue;
      }
      await c.query(`ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "noticeDays" INTEGER NOT NULL DEFAULT 0`);
      await c.query(`ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "maxConsecutiveDays" DOUBLE PRECISION NOT NULL DEFAULT 0`);
      await c.query(`ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "blackoutDates" TEXT NOT NULL DEFAULT '[]'`);
      migrated += 1;
      console.log(`[${schema}] leave-advance OK — noticeDays/maxConsecutiveDays/blackoutDates siap`);
    } catch (e) {
      console.error(`[${schema}] GAGAL:`, e instanceof Error ? e.message : e);
      throw e;
    } finally {
      await c.end();
    }
  }
  console.log(`leave-advance selesai: ${migrated} schema dimigrasi, ${skipped} dilewati`);
}

// CLI langsung: bun run scripts/migrate-leave-advance.ts
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
