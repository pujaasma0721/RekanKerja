import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, locFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
// KONTRAK payload — tipe dipakai compile-time supaya field TIDAK BISA menyimpang
// dari src/rekankerja/travel/components/report-documents/types.ts (TRAV-1-b).
import type {
  ActivePhase,
  TR11Data, TR12Data, TR13Data, TR21Data, TR22Data, TR23Data,
  TR31Data, TR32Data, TR33Data, TR41Data, TR42Data, TR43Data,
} from "@/rekankerja/travel/components/report-documents/types";

// =============================================================================
// TRAV-1-a — LAPORAN DISTRIBUSI TRAVEL (print & PDF ready) =====================
// =============================================================================
// GET /api/rekankerja/travel/reports/documents?id=<trId> — data satu laporan
// siap cetak (12 laporan / 4 grup: pengajuan & validasi SPPD, realisasi &
// rekonsiliasi biaya, kepatuhan kebijakan perjalanan, vendor & logistik).
//
// Alur T110/T112/T-MED-REPORTS (mirror HR & Leave & Medical): form parameter
// awal di klien mengirim query string (office/unit/template/expenseType/status/
// claimStatus cakupan + year/from/to periode) → diterapkan SERVER-SIDE sebelum
// builder berjalan. ?id=_params → daftar opsi filter. ?export=xlsx → stream
// XLSX per laporan.
//
// Guard: requireMenuViewAny travel:travel-reports + cakupan akses efektif.
//
// UANG (M-8): seluruh kolom uang TravelAdvance/TravelClaim/TravelClaimExpense/
// TravelBudget[Item] TERENKRIPSI — didekripsi via tenantCryptoForDb HANYA untuk
// kalkulasi internal (raw — benar meski brankas terkunci); NILAI yang
// diserialisasi digerbang money-view (masked saat brankas terkunci → null,
// frontend render "•••"). Tarif kota (uangHarian/plafonHotel) TIDAK terenkripsi
// (Float biasa — acuan SBI PMK 32/2025).
//
// KEPUTUSAN SEMANTIK (mirror travel-service createClaim):
//   · over-limit PER UNIT — nominal ÷ qty (hari/km/malam) vs limit jenis;
//     recompute + OR dgn flag tersimpan (baris legacy tetap terdeteksi).
//   · uang muka request = Σ advance status ≠ Void (baris Void tidak beredar).

const DAY_MS = 24 * 3600 * 1000;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "tr11", "tr12", "tr13",
  "tr21", "tr22", "tr23",
  "tr31", "tr32", "tr33",
  "tr41", "tr42", "tr43",
]);

const REPORT_TITLES: Record<string, string> = {
  tr11: "Master Travel Request & Log SPPD",
  tr12: "Cash Advance Disbursed Sheet (Lembar Uang Muka)",
  tr13: "Active Business Travelers Tracking Sheet (Pelacak Perjalanan Aktif)",
  tr21: "Travel Settlement & Expense Claim Register (Register Settlement)",
  tr22: "Itemized Expense Category Breakdown (Rincian per Komponen Biaya)",
  tr23: "Mileage & Local Transport Reimbursement Log (Log Mileage & Transport Lokal)",
  tr31: "Travel Tier & Policy Violation Report (Pelanggaran Plafon)",
  tr32: "Lost Savings Opportunity Sheet (Analisis Penghematan)",
  tr33: "Travel ROI / Cost-to-Business Impact Analysis (ROI per Cost Center)",
  tr41: "Corporate Travel Agent (CTA) Reconciliation Sheet (Rekonsiliasi Akun Korporat)",
  tr42: "Hotel Vendor Volume Summary (Volume Malam Menginap per Kota)",
  tr43: "Air Carrier Utilization Report (Utilisasi Maskapai & Kereta)",
};

const REQ_STATUS_LABELS: Record<string, string> = {
  Submitted: "Menunggu Persetujuan", Approved: "Disetujui", Rejected: "Ditolak", Cancelled: "Dibatalkan",
};
const REQ_STATUS_ORDER = ["Submitted", "Approved", "Rejected", "Cancelled"];
const CLAIM_STATUS_LABELS: Record<string, string> = {
  Submitted: "Menunggu Verifikasi", Approved: "Disetujui", Rejected: "Ditolak",
  Cancelled: "Dibatalkan", Transferred: "Ditransfer Payroll", Paid: "Dibayar",
};
const CLAIM_STATUS_ORDER = ["Submitted", "Approved", "Rejected", "Cancelled", "Transferred", "Paid"];
/** Klaim "selesai" (uang sudah jadi beban / diproses payroll). */
const CLAIM_DONE = ["Approved", "Transferred", "Paid"];
const ADV_STATUS_LABELS: Record<string, string> = {
  Given: "Dicairkan", Requested: "Menunggu Pencairan", Void: "Dibatalkan",
};
const ADV_STATUS_ORDER = ["Given", "Requested", "Void"];
const SETTLEMENT_LABELS: Record<string, string> = {
  unsettled: "Belum diajukan", processing: "Klaim diproses", settled: "Selesai",
};
const PHASE_LABELS: Record<ActivePhase, string> = {
  "final-day": "Hari terakhir",
  "returning-soon": "Segera pulang (≤2 hari)",
  "mid-trip": "Di tengah perjalanan",
};
const KIND_LABELS: Record<string, string> = {
  GENERAL: "Umum", ALLOWANCE: "Uang Saku", MILEAGE: "Kilometer", ENTERTAINMENT: "Entertainment",
};
const TR23_CATEGORY_LABELS: Record<string, string> = {
  "mileage-km": "Kendaraan Pribadi (km)", fuel: "BBM", "local-rail": "Kereta Lokal", "local-rent": "Sewa/Taksi Lokal",
};
const TR23_CATEGORY_ORDER = ["mileage-km", "fuel", "local-rail", "local-rent"];
const TR32_CATEGORY_LABELS: Record<string, string> = {
  hotel: "Hotel di Atas Plafon SBI", "per-diem": "Uang Saku di Atas Tarif SBI", "last-minute": "Tiket Last-Minute (≤H-1)",
};
const TR32_CATEGORY_ORDER = ["hotel", "per-diem", "last-minute"];
const MODE_LABELS: Record<string, string> = { air: "Udara", rail: "Kereta", other: "Darat/Laut" };
const UNMATCHED_CITY = "Tidak terpetakan";

// ---- regex best-effort (carrier/rute/transport lokal) ----
const RE_LOCAL_TRANSPORT = /taksi|rental|sewa|grab|ojek|kereta|argo|commuter|parkir|tol|bandara/i;
const RE_LOCAL_RAIL = /kereta|argo|commuter/i;
/** Pasangan kode IATA utk label rute: "CGK-SIN", "CGK to SIN" ([-–to] = pemisah). */
const RE_ROUTE_PAIR = /([A-Z]{3})\s*[-–to]+\s*([A-Z]{3})/;
/** Pasangan kode IATA murni (penanda transport udara antar-kota). */
const RE_IATA_PAIR = /[A-Z]{3}[-–][A-Z]{3}/;

/** Parse carrier dari description (best-effort; fallback per kode jenis biaya). */
function parseCarrier(desc: string | null, code: string): string {
  const d = (desc ?? "").toLowerCase();
  if (/garuda|\bga-\d/.test(d)) return "Garuda Indonesia";
  if (/lion/.test(d)) return "Lion Air";
  if (/singapore airline|\bsq-/.test(d)) return "Singapore Airlines";
  if (/batik/.test(d)) return "Batik Air";
  if (/citilink/.test(d)) return "Citilink";
  if (/airasia/.test(d)) return "AirAsia";
  if (/scoot/.test(d)) return "Scoot";
  if (/kereta|\bka\b|argo|commuter|kai/.test(d)) return "KAI (Kereta Api)";
  if (/travel|shuttle|bus/.test(d)) return "Bus/Travel Darat";
  return code === "O-TRANSPORT" ? "Tidak teridentifikasi (Udara)" : "Tidak teridentifikasi (Darat)";
}

/** Mode transport: kereta > udara (O-* / pesawat / kode IATA) > darat/laut. */
function parseMode(desc: string | null, code: string): "air" | "rail" | "other" {
  const d = (desc ?? "").toLowerCase();
  if (/kereta|\bka\b|argo|commuter|kai/.test(d)) return "rail";
  if (code === "O-TRANSPORT" || /pesawat|flight/.test(d) || RE_IATA_PAIR.test(desc ?? "")) return "air";
  return "other";
}

// ============ parameter & filter awal (mirror T-MED-REPORTS) ============

interface ReportFilters {
  office: string | null;
  unit: string | null;
  /** id TravelTemplate. */
  template: string | null;
  /** id TravelExpenseType. */
  expenseType: string | null;
  /** status TravelRequest (tr11/tr12). */
  status: string | null;
  /** status TravelClaim (tr21). */
  claimStatus: string | null;
  year: number | null;
  /** YYYY-MM-DD */
  from: string | null;
  to: string | null;
}

const isYMD = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ============ util kecil ============

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const round2 = (n: number) => Math.round(n * 100) / 100;
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Hari trip inklusif: ceil(Δhari) + 1 (berangkat & pulang dihitung). */
const durationDaysOf = (from: Date, to: Date) =>
  Math.max(1, Math.ceil((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1);

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["travel:travel-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan). ----
    if (id === "_params") {
      const [offices, units, templates, expenseTypes, minReq, minClaim] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        db.travelTemplate.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        db.travelExpenseType.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        db.travelRequest.aggregate({ _min: { requestDate: true } }),
        db.travelClaim.aggregate({ _min: { claimDate: true } }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = Math.min(
        minReq._min.requestDate?.getFullYear() ?? nowP.getFullYear(),
        minClaim._min.claimDate?.getFullYear() ?? nowP.getFullYear(),
      );
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        templates: templates.map((t) => ({ id: t.id, label: `${t.code} — ${t.name}` })),
        expenseTypes: expenseTypes.map((t) => ({ id: t.id, label: `${t.code} — ${t.name}` })),
        statuses: REQ_STATUS_ORDER.map((s) => ({ id: s, label: REQ_STATUS_LABELS[s] ?? s })),
        claimStatuses: CLAIM_STATUS_ORDER.map((s) => ({ id: s, label: CLAIM_STATUS_LABELS[s] ?? s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (tr11…tr43)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const yearParam = sp.get("year");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      unit: sp.get("unit") || null,
      template: sp.get("template") || null,
      expenseType: sp.get("expenseType") || null,
      status: sp.get("status") || null,
      claimStatus: sp.get("claimStatus") || null,
      year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null,
      from: isYMD(fromParam) ? fromParam : null,
      to: isYMD(toParam) ? toParam : null,
    };

    const scope = await resolveAccessScope(db, {
      appUserId: m.actor.appUserId,
      employeeId: m.actor.employeeId,
      appUserRole: m.actor.appUserRole,
      platformRole: m.actor.role,
    });
    const scopeCond = scopeWhere(scope);
    const tc = tenantCryptoForDb(db);
    const mv = await moneyViewForReq(req, db);
    const now = new Date();

    // ---- fetch utama ----
    const [rawEmps, typesAll, unitsAll, officesAll, templatesAll, ratesAll, requestsAll, claimsAll, budgetsAll, company] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          id: true, employeeNo: true, fullName: true, phone: true, status: true,
          orgUnitId: true, companyOfficeId: true, gradeId: true,
          grade: { select: { name: true } },
          assignments: {
            where: { validTo: null },
            select: { orgUnit: { select: { name: true } } },
            orderBy: { validFrom: "desc" },
            take: 1,
          },
        },
      }),
      db.travelExpenseType.findMany({
        select: { id: true, code: true, name: true, kind: true, limitAmount: true, unlimited: true, active: true },
      }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true } }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, active: true } }),
      db.travelTemplate.findMany({ select: { id: true, code: true, name: true } }),
      db.travelCityRate.findMany({ select: { city: true, country: true, overseas: true, uangHarian: true, plafonHotel: true, active: true } }),
      db.travelRequest.findMany({
        select: {
          id: true, docNo: true, employeeId: true, requestDate: true, dateFrom: true, dateTo: true,
          templateId: true, costCenter: true, purpose: true, status: true, decisionNote: true, claimRequestedAt: true,
          destinations: { select: { seq: true, city: true, country: true, dateFrom: true, dateTo: true, overseas: true }, orderBy: { seq: "asc" } },
          advances: { select: { amount: true, status: true, givenAt: true } },
          claims: { select: { docNo: true, status: true, totalSettlement: true } },
        },
        orderBy: [{ requestDate: "desc" }, { docNo: "desc" }],
        take: 500,
      }),
      db.travelClaim.findMany({
        select: {
          id: true, docNo: true, employeeId: true, requestId: true, claimDate: true, templateId: true,
          costCenter: true, purpose: true, status: true,
          otherCompanyExp: true, exchangeLoss: true, payableEmployee: true, payableCompany: true, totalSettlement: true,
          settlementMethod: true, journalNo: true, periodCode: true,
          expenses: {
            select: { expenseCode: true, kind: true, expenseDate: true, description: true, amount: true, qty: true, guestName: true, overLimit: true },
          },
          request: {
            select: {
              docNo: true, purpose: true, costCenter: true, dateFrom: true, dateTo: true,
              destinations: { select: { seq: true, city: true, country: true, dateFrom: true, dateTo: true, overseas: true }, orderBy: { seq: "asc" } },
              advances: { select: { amount: true, status: true } },
            },
          },
        },
        orderBy: [{ claimDate: "desc" }, { docNo: "desc" }],
        take: 500,
      }),
      db.travelBudget.findMany({ select: { year: true, totalBudget: true, items: { select: { costCenter: true, amount: true } } } }),
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    ]);

    // ---- maps ----
    const decMoney = (v: string | null | undefined) => tc.decryptMoney(v) ?? 0;
    const typeByCode = new Map(typesAll.map((t) => [t.code, t]));
    const typeById = new Map(typesAll.map((t) => [t.id, t]));
    const templateById = new Map(templatesAll.map((t) => [t.id, t]));
    const unitById = new Map(unitsAll.map((u) => [u.id, u]));
    const officeById = new Map(officesAll.map((o) => [o.id, o]));
    /** Σ uang muka AKTIF (status ≠ Void) — mirror sumActiveAdvances travel-service. */
    const sumActiveAdvances = (advances: { amount: string | null; status: string | null }[]) =>
      round2(advances.filter((a) => (a.status ?? "Given") !== "Void").reduce((s, a) => s + decMoney(a.amount), 0));

    // ---- normalisasi karyawan + filter cakupan ----
    interface EnrEmp {
      id: string; employeeNo: string; fullName: string; phone: string | null;
      status: string; orgUnitId: string | null; companyOfficeId: string | null;
      unitName: string | null; gradeName: string | null;
    }
    const rawUnitName = (unitId: string | null) => (unitId ? unitById.get(unitId)?.name ?? null : null);
    const emps: EnrEmp[] = rawEmps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, phone: e.phone,
      status: e.status, orgUnitId: e.orgUnitId, companyOfficeId: e.companyOfficeId,
      unitName: e.assignments[0]?.orgUnit?.name ?? rawUnitName(e.orgUnitId),
      gradeName: e.grade?.name ?? null,
    }));
    const empById = new Map(emps.map((e) => [e.id, e]));

    const unitSubtreeIds = (rootId: string): Set<string> => {
      const ids = new Set<string>();
      const walk = (pid: string) => {
        ids.add(pid);
        for (const u of unitsAll) if (u.parentId === pid) walk(u.id);
      };
      walk(rootId);
      return ids;
    };
    const scopedUnitIds = fp.unit ? unitSubtreeIds(fp.unit) : null;
    const scoped = emps.filter((e) =>
      (!fp.office || e.companyOfficeId === fp.office)
      && (!scopedUnitIds || (!!e.orgUnitId && scopedUnitIds.has(e.orgUnitId))),
    );
    const scopedIds = new Set(scoped.map((e) => e.id));
    const sortByNo = (a: { employeeNo: string }, b: { employeeNo: string }) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // ---- tarif kota (SBI) — pencocokan dua arah mirror matchCityRate ----
    interface CityRate { city: string; country: string; overseas: boolean; uangHarian: number; plafonHotel: number }
    const rates: CityRate[] = ratesAll.filter((r) => r.active);
    const matchRate = (city: string): CityRate | null => {
      const c = city.trim().toLowerCase();
      if (!c) return null;
      let best: CityRate | null = null;
      for (const r of rates) {
        const rc = r.city.trim().toLowerCase();
        if (!rc) continue;
        if (c === rc || c.includes(rc) || rc.includes(c)) {
          if (!best || rc.length > best.city.trim().toLowerCase().length) best = r;
        }
      }
      return best;
    };

    // ---- request ter-scope + ter-enrich (uang RAW hasil decrypt) ----
    interface EnrDest { seq: number; city: string; country: string; dateFrom: Date; dateTo: Date; overseas: boolean }
    interface EnrRequest {
      id: string; docNo: string; emp: EnrEmp; requestDate: Date; dateFrom: Date; dateTo: Date;
      templateId: string; templateCode: string; templateName: string; costCenter: string | null;
      purpose: string; status: string; decisionNote: string | null; claimRequestedAt: Date | null;
      destinations: EnrDest[]; advanceTotal: number;
      advances: { amount: number; status: string; givenAt: Date | null }[];
      claims: { docNo: string; status: string; totalSettlement: number }[];
    }
    const mkDests = (ds: { seq: number; city: string; country: string; dateFrom: Date; dateTo: Date; overseas: boolean }[]): EnrDest[] =>
      [...ds].sort((a, b) => a.seq - b.seq).map((d) => ({ seq: d.seq, city: d.city, country: d.country, dateFrom: new Date(d.dateFrom), dateTo: new Date(d.dateTo), overseas: d.overseas }));
    const requests: EnrRequest[] = requestsAll
      .filter((r) => scopedIds.has(r.employeeId))
      .map((r) => {
        const emp = empById.get(r.employeeId);
        const tpl = templateById.get(r.templateId);
        if (!emp || !tpl) return null;
        return {
          id: r.id, docNo: r.docNo, emp,
          requestDate: new Date(r.requestDate), dateFrom: new Date(r.dateFrom), dateTo: new Date(r.dateTo),
          templateId: r.templateId, templateCode: tpl.code, templateName: tpl.name,
          costCenter: r.costCenter, purpose: r.purpose, status: r.status,
          decisionNote: r.decisionNote, claimRequestedAt: r.claimRequestedAt,
          destinations: mkDests(r.destinations),
          advanceTotal: sumActiveAdvances(r.advances),
          advances: r.advances.map((a) => ({ amount: decMoney(a.amount), status: a.status ?? "Given", givenAt: a.givenAt })),
          claims: r.claims.map((c) => ({ docNo: c.docNo, status: c.status, totalSettlement: decMoney(c.totalSettlement) })),
        } satisfies EnrRequest;
      })
      .filter((r): r is EnrRequest => !!r);
    const requestById = new Map(requests.map((r) => [r.id, r]));

    // ---- klaim ter-scope + ter-enrich (uang RAW; kind dari master jenis biaya) ----
    interface EnrExpense {
      expenseCode: string; typeName: string; kind: string; kindLabel: string;
      limit: number; unlimited: boolean;
      expenseDate: Date | null; description: string | null;
      amount: number; qty: number; guestName: string | null;
      overLimit: boolean; overLimitCalc: boolean;
    }
    interface EnrClaim {
      id: string; docNo: string; emp: EnrEmp; claimDate: Date;
      templateCode: string; templateName: string; costCenter: string | null; purpose: string | null;
      status: string; otherCompanyExp: number; exchangeLoss: number;
      payableEmployee: number; payableCompany: number; totalSettlement: number;
      settlementMethod: string; journalNo: string | null; periodCode: string | null;
      request: EnrRequest | null;
      expenses: EnrExpense[];
    }
    const claims: EnrClaim[] = claimsAll
      .filter((c) => scopedIds.has(c.employeeId))
      .map((c) => {
        const emp = empById.get(c.employeeId);
        const tpl = templateById.get(c.templateId);
        if (!emp || !tpl) return null;
        return {
          id: c.id, docNo: c.docNo, emp, claimDate: new Date(c.claimDate),
          templateCode: tpl.code, templateName: tpl.name, costCenter: c.costCenter, purpose: c.purpose,
          status: c.status,
          otherCompanyExp: decMoney(c.otherCompanyExp), exchangeLoss: decMoney(c.exchangeLoss),
          payableEmployee: decMoney(c.payableEmployee), payableCompany: decMoney(c.payableCompany),
          totalSettlement: decMoney(c.totalSettlement),
          settlementMethod: c.settlementMethod, journalNo: c.journalNo, periodCode: c.periodCode,
          request: c.requestId ? requestById.get(c.requestId) ?? null : null,
          expenses: c.expenses.map((e) => {
            const t = typeByCode.get(e.expenseCode);
            const kind = t?.kind ?? e.kind ?? "GENERAL";
            const qty = e.qty && e.qty > 0 ? e.qty : 1;
            const amount = decMoney(e.amount);
            // Task 98 (F0-6/B6) — over-limit PER UNIT (nominal ÷ qty vs limit).
            const overLimitCalc = !!t && !t.unlimited && t.limitAmount > 0 && amount / Math.max(1, qty) > t.limitAmount;
            return {
              expenseCode: e.expenseCode, typeName: t?.name ?? e.expenseCode, kind, kindLabel: KIND_LABELS[kind] ?? kind,
              limit: t?.limitAmount ?? 0, unlimited: t?.unlimited ?? false,
              expenseDate: e.expenseDate ? new Date(e.expenseDate) : null, description: e.description,
              amount, qty, guestName: e.guestName,
              overLimit: e.overLimit || overLimitCalc, overLimitCalc,
            } satisfies EnrExpense;
          }),
        } satisfies EnrClaim;
      })
      .filter((c): c is EnrClaim => !!c);

    // ---- budget per tahun/cost center (RAW) ----
    const budgetByYear = new Map<number, { totalBudget: number; items: Map<string, number> }>();
    for (const b of budgetsAll) {
      budgetByYear.set(b.year, {
        totalBudget: decMoney(b.totalBudget),
        items: new Map(b.items.map((i) => [i.costCenter, decMoney(i.amount)])),
      });
    }

    const fromD = fp.from ? new Date(`${fp.from}T00:00:00`) : null;
    const toD = fp.to ? new Date(`${fp.to}T23:59:59`) : null;

    // ---- chip parameter terpasang (kop dokumen) ----
    const filterChips: { label: string; value: string }[] = [];
    if (fp.office) {
      const o = officeById.get(fp.office);
      if (o) filterChips.push({ label: "Cabang", value: `${o.name}${o.city ? ` — ${o.city}` : ""}` });
    }
    if (fp.unit) {
      const u = unitById.get(fp.unit);
      if (u) filterChips.push({ label: "Unit", value: u.name });
    }
    if (fp.template) {
      const t = templateById.get(fp.template);
      if (t) filterChips.push({ label: "Jenis Perjalanan", value: `${t.code} — ${t.name}` });
    }
    if (fp.expenseType) {
      const t = typeById.get(fp.expenseType);
      if (t) filterChips.push({ label: "Jenis Biaya", value: `${t.code} — ${t.name}` });
    }
    if (fp.status) filterChips.push({ label: "Status Pengajuan", value: REQ_STATUS_LABELS[fp.status] ?? fp.status });
    if (fp.claimStatus) filterChips.push({ label: "Status Klaim", value: CLAIM_STATUS_LABELS[fp.claimStatus] ?? fp.claimStatus });
    if (fp.year) filterChips.push({ label: "Tahun Buku", value: String(fp.year) });
    if (fp.from || fp.to) {
      const fd = fp.from ? dateID(new Date(`${fp.from}T00:00:00`)) : "awal riwayat";
      const td = fp.to ? dateID(new Date(`${fp.to}T00:00:00`)) : dateID(now);
      filterChips.push({ label: "Rentang Tanggal", value: `${fd} – ${td}` });
    }

    const activeOffices = officesAll.filter((o) => o.active);
    const meta = {
      companyName: company?.name ?? "Perusahaan",
      companyAddress: company?.address ?? null,
      companyCity: company?.city ?? null,
      companyTaxId: company?.taxId ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      branchLabel: fp.office
        ? officeById.get(fp.office)?.name ?? "Semua Cabang & Lokasi Kerja"
        : activeOffices.length === 1 ? activeOffices[0].name : "Semua Cabang & Lokasi Kerja",
      printedBy: m.actor.name,
      generatedAt: now.toISOString(),
      year: now.getFullYear(),
      scope: scope.all ? "all" : "scoped",
      filters: filterChips,
    };

    // ---- konteks builder ----
    const ctx: Ctx = {
      db, scoped, scopedIds, requests, claims, requestById,
      typeByCode, typeById, templateById, matchRate,
      budgetByYear, now, fp, meta, tc, mv,
      unitById, officeById, sortByNo, fromD, toD,
    };

    const data = await buildReport(id, ctx);

    // ---- mode export XLSX ----
    if (sp.get("export") === "xlsx") {
      // BL-4: bahasa ekspor — default EN (frontend selalu mengirim ?lang=;
      // "id" eksplisit → Indonesia, tanpa param pun → EN utk kompatibilitas maju).
      const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
      const sheets = buildSheets(id, data, data.periodLabel, lang);
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "TravelReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi Travel (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-travel-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ tipe konteks ============

interface Ctx {
  db: TenantDb;
  scoped: {
    id: string; employeeNo: string; fullName: string; phone: string | null;
    status: string; orgUnitId: string | null; companyOfficeId: string | null;
    unitName: string | null; gradeName: string | null;
  }[];
  scopedIds: Set<string>;
  requests: {
    id: string; docNo: string; emp: { id: string; employeeNo: string; fullName: string; phone: string | null; unitName: string | null; gradeName: string | null };
    requestDate: Date; dateFrom: Date; dateTo: Date;
    templateId: string; templateCode: string; templateName: string; costCenter: string | null;
    purpose: string; status: string; decisionNote: string | null; claimRequestedAt: Date | null;
    destinations: { seq: number; city: string; country: string; dateFrom: Date; dateTo: Date; overseas: boolean }[];
    advanceTotal: number;
    advances: { amount: number; status: string; givenAt: Date | null }[];
    claims: { docNo: string; status: string; totalSettlement: number }[];
  }[];
  claims: {
    id: string; docNo: string; emp: { id: string; employeeNo: string; fullName: string; phone: string | null; unitName: string | null; gradeName: string | null };
    claimDate: Date; templateCode: string; templateName: string; costCenter: string | null; purpose: string | null;
    status: string; otherCompanyExp: number; exchangeLoss: number;
    payableEmployee: number; payableCompany: number; totalSettlement: number;
    settlementMethod: string; journalNo: string | null; periodCode: string | null;
    request: Ctx["requests"][number] | null;
    expenses: {
      expenseCode: string; typeName: string; kind: string; kindLabel: string;
      limit: number; unlimited: boolean; expenseDate: Date | null; description: string | null;
      amount: number; qty: number; guestName: string | null; overLimit: boolean; overLimitCalc: boolean;
    }[];
  }[];
  requestById: Map<string, Ctx["requests"][number]>;
  typeByCode: Map<string, { id: string; code: string; name: string; kind: string; limitAmount: number; unlimited: boolean; active: boolean }>;
  typeById: Map<string, { id: string; code: string; name: string; kind: string; limitAmount: number; unlimited: boolean; active: boolean }>;
  templateById: Map<string, { id: string; code: string; name: string }>;
  matchRate: (city: string) => { city: string; country: string; overseas: boolean; uangHarian: number; plafonHotel: number } | null;
  budgetByYear: Map<number, { totalBudget: number; items: Map<string, number> }>;
  now: Date;
  fp: ReportFilters;
  meta: {
    companyName: string; companyAddress: string | null; companyCity: string | null;
    companyTaxId: string | null; companyLogoUrl: string | null; branchLabel: string;
    printedBy: string; generatedAt: string; year: number; scope: string;
    filters: { label: string; value: string }[];
  };
  tc: ReturnType<typeof tenantCryptoForDb>;
  mv: Awaited<ReturnType<typeof moneyViewForReq>>;
  unitById: Map<string, { id: string; code: string; name: string; parentId: string | null; level: number }>;
  officeById: Map<string, { id: string; code: string; name: string; city: string | null; active: boolean }>;
  sortByNo: (a: { employeeNo: string }, b: { employeeNo: string }) => number;
  fromD: Date | null;
  toD: Date | null;
}

async function buildReport(id: string, ctx: Ctx): Promise<{ periodLabel: string; payload: unknown }> {
  switch (id) {
    case "tr11": return tr11Requests(ctx);
    case "tr12": return tr12Advances(ctx);
    case "tr13": return tr13Active(ctx);
    case "tr21": return tr21Register(ctx);
    case "tr22": return tr22ByExpense(ctx);
    case "tr23": return tr23LocalTransport(ctx);
    case "tr31": return tr31Violations(ctx);
    case "tr32": return tr32LostSavings(ctx);
    case "tr33": return tr33Roi(ctx);
    case "tr41": return tr41Corporate(ctx);
    case "tr42": return tr42HotelVolume(ctx);
    default: return tr43Carriers(ctx);
  }
}

// ---- helper bersama ----

/** Baris biaya rata dgn referensi klaimnya (tr22/tr23/tr31/tr32/tr42/tr43). */
interface ExpLine {
  claim: Ctx["claims"][number];
  exp: Ctx["claims"][number]["expenses"][number];
  /** tanggal efektif: expenseDate fallback claimDate (tr23). */
  dateOf: Date;
}
function allExpenses(ctx: Ctx, claims: Ctx["claims"], useExpenseDate: boolean): ExpLine[] {
  const out: ExpLine[] = [];
  for (const c of claims) {
    for (const e of c.expenses) {
      out.push({ claim: c, exp: e, dateOf: useExpenseDate ? (e.expenseDate ?? c.claimDate) : c.claimDate });
    }
  }
  return out;
}
function expenseTypeCodeOf(ctx: Ctx): string | null {
  return ctx.fp.expenseType ? ctx.typeById.get(ctx.fp.expenseType)?.code ?? null : null;
}

/** City-match best-effort baris biaya → destinasi SPPD (tr32/tr42). */
function cityOfExpense(
  claim: Ctx["claims"][number],
  exp: Ctx["claims"][number]["expenses"][number],
): { city: string; matched: boolean; country: string; overseas: boolean } {
  const req = claim.request;
  if (!req || req.destinations.length === 0) {
    return { city: UNMATCHED_CITY, matched: false, country: "—", overseas: false };
  }
  const dests = req.destinations; // sudah urut seq asc
  if (dests.length === 1) return { city: dests[0].city, matched: true, country: dests[0].country, overseas: dests[0].overseas };
  if (exp.expenseDate) {
    const ed = dayStart(exp.expenseDate);
    const hit = dests.find((d) => dayStart(d.dateFrom) <= ed && ed <= dayStart(d.dateTo));
    if (hit) return { city: hit.city, matched: true, country: hit.country, overseas: hit.overseas };
  }
  return { city: UNMATCHED_CITY, matched: false, country: "—", overseas: false };
}

/** (tripFrom − expenseDate) dalam hari; negatif = dibeli saat/sesudah trip. */
function daysToDepartureOf(claim: Ctx["claims"][number], exp: Ctx["claims"][number]["expenses"][number]): number | null {
  if (!claim.request || !exp.expenseDate) return null;
  return Math.floor((dayStart(claim.request.dateFrom).getTime() - dayStart(exp.expenseDate).getTime()) / DAY_MS);
}

// ===================== G1 — PENGAJUAN & VALIDASI PERJALANAN DINAS =====================

// ---------- TR1.1 Master Travel Request & Log SPPD ----------
function tr11Requests(ctx: Ctx): { periodLabel: string; payload: TR11Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const reqs = ctx.requests.filter((r) =>
    (!ctx.fp.template || r.templateId === ctx.fp.template)
    && (!ctx.fp.status || r.status === ctx.fp.status)
    && r.requestDate >= from && r.requestDate <= to);
  const items: TR11Data["items"] = reqs.map((r) => ({
    docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: r.emp.unitName,
    templateCode: r.templateCode, templateName: r.templateName,
    requestDate: iso(r.requestDate) ?? "", dateFrom: iso(r.dateFrom) ?? "", dateTo: iso(r.dateTo) ?? "",
    durationDays: durationDaysOf(r.dateFrom, r.dateTo),
    destinations: r.destinations.map((d) => d.city).join(" → "),
    overseas: r.destinations.some((d) => d.overseas),
    purpose: r.purpose, costCenter: r.costCenter,
    status: r.status as TR11Data["items"][number]["status"],
    statusLabel: REQ_STATUS_LABELS[r.status] ?? r.status,
    decisionNote: r.decisionNote,
    claimRequested: !!r.claimRequestedAt,
    advance: canSee ? r.advanceTotal : null,
  }));
  const statusCounts = new Map<string, number>();
  for (const r of reqs) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  let sumAdvance = 0;
  for (const r of reqs) sumAdvance += r.advanceTotal;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — tanggal pengajuan SPPD`,
    payload: {
      items,
      total: items.length,
      byStatus: REQ_STATUS_ORDER
        .map((st) => ({ status: st, label: REQ_STATUS_LABELS[st] ?? st, count: statusCounts.get(st) ?? 0 }))
        .filter((s) => s.count > 0),
      overseasCount: items.filter((i) => i.overseas).length,
      claimRequestedCount: items.filter((i) => i.claimRequested).length,
      sum: { durationDays: items.reduce((s, i) => s + i.durationDays, 0), advance: canSee ? round2(sumAdvance) : null },
    },
  };
}

// ---------- TR1.2 Cash Advance Disbursed Sheet ----------
function tr12Advances(ctx: Ctx): { periodLabel: string; payload: TR12Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const reqs = ctx.requests.filter((r) =>
    (!ctx.fp.template || r.templateId === ctx.fp.template)
    && (!ctx.fp.status || r.status === ctx.fp.status)
    && r.requestDate >= from && r.requestDate <= to);
  const items: TR12Data["items"] = [];
  for (const r of reqs) {
    for (const a of r.advances) {
      const activeClaims = r.claims.filter((c) => c.status !== "Rejected" && c.status !== "Cancelled");
      const doneClaims = activeClaims.filter((c) => CLAIM_DONE.includes(c.status));
      const settlement: TR12Data["items"][number]["settlement"] = doneClaims.length
        ? "settled"
        : activeClaims.length ? "processing" : "unsettled";
      const latest = activeClaims[activeClaims.length - 1] ?? null;
      const settledTotal = doneClaims.reduce((s, c) => s + c.totalSettlement, 0);
      const outstanding = Math.max(0, round2(a.amount - settledTotal));
      items.push({
        docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: r.emp.unitName,
        destinations: r.destinations.map((d) => d.city).join(" → "),
        purpose: r.purpose, costCenter: r.costCenter,
        requestDate: iso(r.requestDate) ?? "", tripFrom: iso(r.dateFrom) ?? "", tripTo: iso(r.dateTo) ?? "",
        advanceStatus: a.status as TR12Data["items"][number]["advanceStatus"],
        advanceStatusLabel: ADV_STATUS_LABELS[a.status] ?? a.status,
        givenAt: iso(a.givenAt),
        amount: canSee ? a.amount : null,
        claimDocNo: latest?.docNo ?? null,
        claimStatusLabel: latest ? CLAIM_STATUS_LABELS[latest.status] ?? latest.status : null,
        settlement,
        settlementLabel: SETTLEMENT_LABELS[settlement] ?? settlement,
        outstanding: canSee ? outstanding : null,
      });
    }
  }
  const advCounts = new Map<string, number>();
  for (const i of items) advCounts.set(i.advanceStatus, (advCounts.get(i.advanceStatus) ?? 0) + 1);
  let sumAmount = 0, sumOutstanding = 0;
  for (const r of reqs) for (const a of r.advances) sumAmount += a.amount;
  for (const i of items) sumOutstanding += i.outstanding ?? 0;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — uang muka per tanggal pengajuan SPPD`,
    payload: {
      items,
      byStatus: ADV_STATUS_ORDER
        .map((st) => ({ status: st, label: ADV_STATUS_LABELS[st] ?? st, count: advCounts.get(st) ?? 0 }))
        .filter((s) => s.count > 0),
      counts: {
        given: advCounts.get("Given") ?? 0,
        requested: advCounts.get("Requested") ?? 0,
        void: advCounts.get("Void") ?? 0,
        unsettled: items.filter((i) => i.settlement === "unsettled").length,
      },
      sum: { amount: canSee ? round2(sumAmount) : null, outstanding: canSee ? round2(sumOutstanding) : null },
    },
  };
}

// ---------- TR1.3 Active Business Travelers Tracking Sheet ----------
function tr13Active(ctx: Ctx): { periodLabel: string; payload: TR13Data } {
  const canSee = ctx.mv.canSee;
  const today = dayStart(ctx.now);
  const reqs = ctx.requests.filter((r) =>
    r.status === "Approved" && dayStart(r.dateFrom) <= today && today <= dayStart(r.dateTo));
  const items: TR13Data["items"] = reqs.map((r) => {
    const dayNo = Math.floor((today.getTime() - dayStart(r.dateFrom).getTime()) / DAY_MS) + 1;
    const daysToReturn = Math.floor((dayStart(r.dateTo).getTime() - today.getTime()) / DAY_MS);
    const phase: ActivePhase = daysToReturn === 0 ? "final-day" : daysToReturn <= 2 ? "returning-soon" : "mid-trip";
    // kota saat ini = kaki destinasi yang menutupi hari ini; fallback kaki terakhir.
    const currentCity = r.destinations.find((d) => dayStart(d.dateFrom) <= today && today <= dayStart(d.dateTo))?.city
      ?? r.destinations[r.destinations.length - 1]?.city ?? "—";
    return {
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName, unit: r.emp.unitName,
      phone: r.emp.phone, grade: r.emp.gradeName,
      destinations: r.destinations.map((d) => d.city).join(" → "),
      overseas: r.destinations.some((d) => d.overseas),
      tripFrom: iso(r.dateFrom) ?? "", tripTo: iso(r.dateTo) ?? "",
      totalDays: durationDaysOf(r.dateFrom, r.dateTo), dayNo, daysToReturn,
      currentCity, costCenter: r.costCenter, purpose: r.purpose,
      phase, phaseLabel: PHASE_LABELS[phase],
      advance: canSee ? r.advanceTotal : null,
    };
  });
  let sumAdvance = 0;
  for (const r of reqs) sumAdvance += r.advanceTotal;
  return {
    periodLabel: `Posisi per ${dateID(ctx.now)} — karyawan aktif bertugas di luar kota/negeri`,
    payload: {
      asOf: `${ctx.now.getFullYear()}-${String(ctx.now.getMonth() + 1).padStart(2, "0")}-${String(ctx.now.getDate()).padStart(2, "0")}`,
      items,
      total: items.length,
      overseasCount: items.filter((i) => i.overseas).length,
      domesticCount: items.filter((i) => !i.overseas).length,
      returningSoon: items.filter((i) => i.phase === "final-day" || i.phase === "returning-soon").length,
      sum: { advance: canSee ? round2(sumAdvance) : null },
    },
  };
}

// ===================== G2 — REALISASI & REKONSILIASI BIAYA =====================

// ---------- TR2.1 Travel Settlement & Expense Claim Register ----------
function tr21Register(ctx: Ctx): { periodLabel: string; payload: TR21Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const claims = ctx.claims.filter((c) =>
    (!ctx.fp.claimStatus || c.status === ctx.fp.claimStatus)
    && c.claimDate >= from && c.claimDate <= to);
  const items: TR21Data["items"] = claims.map((c) => ({
    docNo: c.docNo, claimDate: iso(c.claimDate) ?? "",
    employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: c.emp.unitName,
    requestDocNo: c.request?.docNo ?? null,
    templateName: c.templateName,
    purpose: c.purpose ?? c.request?.purpose ?? null,
    costCenter: c.costCenter,
    expenseCount: c.expenses.length,
    expenseTotal: g(round2(c.expenses.reduce((s, e) => s + e.amount, 0))),
    otherCompanyExp: g(c.otherCompanyExp),
    exchangeLoss: g(c.exchangeLoss),
    totalSettlement: g(c.totalSettlement),
    advance: g(c.request ? c.request.advanceTotal : 0),
    payableEmployee: g(c.payableEmployee),
    payableCompany: g(c.payableCompany),
    status: c.status, statusLabel: CLAIM_STATUS_LABELS[c.status] ?? c.status,
    journalNo: c.journalNo, periodCode: c.periodCode,
    settlementMethod: c.settlementMethod,
  }));
  const statusCounts = new Map<string, number>();
  for (const c of claims) statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
  const sum = {
    expenseTotal: 0, otherCompanyExp: 0, exchangeLoss: 0, totalSettlement: 0,
    advance: 0, payableEmployee: 0, payableCompany: 0,
  };
  for (const c of claims) {
    sum.expenseTotal += c.expenses.reduce((s, e) => s + e.amount, 0);
    sum.otherCompanyExp += c.otherCompanyExp;
    sum.exchangeLoss += c.exchangeLoss;
    sum.totalSettlement += c.totalSettlement;
    sum.advance += c.request ? c.request.advanceTotal : 0;
    sum.payableEmployee += c.payableEmployee;
    sum.payableCompany += c.payableCompany;
  }
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — tanggal klaim settlement`,
    payload: {
      items,
      total: items.length,
      byStatus: CLAIM_STATUS_ORDER
        .map((st) => ({ status: st, label: CLAIM_STATUS_LABELS[st] ?? st, count: statusCounts.get(st) ?? 0 }))
        .filter((s) => s.count > 0),
      sum: {
        expenseTotal: g(round2(sum.expenseTotal)), otherCompanyExp: g(round2(sum.otherCompanyExp)),
        exchangeLoss: g(round2(sum.exchangeLoss)), totalSettlement: g(round2(sum.totalSettlement)),
        advance: g(round2(sum.advance)), payableEmployee: g(round2(sum.payableEmployee)),
        payableCompany: g(round2(sum.payableCompany)),
      },
    },
  };
}

// ---------- TR2.2 Itemized Expense Category Breakdown ----------
function tr22ByExpense(ctx: Ctx): { periodLabel: string; payload: TR22Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  const lines = allExpenses(ctx, ctx.claims.filter((c) => c.claimDate.getFullYear() === year), false)
    .filter((l) => !codeFilter || l.exp.expenseCode === codeFilter);
  interface CodeAgg { code: string; name: string; kind: string; claims: Set<string>; lines: number; qty: number; amount: number; overLimit: number }
  const byCodeMap = new Map<string, CodeAgg>();
  for (const l of lines) {
    const agg = byCodeMap.get(l.exp.expenseCode) ?? {
      code: l.exp.expenseCode, name: l.exp.typeName, kind: l.exp.kind,
      claims: new Set<string>(), lines: 0, qty: 0, amount: 0, overLimit: 0,
    };
    agg.claims.add(l.claim.docNo); agg.lines += 1; agg.qty += l.exp.qty; agg.amount += l.exp.amount;
    if (l.exp.overLimit) agg.overLimit += 1;
    byCodeMap.set(l.exp.expenseCode, agg);
  }
  const totalAmount = [...byCodeMap.values()].reduce((s, a) => s + a.amount, 0);
  const rows: TR22Data["rows"] = [...byCodeMap.values()]
    .sort((a, b) => b.amount - a.amount || a.code.localeCompare(b.code))
    .map((a) => ({
      code: a.code, name: a.name, kind: a.kind, kindLabel: KIND_LABELS[a.kind] ?? a.kind,
      claimCount: a.claims.size, expenseCount: a.lines,
      qty: round2(a.qty), amount: g(round2(a.amount)), overLimitCount: a.overLimit,
      sharePct: canSee && totalAmount > 0 ? round2((a.amount / totalAmount) * 100) : null,
      avgPerLine: canSee && a.lines > 0 ? round2(a.amount / a.lines) : null,
    }));
  const kindAgg = new Map<string, number>();
  for (const a of byCodeMap.values()) kindAgg.set(a.kind, (kindAgg.get(a.kind) ?? 0) + a.amount);
  const byKind = [...kindAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([kind, amount]) => ({
      kind, kindLabel: KIND_LABELS[kind] ?? kind,
      amount: g(round2(amount)),
      sharePct: canSee && totalAmount > 0 ? round2((amount / totalAmount) * 100) : null,
    }));
  const monthly = MONTHS_ID.map((mo, i) => {
    const inM = lines.filter((l) => l.claim.claimDate.getMonth() === i);
    return {
      month: mo.slice(0, 3), lines: inM.length,
      amount: g(round2(inM.reduce((s, l) => s + l.exp.amount, 0))),
    };
  });
  return {
    periodLabel: `Tahun Buku ${year} — tanggal klaim`,
    payload: {
      year, rows, byKind, monthly,
      total: {
        lines: lines.length,
        amount: g(round2(totalAmount)),
        overLimitCount: lines.filter((l) => l.exp.overLimit).length,
      },
    },
  };
}

// ---------- TR2.3 Mileage & Local Transport Reimbursement Log ----------
function tr23LocalTransport(ctx: Ctx): { periodLabel: string; payload: TR23Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  // scope: kind MILEAGE ATAU L-/O-TRANSPORT yang keterangannya transport lokal.
  const lines = allExpenses(ctx, ctx.claims, true).filter((l) => {
    if (codeFilter && l.exp.expenseCode !== codeFilter) return false;
    if (l.dateOf < from || l.dateOf > to) return false;
    if (l.exp.kind === "MILEAGE") return true;
    if (l.exp.expenseCode === "L-TRANSPORT" || l.exp.expenseCode === "O-TRANSPORT") {
      return RE_LOCAL_TRANSPORT.test(l.exp.description ?? "");
    }
    return false;
  });
  const categoryOf = (l: ExpLine): TR23Data["items"][number]["category"] => {
    if (l.exp.expenseCode === "L-JARAK") return "mileage-km";
    if (l.exp.expenseCode === "L-BBM") return "fuel";
    if (RE_LOCAL_RAIL.test(l.exp.description ?? "")) return "local-rail";
    return "local-rent";
  };
  const qtyLabelOf = (l: ExpLine): string => {
    if (l.exp.expenseCode === "L-JARAK") return "km";
    if (l.exp.kind === "ALLOWANCE") return "hari";
    return "unit";
  };
  const items: TR23Data["items"] = lines.map((l) => {
    const category = categoryOf(l);
    return {
      claimDocNo: l.claim.docNo, claimDate: iso(l.claim.claimDate) ?? "",
      employeeNo: l.claim.emp.employeeNo, name: l.claim.emp.fullName, unit: l.claim.emp.unitName,
      expenseDate: iso(l.exp.expenseDate),
      code: l.exp.expenseCode, typeName: l.exp.typeName,
      category, categoryLabel: TR23_CATEGORY_LABELS[category] ?? category,
      description: l.exp.description,
      qty: l.exp.qty, qtyLabel: qtyLabelOf(l),
      amount: g(l.exp.amount),
      rate: canSee && l.exp.qty > 0 ? round2(l.exp.amount / l.exp.qty) : null,
      overLimit: l.exp.overLimit,
    };
  });
  const catAgg = new Map<string, { lines: number; qty: number; amount: number }>();
  for (const l of lines) {
    const c = categoryOf(l);
    const agg = catAgg.get(c) ?? { lines: 0, qty: 0, amount: 0 };
    agg.lines += 1; agg.qty += l.exp.qty; agg.amount += l.exp.amount;
    catAgg.set(c, agg);
  }
  const byCategory = TR23_CATEGORY_ORDER
    .filter((c) => catAgg.has(c))
    .map((c) => ({
      category: c, categoryLabel: TR23_CATEGORY_LABELS[c] ?? c,
      lines: catAgg.get(c)!.lines, qty: round2(catAgg.get(c)!.qty),
      amount: g(round2(catAgg.get(c)!.amount)),
    }));
  const codeAgg = new Map<string, { name: string; lines: number; qty: number; amount: number }>();
  for (const l of lines) {
    const agg = codeAgg.get(l.exp.expenseCode) ?? { name: l.exp.typeName, lines: 0, qty: 0, amount: 0 };
    agg.lines += 1; agg.qty += l.exp.qty; agg.amount += l.exp.amount;
    codeAgg.set(l.exp.expenseCode, agg);
  }
  const byCode = [...codeAgg.entries()]
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([code, a]) => ({
      code, name: a.name, lines: a.lines, qty: round2(a.qty), amount: g(round2(a.amount)),
      avgRate: canSee && a.qty > 0 ? round2(a.amount / a.qty) : null,
    }));
  let sumAmount = 0;
  for (const l of lines) sumAmount += l.exp.amount;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — tanggal biaya (fallback tanggal klaim)`,
    payload: {
      items, byCategory, byCode,
      total: items.length,
      totalKm: round2(lines.filter((l) => l.exp.expenseCode === "L-JARAK").reduce((s, l) => s + l.exp.qty, 0)),
      sum: { amount: g(round2(sumAmount)) },
    },
  };
}

// ===================== G3 — ANALISIS KEPATUHAN KEBIJAKAN =====================

// ---------- TR3.1 Travel Tier & Policy Violation Report ----------
function tr31Violations(ctx: Ctx): { periodLabel: string; payload: TR31Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  const lines = allExpenses(ctx, ctx.claims.filter((c) => c.claimDate.getFullYear() === year), false)
    .filter((l) =>
      (!codeFilter || l.exp.expenseCode === codeFilter)
      // pelanggaran: flag tersimpan ATAU recompute per unit (mirror travel-service).
      && (l.exp.overLimit || l.exp.overLimitCalc));
  const limitUnitOf = (l: ExpLine): string => {
    const c = l.exp.expenseCode;
    if (c.endsWith("HOTEL")) return "malam";
    if (l.exp.kind === "ALLOWANCE" || c === "L-POCKET") return "hari";
    if (c === "L-JARAK" || c === "L-BBM") return "km";
    return "pengajuan";
  };
  const items: TR31Data["items"] = lines.map((l) => {
    // excess per unit × qty — nilai lebih riil di atas plafon (baris 1 unit → sama dgn amount−limit).
    const perUnit = l.exp.amount / Math.max(1, l.exp.qty);
    const excess = Math.max(0, round2((perUnit - l.exp.limit) * Math.max(1, l.exp.qty)));
    const overPct = l.exp.limit > 0 ? round2(((perUnit - l.exp.limit) / l.exp.limit) * 100) : null;
    return {
      claimDocNo: l.claim.docNo, claimDate: iso(l.claim.claimDate) ?? "",
      employeeNo: l.claim.emp.employeeNo, name: l.claim.emp.fullName, unit: l.claim.emp.unitName,
      grade: l.claim.emp.gradeName ?? "—",
      code: l.exp.expenseCode, typeName: l.exp.typeName, kindLabel: l.exp.kindLabel,
      qty: l.exp.qty, amount: g(l.exp.amount),
      limit: l.exp.limit,
      limitLabel: `Rp ${l.exp.limit.toLocaleString("id-ID")} / ${limitUnitOf(l)}`,
      excess: g(excess), overPct: canSee ? overPct : null,
      claimStatus: l.claim.status, claimStatusLabel: CLAIM_STATUS_LABELS[l.claim.status] ?? l.claim.status,
      approvedAnyway: CLAIM_DONE.includes(l.claim.status),
    };
  });
  // agregat per kode + total (excess per unit × qty — konsisten dgn baris items).
  const codeAgg = new Map<string, { name: string; violations: number; excess: number }>();
  let sumExcess = 0;
  for (const l of lines) {
    const excess = Math.max(0, (l.exp.amount / Math.max(1, l.exp.qty) - l.exp.limit) * Math.max(1, l.exp.qty));
    const agg = codeAgg.get(l.exp.expenseCode) ?? { name: l.exp.typeName, violations: 0, excess: 0 };
    agg.violations += 1;
    agg.excess += excess;
    codeAgg.set(l.exp.expenseCode, agg);
    sumExcess += excess;
  }
  const byCode = [...codeAgg.entries()]
    .sort((a, b) => b[1].excess - a[1].excess)
    .map(([code, a]) => ({ code, name: a.name, violations: a.violations, excess: g(round2(a.excess)) }));
  return {
    periodLabel: `Tahun Buku ${year} — limit per unit (hari/km/malam)`,
    payload: {
      year, items, byCode,
      total: items.length,
      approvedAnyway: items.filter((i) => i.approvedAnyway).length,
      sum: { excess: g(round2(sumExcess)) },
    },
  };
}

// ---------- TR3.2 Lost Savings Opportunity Sheet ----------
function tr32LostSavings(ctx: Ctx): { periodLabel: string; payload: TR32Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  const lines = allExpenses(ctx, ctx.claims.filter((c) => c.claimDate.getFullYear() === year), false)
    .filter((l) => {
      if (codeFilter && l.exp.expenseCode !== codeFilter) return false;
      const c = l.exp.expenseCode;
      const isHotel = c === "L-HOTEL" || c === "O-HOTEL";
      const isPocket = c === "L-POCKET";
      const isTransport = c === "L-TRANSPORT" || c === "O-TRANSPORT";
      if (isHotel || isPocket) return true;
      // transport: hanya baris last-minute yang relevan utk analisis penghematan.
      if (isTransport) {
        const dtd = daysToDepartureOf(l.claim, l.exp);
        return dtd != null && dtd <= 1;
      }
      return false;
    });
  const catOf = (l: ExpLine): TR32Data["byCategory"][number]["category"] => {
    const c = l.exp.expenseCode;
    if (c === "L-TRANSPORT" || c === "O-TRANSPORT") return "last-minute";
    if (c === "L-POCKET") return "per-diem";
    return "hotel";
  };
  const items: TR32Data["items"] = lines.map((l) => {
    const cm = cityOfExpense(l.claim, l.exp);
    const code = l.exp.expenseCode;
    const isTransport = code === "L-TRANSPORT" || code === "O-TRANSPORT";
    const isPocket = code === "L-POCKET";
    const rate = cm.matched ? ctx.matchRate(cm.city) : null;
    let refRate = 0;
    let refLabel = "—";
    let lost: number | null = null;
    const actualPerUnit = canSee && l.exp.qty > 0 ? round2(l.exp.amount / l.exp.qty) : null;
    if (!isTransport && cm.matched) {
      if (rate) {
        refRate = isPocket ? rate.uangHarian : rate.plafonHotel;
        refLabel = isPocket ? `Uang harian ${cm.city} (SBI)` : `Plafon hotel ${cm.city} (SBI)`;
        if (canSee && l.exp.qty > 0) {
          lost = round2(Math.max(0, (l.exp.amount / l.exp.qty - refRate) * l.exp.qty));
        }
      } else {
        refLabel = `Tarif acuan ${cm.city} tidak tersedia`;
      }
    }
    const dtd = daysToDepartureOf(l.claim, l.exp);
    return {
      claimDocNo: l.claim.docNo,
      employeeNo: l.claim.emp.employeeNo, name: l.claim.emp.fullName,
      city: cm.city, cityMatched: cm.matched,
      code, typeName: l.exp.typeName,
      qty: l.exp.qty, qtyLabel: isTransport ? "tiket" : isPocket ? "hari" : "malam",
      actualPerUnit,
      refRate, refLabel, lost,
      lastMinute: isTransport && dtd != null && dtd <= 1,
      daysToDeparture: dtd,
    };
  });
  const catAgg = new Map<string, { lines: number; lost: number }>();
  for (const l of lines) {
    const c = catOf(l);
    const agg = catAgg.get(c) ?? { lines: 0, lost: 0 };
    agg.lines += 1;
    const perUnit = l.exp.amount / Math.max(1, l.exp.qty);
    const code = l.exp.expenseCode;
    const isTransport = code === "L-TRANSPORT" || code === "O-TRANSPORT";
    const isPocket = code === "L-POCKET";
    const cm = cityOfExpense(l.claim, l.exp);
    const rate = cm.matched ? ctx.matchRate(cm.city) : null;
    if (!isTransport && cm.matched && rate) {
      agg.lost += Math.max(0, (perUnit - (isPocket ? rate.uangHarian : rate.plafonHotel)) * l.exp.qty);
    }
    catAgg.set(c, agg);
  }
  const byCategory = TR32_CATEGORY_ORDER
    .filter((c) => catAgg.has(c))
    .map((c) => ({
      category: c as TR32Data["byCategory"][number]["category"],
      categoryLabel: TR32_CATEGORY_LABELS[c] ?? c,
      lines: catAgg.get(c)!.lines,
      lost: g(round2(catAgg.get(c)!.lost)),
    }));
  let sumLost = 0;
  for (const [, a] of catAgg) sumLost += a.lost;
  return {
    periodLabel: `Tahun Buku ${year} — tarif riil vs acuan SBI (PMK 32/2025)`,
    payload: {
      year, items, byCategory,
      total: items.length,
      matchedCount: items.filter((i) => i.cityMatched).length,
      lastMinuteCount: items.filter((i) => i.lastMinute).length,
      sum: { lost: g(round2(sumLost)) },
      methodology:
        "Tarif acuan mengikuti Standar Biaya Input (SBI) per kota — uang harian per hari trip & plafon hotel per malam menginap (PMK 32/2025). " +
        "Lost savings = (tarif riil per unit − tarif acuan) × jumlah unit, dihitung hanya untuk baris yang kotanya berhasil dipetakan dari destinasi SPPD " +
        "(baris tidak terpetakan ditandai “—”). Tiket last-minute = pembelian transport antar-kota ≤ 1 hari sebelum keberangkatan (H−1) atau saat/sesudah perjalanan.",
    },
  };
}

// ---------- TR3.3 Travel ROI / Cost-to-Business Impact Analysis ----------
function tr33Roi(ctx: Ctx): { periodLabel: string; payload: TR33Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const reqs = ctx.requests.filter((r) => r.status === "Approved" && r.requestDate.getFullYear() === year);
  const claims = ctx.claims.filter((c) => c.claimDate.getFullYear() === year);
  const budget = ctx.budgetByYear.get(year);
  const ccs = new Set<string>();
  for (const r of reqs) if (r.costCenter) ccs.add(r.costCenter);
  for (const c of claims) if (c.costCenter) ccs.add(c.costCenter);
  if (budget) for (const cc of budget.items.keys()) ccs.add(cc);
  const hasNullCc = reqs.some((r) => !r.costCenter) || claims.some((c) => !c.costCenter);
  const ccKeys: (string | null)[] = [...ccs].sort();
  if (hasNullCc) ccKeys.push(null);
  const rows: TR33Data["rows"] = ccKeys.map((cc) => {
    const trips = reqs.filter((r) => (r.costCenter ?? null) === cc);
    const ccClaims = claims.filter((c) => (c.costCenter ?? null) === cc);
    const settlement = ccClaims
      .filter((c) => CLAIM_DONE.includes(c.status))
      .reduce((s, c) => s + c.totalSettlement, 0);
    const advance = trips.reduce((s, r) => s + r.advanceTotal, 0);
    const budgetAmount = budget?.items.get(cc ?? "") ?? 0;
    const purposeCount = new Map<string, number>();
    for (const r of trips) purposeCount.set(r.purpose, (purposeCount.get(r.purpose) ?? 0) + 1);
    const topPurpose = [...purposeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      costCenter: cc ?? "", costCenterLabel: cc ?? "Tanpa Cost Center",
      trips: trips.length,
      employees: new Set(trips.map((r) => r.emp.id)).size,
      claims: ccClaims.length,
      advance: g(round2(advance)),
      settlement: g(round2(settlement)),
      budget: g(budgetAmount),
      utilizationPct: canSee && budgetAmount > 0 ? round2((settlement / budgetAmount) * 100) : null,
      avgPerTrip: canSee && trips.length > 0 ? round2(settlement / trips.length) : null,
      topPurpose,
    };
  }).sort((a, b) => (b.settlement ?? 0) - (a.settlement ?? 0) || a.costCenterLabel.localeCompare(b.costCenterLabel));
  const tSettlement = claims.filter((c) => CLAIM_DONE.includes(c.status)).reduce((s, c) => s + c.totalSettlement, 0);
  const tAdvance = reqs.reduce((s, r) => s + r.advanceTotal, 0);
  const tBudget = budget ? [...budget.items.values()].reduce((s, v) => s + v, 0) : 0;
  const nullReq = reqs.filter((r) => !r.costCenter).length;
  const nullClaim = claims.filter((c) => !c.costCenter).length;
  return {
    periodLabel: `Tahun Buku ${year} — settlement vs budget per cost center`,
    payload: {
      year, rows,
      total: {
        trips: reqs.length,
        employees: new Set(reqs.map((r) => r.emp.id)).size,
        claims: claims.length,
        advance: g(round2(tAdvance)),
        settlement: g(round2(tSettlement)),
        budget: g(round2(tBudget)),
      },
      overallUtilization: canSee && tBudget > 0 ? round2((tSettlement / tBudget) * 100) : null,
      unmatchedNote: hasNullCc
        ? `${nullReq} request dan ${nullClaim} klaim tahun ini tanpa cost center — dikelompokkan pada baris “Tanpa Cost Center”.`
        : null,
      methodology:
        "Trip = permintaan perjalanan berstatus Approved pada tahun buku (tanggal pengajuan). Settlement = Σ total settlement klaim berstatus " +
        "Approved/Transferred/Paid pada cost center yang sama (tanggal klaim). Budget = rincian TravelBudgetItem cost center tahun tsb; " +
        "utilisasi = settlement ÷ budget × 100 (indikatif — over-budget tidak memblokir klaim).",
    },
  };
}

// ===================== G4 — DISTRIBUSI VENDOR & LOGISTIK PERJALANAN =====================

// ---------- TR4.1 Corporate Travel Agent (CTA) Reconciliation Sheet ----------
function tr41Corporate(ctx: Ctx): { periodLabel: string; payload: TR41Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const claims = ctx.claims.filter((c) =>
    c.claimDate.getFullYear() === year && c.otherCompanyExp > 0);
  const items: TR41Data["items"] = claims.map((c) => ({
    claimDocNo: c.docNo, claimDate: iso(c.claimDate) ?? "",
    employeeNo: c.emp.employeeNo, name: c.emp.fullName,
    requestDocNo: c.request?.docNo ?? null,
    destinations: c.request ? c.request.destinations.map((d) => d.city).join(" → ") : "",
    templateName: c.templateName, purpose: c.purpose ?? c.request?.purpose ?? null,
    corporateBilled: g(c.otherCompanyExp),
    payableEmployee: g(c.payableEmployee),
    payableCompany: g(c.payableCompany),
    totalSettlement: g(c.totalSettlement),
    journalNo: c.journalNo,
    status: c.status, statusLabel: CLAIM_STATUS_LABELS[c.status] ?? c.status,
    ageDays: Math.max(0, Math.floor((ctx.now.getTime() - dayStart(c.claimDate).getTime()) / DAY_MS)),
  }));
  const monthly = MONTHS_ID.map((mo, i) => {
    const inM = claims.filter((c) => c.claimDate.getMonth() === i);
    return { month: mo.slice(0, 3), claims: inM.length, corporateBilled: g(round2(inM.reduce((s, c) => s + c.otherCompanyExp, 0))) };
  });
  const sum = {
    corporateBilled: 0, payableEmployee: 0, payableCompany: 0, totalSettlement: 0,
  };
  for (const c of claims) {
    sum.corporateBilled += c.otherCompanyExp;
    sum.payableEmployee += c.payableEmployee;
    sum.payableCompany += c.payableCompany;
    sum.totalSettlement += c.totalSettlement;
  }
  return {
    periodLabel: `Tahun Buku ${year} — klaim dgn biaya akun korporat/CTA`,
    payload: {
      year, items, monthly,
      total: items.length,
      openCount: items.filter((i) => i.status !== "Transferred" && i.status !== "Paid").length,
      settledCount: items.filter((i) => i.status === "Transferred" || i.status === "Paid").length,
      sum: {
        corporateBilled: g(round2(sum.corporateBilled)), payableEmployee: g(round2(sum.payableEmployee)),
        payableCompany: g(round2(sum.payableCompany)), totalSettlement: g(round2(sum.totalSettlement)),
      },
      manifestNote:
        "Tagihan akun korporat (CTA/Travel Agent) dicocokkan dengan manifes klaim & keberangkatan HRIS — kolom (a) = biaya dibayar pihak lain; mencegah double payment.",
    },
  };
}

// ---------- TR4.2 Hotel Vendor Volume Summary ----------
function tr42HotelVolume(ctx: Ctx): { periodLabel: string; payload: TR42Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  const lines = allExpenses(ctx, ctx.claims.filter((c) => c.claimDate.getFullYear() === year), false)
    .filter((l) =>
      (l.exp.expenseCode === "L-HOTEL" || l.exp.expenseCode === "O-HOTEL")
      && (!codeFilter || l.exp.expenseCode === codeFilter));
  const detail: TR42Data["detail"] = lines.map((l) => {
    const cm = cityOfExpense(l.claim, l.exp);
    return {
      claimDocNo: l.claim.docNo, employeeNo: l.claim.emp.employeeNo, name: l.claim.emp.fullName,
      city: cm.city, cityMatched: cm.matched,
      date: iso(l.exp.expenseDate),
      nights: l.exp.qty,
      rate: canSee && l.exp.qty > 0 ? round2(l.exp.amount / l.exp.qty) : null,
      amount: g(l.exp.amount),
      overLimit: l.exp.overLimit,
    };
  });
  interface CityAgg { city: string; country: string; overseas: boolean; nights: number; amount: number; employees: Set<string>; claims: Set<string> }
  const byCityMap = new Map<string, CityAgg>();
  for (const l of lines) {
    const cm = cityOfExpense(l.claim, l.exp);
    const agg = byCityMap.get(cm.city) ?? { city: cm.city, country: cm.country, overseas: cm.overseas, nights: 0, amount: 0, employees: new Set<string>(), claims: new Set<string>() };
    agg.nights += l.exp.qty; agg.amount += l.exp.amount;
    agg.employees.add(l.claim.emp.id); agg.claims.add(l.claim.docNo);
    byCityMap.set(cm.city, agg);
  }
  const totalAmount = [...byCityMap.values()].reduce((s, a) => s + a.amount, 0);
  const totalNights = [...byCityMap.values()].reduce((s, a) => s + a.nights, 0);
  const byCity: TR42Data["byCity"] = [...byCityMap.values()]
    .sort((a, b) => b.nights - a.nights || a.city.localeCompare(b.city))
    .map((a) => ({
      city: a.city, country: a.country, overseas: a.overseas,
      roomNights: round2(a.nights), amount: g(round2(a.amount)),
      avgRate: canSee && a.nights > 0 ? round2(a.amount / a.nights) : null,
      employees: a.employees.size, claims: a.claims.size,
      sharePct: canSee && totalAmount > 0 ? round2((a.amount / totalAmount) * 100) : null,
    }));
  return {
    periodLabel: `Tahun Buku ${year} — volume malam menginap per kota`,
    payload: {
      year, byCity, detail,
      total: detail.length,
      cities: [...byCityMap.keys()].filter((c) => c !== UNMATCHED_CITY).length,
      sum: { roomNights: round2(totalNights), amount: g(round2(totalAmount)) },
    },
  };
}

// ---------- TR4.3 Air Carrier Utilization Report ----------
function tr43Carriers(ctx: Ctx): { periodLabel: string; payload: TR43Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const codeFilter = expenseTypeCodeOf(ctx);
  const lines = allExpenses(ctx, ctx.claims.filter((c) => c.claimDate.getFullYear() === year), false)
    .filter((l) =>
      (l.exp.expenseCode === "L-TRANSPORT" || l.exp.expenseCode === "O-TRANSPORT")
      && (!codeFilter || l.exp.expenseCode === codeFilter));
  const detail: TR43Data["detail"] = lines.map((l) => {
    const dtd = daysToDepartureOf(l.claim, l.exp);
    const m = RE_ROUTE_PAIR.exec(l.exp.description ?? "");
    return {
      claimDocNo: l.claim.docNo, employeeNo: l.claim.emp.employeeNo, name: l.claim.emp.fullName,
      carrier: parseCarrier(l.exp.description, l.exp.expenseCode),
      route: m ? `${m[1]}–${m[2]}` : null,
      expenseDate: iso(l.exp.expenseDate),
      amount: g(l.exp.amount),
      lastMinute: dtd != null && dtd <= 1,
    };
  });
  interface CarAgg { carrier: string; mode: string; tickets: number; routes: Set<string>; employees: Set<string>; amount: number }
  const byCarMap = new Map<string, CarAgg>();
  for (const l of lines) {
    const carrier = parseCarrier(l.exp.description, l.exp.expenseCode);
    const mode = parseMode(l.exp.description, l.exp.expenseCode);
    const agg = byCarMap.get(carrier) ?? { carrier, mode, tickets: 0, routes: new Set<string>(), employees: new Set<string>(), amount: 0 };
    agg.tickets += 1;
    const m = RE_ROUTE_PAIR.exec(l.exp.description ?? "");
    if (m) agg.routes.add(`${m[1]}–${m[2]}`);
    agg.employees.add(l.claim.emp.id);
    agg.amount += l.exp.amount;
    byCarMap.set(carrier, agg);
  }
  const totalAmount = [...byCarMap.values()].reduce((s, a) => s + a.amount, 0);
  const rows: TR43Data["rows"] = [...byCarMap.values()]
    .sort((a, b) => b.amount - a.amount || a.carrier.localeCompare(b.carrier))
    .map((a) => ({
      carrier: a.carrier,
      mode: a.mode as TR43Data["rows"][number]["mode"],
      modeLabel: MODE_LABELS[a.mode] ?? a.mode,
      tickets: a.tickets, routes: a.routes.size, employees: a.employees.size,
      amount: g(round2(a.amount)),
      sharePct: canSee && totalAmount > 0 ? round2((a.amount / totalAmount) * 100) : null,
      avgFare: canSee && a.tickets > 0 ? round2(a.amount / a.tickets) : null,
    }));
  let sumAmount = 0;
  for (const l of lines) sumAmount += l.exp.amount;
  return {
    periodLabel: `Tahun Buku ${year} — utilisasi carrier transport antar-kota`,
    payload: {
      year, rows, detail,
      total: detail.length,
      airTickets: lines.filter((l) => parseMode(l.exp.description, l.exp.expenseCode) === "air").length,
      railTickets: lines.filter((l) => parseMode(l.exp.description, l.exp.expenseCode) === "rail").length,
      unidentified: lines.filter((l) => parseCarrier(l.exp.description, l.exp.expenseCode).startsWith("Tidak teridentifikasi")).length,
      sum: { amount: g(round2(sumAmount)) },
    },
  };
}

// ============ XLSX ============

type AnyRec = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "—" : String(v));
const d = (isoStr: string | null | undefined): string => {
  if (!isoStr) return "—";
  const dt = new Date(isoStr);
  return dt.getDate() ? `${dt.getDate()} ${MONTHS_ID[dt.getMonth()].slice(0, 3)} ${dt.getFullYear()}` : "—";
};
/** Uang null (brankas terkunci) → "" — BUKAN 0 (aturan audit kolom R1.2/LR3.1). */
const rp = (n: unknown) => (n == null ? "" : n as number);
const yn = (b: boolean) => (b ? "Ya" : "Bukan");

function buildSheets(
  id: string,
  built: { periodLabel: string; payload: unknown },
  periodLabel: string,
  lang: Lang = "id",
): ExportSheet[] {
  const p = built.payload as AnyRec;
  // BL-4: judul dua-bahasa — nama laporan via kamus, label periode swap bulan ID→EN.
  const title = `${trFor(lang, REPORT_TITLES[id])}${periodLabel ? ` — ${locReportFor(lang, periodLabel)}` : ""}`;
  switch (id) {
    case "tr11": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Master SPPD",
        title,
        columns: [
          { header: "No. SPPD", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Jenis Perjalanan", width: 18 }, { header: "Tgl Pengajuan", width: 13 },
          { header: "Berangkat", width: 12 }, { header: "Kembali", width: 12 }, { header: "Durasi (hari)", width: 12 },
          { header: "Tujuan (multi-kaki)", width: 30 }, { header: "LN", width: 6 },
          { header: "Tujuan Bisnis", width: 32 }, { header: "Cost Center", width: 12 },
          { header: "Status", width: 18 }, { header: "Klaim Diajukan", width: 13 },
          { header: "Uang Muka (Rp)", width: 16 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.templateCode), d(i.requestDate as string),
            d(i.dateFrom as string), d(i.dateTo as string), (i.durationDays as number) ?? 0,
            s(i.destinations), i.overseas ? "LN" : "Domestik",
            s(i.purpose), s(i.costCenter), s(i.statusLabel), i.claimRequested ? "Ya" : "Belum",
            rp(i.advance),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", (sum.durationDays as number) ?? 0, "", "", "", "", `${(p.total as number) ?? 0} pengajuan`, `${(p.claimRequestedCount as number) ?? 0} klaim`, rp(sum.advance)],
        ],
      }];
    }
    case "tr12": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Uang Muka",
        title,
        columns: [
          { header: "No. SPPD", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Tujuan", width: 26 }, { header: "Tgl Pengajuan", width: 13 },
          { header: "Berangkat", width: 12 }, { header: "Kembali", width: 12 }, { header: "Status Pencairan", width: 16 },
          { header: "Tgl Cair", width: 12 }, { header: "Nominal (Rp)", width: 16 }, { header: "Klaim", width: 15 },
          { header: "Status Klaim", width: 18 }, { header: "Penyelesaian", width: 14 },
          { header: "Outstanding (Rp)", width: 17 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.destinations), d(i.requestDate as string),
            d(i.tripFrom as string), d(i.tripTo as string), s(i.advanceStatusLabel), d(i.givenAt as string),
            rp(i.amount), s(i.claimDocNo), s(i.claimStatusLabel), s(i.settlementLabel), rp(i.outstanding),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", rp(sum.amount), "", "", "", rp(sum.outstanding)],
        ],
      }];
    }
    case "tr13": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Traveler Aktif",
        title,
        columns: [
          { header: "No. SPPD", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Telepon", width: 16 }, { header: "Grade", width: 14 },
          { header: "Tujuan", width: 26 }, { header: "LN", width: 6 }, { header: "Berangkat", width: 12 },
          { header: "Kembali", width: 12 }, { header: "Hari ke-", width: 9 }, { header: "Total Hari", width: 10 },
          { header: "Pulang dlm (hari)", width: 14 }, { header: "Kota Saat Ini", width: 16 },
          { header: "Fase", width: 22 }, { header: "Uang Muka (Rp)", width: 16 }, { header: "Tujuan Bisnis", width: 30 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.phone), s(i.grade), s(i.destinations),
            i.overseas ? "LN" : "Domestik", d(i.tripFrom as string), d(i.tripTo as string),
            (i.dayNo as number) ?? 0, (i.totalDays as number) ?? 0, (i.daysToReturn as number) ?? 0,
            s(i.currentCity), s(i.phaseLabel), rp(i.advance), s(i.purpose),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", `${(p.total as number) ?? 0} traveler aktif`, rp(sum.advance), ""],
        ],
      }];
    }
    case "tr21": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Register Settlement",
        title,
        columns: [
          { header: "No. Klaim", width: 15 }, { header: "Tgl Klaim", width: 12 }, { header: "No. Karyawan", width: 14 },
          { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "No. SPPD", width: 15 },
          { header: "Template", width: 20 }, { header: "Tujuan Bisnis", width: 30 }, { header: "Cost Center", width: 12 },
          { header: "Baris", width: 7 }, { header: "Rincian (Rp)", width: 15 }, { header: "(a) Pihak Lain (Rp)", width: 17 },
          { header: "Rugi Kurs (Rp)", width: 15 }, { header: "Total Settlement (Rp)", width: 19 },
          { header: "Uang Muka (Rp)", width: 16 }, { header: "(b) Dibayar Karyawan (Rp)", width: 20 },
          { header: "(c) Kembali Perusahaan (Rp)", width: 22 }, { header: "Status", width: 18 },
          { header: "No. Jurnal", width: 15 }, { header: "Periode", width: 10 }, { header: "Metode", width: 10 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), d(i.claimDate as string), s(i.employeeNo), s(i.name), s(i.unit), s(i.requestDocNo),
            s(i.templateName), s(i.purpose), s(i.costCenter), (i.expenseCount as number) ?? 0,
            rp(i.expenseTotal), rp(i.otherCompanyExp), rp(i.exchangeLoss), rp(i.totalSettlement),
            rp(i.advance), rp(i.payableEmployee), rp(i.payableCompany),
            s(i.statusLabel), s(i.journalNo), s(i.periodCode), s(i.settlementMethod),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", rp(sum.expenseTotal), rp(sum.otherCompanyExp), rp(sum.exchangeLoss), rp(sum.totalSettlement), rp(sum.advance), rp(sum.payableEmployee), rp(sum.payableCompany), "", "", "", ""],
        ],
      }];
    }
    case "tr22": {
      const total = (p.total as AnyRec) ?? {};
      return [
        {
          name: "Rincian Jenis",
          title,
          columns: [
            { header: "Kode", width: 14 }, { header: "Jenis Biaya", width: 26 }, { header: "Kelompok", width: 14 },
            { header: "Klaim", width: 8 }, { header: "Baris", width: 8 }, { header: "Σ Unit", width: 10 },
            { header: "Nominal (Rp)", width: 16 }, { header: "Over Limit", width: 10 },
            { header: "Porsi %", width: 10 }, { header: "Rata-rata/Baris (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.rows as AnyRec[]) ?? []).map((r) => [
              s(r.code), s(r.name), s(r.kindLabel), (r.claimCount as number) ?? 0, (r.expenseCount as number) ?? 0,
              (r.qty as number) ?? 0, rp(r.amount), (r.overLimitCount as number) ?? 0, rp(r.sharePct), rp(r.avgPerLine),
            ])),
            ["TOTAL", "", "", "", (total.lines as number) ?? 0, "", rp(total.amount), (total.overLimitCount as number) ?? 0, "", ""],
          ],
        },
        {
          name: "Tren Bulanan",
          title,
          columns: [
            { header: "Bulan", width: 12 }, { header: "Baris", width: 10 }, { header: "Nominal (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.monthly as AnyRec[]) ?? []).map((r) => [s(r.month), (r.lines as number) ?? 0, rp(r.amount)])),
            ["TOTAL", ((p.monthly as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.lines as number) ?? 0), 0), rp(total.amount)],
          ],
        },
        {
          name: "Per Kelompok",
          title,
          columns: [
            { header: "Kelompok", width: 16 }, { header: "Nominal (Rp)", width: 18 }, { header: "Porsi %", width: 10 },
          ],
          rows: [
            ...(((p.byKind as AnyRec[]) ?? []).map((r) => [s(r.kindLabel), rp(r.amount), rp(r.sharePct)])),
            ["TOTAL", rp(total.amount), ""],
          ],
        },
      ];
    }
    case "tr23": {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Rincian",
          title,
          columns: [
            { header: "No. Klaim", width: 15 }, { header: "Tgl Klaim", width: 12 }, { header: "No. Karyawan", width: 14 },
            { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Tgl Biaya", width: 12 },
            { header: "Kode", width: 14 }, { header: "Jenis Biaya", width: 24 }, { header: "Kategori", width: 20 },
            { header: "Keterangan", width: 34 }, { header: "Qty", width: 8 }, { header: "Satuan", width: 8 },
            { header: "Nominal (Rp)", width: 15 }, { header: "Tarif Satuan (Rp)", width: 16 }, { header: "Over Limit", width: 10 },
          ],
          rows: [
            ...(((p.items as AnyRec[]) ?? []).map((i) => [
              s(i.claimDocNo), d(i.claimDate as string), s(i.employeeNo), s(i.name), s(i.unit), d(i.expenseDate as string),
              s(i.code), s(i.typeName), s(i.categoryLabel), s(i.description), (i.qty as number) ?? 0, s(i.qtyLabel),
              rp(i.amount), rp(i.rate), yn(i.overLimit as boolean),
            ])),
            ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", rp(sum.amount), "", ""],
          ],
        },
        {
          name: "Per Kategori",
          title,
          columns: [
            { header: "Kategori", width: 24 }, { header: "Baris", width: 8 }, { header: "Qty", width: 10 },
            { header: "Nominal (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.byCategory as AnyRec[]) ?? []).map((r) => [s(r.categoryLabel), (r.lines as number) ?? 0, (r.qty as number) ?? 0, rp(r.amount)])),
            ["TOTAL", ((p.byCategory as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.lines as number) ?? 0), 0), "", rp(sum.amount)],
          ],
        },
        {
          name: "Per Kode",
          title,
          columns: [
            { header: "Kode", width: 14 }, { header: "Jenis Biaya", width: 26 }, { header: "Baris", width: 8 },
            { header: "Qty", width: 10 }, { header: "Nominal (Rp)", width: 18 }, { header: "Tarif Rata-rata (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.byCode as AnyRec[]) ?? []).map((r) => [s(r.code), s(r.name), (r.lines as number) ?? 0, (r.qty as number) ?? 0, rp(r.amount), rp(r.avgRate)])),
            ["TOTAL", "", ((p.byCode as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.lines as number) ?? 0), 0), "", rp(sum.amount), ""],
          ],
        },
      ];
    }
    case "tr31": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Pelanggaran Limit",
        title,
        columns: [
          { header: "No. Klaim", width: 15 }, { header: "Tgl Klaim", width: 12 }, { header: "No. Karyawan", width: 14 },
          { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Grade", width: 14 },
          { header: "Kode", width: 14 }, { header: "Jenis Biaya", width: 24 }, { header: "Kelompok", width: 14 },
          { header: "Qty", width: 8 }, { header: "Nominal (Rp)", width: 16 }, { header: "Limit", width: 22 },
          { header: "Kelebihan (Rp)", width: 16 }, { header: "% Over", width: 9 },
          { header: "Status Klaim", width: 18 }, { header: "Tetap Disetujui", width: 14 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.claimDocNo), d(i.claimDate as string), s(i.employeeNo), s(i.name), s(i.unit), s(i.grade),
            s(i.code), s(i.typeName), s(i.kindLabel), (i.qty as number) ?? 0, rp(i.amount), s(i.limitLabel),
            rp(i.excess), rp(i.overPct), s(i.claimStatusLabel), yn(i.approvedAnyway as boolean),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", rp(sum.excess), "", `${(p.total as number) ?? 0} pelanggaran`, `${(p.approvedAnyway as number) ?? 0} disetujui`],
        ],
      }];
    }
    case "tr32": {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Rincian",
          title,
          columns: [
            { header: "No. Klaim", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
            { header: "Kota", width: 18 }, { header: "Kode", width: 14 }, { header: "Jenis Biaya", width: 24 },
            { header: "Qty", width: 8 }, { header: "Satuan", width: 9 }, { header: "Tarif Riil/Unit (Rp)", width: 17 },
            { header: "Acuan SBI (Rp)", width: 16 }, { header: "Label Acuan", width: 28 },
            { header: "Lost (Rp)", width: 15 }, { header: "Last-Minute", width: 12 }, { header: "H−Berangkat", width: 12 },
          ],
          rows: [
            ...(((p.items as AnyRec[]) ?? []).map((i) => [
              s(i.claimDocNo), s(i.employeeNo), s(i.name), s(i.city), s(i.code), s(i.typeName),
              (i.qty as number) ?? 0, s(i.qtyLabel), rp(i.actualPerUnit), rp(i.refRate), s(i.refLabel),
              rp(i.lost), yn(i.lastMinute as boolean), i.daysToDeparture == null ? "" : i.daysToDeparture as number,
            ])),
            ["TOTAL", "", "", "", "", "", "", "", "", "", "", rp(sum.lost), "", ""],
          ],
        },
        {
          name: "Per Kategori",
          title,
          columns: [
            { header: "Kategori", width: 32 }, { header: "Baris", width: 8 }, { header: "Lost (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.byCategory as AnyRec[]) ?? []).map((r) => [s(r.categoryLabel), (r.lines as number) ?? 0, rp(r.lost)])),
            ["TOTAL", ((p.byCategory as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.lines as number) ?? 0), 0), rp(sum.lost)],
          ],
        },
      ];
    }
    case "tr33": {
      const total = (p.total as AnyRec) ?? {};
      return [{
        name: "ROI Cost Center",
        title,
        columns: [
          { header: "Cost Center", width: 18 }, { header: "Trips", width: 8 }, { header: "Karyawan", width: 10 },
          { header: "Klaim", width: 8 }, { header: "Uang Muka (Rp)", width: 16 }, { header: "Settlement (Rp)", width: 17 },
          { header: "Budget (Rp)", width: 17 }, { header: "Utilisasi %", width: 11 },
          { header: "Rata-rata/Trip (Rp)", width: 18 }, { header: "Tujuan Bisnis Utama", width: 34 },
        ],
        rows: [
          ...(((p.rows as AnyRec[]) ?? []).map((r) => [
            s(r.costCenterLabel), (r.trips as number) ?? 0, (r.employees as number) ?? 0, (r.claims as number) ?? 0,
            rp(r.advance), rp(r.settlement), rp(r.budget), rp(r.utilizationPct), rp(r.avgPerTrip), s(r.topPurpose),
          ])),
          ["TOTAL", (total.trips as number) ?? 0, (total.employees as number) ?? 0, (total.claims as number) ?? 0, rp(total.advance), rp(total.settlement), rp(total.budget), rp(p.overallUtilization), "", ""],
        ],
      }];
    }
    case "tr41": {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Rekonsiliasi CTA",
          title,
          columns: [
            { header: "Bulan", width: 12 }, { header: "Klaim", width: 8 }, { header: "(a) Ditagih Korporat (Rp)", width: 22 },
          ],
          rows: [
            ...(((p.monthly as AnyRec[]) ?? []).map((r) => [s(r.month), (r.claims as number) ?? 0, rp(r.corporateBilled)])),
            ["TOTAL", ((p.monthly as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.claims as number) ?? 0), 0), rp(sum.corporateBilled)],
          ],
        },
        {
          name: "Rincian Klaim Korporat",
          title,
          columns: [
            { header: "No. Klaim", width: 15 }, { header: "Tgl Klaim", width: 12 }, { header: "No. Karyawan", width: 14 },
            { header: "Nama", width: 24 }, { header: "No. SPPD", width: 15 }, { header: "Destinasi", width: 26 },
            { header: "Template", width: 20 }, { header: "Tujuan Bisnis", width: 30 },
            { header: "(a) Korporat (Rp)", width: 17 }, { header: "(b) Karyawan (Rp)", width: 16 },
            { header: "(c) Kembali (Rp)", width: 16 }, { header: "Total Settlement (Rp)", width: 19 },
            { header: "No. Jurnal", width: 15 }, { header: "Status", width: 18 }, { header: "Umur (hari)", width: 11 },
          ],
          rows: [
            ...(((p.items as AnyRec[]) ?? []).map((i) => [
              s(i.claimDocNo), d(i.claimDate as string), s(i.employeeNo), s(i.name), s(i.requestDocNo),
              s(i.destinations), s(i.templateName), s(i.purpose),
              rp(i.corporateBilled), rp(i.payableEmployee), rp(i.payableCompany), rp(i.totalSettlement),
              s(i.journalNo), s(i.statusLabel), (i.ageDays as number) ?? 0,
            ])),
            ["TOTAL", "", "", "", "", "", "", "", rp(sum.corporateBilled), rp(sum.payableEmployee), rp(sum.payableCompany), rp(sum.totalSettlement), "", "", ""],
          ],
        },
      ];
    }
    case "tr42": {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Volume Kota",
          title,
          columns: [
            { header: "Kota", width: 20 }, { header: "Negara", width: 16 }, { header: "LN", width: 6 },
            { header: "Malam Menginap", width: 14 }, { header: "Nominal (Rp)", width: 17 },
            { header: "Tarif Rata-rata (Rp)", width: 18 }, { header: "Karyawan", width: 10 },
            { header: "Klaim", width: 8 }, { header: "Porsi %", width: 10 },
          ],
          rows: [
            ...(((p.byCity as AnyRec[]) ?? []).map((r) => [
              s(r.city), s(r.country), r.overseas ? "LN" : "Domestik", (r.roomNights as number) ?? 0,
              rp(r.amount), rp(r.avgRate), (r.employees as number) ?? 0, (r.claims as number) ?? 0, rp(r.sharePct),
            ])),
            ["TOTAL", "", "", (sum.roomNights as number) ?? 0, rp(sum.amount), "", "", "", ""],
          ],
        },
        {
          name: "Rincian",
          title,
          columns: [
            { header: "No. Klaim", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
            { header: "Kota", width: 20 }, { header: "Tgl", width: 12 }, { header: "Malam", width: 8 },
            { header: "Tarif/Malam (Rp)", width: 17 }, { header: "Nominal (Rp)", width: 17 }, { header: "Over Limit", width: 10 },
          ],
          rows: [
            ...(((p.detail as AnyRec[]) ?? []).map((i) => [
              s(i.claimDocNo), s(i.employeeNo), s(i.name), s(i.city), d(i.date as string),
              (i.nights as number) ?? 0, rp(i.rate), rp(i.amount), yn(i.overLimit as boolean),
            ])),
            ["TOTAL", "", "", "", "", (sum.roomNights as number) ?? 0, "", rp(sum.amount), ""],
          ],
        },
      ];
    }
    default: {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Utilisasi Carrier",
          title,
          columns: [
            { header: "Carrier", width: 26 }, { header: "Mode", width: 12 }, { header: "Tiket", width: 8 },
            { header: "Rute", width: 8 }, { header: "Karyawan", width: 10 }, { header: "Nominal (Rp)", width: 17 },
            { header: "Porsi %", width: 10 }, { header: "Tarif Rata-rata (Rp)", width: 18 },
          ],
          rows: [
            ...(((p.rows as AnyRec[]) ?? []).map((r) => [
              s(r.carrier), s(r.modeLabel), (r.tickets as number) ?? 0, (r.routes as number) ?? 0,
              (r.employees as number) ?? 0, rp(r.amount), rp(r.sharePct), rp(r.avgFare),
            ])),
            ["TOTAL", "", ((p.rows as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.tickets as number) ?? 0), 0), "", "", rp(sum.amount), "", ""],
          ],
        },
        {
          name: "Rincian",
          title,
          columns: [
            { header: "No. Klaim", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
            { header: "Carrier", width: 26 }, { header: "Rute", width: 12 }, { header: "Tgl Biaya", width: 12 },
            { header: "Nominal (Rp)", width: 17 }, { header: "Last-Minute", width: 12 },
          ],
          rows: [
            ...(((p.detail as AnyRec[]) ?? []).map((i) => [
              s(i.claimDocNo), s(i.employeeNo), s(i.name), s(i.carrier), s(i.route),
              d(i.expenseDate as string), rp(i.amount), yn(i.lastMinute as boolean),
            ])),
            ["TOTAL", "", "", "", "", "", rp(sum.amount), ""],
          ],
        },
      ];
    }
  }
}
