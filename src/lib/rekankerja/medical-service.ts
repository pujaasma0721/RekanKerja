// RekanKerja Medical Service (ref: ANALISA-MEDICAL.md — modul Medical Benefit oranHR).
// Alur: master jenis benefit (limit UNLIMITED/NOMINAL/FACTOR×gaji) → Generate saldo
// per tahun (padanan Generate Employee Medical Information) → klaim medis (baris
// perawatan: treated/diagnosa/kwitansi/dokter/RS + bill/reimburse/approved/nonRe) →
// approval (Submit→Approved→Settled; Reject/Cancel) → Settle = jurnal otomatis +
// saldo used bertambah → penyesuaian ± (Medical Adjustment + approval) → sisa saldo
// jenis CASH ditarik ke payroll (komponen UMC) → Paid saat run dikonfirmasi.
import { TenantDb } from "./tenant-db";

// ============ util ============

const round2 = (n: number) => Math.round(n * 100) / 100;

const dayStart = (d: Date | string) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

/** Nomor dokumen per prefix (MC/MA) — max-suffix per model. */
async function nextDocNo(db: TenantDb, prefix: "MC" | "MA"): Promise<string> {
  const year = new Date().getFullYear();
  const start = `${prefix}-${year}-`;
  const rows = prefix === "MC"
    ? await db.medicalClaim.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } })
    : await db.medicalAdjustment.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

async function nextJournalNo(db: TenantDb): Promise<string> {
  const rows = await db.payrollJournal.findMany({ where: { journalNo: { startsWith: "JV-" } }, select: { journalNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.journalNo.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `JV-${String(max + 1).padStart(4, "0")}`;
}

async function activeSalary(db: TenantDb, employeeId: string): Promise<number> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } },
  });
  return emp?.assignments[0]?.baseSalary ?? 0;
}

const MEDICAL_EXPENSE_ACC = { code: "5106", name: "Beban Kesejahteraan Medis" };
const CASH_ACC = { code: "1101", name: "Kas & Bank" };

interface StatusEntry {
  state: string;
  at: string; // ISO
  by: string;
  note?: string;
}

function logEntry(state: string, by: string, note?: string): StatusEntry {
  return { state, at: new Date().toISOString(), by, note: note || undefined };
}

// ============ master: jenis benefit (padanan MedicalBenefitTypeDetail.jsp) ============

export interface BenefitTypeRow {
  id: string; code: string; name: string; description: string | null; active: boolean;
  needReceipt: boolean;
  limitRule: string; limitValue: number; wageCode: string | null;
  freqUnlimited: boolean; freqValue: number; freqPeriod: string;
  pctCompany: number; pctInsurance: number; insuranceCompany: string | null;
  unusedRule: string; cashWageCode: string | null; maxCarryOver: number;
  dependentEnabled: boolean; maxDependents: number; maxChildAge: number; depLimitRule: string;
  balanceCount: number; claimCount: number;
}

export async function listBenefitTypes(db: TenantDb): Promise<BenefitTypeRow[]> {
  const rows = await db.medicalBenefitType.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { balances: true, claims: true } } },
  });
  return rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, description: t.description, active: t.active,
    needReceipt: t.needReceipt,
    limitRule: t.limitRule, limitValue: t.limitValue, wageCode: t.wageCode,
    freqUnlimited: t.freqUnlimited, freqValue: t.freqValue, freqPeriod: t.freqPeriod,
    pctCompany: t.pctCompany, pctInsurance: t.pctInsurance, insuranceCompany: t.insuranceCompany,
    unusedRule: t.unusedRule, cashWageCode: t.cashWageCode, maxCarryOver: t.maxCarryOver,
    dependentEnabled: t.dependentEnabled, maxDependents: t.maxDependents, maxChildAge: t.maxChildAge,
    depLimitRule: t.depLimitRule,
    balanceCount: t._count.balances, claimCount: t._count.claims,
  }));
}

export interface UpsertTypeInput {
  id?: string;
  code: string;
  name: string;
  description?: string;
  needReceipt?: boolean;
  limitRule: string; // UNLIMITED|NOMINAL|FACTOR|WAGE_COMPONENT
  limitValue?: number;
  wageCode?: string;
  freqUnlimited?: boolean;
  freqValue?: number;
  freqPeriod?: string;
  pctCompany?: number;
  pctInsurance?: number;
  insuranceCompany?: string;
  unusedRule?: string;
  cashWageCode?: string;
  maxCarryOver?: number;
  dependentEnabled?: boolean;
  maxDependents?: number;
  maxChildAge?: number;
  depLimitRule?: string;
  active?: boolean;
}

export async function upsertBenefitType(db: TenantDb, input: UpsertTypeInput): Promise<string> {
  const rule = input.limitRule;
  if (!["UNLIMITED", "NOMINAL", "FACTOR", "WAGE_COMPONENT"].includes(rule)) {
    throw new Error("Aturan limit tidak valid");
  }
  if (rule === "NOMINAL" && !(input.limitValue && input.limitValue > 0)) {
    throw new Error("Limit nominal harus > 0");
  }
  if (rule === "FACTOR" && !(input.limitValue && input.limitValue > 0)) {
    throw new Error("Faktor gaji harus > 0");
  }
  const data = {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    needReceipt: input.needReceipt ?? true,
    limitRule: rule,
    limitValue: rule === "UNLIMITED" ? 0 : (input.limitValue ?? 0),
    wageCode: input.wageCode?.trim() || null,
    freqUnlimited: input.freqUnlimited ?? false,
    freqValue: Math.max(0, Math.round(input.freqValue ?? 0)),
    freqPeriod: input.freqPeriod ?? "YEAR",
    pctCompany: Math.min(100, Math.max(0, Math.round(input.pctCompany ?? 100))),
    pctInsurance: Math.min(100, Math.max(0, Math.round(input.pctInsurance ?? 0))),
    insuranceCompany: input.insuranceCompany?.trim() || null,
    unusedRule: input.unusedRule ?? "FORFEITED",
    cashWageCode: input.cashWageCode?.trim() || null,
    maxCarryOver: Math.max(0, input.maxCarryOver ?? 0),
    dependentEnabled: input.dependentEnabled ?? true,
    maxDependents: Math.max(0, Math.round(input.maxDependents ?? 2)),
    maxChildAge: Math.max(0, Math.round(input.maxChildAge ?? 21)),
    depLimitRule: input.depLimitRule ?? "SHARED",
    active: input.active ?? true,
  };
  if (input.id) {
    await db.medicalBenefitType.update({ where: { id: input.id }, data });
    return input.id;
  }
  const t = await db.medicalBenefitType.create({
    data: { ...data, code: input.code.trim().toUpperCase().replace(/\s+/g, "_") },
  });
  return t.id;
}

// ============ master: rumah sakit & asuransi (Hospital + InsuranceCompany) ============

export async function listProviders(db: TenantDb) {
  return db.medicalProvider.findMany({
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
}

export async function upsertProvider(
  db: TenantDb,
  input: { id?: string; code: string; name: string; kind: string; city?: string; address?: string; phone?: string; active?: boolean },
): Promise<string> {
  if (input.id) {
    await db.medicalProvider.update({
      where: { id: input.id },
      data: {
        name: input.name.trim(), kind: input.kind,
        city: input.city?.trim() || null, address: input.address?.trim() || null,
        phone: input.phone?.trim() || null, active: input.active ?? true,
      },
    });
    return input.id;
  }
  const p = await db.medicalProvider.create({
    data: {
      code: input.code.trim().toUpperCase().replace(/\s+/g, "-"),
      name: input.name.trim(), kind: input.kind,
      city: input.city?.trim() || null, address: input.address?.trim() || null,
      phone: input.phone?.trim() || null, active: input.active ?? true,
    },
  });
  return p.id;
}

// ============ saldo (padanan Employee Medical Information + Generate) ============

/** Limit benefit karyawan dari kebijakan jenis + gaji aktif. */
export function benefitLimitFor(
  t: { limitRule: string; limitValue: number },
  baseSalary: number,
): number {
  switch (t.limitRule) {
    case "UNLIMITED": return Number.MAX_SAFE_INTEGER / 1000; // tampil sebagai "∞" di UI
    case "FACTOR": return round2(t.limitValue * baseSalary);
    case "WAGE_COMPONENT": return round2(baseSalary); // fallback: gaji pokok
    default: return round2(t.limitValue);
  }
}

export interface GenerateResult {
  year: number;
  employees: number;
  created: number;
  updated: number;
  limitCorrection: boolean;
}

/** Generate saldo medis per tahun — padanan GenerateMedicalBenefitInfo.jsp:
 *  period + (semua jenis / jenis tertentu) + Benefit Limit Correction (true =
 *  benefitAmount boleh ditulis ulang; false = hanya isi jika kosong). */
export async function generateBalances(
  db: TenantDb,
  input: { year: number; typeId?: string; limitCorrection?: boolean; employeeIds?: string[] },
): Promise<GenerateResult> {
  const year = Math.round(input.year);
  if (year < 2000 || year > 2100) throw new Error("Tahun tidak valid");

  const types = await db.medicalBenefitType.findMany({
    where: { active: true, ...(input.typeId ? { id: input.typeId } : {}) },
  });
  if (types.length === 0) throw new Error("Tidak ada jenis benefit aktif");

  const employees = await db.employee.findMany({
    where: {
      status: "Active",
      ...(input.employeeIds?.length ? { id: { in: input.employeeIds } } : {}),
    },
    select: { id: true, assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } },
  });
  if (employees.length === 0) throw new Error("Tidak ada karyawan aktif");

  const prevBalances = await db.medicalBalance.findMany({ where: { year: year - 1 } });
  const prevByKey = new Map(prevBalances.map((b) => [`${b.employeeId}:${b.typeId}`, b]));

  let created = 0;
  let updated = 0;
  for (const emp of employees) {
    const salary = emp.assignments[0]?.baseSalary ?? 0;
    for (const t of types) {
      const limit = benefitLimitFor(t, salary);
      const prev = prevByKey.get(`${emp.id}:${t.id}`);
      // carry-over: kebijakan CARRY → sisa tahun lalu (max maxCarryOver) dibawa
      const carried = t.unusedRule === "CARRY" && prev
        ? Math.min(
            Math.max(
              round2(
                prev.benefitAmount + prev.adjustmentAmount + prev.carriedOver
                - prev.usedAmount - prev.initialUsed,
              ),
              0,
            ),
            t.maxCarryOver,
          )
        : 0;
      // initialUsed: sisa tahun lalu (padanan Initial Medical Benefit — saldo dibawa)
      const initialUsed = prev && t.unusedRule === "FORFEITED" ? 0 : prev ? prev.usedAmount : 0;
      const depBenefit =
        t.dependentEnabled && t.depLimitRule !== "SHARED" ? limit : 0;

      const existing = await db.medicalBalance.findUnique({
        where: { employeeId_typeId_year: { employeeId: emp.id, typeId: t.id, year } },
      });
      if (!existing) {
        await db.medicalBalance.create({
          data: {
            employeeId: emp.id, typeId: t.id, year,
            benefitAmount: limit, depBenefitAmount: depBenefit,
            carriedOver: carried, initialUsed,
          },
        });
        created++;
      } else if (input.limitCorrection) {
        await db.medicalBalance.update({
          where: { id: existing.id },
          data: { benefitAmount: limit, depBenefitAmount: depBenefit },
        });
        updated++;
      }
    }
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MedicalBalance", entityId: String(year),
      detail: `Generate saldo medis ${year}: ${created} baru, ${updated} dikoreksi, ${employees.length} karyawan × ${types.length} jenis`,
    },
  });
  return { year, employees: employees.length, created, updated, limitCorrection: Boolean(input.limitCorrection) };
}

export interface BalanceRow {
  id: string;
  employeeId: string;
  employeeNo: string;
  fullName: string;
  orgUnitName: string | null;
  baseSalary: number;
  typeCode: string;
  typeName: string;
  year: number;
  limitRule: string;
  benefitAmount: number;
  adjustmentAmount: number;
  carriedOver: number;
  initialUsed: number;
  usedAmount: number;
  remaining: number;
  depBenefitAmount: number;
  depAdjustment: number;
  depUsed: number;
  depRemaining: number;
  totalRemaining: number;
  claimCount: number;
}

export async function listBalances(
  db: TenantDb,
  input: { year: number; employeeId?: string; typeId?: string },
): Promise<BalanceRow[]> {
  const rows = await db.medicalBalance.findMany({
    where: {
      year: input.year,
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      ...(input.typeId ? { typeId: input.typeId } : {}),
    },
    include: {
      employee: {
        select: {
          employeeNo: true, fullName: true,
          assignments: { where: { validTo: null }, select: { baseSalary: true, orgUnit: { select: { name: true } } }, take: 1 },
        },
      },
      type: { select: { code: true, name: true, limitRule: true } },
    },
    orderBy: [{ employee: { employeeNo: "asc" } }, { type: { sortOrder: "asc" } }],
    take: 1500,
  });
  // jenis UNLIMITED tidak masuk agregat nominal (menampilkan ∞ per baris)
  return rows.filter((b) => b.type.limitRule !== "UNLIMITED").map((b) => {
    const remaining = round2(
      b.benefitAmount + b.adjustmentAmount + b.carriedOver - b.usedAmount - b.initialUsed,
    );
    const depRemaining = round2(b.depBenefitAmount + b.depAdjustment - b.depUsed);
    return {
      id: b.id, employeeId: b.employeeId, employeeNo: b.employee.employeeNo,
      fullName: b.employee.fullName,
      orgUnitName: b.employee.assignments[0]?.orgUnit?.name ?? null,
      baseSalary: b.employee.assignments[0]?.baseSalary ?? 0,
      typeCode: b.type.code, typeName: b.type.name, year: b.year, limitRule: b.type.limitRule,
      benefitAmount: b.benefitAmount, adjustmentAmount: b.adjustmentAmount,
      carriedOver: b.carriedOver, initialUsed: b.initialUsed, usedAmount: b.usedAmount,
      remaining,
      depBenefitAmount: b.depBenefitAmount, depAdjustment: b.depAdjustment,
      depUsed: b.depUsed, depRemaining,
      totalRemaining: round2(remaining + (b.type.limitRule !== "" ? depRemaining : 0)),
      claimCount: 0,
    };
  });
}

// ============ klaim (padanan MedicalBenefitClaim.jsp) ============

export interface ClaimLineInput {
  treatedName: string;
  treatment?: string;
  treatmentDate?: string;
  receiptNo?: string;
  physician?: string;
  hospital?: string;
  note?: string;
  occupationalInjury?: boolean;
  billAmount: number;
  reimburseAmount: number;
  approvedAmount: number;
}

export interface SubmitClaimInput {
  employeeId: string;
  typeId: string;
  claimDate: string;
  letterNo?: string;
  forDependent?: boolean;
  lines: ClaimLineInput[];
  note?: string;
  submit?: boolean; // true = langsung Submitted (padanan ESS); false = Draft
}

export interface ClaimPreview {
  employeeNo: string;
  fullName: string;
  baseSalary: number;
  typeName: string;
  typeCode: string;
  limitRule: string;
  benefitAmount: number;
  adjustmentAmount: number;
  carriedOver: number;
  initialUsed: number;
  usedAmount: number;
  remaining: number;
  claimCountYear: number;
  freqUnlimited: boolean;
  freqValue: number;
  freqPeriod: string;
  needReceipt: boolean;
  dependentEnabled: boolean;
  providers: { id: string; name: string; kind: string }[];
}

export async function previewClaim(
  db: TenantDb,
  input: { employeeId: string; typeId: string; year: number },
): Promise<ClaimPreview> {
  const emp = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: {
      employeeNo: true, fullName: true, status: true,
      assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 },
    },
  });
  if (!emp) throw new Error("Karyawan tidak ditemukan");
  if (emp.status !== "Active") throw new Error("Karyawan tidak aktif");
  const t = await db.medicalBenefitType.findUnique({ where: { id: input.typeId } });
  if (!t || !t.active) throw new Error("Jenis benefit tidak aktif");

  const bal = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: input.employeeId, typeId: input.typeId, year: input.year } },
  });
  const salary = emp.assignments[0]?.baseSalary ?? 0;
  const limit = bal?.benefitAmount ?? benefitLimitFor(t, salary);
  const used = (bal?.usedAmount ?? 0) + (bal?.initialUsed ?? 0);
  const claimCountYear = await db.medicalClaim.count({
    where: {
      employeeId: input.employeeId, typeId: input.typeId, year: input.year,
      state: { in: ["Submitted", "Approved", "Settled"] },
    },
  });
  const providers = await db.medicalProvider.findMany({
    where: { active: true }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" }, take: 200,
  });
  return {
    employeeNo: emp.employeeNo, fullName: emp.fullName, baseSalary: salary,
    typeName: t.name, typeCode: t.code, limitRule: t.limitRule,
    benefitAmount: limit,
    adjustmentAmount: bal?.adjustmentAmount ?? 0,
    carriedOver: bal?.carriedOver ?? 0,
    initialUsed: bal?.initialUsed ?? 0,
    usedAmount: used,
    remaining: round2(limit + (bal?.adjustmentAmount ?? 0) + (bal?.carriedOver ?? 0) - used),
    claimCountYear,
    freqUnlimited: t.freqUnlimited, freqValue: t.freqValue, freqPeriod: t.freqPeriod,
    needReceipt: t.needReceipt, dependentEnabled: t.dependentEnabled,
    providers,
  };
}

export interface SubmitClaimResult {
  id: string;
  docNo: string;
  state: string;
  totalBill: number;
  totalReimburse: number;
  totalApproved: number;
  totalNonRe: number;
  remainingAfter: number;
}

export async function submitClaim(db: TenantDb, input: SubmitClaimInput, actorId: string): Promise<SubmitClaimResult> {
  const preview = await previewClaim(db, { employeeId: input.employeeId, typeId: input.typeId, year: new Date(input.claimDate).getFullYear() });
  if (input.lines.length === 0) throw new Error("Minimal satu baris perawatan");

  // validasi frekuensi (padanan Max Claim in X period)
  if (!preview.freqUnlimited && preview.freqValue > 0 && preview.claimCountYear >= preview.freqValue) {
    throw new Error(
      `Frekuensi klaim ${preview.typeCode} maksimal ${preview.freqValue}× per ${preview.freqPeriod === "YEAR" ? "tahun" : "period"} — sudah ${preview.claimCountYear} klaim`,
    );
  }

  const bal = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: input.employeeId, typeId: input.typeId, year: new Date(input.claimDate).getFullYear() } },
  });
  const remaining = preview.remaining;

  let totalBill = 0;
  let totalRe = 0;
  let totalApproved = 0;
  const lines: {
    treatedName: string; treatment: string | null; treatmentDate: Date | null;
    receiptNo: string | null; physician: string | null; hospital: string | null; note: string | null;
    occupationalInjury: boolean; billAmount: number; reimburseAmount: number;
    approvedAmount: number; nonReAmount: number;
  }[] = [];

  for (const l of input.lines) {
    if (!l.treatedName.trim()) throw new Error("Nama yang dirawat wajib diisi");
    if (l.billAmount < 0 || l.approvedAmount < 0) throw new Error("Jumlah tidak boleh negatif");
    if (l.approvedAmount > l.billAmount) throw new Error("Approved tidak boleh melebihi tagihan");
    const nonRe = round2(l.billAmount - l.approvedAmount);
    totalBill = round2(totalBill + l.billAmount);
    totalRe = round2(totalRe + l.reimburseAmount);
    totalApproved = round2(totalApproved + l.approvedAmount);
    lines.push({
      treatedName: l.treatedName.trim(),
      treatment: l.treatment?.trim() || null,
      treatmentDate: l.treatmentDate ? dayStart(l.treatmentDate) : null,
      receiptNo: l.receiptNo?.trim() || null,
      physician: l.physician?.trim() || null,
      hospital: l.hospital?.trim() || null,
      note: l.note?.trim() || null,
      occupationalInjury: Boolean(l.occupationalInjury),
      billAmount: round2(l.billAmount),
      reimburseAmount: round2(l.reimburseAmount),
      approvedAmount: round2(l.approvedAmount),
      nonReAmount: nonRe,
    });
  }

  // validasi saldo — over-limit hanya warning (soft limit, konsisten oranHR: klaim boleh > saldo)
  if (totalApproved > remaining) {
    // oranHR memungkinkan klaim over-limit; kita tolak bila melebihi 2× sisa (guard rail)
    if (totalApproved > remaining * 2) {
      throw new Error(
        `Total approved ${totalApproved.toLocaleString("id-ID")} melebihi batas wajar (2× sisa ${remaining.toLocaleString("id-ID")})`,
      );
    }
  }

  const docNo = await nextDocNo(db, "MC");
  const year = new Date(input.claimDate).getFullYear();
  const state = input.submit === false ? "Draft" : "Submitted";
  const log = [logEntry("Draft", actorId, "Dibuat"), ...(state === "Submitted" ? [logEntry("Submitted", actorId, input.note || "Diajukan")] : [])];

  const claim = await db.medicalClaim.create({
    data: {
      docNo, employeeId: input.employeeId, typeId: input.typeId, year,
      claimDate: dayStart(input.claimDate),
      letterNo: input.letterNo?.trim() || null,
      forDependent: Boolean(input.forDependent),
      state,
      maxBenefitAt: preview.benefitAmount,
      usedAt: preview.usedAmount,
      totalBill, totalReimburse: totalRe, totalApproved, totalNonRe: round2(totalBill - totalApproved),
      statusLog: JSON.stringify(log),
      lines: { create: lines },
    },
  });

  await db.activityLog.create({
    data: {
      action: "Created", entity: "MedicalClaim", entityId: claim.id,
      detail: `Klaim medis ${docNo} — ${preview.fullName} (${preview.typeCode}): approved ${totalApproved.toLocaleString("id-ID")}`,
    },
  });
  return {
    id: claim.id, docNo, state,
    totalBill, totalReimburse: totalRe, totalApproved,
    totalNonRe: round2(totalBill - totalApproved),
    remainingAfter: remaining,
  };
}

export interface ClaimRow {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null;
  typeCode: string; typeName: string; year: number;
  claimDate: Date; letterNo: string | null; state: string; forDependent: boolean;
  maxBenefitAt: number; usedAt: number;
  totalBill: number; totalReimburse: number; totalApproved: number; totalNonRe: number;
  settleDate: Date | null; journalNo: string | null; periodCode: string | null; paidRunNo: string | null;
  decisionNote: string | null;
  lineCount: number;
  lines?: {
    treatedName: string; treatment: string | null; treatmentDate: Date | null;
    receiptNo: string | null; physician: string | null; hospital: string | null;
    occupationalInjury: boolean; billAmount: number; reimburseAmount: number;
    approvedAmount: number; nonReAmount: number; note: string | null;
  }[];
  statusLog: StatusEntry[];
}

export async function listClaims(
  db: TenantDb,
  input: { state?: string; year?: number; employeeId?: string; typeId?: string; includeLines?: boolean },
): Promise<ClaimRow[]> {
  const rows = await db.medicalClaim.findMany({
    where: {
      ...(input.state && input.state !== "all" ? { state: input.state } : {}),
      ...(input.year ? { year: input.year } : {}),
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      ...(input.typeId ? { typeId: input.typeId } : {}),
    },
    include: {
      employee: {
        select: {
          employeeNo: true, fullName: true,
          assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 },
        },
      },
      type: { select: { code: true, name: true } },
      lines: input.includeLines ? true : false,
    },
    orderBy: [{ claimDate: "desc" }, { docNo: "desc" }],
    take: 500,
  });
  return rows.map((c) => ({
    id: c.id, docNo: c.docNo, employeeId: c.employeeId,
    employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    orgUnitName: c.employee.assignments[0]?.orgUnit?.name ?? null,
    typeCode: c.type.code, typeName: c.type.name, year: c.year,
    claimDate: c.claimDate, letterNo: c.letterNo, state: c.state, forDependent: c.forDependent,
    maxBenefitAt: c.maxBenefitAt, usedAt: c.usedAt,
    totalBill: c.totalBill, totalReimburse: c.totalReimburse,
    totalApproved: c.totalApproved, totalNonRe: c.totalNonRe,
    settleDate: c.settleDate, journalNo: c.journalNo,
    periodCode: c.periodCode, paidRunNo: c.paidRunNo, decisionNote: c.decisionNote,
    lineCount: input.includeLines ? (c as { lines: unknown[] }).lines.length : 0,
    ...(input.includeLines
      ? {
          lines: (c as { lines: {
            treatedName: string; treatment: string | null; treatmentDate: Date | null;
            receiptNo: string | null; physician: string | null; hospital: string | null;
            occupationalInjury: boolean; billAmount: number; reimburseAmount: number;
            approvedAmount: number; nonReAmount: number; note: string | null;
          }[] }).lines.map((l) => ({ ...l })),
        }
      : {}),
    statusLog: Array.isArray(c.statusLog) ? (c.statusLog as unknown as StatusEntry[]) : [],
  }));
}

// ---- jurnal settlement (pola klaim travel) ----

interface JournalLineDraft {
  accountCode: string;
  accountName: string;
  position: "Debit" | "Credit";
  amount: number;
  memo: string;
}

async function generateSettleJournal(
  db: TenantDb,
  claimId: string,
): Promise<{ journalNo: string; journalDate: Date; lines: number; total: number }> {
  const claim = await db.medicalClaim.findUnique({
    where: { id: claimId },
    include: { lines: true, employee: { select: { fullName: true } }, type: { select: { code: true, name: true } } },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.journalNo) {
    await db.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
  }
  const drafts: JournalLineDraft[] = [];
  const acc = await db.account.findUnique({ where: { code: MEDICAL_EXPENSE_ACC.code } });
  const accName = acc?.name ?? MEDICAL_EXPENSE_ACC.name;
  for (const l of claim.lines) {
    if (l.approvedAmount <= 0) continue;
    drafts.push({
      accountCode: MEDICAL_EXPENSE_ACC.code,
      accountName: accName,
      position: "Debit",
      amount: l.approvedAmount,
      memo: `${claim.docNo} — ${claim.type.name}${l.treatedName !== claim.employee.fullName ? ` (${l.treatedName})` : ""}`,
    });
  }
  const total = round2(drafts.reduce((s, d) => s + d.amount, 0));
  if (total <= 0) return { journalNo: "", journalDate: new Date(), lines: 0, total: 0 };
  drafts.push({
    accountCode: CASH_ACC.code, accountName: CASH_ACC.name, position: "Credit",
    amount: total, memo: `${claim.docNo} — reimbursement medis ${claim.employee.fullName}`,
  });
  const journalNo = await nextJournalNo(db);
  const journalDate = new Date();
  await db.payrollJournal.create({
    data: {
      journalNo, journalDate, runId: null, runNo: claim.docNo,
      description: `Klaim medis ${claim.docNo} — ${claim.employee.fullName} (${claim.type.name})`,
      totalDebit: total, totalCredit: total, status: "Posted",
      lines: {
        create: drafts.map((d, i) => ({
          sequence: i + 1, accountCode: d.accountCode, accountName: d.accountName,
          position: d.position, amount: d.amount, memo: d.memo,
        })),
      },
    },
  });
  return { journalNo, journalDate, lines: drafts.length, total };
}

export interface DecideClaimInput {
  claimId: string;
  action: "submit" | "return" | "approve" | "reject" | "cancel" | "settle";
  note?: string;
}

export interface DecideClaimResult {
  docNo: string;
  state: string;
  journalNo: string | null;
  journalLines: number;
  usedAdded: number;
  remaining: number;
}

/** Operasi klaim — padanan Operation oranHR: Submit | Return To Requester |
 *  Approve | Reject | Cancel | Settle. Settle = jurnal + saldo used bertambah. */
export async function decideClaim(db: TenantDb, input: DecideClaimInput, actorId: string): Promise<DecideClaimResult> {
  const claim = await db.medicalClaim.findUnique({
    where: { id: input.claimId },
    include: { type: { select: { code: true, name: true } }, employee: { select: { fullName: true } } },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");

  const log = Array.isArray(claim.statusLog) ? [...(claim.statusLog as unknown as StatusEntry[])] : [];
  const pushLog = (state: string) => log.push(logEntry(state, actorId, input.note));
  let journalNo = claim.journalNo;
  let journalLines = 0;
  let usedAdded = 0;

  const allowed: Record<string, string[]> = {
    submit: ["Draft", "Returned"],
    return: ["Submitted"],
    approve: ["Submitted", "Returned"],
    reject: ["Submitted", "Returned"],
    cancel: ["Draft", "Submitted", "Approved"],
    settle: ["Approved"],
  };
  if (!allowed[input.action]?.includes(claim.state)) {
    throw new Error(`Operasi ${input.action} tidak valid untuk status ${claim.state}`);
  }

  let newState = claim.state;
  if (input.action === "submit") { newState = "Submitted"; pushLog("Submitted"); }
  if (input.action === "return") { newState = "Returned"; pushLog("Returned"); }
  if (input.action === "approve") { newState = "Approved"; pushLog("Approved"); }
  if (input.action === "reject") { newState = "Rejected"; pushLog("Rejected"); }
  if (input.action === "cancel") {
    newState = "Cancelled"; pushLog("Cancelled");
    if (claim.state === "Settled" || claim.journalNo) throw new Error("Klaim sudah settled — tidak bisa dibatalkan");
    if (claim.journalNo) {
      const del = await db.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
      journalNo = null; journalLines = -del.count;
    }
  }
  if (input.action === "settle") {
    newState = "Settled";
    pushLog("Settled");
    const j = await generateSettleJournal(db, claim.id);
    journalNo = j.journalNo || null;
    journalLines = j.lines;
    // saldo used bertambah sebesar approved (employee / dependent sesuai klaim)
    const bal = await db.medicalBalance.findUnique({
      where: { employeeId_typeId_year: { employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year } },
    });
    if (bal) {
      usedAdded = claim.totalApproved;
      await db.medicalBalance.update({
        where: { id: bal.id },
        data: claim.forDependent
          ? { depUsed: round2(bal.depUsed + usedAdded) }
          : { usedAmount: round2(bal.usedAmount + usedAdded) },
      });
    }
  }

  await db.medicalClaim.update({
    where: { id: claim.id },
    data: {
      state: newState,
      statusLog: JSON.stringify(log),
      journalNo, journalDate: journalNo ? new Date() : null,
      settleDate: input.action === "settle" ? new Date() : claim.settleDate,
      settledById: input.action === "settle" ? actorId : claim.settledById,
      decidedById: ["approve", "reject", "cancel"].includes(input.action) ? actorId : claim.decidedById,
      decidedAt: ["approve", "reject", "cancel"].includes(input.action) ? new Date() : claim.decidedAt,
      decisionNote: input.note ?? claim.decisionNote,
    },
  });

  await db.activityLog.create({
    data: {
      action: input.action === "settle" ? "Processed" : "Updated",
      entity: "MedicalClaim", entityId: claim.id,
      detail: `Klaim ${claim.docNo} → ${newState}${input.note ? ` (${input.note})` : ""}${journalNo ? ` — jurnal ${journalNo} (${journalLines} baris)` : ""}`,
    },
  });

  const balAfter = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year } },
  });
  const remaining = balAfter
    ? round2(balAfter.benefitAmount + balAfter.adjustmentAmount + balAfter.carriedOver - balAfter.usedAmount - balAfter.initialUsed)
    : 0;
  return { docNo: claim.docNo, state: newState, journalNo, journalLines, usedAdded, remaining };
}

// ============ penyesuaian saldo (padanan MedicalBenefitAdjustment) ============

export interface AdjustmentInput {
  employeeId: string;
  typeId: string;
  year: number;
  forDependent?: boolean;
  amount: number;
  adjustmentDate: string;
  note?: string;
}

export async function submitAdjustment(db: TenantDb, input: AdjustmentInput, actorId: string) {
  if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("Jumlah penyesuaian harus ≠ 0");
  const bal = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: input.employeeId, typeId: input.typeId, year: input.year } },
  });
  if (!bal) throw new Error("Saldo medis karyawan belum digenerate untuk tahun ini");
  const docNo = await nextDocNo(db, "MA");
  const adj = await db.medicalAdjustment.create({
    data: {
      docNo, employeeId: input.employeeId, typeId: input.typeId, year: input.year,
      forDependent: Boolean(input.forDependent),
      amount: round2(input.amount),
      adjustmentDate: dayStart(input.adjustmentDate),
      note: input.note?.trim() || null,
      state: "Submitted",
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "MedicalAdjustment", entityId: adj.id,
      detail: `Penyesuaian medis ${docNo} ${input.amount > 0 ? "+" : ""}${input.amount.toLocaleString("id-ID")}`,
    },
  });
  return { id: adj.id, docNo };
}

export async function decideAdjustment(
  db: TenantDb,
  input: { adjustmentId: string; action: "approve" | "reject" | "cancel"; note?: string },
  actorId: string,
) {
  const adj = await db.medicalAdjustment.findUnique({ where: { id: input.adjustmentId } });
  if (!adj) throw new Error("Penyesuaian tidak ditemukan");
  if (adj.state !== "Submitted") throw new Error(`Status ${adj.state} tidak bisa diproses`);
  if (input.action === "approve") {
    const bal = await db.medicalBalance.findUnique({
      where: { employeeId_typeId_year: { employeeId: adj.employeeId, typeId: adj.typeId, year: adj.year } },
    });
    if (!bal) throw new Error("Saldo tidak ditemukan");
    await db.medicalBalance.update({
      where: { id: bal.id },
      data: adj.forDependent
        ? { depAdjustment: round2(bal.depAdjustment + adj.amount) }
        : { adjustmentAmount: round2(bal.adjustmentAmount + adj.amount) },
    });
  }
  await db.medicalAdjustment.update({
    where: { id: adj.id },
    data: {
      state: input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Cancelled",
      decidedById: actorId, decidedAt: new Date(), decisionNote: input.note ?? null,
    },
  });
  return { docNo: adj.docNo, state: input.action === "approve" ? "Approved" : input.action === "reject" ? "Rejected" : "Cancelled" };
}

export async function listAdjustments(db: TenantDb, input: { state?: string; year?: number }) {
  const rows = await db.medicalAdjustment.findMany({
    where: {
      ...(input.state && input.state !== "all" ? { state: input.state } : {}),
      ...(input.year ? { year: input.year } : {}),
    },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      type: { select: { code: true, name: true } },
    },
    orderBy: { adjustmentDate: "desc" },
    take: 300,
  });
  return rows.map((a) => ({
    id: a.id, docNo: a.docNo, employeeNo: a.employee.employeeNo, fullName: a.employee.fullName,
    typeCode: a.type.code, typeName: a.type.name, year: a.year, forDependent: a.forDependent,
    amount: a.amount, adjustmentDate: a.adjustmentDate, note: a.note, state: a.state,
    decisionNote: a.decisionNote,
  }));
}

// ============ transfer sisa saldo ke payroll (padanan cash_wage_code oranHR) ============

export interface MedTransferResult {
  periodName: string;
  employees: number;
  rows: number;
  totalAmount: number;
  removed: number;
}

/** Sisa saldo jenis unusedRule=CASH akhir tahun → komponen Specific UMC (Earning
 *  Compensation). Idempoten: assignment UMC period dibuang lalu ditulis ulang. */
export async function transferUnusedToPayroll(
  db: TenantDb,
  input: { periodId: string; year: number; processTypeCode?: string },
): Promise<MedTransferResult> {
  const period = await db.payrollPeriod.findUnique({ where: { id: input.periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");
  if (period.status === "Locked" || period.status === "Closed") {
    throw new Error("Period sudah ditutup/terkunci — pilih period lain");
  }
  const ptCode = input.processTypeCode ?? "SALARY";
  const pt = await db.processType.findFirst({ where: { code: ptCode } });
  if (!pt) throw new Error(`Process type ${ptCode} tidak ditemukan`);
  const comp = await db.wageComponent.findUnique({ where: { code: "UMC" } });
  if (!comp) throw new Error("Komponen upah UMC belum didefinisikan (hubungi admin)");

  const types = await db.medicalBenefitType.findMany({ where: { active: true, unusedRule: "CASH" } });
  if (types.length === 0) throw new Error("Tidak ada jenis benefit dengan kebijakan saldo CASH");
  const typeIds = types.map((t) => t.id);

  const balances = await db.medicalBalance.findMany({
    where: { year: input.year, typeId: { in: typeIds } },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true, status: true } } },
  });
  const rows = balances
    .map((b) => ({
      balanceId: b.id,
      employeeId: b.employeeId,
      employeeNo: b.employee.employeeNo,
      fullName: b.employee.fullName,
      status: b.employee.status,
      typeName: types.find((t) => t.id === b.typeId)?.name ?? "",
      remaining: round2(b.benefitAmount + b.adjustmentAmount + b.carriedOver - b.usedAmount - b.initialUsed),
    }))
    .filter((r) => r.status === "Active" && r.remaining > 0);
  if (rows.length === 0) throw new Error(`Tidak ada sisa saldo CASH pada tahun ${input.year}`);

  const removed = await db.employeeComponentAssignment.deleteMany({
    where: { kind: "Specific", periodId: period.id, processTypeId: pt.id, wageComponentId: comp.id },
  });

  const employees = new Set<string>();
  let total = 0;
  // agregasi per karyawan (satu baris UMC per karyawan, rincian di notes)
  const byEmp = new Map<string, { amount: number; detail: string[] }>();
  for (const r of rows) {
    const cur = byEmp.get(r.employeeId) ?? { amount: 0, detail: [] };
    cur.amount = round2(cur.amount + r.remaining);
    cur.detail.push(`${r.typeName} ${r.remaining.toLocaleString("id-ID")}`);
    byEmp.set(r.employeeId, cur);
  }
  for (const [empId, v] of byEmp) {
    await db.employeeComponentAssignment.create({
      data: {
        employeeId: empId, wageComponentId: comp.id,
        kind: "Specific", amount: v.amount,
        periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
        notes: `Uang sisa saldo medis ${input.year}: ${v.detail.join(", ")}`,
        active: true,
      },
    });
    employees.add(empId);
    total += v.amount;
  }

  // saldo CASH dikonsumsi saat ditransfer (used bertambah) — mencegah transfer
  // ganda ke period lain (padanan oranHR: saldo hangus saat dibayar tunai).
  for (const r of rows) {
    const bal = balances.find((b) => b.id === r.balanceId);
    if (!bal) continue;
    await db.medicalBalance.update({
      where: { id: r.balanceId },
      data: { usedAmount: round2(bal.usedAmount + r.remaining) },
    });
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MedicalTransfer", entityId: period.id,
      detail: `Transfer sisa saldo medis ${input.year} → ${period.name}: ${employees.size} karyawan, total ${total.toLocaleString("id-ID")}`,
    },
  });
  return { periodName: period.name, employees: employees.size, rows: rows.length, totalAmount: total, removed: removed.count };
}

/** Dipanggil confirmRun(): klaim yang periodCode-nya cocok run → Paid (transfer UMC). */
export async function markMedicalPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run || run.processType.code !== "SALARY") return 0;
  const res = await db.medicalClaim.updateMany({
    where: { periodCode: run.period.code, paidRunNo: null },
    data: { paidRunNo: run.runNo },
  });
  if (res.count > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "MedicalClaim", entityId: runId,
        detail: `${res.count} transfer medis ditandai Dibayar via run ${run.runNo} (${run.period.name})`,
      },
    });
  }
  return res.count;
}

// ============ KPI & laporan ============

export async function medicalStats(db: TenantDb, year: number) {
  const [totalBalances, totalClaims, pendingClaims, settledClaims, adjustments, types] = await Promise.all([
    db.medicalBalance.count({ where: { year } }),
    db.medicalClaim.count({ where: { year } }),
    db.medicalClaim.count({ where: { year, state: { in: ["Submitted", "Returned"] } } }),
    db.medicalClaim.count({ where: { year, state: "Settled" } }),
    db.medicalAdjustment.count({ where: { year } }),
    db.medicalBenefitType.count({ where: { active: true } }),
  ]);
  const settledAgg = await db.medicalClaim.aggregate({
    where: { year, state: "Settled" },
    _sum: { totalApproved: true, totalBill: true },
  });
  const balances = await db.medicalBalance.findMany({
    where: { year },
    include: { type: { select: { limitRule: true } } },
  });
  // jenis UNLIMITED (mis. PJK) tidak dijumlahkan nominal sisa
  const remaining = round2(
    balances
      .filter((b) => b.type.limitRule !== "UNLIMITED")
      .reduce((s, b) => s + b.benefitAmount + b.adjustmentAmount + b.carriedOver - b.usedAmount - b.initialUsed, 0),
  );
  const byTypeAgg = await db.medicalClaim.groupBy({
    by: ["typeId"],
    where: { year, state: "Settled" },
    _sum: { totalApproved: true },
    _count: { _all: true },
  });
  const typeRows = await db.medicalBenefitType.findMany({ select: { id: true, code: true, name: true } });
  const byType = byTypeAgg.map((g) => {
    const t = typeRows.find((x) => x.id === g.typeId);
    return {
      typeCode: t?.code ?? "?", typeName: t?.name ?? "?",
      claimCount: g._count._all, approvedAmount: g._sum.totalApproved ?? 0,
    };
  }).sort((a, b) => b.approvedAmount - a.approvedAmount);
  return {
    year, totalBalances, totalClaims, pendingClaims, settledClaims, adjustments, types,
    settledApproved: settledAgg._sum.totalApproved ?? 0,
    settledBill: settledAgg._sum.totalBill ?? 0,
    remaining, byType,
  };
}

export async function claimReport(
  db: TenantDb,
  input: { from: string; to: string; employeeId?: string },
) {
  const start = dayStart(input.from);
  const end = dayStart(new Date(new Date(input.to).getTime() + 86400000));
  const rows = await db.medicalClaim.findMany({
    where: {
      claimDate: { gte: start, lt: end },
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
    },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      type: { select: { code: true, name: true } },
    },
    orderBy: { claimDate: "desc" },
    take: 500,
  });
  return rows.map((c) => ({
    docNo: c.docNo, employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    typeCode: c.type.code, typeName: c.type.name, claimDate: c.claimDate, state: c.state,
    forDependent: c.forDependent, totalBill: c.totalBill, totalApproved: c.totalApproved,
    journalNo: c.journalNo, settleDate: c.settleDate,
  }));
}
