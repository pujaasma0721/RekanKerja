// OneVity — SERVICE EMAIL (Task 34) ==================================
// =====================================================================
// Pengiriman email otomatis oleh sistem saat ada pengajuan / persetujuan:
//   notifyEmailEvent(db, {event, to, data})  — fire-and-forget (never throw)
//   sendTestEmail(db, {to})                  — tes koneksi + email uji
//   getConfigPublic(db)                      — config tanpa password (klien)
//   ensureTemplates(db)                      — self-heal seed template default
//
// Prinsip: kegagalan pengiriman TIDAK PERNAH mengganggu proses bisnis utama
// (approval tetap sukses); setiap percobaan dicatat ke EmailLog (Sent/Failed/
// Skipped) untuk audit di tab "Riwayat Kirim".
// =====================================================================
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { DEFAULT_TEMPLATES_PLACEHOLDER } from "@/onevity/shared/services/email-defaults";

// ---- lazy import nodemailer (server-only; bundling edge-safe) ----
type Transporter = { sendMail(opts: MailOptions): Promise<{ messageId: string; response?: string }>; verify(): Promise<boolean>; close(): void };
interface MailOptions { from: string; to: string; subject: string; text?: string; html?: string; cc?: string; attachments?: EmailAttachment[] }
type NodemailerModule = typeof import("nodemailer");
async function createTransport(cfg: SmtpConfig): Promise<Transporter> {
  let mod: NodemailerModule;
  try {
    mod = await import("nodemailer");
  } catch {
    // Paket belum terpasang di node_modules (mis. habis git pull tanpa install
    // ulang). Didegradasi jadi pesan jelas — app TIDAK crash (serverExternalPackages
    // menjadikan nodemailer runtime-external, bukan build-time).
    throw new Error("Library pengiriman email (nodemailer) belum terpasang — jalankan `npm install` atau `bun install` di folder proyek lalu restart server dev");
  }
  // interop CJS: implementasi asli berada di .default (namespace juga valid)
  const impl = (mod as unknown as { default?: NodemailerModule }).default ?? mod;
  return impl.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }) as unknown as Transporter;
}

// ---------- tipe ----------

export interface SmtpConfig {
  host: string; port: number; secure: boolean; user: string; password: string;
  fromEmail: string; fromName: string;
}

export interface EmailRecipient { email: string; name?: string }

/** Lampiran email (nodemailer attachments) — konten biner + nama file. */
export interface EmailAttachment {
  filename: string;
  content: Uint8Array | Buffer;
  contentType?: string;
}

export interface NotifyInput {
  event: string;                 // "leave.approved" dst — kunci EmailTemplate
  to: EmailRecipient[];          // penerima utama
  data: Record<string, string>;  // placeholder {{nama}} {{docNo}} …
}

interface ConfigRow {
  id: string; active: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean;
  smtpUser: string; smtpPassword: string;
  fromEmail: string; fromName: string;
}

interface TemplateRow {
  event: string; label: string; active: boolean;
  notifyEmployee: boolean; notifyApprover: boolean; notifyHrd: boolean;
  subject: string; body: string;
}

// ---------- konfigurasi ----------

/** Ambil config aktif; null bila belum ada / SMTP belum diisi. */
export async function getActiveConfig(db: TenantDb): Promise<ConfigRow | null> {
  const row = await db.emailConfig.findFirst({ where: { active: true } });
  return row ?? null;
}

/** Config untuk KLIEN — password diganti indikator panjang (masked). */
export interface ConfigPublic {
  active: boolean;
  smtpHost: string; smtpPort: number; smtpSecure: boolean; smtpUser: string;
  fromEmail: string; fromName: string;
  hasPassword: boolean;
  lastTestOk: boolean | null; lastTestAt: Date | null; lastTestMessage: string | null;
}

export async function getConfigPublic(db: TenantDb): Promise<ConfigPublic> {
  const row = await getActiveConfig(db);
  if (!row) {
    return {
      active: false, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "",
      fromEmail: "", fromName: "OneVity HRIS", hasPassword: false,
      lastTestOk: null, lastTestAt: null, lastTestMessage: null,
    };
  }
  return {
    active: row.active, smtpHost: row.smtpHost, smtpPort: row.smtpPort, smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser, fromEmail: row.fromEmail, fromName: row.fromName,
    hasPassword: row.smtpPassword.length > 0,
    lastTestOk: null, lastTestAt: null, lastTestMessage: null,
  };
}

function smtpOf(row: ConfigRow): SmtpConfig {
  return {
    host: row.smtpHost, port: row.smtpPort, secure: row.smtpSecure,
    user: row.smtpUser, password: row.smtpPassword,
    fromEmail: row.fromEmail || row.smtpUser, fromName: row.fromName || "OneVity HRIS",
  };
}

/** Apakah SMTP layak dipakai (host + from terisi)? */
function smtpReady(cfg: SmtpConfig): boolean {
  return cfg.host.trim().length > 0 && cfg.fromEmail.trim().length > 0;
}

// ---------- template ----------

/** Render placeholder {{key}} → nilai (kunci tak dikenal → tetap). */
export function renderTemplate(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) => {
    const v = data[key];
    return v != null && v !== "" ? v : m;
  });
}

// ---------- kirim & log ----------

async function writeLog(db: TenantDb, entry: { event: string; toEmail: string; subject: string; status: string; error?: string; body?: string }) {
  try {
    await db.emailLog.create({
      data: {
        event: entry.event, toEmail: entry.toEmail, subject: entry.subject,
        status: entry.status, error: entry.error ?? null, body: entry.body ?? null,
      },
    });
  } catch {
    // log gagal tidak boleh melempar
  }
}

/** Kirim via SMTP (throw → ditangani pemanggil). */
async function smtpSend(cfg: SmtpConfig, to: EmailRecipient, subject: string, body: string, attachments?: EmailAttachment[]) {
  const transporter = await createTransport(cfg);
  try {
    await transporter.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to: to.name ? `"${to.name}" <${to.email}>` : to.email,
      subject,
      text: body,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  } finally {
    transporter.close();
  }
}

/**
 * Kirim email uji (tombol "Tes Kirim") — memperbarui status tes terakhir.
 * Selalu resolve {ok, message}; tidak pernah throw.
 */
export async function sendTestEmail(db: TenantDb, to: string): Promise<{ ok: boolean; message: string }> {
  const row = await getActiveConfig(db);
  if (!row) return { ok: false, message: "Konfigurasi belum tersimpan" };
  const cfg = smtpOf(row);
  if (!smtpReady(cfg)) return { ok: false, message: "SMTP host dan email pengirim belum diisi" };
  if (!to.includes("@")) return { ok: false, message: "Alamat email tujuan tidak valid" };

  const subject = "Tes Konfigurasi Email OneVity HRIS";
  const body = `Ini email percobaan dari OneVity HRIS.\n\nJika Anda menerima email ini, konfigurasi SMTP sudah benar.\n\nServer: ${cfg.host}:${cfg.port}${cfg.secure ? " (TLS)" : ""}\nPengirim: ${cfg.fromEmail}\n\n--- Email otomatis, tidak perlu dibalas.`;
  try {
    await smtpSend(cfg, { email: to }, subject, body);
    await db.emailConfig.update({
      where: { id: row.id },
      data: { lastTestOk: true, lastTestAt: new Date(), lastTestMessage: "OK — email terkirim" },
    });
    await writeLog(db, { event: "config.test", toEmail: to, subject, status: "Sent", body });
    return { ok: true, message: `Email uji terkirim ke ${to}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await db.emailConfig.update({
      where: { id: row.id },
      data: { lastTestOk: false, lastTestAt: new Date(), lastTestMessage: msg.slice(0, 300) },
    });
    await writeLog(db, { event: "config.test", toEmail: to, subject, status: "Failed", error: msg.slice(0, 500), body });
    return { ok: false, message: `Gagal: ${msg}` };
  }
}

/**
 * NOTIFIKASI OTOMATIS — fire-and-forget. Dipanggil dari route pengajuan/
 * keputusan SETELAH operasi utama sukses. Tidak pernah throw / reject.
 *
 * - config kosong / nonaktif / SMTP belum siap → log "Skipped" (diam)
 * - template tidak aktif → return tanpa log (keputusan sadar admin)
 * - template tidak ada → fallback template generik (tetap terkirim)
 */
export function notifyEmailEvent(db: TenantDb, input: NotifyInput): void {
  void dispatch(db, input).catch(() => { /* never */ });
}

async function dispatch(db: TenantDb, input: NotifyInput): Promise<void> {
  try {
    const cfgRow = await getActiveConfig(db);
    if (!cfgRow || !cfgRow.active) {
      await writeLog(db, { event: input.event, toEmail: input.to.map((t) => t.email).join(","), subject: input.event, status: "Skipped", error: "Konfigurasi email belum aktif" });
      return;
    }
    const cfg = smtpOf(cfgRow);
    if (!smtpReady(cfg)) {
      await writeLog(db, { event: input.event, toEmail: input.to.map((t) => t.email).join(","), subject: input.event, status: "Skipped", error: "SMTP belum dikonfigurasi" });
      return;
    }

    const tpl = await db.emailTemplate.findUnique({ where: { event: input.event } });
    if (tpl && !tpl.active) return; // dimatikan sengaja → tanpa jejak

    const subject = renderTemplate(tpl?.subject ?? `Notifikasi {{event}} — {{docNo}}`, { ...input.data, event: input.event });
    const body = renderTemplate(
      tpl?.body ?? `Notifikasi sistem OneVity HRIS.\n\n{{event}}\n\n{{detail}}`,
      { ...input.data, event: input.event, detail: Object.entries(input.data).map(([k, v]) => `- ${k}: ${v}`).join("\n") },
    );

    for (const t of input.to) {
      if (!t.email || !t.email.includes("@")) continue;
      try {
        await smtpSend(cfg, t, subject, body);
        await writeLog(db, { event: input.event, toEmail: t.email, subject, status: "Sent", body });
      } catch (e) {
        await writeLog(db, { event: input.event, toEmail: t.email, subject, status: "Failed", error: (e instanceof Error ? e.message : "unknown").slice(0, 500), body });
      }
    }
  } catch {
    // safety net — notifikasi tidak pernah merusak proses utama
  }
}

// ---------- slip gaji (T10-PAYSLIP-PDF) ----------

/** Event template slip gaji (payroll.payslip — email-defaults.ts). */
export const PAYSLIP_TEMPLATE_EVENT = "payroll.payslip";

export type PayslipSendStatus = "Sent" | "Failed" | "Skipped" | "Disabled";

export interface PayslipEmailInput {
  to: EmailRecipient;
  /** placeholder template: {{nama}} {{periode}} {{net}} {{runNo}} … */
  data: Record<string, string>;
  attachment: EmailAttachment;
}

/**
 * Kirim email slip gaji (dgn LAMPIRAN PDF) ke SATU karyawan — dipakai aksi
 * `send-slips` run payroll (kirim massal per line). Tidak pernah throw.
 *
 * - email tujuan kosong/invalid → log "Skipped" (Email karyawan kosong)
 * - config kosong / nonaktif / SMTP belum siap → log "Skipped"
 * - template payroll.payslip nonaktif → "Disabled" tanpa jejak (pilihan admin)
 * - template belum ada di DB → self-heal upsert dari email-defaults.ts
 * - sukses/gagal SMTP → log "Sent"/"Failed" (audit tab Riwayat Kirim)
 */
export async function sendPayslipEmail(db: TenantDb, input: PayslipEmailInput): Promise<PayslipSendStatus> {
  const event = PAYSLIP_TEMPLATE_EVENT;
  try {
    if (!input.to.email || !input.to.email.includes("@")) {
      await writeLog(db, { event, toEmail: input.to.email || "(kosong)", subject: `Slip gaji ${input.data.periode ?? ""}`.trim(), status: "Skipped", error: "Email karyawan kosong" });
      return "Skipped";
    }

    const cfgRow = await getActiveConfig(db);
    if (!cfgRow || !cfgRow.active) {
      await writeLog(db, { event, toEmail: input.to.email, subject: `Slip gaji ${input.data.periode ?? ""}`.trim(), status: "Skipped", error: "Konfigurasi email belum aktif" });
      return "Skipped";
    }
    const cfg = smtpOf(cfgRow);
    if (!smtpReady(cfg)) {
      await writeLog(db, { event, toEmail: input.to.email, subject: `Slip gaji ${input.data.periode ?? ""}`.trim(), status: "Skipped", error: "SMTP belum dikonfigurasi" });
      return "Skipped";
    }

    // template: baris DB → fallback default (email-defaults.ts) + self-heal upsert
    let tpl = await db.emailTemplate.findUnique({ where: { event } });
    if (!tpl) {
      const def = DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event);
      if (def) {
        tpl = await db.emailTemplate.upsert({
          where: { event },
          update: {},
          create: def,
        }).catch(() => null);
      }
    }
    if (tpl && !tpl.active) return "Disabled"; // dimatikan sengaja → tanpa jejak

    const fallback = DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event);
    const subject = renderTemplate(tpl?.subject ?? fallback?.subject ?? `Slip Gaji {{periode}} — OneVity HRIS`, input.data);
    const body = renderTemplate(tpl?.body ?? fallback?.body ?? "Halo {{nama}},\n\nSlip gaji periode {{periode}} terlampir. Take Home Pay {{net}}.\n\n---\nEmail otomatis sistem OneVity HRIS — tidak perlu dibalas.", input.data);

    try {
      await smtpSend(cfg, input.to, subject, body, [{ ...input.attachment, contentType: input.attachment.contentType ?? "application/pdf" }]);
      await writeLog(db, { event, toEmail: input.to.email, subject, status: "Sent", body });
      return "Sent";
    } catch (e) {
      await writeLog(db, { event, toEmail: input.to.email, subject, status: "Failed", error: (e instanceof Error ? e.message : "unknown").slice(0, 500), body });
      return "Failed";
    }
  } catch {
    // safety net — pengiriman slip tidak boleh merusak proses run
    return "Failed";
  }
}

// ---------- helper penerima ----------

/** Email karyawan (Employee.email) — null bila kosong. */
export async function employeeEmailOf(db: TenantDb, employeeId: string | null | undefined): Promise<EmailRecipient | null> {
  if (!employeeId) return null;
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { email: true, fullName: true } });
  if (!emp?.email) return null;
  return { email: emp.email, name: emp.fullName };
}

/** Email approver: AppUser admin/HR aktif pertama (fallback demo single-approver). */
export async function approverEmailsOf(db: TenantDb, excludeEmployeeId?: string | null): Promise<EmailRecipient[]> {
  const users = await db.appUser.findMany({
    where: { active: true, role: { in: ["HR Manager", "Admin"] } },
    select: { email: true, fullName: true, employeeId: true },
    take: 5,
  });
  const out: EmailRecipient[] = [];
  for (const u of users) {
    if (!u.email) continue;
    if (excludeEmployeeId && u.employeeId === excludeEmployeeId) continue;
    out.push({ email: u.email, name: u.fullName });
  }
  return out;
}

/** Email atasan langsung karyawan (dari penempatan aktif: EmployeeAssignment.managerId). */
export async function managerEmailOf(db: TenantDb, employeeId: string | null | undefined): Promise<EmailRecipient | null> {
  if (!employeeId) return null;
  const asg = await db.employeeAssignment.findFirst({
    where: { employeeId, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] },
    orderBy: { validFrom: "desc" },
    select: { managerId: true },
  });
  if (!asg?.managerId) return null;
  return employeeEmailOf(db, asg.managerId);
}
