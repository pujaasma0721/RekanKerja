// Migrasi TASK 32 — ATURAN DIFERENSIASI BESARAN KOMPONEN UPAH (idempoten):
//   1. CREATE TABLE IF NOT EXISTS "WageComponentRule" (+ index + FK ke
//      WageComponent ON DELETE CASCADE) — selaras prisma/schema-tenant.prisma.
//   2. Seed demo rule MII (insert-only bila komponen belum punya rule dgn
//      nama sama) — memperagakan SEMUA jenis parameter:
//        · TMAKAN  — office OFF-HO (750rb) / OFF-PLG (+100rb) / OFF-SBY (700rb)
//        · TTRANS  — lokasi produksi (500rb — shuttle tersedia) / masa kerja
//                    ≥5 th (+100rb loyalitas)
//        · TKEHADIRAN — hanya Permanent (200rb)
//        · TKEL    — belum menikah → 0 (tunjangan keluarga hanya yang menikah)
//        · TJAB    — manajemen senior PL6+ → ×2
//        · BEN_GEN — benefit keagamaan berbeda per agama (demo parameter
//                    personal religion)
// Dapat diimpor IN-PROCESS oleh src/onevity/shared/lib/parity-runner.ts
// ATAU dijalankan CLI: bun run scripts/migrate-component-rules.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const CREATE_DDL = [
  `CREATE TABLE IF NOT EXISTS "WageComponentRule" (
    "id" TEXT NOT NULL,
    "wageComponentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actionType" TEXT NOT NULL DEFAULT 'SetAmount',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WageComponentRule_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "WageComponentRule_wageComponentId_idx" ON "WageComponentRule"("wageComponentId")`,
  `CREATE INDEX IF NOT EXISTS "WageComponentRule_priority_idx" ON "WageComponentRule"("priority")`,
];

const FK_NAME = "WageComponentRule_wageComponentId_fkey";

/** [compCode, ruleName, priority, conditionsJSON, actionType, amount, notes] */
const RULE_SEED: [string, string, number, string, string, number, string][] = [
  ["TMAKAN", "Tunjangan Makan — Kantor Pusat Jakarta", 10,
    JSON.stringify([{ param: "office", op: "in", values: ["OFF-HO"] }]),
    "SetAmount", 750_000, "Standar biaya makan wilayah Jakarta (BPS: rata-rata harga makan siang lebih tinggi)."],
  ["TMAKAN", "Tunjangan Makan — Pabrik Pulogadung (uang makan + jajan shift)", 20,
    JSON.stringify([{ param: "office", op: "in", values: ["OFF-PLG"] }]),
    "AddAmount", 100_000, "Tambahan uang jajan shift pagi/sore pekerja pabrik."],
  ["TMAKAN", "Tunjangan Makan — Cabang Surabaya", 30,
    JSON.stringify([{ param: "office", op: "in", values: ["OFF-SBY"] }]),
    "SetAmount", 700_000, "Standar biaya makan wilayah Surabaya."],
  ["TTRANS", "Tunjangan Transport — Lokasi Produksi (shuttle tersedia)", 10,
    JSON.stringify([{ param: "workLocation", op: "in", values: ["LOC-PRD-A", "LOC-PRD-B", "LOC-WH", "LOC-QC"] }]),
    "SetAmount", 500_000, "Karyawan lokasi produksi memakai shuttle perusahaan — transport diberikan sebagai selisih top-up."],
  ["TTRANS", "Tunjangan Transport — Loyalitas masa kerja ≥ 5 tahun", 20,
    JSON.stringify([{ param: "tenureYears", op: "gte", values: ["5"] }]),
    "AddAmount", 100_000, " Tambahan loyalitas bagi karyawan dengan masa kerja 5 tahun+."],
  ["TKEHADIRAN", "Tunjangan Kehadiran — hanya karyawan Permanent", 10,
    JSON.stringify([{ param: "employmentStatus", op: "in", values: ["Permanent"] }]),
    "SetAmount", 200_000, "Tunjangan kehadiran penuh diberikan setelah status tetap (probation/kontrak menerima setelah konversi)."],
  ["TKEL", "Tunjangan Keluarga — hanya status Menikah", 10,
    JSON.stringify([{ param: "maritalStatus", op: "not_in", values: ["Menikah"] }]),
    "SetAmount", 0, "Tunjangan keluarga hanya untuk karyawan berstatus Menikah (kondisi not_in — nilai lain tidak menerima)."],
  ["TJAB", "Tunjangan Jabatan — manajemen senior (SM ke atas)", 10,
    JSON.stringify([{ param: "positionLevel", op: "in", values: ["PL6", "PL7", "PL8"] }]),
    "Multiply", 2, "Senior Manager/Director/VP: tunjangan jabatan digandakan (rumus dasar BASE_SALARY*0.1 × 2)."],
  ["BEN_GEN", "Benefit Karyawan — hari raya keagamaan Islam", 10,
    JSON.stringify([{ param: "religion", op: "in", values: ["Islam"] }]),
    "SetAmount", 300_000, "Alokasi perayaan hari raya (Idul Fitri) — benefit non-tunai berbasis kalender keagamaan."],
  ["BEN_GEN", "Benefit Karyawan — hari raya keagamaan Kristen/Katolik", 20,
    JSON.stringify([{ param: "religion", op: "in", values: ["Kristen Protestan", "Katolik"] }]),
    "SetAmount", 250_000, "Alokasi perayaan Natal — benefit non-tunai berbasis kalender keagamaan."],
];

/** Seed demo HANYA di MII — kode office/lokasi/level pada rule merujuk master MII;
 *  di tenant lain tabel tetap dibuat (paritas) tanpa rule contoh. */
const SEED_SCHEMAS = new Set(["tenant_pt_mitra_industri_internasional"]);

export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      console.log(`\n[${schema}] migrasi task-32 (tabel WageComponentRule + seed demo rule)…`);

      // ---- 1. DDL idempoten ----
      for (const ddl of CREATE_DDL) await c.query(ddl);
      const fk = await c.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`,
        [FK_NAME, schema],
      );
      if (fk.rowCount === 0) {
        await c.query(
          `ALTER TABLE "WageComponentRule" ADD CONSTRAINT "${FK_NAME}" FOREIGN KEY ("wageComponentId") REFERENCES "WageComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
        );
        console.log(`[${schema}] FK ${FK_NAME} dibuat`);
      }

      // ---- 2. seed demo (insert-only per nama rule; hanya MII) ----
      let inserted = 0;
      if (SEED_SCHEMAS.has(schema)) {
        for (const [compCode, name, priority, conditions, actionType, amount, notes] of RULE_SEED) {
          const comp = await c.query(`SELECT id FROM "WageComponent" WHERE code = $1`, [compCode]);
          if (comp.rowCount === 0) { console.log(`[${schema}] skip ${compCode}: komponen tidak ada`); continue; }
          const exists = await c.query(
            `SELECT 1 FROM "WageComponentRule" WHERE "wageComponentId" = $1 AND name = $2`,
            [comp.rows[0].id, name],
          );
          if ((exists.rowCount ?? 0) > 0) continue;
          await c.query(
            `INSERT INTO "WageComponentRule" ("id", "wageComponentId", "name", "priority", "conditions", "actionType", "amount", "notes", "active", "createdAt")
             VALUES (concat('wcr_', replace(gen_random_uuid()::text, '-', '')), $1, $2, $3, $4, $5, $6, $7, true, CURRENT_TIMESTAMP)`,
            [comp.rows[0].id, name, priority, conditions, actionType, amount, notes.trim()],
          );
          inserted++;
        }
      }
      console.log(`[${schema}] seed rule: ${inserted} baru dimasukkan (sisanya sudah ada)`);
    } finally {
      await c.end();
    }
  }
  console.log("\n[migrate-component-rules] selesai — semua tenant paritas task-32.");
}

// CLI: bun run scripts/migrate-component-rules.ts
if (process.argv[1] && process.argv[1].endsWith("migrate-component-rules.ts")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
