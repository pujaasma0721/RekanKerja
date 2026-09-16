// OneVity — Email checklist per bagian (Task 65) ========================
// Dipakai API onboarding & offboarding: setiap bagian yang punya tugas
// pada checklist menerima SATU email berisi daftar tugasnya + link
// checklist publik (token HMAC khusus bagian itu). Fire-and-forget —
// kegagalan email tidak pernah menggagalkan operasi utama.
// =====================================================================
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { notifyEmailEvent } from "@/onevity/shared/services/email-service";
import {
  checklistUrl, deptLabelOf, makeChecklistToken, publicBaseUrlOf, resolveDeptEmails,
} from "@/onevity/shared/services/checklist-service";

export interface ChecklistEmailTask { seq: number; title: string; owner: string | null }

interface ChecklistEmailInput {
  kind: "onboarding" | "offboarding";
  processId: string;
  /** slug tenant — ikut dalam token agar halaman publik tahu schema-nya. */
  tenantSlug: string;
  employee: { fullName: string; employeeNo: string };
  position?: string | null;
  orgUnit?: string | null;
  /** Tanggal mulai kerja (onboarding) / hari terakhir (offboarding). */
  date?: Date | null;
  tasks: ChecklistEmailTask[];
  req: { headers: { get(name: string): string | null } };
}

/** Format tanggal pendek id-ID (aman tanpa Intl — hindari beda locale server). */
function fmtDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Kirim email checklist ke tiap bagian yang punya tugas. Blokir sebelum
 * return? Tidak — notifyEmailEvent fire-and-forget; kita hanya menyiapkan.
 * Mengembalikan jumlah bagian yang dikirimi email (untuk ActivityLog).
 */
export async function sendChecklistEmails(db: TenantDb, input: ChecklistEmailInput): Promise<number> {
  // kelompokkan tugas per owner (bagian tanpa owner dilewati)
  const byDept = new Map<string, ChecklistEmailTask[]>();
  for (const t of input.tasks) {
    if (!t.owner) continue;
    const arr = byDept.get(t.owner) ?? [];
    arr.push(t);
    byDept.set(t.owner, arr);
  }

  const base = publicBaseUrlOf(input.req);
  const event = input.kind === "onboarding" ? "onboarding.checklist" : "offboarding.checklist";
  let sent = 0;

  for (const [dept, tasks] of byDept) {
    const recipients = await resolveDeptEmails(db, dept);
    if (recipients.length === 0) continue;
    const list = tasks
      .sort((a, b) => a.seq - b.seq)
      .map((t) => `${t.seq}. ${t.title}`)
      .join("\n");
    notifyEmailEvent(db, {
      event,
      to: recipients,
      data: {
        bagian: deptLabelOf(dept),
        nama: input.employee.fullName,
        employeeNo: input.employee.employeeNo,
        posisi: input.position ?? "-",
        unit: input.orgUnit ?? "-",
        tanggal: fmtDate(input.date),
        daftarTugas: list,
        link: checklistUrl(base, makeChecklistToken(input.kind, input.tenantSlug, input.processId, dept)),
      },
    });
    sent += 1;
  }
  return sent;
}
