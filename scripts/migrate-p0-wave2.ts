// Migrasi P0 WAVE-2 (audit domain-first GAP-ANALYSIS-DEEP.md) ke tenant existing:
//   1. ADD COLUMN idempoten PayrollRunLine.umkWarning + umkJson
//      (penanda hasil validasi UMP/UMK per baris run — PP 36/2021).
//   2. Seed UMP/UMK 2026 (MinimumWage) — hanya INSERT bila belum ada
//      (aman-edit: tidak menimpa nilai yang sudah diubah admin):
//        · MII: OFF-HO & OFF-PLG (Jakarta) → UMK DKI 2026 Rp 5.396.761
//                OFF-SBY (Surabaya)      → UMK Jatim 2026  Rp 4.961.753
//        · Cahaya (tanpa kantor): default tenant → UMP Jawa Barat 2026 Rp 4.594.354
//        · Sentra  (tanpa kantor): default tenant → UMP Jawa Tengah 2026 Rp 2.236.491
//   3. Seed PKWT PP 35/2021 (MII): contractStart/contractEnd/renewalCount untuk
//      karyawan Contract/Probation yang kolomnya masih kosong — termasuk satu
//      kasus durasi total > 5 tahun (uji guard konversi PKS) dan sebaran
//      tanggal berakhir ≤7/≤21/≤45/≤75 hari + 1 lewat (uji filter directory).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI: bun run scripts/migrate-p0-wave2.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const NEW_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "PayrollRunLine", column: "umkWarning", ddl: "BOOLEAN NOT NULL DEFAULT false" },
  { table: "PayrollRunLine", column: "umkJson", ddl: "TEXT" },
];

/** UMP/UMK 2026 per schema → [officeCode|null, label, amount]. */
const WAGE_SEED_2026: Record<string, [string | null, string, number][]> = {
  tenant_pt_mitra_industri_internasional: [
    ["OFF-HO", "UMK DKI Jakarta 2026 (Kota/Kab. Jakarta Timur)", 5_396_761],
    ["OFF-PLG", "UMK DKI Jakarta 2026 (Kota/Kab. Jakarta Timur)", 5_396_761],
    ["OFF-SBY", "UMK Jawa Timur 2026 (Kab./Kota Surabaya)", 4_961_753],
  ],
  tenant_cahaya_digital_nusantara: [
    [null, "UMP Jawa Barat 2026 (default tenant)", 4_594_354],
  ],
  tenant_sentra_logistik_prima: [
    [null, "UMP Jawa Tengah 2026 (default tenant)", 2_236_491],
  ],
};

/** Seed PKWT MII: employeeNo → {start, end|null, renewal} (end relatif hari ini). */
function pkwtSeed(): { employeeNo: string; start: string; end: string | null; renewal: number }[] {
  const day = (n: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return [
    // > 5 tahun total (2019-12-18 → 2026-06-30) — guard PP35: wajib konversi PKS
    { employeeNo: "MII00013", start: "2019-12-18", end: "2026-06-30", renewal: 3 },
    // berakhir ≤ 7 hari (badge merah)
    { employeeNo: "MII00022", start: "2020-12-26", end: day(5), renewal: 2 },
    // berakhir ≤ 30 hari (badge amber)
    { employeeNo: "MII00015", start: "2023-11-26", end: day(21), renewal: 1 },
    // sudah LEWAT jatuh tempo namun masih Active — butuh tindak lanjut HR
    { employeeNo: "MII00031", start: "2024-12-14", end: day(-9), renewal: 0 },
    // berakhir ≤ 60 hari
    { employeeNo: "MII00028", start: "2021-11-27", end: day(45), renewal: 1 },
    // probation: tanggal mulai kontrak = joinDate (akhir kontrak belum ditetapkan)
    { employeeNo: "MII00014", start: "2024-03-02", end: null, renewal: 0 },
    { employeeNo: "MII00035", start: "2024-03-12", end: null, renewal: 0 },
  ];
}

// ============ main ============

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? SCHEMAS;
  for (const schema of list) {
  const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schema}"`);
    console.log(`\n[${schema}] migrasi P0 wave-2 (umkWarning/umkJson + seed UMK 2026 + PKWT MII)…`);

    // ---- 1. ADD COLUMN idempoten ----
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

    // ---- 2. seed MinimumWage 2026 (insert-only bila belum ada) ----
    let wages = 0;
    for (const [officeCode, label, amount] of WAGE_SEED_2026[schema] ?? []) {
      let officeId: string | null = null;
      if (officeCode) {
        const o = await c.query('SELECT id FROM "CompanyOffice" WHERE code = $1', [officeCode]);
        if (o.rowCount === 0) { console.log(`  [!] kantor ${officeCode} tidak ditemukan — lewati`); continue; }
        officeId = o.rows[0].id as string;
      }
      const exists = await c.query(
        'SELECT 1 FROM "MinimumWage" WHERE year = 2026 AND "companyOfficeId" IS NOT DISTINCT FROM $1',
        [officeId],
      );
      if (exists.rowCount === 0) {
        await c.query(
          'INSERT INTO "MinimumWage" (id, year, "companyOfficeId", label, "monthlyAmount", active, "createdAt", "updatedAt") VALUES (gen_random_uuid()::text, 2026, $1, $2, $3, true, now(), now())',
          [officeId, label, amount],
        );
        wages++;
      }
    }
    console.log(`  UMP/UMK 2026 baru: ${wages} (sisanya sudah ada)`);

    // ---- 3. seed PKWT MII (hanya bila contractEnd masih kosong; karyawan AKTIF saja) ----
    if (schema === "tenant_pt_mitra_industri_internasional") {
      let pkwt = 0;
      for (const s of pkwtSeed()) {
        const emp = await c.query(
          'SELECT id FROM "Employee" WHERE "employeeNo" = $1 AND "contractStart" IS NULL AND "contractEnd" IS NULL AND status = \'Active\'',
          [s.employeeNo],
        );
        if (emp.rowCount === 0) continue;
        await c.query(
          'UPDATE "Employee" SET "contractStart" = $1, "contractEnd" = $2, "renewalCount" = $3 WHERE id = $4',
          [s.start, s.end, s.renewal, emp.rows[0].id],
        );
        pkwt++;
      }
      console.log(`  PKWT MII terisi: ${pkwt} karyawan`);
    }
  } finally {
    await c.end();
  }
  }
  console.log("\nDONE");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor aplikasi.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
