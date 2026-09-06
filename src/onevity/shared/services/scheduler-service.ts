// OneVity — BACKGROUND JOB SCHEDULER (T14-SCHED) ============================
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
// - anti-tumpang-tindih: flag `running` (disimpan di globalThis agar tahan
//   terhadap reload modul dev)
// - timer setInterval/setTimeout di-unref() → tidak menahan proses exit
//
// Enam job (semua fire-and-forget, idempoten, defensif — tabel opsional
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
//
// Setiap siklus menulis SATU baris ringkasan ActivityLog per tenant
// (action "Scheduled", entity "Scheduler", detail "n job, n notifikasi")
// — pengingat individual tercatat sebagai baris "Reminder" sekaligus
// menjadi penanda dedupe.
// =====================================================================
import { randomUUID } from "node:crypto";
import { db as platformDb } from "@/lib/db";
import { getTenantClient, type TenantDb } from "@/onevity/shared/lib/tenant-db";
import { DEFAULT_TEMPLATES_PLACEHOLDER } from "@/onevity/shared/services/email-defaults";
import { notifyEmailEvent, type EmailRecipient } from "@/onevity/shared/services/email-service";
import { notifyEvent } from "@/onevity/shared/services/notification-service";

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
  __onevitySchedulerState?: SchedulerGlobalState;
};
const schedulerState: SchedulerGlobalState =
  globalForScheduler.__onevitySchedulerState ?? { running: false };
globalForScheduler.__onevitySchedulerState = schedulerState;

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
 * KLAIM pengingat secara atomik (INSERT … WHERE NOT EXISTS — satu statement):
 * mengembalikan true bila kunci dedupe BELUM pernah diklaim (pemanggil boleh
 * mengirim), false bila sudah ada / gagal insert. Klaim dibuat SEBELUM kirim
 * supaya dua proses scheduler yang berjalan bersamaan (interval dev server +
 * skrip manual) tidak dobel-kirim — jendela race hanya mikrodetik.
 * Baris klaim sekaligus jejak audit "Reminder" (entity "Scheduler").
 */
async function claimReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  try {
    const id = randomUUID();
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
}

async function jobContractReminders(db: TenantDb): Promise<{ contract: number; probation: number; notif: number }> {
  const today = new Date();
  const recipients = await hrRecipients(db);
  let contract = 0;
  let probation = 0;
  let notif = 0;

  // --- kontrak berakhir: Employee aktif dengan endDate masa depan ---
  let emps: ContractEmp[] = [];
  try {
    emps = await db.employee.findMany({
      where: { status: "Active", endDate: { gte: startOfDay(today) } },
      select: { id: true, employeeNo: true, fullName: true, email: true, joinDate: true, endDate: true },
      take: 500,
    });
  } catch {
    return { contract: 0, probation: 0, notif: 0 };
  }

  for (const emp of emps) {
    if (!emp.endDate) continue;
    const days = daysUntil(emp.endDate, today);
    if (days < 1) continue; // hari ini/lewat → bukan pengingat (job a menangani)
    // band TERKECIL yang ≥ sisa hari (30 dulu, lalu 60, lalu 90) — tiap band
    // mengingatkan SEKALI per karyawan (dedupe key per band).
    const band = CONTRACT_BANDS.find((b) => days <= b);
    if (!band) continue; // masih > 90 hari → belum waktunya

    const key = `reminder:contract:${emp.id}:${band}`;
    const tanggal = fmtDate(emp.endDate);
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
  let sent = 0;
  let notif = 0;
  for (const doc of docs) {
    if (!doc.expiresAt) continue;
    const days = daysUntil(doc.expiresAt, new Date());

    const empNo = doc.employee?.employeeNo ?? "-";
    const nama = doc.employee?.fullName ?? "-";
    const tanggal = fmtDate(doc.expiresAt);
    const docNo = doc.docNumber?.trim() || `${doc.docType}-${doc.id.slice(-6).toUpperCase()}`;
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

async function jobNotificationHousekeeping(db: TenantDb): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
    const res = await db.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return res.count;
  } catch {
    return 0;
  }
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
}

export interface SchedulerRunResult {
  tenant: string;
  jobs: SchedulerJobCounts;
  notificationsSent: number;
  templatesSeeded: number;
  errors: string[];
}

/**
 * Jalankan SEMUA job scheduler untuk satu tenant (dipanggil runAllTenants;
 * diekspor juga untuk pengujian manual scripts/t14-test-scheduler.ts).
 * Setiap job dibungkus try/catch — kegagalan satu job tidak menghentikan
 * job lain, dan satu baris ringkasan ActivityLog ditulis per siklus.
 */
export async function runAllJobs(
  db: TenantDb,
  opts: { tenant?: string } = {},
): Promise<SchedulerRunResult> {
  const tenant = opts.tenant ?? "tenant";
  const errors: string[] = [];
  const jobs: SchedulerJobCounts = {
    resignTerminated: 0,
    contractReminders: 0,
    probationReminders: 0,
    docReminders: 0,
    slaReminders: 0,
    payrollReminders: 0,
    notificationsPruned: 0,
  };
  let notificationsSent = 0;
  let templatesSeeded = 0;

  const safe = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  await safe("templates", async () => {
    templatesSeeded = await ensureSchedulerTemplates(db);
  });
  await safe("resign-terjadwal", async () => {
    jobs.resignTerminated = await jobScheduledResignations(db);
  });
  await safe("kontrak-probation", async () => {
    const r = await jobContractReminders(db);
    jobs.contractReminders = r.contract;
    jobs.probationReminders = r.probation;
    notificationsSent += r.notif;
  });
  await safe("dokumen-kedaluwarsa", async () => {
    const r = await jobDocumentExpiryReminders(db);
    jobs.docReminders = r.docs;
    notificationsSent += r.notif;
  });
  await safe("sla-approval", async () => {
    const r = await jobApprovalSlaReminders(db);
    jobs.slaReminders = r.chains;
    notificationsSent += r.notif;
  });
  await safe("payroll-d3", async () => {
    const r = await jobPayrollReminders(db);
    jobs.payrollReminders = r.periods;
    notificationsSent += r.notif;
  });
  await safe("housekeeping", async () => {
    jobs.notificationsPruned = await jobNotificationHousekeeping(db);
  });

  const totalJobs =
    jobs.resignTerminated +
    jobs.contractReminders +
    jobs.probationReminders +
    jobs.docReminders +
    jobs.slaReminders +
    jobs.payrollReminders +
    jobs.notificationsPruned;
  const detail =
    `${totalJobs} job, ${notificationsSent} notifikasi` +
    (templatesSeeded > 0 ? `, ${templatesSeeded} template baru` : "") +
    (errors.length > 0 ? ` — galat: ${errors.join("; ")}` : "");
  await writeActivity(db, { action: "Scheduled", entity: "Scheduler", detail: `${detail} (${tenant})` });

  return { tenant, jobs, notificationsSent, templatesSeeded, errors };
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
 * Anti-tumpang-tindih: bila siklus sebelumnya masih berjalan → skip.
 * Gagal satu tenant (DB/schema belum siap) tidak menghentikan tenant lain.
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
        const res = await runAllJobs(db, { tenant: t.slug });
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
          res.jobs.notificationsPruned;
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
