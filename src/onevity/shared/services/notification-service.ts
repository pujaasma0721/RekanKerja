// OneVity Notification Service (T7-ESS) — pusat emisi notifikasi in-app.
// =====================================================================
// Tabel tenant "Notification" (per AppUser). Helper pushNotification()
// dipakai lintas modul (leave/travel/medical/payroll/ESS/wave-3) —
// FIRE-AND-FORGET SAFE: tidak pernah melempar error ke pemanggil
// (kegagalan insert dicatat ke console saja; proses bisnis utama
// tidak boleh terganggu oleh notifikasi — pola sama dgn email-service).
//
// T11-NOTIF: notifyEvent() — emisi tingkat EVENT dgn resolusi penerima:
//   to: "employee"     → AppUser tertaut employeeId pengaju;
//   to: "nextApprover" → AppUser approver jenjang AKTIF chain (InProgress)
//                        dokumen; fallback Admin/HR (maks 3);
//   to: "admins"       → semua AppUser Admin/HR aktif (maks 5, payroll run).
// Juga never-throw; mengembalikan daftar AppUser penerima (utk testing).
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

export interface PushNotificationInput {
  /** AppUser tujuan (bukan employeeId — notifikasi per-pengguna aplikasi). */
  appUserId: string;
  title: string;
  body?: string | null;
  /** kategori emisi: leave | travel | medical | payroll | attendance | dsb. */
  kind?: string | null;
  /** tujuan navigasi saat notifikasi dibuka (mis. "/ess/leave"). */
  link?: string | null;
}

/**
 * Kirim notifikasi in-app ke seorang AppUser. Selalu resolve (tidak pernah
 * reject) — aman dipanggil `void pushNotification(...)` tanpa try-catch.
 * Mengembalikan id notifikasi bila berhasil, null bila gagal/di-skip.
 */
export async function pushNotification(
  db: TenantDb,
  input: PushNotificationInput,
): Promise<string | null> {
  try {
    if (!input.appUserId || !input.title?.trim()) return null;
    const row = await db.notification.create({
      data: {
        appUserId: input.appUserId,
        title: input.title.trim(),
        body: input.body?.trim() || null,
        kind: input.kind?.trim() || null,
        link: input.link?.trim() || null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    // schema belum termigrasi / DB down — bisnis utama tetap lanjut.
    console.warn("[notification] gagal mengirim:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ============ T11-NOTIF: emisi event dgn resolusi penerima ============

/** Penerima event notifikasi. */
export type NotifyTarget = "employee" | "nextApprover" | "admins";

/** Role AppUser yang dianggap tim Admin/HR (fallback & broadcast payroll). */
const ADMIN_ROLES = ["Admin", "HR Manager", "HR Staff"];

export interface NotifyEventInput {
  /** Penerima: pengaju | approver jenjang berikutnya | semua Admin/HR. */
  to: NotifyTarget;
  /** docType ApprovalChain ("Leave"|"WorkOff"|"Travel"|"Medical") atau label
   *  modul lain ("Overtime"|"PayrollRun") — dipakai resolusi jenjang approver. */
  docType: string;
  /** nomor dokumen display (LR-…/WO-…/TR-…/MC-…/OT-…/run payroll) — dipakai
   *  mencari chain bila docId tidak diberikan. */
  docNo: string;
  /** id internal dokumen (chain lookup langsung) — opsional. */
  docId?: string | null;
  /** employeeId pengaju — wajib utk to:"employee". */
  employeeId?: string | null;
  title: string;
  body?: string | null;
  kind?: string | null;
  /** link navigasi shell "section:view" (mis. "actions:inbox"). */
  link?: string | null;
}

export interface NotifyEventResult {
  /** AppUser.id yang berhasil dikirimi notifikasi (utk testing). */
  recipients: string[];
}

/** Resolusi docId dari docNo per docType (semua docNo unik di schema tenant). */
async function resolveDocId(db: TenantDb, docType: string, docNo: string): Promise<string | null> {
  if (!docNo) return null;
  try {
    switch (docType) {
      case "Leave":
        return (await db.leaveRequest.findUnique({ where: { docNo }, select: { id: true } }))?.id ?? null;
      case "WorkOff":
        return (await db.workOffPermission.findUnique({ where: { docNo }, select: { id: true } }))?.id ?? null;
      case "Travel":
        return (await db.travelRequest.findUnique({ where: { docNo }, select: { id: true } }))?.id ?? null;
      case "Medical":
        return (await db.medicalClaim.findUnique({ where: { docNo }, select: { id: true } }))?.id ?? null;
      default:
        return null;
    }
  } catch {
    return null; // model tak dikenal / DB error — fallback ke Admin/HR
  }
}

/** AppUser aktif tertaut sebuah employeeId. */
async function appUsersOfEmployee(db: TenantDb, employeeId: string): Promise<string[]> {
  try {
    const rows = await db.appUser.findMany({
      where: { employeeId, active: true },
      select: { id: true },
      take: 5,
    });
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/** AppUser Admin/HR aktif (fallback approver / broadcast payroll). */
async function adminAppUsers(db: TenantDb, max: number): Promise<string[]> {
  try {
    const rows = await db.appUser.findMany({
      where: { active: true, role: { in: ADMIN_ROLES } },
      orderBy: { username: "asc" },
      select: { id: true },
      take: max,
    });
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Resolusi daftar AppUser penerima sesuai target:
 * - "employee": semua AppUser aktif tertaut employeeId pengaju;
 * - "nextApprover": chain InProgress dokumen → step Current →
 *   approverEmployeeId → AppUser; tanpa chain/approver (mis. Overtime tanpa
 *   approval berjenjang, step HR_ADMIN tanpa employee) → fallback Admin/HR
 *   maks 3;
 * - "admins": Admin/HR maks 5.
 * Tidak pernah melempar error.
 */
async function resolveRecipients(db: TenantDb, input: NotifyEventInput): Promise<string[]> {
  if (input.to === "admins") return adminAppUsers(db, 5);

  if (input.to === "employee") {
    return input.employeeId ? appUsersOfEmployee(db, input.employeeId) : [];
  }

  // to === "nextApprover"
  try {
    const docId = input.docId || (await resolveDocId(db, input.docType, input.docNo));
    if (docId) {
      const chain = await db.approvalChain.findUnique({
        where: { docType_docId: { docType: input.docType, docId } },
        select: {
          steps: { where: { status: "Current" }, select: { approverEmployeeId: true }, take: 1 },
        },
      });
      const approverEmployeeId = chain?.steps[0]?.approverEmployeeId ?? null;
      if (approverEmployeeId) {
        const ids = await appUsersOfEmployee(db, approverEmployeeId);
        if (ids.length > 0) return ids;
      }
    }
  } catch {
    // lanjut ke fallback — notifikasi tidak boleh mengganggu proses utama
  }
  return adminAppUsers(db, 3);
}

/**
 * Kirim notifikasi EVENT ke penerima yang diresolusi otomatis (T11-NOTIF).
 * NEVER-THROW: aman dipanggil `void notifyEvent(...)`; mengembalikan daftar
 * AppUser penerima supaya panggilan testing bisa memverifikasi emisi.
 */
export async function notifyEvent(db: TenantDb, input: NotifyEventInput): Promise<NotifyEventResult> {
  try {
    if (!input.title?.trim() || !input.docNo) return { recipients: [] };
    const ids = Array.from(new Set(await resolveRecipients(db, input)));
    const sent: string[] = [];
    for (const appUserId of ids) {
      const id = await pushNotification(db, {
        appUserId,
        title: input.title,
        body: input.body,
        kind: input.kind,
        link: input.link,
      });
      if (id) sent.push(appUserId);
    }
    return { recipients: sent };
  } catch (e) {
    // pertahanan terakhir — resolusi/gagal insert tidak boleh mengganggu bisnis
    console.warn("[notification] notifyEvent gagal:", e instanceof Error ? e.message : e);
    return { recipients: [] };
  }
}
