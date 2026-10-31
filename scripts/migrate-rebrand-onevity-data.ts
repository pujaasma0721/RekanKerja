// Migrasi REBRAND DATA: "OneVity" → "RekanKerja" di seluruh isi database. ==
// ===========================================================================
// LATAR: commit a5bb530 (Task 86) me-rebrand kode + template default seed
// menjadi "RekanKerja", TETAPI seed bersifat insert-if-missing:
//   - EmailTemplate: INSERT ... WHERE NOT EXISTS (scripts/migrate-email-config.ts)
//   - WaTemplate:    upsert({ update: {} })  (parity-runner)
// Artinya: baris yang DIBUAT SEBELUM rebrand (berisi "OneVity HRIS", dsb.)
// TIDAK PERNAH ditimpa oleh kode baru — teks "OneVity" bertahan selamanya
// di database yang sudah terisi data lama (contoh: server dev yang
// di-deploy ulang dari DB lama).
//
// Migrasi ini menulis ulang ISI DATA (bukan schema): setiap kolom teks
// (varchar/text/char) + JSON (json/jsonb) di SEMUA schema (public + semua
// tenant_*) discan; kata persis "OneVity" diganti "RekanKerja".
//
// Pemakaian (jalankan dari root repo, server dev/production):
//   bun scripts/migrate-rebrand-onevity-data.ts             # DRY-RUN: laporan saja, TANPA menulis
//   bun scripts/migrate-rebrand-onevity-data.ts --apply     # eksekusi penggantian
//
// KEBIJAKAN AMAN:
//   1. HANYA kata persis "OneVity" (camel-case) yang diganti otomatis —
//      varian "onevity123" (sandi), "onevity.sayone.my.id" (URL/domain),
//      "@onevity" (email), label kripto internal — TIDAK disentuh dan hanya
//      DILAPORKAN untuk review manual (menggantinya bisa memutus kredensial,
//      tautan, dan derivasi kunci enkripsi data lama).
//   2. Kolom terenkripsi aman: ciphertext (enc:v1/...) tidak mengandung teks
//      polos "OneVity", jadi tidak pernah tersentuh (guard WHERE LIKE).
//   3. Idempoten: data yang sudah bersih tidak di-UPDATE ulang.
//   4. Semua UPDATE dalam SATU transaksi per tabel; tabel bermasalah
//      (mis. view) di-skip + dilaporkan, sisanya tetap diproses.
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const CONN =
  process.env.PLATFORM_DB_URL ??
  process.env.TENANT_DB_BASE_URL ??
  "postgresql://rekankerja:rekankerja_dev@127.0.0.1:5432/rekankerja";

interface Hit {
  schema: string;
  table: string;
  column: string;
  dtype: string;
  rows: number; // baris mengandung 'onevity' (case-insensitive)
  replaceable: number; // baris mengandung persis 'OneVity' (akan diganti)
  sample: string;
}

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  console.log(
    `== Migrasi rebrand data: "OneVity" → "RekanKerja" (${APPLY ? "APPLY" : "DRY-RUN — tanpa perubahan"}) ==`,
  );
  console.log(`DB: ${CONN.replace(/:[^:@/]+@/, ":***@")}\n`);

  // ---- 1. temukan schema + kolom teks/json kandidat ---------------------
  const schemas = (
    await c.query<{ schema_name: string }>(
      `SELECT schema_name FROM information_schema.schemata
       WHERE schema_name = 'public' OR schema_name LIKE 'tenant\\_%'
       ORDER BY schema_name`,
    )
  ).rows.map((r) => r.schema_name);
  console.log(`schema discan (${schemas.length}): ${schemas.join(", ")}\n`);

  const cols = (
    await c.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
      `SELECT k.table_schema, k.table_name, k.column_name, k.data_type
       FROM information_schema.columns k
       JOIN information_schema.tables t
         ON t.table_schema = k.table_schema AND t.table_name = k.table_name
       WHERE k.table_schema = ANY($1::text[])
         AND t.table_type = 'BASE TABLE'
         AND k.table_name NOT LIKE '\\_prisma%'
         AND k.data_type IN ('character varying','text','character','json','jsonb')
       ORDER BY k.table_schema, k.table_name, k.column_name`,
      [schemas],
    )
  ).rows;
  console.log(`kolom kandidat: ${cols.length} (varchar/text/char/json/jsonb)\n`);

  // ---- 2. scan: mana yang benar-benar mengandung 'onevity' --------------
  const hits: Hit[] = [];
  for (const col of cols) {
    const q = `"${col.table_schema}"."${col.table_name}"."${col.column_name}"`;
    const casted = col.data_type.startsWith("json") ? `${q}::text` : q;
    const r = await c.query<{ n: number; r: number; s: string | null }>(
      `SELECT COUNT(*) FILTER (WHERE ${casted} ILIKE '%onevity%')::int AS n,
              COUNT(*) FILTER (WHERE ${casted} LIKE '%OneVity%')::int AS r,
              (SELECT LEFT(${casted}, 90) FROM "${col.table_schema}"."${col.table_name}"
                WHERE ${casted} ILIKE '%onevity%' LIMIT 1) AS s
       FROM "${col.table_schema}"."${col.table_name}"`,
    );
    const row = r.rows[0];
    if (row && row.n > 0) {
      hits.push({
        schema: col.table_schema, table: col.table_name, column: col.column_name,
        dtype: col.data_type, rows: row.n, replaceable: row.r,
        sample: (row.s ?? "").replace(/\s+/g, " ").slice(0, 90),
      });
    }
  }

  // ---- 2b. perbaiki DEFAULT kolom pra-rebrand (mis. EmailConfig.fromName
  //          DDL lama: DEFAULT 'OneVity HRIS' — baris BARU ikut lahir salah) --
  const badDefaults = (
    await c.query<{ table_schema: string; table_name: string; column_name: string; column_default: string }>(
      `SELECT table_schema, table_name, column_name, column_default
       FROM information_schema.columns
       WHERE (table_schema = 'public' OR table_schema LIKE 'tenant\\_%')
         AND column_default LIKE '%OneVity%'`,
    )
  ).rows;

  if (hits.length === 0 && badDefaults.length === 0) {
    console.log("✓ TIDAK ADA kemunculan 'onevity' di database ini — tidak ada yang perlu diganti.");
    await c.end();
    return;
  }

  if (badDefaults.length > 0) {
    console.log(`DEFAULT kolom pra-rebrand (${badDefaults.length}):`);
    for (const d of badDefaults) {
      const fixed = d.column_default.replace(/OneVity/g, "RekanKerja");
      console.log(`  [DEFAULT] ${d.table_schema}.${d.table_name}.${d.column_name}: '${d.column_default}' → '${fixed}'`);
      if (APPLY) {
        try {
          await c.query(
            `ALTER TABLE "${d.table_schema}"."${d.table_name}" ALTER COLUMN "${d.column_name}" SET DEFAULT ${fixed}`,
          );
        } catch (e) {
          console.log(`  ✗ GAGAL ubah default: ${String(e).slice(0, 120)}`);
        }
      }
    }
    if (!APPLY) console.log("  (default belum diubah — jalankan --apply)\n");
  }

  // ---- 3. laporan baris data ---------------------------------------------
  let totalRows = 0, totalReplace = 0;
  for (const h of hits) {
    totalRows += h.rows; totalReplace += h.replaceable;
    const mark = h.replaceable > 0 ? "GANTI" : "review";
    console.log(`  [${mark}] ${h.schema}.${h.table}.${h.column} (${h.dtype}) — ${h.rows} baris (${h.replaceable} mengandung "OneVity") :: ${h.sample}`);
  }
  console.log(`\ntotal: ${hits.length} kolom · ${totalRows} baris mengandung 'onevity' · ${totalReplace} baris akan diganti\n`);

  if (!APPLY) {
    console.log("DRY-RUN selesai — belum ada perubahan. Jalankan dengan --apply untuk mengeksekusi:");
    console.log("  bun scripts/migrate-rebrand-onevity-data.ts --apply");
    await c.end();
    return;
  }

  // ---- 4. apply: REPLACE persis 'OneVity' → 'RekanKerja' -----------------
  let updatedCols = 0, updatedRows = 0, failed = 0;
  for (const h of hits.filter((x) => x.replaceable > 0)) {
    const q = `"${h.schema}"."${h.table}"."${h.column}"`;
    const castBack = h.dtype === "jsonb" ? "::jsonb" : h.dtype === "json" ? "::json" : "";
    const castOut = h.dtype.startsWith("json") ? `${q}::text` : q;
    try {
      await c.query("BEGIN");
      const r = await c.query(
        `UPDATE "${h.schema}"."${h.table}"
         SET "${h.column}" = REPLACE(${castOut}, 'OneVity', 'RekanKerja')${castBack}
         WHERE ${castOut} LIKE '%OneVity%'`,
      );
      await c.query("COMMIT");
      updatedCols++; updatedRows += r.rowCount ?? 0;
      console.log(`  ✓ ${h.schema}.${h.table}.${h.column}: ${r.rowCount} baris diganti`);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      failed++;
      console.log(`  ✗ GAGAL ${h.schema}.${h.table}.${h.column}: ${String(e).slice(0, 120)} (di-skip, transaksi dibatalkan)`);
    }
  }

  // ---- 5. audit akhir: sisa varian non-"OneVity" utk review manual ------
  const leftover: string[] = [];
  for (const col of cols) {
    const q = `"${col.table_schema}"."${col.table_name}"."${col.column_name}"`;
    const casted = col.data_type.startsWith("json") ? `${q}::text` : q;
    try {
      const r = await c.query<{ n: number; s: string | null }>(
        `SELECT COUNT(*)::int AS n,
                (SELECT LEFT(${casted}, 70) FROM "${col.table_schema}"."${col.table_name}"
                  WHERE ${casted} ILIKE '%onevity%' LIMIT 1) AS s
         FROM "${col.table_schema}"."${col.table_name}" WHERE ${casted} ILIKE '%onevity%'`,
      );
      if (r.rows[0]?.n > 0)
        leftover.push(`  ${col.table_schema}.${col.table_name}.${col.column_name}: ${r.rows[0].n} baris :: ${r.rows[0].s}`);
    } catch { /* skip */ }
  }

  console.log(`\n== HASIL: ${updatedCols} kolom / ${updatedRows} baris diganti${failed ? ` · ${failed} tabel gagal (lihat ✗)` : ""} ==`);
  if (leftover.length) {
    console.log(`\nSISA varian huruf lain ("onevity"/"ONEVITY" — sandi, URL, email, dst.) TIDAK diubah, review manual:`);
    console.log(leftover.join("\n"));
  } else {
    console.log("Tidak ada sisa varian lain — database bebas 'onevity'.");
  }
  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
