// AUD-OT — terapkan kepatuhan lembur PP 35/2021 pada AttendanceRule demo. ==
// Idempoten: boleh diulang. Per tenant:
//   1. otWorkweekDays = 5 (MII/Cahaya/Sentra: Senin–Jumat, Sabtu–Minggu libur)
//      → tabel rate hari libur Ps.31 ayat (3): 2× j1–8, 3× j9, 4× j10–12.
//   2. otBasisMode = BASE_FIXED + komponen tunjangan tetap yang TERSEDIA di
//      tenant (TJAB/TKEL/TTRANS/TMAKAN — Pasal 32 ayat 3: dasar = 100% upah,
//      pokok + tunjangan tetap). Tenant tanpa komponen tsb tetap BASE.
// Jalankan: bun scripts/apply-ot-compliance.ts
import "./lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";

const TENANTS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const FIXED_CODES = ["TJAB", "TKEL", "TTRANS", "TMAKAN"];

for (const schema of TENANTS) {
  const db = getTenantClient(schema);
  const rule = await db.attendanceRule.findFirst({ orderBy: { id: "asc" } });
  if (!rule) {
    console.log(`[${schema}] tidak ada AttendanceRule — dibuat baru default`);
    await db.attendanceRule.create({
      data: { otWorkweekDays: 5 },
    });
    continue;
  }
  // hanya aktifkan BASE_FIXED bila komponen tunjangan tetap tersedia
  const comps = await db.wageComponent.findMany({
    where: { code: { in: FIXED_CODES }, active: true },
    select: { code: true },
  });
  const codes = FIXED_CODES.filter((c) => comps.some((x) => x.code === c));
  const patch: Record<string, unknown> = { otWorkweekDays: 5 };
  if (codes.length > 0) {
    patch.otBasisMode = "BASE_FIXED";
    patch.otBasisComponentCodes = codes.join(",");
  }
  await db.attendanceRule.update({ where: { id: rule.id }, data: patch });
  console.log(
    `[${schema}] otWorkweekDays=5${codes.length ? `, otBasisMode=BASE_FIXED (${codes.join("+")})` : ", otBasisMode=BASE (tanpa komponen tetap)"}`,
  );
}
console.log("SELESAI — kepatuhan lembur PP 35/2021 diterapkan");
