// OneVity — Mesin APPROVAL STRUKTUR BERJENJANG (Task 25)
// =====================================================================
// Alur persetujuan multi-level yang dapat di-setup per modul dokumen
// (Leave/Travel/Medical/Loan) dengan pencocokan 6 dimensi penempatan
// pemohon: company office, work location, unit organisasi, posisi,
// grade, dan level jabatan (semua parameter tersimpan pada Employee —
// snapshot penempatan aktif). Khusus Travel/Medical/Loan, tiap jenjang
// dapat membawa syarat nominal (minAmount/maxAmount) sehingga jenjang
// tambahan aktif hanya bila besaran benefit / jumlah pinjaman masuk
// rentang.
//
// Fallback tanpa struktur: atasan langsung (bila ada) → Admin/HR —
// mencegah deadlock (temuan audit BPA: layer tanpa approver).
// =====================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";

export type DbOrTx = TenantDb | Prisma.TransactionClient;

// ============ konstanta domain ============

export const APPROVAL_DOC_TYPES = ["Leave", "Travel", "Medical", "Loan"] as const;
export type ApprovalDocType = (typeof APPROVAL_DOC_TYPES)[number];

/** docType yang jenjangnya bisa memakai syarat nominal (besaran). */
export const AMOUNT_DOC_TYPES: ApprovalDocType[] = ["Travel", "Medical", "Loan"];

export const DOC_TYPE_LABEL: Record<ApprovalDocType, string> = {
  Leave: "Cuti (Leave)",
  Travel: "Perjalanan Dinas (Travel)",
  Medical: "Klaim Medis (Medical)",
  Loan: "Pinjaman Karyawan (Loan)",
};

export const APPROVER_TYPE_LABEL: Record<string, string> = {
  ATASAN_LANGSUNG: "Atasan Langsung",
  ATASAN_BERJENJANG: "Atasan Berjenjang",
  POSISI: "Pemegang Posisi",
  KARYAWAN: "Karyawan Tertentu",
  HR_ADMIN: "Admin/HR Workspace",
};

/** jenjang nominal di-render hanya untuk docType ini di UI. */
export const isAmountDocType = (docType: string): boolean =>
  (AMOUNT_DOC_TYPES as string[]).includes(docType);

// ============ tipe publik ============

export interface EmployeeApprovalParams {
  employeeId: string;
  employeeNo: string;
  fullName: string;
  companyOfficeId: string | null;
  workLocationId: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  positionLevelId: string | null;
  managerId: string | null;
}

export interface BuiltStep {
  levelNo: number;
  approverType: string;
  approverLabel: string;
  approverEmployeeId: string | null;
  approverPositionCode: string | null;
  minAmount: number | null;
  maxAmount: number | null;
}

export interface BuiltChain {
  structureId: string | null;
  structureCode: string | null;
  structureName: string | null;
  /** true bila tidak ada struktur cocok — memakai fallback default. */
  fallback: boolean;
  steps: BuiltStep[];
}

export interface ChainStepView {
  levelNo: number;
  approverType: string;
  approverLabel: string;
  approverEmployeeId: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  status: string; // Waiting|Current|Approved|Rejected|Skipped
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export interface ChainView {
  id: string;
  docType: string;
  docId: string;
  structureId: string | null;
  status: string;
  currentLevel: number;
  totalLevels: number;
  amount: number | null;
  steps: ChainStepView[];
}

export interface ChainSummary {
  status: string;
  currentLevel: number;
  totalLevels: number;
  currentApprover: string | null;
}

export interface DecideActor {
  /** role workspace: OWNER|ADMIN|HR|VIEWER */
  role: string;
  /** employeeId tenant aktor (bila AppUser tertaut karyawan). */
  employeeId: string | null;
  name: string;
}

// ============ parameter employee ============

/**
 * Parameter penempatan pemohon untuk pencocokan struktur. Membaca snapshot
 * Employee (didorong service assignment); bila snapshot belum terisi
 * (data legacy pra-migrasi), diturunkan dari EmployeeAssignment aktif.
 */
export async function getEmployeeApprovalParams(db: DbOrTx, employeeId: string): Promise<EmployeeApprovalParams | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, employeeNo: true, fullName: true,
      companyOfficeId: true, workLocationId: true,
      orgUnitId: true, positionId: true, gradeId: true, positionLevelId: true,
      position: { select: { positionLevelId: true } },
    },
  });
  if (!emp) return null;

  let { orgUnitId, positionId, gradeId, positionLevelId, companyOfficeId, workLocationId } = emp;
  let managerId: string | null = null;

  const assignment = await db.employeeAssignment.findFirst({
    where: { employeeId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: {
      orgUnitId: true, positionId: true, gradeId: true,
      companyOfficeId: true, workLocationId: true, managerId: true,
      position: { select: { positionLevelId: true } },
    },
  });
  managerId = assignment?.managerId ?? null;

  // snapshot belum terisi → turunkan dari assignment aktif (robust saat migrasi berjalan)
  if (!orgUnitId && !positionId && !gradeId && !companyOfficeId && !workLocationId && assignment) {
    orgUnitId = assignment.orgUnitId;
    positionId = assignment.positionId;
    gradeId = assignment.gradeId;
    companyOfficeId = assignment.companyOfficeId;
    workLocationId = assignment.workLocationId;
    positionLevelId = positionLevelId ?? assignment.position?.positionLevelId ?? null;
  }
  if (!positionLevelId) positionLevelId = emp.position?.positionLevelId ?? null;

  return {
    employeeId: emp.id,
    employeeNo: emp.employeeNo,
    fullName: emp.fullName,
    companyOfficeId,
    workLocationId,
    orgUnitId,
    positionId,
    gradeId,
    positionLevelId,
    managerId,
  };
}

// ============ resolusi struktur ============

interface StructureWithLevels {
  id: string;
  code: string;
  name: string;
  companyOfficeId: string | null;
  workLocationId: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  positionLevelId: string | null;
  active: boolean;
  createdAt: Date;
  levels: {
    levelNo: number;
    approverType: string;
    approverPositionId: string | null;
    approverEmployeeId: string | null;
    superiorLevel: number | null;
    minAmount: number | null;
    maxAmount: number | null;
    note: string | null;
  }[];
}

/** Struktur aktif yang cocok untuk pemohon — terbit spesifik (kriteria terbanyak). */
export async function resolveApprovalStructure(
  db: DbOrTx,
  params: EmployeeApprovalParams,
  docType: string,
): Promise<StructureWithLevels | null> {
  const structures = (await db.approvalStructure.findMany({
    where: { docType, active: true },
    include: { levels: { orderBy: { levelNo: "asc" } } },
    orderBy: { createdAt: "asc" },
  })) as unknown as StructureWithLevels[];

  const matches = structures
    .map((s) => {
      const criteria: [string | null, string | null][] = [
        [s.companyOfficeId, params.companyOfficeId],
        [s.workLocationId, params.workLocationId],
        [s.orgUnitId, params.orgUnitId],
        [s.positionId, params.positionId],
        [s.gradeId, params.gradeId],
        [s.positionLevelId, params.positionLevelId],
      ];
      let score = 0;
      for (const [criterion, value] of criteria) {
        if (criterion == null) continue;
        if (criterion !== value) return null; // tidak cocok
        score++;
      }
      return { s, score };
    })
    .filter((m): m is { s: StructureWithLevels; score: number } => m !== null)
    .sort((a, b) => b.score - a.score);

  return matches[0]?.s ?? null;
}

// ============ resolusi approver per jenjang ============

async function positionHolderLabel(
  db: DbOrTx,
  positionId: string,
): Promise<{ approverEmployeeId: string | null; label: string; positionCode: string | null }> {
  const position = await db.position.findUnique({
    where: { id: positionId },
    select: { code: true, title: true },
  });
  if (!position) {
    return { approverEmployeeId: null, label: "Posisi tidak dikenal — Admin/HR Workspace", positionCode: null };
  }
  const holder = await db.employeeAssignment.findFirst({
    where: { positionId, validTo: null },
    orderBy: { validFrom: "desc" },
    select: { employee: { select: { id: true, fullName: true } } },
  });
  if (!holder) {
    return { approverEmployeeId: null, label: `${position.title} belum diisi — Admin/HR Workspace`, positionCode: position.code };
  }
  return { approverEmployeeId: holder.employee.id, label: `${holder.employee.fullName} — ${position.title}`, positionCode: position.code };
}

async function employeeLabel(db: DbOrTx, employeeId: string): Promise<{ approverEmployeeId: string; label: string } | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, fullName: true, positionId: true, position: { select: { title: true } } },
  });
  if (!emp) return null;
  return { approverEmployeeId: emp.id, label: emp.position?.title ? `${emp.fullName} — ${emp.position.title}` : emp.fullName };
}

/** Naik rantai atasan dari seorang karyawan (1 = atasan langsung). */
async function managerAtLevel(db: DbOrTx, employeeId: string, level: number): Promise<string | null> {
  let currentId = employeeId;
  for (let i = 0; i < level; i++) {
    const assignment = await db.employeeAssignment.findFirst({
      where: { employeeId: currentId, validTo: null },
      orderBy: { validFrom: "desc" },
      select: { managerId: true },
    });
    const managerId = assignment?.managerId ?? null;
    if (!managerId) return null;
    currentId = managerId;
  }
  return currentId;
}

async function resolveApprover(
  db: DbOrTx,
  params: EmployeeApprovalParams,
  level: StructureWithLevels["levels"][number],
): Promise<BuiltStep> {
  const base = { levelNo: level.levelNo, minAmount: level.minAmount, maxAmount: level.maxAmount };
  switch (level.approverType) {
    case "ATASAN_LANGSUNG": {
      if (!params.managerId) {
        return { ...base, approverType: "HR_ADMIN", approverLabel: "Tanpa atasan langsung — Admin/HR Workspace", approverEmployeeId: null, approverPositionCode: null };
      }
      const l = await employeeLabel(db, params.managerId);
      return {
        ...base, approverType: "ATASAN_LANGSUNG",
        approverLabel: l?.label ?? "Atasan langsung tidak ditemukan — Admin/HR Workspace",
        approverEmployeeId: l?.approverEmployeeId ?? null, approverPositionCode: null,
      };
    }
    case "ATASAN_BERJENJANG": {
      const up = Math.max(1, level.superiorLevel ?? 1);
      const managerId = await managerAtLevel(db, params.employeeId, up);
      if (!managerId) {
        return { ...base, approverType: "HR_ADMIN", approverLabel: `Atasan ${up > 1 ? `tingkat ${up} ` : ""}tidak ditemukan — Admin/HR Workspace`, approverEmployeeId: null, approverPositionCode: null };
      }
      const l = await employeeLabel(db, managerId);
      return {
        ...base, approverType: "ATASAN_BERJENJANG",
        approverLabel: l?.label ?? "Atasan tidak ditemukan — Admin/HR Workspace",
        approverEmployeeId: l?.approverEmployeeId ?? null, approverPositionCode: null,
      };
    }
    case "POSISI": {
      if (!level.approverPositionId) {
        return { ...base, approverType: "HR_ADMIN", approverLabel: "Posisi approver belum dipilih — Admin/HR Workspace", approverEmployeeId: null, approverPositionCode: null };
      }
      const holder = await positionHolderLabel(db, level.approverPositionId);
      return { ...base, approverType: "POSISI", approverLabel: holder.label, approverEmployeeId: holder.approverEmployeeId, approverPositionCode: holder.positionCode };
    }
    case "KARYAWAN": {
      if (!level.approverEmployeeId) {
        return { ...base, approverType: "HR_ADMIN", approverLabel: "Karyawan approver belum dipilih — Admin/HR Workspace", approverEmployeeId: null, approverPositionCode: null };
      }
      const l = await employeeLabel(db, level.approverEmployeeId);
      return { ...base, approverType: "KARYAWAN", approverLabel: l?.label ?? "Karyawan tidak ditemukan — Admin/HR Workspace", approverEmployeeId: l?.approverEmployeeId ?? null, approverPositionCode: null };
    }
    case "HR_ADMIN":
    default:
      return { ...base, approverType: "HR_ADMIN", approverLabel: "Admin/HR Workspace", approverEmployeeId: null, approverPositionCode: null };
  }
}

// ============ pembangunan jalur ============

/**
 * Bangun jalur persetujuan untuk pemohon (tanpa menyimpan). Untuk docType
 * nominal (Travel/Medical/Loan), jenjang difilter terhadap `amount`.
 * Anti-deadlock: hasil selalu ≥ 1 langkah; approver = pemohon di-skip;
 * duplikasi orang yang sama pada jenjang berurutan di-rasionalkan.
 */
export async function buildApprovalChain(
  db: DbOrTx,
  employeeId: string,
  docType: string,
  amount?: number | null,
): Promise<BuiltChain> {
  const params = await getEmployeeApprovalParams(db, employeeId);
  if (!params) throw new Error("Karyawan pemohon tidak ditemukan");

  const structure = await resolveApprovalStructure(db, params, docType);
  const useAmount = isAmountDocType(docType);

  let levels = structure?.levels ?? [];
  if (structure && useAmount && amount != null) {
    levels = levels.filter((l) => {
      const minOk = l.minAmount == null || amount >= l.minAmount;
      const maxOk = l.maxAmount == null || amount <= l.maxAmount;
      return minOk && maxOk;
    });
  } else if (structure && useAmount && amount == null) {
    // nominal belum diketahui — jenjang bersyarat minimal diaktifkan konservatif
    levels = levels.filter((l) => l.minAmount == null);
  }

  let steps: BuiltStep[] = [];
  for (const level of levels) {
    steps.push(await resolveApprover(db, params, level));
  }

  // rationing: skip approver = pemohon & duplikat orang berurutan
  const seen = new Set<string>();
  steps = steps.filter((s) => {
    if (s.approverType === "HR_ADMIN") return true;
    if (s.approverEmployeeId === params.employeeId) return false; // self-approval
    if (s.approverEmployeeId && seen.has(s.approverEmployeeId)) return false;
    if (s.approverEmployeeId) seen.add(s.approverEmployeeId);
    return true;
  });

  // fallback default: tanpa struktur (atau semua jenjang terfilter) → atasan langsung / Admin-HR
  if (steps.length === 0) {
    if (params.managerId) {
      const l = await employeeLabel(db, params.managerId);
      steps = [{
        levelNo: 1, approverType: "ATASAN_LANGSUNG",
        approverLabel: l?.label ?? "Atasan Langsung",
        approverEmployeeId: l?.approverEmployeeId ?? null,
        approverPositionCode: null, minAmount: null, maxAmount: null,
      }];
    } else {
      steps = [{
        levelNo: 1, approverType: "HR_ADMIN",
        approverLabel: "Admin/HR Workspace (default)",
        approverEmployeeId: null, approverPositionCode: null, minAmount: null, maxAmount: null,
      }];
    }
    return { structureId: null, structureCode: null, structureName: null, fallback: true, steps };
  }

  // re-number level setelah filtering
  steps = steps.map((s, i) => ({ ...s, levelNo: i + 1 }));

  return {
    structureId: structure?.id ?? null,
    structureCode: structure?.code ?? null,
    structureName: structure?.name ?? null,
    fallback: !structure,
    steps,
  };
}

// ============ runtime chain ============

/** Buat chain untuk dokumen (idempotent — chain sudah ada dikembalikan apa adanya). */
export async function startApprovalChain(
  db: DbOrTx,
  input: { docType: ApprovalDocType; docId: string; employeeId: string; amount?: number | null; createdBy?: string | null },
): Promise<ChainView> {
  const existing = await getApprovalChain(db, input.docType, input.docId);
  if (existing) return existing;

  const built = await buildApprovalChain(db, input.employeeId, input.docType, input.amount);
  const chain = await db.approvalChain.create({
    data: {
      docType: input.docType,
      docId: input.docId,
      structureId: built.structureId,
      employeeId: input.employeeId,
      amount: input.amount ?? null,
      currentLevel: 1,
      totalLevels: built.steps.length,
      createdBy: input.createdBy ?? null,
      steps: {
        create: built.steps.map((s, i) => ({
          levelNo: s.levelNo,
          approverType: s.approverType,
          approverLabel: s.approverLabel,
          approverEmployeeId: s.approverEmployeeId,
          approverPositionCode: s.approverPositionCode,
          minAmount: s.minAmount,
          maxAmount: s.maxAmount,
          status: i === 0 ? "Current" : "Waiting",
        })),
      },
    },
    include: { steps: { orderBy: { levelNo: "asc" } } },
  });
  return {
    id: chain.id, docType: chain.docType, docId: chain.docId, structureId: chain.structureId,
    status: chain.status, currentLevel: chain.currentLevel, totalLevels: chain.totalLevels, amount: chain.amount,
    steps: chain.steps.map((s) => ({
      levelNo: s.levelNo, approverType: s.approverType, approverLabel: s.approverLabel,
      approverEmployeeId: s.approverEmployeeId, minAmount: s.minAmount, maxAmount: s.maxAmount,
      status: s.status, note: s.note, decidedBy: s.decidedBy, decidedAt: s.decidedAt,
    })),
  };
}

/** Ambil chain lengkap (steps urut) untuk satu dokumen. */
export async function getApprovalChain(db: DbOrTx, docType: string, docId: string): Promise<ChainView | null> {
  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType, docId } },
    include: { steps: { orderBy: { levelNo: "asc" } } },
  });
  if (!chain) return null;
  return {
    id: chain.id,
    docType: chain.docType,
    docId: chain.docId,
    structureId: chain.structureId,
    status: chain.status,
    currentLevel: chain.currentLevel,
    totalLevels: chain.totalLevels,
    amount: chain.amount,
    steps: chain.steps.map((s) => ({
      levelNo: s.levelNo, approverType: s.approverType, approverLabel: s.approverLabel,
      approverEmployeeId: s.approverEmployeeId, minAmount: s.minAmount, maxAmount: s.maxAmount,
      status: s.status, note: s.note, decidedBy: s.decidedBy, decidedAt: s.decidedAt,
    })),
  };
}

/** Otorisasi: siapa boleh memutus jenjang saat ini. */
export function canActorDecideCurrentStep(actor: DecideActor, step: { approverType: string; approverEmployeeId: string | null }): boolean {
  if (["OWNER", "ADMIN", "HR"].includes(actor.role)) return true;
  if (actor.role === "VIEWER") return false;
  if (step.approverType === "HR_ADMIN") return false; // non-admin tidak bisa mewakili Admin/HR
  return !!step.approverEmployeeId && step.approverEmployeeId === actor.employeeId;
}

export interface ChainDecisionResult {
  /** true bila seluruh jenjang selesai (dokumen boleh berstatus Approved). */
  final: boolean;
  chain: ChainView;
}

/**
 * Putuskan jenjang saat ini:
 *  - approve: jenjang aktif → Approved; bila masih ada jenjang berikutnya,
 *    currentLevel maju dan chain tetap InProgress (final=false); jenjang
 *    terakhir → chain Approved (final=true).
 *  - reject / cancel: jenjang aktif → Rejected, chain berhenti.
 * Aksi ditolak bila aktor bukan approver jenjang berjalan (kecuali
 * OWNER/ADMIN/HR).
 */
export async function decideApprovalChain(
  db: DbOrTx,
  input: { docType: ApprovalDocType; docId: string; action: "approve" | "reject" | "cancel"; note?: string; actor: DecideActor },
): Promise<ChainDecisionResult> {
  const chain = await db.approvalChain.findUnique({
    where: { docType_docId: { docType: input.docType, docId: input.docId } },
    include: { steps: { orderBy: { levelNo: "asc" } } },
  });
  if (!chain) throw new Error("Jalur persetujuan tidak ditemukan untuk dokumen ini");
  if (chain.status !== "InProgress") {
    throw new Error(`Jalur persetujuan sudah berstatus ${chain.status}`);
  }

  const currentStep = chain.steps.find((s) => s.levelNo === chain.currentLevel);
  if (!currentStep) throw new Error("Jenjang aktif tidak ditemukan");

  if (!canActorDecideCurrentStep(input.actor, currentStep)) {
    throw new Error(
      `Akses ditolak: keputusan jenjang ${chain.currentLevel} menunggu ${currentStep.approverLabel}` +
      (input.actor.employeeId ? "" : " — akun Anda tidak tertaut ke karyawan approver"),
    );
  }

  const now = new Date();
  const decidedBy = input.actor.name;
  const steps = chain.steps;

  if (input.action === "approve") {
    await db.approvalStep.update({
      where: { id: currentStep.id },
      data: { status: "Approved", note: input.note ?? null, decidedBy, decidedAt: now },
    });
    const next = steps.find((s) => s.levelNo === chain.currentLevel + 1);
    if (next) {
      await db.approvalStep.update({ where: { id: next.id }, data: { status: "Current" } });
      const updated = await db.approvalChain.update({
        where: { id: chain.id },
        data: { currentLevel: next.levelNo },
      });
      return { final: false, chain: toView(updated, steps) };
    }
    const updated = await db.approvalChain.update({
      where: { id: chain.id },
      data: { status: "Approved", completedAt: now },
    });
    return { final: true, chain: toView(updated, steps) };
  }

  // reject / cancel
  const target = input.action === "reject" ? "Rejected" : "Cancelled";
  await db.approvalStep.update({
    where: { id: currentStep.id },
    data: { status: target, note: input.note ?? null, decidedBy, decidedAt: now },
  });
  const updated = await db.approvalChain.update({
    where: { id: chain.id },
    data: { status: target, completedAt: now },
  });
  return { final: true, chain: toView(updated, steps) };
}

/** Hentikan chain tanpa keputusan (dokumen dibatalkan di modul). */
export async function cancelApprovalChain(db: DbOrTx, docType: string, docId: string, by?: string): Promise<void> {
  const chain = await db.approvalChain.findUnique({ where: { docType_docId: { docType, docId } } });
  if (!chain || chain.status !== "InProgress") return;
  await db.approvalChain.update({
    where: { id: chain.id },
    data: { status: "Cancelled", completedAt: new Date() },
  });
}

function toView(
  chain: { id: string; docType: string; docId: string; structureId: string | null; status: string; currentLevel: number; totalLevels: number; amount: number | null },
  rawSteps: {
    id: string; levelNo: number; approverType: string; approverLabel: string; approverEmployeeId: string | null;
    minAmount: number | null; maxAmount: number | null; status: string; note: string | null; decidedBy: string | null; decidedAt: Date | null;
  }[],
): ChainView {
  return {
    id: chain.id, docType: chain.docType, docId: chain.docId, structureId: chain.structureId,
    status: chain.status, currentLevel: chain.currentLevel, totalLevels: chain.totalLevels, amount: chain.amount,
    steps: rawSteps.map((s) => ({
      levelNo: s.levelNo, approverType: s.approverType, approverLabel: s.approverLabel,
      approverEmployeeId: s.approverEmployeeId, minAmount: s.minAmount, maxAmount: s.maxAmount,
      status: s.status, note: s.note, decidedBy: s.decidedBy, decidedAt: s.decidedAt,
    })),
  };
}

// ============ ringkasan untuk list ============

/** Ringkas chain untuk daftar dokumen (1 query batch). */
export async function attachChainSummaries<T extends { id: string }>(
  db: TenantDb,
  docType: string,
  rows: T[],
): Promise<Map<string, ChainSummary>> {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, ChainSummary>();
  if (ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const chains = await db.approvalChain.findMany({
      where: { docType, docId: { in: batch } },
      include: { steps: { where: { status: "Current" }, take: 1 } },
    });
    for (const c of chains) {
      out.set(c.docId, {
        status: c.status,
        currentLevel: c.currentLevel,
        totalLevels: c.totalLevels,
        currentApprover: c.steps[0]?.approverLabel ?? null,
      });
    }
  }
  return out;
}
