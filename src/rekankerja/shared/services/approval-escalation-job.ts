// P2.6-BM (D-BM21) — ESKALASI OTOMATIS PERSETUJUAN (stub Phase 0 P2).
// Implementasi slice P2.6-F DI FILE INI — jangan pindah/menghapus registrasi
// guarded("approval-escalation") di scheduler-service (dipasang Phase 0 agar
// slice paralel tidak berebut file scheduler-service.ts).
//
// Perilaku target (DEVELOPMENT-PLAN-BENCHMARK.md D-BM21):
//   * Per ApprovalStructure.escalateDays (null = OFF default — tidak mengubah
//     perilaku engine sama sekali).
//   * Chain InProgress + step Current tanpa keputusan > X hari (lastActivity =
//     max(decidedAt step terakhir, createdAt chain)) → step current
//     di-eskalasi ke ATASAN approver (managerAtLevel approval-engine; tanpa
//     atasan → fallback Admin/HR roles) — catat jejak di note step + ActivityLog
//     action "Escalated" entity "ApprovalChain" + notif approver baru.
//   * Dedupe: claimReminder(db, `escalation:chain:${chain.id}`, ...) sekali
//     per chain per hari; race-safe via updateMany kondisional status Current.
//   * Never-throw (pola job lain); return counter.
import type { TenantDb } from "../lib/tenant-db";

export async function jobApprovalEscalation(db: TenantDb): Promise<{ escalated: number; notified: number }> {
  void db; // stub Phase 0 — diisi P2.6-F
  return { escalated: 0, notified: 0 };
}
