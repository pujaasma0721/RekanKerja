// Migrasi T5-TA-FIX ke tenant existing — idempoten:
//   DDL: kolom "AttendanceDaily"."paidFlag" BOOLEAN (nullable) — klasifikasi
//   izin berbayar/tidak yang eksplisit (mengganti notes.includes("tidak dibayar")
//   di recapPeriod; baris lama fallback ke notes).
// Jalankan: bun scripts/migrate-t5-ta.ts
import { Client } from "pg";

const SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

async function applyDdl(schemaName: string): Promise<string[]> {
  const out: string[] = [];
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    await c.query(`
      ALTER TABLE "AttendanceDaily"
        ADD COLUMN IF NOT EXISTS "paidFlag" BOOLEAN;`);
    out.push("kolom AttendanceDaily.paidFlag");

    // laporan jumlah baris lama yang belum punya paidFlag (akan terisi saat regen)
    const res = await c.query(
      `SELECT status, COUNT(*)::int AS n,
              COUNT("paidFlag")::int AS with_flag
       FROM "AttendanceDaily"
       WHERE status IN ('WorkOff', 'OnLeave')
       GROUP BY status`,
    );
    for (const row of res.rows as { status: string; n: number; with_flag: number }[]) {
      out.push(`pra-regen ${row.status}: ${row.n} baris (${row.with_flag} sudah ber paidFlag)`);
    }
  } finally {
    await c.end();
  }
  return out;
}

let total = 0;
for (const schema of SCHEMAS) {
  console.log(`\n[${schema}] migrasi T5-TA-FIX…`);
  const ddl = await applyDdl(schema);
  total += ddl.length;
  console.log(`  ${ddl.join(" · ")}`);
}
console.log(`\nDONE — ${total} langkah diterapkan (idempoten) di ${SCHEMAS.length} tenant`);
