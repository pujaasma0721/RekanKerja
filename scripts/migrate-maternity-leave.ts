// Migrasi Cuti Melahirkan/Keguguran Pekerja Perempuan (Task 52-a) —
// 2 jenis cuti baru UU 13/2003 Ps.82 + UU KIA 4/2024 Ps.22:
//   · CT-LAHIR-P  Cuti Melahirkan (Pekerja Perempuan) — 6 bulan (3 bln dasar +
//     perpanjangan s.d. 6 bln per rekomendasi dokter), unit MONTH, needDocs.
//   · CT-GUGUR-P  Cuti Keguguran (Pekerja Perempuan) — 1,5 bulan, unit MONTH.
// INSERT ... ON CONFLICT ("code") DO NOTHING → idempoten, aman di-rerun.
// Saldo per karyawan TIDAK dibuat di sini — baris saldo event-type dibuat
// otomatis saat permintaan diajukan (ensureBalance) & ESS menampilkan jenis
// event aktif walau belum ada baris saldo (Task 52-a).
// Dapat diimpor IN-PROCESS oleh parity-runner ATAU CLI:
//   bun run scripts/migrate-maternity-leave.ts
import "./lib/env";
import { Client } from "pg";

const DEMO_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const TYPES: {
  id: string; code: string; name: string; description: string;
  entitlement: number; maxPerRequest: number;
}[] = [
  {
    id: "leave_type_ct_lahir_p",
    code: "CT-LAHIR-P",
    name: "Cuti Melahirkan (Pekerja Perempuan)",
    description:
      "3 bulan (UU 13/2003 Ps.82) — dapat diperpanjang hingga 6 bulan sesuai surat rekomendasi dokter (UU KIA 4/2024 Ps.22)",
    entitlement: 6,
    maxPerRequest: 6,
  },
  {
    id: "leave_type_ct_gugur_p",
    code: "CT-GUGUR-P",
    name: "Cuti Keguguran (Pekerja Perempuan)",
    description: "1,5 bulan (UU 13/2003 Ps.82 ayat 2)",
    entitlement: 1.5,
    maxPerRequest: 1.5,
  },
];

/** Parameter `schemas` → daftar schema dinamis dari registry tenant (parity-runner). */
export async function main(schemas?: string[]): Promise<void> {
  const list = schemas ?? DEMO_SCHEMAS;
  for (const schema of list) {
    const c = new Client({ connectionString: process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity" });
    await c.connect();
    try {
      await c.query(`SET search_path TO "${schema}"`);
      let inserted = 0;
      for (const t of TYPES) {
        const res = await c.query(
          `INSERT INTO "LeaveType"
             ("id","code","name","description","unit","entitlement","maxPerRequest",
              "paid","cashable","periodMode","prorateMonthly","carryOverMax","waitingMonths",
              "allowAdvance","allowHalfDay","needDocs","active","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,'MONTH',$5,$6,true,false,'CALENDAR',false,0,0,false,true,true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT ("code") DO NOTHING`,
          [t.id, t.code, t.name, t.description, t.entitlement, t.maxPerRequest],
        );
        inserted += res.rowCount ?? 0;
      }
      console.log(`[${schema}] jenis cuti perempuan (Task 52-a): ${inserted} baru / ${TYPES.length} cek — CT-LAHIR-P & CT-GUGUR-P siap`);
    } finally {
      await c.end().catch(() => {});
    }
  }
}

// CLI langsung (bukan import parity) → jalankan main().
if (process.argv[1]?.includes("migrate-maternity-leave")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
