// Migrasi T9-HOLIDAY ke tenant existing — idempoten:
//   DDL: tabel "HolidayDate" (id/date/name/kind) + unique (date,name) + index.
//   SEED: kalender hari libur Indonesia 2025 + 2026 (nasional + cuti bersama),
//        INSERT … ON CONFLICT ("date","name") DO NOTHING — aman dijalankan ulang.
// Jalankan: bun scripts/migrate-holidays.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

// ============ seed kalender Indonesia (2025 resmi SKB; 2026 proyeksi SKB) ============
// kind: National = hari libur nasional resmi; Joint = cuti bersama.
const HOLIDAYS: { date: string; name: string; kind: "National" | "Joint" }[] = [
  // ---- 2025 ----
  { date: "2025-01-01", name: "Tahun Baru Masehi 2025", kind: "National" },
  { date: "2025-01-27", name: "Isra Mikraj Nabi Muhammad SAW", kind: "National" },
  { date: "2025-01-28", name: "Cuti Bersama Tahun Baru Imlek 2597", kind: "Joint" },
  { date: "2025-01-29", name: "Tahun Baru Imlek 2597 Kongzili", kind: "National" },
  { date: "2025-03-28", name: "Hari Raya Nyepi (Tahun Baru Saka 1947)", kind: "National" },
  { date: "2025-03-31", name: "Hari Raya Idulfitri 1446 H", kind: "National" },
  { date: "2025-04-01", name: "Hari Raya Idulfitri 1446 H (hari kedua)", kind: "National" },
  { date: "2025-04-02", name: "Cuti Bersama Idulfitri 1446 H", kind: "Joint" },
  { date: "2025-04-03", name: "Cuti Bersama Idulfitri 1446 H", kind: "Joint" },
  { date: "2025-04-04", name: "Cuti Bersama Idulfitri 1446 H", kind: "Joint" },
  { date: "2025-04-18", name: "Wafat Isa Almasih", kind: "National" },
  { date: "2025-05-01", name: "Hari Buruh Nasional", kind: "National" },
  { date: "2025-05-12", name: "Hari Raya Waisak", kind: "National" },
  { date: "2025-05-29", name: "Kenaikan Isa Almasih", kind: "National" },
  { date: "2025-06-01", name: "Hari Lahir Pancasila", kind: "National" },
  { date: "2025-06-06", name: "Hari Raya Iduladha 1446 H", kind: "National" },
  { date: "2025-06-27", name: "Tahun Baru Islam 1447 H", kind: "National" },
  { date: "2025-08-17", name: "Hari Proklamasi Kemerdekaan RI ke-80", kind: "National" },
  { date: "2025-09-05", name: "Maulid Nabi Muhammad SAW", kind: "National" },
  { date: "2025-12-25", name: "Hari Raya Natal", kind: "National" },
  { date: "2025-12-26", name: "Cuti Bersama Natal", kind: "Joint" },
  // ---- 2026 ----
  { date: "2026-01-01", name: "Tahun Baru Masehi 2026", kind: "National" },
  { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad SAW", kind: "National" },
  { date: "2026-02-16", name: "Cuti Bersama Tahun Baru Imlek 2601", kind: "Joint" },
  { date: "2026-02-17", name: "Tahun Baru Imlek 2601 Kongzili", kind: "National" },
  { date: "2026-03-19", name: "Hari Raya Nyepi (Tahun Baru Saka 1948)", kind: "National" },
  { date: "2026-03-20", name: "Hari Raya Idulfitri 1447 H", kind: "National" },
  { date: "2026-03-21", name: "Hari Raya Idulfitri 1447 H (hari kedua)", kind: "National" },
  { date: "2026-03-23", name: "Cuti Bersama Idulfitri 1447 H", kind: "Joint" },
  { date: "2026-03-24", name: "Cuti Bersama Idulfitri 1447 H", kind: "Joint" },
  { date: "2026-03-25", name: "Cuti Bersama Idulfitri 1447 H", kind: "Joint" },
  { date: "2026-03-26", name: "Cuti Bersama Idulfitri 1447 H", kind: "Joint" },
  { date: "2026-04-03", name: "Wafat Isa Almasih", kind: "National" },
  { date: "2026-05-01", name: "Hari Buruh Nasional", kind: "National" },
  { date: "2026-05-14", name: "Kenaikan Isa Almasih", kind: "National" },
  { date: "2026-05-27", name: "Hari Raya Iduladha 1447 H", kind: "National" },
  { date: "2026-05-31", name: "Hari Raya Waisak", kind: "National" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "National" },
  { date: "2026-06-16", name: "Tahun Baru Islam 1448 H", kind: "National" },
  { date: "2026-08-17", name: "Hari Proklamasi Kemerdekaan RI ke-81", kind: "National" },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "National" },
  { date: "2026-12-24", name: "Cuti Bersama Natal", kind: "Joint" },
  { date: "2026-12-25", name: "Hari Raya Natal", kind: "National" },
];

async function applyDdl(schemaName: string): Promise<{ ddl: string[]; inserted: number; total: number }> {
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS "HolidayDate" (
          "id" TEXT NOT NULL,
          "date" DATE NOT NULL,
          "name" TEXT NOT NULL,
          "kind" TEXT NOT NULL DEFAULT 'National',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "HolidayDate_pkey" PRIMARY KEY ("id")
      );`);
    await c.query(`CREATE UNIQUE INDEX IF NOT EXISTS "HolidayDate_date_name_key" ON "HolidayDate"("date", "name");`);
    await c.query(`CREATE INDEX IF NOT EXISTS "HolidayDate_date_idx" ON "HolidayDate"("date");`);
    await c.query(`CREATE INDEX IF NOT EXISTS "HolidayDate_kind_idx" ON "HolidayDate"("kind");`);
    const ddl = ["tabel HolidayDate + unique(date,name) + index"];

    // seed idempoten — ON CONFLICT DO NOTHING per (date, name)
    let inserted = 0;
    for (const h of HOLIDAYS) {
      const res = await c.query(
        `INSERT INTO "HolidayDate" ("id", "date", "name", "kind")
         VALUES (gen_random_uuid()::text, $1, $2, $3)
         ON CONFLICT ("date", "name") DO NOTHING`,
        [h.date, h.name, h.kind],
      );
      inserted += res.rowCount ?? 0;
    }
    const total = (await c.query(`SELECT COUNT(*)::int AS n FROM "HolidayDate"`)).rows[0].n;
    return { ddl, inserted, total };
  } finally {
    await c.end();
  }
}

let grand = 0;
for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi T9-HOLIDAY…`);
  const r = await applyDdl(schema);
  grand += r.inserted;
  console.log(`  ${r.ddl.join(" · ")} · seed: ${r.inserted} baru dari ${HOLIDAYS.length} baris (total ${r.total})`);
}
console.log(`\nDONE — ${grand} baris libur baru (idempoten) di ${SCHEMAS.length} tenant`);
