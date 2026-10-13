// AUDIT READ-ONLY struktur modul REKRUTMEN (F0–F9) untuk semua tenant —
// TANPA menulis apa pun ke database (SELECT information_schema saja).
// =========================================================================
// Latar: error produksi berulang pada menu-menu recruitment. Gap-check lama
// hanya memeriksa SATU tabel representatif per fase (F1 = PersonnelRequisition,
// F2 = JobOpening, dst.) sehingga tabel sekunder fase (mis. ApplicantDocument,
// ScorecardTemplate, WebhookDelivery) bisa hilang tanpa terdeteksi. Skrip ini
// memeriksa SELURUH 45 tabel + 5 kolom ALTER peta di scripts/lib/recruitment-schema.ts
// dan melaporkan yang hilang PER TENANT + PER FASE — diagnosis langsung tanpa
// menunggu screenshot error.
//
// Pemakaian (di server produksi, akses DB sesuai env):
//   bun run scripts/audit-recruitment-schema.ts            → semua tenant registry
//   TENANT_DB_BASE_URL=postgres://… bun run scripts/audit-recruitment-schema.ts
// Keluaran: ringkasan per tenant; exit code 0 = lengkap, 1 = ada yang hilang,
// 2 = koneksi/gagal menjalankan audit. Tidak pernah menulis ke DB.
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import {
  RECRUITMENT_TABLES,
  RECRUITMENT_ALTER_COLUMNS,
  type RecruitmentPhase,
} from "./lib/recruitment-schema";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

async function tenantSchemas(): Promise<string[]> {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants.map((t) => t.schemaName).filter((s): s is string => !!s).sort();
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  const schemas = await tenantSchemas();
  if (schemas.length === 0) {
    console.log("Tidak ada tenant di registry — tidak ada yang diaudit.");
    process.exitCode = 0;
    return;
  }

  const c = new Client({ connectionString: TENANT_URL() });
  try {
    await c.connect();
  } catch (e) {
    console.error(`GAGAL koneksi ke database tenant (${TENANT_URL().replace(/\/\/.*@/, "//***@")}): ${msg(e)}`);
    process.exitCode = 2;
    return;
  }

  const tables = RECRUITMENT_TABLES.map((r) => r.table);
  // Kolom: hanya untuk tabel yang ada di peta (kolom ALTER pada tabel inti lain
  // tetap dicek — information_schema.columns tidak butuh tabel terdaftar).
  const allCols = [...new Set(RECRUITMENT_ALTER_COLUMNS.map((r) => r.column))];

  try {
    // Satu query per jenis pemeriksaan (bukan per tenant) — murah & atomik.
    const tblRows = await c.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_schema = ANY($1::text[]) AND table_name = ANY($2::text[])`,
      [schemas, tables],
    );
    const colRows = await c.query<{ table_schema: string; table_name: string; column_name: string }>(
      `SELECT table_schema, table_name, column_name FROM information_schema.columns
       WHERE table_schema = ANY($1::text[]) AND table_name = ANY($2::text[]) AND column_name = ANY($3::text[])`,
      [schemas, tables, allCols],
    );
    const haveTable = new Set(tblRows.rows.map((r) => `${r.table_schema}.${r.table_name}`));
    const haveCol = new Set(colRows.rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));

    let problems = 0;
    for (const schema of schemas) {
      const missingByPhase = new Map<RecruitmentPhase, string[]>();
      const push = (phase: RecruitmentPhase, what: string) => {
        const arr = missingByPhase.get(phase) ?? [];
        arr.push(what);
        missingByPhase.set(phase, arr);
      };
      for (const { phase, table } of RECRUITMENT_TABLES) {
        if (!haveTable.has(`${schema}.${table}`)) push(phase, `tabel ${table}`);
      }
      for (const { phase, table, column } of RECRUITMENT_ALTER_COLUMNS) {
        // Kolom hanya wajib bila tabel induknya ada (instalasi pra-fase tanpa
        // tabel inti modul lain tidak dianggap gap — sama dgn pola medical).
        if (haveTable.has(`${schema}.${table}`) && !haveCol.has(`${schema}.${table}.${column}`)) {
          push(phase, `kolom ${table}.${column}`);
        }
      }
      if (missingByPhase.size === 0) {
        console.log(`[${schema}] LENGKAP — 45 tabel + 5 kolom recruitment tersedia.`);
        continue;
      }
      problems++;
      console.log(`[${schema}] TIDAK LENGKAP:`);
      for (const [phase, items] of [...missingByPhase.entries()].sort()) {
        console.log(`  ${phase}: ${items.join(", ")}`);
      }
    }
    console.log(
      problems === 0
        ? "SEMUA tenant lengkap — tidak ada gap struktur recruitment."
        : `${problems}/${schemas.length} tenant belum lengkap → jalankan pipeline parity (POST /api/admin/seed-demo atau restart app) untuk healing idempoten.`,
    );
    process.exitCode = problems === 0 ? 0 : 1;
  } catch (e) {
    console.error(`Audit gagal: ${msg(e)}`);
    process.exitCode = 2;
  } finally {
    try { await c.end(); } catch { /* ignore */ }
    try { await platform.$disconnect(); } catch { /* ignore */ }
  }
}

main();
