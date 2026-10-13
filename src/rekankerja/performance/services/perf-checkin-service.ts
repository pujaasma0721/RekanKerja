import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { APPRAISAL_LOCKED } from "@/rekankerja/performance/services/perf-cycle-service";

// ============================================================================
// PERFORMANCE — Service check-in & monitoring (P2 — DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P2, §27 Alur 3, §17 endpoint checkins):
//   • CheckIn 1-on-1 terdokumentasi: schedule (rencana + agenda + jadwal
//     berikutnya) → log (hasil ringkas dua arah §27-2: karyawan mengisi
//     bagiannya via ESS, atasan menambah catatan) → markMissed.
//   • Checkpoint tengah tahun §27-3: atasan mengisi midActual per KPI
//     (progress dua arah terlihat); karyawan melihat progress di ESS.
//   • Revisi target mid-year §27-4 (guard §35-5): atasan mengajukan (alasan
//     wajib) → APPROVAL RINGAN atasan-atas (L2 = atasan dari atasan snapshot)
//     menyetujui → AppraisalKpi diperbarui + jejak penuh ActivityLog
//     (permintaan = RevisionRequested ber-payload; keputusan = Approved/
//     Rejected) — tanpa tabel baru sesuai hemat arsitektur §15.
// ============================================================================

const DAY_MS = 86_400_000;

function reqStr(v: unknown, label: string): string {
  const s = v != null ? String(v).trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  return s;
}

function dateOf(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

export interface CheckinActor {
  employeeId: string | null;
  superAdmin: boolean;
}

/** Status siklus yang masih boleh aktivitas check-in (§35-6: ditolak bila Published). */
const CHECKIN_ALLOWED_CYCLE = ["Ongoing", "Assessment", "Calibration"];

async function mustAppraisal(db: TenantDb, appraisalId: string) {
  const a = await db.appraisalRecord.findUnique({
    where: { id: appraisalId },
    include: {
      cycle: { select: { id: true, code: true, status: true, periodStart: true, periodEnd: true, midStart: true, midEnd: true } },
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) throw new Error("Peserta tidak ditemukan");
  return a;
}

function assertCheckinWindow(cycleStatus: string, cycleCode: string): void {
  if (!CHECKIN_ALLOWED_CYCLE.includes(cycleStatus)) {
    throw new Error(`Check-in hanya sah saat siklus berjalan (Ongoing/Assessment/Calibration) — siklus ${cycleCode} saat ini ${cycleStatus} (§35-6)`);
  }
}

// ============================================================================
// LIST — riwayat per peserta / per siklus (halaman atasan/HR)
// ============================================================================

export async function listCheckIns(
  db: TenantDb, opt: { cycleId?: string; appraisalId?: string; from?: string; to?: string; status?: string },
): Promise<Record<string, unknown>[]> {
  const where: Record<string, unknown> = {};
  if (opt.appraisalId) where.appraisalId = opt.appraisalId;
  if (opt.cycleId) where.appraisal = { cycleId: opt.cycleId };
  const from = dateOf(opt.from);
  const to = dateOf(opt.to);
  if (from || to) where.heldAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (opt.status && ["Planned", "Held", "Missed"].includes(opt.status)) where.status = opt.status;

  const rows = await db.checkIn.findMany({
    where: where as never,
    include: {
      appraisal: {
        select: {
          id: true, docNo: true, status: true,
          employee: { select: { employeeNo: true, fullName: true } },
          manager: { select: { fullName: true } },
          cycle: { select: { code: true, status: true } },
        },
      },
    },
    orderBy: { heldAt: "desc" },
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id, appraisalId: r.appraisalId, heldAt: r.heldAt.toISOString(), agenda: r.agenda,
    notesJson: r.notesJson, managerComment: r.managerComment,
    nextCheckInAt: r.nextCheckInAt?.toISOString() ?? null,
    status: r.status, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    employeeNo: r.appraisal.employee.employeeNo, fullName: r.appraisal.employee.fullName,
    managerName: r.appraisal.manager?.fullName ?? null, docNo: r.appraisal.docNo,
    cycleCode: r.appraisal.cycle.code,
  }));
}

// ============================================================================
// SCHEDULE / LOG / MARK MISSED
// ============================================================================

export async function scheduleCheckIn(
  db: TenantDb, actor: CheckinActor, input: { appraisalId: string; heldAt: unknown; agenda?: string; nextCheckInAt?: unknown },
): Promise<string> {
  const a = await mustAppraisal(db, input.appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId && a.employeeId !== actor.employeeId) {
    throw new Error("Hanya atasan atau karyawan peserta yang dapat menjadwalkan check-in (§35-6)");
  }
  assertCheckinWindow(a.cycle.status, a.cycle.code);
  const heldAt = dateOf(input.heldAt);
  if (!heldAt) throw new Error("Tanggal check-in wajib diisi");
  const nextCheckInAt = dateOf(input.nextCheckInAt);
  if (nextCheckInAt && nextCheckInAt < heldAt) throw new Error("Jadwal berikutnya harus setelah tanggal check-in");
  return (await db.checkIn.create({
    data: {
      appraisalId: a.id, heldAt, agenda: input.agenda?.trim() || null,
      nextCheckInAt, status: "Planned", createdById: actor.employeeId ?? null,
      notesJson: JSON.stringify({ wins: [], blockers: [], next: [] }),
    },
  })).id;
}

export interface LogCheckInInput {
  id?: string;
  appraisalId?: string;
  heldAt?: unknown;
  wins?: string[];
  blockers?: string[];
  next?: string[];
  managerComment?: string;
}

/** Catat hasil 1-on-1 (§27-2) — status → Held. */
export async function logCheckIn(db: TenantDb, actor: CheckinActor, input: LogCheckInInput): Promise<{ id: string }> {
  const ci = input.id
    ? await db.checkIn.findUnique({ where: { id: input.id }, include: { appraisal: { include: { cycle: { select: { status: true, code: true } }, manager: { select: { id: true } }, employee: { select: { id: true } } } } } })
    : input.appraisalId
      ? (await db.checkIn.findFirst({
          where: { appraisalId: input.appraisalId, status: "Planned" },
          orderBy: { heldAt: "asc" },
          include: { appraisal: { include: { cycle: { select: { status: true, code: true } }, manager: { select: { id: true } }, employee: { select: { id: true } } } } },
        }))
      : null;
  if (!ci) throw new Error("Check-in tidak ditemukan (beri id, atau appraisalId dengan jadwal Planned)");
  if (!actor.superAdmin && actor.employeeId && ci.appraisal.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta yang mencatat hasil check-in (§27-2 — catatan atasan)");
  }
  assertCheckinWindow(ci.appraisal.cycle.status, ci.appraisal.cycle.code);

  const notes = {
    wins: (input.wins ?? []).map((s) => s.trim()).filter(Boolean),
    blockers: (input.blockers ?? []).map((s) => s.trim()).filter(Boolean),
    next: (input.next ?? []).map((s) => s.trim()).filter(Boolean),
    ...(parseEmployeePart(ci.notesJson) ? { employee: parseEmployeePart(ci.notesJson) } : {}),
  };
  const heldAt = dateOf(input.heldAt) ?? ci.heldAt;
  await db.checkIn.update({
    where: { id: ci.id },
    data: { notesJson: JSON.stringify(notes), managerComment: input.managerComment?.trim() || null, heldAt, status: "Held" },
  });
  return { id: ci.id };
}

/** Bagian KARYAWAN dari check-in dua arah (§27-2) — dari ESS, digabung ke notesJson.employee. */
export async function fillEmployeePart(
  db: TenantDb, employeeId: string, checkInId: string, part: { wins?: string[]; blockers?: string[]; next?: string[] },
): Promise<{ id: string }> {
  const ci = await db.checkIn.findUnique({
    where: { id: checkInId },
    include: { appraisal: { include: { employee: { select: { id: true } }, cycle: { select: { status: true, code: true } } } } },
  });
  if (!ci) throw new Error("Check-in tidak ditemukan");
  if (ci.appraisal.employee.id !== employeeId) throw new Error("Hanya karyawan peserta yang dapat mengisi bagiannya");
  assertCheckinWindow(ci.appraisal.cycle.status, ci.appraisal.cycle.code);
  const cur = parseNotes(ci.notesJson);
  cur.employee = {
    wins: (part.wins ?? []).map((s) => s.trim()).filter(Boolean),
    blockers: (part.blockers ?? []).map((s) => s.trim()).filter(Boolean),
    next: (part.next ?? []).map((s) => s.trim()).filter(Boolean),
  };
  await db.checkIn.update({ where: { id: ci.id }, data: { notesJson: JSON.stringify(cur) } });
  return { id: ci.id };
}

function parseNotes(raw: string): { wins: string[]; blockers: string[]; next: string[]; employee?: { wins: string[]; blockers: string[]; next: string[] } } {
  try { return JSON.parse(raw) ?? { wins: [], blockers: [], next: [] }; } catch { return { wins: [], blockers: [], next: [] }; }
}
function parseEmployeePart(raw: string): { wins: string[]; blockers: string[]; next: string[] } | null {
  const n = parseNotes(raw);
  return n.employee && (n.employee.wins?.length || n.employee.blockers?.length || n.employee.next?.length) ? n.employee : null;
}

export async function markMissed(db: TenantDb, actor: CheckinActor, id: string): Promise<void> {
  const ci = await db.checkIn.findUnique({
    where: { id },
    include: { appraisal: { include: { cycle: { select: { status: true, code: true } }, manager: { select: { id: true } } } } },
  });
  if (!ci) throw new Error("Check-in tidak ditemukan");
  if (!actor.superAdmin && actor.employeeId && ci.appraisal.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta yang menandai check-in terlewat");
  }
  assertCheckinWindow(ci.appraisal.cycle.status, ci.appraisal.cycle.code);
  await db.checkIn.update({ where: { id }, data: { status: "Missed" } });
}

// ============================================================================
// CHECKPOINT TENGAH TAHUN — midActual §27-3 (progress dua arah)
// ============================================================================

/** Isi capaian tengah tahun per KPI (atasan). Jendela mid diperiksa bila diatur. */
export async function saveMidActual(
  db: TenantDb, actor: CheckinActor, appraisalId: string, rows: { kpiId: string; midActual: number | null }[],
): Promise<{ updated: number }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta yang mengisi capaian tengah tahun (§27-3)");
  }
  if (a.cycle.status !== "Ongoing") throw new Error("Checkpoint tengah tahun hanya saat fase Ongoing (§27-3)");
  if (a.cycle.midStart || a.cycle.midEnd) {
    const now = Date.now();
    if (a.cycle.midStart && a.cycle.midStart.getTime() > now) throw new Error("Jendela checkpoint tengah tahun belum dibuka");
    if (a.cycle.midEnd && a.cycle.midEnd.getTime() < now - DAY_MS) throw new Error("Jendela checkpoint tengah tahun sudah tutup");
  }
  const byId = new Map(a.kpis.map((k) => [k.id, k]));
  let updated = 0;
  for (const r of rows) {
    if (!byId.has(r.kpiId)) continue;
    await db.appraisalKpi.update({ where: { id: r.kpiId }, data: { midActual: r.midActual } });
    updated++;
  }
  return { updated };
}

/** Progres tengah tahun ringkas (dipakai atasan + ESS "kedua sisi" §27-3). */
export async function midProgress(db: TenantDb, appraisalId: string) {
  const a = await mustAppraisal(db, appraisalId);
  const filled = a.kpis.filter((k) => k.midActual != null);
  return {
    cycle: { code: a.cycle.code, status: a.cycle.status, midStart: a.cycle.midStart?.toISOString() ?? null, midEnd: a.cycle.midEnd?.toISOString() ?? null },
    employee: { employeeNo: a.employee.employeeNo, fullName: a.employee.fullName },
    total: a.kpis.length,
    filled: filled.length,
    pct: a.kpis.length ? Math.round((filled.length / a.kpis.length) * 100) : 0,
    rows: a.kpis.map((k) => ({
      id: k.id, title: k.title, unit: k.unit, polarity: k.polarity,
      target: k.target, midActual: k.midActual, finalActual: k.finalActual, weight: k.weight,
    })),
  };
}

// ============================================================================
// REVISI TARGET MID-YEAR §27-4 (guard §35-5) — approval ringan L2 via ActivityLog
// ============================================================================

export interface RevisionChange {
  kpiId: string;
  target?: number | null;
  thresholdMin?: number | null;
  stretchValue?: number | null;
  weight?: number;
}

/** Atasan mengajukan revisi (alasan wajib §35-5). Disimpan sebagai ActivityLog
 *  RevisionRequested ber-payload; menunggu keputusan L2 (atasan dari atasan). */
export async function reviseTarget(
  db: TenantDb, actor: CheckinActor, appraisalId: string, changes: RevisionChange[], reason: string,
): Promise<{ requestId: string; approverName: string | null }> {
  const a = await mustAppraisal(db, appraisalId);
  if (!actor.superAdmin && actor.employeeId && a.managerId !== actor.employeeId) {
    throw new Error("Hanya atasan peserta yang dapat mengajukan revisi target (§27-4)");
  }
  // §35-5: fase Ongoing + jendela mid terbuka; ditolak bila sudah Assessment
  if (a.cycle.status !== "Ongoing") {
    throw new Error(`Revisi target hanya saat fase Ongoing — siklus ${a.cycle.code} saat ini ${a.cycle.status} (§35-5)`);
  }
  if (a.cycle.midStart || a.cycle.midEnd) {
    const now = Date.now();
    if (a.cycle.midStart && a.cycle.midStart.getTime() > now) throw new Error("Jendela revisi tengah tahun belum dibuka (§35-5)");
    if (a.cycle.midEnd && a.cycle.midEnd.getTime() < now - DAY_MS) throw new Error("Jendela revisi tengah tahun sudah tutup (§35-5)");
  }
  const cleanReason = reqStr(reason, "Alasan revisi (wajib — realita berubah)");
  if (!changes.length) throw new Error("Pilih minimal satu baris KPI yang direvisi");
  const byId = new Map(a.kpis.map((k) => [k.id, k]));
  const valid = changes.filter((c) => byId.has(c.kpiId));
  if (!valid.length) throw new Error("Baris KPI tidak valid");

  // L2 = atasan dari atasan snapshot (atasan berjenjang); fallback HR (superadmin)
  let approverId: string | null = null;
  let approverName: string | null = null;
  if (a.managerId) {
    const l2 = await db.employeeAssignment.findFirst({
      where: { employeeId: a.managerId, validTo: null },
      select: { manager: { select: { id: true, fullName: true } } },
    });
    approverId = l2?.manager?.id ?? null;
    approverName = l2?.manager?.fullName ?? null;
  }
  if (!approverId && !actor.superAdmin) {
    throw new Error("Atasan berjenjang (L2) tidak ditemukan — minta HR mengatur atasan dari atasan Anda terlebih dahulu");
  }

  const log = await db.activityLog.create({
    data: {
      action: "RevisionRequested", entity: "AppraisalRecord", entityId: appraisalId,
      detail: JSON.stringify({
        cycleCode: a.cycle.code, employee: `${a.employee.employeeNo} ${a.employee.fullName}`,
        requestedBy: actor.employeeId, approverId, approverName, reason: cleanReason,
        changes: valid.map((c) => ({
          kpiId: c.kpiId, title: byId.get(c.kpiId)!.title,
          oldTarget: byId.get(c.kpiId)!.target, newTarget: c.target ?? byId.get(c.kpiId)!.target,
          oldThreshold: byId.get(c.kpiId)!.thresholdMin, newThreshold: c.thresholdMin ?? byId.get(c.kpiId)!.thresholdMin,
          oldStretch: byId.get(c.kpiId)!.stretchValue, newStretch: c.stretchValue ?? byId.get(c.kpiId)!.stretchValue,
          oldWeight: byId.get(c.kpiId)!.weight, newWeight: c.weight ?? byId.get(c.kpiId)!.weight,
        })),
      }),
    },
  });
  return { requestId: log.id, approverName };
}

/** Daftar permintaan revisi menunggu keputusan L2/HR (per siklus opsional). */
export async function pendingRevisions(db: TenantDb, opt: { cycleId?: string; forApproverEmployeeId?: string }): Promise<Record<string, unknown>[]> {
  const reqs = await db.activityLog.findMany({
    where: { action: "RevisionRequested", entity: "AppraisalRecord" },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const decided = new Set(
    (await db.activityLog.findMany({
      where: { action: { in: ["RevisionApproved", "RevisionRejected"] }, entity: "RevisionRequest" },
      select: { detail: true },
      take: 200,
    })).map((d) => /requestId=([^;]+)/.exec(d.detail ?? "")?.[1]).filter(Boolean) as string[],
  );
  const out: Record<string, unknown>[] = [];
  for (const r of reqs) {
    if (decided.has(r.id)) continue;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.detail ?? "{}"); } catch { /* lewati rusak */ }
    if (opt.cycleId && payload.cycleId && payload.cycleId !== opt.cycleId) continue;
    if (opt.forApproverEmployeeId && payload.approverId !== opt.forApproverEmployeeId) continue;
    const ap = await db.appraisalRecord.findUnique({
      where: { id: r.entityId ?? "" },
      select: { cycle: { select: { id: true } } },
    });
    if (opt.cycleId && ap?.cycle.id !== opt.cycleId) continue;
    out.push({ requestId: r.id, appraisalId: r.entityId, createdAt: r.createdAt.toISOString(), ...payload });
  }
  return out;
}

/** Keputusan L2/HR: setujui (terapkan ke AppraisalKpi) / tolak. */
export async function decideRevision(
  db: TenantDb, actor: CheckinActor, requestId: string, decision: "approve" | "reject", note?: string,
): Promise<{ applied: number }> {
  const req = await db.activityLog.findUnique({ where: { id: requestId } });
  if (!req || req.action !== "RevisionRequested") throw new Error("Permintaan revisi tidak ditemukan");
  // payload terserialisasi dgn field display new*/old* (lihat reviseTarget)
  let payload: {
    approverId?: string | null;
    changes?: { kpiId: string; newTarget?: number | null; newThreshold?: number | null; newStretch?: number | null; newWeight?: number | null }[];
    employee?: string; reason?: string; cycleCode?: string;
  };
  try { payload = JSON.parse(req.detail ?? "{}"); } catch { throw new Error("Payload permintaan rusak"); }
  if (!actor.superAdmin && actor.employeeId && payload.approverId !== actor.employeeId) {
    throw new Error("Hanya atasan berjenjang (L2) atau HR yang memutuskan revisi target (§27-4)");
  }
  const a = await mustAppraisal(db, req.entityId ?? "");
  if (a.cycle.status !== "Ongoing") throw new Error(`Revisi hanya dapat diputuskan saat Ongoing — siklus ${a.cycle.code} saat ini ${a.cycle.status}`);

  let applied = 0;
  if (decision === "approve") {
    for (const c of payload.changes ?? []) {
      await db.appraisalKpi.update({
        where: { id: c.kpiId },
        data: {
          ...(c.newTarget != null ? { target: c.newTarget } : {}),
          ...(c.newThreshold != null ? { thresholdMin: c.newThreshold } : {}),
          ...(c.newStretch != null ? { stretchValue: c.newStretch } : {}),
          ...(c.newWeight != null ? { weight: c.newWeight } : {}),
        },
      }).catch(() => { /* baris sudah tidak ada — lewati */ });
      applied++;
    }
  }
  await db.activityLog.create({
    data: {
      action: decision === "approve" ? "RevisionApproved" : "RevisionRejected",
      entity: "RevisionRequest", entityId: requestId,
      detail: `requestId=${requestId}; peserta=${payload.employee ?? "-"}; siklus=${payload.cycleCode ?? "-"}; ${applied} baris ${decision === "approve" ? "diterapkan" : "ditolak"}; alasan=${payload.reason ?? "-"}${note ? `; catatan L2: ${note.slice(0, 160)}` : ""} (§27-4 approval ringan L2)`,
    },
  });
  return { applied };
}

// ============================================================================
// ESS — riwayat 1-on-1 saya (§17 my-checkins) + progres mid
// ============================================================================

export async function myCheckins(db: TenantDb, employeeId: string) {
  const appraisals = await db.appraisalRecord.findMany({
    where: { employeeId },
    include: { cycle: { select: { code: true, status: true, periodStart: true, periodEnd: true } } },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  const out: Record<string, unknown>[] = [];
  for (const a of appraisals) {
    const cis = await db.checkIn.findMany({
      where: { appraisalId: a.id },
      orderBy: { heldAt: "desc" },
      take: 50,
    });
    const kpis = await db.appraisalKpi.findMany({
      where: { appraisalId: a.id },
      select: { id: true, title: true, unit: true, target: true, midActual: true, weight: true },
    });
    out.push({
      appraisalId: a.id, docNo: a.docNo, status: a.status,
      cycle: {
        code: a.cycle.code, status: a.cycle.status,
        periodStart: a.cycle.periodStart.toISOString().slice(0, 10),
        periodEnd: a.cycle.periodEnd.toISOString().slice(0, 10),
      },
      checkins: cis.map((c) => ({
        id: c.id, heldAt: c.heldAt.toISOString().slice(0, 10), agenda: c.agenda, status: c.status,
        notes: parseNotes(c.notesJson), managerComment: c.managerComment,
        nextCheckInAt: c.nextCheckInAt?.toISOString().slice(0, 10) ?? null,
      })),
      midProgress: {
        total: kpis.length,
        filled: kpis.filter((k) => k.midActual != null).length,
        pct: kpis.length ? Math.round((kpis.filter((k) => k.midActual != null).length / kpis.length) * 100) : 0,
        rows: kpis,
      },
    });
  }
  return out.filter((x) => (x.checkins as unknown[]).length > 0 || (x.midProgress as { total: number }).total > 0);
}

// ============================================================================
// SCHEDULER — pengingat check-in jatuh tempo + auto-Missed (§27-1)
// ============================================================================

export interface CheckinReminderOut { reminded: number; autoMissed: number }

/** Dipanggil scheduler-service per tenant: Planned ≤ H-2 → nudge in-app
 *  atasan+karyawan; lewat tenggat > 7 hari → otomatis Missed (ter-log). */
export async function checkinReminders(
  db: TenantDb, push: (appUserIds: string[], title: string, body: string) => Promise<number>,
): Promise<CheckinReminderOut> {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const soon = new Date(today.getTime() + 2 * DAY_MS);
  const planned = await db.checkIn.findMany({
    where: { status: "Planned", heldAt: { lte: soon } },
    include: {
      appraisal: {
        select: {
          employee: { select: { id: true, fullName: true } },
          manager: { select: { id: true, fullName: true } },
          cycle: { select: { code: true } },
        },
      },
    },
    take: 300,
  });
  const out: CheckinReminderOut = { reminded: 0, autoMissed: 0 };
  for (const ci of planned) {
    const dueKey = ci.heldAt.toISOString().slice(0, 10);
    const key = `reminder:perf-checkin:${ci.id}:${dueKey}`;
    const claimed = await db.activityLog.findFirst({ where: { action: "Reminder", entity: "Scheduler", entityId: key } });
    if (claimed) continue;
    await db.activityLog.create({
      data: { actorType: "system", action: "Reminder", entity: "Scheduler", entityId: key, detail: `Pengingat check-in 1-on-1 ${ci.appraisal.employee.fullName} (${ci.heldAt.toISOString().slice(0, 10)}) siklus ${ci.appraisal.cycle.code}` },
    }).catch(() => { /* best effort */ });

    const overdueMs = today.getTime() - ci.heldAt.getTime();
    if (overdueMs > 7 * DAY_MS) {
      // lewat tenggat > 7 hari — tandai terlewat otomatis (audit via log)
      await db.checkIn.update({ where: { id: ci.id }, data: { status: "Missed" } });
      await db.activityLog.create({
        data: { action: "Missed", entity: "CheckIn", entityId: ci.id, detail: `Check-in 1-on-1 terlewat otomatis (lewat tenggat > 7 hari) — peserta ${ci.appraisal.employee.fullName}` },
      }).catch(() => { /* never */ });
      out.autoMissed++;
      continue;
    }
    // nudge in-app atasan + karyawan
    const targets = [ci.appraisal.manager?.id, ci.appraisal.employee.id].filter((x): x is string => !!x);
    const users = await db.appUser.findMany({ where: { employeeId: { in: targets } }, select: { id: true } });
    const tanggal = ci.heldAt.toISOString().slice(0, 10);
    out.reminded += await push(
      users.map((u) => u.id),
      `Check-in 1-on-1 ${ci.appraisal.cycle.code} — ${tanggal}`,
      `Jangan lupa: jadwal check-in 1-on-1 ${ci.appraisal.employee.fullName} pada ${tanggal}. Buka Performance → Check-in.`,
    );
  }
  return out;
}
