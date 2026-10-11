// ============================================================================
// RECRUITMENT F5 — Rencana (RecruitmentPlan) & Anggaran (RecruitmentBudget)
// service (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F5 + analisa oranHR §2.1/§2.2).
//
// RecruitmentPlan ringkas — formula oranHR a–h (SEMUA dihitung saat baca,
// bukan kolom tersimpan):
//   (a) targetA  target headcount awal        (input)
//   (b) adjustB  penyesuaian (+/−)             (input)
//   (c)          total target      = (a)+(b)
//   (d) empD     karyawan awal                (input / sync headcount live)
//   (e) inE      rekrut/masuk                  (input)
//   (f) outF     turnover/keluar              (input)
//   (g)          hasil             = (d)+(e)−(f)
//   (h)          kebutuhan rekrut  = (c)−(g)
// Rekonsiliasi PR: requested = Σ requiredNo PR [Submitted|Approved|OnHold|
// Fulfilled] yang match posisi (+kantor); fulfilled = Σ CandidateAppointment
// pada PR match; unfulfilled = requested − fulfilled.
//
// RecruitmentBudget: per periode (vault uang: totalBudget + adjust); realisasi
// (used) dihitung agregat dari actualCost JobOpeningMethod JO periode tsb —
// ringkas DUA LEVEL oranHR: per Job Opportunity + per Advertised PR di JO.
//
// Uang vault: decrypt HANYA di serializer (moneyVisible) — W28.
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

// ============ konstanta domain ============

export const PLAN_STATUSES = ["Draft", "Applied"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Status PR yang dihitung sebagai "requested" di rekonsiliasi. */
const RECON_PR_STATUSES = ["Submitted", "Approved", "OnHold", "Fulfilled"] as const;

// ============ tipe baris (bentuk JSON API) ============

export interface PlanRecon {
  requested: number; // Σ requiredNo PR match
  fulfilled: number; // Σ pengangkatan pada PR match
  unfulfilled: number;
  prCount: number;
}

export interface PlanRow {
  id: string;
  period: string;
  seqNo: number;
  positionId: string | null;
  positionTitle: string;
  companyOfficeId: string | null;
  officeName: string | null;
  targetA: number;
  adjustB: number;
  totalC: number; // (a)+(b)
  empD: number;
  inE: number;
  outF: number;
  resultedG: number; // (d)+(e)−(f)
  toRecruitH: number; // (c)−(g)
  salaryBudget: number | null; // null bila vault disembunyikan
  basePeriod: string | null;
  status: PlanStatus;
  note: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recon: PlanRecon;
}

export interface PlanStats {
  total: number; draft: number; applied: number;
  periods: string[]; // daftar periode unik (urut desc)
  headcountLive: number | null; // headcount Employee aktif saat ini (opsional — ?positionId=)
}

export interface BudgetMethodLine {
  id: string;
  methodName: string;
  costItemName: string | null;
  actual: number | null;
  planned: number | null;
  datePosted: string | null;
}

export interface BudgetJoLine {
  joId: string;
  refNo: string;
  title: string;
  status: string;
  datePrepared: string | null;
  planned: number; // Σ planned method JO (null → 0)
  actual: number;
  methods: BudgetMethodLine[];
  prs: BudgetPrLine[]; // level kedua: per PR di dalam JO
}

export interface BudgetPrLine {
  prId: string;
  prNo: string;
  positionTitle: string | null;
  requiredNo: number;
  prStatus: string;
  actual: number; // Σ actual method JO dialokasikan proporsional per slot? — TIDAK:
  // method melekat pada JO (bukan slot); per-PR = Σ method JO yang MEMUAT slot
  // PR tsb (JO dengan N slot "membebankan" biaya ke tiap PR-nya penuh —
  // padanan dua level oranHR: cost item per advertised PR).
}

export interface BudgetRow {
  period: string;
  totalBudget: number | null;
  adjust: number | null;
  adjustBudget: number | null; // total + adjust (null bila salah satu masked)
  used: number; // Σ actualCost method JO periode (selalu terlihat — metode biaya)
  unused: number | null;
  currency: string;
  note: string | null;
  perJO: BudgetJoLine[];
  updatedAt: string | null;
}

// ============ input ============

export interface PlanInput {
  period: string;
  seqNo?: number;
  positionId?: string | null;
  positionTitle: string;
  companyOfficeId?: string | null;
  targetA: number;
  adjustB?: number;
  empD?: number;
  inE?: number;
  outF?: number;
  salaryBudget?: number | null;
  basePeriod?: string | null;
  note?: string | null;
}

// ============ helper ============

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Headcount Employee aktif pada posisi (+kantor ops) — sinkron (d) oranHR. */
export async function headcountOf(
  db: TenantDb,
  where: { positionId?: string | null; companyOfficeId?: string | null },
): Promise<number> {
  const w: Prisma.EmployeeWhereInput = { status: "Active" };
  if (where.positionId) w.positionId = where.positionId;
  if (where.companyOfficeId) w.companyOfficeId = where.companyOfficeId;
  return db.employee.count({ where: w });
}

/** PR yang cocok dengan baris plan (posisi via id ATAU judul; +kantor ops). */
function planPrWhere(p: { positionId: string | null; positionTitle: string; companyOfficeId: string | null }): Prisma.PersonnelRequisitionWhereInput {
  const posMatch: Prisma.PersonnelRequisitionWhereInput[] = p.positionId
    ? [{ positionId: p.positionId }]
    : [{ position: { title: { equals: p.positionTitle, mode: "insensitive" } } }];
  if (p.companyOfficeId) posMatch.push({ companyOfficeId: p.companyOfficeId });
  return { status: { in: [...RECON_PR_STATUSES] }, AND: posMatch };
}

/** Rekonsiliasi PR untuk satu baris plan (requested/fulfilled/unfulfilled). */
async function reconOf(
  db: TenantDb,
  p: { positionId: string | null; positionTitle: string; companyOfficeId: string | null },
): Promise<PlanRecon> {
  const prs = await db.personnelRequisition.findMany({
    where: planPrWhere(p),
    select: { id: true, requiredNo: true },
  });
  if (prs.length === 0) return { requested: 0, fulfilled: 0, unfulfilled: 0, prCount: 0 };
  const appts = await db.candidateAppointment.groupBy({
    by: ["prId"],
    _count: { _all: true },
    where: { prId: { in: prs.map((x) => x.id) } },
  });
  const fulfilled = appts.reduce((a, g) => a + g._count._all, 0);
  const requested = prs.reduce((a, x) => a + x.requiredNo, 0);
  return { requested, fulfilled, unfulfilled: requested - fulfilled, prCount: prs.length };
}

const PLAN_INCLUDE = {
  position: { select: { id: true, title: true } },
  companyOffice: { select: { id: true, name: true } },
} satisfies Prisma.RecruitmentPlanInclude;

function planRow(
  p: Prisma.RecruitmentPlanGetPayload<{ include: typeof PLAN_INCLUDE }>,
  moneyVisible: boolean,
  db: TenantDb,
  recon: PlanRecon,
): PlanRow {
  const tc = tenantCryptoForDb(db);
  const totalC = p.targetA + p.adjustB;
  const resultedG = p.empD + p.inE - p.outF;
  return {
    id: p.id,
    period: p.period,
    seqNo: p.seqNo,
    positionId: p.positionId,
    positionTitle: p.positionTitle,
    companyOfficeId: p.companyOfficeId,
    officeName: p.companyOffice?.name ?? null,
    targetA: p.targetA,
    adjustB: p.adjustB,
    totalC,
    empD: p.empD,
    inE: p.inE,
    outF: p.outF,
    resultedG,
    toRecruitH: totalC - resultedG,
    salaryBudget: moneyVisible && p.salaryBudget ? (tc.decryptMoney(p.salaryBudget) ?? null) : null,
    basePeriod: p.basePeriod,
    status: p.status as PlanStatus,
    note: p.note,
    appliedAt: iso(p.appliedAt),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    recon,
  };
}

// ============ query plan ============

export async function listPlans(
  db: TenantDb,
  opts: { period?: string | null; status?: string | null; moneyVisible?: boolean },
): Promise<{ rows: PlanRow[]; stats: PlanStats }> {
  const moneyVisible = opts.moneyVisible ?? false;
  const where: Prisma.RecruitmentPlanWhereInput = {};
  if (opts.period) where.period = opts.period;
  if (opts.status && PLAN_STATUSES.includes(opts.status as PlanStatus)) where.status = opts.status;

  const [rows, total, groupStatus, periods] = await Promise.all([
    db.recruitmentPlan.findMany({ where, include: PLAN_INCLUDE, orderBy: [{ period: "desc" }, { seqNo: "asc" }], take: 200 }),
    db.recruitmentPlan.count({ where }),
    db.recruitmentPlan.groupBy({ by: ["status"], _count: { _all: true } }),
    db.recruitmentPlan.groupBy({ by: ["period"], _count: { _all: true }, orderBy: { period: "desc" } }),
  ]);

  const out: PlanRow[] = [];
  for (const p of rows) {
    out.push(planRow(p, moneyVisible, db, await reconOf(db, p)));
  }
  const st = (s: string) => groupStatus.find((g) => g.status === s)?._count._all ?? 0;
  return {
    rows: out,
    stats: {
      total,
      draft: st("Draft"),
      applied: st("Applied"),
      periods: periods.map((g) => g.period),
      headcountLive: null,
    },
  };
}

export async function getPlan(db: TenantDb, id: string, moneyVisible: boolean): Promise<PlanRow | null> {
  const p = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  if (!p) return null;
  return planRow(p, moneyVisible, db, await reconOf(db, p));
}

/** Opsi form plan: posisi aktif + kantor. */
export async function planOptions(db: TenantDb): Promise<{
  positions: { id: string; code: string; title: string; headcount: number }[];
  offices: { id: string; name: string; city: string | null }[];
}> {
  const [positions, offices] = await Promise.all([
    db.position.findMany({
      where: { active: true },
      select: { id: true, code: true, title: true, headcount: true, employees: { where: { status: "Active" }, select: { id: true } } },
      orderBy: { title: "asc" },
      take: 300,
    }),
    db.companyOffice.findMany({ select: { id: true, name: true, city: true }, orderBy: { name: "asc" }, take: 100 }),
  ]);
  return {
    positions: positions.map((p) => ({ id: p.id, code: p.code, title: p.title, headcount: p.employees.length })),
    offices: offices.map((o) => ({ id: o.id, name: o.name, city: o.city ?? null })),
  };
}

// ============ mutasi plan ============

function assertPlanInput(input: PlanInput): string | null {
  if (!input.period?.trim()) return "Periode wajib diisi (mis. 2026)";
  if (!input.positionTitle?.trim()) return "Judul posisi wajib diisi";
  if (!Number.isFinite(input.targetA) || input.targetA < 0) return "Target awal (a) harus ≥ 0";
  return null;
}

export async function createPlan(db: TenantDb, input: PlanInput, actorName?: string | null): Promise<PlanRow> {
  const err = assertPlanInput(input);
  if (err) throw new Error(err);
  const tc = tenantCryptoForDb(db);

  // seqNo otomatis per periode bila tidak diberikan
  let seqNo = input.seqNo;
  if (!Number.isFinite(seqNo) || (seqNo ?? 0) < 1) {
    const last = await db.recruitmentPlan.findFirst({
      where: { period: input.period.trim() },
      orderBy: { seqNo: "desc" },
      select: { seqNo: true },
    });
    seqNo = (last?.seqNo ?? 0) + 1;
  }

  const positionId = input.positionId || null;
  // (d) default: headcount live pada posisi/kantor (sinkron EmployeeAssignment)
  const empD = input.empD != null && Number.isFinite(input.empD)
    ? Math.floor(input.empD)
    : await headcountOf(db, { positionId, companyOfficeId: input.companyOfficeId || null });
  const seqNoFinal = Math.floor((seqNo ?? 0) > 0 ? (seqNo as number) : 1);

  const created = await db.recruitmentPlan.create({
    data: {
      period: input.period.trim(),
      seqNo: seqNoFinal,
      positionId,
      positionTitle: input.positionTitle.trim(),
      companyOfficeId: input.companyOfficeId || null,
      targetA: Math.floor(input.targetA),
      adjustB: Math.floor(input.adjustB ?? 0),
      empD: Math.floor(empD),
      inE: Math.floor(input.inE ?? 0),
      outF: Math.floor(input.outF ?? 0),
      salaryBudget: input.salaryBudget != null && input.salaryBudget > 0 ? tc.encryptMoney(input.salaryBudget) : null,
      basePeriod: input.basePeriod?.trim() || null,
      note: input.note?.trim() || null,
    },
    include: PLAN_INCLUDE,
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "RecruitmentPlan", entityId: created.period,
      detail: `Rencana rekrutmen #${created.seqNo} ${created.positionTitle} periode ${created.period} dibuat — kebutuhan rekrut (h) = ${(created.targetA + created.adjustB) - (created.empD + created.inE - created.outF)}${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return planRow(created, true, db, await reconOf(db, created));
}

export async function updatePlan(db: TenantDb, id: string, input: Partial<PlanInput>, actorName?: string | null): Promise<PlanRow> {
  const p = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  if (!p) throw new Error("Rencana rekrutmen tidak ditemukan");
  if (p.status === "Applied") throw new Error("Rencana sudah Applied — tidak dapat diubah (duplikat bila perlu revisi)");
  const tc = tenantCryptoForDb(db);

  const data: Prisma.RecruitmentPlanUncheckedUpdateInput = {};
  if (input.period !== undefined) {
    if (!input.period?.trim()) throw new Error("Periode wajib diisi");
    data.period = input.period.trim();
  }
  if (input.seqNo !== undefined && Number.isFinite(input.seqNo)) data.seqNo = Math.floor(input.seqNo as number);
  if (input.positionId !== undefined) data.positionId = input.positionId || null;
  if (input.positionTitle !== undefined) {
    if (!input.positionTitle?.trim()) throw new Error("Judul posisi wajib diisi");
    data.positionTitle = input.positionTitle.trim();
  }
  if (input.companyOfficeId !== undefined) data.companyOfficeId = input.companyOfficeId || null;
  if (input.targetA !== undefined) {
    if (!Number.isFinite(input.targetA) || (input.targetA as number) < 0) throw new Error("Target awal (a) harus ≥ 0");
    data.targetA = Math.floor(input.targetA as number);
  }
  if (input.adjustB !== undefined && Number.isFinite(input.adjustB)) data.adjustB = Math.floor(input.adjustB as number);
  if (input.empD !== undefined && Number.isFinite(input.empD)) data.empD = Math.floor(input.empD as number);
  if (input.inE !== undefined && Number.isFinite(input.inE)) data.inE = Math.floor(input.inE as number);
  if (input.outF !== undefined && Number.isFinite(input.outF)) data.outF = Math.floor(input.outF as number);
  if (input.salaryBudget !== undefined) {
    data.salaryBudget = input.salaryBudget != null && input.salaryBudget > 0 ? tc.encryptMoney(input.salaryBudget) : null;
  }
  if (input.basePeriod !== undefined) data.basePeriod = input.basePeriod?.trim() || null;
  if (input.note !== undefined) data.note = input.note?.trim() || null;

  if (Object.keys(data).length > 0) {
    await db.recruitmentPlan.update({ where: { id }, data });
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "RecruitmentPlan", entityId: p.period,
        detail: `Rencana rekrutmen #${p.seqNo} ${p.positionTitle} diperbarui${actorName ? ` oleh ${actorName}` : ""}`,
      },
    });
  }
  const fresh = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  return planRow(fresh!, true, db, await reconOf(db, fresh!));
}

/** Terapkan rencana (Draft → Applied — padanan tombol Apply oranHR). */
export async function applyPlan(db: TenantDb, id: string, actorName?: string | null): Promise<PlanRow> {
  const p = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  if (!p) throw new Error("Rencana rekrutmen tidak ditemukan");
  if (p.status === "Applied") throw new Error("Rencana sudah Applied");
  await db.recruitmentPlan.update({ where: { id }, data: { status: "Applied", appliedAt: new Date() } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "RecruitmentPlan", entityId: p.period,
      detail: `Rencana rekrutmen #${p.seqNo} ${p.positionTitle} periode ${p.period} DIAPLIKASIKAN — jadi dasar justifikasi PR${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  const fresh = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  return planRow(fresh!, true, db, await reconOf(db, fresh!));
}

/** Hapus baris plan (Draft saja). */
export async function deletePlan(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const p = await db.recruitmentPlan.findUnique({ where: { id }, select: { id: true, seqNo: true, positionTitle: true, period: true, status: true } });
  if (!p) throw new Error("Rencana rekrutmen tidak ditemukan");
  if (p.status === "Applied") throw new Error("Rencana sudah Applied — tidak dapat dihapus");
  await db.recruitmentPlan.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "RecruitmentPlan", entityId: p.period,
      detail: `Rencana rekrutmen #${p.seqNo} ${p.positionTitle} dihapus${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

/** Sinkron (d) dengan headcount Employee aktif saat ini. */
export async function syncPlanHeadcount(db: TenantDb, id: string, actorName?: string | null): Promise<{ empD: number }> {
  const p = await db.recruitmentPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  if (!p) throw new Error("Rencana rekrutmen tidak ditemukan");
  if (p.status === "Applied") throw new Error("Rencana sudah Applied — headcount tidak disinkronkan");
  const live = await headcountOf(db, { positionId: p.positionId, companyOfficeId: p.companyOfficeId });
  await db.recruitmentPlan.update({ where: { id }, data: { empD: live } });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "RecruitmentPlan", entityId: p.period,
      detail: `Rencana #${p.seqNo} ${p.positionTitle}: jumlah karyawan awal (d) disinkronkan ke headcount aktif = ${live}${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return { empD: live };
}

// ============ anggaran (RecruitmentBudget) ============

/** Daftar periode anggaran tersimpan (+ saran tahun berjalan). */
export async function listBudgetPeriods(db: TenantDb): Promise<{ periods: string[]; suggest: string }> {
  const rows = await db.recruitmentBudget.groupBy({ by: ["period"], orderBy: { period: "desc" } });
  const suggest = String(new Date().getFullYear());
  const periods = rows.map((r) => r.period);
  if (!periods.includes(suggest)) periods.unshift(suggest);
  return { periods, suggest };
}

const BUDGET_JO_INCLUDE = {
  methods: {
    include: {
      method: { select: { name: true } },
      costItem: { select: { name: true } },
    },
  },
  openings: {
    include: {
      pr: { select: { id: true, prNo: true, requiredNo: true, status: true, position: { select: { title: true } } } },
    },
  },
} satisfies Prisma.JobOpportunityInclude;

/**
 * Anggaran satu periode + realisasi dua level oranHR:
 * per Job Opportunity (header) + per Advertised PR (slot di dalam JO).
 * used = Σ actualCost method pada JO yang disiapkan di periode tsb
 * (match tahun datePrepared; bila period bukan tahun — semua JO dihitung).
 */
export async function getBudget(db: TenantDb, period: string, moneyVisible: boolean): Promise<BudgetRow | null> {
  const tc = tenantCryptoForDb(db);
  const budget = await db.recruitmentBudget.findUnique({ where: { period } });

  const year = parseInt(period, 10);
  const inPeriod = Number.isFinite(year)
    ? {
        datePrepared: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      }
    : {};
  const jos = await db.jobOpportunity.findMany({
    where: inPeriod,
    include: BUDGET_JO_INCLUDE,
    orderBy: { refNo: "asc" },
    take: 100,
  });

  let used = 0;
  const perJO: BudgetJoLine[] = [];
  for (const jo of jos) {
    let joActual = 0;
    let joPlanned = 0;
    const methods: BudgetMethodLine[] = [];
    for (const m of jo.methods) {
      const actual = m.actualCost ? (tc.decryptMoney(m.actualCost) ?? 0) : 0;
      const planned = m.plannedCost ? (tc.decryptMoney(m.plannedCost) ?? 0) : 0;
      joActual += actual;
      joPlanned += planned;
      methods.push({
        id: m.id,
        methodName: m.method.name,
        costItemName: m.costItem?.name ?? null,
        actual: m.actualCost ? actual : null,
        planned: m.plannedCost ? planned : null,
        datePosted: iso(m.datePosted),
      });
    }
    used += joActual;
    // level kedua: tiap PR yang diiklankan JO ini "memegang" biaya JO penuh
    // (oranHR Advertised PR cost — pelacakan dua level, bukan alokasi proporsional)
    const prs: BudgetPrLine[] = jo.openings.map((o) => ({
      prId: o.pr.id,
      prNo: o.pr.prNo,
      positionTitle: o.pr.position?.title ?? null,
      requiredNo: o.pr.requiredNo,
      prStatus: o.pr.status,
      actual: joActual,
    }));
    perJO.push({
      joId: jo.id,
      refNo: jo.refNo,
      title: jo.title,
      status: jo.status,
      datePrepared: iso(jo.datePrepared),
      planned: joPlanned,
      actual: joActual,
      methods: methods.sort((a, b) => a.methodName.localeCompare(b.methodName)),
      prs: prs.sort((a, b) => a.prNo.localeCompare(b.prNo)),
    });
  }

  const totalBudget = budget && moneyVisible && budget.totalBudget ? (tc.decryptMoney(budget.totalBudget) ?? null) : null;
  const adjust = budget && moneyVisible && budget.adjust ? (tc.decryptMoney(budget.adjust) ?? null) : null;
  const adjustBudget = totalBudget != null ? totalBudget + (adjust ?? 0) : null;
  return {
    period,
    totalBudget,
    adjust,
    adjustBudget,
    used,
    unused: adjustBudget != null ? adjustBudget - used : null,
    currency: budget?.currency ?? "IDR",
    note: budget?.note ?? null,
    perJO,
    updatedAt: budget ? iso(budget.updatedAt) : null,
  };
}

export async function upsertBudget(
  db: TenantDb,
  input: { period: string; totalBudget: number; adjust?: number | null; note?: string | null },
  actorName?: string | null,
): Promise<void> {
  const period = input.period?.trim();
  if (!period) throw new Error("Periode anggaran wajib diisi (mis. 2026)");
  if (!Number.isFinite(input.totalBudget) || input.totalBudget < 0) throw new Error("Total anggaran harus ≥ 0");
  const tc = tenantCryptoForDb(db);
  const adjust = input.adjust != null && Number.isFinite(input.adjust) ? Math.floor(input.adjust as number) : 0;
  const totalEnc = tc.encryptMoney(Math.floor(input.totalBudget));
  const adjustEnc = adjust !== 0 ? tc.encryptMoney(adjust) : null;
  await db.recruitmentBudget.upsert({
    where: { period },
    create: {
      period,
      totalBudget: totalEnc!,
      adjust: adjustEnc,
      note: input.note?.trim() || null,
    },
    update: {
      totalBudget: totalEnc!,
      adjust: adjustEnc,
      note: input.note !== undefined ? (input.note?.trim() || null) : undefined,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "RecruitmentBudget", entityId: period,
      detail: `Anggaran rekrutmen periode ${period} disimpan${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

export async function deleteBudget(db: TenantDb, period: string, actorName?: string | null): Promise<void> {
  const b = await db.recruitmentBudget.findUnique({ where: { period }, select: { period: true } });
  if (!b) throw new Error("Anggaran periode tersebut tidak ditemukan");
  await db.recruitmentBudget.delete({ where: { period } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "RecruitmentBudget", entityId: period,
      detail: `Anggaran rekrutmen periode ${period} dihapus${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}
