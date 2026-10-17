// P2.5-BM (D-BM20) — JOB SCHEDULER POLIS ASURANSI GRUP (stub Phase 0 P2).
// Implementasi slice P2.5-E DI FILE INI — jangan pindah/menghapus registrasi
// guarded("policy-member-expiry" / "policy-renewal-reminder") di
// scheduler-service (dipasang Phase 0 agar slice paralel tidak berebut file
// scheduler-service.ts).
//
// Perilaku target (DEVELOPMENT-PLAN-BENCHMARK.md D-BM20):
//   * jobPolicyMemberExpiry — sweep: karyawan ber-status Resigned/Terminated
//     (atau endDate < hari ini) dengan membership polis masih terbuka
//     (effectiveTo null) → tutup (effectiveTo = endDate/hari ini) + ActivityLog
//     per membership. Never-throw; defensive bila tabel belum ada di tenant.
//   * jobPolicyRenewalReminders — polis Active dengan periodEnd H-30 →
//     notif in-app + email event "policy.renewal.reminder" (template baru di
//     email-defaults, slice E menambahkannya) ke Admin/HR + dedupe
//     claimReminder(`reminder:policy-renewal:${id}:30`) pola H-30 jobDocument
//     ExpiryReminders.
import type { TenantDb } from "../../shared/lib/tenant-db";

export async function jobPolicyMemberExpiry(db: TenantDb): Promise<{ membershipsClosed: number }> {
  void db; // stub Phase 0 — diisi P2.5-E
  return { membershipsClosed: 0 };
}

export async function jobPolicyRenewalReminders(db: TenantDb): Promise<{ reminded: number; emailed: number }> {
  void db; // stub Phase 0 — diisi P2.5-E
  return { reminded: 0, emailed: 0 };
}
