// P2.5-BM (D-BM20) — JOB SCHEDULER POLIS ASURANSI GRUP (implementasi slice P2.5-E).
// Registrasi guarded("policy-member-expiry" / "policy-renewal-reminder") SUDAH
// terpasang di scheduler-service (Phase 0 — file ini TIDAK menyentuh
// scheduler-service; helper dedupe di bawah adalah salinan lokal pola
// claimReminder/writeCount di sana karena keduanya tidak diekspor).
//
// Perilaku (DEVELOPMENT-PLAN-BENCHMARK.md D-BM20):
//   * jobPolicyMemberExpiry — sweep: karyawan ber-status non-Active (atau
//     endDate < hari ini) dengan membership polis masih terbuka (effectiveTo
//     null) → tutup (effectiveTo = endDate ?? hari ini) + ActivityLog per
//     membership (actor system). Never-throw; defensive bila tabel belum ada
//     di tenant sangat awal → skip senyap.
//   * jobPolicyRenewalReminders — polis Active dengan periodEnd H-30 (antara
//     hari ini .. hari ini+30d) → per polis: dedupe claimReminder atomik
//     `reminder:policy-renewal:${id}:30` (pola H-30 jobDocumentExpiryReminders)
//     + notifikasi in-app Admin/HR + email event "policy.renewal.reminder"
//     (template email-defaults.ts — slice E) ke tiap admin ber-email.
//     P1.5-BM pelajaran race e2e: notifyEmailEvent di-AWAIT di dalam try/catch
//     (never-throw per polis) supaya EmailLog tertulis deterministik sebelum
//     fungsi kembali.
import { randomUUID } from "node:crypto";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { notifyEvent } from "@/rekankerja/shared/services/notification-service";
import { notifyEmailEvent, type EmailRecipient } from "@/rekankerja/shared/services/email-service";

const DAY_MS = 86_400_000;
/** Jendela pengingat perpanjangan polis (hari — H-30). */
const POLICY_RENEWAL_WINDOW_DAYS = 30;
/** Role AppUser tim Admin/HR (penerima pengingat — pola HR_ROLES scheduler). */
const POLICY_ADMIN_ROLES = ["Admin", "HR Manager", "HR Staff"];
/** Batas aman per run — polis yang diingatkan per siklus per tenant. */
const POLICY_RENEWAL_BATCH_CAP = 50;

const startOfDay = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Tanggal format YYYY-MM-DD (gaya data demo — pola fmtDate scheduler). */
const fmtDate = (d: Date | null | undefined): string =>
  d ? startOfDay(d).toISOString().slice(0, 10) : "-";

/** Selisih hari (pembulatan) dari hari ini menuju `to`. */
const daysUntil = (to: Date): number =>
  Math.round((startOfDay(to).getTime() - startOfDay(new Date()).getTime()) / DAY_MS);

/** ActivityLog ringkas actor system — best-effort, never-throw (pola
 *  writeActivity scheduler-service; salinan lokal karena tidak diekspor). */
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
    // tabel/kolom belum termigrasi → job tetap lanjut (never-throw)
  }
}

/** KLAIM pengingat atomik INSERT … ON CONFLICT DO NOTHING (salinan lokal pola
 *  claimReminder scheduler — partial unique index ActivityLog_dedu_reminder).
 *  true = kunci BARU ditanam (boleh kirim); false = sudah diklaim / gagal. */
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
    // (race jendela mikrodetik — lebih baik daripada tidak mengingatkan).
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

// ---------- JOB 1: tutup membership polis karyawan keluar (sweep) ----------

export async function jobPolicyMemberExpiry(db: TenantDb): Promise<{ membershipsClosed: number }> {
  try {
    // karyawan yang sudah keluar: status non-Active ATAU endDate terlewat
    // (resign terjadwal — pasangan job a scheduler "resign-terjadwal").
    const gone = await db.employee.findMany({
      where: {
        OR: [
          { status: { not: "Active" } },
          { endDate: { lt: startOfDay(new Date()) } },
        ],
      },
      select: { id: true, employeeNo: true, endDate: true, status: true },
      take: 500,
    });
    if (gone.length === 0) return { membershipsClosed: 0 };

    let closed = 0;
    for (const emp of gone) {
      // defensive per karyawan — satu kegagalan tidak menghentikan sweep.
      try {
        const open = await db.policyMember.findMany({
          where: { employeeId: emp.id, effectiveTo: null },
          include: {
            dependent: { select: { relation: true } },
            policy: { select: { policyNo: true, provider: { select: { code: true } } } },
          },
          take: 50,
        });
        for (const m of open) {
          const effectiveTo = emp.endDate ? startOfDay(emp.endDate) : startOfDay(new Date());
          await db.policyMember.update({ where: { id: m.id }, data: { effectiveTo } });
          closed++;
          await writeActivity(db, {
            action: "Updated", entity: "PolicyMember", entityId: m.id, employeeId: emp.id,
            detail:
              `Membership polis ${m.policy.policyNo} provider ${m.policy.provider.code} (${emp.employeeNo}${m.dependent ? `+${m.dependent.relation}` : ""}) ` +
              `diakhiri otomatis — karyawan berstatus ${emp.status} (sweep scheduler) efektif ${fmtDate(effectiveTo)}`,
          });
        }
      } catch {
        // lanjut karyawan berikutnya (never-throw per baris)
      }
    }
    return { membershipsClosed: closed };
  } catch {
    // tabel PolicyMember/Employee belum termigrasi (tenant sangat awal) → skip senyap.
    return { membershipsClosed: 0 };
  }
}

// ---------- JOB 2: pengingat perpanjangan polis H-30 ----------

export async function jobPolicyRenewalReminders(db: TenantDb): Promise<{ reminded: number; emailed: number }> {
  let reminded = 0;
  let emailed = 0;
  try {
    const today = startOfDay(new Date());
    const deadline = new Date(today.getTime() + POLICY_RENEWAL_WINDOW_DAYS * DAY_MS);
    let policies: Array<{
      id: string; policyNo: string; periodEnd: Date; status: string;
      provider: { name: string; code: string } | null;
    }>;
    try {
      policies = await db.insurancePolicy.findMany({
        where: { status: "Active", periodEnd: { gte: today, lte: deadline } },
        include: { provider: { select: { name: true, code: true } } },
        orderBy: { periodEnd: "asc" },
        take: POLICY_RENEWAL_BATCH_CAP,
      });
    } catch {
      return { reminded: 0, emailed: 0 }; // tabel belum termigrasi → skip senyap
    }

    // penerima email/notif: tim Admin/HR ber-email (pola hrRecipients scheduler).
    let recipients: EmailRecipient[] = [];
    try {
      const admins = await db.appUser.findMany({
        where: { active: true, role: { in: POLICY_ADMIN_ROLES }, email: { not: null } },
        orderBy: { username: "asc" },
        select: { email: true, fullName: true },
        take: 10,
      });
      recipients = admins
        .filter((u): u is { email: string; fullName: string } => Boolean(u.email))
        .map((u) => ({ email: u.email, name: u.fullName }));
    } catch {
      recipients = [];
    }

    for (const p of policies) {
      // never-throw per polis — satu polis gagal tidak menghentikan sisanya.
      try {
        const sisa = daysUntil(p.periodEnd);
        const tanggal = fmtDate(p.periodEnd);
        const providerName = p.provider?.name ?? "-";
        // (1) dedupe atomik per (polis, jendela 30) — pola H-30 doc-expiry.
        const key = `reminder:policy-renewal:${p.id}:30`;
        const claimed = await claimReminder(
          db,
          key,
          `Pengingat perpanjangan polis ${p.policyNo} provider ${providerName} berakhir ${tanggal} (${sisa} hari lagi)`,
        );
        if (!claimed) continue; // sudah pernah dikirim / gagal klaim

        // (2) notifikasi in-app Admin/HR.
        const rNotif = await notifyEvent(db, {
          to: "admins",
          docType: "InsurancePolicy",
          docNo: p.policyNo,
          title: `Polis asuransi ${p.policyNo} berakhir ${tanggal}`,
          body:
            `Polis asuransi grup ${p.policyNo} (provider ${providerName}) berakhir ${tanggal} — sisa ${sisa} hari. ` +
            `Mohon tindak lanjut perpanjangan (renewal) dengan penyedia agar cakupan manfaat karyawan tidak terputus.`,
          kind: "medical",
          link: "medical:insurance-policies",
        });
        reminded += Math.max(1, rNotif.recipients.length);

        // (3) email per admin — P1.5-BM pelajaran race e2e: di-AWAIT di dalam
        // try/catch (EmailLog deterministik sebelum return; never-throw).
        for (const to of recipients) {
          try {
            await notifyEmailEvent(db, {
              event: "policy.renewal.reminder",
              to: [to],
              data: {
                nama: to.name || "Tim HR",
                polis: p.policyNo,
                provider: providerName,
                tanggal,
                sisa: String(sisa),
              },
            });
            emailed++;
          } catch {
            // never-throw — email tidak boleh menggagalkan pengingat
          }
        }
      } catch {
        // never-throw per polis
      }
    }
    return { reminded, emailed };
  } catch {
    // defensif luar (tabel opsional belum termigrasi) — skip senyap.
    return { reminded: 0, emailed: 0 };
  }
}
