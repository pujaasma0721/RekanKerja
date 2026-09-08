// OneVity Benefit Service (P5) — engine limit klaim + lifecycle persetujuan +
// integrasi pay-in-payroll (klaim Scheduled → komponen Specific run BENEFIT).
// Pola "Employee Benefit": BenefitType (limit/reset/auto-approve) +
// BenefitClaim dengan snapshot audit limit saat pengajuan.
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";

// Status klaim yang mengonsumsi limit (Pending dihitung terpisah saat approval).
const CONSUMING = ["Approved", "Scheduled", "Paid"] as const;

export interface LimitSnapshot {
  used: number;          // pemakaian pada siklus window (sebelum klaim baru)
  limit: number | null;  // null = unlimited
  remaining: number | null;
  inLimit: boolean;
  windowLabel: string;   // deskripsi siklus utk pesan/UI
}

// Jendela siklus reset menurut resetPeriod & tanggal klaim.
export function resetWindow(resetPeriod: string, claimDate: Date): { start: Date; end: Date; label: string } {
  const y = claimDate.getFullYear();
  const m = claimDate.getMonth();
  switch (resetPeriod) {
    case "Monthly": {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      return { start, end, label: `bulanan ${start.toLocaleDateString("id-ID", { month: "long", year: "numeric" }) }` };
    }
    case "Quarterly": {
      const q = Math.floor(m / 3);
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 0, 23, 59, 59);
      return { start, end, label: `kuartalan Q${q + 1} ${y}` };
    }
    case "Yearly": {
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31, 23, 59, 59);
      return { start, end, label: `tahunan ${y}` };
    }
    default:
      return { start: new Date(0), end: new Date("9999-12-31T23:59:59.999Z"), label: "sekali seumur pakai" };
  }
}

// Snapshot limit utk karyawan×jenis pada tanggal klaim.
export async function limitSnapshot(
  db: TenantDb,
  type: { id: string; resetPeriod: string; maxClaimAmount: number; unlimited: boolean },
  employeeId: string,
  claimDate: Date,
  extraAmount = 0,
): Promise<LimitSnapshot> {
  if (type.unlimited || type.maxClaimAmount <= 0) {
    return { used: 0, limit: null, remaining: null, inLimit: true, windowLabel: "tanpa limit" };
  }
  const w = resetWindow(type.resetPeriod, claimDate);
  const rows = await db.benefitClaim.findMany({
    where: {
      benefitTypeId: type.id,
      employeeId,
      status: { in: [...CONSUMING] },
      claimDate: { gte: w.start, lte: w.end },
    },
    select: { amount: true },
  });
  const used = rows.reduce((s, r) => s + r.amount, 0);
  const remaining = Math.max(0, type.maxClaimAmount - used);
  const inLimit = used + extraAmount <= type.maxClaimAmount;
  return { used, limit: type.maxClaimAmount, remaining, inLimit, windowLabel: w.label };
}

// Kelayakan karyawan menurut entitleFor (status kepegawaian penempatan aktif).
export async function checkEntitlement(db: TenantDb, entitleFor: string, employeeId: string): Promise<boolean> {
  if (entitleFor === "All") return true;
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    include: { assignments: { where: { validTo: null }, select: { employmentStatus: true }, take: 1 } },
  });
  if (!emp) return false;
  return emp.assignments[0]?.employmentStatus === entitleFor;
}

export async function nextClaimNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `BC-${year}-`;
  const count = await db.benefitClaim.count({ where: { claimNo: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(3, "0")}`;
}

const CLAIM_INCLUDE = {
  benefitType: { select: { id: true, code: true, name: true, category: true, resetPeriod: true, maxClaimAmount: true, unlimited: true, allowOverlimit: true, autoApproveInLimit: true, payInPayroll: true, needDocuments: true, wageComponentId: true } },
  employee: { select: { employeeNo: true, fullName: true } },
  period: { select: { code: true, name: true, status: true } },
} as const;

// Sinkronkan komponen Specific (employee × period × processType BENEFIT) agar
// selalu = total klaim Scheduled — idempotent, dipanggil saat schedule/cancel.
export async function syncClaimComponent(
  db: TenantDb,
  employeeId: string,
  wageComponentId: string,
  periodId: string,
  benefitTypeId: string,
): Promise<void> {
  const benefitType = await db.benefitType.findUnique({ where: { id: benefitTypeId } });
  if (!benefitType?.wageComponentId || !benefitType.payInPayroll) return;
  const pt = await db.processType.findFirst({ where: { code: "BENEFIT" } });
  if (!pt) return;

  const scheduled = await db.benefitClaim.findMany({
    where: { employeeId, benefitTypeId, status: "Scheduled", periodId },
    select: { claimNo: true, amount: true },
    orderBy: { claimNo: "asc" },
  });
  const total = scheduled.reduce((s, c) => s + c.amount, 0);
  const notes = scheduled.map((c) => c.claimNo).join(", ");

  const existing = await db.employeeComponentAssignment.findFirst({
    where: {
      employeeId,
      wageComponentId: benefitType.wageComponentId,
      kind: "Specific",
      periodId,
      processTypeId: pt.id,
      active: true,
    },
  });
  if (existing) {
    if (total > 0) {
      await db.employeeComponentAssignment.update({
        where: { id: existing.id },
        // 28-c: nilai komponen disimpan TERENKRIPSI (enc:v1:n:…).
        data: { amount: tenantCryptoForDb(db).encryptMoney(total), notes: notes || "Klaim benefit" },
      });
    } else {
      await db.employeeComponentAssignment.delete({ where: { id: existing.id } });
    }
  } else if (total > 0) {
    await db.employeeComponentAssignment.create({
      data: {
        employeeId,
        wageComponentId: benefitType.wageComponentId,
        kind: "Specific",
        amount: tenantCryptoForDb(db).encryptMoney(total),
        periodId,
        processTypeId: pt.id,
        basedDate: new Date(),
        notes: notes || "Klaim benefit",
        active: true,
      },
    });
  }
}

// Ajukan klaim: validasi → snapshot limit → auto-approve bila dalam limit.
export async function submitClaim(db: TenantDb, input: {
  employeeId: string; benefitTypeId: string; amount: number; claimDate?: string;
  description?: string | null; documentsNote?: string | null;
}): Promise<{ claim: unknown; autoApproved: boolean; note: string }> {
  const { employeeId, benefitTypeId } = input;
  const amount = Number(input.amount);
  if (!employeeId || !benefitTypeId || !amount || amount <= 0) {
    throw new Error("Karyawan, jenis benefit & nilai klaim (lebih dari 0) wajib diisi");
  }
  const type = await db.benefitType.findUnique({ where: { id: benefitTypeId } });
  if (!type || !type.active) throw new Error("Jenis benefit tidak ditemukan / tidak aktif");
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");

  const claimDate = input.claimDate ? new Date(input.claimDate) : new Date();
  if (type.validFrom > claimDate) throw new Error(`Jenis benefit berlaku mulai ${type.validFrom.toLocaleDateString("id-ID")}`);
  if (type.validTo && type.validTo < claimDate) throw new Error("Jenis benefit sudah kedaluwarsa");

  if (!(await checkEntitlement(db, type.entitleFor, employeeId))) {
    throw new Error(`Benefit ini hanya utk status kepegawaian ${type.entitleFor}`);
  }
  if (type.needDocuments && !input.documentsNote?.trim()) {
    throw new Error("Jenis benefit ini mewajibkan keterangan dokumen pendukung");
  }

  const snap = await limitSnapshot(db, type, employeeId, claimDate, amount);
  if (!snap.inLimit && !type.allowOverlimit) {
    throw new Error(
      `Klaim ${fmt(amount)} melebihi limit ${snap.windowLabel} — terpakai ${fmt(snap.used)} dari ${fmt(snap.limit ?? 0)} (sisa ${fmt(snap.remaining ?? 0)})`,
    );
  }

  const autoApproved = type.autoApproveInLimit && snap.inLimit;
  const claimNo = await nextClaimNo(db);
  const claim = await db.benefitClaim.create({
    data: {
      claimNo,
      benefitTypeId,
      employeeId,
      claimDate,
      amount,
      approvedAmount: autoApproved ? amount : 0,
      description: input.description?.trim() || null,
      documentsNote: input.documentsNote?.trim() || null,
      status: autoApproved ? "Approved" : "Pending",
      limitUsed: snap.used,
      limitRemaining: snap.remaining ?? 0,
      inLimit: snap.inLimit,
      approvedBy: autoApproved ? "Sistem (auto-approve dalam limit)" : null,
      approvedAt: autoApproved ? new Date() : null,
    },
    include: CLAIM_INCLUDE,
  });

  const note = autoApproved
    ? `Klaim ${claimNo} otomatis disetujui (dalam limit ${snap.windowLabel}, sisa ${fmt(snap.remaining ?? 0)})`
    : snap.inLimit
      ? `Klaim ${claimNo} diajukan — menunggu persetujuan`
      : `Klaim ${claimNo} melebihi limit (overlimit diizinkan) — menunggu persetujuan manual`;
  return { claim, autoApproved, note };
}

export async function approveClaim(db: TenantDb, id: string, approvedBy?: string): Promise<unknown> {
  const claim = await db.benefitClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.status !== "Pending") throw new Error("Hanya klaim berstatus Pending yang dapat disetujui");

  // Re-check limit terhadap klaim lain yang mungkin sudah disetujui sejak pengajuan.
  const type = await db.benefitType.findUnique({ where: { id: claim.benefitTypeId } });
  if (!type) throw new Error("Jenis benefit tidak ditemukan");
  if (!type.unlimited && type.maxClaimAmount > 0) {
    const w = resetWindow(type.resetPeriod, claim.claimDate);
    const others = await db.benefitClaim.findMany({
      where: {
        benefitTypeId: type.id, employeeId: claim.employeeId,
        status: { in: [...CONSUMING] }, id: { not: claim.id },
        claimDate: { gte: w.start, lte: w.end },
      },
      select: { amount: true },
    });
    const used = others.reduce((s, c) => s + c.amount, 0);
    if (used + claim.amount > type.maxClaimAmount && !type.allowOverlimit) {
      throw new Error(`Tidak dapat disetujui: total ${fmt(used + claim.amount)} melebihi limit ${fmt(type.maxClaimAmount)} (${w.label}) & overlimit tidak diizinkan`);
    }
  }
  const updated = await db.benefitClaim.update({
    where: { id },
    data: {
      status: "Approved", approvedAmount: claim.amount,
      approvedBy: approvedBy?.trim() || "Admin Payroll", approvedAt: new Date(),
    },
    include: CLAIM_INCLUDE,
  });
  return updated;
}

export async function rejectClaim(db: TenantDb, id: string, reason: string): Promise<unknown> {
  const claim = await db.benefitClaim.findUnique({ where: { id } });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.status !== "Pending") throw new Error("Hanya klaim berstatus Pending yang dapat ditolak");
  if (!reason.trim()) throw new Error("Alasan penolakan wajib diisi");
  const updated = await db.benefitClaim.update({
    where: { id },
    data: { status: "Rejected", rejectedReason: reason.trim() },
    include: CLAIM_INCLUDE,
  });
  return updated;
}

// Jadwalkan klaim Approved ke period payroll (pay-in-payroll).
export async function scheduleClaim(db: TenantDb, id: string, periodId: string): Promise<unknown> {
  const claim = await db.benefitClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.status !== "Approved") throw new Error("Hanya klaim Approved yang dapat dijadwalkan");
  const type = await db.benefitType.findUnique({ where: { id: claim.benefitTypeId } });
  if (!type) throw new Error("Jenis benefit tidak ditemukan");
  if (!type.payInPayroll) throw new Error("Jenis benefit ini dibayar langsung dari kas (bukan via payroll)");
  if (!type.wageComponentId) throw new Error("Jenis benefit belum memetakan komponen upah (payslip)");
  const period = await db.payrollPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");
  if (period.status === "Locked" || period.status === "Closed") throw new Error("Period sudah ditutup/terkunci");

  const updated = await db.benefitClaim.update({
    where: { id },
    data: { status: "Scheduled", periodId },
    include: CLAIM_INCLUDE,
  });
  await syncClaimComponent(db, claim.employeeId, type.wageComponentId, periodId, type.id);
  return updated;
}

// Klaim Approved jenis non-payroll → tandai lunas dari kas.
export async function markClaimPaidCash(db: TenantDb, id: string): Promise<unknown> {
  const claim = await db.benefitClaim.findUnique({ where: { id }, include: CLAIM_INCLUDE });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.status !== "Approved") throw new Error("Hanya klaim Approved yang dapat ditandai lunas");
  const type = await db.benefitType.findUnique({ where: { id: claim.benefitTypeId } });
  if (!type) throw new Error("Jenis benefit tidak ditemukan");
  if (type.payInPayroll) throw new Error("Jenis benefit ini dibayar via payroll — jadwalkan ke period");
  const updated = await db.benefitClaim.update({
    where: { id },
    data: { status: "Paid", paidRunNo: null },
    include: CLAIM_INCLUDE,
  });
  return updated;
}

export async function cancelClaim(db: TenantDb, id: string): Promise<unknown> {
  const claim = await db.benefitClaim.findUnique({ where: { id } });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (!["Pending", "Approved", "Scheduled"].includes(claim.status)) {
    throw new Error("Klaim yang sudah dibayar/ditolak tidak dapat dibatalkan");
  }
  const periodId = claim.status === "Scheduled" ? claim.periodId : null;
  const updated = await db.benefitClaim.update({
    where: { id },
    data: { status: "Cancelled", periodId: null },
    include: CLAIM_INCLUDE,
  });
  if (periodId) {
    const type = await db.benefitType.findUnique({ where: { id: claim.benefitTypeId } });
    if (type?.wageComponentId) {
      await syncClaimComponent(db, claim.employeeId, type.wageComponentId, periodId, type.id);
    }
  }
  return updated;
}

// Dipanggil confirmRun() saat run BENEFIT dikonfirmasi: klaim Scheduled pada
// period run → Paid + paidRunNo (komponen Specific ikut terkunci di snapshot).
export async function markClaimsPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run || run.processType.code !== "BENEFIT") return 0;
  const res = await db.benefitClaim.updateMany({
    where: { periodId: run.periodId, status: "Scheduled" },
    data: { status: "Paid", paidRunNo: run.runNo },
  });
  if (res.count > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "BenefitClaim", entityId: runId,
        detail: `${res.count} klaim benefit ditandai Dibayar via run ${run.runNo} (${run.period.name})`,
      },
    });
  }
  return res.count;
}

function fmt(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}
