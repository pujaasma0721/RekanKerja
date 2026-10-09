import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, locFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import { listBalances } from "@/rekankerja/leave/services/leave-service";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// =============================================================================
// T112 — LAPORAN DISTRIBUSI LEAVE (print & PDF ready) =========================
// =============================================================================
// GET /api/rekankerja/leave/reports/documents?id=<lrId> — data satu laporan siap
// cetak (12 laporan / 4 grup: saldo & hak cuti, transaksi cuti, analisis
// ketidakhadiran, kepatuhan cuti khusus regulasi Indonesia).
//
// Alur T110 (mirror HR): form parameter awal di klien mengirim query string
// (office/unit/leaveType/status cakupan + month/year/from/to periode + filter
// khusus) → diterapkan SERVER-SIDE sebelum builder berjalan. ?id=_params →
// daftar opsi filter. ?export=xlsx → stream XLSX per laporan.
//
// Guard: requireMenuViewAny leave:leave-reports + cakupan akses efektif.
// Uang (R1.3 liabilitas): baseSalary terenkripsi M-8 didekripsi via
// tenantCryptoForDb HANYA untuk kalkulasi internal; NILAI yang diserialisasi
// digerbang money-view (masked saat brankas terkunci → null).

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "lr11", "lr12", "lr13",
  "lr21", "lr22", "lr23",
  "lr31", "lr32", "lr33",
  "lr41", "lr42", "lr43",
]);

const REPORT_TITLES: Record<string, string> = {
  lr11: "Annual Leave Balance Report (Saldo Cuti Karyawan Aktif)",
  lr12: "Leave Expiry & Forfeiture Alert Sheet",
  lr13: "Leave Liability Report (Liabilitas Saldo Cuti)",
  lr21: "Detailed Leave Activity Log",
  lr22: "Leave Approval Pipeline",
  lr23: "Departmental Leave Schedule",
  lr31: "Absenteeism Rate Summary",
  lr32: "Sick Leave Tracking & Medical Certificate (SKD) Audit",
  lr33: "Unexcused Absence / Alpa Log",
  lr41: "Statutory Special Leave Report",
  lr42: "Long Leave / Grand Leave Report",
  lr43: "Menstrual Leave Audit Sheet",
};

// ============ T112: parameter & filter awal (mirror T110 HR) ============

const STATUS_LABELS: Record<string, string> = {
  Approved: "Disetujui", Submitted: "Menunggu Persetujuan", Rejected: "Ditolak", Cancelled: "Dibatalkan", MassLeave: "Cuti Massal",
};

/** Jenis cuti khusus regulasi (R4.1) — dasar hukum utk kop kolom. */
const SPECIAL_TYPES: { code: string; basis: string }[] = [
  { code: "CT-LAHIR-P", basis: "UU KIA 4/2024 Ps.4(3)(a) — UU 13/2003 Ps.82(1)" },
  { code: "CT-GUGUR-P", basis: "UU 13/2003 Ps.82(2) & UU KIA 4/2024 Ps.4(3)(b)" },
  { code: "CT-LAHIR", basis: "UU 13/2003 Ps.93 & UU KIA 4/2024 Ps.8" },
  { code: "CT-GUGUR-I", basis: "UU 13/2003 Ps.93" },
  { code: "CT-NIKAH", basis: "UU 13/2003 Ps.81" },
  { code: "CT-NIKAH-A", basis: "PP 35/2021" },
  { code: "CT-KHITAN", basis: "PP 35/2021" },
  { code: "CT-MATI-I", basis: "PP 35/2021" },
  { code: "CT-MATI-S", basis: "PP 35/2021" },
  { code: "CT-HAJI", basis: "UU 13/2003 Ps.81" },
];

interface ReportFilters {
  office: string | null;
  unit: string | null;
  /** id LeaveType */
  leaveType: string | null;
  /** status pengajuan */
  status: string | null;
  skd: string[];
  /** YYYY-MM */
  month: string | null;
  year: number | null;
  /** YYYY-MM-DD */
  from: string | null;
  to: string | null;
}

const isYM = (v: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
const isYMD = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ============ util kecil ============

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
const monthLabel = (d: Date) => `${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const overlapDays = (a1: Date, a2: Date, b1: Date, b2: Date) => a1 <= b2 && b1 <= a2;

const SKD_RE = /skd|surat keterangan dokter|surat dokter|keterangan medis/i;

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["leave:leave-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan). ----
    if (id === "_params") {
      const [offices, units, types, minJoin, reqStats] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        db.leaveType.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        db.employee.aggregate({ _min: { joinDate: true } }),
        db.leaveRequest.findMany({ select: { status: true }, distinct: ["status"] }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = minJoin._min.joinDate?.getFullYear() ?? nowP.getFullYear();
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      const REQ_ORDER = ["Submitted", "Approved", "Rejected", "Cancelled", "MassLeave"];
      const present = [...new Set(reqStats.map((r) => r.status).filter(Boolean))]
        .sort((a, b) => REQ_ORDER.indexOf(a) - REQ_ORDER.indexOf(b));
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        leaveTypes: types.map((t) => ({ id: t.id, label: `${t.code} — ${t.name}` })),
        statuses: present.map((s) => ({ id: s, label: STATUS_LABELS[s] ?? s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (lr11…lr43)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const monthParam = sp.get("month");
    const yearParam = sp.get("year");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const list = (key: string) => (sp.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      unit: sp.get("unit") || null,
      leaveType: sp.get("leaveType") || null,
      status: sp.get("status") || null,
      skd: list("skd"),
      month: isYM(monthParam) ? monthParam : null,
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
    const [rawEmps, typesAll, unitsAll, officesAll, reqsAll, attDaily, company] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          id: true, employeeNo: true, fullName: true, gender: true, joinDate: true,
          endDate: true, status: true, orgUnitId: true, companyOfficeId: true, positionId: true,
          assignments: {
            where: { validTo: null },
            select: { employmentStatus: true, baseSalary: true, validFrom: true },
            orderBy: { validFrom: "desc" },
            take: 1,
          },
        },
      }),
      db.leaveType.findMany({ select: { id: true, code: true, name: true, unit: true, entitlement: true, paid: true, needDocs: true, carryOverMax: true, waitingMonths: true, periodMode: true } }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true } }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, active: true } }),
      db.leaveRequest.findMany({
        select: {
          id: true, docNo: true, employeeId: true, leaveTypeId: true, year: true, requestDate: true,
          dateFrom: true, sessionFrom: true, dateTo: true, sessionTo: true, workingDays: true,
          status: true, source: true, reason: true, note: true, decidedById: true, decidedAt: true,
        },
        orderBy: [{ dateFrom: "desc" }, { docNo: "desc" }],
      }),
      db.attendanceDaily.findMany({
        select: { employeeId: true, workDate: true, status: true, notes: true },
        // semua status termasuk Off/Holiday — mayoritas-nonOff menentukan
        // hari kerja efektif (R3.1); Off/Holiday tidak masuk baris mana pun.
      }),
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    ]);

    // ---- maps ----
    const typeById = new Map(typesAll.map((t) => [t.id, t]));
    const unitById = new Map(unitsAll.map((u) => [u.id, u]));
    const officeById = new Map(officesAll.map((o) => [o.id, o]));

    // ---- normalisasi karyawan + filter cakupan ----
    interface EnrEmp {
      id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
      status: string; orgUnitId: string | null; companyOfficeId: string | null; positionId: string | null;
      employmentStatus: string; monthlySalary: number; // decrypt internal (M-8) — 0 bila kosong
    }
    const emps: EnrEmp[] = rawEmps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender,
      joinDate: e.joinDate, status: e.status, orgUnitId: e.orgUnitId,
      companyOfficeId: e.companyOfficeId, positionId: e.positionId,
      employmentStatus: e.assignments[0]?.employmentStatus ?? "Tanpa data",
      monthlySalary: e.assignments[0]?.baseSalary ? tc.decryptMoney(e.assignments[0].baseSalary) ?? 0 : 0,
    }));
    const empById = new Map(emps.map((e) => [e.id, e]));
    const empNameById = new Map(emps.map((e) => [e.id, e.fullName]));

    const divUnits = unitsAll.filter((u) => u.level === 3);
    const divMap = new Map(divUnits.map((d) => [d.id, d.name]));
    const subToDiv = new Map(unitsAll.filter((u) => u.level === 4).map((s) => [s.id, s.parentId]));
    const divNameOf = (unitId: string | null): string => {
      if (!unitId) return "Tanpa Unit";
      const divId = divMap.has(unitId) ? unitId : (subToDiv.get(unitId) ?? unitId);
      return divMap.get(divId) ?? "Lainnya";
    };
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
    const active = scoped.filter((e) => e.status === "Active");
    const unitName = (id: string | null) => (id ? unitById.get(id)?.name ?? null : null);
    const tenureYears = (e: { joinDate: Date }) => (now.getTime() - e.joinDate.getTime()) / YEAR_MS;
    const sortByNo = (a: { employeeNo: string }, b: { employeeNo: string }) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // ---- permintaan cuti ter-scope + filter jenis/status ----
    interface EnrReq {
      id: string; docNo: string; emp: EnrEmp; type: (typeof typesAll)[number];
      year: number; requestDate: Date; dateFrom: Date; sessionFrom: string;
      dateTo: Date; sessionTo: string; workingDays: number; status: string;
      source: string; reason: string | null; note: string | null;
      decidedBy: string | null; decidedAt: Date | null;
    }
    const reqs: EnrReq[] = reqsAll
      .filter((r) => scopedIds.has(r.employeeId))
      .filter((r) => !fp.leaveType || r.leaveTypeId === fp.leaveType)
      .filter((r) => !fp.status || r.status === fp.status)
      .map((r) => ({
        id: r.id, docNo: r.docNo, emp: empById.get(r.employeeId)!, type: typeById.get(r.leaveTypeId)!,
        year: r.year, requestDate: r.requestDate, dateFrom: r.dateFrom, sessionFrom: r.sessionFrom,
        dateTo: r.dateTo, sessionTo: r.sessionTo, workingDays: r.workingDays, status: r.status,
        source: r.source, reason: r.reason, note: r.note,
        decidedBy: r.decidedById ? empNameById.get(r.decidedById) ?? null : null,
        decidedAt: r.decidedAt,
      }))
      .filter((r) => !!r.emp && !!r.type);
    const fromD = fp.from ? new Date(`${fp.from}T00:00:00`) : null;
    const toD = fp.to ? new Date(`${fp.to}T23:59:59`) : null;

    // ---- absensi (R3.1 & R3.3) ter-scope ----
    interface AttRow { emp: EnrEmp; workDate: Date; status: string; notes: string | null }
    const atts: AttRow[] = (attDaily as { employeeId: string; workDate: Date; status: string; notes: string | null }[])
      .filter((a) => scopedIds.has(a.employeeId))
      .map((a) => ({ emp: empById.get(a.employeeId)!, workDate: new Date(a.workDate), status: a.status, notes: a.notes }))
      .filter((a) => !!a.emp && (!fromD || a.workDate >= fromD) && (!toD || a.workDate <= toD));

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
    if (fp.leaveType) {
      const ty = typeById.get(fp.leaveType);
      if (ty) filterChips.push({ label: "Jenis Cuti", value: `${ty.code} — ${ty.name}` });
    }
    if (fp.status) filterChips.push({ label: "Status Pengajuan", value: STATUS_LABELS[fp.status] ?? fp.status });
    if (fp.month) {
      const [yy, mm] = fp.month.split("-").map(Number);
      filterChips.push({ label: "Bulan Data", value: `${MONTHS_ID[mm - 1]} ${yy}` });
    }
    if (fp.year) filterChips.push({ label: "Tahun Data", value: String(fp.year) });
    if (fp.from || fp.to) {
      const fd = fp.from ? dateID(new Date(`${fp.from}T00:00:00`)) : "awal riwayat";
      const td = fp.to ? dateID(new Date(`${fp.to}T00:00:00`)) : dateID(now);
      filterChips.push({ label: "Rentang Tanggal", value: `${fd} – ${td}` });
    }
    if (fp.skd.length) filterChips.push({ label: "Audit SKD", value: fp.skd.map((s) => s === "complete" ? "Lengkap" : "Tidak Lengkap").join(", ") });

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
      db, scoped, active, reqs, atts, now, fp, meta, tc, mv,
      typeById, unitById, officeById, divNameOf, unitName, tenureYears, sortByNo, fromD, toD,
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
            action: "Exported", entity: "LeaveReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi Leave (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-leave-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ tipe konteks ============

interface EnrEmp2 {
  id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
  status: string; orgUnitId: string | null; companyOfficeId: string | null; positionId: string | null;
  employmentStatus: string; monthlySalary: number;
}

interface EnrType2 {
  id: string; code: string; name: string; unit: string; entitlement: number;
  paid: boolean; needDocs: boolean; carryOverMax: number; waitingMonths: number; periodMode: string;
}

interface EnrReq2 {
  id: string; docNo: string; emp: EnrEmp2; type: EnrType2;
  year: number; requestDate: Date; dateFrom: Date; sessionFrom: string;
  dateTo: Date; sessionTo: string; workingDays: number; status: string;
  source: string; reason: string | null; note: string | null;
  decidedBy: string | null; decidedAt: Date | null;
}

interface Ctx {
  db: TenantDb;
  scoped: EnrEmp2[];
  active: EnrEmp2[];
  reqs: EnrReq2[];
  atts: { emp: EnrEmp2; workDate: Date; status: string; notes: string | null }[];
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
  typeById: Map<string, EnrType2>;
  unitById: Map<string, { id: string; code: string; name: string; parentId: string | null; level: number }>;
  officeById: Map<string, { id: string; code: string; name: string; city: string | null; active: boolean }>;
  divNameOf: (unitId: string | null) => string;
  unitName: (id: string | null) => string | null;
  tenureYears: (e: { joinDate: Date }) => number;
  sortByNo: (a: { employeeNo: string }, b: { employeeNo: string }) => number;
  fromD: Date | null;
  toD: Date | null;
}

async function buildReport(id: string, ctx: Ctx): Promise<{ periodLabel: string; payload: unknown }> {
  switch (id) {
    case "lr11": return lr11Balance(ctx);
    case "lr12": return lr12Expiry(ctx);
    case "lr13": return lr13Liability(ctx);
    case "lr21": return lr21Activity(ctx);
    case "lr22": return lr22Pipeline(ctx);
    case "lr23": return lr23Schedule(ctx);
    case "lr31": return lr31Absenteeism(ctx);
    case "lr32": return lr32Sick(ctx);
    case "lr33": return lr33Alpa(ctx);
    case "lr41": return lr41Special(ctx);
    case "lr42": return lr42LongLeave(ctx);
    default: return lr43Menstrual(ctx);
  }
}

// ===================== G1 — SALDO & HAK CUTI =====================

// ---------- LR1.1 Annual Leave Balance ----------
async function lr11Balance(ctx: Ctx) {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  // default jenis = Cuti Tahunan (lookup by CODE — id server bukan konstanta).
  const defTypeId = [...ctx.typeById.values()].find((t) => t.code === "CT-THN")?.id ?? null;
  const typeId = ctx.fp.leaveType ?? defTypeId;
  const type = typeId ? ctx.typeById.get(typeId) : null;
  const rows = await listBalances(ctx.db, { year, ...(typeId ? { leaveTypeId: typeId } : {}) });
  const scopedByNo = new Map(ctx.active.map((e) => [e.employeeNo, e]));
  const scopedRows = rows
    .filter((r) => scopedByNo.has(r.employeeNo))
    .map((r) => {
      const e = scopedByNo.get(r.employeeNo)!;
      return {
        employeeNo: r.employeeNo, name: r.fullName, unit: ctx.unitName(e.orgUnitId),
        employmentStatus: e.employmentStatus, joinDate: iso(e.joinDate),
        tenureYears: round1(ctx.tenureYears(e)),
        carriedOver: r.carriedOver, earned: r.earned, adjustment: r.adjustment,
        taken: r.taken, applied: r.applied, cashed: r.cashed, remaining: r.remaining,
        entitlement: r.entitlement, typeUnit: r.unit, paid: r.paid, cashable: r.cashable,
        periodLabel: r.periodLabel,
      };
    })
    .sort((a, b) => (a.unit ?? "").localeCompare(b.unit ?? "") || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  const isMonth = type?.unit === "MONTH";
  const tot = (k: "carriedOver" | "earned" | "adjustment" | "taken" | "applied" | "cashed" | "remaining") =>
    round1(scopedRows.reduce((s, r) => s + r[k], 0));
  return {
    periodLabel: `${type ? `${type.code} — ${type.name}` : "Semua Jenis"} · saldo per ${dateID(ctx.now)}`,
    payload: {
      typeName: type ? `${type.code} — ${type.name}` : "Semua Jenis Cuti",
      typeUnit: type?.unit ?? "DAY",
      rows: scopedRows,
      total: scopedRows.length,
      avgRemaining: scopedRows.length ? round1(scopedRows.reduce((s, r) => s + r.remaining, 0) / scopedRows.length) : 0,
      zeroRemaining: scopedRows.filter((r) => r.remaining <= 0).length,
      sum: {
        carriedOver: tot("carriedOver"), earned: tot("earned"), adjustment: tot("adjustment"),
        taken: tot("taken"), applied: tot("applied"), cashed: tot("cashed"), remaining: tot("remaining"),
      },
      isMonth,
    },
  };
}

// ---------- LR1.2 Leave Expiry & Forfeiture ----------
async function lr12Expiry(ctx: Ctx) {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const rows = await listBalances(ctx.db, { year });
  const scopedByNo = new Map(ctx.active.map((e) => [e.employeeNo, e]));
  // carry-over hangus 31-12 tahun periode (konvensi saldo — computeParts).
  const forfeitDate = new Date(year, 11, 31, 23, 59, 59);
  const items = rows
    .filter((r) => scopedByNo.has(r.employeeNo) && r.carriedOver > 0 && (ctx.typeById.get(r.leaveTypeId)?.carryOverMax ?? 0) > 0)
    .map((r) => {
      const e = scopedByNo.get(r.employeeNo)!;
      const daysRemaining = Math.ceil((forfeitDate.getTime() - ctx.now.getTime()) / DAY_MS);
      const urgency = daysRemaining < 0 ? "overdue" : daysRemaining < 30 ? "critical" : daysRemaining < 60 ? "warning" : daysRemaining < 90 ? "caution" : "safe";
      return {
        employeeNo: r.employeeNo, name: r.fullName, unit: ctx.unitName(e.orgUnitId),
        leaveType: `${r.leaveTypeCode} — ${r.leaveTypeName}`,
        carryOverMax: ctx.typeById.get(r.leaveTypeId)?.carryOverMax ?? 0, carriedOver: r.carriedOver,
        remaining: r.remaining, potentialForfeit: round1(Math.min(r.carriedOver, Math.max(0, r.remaining))),
        forfeitDate: iso(new Date(year, 11, 31)), daysRemaining, urgency,
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining || b.potentialForfeit - a.potentialForfeit);
  const levels = [
    { urgency: "overdue", label: "Lewat Jatuh Tempo" },
    { urgency: "critical", label: "Kritis (< 30 hari)" },
    { urgency: "warning", label: "Perhatian (30 – 60 hari)" },
    { urgency: "caution", label: "Waspada (60 – 90 hari)" },
    { urgency: "safe", label: "Aman (> 90 hari)" },
  ];
  return {
    periodLabel: `Per ${dateID(ctx.now)} — batas hangus 31 Des ${year}`,
    payload: {
      year, items,
      total: items.length,
      counts: levels.map((l) => ({ ...l, count: items.filter((i) => i.urgency === l.urgency).length })),
      totalCarried: round1(items.reduce((s, i) => s + i.carriedOver, 0)),
      totalPotentialForfeit: round1(items.reduce((s, i) => s + i.potentialForfeit, 0)),
    },
  };
}

// ---------- LR1.3 Leave Liability ----------
async function lr13Liability(ctx: Ctx) {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  // default jenis = Cuti Tahunan (lookup by CODE — mirror lr11).
  const defTypeId = [...ctx.typeById.values()].find((t) => t.code === "CT-THN")?.id ?? null;
  const typeId = ctx.fp.leaveType ?? defTypeId;
  const type = typeId ? ctx.typeById.get(typeId) : null;
  const canSee = ctx.mv.canSee;
  const rows = await listBalances(ctx.db, { year, ...(typeId ? { leaveTypeId: typeId } : {}) });
  const scopedByNo = new Map(ctx.active.map((e) => [e.employeeNo, e]));
  const items = rows
    .filter((r) => scopedByNo.has(r.employeeNo) && r.remaining > 0)
    .map((r) => {
      const e = scopedByNo.get(r.employeeNo)!;
      const dailyRate = e.monthlySalary > 0 ? e.monthlySalary / 21 : 0;
      return {
        employeeNo: r.employeeNo, name: r.fullName, unit: ctx.unitName(e.orgUnitId),
        employmentStatus: e.employmentStatus, remaining: r.remaining,
        monthlySalary: canSee && e.monthlySalary > 0 ? Math.round(e.monthlySalary) : null,
        dailyRate: canSee && dailyRate > 0 ? Math.round(dailyRate) : null,
        liability: canSee && dailyRate > 0 ? Math.round(r.remaining * dailyRate) : null,
      };
    })
    .sort((a, b) => (b.liability ?? -1) - (a.liability ?? -1) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  return {
    periodLabel: `Per ${dateID(ctx.now)} — estimasi upah harian = gaji pokok ÷ 21`,
    payload: {
      typeName: type ? `${type.code} — ${type.name}` : "Semua Jenis Cuti",
      masked: !canSee,
      items,
      totalEmployees: items.length,
      totalDays: round1(items.reduce((s, i) => s + i.remaining, 0)),
      totalLiability: canSee ? items.reduce((s, i) => s + (i.liability ?? 0), 0) : null,
      top5: items.slice(0, 5),
    },
  };
}

// ===================== G2 — TRANSAKSI & RIWAYAT =====================

// ---------- LR2.1 Detailed Leave Activity Log ----------
function lr21Activity(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const items = ctx.reqs
    .filter((r) => overlapDays(r.dateFrom, r.dateTo, from, to))
    .map((r) => ({
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
      unit: ctx.unitName(r.emp.orgUnitId), leaveType: `${r.type.code} — ${r.type.name}`,
      dateFrom: iso(r.dateFrom), sessionFrom: r.sessionFrom,
      dateTo: iso(r.dateTo), sessionTo: r.sessionTo,
      workingDays: r.workingDays, status: r.status,
      reason: r.reason, source: r.source,
      decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt),
    }));
  const byStatus = ["Submitted", "Approved", "Rejected", "Cancelled", "MassLeave"]
    .map((s) => ({ status: s, label: STATUS_LABELS[s], count: items.filter((i) => i.status === s).length }))
    .filter((s) => s.count > 0);
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      total: items.length,
      totalDays: round1(items.reduce((s, i) => s + i.workingDays, 0)),
      byStatus,
      uniqueEmployees: new Set(items.map((i) => i.employeeNo)).size,
    },
  };
}

// ---------- LR2.2 Leave Approval Pipeline ----------
function lr22Pipeline(ctx: Ctx) {
  const items = ctx.reqs
    .filter((r) => r.status === "Submitted")
    .map((r) => {
      const waitingDays = Math.floor((ctx.now.getTime() - r.requestDate.getTime()) / DAY_MS);
      return {
        docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
        unit: ctx.unitName(r.emp.orgUnitId), leaveType: `${r.type.code} — ${r.type.name}`,
        dateFrom: iso(r.dateFrom), dateTo: iso(r.dateTo), workingDays: r.workingDays,
        requestDate: iso(r.requestDate), waitingDays,
        sla: waitingDays > 7 ? "overdue" : waitingDays > 3 ? "due-soon" : "on-track",
        source: r.source, reason: r.reason,
      };
    })
    .sort((a, b) => b.waitingDays - a.waitingDays);
  const levels = [
    { sla: "overdue", label: "Melewati SLA (> 7 hari)" },
    { sla: "due-soon", label: "Mendekati SLA (4 – 7 hari)" },
    { sla: "on-track", label: "Normal (≤ 3 hari)" },
  ];
  return {
    periodLabel: `Menunggu persetujuan per ${dateID(ctx.now)}`,
    payload: {
      items, total: items.length,
      totalDays: round1(items.reduce((s, i) => s + i.workingDays, 0)),
      counts: levels.map((l) => ({ ...l, count: items.filter((i) => i.sla === l.sla).length })),
      oldestWaiting: items.length ? Math.max(...items.map((i) => i.waitingDays)) : 0,
    },
  };
}

// ---------- LR2.3 Departmental Leave Schedule ----------
function lr23Schedule(ctx: Ctx) {
  const [ay, am] = (ctx.fp.month ?? "").split("-").map(Number);
  const anchor = ctx.fp.month && ay && am ? new Date(ay, am - 1, 1) : new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
  const upcoming = ctx.reqs
    .filter((r) => (r.status === "Approved" || r.status === "MassLeave") && overlapDays(r.dateFrom, r.dateTo, monthStart, monthEnd))
    .map((r) => {
      const overlapStart = r.dateFrom < monthStart ? monthStart : r.dateFrom;
      const overlapEnd = r.dateTo > monthEnd ? monthEnd : r.dateTo;
      const daysInMonth = Math.max(0, Math.round((overlapStart.getTime() <= overlapEnd.getTime() ? (overlapEnd.getTime() - overlapStart.getTime()) / DAY_MS : 0) + 1));
      // bentrok jadwal: rekan satu unit dengan rentang overlap
      const conflicts = ctx.reqs.filter((o) =>
        o.id !== r.id && (o.status === "Approved" || o.status === "MassLeave")
        && o.emp.orgUnitId === r.emp.orgUnitId && overlapDays(o.dateFrom, o.dateTo, r.dateFrom, r.dateTo),
      ).length;
      return {
        unit: ctx.unitName(r.emp.orgUnitId) ?? "Tanpa Unit",
        employeeNo: r.emp.employeeNo, name: r.emp.fullName,
        leaveType: `${r.type.code} — ${r.type.name}`,
        dateFrom: iso(r.dateFrom), sessionFrom: r.sessionFrom,
        dateTo: iso(r.dateTo), sessionTo: r.sessionTo,
        workingDays: r.workingDays, daysInMonth, conflicts,
        backToWork: iso(new Date(r.dateTo.getTime() + DAY_MS)),
      };
    })
    .sort((a, b) => (a.dateFrom ?? "").localeCompare(b.dateFrom ?? "") || a.unit.localeCompare(b.unit));
  const byUnit = new Map<string, typeof upcoming>();
  for (const it of upcoming) {
    const arr = byUnit.get(it.unit) ?? [];
    arr.push(it);
    byUnit.set(it.unit, arr);
  }
  return {
    periodLabel: `Jadwal ${monthLabel(anchor)} (disetujui & cuti massal)`,
    payload: {
      month: monthLabel(anchor),
      items: upcoming,
      byUnit: [...byUnit.entries()].map(([unit, rows]) => ({
        unit, rows, employees: new Set(rows.map((r) => r.employeeNo)).size,
        days: round1(rows.reduce((s, r) => s + r.workingDays, 0)),
        conflicts: rows.reduce((s, r) => s + r.conflicts, 0),
      })).sort((a, b) => a.unit.localeCompare(b.unit)),
      total: upcoming.length,
      totalDays: round1(upcoming.reduce((s, i) => s + i.workingDays, 0)),
      withConflicts: upcoming.filter((i) => i.conflicts > 0).length,
      unitsAffected: byUnit.size,
    },
  };
}

// ===================== G3 — ANALISIS KETIDAKHADIRAN =====================

// ---------- LR3.1 Absenteeism Rate Summary ----------
function lr31Absenteeism(ctx: Ctx) {
  const [ay, am] = (ctx.fp.month ?? "").split("-").map(Number);
  const anchor = ctx.fp.month && ay && am ? new Date(ay, am - 1, 1) : new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
  const atts = ctx.atts.filter((a) => a.workDate >= monthStart && a.workDate <= monthEnd);
  // hari kerja bulan = tanggal mayoritas-non-Off (Sabtu/Minggu shift tetap
  // tercatat Present — hitung workday hanya bila catatan non-Off > Off).
  const byDate = new Map<string, { nonOff: number; off: number }>();
  for (const a of atts) {
    const key = a.workDate.toDateString();
    const cur = byDate.get(key) ?? { nonOff: 0, off: 0 };
    if (a.status === "Off" || a.status === "Holiday") cur.off++;
    else cur.nonOff++;
    byDate.set(key, cur);
  }
  const workdays = [...byDate.values()].filter((v) => v.nonOff > v.off).length;
  const divisions = [...new Set(ctx.active.map((e) => ctx.divNameOf(e.orgUnitId)))].sort();
  const rows = divisions.map((division) => {
    const divEmps = ctx.active.filter((e) => ctx.divNameOf(e.orgUnitId) === division);
    const ids = new Set(divEmps.map((e) => e.id));
    const att = atts.filter((a) => ids.has(a.emp.id));
    const present = att.filter((a) => a.status === "Present" || a.status === "Late").length;
    const onLeave = att.filter((a) => a.status === "OnLeave").length;
    const absent = att.filter((a) => a.status === "Absent").length;
    const workoff = att.filter((a) => a.status === "WorkOff").length;
    const available = divEmps.length * workdays;
    const lostTotal = onLeave + workoff + absent;
    return {
      division, headcount: divEmps.length, workdays,
      present, onLeave, workoff, absent, lostTotal,
      rate: available > 0 ? round1((lostTotal / available) * 100) : null,
      unplannedRate: available > 0 ? round1((absent / available) * 100) : null,
    };
  });
  const totalAvailable = ctx.active.length * workdays;
  const sums = {
    present: rows.reduce((s, r) => s + r.present, 0),
    onLeave: rows.reduce((s, r) => s + r.onLeave, 0),
    workoff: rows.reduce((s, r) => s + r.workoff, 0),
    absent: rows.reduce((s, r) => s + r.absent, 0),
  };
  return {
    periodLabel: `${monthLabel(anchor)} — ${workdays} hari kerja tercatat`,
    payload: {
      month: monthLabel(anchor), workdays, rows,
      total: {
        headcount: ctx.active.length, ...sums,
        lostTotal: sums.onLeave + sums.workoff + sums.absent,
        rate: totalAvailable > 0 ? round1(((sums.onLeave + sums.workoff + sums.absent) / totalAvailable) * 100) : null,
        unplannedRate: totalAvailable > 0 ? round1((sums.absent / totalAvailable) * 100) : null,
      },
    },
  };
}

// ---------- LR3.2 Sick Leave Tracking & SKD Audit ----------
function lr32Sick(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const sakitTypeId = ctx.typeById.get("CT-SAKIT")?.id;
  const all = sakitTypeId
    ? ctx.reqs.filter((r) => r.type.id === sakitTypeId)
    : ctx.reqs.filter((r) => /sakit/i.test(r.type.name));
  const items = all
    .filter((r) => overlapDays(r.dateFrom, r.dateTo, from, to))
    .map((r) => ({
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
      unit: ctx.unitName(r.emp.orgUnitId),
      dateFrom: iso(r.dateFrom), dateTo: iso(r.dateTo), workingDays: r.workingDays,
      reason: r.reason, note: r.note, status: r.status,
      skdComplete: SKD_RE.test(r.note ?? "") || SKD_RE.test(r.reason ?? ""),
      decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt),
    }))
    .sort((a, b) => (b.dateFrom ?? "").localeCompare(a.dateFrom ?? ""));
  const filtered = ctx.fp.skd.length
    ? items.filter((i) => ctx.fp.skd.includes(i.skdComplete ? "complete" : "incomplete"))
    : items;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items: filtered,
      total: filtered.length,
      totalDays: round1(filtered.reduce((s, i) => s + i.workingDays, 0)),
      complete: filtered.filter((i) => i.skdComplete).length,
      incomplete: filtered.filter((i) => !i.skdComplete).length,
      uniqueEmployees: new Set(filtered.map((i) => i.employeeNo)).size,
      pending: filtered.filter((i) => i.status === "Submitted").length,
    },
  };
}

// ---------- LR3.3 Unexcused Absence / Alpa Log ----------
function lr33Alpa(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  const to = ctx.toD ?? ctx.now;
  const absents = ctx.atts.filter((a) => a.status === "Absent" && a.workDate >= from && a.workDate <= to);
  const byEmp = new Map<string, typeof absents>();
  for (const a of absents) {
    const arr = byEmp.get(a.emp.id) ?? [];
    arr.push(a);
    byEmp.set(a.emp.id, arr);
  }
  const recommend = (n: number): { level: string; action: string } => {
    if (n >= 7) return { level: "SP-3", action: "SP ketiga — pertimbangkan pemutusan hubungan kerja (UU 13/2003 Ps.158)" };
    if (n >= 5) return { level: "SP-2", action: "Surat Peringatan kedua" };
    if (n >= 3) return { level: "SP-1", action: "Surat Peringatan pertama" };
    if (n >= 2) return { level: "Teguran", action: "Teguran tertulis + pembinaan" };
    return { level: "Pembinaan", action: "Teguran lisan / klarifikasi atasan" };
  };
  const summary = [...byEmp.entries()]
    .map(([empId, rows]) => {
      const e = rows[0].emp;
      const rec = recommend(rows.length);
      return {
        employeeNo: e.employeeNo, name: e.fullName, unit: ctx.unitName(e.orgUnitId),
        employmentStatus: e.employmentStatus,
        count: rows.length, firstDate: iso(rows.map((r) => r.workDate).sort((a, b) => a.getTime() - b.getTime())[0]),
        lastDate: iso(rows.map((r) => r.workDate).sort((a, b) => b.getTime() - a.getTime())[0]),
        recommendation: rec.level, action: rec.action,
      };
    })
    .sort((a, b) => b.count - a.count || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  const detail = absents
    .map((a) => ({
      date: iso(a.workDate), weekday: ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][a.workDate.getDay()],
      employeeNo: a.emp.employeeNo, name: a.emp.fullName, unit: ctx.unitName(a.emp.orgUnitId),
      notes: a.notes,
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      summary, detail,
      employees: summary.length,
      totalDays: absents.length,
      sp1: summary.filter((s) => s.recommendation.startsWith("SP")).length,
      top: summary[0] ?? null,
    },
  };
}

// ===================== G4 — KEPATUHAN & CUTI KHUSUS =====================

// ---------- LR4.1 Statutory Special Leave ----------
function lr41Special(ctx: Ctx) {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const specialByCode = new Map(SPECIAL_TYPES.map((s) => [s.code, s]));
  const items = ctx.reqs
    .filter((r) => specialByCode.has(r.type.code) && r.dateFrom.getFullYear() === year)
    .map((r) => ({
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
      gender: r.emp.gender === "F" ? "Perempuan" : "Laki-laki",
      unit: ctx.unitName(r.emp.orgUnitId),
      leaveType: `${r.type.code} — ${r.type.name}`,
      basis: specialByCode.get(r.type.code)?.basis ?? "",
      dateFrom: iso(r.dateFrom), dateTo: iso(r.dateTo),
      workingDays: r.workingDays, unitOfMeasure: r.type.unit,
      status: r.status, needDocs: r.type.needDocs,
      docsComplete: !r.type.needDocs || SKD_RE.test(r.note ?? "") || /surat|keterangan|skd|dokumen/i.test(r.note ?? ""),
      reason: r.reason,
    }))
    .sort((a, b) => a.leaveType.localeCompare(b.leaveType) || (a.dateFrom ?? "").localeCompare(b.dateFrom ?? ""));
  const byType = SPECIAL_TYPES
    .map((s) => {
      const rows = items.filter((i) => i.leaveType.startsWith(s.code));
      return { code: s.code, basis: s.basis, count: rows.length, days: round1(rows.reduce((x, i) => x + i.workingDays, 0)) };
    })
    .filter((t) => t.count > 0);
  return {
    periodLabel: `Tahun ${year}`,
    payload: {
      year, items, byType,
      total: items.length,
      totalDays: round1(items.reduce((s, i) => s + i.workingDays, 0)),
      female: items.filter((i) => i.gender === "Perempuan").length,
      male: items.filter((i) => i.gender === "Laki-laki").length,
      docsMissing: items.filter((i) => !i.docsComplete).length,
    },
  };
}

// ---------- LR4.2 Long Leave / Grand Leave ----------
function lr42LongLeave(ctx: Ctx) {
  const besar = ctx.typeById.get("CT-BESAR");
  const waitingMonths = besar?.waitingMonths ?? 72;
  const taken = besar
    ? ctx.reqs.filter((r) => r.type.id === besar.id).map((r) => ({
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
      unit: ctx.unitName(r.emp.orgUnitId), joinDate: iso(r.emp.joinDate),
      tenureYears: round1(ctx.tenureYears(r.emp)),
      dateFrom: iso(r.dateFrom), dateTo: iso(r.dateTo), workingDays: r.workingDays,
      status: r.status, note: r.note,
    }))
    : [];
  const takers = new Set(taken.map((t) => t.employeeNo));
  const eligible = ctx.active
    .filter((e) => ctx.tenureYears(e) * 12 >= waitingMonths && !takers.has(e.employeeNo))
    .map((e) => ({
      employeeNo: e.employeeNo, name: e.fullName, unit: ctx.unitName(e.orgUnitId),
      joinDate: iso(e.joinDate), tenureYears: round1(ctx.tenureYears(e)),
      employmentStatus: e.employmentStatus,
    }))
    .sort((a, b) => b.tenureYears - a.tenureYears);
  return {
    periodLabel: `Per ${dateID(ctx.now)} — syarat masa kerja ${waitingMonths} bulan`,
    payload: {
      waitingMonths, entitlement: besar?.entitlement ?? 12,
      taken, eligible,
      takenCount: taken.length,
      eligibleCount: eligible.length,
    },
  };
}

// ---------- LR4.3 Menstrual Leave Audit ----------
function lr43Menstrual(ctx: Ctx) {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const haidTypeId = ctx.typeById.get("CT-HAID")?.id;
  const all = haidTypeId
    ? ctx.reqs.filter((r) => r.type.id === haidTypeId)
    : ctx.reqs.filter((r) => /haid/i.test(r.type.name));
  const items = all
    .filter((r) => overlapDays(r.dateFrom, r.dateTo, from, to))
    .map((r) => ({
      docNo: r.docNo, employeeNo: r.emp.employeeNo, name: r.emp.fullName,
      unit: ctx.unitName(r.emp.orgUnitId),
      dateFrom: iso(r.dateFrom), sessionFrom: r.sessionFrom,
      dateTo: iso(r.dateTo), sessionTo: r.sessionTo,
      workingDays: r.workingDays, status: r.status, reason: r.reason,
      decidedBy: r.decidedBy, decidedAt: iso(r.decidedAt),
    }))
    .sort((a, b) => (b.dateFrom ?? "").localeCompare(a.dateFrom ?? ""));
  const femaleActive = ctx.active.filter((e) => e.gender === "F");
  const perEmp = new Map<string, number>();
  for (const i of items) perEmp.set(i.employeeNo, (perEmp.get(i.employeeNo) ?? 0) + i.workingDays);
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items, femaleActive: femaleActive.length,
      total: items.length,
      totalDays: round1(items.reduce((s, i) => s + i.workingDays, 0)),
      uniqueEmployees: perEmp.size,
      avgPerEmployee: perEmp.size ? round1([...perEmp.values()].reduce((s, v) => s + v, 0) / perEmp.size) : 0,
      top: [...perEmp.entries()].map(([employeeNo, days]) => ({ employeeNo, days: round1(days) })).sort((a, b) => b.days - a.days).slice(0, 5),
      approved: items.filter((i) => i.status === "Approved").length,
      pending: items.filter((i) => i.status === "Submitted").length,
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
    case "lr11": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Saldo Cuti",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Status", width: 14 }, { header: "Tgl Masuk", width: 12 }, { header: "Masa Kerja (thn)", width: 12 },
          { header: "Hak (bruto)", width: 12 }, { header: "Bawa (a)", width: 10 }, { header: "Diperoleh (b)", width: 12 },
          { header: "Penyesuaian (c)", width: 12 }, { header: "Diambil (f)", width: 12 }, { header: "Terpasang (g)", width: 12 },
          { header: "Diuangkan (e)", width: 12 }, { header: "Sisa Saldo", width: 12 },
        ],
        rows: rows.map((r) => [s(r.employeeNo), s(r.name), s(r.unit), s(r.employmentStatus), d(r.joinDate as string), (r.tenureYears as number) ?? 0, (r.entitlement as number) ?? 0, (r.carriedOver as number) ?? 0, (r.earned as number) ?? 0, (r.adjustment as number) ?? 0, (r.taken as number) ?? 0, (r.applied as number) ?? 0, (r.cashed as number) ?? 0, (r.remaining as number) ?? 0]),
      }];
    }
    case "lr12": {
      const label: Record<string, string> = { overdue: "Lewat Jatuh Tempo", critical: "Kritis (<30 hr)", warning: "Perhatian (30–60)", caution: "Waspada (60–90)", safe: "Aman (>90)" };
      return [{
        name: "Hangus Carry-Over",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Jenis Cuti", width: 22 }, { header: "Batas Bawa", width: 10 }, { header: "Dibawa", width: 10 }, { header: "Sisa Saldo", width: 10 }, { header: "Potensi Hangus", width: 12 }, { header: "Tanggal Hangus", width: 14 }, { header: "Sisa Hari", width: 10 }, { header: "Urgensi", width: 18 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.leaveType), (i.carryOverMax as number) ?? 0, (i.carriedOver as number) ?? 0, (i.remaining as number) ?? 0, (i.potentialForfeit as number) ?? 0, d(i.forfeitDate as string), (i.daysRemaining as number) ?? 0, label[i.urgency as string] ?? s(i.urgency)]),
      }];
    }
    case "lr13": {
      const rp = (n: unknown) => (n == null ? "—" : n as number);
      return [{
        name: "Liabilitas Cuti",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Status", width: 14 }, { header: "Sisa Saldo (hari)", width: 14 }, { header: "Gaji Pokok (Rp/bln)", width: 18 }, { header: "Upah Harian (Rp)", width: 16 }, { header: "Liabilitas (Rp)", width: 18 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.employmentStatus), (i.remaining as number) ?? 0, rp(i.monthlySalary), rp(i.dailyRate), rp(i.liability)]),
      }];
    }
    case "lr21": {
      const label: Record<string, string> = { Approved: "Disetujui", Submitted: "Menunggu", Rejected: "Ditolak", Cancelled: "Dibatalkan", MassLeave: "Cuti Massal" };
      return [{
        name: "Riwayat Cuti",
        title,
        columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Jenis Cuti", width: 24 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari Kerja", width: 10 }, { header: "Status", width: 14 }, { header: "Alasan", width: 32 }, { header: "Sumber", width: 10 }, { header: "Pemutus", width: 20 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.leaveType), d(i.dateFrom as string), d(i.dateTo as string), (i.workingDays as number) ?? 0, label[i.status as string] ?? s(i.status), s(i.reason), s(i.source), s(i.decidedBy)]),
      }];
    }
    case "lr22": {
      const label: Record<string, string> = { overdue: "Melewati SLA", "due-soon": "Mendekati SLA", "on-track": "Normal" };
      return [{
        name: "Pipeline Persetujuan",
        title,
        columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Jenis Cuti", width: 24 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari Kerja", width: 10 }, { header: "Diajukan", width: 12 }, { header: "Menunggu (hari)", width: 12 }, { header: "SLA", width: 14 }, { header: "Alasan", width: 30 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.leaveType), d(i.dateFrom as string), d(i.dateTo as string), (i.workingDays as number) ?? 0, d(i.requestDate as string), (i.waitingDays as number) ?? 0, label[i.sla as string] ?? s(i.sla), s(i.reason)]),
      }];
    }
    case "lr23": {
      return [{
        name: "Jadwal Cuti",
        title,
        columns: [{ header: "Unit", width: 24 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Jenis Cuti", width: 24 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari Kerja", width: 10 }, { header: "Bentrok Unit", width: 12 }, { header: "Kembali Kerja", width: 14 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.unit), s(i.employeeNo), s(i.name), s(i.leaveType), d(i.dateFrom as string), d(i.dateTo as string), (i.workingDays as number) ?? 0, (i.conflicts as number) ?? 0, d(i.backToWork as string)]),
      }];
    }
    case "lr31": {
      return [{
        name: "Absenteeisme",
        title,
        columns: [{ header: "Divisi", width: 26 }, { header: "Headcount", width: 12 }, { header: "Hari Kerja", width: 10 }, { header: "Hadir", width: 10 }, { header: "Cuti", width: 10 }, { header: "Izin/Off", width: 10 }, { header: "Alpa", width: 10 }, { header: "Total Tidak Hadir", width: 14 }, { header: "Absenteeisme %", width: 14 }, { header: "Alpa % (tak terencana)", width: 16 }],
        rows: ((p.rows as AnyRec[]) ?? []).map((r) => [s(r.division), (r.headcount as number) ?? 0, (r.workdays as number) ?? 0, (r.present as number) ?? 0, (r.onLeave as number) ?? 0, (r.workoff as number) ?? 0, (r.absent as number) ?? 0, (r.lostTotal as number) ?? 0, (r.rate as number) ?? "—", (r.unplannedRate as number) ?? "—"]),
      }];
    }
    case "lr32": {
      return [{
        name: "Audit Sakit & SKD",
        title,
        columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari", width: 8 }, { header: "Alasan", width: 28 }, { header: "SKD", width: 12 }, { header: "No./Catatan SKD", width: 32 }, { header: "Status", width: 14 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), d(i.dateFrom as string), d(i.dateTo as string), (i.workingDays as number) ?? 0, s(i.reason), i.skdComplete ? "Lengkap" : "TIDAK LENGKAP", s(i.note), s(i.status)]),
      }];
    }
    case "lr33": {
      return [
        {
          name: "Rekap Alpa",
          title,
          columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Status", width: 14 }, { header: "Jumlah Alpa", width: 12 }, { header: "Pertama", width: 12 }, { header: "Terakhir", width: 12 }, { header: "Rekomendasi", width: 14 }, { header: "Tindakan", width: 40 }],
          rows: ((p.summary as AnyRec[]) ?? []).map((r) => [s(r.employeeNo), s(r.name), s(r.unit), s(r.employmentStatus), (r.count as number) ?? 0, d(r.firstDate as string), d(r.lastDate as string), s(r.recommendation), s(r.action)]),
        },
        {
          name: "Log Detail",
          title,
          columns: [{ header: "Tanggal", width: 12 }, { header: "Hari", width: 10 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }],
          rows: ((p.detail as AnyRec[]) ?? []).map((r) => [d(r.date as string), s(r.weekday), s(r.employeeNo), s(r.name), s(r.unit)]),
        },
      ];
    }
    case "lr41": {
      return [{
        name: "Cuti Khusus Regulasi",
        title,
        columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "L/P", width: 6 }, { header: "Unit", width: 22 }, { header: "Jenis Cuti", width: 26 }, { header: "Dasar Hukum", width: 36 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari/Bulan", width: 12 }, { header: "Status", width: 14 }, { header: "Dokumen", width: 12 }, { header: "Alasan", width: 30 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.docNo), s(i.employeeNo), s(i.name), s(i.gender), s(i.unit), s(i.leaveType), s(i.basis), d(i.dateFrom as string), d(i.dateTo as string), (i.workingDays as number) ?? 0, s(i.status), i.docsComplete ? "Lengkap" : "Belum", s(i.reason)]),
      }];
    }
    case "lr42": {
      return [
        {
          name: "Riwayat Cuti Besar",
          title,
          columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Tgl Masuk", width: 12 }, { header: "Masa Kerja (thn)", width: 14 }, { header: "Mulai", width: 12 }, { header: "Selesai", width: 12 }, { header: "Hari Kerja", width: 10 }, { header: "Status", width: 14 }],
          rows: ((p.taken as AnyRec[]) ?? []).map((t) => [s(t.docNo), s(t.employeeNo), s(t.name), s(t.unit), d(t.joinDate as string), (t.tenureYears as number) ?? 0, d(t.dateFrom as string), d(t.dateTo as string), (t.workingDays as number) ?? 0, s(t.status)]),
        },
        {
          name: "Berhak Belum Ambil",
          title,
          columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Tgl Masuk", width: 12 }, { header: "Masa Kerja (thn)", width: 14 }, { header: "Status", width: 14 }],
          rows: ((p.eligible as AnyRec[]) ?? []).map((e) => [s(e.employeeNo), s(e.name), s(e.unit), d(e.joinDate as string), (e.tenureYears as number) ?? 0, s(e.employmentStatus)]),
        },
      ];
    }
    default: {
      return [{
        name: "Audit Cuti Haid",
        title,
        columns: [{ header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Tanggal", width: 12 }, { header: "Sesi", width: 10 }, { header: "Hari", width: 8 }, { header: "Status", width: 14 }, { header: "Alasan", width: 26 }, { header: "Pemutus", width: 20 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), d(i.dateFrom as string), s(i.sessionFrom), (i.workingDays as number) ?? 0, s(i.status), s(i.reason), s(i.decidedBy)]),
      }];
    }
  }
}
