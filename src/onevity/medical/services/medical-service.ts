// OneVity Medical Service (ref: ANALISA-MEDICAL.md — modul Medical Benefit).
// Alur: master jenis benefit (limit UNLIMITED/NOMINAL/FACTOR×gaji) → Generate saldo
// per tahun (padanan Generate Employee Medical Information) → klaim medis (baris
// perawatan: treated/diagnosa/kwitansi/dokter/RS + bill/reimburse/approved/nonRe) →
// approval (Submit→Approved→Settled; Reject/Cancel) → Settle = jurnal otomatis +
// saldo used bertambah → penyesuaian ± (Medical Adjustment + approval) → sisa saldo
// jenis CASH ditarik ke payroll (komponen UMC) → Paid saat run dikonfirmasi.
import { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb, type FieldCrypto } from "@/onevity/shared/lib/field-crypto";
import { nextJournalNoInTx } from "@/onevity/shared/lib/journal-no";
import { startApprovalChain, decideApprovalChain, getApprovalChain, attachChainSummaries, type ChainSummary, type DecideActor } from "@/onevity/shared/services/approval-engine";
import type { Prisma } from "@/generated/tenant";
// Task 33 — rule diferensiasi plafon per parameter karyawan.
import { EntityRuleLite, RuleContext, matchFirstRule, applyRuleValue } from "@/onevity/shared/lib/parameter-rules";
import { EMPLOYEE_RULE_INCLUDE, buildEmployeeRuleContext, EmployeeRuleRecord } from "@/onevity/shared/services/employee-rule-context";

// ============ Task 33 — resolver plafon via rule ============

/** Muat rule plafon semua jenis medis terlibat (map typeId → lite). */
async function medicalTypeRules(
  db: Pick<TenantDb, "medicalBenefitTypeRule">,
  typeIds: string[],
): Promise<Map<string, EntityRuleLite[]>> {
  const map = new Map<string, EntityRuleLite[]>();
  if (typeIds.length === 0) return map;
  const rows = await db.medicalBenefitTypeRule.findMany({ where: { medicalBenefitTypeId: { in: typeIds }, active: true } });
  for (const r of rows) {
    const arr = map.get(r.medicalBenefitTypeId) ?? [];
    arr.push({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt });
    map.set(r.medicalBenefitTypeId, arr);
  }
  return map;
}

/** Plafon efektif: rule cocok pertama menang (atas plafon dasar hasil limitRule). */
function limitWithRules(base: number, rules: EntityRuleLite[] | undefined, ctx: RuleContext | undefined | null): number {
  if (!rules || rules.length === 0 || !ctx) return base;
  const matched = matchFirstRule(rules, ctx);
  return matched ? applyRuleValue(matched.rule.actionType, matched.rule.value, base) : base;
}

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

/** Gaji pokok aktif (28-c: terenkripsi di DB — dekripsi via field-crypto). */
export function salaryOfAssignment(tc: FieldCrypto, stored: string | null): number {
  return tc.decryptMoney(stored) ?? 0;
}

async function activeSalary(db: TenantDb, employeeId: string): Promise<number> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { assignments: { where: { validTo: null }, select: { baseSalary: true }, take: 1 } },
  });
  return emp?.assignments[0] ? tenantCryptoForDb(db).decryptMoney(emp.assignments[0].baseSalary) ?? 0 : 0;
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

const fmtRp = (n: number) => n.toLocaleString("id-ID");

/** Status klaim yang masih "hidup" (uang belum selesai) — dipakai dedupe kwitansi (M-8). */
const ACTIVE_CLAIM_STATES = ["Draft", "Submitted", "Returned", "Approved", "Settled"];
/** Status klaim yang masih MENAHAN plafon (belum diputuskan/dibayar) — dipakai
 *  reservasi sisa plafon (K-1/K-2). */
const PENDING_CLAIM_STATES = ["Submitted", "Returned", "Approved"];

// ==== pool plafon (fix audit K-3) ====

/** True bila jenis memberi pool plafon DEPENDENT TERPISAH (depLimitRule ≠ SHARED
 *  dan dependent aktif). SHARED → klaim dependent memakai POOL UTAMA karyawan
 *  (depBenefitAmount = 0 → depUsed tidak pernah memotong plafon bersama). */
function depPoolSeparate(t: { dependentEnabled: boolean; depLimitRule: string }): boolean {
  return t.dependentEnabled && t.depLimitRule !== "SHARED";
}

export interface PoolAvailability {
  pool: "employee" | "dependent";
  /** sisa plafon pool saat ini (SHARED-dependent → pool utama karyawan). */
  poolRemaining: number;
  /** Σ klaim lain (Submitted/Returned/Approved) yang menahan pool ini. */
  pendingOthers: number;
  /** poolRemaining − pendingOthers. */
  available: number;
  otherClaims: { docNo: string; totalApproved: number }[];
  empRemaining: number;
  depRemaining: number;
  /** snapshot pool utk header klaim (benefit+adj+carry | depBenefit+depAdj). */
  poolBenefit: number;
  poolUsed: number;
}

/** Sisa plafon pool yang BENAR untuk sebuah klaim (fix K-1/K-2/K-3) + reservasi
 *  klaim lain yang masih menunggu. excludeClaimId dipakai saat re-check
 *  approve/settle supaya klaim itu sendiri tidak dihitung dua kali. */
async function claimPoolAvailability(
  db: TenantDb,
  input: { employeeId: string; typeId: string; year: number; forDependent: boolean; excludeClaimId?: string },
): Promise<PoolAvailability> {
  const t = await db.medicalBenefitType.findUnique({
    where: { id: input.typeId },
    select: { dependentEnabled: true, depLimitRule: true, limitRule: true, limitValue: true },
  });
  if (!t) throw new Error("Jenis benefit tidak ditemukan");
  const [bal, emp] = await Promise.all([
    db.medicalBalance.findUnique({
      where: { employeeId_typeId_year: { employeeId: input.employeeId, typeId: input.typeId, year: input.year } },
    }),
    db.employee.findUnique({
      where: { id: input.employeeId },
      // Task 33: include konteks rule plafon (assignment full-row + entitas).
      include: EMPLOYEE_RULE_INCLUDE,
    }),
  ]);
  // fallback bila saldo tahun itu belum digenerate (backlog m-5: submit masih
  // memakai limit on-the-fly; settle kini MENOLAK tanpa saldo — lihat decideClaim)
  // 28-c: baseSalary terenkripsi — dekripsi utk kalkulasi plafon.
  const salary = emp?.assignments[0] ? tenantCryptoForDb(db).decryptMoney(emp.assignments[0].baseSalary) ?? 0 : 0;
  // Task 33 — fallback plafon on-the-fly ikut rule parameter karyawan.
  const poolRules = await medicalTypeRules(db, [input.typeId]);
  const poolCtx = emp ? buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, new Date()) : null;
  const fallbackLimit = limitWithRules(benefitLimitFor(t, salary), poolRules.get(input.typeId), poolCtx);
  const limit = bal?.benefitAmount ?? fallbackLimit;
  const empRemaining = bal
    ? round2(bal.benefitAmount + bal.adjustmentAmount + bal.carriedOver - bal.usedAmount - bal.initialUsed)
    : round2(limit);
  const depRemaining = bal
    ? round2(bal.depBenefitAmount + bal.depAdjustment - bal.depUsed)
    : round2(depPoolSeparate(t) ? limit : 0);
  const pool: "employee" | "dependent" = input.forDependent && depPoolSeparate(t) ? "dependent" : "employee";
  const poolRemaining = pool === "dependent" ? depRemaining : empRemaining;

  const others = await db.medicalClaim.findMany({
    where: {
      employeeId: input.employeeId, typeId: input.typeId, year: input.year,
      state: { in: PENDING_CLAIM_STATES },
      ...(input.excludeClaimId ? { id: { not: input.excludeClaimId } } : {}),
    },
    select: { docNo: true, totalApproved: true, forDependent: true },
  });
  const otherClaims: { docNo: string; totalApproved: number }[] = [];
  let pendingOthers = 0;
  for (const o of others) {
    const oPool = o.forDependent && depPoolSeparate(t) ? "dependent" : "employee";
    if (oPool === pool) {
      pendingOthers = round2(pendingOthers + o.totalApproved);
      otherClaims.push({ docNo: o.docNo, totalApproved: o.totalApproved });
    }
  }
  return {
    pool, poolRemaining, pendingOthers, otherClaims,
    available: round2(poolRemaining - pendingOthers),
    empRemaining, depRemaining,
    poolBenefit: pool === "dependent"
      ? round2((bal?.depBenefitAmount ?? (depPoolSeparate(t) ? limit : 0)) + (bal?.depAdjustment ?? 0))
      : round2((bal ? bal.benefitAmount : limit) + (bal?.adjustmentAmount ?? 0) + (bal?.carriedOver ?? 0)),
    poolUsed: pool === "dependent" ? (bal?.depUsed ?? 0) : round2((bal?.usedAmount ?? 0) + (bal?.initialUsed ?? 0)),
  };
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
  /** Task 33 — jumlah aturan diferensiasi plafon. */
  ruleCount: number;
}

export async function listBenefitTypes(db: TenantDb): Promise<BenefitTypeRow[]> {
  const rows = await db.medicalBenefitType.findMany({
    orderBy: { sortOrder: "asc" },
    // Task 33 — jumlah aturan diferensiasi plafon per jenis.
    include: { _count: { select: { balances: true, claims: true, rules: true } } },
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
    ruleCount: t._count.rules,
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
  input: { year: number; typeId?: string; limitCorrection?: boolean; employeeIds?: string[]; actor?: MedActorRef },
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
    // Task 33: include lengkap utk konteks rule plafon (assignment full-row
    // — termasuk baseSalary terenkripsi & kode entitas penempatan).
    include: EMPLOYEE_RULE_INCLUDE,
  });
  if (employees.length === 0) throw new Error("Tidak ada karyawan aktif");

  // Task 33 — rule plafon per jenis (dievaluasi per parameter karyawan).
  const medRules = await medicalTypeRules(db, types.map((t) => t.id));
  const asOfYear = new Date(year, 0, 1);

  const prevBalances = await db.medicalBalance.findMany({ where: { year: year - 1 } });
  const prevByKey = new Map(prevBalances.map((b) => [`${b.employeeId}:${b.typeId}`, b]));

  // M-14b (audit 42): saldo tahun `year` utk seluruh karyawan×jenis diambil
  // SEKALI (findMany in [...employeeIds] + Map) — dulu findUnique per pasangan
  // di dalam loop (42 karyawan × 8 jenis = 336 kueri; N+1). Semantik create /
  // update-koreksi per pasangan TIDAK berubah (tetap kondisional & terpisah).
  const existingRows = await db.medicalBalance.findMany({
    where: {
      year,
      ...(input.typeId ? { typeId: input.typeId } : {}),
      ...(input.employeeIds?.length ? { employeeId: { in: input.employeeIds } } : {}),
    },
  });
  const existingByKey = new Map(existingRows.map((b) => [`${b.employeeId}:${b.typeId}`, b]));

  let created = 0;
  let updated = 0;
  // 28-c: baseSalary terenkripsi — dekripsi utk kalkulasi plafon.
  const tcGen = tenantCryptoForDb(db);
  for (const emp of employees) {
    const salary = emp.assignments[0] ? salaryOfAssignment(tcGen, emp.assignments[0].baseSalary) : 0;
    const empCtx = buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, asOfYear);
    for (const t of types) {
      const limit = limitWithRules(benefitLimitFor(t, salary), medRules.get(t.id), empCtx);
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
      // K-4 (fix audit BPA-medical): initialUsed = 0 — auto-carry used tahun lalu
      // DIHAPUS. Padanan "Initial Medical Benefit" adalah MIGRASI MANUAL
      // saldo awal (input eksplisit), bukan auto-carry:
      // (a) CASH — sisa tahun lalu SUDAH dicairkan via UMC sehingga pemakaian lama
      //     tidak relevan (auto-carry memberi seluruh karyawan sisa 0 di tahun baru);
      // (b) CARRY — sisa tahun lalu sudah masuk carriedOver; initialUsed mengurangi
      //     dua kali (double-count).
      // Kolom initialUsed tetap tersedia untuk input migrasi eksplisit
      // (padanan InitialMedicalBenefit.jsp — via adjustment/manual bila dibutuhkan).
      const initialUsed = 0;
      const depBenefit =
        t.dependentEnabled && t.depLimitRule !== "SHARED" ? limit : 0;

      const existing = existingByKey.get(`${emp.id}:${t.id}`);
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

  // Fix audit 40 M-05 — aktor generate saldo (appUserId) ikut tercatat
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MedicalBalance", entityId: String(year),
      appUserId: input.actor?.appUserId ?? undefined,
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
  // 28-c: baseSalary karyawan terenkripsi — dekripsi utk kolom saldo.
  const tcBal = tenantCryptoForDb(db);
  return rows.filter((b) => b.type.limitRule !== "UNLIMITED").map((b) => {
    const remaining = round2(
      b.benefitAmount + b.adjustmentAmount + b.carriedOver - b.usedAmount - b.initialUsed,
    );
    const depRemaining = round2(b.depBenefitAmount + b.depAdjustment - b.depUsed);
    return {
      id: b.id, employeeId: b.employeeId, employeeNo: b.employee.employeeNo,
      fullName: b.employee.fullName,
      orgUnitName: b.employee.assignments[0]?.orgUnit?.name ?? null,
      baseSalary: b.employee.assignments[0] ? tcBal.decryptMoney(b.employee.assignments[0].baseSalary) ?? 0 : 0,
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
  /** Khusus seeder/migrasi demo: izinkan klaim over-limit melewati guard K-1
   *  (API TIDAK memetakan flag ini — operasi bisnis normal tetap ditolak 400). */
  allowOverLimit?: boolean;
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
  // ---- tambahan (fix audit, additive — kontrak lama utuh) ----
  joinDate: Date | null; // validasi tanggal M-2
  depRemaining: number; // sisa plafon dependent terpisah (K-3)
  claimPool: "employee" | "dependent"; // pool yang dipotong klaim (K-3)
  /** sisa pool yang benar SETELAH reservasi klaim menunggu (K-1/K-2). */
  remainingForClaim: number;
  pendingReserved: number;
  poolNote: string | null;
}

export async function previewClaim(
  db: TenantDb,
  input: { employeeId: string; typeId: string; year: number; forDependent?: boolean },
): Promise<ClaimPreview> {
  const emp = await db.employee.findUnique({
    where: { id: input.employeeId },
    // Task 33: include konteks rule plafon + field preview.
    select: {
      employeeNo: true, fullName: true, status: true, joinDate: true,
      religion: true, maritalStatus: true, gender: true, birthDate: true, city: true, bloodType: true,
      company: { select: { code: true, name: true } },
      positionLevel: { select: { code: true, name: true } },
      payrollProfile: { select: { hasNpwp: true, taxStatus: true, dependents: true } },
      assignments: { where: { validTo: null }, orderBy: { validFrom: "desc" }, include: { orgUnit: { select: { code: true, name: true } }, position: { select: { code: true, title: true } }, grade: { select: { code: true, name: true } }, companyOffice: { select: { code: true, name: true } }, workLocation: { select: { code: true, name: true } } }, take: 1 },
    },
  });
  if (!emp) throw new Error("Karyawan tidak ditemukan");
  if (emp.status !== "Active") throw new Error("Karyawan tidak aktif");
  const t = await db.medicalBenefitType.findUnique({ where: { id: input.typeId } });
  if (!t || !t.active) throw new Error("Jenis benefit tidak aktif");

  const bal = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: input.employeeId, typeId: input.typeId, year: input.year } },
  });
  // 28-c: gaji pokok terenkripsi — dekripsi utk fallback plafon.
  const salary = emp.assignments[0] ? salaryOfAssignment(tenantCryptoForDb(db), emp.assignments[0].baseSalary) : 0;
  // Task 33 — fallback plafon ikut rule parameter karyawan.
  const wizRules = await medicalTypeRules(db, [input.typeId]);
  const wizCtx = buildEmployeeRuleContext(emp as unknown as EmployeeRuleRecord, new Date());
  const limit = bal?.benefitAmount ?? limitWithRules(benefitLimitFor(t, salary), wizRules.get(input.typeId), wizCtx);
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
  // pool yang benar utk klaim (fix K-3) + reservasi klaim menunggu (fix K-1/K-2)
  const avail = await claimPoolAvailability(db, {
    employeeId: input.employeeId, typeId: input.typeId, year: input.year,
    forDependent: Boolean(input.forDependent),
  });
  const poolNote = input.forDependent
    ? (avail.pool === "dependent"
        ? "klaim dependent memotong plafon dependent TERPISAH"
        : "klaim dependent memotong plafon BERSAMA karyawan (SHARED)")
    : null;
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
    joinDate: emp.joinDate ?? null,
    depRemaining: avail.depRemaining,
    claimPool: avail.pool,
    remainingForClaim: avail.available,
    pendingReserved: avail.pendingOthers,
    poolNote,
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
  approvalLevels: number;
  firstApprover: string | null;
}

/** Identitas aktor sesi utk jejak audit (fix audit 40 M-05) — opsional supaya
 *  seeder/ESS path lama tetap kompatibel. */
export interface MedActorRef {
  appUserId?: string | null;
  employeeId?: string | null;
}

export async function submitClaim(
  db: TenantDb,
  input: SubmitClaimInput,
  actorId: string,
  actor?: MedActorRef,
): Promise<SubmitClaimResult> {
  const year = new Date(input.claimDate).getFullYear();
  const preview = await previewClaim(db, { employeeId: input.employeeId, typeId: input.typeId, year, forDependent: Boolean(input.forDependent) });
  if (input.lines.length === 0) throw new Error("Minimal satu baris perawatan");

  // K-3: klaim dependent hanya untuk jenis yang mengaktifkan dependent
  if (input.forDependent && !preview.dependentEnabled) {
    throw new Error(`Jenis ${preview.typeCode} tidak mengaktifkan klaim dependent`);
  }

  // ---- M-2 (fix audit): validasi tanggal — sebelumnya hilang total ----
  // klaim & perawatan tidak boleh masa depan, tahun perawatan = tahun saldo,
  // tanggal tidak boleh mendahului tanggal bergabung karyawan.
  const today = dayStart(new Date());
  const claimDate = dayStart(input.claimDate);
  if (Number.isNaN(claimDate.getTime())) throw new Error("Tanggal klaim tidak valid");
  const fmtD = (d: Date) => d.toISOString().slice(0, 10);
  if (claimDate > today) {
    throw new Error(`Tanggal klaim tidak boleh di masa depan (${fmtD(claimDate)} — hari ini ${fmtD(today)})`);
  }
  const joinDate = preview.joinDate ? dayStart(preview.joinDate) : null;
  if (joinDate && claimDate < joinDate) {
    throw new Error(`Tanggal klaim ${fmtD(claimDate)} mendahului tanggal bergabung karyawan (${fmtD(joinDate)})`);
  }

  // validasi frekuensi (padanan Max Claim in X period)
  if (!preview.freqUnlimited && preview.freqValue > 0 && preview.claimCountYear >= preview.freqValue) {
    throw new Error(
      `Frekuensi klaim ${preview.typeCode} maksimal ${preview.freqValue}× per ${preview.freqPeriod === "YEAR" ? "tahun" : "period"} — sudah ${preview.claimCountYear} klaim`,
    );
  }

  let totalBill = 0;
  let totalRe = 0;
  let totalApproved = 0;
  const lines: {
    treatedName: string; treatment: string | null; treatmentDate: Date | null;
    receiptNo: string | null; physician: string | null; hospital: string | null; note: string | null;
    occupationalInjury: boolean; billAmount: number; reimburseAmount: number;
    approvedAmount: number; nonReAmount: number;
  }[] = [];
  const seenReceipts = new Set<string>();

  for (const l of input.lines) {
    if (!l.treatedName.trim()) throw new Error("Nama yang dirawat wajib diisi");
    if (l.billAmount < 0 || l.approvedAmount < 0) throw new Error("Jumlah tidak boleh negatif");
    if (l.approvedAmount > l.billAmount) throw new Error("Approved tidak boleh melebihi tagihan");
    // M-2: tanggal perawatan ≤ hari ini, tahun sama dengan tahun klaim/saldo,
    // ≥ tanggal bergabung.
    if (l.treatmentDate) {
      const td = dayStart(l.treatmentDate);
      if (Number.isNaN(td.getTime())) throw new Error(`Tanggal perawatan tidak valid: ${l.treatmentDate}`);
      if (td > today) {
        throw new Error(`Tanggal perawatan tidak boleh di masa depan (${fmtD(td)} — hari ini ${fmtD(today)})`);
      }
      if (td.getFullYear() !== year) {
        throw new Error(`Tahun tanggal perawatan (${td.getFullYear()}) harus sama dengan tahun klaim/saldo (${year}) — pilih tahun saldo yang sesuai`);
      }
      if (joinDate && td < joinDate) {
        throw new Error(`Tanggal perawatan ${fmtD(td)} mendahului tanggal bergabung karyawan (${fmtD(joinDate)})`);
      }
    }
    // M-8: no. kwitansi unik dalam satu pengajuan
    const rn = l.receiptNo?.trim() ?? "";
    if (rn) {
      if (seenReceipts.has(rn)) {
        throw new Error(`No. kwitansi ${rn} dipakai lebih dari satu baris pada pengajuan ini — kwitansi ganda ditolak`);
      }
      seenReceipts.add(rn);
    }
    const nonRe = round2(l.billAmount - l.approvedAmount);
    totalBill = round2(totalBill + l.billAmount);
    totalRe = round2(totalRe + l.reimburseAmount);
    totalApproved = round2(totalApproved + l.approvedAmount);
    lines.push({
      treatedName: l.treatedName.trim(),
      treatment: l.treatment?.trim() || null,
      treatmentDate: l.treatmentDate ? dayStart(l.treatmentDate) : null,
      receiptNo: rn || null,
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

  // ---- M-8 (fix audit): dedupe kwitansi LINTAS klaim (status aktif) ----
  if (seenReceipts.size > 0) {
    const dup = await db.medicalClaimLine.findMany({
      where: {
        receiptNo: { in: [...seenReceipts] },
        claim: { employeeId: input.employeeId, state: { in: ACTIVE_CLAIM_STATES } },
      },
      select: { receiptNo: true, claim: { select: { docNo: true } } },
      take: 5,
    });
    if (dup.length > 0) {
      throw new Error(
        `Kwitansi sudah pernah diklaim: ${dup.map((d) => `${d.receiptNo} (${d.claim.docNo})`).join("; ")} — klaim ganda ditolak`,
      );
    }
  }

  // ---- K-1 + K-2(c) + K-3 (fix audit): enforce KUAT di submit — tolak bila total
  // approved melebihi sisa plafon POOL YANG BENAR (klaim dependent SHARED → pool
  // utama karyawan; termasuk reservasi klaim menunggu lain). Guard lembut 2× lama
  // DIHAPUS — klaim over-limit terbukti lolos sampai settle (bukti MC-2026-005);
  // klaim atas saldo yang sudah ditransfer UMC (sisa 0) juga ditolak di sini. ----
  const avail = await claimPoolAvailability(db, {
    employeeId: input.employeeId, typeId: input.typeId, year,
    forDependent: Boolean(input.forDependent),
  });
  const poolLabel = avail.pool === "dependent" ? "plafon dependent" : "plafon karyawan";
  if (!input.allowOverLimit && totalApproved > avail.available) {
    throw new Error(
      `Total approved Rp ${fmtRp(totalApproved)} melebihi sisa ${poolLabel} Rp ${fmtRp(avail.available)}` +
      (avail.pendingOthers > 0 ? ` (termasuk reservasi klaim menunggu lain Rp ${fmtRp(avail.pendingOthers)})` : "") +
      " — kurangi nilai approved atau ajukan penyesuaian/limit koreksi terlebih dahulu",
    );
  }

  const docNo = await nextDocNo(db, "MC");
  const state = input.submit === false ? "Draft" : "Submitted";
  const log = [logEntry("Draft", actorId, "Dibuat"), ...(state === "Submitted" ? [logEntry("Submitted", actorId, input.note || "Diajukan")] : [])];

  const claim = await db.medicalClaim.create({
    data: {
      docNo, employeeId: input.employeeId, typeId: input.typeId, year,
      claimDate: dayStart(input.claimDate),
      letterNo: input.letterNo?.trim() || null,
      forDependent: Boolean(input.forDependent),
      state,
      // snapshot pool yang BENAR (K-3): dep pool terpisah → depBenefit/depUsed;
      // SHARED-dependent & klaim karyawan → pool utama (benefit+adj+carry/used).
      maxBenefitAt: avail.poolBenefit,
      usedAt: avail.poolUsed,
      totalBill, totalReimburse: totalRe, totalApproved, totalNonRe: round2(totalBill - totalApproved),
      // statusLog ditulis sebagai array Json (bukan string — riwayat utuh)
      statusLog: log as unknown as Prisma.InputJsonValue,
      lines: { create: lines },
    },
  });

  // Fix audit 40 M-05 — identitas aktor pengajuan (appUserId/employeeId) tercatat
  await db.activityLog.create({
    data: {
      action: "Created", entity: "MedicalClaim", entityId: claim.id,
      appUserId: actor?.appUserId ?? undefined,
      employeeId: actor?.employeeId ?? undefined,
      detail: `Klaim medis ${docNo} — ${preview.fullName} (${preview.typeCode}): approved ${totalApproved.toLocaleString("id-ID")}`,
    },
  });
  // Approval berjenjang (Task 25): nominal = total tagihan (besaran benefit) —
  // jenjang bersyarat nominal aktif hanya bila tagihan masuk rentang.
  let approvalLevels = 0;
  let firstApprover: string | null = null;
  if (state === "Submitted") {
    const chain = await startApprovalChain(db, {
      docType: "Medical", docId: claim.id, employeeId: input.employeeId,
      amount: totalBill, createdBy: actorId,
    });
    approvalLevels = chain.totalLevels;
    firstApprover = chain.steps[0]?.approverLabel ?? null;
  }
  return {
    id: claim.id, docNo, state,
    totalBill, totalReimburse: totalRe, totalApproved,
    totalNonRe: round2(totalBill - totalApproved),
    remainingAfter: avail.available,
    approvalLevels, firstApprover,
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
  /** ringkasan jalur approval berjenjang (Task 25) */
  approval: ChainSummary | null;
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
  const chainMap = await attachChainSummaries(db, "Medical", rows.map((r) => ({ id: r.id })));
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
    statusLog: parseStatusLog(c.statusLog),
    approval: chainMap.get(c.id) ?? null,
  }));
}

/** statusLog lama tersimpan sebagai STRING JSON (kode lama menulis
 *  JSON.stringify) — parse kedua bentuk supaya riwayat tampil utuh. */
function parseStatusLog(raw: unknown): StatusEntry[] {
  if (Array.isArray(raw)) return raw as StatusEntry[];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as StatusEntry[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ---- jurnal settlement (pola klaim travel) ----

interface JournalLineDraft {
  accountCode: string;
  accountName: string;
  position: "Debit" | "Credit";
  amount: number;
  memo: string;
}

// Fix audit 40 K-1 — nested $transaction: Prisma tx tidak punya $transaction;
// pakai nextJournalNoInTx + seluruh akses (baca klaim/jurnal/akun + insert jurnal)
// via tx sehingga alokasi nomor jurnal + insert + mutasi settle atomik dalam
// $transaction decideClaim (advisory lock jurnal ditahan sampai commit).
async function generateSettleJournal(
  tx: Prisma.TransactionClient,
  claimId: string,
): Promise<{ journalNo: string; journalDate: Date; lines: number; total: number }> {
  const claim = await tx.medicalClaim.findUnique({
    where: { id: claimId },
    include: { lines: true, employee: { select: { fullName: true } }, type: { select: { code: true, name: true } } },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  if (claim.journalNo) {
    await tx.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
  }
  const drafts: JournalLineDraft[] = [];
  const acc = await tx.account.findUnique({ where: { code: MEDICAL_EXPENSE_ACC.code } });
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
  // Fix audit 40 K-1: nomor jurnal dialokasikan DI DALAM tx (varian InTx) —
  // pemanggilan nextJournalNo lama memicu tx.$transaction (tidak ada di
  // TransactionClient) → TypeError "db.$transaction is not a function" →
  // seluruh settle rollback (klaim stuck Approved, jurnal tak pernah lahir).
  const journalNo = await nextJournalNoInTx(tx);
  const journalDate = new Date();
  // 28-c: total & baris jurnal disimpan TERENKRIPSI (enc:v1:n:…).
  // (client tx Prisma 6.11 tetap membaca brand schema → konteks crypto valid)
  const tcJ = tenantCryptoForDb(tx);
  await tx.payrollJournal.create({
    data: {
      journalNo, journalDate, runId: null, runNo: claim.docNo,
      description: `Klaim medis ${claim.docNo} — ${claim.employee.fullName} (${claim.type.name})`,
      totalDebit: tcJ.encryptMoney(total), totalCredit: tcJ.encryptMoney(total), status: "Posted",
      lines: {
        create: drafts.map((d, i) => ({
          sequence: i + 1, accountCode: d.accountCode, accountName: d.accountName,
          position: d.position, amount: tcJ.encryptMoney(d.amount), memo: d.memo,
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
  /** Khusus seeder/migrasi demo: izinkan approve/settle klaim over-limit melewati
   *  guard re-check K-1/K-2 (API TIDAK memetakan flag ini — operasi bisnis normal
   *  tetap ditolak 400). */
  allowOverLimit?: boolean;
  /** aktor sesi (otorisasi & jejak jenjang approval berjenjang — Task 25) */
  actor?: DecideActor;
}

export interface DecideClaimResult {
  docNo: string;
  state: string;
  journalNo: string | null;
  journalLines: number;
  usedAdded: number;
  remaining: number;
  /** (additive, fix K-3) pool yang dipotong saat settle — "employee" | "dependent". */
  usedPool?: "employee" | "dependent";
  /** info jenjang berjenjang — ada bila masih ada jenjang berikutnya (Task 25) */
  approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null };
}

/** Operasi klaim — padanan Operation: Submit | Return To Requester |
 *  Approve | Reject | Cancel | Settle. Settle = jurnal + saldo used bertambah.
 *
 *  Fix audit K-1/K-2/K-3: approve & settle RE-CHECK sisa plafon pool yang benar
 *  (termasuk klaim menunggu lain) — saldo dapat berubah sejak submit (klaim lain
 *  di-settle, transfer UMC mencairkan seluruh saldo, adjustment). Settle dibungkus
 *  $transaction (jurnal + saldo + klaim + log atomik — backlog m-7). */
export async function decideClaim(db: TenantDb, input: DecideClaimInput, actorId: string): Promise<DecideClaimResult> {
  const claim = await db.medicalClaim.findUnique({
    where: { id: input.claimId },
    include: {
      type: { select: { code: true, name: true, dependentEnabled: true, depLimitRule: true } },
      employee: { select: { fullName: true } },
    },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");

  // statusLog historis ditulis sebagai STRING JSON oleh kode lama — parse kedua
  // bentuk supaya riwayat transisi tidak hilang saat operasi berikutnya.
  const log: StatusEntry[] = [...parseStatusLog(claim.statusLog)];
  const pushLog = (state: string) => log.push(logEntry(state, actorId, input.note));
  let journalNo = claim.journalNo;
  let journalLines = 0;
  let usedAdded = 0;
  let useDepPool = false;
  let poolLabel = "plafon karyawan";

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

  // ==== Approval berjenjang (Task 25) — nominal = total tagihan ====
  // submit → pastikan chain ada; approve/reject/cancel → putuskan jenjang saat ini.
  // approve jenjang menengah: klaim tetap Submitted; jenjang terakhir → alur lama.
  if (input.action === "submit") {
    await startApprovalChain(db, {
      docType: "Medical", docId: claim.id, employeeId: claim.employeeId,
      amount: claim.totalBill, createdBy: actorId,
    });
  }
  let chainInfo: { currentLevel: number; totalLevels: number; currentApprover: string | null } | undefined;
  if (["approve", "reject", "cancel"].includes(input.action)) {
    let chain = await getApprovalChain(db, "Medical", claim.id);
    if (!chain) {
      chain = await startApprovalChain(db, {
        docType: "Medical", docId: claim.id, employeeId: claim.employeeId,
        amount: claim.totalBill, createdBy: "legacy-backfill",
      });
    }
    if (chain.status === "InProgress" && ["Submitted", "Returned"].includes(claim.state)) {
      const actor: DecideActor = input.actor ?? { role: "ADMIN", employeeId: null, name: actorId || "Sistem" };
      const res = await decideApprovalChain(db, {
        docType: "Medical", docId: claim.id, action: input.action as "approve" | "reject" | "cancel", note: input.note, actor,
      });
      if (!res.final) {
        // jenjang menengah disetujui — klaim tetap Submitted menunggu jenjang berikutnya
        const currentStep = res.chain.steps.find((s) => s.status === "Current");
        const middleLog = [...log, logEntry("Submitted", actorId, `Jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui — menunggu ${currentStep?.approverLabel ?? "jenjang berikutnya"}`)];
        await db.medicalClaim.update({
          where: { id: claim.id },
          data: { statusLog: middleLog as unknown as Prisma.InputJsonValue },
        });
        chainInfo = {
          currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
          currentApprover: currentStep?.approverLabel ?? null,
        };
        return { docNo: claim.docNo, state: "Submitted", journalNo: null, journalLines: 0, usedAdded: 0, remaining: 0, approval: chainInfo };
      }
      // jenjang terakhir / reject / cancel → lanjut alur lama di bawah
    }
  }

  let newState = claim.state;
  if (input.action === "submit") { newState = "Submitted"; pushLog("Submitted"); }
  if (input.action === "return") { newState = "Returned"; pushLog("Returned"); }

  // ---- K-2(a)/K-1 (fix audit): approve RE-CHECK saldo — saldo bisa berubah sejak
  // submit (klaim lain settle / transfer UMC mencairkan saldo / adjustment). Tanpa
  // ini klaim atas saldo yang sudah ditransfer masih bisa di-approve → double pay
  // (bukti live MC-2026-006 atas saldo RAWAT_JALAN yang sudah dicairkan UMC).
  if (input.action === "approve") {
    const avail = await claimPoolAvailability(db, {
      employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year,
      forDependent: claim.forDependent, excludeClaimId: claim.id,
    });
    poolLabel = avail.pool === "dependent" ? "plafon dependent" : "plafon karyawan";
    if (!input.allowOverLimit && claim.totalApproved > avail.available) {
      throw new Error(
        `Approve ditolak: total approved Rp ${fmtRp(claim.totalApproved)} melebihi sisa ${poolLabel} Rp ${fmtRp(avail.available)}` +
        ` — saldo berubah sejak pengajuan (snapshot sisa saat ajukan Rp ${fmtRp(round2(claim.maxBenefitAt - claim.usedAt))}` +
        (avail.pendingOthers > 0 ? `, klaim lain menunggu Rp ${fmtRp(avail.pendingOthers)}` : "") +
        "). Selesaikan/putuskan klaim lain atau ajukan penyesuaian saldo terlebih dahulu",
      );
    }
    newState = "Approved"; pushLog("Approved");
  }
  if (input.action === "reject") { newState = "Rejected"; pushLog("Rejected"); }
  if (input.action === "cancel") {
    newState = "Cancelled"; pushLog("Cancelled");
    if (claim.state === "Settled" || claim.journalNo) throw new Error("Klaim sudah settled — tidak bisa dibatalkan");
    journalNo = null;
  }
  if (input.action === "settle") {
    newState = "Settled";
    pushLog("Settled");
    // ---- K-1/K-2 (fix audit): re-check TERAKHIR sebelum membayar jurnal — menutup
    // (a) klaim over-limit lolos approve lalu settle bayar penuh (bukti live
    // MC-2026-005: approved 11,5jt vs maxBenefit 8,5jt); (b) double pay atas saldo
    // yang sudah dicairkan via transfer UMC.
    const avail = await claimPoolAvailability(db, {
      employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year,
      forDependent: claim.forDependent, excludeClaimId: claim.id,
    });
    poolLabel = avail.pool === "dependent" ? "plafon dependent" : "plafon karyawan";
    if (!input.allowOverLimit && claim.totalApproved > avail.available) {
      throw new Error(
        `Settle ditolak — jurnal TIDAK dibuat: total approved Rp ${fmtRp(claim.totalApproved)} melebihi sisa ${poolLabel} Rp ${fmtRp(avail.available)}` +
        (avail.pendingOthers > 0 ? ` (klaim lain menunggu Rp ${fmtRp(avail.pendingOthers)})` : "") +
        " — saldo berubah sejak pengajuan (dipakai klaim lain / ditransfer ke payroll UMC / adjustment). Sesuaikan klaim atau ajukan penyesuaian saldo",
      );
    }
    const bal = await db.medicalBalance.findUnique({
      where: { employeeId_typeId_year: { employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year } },
    });
    if (!bal) {
      // m-5: tanpa saldo, pemakaian tidak tercatat & jurnal tetap terbayar — tolak.
      throw new Error(
        `Settle ditolak: saldo medis tahun ${claim.year} belum digenerate untuk karyawan ini — generate saldo dulu agar pemakaian tercatat`,
      );
    }
    // K-3 (fix audit): klaim dependent jenis SHARED memotong POOL UTAMA karyawan
    // (depBenefit 0 → depUsed tidak pernah mengurangi plafon bersama); pool
    // dependent terpisah (EACH/TOTAL) tetap memotong depUsed.
    useDepPool = claim.forDependent && depPoolSeparate(claim.type);
    usedAdded = claim.totalApproved;
    const settleDate = new Date();
    // $transaction (backlog m-7 — murah dibungkus sekalian): jurnal + saldo +
    // klaim + activity log atomik — crash mid-flight tidak lagi meninggalkan
    // jurnal tanpa pemakaian saldo.
    // Fix audit 40 K-1 — generateSettleJournal kini menerima tx langsung
    // (semua mutasi settle di bawah memakai tx — lihat generateSettleJournal).
    await db.$transaction(async (tx) => {
      const j = await generateSettleJournal(tx, claim.id);
      journalNo = j.journalNo || null;
      journalLines = j.lines;
      await tx.medicalBalance.update({
        where: { id: bal.id },
        data: useDepPool
          ? { depUsed: round2(bal.depUsed + usedAdded) }
          : { usedAmount: round2(bal.usedAmount + usedAdded) },
      });
      await tx.medicalClaim.update({
        where: { id: claim.id },
        data: {
          state: newState,
          statusLog: log as unknown as Prisma.InputJsonValue,
          journalNo, journalDate: journalNo ? new Date() : null,
          settleDate,
          settledById: actorId,
          decisionNote: input.note ?? claim.decisionNote,
        },
      });
      // Fix audit 40 M-05 — aktor keputusan (appUserId/employeeId) ikut tercatat
      await tx.activityLog.create({
        data: {
          action: "Processed", entity: "MedicalClaim", entityId: claim.id,
          appUserId: input.actor?.appUserId ?? undefined,
          employeeId: input.actor?.employeeId ?? undefined,
          detail: `Klaim ${claim.docNo} → ${newState}${input.note ? ` (${input.note})` : ""}${journalNo ? ` — jurnal ${journalNo} (${journalLines} baris)` : ""}`,
        },
      });
    });
  }

  if (input.action !== "settle") {
    await db.medicalClaim.update({
      where: { id: claim.id },
      data: {
        state: newState,
        statusLog: log as unknown as Prisma.InputJsonValue,
        journalNo, journalDate: journalNo ? new Date() : null,
        settleDate: claim.settleDate,
        settledById: claim.settledById,
        decidedById: ["approve", "reject", "cancel"].includes(input.action) ? actorId : claim.decidedById,
        decidedAt: ["approve", "reject", "cancel"].includes(input.action) ? new Date() : claim.decidedAt,
        decisionNote: input.note ?? claim.decisionNote,
      },
    });

    // Fix audit 40 M-05 — aktor keputusan (appUserId/employeeId) ikut tercatat
    await db.activityLog.create({
      data: {
        action: "Updated", entity: "MedicalClaim", entityId: claim.id,
        appUserId: input.actor?.appUserId ?? undefined,
        employeeId: input.actor?.employeeId ?? undefined,
        detail: `Klaim ${claim.docNo} → ${newState}${input.note ? ` (${input.note})` : ""}${journalNo ? ` — jurnal ${journalNo} (${journalLines} baris)` : ""}`,
      },
    });
  }

  // remaining utk respon = pool yang benar (K-3)
  const balAfter = await db.medicalBalance.findUnique({
    where: { employeeId_typeId_year: { employeeId: claim.employeeId, typeId: claim.typeId, year: claim.year } },
  });
  const remaining = balAfter
    ? (useDepPool
        ? round2(balAfter.depBenefitAmount + balAfter.depAdjustment - balAfter.depUsed)
        : round2(balAfter.benefitAmount + balAfter.adjustmentAmount + balAfter.carriedOver - balAfter.usedAmount - balAfter.initialUsed))
    : 0;
  return { docNo: claim.docNo, state: newState, journalNo, journalLines, usedAdded, remaining, usedPool: useDepPool ? "dependent" : "employee" };
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
  // K-3 (paritet validasi klaim): jenis harus aktif; penyesuaian dependent hanya
  // untuk jenis yang mengaktifkan dependent (mis. KHUSUS_PJK tolak dependent).
  const t = await db.medicalBenefitType.findUnique({
    where: { id: input.typeId },
    select: { code: true, active: true, dependentEnabled: true },
  });
  if (!t || !t.active) throw new Error("Jenis benefit tidak aktif");
  if (input.forDependent && !t.dependentEnabled) {
    throw new Error(`Jenis ${t.code} tidak mengaktifkan penyesuaian dependent`);
  }
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
  const adj = await db.medicalAdjustment.findUnique({
    where: { id: input.adjustmentId },
    include: { type: { select: { code: true, dependentEnabled: true, depLimitRule: true } } },
  });
  if (!adj) throw new Error("Penyesuaian tidak ditemukan");
  if (adj.state !== "Submitted") throw new Error(`Status ${adj.state} tidak bisa diproses`);
  if (input.action === "approve") {
    const bal = await db.medicalBalance.findUnique({
      where: { employeeId_typeId_year: { employeeId: adj.employeeId, typeId: adj.typeId, year: adj.year } },
    });
    if (!bal) throw new Error("Saldo tidak ditemukan");
    // K-3 (penyelesaian sisa): penyesuaian dependent pada jenis SHARED → POOL
    // UTAMA karyawan (depBenefit 0 → depAdjustment tidak pernah menambah plafon
    // yang benar-benar dipakai klaim dependent SHARED); depAdjustment hanya untuk
    // pool dependent terpisah (EACH/TOTAL_SEPARATE) — konsisten dengan settle
    // klaim (useDepPool = forDependent && depPoolSeparate).
    const useDepPool = adj.forDependent && depPoolSeparate(adj.type);
    await db.medicalBalance.update({
      where: { id: bal.id },
      data: useDepPool
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

// ============ transfer sisa saldo ke payroll (padanan cash_wage_code) ============

export interface MedTransferResult {
  periodName: string;
  employees: number;
  rows: number;
  totalAmount: number;
  removed: number;
}

/** Transfer UMC memakai identitas aktor sesi — fix audit 40 M-05 (appUserId di
 *  ActivityLog) — opsional supaya seeder/script lama tetap kompatibel. */
export interface MedTransferActor {
  name?: string;
  appUserId?: string | null;
}

/** Sisa saldo jenis unusedRule=CASH akhir tahun → komponen Specific UMC (Earning
 *  Compensation). Idempoten: assignment UMC period dibuang lalu ditulis ulang. */
export async function transferUnusedToPayroll(
  db: TenantDb,
  input: { periodId: string; year: number; processTypeCode?: string; actor?: MedTransferActor },
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

  // Fix audit 40 M-7 (mirror guard travel transferClaimsToPayroll): period yang
  // sudah punya run Confirmed/Paid utk processType target tidak boleh menerima
  // transfer — saldo CASH sudah dikonsumsi + assignment UMC dibuat SETELAH run
  // di-snapshot/dihitung → tidak pernah masuk run → saldo hangus diam-diam tanpa
  // jalur recovery (M-08 lama; travel sudah fixed, medical kini menyusul).
  const doneRuns = await db.payrollRun.count({
    where: { periodId: period.id, processTypeId: pt.id, status: { in: ["Confirmed", "Paid"] } },
  });
  if (doneRuns > 0) {
    throw new Error(
      `Period ${period.name} sudah memiliki run payroll yang dikonfirmasi/dibayar — sisa saldo yang ditransfer ke sini tidak akan pernah dibayar. ` +
      "Pilih period yang run-nya belum dikonfirmasi",
    );
  }

  const types = await db.medicalBenefitType.findMany({ where: { active: true, unusedRule: "CASH" } });
  if (types.length === 0) throw new Error("Tidak ada jenis benefit dengan kebijakan saldo CASH");
  const typeIds = types.map((t) => t.id);

  // ---- K-2(b) (fix audit): tolak bila masih ada klaim menunggu keputusan/
  // settlement atas jenis CASH tahun ini — transfer mengonsumsi seluruh sisa saldo,
  // klaim itu kehilangan plafonnya (double pay bila tetap di-approve & settle).
  const pendingClaims = await db.medicalClaim.findMany({
    where: { year: input.year, typeId: { in: typeIds }, state: { in: PENDING_CLAIM_STATES } },
    select: { docNo: true },
    orderBy: { docNo: "asc" },
    take: 20,
  });
  if (pendingClaims.length > 0) {
    throw new Error(
      `Tidak bisa menarik sisa saldo tahun ${input.year}: masih ada klaim medis menunggu keputusan/settlement atas jenis CASH ` +
      `(${pendingClaims.map((p) => p.docNo).join(", ")}${pendingClaims.length === 20 ? "…" : ""}) — ` +
      "approve & settle atau tolak/batalkan dulu, baru tarik sisa saldo",
    );
  }

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
        // 28-c: nilai komponen disimpan TERENKRIPSI (enc:v1:n:…).
        kind: "Specific", amount: tenantCryptoForDb(db).encryptMoney(v.amount),
        periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
        notes: `Uang sisa saldo medis ${input.year}: ${v.detail.join(", ")}`,
        active: true,
      },
    });
    employees.add(empId);
    total += v.amount;
  }

  // saldo CASH dikonsumsi saat ditransfer (used bertambah) — mencegah transfer
  // ganda ke period lain (padanan: saldo hangus saat dibayar tunai).
  for (const r of rows) {
    const bal = balances.find((b) => b.id === r.balanceId);
    if (!bal) continue;
    await db.medicalBalance.update({
      where: { id: r.balanceId },
      data: { usedAmount: round2(bal.usedAmount + r.remaining) },
    });
  }

  // Fix audit 40 M-05 — aktor transfer (appUserId) ikut tercatat di ActivityLog
  await db.activityLog.create({
    data: {
      action: "Processed", entity: "MedicalTransfer", entityId: period.id,
      appUserId: input.actor?.appUserId ?? undefined,
      detail: `Transfer sisa saldo medis ${input.year} → ${period.name}: ${employees.size} karyawan, total ${total.toLocaleString("id-ID")}`,
    },
  });
  return { periodName: period.name, employees: employees.size, rows: rows.length, totalAmount: total, removed: removed.count };
}

/** Dipanggil confirmRun() (fix audit M-3/M-05): menandai objek yang BENAR-BENAR
 *  ditulis transferUnusedToPayroll — yaitu assignment komponen UMC per karyawan
 *  (saldo CASH → run item). Callback LAMA mem-filter medicalClaim.periodCode yang
 *  tidak pernah diisi kode mana pun → selalu no-op (paidRunNo 11/11 NULL).
 *  Karena schema tidak punya kolom paidRunNo pada EmployeeComponentAssignment,
 *  penanda "Dibayar via run {runNo}" ditulis pada notes assignment tersebut
 *  (idempoten: per run hanya sekali; re-transfer menulis ulang notes bersih).
 *  Hanya run SALARY; hanya karyawan yang benar-benar menerima item UMC di run
 *  (inspeksi PayrollRunItem via run.lines). */
export async function markMedicalPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true, processType: true,
      lines: { select: { employeeId: true, items: { select: { code: true } } } },
    },
  });
  if (!run || run.processType.code !== "SALARY") return 0;

  const comp = await db.wageComponent.findUnique({ where: { code: "UMC" } });
  if (!comp) return 0;

  // karyawan yang benar-benar menerima UMC di run ini (assignment → run item)
  const paidEmployees = run.lines
    .filter((l) => l.items.some((i) => i.code === "UMC"))
    .map((l) => l.employeeId);
  if (paidEmployees.length === 0) return 0;

  // assignment UMC transfer medis pada period+processType run ini; skip yang
  // sudah bertanda runNo ini (idempoten).
  const targets = (await db.employeeComponentAssignment.findMany({
    where: {
      wageComponentId: comp.id, kind: "Specific",
      periodId: run.periodId, processTypeId: run.processTypeId,
      employeeId: { in: paidEmployees },
      notes: { contains: "sisa saldo medis" },
    },
    select: { id: true, notes: true },
  })).filter((a) => !(a.notes ?? "").includes(run.runNo));

  for (const a of targets) {
    await db.employeeComponentAssignment.update({
      where: { id: a.id },
      data: { notes: `${(a.notes ?? "").trim()} — Dibayar via run ${run.runNo}`.trim() },
    });
  }
  if (targets.length > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "MedicalTransfer", entityId: runId,
        detail: `${targets.length} assignment UMC (transfer sisa saldo medis) ditandai Dibayar via run ${run.runNo} (${run.period.name})`,
      },
    });
  }
  return targets.length;
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
