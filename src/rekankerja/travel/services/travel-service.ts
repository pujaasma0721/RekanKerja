// RekanKerja Travel Service (ref: ANALISA-TRAVEL.md — modul Travel Administration).
// Alur: Travel Request (destinasi + advance) → approval → Travel Claim / Settlement
// (rincian biaya per jenis: General/Allowance/Mileage/Entertainment) → approval →
// jurnal otomatis → TRANSFER ke payroll (UTRP bayar / TRVSTLIN potong) → Paid.
// Formula settlement (T3-TRAVEL — fix B1/B2 double-count, konsisten dgn jurnal):
//   totalReimbursement (R) = Σ baris biaya + exchangeLoss − otherCompanyExp (a)
//   b (payableEmployee, UTRP) = max(0, R − advance)
//   c (payableCompany, TRVSTLIN) = max(0, advance − R)
//   totalSettlement = R (gross settlement, sebanding total beban)
// (a) biaya dibayar pihak lain TIDAK dibayar ke karyawan — jurnal: baris KONTRA.
import { startApprovalChain, decideApprovalChain, cancelApprovalChain, getApprovalChain, attachChainSummaries, type ChainSummary, type DecideActor } from "@/rekankerja/shared/services/approval-engine";
import { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb, type FieldCrypto } from "@/rekankerja/shared/lib/field-crypto";
import type { MoneyView } from "@/rekankerja/shared/lib/money-view";
import { nextJournalNo } from "@/rekankerja/shared/lib/journal-no";
// Task 33 — rule diferensiasi limit jenis biaya per parameter karyawan.
import { EntityRuleLite, RuleContext, matchFirstRule, applyRuleValue } from "@/rekankerja/shared/lib/parameter-rules";
import { ruleContextForEmployee } from "@/rekankerja/shared/services/employee-rule-context";

// ============ Task 33 — resolver limit biaya via rule ============

/** Muat rule limit semua jenis biaya terlibat (map typeId → lite). */
async function travelTypeRules(
  db: Pick<TenantDb, "travelExpenseTypeRule">,
  typeIds: string[],
): Promise<Map<string, EntityRuleLite[]>> {
  const map = new Map<string, EntityRuleLite[]>();
  if (typeIds.length === 0) return map;
  const rows = await db.travelExpenseTypeRule.findMany({ where: { travelExpenseTypeId: { in: typeIds }, active: true } });
  for (const r of rows) {
    const arr = map.get(r.travelExpenseTypeId) ?? [];
    arr.push({ id: r.id, name: r.name, priority: r.priority, conditions: r.conditions, actionType: r.actionType, value: r.amount, active: r.active, createdAt: r.createdAt });
    map.set(r.travelExpenseTypeId, arr);
  }
  return map;
}

/** Limit efektif karyawan: rule cocok pertama menang (atas limitAmount dasar). */
function limitWithRules(base: number, rules: EntityRuleLite[] | undefined, ctx: RuleContext | undefined | null): number {
  if (!rules || rules.length === 0 || !ctx) return base;
  const matched = matchFirstRule(rules, ctx);
  return matched ? applyRuleValue(matched.rule.actionType, matched.rule.value, base) : base;
}

/** Map limit efektif per kode jenis biaya utk satu karyawan (claim submit). */
async function effectiveExpenseLimits(
  db: TenantDb,
  types: { id: string; code: string; limitAmount: number; unlimited: boolean }[],
  employeeId: string,
): Promise<Map<string, number>> {
  const ids = types.map((t) => t.id);
  if (ids.length === 0) return new Map();
  const [rules, ctx] = await Promise.all([
    travelTypeRules(db, ids),
    ruleContextForEmployee(db, employeeId),
  ]);
  const map = new Map<string, number>();
  for (const t of types) {
    map.set(t.code, t.unlimited || t.limitAmount <= 0 ? t.limitAmount : limitWithRules(t.limitAmount, rules.get(t.id), ctx));
  }
  return map;
}

// ============ util ============

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const dayStart = (d: Date | string) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Format rupiah ringkas utk ActivityLog (tanpa dependensi locale UI). */
const fmtIDRLog = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

/** Jumlahkan uang muka AKTIF (status ≠ Void) — baris Void (request ditolak/
 * dibatalkan) tidak lagi dihitung sbg uang muka beredar (M-3/B5 T3-TRAVEL).
 * 44-d (M-8): TravelAdvance.amount TERENKRIPSI (enc:v1:n) — dekripsi per baris
 * dulu (decryptMoney mem-parse plaintext numerik legacy apa adanya). */
const sumActiveAdvances = (tc: FieldCrypto, advances: { amount: string | null; status?: string | null }[]) =>
  round2(advances.filter((x) => (x.status ?? "Given") !== "Void").reduce((s, x) => s + (tc.decryptMoney(x.amount) ?? 0), 0));

/** Parse tanggal (string|Date) → awal hari; tolak bila bukan tanggal valid (M-5). */
const parseDay = (v: string | Date, label: string): Date => {
  const x = dayStart(v);
  if (Number.isNaN(x.getTime())) throw new Error(`${label} tidak valid`);
  return x;
};

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

// ============ master (padanan General Setting) ============

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
  /** Task 33 — jumlah aturan diferensiasi limit. */
  ruleCount: number;
}

export async function listExpenseTypes(db: TenantDb): Promise<ExpenseTypeRow[]> {
  const rows = await db.travelExpenseType.findMany({
    orderBy: [{ kind: "asc" }, { code: "asc" }],
    // Task 33 — jumlah aturan diferensiasi limit per jenis biaya.
    include: { _count: { select: { rules: true } } },
  });
  return rows.map((t) => ({
    id: t.id, code: t.code, name: t.name, kind: t.kind, description: t.description,
    needDocs: t.needDocs, limitAmount: t.limitAmount, unlimited: t.unlimited, currency: t.currency,
    compWageCode: t.compWageCode, debitAccount: t.debitAccount, creditAccount: t.creditAccount, active: t.active,
    ruleCount: t._count.rules,
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
  actorName?: string;
}

export interface SubmitTravelRequestResult {
  docNo: string;
  destinations: number;
  days: number;
  advanceAmount: number;
  settlementDue: string | null;
  approvalLevels: number;
  firstApprover: string | null;
}

export async function submitTravelRequest(db: TenantDb, input: SubmitTravelRequestInput): Promise<SubmitTravelRequestResult> {
  if (!input.purpose?.trim()) throw new Error("Tujuan perjalanan wajib diisi");
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const template = await db.travelTemplate.findFirst({ where: { code: input.templateCode, active: true } });
  if (!template) throw new Error(`Template ${input.templateCode} tidak ditemukan / tidak aktif`);

  const from = parseDay(input.dateFrom, "Tanggal mulai perjalanan");
  const to = parseDay(input.dateTo, "Tanggal selesai perjalanan");
  if (to < from) throw new Error("Tanggal selesai sebelum tanggal mulai");
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (days > 60) throw new Error("Perjalanan lebih dari 60 hari — hubungi HR (validasi manual)");

  if (!input.destinations?.length) throw new Error("Minimal 1 destinasi perjalanan");
  const zones = await db.travelZone.findMany();
  const zoneByCode = new Map(zones.map((z) => [z.code, z]));

  // M-5 (24-FIX-TRAVEL): validasi tanggal destinasi per kaki — datang ≥ berangkat,
  // dalam rentang request, dan urutan tanggal monoton mengikuti seq.
  let prevLegFrom: Date | null = null;
  input.destinations.forEach((d, i) => {
    const legFrom = parseDay(d.dateFrom, `Tanggal berangkat destinasi kaki ${i + 1}`);
    const legTo = parseDay(d.dateTo, `Tanggal datang destinasi kaki ${i + 1}`);
    if (legTo < legFrom) throw new Error(`Destinasi kaki ${i + 1} (${d.city}): tanggal datang sebelum tanggal berangkat`);
    if (legFrom < from) throw new Error(`Destinasi kaki ${i + 1} (${d.city}): tanggal berangkat di luar rentang permintaan (mulai ${fmtDate(from)})`);
    if (legTo > to) throw new Error(`Destinasi kaki ${i + 1} (${d.city}): tanggal datang di luar rentang permintaan (s.d. ${fmtDate(to)})`);
    if (prevLegFrom && legFrom < prevLegFrom) {
      throw new Error(`Destinasi kaki ${i + 1}: urutan tanggal kaki tidak monoton — berangkat sebelum kaki sebelumnya`);
    }
    prevLegFrom = legFrom;
  });

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
          const df = parseDay(d.dateFrom, `Tanggal berangkat destinasi kaki ${i + 1}`);
          const dt = parseDay(d.dateTo, `Tanggal datang destinasi kaki ${i + 1}`);
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
    // M-3/B5 (T3-TRAVEL): advance baru "Requested" (belum dicairkan) — givenAt
    // baru diisi saat request disetujui final; bukan pinjaman karyawan (TRVLOAN
    // tidak pernah diimplementasikan — jurnal/jumlah mengikuti klaim settlement).
    // 44-d (M-8): amount advance disimpan TERENKRIPSI (enc:v1:n:…).
    await db.travelAdvance.create({
      data: { requestId: req.id, amount: tenantCryptoForDb(db).encryptMoney(advanceAmount) ?? "0", status: "Requested", givenAt: null, note: input.advanceNote?.trim() || null },
    });
  }

  // Approval berjenjang (Task 25): nominal = uang muka (besaran benefit) — jenjang
  // bersyarat nominal pada struktur Travel aktif hanya bila nominal masuk rentang.
  const chain = await startApprovalChain(db, {
    docType: "Travel", docId: req.id, employeeId: emp.id,
    amount: advanceAmount > 0 ? advanceAmount : null,
    createdBy: input.actorName ?? null,
  });

  // jatuh tempo settlement = tanggal kembali + settlement day template
  const dueDate = new Date(to);
  dueDate.setDate(dueDate.getDate() + template.settlementDay);

  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "TravelRequest", entityId: docNo,
      detail: `${docNo}: ${emp.fullName} — ${template.name} ${fmtDate(from)} → ${fmtDate(to)} (${input.destinations.length} destinasi${advanceAmount > 0 ? `, advance ${advanceAmount}` : ""}) — approval berjenjang ${chain.totalLevels} level`,
    },
  });
  return {
    docNo, destinations: input.destinations.length, days,
    advanceAmount, settlementDue: template.settlementDay > 0 ? dueDate.toISOString() : null,
    approvalLevels: chain.totalLevels,
    firstApprover: chain.steps[0]?.approverLabel ?? null,
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
  /** K-2 (24-FIX-TRAVEL): ada klaim aktif (status bukan Rejected/Cancelled). */
  hasActiveClaim: boolean;
  activeClaimDocNo: string | null;
  settlementDue: Date | null;
  overdue: boolean;
  /** ringkasan jalur approval berjenjang (Task 25) */
  approval: ChainSummary | null;
}

export async function listTravelRequests(db: TenantDb, opts: { status?: string; employeeId?: string; sortBy?: string; sortDir?: string } = {}): Promise<TravelRequestRow[]> {
  const where: { status?: string; employeeId?: string } = {};
  if (opts.status && opts.status !== "all") where.status = opts.status;
  if (opts.employeeId) where.employeeId = opts.employeeId;
  // Sort server-side (Task 76): kolom langsung & relasi via orderBy Prisma (SQL,
  // seluruh data); kolom DTO terenkripsi (advance) via sort in-memory atas hasil
  // akhir — endpoint ini full-list (tanpa take/skip), jadi tetap lintas seluruh data.
  const REQ_SORT = {
    doc: { col: "docNo" }, plan: { col: "dateFrom" }, status: { col: "status" },
    employee: { rel: "employee", field: "fullName" },
    template: { rel: "template", field: "name" },
    destinations: { dto: "dest" }, advance: { dto: "advance" },
  } as const;
  const reqSort = opts.sortBy && (REQ_SORT as Record<string, (typeof REQ_SORT)[keyof typeof REQ_SORT]>)[opts.sortBy];
  const sortDir: "asc" | "desc" = opts.sortDir === "desc" ? "desc" : "asc";
  const rows = await db.travelRequest.findMany({
    where,
    orderBy: reqSort && "col" in reqSort ? { [reqSort.col]: sortDir } : { createdAt: "desc" },
    include: {
      employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
      template: true,
      destinations: { orderBy: { seq: "asc" }, include: { zone: true } },
      advances: true,
      claims: { select: { id: true, docNo: true, status: true } },
    },
  });
  const chainMap = await attachChainSummaries(db, "Travel", rows.map((r) => ({ id: r.id })));
  // 44-d (M-8): advance terenkripsi — dekripsi sebelum dijumlahkan.
  const tcReq = tenantCryptoForDb(db);
  const out = rows.map((r) => {
    const advanceAmount = sumActiveAdvances(tcReq, r.advances);
    const activeClaim = r.claims.find((c) => c.status !== "Rejected" && c.status !== "Cancelled") ?? null;
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
      hasActiveClaim: activeClaim !== null,
      activeClaimDocNo: activeClaim?.docNo ?? null,
      settlementDue: r.template.settlementDay > 0 ? due : null,
      overdue: r.template.settlementDay > 0 && r.status === "Approved" && !r.claimRequestedAt && due.getTime() < Date.now(),
      approval: chainMap.get(r.id) ?? null,
    };
  });
  // Sort in-memory utk kolom DTO (destinasi kota pertama / advance terenkripsi)
  if (reqSort && "dto" in reqSort) {
    const acc = reqSort.dto === "advance"
      ? (x: TravelRequestRow) => x.advanceAmount
      : (x: TravelRequestRow) => x.destinations[0]?.city ?? null;
    out.sort((a, b) => {
      const va = acc(a), vb = acc(b);
      if (va == null && vb != null) return 1;
      if (vb == null && va != null) return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "id", { numeric: true });
      return sortDir === "asc" ? c : -c;
    });
  }
  return out;
}

export interface DecideResult {
  docNo: string;
  status: string;
  /** info jenjang berjenjang — ada bila masih ada jenjang berikutnya */
  approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null };
}

export async function decideTravelRequest(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string; actorId?: string; actor?: DecideActor },
): Promise<DecideResult> {
  const req = await db.travelRequest.findUnique({ where: { id: input.id }, include: { template: true, advances: true } });
  if (!req) throw new Error("Permintaan travel tidak ditemukan");
  const tcDec = tenantCryptoForDb(db); // 44-d (M-8): advance terenkripsi

  const map: Record<string, { to: string; from: string[]; log: string }> = {
    approve: { to: "Approved", from: ["Submitted"], log: "Disetujui" },
    reject: { to: "Rejected", from: ["Submitted", "Approved"], log: "Ditolak" },
    cancel: { to: "Cancelled", from: ["Submitted", "Approved"], log: "Dibatalkan" },
  };
  const m = map[input.action];
  if (!m) throw new Error("Aksi tidak dikenal");
  if (!m.from.includes(req.status)) throw new Error(`Status ${req.status} tidak bisa ${m.log.toLowerCase()}`);

  // ==== Approval berjenjang (Task 25) — nominal = uang muka ====
  let chain = await getApprovalChain(db, "Travel", input.id);
  if (!chain) {
    const advanceAmount = sumActiveAdvances(tcDec, req.advances);
    chain = await startApprovalChain(db, {
      docType: "Travel", docId: input.id, employeeId: req.employeeId,
      amount: advanceAmount > 0 ? advanceAmount : null, createdBy: "legacy-backfill",
    });
  }
  if (chain.status === "InProgress" && req.status === "Submitted") {
    const actor: DecideActor = input.actor ?? { role: "ADMIN", employeeId: null, name: input.actorId ?? "Sistem" };
    const res = await decideApprovalChain(db, {
      docType: "Travel", docId: input.id, action: input.action, note: input.note, actor,
    });
    if (!res.final) {
      // jenjang menengah — request tetap Submitted, menunggu jenjang berikutnya
      const currentStep = res.chain.steps.find((s) => s.status === "Current");
      await db.activityLog.create({
        data: {
          action: "Approved", entity: "TravelRequest", entityId: req.docNo,
          detail: `${req.docNo}: jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui — menunggu ${currentStep?.approverLabel ?? "jenjang berikutnya"}`,
        },
      });
      return {
        docNo: req.docNo, status: "Submitted",
        approval: {
          currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
          currentApprover: currentStep?.approverLabel ?? null,
        },
      };
    }
    // jenjang terakhir / reject / cancel → lanjut alur lama di bawah
  }

  if (input.action !== "approve") {
    // M-2 (24-FIX-TRAVEL): request yang sudah punya klaim di luar draft (Approved/
    // Transferred/Paid) TIDAK boleh ditolak/dibatalkan — klaim tersebut sudah berdampak
    // jurnal/payroll (uang), membatalkan request diam-diam akan membiarkan klaim tetap
    // diproses bayar. Selesaikan klaimnya dulu (tolak/batalkan klaim), baru request.
    const activeClaims = await db.travelClaim.findMany({
      where: { requestId: req.id, status: { in: ["Approved", "Transferred", "Paid"] } },
      select: { docNo: true },
    });
    if (activeClaims.length > 0) {
      throw new Error(
        `Permintaan tidak bisa ${m.log.toLowerCase()} — masih ada klaim aktif ${activeClaims.map((x) => x.docNo).join(", ")}. Tolak/batalkan klaim terlebih dahulu.`,
      );
    }
    // batalkan klaim yang belum diputus bila request dibatalkan/ditolak setelah ada klaim draft
    await db.travelClaim.updateMany({
      where: { requestId: req.id, status: { in: ["Submitted"] } },
      data: { status: "Cancelled" },
    });
    // M-3/B5 (T3-TRAVEL): request ditolak/dibatalkan → uang muka di-VOID (tidak lagi
    // beredar / dihitung outstanding). Bila advance sudah dicairkan (Given), pengembalian
    // kas fisik ditangani manual — dicatat di ActivityLog.
    const voidedAdvances = await db.travelAdvance.updateMany({
      where: { requestId: req.id, status: { not: "Void" } },
      data: { status: "Void" },
    });
    if (voidedAdvances.count > 0) {
      await db.activityLog.create({
        data: {
          action: m.log, entity: "TravelAdvance", entityId: req.docNo,
          detail: `${req.docNo}: ${voidedAdvances.count} baris uang muka dibatalkan (Void) — request ${m.log.toLowerCase()}`,
        },
      });
    }
  }

  await db.travelRequest.update({
    where: { id: req.id },
    data: {
      status: m.to,
      decidedById: input.actorId ?? null,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    },
  });
  // M-3/B5 (T3-TRAVEL): request disetujui FINAL → uang muka "dicairkan":
  // status Requested → Given + givenAt terisi (bukan lagi saat submit).
  if (input.action === "approve") {
    const given = await db.travelAdvance.updateMany({
      where: { requestId: req.id, status: "Requested" },
      data: { status: "Given", givenAt: new Date() },
    });
    if (given.count > 0) {
      const advanceAmount = sumActiveAdvances(tcDec, req.advances);
      await db.activityLog.create({
        data: {
          action: "Processed", entity: "TravelAdvance", entityId: req.docNo,
          detail: `${req.docNo}: uang muka ${fmtIDRLog(advanceAmount)} dicairkan (Given) — request disetujui final`,
        },
      });
    }
  }
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
  // K-2 (24-FIX-TRAVEL): request yang sudah punya klaim aktif bukan dasar klaim baru
  const activeClaim = await db.travelClaim.findFirst({
    where: { requestId: req.id, status: { notIn: ["Rejected", "Cancelled"] } },
    select: { docNo: true },
  });
  if (activeClaim) {
    throw new Error(`Permintaan ${req.docNo} sudah memiliki klaim aktif ${activeClaim.docNo} — satu permintaan hanya boleh satu klaim aktif`);
  }
  const expenseTypes = await listExpenseTypes(db);
  const advanceAmount = sumActiveAdvances(tenantCryptoForDb(db), req.advances);
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
    // T3-TRAVEL: saran (b)/(c) mengikuti formula baru — belum ada baris biaya →
    // R = 0 → b = 0, c = seluruh uang muka (kasbon penuh kembali ke perusahaan).
    suggested: { totalExpenses: 0, payableEmployee: 0, payableCompany: advanceAmount },
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
  /** T15-CHAIN-EXT: nama aktor sesi — pencipta jalur approval berjenjang. */
  actorName?: string | null;
}

export interface CreateClaimResult {
  docNo: string;
  totalSettlement: number;
  totalExpenses: number;
  overLimitLines: number;
  /** M-1 (24-FIX-TRAVEL): hasil hitung server (b)/(c) dari rincian vs uang muka. */
  payableEmployee: number;
  payableCompany: number;
  advanceAmount: number;
  /** T15-CHAIN-EXT: jumlah jenjang persetujuan klaim (struktur TravelClaim). */
  approvalLevels: number;
  /** T15-CHAIN-EXT: nama approver jenjang pertama. */
  firstApprover: string | null;
}

export async function createClaim(db: TenantDb, input: CreateClaimInput): Promise<CreateClaimResult> {
  const emp = await db.employee.findUnique({ where: { id: input.employeeId } });
  if (!emp || emp.status !== "Active") throw new Error("Karyawan tidak ditemukan / tidak aktif");
  const template = await db.travelTemplate.findFirst({ where: { code: input.templateCode, active: true } });
  if (!template) throw new Error(`Template ${input.templateCode} tidak ditemukan / tidak aktif`);
  if (!input.expenses?.length) throw new Error("Klaim wajib memuat minimal 1 baris biaya");
  // 44-d (M-8): konteks crypto — tangkap dari client LUAR (dipakai lintas
  // create claim/expense di bawah, semua tulisan uang terenkripsi).
  const tc = tenantCryptoForDb(db);

  // validasi jenis biaya + limit (padanan Expense Definition Rules — warning, tetap boleh)
  const types = await db.travelExpenseType.findMany();
  const typeByCode = new Map(types.map((t) => [t.code, t]));
  // Task 33 — limit jenis biaya efektif per parameter karyawan (rule).
  const effLimits = await effectiveExpenseLimits(db, types, input.employeeId);
  let overLimitLines = 0;
  let totalExpenses = 0;
  for (const e of input.expenses) {
    const t = typeByCode.get(e.expenseCode);
    if (!t || !t.active) throw new Error(`Jenis biaya ${e.expenseCode} tidak ditemukan / tidak aktif`);
    if (e.amount <= 0) throw new Error(`Baris biaya ${e.expenseCode}: nominal harus > 0`);
    const effLimit = effLimits.get(e.expenseCode) ?? t.limitAmount;
    if (!t.unlimited && effLimit > 0 && e.amount > effLimit) overLimitLines++;
    totalExpenses += Math.max(0, e.amount);
  }

  // request opsional — klaim mandiri diperbolehkan (padanan: claim tanpa request)
  let req = null as Awaited<ReturnType<typeof db.travelRequest.findUnique>>;
  let advanceAmount = 0;
  if (input.requestId) {
    const reqRow = await db.travelRequest.findUnique({
      where: { id: input.requestId },
      include: { advances: true },
    });
    if (!reqRow) throw new Error("Permintaan travel tidak ditemukan");
    if (reqRow.employeeId !== input.employeeId) throw new Error("Permintaan travel milik karyawan lain");
    // M-2 (24-FIX-TRAVEL): status request wajib Approved — guard yang sebelumnya hanya ada
    // di previewClaim; POST langsung bisa membuat klaim dari request Rejected/Cancelled.
    if (reqRow.status !== "Approved") {
      throw new Error(`Klaim hanya bisa dibuat dari permintaan Approved (status saat ini: ${reqRow.status})`);
    }
    // K-2 (24-FIX-TRAVEL): satu request hanya boleh punya SATU klaim aktif → cegah double
    // reimbursement (klaim lama harus ditolak/dibatalkan dulu sebelum mengajukan ulang).
    const activeClaim = await db.travelClaim.findFirst({
      where: { requestId: reqRow.id, status: { notIn: ["Rejected", "Cancelled"] } },
      select: { docNo: true },
      orderBy: { createdAt: "desc" },
    });
    if (activeClaim) {
      throw new Error(`Permintaan ${reqRow.docNo} sudah memiliki klaim aktif ${activeClaim.docNo} — batalkan/tolak klaim lama sebelum mengajukan klaim baru`);
    }
    advanceAmount = sumActiveAdvances(tc, reqRow.advances);

    // M-5 (24-FIX-TRAVEL): tanggal baris biaya harus dalam rentang trip;
    // claimDate tidak boleh sebelum tanggal kembali.
    const tripFrom = dayStart(reqRow.dateFrom);
    const tripTo = dayStart(reqRow.dateTo);
    for (const e of input.expenses) {
      if (!e.expenseDate) continue;
      const ed = parseDay(e.expenseDate, `Tanggal baris biaya ${e.expenseCode}`);
      if (ed < tripFrom || ed > tripTo) {
        throw new Error(`Baris biaya ${e.expenseCode}: tanggal ${fmtDate(ed)} di luar rentang perjalanan ${fmtDate(tripFrom)} s/d ${fmtDate(tripTo)}`);
      }
    }
    if (input.claimDate) {
      const cd = parseDay(input.claimDate, "Tanggal klaim");
      if (cd < tripTo) {
        throw new Error(`Tanggal klaim tidak boleh sebelum tanggal kembali perjalanan (${fmtDate(tripTo)})`);
      }
    } else {
      // default claimDate = hari ini → klaim settlement hanya setelah perjalanan selesai
      const today = dayStart(new Date());
      if (today < tripTo) {
        throw new Error(`Klaim hanya bisa diajukan setelah perjalanan selesai (tanggal kembali ${fmtDate(tripTo)})`);
      }
    }
    req = reqRow;
  }

  // B1/B2 (T3-TRAVEL): settlement dihitung SERVER dari realisasi vs uang muka:
  //   totalReimbursement (R) = Σ baris biaya + rugi kurs − (a) biaya pihak lain
  //   b (UTRP) = max(0, R − advance); c (TRVSTLIN) = max(0, advance − R)
  //   totalSettlement = R (gross, sebanding total beban & total jurnal).
  // Fix bug lama: (a)+loss pernah dihitung 2× (gross memuat (a), lalu totalSettlement
  // menambah (a) lagi) → totalSettlement bisa NEGATIF saat kasbon > realisasi; dan
  // (a) "dibayar pihak lain" ikut dibayar ke karyawan via b. Input b/c dari klien
  // tetap diabaikan (otoritatif server).
  const a = Math.max(0, input.otherCompanyExp);
  const loss = Math.max(0, input.exchangeLoss);
  const expensesTotal = round2(totalExpenses);
  if (a > round2(expensesTotal + loss)) {
    throw new Error("Biaya dibayar pihak lain (a) tidak boleh melebihi total rincian + rugi kurs");
  }
  const totalReimbursement = round2(expensesTotal + loss - a);
  const b = Math.max(0, round2(totalReimbursement - advanceAmount));
  const c = Math.max(0, round2(advanceAmount - totalReimbursement));
  const totalSettlement = totalReimbursement;

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
      // 44-d (M-8): lima nilai uang klaim disimpan TERENKRIPSI (enc:v1:n:…);
      // input selalu angka → ?? "0" hanya menetralkan tipe (tak pernah null).
      otherCompanyExp: tc.encryptMoney(a) ?? "0", exchangeLoss: tc.encryptMoney(loss) ?? "0",
      payableEmployee: tc.encryptMoney(b) ?? "0", payableCompany: tc.encryptMoney(c) ?? "0",
      totalSettlement: tc.encryptMoney(totalSettlement) ?? "0",
      settlementMethod: input.settlementMethod || template.settlementMethod,
      voucherNo: input.voucherNo?.trim() || null,
    },
  });
  await db.travelClaimExpense.createMany({
    data: input.expenses.map((e) => {
      const t = typeByCode.get(e.expenseCode)!;
      const amount = Math.max(0, e.amount);
      // Task 33 — overLimit dievaluasi thd limit efektif rule karyawan.
      const effLimit = effLimits.get(e.expenseCode) ?? t.limitAmount;
      return {
        claimId: claim.id, expenseCode: e.expenseCode, kind: t.kind,
        expenseDate: e.expenseDate ? dayStart(e.expenseDate) : null,
        description: e.description?.trim() || null,
        amount: tc.encryptMoney(amount) ?? "0", qty: e.qty && e.qty > 0 ? e.qty : 1,
        guestName: e.guestName?.trim() || null,
        overLimit: !t.unlimited && effLimit > 0 && amount > effLimit,
      };
    }),
  });

  if (req && !req.claimRequestedAt) {
    await db.travelRequest.update({ where: { id: req.id }, data: { claimRequestedAt: new Date() } });
  }

  // ==== Approval berjenjang (T15-CHAIN-EXT) — klaim settlement diajukan
  // (state Submitted) → bangun jalur "TravelClaim" sesuai struktur pemohon;
  // nominal = totalSettlement (gross settlement R) supaya jenjang bersyarat
  // (mis. FIN ≥ 15 jt / HRD ≥ 50 jt) aktif sesuai besar klaim. Fallback tanpa
  // struktur: atasan langsung → Admin/HR (anti-deadlock). ====
  const chain = await startApprovalChain(db, {
    docType: "TravelClaim", docId: claim.id, employeeId: emp.id,
    amount: totalSettlement, createdBy: input.actorName ?? null,
  });

  await db.activityLog.create({
    data: {
      action: "Submitted", entity: "TravelClaim", entityId: docNo,
      detail: `${docNo}: ${emp.fullName} — ${input.expenses.length} baris biaya, total settlement ${totalSettlement}${req ? ` (request ${req.docNo})` : ""} — approval berjenjang ${chain.totalLevels} level`,
    },
  });
  return {
    docNo, totalSettlement, totalExpenses: expensesTotal, overLimitLines, payableEmployee: b, payableCompany: c, advanceAmount,
    approvalLevels: chain.totalLevels,
    firstApprover: chain.steps[0]?.approverLabel ?? null,
  };
}

export interface TravelClaimRow {
  id: string; docNo: string; requestDocNo: string | null; employeeId: string;
  employeeNo: string; fullName: string; orgUnitName: string | null;
  claimDate: Date; templateCode: string; templateName: string; costCenter: string | null;
  purpose: string | null; remark: string | null; status: string;
  /** 45-b: null = vault uang masked (frontend render "—"). */
  otherCompanyExp: number | null; exchangeLoss: number | null; payableEmployee: number | null; payableCompany: number | null;
  totalSettlement: number | null; settlementMethod: string; voucherNo: string | null;
  journalNo: string | null; journalDate: Date | null; periodCode: string | null;
  transferredRunNo: string | null; paidRunNo: string | null;
  decidedAt: Date | null; decisionNote: string | null;
  advanceAmount: number | null;
  totalExpenses: number | null;
  expenseLines: number;
  overLimitLines: number;
  expenseKinds: string[];
  /** T15-CHAIN-EXT: ringkasan jalur approval berjenjang (jenjang aktif + approver menunggu). */
  approval?: ChainSummary | null;
}

/** List klaim travel (DTO tampilan).
 *  45-b: mv (MoneyView) WAJIB — gerbang vault uang: kolom uang → null saat
 *  masked; kalkulasi internal (formula settlement/validasi/jurnal) TIDAK lewat
 *  sini — tetap raw tc di service lain. */
export async function listTravelClaims(db: TenantDb, opts: { status?: string; employeeId?: string; sortBy?: string; sortDir?: string } = {}, mv: MoneyView): Promise<TravelClaimRow[]> {
  const where: { status?: string; employeeId?: string } = {};
  if (opts.status && opts.status !== "all") where.status = opts.status;
  if (opts.employeeId) where.employeeId = opts.employeeId;
  // Sort server-side (Task 76): pola sama dgn listTravelRequests — kolom langsung
  // & relasi via orderBy Prisma; kolom terenkripsi (settlement/payable) in-memory.
  const CLAIM_SORT = {
    doc: { col: "docNo" }, claimDate: { col: "claimDate" }, status: { col: "status" }, journal: { col: "journalNo" },
    employee: { rel: "employee", field: "fullName" },
    template: { rel: "template", field: "name" }, basis: { rel: "template", field: "name" },
    total: { dto: "total" }, advance: { dto: "advance" },
  } as const;
  const clSort = opts.sortBy && (CLAIM_SORT as Record<string, (typeof CLAIM_SORT)[keyof typeof CLAIM_SORT]>)[opts.sortBy];
  const sortDir: "asc" | "desc" = opts.sortDir === "desc" ? "desc" : "asc";
  const rows = await db.travelClaim.findMany({
    where,
    orderBy: clSort && "col" in clSort ? { [clSort.col]: sortDir } : { createdAt: "desc" },
    include: {
      employee: { select: { employeeNo: true, fullName: true, assignments: { where: { validTo: null }, select: { orgUnit: { select: { name: true } } }, take: 1 } } },
      template: true,
      request: { select: { docNo: true, advances: true } },
      expenses: true,
    },
  });
  // T15-CHAIN-EXT: ringkasan approval berjenjang per klaim (satu query batch).
  const chainMap = await attachChainSummaries(db, "TravelClaim", rows.map((c) => ({ id: c.id })));
  // 44-d (M-8): nilai uang klaim/expense terenkripsi — dekripsi utk DTO (angka).
  // 45-b: dekripsi raw utk memastikan nilai, lalu gate tampilan via mv
  // (g = null saat masked — kalkulasi line di bawah tetap atas angka raw).
  const tc = tenantCryptoForDb(db);
  const g = (n: number) => (mv.canSee ? n : null);
  const out = rows.map((c) => ({
    id: c.id, docNo: c.docNo, requestDocNo: c.request?.docNo ?? null,
    employeeId: c.employeeId, employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    orgUnitName: c.employee.assignments[0]?.orgUnit?.name ?? null,
    claimDate: c.claimDate, templateCode: c.template.code, templateName: c.template.name,
    costCenter: c.costCenter, purpose: c.purpose, remark: c.remark, status: c.status,
    otherCompanyExp: g(tc.decryptMoney(c.otherCompanyExp) ?? 0), exchangeLoss: g(tc.decryptMoney(c.exchangeLoss) ?? 0),
    payableEmployee: g(tc.decryptMoney(c.payableEmployee) ?? 0), payableCompany: g(tc.decryptMoney(c.payableCompany) ?? 0),
    totalSettlement: g(tc.decryptMoney(c.totalSettlement) ?? 0), settlementMethod: c.settlementMethod,
    voucherNo: c.voucherNo, journalNo: c.journalNo, journalDate: c.journalDate,
    periodCode: c.periodCode, transferredRunNo: c.transferredRunNo, paidRunNo: c.paidRunNo,
    decidedAt: c.decidedAt, decisionNote: c.decisionNote,
    advanceAmount: g(c.request ? sumActiveAdvances(tc, c.request.advances) : 0),
    totalExpenses: g(round2(c.expenses.reduce((s, e) => s + (tc.decryptMoney(e.amount) ?? 0), 0))),
    expenseLines: c.expenses.length,
    overLimitLines: c.expenses.filter((e) => e.overLimit).length,
    expenseKinds: [...new Set(c.expenses.map((e) => e.kind))],
    approval: chainMap.get(c.id) ?? null,
  }));
  // Sort in-memory utk kolom DTO terenkripsi (masked → 0 dianggap bawah pada asc).
  if (clSort && "dto" in clSort) {
    const acc = clSort.dto === "total"
      ? (x: TravelClaimRow) => x.totalSettlement
      : (x: TravelClaimRow) => x.advanceAmount;
    out.sort((a, b) => {
      const va = acc(a), vb = acc(b);
      if (va == null && vb != null) return 1;
      if (vb == null && va != null) return -1;
      const c = (va ?? 0) - (vb ?? 0);
      return sortDir === "asc" ? c : -c;
    });
  }
  return out;
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
// C-04 (24-FIX-TRAVEL): akun kliring payroll — penamaan selaras JOURNAL_ACCOUNTS.clearing
// di payroll/services/payroll-journal.ts (2101 Hutang Gaji).
const SALARY_PAYABLE_ACC = { code: "2101", name: "Hutang Gaji" };
// Fix audit 40 M-3/M-4 — akun utang klaim kasbon — penamaan selaras
// JOURNAL_ACCOUNTS.otherDed di payroll-journal.ts (2105 Potongan Lain-lain);
// kredit 2105 TRVSTLIN di jurnal run menutup debit kasbon ini.
const CLAIM_PAYABLE_ACC = { code: "2105", name: "Potongan Lain-lain" };

/** Approve klaim → generate jurnal: Debit akun beban per baris + rugi kurs (5105).
 *  (a) biaya dibayar pihak lain TIDAK di-Debit sbg beban & TIDAK masuk arus kas /
 *  karyawan (fix B2 + g-2 audit) — dicatat sbg baris KONTRA Kredit 5105, sehingga
 *  beban bersih perusahaan = totalSettlement (gross settlement).
 *  Fix audit 40 M-3 — model posting final (residu C-04 beban dobel + 2101 menumpuk
 *  + 2105 phantom ditutup): D 5105 R (beban SEKALI); C 2101 HANYA b (porsi yang
 *  memang dibayar payroll via UTRP — run membalas dgn pass-through D 2101, bukan
 *  D 5105 lagi); kasbon c = DEBIT 2105 (utang klaim karyawan) yang ditutup kredit
 *  2105 TRVSTLIN di jurnal run (2101 & 2105 bersih lintas klaim↔run); C 1101 tunai
 *  = avail + kasbon − b (= advance a — kas advance "Given" memang tak pernah
 *  dijurnal, GAP-4, baru tercatat di sini).
 *  Fix audit 40 M-4 — kasbon jurnal = c PENUH (tanpa clamp min(c,R)), sama persis
 *  dgn assignment TRVSTLIN & tampilan settlement (sumber: claim.payableCompany).
 *  T3-TRAVEL: konsistensi dgn formula baru — b/c = max(0, R − advance)/max(0,
 *  advance − R) dgn R = expenses + loss − (a).
 *  Idempoten: jurnal lama klaim (runNo = docNo klaim) dibuang lalu dibuat ulang. */
export async function generateClaimJournal(db: TenantDb, claimId: string): Promise<{ journalNo: string; journalDate: Date; lines: number; total: number }> {
  const claim = await db.travelClaim.findUnique({
    where: { id: claimId },
    include: { expenses: true, employee: { select: { fullName: true } } },
  });
  if (!claim) throw new Error("Klaim tidak ditemukan");
  // 44-d (M-8): nilai klaim/expense TERENKRIPSI — dekripsi utk komputasi jurnal
  // (baris jurnal ditulis balik terenkripsi — wave-1 28-c, tcJ di bawah, jangan
  // dobel-enkripsi: drafts tetap angka murni di memori).
  const tc = tenantCryptoForDb(db);
  const dec = (v: string | null) => tc.decryptMoney(v) ?? 0;

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
      position: "Debit", amount: dec(e.amount),
      memo: `${claim.docNo} — ${t?.name ?? e.expenseCode}${e.guestName ? ` (tamu: ${e.guestName})` : ""}`,
      wageCode: t?.compWageCode ?? e.expenseCode,
    });
  }
  const lossAmt = dec(claim.exchangeLoss);
  if (lossAmt > 0) {
    drafts.push({ accountCode: TRAVEL_EXPENSE_ACC.code, accountName: TRAVEL_EXPENSE_ACC.name, position: "Debit", amount: lossAmt, memo: `${claim.docNo} — rugi selisih kurs`, wageCode: null });
  }
  // total Debit = Σ rincian + rugi kurs (beban bruto realisasi perusahaan)
  const total = round2(drafts.reduce((s, d) => s + d.amount, 0));

  // T3-TRAVEL: (a) biaya dibayar pihak lain = baris KONTRA kredit 5105 (dibatasi
  // total beban) — bukan beban/arus kas/karyawan. Beban bersih = total − contra = R.
  const contraA = Math.min(Math.max(0, round2(dec(claim.otherCompanyExp))), total);
  const avail = round2(total - contraA); // = totalReimbursement (R)
  // ==== Fix audit 40 M-3 — model posting akhir (semua loop tertutup, D=C) ====
  //   JURNAL KLAIM (di sini):  D 5105 R            → beban TEPAT SEKALI
  //                             C 2101 b            → porsi payroll (UTRP)
  //                             C 1101 tunai        → tunai = avail + kasbon − b
  //                             D 2105 kasbon       → utang klaim karyawan (a−R)
  //   JURNAL RUN (payroll-journal.ts):
  //     UTRP pass-through:       D 2101 b / C 2101 b (thpEarnings) → net 0 di run;
  //                             debit 2101 b menutup kredit 2101 b jurnal klaim.
  //     TRVSTLIN (standard):    D 2101 c / C 2105 c → kredit 2105 c menutup debit
  //                             kasbon jurnal klaim; net pay turun c (potongan).
  //   → lintas klaim+run: 5105 = R sekali; 2101 net 0; 2105 net 0; 1101 = tunai +
  //   net pay (b masuk THP). Porsi tunai = avail + kasbon − b — tepat sebesar
  //   advance a (kas advance saat "Given" memang tidak pernah dijurnal, GAP-4
  //   audit 40 §6.4 — baru tercatat di sini; jadi buku 1101 akhirnya = bank).
  // Fix audit 40 M-4 — nilai kasbon konsisten jurnal ↔ potongan TRVSTLIN: kasbon
  // = c PENUH (claim.payableCompany — sumber nilai yang SAMA dengan assignment
  // TRVSTLIN di transferClaimsToPayroll & tampilan settlement), TANPA clamp
  // min(c, R). Clamp lama membuat buku mencatat utang < potongan aktual
  // karyawan. Baris tetap non-negatif & D=C: kasbon ≥ 0 dan bPayroll ≤ avail
  // (cap) → tunai = avail + kasbon − bPayroll ≥ 0 selalu.
  const bPayroll = Math.min(Math.max(0, round2(dec(claim.payableEmployee))), avail);
  const kasbon = Math.max(0, round2(dec(claim.payableCompany)));
  const cashPortion = round2(avail + kasbon - bPayroll);
  // Klaim tanpa beban riil (R=0) & tanpa kasbon → tidak ada jurnal. Fix audit 40
  // M-3 edge: R=0 tapi ada kasbon (advance a > 0 tidak terpakai sama sekali) →
  // jurnal tetap dibuat (D 2105 kasbon / C 1101 advance) supaya kas advance yang
  // belum terjurnal + piutang kasbon tercatat; baris beban nilai-0 dibuang.
  if (total <= 0) {
    if (kasbon <= 0) return { journalNo: "", journalDate: new Date(), lines: 0, total: 0 };
    drafts.length = 0; // buang baris beban nol (R=0)
  }
  if (contraA > 0) {
    drafts.push({
      accountCode: TRAVEL_EXPENSE_ACC.code, accountName: TRAVEL_EXPENSE_ACC.name,
      position: "Credit", amount: contraA,
      memo: `${claim.docNo} — kontra biaya dibayar pihak lain (bukan beban/arus kas perusahaan)`, wageCode: null,
    });
  }
  // C-04 + M-3: kredit 2101 HANYA sebesar b — porsi yang memang akan dibayar
  // payroll via UTRP (dibersihkan pass-through D 2101 di jurnal run). Kasbon
  // TIDAK lagi menggantung di 2101 (menumpuk kredit — temuan audit M-3).
  if (bPayroll > 0) {
    drafts.push({
      accountCode: SALARY_PAYABLE_ACC.code, accountName: SALARY_PAYABLE_ACC.name,
      position: "Credit", amount: bPayroll,
      memo: `${claim.docNo} — porsi dibayar via payroll (UTRP pass-through; beban sudah dibukukan di jurnal ini)`, wageCode: "UTRP",
    });
  }
  // Fix audit 40 M-3/M-4 — kasbon c penuh sbg DEBIT 2105 (utang klaim karyawan,
  // kelebihan uang muka a−R): ditutup kredit 2105 dari jurnal run TRVSTLIN
  // (D 2101/C 2105) → 2105 net 0; sebelum klaim ditransfer, 2105 membawa saldo
  // DEBIT sebesar c = piutang kasbon karyawan (representasi benar).
  if (kasbon > 0) {
    drafts.push({
      accountCode: CLAIM_PAYABLE_ACC.code, accountName: CLAIM_PAYABLE_ACC.name,
      position: "Debit", amount: kasbon,
      memo: `${claim.docNo} — kasbon kelebihan uang muka (dipulihkan via potongan TRVSTLIN di payroll)`, wageCode: "TRVSTLIN",
    });
  }
  if (cashPortion > 0) {
    drafts.push({
      accountCode: CASH_ACC.code, accountName: CASH_ACC.name,
      position: "Credit", amount: cashPortion,
      memo: `${claim.docNo} — settlement ${claim.settlementMethod} (porsi tunai + kas advance yang belum terjurnal)`, wageCode: null,
    });
  }

  // Fix audit 40 M-3(i) — invarian D=C per jurnal (baris kasbon menambah sisi
  // Debit): total jurnal = total beban bruto + kasbon. Cek defensif gagal-loud
  // (pola payroll-journal.ts) supaya approval tidak membukukan jurnal miring.
  const journalTotal = round2(total + kasbon);
  const sumD = round2(drafts.filter((d) => d.position === "Debit").reduce((s, d) => s + d.amount, 0));
  const sumC = round2(drafts.filter((d) => d.position === "Credit").reduce((s, d) => s + d.amount, 0));
  if (Math.abs(sumD - sumC) > 0.005) {
    throw new Error(`Jurnal klaim ${claim.docNo} tidak balance: D ${sumD} vs C ${sumC}`);
  }

  const journalNo = await nextJournalNo(db);
  const journalDate = new Date();
  // 28-c: total & baris jurnal disimpan TERENKRIPSI (enc:v1:n:…).
  const tcJ = tenantCryptoForDb(db);
  await db.payrollJournal.create({
    data: {
      journalNo, journalDate, runId: null, runNo: claim.docNo,
      description: `Klaim perjalanan dinas ${claim.docNo} — ${claim.employee.fullName}`,
      totalDebit: tcJ.encryptMoney(journalTotal), totalCredit: tcJ.encryptMoney(journalTotal), status: "Posted",
      lines: {
        create: drafts.map((d, i) => ({
          sequence: i + 1, accountCode: d.accountCode, accountName: d.accountName,
          position: d.position, amount: tcJ.encryptMoney(d.amount), memo: d.memo, wageCode: d.wageCode,
        })),
      },
    },
  });
  return { journalNo, journalDate, lines: drafts.length, total: journalTotal };
}

// ============ approval klaim (padanan TravelClaimToApprove + Operation + Transfer) ============

export interface ClaimDecisionResult {
  docNo: string;
  status: string;
  journalNo: string | null;
  journalLines: number;
  /** T15-CHAIN-EXT: ada bila approve jenjang menengah — klaim tetap Submitted. */
  approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null };
}

export async function decideClaim(
  db: TenantDb,
  input: { id: string; action: "approve" | "reject" | "cancel"; note?: string; actorId?: string; actor?: DecideActor },
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

  // ==== Approval berjenjang (T15-CHAIN-EXT) — chain dibuat saat submit
  // (createClaim, nominal = totalSettlement); klaim legacy Submitted tanpa
  // chain di-backfill saat putusan pertama (pola workoff). Approve jenjang
  // menengah → klaim TETAP Submitted (menunggu jenjang berikutnya); hanya
  // keputusan FINAL yang menjalankan jurnal otomatis + status Approved. ====
  let chain = await getApprovalChain(db, "TravelClaim", input.id);
  if (!chain && claim.status === "Submitted") {
    chain = await startApprovalChain(db, {
      docType: "TravelClaim", docId: input.id, employeeId: claim.employeeId,
      // 44-d (M-8): totalSettlement terenkripsi — dekripsi utk nominal chain.
      amount: tenantCryptoForDb(db).decryptMoney(claim.totalSettlement) ?? 0, createdBy: "legacy-backfill",
    });
  }
  const actor: DecideActor =
    input.actor ?? { role: "ADMIN", employeeId: null, name: input.actorId ?? "Sistem" };

  if (input.action === "approve" && chain && chain.status === "InProgress") {
    const res = await decideApprovalChain(db, {
      docType: "TravelClaim", docId: input.id, action: "approve", note: input.note, actor,
    });
    if (!res.final) {
      // jenjang menengah — klaim tetap Submitted, menunggu jenjang berikutnya
      const currentStep = res.chain.steps.find((s) => s.status === "Current");
      await db.activityLog.create({
        data: {
          action: "Approved", entity: "TravelClaim", entityId: claim.docNo,
          detail: `${claim.docNo}: jenjang ${chain.currentLevel}/${chain.totalLevels} disetujui oleh ${actor.name} — menunggu ${currentStep?.approverLabel ?? "jenjang berikutnya"} (total settlement ${tenantCryptoForDb(db).decryptMoney(claim.totalSettlement) ?? 0})`,
        },
      });
      return {
        docNo: claim.docNo, status: "Submitted", journalNo: null, journalLines: 0,
        approval: {
          currentLevel: res.chain.currentLevel, totalLevels: res.chain.totalLevels,
          currentApprover: currentStep?.approverLabel ?? null,
        },
      };
    }
    // jenjang TERAKHIR → lanjut alur final di bawah (jurnal otomatis + Approved)
  }

  // level tempat reject/cancel mendarat (snapshot PRA-keputusan — chain lokal
  // masih InProgress pada jenjang X; string dicatat di ActivityLog + response)
  const decidedAtLevel = input.action !== "approve" && chain && chain.status === "InProgress"
    ? ` di jenjang ${chain.currentLevel}/${chain.totalLevels}`
    : "";

  let journalNo = claim.journalNo;
  let journalLines = 0;

  if (input.action === "approve") {
    // posting jurnal otomatis (padanan Journal No/Type/Date) — SETELAH final
    // approve (jenjang menengah tidak menyentuh jurnal)
    const j = await generateClaimJournal(db, claim.id);
    journalNo = j.journalNo || null;
    journalLines = j.lines;
  } else {
    // reject/cancel pada klaim yang sudah ter-approve → buang jurnalnya;
    // reject jenjang (klaim Submitted) → chain dihentikan lebih dulu
    if (input.action === "reject" && chain && chain.status === "InProgress") {
      await decideApprovalChain(db, { docType: "TravelClaim", docId: input.id, action: "reject", note: input.note, actor });
    }
    if (input.action === "cancel" && chain && chain.status === "InProgress") {
      await cancelApprovalChain(db, "TravelClaim", input.id, actor.name);
    }
    if (claim.journalNo) {
      const del = await db.payrollJournal.deleteMany({ where: { journalNo: claim.journalNo, runId: null } });
      journalNo = null;
      journalLines = -del.count;
    }
  }

  await db.travelClaim.update({
    where: { id: claim.id },
    data: {
      status: m.to,
      decidedById: input.actorId ?? null,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
      journalNo, journalDate: journalNo ? new Date() : null,
    },
  });
  await db.activityLog.create({
    data: {
      action: m.log, entity: "TravelClaim", entityId: claim.docNo,
      detail: `${claim.docNo} ${m.log}${decidedAtLevel}${journalNo ? ` — jurnal ${journalNo} (${journalLines} baris)` : ""}${chain ? ` (${chain.totalLevels} jenjang)` : ""}${input.note ? ` — ${input.note.trim()}` : ""}`,
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
 *  K-1 (24-FIX-TRAVEL): scope rewrite = klaim {Approved, belum pernah ditransfer} ∪
 *  {Transferred ke period INI} — hanya assignment milik klaim tersebut yang dihapus
 *  lalu ditulis ulang (dibatasi per docNo klaim di notes); klaim Transferred ke period
 *  LAIN atau sudah Paid tidak disentuh → transfer ulang ke period sama idempoten dan
 *  klaim batch sebelumnya tidak lagi hilang komponennya (dulu: ditandai "Paid tanpa
 *  dibayar" saat run period dikonfirmasi).
 *  Minor audit 40 §5-11: hapus+buat ulang + penandaan klaim kini ATOMIK dalam satu
 *  db.$transaction (anti race duplikat assignment lintas request paralel). */
export async function transferClaimsToPayroll(
  db: TenantDb,
  input: { periodId: string; processTypeCode?: string; actor?: { name: string; appUserId: string | null } },
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

  // M-4/C-04 (24-FIX-TRAVEL): period dengan run sudah Confirmed/Paid tidak boleh
  // menerima transfer — assignment baru tidak akan pernah masuk run yang sudah
  // dihitung/dibayar, klaim akan ditandai Paid tanpa pernah dibayar (kasus terjebak
  // CL-2026-004 Transferred di period yang run-nya sudah lewat).
  const doneRuns = await db.payrollRun.count({
    where: { periodId: period.id, processTypeId: pt.id, status: { in: ["Confirmed", "Paid"] } },
  });
  if (doneRuns > 0) {
    throw new Error(`Period ${period.name} sudah memiliki run payroll yang dikonfirmasi/dibayar — klaim yang ditransfer ke sini tidak akan pernah dibayar. Pilih period yang run-nya belum dikonfirmasi`);
  }

  // K-1: klaim yang ditulis ulang = Approved (belum transfer) ∪ Transferred ke period ini
  const claims = await db.travelClaim.findMany({
    where: {
      OR: [
        { status: "Approved" },
        { status: "Transferred", periodCode: period.code },
      ],
    },
    include: { employee: { select: { id: true, fullName: true } } },
    orderBy: { docNo: "asc" },
  });
  if (claims.length === 0) throw new Error("Tidak ada klaim berstatus Approved yang siap ditransfer");

  // Minor audit 40 §5-11 — transferClaimsToPayroll transaksional: hapus+buat
  // ulang assignment + penandaan klaim dibungkus SATU db.$transaction (sebelumnya
  // berurutan tanpa atomikitas → race dua request transfer paralel ke period sama
  // melipatgandakan assignment UTRP/TRVSTLIN; tanpa unique constraint, duplikat
  // tidak tertahan DB). Tidak ada nextJournalNo di dalam tx → bukan nested
  // $transaction (aman dari pola bug K-1 medical).
  const employees = new Set<string>();
  let earningTotal = 0;
  let deductionTotal = 0;
  let removedCount = 0;
  // 28-c: nilai komponen khusus disimpan TERENKRIPSI (enc:v1:n:…).
  // 44-d (M-8): payableEmployee/payableCompany klaim juga terenkripsi →
  // dekripsi (tcC) sebelum komputasi; tcC ditangkap dari client LUAR sebelum
  // $transaction (client transaksi tidak membawa brand schema).
  const tcC = tenantCryptoForDb(db);
  await db.$transaction(async (tx) => {
    // idempoten: buang assignment lama HANYA milik klaim yang akan ditulis ulang
    // (period × processType ini × komponen UTRP/TRVSTLIN × docNo klaim di notes) —
    // assignment klaim period lain / klaim Paid / assignment manual HR tidak tersapu.
    const removed = await tx.employeeComponentAssignment.deleteMany({
      where: {
        kind: "Specific", periodId: period.id, processTypeId: pt.id,
        wageComponentId: { in: [compUtrp.id, compDed.id] },
        OR: claims.map((c) => ({ notes: { contains: c.docNo } })),
      },
    });
    removedCount = removed.count;
    for (const c of claims) {
      const bVal = tcC.decryptMoney(c.payableEmployee) ?? 0;
      const cVal = tcC.decryptMoney(c.payableCompany) ?? 0;
      if (bVal > 0) {
        await tx.employeeComponentAssignment.create({
          data: {
            employeeId: c.employeeId, wageComponentId: compUtrp.id,
            kind: "Specific", amount: tcC.encryptMoney(Math.round(bVal)),
            periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
            notes: `Kompensasi perjalanan dinas ${c.docNo} — ${c.employee.fullName}`,
            active: true,
          },
        });
        employees.add(c.employeeId);
        earningTotal += Math.round(bVal);
      }
      // Fix audit 40 M-4 — jumlah potongan TRVSTLIN = payableCompany (c penuh,
      // sumber yang sama dengan kasbon D 2105 di generateClaimJournal).
      if (cVal > 0) {
        await tx.employeeComponentAssignment.create({
          data: {
            employeeId: c.employeeId, wageComponentId: compDed.id,
            kind: "Specific", amount: tcC.encryptMoney(Math.round(cVal)),
            periodId: period.id, processTypeId: pt.id, basedDate: new Date(),
            notes: `Potongan settlement travel ${c.docNo} — kelebihan uang muka`,
            active: true,
          },
        });
        employees.add(c.employeeId);
        deductionTotal += Math.round(cVal);
      }
      await tx.travelClaim.update({
        where: { id: c.id },
        data: { status: "Transferred", periodCode: period.code },
      });
    }
  });

  await db.activityLog.create({
    data: {
      action: "Processed", entity: "TravelTransfer", entityId: period.id,
      appUserId: input.actor?.appUserId ?? null,
      detail: `Transfer klaim travel → ${period.name}: ${claims.length} klaim, ${employees.size} karyawan, bayar ${earningTotal}, potong ${deductionTotal}${input.actor ? ` — oleh ${input.actor.name}` : ""}`,
    },
  });
  return {
    periodName: period.name, claims: claims.length, employees: employees.size,
    earningTotal, deductionTotal, removed: removedCount,
  };
}

/** Dipanggil confirmRun(): klaim Transferred period run SALARY → Paid.
 *  B4 (T3-TRAVEL): mirror markMedicalPaidForRun — tandai Paid HANYA klaim yang
 *  komponen UTRP/TRVSTLIN-nya BENAR-BENAR muncul di PayrollRunItem karyawan run
 *  terkait (klaim karyawan non-aktif / tak masuk run tidak lagi ditandai Paid
 *  diam-diam — status Transferred tetap, terlihat di antrean transfer).
 *  Klaim b=c=0 (tak punya komponen payroll) sah ditandai Paid — tak ada yang
 *  perlu diverifikasi di payslip. */
export async function markTravelPaidForRun(db: TenantDb, runId: string): Promise<number> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: {
      period: true, processType: true,
      lines: { select: { employeeId: true, items: { select: { code: true } } } },
    },
  });
  if (!run || run.processType.code !== "SALARY") return 0;

  // karyawan yang benar-benar menerima UTRP / TRVSTLIN di run ini (assignment → run item)
  const paidEmployees = new Set(
    run.lines
      .filter((l) => l.items.some((i) => i.code === "UTRP" || i.code === "TRVSTLIN"))
      .map((l) => l.employeeId),
  );

  const transferred = await db.travelClaim.findMany({
    where: { status: "Transferred", periodCode: run.period.code },
    select: { id: true, docNo: true, employeeId: true, payableEmployee: true, payableCompany: true },
    orderBy: { docNo: "asc" },
  });
  // 44-d (M-8): b/c terenkripsi — dekripsi utk pengecekan klaim nol-komponen.
  const tcPaid = tenantCryptoForDb(db);
  const toPaid = transferred.filter(
    (c) =>
      paidEmployees.has(c.employeeId) ||
      ((tcPaid.decryptMoney(c.payableEmployee) ?? 0) <= 0 && (tcPaid.decryptMoney(c.payableCompany) ?? 0) <= 0),
  );
  const skipped = transferred.filter((c) => !toPaid.includes(c));

  let marked = 0;
  if (toPaid.length > 0) {
    const res = await db.travelClaim.updateMany({
      where: { id: { in: toPaid.map((c) => c.id) } },
      data: { status: "Paid", paidRunNo: run.runNo, transferredRunNo: run.runNo },
    });
    marked = res.count;
  }
  if (marked > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "TravelClaim", entityId: runId,
        detail: `${marked} klaim travel ditandai Dibayar via run ${run.runNo} (${run.period.name}) — terverifikasi item UTRP/TRVSTLIN di payslip`,
      },
    });
  }
  if (skipped.length > 0) {
    await db.activityLog.create({
      data: {
        action: "Processed", entity: "TravelClaim", entityId: runId,
        detail: `${skipped.length} klaim Transferred TIDAK ditandai Paid (komponen UTRP/TRVSTLIN tidak muncul di run ${run.runNo}): ${skipped.map((c) => c.docNo).join(", ")}`,
      },
    });
  }
  return marked;
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
  // 44-d (M-8): budget/item/totalSettlement terenkripsi — dekripsi (reduce
  // in-memory atas nilai terdekripsi; totalSettlement dipakai sbg angka).
  const tc = tenantCryptoForDb(db);
  return budgets.map((b) => {
    const inWindow = claims.filter((c) => c.claimDate >= b.startDate && c.claimDate <= b.endDate);
    const used = round2(inWindow.reduce((s, c) => s + (tc.decryptMoney(c.totalSettlement) ?? 0), 0));
    const totalBudget = tc.decryptMoney(b.totalBudget) ?? 0;
    return {
      id: b.id, year: b.year, startDate: b.startDate, endDate: b.endDate, currency: b.currency,
      totalBudget, note: b.note,
      items: b.items.map((i) => ({ costCenter: i.costCenter, amount: tc.decryptMoney(i.amount) ?? 0, note: i.note })),
      used, remaining: round2(totalBudget - used), claimCount: inWindow.length,
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
  // 44-d (M-8): totalBudget + amount item disimpan TERENKRIPSI (enc:v1:n:…).
  const tc = tenantCryptoForDb(db);
  let budgetId = input.id;
  if (input.id) {
    await db.travelBudget.update({
      where: { id: input.id },
      data: { totalBudget: tc.encryptMoney(Math.max(0, input.totalBudget)) ?? "0", note: input.note?.trim() || null },
    });
    if (input.items) {
      await db.travelBudgetItem.deleteMany({ where: { budgetId: input.id } });
    }
  } else {
    const exists = await db.travelBudget.findUnique({ where: { year } });
    if (exists) throw new Error(`Budget tahun ${year} sudah ada — gunakan tombol ubah`);
    const b = await db.travelBudget.create({
      data: { year, startDate, endDate, totalBudget: tc.encryptMoney(Math.max(0, input.totalBudget)) ?? "0", note: input.note?.trim() || null },
    });
    budgetId = b.id;
  }
  if (budgetId && input.items?.length) {
    await db.travelBudgetItem.createMany({
      data: input.items
        .filter((i) => i.costCenter?.trim())
        .map((i) => ({ budgetId: budgetId!, costCenter: i.costCenter.trim(), amount: tc.encryptMoney(Math.max(0, i.amount)) ?? "0", note: i.note?.trim() || null })),
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

  const [requests, claims, budgets, claimsYtdRaw, expenseRows, advanceRows, requestsApprovedYtd] = await Promise.all([
    db.travelRequest.findMany({ where: { requestDate: { gte: monthStart } }, select: { status: true } }),
    db.travelClaim.findMany({ where: { status: "Submitted" }, select: { id: true } }),
    db.travelBudget.findFirst({ where: { year: now.getFullYear() } }),
    db.travelClaim.findMany({
      where: { claimDate: { gte: yearStart } },
      select: { status: true, totalSettlement: true, payableEmployee: true, payableCompany: true },
    }),
    // 44-d (M-8): groupBy/_sum.amount DILARANG (amount terenkripsi, ciphertext
    // acak per baris) → fetch rows + agregasi IN-MEMORY setelah dekripsi.
    db.travelClaimExpense.findMany({
      where: { claim: { claimDate: { gte: yearStart }, status: { in: ["Approved", "Transferred", "Paid"] } } },
      select: { kind: true, amount: true },
    }),
    // M-3/B5 (T3-TRAVEL): SEMUA advance belum lunas — status Given (sudah dicairkan)
    // DAN request belum punya klaim Paid (klaim Submitted/Approved/Transferred =
    // uang muka masih beredar; klaim Paid = lunas; Void/Requested tidak dihitung).
    db.travelAdvance.findMany({
      where: { status: "Given" },
      include: { request: { select: { claims: { where: { status: "Paid" }, select: { id: true } } } } },
    }),
    db.travelRequest.count({ where: { status: "Approved", requestDate: { gte: yearStart } } }),
  ]);

  const requestsSubmitted = await db.travelRequest.count({ where: { status: "Submitted" } });
  // 44-d (M-8): nilai uang terenkripsi — dekripsi semua reduce in-memory.
  const tc = tenantCryptoForDb(db);
  const used = claimsYtdRaw
    .filter((c) => c.status === "Transferred" || c.status === "Paid")
    .reduce((s, c) => s + (tc.decryptMoney(c.totalSettlement) ?? 0), 0);

  const kindLabel: Record<string, string> = {
    GENERAL: "General Expense", ALLOWANCE: "Allowance (Uang Saku)", MILEAGE: "Mileage (BBM/Jarak)", ENTERTAINMENT: "Entertainment",
  };
  const kindAgg = new Map<string, number>();
  for (const e of expenseRows) {
    kindAgg.set(e.kind, round2((kindAgg.get(e.kind) ?? 0) + (tc.decryptMoney(e.amount) ?? 0)));
  }
  const topExpenseKinds = [...kindAgg.entries()]
    .map(([kind, amount]) => ({ kind: kindLabel[kind] ?? kind, amount }))
    .sort((x, y) => y.amount - x.amount);

  return {
    requestsThisMonth: requests.length,
    requestsApprovedYtd,
    pendingRequestApprovals: requestsSubmitted,
    pendingClaimApprovals: claims.length,
    claimsYtd: claimsYtdRaw.length,
    claimsYtdAmount: round2(claimsYtdRaw.reduce((s, c) => s + (tc.decryptMoney(c.totalSettlement) ?? 0), 0)),
    transferredCount: claimsYtdRaw.filter((c) => c.status === "Transferred").length,
    paidCount: claimsYtdRaw.filter((c) => c.status === "Paid").length,
    budgetYear: budgets?.year ?? null,
    budgetTotal: budgets ? tc.decryptMoney(budgets.totalBudget) ?? 0 : 0,
    budgetUsed: round2(used),
    advanceOutstanding: round2(advanceRows.filter((x) => x.request.claims.length === 0).reduce((s, x) => s + (tc.decryptMoney(x.amount) ?? 0), 0)),
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
  // 44-d (M-8): semua nilai uang TERENKRIPSI — dekripsi utk laporan (angka).
  const tcR = tenantCryptoForDb(db);
  return claims.map((c) => ({
    docNo: c.docNo, employeeNo: c.employee.employeeNo, fullName: c.employee.fullName,
    claimDate: c.claimDate, templateName: c.template.name, costCenter: c.costCenter, status: c.status,
    totalExpenses: round2(c.expenses.reduce((s, e) => s + (tcR.decryptMoney(e.amount) ?? 0), 0)),
    otherCompanyExp: tcR.decryptMoney(c.otherCompanyExp) ?? 0, exchangeLoss: tcR.decryptMoney(c.exchangeLoss) ?? 0,
    payableEmployee: tcR.decryptMoney(c.payableEmployee) ?? 0, payableCompany: tcR.decryptMoney(c.payableCompany) ?? 0,
    totalSettlement: tcR.decryptMoney(c.totalSettlement) ?? 0, journalNo: c.journalNo, periodCode: c.periodCode,
    expenses: c.expenses.map((e) => ({
      expenseCode: e.expenseCode, kind: e.kind, description: e.description,
      amount: tcR.decryptMoney(e.amount) ?? 0, qty: e.qty, guestName: e.guestName, overLimit: e.overLimit,
    })),
  }));
}
