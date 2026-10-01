// Migrasi modul Leave ke tenant MII yang sudah punya data (Task 18):
//   1. ensureLeaveReference (12 jenis cuti + komponen UCT)
//   2. seedLeaveDemoData (saldo 2025→2026, permintaan, massal SKB, encashment)
//   3. hitung ulang rekap kehadiran Agu–Sep (status OnLeave masuk)
// Idempoten: saldo 2026 sudah ada → skip.
// Jalankan: bun run scripts/migrate-leave.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { seedLeaveDemoData } from "@/rekankerja/leave/services/leave-seed";
import { regenerateRange } from "@/rekankerja/time-attendance/services/attendance-service";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi leave…`);
  const db = getTenantClient(schema);
  const res = await seedLeaveDemoData(db);
  if (res.skipped) {
    console.log("  saldo 2026 sudah ada — skip");
  } else {
    console.log(`  ${res.balances} saldo 2026, ${res.requests} permintaan, massal ${res.massGenerated} karyawan, ${res.encashments} encashment`);
    // rekap kehadiran ulang agar status OnLeave muncul (window seed Aug–Sep 2026)
    const days = await regenerateRange(db, new Date(2026, 7, 1), new Date(2026, 8, 30));
    console.log(`  ${days} rekap kehadiran dihitung ulang`);
  }
  await db.$disconnect();
}
console.log("\nDONE");
