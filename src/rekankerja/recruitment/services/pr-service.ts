// ============================================================================
// RECRUITMENT F1 — PersonnelRequisition (PR) service
// Sumber: DEVELOPMENT-PLAN-RECRUITMENT.md §7 F1 + §4.3 (state machine HRX A3).
//
// State machine EKSPLISIT (guard transisi di sini — bukan di UI):
//   Draft ──apply──► Submitted ──approval──► Approved | Rejected
//   Draft ──cancel──► Cancelled
//   Submitted ──cancel──► Cancelled (ApprovalChain ikut dibatalkan)
//   Approved ──hold──► OnHold ──hold(resume)──► Approved
//   Approved|OnHold ──close──► Closed
//   (F2: Approved ──sistem──► Fulfilled saat lowongan terpenuhi)
//   Terminal (Rejected/Cancelled/Closed/Fulfilled) → ajukan ulang via duplicate.
//
// Uang: salaryBudget = String terenkripsi vault (enc:v1:n:…) — decrypt HANYA
// di batas serializer (rows/detail) atau untuk amount tier chain (baca-hitung),
// tidak pernah di query/sort SQL (konvensi W28 modul).
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import type { AdvSearch } from "@/rekankerja/shared/lib/adv-search";
import { advPrismaWhere, type AdvServerField } from "@/rekankerja/shared/services/adv-search-server";
import {
  startApprovalChain, getApprovalChain, decideApprovalChain, cancelApprovalChain,
  attachChainSummaries, type ChainSummary, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";

// ============ konstanta domain ============

export const PR_STATUSES = ["Draft", "Submitted", "Approved", "Rejected", "OnHold", "Fulfilled", "Closed", "Cancelled"] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

export const PR_EMPLOYMENT_STATUSES = ["Permanent", "Contract", "Probation", "Outsourcing"] as const;
export const PR_SOURCES = ["Internal", "External", "Any"] as const;

/** docType engine approval untuk PR rekrutmen. */
export const PR_DOC_TYPE = "RecruitmentPR" as const;

/** Field advance-search PR (server-side, whitelist — field tak dikenal dibuang). */
const PR_ADV_FIELDS: Record<string, AdvServerField> = {
  prNo: { path: "prNo", type: "text" },
  requester: { path: "requestedBy.fullName", type: "text" },
  position: { path: "position.title", type: "text" },
  orgUnit: { path: "orgUnit.name", type: "text" },
  officer: { path: "recruitmentOfficer.fullName", type: "text" },
  status: { path: "status", type: "select" },
  employmentStatus: { path: "employmentStatus", type: "select" },
  requestDate: { path: "requestDate", type: "date" },
  earliestDate: { path: "earliestDate", type: "date" },
  latestDate: { path: "latestDate", type: "date" },
  requiredNo: { path: "requiredNo", type: "number" },
};

/** Whitelist sort server-side (bentuk ARRAY — konvensi Prisma proyek). */
const PR_SORT: Record<string, Prisma.PersonnelRequisitionOrderByWithRelationInput[]> = {
  prNo: [{ prNo: "asc" }],
  requestDate: [{ requestDate: "asc" }],
  status: [{ status: "asc" }],
  requiredNo: [{ requiredNo: "asc" }],
  requester: [{ requestedBy: { fullName: "asc" } }],
  position: [{ position: { title: "asc" } }],
};

const PR_INCLUDE = {
  requestedBy: { select: { id: true, fullName: true, employeeNo: true } },
  position: { select: { id: true, title: true, code: true } },
  job: { select: { id: true, title: true, code: true } },
  orgUnit: { select: { id: true, name: true, code: true } },
  companyOffice: { select: { id: true, name: true, code: true } },
  recruitmentOfficer: { select: { id: true, fullName: true, employeeNo: true } },
  replacedEmployee: { select: { id: true, fullName: true, employeeNo: true } },
} satisfies Prisma.PersonnelRequisitionInclude;

// ============ tipe baris (bentuk JSON API — angka tetap angka) ============

export interface PrRow {
  id: string;
  prNo: string;
  requestDate: string; // ISO
  status: PrStatus;
  requestedById: string;
  requesterName: string;
  requesterNo: string;
  positionId: string | null;
  positionTitle: string | null;
  positionCode: string | null;
  jobId: string | null;
  jobTitle: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  companyOfficeId: string | null;
  officeName: string | null;
  requiredNo: number;
  employmentStatus: string;
  preferredSource: string | null;
  earliestDate: string | null;
  latestDate: string | null;
  recruitmentOfficerId: string | null;
  officerName: string | null;
  reason: string | null;
  miscSpec: string | null;
  additionalQualification: string | null;
  /** null bila vault menyembunyikan (masking per role) — TIDAK pernah string cipher. */
  salaryBudget: number | null;
  autoPostOpening: boolean;
  slaTargetDays: number | null;
  replacedEmployeeId: string | null;
  replacedEmployeeName: string | null;
  decisionNote: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  approval: ChainSummary | null;
}

export interface PrStats {
  total: number; draft: number; submitted: number; approved: number; rejected: number;
  onHold: number; fulfilled: number; closed: number; cancelled: number;
  requiredTotal: number; // Σ requiredNo PR Approved (kebutuhan terbuka)
}

// ============ helper ============

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Nomor PR berikutnya: PR-YYYY-NNNN (max-suffix, delete-safe — pola nextDocNo leave). */
export async function nextPrNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const start = `PR-${year}-`;
  let max = 0;
  const rows = await db.personnelRequisition.findMany({
    where: { prNo: { startsWith: start } },
    select: { prNo: true },
    take: 500,
  });
  for (const r of rows) {
    const n = parseInt(r.prNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

function rowOf(
  p: Prisma.PersonnelRequisitionGetPayload<{ include: typeof PR_INCLUDE }>,
  salaryBudget: number | null,
  approval: ChainSummary | null,
): PrRow {
  return {
    id: p.id, prNo: p.prNo, requestDate: p.requestDate.toISOString(), status: p.status as PrStatus,
    requestedById: p.requestedById, requesterName: p.requestedBy.fullName, requesterNo: p.requestedBy.employeeNo,
    positionId: p.positionId, positionTitle: p.position?.title ?? null, positionCode: p.position?.code ?? null,
    jobId: p.jobId, jobTitle: p.job?.title ?? null,
    orgUnitId: p.orgUnitId, orgUnitName: p.orgUnit?.name ?? null,
    companyOfficeId: p.companyOfficeId, officeName: p.companyOffice?.name ?? null,
    requiredNo: p.requiredNo, employmentStatus: p.employmentStatus, preferredSource: p.preferredSource,
    earliestDate: iso(p.earliestDate), latestDate: iso(p.latestDate),
    recruitmentOfficerId: p.recruitmentOfficerId, officerName: p.recruitmentOfficer?.fullName ?? null,
    reason: p.reason, miscSpec: p.miscSpec, additionalQualification: p.additionalQualification,
    salaryBudget, autoPostOpening: p.autoPostOpening, slaTargetDays: p.slaTargetDays,
    replacedEmployeeId: p.replacedEmployeeId, replacedEmployeeName: p.replacedEmployee?.fullName ?? null,
    decisionNote: p.decisionNote, submittedAt: iso(p.submittedAt), decidedAt: iso(p.decidedAt),
    approval,
  };
}

// ============ validasi input ============

export interface PrInput {
  requestDate?: string | null; // YYYY-MM-DD
  requestedById: string;
  positionId?: string | null;
  jobId?: string | null;
  orgUnitId?: string | null;
  companyOfficeId?: string | null;
  requiredNo: number;
  employmentStatus: string;
  preferredSource?: string | null;
  earliestDate?: string | null;
  latestDate?: string | null;
  recruitmentOfficerId?: string | null;
  reason?: string | null;
  miscSpec?: string | null;
  additionalQualification?: string | null;
  salaryBudget?: number | null;
  autoPostOpening?: boolean;
  slaTargetDays?: number | null;
  replacedEmployeeId?: string | null;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Tanggal tidak valid (YYYY-MM-DD): ${v}`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new Error(`Tanggal tidak valid: ${v}`);
  return d;
}

/** Validasi field PR. `forApply` = validasi penuh (Draft→Submitted);
 *  draft boleh setengah terisi (kecuali identitas dasar). */
async function validatePrInput(db: TenantDb, input: PrInput, forApply: boolean): Promise<{
  requestedById: string; positionId: string | null; jobId: string | null; orgUnitId: string | null;
  companyOfficeId: string | null; requiredNo: number; employmentStatus: string; preferredSource: string | null;
  earliestDate: Date | null; latestDate: Date | null; recruitmentOfficerId: string | null;
  reason: string | null; miscSpec: string | null; additionalQualification: string | null;
  autoPostOpening: boolean; slaTargetDays: number | null; replacedEmployeeId: string | null;
}> {
  if (!input.requestedById) throw new Error("Pengaju (karyawan) wajib dipilih");
  const requester = await db.employee.findUnique({
    where: { id: input.requestedById }, select: { id: true, status: true, fullName: true },
  });
  if (!requester) throw new Error("Karyawan pengaju tidak ditemukan");
  if (requester.status !== "Active") throw new Error(`Karyawan pengaju ${requester.fullName} berstatus ${requester.status} — harus Active`);

  if (forApply && !input.positionId) throw new Error("Posisi yang diminta wajib dipilih untuk mengajukan PR");
  if (input.positionId) {
    const pos = await db.position.findUnique({ where: { id: input.positionId }, select: { id: true } });
    if (!pos) throw new Error("Posisi tidak ditemukan");
  }
  if (input.jobId) {
    const job = await db.job.findUnique({ where: { id: input.jobId }, select: { id: true } });
    if (!job) throw new Error("Job tidak ditemukan");
  }
  if (input.orgUnitId) {
    const ou = await db.orgUnit.findUnique({ where: { id: input.orgUnitId }, select: { id: true } });
    if (!ou) throw new Error("Unit organisasi tidak ditemukan");
  }
  if (input.companyOfficeId) {
    const ofc = await db.companyOffice.findUnique({ where: { id: input.companyOfficeId }, select: { id: true } });
    if (!ofc) throw new Error("Kantor tidak ditemukan");
  }
  if (input.recruitmentOfficerId) {
    const off = await db.employee.findUnique({ where: { id: input.recruitmentOfficerId }, select: { id: true } });
    if (!off) throw new Error("Recruitment officer tidak ditemukan");
  }
  if (input.replacedEmployeeId) {
    const rep = await db.employee.findUnique({ where: { id: input.replacedEmployeeId }, select: { id: true } });
    if (!rep) throw new Error("Karyawan yang digantikan tidak ditemukan");
  }

  const requiredNo = Math.trunc(Number(input.requiredNo ?? 1));
  if (!Number.isFinite(requiredNo) || requiredNo < 1 || requiredNo > 999) {
    throw new Error("Jumlah kebutuhan wajib 1–999 orang");
  }
  if (!PR_EMPLOYMENT_STATUSES.includes(input.employmentStatus as (typeof PR_EMPLOYMENT_STATUSES)[number])) {
    throw new Error(`Status kerja tidak dikenal: ${input.employmentStatus}`);
  }
  if (input.preferredSource && !PR_SOURCES.includes(input.preferredSource as (typeof PR_SOURCES)[number])) {
    throw new Error(`Sumber kandidat pilihan tidak dikenal: ${input.preferredSource}`);
  }

  const earliest = parseDate(input.earliestDate ?? null);
  const latest = parseDate(input.latestDate ?? null);
  if (earliest && latest && earliest.getTime() > latest.getTime()) {
    throw new Error("Tanggal paling awal melebihi tanggal paling lambat");
  }

  const slaTargetDays = input.slaTargetDays == null ? null : Math.trunc(Number(input.slaTargetDays));
  if (slaTargetDays != null && (slaTargetDays < 1 || slaTargetDays > 365)) {
    throw new Error("Target SLA (hari) wajib 1–365");
  }
  if (input.salaryBudget != null && (!Number.isFinite(Number(input.salaryBudget)) || Number(input.salaryBudget) < 0)) {
    throw new Error("Anggaran gaji wajib angka ≥ 0");
  }

  return {
    requestedById: input.requestedById,
    positionId: input.positionId ?? null,
    jobId: input.jobId ?? null,
    orgUnitId: input.orgUnitId ?? null,
    companyOfficeId: input.companyOfficeId ?? null,
    requiredNo,
    employmentStatus: input.employmentStatus,
    preferredSource: input.preferredSource ?? null,
    earliestDate: earliest, latestDate: latest,
    recruitmentOfficerId: input.recruitmentOfficerId ?? null,
    reason: input.reason?.trim() || null,
    miscSpec: input.miscSpec?.trim() || null,
    additionalQualification: input.additionalQualification?.trim() || null,
    autoPostOpening: input.autoPostOpening === true,
    slaTargetDays,
    replacedEmployeeId: input.replacedEmployeeId ?? null,
  };
}

// ============ LIST (server-side pagination + adv + chain summary) ============

export interface ListPrsParams {
  status?: string | null; // "all" | PrStatus
  q?: string | null;
  adv?: AdvSearch | null;
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  sortDir?: string | null; // asc | desc
  requestedById?: string | null; // scope ESS (hanya PR saya)
  moneyVisible?: boolean; // false → salaryBudget null (masked)
}

export async function listPrs(db: TenantDb, p: ListPrsParams): Promise<{ rows: PrRow[]; total: number; stats: PrStats }> {
  const where: Prisma.PersonnelRequisitionWhereInput = {};
  if (p.status && p.status !== "all" && PR_STATUSES.includes(p.status as PrStatus)) where.status = p.status;
  if (p.requestedById) where.requestedById = p.requestedById;

  const q = p.q?.trim().toLowerCase();
  if (q) {
    where.OR = [
      { prNo: { contains: q, mode: "insensitive" } },
      { requestedBy: { fullName: { contains: q, mode: "insensitive" } } },
      { position: { title: { contains: q, mode: "insensitive" } } },
      { reason: { contains: q, mode: "insensitive" } },
    ];
  }

  const advW = advPrismaWhere(p.adv ?? null, PR_ADV_FIELDS);
  const withAdv: Prisma.PersonnelRequisitionWhereInput = advW
    ? { AND: [where, advW as Prisma.PersonnelRequisitionWhereInput] }
    : where;

  const sortBy = p.sortBy && PR_SORT[p.sortBy] ? p.sortBy : "requestDate";
  const dir: "asc" | "desc" = p.sortDir === "asc" ? "asc" : "desc";
  /** ganti arah sort secara rekursif (dukung relasi bertitik: requestedBy.fullName). */
  const withDir = (o: Prisma.PersonnelRequisitionOrderByWithRelationInput): Prisma.PersonnelRequisitionOrderByWithRelationInput => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = typeof v === "string" ? dir : withDir(v as Prisma.PersonnelRequisitionOrderByWithRelationInput);
    }
    return out as Prisma.PersonnelRequisitionOrderByWithRelationInput;
  };
  const orderBy = PR_SORT[sortBy]!.map(withDir);
  // sekunder: prNo supaya urutan stabil antar halaman
  orderBy.push({ prNo: dir } as Prisma.PersonnelRequisitionOrderByWithRelationInput);

  const limit = Math.min(Math.max(Math.trunc(Number(p.limit ?? 20)), 1), 100);
  const offset = Math.max(Math.trunc(Number(p.offset ?? 0)), 0);

  const [pageRows, total, stats] = await Promise.all([
    db.personnelRequisition.findMany({ where: withAdv, include: PR_INCLUDE, orderBy, take: limit, skip: offset }),
    db.personnelRequisition.count({ where: withAdv }),
    prStats(db, p.requestedById ?? null),
  ]);

  const chainMap = await attachChainSummaries(db, PR_DOC_TYPE, pageRows);
  const tc = tenantCryptoForDb(db);
  const moneyVisible = p.moneyVisible !== false;
  const rows = pageRows.map((r) => rowOf(r, moneyVisible ? tc.decryptMoney(r.salaryBudget) : null, chainMap.get(r.id) ?? null));
  return { rows, total, stats };
}

export async function prStats(db: TenantDb, requestedById?: string | null): Promise<PrStats> {
  const scope = requestedById ? { requestedById } : {};
  const g = await db.personnelRequisition.groupBy({
    by: ["status"],
    _count: { _all: true },
    _sum: { requiredNo: true },
    where: scope,
  });
  const by: Record<string, number> = {};
  let requiredApproved = 0;
  for (const row of g) {
    by[row.status] = row._count._all;
    if (row.status === "Approved") requiredApproved = row._sum.requiredNo ?? 0;
  }
  const stats: PrStats = {
    total: Object.values(by).reduce((a, b) => a + b, 0),
    draft: by.Draft ?? 0, submitted: by.Submitted ?? 0, approved: by.Approved ?? 0,
    rejected: by.Rejected ?? 0, onHold: by.OnHold ?? 0, fulfilled: by.Fulfilled ?? 0,
    closed: by.Closed ?? 0, cancelled: by.Cancelled ?? 0,
    requiredTotal: requiredApproved,
  };
  return stats;
}

export async function getPr(db: TenantDb, id: string, moneyVisible = true): Promise<PrRow | null> {
  const p = await db.personnelRequisition.findUnique({ where: { id }, include: PR_INCLUDE });
  if (!p) return null;
  const chain = await getApprovalChain(db, PR_DOC_TYPE, id);
  const approval: ChainSummary | null = chain
    ? { status: chain.status, currentLevel: chain.currentLevel, totalLevels: chain.totalLevels, currentApprover: currentApproverOf(chain.steps) }
    : null;
  const tc = tenantCryptoForDb(db);
  return rowOf(p, moneyVisible ? tc.decryptMoney(p.salaryBudget) : null, approval);
}

function currentApproverOf(steps: { status: string; approverLabel: string }[]): string | null {
  const cur = steps.find((s) => s.status === "Current");
  return cur?.approverLabel ?? null;
}

// ============ CREATE / UPDATE / DUPLICATE ============

export interface CreatePrResult {
  id: string; prNo: string; status: PrStatus;
  approvalLevels?: number; firstApprover?: string | null;
}

export async function createPr(
  db: TenantDb,
  input: PrInput,
  opts: { submit: boolean; actorName?: string | null },
): Promise<CreatePrResult> {
  const v = await validatePrInput(db, input, opts.submit);
  const prNo = await nextPrNo(db);
  const requestDate = parseDate(input.requestDate ?? null) ?? new Date();
  const tc = tenantCryptoForDb(db);

  const created = await db.personnelRequisition.create({
    data: {
      prNo,
      requestDate,
      requestedById: v.requestedById,
      positionId: v.positionId, jobId: v.jobId, orgUnitId: v.orgUnitId, companyOfficeId: v.companyOfficeId,
      requiredNo: v.requiredNo, employmentStatus: v.employmentStatus, preferredSource: v.preferredSource,
      earliestDate: v.earliestDate, latestDate: v.latestDate,
      recruitmentOfficerId: v.recruitmentOfficerId,
      reason: v.reason, miscSpec: v.miscSpec, additionalQualification: v.additionalQualification,
      salaryBudget: input.salaryBudget != null ? tc.encryptMoney(Number(input.salaryBudget)) : null,
      autoPostOpening: v.autoPostOpening, slaTargetDays: v.slaTargetDays,
      replacedEmployeeId: v.replacedEmployeeId,
      status: "Draft",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PersonnelRequisition", entityId: prNo,
      detail: `PR rekrutmen ${prNo} dibuat${opts.actorName ? ` oleh ${opts.actorName}` : ""} (Draft)`,
    },
  });

  if (!opts.submit) return { id: created.id, prNo, status: "Draft" };
  const applied = await applyPr(db, created.id, opts.actorName ?? null);
  return { id: created.id, prNo, status: "Submitted", approvalLevels: applied.approvalLevels, firstApprover: applied.firstApprover };
}

export async function updatePr(db: TenantDb, id: string, input: PrInput, actorName?: string | null): Promise<{ prNo: string }> {
  const p = await db.personnelRequisition.findUnique({ where: { id }, select: { id: true, prNo: true, status: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Draft") throw new Error(`PR ${p.prNo} berstatus ${p.status} — hanya Draft yang dapat diubah (gunakan Duplikat untuk mengajukan ulang)`);

  const v = await validatePrInput(db, input, false);
  const requestDate = parseDate(input.requestDate ?? null);
  const tc = tenantCryptoForDb(db);

  await db.personnelRequisition.update({
    where: { id },
    data: {
      ...(requestDate ? { requestDate } : {}),
      requestedById: v.requestedById,
      positionId: v.positionId, jobId: v.jobId, orgUnitId: v.orgUnitId, companyOfficeId: v.companyOfficeId,
      requiredNo: v.requiredNo, employmentStatus: v.employmentStatus, preferredSource: v.preferredSource,
      earliestDate: v.earliestDate, latestDate: v.latestDate,
      recruitmentOfficerId: v.recruitmentOfficerId,
      reason: v.reason, miscSpec: v.miscSpec, additionalQualification: v.additionalQualification,
      salaryBudget: input.salaryBudget != null ? tc.encryptMoney(Number(input.salaryBudget)) : null,
      autoPostOpening: v.autoPostOpening, slaTargetDays: v.slaTargetDays,
      replacedEmployeeId: v.replacedEmployeeId,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Updated", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR rekrutmen ${p.prNo} diperbarui${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return { prNo: p.prNo };
}

/** Duplikat PR (termasuk ditolak/ditutup) → Draft baru dengan nomor baru.
 *  Jalur resmi "ajukan ulang": jejak chain PR lama tetap utuh. */
export async function duplicatePr(db: TenantDb, id: string, actorName?: string | null): Promise<CreatePrResult> {
  const src = await db.personnelRequisition.findUnique({ where: { id } });
  if (!src) throw new Error("PR sumber tidak ditemukan");
  const prNo = await nextPrNo(db);
  const created = await db.personnelRequisition.create({
    data: {
      prNo,
      requestDate: new Date(),
      requestedById: src.requestedById,
      positionId: src.positionId, jobId: src.jobId, orgUnitId: src.orgUnitId, companyOfficeId: src.companyOfficeId,
      requiredNo: src.requiredNo, employmentStatus: src.employmentStatus, preferredSource: src.preferredSource,
      earliestDate: src.earliestDate, latestDate: src.latestDate,
      recruitmentOfficerId: src.recruitmentOfficerId,
      reason: src.reason, miscSpec: src.miscSpec, additionalQualification: src.additionalQualification,
      salaryBudget: src.salaryBudget, // sudah terenkripsi — salin apa adanya
      autoPostOpening: src.autoPostOpening, slaTargetDays: src.slaTargetDays,
      replacedEmployeeId: src.replacedEmployeeId,
      status: "Draft",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "PersonnelRequisition", entityId: prNo,
      detail: `PR ${prNo} dibuat sebagai duplikat dari ${src.prNo}${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return { id: created.id, prNo, status: "Draft" };
}

// ============ STATE MACHINE ============

/** Draft → Submitted: buat ApprovalChain (idempoten) + notif dipanggil route. */
export async function applyPr(
  db: TenantDb, id: string, actorName?: string | null,
): Promise<{ prNo: string; approvalLevels: number; firstApprover: string | null }> {
  const p = await db.personnelRequisition.findUnique({ where: { id }, include: { requestedBy: { select: { fullName: true } }, position: { select: { title: true } } } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Draft") throw new Error(`PR ${p.prNo} berstatus ${p.status} — hanya Draft yang dapat diajukan`);

  // validasi penuh ulang (bisa jadi draft disimpan setengah terisi)
  const input: PrInput = {
    requestedById: p.requestedById, positionId: p.positionId, jobId: p.jobId, orgUnitId: p.orgUnitId,
    companyOfficeId: p.companyOfficeId, requiredNo: p.requiredNo, employmentStatus: p.employmentStatus,
    preferredSource: p.preferredSource, earliestDate: p.earliestDate ? p.earliestDate.toISOString().slice(0, 10) : null,
    latestDate: p.latestDate ? p.latestDate.toISOString().slice(0, 10) : null,
    recruitmentOfficerId: p.recruitmentOfficerId, slaTargetDays: p.slaTargetDays, replacedEmployeeId: p.replacedEmployeeId,
  };
  await validatePrInput(db, input, true);

  const tc = tenantCryptoForDb(db);
  const amount = tc.decryptMoney(p.salaryBudget) ?? undefined; // tier jenjang min/max salaryBudget

  const chain = await startApprovalChain(db, {
    docType: PR_DOC_TYPE, docId: p.id, employeeId: p.requestedById, amount, createdBy: actorName ?? null,
  });
  const first = chain.steps.find((s) => s.status === "Current") ?? null;

  await db.personnelRequisition.update({
    where: { id },
    data: { status: "Submitted", submittedAt: new Date(), decisionNote: null, decidedAt: null },
  });
  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR ${p.prNo} diajukan ke approval (${chain.totalLevels} jenjang${actorName ? `, oleh ${actorName}` : ""}) — ${p.position?.title ?? "-"}, ${p.requiredNo} orang`,
    },
  });
  return { prNo: p.prNo, approvalLevels: chain.totalLevels, firstApprover: first?.approverLabel ?? null };
}

/** Keputusan approval: approve (jenjang/final) | reject. */
export async function decidePr(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject"; note?: string | null; actor: DecideActor },
): Promise<{ prNo: string; status: PrStatus; approval: ChainSummary | null; final: boolean }> {
  const p = await db.personnelRequisition.findUnique({ where: { id: input.id }, include: { requestedBy: { select: { fullName: true } }, position: { select: { title: true } } } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Submitted") throw new Error(`PR ${p.prNo} berstatus ${p.status} — tidak menunggu keputusan`);

  // chain hilang (edge legacy) → backfill idempoten
  let chain = await getApprovalChain(db, PR_DOC_TYPE, p.id);
  if (!chain) {
    const tc = tenantCryptoForDb(db);
    chain = await startApprovalChain(db, {
      docType: PR_DOC_TYPE, docId: p.id, employeeId: p.requestedById,
      amount: tc.decryptMoney(p.salaryBudget) ?? undefined, createdBy: "legacy-backfill",
    });
  }

  const res = await decideApprovalChain(db, {
    docType: PR_DOC_TYPE, docId: p.id, action: input.action, note: input.note ?? undefined, actor: input.actor,
  });

  const summary: ChainSummary = {
    status: res.chain.status, currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
    currentApprover: res.chain.steps.find((s) => s.status === "Current")?.approverLabel ?? null,
  };

  if (!res.final) {
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "PersonnelRequisition", entityId: p.prNo,
        detail: `PR ${p.prNo} disetujui jenjang ${res.chain.currentLevel - 1}/${res.chain.totalLevels} (${input.actor.name}) — lanjut ke ${summary.currentApprover ?? "-"}`,
      },
    });
    return { prNo: p.prNo, status: "Submitted", approval: summary, final: false };
  }

  if (input.action === "approve") {
    await db.personnelRequisition.update({
      where: { id: p.id },
      data: { status: "Approved", decidedAt: new Date(), decisionNote: input.note?.trim() || null },
    });
    await db.activityLog.create({
      data: {
        action: "Approved", entity: "PersonnelRequisition", entityId: p.prNo,
        detail: `PR ${p.prNo} DISETUJUI penuh (${res.chain.totalLevels} jenjang, keputusan akhir: ${input.actor.name})${p.autoPostOpening ? " — auto-post lowongan aktif (dieksekusi F2)" : ""}`,
      },
    });
    return { prNo: p.prNo, status: "Approved", approval: summary, final: true };
  }

  await db.personnelRequisition.update({
    where: { id: p.id },
    data: { status: "Rejected", decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  await db.activityLog.create({
    data: {
      action: "Rejected", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR ${p.prNo} DITOLAK (${input.actor.name})${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { prNo: p.prNo, status: "Rejected", approval: summary, final: true };
}

/** Cancel: Draft (tanpa chain) | Submitted (chain ikut dibatalkan). */
export async function cancelPr(
  db: TenantDb, input: { id: string; note?: string | null; actorName?: string | null },
): Promise<{ prNo: string; status: PrStatus }> {
  const p = await db.personnelRequisition.findUnique({ where: { id: input.id }, select: { id: true, prNo: true, status: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Draft" && p.status !== "Submitted") {
    throw new Error(`PR ${p.prNo} berstatus ${p.status} — gunakan Tutup PR untuk menghentikan PR yang sudah disetujui`);
  }
  if (p.status === "Submitted") await cancelApprovalChain(db, PR_DOC_TYPE, p.id, input.actorName ?? undefined);
  await db.personnelRequisition.update({
    where: { id: p.id },
    data: { status: "Cancelled", decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  await db.activityLog.create({
    data: {
      action: "Cancelled", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR ${p.prNo} dibatalkan${input.actorName ? ` oleh ${input.actorName}` : ""}${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { prNo: p.prNo, status: "Cancelled" };
}

/** Hold/Resume: Approved ⇄ OnHold (rekrutmen ditunda sementara). */
export async function holdPr(
  db: TenantDb, input: { id: string; note?: string | null; actorName?: string | null },
): Promise<{ prNo: string; status: PrStatus }> {
  const p = await db.personnelRequisition.findUnique({ where: { id: input.id }, select: { id: true, prNo: true, status: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  const to: PrStatus = p.status === "Approved" ? "OnHold" : p.status === "OnHold" ? "Approved" : null as unknown as PrStatus;
  if (!to) throw new Error(`PR ${p.prNo} berstatus ${p.status} — hanya Approved/OnHold yang dapat ditahan/dilanjutkan`);
  await db.personnelRequisition.update({
    where: { id: p.id },
    data: { status: to, decisionNote: input.note?.trim() || null, decidedAt: new Date() },
  });
  await db.activityLog.create({
    data: {
      action: to === "OnHold" ? "Held" : "Resumed", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR ${p.prNo} ${to === "OnHold" ? "ditahan (On Hold)" : "dilanjutkan kembali"}${input.actorName ? ` oleh ${input.actorName}` : ""}${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { prNo: p.prNo, status: to };
}

/** Close: Approved|OnHold → Closed (batal rekrutmen pasca-approval). */
export async function closePr(
  db: TenantDb, input: { id: string; note?: string | null; actorName?: string | null },
): Promise<{ prNo: string; status: PrStatus }> {
  const p = await db.personnelRequisition.findUnique({ where: { id: input.id }, select: { id: true, prNo: true, status: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Approved" && p.status !== "OnHold") {
    throw new Error(`PR ${p.prNo} berstatus ${p.status} — hanya Approved/OnHold yang dapat ditutup`);
  }
  await db.personnelRequisition.update({
    where: { id: p.id },
    data: { status: "Closed", decidedAt: new Date(), decisionNote: input.note?.trim() || null },
  });
  await db.activityLog.create({
    data: {
      action: "Closed", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `PR ${p.prNo} ditutup${input.actorName ? ` oleh ${input.actorName}` : ""}${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { prNo: p.prNo, status: "Closed" };
}

/** Hapus Draft (tidak pernah ada chain). */
export async function deletePr(db: TenantDb, id: string): Promise<{ prNo: string }> {
  const p = await db.personnelRequisition.findUnique({ where: { id }, select: { id: true, prNo: true, status: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.status !== "Draft") throw new Error(`PR ${p.prNo} berstatus ${p.status} — hanya Draft yang dapat dihapus`);
  await db.personnelRequisition.delete({ where: { id } });
  await db.activityLog.create({
    data: {
      action: "Deleted", entity: "PersonnelRequisition", entityId: p.prNo,
      detail: `Draft PR ${p.prNo} dihapus`,
    },
  });
  return { prNo: p.prNo };
}

/** ESS: tarik/batalkan PR milik sendiri (Draft|Submitted). */
export async function cancelOwnPr(
  db: TenantDb, input: { id: string; employeeId: string; note?: string | null; actorName?: string | null },
): Promise<{ prNo: string; status: PrStatus }> {
  const p = await db.personnelRequisition.findUnique({ where: { id: input.id }, select: { id: true, prNo: true, status: true, requestedById: true } });
  if (!p) throw new Error("PR tidak ditemukan");
  if (p.requestedById !== input.employeeId) throw new Error("PR ini bukan milik Anda");
  return cancelPr(db, { id: input.id, note: input.note, actorName: input.actorName });
}

/** ESS: PR yang menunggu keputusan aktor (chain InProgress, step Current
 *  = aktor ATAU jenjang HR_ADMIN untuk aktor ber-peran admin — selaras
 *  otorisasi engine canActorDecideCurrentStep / pola dashboard ESS). */
export async function listPrsToApprove(
  db: TenantDb, actor: { employeeId: string | null; isAdminRole: boolean }, moneyVisible: boolean,
): Promise<PrRow[]> {
  const chains = await db.approvalChain.findMany({
    where: { docType: PR_DOC_TYPE, status: "InProgress" },
    include: { steps: { where: { status: "Current" }, take: 1, select: { approverType: true, approverEmployeeId: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const ids = chains
    .filter((ch) => {
      const step = ch.steps[0];
      if (!step) return false;
      if (step.approverEmployeeId && step.approverEmployeeId === actor.employeeId) return true;
      return step.approverType === "HR_ADMIN" && actor.isAdminRole;
    })
    .map((ch) => ch.docId);
  if (ids.length === 0) return [];
  const rows = await db.personnelRequisition.findMany({ where: { id: { in: ids }, status: "Submitted" }, include: PR_INCLUDE });
  const chainById = new Map(chains.map((ch) => [ch.docId, ch]));
  const tc = tenantCryptoForDb(db);
  return rows.map((r) => {
    const ch = chainById.get(r.id);
    const step = ch?.steps[0];
    return rowOf(r, moneyVisible ? tc.decryptMoney(r.salaryBudget) : null, ch
      ? { status: ch.status, currentLevel: ch.currentLevel, totalLevels: ch.totalLevels, currentApprover: step ? "Anda" : null }
      : null);
  });
}
