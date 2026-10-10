// RekanKerja — BACKGROUND JOB SCHEDULER (T14-SCHED) ============================
// =====================================================================
// Scheduler latar belakang lintas tenant, dijalankan dari instrumentation
// Next.js (register()) — satu siklus tiap 6 jam (+ run pertama 60 detik
// setelah server siap). Loop:
//   list Tenant ACTIVE (platform db) → per tenant getTenantClient(schema)
//   → jalankan 6 job ringan (try/catch per tenant — gagal 1 tenant tidak
//   menghentikan tenant lain).
//
// Guard:
// - hanya runtime nodejs; tidak saat `next build` (phase-production-build)
// - matikan via env SCHEDULER=off
// - anti-tumpang-tindih INTRA-proses: flag `running` (di globalThis, tahan
//   reload modul dev)
// - T41-M10 anti-tumpang-tindih ANTAR-proses (PM2 cluster / beberapa dev
//   server): tiap job per tenant dipagari pg_try_advisory_lock dengan key
//   deterministik hash(jobId, schema) — proses yang kalah SKIP job itu
//   siklus ini; plus dedupe Reminder atomik ON CONFLICT (partial unique
//   index ActivityLog, DDL scripts/migrate-scheduler-race.ts) sehingga
//   notifikasi/email pengingat tidak dobel.
// - timer setInterval/setTimeout di-unref() → tidak menahan proses exit
//
// Delapan job (semua fire-and-forget, idempoten, defensif — tabel opsional
// yang belum termigrasi di tenant → catch & skip senyap):
//   a. resign-terjadwal : Employee Active + endDate < hari ini → status
//      Terminated/Resigned (PA-aware) + ActivityLog (fix audit HR: resign
//      terjadwal yang tidak pernah dinonaktifkan).
//   b. kontrak/probation: endDate 30/60/90 hari ke depan (band, sekali per
//      band) + probation evaluasi 90 hari dari joinDate → email Admin/HR
//      + notifikasi. DEDUPE via ActivityLog key reminder:contract:{id}:{band}.
//   c. dokumen kedaluwarsa: EmployeeDocument expiresAt ≤ 30 hari → email +
//      notifikasi HR & karyawan (tabel T16 opsional → skip senyap).
//   d. SLA approval    : ApprovalChain InProgress menunggu > 3 hari di
//      step Current → email + notifikasi ke approver jenjang berjalan.
//      Dedupe per hari.
//   e. payroll D-3     : PayrollPeriod aktif payday ≤ 3 hari tanpa run
//      Confirmed → notifikasi + email Admin/HR. Dedupe per hari.
//   f. housekeeping    : Notification lebih tua dari 180 hari dihapus.
//   g. webhook-retry    : T41-M14 — WebhookLog status 'failed' & jatuh tempo
//      (backoff 5m/30m/2h/6h/24h, maks 5 percobaan) dikirim ulang; sukses →
//      delivered, percobaan ke-5 gagal → dead.
//
// Setiap siklus menulis SATU baris ringkasan ActivityLog per tenant
// (action "Scheduled", entity "Scheduler", detail "n job, n notifikasi")
// — pengingat individual tercatat sebagai baris "Reminder" sekaligus
// menjadi penanda dedupe.
// =====================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, type TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { DEFAULT_TEMPLATES_PLACEHOLDER } from "@/rekankerja/shared/services/email-defaults";
import { notifyEmailEvent, type EmailRecipient } from "@/rekankerja/shared/services/email-service";
import { notifyEvent, pushNotification } from "@/rekankerja/shared/services/notification-service";
import { retryFailedWebhookDeliveries } from "@/rekankerja/shared/services/webhook-service";

// ---------- konstanta & env flag ----------

const DAY_MS = 86_400_000;

/** Interval siklus default (jam) — override env SCHEDULER_INTERVAL_HOURS. */
const DEFAULT_INTERVAL_HOURS = 6;
/** Delay run pertama default (ms) — override env SCHEDULER_FIRST_DELAY_MS. */
const DEFAULT_FIRST_DELAY_MS = 60_000;

/** Band ambang pengingat kontrak (hari, ASC — band TERKECIL yang ≥ sisa
 *  hari dipakai; satu pengingat per band per karyawan: 30 → 60 → 90). */
const CONTRACT_BANDS = [30, 60, 90] as const;
/** Lama evaluasi probation (hari) sejak joinDate. */
const PROBATION_EVAL_DAYS = 90;
/** Jendela pengingat dokumen kedaluwarsa (hari). */
const DOC_EXPIRY_WINDOW_DAYS = 30;
/** SLA persetujuan (hari) — reminder saat melewati ambang ini. */
const APPROVAL_SLA_DAYS = 3;
/** Payroll D-3 — reminder saat payday ≤ jumlah hari ini. */
const PAYROLL_D_DAYS = 3;

// ---------- Task 100 (G4, audit A-02/C-05): konstanta job attendance ----------

/** Jam lokal mulai jendela pengingat clock-out (17:00–23:59, 1×/hari/karyawan). */
const CLOCKOUT_REMINDER_FROM_HOUR = 17;
/** Lembur Approved menunggu verifikasi lebih dari jumlah hari ini → aging. */
const OT_AGING_DAYS = 3;
/** Tanggal bulanan jendela pengingat transfer TA (menjelang akhir bulan). */
const TRANSFER_REMINDER_DAYS = [25, 26, 27, 28] as const;
/** Jendela TA berakhir ≤ jumlah hari ini → ingatkan transfer absensi. */
const TA_TRANSFER_D_DAYS = 3;
/** Retensi notifikasi (hari) untuk housekeeping. */
const NOTIFICATION_RETENTION_DAYS = 180;

/** Role AppUser yang dianggap tim Admin/HR (penerima pengingat scheduler). */
const HR_ROLES = ["Admin", "HR Manager", "HR Staff"];

/** Label jenis dokumen ApprovalChain (judul pengingat SLA). */
const DOC_TYPE_LABEL: Record<string, string> = {
  Leave: "Cuti",
  WorkOff: "Izin Absen",
  Travel: "Perjalanan Dinas",
  Medical: "Klaim Medis",
  Overtime: "Lembur",
  RecruitmentPR: "Permintaan Karyawan (PR)",
};

/** Status period payroll yang masih "aktif" (belum diproses/ditutup). */
const ACTIVE_PERIOD_STATUSES = ["Open"];

// ---------- state global (tahan reload modul dev) ----------

interface SchedulerGlobalState {
  running: boolean;
  handle?: {
    interval: ReturnType<typeof setInterval>;
    first: ReturnType<typeof setTimeout>;
    startedAt: Date;
    cycles: number;
  };
}

const globalForScheduler = globalThis as unknown as {
  __rekankerjaSchedulerState?: SchedulerGlobalState;
};
const schedulerState: SchedulerGlobalState =
  globalForScheduler.__rekankerjaSchedulerState ?? { running: false };
globalForScheduler.__rekankerjaSchedulerState = schedulerState;

// ---------- T41-M10: mutex antar-proses per (job, tenant) ----------
// Flag `running` hanya menghalangi tumpang tindih dalam SATU proses; di PM2
// cluster / multi-server semua worker menjalankan siklus bersamaan. Tiap job
// per tenant kini dipagari advisory lock PostgreSQL (pg_try_advisory_lock)
// dengan key BIGINT deterministik = FNV-1a 32-bit dari `${jobId}:${schema}`
// — proses yang kalah race mendapat false → SKIP job itu siklus ini (pekerja
// lain sedang menjalankannya). Pola advisory lock merujuk journal-no.ts;
// di sini memakai pg Client DEDICATED + unlock eksplisit karena job tidak
// berjalan dalam satu transaksi tunggal. Koneksi selalu ditutup di finally.

const SCHEDULER_DB_URL = () =>
  process.env.TENANT_DB_BASE_URL ?? "postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity";

/** Hash FNV-1a 32-bit → string desimal (key advisory lock deterministik). */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return String(h >>> 0);
}

/**
 * Jalankan `fn` hanya bila advisory lock (jobId, schema) berhasil direbut;
 * mengembalikan { ran: false } bila proses lain sedang memegangnya (skip).
 * Galat membuka kunci (pg tak terjangkau dsb.) → degradasi ke perilaku lama:
 * job tetap dijalankan TANPA mutex (dedupe Reminder ON CONFLICT tetap
 * menahan baris ganda). Error dari `fn` sendiri dibiarkan propagate —
 * dibungkus safe() try/catch per job seperti sebelumnya (never-throw).
 */
async function withJobMutex(schema: string, jobId: string, fn: () => Promise<void>): Promise<{ ran: boolean }> {
  const key = fnv1a32(`${jobId}:${schema}`);
  let client: Client | null = null;
  let acquired = false;
  let skip = false;
  try {
    client = new Client({ connectionString: SCHEDULER_DB_URL() });
    await client.connect();
    const r = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS ok",
      [key],
    );
    acquired = r.rows[0]?.ok === true;
    if (!acquired) skip = true; // proses lain sedang menjalankan job ini
  } catch {
    // tanpa kunci → jalankan tanpa mutex (jangan matikan scheduler)
  }
  try {
    if (!skip) await fn();
  } finally {
    if (client) {
      try {
        if (acquired) await client.query("SELECT pg_advisory_unlock($1::bigint)", [key]);
      } catch { /* best-effort unlock */ }
      try { await client.end(); } catch { /* ignore */ }
    }
  }
  return { ran: !skip };
}

// ---------- util kecil ----------

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Selisih hari (pembulatan) dari `from` menuju `to`, keduanya di-normalisasi. */
function daysUntil(to: Date, from: Date = new Date()): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** Tanggal format YYYY-MM-DD (gaya data demo). */
function fmtDate(d: Date | null | undefined): string {
  return d ? startOfDay(d).toISOString().slice(0, 10) : "-";
}

/** Kunci hari (YYYY-MM-DD) untuk dedupe per-hari. */
function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- ActivityLog: ringkasan + dedupe ----------

async function writeActivity(
  db: TenantDb,
  data: { action: string; entity: string; entityId?: string | null; employeeId?: string | null; detail: string },
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        actorType: "system",
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        employeeId: data.employeeId ?? null,
        detail: data.detail,
      },
    });
  } catch {
    // tabel/kolom belum termigrasi → scheduler tetap lanjut (never-throw)
  }
}

/**
 * KLAIM pengingat secara atomik (INSERT … ON CONFLICT DO NOTHING — satu
 * statement): mengembalikan true bila kunci dedupe BARU ditanam (pemanggil
 * boleh mengirim), false bila sudah diklaim / gagal insert.
 * T41-M10: race antar-proses (PM2 cluster / dev server + skrip manual) kini
 * ditahan DATABASE — partial unique index "ActivityLog_dedu_reminder"
 * ON ("action","entity","entityId") WHERE "entityId" IS NOT NULL AND
 * "action" = 'Reminder' (DDL: scripts/migrate-scheduler-race.ts; tenant baru
 * via provisioning — index partial TIDAK bisa diekspresikan di Prisma).
 * Index hanya menahan baris Reminder — ActivityLog bisnis lain (mis.
 * "Employee/Updated" berulang) tidak terpengaruh. Bila index belum ada di
 * tenant (pra-migrasi) → fallback jalur lama WHERE NOT EXISTS (best-effort).
 * Baris klaim sekaligus jejak audit "Reminder" (entity "Scheduler").
 */
async function claimReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  const id = randomUUID();
  try {
    const n = await db.$executeRaw`
      INSERT INTO "ActivityLog" ("id","actorType","action","entity","entityId","employeeId","personnelActionId","detail","createdAt")
      SELECT ${id}, 'system', 'Reminder', 'Scheduler', ${key}, NULL, NULL, ${detail}, now()
      ON CONFLICT ("action","entity","entityId") WHERE "entityId" IS NOT NULL AND "action" = 'Reminder'
      DO NOTHING`;
    return n === 1;
  } catch {
    // Partial index belum terpasang di schema tenant ini → jalur lama
    // (race jendela mikrodetik — tetap lebih baik daripada tidak mengingatkan).
    try {
      const n = await db.$executeRaw`
        INSERT INTO "ActivityLog" ("id","actorType","action","entity","entityId","employeeId","personnelActionId","detail","createdAt")
        SELECT ${id}, 'system', 'Reminder', 'Scheduler', ${key}, NULL, NULL, ${detail}, now()
        WHERE NOT EXISTS (
          SELECT 1 FROM "ActivityLog" WHERE action = 'Reminder' AND entity = 'Scheduler' AND "entityId" = ${key}
        )`;
      return n === 1;
    } catch {
      return false; // tabel/kolom belum termigrasi → anggap sudah diklaim (skip)
    }
  }
}

// ---------- penerima email / self-heal template ----------

/** Email tim Admin/HR tenant (penerima pengingat kontrak/probation/payroll). */
async function hrRecipients(db: TenantDb): Promise<EmailRecipient[]> {
  try {
    const users = await db.appUser.findMany({
      where: { active: true, role: { in: HR_ROLES }, email: { not: null } },
      orderBy: { username: "asc" },
      select: { email: true, fullName: true },
      take: 10,
    });
    return users
      .filter((u): u is { email: string; fullName: string } => Boolean(u.email))
      .map((u) => ({ email: u.email, name: u.fullName }));
  } catch {
    return [];
  }
}

/** Email approver (Employee.email via approverEmployeeId) — fallback tim HR. */
async function approverRecipients(db: TenantDb, approverEmployeeId: string | null): Promise<EmailRecipient[]> {
  if (approverEmployeeId) {
    try {
      const emp = await db.employee.findUnique({
        where: { id: approverEmployeeId },
        select: { email: true, fullName: true },
      });
      if (emp?.email) return [{ email: emp.email, name: emp.fullName }];
    } catch {
      // lanjut ke fallback
    }
  }
  return hrRecipients(db);
}

const SCHEDULER_TEMPLATE_EVENTS = [
  "scheduler.contract-expiry",
  "scheduler.doc-expiry",
  "scheduler.approval-sla",
  "scheduler.payroll-reminder",
] as const;

/**
 * Self-heal: pastikan 4 template scheduler ada di EmailTemplate tenant
 * (idempoten — tidak menimpa suntingan admin; create hanya bila belum ada).
 */
async function ensureSchedulerTemplates(db: TenantDb): Promise<number> {
  let seeded = 0;
  for (const event of SCHEDULER_TEMPLATE_EVENTS) {
    try {
      const existing = await db.emailTemplate.findUnique({ where: { event }, select: { event: true } });
      if (existing) continue;
      const def = DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event);
      if (!def) continue;
      await db.emailTemplate.create({
        data: {
          event: def.event,
          label: def.label,
          notifyEmployee: def.notifyEmployee,
          notifyApprover: def.notifyApprover,
          notifyHrd: def.notifyHrd,
          subject: def.subject,
          body: def.body,
        },
      });
      seeded++;
    } catch {
      // tabel EmailTemplate belum termigrasi → email fallback generik, lanjut
    }
  }
  return seeded;
}

/** Cek kolom opsional di schema tenant (current_schema = schema tenant klien). */
async function columnExists(db: TenantDb, table: string, column: string): Promise<boolean> {
  try {
    const rows = await db.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${column}
      ) AS present`;
    return rows[0]?.present === true;
  } catch {
    return false;
  }
}

// ---------- JOB a: resign terjadwal menggantung (fix audit HR) ----------

/**
 * Employee status Active dengan endDate < hari ini → nonaktifkan.
 * Status keluar mengikuti PersonnelAction terkait bila ada
 * (Resignation/Retirement → Resigned, Termination → Terminated),
 * default Terminated. Catatan keputusan tercatat di ActivityLog.
 * Idempoten: filter status Active — karyawan yang sudah diproses tak diproses ulang.
 */
async function jobScheduledResignations(db: TenantDb): Promise<number> {
  const today = startOfDay(new Date());
  const pending = await db.employee.findMany({
    where: { status: "Active", endDate: { lt: today } },
    select: { id: true, employeeNo: true, fullName: true, endDate: true },
    take: 200,
  });
  let done = 0;
  for (const emp of pending) {
    if (!emp.endDate) continue;
    // PA terkait (bila resign terjadwal dibuat lewat Personnel Action)
    let pa: { type: string; docNo: string } | null = null;
    try {
      pa = await db.personnelAction.findFirst({
        where: {
          employeeId: emp.id,
          type: { in: ["Resignation", "Termination", "Retirement"] },
          status: "Processed",
        },
        orderBy: { processedAt: "desc" },
        select: { type: true, docNo: true },
      });
    } catch {
      pa = null;
    }
    const exitStatus =
      pa?.type === "Resignation" || pa?.type === "Retirement" ? "Resigned" : "Terminated";
    try {
      await db.employee.update({ where: { id: emp.id }, data: { status: exitStatus } });
    } catch {
      continue; // gagal update satu karyawan → lanjut karyawan berikutnya
    }
    await writeActivity(db, {
      action: exitStatus,
      entity: "Employee",
      entityId: emp.id,
      employeeId: emp.id,
      detail:
        `Resign terjadwal otomatis oleh scheduler — ${emp.fullName} (${emp.employeeNo}) ` +
        `Active→${exitStatus}, tanggal akhir ${fmtDate(emp.endDate)}` +
        (pa ? ` (PA ${pa.docNo} ${pa.type})` : ""),
    });
    done++;
  }
  return done;
}

// ---------- JOB b: pengingat kontrak & probation ----------

interface ContractEmp {
  id: string;
  employeeNo: string;
  fullName: string;
  email: string | null;
  joinDate: Date;
  endDate: Date | null;
  /** 26-b P0 — akhir PKWT (PP 35/2021); diutamakan di atas endDate bila terisi. */
  contractEnd: Date | null;
}

async function jobContractReminders(db: TenantDb): Promise<{ contract: number; probation: number; notif: number }> {
  const today = new Date();
  const recipients = await hrRecipients(db);
  let contract = 0;
  let probation = 0;
  let notif = 0;

  // --- kontrak berakhir: Employee aktif — 26-b: tanggal efektif = PKWT
  // contractEnd bila terisi, else endDate lama (kompatibel data pra-migrasi) ---
  let emps: ContractEmp[] = [];
  try {
    emps = await db.employee.findMany({
      where: {
        status: "Active",
        OR: [
          { endDate: { gte: startOfDay(today) } },
          { contractEnd: { gte: startOfDay(today) } },
        ],
      },
      select: { id: true, employeeNo: true, fullName: true, email: true, joinDate: true, endDate: true, contractEnd: true },
      take: 500,
    });
  } catch {
    return { contract: 0, probation: 0, notif: 0 };
  }

  for (const emp of emps) {
    // 26-b: PKWT contractEnd menang atas endDate lifecycle (bila keduanya terisi,
    // ambil yang TERDEKAT — pengingat paling relevan untuk HR)
    const candidates = [emp.contractEnd, emp.endDate].filter((d): d is Date => d != null);
    if (candidates.length === 0) continue;
    const due = candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
    const days = daysUntil(due, today);
    if (days < 1) continue; // hari ini/lewat → bukan pengingat (job a menangani)
    // band TERKECIL yang ≥ sisa hari (30 dulu, lalu 60, lalu 90) — tiap band
    // mengingatkan SEKALI per karyawan per tanggal jatuh tempo (dedupe key
    // menyertakan tanggal: perpanjangan PKWT baru = pengingat baru).
    const band = CONTRACT_BANDS.find((b) => days <= b);
    if (!band) continue; // masih > 90 hari → belum waktunya

    const dueKey = due.toISOString().slice(0, 10);
    const key = `reminder:contract:${emp.id}:${band}:${dueKey}`;
    const tanggal = fmtDate(due);
    // klaim atomik DULU (dedupe anti dobel antar-proses) → baru kirim
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat kontrak ${emp.fullName} (${emp.employeeNo}) berakhir ${tanggal} — ${days} hari (ambang ${band})`,
    );
    if (!claimed) continue; // sudah pernah dikirim di band ini

    const r = await notifyEvent(db, {
      to: "admins",
      docType: "Employee",
      docNo: `EMP-${emp.employeeNo}`,
      title: `Kontrak ${emp.fullName} berakhir ${days} hari lagi`,
      body:
        `Kontrak ${emp.fullName} (${emp.employeeNo}) berakhir pada ${tanggal} — ${days} hari lagi. ` +
        `Mohon tindak lanjut perpanjangan / penyelesaian.`,
      kind: "hr",
      link: "employee:directory",
    });
    notif += r.recipients.length;
    notifyEmailEvent(db, {
      event: "scheduler.contract-expiry",
      to: recipients,
      data: {
        nama: emp.fullName,
        employeeNo: emp.employeeNo,
        jenis: "Kontrak",
        date: tanggal,
        days: String(days),
      },
    });
    contract++;
  }

  // --- probation: evaluasi 90 hari sejak joinDate (probationEndDate bila ada) ---
  // Kolom opsional Employee.probationEndDate (pra-migrasi) diutamakan bila ada.
  let probDateById = new Map<string, Date>();
  try {
    if (await columnExists(db, "Employee", "probationEndDate")) {
      const rows = await db.$queryRaw<Array<{ id: string; probationEndDate: Date }>>`
        SELECT id, "probationEndDate" FROM "Employee" WHERE "probationEndDate" IS NOT NULL`;
      for (const row of rows) probDateById.set(row.id, new Date(row.probationEndDate));
    }
  } catch {
    probDateById = new Map();
  }

  let probEmps: Array<{ id: string; employeeNo: string; fullName: string; joinDate: Date }> = [];
  try {
    probEmps = await db.employee.findMany({
      where: {
        status: "Active",
        assignments: {
          some: {
            employmentStatus: "Probation",
            OR: [{ validTo: null }, { validTo: { gte: startOfDay(today) } }],
          },
        },
      },
      select: { id: true, employeeNo: true, fullName: true, joinDate: true },
      take: 500,
    });
  } catch {
    probEmps = [];
  }

  for (const emp of probEmps) {
    const evalDate =
      probDateById.get(emp.id) ?? new Date(startOfDay(emp.joinDate).getTime() + PROBATION_EVAL_DAYS * DAY_MS);
    const days = daysUntil(evalDate, today);
    if (days < 1 || days > DOC_EXPIRY_WINDOW_DAYS) continue; // evaluasi >30 hari lagi / sudah lewat

    const key = `reminder:probation:${emp.id}:30`;
    const tanggal = fmtDate(evalDate);
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat probation ${emp.fullName} (${emp.employeeNo}) evaluasi ${tanggal} — ${days} hari`,
    );
    if (!claimed) continue;

    const r = await notifyEvent(db, {
      to: "admins",
      docType: "Employee",
      docNo: `EMP-${emp.employeeNo}`,
      title: `Probation ${emp.fullName} evaluasi ${days} hari lagi`,
      body:
        `Masa probation ${emp.fullName} (${emp.employeeNo}) berakhir ${tanggal} — evaluasi ` +
        `${PROBATION_EVAL_DAYS} hari sejak joinDate. Mohon jadwalkan evaluasi.`,
      kind: "hr",
      link: "employee:directory",
    });
    notif += r.recipients.length;
    notifyEmailEvent(db, {
      event: "scheduler.contract-expiry",
      to: recipients,
      data: {
        nama: emp.fullName,
        employeeNo: emp.employeeNo,
        jenis: "Probation",
        date: tanggal,
        days: String(days),
      },
    });
    probation++;
  }

  return { contract, probation, notif };
}

// ---------- JOB c: pengingat dokumen kedaluwarsa (tabel opsional T16) ----------

async function jobDocumentExpiryReminders(db: TenantDb): Promise<{ docs: number; notif: number }> {
  // Tabel EmployeeDocument dibuat agen T16 (paralel) — bila belum ada di
  // schema tenant ini, model findMany melempar → skip SENYAP.
  const deadline = new Date(startOfDay(new Date()).getTime() + DOC_EXPIRY_WINDOW_DAYS * DAY_MS);
  let docs: Array<{
    id: string;
    docType: string;
    docNumber: string | null;
    expiresAt: Date | null;
    employee: { id: string; employeeNo: string; fullName: string; email: string | null } | null;
  }>;
  try {
    docs = await db.employeeDocument.findMany({
      where: { expiresAt: { not: null, lte: deadline } },
      select: {
        id: true,
        docType: true,
        docNumber: true,
        expiresAt: true,
        employee: { select: { id: true, employeeNo: true, fullName: true, email: true } },
      },
      take: 300,
    });
  } catch {
    return { docs: 0, notif: 0 }; // tabel belum termigrasi → skip senyap
  }

  const hrTo = await hrRecipients(db);
  // Task 55 — docNumber tersimpan TERENKRIPSI (52-d): dekripsi di batas
  // pemakaian. Best-effort per baris: nilai tak terbaca (kunci vault belum
  // termuat) → fallback label generik, pengingat tetap terkirim (isi email
  // TIDAK membocorkan ciphertext mentah — jangan tampilkan enc:… ke user).
  let tcDoc: ReturnType<typeof tenantCryptoForDb> | null = null;
  try {
    tcDoc = tenantCryptoForDb(db);
  } catch {
    tcDoc = null; // client tanpa brand (transaksi?) — fallback label
  }
  let sent = 0;
  let notif = 0;
  for (const doc of docs) {
    if (!doc.expiresAt) continue;
    const days = daysUntil(doc.expiresAt, new Date());

    const empNo = doc.employee?.employeeNo ?? "-";
    const nama = doc.employee?.fullName ?? "-";
    const tanggal = fmtDate(doc.expiresAt);
    // Task 55 — dekripsi nomor dokumen (best-effort): gagal/kunci tak termuat
    // → label generik, JANGAN pernah menulis ciphertext mentah ke pesan.
    let plainDocNo: string | null = doc.docNumber;
    if (plainDocNo && tcDoc) {
      try {
        plainDocNo = tcDoc.decryptText(plainDocNo);
      } catch {
        plainDocNo = null;
      }
    } else if (plainDocNo && /^enc:v[12]:/.test(plainDocNo)) {
      plainDocNo = null; // tanpa konteks crypto → jangan bocorkan ciphertext
    }
    const docNo = plainDocNo?.trim() || `${doc.docType}-${doc.id.slice(-6).toUpperCase()}`;
    const statusText = days >= 0 ? `${days} hari lagi` : `lewat ${Math.abs(days)} hari`;

    const key = `reminder:doc:${doc.id}:30`;
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat dokumen ${doc.docType} ${docNo} (${nama}) kedaluwarsa ${tanggal} (${statusText})`,
    );
    if (!claimed) continue; // sudah pernah dikirim / gagal klaim

    // notifikasi: tim HR + karyawan pemilik dokumen
    const rHr = await notifyEvent(db, {
      to: "admins",
      docType: "EmployeeDocument",
      docNo,
      title: `Dokumen ${doc.docType} ${nama} kedaluwarsa ${statusText}`,
      body: `Dokumen ${doc.docType} ${docNo} milik ${nama} (${empNo}) kedaluwarsa ${tanggal} (${statusText}). Mohon pembaruan.`,
      kind: "hr",
      link: "employee:directory",
    });
    notif += rHr.recipients.length;
    if (doc.employee) {
      const rEmp = await notifyEvent(db, {
        to: "employee",
        docType: "EmployeeDocument",
        docNo,
        employeeId: doc.employee.id,
        title: `Dokumen ${doc.docType} Anda kedaluwarsa ${statusText}`,
        body: `Dokumen ${doc.docType} ${docNo} Anda kedaluwarsa ${tanggal} (${statusText}). Mohon pembaruan dokumen.`,
        kind: "hr",
        link: "employee:directory",
      });
      notif += rEmp.recipients.length;
    }

    // email: HR + karyawan (bila punya alamat)
    const to: EmailRecipient[] = [...hrTo];
    if (doc.employee?.email && !to.some((t) => t.email === doc.employee?.email)) {
      to.push({ email: doc.employee.email, name: doc.employee.fullName });
    }
    notifyEmailEvent(db, {
      event: "scheduler.doc-expiry",
      to,
      data: { nama, employeeNo: empNo, docType: doc.docType, docNo, date: tanggal, days: String(days) },
    });
    sent++;
  }
  return { docs: sent, notif };
}

// ---------- JOB d: SLA persetujuan berjenjang ----------

async function jobApprovalSlaReminders(db: TenantDb): Promise<{ chains: number; notif: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - APPROVAL_SLA_DAYS * DAY_MS);
  const today = dayKey(now);

  let chains: Array<{
    id: string;
    docType: string;
    docId: string;
    employeeId: string;
    createdAt: Date;
    steps: Array<{ levelNo: number; status: string; approverLabel: string; approverEmployeeId: string | null; decidedAt: Date | null }>;
  }>;
  try {
    chains = await db.approvalChain.findMany({
      where: { status: "InProgress" },
      select: {
        id: true,
        docType: true,
        docId: true,
        employeeId: true,
        createdAt: true,
        steps: {
          orderBy: { levelNo: "asc" },
          select: {
            levelNo: true,
            status: true,
            approverLabel: true,
            approverEmployeeId: true,
            decidedAt: true,
          },
        },
      },
      take: 300,
    });
  } catch {
    return { chains: 0, notif: 0 };
  }

  let sent = 0;
  let notif = 0;
  for (const chain of chains) {
    const current = chain.steps.find((s) => s.status === "Current");
    if (!current || current.decidedAt) continue;

    // aktivitas terakhir = keputusan jenjang sebelumnya (decidedAt terakhir)
    // atau pembuatan chain — menunjukkan sejak kapan dokumen MENUNGGU.
    const lastDecision = chain.steps.reduce((acc, s) => (s.decidedAt ? Math.max(acc, s.decidedAt.getTime()) : acc), 0);
    const lastActivity = new Date(Math.max(lastDecision, chain.createdAt.getTime()));
    if (lastActivity.getTime() > cutoff.getTime()) continue; // belum 3 hari

    const key = `reminder:sla:${chain.id}:${today}`;

    const days = Math.max(1, Math.floor((now.getTime() - lastActivity.getTime()) / DAY_MS));
    const jenis = DOC_TYPE_LABEL[chain.docType] ?? chain.docType;

    // nomor dokumen + nama pemohon (best-effort; fallback id pendek)
    let docNo = `${chain.docType}-${chain.docId.slice(-6).toUpperCase()}`;
    let pemohon = "-";
    try {
      const emp = await db.employee.findUnique({
        where: { id: chain.employeeId },
        select: { fullName: true, employeeNo: true },
      });
      pemohon = emp ? `${emp.fullName} (${emp.employeeNo})` : "-";
      const row = await resolveDocNo(db, chain.docType, chain.docId);
      if (row) docNo = row;
    } catch {
      // info display opsional — lanjut dengan fallback
    }

    // klaim dedupe per hari DULU → baru kirim (anti dobel antar-proses)
    const claimed = await claimReminder(
      db,
      key,
      `SLA ${jenis} ${docNo} menunggu ${days} hari di jenjang ${current.approverLabel}`,
    );
    if (!claimed) continue;

    // notifikasi → approver jenjang berjalan (resolusi notifyEvent "nextApprover")
    const r = await notifyEvent(db, {
      to: "nextApprover",
      docType: chain.docType,
      docId: chain.docId,
      docNo,
      title: `${jenis} ${docNo} menunggu ${days} hari`,
      body:
        `Persetujuan ${jenis} ${docNo} (${pemohon}) menunggu di jenjang ${current.approverLabel} ` +
        `selama ${days} hari — melebihi SLA ${APPROVAL_SLA_DAYS} hari. Mohon tindak lanjut.`,
      kind: chain.docType.toLowerCase(),
      link: "actions:inbox",
    });
    notif += r.recipients.length;

    // email → approver jenjang berjalan (fallback tim HR)
    const emailTo = await approverRecipients(db, current.approverEmployeeId);
    notifyEmailEvent(db, {
      event: "scheduler.approval-sla",
      to: emailTo,
      data: { jenis, docNo, nama: pemohon, approver: current.approverLabel, layer: current.approverLabel, days: String(days) },
    });
    sent++;
  }
  return { chains: sent, notif };
}

/** Nomor dokumen dari id (per docType chain) — null bila tak ketemu. */
async function resolveDocNo(db: TenantDb, docType: string, docId: string): Promise<string | null> {
  switch (docType) {
    case "Leave":
      return (await db.leaveRequest.findUnique({ where: { id: docId }, select: { docNo: true } }))?.docNo ?? null;
    case "WorkOff":
      return (await db.workOffPermission.findUnique({ where: { id: docId }, select: { docNo: true } }))?.docNo ?? null;
    case "Travel":
      return (await db.travelRequest.findUnique({ where: { id: docId }, select: { docNo: true } }))?.docNo ?? null;
    case "Medical":
      return (await db.medicalClaim.findUnique({ where: { id: docId }, select: { docNo: true } }))?.docNo ?? null;
    default:
      return null;
  }
}

// ---------- JOB e: pengingat payroll D-3 ----------

async function jobPayrollReminders(db: TenantDb): Promise<{ periods: number; notif: number }> {
  const today = startOfDay(new Date());

  let periods: Array<{ id: string; code: string; name: string; endDate: Date }>;
  try {
    periods = await db.payrollPeriod.findMany({
      where: { status: { in: ACTIVE_PERIOD_STATUSES } },
      select: { id: true, code: true, name: true, endDate: true },
      take: 100,
    });
  } catch {
    return { periods: 0, notif: 0 };
  }

  // Kolom opsional PayrollPeriod.payDate (hari gajian eksplisit) — bila
  // belum termigrasi dipakai endDate periode sebagai proxy hari gajian.
  const payDateById = new Map<string, Date>();
  try {
    if (await columnExists(db, "PayrollPeriod", "payDate")) {
      const rows = await db.$queryRaw<Array<{ id: string; payDate: Date }>>`
        SELECT id, "payDate" FROM "PayrollPeriod" WHERE "payDate" IS NOT NULL`;
      for (const row of rows) payDateById.set(row.id, new Date(row.payDate));
    }
  } catch {
    // biarkan kosong → fallback endDate
  }

  const recipients = await hrRecipients(db);
  let sent = 0;
  let notif = 0;
  for (const p of periods) {
    const payday = payDateById.get(p.id) ?? p.endDate;
    const days = daysUntil(payday, today);
    if (days < 0 || days > PAYROLL_D_DAYS) continue; // bukan jendela D-3

    // sudah ada run Confirmed/Paid → tidak perlu mengingatkan
    try {
      const confirmed = await db.payrollRun.findFirst({
        where: { periodId: p.id, status: { in: ["Confirmed", "Paid"] } },
        select: { id: true },
      });
      if (confirmed) continue;
    } catch {
      continue;
    }

    const key = `reminder:payroll:${p.id}:${dayKey(today)}`;
    const tanggal = fmtDate(payday);
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat payroll D-${days} periode ${p.name} (${p.code}) gajian ${tanggal}`,
    );
    if (!claimed) continue; // dedupe per hari

    const r = await notifyEvent(db, {
      to: "admins",
      docType: "PayrollRun",
      docNo: p.code,
      title: `Payroll periode ${p.name} gajian ${tanggal} (D-${days})`,
      body: `Periode payroll ${p.name} (${p.code}) dijadwalkan gajian ${tanggal} — ${days} hari lagi — dan belum ada run yang dikonfirmasi. Mohon mulai proses payroll.`,
      kind: "payroll",
      link: "payroll:runs",
    });
    notif += r.recipients.length;
    notifyEmailEvent(db, {
      event: "scheduler.payroll-reminder",
      to: recipients,
      data: { periode: p.name, code: p.code, date: tanggal, days: String(days) },
    });
    sent++;
  }
  return { periods: sent, notif };
}

// ---------- JOB f: housekeeping notifikasi ----------

// ---------- JOB g: refresh tahunan PTKP dari data keluarga (Task 49) ----------

/**
 * Refresh PTKP TAHUNAN per 1 Januari (Task 49 + kebijakan snapshot Task 50;
 * UU PPh Pasal 7 — status PTKP diperbarui tiap awal tahun pajak):
 *   1. marker ActivityLog per tahun (action "Scheduled", entity "PtkpSync",
 *      entityId "annual-<tahun>") — bila sudah ada → skip sisa tahun;
 *   2. syncAllPtkpAuto(db) — recompute SELURUH profil bersumber "auto" dari
 *      data keluarga terkini (profil "manual" termasuk K/I tidak disentuh);
 *   3. tulis marker + ActivityLog ringkasan hasil.
 * Kebijakan Task 50: PTKP efektif = SNAPSHOT hasil refresh ini — perubahan
 * keluarga (tambah/hapus pasangan/tanggungan) DI TENGAH TAHUN tidak
 * mengubah PTKP payroll; akumulasi perubahan tersebut diterapkan pada
 * siklus refresh pertama setelah 1 Januari tahun berikutnya (job ini).
 * Job dipagari advisory lock "ptkp-tahunan" per schema (guarded) — race
 * antar-proses aman; jendela mikrodetik antara cek-marker dan tulis-marker
 * hanya menyebabkan sync idempoten berjalan ganda (tanpa efek samping).
 */
async function jobAnnualPtkpRefresh(db: TenantDb): Promise<number> {
  const year = new Date().getFullYear();
  const markerId = `annual-${year}`;
  try {
    const done = await db.activityLog.findFirst({
      where: { action: "Scheduled", entity: "PtkpSync", entityId: markerId },
      select: { id: true },
    });
    if (done) return 0; // tahun berjalan sudah disinkronkan
  } catch {
    return 0; // tabel/kolom belum termigrasi → skip senyap
  }
  const { syncAllPtkpAuto } = await import("@/rekankerja/payroll/services/ptkp-auto");
  const r = await syncAllPtkpAuto(db);
  await writeActivity(db, {
    action: "Scheduled",
    entity: "PtkpSync",
    entityId: markerId,
    detail: `Refresh PTKP tahunan ${year} dari data keluarga — ${r.employees} profil auto diperiksa, ${r.changed} berubah status (perubahan keluarga tahun sebelumnya kini berlaku; perubahan tahun berjalan menunggu refresh 1 Jan ${year + 1})`,
  });
  return r.employees;
}

// Task 99 (F0-2, audit G2) — job tahunan modul Leave (otomasi siklus saldo):
//   · NOVEMBER  : pengingat agregat ke HR — karyawan dengan saldo bawa yang
//                 akan HANGUS 31 Des (use-it-or-lose-it nudge; marker per tahun).
//   · DESEMBER  : pengingat ke HR utk generate saldo tahun depan (marker per
//                 tahun; hanya bila belum ada baris saldo tahun depan).
//   · JAN–MAR   : fill-missing otomatis — generateLeaveInfo(skipExisting) untuk
//                 karyawan aktif yang belum punya baris saldo tahun berjalan
//                 (baris existing TIDAK disentuh — edit manual HR terjaga);
//                 notifikasi ke HR hanya saat ada baris yang benar dibuat.
async function jobLeaveYearEnd(db: TenantDb): Promise<{ rows: number; notif: number }> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  let notif = 0;
  let rows = 0;
  try {
    if (m === 10) {
      // November — pengingat hangus (marker tahunan, mirror pola PTKP)
      const marker = `leave-hangus-${y}`;
      const done = await db.activityLog.findFirst({
        where: { action: "Scheduled", entity: "LeaveYearEnd", entityId: marker },
        select: { id: true },
      });
      if (!done) {
        const withCarry = await db.leaveBalance.count({ where: { year: y, carriedOver: { gt: 0 } } });
        if (withCarry > 0) {
          await notifyEvent(db, {
            to: "admins", docType: "Leave", docNo: `LEAVE-${y}`,
            title: `Sisa saldo bawa cuti hangus 31 Des ${y}`,
            body: `${withCarry} baris saldo masih menyimpan hari bawa (carry-over) yang hangus otomatis 31 Des ${y}. Ingatkan karyawan memakai / menguangkan sisa saldo, atau lakukan penyesuaian.`,
            kind: "leave", link: "leave:leave-info",
          });
          notif++;
        }
        await db.activityLog.create({
          data: {
            action: "Scheduled", entity: "LeaveYearEnd", entityId: marker,
            detail: `Pengingat hangus carry-over ${y}: ${withCarry} baris saldo bawa aktif`,
          },
        });
      }
    }
    if (m === 11) {
      // Desember — pengingat generate tahun depan (marker tahunan)
      const marker = `leave-gen-${y + 1}`;
      const done = await db.activityLog.findFirst({
        where: { action: "Scheduled", entity: "LeaveYearEnd", entityId: marker },
        select: { id: true },
      });
      const nextYearRows = await db.leaveBalance.count({ where: { year: y + 1 } });
      if (!done && nextYearRows === 0) {
        await notifyEvent(db, {
          to: "admins", docType: "Leave", docNo: `LEAVE-${y + 1}`,
          title: `Generate saldo cuti tahun ${y + 1}`,
          body: `Saldo cuti tahun ${y + 1} belum dibuat. Buka modul Leave → Informasi Cuti → Generate Leave Information sebelum 31 Des agar carry-over terhitung — atau biarkan job Januari mengisi otomatis (fill-missing).`,
          kind: "leave", link: "leave:leave-info",
        });
        notif++;
      }
      await db.activityLog.create({
        data: {
          action: "Scheduled", entity: "LeaveYearEnd", entityId: marker,
          detail: `Pengingat generate saldo ${y + 1}: ${nextYearRows} baris tahun depan sudah ada`,
        },
      });
    }
    if (m <= 2) {
      // Jan–Mar — fill-missing: hanya buat baris yang BELUM ada (skipExisting)
      const active = await db.employee.count({ where: { status: "Active" } });
      if (active > 0) {
        const have = await db.leaveBalance.findMany({
          where: { year: y },
          select: { employeeId: true },
          distinct: ["employeeId"],
        });
        if (have.length < active) {
          const { generateLeaveInfo } = await import("@/rekankerja/leave/services/leave-service");
          const r = await generateLeaveInfo(db, { year: y, skipExisting: true });
          rows = r.rows;
          if (r.rows > 0) {
            await notifyEvent(db, {
              to: "admins", docType: "Leave", docNo: `LEAVE-${y}`,
              title: `Saldo cuti ${y} dilengkapi otomatis`,
              body: `${r.rows} baris saldo cuti tahun ${y} dibuat otomatis untuk karyawan aktif yang belum punya baris (fill-missing; carry-over dihitung 31-12-${y - 1}). Baris yang sudah ada tidak diubah.`,
              kind: "leave", link: "leave:leave-info",
            });
            notif++;
          }
        }
      }
    }
  } catch {
    // tabel leave belum termigrasi di tenant ini → skip senyap (mirror pola lain)
  }
  return { rows, notif };
}

async function jobNotificationHousekeeping(db: TenantDb): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    const res = await db.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return res.count;
  } catch {
    return 0;
  }
}

// ---------- Task 100 (G4, audit A-02/C-05): JOB-JOB ATTENDANCE ----------
// Empat job modul Time & Attendance (semua idempoten + dedupe per hari via
// claimReminder, defensif terhadap tenant yang tabelnya belum termigrasi):
//   h. attendance-nightly        : regenerasi AttendanceDaily kemarin + hari ini
//      (regen dulu murni reaktif — mutasi master jadwal/libur membuat rekap
//      hari berjalan STALE sampai ada clock/approval berikutnya).
//   i. attendance-clockout-reminder : 17:00–23:59 — karyawan dengan clock IN
//      yang belum ditutup OUT → notifikasi in-app "Jangan lupa clock-out"
//      (1×/hari/karyawan).
//   j. attendance-ot-aging       : lembur Approved menunggu verifikasi > 3 hari
//      → notifikasi admin attendance (jam belum diverifikasi = uang tertahan).
//   k. attendance-transfer-reminder : tgl 25–28 — period Open/Processing dengan
//      jendela TA berakhir ≤ 3 hari & belum pernah ditransfer → notifikasi
//      admin payroll/attendance (lembur/telat/absen belum masuk payroll).

/**
 * JOB h — regenerasi rekap harian (kemarin + hari ini) seluruh karyawan aktif.
 * Sekali per hari (marker claimReminder per tanggal; siklus scheduler 6 jam →
 * tanpa marker akan regen 4×/hari). Gagal (mis. tabel belum termigrasi) →
 * marker DILEPAS supaya siklus berikutnya hari yang sama mencoba ulang
 * (regenerateRange idempoten — upsert per karyawan/tanggal).
 */
async function jobAttendanceNightly(db: TenantDb): Promise<number> {
  const today = startOfDay(new Date());
  const yesterday = new Date(today.getTime() - DAY_MS);
  const key = `attendance-nightly:${dayKey(today)}`;
  const claimed = await claimReminder(
    db,
    key,
    `Regenerasi rekap absensi ${fmtDate(yesterday)}–${fmtDate(today)} (kemarin + hari ini)`,
  );
  if (!claimed) return 0; // sudah diregenerasi hari ini (siklus sebelumnya)
  try {
    // dynamic import — pola jobLeaveYearEnd (modul service berat, tak perlu di boot)
    const { regenerateRange } = await import("@/rekankerja/time-attendance/services/attendance-service");
    return await regenerateRange(db, yesterday, today);
  } catch {
    // gagal regen → lepas marker harian agar siklus 6-jam berikutnya mencoba ulang
    try {
      await db.activityLog.deleteMany({
        where: { action: "Reminder", entity: "Scheduler", entityId: key },
      });
    } catch { /* best-effort */ }
    return 0;
  }
}

/**
 * JOB i — pengingat clock-out (jendela 17:00–23:59, sekali per hari per
 * karyawan). Populasi: clock IN TERBUKA (belum ada OUT setelahnya) sejak
 * kemarin 12:00 — dibaca langsung dari AttendanceClockLog, bukan dari rekap
 * harian (regen hari ini mungkin belum berjalan); mencakup shift malam
 * lintas hari. Notifikasi in-app ke AppUser karyawan (pola ess/api/swap.ts).
 */
async function jobAttendanceClockoutReminder(db: TenantDb): Promise<{ employees: number; notif: number }> {
  const now = new Date();
  if (now.getHours() < CLOCKOUT_REMINDER_FROM_HOUR) return { employees: 0, notif: 0 }; // belum jendela sore
  const today = startOfDay(now);
  const yesterdayNoon = new Date(today.getTime() - DAY_MS / 2); // kemarin 12:00

  let logs: Array<{ employeeId: string; direction: string; timestamp: Date }>;
  try {
    logs = await db.attendanceClockLog.findMany({
      where: { timestamp: { gte: yesterdayNoon } },
      orderBy: { timestamp: "asc" },
      select: { employeeId: true, direction: true, timestamp: true },
    });
  } catch {
    return { employees: 0, notif: 0 };
  }
  // IN terbuka per karyawan (OUT menutup IN sebelumnya — urutan asc)
  const openIn = new Map<string, Date>();
  for (const l of logs) {
    if (l.direction === "IN") openIn.set(l.employeeId, l.timestamp);
    else openIn.delete(l.employeeId);
  }
  if (openIn.size === 0) return { employees: 0, notif: 0 };

  const empIds = [...openIn.keys()];
  let employees: Array<{ id: string; employeeNo: string; fullName: string }>;
  let users: Array<{ id: string; employeeId: string | null }>;
  try {
    [employees, users] = await Promise.all([
      db.employee.findMany({
        where: { id: { in: empIds }, status: "Active" },
        select: { id: true, employeeNo: true, fullName: true },
      }),
      db.appUser.findMany({
        where: { employeeId: { in: empIds }, active: true },
        select: { id: true, employeeId: true },
        take: 200,
      }),
    ]);
  } catch {
    return { employees: 0, notif: 0 };
  }

  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const todayKey = dayKey(now);
  const usersByEmp = new Map<string, string[]>();
  for (const u of users) {
    if (!u.employeeId) continue; // AppUser tanpa relasi karyawan — lewati
    const arr = usersByEmp.get(u.employeeId) ?? [];
    arr.push(u.id);
    usersByEmp.set(u.employeeId, arr);
  }

  let sent = 0;
  let notif = 0;
  for (const emp of employees) {
    const checkIn = openIn.get(emp.id);
    if (!checkIn) continue;
    // dedupe 1×/hari/karyawan (claimReminder atomik lintas proses)
    const key = `attendance-clockout:${emp.id}:${todayKey}`;
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat clock-out ${emp.employeeNo} (${emp.fullName}) — clock-in ${hhmm(checkIn)} belum ditutup`,
    );
    if (!claimed) continue;
    for (const appUserId of usersByEmp.get(emp.id) ?? []) {
      // never-throw (pushNotification menelan galat)
      await pushNotification(db, {
        appUserId,
        title: "Jangan lupa clock-out",
        body: `Clock-in Anda pukul ${hhmm(checkIn)} belum ditutup clock-out. Lakukan clock-out sebelum/segera setelah pulang agar jam kerja tercatat — rekap absensi & lembur dihitung dari pasangan clock-in/out.`,
        kind: "attendance",
      });
      notif++;
    }
    sent++;
  }
  return { employees: sent, notif };
}

/**
 * JOB j — aging verifikasi lembur: OvertimeOrder Approved, belum dibayar
 * (paidRunNo null), disetujui > 3 hari lalu namun belum diverifikasi →
 * notifikasi admin attendance (jam tidak diverifikasi = uang lembur tertahan
 * & tidak ikut transfer payroll).
 */
async function jobAttendanceOtAging(db: TenantDb): Promise<{ orders: number; notif: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - OT_AGING_DAYS * DAY_MS);
  const todayKey = dayKey(now);

  let orders: Array<{ id: string; orderNo: string; overtimeDate: Date; decidedAt: Date | null }>;
  try {
    orders = await db.overtimeOrder.findMany({
      where: {
        status: "Approved",
        paidRunNo: null,
        // menunggu verify > 3 hari sejak disetujui (fallback tanggal lembur utk
        // baris lama tanpa decidedAt)
        OR: [{ decidedAt: { lte: cutoff } }, { decidedAt: null, overtimeDate: { lte: cutoff } }],
      },
      select: { id: true, orderNo: true, overtimeDate: true, decidedAt: true },
      orderBy: [{ overtimeDate: "asc" }, { orderNo: "asc" }],
      take: 100,
    });
  } catch {
    return { orders: 0, notif: 0 };
  }

  let sent = 0;
  let notif = 0;
  for (const o of orders) {
    const asOf = o.decidedAt ?? o.overtimeDate;
    const days = Math.max(1, Math.floor((now.getTime() - asOf.getTime()) / DAY_MS));
    const key = `attendance-ot-aging:${o.orderNo}:${todayKey}`;
    const claimed = await claimReminder(
      db,
      key,
      `Lembur ${o.orderNo} Approved ${days} hari belum diverifikasi`,
    );
    if (!claimed) continue; // dedupe per hari
    const r = await notifyEvent(db, {
      to: "admins",
      docType: "Overtime",
      docNo: o.orderNo,
      docId: o.id,
      title: `Lembur ${o.orderNo} menunggu verifikasi ${days} hari`,
      body:
        `Perintah lembur ${o.orderNo} (tanggal ${fmtDate(o.overtimeDate)}) sudah disetujui namun jamnya belum diverifikasi selama ${days} hari. ` +
        `Verifikasi jam lembur di Kehadiran → Lembur agar upah lembur ikut terhitung pada transfer absensi berikutnya.`,
      kind: "attendance",
      link: "attendance:overtime",
    });
    notif += r.recipients.length;
    sent++;
  }
  return { orders: sent, notif };
}

/**
 * JOB k — pengingat transfer absensi menjelang tutup bulan (tanggal 25–28,
 * sekali per hari): PayrollPeriod Open/Processing dengan jendela TA berakhir
 * ≤ 3 hari & BELUM pernah ditransfer. Heuristik "belum transfer" yang aman:
 * tidak ada ActivityLog "AttendanceTransfer" utk period tsb (baris itu ditulis
 * transferToPayroll DALAM transaksi yang sama dengan komponen — marker paling
 * otoritatif; period tanpa jendela TA sama sekali di-skip, tidak diduga-duga).
 */
async function jobAttendanceTransferReminder(db: TenantDb): Promise<{ periods: number; notif: number }> {
  const now = new Date();
  if (!(TRANSFER_REMINDER_DAYS as readonly number[]).includes(now.getDate())) {
    return { periods: 0, notif: 0 }; // hanya tgl 25–28
  }
  const today = startOfDay(now);

  let periods: Array<{ id: string; code: string; name: string; taEndDate: Date | null }>;
  try {
    periods = await db.payrollPeriod.findMany({
      where: { status: { in: ["Open", "Processing"] } },
      select: { id: true, code: true, name: true, taEndDate: true },
      take: 100,
    });
  } catch {
    return { periods: 0, notif: 0 };
  }

  let sent = 0;
  let notif = 0;
  for (const p of periods) {
    if (!p.taEndDate) continue;
    const taEnd = startOfDay(p.taEndDate);
    const days = daysUntil(taEnd, today);
    if (days < 0 || days > TA_TRANSFER_D_DAYS) continue; // bukan jendela D-3
    try {
      const transferred = await db.activityLog.findFirst({
        where: { action: "Processed", entity: "AttendanceTransfer", entityId: p.id },
        select: { id: true },
      });
      if (transferred) continue; // sudah pernah transfer TA utk period ini
    } catch {
      continue;
    }
    const key = `attendance-transfer:${p.id}:${dayKey(now)}`;
    const claimed = await claimReminder(
      db,
      key,
      `Pengingat transfer absensi period ${p.name} (${p.code}) — jendela TA berakhir ${fmtDate(taEnd)}`,
    );
    if (!claimed) continue; // dedupe per hari
    const r = await notifyEvent(db, {
      to: "admins",
      docType: "PayrollRun",
      docNo: p.code,
      title: `Transfer absensi period ${p.name} belum dilakukan (jendela TA ${days === 0 ? "berakhir hari ini" : `berakhir ${days} hari lagi`})`,
      body:
        `Jendela TA period ${p.name} (${p.code}) berakhir ${fmtDate(taEnd)} dan belum ada transfer absensi (lembur/telat/absen/tunjangan kehadiran) ke payroll. ` +
        `Buka Kehadiran → Absensi → Transfer ke Payroll sebelum period diproses agar komponen ikut terhitung.`,
      kind: "payroll",
      link: "attendance:absence",
    });
    notif += r.recipients.length;
    sent++;
  }
  return { periods: sent, notif };
}

// ---------- orkestrasi per tenant ----------

export interface SchedulerJobCounts {
  resignTerminated: number;
  contractReminders: number;
  probationReminders: number;
  docReminders: number;
  slaReminders: number;
  payrollReminders: number;
  notificationsPruned: number;
  /** T41-M14 — baris webhook yang dikirim ulang job webhook-retry. */
  webhookRetried: number;
  /** T49 — karyawan yang status PTKP-nya disinkronkan dari data keluarga
   *  oleh job tahunan (paling signifikan pada siklus pertama tiap 1 Januari). */
  ptkpYearlySynced: number;
  /** Task 99 (F0-2) — baris saldo cuti yang dibuat otomatis job leave-tahunan
   *  (fill-missing Januari; pengingat Des/Nov dikirim sebagai notifikasi). */
  leaveYearEndRows: number;
  /** Task 100 (G4) — baris AttendanceDaily yang diregenerasi job attendance-nightly
   *  (kemarin + hari ini; regen dulu murni reaktif — audit A-02). */
  attendanceNightlyRows: number;
  /** Task 100 (G4) — karyawan yang dikirimi pengingat clock-out (1×/hari). */
  attendanceClockoutReminded: number;
  /** Task 100 (G4) — order lembur aging (>3 hari menunggu verifikasi) yang diingatkan. */
  attendanceOtAging: number;
  /** Task 100 (G4) — period dengan jendela TA berakhir yang diingatkan utk transfer. */
  attendanceTransferReminders: number;
}

export interface SchedulerRunResult {
  tenant: string;
  jobs: SchedulerJobCounts;
  notificationsSent: number;
  templatesSeeded: number;
  /** job yang dilewati karena advisory lock dipegang proses lain (T41-M10). */
  mutexSkipped: number;
  errors: string[];
}

/**
 * Jalankan SEMUA job scheduler untuk satu tenant (dipanggil runAllTenants;
 * diekspor juga untuk pengujian manual scripts/t14-test-scheduler.ts).
 * Setiap job dibungkus try/catch — kegagalan satu job tidak menghentikan
 * job lain, dan satu baris ringkasan ActivityLog ditulis per siklus.
 * T41-M10: tiap job juga dipagari advisory lock per (jobId, schema) — bila
 * proses lain sedang menjalankan job yang sama untuk tenant ini, job
 * dilewati siklus ini (mutexSkipped++). `opts.schema` (schemaName) dipakai
 * kunci lock; bila tidak diberikan (skrip uji lama) fallback ke label tenant.
 */
export async function runAllJobs(
  db: TenantDb,
  opts: { tenant?: string; schema?: string } = {},
): Promise<SchedulerRunResult> {
  const tenant = opts.tenant ?? "tenant";
  const schema = opts.schema ?? tenant; // kunci advisory lock per (job, schema)
  const errors: string[] = [];
  const jobs: SchedulerJobCounts = {
    resignTerminated: 0,
    contractReminders: 0,
    probationReminders: 0,
    docReminders: 0,
    slaReminders: 0,
    payrollReminders: 0,
    notificationsPruned: 0,
    webhookRetried: 0,
    ptkpYearlySynced: 0,
    leaveYearEndRows: 0,
    attendanceNightlyRows: 0,
    attendanceClockoutReminded: 0,
    attendanceOtAging: 0,
    attendanceTransferReminders: 0,
  };
  let notificationsSent = 0;
  let templatesSeeded = 0;
  let mutexSkipped = 0;

  const safe = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  /** safe + mutex: lewati (dan catat) bila proses lain memegang job ini. */
  const guarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
    await safe(name, async () => {
      const r = await withJobMutex(schema, name, fn);
      if (!r.ran) mutexSkipped++;
    });
  };

  await guarded("templates", async () => {
    templatesSeeded = await ensureSchedulerTemplates(db);
  });
  await guarded("resign-terjadwal", async () => {
    jobs.resignTerminated = await jobScheduledResignations(db);
  });
  await guarded("kontrak-probation", async () => {
    const r = await jobContractReminders(db);
    jobs.contractReminders = r.contract;
    jobs.probationReminders = r.probation;
    notificationsSent += r.notif;
  });
  await guarded("dokumen-kedaluwarsa", async () => {
    const r = await jobDocumentExpiryReminders(db);
    jobs.docReminders = r.docs;
    notificationsSent += r.notif;
  });
  await guarded("sla-approval", async () => {
    const r = await jobApprovalSlaReminders(db);
    jobs.slaReminders = r.chains;
    notificationsSent += r.notif;
  });
  await guarded("payroll-d3", async () => {
    const r = await jobPayrollReminders(db);
    jobs.payrollReminders = r.periods;
    notificationsSent += r.notif;
  });
  await guarded("webhook-retry", async () => {
    // T41-M14 — kirim ulang webhook gagal yang jatuh tempo (backoff) —
    // processor NEVER-THROW di webhook-service; kolom baru WebhookLog yang
    // belum termigrasi di tenant → skip senyap dari dalam processor.
    const r = await retryFailedWebhookDeliveries(db);
    jobs.webhookRetried = r.retried;
  });
  await guarded("housekeeping", async () => {
    jobs.notificationsPruned = await jobNotificationHousekeeping(db);
  });
  // T49/T50: refresh tahunan PTKP dari data keluarga — berjalan pada siklus
  // pertama setelah 1 Januari (marker ActivityLog per tahun pajak), lalu
  // dilewati sisa tahun (idempoten lintas restart/proses). Inilah SATU-SATUNYA
  // jalur otomatis yang mengubah PTKP efektif (snapshot tahunan) — mutasi
  // keluarga tengah tahun hanya menunggu refresh tahun berikutnya.
  await guarded("ptkp-tahunan", async () => {
    jobs.ptkpYearlySynced = await jobAnnualPtkpRefresh(db);
  });
  // Task 99 (F0-2) — otomasi siklus tahunan saldo cuti: pengingat hangus (Nov),
  // pengingat generate tahun depan (Des), fill-missing otomatis (Jan–Mar).
  await guarded("leave-tahunan", async () => {
    const r = await jobLeaveYearEnd(db);
    jobs.leaveYearEndRows = r.rows;
    notificationsSent += r.notif;
  });
  // Task 100 (G4) — empat job attendance: regen harian (stale pasca mutasi
  // master), pengingat clock-out sore hari, aging verifikasi lembur, pengingat
  // transfer TA menjelang tutup jendela period. Semua idempoten + dedupe/hari.
  await guarded("attendance-nightly", async () => {
    jobs.attendanceNightlyRows = await jobAttendanceNightly(db);
  });
  await guarded("attendance-clockout-reminder", async () => {
    const r = await jobAttendanceClockoutReminder(db);
    jobs.attendanceClockoutReminded = r.employees;
    notificationsSent += r.notif;
  });
  await guarded("attendance-ot-aging", async () => {
    const r = await jobAttendanceOtAging(db);
    jobs.attendanceOtAging = r.orders;
    notificationsSent += r.notif;
  });
  await guarded("attendance-transfer-reminder", async () => {
    const r = await jobAttendanceTransferReminder(db);
    jobs.attendanceTransferReminders = r.periods;
    notificationsSent += r.notif;
  });

  const totalJobs =
    jobs.resignTerminated +
    jobs.contractReminders +
    jobs.probationReminders +
    jobs.docReminders +
    jobs.slaReminders +
    jobs.payrollReminders +
    jobs.notificationsPruned +
    jobs.webhookRetried;
  const detail =
    `${totalJobs} job, ${notificationsSent} notifikasi` +
    (templatesSeeded > 0 ? `, ${templatesSeeded} template baru` : "") +
    (jobs.webhookRetried > 0 ? `, ${jobs.webhookRetried} webhook retry` : "") +
    (jobs.ptkpYearlySynced > 0 ? `, ${jobs.ptkpYearlySynced} PTKP disinkronkan dari data keluarga` : "") +
    (jobs.leaveYearEndRows > 0 ? `, ${jobs.leaveYearEndRows} baris saldo cuti dibuat otomatis (fill-missing)` : "") +
    (jobs.attendanceNightlyRows > 0 ? `, ${jobs.attendanceNightlyRows} baris rekap absensi diregenerasi (nightly)` : "") +
    (jobs.attendanceClockoutReminded > 0 ? `, ${jobs.attendanceClockoutReminded} pengingat clock-out terkirim` : "") +
    (jobs.attendanceOtAging > 0 ? `, ${jobs.attendanceOtAging} lembur aging diingatkan` : "") +
    (jobs.attendanceTransferReminders > 0 ? `, ${jobs.attendanceTransferReminders} pengingat transfer TA terkirim` : "") +
    (mutexSkipped > 0 ? `, ${mutexSkipped} job dilewati (dipegang proses lain)` : "") +
    (errors.length > 0 ? ` — galat: ${errors.join("; ")}` : "");
  await writeActivity(db, { action: "Scheduled", entity: "Scheduler", detail: `${detail} (${tenant})` });

  return { tenant, jobs, notificationsSent, templatesSeeded, mutexSkipped, errors };
}

// ---------- orkestrasi lintas tenant + timer ----------

export interface SchedulerCycleResult {
  skipped: boolean; // siklus dilewati (masih berjalan)
  tenants: number;
  ok: number;
  failed: number;
}

/**
 * SATU siklus scheduler: semua Tenant ACTIVE → runAllJobs per tenant.
 * Anti-tumpang-tindih intra-proses: bila siklus sebelumnya masih berjalan →
 * skip. AntAR-proses (PM2 cluster): advisory lock per (job, tenant) di
 * dalam runAllJobs (T41-M10). Gagal satu tenant (DB/schema belum siap)
 * tidak menghentikan tenant lain.
 */
export async function runAllTenants(): Promise<SchedulerCycleResult> {
  if (schedulerState.running) return { skipped: true, tenants: 0, ok: 0, failed: 0 };
  schedulerState.running = true;
  try {
    const tenants = await platformDb.tenant.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, slug: true, schemaName: true },
      orderBy: { slug: "asc" },
    });
    let ok = 0;
    let failed = 0;
    let jobCount = 0;
    let notifCount = 0;
    for (const t of tenants) {
      try {
        const db = getTenantClient(t.schemaName);
        const res = await runAllJobs(db, { tenant: t.slug, schema: t.schemaName });
        if (res.errors.length > 0) {
          console.warn(`[scheduler] tenant ${t.slug} — job bermasalah: ${res.errors.join(" | ")}`);
        }
        jobCount +=
          res.jobs.resignTerminated +
          res.jobs.contractReminders +
          res.jobs.probationReminders +
          res.jobs.docReminders +
          res.jobs.slaReminders +
          res.jobs.payrollReminders +
          res.jobs.notificationsPruned +
          res.jobs.webhookRetried;
        notifCount += res.notificationsSent;
        ok++;
      } catch (e) {
        failed++;
        console.warn(
          `[scheduler] tenant ${t.slug} gagal: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (schedulerState.handle) schedulerState.handle.cycles++;
    console.log(
      `[scheduler] siklus selesai — ${ok}/${tenants.length} tenant OK, ${failed} gagal, ${jobCount} job, ${notifCount} notifikasi`,
    );
    return { skipped: false, tenants: tenants.length, ok, failed };
  } finally {
    schedulerState.running = false;
  }
}

function runCycle(): void {
  void runAllTenants().catch((e) => {
    console.warn(`[scheduler] siklus gagal total: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/**
 * NYALAKAN scheduler (dipanggil dari instrumentation register()):
 * - interval tetap tiap SCHEDULER_INTERVAL_HOURS (default 6 jam) + unref
 * - run pertama setelah SCHEDULER_FIRST_DELAY_MS (default 60 detik) + unref
 * - guard: runtime nodejs, bukan phase-production-build, SCHEDULER=off
 * - idempoten per proses (handle di globalThis — reload modul dev aman)
 */
export function initScheduler(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // bukan runtime node (edge)
  if (process.env.NEXT_PHASE === "phase-production-build") return; // next build
  if (process.env.SCHEDULER === "off") {
    console.log("[scheduler] NONAKTIF via env SCHEDULER=off");
    return;
  }
  if (schedulerState.handle) return; // sudah jalan di proses ini

  const hours = Math.max(0.001, num(process.env.SCHEDULER_INTERVAL_HOURS) || DEFAULT_INTERVAL_HOURS);
  const firstDelay = Math.max(100, num(process.env.SCHEDULER_FIRST_DELAY_MS) || DEFAULT_FIRST_DELAY_MS);

  const interval = setInterval(runCycle, Math.round(hours * 3_600_000));
  interval.unref?.();
  const first = setTimeout(runCycle, firstDelay);
  first.unref?.();

  schedulerState.handle = { interval, first, startedAt: new Date(), cycles: 0 };
  console.log(
    `[scheduler] aktif — siklus tiap ${hours} jam, run pertama dalam ${Math.round(firstDelay / 1000)} dtk (proses ${process.pid})`,
  );
}

/** Status scheduler (untuk debug/ops — dibaca test script). */
export function schedulerStatus(): { active: boolean; cycles: number; running: boolean; startedAt: string | null } {
  return {
    active: schedulerState.handle != null,
    cycles: schedulerState.handle?.cycles ?? 0,
    running: schedulerState.running,
    startedAt: schedulerState.handle?.startedAt.toISOString() ?? null,
  };
}
