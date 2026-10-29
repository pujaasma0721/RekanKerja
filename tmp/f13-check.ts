// F-13 verify helper — baca NIK terdekripsi + baseline jumlah karyawan MII.
import "../scripts/lib/env";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

const MII_SCHEMA = "tenant_pt_mitra_industri_internasional";

async function main() {
  const db = getTenantClient(MII_SCHEMA);
  const tc = tenantCryptoForDb(db);
  const total = await db.employee.count();
  const rows = await db.employee.findMany({
    where: { nationalId: { not: null } },
    orderBy: { employeeNo: "asc" },
    select: { employeeNo: true, fullName: true, nationalId: true, status: true },
  });
  console.log(`TOTAL_EMPLOYEES=${total}`);
  console.log(`EMPLOYEES_WITH_NIK=${rows.length}`);
  for (const r of rows.slice(0, 5)) {
    console.log(`NIK_SAMPLE ${r.employeeNo} ${r.fullName} ${tc.decryptText(r.nationalId)} ${r.status}`);
  }
  // cek apakah sudah ada duplikat NIK tersimpan (sisa UAT bagian 2)
  const seen = new Map<string, string>();
  let dup = 0;
  for (const r of rows) {
    const nik = tc.decryptText(r.nationalId) ?? "";
    if (seen.has(nik)) {
      console.log(`DUPLICATE_EXISTING ${nik} => ${seen.get(nik)} & ${r.employeeNo}`);
      dup++;
    } else seen.set(nik, r.employeeNo);
  }
  console.log(`DUPLICATE_NIK_PAIRS=${dup}`);
  await db.$disconnect?.();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
