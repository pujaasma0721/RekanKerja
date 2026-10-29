// OneVity Travel Service (ref: ANALISA-TRAVEL.md — modul Travel Administration oranHR).
// Alur: Travel Request (destinasi + advance) → approval → Travel Claim / Settlement
// (rincian biaya per jenis: General/Allowance/Mileage/Entertainment) → approval →
// jurnal otomatis → TRANSFER ke payroll (UTRP bayar / TRVSTLIN potong) → Paid.
// Formula settlement oranHR dipertahankan:
//   totalSettlement = (a otherCompanyExp + a exchangeLoss) + (b payableEmployee) − (c payableCompany)
import { TenantDb } from "./tenant-db";

// ============ util ============

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const dayStart = (d: Date | string) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Nomor dokumen per prefix (TR/CL) — max-suffix per model (aman terhadap baris terhapus). */
async function nextDocNo(db: TenantDb, prefix: "TR" | "CL"): Promise<string> {
  const year = new Date().getFullYear();
  const start = `${prefix}-${year}-`;
  let max = 0;
  const rows = prefix === "TR"
    ? await db.travelRequest.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } })
    : await db.travelClaim.findMany({ where: { docNo: { startsWith: start } }, select: { docNo: true } });
  for (const r of rows) {
    const n = parseInt(r.docNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${year}-${String(max + 1).padStart(3, "0")}`;
}

// ============ master (padanan General Setting oranHR) ============

export interface TemplateRow {
  id: string; code: string; name: string; isDefault: boolean; description: string | null;
  settlementDay: number; settlementMethod: string; active: boolean;
  requestCount: number; claimCount: number;
}

export async function listTemplates(db: TenantDb): Promise<TemplateRow[]> {
  const rows = await db.travelTemplate.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { requests: true, claims: true } } } });
  return rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, isDefault: t.isDefault, description: t.description,
    settlementDay: t.settlementDay, settlementMethod: t.settlementMethod, active: t.active,
    requestCount: t._count.requests, claimCount: t._count.claims,
  }));
}

export async function upsertTemplate(
  db: TenantDb,
  input: { id?: string; code: string; name: string; description?: string; settlementDay: number; settlementMethod: string; isDefault?: boolean },
): Promise<string> {
  if (input.isDefault) {
    await db.travelTemplate.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  }
  if (input.id) {
    await db.travelTemplate.update({
      where: { id: input.id },
      data: {
        name: input.name, description: input.description ?? null,
        settlementDay: Math.max(0, Math.round(input.settlementDay)),
        settlementMethod: input.settlementMethod, isDefault: Boolean(input.isDefault),
      },
    });
    return input.id;
  }
  const t = await db.travelTemplate.create({
    data: {
      code: input.code.trim().toUpperCase(), name: input.name.trim(),
      description: input.description ?? null,
      settlementDay: Math.max(0, Math.round(input.settlementDay)),
      settlementMethod: input.settlementMethod, isDefault: Boolean(input.isDefault),
    },
  });
  return t.id;
}

export interface ExpenseTypeRow {
  id: string; code: string; name: string; kind: string; description: string | null;
  needDocs: boolean; limitAmount: number; unlimited: boolean; currency: string;
  compWageCode: string | null; debitAccount: string | null; creditAccount: string | null; active: boolean;
}

export async function listExpenseTypes(db: TenantDb): Promise<ExpenseTypeRow[]> {
  const rows = await db.travelExpenseType.findMany({ orderBy: [{ kind: "asc" }, { code: "asc" }] });
  return rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, kind: t.kind, description: t.description,
    needDocs: t.needDocs, limitAmount: t.limitAmount, unlimited: t.unlimited, currency: t.currency,
    compWageCode: t.compWageCode, debitAccount: t.debitAccount, creditAccount: t.creditAccount, active: t.active,
  }));
}

export async function upsertExpenseType(
  db: TenantDb,
  input: {
    id?: string; code: string; name: string; kind: string; description?: string;
    limitAmount: number; unlimited?: boolean; needDocs?: boolean;
    debitAccount?: string; creditAccount?: string; compWageCode?: string;
  },
): Promise<string> {
  const kind = ["GENERAL", "ALLOWANCE", "MILEAGE", "ENTERTAINMENT"].includes(input.kind) ? input.kind : "GENERAL";
  if (input.id) {
    await db.travelExpenseType.update({
      where: { id: input.id },
      data: {
        name: input.name, kind, description: input.description ?? null,
        limitAmount: Math.max(0, input.limitAmount), unlimited: Boolean(input.unlimited),
        needDocs: Boolean(input.needDocs),
        debitAccount: input.debitAccount?.trim() || null, creditAccount: input.creditAccount?.trim() || null,
        compWageCode: input.compWageCode?.trim() || null,
      },
    });
    return input.id;
  }
  const t = await db.travelExpenseType.create({
    data: {
      code: input.code.trim().toUpperCase(), name: input.name.trim(), kind,
      description: input.description ?? null, needDocs: Boolean(input.needDocs),
      limitAmount: Math.max(0, input.limitAmount), unlimited: Boolean(input.unlimited),
      debitAccount: input.debitAccount?.trim() || null, creditAccount: input.creditAccount?.trim() || null,
      compWageCode: input.compWageCode?.trim() || null,
    },
  });
  return t.id;
}

export async function listZones(db: TenantDb) {
  return db.travelZone.findMany({ orderBy: { code: "asc" } });
}

// ============ travel request (padanan TravelRequest.jsp + Destination + Cash Advance) ============

export interface DestinationInput {
  dateFrom: string | Date;
  dateTo: string | Date;
  city: string;
  country?: string;
  zoneCode?: string;
  overseas?: boolean;
  note?: string;
}

export interface SubmitTravelRequestInput {
  employeeId: string;
  templateCode: string;
  dateFrom: string | Date;
  dateTo: string | Date;
  purpose: string;
  remark?: string;
  costCenter?: string;
  destinations: DestinationInput[];
  advanceAmount?: number;
  advanceNote?: string;
}

export interface SubmitTravelRequestResult {
  docNo: string;
  destinations: number;
  days: number;
  advanceAmount: number;
  settlementDue: string | null;
}

export async function submitTravelRequest(db: TenantDb, input: SubmitTravelRequestInput): Promise<SubmitTravelRequestResult> {
  if (!input.purpose?.trim()) throw new Error("Tujuan perjalanan wajib diisi");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const template = await db.travelTemplate.findFirst({ where: { code: input.templateCode, active: true } });
  if (!template) throw new Error(`Template ${input.templateCode} tidak ditemukan / tidak aktif`);

  const from = dayStart(input.dateFrom);
  const to = dayStart(input.dateTo);
  if (to < from) throw new Error("Tanggal selesai sebelum tanggal mulai");
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > 60) throw new Error("Perjalanan lebih dari 60 hari — hubungi HR (validasi manual)");

  if (!input.destinations?.length) throw new Error("Minimal 1 destinasi perjalanan");
  const zones = await db.travelZone.findMany();
  const zoneByCode = new Map(zones.map((z) => [z.code, z]));

  // cost center default dari unit organisasi assignment aktif karyawan
  let costCenter = input.costCenter?.trim() || null;
  if (!costCenter) {
    const assign = await db.employeeAssignment.findFirst({
      where: { employeeId: emp.id, validTo: null },
      select: { orgUnit: { select: { name: true } } },
    });
    costCenter = assign?.orgUnit?.name ?? null;
  }

  const docNo = await nextDocNo(db, "TR");
  const req = await db.travelRequest.create({
    data: {
      docNo, employeeId: emp.id, requestDate: new Date(),
      dateFrom: from, dateTo: to, templateId: template.id,
      costCenter, purpose: input.purpose.trim(), remark: input.remark?.trim() || null,
      status: "Submitted",
      destinations: {
        create: input.destinations.map((d, i) => {
          const df = dayStart(d.dateFrom);
          const dt = dayStart(d.dateTo);
          const zone = d.zoneCode ? zoneByCode.get(d.zoneCode) : undefined;
          return {
            seq: i + 1, dateFrom: df, dateTo: dt,
            city: d.city.trim(), country: d.country?.trim() || "Indonesia",
            zoneId: zone?.id ?? null,
            overseas: d.overseas ?? zone?.overseas ?? false,
            note: d.note?.trim() || null,
          };
        }),
      },
    },
  });

  const advanceAmount = Math.max(0, input.advanceAmount ?? 0);
  if (advanceAmount > 0) {
    await db.travelAdvance.create({
      data: { requestId: req.id, amount: advanceAmount, note: input.advanceNote?.trim() || null },
    });
  }

  // jatuh tempo settlement = tanggal kembali + settlement day template (padanan oranHR)
  const dueDate = new Date(to);
  dueDate.setDate(dueDate.getDate() + template.settlementDay);

  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "TravelRequest", entityId: docNo,
      detail: `${docNo}: ${emp.fullName} — ${template.name} ${fmtDate(from)} → ${fmtDate(to)} (${input.destinations.length} destinasi${advanceAmount > 0 ? `, advance ${advanceAmount}` : ""})`,
    },
  });
  return {
    docNo, destinations: input.destinations.length, days,
    advanceAmount, settlementDue: template.settlementDay > 0 ? dueDate.toISOString() : null,
  };
}

export interface TravelRequestRow {
  id: string; docNo: string; employeeId: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; requestDate: Date; dateFrom: Date; dateTo: Date; days: number;
  templateCode: string; templateName: string; costCenter: string | null; purpose: string;
  remark: string | null; status: string; claimRequestedAt: Date | null;
  decidedAt: Date | null; decisionNote: string | null;
  destinations: { seq: number; city: string; country: string; dateFrom: Date; dateTo: Date; overseas: boolean; zoneName: string | null }[];
  advanceAmount: number;
  claimCount: number;
  settlementDue: Date | null;
  overdue: boolean;
}

export async function listTravelRequests(db: TenantDb, opts: { status?: string; employeeId?: string } = {}): Promise<TravelRequestRow[]> {
  const where: { status?: string; employeeId?: string } = {};
  if (opts.status && opts.status !== "all") where.status = opts.status;
  if (opts.employeeId) where.employeeId = opts.employeeId;
  const rows = await db.travelRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
      template: true,
      destinations: { orderBy: { seq: "asc" }, include: { zone: true } },
      advances: true,
      claims: { select: { id: true } },
    },
  });
  return rows.map((r) => {
    const advanceAmount = r.advances.reduce((s, a) => s + a.amount, 0);
    const due = new Date(r.dateTo);
    due.setDate(due.getDate() + r.template.settlementDay);
    return {
      id: r.id, docNo: r.docNo,
      employeeId: r.employeeId, employeeNo: r.employee.employeeNo, fullName: r.employee.fullName,
      orgUnitName: r.employee.assignments[0]?.orgUnit?.name ?? null,
      requestDate: r.requestDate, dateFrom: r.dateFrom, dateTo: r.dateTo,
      days: Math.round((dayStart(r.dateTo).getTime() - dayStart(r.dateFrom).getTime()) / 86_400_000) + 1,
      templateCode: r.template.code, templateName: r.template.name,
      costCenter: r.costCenter, purpose: r.purpose, remark: r.remark,
      status: r.status, claimRequestedAt: r.claimRequestedAt,
      decidedAt: r.decidedAt, decisionNote: r.decisionNote,
      destinations: r.destinations.map((d) => ({
        seq: d.seq, city: d.city, country: d.country, dateFrom: d.dateFrom, dateTo: d.dateTo,
        overseas: d.overseas, zoneName: d.zone?.name ?? null,
      })),
      advanceAmount,
      claimCount: r.claims.length,
      settlementDue: r.template.settlementDay > 0 ? due : null,
      overdue: r.template.settlementDay > 0 && r.status === "Approved" && !r.claimRequestedAt && due.getTime() < Date.now(),
    };
  });
}

export interface DecideResult {
  docNo: string;
  status: string;
}

export async function decideTravelRequest(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string },
): Promise<DecideResult> {
  const req = await db.travelRequest.findUnique({ where: { id: input.id }, include: { template: true } });
  if (!req) throw new Error("Permintaan travel tidak ditemukan");

  const map: Record<string, { to: string; from: string[]; log: string }> = {
    approve: { to: "Approved", from: ["Submitted"], log: "Disetujui" },
    reject: { to: "Rejected", from: ["Submitted", "Approved"], log: "Ditolak" },
    cancel: { to: "Cancelled", from: ["Submitted", "Approved"], log: "Dibatalkan" },
  };
  const m = map[input.action];
  if (!m) throw new Error("Aksi tidak dikenal");
  if (!m.from.includes(req.status)) throw new Error(`Status ${req.status} tidak bisa ${m.log.toLowerCase()}`);

  // batalkan klaim yang belum diputus bila request dibatalkan/ditolak setelah ada klaim draft
  if (input.action !== "approve") {
    await db.travelClaim.updateMany({
      where: { requestId: req.id, status: { in: ["Submitted"] } },
      data: { status: "Cancelled" },
    });
  }

  await db.travelRequest.update({
    where: { id: req.id },
    data: {
      status: m.to,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    },
  });
  await db.activityLog.create({
    data: {
      action: m.log, entity: "TravelRequest", entityId: req.docNo,
      detail: `${req.docNo} ${m.log}${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { docNo: req.docNo, status: m.to };
}

// ============ claim / settlement (padanan TravelClaim.jsp) ============

export interface ClaimPreview {
  requestId: string | null;
  docNo: string | null;
  employee: { id: string; employeeNo: string; fullName: string } | null;
  templateCode: string | null;
  templateName: string | null;
  settlementMethod: string | null;
  costCenter: string | null;
  purpose: string | null;
  destinations: { city: string; country: string; dateFrom: Date; dateTo: Date; overseas: boolean }[];
  advanceAmount: number;
  expenseTypes: ExpenseTypeRow[];
  suggested: { totalExpenses: number; payableEmployee: number; payableCompany: number };
}

/** Preview klaim untuk sebuah request Approved — sumber data form klaim. */
export async function previewClaim(db: TenantDb, requestId: string): Promise<ClaimPreview> {
  const req = await db.travelRequest.findUnique({
    where: { id: requestId },
    include: { template: true, destinations: true, advances: true, employee: true },
  });
  if (!req) throw new Error("Permintaan travel tidak ditemukan");
  if (req.status !== "Approved") throw new Error(`Klaim hanya bisa dibuat dari permintaan Approved (status saat ini: ${req.status})`);
  const expenseTypes = await listExpenseTypes(db);
  const advanceAmount = req.advances.reduce((s, a) => s + a.amount, 0);
  return {
    requestId: req.id,
    docNo: req.docNo,
    employee: { id: req.employee.id, employeeNo: req.employee.employeeNo, fullName: req.employee.fullName },
    templateCode: req.template.code,
    templateName: req.template.name,
    settlementMethod: req.template.settlementMethod,
    costCenter: req.costCenter,
    purpose: req.purpose,
    destinations: req.destinations.map((d) => ({ city: d.city, country: d.country, dateFrom: d.dateFrom, dateTo: d.dateTo, overseas: d.overseas })),
    advanceAmount,
    expenseTypes,
    suggested: { totalExpenses: 0, payableEmployee: Math.max(0, -advanceAmount), payableCompany: advanceAmount },
  };
}

export interface ExpenseInput {
  expenseCode: string;
  expenseDate?: string | Date;
  description?: string;
  amount: number;
  qty?: number;
  guestName?: string;
}

export interface CreateClaimInput {
  requestId?: string;
  employeeId: string;
  templateCode: string;
  claimDate?: string | Date;
  costCenter?: string;
  purpose?: string;
  remark?: string;
  voucherNo?: string;
  settlementMethod?: string;
  expenses: ExpenseInput[];
  otherCompanyExp: number;
  exchangeLoss: number;
  payableEmployee: number;
  payableCompany: number;
}

export interface CreateClaimResult {
  docNo: string;
  totalSettlement: number;
  totalExpenses: number;
  overLimitLines: number;
}

export async function createClaim(db: TenantDb, input: CreateClaimInput): Promise<CreateClaimResult> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const template = await db.travelTemplate.findFirst({ where: { code: input.templateCode, active: true } });
  if (!template) throw new Error(`Template ${input.templateCode} tidak ditemukan / tidak aktif`);
  if (!input.expenses?.length) throw new Error("Klaim wajib memuat minimal 1 baris biaya");

  // validasi jenis biaya + limit (padanan Expense Definition Rules — warning, tetap boleh)
  const types = await db.travelExpenseType.findMany();
  const typeByCode = new Map(types.map((t) => [t.code, t]));
  let overLimitLines = 0;
  let totalExpenses = 0;
  for (const e of input.expenses) {
    const t = typeByCode.get(e.expenseCode);
    if (!t || !t.active) throw new Error(`Jenis biaya ${e.expenseCode} tidak ditemukan / tidak aktif`);
    if (e.amount <= 0) throw new Error(`Baris biaya ${e.expenseCode}: nominal harus > 0`);
    if (!t.unlimited && t.limitAmount > 0 && e.amount > t.limitAmount) overLimitLines++;
    totalExpenses += Math.max(0, e.amount);
  }

  // request opsional — klaim mandiri diperbolehkan (padanan oranHR: claim tanpa request)
  let req = null as Awaited<ReturnType<typeof db.travelRequest.findUnique>>;
  if (input.requestId) {
    req = await db.travelRequest.findUnique({ where: { id: input.requestId } });
    if (!req) throw new Error("Permintaan travel tidak ditemukan");
    if (req.employeeId !== input.employeeId) throw new Error("Permintaan travel milik karyawan lain");
  }

  const a = Math.max(0, input.otherCompanyExp);
  const loss = Math.max(0, input.exchangeLoss);
  const b = Math.max(0, input.payableEmployee);
  const c = Math.max(0, input.payableCompany);
  const totalSettlement = round2(a + loss + b - c);

  const docNo = await nextDocNo(db, "CL");
  const claim = await db.travelClaim.create({
    data: {
      docNo,
      requestId: req?.id ?? null,
      employeeId: emp.id,
      claimDate: input.claimDate ? dayStart(input.claimDate) : new Date(),
      templateId: template.id,
      costCenter: input.costCenter?.trim() || req?.costCenter || null,
      purpose: input.purpose?.trim() || req?.purpose || null,
      remark: input.remark?.trim() || null,
      status: "Submitted",
      otherCompanyExp: a, exchangeLoss: loss, payableEmployee: b, payableCompany: c,
      totalSettlement,
      settlementMethod: input.settlementMethod || template.settlementMethod,
      voucherNo: input.voucherNo?.trim() || null,
    },
  });
  await db.travelClaimExpense.createMany({
    data: input.expenses.map((e) => {
      const t = typeByCode.get(e.expenseCode)!;
      const amount = Math.max(0, e.amount);
      return {
        claimId: claim.id, expenseCode: e.expenseCode, kind: t.kind,
        expenseDate: e.expenseDate ? dayStart(e.expenseDate) : null,
        description: e.description?.trim() || null,
        amount, qty: e.qty && e.qty > 0 ? e.qty : 1,
        guestName: e.guestName?.trim() || null,
        overLimit: !t.unlimited && t.limitAmount > 0 && amount > t.limitAmount,
      };
    }),
  });

  if (req && !req.claimRequestedAt) {
    await db.travelRequest.update({ where: { id: req.id }, data: { claimRequestedAt: new Date() } });
  }

  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "TravelClaim", entityId: docNo,
      detail: `${docNo}: ${emp.fullName} — ${input.expenses.length} baris biaya, total settlement ${totalSettlement}${req ? ` (request ${req.docNo})` : ""}`,
    },
  });
  return { docNo, totalSettlement, totalExpenses: round2(totalExpenses), overLimitLines };
}

export interface TravelClaimRow {
  id: string; docNo: string; requestDocNo: string | null; employeeId: string;
  employeeNo: string; fullName: string; orgUnitName: string | null;
  claimDate: Date; templateCode: string; templateName: string; costCenter: string | null;
  purpose: string | null; remark: string | null; status: string;
  otherCompanyExp: number; exchangeLoss: number; payableEmployee: number; payableCompany: number;
  totalSettlement: number; settlementMethod: string; voucherNo: string | null;
  journalNo: string | null; journalDate: Date | null; periodCode: string | null;
  transferredRunNo: string | null; paidRunNo: string | null;
  decidedAt: Date | null; decisionNote: string | null;
  advanceAmount: number;
  totalExpenses: number;
  expenseLines: number;
  overLimitLines: number;
  expenseKinds: string[];
}

export async function listTravelClaims(db: TenantDb, opts: { status?: string; employeeId?: string } = {}): Promise<TravelClaimRow[]> {
  const where: { status?: string; employeeId?: string } = {};
  if (opts.status && opts.status !== "all") where.status = opts.status;
  if (opts.employeeId) where.employeeId = opts.employeeId;
  const rows = await db.travelClaim.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
      template: true,
      request: { select: { docNo: true, advances: true } },
      expenses: true,
    },
  });
  return rows.map((c) => ({
    id: c.id, docNo: c.docNo, requestDocNo: c.request?.docNo ?? null,
    employeeId: c.employeeId, employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    orgUnitName: c.employee.assignments[0]?.orgUnit?.name ?? null,
    claimDate: c.claimDate, templateCode: c.template.code, templateName: c.template.name,
    costCenter: c.costCenter, purpose: c.purpose, remark: c.remark, status: c.status,
    otherCompanyExp: c.otherCompanyExp, exchangeLoss: c.exchangeLoss,
    payableEmployee: c.payableEmployee, payableCompany: c.payableCompany,
    totalSettlement: c.totalSettlement, settlementMethod: c.settlementMethod,
    voucherNo: c.voucherNo, journalNo: c.journalNo, journalDate: c.journalDate,
    periodCode: c.periodCode, transferredRunNo: c.transferredRunNo, paidRunNo: c.paidRunNo,
    decidedAt: c.decidedAt, decisionNote: c.decisionNote,
    advanceAmount: c.request?.advances.reduce((s, a) => s + a.amount, 0) ?? 0,
    totalExpenses: round2(c.expenses.reduce((s, e) => s + e.amount, 0)),
    expenseLines: c.expenses.length,
    overLimitLines: c.expenses.filter((e) => e.overLimit).length,
    expenseKinds: [...new Set(c.expenses.map((e) => e.kind))],
  }));
}

export async function getClaimDetail(db: TenantDb, id: string) {
  const claim = await db.travelClaim.findUnique({
    where: { id },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      template: true,
      request: { include: { destinations: { orderBy: { seq: "asc" }, include: { zone: true } }, advances: true } },
      expenses: { orderBy: [{ expenseDate: "asc" }, { expenseCode: "asc" }] },
    },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  return claim;
}

// ============ jurnal klaim (padanan Expense Chart of Account + Journal No/Type/Date) ============

interface JournalLineDraft {
  accountCode: string;
  accountName: string;
  position: "Debit" | "Credit";
  amount: number;
  memo: string;
  wageCode: string | null;
}

const TRAVEL_EXPENSE_ACC = { code: "5105", name: "Beban Perjalanan Dinas" };
const CASH_ACC = { code: "1101", name: "Kas & Bank" };

async function nextJournalNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JV-${year}-`;
  const rows = await db.payrollJournal.findMany({ where: { journalNo: { startsWith: prefix } }, select: { journalNo: true } });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.journalNo.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Approve klaim → generate jurnal (Debit akun beban per baris, Credit kas).
 *  Idempoten: jurnal lama klaim (runNo = docNo klaim) dibuang lalu dibuat ulang. */
async function generateClaimJournal(db: TenantDb, claimId: string): Promise<{ journalNo: string; journalDate: Date; lines: number; total: number }> {
  const claim = await db.travelClaim.findUnique({
    where: { id: claimId },
    include: { expenses: true, employee: { select: { fullName: true } } },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");

  // buang jurnal lama klaim ini (regenerate)
  if (claim.journalNo) {
    await db.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
  }

  const types = await db.travelExpenseType.findMany();
  const typeByCode = new Map(types.map((t) => [t.code, t]));

  const drafts: JournalLineDraft[] = [];
  for (const e of claim.expenses) {
    const t = typeByCode.get(e.expenseCode);
    drafts.push({
      accountCode: t?.debitAccount || TRAVEL_EXPENSE_ACC.code,
      accountName: t ? `${t.name} (beban)` : TRAVEL_EXPENSE_ACC.name,
      position: "Debit", amount: e.amount,
      memo: `${claim.docNo} — ${t?.name ?? e.expenseCode}${e.guestName ? ` (tamu: ${e.guestName})` : ""}`,
      wageCode: t?.compWageCode ?? e.expenseCode,
    });
  }
  if (claim.otherCompanyExp > 0) {
    drafts.push({ accountCode: TRAVEL_EXPENSE_ACC.code, accountName: TRAVEL_EXPENSE_ACC.name, position: "Debit", amount: claim.otherCompanyExp, memo: `${claim.docNo} — biaya dibayar pihak lain`, wageCode: null });
  }
  if (claim.exchangeLoss > 0) {
    drafts.push({ accountCode: TRAVEL_EXPENSE_ACC.code, accountName: TRAVEL_EXPENSE_ACC.name, position: "Debit", amount: claim.exchangeLoss, memo: `${claim.docNo} — rugi selisih kurs`, wageCode: null });
  }
  const total = round2(drafts.reduce((s, d) => s + d.amount, 0));
  if (total <= 0) return { journalNo: "", journalDate: new Date(), lines: 0, total: 0 };
  drafts.push({ accountCode: CASH_ACC.code, accountName: CASH_ACC.name, position: "Credit", amount: total, memo: `${claim.docNo} — settlement ${claim.settlementMethod}`, wageCode: null });

  const journalNo = await nextJournalNo(db);
  const journalDate = new Date();
  await db.payrollJournal.create({
    data: {
      journalNo, journalDate, runId: null, runNo: claim.docNo,
      description: `Klaim perjalanan dinas ${claim.docNo} — ${claim.employee.fullName}`,
      totalDebit: total, totalCredit: total, status: "Posted",
      lines: {
        create: drafts.map((d, i) => ({
          sequence: i + 1, accountCode: d.accountCode, accountName: d.accountName,
          position: d.position, amount: d.amount, memo: d.memo, wageCode: d.wageCode,
        })),
      },
    },
  });
  return { journalNo, journalDate, lines: drafts.length, total };
}

// ============ approval klaim (padanan TravelClaimToApprove + Operation + Transfer) ============

export interface ClaimDecisionResult {
  docNo: string;
  status: string;
  journalNo: string | null;
  journalLines: number;
}

export async function decideClaim(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string },
): Promise<ClaimDecisionResult> {
  const claim = await db.travelClaim.findUnique({ where: { id: input.id } });
  if (!claim) throw new Error("Klaim tidak ditemukan");

  const map: Record<string, { to: string; from: string[]; log: string }> = {
    approve: { to: "Approved", from: ["Submitted"], log: "Disetujui" },
    reject: { to: "Rejected", from: ["Submitted"], log: "Ditolak" },
    cancel: { to: "Cancelled", from: ["Submitted", "Approved"], log: "Dibatalkan" },
  };
  const m = map[input.action];
  if (!m) throw new Error("Aksi tidak dikenal");
  if (!m.from.includes(claim.status)) throw new Error(`Status ${claim.status} tidak bisa ${m.log.toLowerCase()}`);

  let journalNo = claim.journalNo;
  let journalLines = 0;

  if (input.action === "approve") {
    // posting jurnal otomatis (padanan Journal No/Type/Date oranHR)
    const j = await generateClaimJournal(db, claim.id);
    journalNo = j.journalNo || null;
    journalLines = j.lines;
  } else if (claim.journalNo) {
    // batalkan/ditolak setelah approve → buang jurnal
    const del = await db.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
    journalNo = null;
    journalLines = -del.count;
  }

  await db.travelClaim.update({
    where: { id: claim.id },
    data: {
      status: m.to,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
      journalNo, journalDate: journalNo ? new Date() : null,
    },
  });
  await db.activityLog.create({
    data: {
      action: m.log, entity: "TravelClaim", entityId: claim.docNo,
      detail: `${claim.docNo} ${m.log}${journalNo ? ` — jurnal ${journalNo} (${journalLines} baris)` : ""}${input.note ? ` — ${input.note.trim()}` : ""}`,
    },
  });
  return { docNo: claim.docNo, status: m.to, journalNo, journalLines };
}

// ============ transfer ke payroll (padanan Transfer + UTRP/TRVSTLIN) ============

export interface TravelTransferResult {
  periodName: string;
  claims: number;
  employees: number;
  earningTotal: number;
  deductionTotal: number;
  removed: number;
}

/** Klaim Approved → komponen Specific UTRP (bayar b) + TRVSTLIN (potong c).
 *  Idempoten: assignment UTRP/TRVSTLIN periode ini dibuang lalu ditulis ulang. */
export async function transferClaimsToPayroll(
  db: TenantDb,
  input: { periodId: string; processTypeCode?: string },
): Promise<TravelTransferResult> {
  const period = await db.payrollPeriod.findUnique({ where: { id: input.periodId } });
  if (!period) throw new Error("Period payroll tidak ditemukan");
  if (period.status === "Locked" || period.status === "Closed") {
    throw new Error("Period sudah ditutup/terkunci — pilih period lain");
  }
  const ptCode = input.processTypeCode ?? "SALARY";
  const pt = await db.processType.findFirst({ where: { code: ptCode } });
  if (!pt) throw new Error(`Process type ${ptCode} tidak ditemukan`);
  const compUtrp = await db.wageComponent.findUnique({ where: { code: "UTRP" } });
  const compDed = await db.wageComponent.findUnique({ where: { code: "TRVSTLIN" } });
  if (!compUtrp || !compDed) throw new Error("Komponen upah UTRP/TRVSTLIN belum didefinisikan (hubungi admin)");

  const claims = await db.travelClaim.findMany({
    where: { status: "Approved" },
    include: { employee: { select: { id: true, fullName: true } } },
  });
  if (claims.length === 0) throw new Error("Tidak ada klaim berstatus Approved yang siap ditransfer");

  // idempoten: buang assignment lama period ini
  const removed = await db.employeeComponentAssignment.deleteMany({
    where: { kind: "Specific", periodId: period.id, processTypeId: pt.id, wageComponentId: { in: [compUtrp.id, compDed.id] } },
  });

  const employees = new Set<string>();
  let earningTotal = 0;
  let deductionTotal = 0;
  for (const c of claims) {
    if (c.payableEmployee > 0) {
      await db.employeeComponentAssignment.create({
        data: {
          employeeId: c.employeeId, wageComponentId: compUtrp.id,
          kind: "Specific", amount: Math.round(c.payableEmployee),
          periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
          notes: `Kompensasi perjalanan dinas ${c.docNo} — ${c.employee.fullName}`,
          active: true,
        },
      });
      employees.add(c.employeeId);
      earningTotal += Math.round(c.payableEmployee);
    }
    if (c.payableCompany > 0) {
      await db.employeeComponentAssignment.create({
        data: {
          employeeId: c.employeeId, wageComponentId: compDed.id,
          kind: "Specific", amount: Math.round(c.payableCompany),
          periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
          notes: `Potongan settlement travel ${c.docNo} — kelebihan uang muka`,
          active: true,
        },
      });
      employees.add(c.employeeId);
      deductionTotal += Math.round(c.payableCompany);
    }
    await db.travelClaim.update({
      where: { id: c.id },
      data: { status: "Transferred", periodCode: period.code },
    });
  }

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "TravelTransfer", entityId: period.id,
      detail: `Transfer klaim travel → ${period.name}: ${claims.length} klaim, ${employees.size} karyawan, bayar ${earningTotal}, potong ${deductionTotal}`,
    },
  });
  return {
    periodName: period.name, claims: claims.length, employees: employees.size,
    earningTotal, deductionTotal, removed: removed.count,
  };
}

/** Dipanggil confirmRun(): klaim Transferred period run SALARY → Paid. */
export async function markTravelPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { period: true, processType: true },
  });
  if (!run || run.processType.code !== "SALARY") return 0;
  const res = await db.travelClaim.updateMany({
    where: { status: "Transferred", periodCode: run.period.code },
    data: { status: "Paid", paidRunNo: run.runNo, transferredRunNo: run.transferredRunNo ?? run.runNo },
  });
  if (res.count > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "TravelClaim", entityId: runId,
        detail: `${res.count} klaim travel ditandai Dibayar via run ${run.runNo} (${run.period.name})`,
      },
    });
  }
  return res.count;
}

// ============ budget (padanan TravelPeriod.jsp + Budget Per Cost Center) ============

export interface BudgetRow {
  id: string; year: number; startDate: Date; endDate: Date; currency: string;
  totalBudget: number; note: string | null;
  items: { costCenter: string; amount: number; note: string | null }[];
  used: number; remaining: number; claimCount: number;
}

export async function listBudgets(db: TenantDb): Promise<BudgetRow[]> {
  const budgets = await db.travelBudget.findMany({ orderBy: { year: "desc" }, include: { items: true } });
  const claims = await db.travelClaim.findMany({
    where: { status: { in: ["Transferred", "Paid"] } },
    select: { claimDate: true, totalSettlement: true },
  });
  return budgets.map((b) => {
    const inWindow = claims.filter((c) => c.claimDate >= b.startDate && c.claimDate <= b.endDate);
    const used = round2(inWindow.reduce((s, c) => s + c.totalSettlement, 0));
    return {
      id: b.id, year: b.year, startDate: b.startDate, endDate: b.endDate, currency: b.currency,
      totalBudget: b.totalBudget, note: b.note,
      items: b.items.map((i) => ({ costCenter: i.costCenter, amount: i.amount, note: i.note })),
      used, remaining: round2(b.totalBudget - used), claimCount: inWindow.length,
    };
  });
}

export async function upsertBudget(
  db: TenantDb,
  input: { id?: string; year: number; totalBudget: number; note?: string; items?: { costCenter: string; amount: number; note?: string }[] },
): Promise<string> {
  const year = Math.round(input.year);
  if (year < 2000 || year > 2100) throw new Error("Tahun tidak valid");
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  let budgetId = input.id;
  if (input.id) {
    await db.travelBudget.update({
      where: { id: input.id },
      data: { totalBudget: Math.max(0, input.totalBudget), note: input.note?.trim() || null },
    });
    if (input.items) {
      await db.travelBudgetItem.deleteMany({ where: { budgetId: input.id } });
    }
  } else {
    const exists = await db.travelBudget.findUnique({ where: { year } });
    if (exists) throw new Error(`Budget tahun ${year} sudah ada — gunakan tombol ubah`);
    const b = await db.travelBudget.create({
      data: { year, startDate, endDate, totalBudget: Math.max(0, input.totalBudget), note: input.note?.trim() || null },
    });
    budgetId = b.id;
  }
  if (budgetId && input.items?.length) {
    await db.travelBudgetItem.createMany({
      data: input.items
        .filter((i) => i.costCenter?.trim())
        .map((i) => ({ budgetId: budgetId!, costCenter: i.costCenter.trim(), amount: Math.max(0, i.amount), note: i.note?.trim() || null })),
    });
  }
  await db.activityLog.create({
    data: {
      action: input.id ? "Updated" : "Created", entity: "TravelBudget", entityId: String(year),
      detail: `Budget travel ${year}: ${input.totalBudget}${input.items?.length ? ` (${input.items.length} cost center)` : ""}`,
    },
  });
  return budgetId!;
}

// ============ KPI & laporan ============

export interface TravelStats {
  requestsThisMonth: number;
  requestsApprovedYtd: number;
  pendingRequestApprovals: number;
  pendingClaimApprovals: number;
  claimsYtd: number;
  claimsYtdAmount: number;
  transferredCount: number;
  paidCount: number;
  budgetYear: number | null;
  budgetTotal: number;
  budgetUsed: number;
  advanceOutstanding: number;
  topExpenseKinds: { kind: string; amount: number }[];
}

export async function travelStats(db: TenantDb): Promise<TravelStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [requests, claims, budgets, claimsYtdRaw, expenseAgg, advancesApproved, requestsApprovedYtd] = await Promise.all([
    db.travelRequest.findMany({ where: { requestDate: { gte: monthStart } }, select: { status: true } }),
    db.travelClaim.findMany({ where: { status: "Submitted" }, select: { id: true } }),
    db.travelBudget.findFirst({ where: { year: now.getFullYear() } }),
    db.travelClaim.findMany({
      where: { claimDate: { gte: yearStart } },
      select: { status: true, totalSettlement: true, payableEmployee: true, payableCompany: true },
    }),
    db.travelClaimExpense.groupBy({
      by: ["kind"],
      where: { claim: { claimDate: { gte: yearStart }, status: { in: ["Approved", "Transferred", "Paid"] } } },
      _sum: { amount: true },
    }),
    db.travelRequest.findMany({
      where: { status: "Approved", claimRequestedAt: null },
      include: { advances: true },
    }),
    db.travelRequest.count({ where: { status: "Approved", requestDate: { gte: yearStart } } }),
  ]);

  const requestsSubmitted = await db.travelRequest.count({ where: { status: "Submitted" } });
  const used = claimsYtdRaw
    .filter((c) => c.status === "Transferred" || c.status === "Paid")
    .reduce((s, c) => s + c.totalSettlement, 0);

  const kindLabel: Record<string, string> = {
    GENERAL: "General Expense", ALLOWANCE: "Allowance (Uang Saku)", MILEAGE: "Mileage (BBM/Jarak)", ENTERTAINMENT: "Entertainment",
  };
  const topExpenseKinds = expenseAgg
    .map((g) => ({ kind: kindLabel[g.kind] ?? g.kind, amount: round2(g._sum.amount ?? 0) }))
    .sort((x, y) => y.amount - x.amount);

  return {
    requestsThisMonth: requests.length,
    requestsApprovedYtd,
    pendingRequestApprovals: requestsSubmitted,
    pendingClaimApprovals: claims.length,
    claimsYtd: claimsYtdRaw.length,
    claimsYtdAmount: round2(claimsYtdRaw.reduce((s, c) => s + c.totalSettlement, 0)),
    transferredCount: claimsYtdRaw.filter((c) => c.status === "Transferred").length,
    paidCount: claimsYtdRaw.filter((c) => c.status === "Paid").length,
    budgetYear: budgets?.year ?? null,
    budgetTotal: budgets?.totalBudget ?? 0,
    budgetUsed: round2(used),
    advanceOutstanding: round2(advancesApproved.reduce((s, r) => s + r.advances.reduce((a, x) => a + x.amount, 0), 0)),
    topExpenseKinds,
  };
}

export interface ClaimReportRow {
  docNo: string; employeeNo: string; fullName: string; claimDate: Date;
  templateName: string; costCenter: string | null; status: string;
  totalExpenses: number; otherCompanyExp: number; exchangeLoss: number;
  payableEmployee: number; payableCompany: number; totalSettlement: number;
  journalNo: string | null; periodCode: string | null;
  expenses: { expenseCode: string; kind: string; description: string | null; amount: number; qty: number; guestName: string | null; overLimit: boolean }[];
}

export async function claimReport(db: TenantDb, opts: { from: Date; to: Date; employeeId?: string }): Promise<ClaimReportRow[]> {
  const from = dayStart(opts.from);
  const to = dayStart(opts.to);
  to.setDate(to.getDate() + 1);
  const claims = await db.travelClaim.findMany({
    where: {
      claimDate: { gte: from, lt: to },
      ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    },
    orderBy: { claimDate: "desc" },
    include: {
      employee: { select: { employeeNo: true, fullName: true } },
      template: true,
      expenses: { orderBy: [{ expenseDate: "asc" }, { expenseCode: "asc" }] },
    },
  });
  return claims.map((c) => ({
    docNo: c.docNo, employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    claimDate: c.claimDate, templateName: c.template.name, costCenter: c.costCenter, status: c.status,
    totalExpenses: round2(c.expenses.reduce((s, e) => s + e.amount, 0)),
    otherCompanyExp: c.otherCompanyExp, exchangeLoss: c.exchangeLoss,
    payableEmployee: c.payableEmployee, payableCompany: c.payableCompany,
    totalSettlement: c.totalSettlement, journalNo: c.journalNo, periodCode: c.periodCode,
    expenses: c.expenses.map((e) => ({
      expenseCode: e.expenseCode, kind: e.kind, description: e.description,
      amount: e.amount, qty: e.qty, guestName: e.guestName, overLimit: e.overLimit,
    })),
  }));
}
