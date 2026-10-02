// RekanKerja — PARITY RUNNER (wave seed-remote, Task 30) =====================
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
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { WA_DEFAULT_TEMPLATES } from "@/rekankerja/shared/services/wa-defaults";

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
 *  (sama logika self-heal GET /api/rekankerja/wa-templates; edit admin aman). */
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
  // fix NaN: nilai uang terenkripsi non-finite ("NaN"/"Infinity" — sisa bug
  // encryptMoney pra-Task 50) ditulis ulang → 0; tanpa ini SATU baris buruk
  // membuat step travel-settlement gagal & parity.ok=false di tenant tsb.
  { key: "fix-nan-money", label: "Task 50-fix — perbaiki nilai uang terenkripsi non-finite (NaN → 0)", run: (s) => import("../../../../scripts/migrate-fix-nan-money").then((m) => m.main(s)) },
  // 52-a: cuti melahirkan/keguguran pekerja perempuan (UU 13/2003 Ps.82 +
  // UU KIA 4/2024 Ps.22) — 2 jenis cuti unit MONTH + gating gender di service.
  { key: "maternity-leave", label: "Task 52-a — jenis cuti CT-LAHIR-P & CT-GUGUR-P (melahirkan/keguguran, MONTH)", run: (s) => import("../../../../scripts/migrate-maternity-leave").then((m) => m.main(s)) },
  // 52-c: JKP (PP 6/2025) — REVISI F-01 BPA-AUDIT-53 (Task 54): struktur
  // iuran benar = 0% pekerja + 0,14% rekomposisi JKK (informatif) — versi
  // lama memasang potongan THP 0,24% + beban fiktif 0,22% (salah PP 6/2025
  // Ps.11). Nonaktifkan komponen lama + hapus item template DEFAULT/BS.
  { key: "jkp", label: "Task 52-c/F-01 — JKP PP 6/2025 Ps.11: 0% pekerja + rekomposisi JKK 0,14% (perbaiki instalasi 0,24%/0,22%)", run: (s) => import("../../../../scripts/migrate-jkp").then((m) => m.main(s)) },
  // 52-d: gelombang enkripsi PII lanjutan — no. BPJS, no. dokumen identitas,
  // diagnosis/perawatan medis (audit 51) → enc:v1:t (idempoten).
  { key: "encrypt-pii", label: "Task 52-d — enkripsi PII lanjutan: bpjsHealth/bpjsEmpSkill/docNumber/treatment", run: (s) => import("../../../../scripts/migrate-encrypt-pii").then((m) => m.main(s)) },
  // 52-f: kanal whistleblowing TPKS (UU 12/2022 Ps.22-24) — tabel
  // WhistleblowReport (CREATE IF NOT EXISTS + index, idempoten).
  { key: "whistleblow", label: "Task 52-f — tabel WhistleblowReport (kanal laporan TPKS)", run: (s) => import("../../../../scripts/migrate-whistleblow").then((m) => m.main(s)) },
  // Task 54 (BPA-AUDIT-53 "perbaiki semua"): F-02 tabel TER resmi PMK
  // 168/2023 (44/40/41 lapisan, max 34%) + F-07 cuti melahirkan 3+3 UU KIA
  // Ps.4(3)(a) + F-08 kutipan deskripsi + F-06 komponen PKWT_KOMP/PKWT_TAX.
  { key: "audit53", label: "Task 54/F-02 — tabel TER resmi PMK 168/2023 + cuti melahirkan 3+3 + PKWT final tax", run: (s) => import("../../../../scripts/migrate-audit53").then((m) => m.main(s)) },
  // Task 55: repair double-encryption PII (bug "direktori menampilkan
  // enc:v2:…"): buka lapisan ganda → tulis ulang satu lapis. Guard kini ada
  // di encryptText; langkah ini merapikan data historis pra-guard (idempoten).
  { key: "unwrap-double-enc", label: "Task 55 — buka enkripsi berlapis ganda (PII direktori enc:… mentah)", run: (s) => import("../../../../scripts/migrate-unwrap-double-enc").then((m) => m.main(s)) },
  // Task 57: pulihkan data uang MII yang tertimpa 0 oleh bug rerun parity
  // encrypt (kini diperbaiki) — idempoten, no-op bila data sudah utuh.
  { key: "restore-mii-payroll-money", label: "Task 57 — pulihkan nilai uang MII (baseSalary/komponen/run) pasca-bug rerun encrypt", run: (s) => import("../../../../scripts/restore-mii-payroll-money").then((m) => m.main(s)) },
  // Task 58-b: kolom platform Tenant.companyCode (form registrasi workspace).
  // Deploy lama tanpa `prisma db push` kehilangan DDL ini → prisma.tenant.create()
  // gagal "The column companyCode does not exist in the current database".
  // PLATFORM-level (bukan per-tenant) — dijalankan sekali per pipeline, idempoten.
  { key: "platform-company-code", label: "Task 58-b — DDL platform: kolom Tenant.companyCode (registrasi workspace)", run: () => import("../../../../scripts/migrate-platform-company-code").then((m) => m.main()) },
  // Task 63: tabel PayrollRunLog (log kejadian run payroll — parameter kurang/anomali).
  { key: "payroll-run-log", label: "Task 63 — tabel PayrollRunLog (log kejadian run payroll)", run: (s) => import("../../../../scripts/migrate-payroll-run-log").then((m) => m.main(s)) },
  { key: "wage-template-history", label: "Task 64 — riwayat template upah effective-dated + backfill", run: (s) => import("../../../../scripts/migrate-wage-template-history").then((m) => m.main(s)) },
  { key: "wage-component-prorate-basis", label: "Task 64b — basis prorata per komponen (kalender vs hari kerja)", run: (s) => import("../../../../scripts/migrate-wage-component-prorate-basis").then((m) => m.main(s)) },
  // Task 64k: idle timeout sesi per tenant — kolom PasswordPolicy.idleTimeoutMinutes
  // (0 = nonaktif). Append-only kronologis.
  { key: "password-idle-timeout", label: "Task 64k — kolom PasswordPolicy.idleTimeoutMinutes (idle timeout sesi per tenant)", run: (s) => import("../../../../scripts/migrate-password-idle-timeout").then((m) => m.main(s)) },
  // Task 64l: integritas schema tenant — heal tabel kritis yang hilang
  // (PasswordPolicy dll.) dari blok CREATE TABLE tenant-ddl.sql. Latar: tenant
  // demouser0229 cacat permanen (dibuat pra-Task 33 tanpa tabel policy).
  { key: "tenant-schema-integrity", label: "Task 64l — heal tabel kritis hilang (Employee/PayrollRun/PasswordPolicy/WorkSchedule)", run: (s) => import("../../../../scripts/migrate-tenant-schema-integrity").then((m) => m.main(s)) },
  { key: "checklist-tables", label: "Task 65 — tabel Onboarding/OnboardingTask + OffboardingTask.completedVia", run: (s) => import("../../../../scripts/migrate-checklist-tables").then((m) => m.main(s)) },
  // fix 89 (wave 1 medical): kolom MedicalClaim.prorateFactor + reversalOfId
  // (unique, storno) + MedicalClaimLine.providerId (master provider) + 2 FK.
  // Skip schema tanpa tabel medical (dibuat ensureMedicalReference).
  { key: "medical-wave1", label: "Fix 89 — wave 1 medical: prorateFactor/reversalOfId/providerId + FK", run: (s) => import("../../../../scripts/migrate-medical-wave1").then((m) => m.main(s)) },
  // fix 92 (wave 3 medical): kolom MedicalBenefitType.needLetter — G-2 surat
  // rujukan wajib per jenis benefit. Skip schema tanpa tabel medical.
  { key: "medical-wave3", label: "Fix 92 — wave 3 medical: MedicalBenefitType.needLetter (G-2 surat rujukan)", run: (s) => import("../../../../scripts/migrate-medical-wave3").then((m) => m.main(s)) },
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

    // Sekuensial (bukan Promise.all) — pg 8.23 deprecated mengantre >1 query
    // pada Client yang sama (warning "client is already executing a query").
    // Task 52 — rowSchemas: jumlah schema yang MEMUAT baris `where` pada `table`
    // (UNION ALL antar schema; nama schema dari registry internal — aman di-inline).
    const rowSchemas = async (table: string, whereSql: string): Promise<number> => {
      const union = schemas.map((sc) => `SELECT 1 FROM "${sc}"."${table}" WHERE ${whereSql}`).join(" UNION ALL ");
      try {
        const r = await c.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (${union}) t`);
        return r.rows[0]?.n ?? 0;
      } catch {
        return 0; // tabel belum ada → gap 0 (step DDL akan membuatnya)
      }
    };
    const q = async (sql: string): Promise<number> =>
      (await c.query<{ n: number }>(sql, [schemas])).rows[0]?.n ?? 0;
    const annOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'Announcement' AND table_schema = ANY($1::text[])`,
    );
    const encOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'PayrollRunLine' AND column_name = 'bruto' AND data_type = 'text'
         AND table_schema = ANY($1::text[])`,
    );
    const vaultOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'MoneyVault' AND table_schema = ANY($1::text[])`,
    );
    const vaultKeyOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'MoneyVault' AND column_name = 'dataKey' AND table_schema = ANY($1::text[])`,
    );
    const ptkpSrcOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'EmployeePayrollProfile' AND column_name = 'ptkpSource' AND table_schema = ANY($1::text[])`,
    );
    // Task 52-a/c/f — gap baru: jenis cuti perempuan, kolom JKP, tabel whistleblow.
    const maternityOk = await rowSchemas("LeaveType", `"code" = 'CT-LAHIR-P'`);
    const jkpOk = await rowSchemas("PayrollRegulation", `"jkpEmployeeRate" IS NOT NULL`);
    // Task 54 (BPA-AUDIT-53) — marker perbaikan: tabel TER resmi (lapisan ke-44
    // kategori A ada di tabel resmi saja), JKP struktur benar (pegawai 0%),
    // cuti melahirkan 3+3 (entitlement 3), PKWT_KOMP SeveranceFinal.
    const terOfficialOk = await rowSchemas("TerRate", `"category" = 'A' AND "lowerLimit" = 1400000000`);
    const terOldOk = await rowSchemas("TerRate", `"category" = 'A' AND "upperLimit" = 6350000`);
    const jkpFixedOk = await rowSchemas("PayrollRegulation", `"jkpEmployeeRate" = 0`);
    const maternity3Ok = await rowSchemas("LeaveType", `"code" = 'CT-LAHIR-P' AND "entitlement" = 3`);
    const pkwtFinalOk = await rowSchemas("WageComponent", `"code" = 'PKWT_KOMP' AND "incomeTaxMethod" = 'SeveranceFinal'`);
    const wbtOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'WhistleblowReport' AND table_schema = ANY($1::text[])`,
    );
    // Task 58-b — gap PLATFORM (bukan per-tenant): kolom Tenant.companyCode.
    // Kegagalan koneksi platform TIDAK boleh jadi false positive → anggap OK.
    let companyCodeOk = true;
    try {
      const cc = await platform.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'Tenant' AND column_name = 'companyCode'`;
      companyCodeOk = (cc[0]?.n ?? 0) > 0;
    } catch { /* platform DB tak terjangkau — jangan blokir parity */ }
    // Task 63 — tabel PayrollRunLog belum ada di schema mana pun = gap.
    const runLogOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'PayrollRunLog' AND table_schema = ANY($1::text[])`,
    );
    // Task 64 — riwayat template upah effective-dated: tabel belum ada = gap.
    const wageHistOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'EmployeeWageTemplateHistory' AND table_schema = ANY($1::text[])`,
    );
    // Task 52-d — kolom PII lanjutan: nilai plaintext tersisa = gap (sekuensial).
    const piiPlainOk =
      (await rowSchemas("Employee", `("bpjsHealth" IS NOT NULL AND "bpjsHealth" NOT LIKE 'enc:%') OR ("bpjsEmpSkill" IS NOT NULL AND "bpjsEmpSkill" NOT LIKE 'enc:%')`)) +
      (await rowSchemas("EmployeeDocument", `"docNumber" IS NOT NULL AND "docNumber" NOT LIKE 'enc:%'`)) +
      (await rowSchemas("MedicalClaimLine", `"treatment" IS NOT NULL AND "treatment" NOT LIKE 'enc:%'`));
    const reasons: string[] = [];
    if (annOk < schemas.length) reasons.push(`${schemas.length - annOk} tenant tanpa tabel Announcement (wave 27)`);
    if (encOk < schemas.length) reasons.push(`${schemas.length - encOk} tenant tanpa enkripsi kolom uang (wave 28-c)`);
    if (vaultOk < schemas.length) reasons.push(`${schemas.length - vaultOk} tenant tanpa tabel MoneyVault (Task 45-a)`);
    if (vaultKeyOk < schemas.length) reasons.push(`${schemas.length - vaultKeyOk} tenant tanpa kolom MoneyVault.dataKey (Task 47)`);
    if (ptkpSrcOk < schemas.length) reasons.push(`${schemas.length - ptkpSrcOk} tenant tanpa kolom EmployeePayrollProfile.ptkpSource (Task 49)`);
    if (maternityOk < schemas.length) reasons.push(`${schemas.length - maternityOk} tenant tanpa jenis cuti CT-LAHIR-P (Task 52-a)`);
    if (jkpOk < schemas.length) reasons.push(`${schemas.length - jkpOk} tenant tanpa kolom PayrollRegulation.jkpEmployeeRate (Task 52-c)`);
    // Task 54 (BPA-AUDIT-53) — gap perbaikan audit.
    if (terOldOk > 0) reasons.push(`${terOldOk} tenant masih memuat baris TER lama yang menyimpang (F-02)`);
    if (terOfficialOk < schemas.length) reasons.push(`${schemas.length - terOfficialOk} tenant tanpa tabel TER resmi PMK 168/2023 (F-02)`);
    if (jkpFixedOk < schemas.length) reasons.push(`${schemas.length - jkpFixedOk} tenant dengan jkpEmployeeRate ≠ 0 (F-01 — PP 6/2025 tanpa iuran pekerja)`);
    if (maternity3Ok < schemas.length) reasons.push(`${schemas.length - maternity3Ok} tenant cuti melahirkan belum 3+3 bersyarat (F-07)`);
    if (pkwtFinalOk < schemas.length) reasons.push(`${schemas.length - pkwtFinalOk} tenant PKWT_KOMP belum SeveranceFinal (F-06)`);
    if (piiPlainOk > 0) reasons.push(`${piiPlainOk} tenant dengan PII lanjutan masih plaintext (Task 52-d)`);
    if (wbtOk < schemas.length) reasons.push(`${schemas.length - wbtOk} tenant tanpa tabel WhistleblowReport (Task 52-f)`);
    if (!companyCodeOk) reasons.push("platform: kolom Tenant.companyCode belum ada (Task 58-b — registrasi workspace gagal)");
    if (runLogOk < schemas.length) reasons.push(`${schemas.length - runLogOk} tenant tanpa tabel PayrollRunLog (Task 63)`);
    if (wageHistOk < schemas.length) reasons.push(`${schemas.length - wageHistOk} tenant tanpa tabel EmployeeWageTemplateHistory (Task 64)`);
    // Task 64k — kolom PasswordPolicy.idleTimeoutMinutes belum ada = gap.
    // Penyebut = jumlah schema yang PUNYA tabel PasswordPolicy (tenant sampah
    // tanpa tabel tsb tidak pernah bisa punya kolom → jangan jadi gap permanen).
    const policyTableOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'PasswordPolicy' AND table_schema = ANY($1::text[])`,
    );
    const idleTimeoutOk = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'PasswordPolicy' AND column_name = 'idleTimeoutMinutes' AND table_schema = ANY($1::text[])`,
    );
    if (idleTimeoutOk < policyTableOk) reasons.push(`${policyTableOk - idleTimeoutOk} tenant tanpa kolom PasswordPolicy.idleTimeoutMinutes (Task 64k)`);
    // Task 64l — tabel kritis hilang di schema registry mana pun = gap (heal
    // dijalankan step tenant-schema-integrity; masih hilang → sisa gap terlapor).
    // Penyebut schemas.length penuh: schema cacat di-heal step 64l hingga lengkap,
    // sehingga tidak ada gap permanen seperti kasus tenant_demouser0229 dulu.
    for (const t of ["Employee", "PayrollRun", "PasswordPolicy", "WorkSchedule"]) {
      const have = await q(
        `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
         WHERE table_name = '${t}' AND table_schema = ANY($1::text[])`,
      );
      if (have < schemas.length) reasons.push(`${schemas.length - have} tenant tanpa tabel ${t} (Task 64l)`);
    }
    // fix 89 — wave 1 medical: penyebut = schema yang PUNYA tabel MedicalClaim
    // (instalasi pra-medical tidak pernah punya kolomnya → jangan gap permanen;
    // ensureMedicalReference membuat tabel lengkap saat modul dipakai).
    const medClaimTables = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'MedicalClaim' AND table_schema = ANY($1::text[])`,
    );
    const medWave1Ok = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'MedicalClaim' AND column_name = 'prorateFactor' AND table_schema = ANY($1::text[])`,
    );
    if (medWave1Ok < medClaimTables)
      reasons.push(`${medClaimTables - medWave1Ok} tenant tanpa kolom wave1 medical: prorateFactor/reversalOfId/providerId (fix 89)`);
    // fix 92 — wave 3 medical: MedicalBenefitType.needLetter (G-2). Penyebut =
    // schema yang punya tabel MedicalBenefitType (mirror pola wave1).
    const medTypeTables = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.tables
       WHERE table_name = 'MedicalBenefitType' AND table_schema = ANY($1::text[])`,
    );
    const medWave3Ok = await q(
      `SELECT COUNT(DISTINCT table_schema)::int AS n FROM information_schema.columns
       WHERE table_name = 'MedicalBenefitType' AND column_name = 'needLetter' AND table_schema = ANY($1::text[])`,
    );
    if (medWave3Ok < medTypeTables)
      reasons.push(`${medTypeTables - medWave3Ok} tenant tanpa kolom wave3 medical: MedicalBenefitType.needLetter (fix 92)`);
    return { gap: reasons.length > 0, reasons, tenants: schemas.length, readySchemas: Math.min(annOk, encOk, vaultOk, vaultKeyOk, ptkpSrcOk, maternityOk, jkpOk, terOfficialOk, jkpFixedOk, maternity3Ok, pkwtFinalOk, wbtOk, wageHistOk, idleTimeoutOk, medWave1Ok, medWave3Ok) };
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
