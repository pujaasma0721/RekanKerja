// RekanKerja — DATASET KALENDER LIBUR NASIONAL + CUTI BERSAMA (bundled) ========
// ============================================================================
// P1.5 (D-BM12, DEVELOPMENT-PLAN-BENCHMARK.md): dataset libur resmi Indonesia
// yang DIBUNDLED bersama aplikasi — dikompilasi dari SKB 3 Menteri (Menag,
// Menaker, MenPAN-RB) yang sudah terbit:
//   • 2026 — SKB Nomor 1497, 2, 5 Tahun 2025 (ditetapkan 19 Sep 2025):
//     17 hari libur nasional + 8 cuti bersama.
//   • 2027 — SKB Nomor 1205, 3, 2 Tahun 2026 (ditetapkan 15 Sep 2026):
//     18 hari libur nasional + 8 cuti bersama.
// Sumber rujukan: kemenkopmk.go.id (PDF resmi), setneg.go.id,
// jdih.kemenkoinfra.go.id (rekapan resmi).
//
// PERILAKU:
//   • TIDAK ADA auto-fetch (tidak tersedia feed resmi yang stabil) — dataset
//     di-update di kode setiap SKB baru terbit (± Oktober tiap tahun).
//   • Tenant MENGIMPOR sendiri via tombol "Impor Dataset Nasional" di menu
//     Kalender Libur (pilih tahun) — idempoten: ON CONFLICT (date,name) DO
//     NOTHING, libur Company milik tenant TIDAK tersentuh.
//   • Baris yang sudah ada dengan nama identik dilewati; baris baru ditambah.
// ============================================================================

import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

export interface HolidaySeedRow {
  date: string; // YYYY-MM-DD
  name: string;
  kind: "National" | "Joint";
}

/** SKB 3 Menteri 2026 — 17 nasional + 8 cuti bersama. */
export const HOLIDAYS_2026: HolidaySeedRow[] = [
  { date: "2026-01-01", name: "Tahun Baru 2026 Masehi", kind: "National" },
  { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad SAW", kind: "National" },
  { date: "2026-02-16", name: "Cuti Bersama Tahun Baru Imlek", kind: "Joint" },
  { date: "2026-02-17", name: "Tahun Baru Imlek 2576 Kongzili", kind: "National" },
  { date: "2026-03-18", name: "Cuti Bersama Hari Suci Nyepi", kind: "Joint" },
  { date: "2026-03-19", name: "Hari Suci Nyepi (Tahun Baru Saka 1948)", kind: "National" },
  { date: "2026-03-20", name: "Cuti Bersama Idulfitri 1447 Hijriah", kind: "Joint" },
  { date: "2026-03-21", name: "Hari Raya Idulfitri 1447 Hijriah", kind: "National" },
  { date: "2026-03-22", name: "Hari Raya Idulfitri 1447 Hijriah", kind: "National" },
  { date: "2026-03-23", name: "Cuti Bersama Idulfitri 1447 Hijriah", kind: "Joint" },
  { date: "2026-03-24", name: "Cuti Bersama Idulfitri 1447 Hijriah", kind: "Joint" },
  { date: "2026-04-03", name: "Wafat Yesus Kristus", kind: "National" },
  { date: "2026-04-05", name: "Kebangkitan Yesus Kristus (Paskah)", kind: "National" },
  { date: "2026-05-01", name: "Hari Buruh Internasional", kind: "National" },
  { date: "2026-05-14", name: "Kenaikan Yesus Kristus", kind: "National" },
  { date: "2026-05-15", name: "Cuti Bersama Kenaikan Yesus Kristus", kind: "Joint" },
  { date: "2026-05-27", name: "Iduladha 1447 Hijriah", kind: "National" },
  { date: "2026-05-28", name: "Cuti Bersama Iduladha 1447 Hijriah", kind: "Joint" },
  { date: "2026-05-31", name: "Hari Raya Waisak 2570 BE", kind: "National" },
  { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "National" },
  { date: "2026-06-16", name: "Tahun Baru Islam 1448 Hijriah", kind: "National" },
  { date: "2026-08-17", name: "Proklamasi Kemerdekaan", kind: "National" },
  { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "National" },
  { date: "2026-12-25", name: "Kelahiran Yesus Kristus", kind: "National" },
  { date: "2026-12-26", name: "Cuti Bersama Kelahiran Yesus Kristus", kind: "Joint" },
];

/** SKB 3 Menteri 2027 — 18 nasional + 8 cuti bersama. */
export const HOLIDAYS_2027: HolidaySeedRow[] = [
  { date: "2027-01-01", name: "Tahun Baru 2027 Masehi", kind: "National" },
  { date: "2027-01-05", name: "Isra Mikraj Nabi Muhammad SAW 1448 Hijriah", kind: "National" },
  { date: "2027-02-05", name: "Cuti Bersama Tahun Baru Imlek", kind: "Joint" },
  { date: "2027-02-06", name: "Tahun Baru Imlek 2578 Kongzili", kind: "National" },
  { date: "2027-03-08", name: "Hari Suci Nyepi (Tahun Baru Saka 1949)", kind: "National" },
  { date: "2027-03-09", name: "Cuti Bersama Idulfitri 1448 Hijriah", kind: "Joint" },
  { date: "2027-03-10", name: "Hari Raya Idulfitri 1448 Hijriah", kind: "National" },
  { date: "2027-03-11", name: "Hari Raya Idulfitri 1448 Hijriah", kind: "National" },
  { date: "2027-03-12", name: "Cuti Bersama Idulfitri 1448 Hijriah", kind: "Joint" },
  { date: "2027-03-15", name: "Cuti Bersama Idulfitri 1448 Hijriah", kind: "Joint" },
  { date: "2027-03-25", name: "Cuti Bersama Wafat Yesus Kristus", kind: "Joint" },
  { date: "2027-03-26", name: "Wafat Yesus Kristus", kind: "National" },
  { date: "2027-03-28", name: "Kebangkitan Yesus Kristus (Paskah)", kind: "National" },
  { date: "2027-05-01", name: "Hari Buruh Internasional", kind: "National" },
  { date: "2027-05-06", name: "Kenaikan Yesus Kristus", kind: "National" },
  { date: "2027-05-17", name: "Iduladha 1448 Hijriah", kind: "National" },
  { date: "2027-05-18", name: "Cuti Bersama Iduladha 1448 Hijriah", kind: "Joint" },
  { date: "2027-05-19", name: "Cuti Bersama Waisak", kind: "Joint" },
  { date: "2027-05-20", name: "Hari Raya Waisak 2571 BE", kind: "National" },
  { date: "2027-06-01", name: "Hari Lahir Pancasila", kind: "National" },
  { date: "2027-06-06", name: "Tahun Baru Islam 1449 Hijriah", kind: "National" },
  { date: "2027-08-15", name: "Maulid Nabi Muhammad SAW", kind: "National" },
  { date: "2027-08-17", name: "Proklamasi Kemerdekaan", kind: "National" },
  { date: "2027-12-24", name: "Cuti Bersama Kelahiran Yesus Kristus", kind: "Joint" },
  { date: "2027-12-25", name: "Kelahiran Yesus Kristus", kind: "National" },
  { date: "2027-12-26", name: "Isra Mikraj Nabi Muhammad SAW 1449 Hijriah", kind: "National" },
];

const DATASETS: Record<number, HolidaySeedRow[]> = {
  2026: HOLIDAYS_2026,
  2027: HOLIDAYS_2027,
};

/** Tahun dataset yang tersedia (utk pilihan UI impor). */
export function availableHolidayYears(): number[] {
  return Object.keys(DATASETS).map(Number).sort((a, b) => a - b);
}

export function holidayDatasetFor(year: number): HolidaySeedRow[] {
  return DATASETS[year] ?? [];
}


/**
 * Impor dataset SKB satu tahun ke tenant — IDEMPOTEN (skipDuplicates pada
 * unique [date,name]); libur Company & baris manual tenant tidak tersentuh.
 * Mengembalikan jumlah baris dataset + jumlah baris benar-benar baru.
 */
export async function importHolidayDataset(db: TenantDb, year: number): Promise<{ total: number; inserted: number }> {
  const rows = holidayDatasetFor(year);
  if (rows.length === 0) return { total: 0, inserted: 0 };
  const before = await db.holidayDate.count();
  await db.holidayDate.createMany({
    data: rows.map((r) => ({ date: new Date(`${r.date}T00:00:00.000Z`), name: r.name, kind: r.kind })),
    skipDuplicates: true,
  });
  const after = await db.holidayDate.count();
  return { total: rows.length, inserted: Math.max(0, after - before) };
}
