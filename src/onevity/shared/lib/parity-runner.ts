// OneVity — PARITY RUNNER (wave seed-remote, Task 30) =====================
// =========================================================================
// Menjalankan SELURUH migrasi idempoten pasca-7987fe8 secara IN-PROCESS
// (dynamic import — TANPA spawn bun) untuk SEMUA tenant di registry.
// Latar: deployment produksi onevity.sayone.my.id berjalan di bawah NODE
// (spawn "bun" gagal ENOENT) + DB lama — endpoint seed lama tidak bisa
// mengeksekusi apa pun. Runner ini menggantikan mekanisme itu:
//   1. src/instrumentation.ts — saat BOOT bila terdeteksi gap parity
//      (tenant ada, tapi tabel/kolom wave-26/27/28 belum lengkap) →
//      upgrade otomatis di latar belakang (pull → build → restart selesai).
//   2. POST /api/admin/seed-demo — pemicu manual (fire-and-forget) +
//      status via GET (logTail + laporan per langkah).
// Setiap langkah never-throw (gagal → dicatat, lanjut langkah berikutnya);
// semua migrasi sumber tunggal di scripts/ (diekspor sebagai main(schemas?)).
// Urutan = urutan historis commit (dependensi DDL → seed; enkripsi PALING
// AKHIR sebelum travel-settlement-fix yang menulis amount terenkripsi).
import { Client } from "pg";
import { db as platform } from "@/lib/db";
import { getTenantClient } from "@/onevity/shared/lib/tenant-db";
import { WA_DEFAULT_TEMPLATES } from "@/onevity/shared/services/wa-defaults";

const TENANT_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

export type ParityStepResult = {
  key: string;
  label: string;
  ok: boolean;
  ms: number;
  error?: string;
};

export type ParityReport = {
  schemas: string[];
  steps: ParityStepResult[];
  ok: boolean;
  finishedAt: string;
  remainingGap?: string[];
};

export type ParityGap = {
  gap: boolean;
  reasons: string[];
  tenants: number;
  readySchemas: number;
};

type Step = { key: string; label: string; run: (schemas: string[]) => Promise<void> };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Adapter skrip migrasi task-41/43: main() mereka menerima
 *  {slug, schemaName}[] (hasil query registry), sedangkan runner bekerja
 *  dengan string[] schemaName — slug hanya untuk label log (derivation sama
 *  dengan fallback skrip). */
const withSlugs = (schemas: string[]) =>
  schemas.map((schemaName) => ({
    slug: schemaName.replace(/^tenant_/, "").replace(/_/g, "-"),
    schemaName,
  }));

/** Registry tenant → daftar schemaName (urut nama schema agar log stabil). */
export async function tenantSchemas(): Promise<string[]> {
  const tenants = await platform.tenant.findMany({ select: { schemaName: true } });
  return tenants
    .map((t) => t.schemaName)
    .filter((s): s is string => !!s)
    .sort();
}

// ============ langkah inline kecil (tidak layak jadi file skrip) ============

/** Seed template WhatsApp default per tenant — upsert insert-if-missing
 *  (sama logika self-heal GET /api/onevity/wa-templates; edit admin aman). */
async function seedWaTemplates(schemas: string[]): Promise<void> {
  for (const schema of schemas) {
    const db = getTenantClient(schema);
    try {
      for (const t of WA_DEFAULT_TEMPLATES) {
        await db.waTemplate.upsert({
          where: { event: t.event },
          update: {},
          create: { event: t.event, label: t.label, active: t.active, body: t.body },
        });
      }
      console.log(`[${schema}] template WhatsApp: ${WA_DEFAULT_TEMPLATES.length} default terpasang (insert-if-missing)`);
    } finally {
      await db.$disconnect();
    }
  }
}

/** Demo tukar shift MII — 1 permintaan Pending (TSK-0001) bila belum ada,
 *  agar halaman Tukar Shift admin/ESS tidak kosong pada deployment demo.
 *  (Kasus Approved/Rejected ditinggalkan sebagai interaksi demo nyata.) */
async function seedSwapDemo(schemas: string[]): Promise<void> {
  const MII = "tenant_pt_mitra_industri_internasional";
  if (!schemas.includes(MII)) return;
  const db = getTenantClient(MII);
  try {
    const existing = await db.shiftSwapRequest.findFirst({ where: { code: "TSK-0001" } });
    if (existing) {
      console.log(`[${MII}] demo tukar shift: TSK-0001 sudah ada — skip`);
      return;
    }
    const requester = await db.employee.findUnique({ where: { employeeNo: "MII00010" } });
    const target = await db.employee.findUnique({ where: { employeeNo: "MII00018" } });
    if (!requester || !target) {
      console.log(`[${MII}] demo tukar shift: karyawan MII00010/MII00018 tidak ada — skip`);
      return;
    }
    const swapDate = new Date();
    swapDate.setUTCHours(0, 0, 0, 0);
    swapDate.setUTCDate(swapDate.getUTCDate() + 7);
    await db.shiftSwapRequest.create({
      data: {
        code: "TSK-0001",
        requesterId: requester.id,
        targetId: target.id,
        swapDate,
        reason: "Urusan keluarga di luar kota — bersedia mengganti jadwal pasangan kapan pun bulan ini.",
        status: "Pending",
      },
    });
    console.log(`[${MII}] demo tukar shift: TSK-0001 (Pending, MII00010 → MII00018) dibuat`);
  } finally {
    await db.$disconnect();
  }
}

// ============ definisi langkah (urutan dependensi) ============

const STEPS: Step[] = [
  // Urutan: DDL kolom Employee (contractStart/End, renewalCount) HARUS lebih
  // dulu — Prisma update/findUnique full-row pada Employee membutuhkan SEMUA
  // kolom model ada (RETURNING seluruh baris → P2022 bila kolom belum dibuat).
  { key: "p0-wave1", label: "LetterRequest/MinimumWage/PKWT/slipPassword", run: (s) => import("../../../../scripts/migrate-p0-wave1").then((m) => m.main(s)) },
  { key: "approval-structure", label: "Struktur approval berjenjang (+WorkOff)", run: (s) => import("../../../../scripts/migrate-approval-structure").then((m) => m.main(s)) },
  { key: "ess", label: "ESS — tabel Notification + tautan karyawan", run: (s) => import("../../../../scripts/migrate-ess").then((m) => m.main(s)) },
  { key: "holidays", label: "Kalender libur nasional 2025/2026", run: (s) => import("../../../../scripts/migrate-holidays").then((m) => m.main(s)) },
  { key: "t5-ta", label: "Kolom AttendanceDaily.paidFlag", run: (s) => import("../../../../scripts/migrate-t5-ta").then((m) => m.main(s)) },
  { key: "t15-ot-claim", label: "Lembur + klaim travel masuk approval berjenjang", run: (s) => import("../../../../scripts/migrate-t15-ot-claim").then((m) => m.main(s)) },
  { key: "api-webhook", label: "Tabel ApiKey / Webhook / WebhookLog", run: (s) => import("../../../../scripts/migrate-api-webhook").then((m) => m.main(s)) },
  { key: "attachments", label: "Tabel Attachment / EmployeeDocument", run: (s) => import("../../../../scripts/migrate-attachments").then((m) => m.main(s)) },
  { key: "letters-offboarding", label: "Template surat + offboarding + NPWP kantor", run: (s) => import("../../../../scripts/migrate-letters-offboarding").then((m) => m.main(s)) },
  { key: "resync-letters", label: "Resync template surat (aman-edit)", run: (s) => import("../../../../scripts/resync-letter-templates").then((m) => m.main(s)) },
  { key: "p0-wave2", label: "Validasi UMP/UMK 2026 + seed PKWT", run: (s) => import("../../../../scripts/migrate-p0-wave2").then((m) => m.main(s)) },
  { key: "email-config", label: "Template email default (+lembur & scheduler)", run: (s) => import("../../../../scripts/migrate-email-config").then((m) => m.main(s)) },
  { key: "wave27", label: "Wave 27/28 — 10 tabel + geofence + demo (pengumuman/aset)", run: (s) => import("../../../../scripts/migrate-wave27").then((m) => m.main(s)) },
  { key: "wa-templates", label: "Template WhatsApp default", run: (s) => seedWaTemplates(s) },
  { key: "swap-demo", label: "Demo tukar shift (TSK-0001 Pending)", run: (s) => seedSwapDemo(s) },
  { key: "encrypt", label: "Enkripsi NIK/NPWP/rekening + nilai uang payroll (16 kolom)", run: (s) => import("../../../../scripts/migrate-encrypt").then((m) => m.main(s)) },
  // M-8 (audit 42 / Task 44): gelombang enkripsi kedua — 38 kolom uang modul
  // claim (loan/benefit/leave-encashment/medical/travel). Append-only kronologis.
  { key: "encrypt-money", label: "M-8 — enkripsi uang claim: loan/benefit/encashment/medical/travel (38 kolom)", run: (s) => import("../../../../scripts/migrate-encrypt-money").then((m) => m.main(s)) },
  { key: "travel-settlement", label: "Fix settlement travel (pasca-enkripsi)", run: (s) => import("../../../../scripts/migrate-travel-settlement-fix").then((m) => m.main(s)) },
  { key: "component-rules", label: "Task 32 — tabel WageComponentRule + aturan diferensiasi besaran", run: (s) => import("../../../../scripts/migrate-component-rules").then((m) => m.main(s)) },
  { key: "entity-rules", label: "Task 33 — 4 tabel rule leave/medical/travel/benefit + aturan demo", run: (s) => import("../../../../scripts/migrate-entity-rules").then((m) => m.main(s)) },
  // K-6 (audit 42): migrasi task 41 + task 43 sebelumnya HANYA skrip manual —
  // fresh deploy prod melewatkannya (panel Webhook 500: kolom retry WebhookLog
  // tidak ada). Ditambahkan append-only (urutan kronologis commit).
  { key: "scheduler-race", label: "Task 41 — index dedupe Reminder ActivityLog (scheduler race-safe)", run: (s) => import("../../../../scripts/migrate-scheduler-race").then((m) => m.main(withSlugs(s))) },
  { key: "webhook-retry", label: "Task 41 — kolom retry WebhookLog (attempts/nextRetryAt/lastError)", run: (s) => import("../../../../scripts/migrate-webhook-retry").then((m) => m.main(withSlugs(s))) },
  { key: "task43-indexes", label: "Task 43 — index payroll/klaim + unique run aktif (M-15+M-20)", run: (s) => import("../../../../scripts/migrate-task43-indexes").then((m) => m.main(withSlugs(s))) },
  // 45-a: Money Vault — tabel MoneyVault + MoneyViewGrant (gerbang visibilitas
  // nilai uang terenkripsi per tenant; setup vault sendiri via API admin).
  // Task 47: ALTER ADD COLUMN dataKey (kunci enkripsi kata sandi perusahaan).
  // Append-only kronologis (urutan commit).
  { key: "money-vault", label: "Task 45-a/47 — tabel MoneyVault (+kolom dataKey) + MoneyViewGrant", run: (s) => import("../../../../scripts/migrate-money-vault").then((m) => m.main(s)) },
  // 49: PTKP otomatis dari data keluarga — kolom ptkpSource (auto|manual);
  // sinkronisasi data (bukan DDL) terjadi via API/scheduler, bukan di sini.
  { key: "ptkp-auto", label: "Task 49 — kolom EmployeePayrollProfile.ptkpSource (PTKP otomatis dari keluarga)", run: (s) => import("../../../../scripts/migrate-ptkp-auto").then((m) => m.main(s)) },
];

// ============ deteksi gap (murah — 3 query information_schema) ============

/**
 * Gap parity terdeteksi bila ada tenant yang belum punya tabel "Announcement"
 * (wave 27) ATAU kolom PayrollRunLine.bruto belum TEXT (wave 28-c enkripsi)
 * ATAU tabel "MoneyVault" belum ada (Task 45-a — FIX Task 46: restore-demo/
 * seed fresh + tenant-ddl.sql lama tidak memuat tabel vault → setup kata
 * sandi enkripsi uang 500 "table does not exist")
 * ATAU kolom MoneyVault.dataKey belum ada (Task 47 — kunci enkripsi kata
 * sandi perusahaan; instalasi pra-47 tanpa kolom → setup/ganti sandi gagal)
 * ATAU kolom EmployeePayrollProfile.ptkpSource belum ada (Task 49 — PTKP
 * otomatis dari data keluarga; tanpa kolom → PATCH payroll-profiles gagal).
 * Dipakai instrumentation saat boot — false positif hanya menyebabkan rerun
 * migrasi idempoten (aman).
 */
export async function checkParityGap(): Promise<ParityGap> {
  const schemas = await tenantSchemas();
  if (schemas.length === 0) {
    return { gap: false, reasons: ["belum ada tenant — jalur fresh-seed (restore-demo)"], tenants: 0, readySchemas: 0 };
  }
  const c = new Client({ connectionString: TENANT_URL() });
  await c.connect();
  try {
    const [ann, bruto, vault, vaultKey, ptkpSrc] = await Promise.all([
      c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
         WHERE table_name = 'Announcement' AND table_schema = ANY($1::text[])`,
        [schemas],
      ),
      c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
         WHERE table_name = 'PayrollRunLine' AND column_name = 'bruto' AND data_type = 'text'
           AND table_schema = ANY($1::text[])`,
        [schemas],
      ),
      c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
         WHERE table_name = 'MoneyVault' AND table_schema = ANY($1::text[])`,
        [schemas],
      ),
      c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
         WHERE table_name = 'MoneyVault' AND column_name = 'dataKey' AND table_schema = ANY($1::text[])`,
        [schemas],
      ),
      c.query<{ n: number }>(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
         WHERE table_name = 'EmployeePayrollProfile' AND column_name = 'ptkpSource' AND table_schema = ANY($1::text[])`,
        [schemas],
      ),
    ]);
    const annOk = ann.rows[0]?.n ?? 0;
    const encOk = bruto.rows[0]?.n ?? 0;
    const vaultOk = vault.rows[0]?.n ?? 0;
    const vaultKeyOk = vaultKey.rows[0]?.n ?? 0;
    const ptkpSrcOk = ptkpSrc.rows[0]?.n ?? 0;
    const reasons: string[] = [];
    if (annOk < schemas.length) reasons.push(`${schemas.length - annOk} tenant tanpa tabel Announcement (wave 27)`);
    if (encOk < schemas.length) reasons.push(`${schemas.length - encOk} tenant tanpa enkripsi kolom uang (wave 28-c)`);
    if (vaultOk < schemas.length) reasons.push(`${schemas.length - vaultOk} tenant tanpa tabel MoneyVault (Task 45-a)`);
    if (vaultKeyOk < schemas.length) reasons.push(`${schemas.length - vaultKeyOk} tenant tanpa kolom MoneyVault.dataKey (Task 47)`);
    if (ptkpSrcOk < schemas.length) reasons.push(`${schemas.length - ptkpSrcOk} tenant tanpa kolom EmployeePayrollProfile.ptkpSource (Task 49)`);
    return { gap: reasons.length > 0, reasons, tenants: schemas.length, readySchemas: Math.min(annOk, encOk, vaultOk, vaultKeyOk, ptkpSrcOk) };
  } finally {
    await c.end();
  }
}

// ============ runner ============

let running = false;
let lastReport: ParityReport | null = null;

export function parityRunnerStatus() {
  return { running, lastReport };
}

/**
 * Jalankan seluruh pipeline parity IN-PROCESS untuk semua tenant registry.
 * Per-langkah never-throw; laporan lengkap dikembalikan (dan tersimpan di
 * parityRunnerStatus() untuk endpoint status). Setelah selesai, gap dicek
 * ulang — bila masih ada, alasan dilaporkan (ok=false).
 */
export async function runParityPipeline(log: (line: string) => void = (l) => console.log(`[parity] ${l}`)): Promise<ParityReport> {
  if (running) throw new Error("Pipeline parity masih berjalan — tunggu hingga selesai.");
  running = true;
  try {
    const schemas = await tenantSchemas();
    if (schemas.length === 0) {
      const report: ParityReport = { schemas, steps: [], ok: false, finishedAt: new Date().toISOString(), remainingGap: ["belum ada tenant — gunakan restore-demo (fresh install)"] };
      lastReport = report;
      log("belum ada tenant — tidak ada yang bisa diparity (jalankan restore-demo untuk fresh install).");
      return report;
    }
    log(`mulai: ${schemas.length} tenant → ${schemas.join(", ")}`);
    // Task 47: muat dataKey vault (kunci kata sandi perusahaan) tiap schema
    // SEBELUM langkah enkripsi — skrip migrate-encrypt* menulis nilai baru
    // dengan kunci aktif (v2 vault bila sudah dikonfigurasi, else v1).
    const { primeTenantCrypto } = await import("./field-crypto");
    for (const schema of schemas) {
      await primeTenantCrypto(schema).catch(() => {});
    }
    const steps: ParityStepResult[] = [];
    for (const step of STEPS) {
      const t0 = Date.now();
      try {
        await step.run(schemas);
        const ms = Date.now() - t0;
        steps.push({ key: step.key, label: step.label, ok: true, ms });
        log(`✓ ${step.label} (${(ms / 1000).toFixed(1)}s)`);
      } catch (e) {
        const ms = Date.now() - t0;
        steps.push({ key: step.key, label: step.label, ok: false, ms, error: msg(e) });
        log(`✗ ${step.label} GAGAL: ${msg(e)} — lanjut ke langkah berikutnya`);
      }
    }
    const gap = await checkParityGap().catch((e) => ({ gap: true, reasons: [`cek gap gagal: ${msg(e)}`], tenants: schemas.length, readySchemas: 0 }) as ParityGap);
    const ok = steps.every((r) => r.ok) && !gap.gap;
    const report: ParityReport = { schemas, steps, ok, finishedAt: new Date().toISOString(), remainingGap: gap.gap ? gap.reasons : undefined };
    lastReport = report;
    if (gap.gap) log(`SELESAI dengan sisa gap: ${gap.reasons.join("; ")}`);
    else log(`SELESAI — ${schemas.length} tenant paritas penuh (${steps.length} langkah).`);
    return report;
  } finally {
    running = false;
  }
}
