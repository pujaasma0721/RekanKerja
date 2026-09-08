// Migrasi WAVE 27/28 (prioritas user: P0 semua + P1 subset + P2 subset, dari
// audit GAP-ANALYSIS-DEEP.md) ke tenant existing — SEMUA idempoten:
//   1. CREATE TABLE IF NOT EXISTS × 10: MachineImportBatch, Announcement,
//      AnnouncementRead, Asset, AssetAssignment, ShiftSwapRequest, WaConfig,
//      WaTemplate, WaLog, CustomReport (+ index + FK selaras tenant-ddl.sql).
//   2. ADD COLUMN IF NOT EXISTS WorkLocation.latitude/longitude/radiusMeters
//      + AttendanceRule.geofenceMode (default 'Off' — tidak mengubah perilaku).
//   3. Seed demo (insert-only bila belum ada):
//      · Semua tenant: 3 pengumuman (1 pinned, 1 draft, 1 kedaluwarsa besok)
//        + beberapa AnnouncementRead.
//      · MII: 8 aset (laptop/monitor/seragam/APAR/helm) + 5 penugasan aktif
//        + 1 riwayat pengembalian; koordinat kantor OFF-HO (Jakarta Timur)
//        untuk uji geofencing.
//      · Cahaya & Sentra: 4 aset ringkas + 2 penugasan.
// Dapat diimpor IN-PROCESS oleh src/onevity/shared/lib/parity-runner.ts
// (main() tanpa efek samping modul) ATAU dijalankan CLI:
//   bun run scripts/migrate-wave27.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const NEW_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "WorkLocation", column: "latitude", ddl: "DOUBLE PRECISION" },
  { table: "WorkLocation", column: "longitude", ddl: "DOUBLE PRECISION" },
  { table: "WorkLocation", column: "radiusMeters", ddl: "INTEGER" },
  { table: "AttendanceRule", column: "geofenceMode", ddl: "TEXT NOT NULL DEFAULT 'Off'" },
];

const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS "MachineImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "unknownEmployees" TEXT,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MachineImportBatch_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Announcement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Umum',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Lainnya',
    "serialNumber" TEXT,
    "notes" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "AssetAssignment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnCondition" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssetAssignment_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ShiftSwapRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "swapDate" TIMESTAMP(3) NOT NULL,
    "requesterScheduleId" TEXT,
    "targetScheduleId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedAssignment1" TEXT,
    "appliedAssignment2" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShiftSwapRequest_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "WaConfig" (
    "id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'Fonnte',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL DEFAULT '',
    "sender" TEXT NOT NULL DEFAULT '',
    "lastTestOk" BOOLEAN,
    "lastTestAt" TIMESTAMP(3),
    "lastTestMessage" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaConfig_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "WaTemplate" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "WaLog" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaLog_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "CustomReport" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entity" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "filtersJson" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomReport_pkey" PRIMARY KEY ("id")
  )`,
];

const CREATE_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS "MachineImportBatch_importedAt_idx" ON "MachineImportBatch"("importedAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Announcement_code_key" ON "Announcement"("code")`,
  `CREATE INDEX IF NOT EXISTS "Announcement_publishedAt_idx" ON "Announcement"("publishedAt")`,
  `CREATE INDEX IF NOT EXISTS "AnnouncementRead_employeeId_idx" ON "AnnouncementRead"("employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementRead_announcementId_employeeId_key" ON "AnnouncementRead"("announcementId", "employeeId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Asset_code_key" ON "Asset"("code")`,
  `CREATE INDEX IF NOT EXISTS "Asset_category_idx" ON "Asset"("category")`,
  `CREATE INDEX IF NOT EXISTS "Asset_status_idx" ON "Asset"("status")`,
  `CREATE INDEX IF NOT EXISTS "AssetAssignment_employeeId_idx" ON "AssetAssignment"("employeeId")`,
  `CREATE INDEX IF NOT EXISTS "AssetAssignment_assetId_idx" ON "AssetAssignment"("assetId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ShiftSwapRequest_code_key" ON "ShiftSwapRequest"("code")`,
  `CREATE INDEX IF NOT EXISTS "ShiftSwapRequest_status_idx" ON "ShiftSwapRequest"("status")`,
  `CREATE INDEX IF NOT EXISTS "ShiftSwapRequest_requesterId_idx" ON "ShiftSwapRequest"("requesterId")`,
  `CREATE INDEX IF NOT EXISTS "ShiftSwapRequest_targetId_idx" ON "ShiftSwapRequest"("targetId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WaTemplate_event_key" ON "WaTemplate"("event")`,
  `CREATE INDEX IF NOT EXISTS "WaLog_createdAt_idx" ON "WaLog"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "WaLog_event_idx" ON "WaLog"("event")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CustomReport_code_key" ON "CustomReport"("code")`,
  `CREATE INDEX IF NOT EXISTS "CustomReport_entity_idx" ON "CustomReport"("entity")`,
];

const CREATE_FKS: { name: string; ddl: string }[] = [
  { name: "AnnouncementRead_announcementId_fkey", ddl: `ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE` },
  { name: "AnnouncementRead_employeeId_fkey", ddl: `ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE` },
  { name: "AssetAssignment_assetId_fkey", ddl: `ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE` },
  { name: "AssetAssignment_employeeId_fkey", ddl: `ALTER TABLE "AssetAssignment" ADD CONSTRAINT "AssetAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE` },
  { name: "ShiftSwapRequest_requesterId_fkey", ddl: `ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE` },
  { name: "ShiftSwapRequest_targetId_fkey", ddl: `ALTER TABLE "ShiftSwapRequest" ADD CONSTRAINT "ShiftSwapRequest_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE` },
];

/** Pengumuman demo per tenant — [code, judul, isi, kategori, pinned, offsetHari]. */
function announcementSeed(): [string, string, string, string, boolean, number][] {
  return [
    [
      "PGM-0001",
      "Townhall Q1 2026 & Rencana Produksi Kuartal Ini",
      "Townhall Q1 dijadwalkan Jumat pekan ini pukul 09.00 di aula kantor pusat. Manajemen akan memaparkan hasil kuartal sebelumnya dan rencana produksi kuartal berjalan. Kehadiran wajib bagi seluruh karyawan non-shift; karyawan shift mengikuti sesi ulangan yang sama hari sabtunya.",
      "Event",
      true,
      -3,
    ],
    [
      "PGM-0002",
      "Cut-off Pengajuan Lembur & Klaim — Tanggal 25 Setiap Bulan",
      "Mulai bulan berjalan, seluruh pengajuan lembur, klaim travel, dan klaim medis WAJIB diajukan paling lambat tanggal 25 agar masuk ke proses payroll bulan yang sama. Pengajuan setelah tanggal 25 akan otomatis diproses pada periode berikutnya. Mohon perhatian seluruh karyawan.",
      "Kebijakan",
      false,
      -1,
    ],
    [
      "PGM-0003",
      "[DRAFT INTERNAL] Skema Seragam Baru Tahun 2026",
      "Draft kebijakan seragam baru — belum dipublikasikan, menunggu persetujuan direktur operasional.",
      "Umum",
      false,
      0,
    ],
  ];
}

/** Aset demo per schema: [code, nama, kategori, serial, nilai, lokasi, status]. */
const ASSET_SEED: Record<string, [string, string, string, string, number, string, string][]> = {
  tenant_pt_mitra_industri_internasional: [
    ["AST-0001", "Laptop Lenovo ThinkPad E14", "Elektronik", "TP-2024-E14-0192", 12_500_000, "Gudang IT OFF-HO", "Available"],
    ["AST-0002", "Laptop Dell Latitude 5440", "Elektronik", "DL-2025-5440-0087", 13_800_000, "Gudang IT OFF-HO", "Assigned"],
    ["AST-0003", "Monitor LG 24\" IPS", "Elektronik", "LG-24IPS-1140", 2_150_000, "Gudang IT OFF-HO", "Assigned"],
    ["AST-0004", "Seragam Kerja Operator (set)", "Seragam", "", 450_000, "Gudang GA OFF-PLG", "Assigned"],
    ["AST-0005", "Helm Safety ProSafe + Earplug", "Alat Kerja", "", 320_000, "Gudang K3 OFF-PLG", "Assigned"],
    ["AST-0006", "APAR 6kg Powder (unit)", "Alat Kerja", "APAR-6K-2023-05", 850_000, "Rak K3 OFF-PLG", "Available"],
    ["AST-0007", "Forklift Mitsubishi 2.5 Ton", "Kendaraan", "FL-MIT-2019-03", 285_000_000, "Gudang Produksi OFF-PLG", "Maintenance"],
    ["AST-0008", "Meja Kerja Modular (operator)", "Furniture", "", 1_400_000, "Lantai Produksi OFF-PLG", "Available"],
  ],
  tenant_cahaya_digital_nusantara: [
    ["AST-0001", "MacBook Air M2 13\"", "Elektronik", "MB-M2-2024-0033", 18_900_000, "Loker IT", "Assigned"],
    ["AST-0002", "Kursi Ergonomis ErgoPro", "Furniture", "", 3_600_000, "Gudang Kantor", "Available"],
    ["AST-0003", "Layar Presentasi 65\"", "Elektronik", "TV-65-2023-001", 16_500_000, "Ruang Meeting", "Available"],
    ["AST-0004", "Paket Seragam Onboarding", "Seragam", "", 600_000, "Gudang GA", "Assigned"],
  ],
  tenant_sentra_logistik_prima: [
    ["AST-0001", "Handheld Scanner Zebra TC21", "Elektronik", "ZB-TC21-0051", 7_200_000, "Gudang Utama", "Assigned"],
    ["AST-0002", "GMC Juli Sumbu Roda Belakang — unit", "Kendaraan", "GMC-JSU-2022-08", 210_000_000, "Pool Armada", "Maintenance"],
    ["AST-0003", "Rompi Safety Logistik (unit)", "Alat Kerja", "", 275_000, "Gudang Utama", "Available"],
    ["AST-0004", "Pallet Kayu Standar", "Furniture", "", 190_000, "Gudang Utama", "Available"],
  ],
};

/** Penugasan aktif: employeeNo → assetCode (kondisi null = belum kembali). */
const ASSIGNMENT_SEED: Record<string, [string, string, string | null, string | null][]> = {
  tenant_pt_mitra_industri_internasional: [
    ["MII00002", "AST-0002", "Laptop kerja harian", null],
    ["MII00004", "AST-0003", "Monitor kerja", null],
    ["MII00009", "AST-0004", "Seragam operator 2 set", null],
    ["MII00013", "AST-0005", "APD area produksi", null],
    // riwayat pengembalian (returned, kondisi Good)
    ["MII00006", "AST-0001", "Peminjaman sementara proyek migrasi", "Good"],
  ],
  tenant_cahaya_digital_nusantara: [
    ["CDN00001", "AST-0001", "Laptop desain utama", null],
    ["CDN00004", "AST-0004", "Seragam onboarding", null],
  ],
  tenant_sentra_logistik_prima: [
    ["SLP00003", "AST-0001", "Scanner gudang shift 1", null],
  ],
};

// ============ main ============

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner).
 *  Tanpa parameter → 3 tenant sandbox default. */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schema}"`);
    console.log(`\n[${schema}] migrasi wave 27/28 (10 tabel + kolom geofence + seed demo)…`);

    // ---- 1. CREATE TABLE idempoten ----
    let tables = 0;
    for (const ddl of CREATE_TABLES) {
      await c.query(ddl);
      tables++;
    }
    for (const ddl of CREATE_INDEXES) await c.query(ddl);
    // FK — idempoten via cek pg_constraint (nama constraint eksplisit)
    for (const fk of CREATE_FKS) {
      await c.query(
        `DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${fk.name}') THEN
            ${fk.ddl.replace(/;/g, "")};
          END IF;
        END $$;`);
    }
    console.log(`  tabel dibuat/diamankan: ${tables}, index: ${CREATE_INDEXES.length}, FK: ${CREATE_FKS.length}`);

    // ---- 2. ADD COLUMN idempoten ----
    let columns = 0;
    for (const { table, column, ddl } of NEW_COLUMNS) {
      const has = await c.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
        [schema, table, column],
      );
      if (has.rowCount === 0) {
        await c.query(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`);
        columns++;
      }
    }
    console.log(`  kolom baru: ${columns} (sisanya sudah ada)`);

    // ---- 3a. koordinat geofence MII (kantor pusat Jakarta Timur + cabang SBY) ----
    if (schema === "tenant_pt_mitra_industri_internasional") {
      const geofences: [string, number, number, number][] = [
        ["LOC-HO", -6.2563, 106.8654, 250], // Lantai 5 — Kantor Pusat (Jakarta Timur)
        ["LOC-SBY", -7.2906, 112.7386, 300], // Kantor Cabang Surabaya
      ];
      for (const [code, lat, lng, radius] of geofences) {
        const wl = await c.query(`SELECT id FROM "WorkLocation" WHERE code = $1`, [code]);
        if (wl.rowCount && wl.rowCount > 0) {
          await c.query(
            `UPDATE "WorkLocation" SET latitude = $1, longitude = $2, "radiusMeters" = $3 WHERE id = $4 AND latitude IS NULL`,
            [lat, lng, radius, wl.rows[0].id],
          );
        } else {
          console.log(`  [!] WorkLocation ${code} tidak ditemukan — koordinat dilewati`);
        }
      }
      console.log(`  WorkLocation LOC-HO/LOC-SBY: koordinat + radius (bila belum diisi)`);
    }

    // ---- 3b. seed Announcement + AnnouncementRead (insert-only) ----
    const activeEmployees = await c.query(
      `SELECT id, "employeeNo" FROM "Employee" WHERE status = 'Active' ORDER BY "employeeNo" LIMIT 12`,
    );
    const empIds: string[] = activeEmployees.rows.map((r: { id: string }) => r.id);
    let anns = 0, reads = 0;
    for (const [code, title, body, category, pinned, offsetDays] of announcementSeed()) {
      const exists = await c.query(`SELECT 1 FROM "Announcement" WHERE code = $1`, [code]);
      if (exists.rowCount) continue;
      const published = offsetDays !== 0; // 0 = draft internal
      const pub = published ? `now() - interval '${Math.abs(offsetDays)} days'` : "NULL";
      const ins = await c.query(
        `INSERT INTO "Announcement" (id, code, title, body, category, pinned, "publishedAt", "expiresAt", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, ${pub}, now() + interval '45 days', now(), now())
         RETURNING id`,
        [code, title, body, category, pinned],
      );
      anns++;
      // beberapa karyawan pertama sudah "membaca" (uji statistik read-tracking)
      if (published) {
        for (const eid of empIds.slice(0, 4)) {
          await c.query(
            `INSERT INTO "AnnouncementRead" (id, "announcementId", "employeeId", "readAt")
             VALUES (gen_random_uuid()::text, $1, $2, now() - interval '1 day') ON CONFLICT DO NOTHING`,
            [ins.rows[0].id, eid],
          );
          reads++;
        }
      }
    }
    console.log(`  pengumuman baru: ${anns} (dibaca tercatat: ${reads})`);

    // ---- 3c. seed Asset + AssetAssignment (insert-only) ----
    let assets = 0, assigns = 0;
    for (const [code, name, category, serial, value, location, status] of ASSET_SEED[schema] ?? []) {
      const exists = await c.query(`SELECT 1 FROM "Asset" WHERE code = $1`, [code]);
      if (exists.rowCount) continue;
      await c.query(
        `INSERT INTO "Asset" (id, code, name, category, "serialNumber", "value", status, location, "purchaseDate", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, now() - interval '300 days', now(), now())`,
        [code, name, category, serial || null, value, status, location],
      );
      assets++;
    }
    for (const [employeeNo, assetCode, note, returnCondition] of ASSIGNMENT_SEED[schema] ?? []) {
      const emp = await c.query(`SELECT id FROM "Employee" WHERE "employeeNo" = $1 AND status = 'Active'`, [employeeNo]);
      const ast = await c.query(`SELECT id FROM "Asset" WHERE code = $1`, [assetCode]);
      if (!emp.rowCount || !ast.rowCount) continue;
      const dup = await c.query(
        `SELECT 1 FROM "AssetAssignment" WHERE "assetId" = $1 AND "employeeId" = $2`,
        [ast.rows[0].id, emp.rows[0].id],
      );
      if (dup.rowCount) continue;
      const returnedAt = returnCondition ? new Date(Date.now() - 30 * 86_400_000) : null;
      await c.query(
        `INSERT INTO "AssetAssignment" (id, "assetId", "employeeId", "assignedAt", "returnedAt", "returnCondition", notes, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, now() - interval '120 days', $3::timestamp, $4, $5, now(), now())`,
        [ast.rows[0].id, emp.rows[0].id, returnedAt, returnCondition, note],
      );
      assigns++;
    }
    console.log(`  aset baru: ${assets}, penugasan baru: ${assigns}`);
  } finally {
    await c.end();
  }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung (bun scripts/migrate-wave27.ts),
// BUKAN saat diimpor aplikasi (parity-runner mengimpor main() saja).
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
