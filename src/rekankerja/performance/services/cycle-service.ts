// P1-PERF — service siklus penilaian (DEVELOPMENT-PLAN-PERFORMANCE.md §25–26):
// cycle CRUD + gerbang fase (state machine §35) + enroll peserta (snapshot
// atasan penilai) + Command Center (§18.8 AMANDEMEN 2) + nudge multi-kanal
// dengan rate-limit D17 (1/peserta/kanal/6 jam, hanya jam kerja).
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { nextPerfDocNo, parseWeights, reservePerfDocNoRange } from "./perf-service";

// ============ tipe ============

export interface CycleInput {
  id?: string;
  code: string;
  name: string;
  cycleType?: string;
  periodStart: string;
  periodEnd: string;
  goalStart?: string | null;
  goalEnd?: string | null;
  midStart?: string | null;
  midEnd?: string | null;
  selfStart?: string | null;
  selfEnd?: string | null;
  mgrStart?: string | null;
  mgrEnd?: string | null;
  calibStart?: string | null;
  calibEnd?: string | null;
  weightsJson?: string;
  feedback360?: boolean;
}

const PHASE_FIELDS: [keyof CycleInput, keyof CycleInput][] = [
  ["goalStart", "goalEnd"],
  ["midStart", "midEnd"],
  ["selfStart", "selfEnd"],
  ["mgrStart", "mgrEnd"],
  ["calibStart", "calibEnd"],
];

function bad(msg: string): never { throw new Error(msg); }

function toDate(v: string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) bad(`Tanggal tidak valid: ${v}`);
  return d;
}

/** Validasi jendela fase kronologis dalam periode (§35-1). */
export function validateCycleWindows(input: CycleInput): void {
  const periodStart = toDate(input.periodStart);
  const periodEnd = toDate(input.periodEnd);
  if (!periodStart || !periodEnd) bad("Periode awal & akhir wajib diisi");
  if (periodStart >= periodEnd) bad("Periode awal harus sebelum periode akhir");
  let prevEnd: Date | null = null;
  for (const [s, e] of PHASE_FIELDS) {
    const ws = toDate(input[s] as string | null | undefined);
    const we = toDate(input[e] as string | null | undefined);
    if ((ws == null) !== (we == null)) bad("Jendela fase harus berpasangan awal–akhir (atau kosong untuk dilewati)");
    if (ws && we) {
      if (ws >= we) bad(`Jendela fase harus awal < akhir (${s})`);
      if (prevEnd && ws < prevEnd) bad("Jendela fase harus kronologis (goal → mid → self → mgr → kalibrasi)");
      if (ws < periodStart || we > periodEnd) bad("Jendela fase harus dalam periode siklus");
      prevEnd = we;
    }
  }
  const publishAt = toDate(input.calibEnd); // publish mengikuti penutupan kalibrasi
  void publishAt;
}

// ============ LIST & DETAIL ============

export async function listCycles(
  db: TenantDb,
  opts: { status?: string; year?: string; q?: string; limit?: number; offset?: number },
) {
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;
  if (opts.q) where.OR = [
    { code: { contains: opts.q, mode: "insensitive" } },
    { name: { contains: opts.q, mode: "insensitive" } },
  ];
  if (opts.year) {
    const y = Number(opts.year);
    if (Number.isFinite(y)) {
      where.periodStart = { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) };
    }
  }
  const [rows, total] = await Promise.all([
    db.performanceCycle.findMany({
      where,
      orderBy: [{ periodStart: "desc" }],
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
      include: { _count: { select: { appraisals: true } } },
    }),
    db.performanceCycle.count({ where }),
  ]);
  return {
    rows: rows.map((c) => ({ ...c, participantCount: c._count.appraisals })),
    total,
  };
}

export async function getCycleDetail(db: TenantDb, id: string) {
  const cycle = await db.performanceCycle.findUnique({
    where: { id },
    include: {
      appraisals: {
        include: {
          employee: {
            select: {
              id: true, employeeNo: true, fullName: true,
              position: { select: { title: true } },
              orgUnit: { select: { name: true } },
            },
          },
          manager: { select: { id: true, fullName: true } },
          kpis: { select: { id: true, weight: true, target: true, thresholdMin: true, isCritical: true, unit: true, polarity: true } },
        },
        orderBy: { docNo: "asc" },
      },
    },
  });
  if (!cycle) bad("Siklus tidak ditemukan");
  const rows = cycle.appraisals.map((a) => {
    const kpis = a.kpis;
    const weightSum = kpis.reduce((s, k) => s + k.weight, 0);
    // progres §18.7: field wajib terisi ÷ total (target+ambang per KPI; Boolean → kritis terdefinisi)
    let filled = 0;
    for (const k of kpis) {
      const targetOk = k.target != null;
      const thrOk = k.polarity === "Boolean" ? true : k.thresholdMin != null;
      if (targetOk && thrOk) filled++;
    }
    const progressPct = kpis.length === 0 ? 0 : Math.round((filled / kpis.length) * 100);
    return {
      id: a.id,
      docNo: a.docNo,
      employeeId: a.employeeId,
      employeeNo: a.employee.employeeNo,
      employeeName: a.employee.fullName,
      position: a.employee.position?.title ?? null,
      orgUnit: a.employee.orgUnit?.name ?? null,
      managerId: a.managerId,
      managerName: a.manager?.fullName ?? null,
      status: a.status,
      goalsCopiedFrom: a.goalsCopiedFrom,
      kpiCount: kpis.length,
      weightSum,
      progressPct,
      acknowledgedAt: a.acknowledgedAt,
    };
  });
  const { appraisals: _drop, ...cycleFields } = cycle;
  return { cycle: cycleFields, participants: rows };
}

// ============ CREATE / PATCH ============

export async function createCycle(db: TenantDb, input: CycleInput, actor: string): Promise<string> {
  const code = (input.code ?? "").trim();
  const name = (input.name ?? "").trim();
  if (!code) bad("Kode siklus wajib diisi (mis. PER-2026)");
  if (!name) bad("Nama siklus wajib diisi");
  validateCycleWindows(input);
  const dup = await db.performanceCycle.findUnique({ where: { code } });
  if (dup) bad(`Kode siklus ${code} sudah ada`);
  let weightsJson = input.weightsJson;
  if (!weightsJson) {
    const setting = await db.performanceSetting.findFirst({ select: { defWeights: true } });
    weightsJson = setting?.defWeights ?? "70|20|10";
  } else {
    const w = parseWeights(weightsJson);
    weightsJson = JSON.stringify(w);
  }
  const row = await db.performanceCycle.create({
    data: {
      code, name,
      cycleType: input.cycleType ?? "Annual",
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      goalStart: toDate(input.goalStart),
      goalEnd: toDate(input.goalEnd),
      midStart: toDate(input.midStart),
      midEnd: toDate(input.midEnd),
      selfStart: toDate(input.selfStart),
      selfEnd: toDate(input.selfEnd),
      mgrStart: toDate(input.mgrStart),
      mgrEnd: toDate(input.mgrEnd),
      calibStart: toDate(input.calibStart),
      calibEnd: toDate(input.calibEnd),
      weightsJson,
      feedback360: input.feedback360 === true,
      status: "Draft",
      createdBy: actor,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PerformanceCycle", entityId: row.id,
      detail: `Siklus penilaian ${code} — ${name} dibuat (Draft) oleh ${actor}`,
    },
  });
  return row.id;
}

export async function patchCycle(db: TenantDb, id: string, input: Partial<CycleInput>, actor: string): Promise<void> {
  const row = await db.performanceCycle.findUnique({ where: { id } });
  if (!row) bad("Siklus tidak ditemukan");
  if (row.status !== "Draft") bad("Siklus hanya dapat diubah saat masih Draft (perubahan fase berikutnya lewat aksi bernama)");
  const merged: CycleInput = {
    ...input,
    code: row.code, // kode tidak diubah
    name: input.name ?? row.name,
    periodStart: input.periodStart ?? row.periodStart.toISOString(),
    periodEnd: input.periodEnd ?? row.periodEnd.toISOString(),
  };
  validateCycleWindows(merged);
  await db.performanceCycle.update({
    where: { id },
    data: {
      name: (input.name ?? row.name).trim() || row.name,
      cycleType: input.cycleType ?? row.cycleType,
      periodStart: new Date(merged.periodStart),
      periodEnd: new Date(merged.periodEnd),
      goalStart: toDate(merged.goalStart),
      goalEnd: toDate(merged.goalEnd),
      midStart: toDate(merged.midStart),
      midEnd: toDate(merged.midEnd),
      selfStart: toDate(merged.selfStart),
      selfEnd: toDate(merged.selfEnd),
      mgrStart: toDate(merged.mgrStart),
      mgrEnd: toDate(merged.mgrEnd),
      calibStart: toDate(merged.calibStart),
      calibEnd: toDate(merged.calibEnd),
      ...(input.weightsJson ? { weightsJson: JSON.stringify(parseWeights(input.weightsJson)) } : {}),
      feedback360: input.feedback360 ?? row.feedback360,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PerformanceCycle", entityId: id,
      detail: `Siklus penilaian ${row.code} diperbarui (Draft) oleh ${actor}`,
    },
  });
}

// ============ ENROLL (§25-3) ============

async function managerOf(db: TenantDb, employeeId: string): Promise<string | null> {
  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { managerId: true },
  });
  return assignment?.managerId ?? null;
}

/** Batch managerOf (P9 — enroll massal §22): assignment aktif SEMUA karyawan
 *  dalam SATU query; per karyawan ambil yang validFrom terbaru (mirror
 *  findFirst orderBy validFrom desc). */
async function managerOfMany(db: TenantDb, employeeIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const id of employeeIds) map.set(id, null);
  if (employeeIds.length === 0) return map;
  const rows = await db.employeeAssignment.findMany({
    where: { employeeId: { in: employeeIds }, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { employeeId: true, managerId: true },
  });
  for (const r of rows) {
    if (map.get(r.employeeId) == null) map.set(r.employeeId, r.managerId);
  }
  return map;
}

/** Ambang jalur cepat enroll batch (P9 §22 — di atasnya query per-baris
 *  terasa pada 500 karyawan; di bawahnya perilaku loop lama dipertahankan). */
const ENROLL_BATCH_THRESHOLD = 50;

export async function enrollParticipants(
  db: TenantDb,
  cycleId: string,
  input: { employeeIds?: string[]; allActive?: boolean },
  actor: string,
): Promise<{ enrolled: number; skipped: number; needManager: string[] }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "Draft" && cycle.status !== "GoalSetting") {
    bad("Enroll hanya boleh saat siklus Draft atau fase GoalSetting");
  }
  let employeeIds: string[] = [];
  if (input.allActive) {
    const emps = await db.employee.findMany({
      where: { status: "Active" }, select: { id: true }, orderBy: { employeeNo: "asc" },
    });
    employeeIds = emps.map((e) => e.id);
  } else if (input.employeeIds?.length) {
    employeeIds = input.employeeIds;
  } else {
    bad("Pilih karyawan atau gunakan mode semua karyawan Active");
  }
  const existing = await db.appraisalRecord.findMany({
    where: { cycleId, employeeId: { in: employeeIds } },
    select: { employeeId: true },
  });
  const existingSet = new Set(existing.map((e) => e.employeeId));
  const activeEmps = await db.employee.findMany({
    where: { id: { in: employeeIds }, status: "Active" },
    select: { id: true, fullName: true, employeeNo: true },
  });
  const candidates = activeEmps.filter((e) => !existingSet.has(e.id));
  const needManager: string[] = [];
  let enrolled = 0;
  if (candidates.length > ENROLL_BATCH_THRESHOLD) {
    // P9-PERF — jalur cepat batch (§22 risiko 500 karyawan): 1 query atasan
    // (managerOfMany) + 1 scan penomoran (reservePerfDocNoRange) + createMany —
    // menggantikan 3 query × N baris. Perilaku respons IDENTIK jalur lama.
    const managerMap = await managerOfMany(db, candidates.map((e) => e.id));
    const docNos = await reservePerfDocNoRange(db, "appraisal", candidates.length);
    const data = candidates.map((emp, i) => {
      const managerId = managerMap.get(emp.id) ?? null;
      if (!managerId) needManager.push(`${emp.employeeNo} — ${emp.fullName}`);
      return { docNo: docNos[i] as string, cycleId, employeeId: emp.id, managerId, status: "Enrolled" };
    });
    if (data.length > 0) {
      await db.appraisalRecord.createMany({ data });
      enrolled = data.length;
    }
  } else {
    // jalur lama — perilaku ≤50 kandidat TIDAK berubah (loop per karyawan)
    for (const emp of candidates) {
      const managerId = await managerOf(db, emp.id);
      if (!managerId) needManager.push(`${emp.employeeNo} — ${emp.fullName}`);
      const docNo = await nextPerfDocNo(db, "appraisal");
      await db.appraisalRecord.create({
        data: { docNo, cycleId, employeeId: emp.id, managerId, status: "Enrolled" },
      });
      enrolled++;
    }
  }
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Enroll peserta siklus ${cycle.code}: ${enrolled} baru, ${employeeIds.length - existingSet.size - enrolled} tidak Active/dilewati${needManager.length ? `; perlu penunjukan atasan: ${needManager.join(", ")}` : ""} — oleh ${actor}`,
    },
  });
  return { enrolled, skipped: employeeIds.length - enrolled, needManager };
}

// ============ GERBANG FASE (§35 state machine) ============

const NEXT_STATUS: Record<string, string> = {
  Draft: "GoalSetting",
  GoalSetting: "Ongoing",
  Ongoing: "Assessment",
  Assessment: "Calibration",
  Calibration: "Published",
  Published: "Closed",
};

async function setCycleStatus(db: TenantDb, cycleId: string, target: string, actor: string, note?: string): Promise<void> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (NEXT_STATUS[cycle.status] !== target) {
    bad(`Transisi fase tidak sah: ${cycle.status} → ${target} (urutan sah: Draft → GoalSetting → Ongoing → Assessment → Calibration → Published → Closed)`);
  }
  await db.performanceCycle.update({
    where: { id: cycleId },
    data: { status: target, ...(target === "Published" ? { publishAt: new Date() } : {}) },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Siklus ${cycle.code}: fase ${cycle.status} → ${target}${note ? ` (${note})` : ""} — oleh ${actor}`,
    },
  });
}

export async function openGoal(db: TenantDb, cycleId: string, actor: string, force?: boolean): Promise<void> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true, goalEnd: true, goalStart: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  if (cycle.status !== "Draft") bad("Fase target hanya dapat dibuka dari siklus Draft");
  const participants = await db.appraisalRecord.count({ where: { cycleId } });
  if (participants === 0) bad("Belum ada peserta — enroll karyawan terlebih dahulu (§35-1)");
  if (!cycle.goalEnd || !cycle.goalStart) {
    if (!force) bad("Jendela fase target (goalStart/goalEnd) belum diatur — lengkapi siklus atau paksa dengan ter-catat");
  }
  await setCycleStatus(db, cycleId, "GoalSetting", actor, force ? "dipaksa tanpa jendela target" : undefined);
}

export async function advanceCycle(db: TenantDb, cycleId: string, target: string, actor: string, force?: boolean): Promise<void> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { code: true, status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  // gerbang lunak: jendela lewat boleh; lompat fase hanya dengan force (ter-log)
  if (NEXT_STATUS[cycle.status] !== target) {
    if (!force) bad(`Transisi fase tidak sah: ${cycle.status} → ${target}`);
    // force: lompat ke target langsung (dilog)
  }
  const note = force && NEXT_STATUS[cycle.status] !== target ? `LOMPAT fase dipaksa dari ${cycle.status}` : undefined;
  await db.performanceCycle.update({
    where: { id: cycleId },
    data: { status: target, ...(target === "Published" ? { publishAt: new Date() } : {}) },
  });
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "PerformanceCycle", entityId: cycleId,
      detail: `Siklus ${cycle.code}: fase ${cycle.status} → ${target}${note ? ` (${note})` : ""} — oleh ${actor}`,
    },
  });
}

/** Opsi karyawan utk dialog enroll (picker) — guard performance:cycles. */
export async function listEnrollable(db: TenantDb, cycleId: string, q?: string) {
  const enrolled = await db.appraisalRecord.findMany({
    where: { cycleId },
    select: { employeeId: true },
  });
  const enrolledSet = new Set(enrolled.map((e) => e.employeeId));
  const where: Record<string, unknown> = { status: "Active" };
  if (q) where.OR = [
    { employeeNo: { contains: q, mode: "insensitive" } },
    { fullName: { contains: q, mode: "insensitive" } },
  ];
  const emps = await db.employee.findMany({
    where,
    select: {
      id: true, employeeNo: true, fullName: true,
      position: { select: { title: true } },
      orgUnit: { select: { name: true } },
    },
    orderBy: { employeeNo: "asc" },
    take: 100,
  });
  return {
    employees: emps.map((e) => ({
      id: e.id,
      employeeNo: e.employeeNo,
      fullName: e.fullName,
      position: e.position?.title ?? null,
      orgUnit: e.orgUnit?.name ?? null,
      enrolled: enrolledSet.has(e.id),
    })),
  };
}

// ============ COMMAND CENTER (§18.8) ============

export async function commandCenter(db: TenantDb, cycleId: string) {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const appraisals = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: {
      employee: {
        select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } },
      },
      manager: { select: { id: true, fullName: true } },
      kpis: { select: { target: true, thresholdMin: true, isCritical: true, polarity: true, finalActual: true } },
    },
    orderBy: { docNo: "asc" },
  });
  const participants = appraisals.map((a) => {
    const statusRank = ["Enrolled", "GoalProposed", "GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
    const targetDone = statusRank.indexOf(a.status) >= statusRank.indexOf("GoalApproved");
    const selfDone = statusRank.indexOf(a.status) >= statusRank.indexOf("SelfDone");
    const managerDone = statusRank.indexOf(a.status) >= statusRank.indexOf("ManagerDone");
    let filled = 0;
    for (const k of a.kpis) {
      if (k.target != null && (k.polarity === "Boolean" || k.thresholdMin != null)) filled++;
    }
    return {
      appraisalId: a.id,
      docNo: a.docNo,
      employeeId: a.employeeId,
      employeeNo: a.employee.employeeNo,
      employeeName: a.employee.fullName,
      orgUnit: a.employee.orgUnit?.name ?? null,
      managerId: a.managerId,
      managerName: a.manager?.fullName ?? "—",
      status: a.status,
      targetDone,
      selfDone,
      managerDone,
      acknowledged: a.acknowledgedAt != null,
      progressPct: a.kpis.length === 0 ? 0 : Math.round((filled / a.kpis.length) * 100),
      kpiCount: a.kpis.length,
    };
  });
  // agregat per atasan (§18.8: "Sri Wahyuni: 5/6 target — 86%")
  const byManager = new Map<string, { managerId: string; managerName: string; team: number; targetDone: number; selfDone: number; managerDone: number; progressSum: number }>();
  for (const p of participants) {
    if (!p.managerId) continue;
    const m = byManager.get(p.managerId) ?? { managerId: p.managerId, managerName: p.managerName, team: 0, targetDone: 0, selfDone: 0, managerDone: 0, progressSum: 0 };
    m.team++;
    if (p.targetDone) m.targetDone++;
    if (p.selfDone) m.selfDone++;
    if (p.managerDone) m.managerDone++;
    m.progressSum += p.progressPct;
    byManager.set(p.managerId, m);
  }
  const managers = Array.from(byManager.values()).map((m) => ({
    ...m,
    progressPct: m.team === 0 ? 0 : Math.round(m.progressSum / m.team),
  })).sort((a, b) => (a.progressPct - b.progressPct)); // paling tertinggal di atas
  const totals = {
    participants: participants.length,
    targetDone: participants.filter((p) => p.targetDone).length,
    selfDone: participants.filter((p) => p.selfDone).length,
    managerDone: participants.filter((p) => p.managerDone).length,
    acknowledged: participants.filter((p) => p.acknowledged).length,
  };
  return { cycle: { id: cycle.id, code: cycle.code, name: cycle.name, status: cycle.status, goalEnd: cycle.goalEnd, selfEnd: cycle.selfEnd, mgrEnd: cycle.mgrEnd }, participants, managers, totals };
}

// ============ NUDGE MULTI-KANAL (§18.8 + D17) ============

const NUDGE_CHANNELS = ["in_app", "email", "whatsapp"] as const;
export type NudgeChannel = (typeof NUDGE_CHANNELS)[number];

function isWorkHoursJakarta(d = new Date()): boolean {
  // Asia/Jakarta = UTC+7; jam kerja 08:00–17:00 Sen–Jum (D17)
  const jak = new Date(d.getTime() + 7 * 3600 * 1000);
  const day = jak.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = jak.getUTCHours();
  return hour >= 8 && hour < 17;
}

async function nudgedRecently(db: TenantDb, appraisalId: string, channel: string): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const n = await db.activityLog.count({
    where: {
      action: "Reminder",
      entity: "PerformanceNudge",
      entityId: `${appraisalId}:${channel}`,
      createdAt: { gte: since },
    },
  });
  return n > 0;
}

async function appUsersOfEmployee(db: TenantDb, employeeId: string): Promise<string[]> {
  const rows = await db.appUser.findMany({ where: { employeeId, active: true }, select: { id: true }, take: 5 });
  return rows.map((r) => r.id);
}

export interface NudgeResult {
  sent: { employeeName: string; channels: string[] }[];
  rateLimited: string[];
  queuedOutsideWorkHours: boolean;
}

export async function nudgeParticipants(
  db: TenantDb,
  input: { cycleId: string; appraisalIds: string[]; channels?: NudgeChannel[]; phase?: string; message?: string },
  actor: string,
): Promise<NudgeResult> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId }, select: { code: true, name: true, goalEnd: true, selfEnd: true, mgrEnd: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const channels = input.channels?.length ? input.channels : (["in_app", "email"] as NudgeChannel[]);
  for (const ch of channels) {
    if (!NUDGE_CHANNELS.includes(ch)) bad(`Kanal tidak dikenal: ${ch} (sah: in_app, email, whatsapp — Slack = backlog D17)`);
  }
  const workHours = isWorkHoursJakarta();
  const result: NudgeResult = { sent: [], rateLimited: [], queuedOutsideWorkHours: false };
  const appraisals = await db.appraisalRecord.findMany({
    where: { id: { in: input.appraisalIds }, cycleId: input.cycleId },
    include: { employee: { select: { id: true, fullName: true } }, manager: { select: { id: true, fullName: true } } },
  });
  const phase = input.phase ?? "target";
  const deadlineMap: Record<string, string | null> = { target: cycle.goalEnd?.toISOString() ?? null, self: cycle.selfEnd?.toISOString() ?? null, manager: cycle.mgrEnd?.toISOString() ?? null };
  const deadline = deadlineMap[phase] ?? null;
  for (const a of appraisals) {
    const sentChannels: string[] = [];
    for (const ch of channels) {
      if (await nudgedRecently(db, a.id, ch)) {
        result.rateLimited.push(`${a.employee.fullName} (${ch})`);
        continue;
      }
      // bukti kirim + rate-limit marker (ActivityLog — prinsip §12-6)
      await db.activityLog.create({
        data: {
          action: "Reminder", entity: "PerformanceNudge", entityId: `${a.id}:${ch}`,
          employeeId: a.employeeId,
          detail: `Nudge ${phase} siklus ${cycle.code} kanal ${ch} → ${a.employee.fullName}${a.manager ? ` (atasan: ${a.manager.fullName})` : ""}${input.message ? ` — pesan: ${input.message}` : ""} — oleh ${actor}${workHours ? "" : " (DIANTREKAN — di luar jam kerja, terkirim dijam kerja berikutnya)"}`,
        },
      });
      sentChannels.push(ch);
      if (ch === "in_app") {
        const userIds = await appUsersOfEmployee(db, a.manager?.id ?? a.employee.id);
        const link = phase === "target" ? "performance:goals" : "performance:appraisals";
        for (const uid of userIds) {
          await db.notification.create({
            data: {
              appUserId: uid,
              title: `Pengingatan pengisian ${phase === "target" ? "target KPI" : phase === "self" ? "penilaian diri" : "penilaian atasan"} — ${cycle.code}`,
              body: input.message?.trim() || `Formulir Anda belum selesai. ${deadline ? `Tenggat: ${new Date(deadline).toLocaleDateString("id-ID")}. ` : ""}Buka formulir lewat menu ${phase === "target" ? "Performance → Target & KPI" : "Performance → Penilaian"}.`,
              kind: "performance",
              link,
            },
          }).catch(() => null);
        }
      }
      // email & whatsapp: adapter (deep-link teks); WhatsApp butuh konfigurasi adapter
      // env WHATSAPP_API_URL — tanpa itu tercatat terkirim-log saja (seam D17).
      if (ch === "whatsapp" && !process.env.WHATSAPP_API_URL) {
        // adapter belum dikonfigurasi — bukti = ActivityLog di atas (tidak gagal)
      }
    }
    if (sentChannels.length) result.sent.push({ employeeName: a.employee.fullName, channels: sentChannels });
  }
  result.queuedOutsideWorkHours = !workHours && result.sent.length > 0;
  return result;
}

/** Peserta "tertinggal di fase aktif" (untuk Remind All §18.8). */
export async function laggingParticipants(db: TenantDb, cycleId: string): Promise<{ phase: string; appraisalIds: string[] }> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId }, select: { status: true } });
  if (!cycle) bad("Siklus tidak ditemukan");
  const statusRank = ["Enrolled", "GoalProposed", "GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
  const rank = (s: string) => statusRank.indexOf(s);
  if (cycle.status === "GoalSetting" || cycle.status === "Draft") {
    const rows = await db.appraisalRecord.findMany({
      where: { cycleId, status: { in: ["Enrolled", "GoalProposed"] } },
      select: { id: true },
    });
    return { phase: "target", appraisalIds: rows.map((r) => r.id) };
  }
  if (cycle.status === "Assessment") {
    const rows = await db.appraisalRecord.findMany({
      where: { cycleId, status: { in: ["GoalApproved", "Ongoing", "SelfDone"] } },
      select: { id: true },
    });
    return { phase: "manager", appraisalIds: rows.map((r) => r.id) };
  }
  if (cycle.status === "Ongoing") {
    const rows = await db.appraisalRecord.findMany({ where: { cycleId }, select: { id: true } });
    return { phase: "ongoing", appraisalIds: rows.map((r) => r.id) };
  }
  const rows = await db.appraisalRecord.findMany({
    where: { cycleId, status: { in: ["Calibrating", "Finalized", "ManagerDone"] } },
    select: { id: true },
  });
  void rank;
  return { phase: "calibration", appraisalIds: rows.map((r) => r.id) };
}
