import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { pushNotification } from "@/rekankerja/shared/services/notification-service";
import { sendSystemEmail, employeeEmailOf } from "@/rekankerja/shared/services/email-service";
import { sendWa, employeePhoneOf } from "@/rekankerja/shared/services/wa-service";

// ============================================================================
// PERFORMANCE — Service siklus & Command Center (P1 — DEVELOPMENT-PLAN-
// PERFORMANCE.md §20 P1, §17 endpoint cycles, §18.8 Command Center & Nudge)
//
// Isi:
//   • Cycle CRUD (status Draft — PATCH hanya saat Draft; guard §35-1)
//   • Gerbang fase: openGoal (§35-1) → startOngoing → startAssessment →
//     startCalibration → publish (§35-12) → close (§35-16). Fase ber-jendela
//     null boleh DILEWATI (register D-risiko "fase kaku").
//   • Enroll peserta (§25-3): karyawan Active + snapshot managerId dari
//     EmployeeAssignment aktif; tolak duplikat (§35-2); tanpa atasan →
//     ditandai "butuh penunjukan atasan" (HR override manual dimungkinkan).
//   • Command Center (§18.8 AM2): matriks status peserta × fase + progres %
//     + agregat per atasan + siapa yang tertinggal di fase aktif.
//   • Nudge multi-kanal (D17): in-app + email + WhatsApp, deep-link, JAM
//     KERJA 07:00–18:00 WIB (malam → antre otomatis), RATE-LIMIT 1 per
//     peserta per kanal per 6 jam (via ActivityLog "Nudged"), setiap kirim
//     ter-ActivityLog (guard §35-29).
// ============================================================================

// ---------- konstanta status ----------

const STATUS_ORDER: Record<string, number> = {
  Draft: 0, GoalSetting: 1, Ongoing: 2, Assessment: 3, Calibration: 4, Published: 5, Closed: 6,
};

/** Status siklus (nilai enum DB — turunan keys, bukan teks display). */
export const CYCLE_STATUSES = Object.keys(STATUS_ORDER);
export type CycleStatus = string;

/** Status appraisal yang berarti target sudah TERKUNCI (§35-24 "sumber valid"). */
export const APPRAISAL_LOCKED = [
  "GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed",
] as const;


export const CYCLE_TYPES = ["Annual", "MidYearOnly", "OffCycle"] as const;
export const NUDGE_CHANNELS = ["in-app", "email", "wa"] as const;
export type NudgeChannel = (typeof NUDGE_CHANNELS)[number];

/** Jam kerja pengiriman nudge (D17): 07:00–18:00 WIB (Asia/Jakarta, UTC+7). */
export function isWorkingHourJakarta(now = new Date()): boolean {
  const wibHour = (now.getUTCHours() + 7) % 24;
  return wibHour >= 7 && wibHour < 18;
}

// ---------- util tanggal & validasi ----------

const DAY_MS = 86_400_000;

function dateOf(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tanggal "YYYY-MM-DD" → tengah hari lokal (hindari geser batas hari TZ). */
function dayOf(v: unknown): Date | null {
  const d = dateOf(v);
  if (!d) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

function reqStr(v: unknown, label: string): string {
  const s = v != null ? String(v).trim() : "";
  if (!s) throw new Error(`${label} wajib diisi`);
  return s;
}

/**
 * Jendela fase harus KRONOLOGIS: goal ≤ mid ≤ self ≤ mgr ≤ calib ≤ publish
 * (masing-masing start ≤ end bila keduanya terisi). Null = fase dilewati.
 */
function windowsChronological(c: Record<string, unknown>): boolean {
  const seq: (Date | null)[] = [
    dayOf(c.goalEnd), dayOf(c.midStart), dayOf(c.midEnd), dayOf(c.selfStart), dayOf(c.selfEnd),
    dayOf(c.mgrStart), dayOf(c.mgrEnd), dayOf(c.calibStart), dayOf(c.calibEnd), dayOf(c.publishAt),
  ];
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i], b = seq[i + 1];
    if (a && b && b.getTime() < a.getTime()) return false;
  }
  for (const [s, e] of [
    [dayOf(c.goalStart), dayOf(c.goalEnd)], [dayOf(c.midStart), dayOf(c.midEnd)],
    [dayOf(c.selfStart), dayOf(c.selfEnd)], [dayOf(c.mgrStart), dayOf(c.mgrEnd)],
    [dayOf(c.calibStart), dayOf(c.calibEnd)],
  ] as [Date | null, Date | null][]) {
    if (s && e && e.getTime() < s.getTime()) return false;
  }
  return true;
}

// ============================================================================
// LIST + STATISTIK
// ============================================================================

export async function listCycles(
  db: TenantDb, opt: { status?: string; year?: number; q?: string },
): Promise<Record<string, unknown>[]> {
  const where: Record<string, unknown> = {};
  if (opt.status && (CYCLE_STATUSES as readonly string[]).includes(opt.status)) where.status = opt.status;
  if (opt.year) {
    const from = new Date(Date.UTC(opt.year, 0, 1));
    const to = new Date(Date.UTC(opt.year + 1, 0, 1));
    where.periodStart = { lt: to, gte: new Date(Date.UTC(opt.year - 1, 11, 31)) }; // overlap tahun periode
    void from;
  }
  const rows = await db.performanceCycle.findMany({
    where,
    include: { appraisals: { select: { status: true, managerId: true } } },
    orderBy: { periodStart: "desc" },
    take: 200,
  });
  const q = (opt.q ?? "").toLowerCase();
  return rows
    .filter((r) => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
    .map((r) => {
      const total = r.appraisals.length;
      const locked = r.appraisals.filter((a) => (APPRAISAL_LOCKED as readonly string[]).includes(a.status)).length;
      const { appraisals: _drop, ...cycle } = r;
      void _drop;
      return { ...cycle, participantCount: total, goalApprovedCount: locked };
    });
}

export async function getCycle(db: TenantDb, id: string) {
  return db.performanceCycle.findUnique({
    where: { id },
    include: { appraisals: { select: { id: true, status: true } } },
  });
}

// ============================================================================
// CRUD — status Draft
// ============================================================================

export interface CycleInput {
  code: string;
  name: string;
  cycleType?: string;
  periodStart: unknown;
  periodEnd: unknown;
  goalStart?: unknown; goalEnd?: unknown;
  midStart?: unknown; midEnd?: unknown;
  selfStart?: unknown; selfEnd?: unknown;
  mgrStart?: unknown; mgrEnd?: unknown;
  calibStart?: unknown; calibEnd?: unknown;
  publishAt?: unknown;
  weightsJson?: string;
  feedback360?: boolean;
}

export function normalizeCycleInput(input: CycleInput): Record<string, unknown> {
  const code = reqStr(input.code, "Kode siklus");
  const name = reqStr(input.name, "Nama siklus");
  const cycleType = input.cycleType ?? "Annual";
  if (!(CYCLE_TYPES as readonly string[]).includes(cycleType)) throw new Error(`Jenis siklus tidak valid: ${cycleType}`);
  const periodStart = dayOf(input.periodStart);
  const periodEnd = dayOf(input.periodEnd);
  if (!periodStart || !periodEnd) throw new Error("Periode siklus wajib diisi");
  if (periodEnd.getTime() <= periodStart.getTime()) throw new Error("Akhir periode harus setelah awal periode");

  let weights: { kpi?: number; competency?: number; core?: number } = { kpi: 70, competency: 20, core: 10 };
  if (input.weightsJson) {
    try { weights = JSON.parse(input.weightsJson); } catch { throw new Error("Bobot siklus tidak valid (JSON)"); }
    const sum = (weights.kpi ?? 0) + (weights.competency ?? 0) + (weights.core ?? 0);
    if (sum !== 100) throw new Error(`Total bobot harus 100 (sekarang ${sum})`);
  }

  const c: Record<string, unknown> = {
    code, name, cycleType, periodStart, periodEnd,
    goalStart: dayOf(input.goalStart), goalEnd: dayOf(input.goalEnd),
    midStart: dayOf(input.midStart), midEnd: dayOf(input.midEnd),
    selfStart: dayOf(input.selfStart), selfEnd: dayOf(input.selfEnd),
    mgrStart: dayOf(input.mgrStart), mgrEnd: dayOf(input.mgrEnd),
    calibStart: dayOf(input.calibStart), calibEnd: dayOf(input.calibEnd),
    publishAt: dayOf(input.publishAt),
    weightsJson: JSON.stringify(weights),
    feedback360: input.feedback360 === true,
  };
  if (!windowsChronological(c)) throw new Error("Jendela fase tidak kronologis (goal ≤ mid ≤ self ≤ manager ≤ kalibrasi ≤ publikasi)");
  return c;
}

export async function createCycle(db: TenantDb, input: CycleInput): Promise<string> {
  const data = normalizeCycleInput(input);
  const dup = await db.performanceCycle.findUnique({ where: { code: data.code as string } });
  if (dup) throw new Error(`Kode siklus ${data.code} sudah ada`);
  return (await db.performanceCycle.create({ data: data as never })).id;
}

export async function updateCycle(db: TenantDb, id: string, input: CycleInput): Promise<void> {
  const cur = await db.performanceCycle.findUnique({ where: { id } });
  if (!cur) throw new Error("Siklus tidak ditemukan");
  if (cur.status !== "Draft") throw new Error("Siklus hanya dapat diubah saat masih Draft (gerbang fase sudah dilewati)");
  const data = normalizeCycleInput(input);
  if (data.code !== cur.code) {
    const dup = await db.performanceCycle.findUnique({ where: { code: data.code as string } });
    if (dup) throw new Error(`Kode siklus ${data.code} sudah ada`);
  }
  await db.performanceCycle.update({ where: { id }, data: data as never });
}

/** Hapus siklus — HANYA Draft (peserta ikut terhapus; KPI baris cascade). */
export async function deleteCycle(db: TenantDb, id: string): Promise<void> {
  const cur = await db.performanceCycle.findUnique({ where: { id }, include: { appraisals: { select: { id: true } } } });
  if (!cur) throw new Error("Siklus tidak ditemukan");
  if (cur.status !== "Draft") throw new Error("Siklus hanya dapat dihapus saat masih Draft");
  // AppraisalKpi cascade per appraisal; appraisal dihapus dulu (FK cycle tanpa cascade)
  await db.appraisalRecord.deleteMany({ where: { cycleId: id } });
  await db.performanceCycle.delete({ where: { id } });
}

// ============================================================================
// ENROLL PESERTA (§25-3, guard §35-2)
// ============================================================================

export interface EnrollInput {
  cycleId: string;
  mode: "all" | "unit" | "ids";
  unitId?: string;
  employeeIds?: string[];
  /** HR override manual: employeeId → managerId (karyawan tanpa atasan §25). */
  managerOverrides?: Record<string, string>;
}

export interface EnrollReport {
  enrolled: { employeeNo: string; fullName: string; managerName: string | null }[];
  skippedDuplicate: { employeeNo: string; fullName: string }[];
  needManager: { employeeNo: string; fullName: string }[];
  docNos: string[];
}

export async function enrollParticipants(
  db: TenantDb, input: EnrollInput,
): Promise<EnrollReport> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: input.cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");
  if (cycle.status !== "Draft" && cycle.status !== "GoalSetting") {
    throw new Error("Enroll hanya sah saat siklus Draft / GoalSetting (peserta baru masuk fase berjalan)");
  }

  // kandidat: karyawan Active sesuai mode
  const where: Record<string, unknown> = { status: "Active" };
  if (input.mode === "unit" && input.unitId) where.orgUnitId = input.unitId;
  if (input.mode === "ids" && input.employeeIds?.length) where.id = { in: input.employeeIds };
  const emps = await db.employee.findMany({
    where: where as never,
    select: { id: true, employeeNo: true, fullName: true, orgUnitId: true },
    orderBy: { employeeNo: "asc" },
    take: 1000,
  });

  // assignment aktif → snapshot atasan (§8-10 "siapa menilai siapa terkunci")
  const assigns = await db.employeeAssignment.findMany({
    where: { employeeId: { in: emps.map((e) => e.id) }, validTo: null },
    select: { employeeId: true, managerId: true },
  });
  const mgrOf = new Map(assigns.map((a) => [a.employeeId, a.managerId]));
  for (const [empId, mgrId] of Object.entries(input.managerOverrides ?? {})) {
    if (mgrId) mgrOf.set(empId, String(mgrId));
  }

  // sudah terdaftar? (§35-2 tolak duplikat cycleId+employeeId — unique DB)
  const existing = await db.appraisalRecord.findMany({
    where: { cycleId: cycle.id },
    select: { employeeId: true },
  });
  const existingIds = new Set(existing.map((e) => e.employeeId));

  const year = cycle.periodStart.getFullYear();
  const report: EnrollReport = { enrolled: [], skippedDuplicate: [], needManager: [], docNos: [] };
  const mgrNames = new Map<string, string>();
  const resolveMgrName = async (id: string | null | undefined): Promise<string | null> => {
    if (!id) return null;
    if (!mgrNames.has(id)) {
      const m = await db.employee.findUnique({ where: { id }, select: { fullName: true } });
      mgrNames.set(id, m?.fullName ?? "—");
    }
    return mgrNames.get(id) ?? null;
  };

  for (const e of emps) {
    if (existingIds.has(e.id)) {
      report.skippedDuplicate.push({ employeeNo: e.employeeNo, fullName: e.fullName });
      continue;
    }
    const managerId = mgrOf.get(e.id) ?? null;
    // nomor dokumen peserta PER-YYYY-NNNN (max-suffix — pemanggilan berurutan)
    const seq = report.docNos.length + existingIds.size;
    const docNo = `PER-${year}-${String(seq + 1).padStart(4, "0")}`;
    await db.appraisalRecord.create({
      data: { docNo, cycleId: cycle.id, employeeId: e.id, managerId, status: "Enrolled" },
    });
    existingIds.add(e.id);
    report.docNos.push(docNo);
    report.enrolled.push({
      employeeNo: e.employeeNo, fullName: e.fullName, managerName: await resolveMgrName(managerId),
    });
    if (!managerId) report.needManager.push({ employeeNo: e.employeeNo, fullName: e.fullName });
  }
  return report;
}

// ============================================================================
// GERBANG FASE (§25-4, §35-1/12/16)
// ============================================================================

async function mustCycle(db: TenantDb, id: string) {
  const c = await db.performanceCycle.findUnique({
    where: { id }, include: { appraisals: { select: { id: true, status: true } } },
  });
  if (!c) throw new Error("Siklus tidak ditemukan");
  return c;
}

function assertAdvance(cur: string, next: CycleStatus): void {
  if (STATUS_ORDER[next] <= STATUS_ORDER[cur]) {
    throw new Error(`Siklus sudah ${cur} — fase tidak dapat dimundurkan`);
  }
}

/** Draft → GoalSetting (§35-1: wajib periode + goalEnd + peserta ≥ 1 + kronologis). */
export async function openGoal(db: TenantDb, id: string): Promise<void> {
  const c = await mustCycle(db, id);
  assertAdvance(c.status, "GoalSetting");
  if (!c.periodStart || !c.periodEnd) throw new Error("Siklus belum punya periode (§35-1)");
  if (!c.goalStart || !c.goalEnd) {
    throw new Error("Fase penetapan target dilewati? Jendela goal (mulai–selesai) wajib terisi untuk membuka fase — atau langsung jalankan startOngoing");
  }
  if (c.appraisals.length === 0) throw new Error("Siklus belum punya peserta — enroll dahulu (§35-1)");
  if (!windowsChronological(c as unknown as Record<string, unknown>)) {
    throw new Error("Jendela fase tidak kronologis (§35-1)");
  }
  await db.performanceCycle.update({ where: { id }, data: { status: "GoalSetting" } });
}

/** Maju ke fase berikutnya — jendela null boleh DILEWATI (gerbang longgar §25). */
async function advance(db: TenantDb, id: string, next: CycleStatus, extraGuards?: (c: Awaited<ReturnType<typeof mustCycle>>) => Promise<void>): Promise<void> {
  const c = await mustCycle(db, id);
  assertAdvance(c.status, next);
  if (extraGuards) await extraGuards(c);
  await db.performanceCycle.update({ where: { id }, data: { status: next } });
}

/** → Ongoing: appraisal GoalApproved ikut Ongoing (sisa tetap — masih bisa diajak mengejar? tidak: target terkunci setelah goalEnd — status dibiarkan). */
export async function startOngoing(db: TenantDb, id: string): Promise<void> {
  await advance(db, id, "Ongoing");
  await db.appraisalRecord.updateMany({
    where: { cycleId: id, status: "GoalApproved" }, data: { status: "Ongoing" },
  });
}

/** → Assessment: jendela self/mgr minimal selfStart terisi bila tidak dilewati. */
export async function startAssessment(db: TenantDb, id: string): Promise<void> {
  await advance(db, id, "Assessment", async (c) => {
    if ((c.selfStart && !c.selfEnd) || (!c.selfStart && c.selfEnd)) throw new Error("Jendela fase self harus lengkap (mulai + selesai) atau kosongkan untuk melewati");
    if ((c.mgrStart && !c.mgrEnd) || (!c.mgrStart && c.mgrEnd)) throw new Error("Jendela fase manager harus lengkap atau kosongkan untuk melewati");
  });
}

/** → Calibration. */
export async function startCalibration(db: TenantDb, id: string): Promise<void> {
  await advance(db, id, "Calibration");
}

/** → Published (§35-12: tolak bila masih ada ManagerDone belum final; force ter-log). */
export async function publishCycle(db: TenantDb, id: string, force = false): Promise<void> {
  await advance(db, id, "Published", async (c) => {
    const pending = c.appraisals.filter((a) => a.status === "ManagerDone").length;
    if (pending > 0 && !force) {
      throw new Error(`Masih ada ${pending} peserta status ManagerDone yang belum difinalisasi — selesaikan kalibrasi atau publikasikan dengan force (ter-ActivityLog)`);
    }
    if (c.publishAt && c.publishAt.getTime() > Date.now() + DAY_MS) {
      throw new Error("Tanggal publikasi belum tiba");
    }
  });
  await db.appraisalRecord.updateMany({
    where: { cycleId: id, status: { in: ["Finalized", "Calibrating"] } }, data: { status: "Published" },
  });
}

/** → Closed (§35-16: banding selesai semua). */
export async function closeCycle(db: TenantDb, id: string): Promise<void> {
  await advance(db, id, "Closed", async (c) => {
    const appealed = c.appraisals.filter((a) => a.status === "Appealed").length;
    if (appealed > 0) throw new Error(`Masih ada ${appealed} banding yang belum diputuskan (§35-16)`);
  });
  await db.appraisalRecord.updateMany({ where: { cycleId: id }, data: { status: "Closed" } });
}

// ============================================================================
// COMMAND CENTER (§18.8 AM2 — TAB di halaman Siklus Penilaian)
// ============================================================================

export interface CommandCenterRow {
  appraisalId: string; docNo: string; employeeNo: string; fullName: string; unit: string | null;
  position: string | null; managerName: string | null; managerId: string | null;
  status: string; goalDone: boolean; selfDone: boolean; managerDone: boolean; calibDone: boolean; ackDone: boolean;
  kpiCount: number; progressPct: number; goalsCopiedFrom: string | null;
  lastSavedAt: string | null; phaseLagging: boolean; lagReason: string | null; lagTarget: "manager" | "employee" | "hr" | null;
  lastNudge: { channel: string; at: string } | null;
}

/** Apakah peserta TERTINGGAL di fase siklus aktif + siapa yang harus di-nudge. */
export function lagOf(status: string, cycleStatus: string, acknowledged: boolean): { lagging: boolean; reason: string | null; target: CommandCenterRow["lagTarget"] } {
  const locked = (APPRAISAL_LOCKED as readonly string[]).includes(status);
  switch (cycleStatus) {
    case "GoalSetting":
      return locked
        ? { lagging: false, reason: null, target: null }
        : { lagging: true, reason: "Target belum dikunci", target: "manager" };
    case "Ongoing":
      return locked
        ? { lagging: false, reason: null, target: null }
        : { lagging: true, reason: "Target belum dikunci (siklus berjalan)", target: "manager" };
    case "Assessment":
      if (status === "Enrolled" || status === "GoalProposed" || status === "GoalApproved" || status === "Ongoing")
        return { lagging: true, reason: "Penilaian diri belum diisi", target: "employee" };
      if (status === "SelfDone") return { lagging: true, reason: "Penilaian atasan belum diisi", target: "manager" };
      return { lagging: false, reason: null, target: null };
    case "Calibration":
      if (status === "ManagerDone") return { lagging: true, reason: "Menunggu keputusan kalibrasi", target: "hr" };
      return { lagging: false, reason: null, target: null };
    case "Published":
      return acknowledged
        ? { lagging: false, reason: null, target: null }
        : { lagging: true, reason: "Belum acknowledge hasil", target: "employee" };
    default:
      return { lagging: false, reason: null, target: null };
  }
}

/**
 * Matriks status seluruh perusahaan untuk satu siklus + agregat per atasan
 * + ringkasan tile overview ("Belum mengisi target: N/M").
 */
export async function commandCenter(db: TenantDb, cycleId: string): Promise<{
  cycle: Record<string, unknown>;
  rows: CommandCenterRow[];
  managers: { managerId: string | null; managerName: string; total: number; goalDone: number; avgProgress: number }[];
  tile: { phase: string; laggingCount: number; participantCount: number };
}> {
  const cycle = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!cycle) throw new Error("Siklus tidak ditemukan");

  const appraisals = await db.appraisalRecord.findMany({
    where: { cycleId },
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnitId: true, positionId: true } },
      manager: { select: { id: true, fullName: true } },
      kpis: { select: { target: true, thresholdMin: true, weight: true, polarity: true, updatedAt: true } },
    },
    orderBy: { docNo: "asc" },
  });

  // unit/posisi nama (sekali query)
  const unitIds = [...new Set(appraisals.map((a) => a.employee.orgUnitId).filter((x): x is string => !!x))];
  const posIds = [...new Set(appraisals.map((a) => a.employee.positionId).filter((x): x is string => !!x))];
  const [units, poss] = (await Promise.all([
    unitIds.length ? db.orgUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
    posIds.length ? db.position.findMany({ where: { id: { in: posIds } }, select: { id: true, title: true } }) : Promise.resolve([] as { id: string; title: string }[]),
  ])) as [{ id: string; name: string }[], { id: string; title: string }[]];
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const posName = new Map(poss.map((p) => [p.id, p.title]));

  // nudge terakhir ≤ 6 jam (pratinjau tombol Remind — rate-limit D17)
  const ids = appraisals.map((a) => a.id);
  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const nudgeLogs = ids.length
    ? await db.activityLog.findMany({
        where: { action: "Nudged", entityId: { in: ids }, createdAt: { gte: since } },
        select: { entityId: true, detail: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const rows: CommandCenterRow[] = appraisals.map((a) => {
    const locked = (APPRAISAL_LOCKED as readonly string[]).includes(a.status);
    // progres formulir target §18.7: per baris 3 field wajib (target, ambang*, bobot) + 1 global Σ=100
    const n = a.kpis.length;
    let filled = 0;
    for (const k of a.kpis) {
      if (k.target != null || k.polarity === "Boolean") filled++;
      if (k.thresholdMin != null || k.polarity === "Boolean") filled++;
      if (k.weight != null && k.weight > 0) filled++;
    }
    const sumW = a.kpis.reduce((s, k) => s + (k.weight ?? 0), 0);
    if (n > 0 && Math.abs(sumW - 100) < 0.01) filled++;
    const progressPct = n === 0 ? 0 : Math.round((filled / (3 * n + 1)) * 100);
    const lastSaved = a.kpis.reduce<Date | null>((m, k) => (!m || k.updatedAt > m ? k.updatedAt : m), null);
    const logs = nudgeLogs.filter((l) => l.entityId === a.id);
    const lastNudge = logs.length
      ? { channel: /kanal=([a-z-]+)/.exec(logs[0].detail ?? "")?.[1] ?? "-", at: logs[0].createdAt.toISOString() }
      : null;
    const lag = lagOf(a.status, cycle.status, a.acknowledgedAt != null);
    return {
      appraisalId: a.id, docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName,
      unit: a.employee.orgUnitId ? unitName.get(a.employee.orgUnitId) ?? null : null,
      position: a.employee.positionId ? posName.get(a.employee.positionId) ?? null : null,
      managerName: a.manager?.fullName ?? null, managerId: a.managerId,
      status: a.status,
      goalDone: locked, selfDone: ["SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(a.status),
      managerDone: ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(a.status),
      calibDone: ["Finalized", "Published", "Appealed", "Closed"].includes(a.status),
      ackDone: a.acknowledgedAt != null,
      kpiCount: n, progressPct,
      goalsCopiedFrom: a.goalsCopiedFrom,
      lastSavedAt: lastSaved?.toISOString() ?? null,
      phaseLagging: lag.lagging, lagReason: lag.reason, lagTarget: lag.target,
      lastNudge,
    };
  });

  // agregat per atasan ("Sri Wahyuni: 5/6 target — 86%") — sortir tertinggal
  const byMgr = new Map<string | null, { managerId: string | null; managerName: string; total: number; goalDone: number; progressSum: number }>();
  for (const r of rows) {
    const key = r.managerId ?? "__none__";
    if (!byMgr.has(key)) {
      byMgr.set(key, { managerId: r.managerId, managerName: r.managerName ?? "(tanpa atasan)", total: 0, goalDone: 0, progressSum: 0 });
    }
    const g = byMgr.get(key)!;
    g.total++;
    if (r.goalDone) g.goalDone++;
    g.progressSum += r.progressPct;
  }
  const managers = [...byMgr.values()]
    .map((g) => ({ ...g, avgProgress: g.total ? Math.round(g.progressSum / g.total) : 0 }))
    .sort((a, b) => (a.goalDone / Math.max(a.total, 1)) - (b.goalDone / Math.max(b.total, 1)));

  return {
    cycle: cycle as unknown as Record<string, unknown>,
    rows,
    managers,
    tile: { phase: cycle.status, laggingCount: rows.filter((r) => r.phaseLagging).length, participantCount: rows.length },
  };
}

// ============================================================================
// NUDGE MULTI-KANAL (§18.8 AM2 + D17 + guard §35-29)
// ============================================================================

interface QueuedNudge {
  tenantKey: string;
  appraisalId: string;
  channel: NudgeChannel;
  appUserId: string | null;
  employeeId: string | null;
  managerEmployeeId: string | null;
  title: string;
  body: string;
}

/** Antrean nudge di luar jam kerja (globalThis — tahan reload modul dev). */
const G = globalThis as unknown as { __perfNudgeQueue?: QueuedNudge[] };
if (!G.__perfNudgeQueue) G.__perfNudgeQueue = [];

export interface NudgeInput {
  appraisalIds: string[];
  channels: NudgeChannel[];
  message?: string;
}

export interface NudgeRowResult {
  appraisalId: string; docNo: string; employeeNo: string; fullName: string;
  recipientName: string | null;
  results: { channel: NudgeChannel; status: "sent" | "queued" | "skipped-rate-limit" | "no-contact" | "failed"; note: string }[];
}

/** Pesan default nudge — dwibahasa ringkas + deep-link (D17). */
function nudgeMessage(cycleCode: string, recipientName: string, lagReason: string, custom?: string): { title: string; body: string } {
  if (custom?.trim()) {
    return { title: `Pengingat formulir kinerja — ${cycleCode}`, body: custom.trim() };
  }
  return {
    title: `Pengingat: ${lagReason} — ${cycleCode}`,
    body: `Halo ${recipientName}, ${lagReason.toLowerCase()} untuk siklus penilaian ${cycleCode}. Silakan buka RekanKerja → menu Performance → Target & KPI untuk mengisinya. Terima kasih.`,
  };
}

/** Kanal nudge terkirim ≤ 6 jam terakhir per peserta (rate-limit D17). */
export async function recentNudgeChannels(db: TenantDb, appraisalIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!appraisalIds.length) return map;
  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const logs = await db.activityLog.findMany({
    where: { action: "Nudged", entityId: { in: appraisalIds }, createdAt: { gte: since } },
    select: { entityId: true, detail: true },
  });
  for (const l of logs) {
    if (!l.entityId) continue;
    if (!map.has(l.entityId)) map.set(l.entityId, new Set());
    for (const m of l.detail?.matchAll(/kanal=([a-z-]+)/g) ?? []) map.get(l.entityId)!.add(m[1]);
  }
  return map;
}

export async function nudgeParticipants(
  db: TenantDb, tenantKey: string, input: NudgeInput,
): Promise<NudgeRowResult[]> {
  if (!input.appraisalIds.length) throw new Error("Pilih peserta yang akan diingatkan");
  const channels = input.channels.filter((c) => (NUDGE_CHANNELS as readonly string[]).includes(c));
  if (!channels.length) throw new Error("Pilih minimal satu kanal (in-app / email / WhatsApp)");

  const appraisals = await db.appraisalRecord.findMany({
    where: { id: { in: input.appraisalIds } },
    include: {
      cycle: { select: { id: true, code: true, status: true } },
      employee: { select: { id: true, employeeNo: true, fullName: true } },
      manager: { select: { id: true, fullName: true } },
    },
  });

  const recent = await recentNudgeChannels(db, appraisals.map((a) => a.id));
  const workingHour = isWorkingHourJakarta();
  const out: NudgeRowResult[] = [];

  for (const a of appraisals) {
    // penerima nudge = AKTOR fase aktif (GoalSetting/Ongoing → atasan snapshot)
    const lag = lagOf(a.status, a.cycle.status, a.acknowledgedAt != null);
    const targetEmployeeId = lag.target === "employee" ? a.employeeId : lag.target === "manager" ? a.managerId : a.employeeId;
    const targetName = lag.target === "employee" ? a.employee.fullName : lag.target === "manager" ? a.manager?.fullName ?? a.employee.fullName : a.employee.fullName;
    const msg = nudgeMessage(a.cycle.code, targetName ?? "Bapak/Ibu", lag.reason ?? "Formulir kinerja belum lengkap", input.message);

    // AppUser tujuan (in-app) — karyawan terkait target
    let appUserId: string | null = null;
    if (targetEmployeeId) {
      const u = await db.appUser.findFirst({ where: { employeeId: targetEmployeeId }, select: { id: true } });
      appUserId = u?.id ?? null;
    }

    const row: NudgeRowResult = {
      appraisalId: a.id, docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName,
      recipientName: targetName, results: [],
    };

    for (const ch of channels) {
      const already = recent.get(a.id)?.has(ch);
      if (already) {
        row.results.push({ channel: ch, status: "skipped-rate-limit", note: "Sudah diingatkan di kanal ini < 6 jam (D17)" });
        continue;
      }
      let status: NudgeRowResult["results"][number]["status"] = "failed";
      let note = "";
      if (!workingHour) {
        // antre otomatis — kirim pada jam kerja berikutnya (flush antrean)
        G.__perfNudgeQueue!.push({
          tenantKey, appraisalId: a.id, channel: ch, appUserId,
          employeeId: ch === "in-app" ? null : targetEmployeeId,
          managerEmployeeId: a.managerId,
          title: msg.title, body: msg.body,
        });
        status = "queued";
        note = "Di luar jam kerja — terjadwal otomatis jam kerja berikutnya (07:00 WIB)";
      } else if (ch === "in-app") {
        if (!appUserId) { status = "no-contact"; note = "Penerima tidak punya akun aplikasi"; }
        else {
          const nid = await pushNotification(db, { appUserId, title: msg.title, body: msg.body, kind: "performance", link: "performance:goals" });
          status = nid ? "sent" : "failed"; note = nid ? "Notifikasi in-app terkirim" : "Gagal menulis notifikasi";
        }
      } else if (ch === "email") {
        if (!targetEmployeeId) { status = "no-contact"; note = "Penerima tidak dikenal"; }
        else {
          const rcpt = await employeeEmailOf(db, targetEmployeeId);
          if (!rcpt) { status = "no-contact"; note = "Email penerima tidak tersedia"; }
          else {
            const r = await sendSystemEmail(db, { event: "performance.nudge", to: rcpt, subject: msg.title, body: msg.body });
            status = r.ok ? "sent" : "failed"; note = r.message;
          }
        }
      } else {
        // WhatsApp (adapter WA — kanal opsional; konfigurasi tenant menentukan)
        if (!targetEmployeeId) { status = "no-contact"; note = "Penerima tidak dikenal"; }
        else {
          const phone = await employeePhoneOf(db, targetEmployeeId);
          if (!phone) { status = "no-contact"; note = "Nomor WhatsApp penerima tidak tersedia"; }
          else {
            const r = await sendWa(db, { event: "performance.nudge", toPhone: phone, placeholders: { title: msg.title, body: msg.body } });
            status = r.status === "Sent" ? "sent" : r.status === "Skipped" ? "failed" : "failed";
            note = r.error ?? "WhatsApp terkirim";
          }
        }
      }
      // setiap kirim/antre ter-ActivityLog (guard §35-29) — detail memuat
      // kanal= terstruktur untuk cek rate-limit 6 jam berikutnya.
      await db.activityLog.create({
        data: {
          action: "Nudged", entity: "AppraisalRecord", entityId: a.id,
          detail: `kanal=${ch}; penerima=${targetName ?? "-"}; peserta=${a.employee.employeeNo} ${a.employee.fullName}; siklus=${a.cycle.code}; ${status}${note ? ` (${note.slice(0, 120)})` : ""}`,
        },
      }).catch(() => { /* log gagal tidak boleh memutus bisnis */ });
      row.results.push({ channel: ch, status, note });
    }
    out.push(row);
  }
  return out;
}

/** Remind All — semua peserta TERTINGGAL di fase aktif (§18.8). */
export async function nudgeAllLagging(
  db: TenantDb, tenantKey: string, cycleId: string, channels: NudgeChannel[], message?: string,
): Promise<NudgeRowResult[]> {
  const cc = await commandCenter(db, cycleId);
  const lagging = cc.rows.filter((r) => r.phaseLagging).map((r) => r.appraisalId);
  if (!lagging.length) return [];
  return nudgeParticipants(db, tenantKey, { appraisalIds: lagging, channels, message });
}

/** Kirim antrean nudge yang tertunda (dipanggil scheduler + tiap permintaan nudge). */
export async function flushQueuedNudges(db: TenantDb, tenantKey: string): Promise<number> {
  if (!isWorkingHourJakarta() || !G.__perfNudgeQueue!.length) return 0;
  const mine = G.__perfNudgeQueue!.filter((q) => q.tenantKey === tenantKey);
  G.__perfNudgeQueue = G.__perfNudgeQueue!.filter((q) => q.tenantKey !== tenantKey);
  let sent = 0;
  for (const q of mine) {
    try {
      if (q.channel === "in-app" && q.appUserId) {
        const nid = await pushNotification(db, { appUserId: q.appUserId, title: q.title, body: q.body, kind: "performance", link: "performance:goals" });
        if (nid) sent++;
      } else if (q.channel === "email" && q.employeeId) {
        const rcpt = await employeeEmailOf(db, q.employeeId);
        if (rcpt) { const r = await sendSystemEmail(db, { event: "performance.nudge", to: rcpt, subject: q.title, body: q.body }); if (r.ok) sent++; }
      } else if (q.channel === "wa" && q.employeeId) {
        const phone = await employeePhoneOf(db, q.employeeId);
        if (phone) { const r = await sendWa(db, { event: "performance.nudge", toPhone: phone, placeholders: { title: q.title, body: q.body } }); if (r.status === "Sent") sent++; }
      }
    } catch { /* never */ }
  }
  return sent;
}
