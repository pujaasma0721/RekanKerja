// Migrasi Task 43-d (audit 42 — M-15 + M-20) ke tenant existing — IDEMPOTEN:
//
//   M-15 — 4 index hilang (Seq Scan terverifikasi, dipilih dari query terberat):
//     1. PayrollRun(periodId, processTypeId)         — dup-check run aktif,
//        GET runs?periodId=, markOvertimePaidForRun, component-assignments POST.
//     2. EmployeeComponentAssignment(periodId, processTypeId, kind)
//        — buildRunRows payroll-service (kalkulasi tiap run) + deleteMany
//        transferToPayroll/leave/medical/travel (idempoten transfer).
//     3. MedicalClaim(employeeId)                    — daftar klaim per karyawan,
//        claimPoolAvailability, generateSettleJournal.
//     4. MedicalClaimLine(receiptNo)                 — dedupe kwitansi lintas
//        klaim saat submit (medical-service findMany receiptNo IN [...]).
//     Nama index SAMA dengan tenant-ddl.sql hasil `bun run tenant:ddl`
//     (paritas penuh tenant baru vs existing).
//
//   M-20 — partial unique index run payroll AKTIF (anti gaji dobel):
//        CREATE UNIQUE INDEX uniq_payrollrun_active
//        ON "PayrollRun"("processTypeId","periodId")
//        WHERE "status" <> 'Cancelled'
//     Dua run aktif (Draft/Calculated/Confirmed/Paid) period+jenis yang sama
//     mustahil di level DB (pre-check 409 di payroll-runs.ts POST + race
//     concurrency paralel). Cancel → status 'Cancelled' → run baru period+type
//     sama BOLEH dibuat (semantik soft-delete dipertahankan).
//     Partial index TIDAK ter-ekspresi di Prisma schema — komentar dokumentasi
//     ada di prisma/schema-tenant.prisma (model PayrollRun); wiring tenant baru
//     di provisioning.ts (samping ActivityLog_dedu_reminder).
//
// Catatan: CREATE INDEX polos (bukan CONCURRENTLY) — tabel ini kecil
// (PayrollRun puluhan baris, ECA/klaim ratusan) dan skrip dijalankan offline
// saat maintenance; IF NOT EXISTS membuat skrip idempoten.
//
// Tenant dienumerasi dari registry platform (public."Tenant" status ACTIVE);
// fallback 3 schema sandbox bila registry tak terbaca.
// Jalankan: bun scripts/migrate-task43-indexes.ts
import "./lib/env"; // K-7: muat .env root bila ada (env proses menang)
import { Client } from "pg";

const PLATFORM_URL =
  process.env.PLATFORM_DB_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";
const BASE_URL =
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

const FALLBACK_SCHEMAS = [
  "tenant_pt_mitra_industri_internasional",
  "tenant_cahaya_digital_nusantara",
  "tenant_sentra_logistik_prima",
];

// (nama, DDL) — nama = nama Prisma di tenant-ddl.sql (M-15) / nama bebas (M-20).
const INDEXES: [string, string][] = [
  [
    "PayrollRun_periodId_processTypeId_idx",
    `CREATE INDEX IF NOT EXISTS "PayrollRun_periodId_processTypeId_idx" ON "PayrollRun"("periodId", "processTypeId")`,
  ],
  [
    "EmployeeComponentAssignment_periodId_processTypeId_kind_idx",
    `CREATE INDEX IF NOT EXISTS "EmployeeComponentAssignment_periodId_processTypeId_kind_idx" ON "EmployeeComponentAssignment"("periodId", "processTypeId", "kind")`,
  ],
  [
    "MedicalClaim_employeeId_idx",
    `CREATE INDEX IF NOT EXISTS "MedicalClaim_employeeId_idx" ON "MedicalClaim"("employeeId")`,
  ],
  [
    "MedicalClaimLine_receiptNo_idx",
    `CREATE INDEX IF NOT EXISTS "MedicalClaimLine_receiptNo_idx" ON "MedicalClaimLine"("receiptNo")`,
  ],
  [
    "uniq_payrollrun_active",
    `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_payrollrun_active" ON "PayrollRun"("processTypeId","periodId") WHERE "status" <> 'Cancelled'`,
  ],
];

const TABLES = ["PayrollRun", "EmployeeComponentAssignment", "MedicalClaim", "MedicalClaimLine"];

async function activeTenantSchemas(): Promise<{ slug: string; schemaName: string }[]> {
  const c = new Client({ connectionString: PLATFORM_URL });
  try {
    await c.connect();
    const r = await c.query<{ slug: string; schemaName: string }>(
      `SELECT "slug", "schemaName" FROM public."Tenant" WHERE "status" = 'ACTIVE' ORDER BY "slug"`,
    );
    if (r.rowCount && r.rowCount > 0) return r.rows;
  } catch (e) {
    console.warn(`[migrate-task43-indexes] registry tenant tak terbaca (${e instanceof Error ? e.message : e}) — fallback schema sandbox`);
  } finally {
    try { await c.end(); } catch { /* ignore */ }
  }
  return FALLBACK_SCHEMAS.map((s) => ({ slug: s.replace(/^tenant_/, "").replace(/_/g, "-"), schemaName: s }));
}

async function migrateSchema(schemaName: string, slug: string): Promise<void> {
  console.log(`\n[${schemaName}] (${slug}) migrasi index task43 (M-15 + M-20)…`);
  const c = new Client({ connectionString: BASE_URL });
  await c.connect();
  try {
    await c.query(`SET search_path TO "${schemaName}"`);

    // pre-check tabel ada (tenant parsial pra-migrasi)
    const existingTables = new Set(
      (await c.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
        [schemaName],
      )).rows.map((r) => r.table_name),
    );
    const missing = TABLES.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      console.log(`  SKIP — tabel belum ada di schema ini: ${missing.join(", ")}`);
      return;
    }

    // pre-check data: run AKTIF period+jenis ganda akan menggagalkan partial
    // unique index — laporkan agar dibersihkan manual (race pembuatan paralel
    // pra-migrasi; sandbox: 0 duplikat).
    const dup = await c.query<{ periodId: string; processTypeId: string; n: string }>(`
      SELECT "periodId", "processTypeId", count(*)::text AS n FROM "PayrollRun"
      WHERE "status" <> 'Cancelled'
      GROUP BY "periodId", "processTypeId" HAVING count(*) > 1 LIMIT 5`);
    if (dup.rowCount && dup.rowCount > 0) {
      console.warn(
        `  PERINGATAN — ${dup.rowCount} pasang (period × jenis) run AKTIF ganda terdeteksi ` +
        `(mis. period ${dup.rows[0]!.periodId} × type ${dup.rows[0]!.processTypeId} ×${dup.rows[0]!.n}); ` +
        `partial unique index mungkin gagal — batalkan run duplikat lalu jalankan ulang`,
      );
    }

    for (const [name, ddl] of INDEXES) {
      await c.query(ddl);
      console.log(`  ✓ ${name}`);
    }

    // verifikasi: semua index terdaftar di pg_indexes
    const idx = await c.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname = ANY($2)`,
      [schemaName, INDEXES.map(([n]) => n)],
    );
    console.log(`  verifikasi: ${idx.rowCount}/${INDEXES.length} index terdaftar di pg_indexes`);
  } finally {
    await c.end();
  }
}

export async function main(schemas?: { slug: string; schemaName: string }[]): Promise<void> {
  const list = schemas ?? (await activeTenantSchemas());
  for (const t of list) {
    await migrateSchema(t.schemaName, t.slug);
  }
  console.log(`\nDONE — index M-15 + partial unique M-20 diterapkan (idempoten) di ${list.length} tenant`);
  console.log("CATATAN: plain index M-15 juga ada di prisma/schema-tenant.prisma (tenant-ddl.sql");
  console.log("         sudah diregenerasi); partial unique M-20 TIDAK — wiring tenant baru di provisioning.ts.");
  console.log("SELESAI: step 'task43-indexes' kini terdaftar di PARITY_STEPS parity-runner.ts (43-e).");
}

// CLI guard — hanya auto-run saat dieksekusi langsung, bukan saat diimpor.
if (process.argv[1]?.replace(/\\/g, "/").includes("/scripts/")) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
