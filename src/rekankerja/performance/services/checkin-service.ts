// P2-PERF — service check-in & monitoring (DEVELOPMENT-PLAN-PERFORMANCE.md
// §27 alur 3): jadwal/log 1-on-1 terdokumentasi, checkpoint tengah tahun
// (midActual per KPI + progress), revisi target mid-year (atasan mengajukan,
// atasan berjenjang L2 menyetujui — guard §35-5).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

function bad(msg: string): never { throw new Error(msg); }

const STATUS_RANK = ["Enrolled", "GoalProposed", "GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];

// ============ LIST ============

export async function listCheckIns(
  db: TenantDb,
  opts: { cycleId?: string; appraisalId?: string; from?: string; to?: string; q?: string },
) {
  const where: Record<string, unknown> = {};
  if (opts.appraisalId) where.appraisalId = opts.appraisalId;
  if (opts.cycleId) where.appraisal = { cycleId: opts.cycleId };
  if (opts.from || opts.to) {
    where.heldAt = {};
    if (opts.from) (where.heldAt as Record<string, unknown>).gte = new Date(opts.from);
    if (opts.to) (where.heldAt as Record<string, unknown>).lte = new Date(opts.to);
  }
  const rows = await db.checkIn.findMany({
    where,
    include: {
      appraisal: {
        include: {
          employee: { select: { employeeNo: true, fullName: true, position: { select: { title: true } } } },
          manager: { select: { id: true, fullName: true } },
          cycle: { select: { code: true, status: true, midStart: true, midEnd: true } },
        },
      },
    },
    orderBy: { heldAt: "desc" },
    take: 200,
  });
  return {
    rows: rows.map((c) => ({
      id: c.id,
      appraisalId: c.appraisalId,
      docNo: c.appraisal.docNo,
      employeeId: c.appraisal.employeeId,
      employeeNo: c.appraisal.employee.employeeNo,
      employeeName: c.appraisal.employee.fullName,
      position: c.appraisal.employee.position?.title ?? null,
      managerName: c.appraisal.manager?.fullName ?? null,
      cycleCode: c.appraisal.cycle.code,
      cycleStatus: c.appraisal.cycle.status,
      heldAt: c.heldAt.toISOString(),
      agenda: c.agenda,
      notesJson: c.notesJson,
      managerComment: c.managerComment,
      nextCheckInAt: c.nextCheckInAt?.toISOString() ?? null,
      status: c.status,
    })),
  };
}

// ============ SCHEDULE / LOG / MARK MISSED ============

async function requireCheckable(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: { cycle: { select: { code: true, status: true } } },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (a.cycle.status === "Published" || a.cycle.status === "Closed") {
    bad(`Siklus ${a.cycle.code} sudah ${a.cycle.status} — check-in tidak dapat diubah (§35-6)`);
  }
  return a;
}

export async function scheduleCheckIn(
  db: TenantDb,
  input: { appraisalId: string; heldAt: string; agenda?: string; nextCheckInAt?: string | null },
  actor: string,
): Promise<string> {
  const a = await requireCheckable(db, input.appraisalId);
  if (!input.heldAt) bad("Tanggal check-in wajib diisi");
  const row = await db.checkIn.create({
    data: {
      appraisalId: input.appraisalId,
      heldAt: new Date(input.heldAt),
      agenda: input.agenda ?? null,
      notesJson: JSON.stringify({ wins: [], blockers: [], next: [] }),
      nextCheckInAt: input.nextCheckInAt ? new Date(input.nextCheckInAt) : null,
      status: "Planned",
      createdById: null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "CheckIn", entityId: row.id,
      detail: `Check-in dijadwalkan untuk ${a.docNo} (${new Date(input.heldAt).toLocaleDateString("id-ID")}) oleh ${actor}`,
    },
  });
  return row.id;
}

export async function logCheckIn(
  db: TenantDb,
  input: {
    checkInId: string;
    wins?: string[]; blockers?: string[]; next?: string[];
    managerComment?: string; nextCheckInAt?: string | null;
  },
  actor: string,
): Promise<void> {
  const row = await db.checkIn.findUnique({ where: { id: input.checkInId }, include: { appraisal: { select: { docNo: true } } } });
  if (!row) bad("Check-in tidak ditemukan");
  await requireCheckable(db, row.appraisalId);
  await db.checkIn.update({
    where: { id: input.checkInId },
    data: {
      notesJson: JSON.stringify({ wins: input.wins ?? [], blockers: input.blockers ?? [], next: input.next ?? [] }),
      managerComment: input.managerComment ?? row.managerComment,
      nextCheckInAt: input.nextCheckInAt ? new Date(input.nextCheckInAt) : row.nextCheckInAt,
      status: "Held",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "CheckIn", entityId: input.checkInId,
      detail: `Check-in ${row.appraisal.docNo} dicatat (Held) — ${[(input.wins ?? []).length, (input.blockers ?? []).length, (input.next ?? []).length].join("/")} poin capaian/hambatan/lanjut oleh ${actor}`,
    },
  });
}

export async function markMissed(db: TenantDb, checkInId: string, actor: string): Promise<void> {
  const row = await db.checkIn.findUnique({ where: { id: checkInId } });
  if (!row) bad("Check-in tidak ditemukan");
  await db.checkIn.update({ where: { id: checkInId }, data: { status: "Missed" } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "CheckIn", entityId: checkInId,
      detail: `Check-in ditandai terlewat (Missed) oleh ${actor}`,
    },
  });
}

// ============ CHECKPOINT TENGAH TAHUN (midActual §27-3) ============

export async function midCheckpointView(db: TenantDb, cycleId: string) {
  const appraisals = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { docNo: "asc" },
  });
  return appraisals.map((a) => {
    let filled = 0;
    for (const k of a.kpis) if (k.midActual != null) filled++;
    return {
      appraisalId: a.id,
      docNo: a.docNo,
      employeeNo: a.employee.employeeNo,
      employeeName: a.employee.fullName,
      status: a.status,
      kpis: a.kpis.map((k) => ({
        id: k.id,
        title: k.title,
        unit: k.unit,
        polarity: k.polarity,
        target: k.target,
        midActual: k.midActual,
        dataSource: k.dataSource,
      })),
      midPct: a.kpis.length === 0 ? 0 : Math.round((filled / a.kpis.length) * 100),
    };
  });
}

export async function saveMidActual(
  db: TenantDb,
  input: { kpiId: string; midActual: number | null },
  actor: string,
  forceHr = false,
): Promise<void> {
  const kpi = await db.appraisalKpi.findUnique({ where: { id: input.kpiId }, include: { appraisal: { include: { cycle: { select: { code: true, status: true, midStart: true, midEnd: true } } } } } });
  if (!kpi) bad("KPI tidak ditemukan");
  const cycle = kpi.appraisal.cycle;
  const inWindow = cycle.midStart && cycle.midEnd && new Date() >= cycle.midStart && new Date() <= cycle.midEnd;
  if (cycle.status !== "Ongoing") {
    bad(`Checkpoint tengah tahun hanya saat fase Ongoing (siklus ${cycle.code} saat ini ${cycle.status})`);
  }
  if (!inWindow && !forceHr) {
    bad(`Jendela checkpoint tengah tahun siklus ${cycle.code} belum/tidak terbuka (§35-5)`);
  }
  if (input.midActual != null && !Number.isFinite(input.midActual)) bad("Nilai midActual harus angka");
  await db.appraisalKpi.update({
    where: { id: input.kpiId },
    data: { midActual: input.midActual },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalKpi", entityId: input.kpiId,
      detail: `Checkpoint tengah tahun "${kpi.title}": midActual = ${input.midActual ?? "kosong"} — oleh ${actor}`,
    },
  });
}

// ============ REVISI TARGET MID-YEAR (§27-4, §35-5) ============

export async function reviseTarget(
  db: TenantDb,
  input: {
    appraisalId: string;
    reason: string;
    items: { kpiId: string; target?: number; thresholdMin?: number | null; stretchValue?: number | null; weight?: number }[];
  },
  actor: { employeeId: string | null; name: string; isHr: boolean },
  mode: "propose" | "apply",
): Promise<void> {
  const a = await db.appraisalRecord.findUnique({
    where: { id: input.appraisalId },
    include: {
      cycle: { select: { code: true, status: true, midStart: true, midEnd: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: true,
    },
  });
  if (!a) bad("Peserta tidak ditemukan");
  if (!input.reason?.trim()) bad("Alasan revisi wajib diisi (ter-audit §27-4)");
  if (a.cycle.status !== "Ongoing") bad(`Revisi target hanya saat fase Ongoing (§35-5) — siklus ${a.cycle.code} saat ini ${a.cycle.status}`);
  const inWindow = a.cycle.midStart && a.cycle.midEnd && new Date() >= a.cycle.midStart && new Date() <= a.cycle.midEnd;
  if (!inWindow && !actor.isHr) bad(`Jendela revisi tengah tahun siklus ${a.cycle.code} belum/tidak terbuka (§35-5)`);

  if (mode === "propose") {
    // atasan penilai mengajukan (atasan dari peserta)
    await db.activityLog.create({
      data: {
        action: "Submitted", entity: "AppraisalRecord", entityId: input.appraisalId,
        detail: `REVISI TARGET diajukan (${input.items.length} KPI) oleh ${actor.name} — alasan: ${input.reason}. Menunggu persetujuan atasan berjenjang (L2).`,
      },
    });
    return;
  }
  // apply — guard aktor: HR, atau atasan-atasan dari penilai (L2)
  const l2Ok = await isLevel2Of(db, a.manager?.id ?? null, actor.employeeId);
  if (!actor.isHr && !l2Ok) {
    bad("Revisi hanya dapat DITERAPKAN oleh atasan berjenjang (L2) atau HR (§27-4)");
  }
  for (const it of input.items) {
    const k = a.kpis.find((x) => x.id === it.kpiId);
    if (!k) continue;
    await db.appraisalKpi.update({
      where: { id: it.kpiId },
      data: {
        ...(it.target !== undefined ? { target: it.target } : {}),
        ...(it.thresholdMin !== undefined ? { thresholdMin: it.thresholdMin } : {}),
        ...(it.stretchValue !== undefined ? { stretchValue: it.stretchValue } : {}),
        ...(it.weight !== undefined ? { weight: it.weight } : {}),
      },
    });
  }
  const newSum = a.kpis.reduce((s, k) => s + (input.items.find((i) => i.kpiId === k.id)?.weight ?? k.weight), 0);
  if (Math.abs(newSum - 100) > 0.01) bad(`Revisi mengubah Σbobot menjadi ${Math.round(newSum)} — harus tetap 100`);
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "AppraisalRecord", entityId: input.appraisalId,
      detail: `REVISI TARGET diterapkan (${input.items.length} KPI) oleh ${actor.name} — alasan: ${input.reason}. Σbobot tetap ${Math.round(newSum)}.`,
    },
  });
}

async function isLevel2Of(db: TenantDb, managerId: string | null, actorEmployeeId: string | null): Promise<boolean> {
  if (!managerId || !actorEmployeeId) return false;
  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId: managerId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { managerId: true },
  });
  return assignment?.managerId === actorEmployeeId;
}

export { STATUS_RANK };


// ============ SCHEDULER JOB (P2 — §27-1 reminder check-in) ============

/** Check-in Planned yang lewat heldAt > 3 hari / nextCheckInAt lewat tanpa Held → ingatkan atasan (dedupe claimReminder). */
export async function jobPerfCheckInReminders(db: TenantDb): Promise<{ reminded: number; notified: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
  const overdue = await db.checkIn.findMany({
    where: {
      status: "Planned",
      heldAt: { lt: cutoff },
      appraisal: { cycle: { status: { in: ["GoalSetting", "Ongoing", "Assessment"] } } },
    },
    include: {
      appraisal: {
        include: {
          employee: { select: { fullName: true } },
          manager: { select: { id: true, fullName: true } },
          cycle: { select: { code: true } },
        },
      },
    },
    take: 100,
  });
  let reminded = 0;
  let notified = 0;
  for (const c of overdue) {
    const key = `perf-checkin:${c.id}`;
    const claimed = await claimPerfReminder(db, key, `Check-in terlewat ${c.appraisal.employee.fullName} (${c.heldAt.toISOString().slice(0, 10)}) siklus ${c.appraisal.cycle.code}`);
    if (!claimed) continue;
    reminded++;
    if (c.appraisal.manager) {
      const users = await db.appUser.findMany({ where: { employeeId: c.appraisal.manager.id, active: true }, select: { id: true }, take: 3 });
      for (const u of users) {
        await db.notification.create({
          data: {
            appUserId: u.id,
            title: `Check-in terlewat — ${c.appraisal.employee.fullName}`,
            body: `Check-in ${c.heldAt.toLocaleDateString("id-ID")} (${c.appraisal.cycle.code}) belum dicatat. Buka Performance → Check-in untuk mencatat hasilnya.`,
            kind: "performance",
            link: "performance:checkins",
          },
        }).catch(() => null);
        notified++;
      }
    }
  }
  return { reminded, notified };
}

async function claimPerfReminder(db: TenantDb, key: string, detail: string): Promise<boolean> {
  try {
    const n = await db.$executeRaw`
      INSERT INTO "ActivityLog" ("id","actorType","action","entity","entityId","employeeId","personnelActionId","detail","createdAt")
      SELECT gen_random_uuid()::text, 'system', 'Reminder', 'PerformanceCheckIn', ${key}, NULL, NULL, ${detail}, now()
      ON CONFLICT ("action","entity","entityId") WHERE "entityId" IS NOT NULL AND "action" = 'Reminder'
      DO NOTHING`;
    return n === 1;
  } catch {
    return false;
  }
}
