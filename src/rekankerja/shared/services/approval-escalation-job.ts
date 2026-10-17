// P2.6-BM (D-BM21) — ESKALASI OTOMATIS PERSETUJUAN (slice P2.6-F).
// =====================================================================
// Perilaku (DEVELOPMENT-PLAN-BENCHMARK.md §4 P2.6):
//   * Per ApprovalStructure.escalateDays (null = OFF default — tidak mengubah
//     perilaku engine sama sekali; job tidak menyentuh chain tsb).
//   * Chain InProgress + step Current tanpa keputusan > X hari
//     (lastActivity = max(decidedAt step terakhir, createdAt chain)) →
//     step current di-eskalasi ke ATASAN LANGSUNG APPROVER
//     (managerAtLevel approval-engine) — label + note menyimpan jejak,
//     ActivityLog action "Escalated" entity "ApprovalChain" + notif approver baru.
//   * SINGLE-HOP (keputusan desain D-BM21): dedupe permanen satu kali per
//     chain via claimReminder key `escalation:chain:{id}` — eskalasi tidak
//     berulang naik terus tiap siklus; atasan approver tidak ditemukan →
//     jejak "eskalasi dilewati" (tanpa fallback sembarangan) + skip.
//   * RACE-SAFE: mutasi step via updateMany kondisional
//     {id, status: "Current", approverEmployeeId lama} → count 0 berarti step
//     sudah diputuskan bersamaan (pola decideApprovalChain) → skip senyap.
//   * Never-throw per chain (pola job scheduler lain); return counter
//     {escalated, notified} (dipakai SchedulerJobCounts Phase 0).
// Registrasi guarded("approval-escalation") ada di scheduler-service (Phase 0).
import { randomUUID } from "node:crypto";
import type { TenantDb } from "../lib/tenant-db";
import { managerAtLevel, DOC_TYPE_LABEL } from "./approval-engine";
import { notifyEvent } from "./notification-service";

const DAY_MS = 86_400_000;
/** Batas aman per run — maks chain diproses per siklus per tenant. */
const ESCALATION_BATCH_CAP = 50;

// ---------- ActivityLog: write + klaim dedupe (pola scheduler-service) ----------

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

/**
 * KLAIM eskalasi secara atomik (INSERT … ON CONFLICT DO NOTHING — salinan pola
 * claimReminder scheduler-service.ts; partial unique index "ActivityLog_dedu_reminder"
 * ON ("action","entity","entityId") WHERE "entityId" IS NOT NULL AND "action"='Reminder'
 * menahan race antar-proses; fallback WHERE NOT EXISTS bila index belum terpasang).
 * Key `escalation:chain:{id}` TANPA komponen hari → klaim PERMANEN per chain
 * (eskalasi single-hop D-BM21 — tidak naik terus tiap siklus).
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

/** Nomor dokumen display per docType chain — null bila tak ketemu (pola
 *  resolveDocNo scheduler; sisanya fallback "{docType}-{id pendek}"). */
async function resolveDocNo(db: TenantDb, docType: string, docId: string): Promise<string | null> {
  try {
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
  } catch {
    return null; // info display opsional — lanjut dengan fallback
  }
}

// ---------- JOB: eskalasi approval (D-BM21) ----------

export async function jobApprovalEscalation(db: TenantDb): Promise<{ escalated: number; notified: number }> {
  const now = new Date();
  let escalated = 0;
  let notified = 0;

  // hanya chain berbasis struktur (fallback tanpa struktur tidak punya config eskalasi)
  let chains: Array<{
    id: string;
    docType: string;
    docId: string;
    employeeId: string;
    structureId: string | null;
    createdAt: Date;
    steps: Array<{
      id: string;
      levelNo: number;
      status: string;
      approverLabel: string;
      approverEmployeeId: string | null;
      note: string | null;
      decidedAt: Date | null;
    }>;
  }>;
  try {
    chains = await db.approvalChain.findMany({
      where: { status: "InProgress", structureId: { not: null } },
      select: {
        id: true,
        docType: true,
        docId: true,
        employeeId: true,
        structureId: true,
        createdAt: true,
        steps: {
          orderBy: { levelNo: "asc" },
          select: {
            id: true, levelNo: true, status: true, approverLabel: true,
            approverEmployeeId: true, note: true, decidedAt: true,
          },
        },
      },
      take: ESCALATION_BATCH_CAP,
    });
  } catch {
    return { escalated: 0, notified: 0 }; // tabel belum termigrasi → skip senyap
  }

  for (const chain of chains) {
    // never-throw per chain — satu chain bermasalah tidak menghentikan lainnya
    try {
      const structure = await db.approvalStructure.findUnique({
        where: { id: chain.structureId ?? "" },
        select: { escalateDays: true },
      });
      // null = OFF default — chain tidak tersentuh sama sekali
      const escalateDays = structure?.escalateDays ?? null;
      if (escalateDays == null) continue;

      const current = chain.steps.find((s) => s.status === "Current");
      if (!current || current.decidedAt) continue;

      // step berbasis POSISI tanpa employee (pemegang posisi kosong / HR_ADMIN) →
      // tidak ada atasan yang bisa di-eskalasi — jejak sekali per chain (ringan).
      if (!current.approverEmployeeId) {
        await claimReminder(
          db,
          `escalation:skip:chain:${chain.id}`,
          `Eskalasi ${chain.docType} ${chain.docId} dilewati: jenjang ${current.levelNo} tidak berbasis karyawan approver`,
        );
        continue;
      }

      // aktivitas terakhir = keputusan jenjang sebelumnya (decidedAt terakhir)
      // atau pembuatan chain — menunjukkan sejak kapan dokumen MENUNGGU.
      const lastDecision = chain.steps.reduce((acc, s) => (s.decidedAt ? Math.max(acc, s.decidedAt.getTime()) : acc), 0);
      const lastActivity = new Date(Math.max(lastDecision, chain.createdAt.getTime()));
      if (now.getTime() - lastActivity.getTime() <= escalateDays * DAY_MS) continue; // belum lewat batas

      // klaim dedupe PERMANEN dulu → baru eskalasi (single-hop; race antar-proses
      // ditahan partial index ActivityLog).
      const jenis = DOC_TYPE_LABEL[chain.docType as keyof typeof DOC_TYPE_LABEL] ?? chain.docType;
      const docNo = (await resolveDocNo(db, chain.docType, chain.docId)) ?? `${chain.docType}-${chain.docId.slice(-6).toUpperCase()}`;
      const claimed = await claimReminder(
        db,
        `escalation:chain:${chain.id}`,
        `Eskalasi otomatis ${jenis} ${docNo} jenjang ${current.levelNo} melewati ${escalateDays} hari`,
      );
      if (!claimed) continue; // sudah dieskalasi / sedang diproses proses lain

      // target eskalasi: atasan langsung APPROVER (bukan pemohon). Tanpa atasan →
      // jejak jelas + skip (jangan fallback sembarangan — keputusan D-BM21).
      const superiorId = await managerAtLevel(db, current.approverEmployeeId, 1);
      if (!superiorId || superiorId === current.approverEmployeeId) {
        await writeActivity(db, {
          action: "Escalated",
          entity: "ApprovalChain",
          entityId: chain.id,
          detail: `${jenis} ${docNo} level ${current.levelNo} — eskalasi dilewati: atasan approver tidak ditemukan (batas ${escalateDays} hari)`,
        });
        continue;
      }

      // nama approver lama + baru (hanya fullName — tanpa PII lain)
      const people = await db.employee.findMany({
        where: { id: { in: [current.approverEmployeeId, superiorId] } },
        select: { id: true, fullName: true },
      });
      const approverNama = people.find((p) => p.id === current.approverEmployeeId)?.fullName ?? current.approverLabel;
      const superiorNama = people.find((p) => p.id === superiorId)?.fullName ?? "Atasan approver";

      // RACE-SAFE (pola decideApprovalChain): step hanya berpindah bila masih
      // Current pada approver yang dibaca — keputusan yang mendarat bersamaan
      // memenangi baris (updateMany kita mendapat 0 → skip senyap).
      const upd = await db.approvalStep.updateMany({
        where: { id: current.id, status: "Current", approverEmployeeId: current.approverEmployeeId },
        data: {
          approverEmployeeId: superiorId,
          approverLabel: `${current.approverLabel} (eskalasi)`,
          note: [
            current.note?.trim() || null,
            `eskalasi otomatis dari ${approverNama} — melewati ${escalateDays} hari tanpa keputusan`,
          ]
            .filter(Boolean)
            .join(" | "),
        },
      });
      if (upd.count === 0) continue; // sudah diputuskan bersamaan — tidak ada yang berubah

      escalated++;

      // jejak audit mutasi
      await writeActivity(db, {
        action: "Escalated",
        entity: "ApprovalChain",
        entityId: chain.id,
        detail: `${jenis} ${docNo} level ${current.levelNo} — dari ${approverNama} ke ${superiorNama} (batas ${escalateDays} hari)`,
      });

      // notifikasi → approver BARU (resolusi notifyEvent "nextApprover" membaca
      // step Current = superior pasca mutasi di atas; fallback Admin/HR).
      const r = await notifyEvent(db, {
        to: "nextApprover",
        docType: chain.docType,
        docId: chain.docId,
        docNo,
        title: `Persetujuan dieskalasi ke Anda: ${jenis} ${docNo}`,
        body:
          `Persetujuan ${jenis} ${docNo} menunggu lebih dari ${escalateDays} hari tanpa keputusan ` +
          `dan dieskalasi dari ${approverNama} kepada Anda. Mohon tindak lanjut.`,
        kind: chain.docType.toLowerCase(),
        link: "actions:inbox",
      });
      notified += r.recipients.length;
    } catch (e) {
      // never-throw keseluruhan — catat & lanjut ke chain berikutnya
      console.warn("[approval-escalation] chain", chain.id, "gagal:", e instanceof Error ? e.message : e);
    }
  }
  return { escalated, notified };
}
