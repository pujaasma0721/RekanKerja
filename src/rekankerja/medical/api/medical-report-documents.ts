import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
// KONTRAK payload — tipe dipakai compile-time supaya field TIDAK BISA menyimpang
// dari src/rekankerja/medical/components/report-documents/types.ts (MED-1-b).
import type {
  BalanceStatus,
  MR11Data, MR12Data, MR13Data, MR21Data, MR22Data, MR23Data,
  MR31Data, MR32Data, MR33Data, MR41Data, MR42Data, MR43Data,
} from "@/rekankerja/medical/components/report-documents/types";

// =============================================================================
// MED-1-a — LAPORAN DISTRIBUSI MEDICAL (print & PDF ready) ====================
// =============================================================================
// GET /api/rekankerja/medical/reports/documents?id=<mrId> — data satu laporan
// siap cetak (12 laporan / 4 grup: saldo & plafon medis, transaksi klaim,
// analisis biaya & utilisasi, rekonsiliasi asuransi & kepatuhan CoB).
//
// Alur T110/T112 (mirror HR & Leave): form parameter awal di klien mengirim
// query string (office/unit/benefitType/status cakupan + month/year/from/to
// periode) → diterapkan SERVER-SIDE sebelum builder berjalan.
// ?id=_params → daftar opsi filter. ?export=xlsx → stream XLSX per laporan.
//
// Guard: requireMenuViewAny medical:medical-reports + cakupan akses efektif.
//
// UANG (M-8): seluruh kolom uang MedicalBalance/MedicalClaim/MedicalClaimLine
// TERENKRIPSI — didekripsi via tenantCryptoForDb HANYA untuk kalkulasi internal
// (raw — benar meski brankas terkunci); NILAI yang diserialisasi digerbang
// money-view (masked saat brankas terkunci → null, frontend render "•••").
// Diagnosis/perawatan (PII kesehatan Task 52-d) didekripsi di batas serializer
// (tidak digerbang vault — bukan uang); MR3.3 tetap dianonimkan per desain.

const DAY_MS = 24 * 3600 * 1000;
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "mr11", "mr12", "mr13",
  "mr21", "mr22", "mr23",
  "mr31", "mr32", "mr33",
  "mr41", "mr42", "mr43",
]);

const REPORT_TITLES: Record<string, string> = {
  mr11: "Employee Medical Benefit Limit Balance (Saldo Plafon Medis Karyawan)",
  mr12: "Top Medical Limit Utilizers Alert Sheet (Sisa Plafon Kritis)",
  mr13: "Medical Benefit Liability Report (Liabilitas Saldo Medis)",
  mr21: "Detailed Medical Reimbursement Register (Register Rincian Klaim)",
  mr22: "Pending Claims & Verification Pipeline (Klaim Tertahan & Verifikasi)",
  mr23: "Family Dependent Claim Summary (Rekap Klaim Tanggungan Keluarga)",
  mr31: "Medical Claim Distribution by Type (Distribusi Klaim per Kategori)",
  mr32: "Absenteeism Due to Medical Reasons (Analisis Hari Kerja Hilang)",
  mr33: "High-Frequency Diagnosis Log (Statistik Diagnosis — Anonim)",
  mr41: "Insurance Premium vs Utilization Reconciliation (Rekonsiliasi Asuransi)",
  mr42: "Insurance Enrollment & De-enrollment Log (Mutasi Peserta Asuransi)",
  mr43: "Coordination of Benefits (CoB) Audit Report (Audit Jaminan Berjenjang)",
};

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Submitted: "Menunggu Verifikasi",
  Approved: "Disetujui",
  Rejected: "Ditolak",
  Cancelled: "Dibatalkan",
  Settled: "Settled (Dibayar)",
};
const STATE_ORDER = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled", "Settled"];

const BAL_STATUS_LABELS: Record<string, string> = {
  exhausted: "Habis", critical: "Kritis", warning: "Waspada", caution: "Perhatian", safe: "Aman",
};
const URGENCY_LABELS: Record<string, string> = {
  exhausted: "Habis (0%)", critical: "Kritis (< 5%)", warning: "Waspada (5–10%)", caution: "Perhatian (10–20%)",
};
const SLA_LABELS: Record<string, string> = {
  overdue: "Melewati SLA", "due-soon": "Mendekati SLA", "on-track": "Normal",
};
const INS_STATE_LABELS: Record<string, string> = {
  NONE: "Belum dikirim", SUBMITTED: "Menunggu pembayaran", PAID: "Dibayar", WRITTEN_OFF: "Dihapus buku",
};
const RELATION_LABELS: Record<string, string> = {
  Spouse: "Pasangan", Child: "Anak", Parent: "Orang Tua", Sibling: "Saudara",
};

// ============ MED-1-a: parameter & filter awal (mirror T110 HR / T112 Leave) ============

interface ReportFilters {
  office: string | null;
  unit: string | null;
  /** id MedicalBenefitType */
  benefitType: string | null;
  /** state MedicalClaim */
  status: string | null;
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
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Mirror `depPoolSeparate` medical-service — true bila jenis memberi pool
 *  plafon DEPENDENT TERPISAH (EACH/TOTAL_SEPARATE). SHARED → klaim dependent
 *  memakai pool utama karyawan sehingga baris tanggungan tidak dibuat. */
const depPoolSeparate = (t: { dependentEnabled: boolean; depLimitRule: string }): boolean =>
  t.dependentEnabled && (t.depLimitRule === "EACH" || t.depLimitRule === "TOTAL_SEPARATE");

/** Status urgensi saldo (MR1.1) — plafon ≤ 0 (UNLIMITED/kosong) → "safe". */
function balStatus(plafon: number, remaining: number): BalanceStatus {
  if (plafon <= 0) return "safe";
  if (remaining <= 0) return "exhausted";
  const pct = (remaining / plafon) * 100;
  if (pct < 5) return "critical";
  if (pct < 10) return "warning";
  if (pct < 20) return "caution";
  return "safe";
}

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["medical:medical-reports"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan). ----
    if (id === "_params") {
      const [offices, units, types, minClaim, minBalYear, claimStats] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        db.medicalBenefitType.findMany({ where: { active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        db.medicalClaim.aggregate({ _min: { claimDate: true } }),
        db.medicalBalance.aggregate({ _min: { year: true } }),
        db.medicalClaim.findMany({ select: { state: true }, distinct: ["state"] }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = Math.min(
        minClaim._min.claimDate?.getFullYear() ?? nowP.getFullYear(),
        minBalYear._min.year ?? nowP.getFullYear(),
      );
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      const present = [...new Set(claimStats.map((r) => r.state).filter(Boolean))]
        .sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b));
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        benefitTypes: types.map((t) => ({ id: t.id, label: `${t.code} — ${t.name}` })),
        statuses: present.map((s) => ({ id: s, label: STATUS_LABELS[s] ?? s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (mr11…mr43)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const monthParam = sp.get("month");
    const yearParam = sp.get("year");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      unit: sp.get("unit") || null,
      benefitType: sp.get("benefitType") || null,
      status: sp.get("status") || null,
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
    const [rawEmps, typesAll, unitsAll, officesAll, claimsAll, balAll, sickAll, famAll, company] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          id: true, employeeNo: true, fullName: true, gender: true, joinDate: true,
          endDate: true, status: true, orgUnitId: true, companyOfficeId: true,
          assignments: {
            where: { validTo: null },
            select: { employmentStatus: true, orgUnit: { select: { name: true } } },
            orderBy: { validFrom: "desc" },
            take: 1,
          },
        },
      }),
      db.medicalBenefitType.findMany({
        select: {
          id: true, code: true, name: true, limitRule: true, needReceipt: true, needLetter: true,
          pctCompany: true, pctInsurance: true, insuranceCompany: true,
          depLimitRule: true, dependentEnabled: true, sortOrder: true,
        },
      }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true } }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, active: true } }),
      db.medicalClaim.findMany({
        select: {
          id: true, docNo: true, employeeId: true, typeId: true, year: true, claimDate: true,
          letterNo: true, state: true, forDependent: true,
          totalBill: true, totalReimburse: true, totalApproved: true, totalNonRe: true,
          settleDate: true, journalNo: true,
          insState: true, insRefNo: true, insAmount: true, insSubmittedAt: true, insPaidAt: true, insPaidAmount: true,
          lines: {
            select: {
              treatedName: true, treatment: true, treatmentDate: true, receiptNo: true,
              physician: true, hospital: true, occupationalInjury: true,
              billAmount: true, approvedAmount: true, nonReAmount: true,
            },
          },
        },
        orderBy: [{ claimDate: "desc" }, { docNo: "desc" }],
        take: 500,
      }),
      db.medicalBalance.findMany({
        select: {
          employeeId: true, typeId: true, year: true,
          benefitAmount: true, adjustmentAmount: true, initialUsed: true, usedAmount: true,
          depBenefitAmount: true, depAdjustment: true, depUsed: true, carriedOver: true,
        },
        take: 2500,
      }),
      // MR3.2 — cuti sakit (CT-SAKIT) disetujui/cuti massal = hari kerja hilang.
      db.leaveRequest.findMany({
        where: { leaveType: { code: "CT-SAKIT" }, status: { in: ["Approved", "MassLeave"] } },
        select: { employeeId: true, workingDays: true, dateFrom: true },
      }),
      // MR2.3 — lookup hubungan keluarga (best-effort pasien tanggungan).
      db.employeeFamily.findMany({ select: { employeeId: true, relation: true, name: true } }),
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    ]);

    // ---- maps ----
    const typeById = new Map(typesAll.map((t) => [t.id, t]));
    const unitById = new Map(unitsAll.map((u) => [u.id, u]));
    const officeById = new Map(officesAll.map((o) => [o.id, o]));
    const decMoney = (v: string | null | undefined) => tc.decryptMoney(v) ?? 0;

    // ---- normalisasi karyawan + filter cakupan ----
    interface EnrEmp {
      id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
      endDate: Date | null; status: string; orgUnitId: string | null; companyOfficeId: string | null;
      employmentStatus: string; unitName: string | null;
    }
    const rawUnitName = (unitId: string | null) => (unitId ? unitById.get(unitId)?.name ?? null : null);
    const emps: EnrEmp[] = rawEmps.map((e) => ({
      id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender,
      joinDate: e.joinDate, endDate: e.endDate, status: e.status, orgUnitId: e.orgUnitId,
      companyOfficeId: e.companyOfficeId,
      employmentStatus: e.assignments[0]?.employmentStatus ?? "Tanpa data",
      unitName: e.assignments[0]?.orgUnit?.name ?? rawUnitName(e.orgUnitId),
    }));
    const empById = new Map(emps.map((e) => [e.id, e]));

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
    const sortByNo = (a: { employeeNo: string }, b: { employeeNo: string }) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // ---- saldo medis ter-enrich (uang RAW hasil decrypt — kalkulasi internal) ----
    interface EnrBal {
      emp: EnrEmp; type: (typeof typesAll)[number]; year: number;
      benefit: number; adjustment: number; initialUsed: number; used: number;
      depBenefit: number; depAdjustment: number; depUsed: number; carriedOver: number;
    }
    const balances: EnrBal[] = balAll
      .map((b) => {
        const emp = empById.get(b.employeeId);
        const type = typeById.get(b.typeId);
        if (!emp || !type) return null;
        return {
          emp, type, year: b.year,
          benefit: decMoney(b.benefitAmount), adjustment: decMoney(b.adjustmentAmount),
          initialUsed: decMoney(b.initialUsed), used: decMoney(b.usedAmount),
          depBenefit: decMoney(b.depBenefitAmount), depAdjustment: decMoney(b.depAdjustment),
          depUsed: decMoney(b.depUsed), carriedOver: decMoney(b.carriedOver),
        };
      })
      .filter((b): b is EnrBal => !!b);

    // ---- klaim medis ter-scope + ter-enrich (uang RAW; diagnosis decrypt) ----
    interface EnrLine {
      treatedName: string; treatment: string | null; treatmentDate: Date | null;
      receiptNo: string | null; physician: string | null; hospital: string | null;
      occupationalInjury: boolean; bill: number; approved: number; nonRe: number;
    }
    interface EnrClaim {
      id: string; docNo: string; emp: EnrEmp; type: (typeof typesAll)[number]; year: number;
      claimDate: Date; letterNo: string | null; state: string; forDependent: boolean;
      settleDate: Date | null; journalNo: string | null; insState: string;
      insSubmittedAt: Date | null; insAmount: number; insPaidAmount: number;
      totalBill: number; totalReimburse: number; totalApproved: number; totalNonRe: number;
      lines: EnrLine[];
    }
    const claims: EnrClaim[] = claimsAll
      .filter((c) => scopedIds.has(c.employeeId))
      .map((c) => {
        const emp = empById.get(c.employeeId);
        const type = typeById.get(c.typeId);
        if (!emp || !type) return null;
        return {
          id: c.id, docNo: c.docNo, emp, type, year: c.year, claimDate: new Date(c.claimDate),
          letterNo: c.letterNo, state: c.state, forDependent: c.forDependent,
          settleDate: c.settleDate, journalNo: c.journalNo, insState: c.insState,
          insSubmittedAt: c.insSubmittedAt, insAmount: decMoney(c.insAmount), insPaidAmount: decMoney(c.insPaidAmount),
          totalBill: decMoney(c.totalBill), totalReimburse: decMoney(c.totalReimburse),
          totalApproved: decMoney(c.totalApproved), totalNonRe: decMoney(c.totalNonRe),
          lines: c.lines.map((l) => ({
            treatedName: l.treatedName, treatment: tc.decryptText(l.treatment),
            treatmentDate: l.treatmentDate, receiptNo: l.receiptNo,
            physician: l.physician, hospital: l.hospital, occupationalInjury: l.occupationalInjury,
            bill: decMoney(l.billAmount), approved: decMoney(l.approvedAmount), nonRe: decMoney(l.nonReAmount),
          })),
        };
      })
      .filter((c): c is EnrClaim => !!c);

    const sickLeaves = sickAll
      .filter((s) => scopedIds.has(s.employeeId))
      .map((s) => ({ empId: s.employeeId, workingDays: s.workingDays, dateFrom: new Date(s.dateFrom) }));
    const familyByEmp = new Map<string, { name: string; relation: string }[]>();
    for (const f of famAll) {
      const arr = familyByEmp.get(f.employeeId) ?? [];
      arr.push({ name: f.name, relation: f.relation });
      familyByEmp.set(f.employeeId, arr);
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
    if (fp.benefitType) {
      const ty = typeById.get(fp.benefitType);
      if (ty) filterChips.push({ label: "Jenis Benefit", value: `${ty.code} — ${ty.name}` });
    }
    if (fp.status) filterChips.push({ label: "Status Klaim", value: STATUS_LABELS[fp.status] ?? fp.status });
    if (fp.month) {
      const [yy, mm] = fp.month.split("-").map(Number);
      filterChips.push({ label: "Bulan Data", value: `${MONTHS_ID[mm - 1]} ${yy}` });
    }
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
      db, scoped, active, scopedIds, claims, balances, sickLeaves, familyByEmp,
      now, fp, meta, tc, mv, typeById, unitById, officeById, divNameOf, sortByNo, fromD, toD,
    };

    const data = await buildReport(id, ctx);

    // ---- mode export XLSX ----
    if (sp.get("export") === "xlsx") {
      const sheets = buildSheets(id, data, data.periodLabel);
      const buf = await toXlsxMulti(sheets);
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "MedicalReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi Medical (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-medical-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ tipe konteks ============

interface CtxEmp {
  id: string; employeeNo: string; fullName: string; gender: string; joinDate: Date;
  endDate: Date | null; status: string; orgUnitId: string | null; companyOfficeId: string | null;
  employmentStatus: string; unitName: string | null;
}
interface CtxType {
  id: string; code: string; name: string; limitRule: string; needReceipt: boolean; needLetter: boolean;
  pctCompany: number; pctInsurance: number; insuranceCompany: string | null;
  depLimitRule: string; dependentEnabled: boolean; sortOrder: number;
}
interface CtxLine {
  treatedName: string; treatment: string | null; treatmentDate: Date | null;
  receiptNo: string | null; physician: string | null; hospital: string | null;
  occupationalInjury: boolean; bill: number; approved: number; nonRe: number;
}
interface CtxClaim {
  id: string; docNo: string; emp: CtxEmp; type: CtxType; year: number;
  claimDate: Date; letterNo: string | null; state: string; forDependent: boolean;
  settleDate: Date | null; journalNo: string | null; insState: string;
  insSubmittedAt: Date | null; insAmount: number; insPaidAmount: number;
  totalBill: number; totalReimburse: number; totalApproved: number; totalNonRe: number;
  lines: CtxLine[];
}
interface CtxBal {
  emp: CtxEmp; type: CtxType; year: number;
  benefit: number; adjustment: number; initialUsed: number; used: number;
  depBenefit: number; depAdjustment: number; depUsed: number; carriedOver: number;
}

interface Ctx {
  db: TenantDb;
  scoped: CtxEmp[];
  active: CtxEmp[];
  scopedIds: Set<string>;
  claims: CtxClaim[];
  balances: CtxBal[];
  sickLeaves: { empId: string; workingDays: number; dateFrom: Date }[];
  familyByEmp: Map<string, { name: string; relation: string }[]>;
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
  typeById: Map<string, CtxType>;
  unitById: Map<string, { id: string; code: string; name: string; parentId: string | null; level: number }>;
  officeById: Map<string, { id: string; code: string; name: string; city: string | null; active: boolean }>;
  divNameOf: (unitId: string | null) => string;
  sortByNo: (a: { employeeNo: string }, b: { employeeNo: string }) => number;
  fromD: Date | null;
  toD: Date | null;
}

async function buildReport(id: string, ctx: Ctx): Promise<{ periodLabel: string; payload: unknown }> {
  switch (id) {
    case "mr11": return mr11Balance(ctx);
    case "mr12": return mr12Utilizers(ctx);
    case "mr13": return mr13Liability(ctx);
    case "mr21": return mr21Register(ctx);
    case "mr22": return mr22Pipeline(ctx);
    case "mr23": return mr23Dependents(ctx);
    case "mr31": return mr31ByType(ctx);
    case "mr32": return mr32Absenteeism(ctx);
    case "mr33": return mr33Diagnosis(ctx);
    case "mr41": return mr41Insurance(ctx);
    case "mr42": return mr42Enrollment(ctx);
    default: return mr43Cob(ctx);
  }
}

/** Basis saldo pool utama karyawan aktif ter-scope untuk tahun buku tertentu
 *  (dipakai MR1.1/1.2/1.3 — formula saldo identik medical-service listBalances:
 *  plafon = benefit + adjustment + carry-over; terpakai = used + initialUsed). */
function scopedBalances(ctx: Ctx, year: number): CtxBal[] {
  return ctx.balances.filter((b) =>
    b.year === year
    && (!ctx.fp.benefitType || b.type.id === ctx.fp.benefitType)
    && ctx.scopedIds.has(b.emp.id)
    && b.emp.status === "Active",
  );
}

// ===================== G1 — SALDO & PLAFON MEDIS =====================

// ---------- MR1.1 Employee Medical Benefit Limit Balance ----------
function mr11Balance(ctx: Ctx): { periodLabel: string; payload: MR11Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const base = scopedBalances(ctx, year).slice()
    .sort((a, b) => ctx.sortByNo(a.emp, b.emp) || a.type.sortOrder - b.type.sortOrder);
  const rows: MR11Data["rows"] = [];
  const byTypeMap = new Map<string, { type: CtxType; count: number; plafon: number; used: number; remaining: number }>();
  const empSet = new Set<string>();
  let sumP = 0, sumU = 0, sumR = 0;
  for (const b of base) {
    const plafon = round2(b.benefit + b.adjustment + b.carriedOver);
    const used = round2(b.used + b.initialUsed);
    const remaining = round2(plafon - used);
    rows.push({
      employeeNo: b.emp.employeeNo, name: b.emp.fullName, unit: b.emp.unitName,
      employmentStatus: b.emp.employmentStatus, typeCode: b.type.code, typeName: b.type.name,
      dependent: false, plafon: g(plafon), used: g(used), remaining: g(remaining),
      usedPct: canSee && plafon > 0 ? round2((used / plafon) * 100) : null,
      status: balStatus(plafon, remaining),
    });
    const agg = byTypeMap.get(b.type.id) ?? { type: b.type, count: 0, plafon: 0, used: 0, remaining: 0 };
    agg.count += 1; agg.plafon += plafon; agg.used += used; agg.remaining += remaining;
    byTypeMap.set(b.type.id, agg);
    empSet.add(b.emp.id);
    sumP += plafon; sumU += used; sumR += remaining;
    // Baris pool TANGGUNGAN hanya bila jenis punya pool dependent terpisah
    // (EACH/TOTAL_SEPARATE) dan plafonnya > 0.
    if (depPoolSeparate(b.type) && b.depBenefit + b.depAdjustment > 0) {
      const dPlafon = round2(b.depBenefit + b.depAdjustment);
      const dUsed = round2(b.depUsed);
      const dRemaining = round2(dPlafon - dUsed);
      rows.push({
        employeeNo: b.emp.employeeNo, name: b.emp.fullName, unit: b.emp.unitName,
        employmentStatus: b.emp.employmentStatus, typeCode: b.type.code, typeName: b.type.name,
        dependent: true, plafon: g(dPlafon), used: g(dUsed), remaining: g(dRemaining),
        usedPct: canSee && dPlafon > 0 ? round2((dUsed / dPlafon) * 100) : null,
        status: balStatus(dPlafon, dRemaining),
      });
      sumP += dPlafon; sumU += dUsed; sumR += dRemaining;
    }
  }
  const byType = [...byTypeMap.values()]
    .sort((a, b) => a.type.sortOrder - b.type.sortOrder)
    .map((a) => ({
      typeCode: a.type.code, typeName: a.type.name, count: a.count,
      plafon: g(round2(a.plafon)), used: g(round2(a.used)), remaining: g(round2(a.remaining)),
    }));
  const typeChip = ctx.fp.benefitType ? ` — ${ctx.typeById.get(ctx.fp.benefitType)?.code ?? ""}` : "";
  return {
    periodLabel: `Tahun Buku ${year}${typeChip} · saldo per ${dateID(ctx.now)}`,
    payload: {
      year, masked: !canSee, rows, byType,
      total: rows.length,
      employees: empSet.size,
      sum: { plafon: g(round2(sumP)), used: g(round2(sumU)), remaining: g(round2(sumR)) },
    },
  };
}

// ---------- MR1.2 Top Medical Limit Utilizers Alert (< 20% sisa) ----------
function mr12Utilizers(ctx: Ctx): { periodLabel: string; payload: MR12Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  // Basis = pool utama mr11, HANYA plafon > 0.
  const base = scopedBalances(ctx, year)
    .map((b) => {
      const plafon = round2(b.benefit + b.adjustment + b.carriedOver);
      const used = round2(b.used + b.initialUsed);
      const remaining = round2(plafon - used);
      return { b, plafon, used, remaining, remainingPct: round2((remaining / plafon) * 100) };
    })
    .filter((r) => r.plafon > 0);
  // jumlah klaim karyawan×jenis tahun tsb (semua state kecuali Cancelled).
  const claimCount = new Map<string, number>();
  for (const c of ctx.claims) {
    if (c.year === year && c.state !== "Cancelled") {
      const k = `${c.emp.id}|${c.type.id}`;
      claimCount.set(k, (claimCount.get(k) ?? 0) + 1);
    }
  }
  const items = base
    .filter((r) => r.remainingPct < 20)
    .map((r) => ({
      employeeNo: r.b.emp.employeeNo, name: r.b.emp.fullName, unit: r.b.emp.unitName,
      typeCode: r.b.type.code, typeName: r.b.type.name,
      plafon: canSee ? r.plafon : null, used: canSee ? r.used : null, remaining: canSee ? r.remaining : null,
      remainingPct: r.remainingPct,
      claimCount: claimCount.get(`${r.b.emp.id}|${r.b.type.id}`) ?? 0,
      urgency: (r.remaining <= 0 ? "exhausted" : r.remainingPct < 5 ? "critical" : r.remainingPct < 10 ? "warning" : "caution") as MR12Data["items"][number]["urgency"],
    }))
    .sort((a, b) => a.remainingPct - b.remainingPct || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  const rawRemaining = base.filter((r) => r.remainingPct < 20).reduce((s, r) => s + r.remaining, 0);
  const levels = [
    { urgency: "exhausted", label: URGENCY_LABELS.exhausted },
    { urgency: "critical", label: URGENCY_LABELS.critical },
    { urgency: "warning", label: URGENCY_LABELS.warning },
    { urgency: "caution", label: URGENCY_LABELS.caution },
  ];
  return {
    periodLabel: `Tahun Buku ${year} — sisa plafon < 20% · per ${dateID(ctx.now)}`,
    payload: {
      year, items, total: items.length,
      counts: levels.map((l) => ({ ...l, count: items.filter((i) => i.urgency === l.urgency).length })),
      exhausted: items.filter((i) => i.urgency === "exhausted").length,
      totalRemaining: canSee ? round2(rawRemaining) : null,
    },
  };
}

// ---------- MR1.3 Medical Benefit Liability ----------
function mr13Liability(ctx: Ctx): { periodLabel: string; payload: MR13Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const base = scopedBalances(ctx, year);
  const byTypeMap = new Map<string, { type: CtxType; employees: Set<string>; plafon: number; used: number; remaining: number }>();
  const byUnitMap = new Map<string, { employees: Set<string>; remaining: number; liability: number }>();
  for (const b of base) {
    const plafon = round2(b.benefit + b.adjustment + b.carriedOver);
    const used = round2(b.used + b.initialUsed);
    const remaining = round2(plafon - used);
    const agg = byTypeMap.get(b.type.id) ?? { type: b.type, employees: new Set<string>(), plafon: 0, used: 0, remaining: 0 };
    agg.employees.add(b.emp.id); agg.plafon += plafon; agg.used += used; agg.remaining += remaining;
    byTypeMap.set(b.type.id, agg);
    const div = ctx.divNameOf(b.emp.orgUnitId);
    const uAgg = byUnitMap.get(div) ?? { employees: new Set<string>(), remaining: 0, liability: 0 };
    uAgg.employees.add(b.emp.id); uAgg.remaining += remaining;
    uAgg.liability += round2((remaining * b.type.pctCompany) / 100);
    byUnitMap.set(div, uAgg);
  }
  const byType = [...byTypeMap.values()]
    .sort((a, b) => a.type.sortOrder - b.type.sortOrder)
    .map((a) => ({
      typeCode: a.type.code, typeName: a.type.name, pctCompany: a.type.pctCompany,
      employees: a.employees.size,
      plafon: g(round2(a.plafon)), used: g(round2(a.used)), remaining: g(round2(a.remaining)),
      liability: g(round2((a.remaining * a.type.pctCompany) / 100)),
    }));
  const byUnit = [...byUnitMap.entries()]
    .map(([unit, u]) => ({ unit, employees: u.employees.size, remaining: g(round2(u.remaining)), liability: g(round2(u.liability)) }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
  return {
    periodLabel: `Tahun Buku ${year} — liabilitas = sisa plafon × porsi perusahaan`,
    payload: {
      year, masked: !canSee, byType, byUnit,
      headcount: ctx.active.length,
      totalRemaining: g(round2(byTypeMap.size ? [...byTypeMap.values()].reduce((s, a) => s + a.remaining, 0) : 0)),
      totalLiability: g(round2(byTypeMap.size ? [...byTypeMap.values()].reduce((s, a) => s + round2((a.remaining * a.type.pctCompany) / 100), 0) : 0)),
    },
  };
}

// ===================== G2 — TRANSAKSI & REKAPITULASI KLAIM =====================

// ---------- MR2.1 Detailed Medical Reimbursement Register ----------
function mr21Register(ctx: Ctx): { periodLabel: string; payload: MR21Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) =>
    (!ctx.fp.benefitType || c.type.id === ctx.fp.benefitType)
    && (!ctx.fp.status || c.state === ctx.fp.status)
    && c.claimDate >= from && c.claimDate <= to);
  const items: MR21Data["items"] = [];
  const stateCounts = new Map<string, number>();
  const docSet = new Set<string>();
  let sumBill = 0, sumAppr = 0;
  for (const c of claims) {
    if (!c.lines.length) continue;
    docSet.add(c.docNo);
    stateCounts.set(c.state, (stateCounts.get(c.state) ?? 0) + 1);
    for (const l of c.lines) {
      items.push({
        docNo: c.docNo, employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: c.emp.unitName,
        typeName: c.type.name, claimDate: iso(c.claimDate) ?? "", state: c.state,
        receiptDate: iso(l.treatmentDate), patient: l.treatedName, dependent: c.forDependent,
        treatment: l.treatment, physician: l.physician, hospital: l.hospital,
        bill: canSee ? l.bill : null, approved: canSee ? l.approved : null,
      });
      sumBill += l.bill; sumAppr += l.approved;
    }
  }
  const byState = STATE_ORDER
    .map((st) => ({ state: st, label: STATUS_LABELS[st] ?? st, count: stateCounts.get(st) ?? 0 }))
    .filter((s) => s.count > 0);
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      total: items.length,
      claims: docSet.size,
      uniqueEmployees: new Set(items.map((i) => i.employeeNo)).size,
      sum: { bill: canSee ? round2(sumBill) : null, approved: canSee ? round2(sumAppr) : null },
      byState,
    },
  };
}

// ---------- MR2.2 Pending Claims & Verification Pipeline ----------
function mr22Pipeline(ctx: Ctx): { periodLabel: string; payload: MR22Data } {
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) =>
    (c.state === "Draft" || c.state === "Submitted" || c.state === "Approved")
    && (!ctx.fp.benefitType || c.type.id === ctx.fp.benefitType));
  const items = claims
    .map((c) => {
      const waitingDays = Math.max(0, Math.floor((ctx.now.getTime() - c.claimDate.getTime()) / DAY_MS));
      const needReceipt = c.type.needReceipt;
      const receiptComplete = c.lines.length > 0 && c.lines.every((l) => !!l.receiptNo);
      const needLetter = c.type.needLetter;
      const letterComplete = !!c.letterNo;
      return {
        docNo: c.docNo, employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: c.emp.unitName,
        typeName: c.type.name, claimDate: iso(c.claimDate) ?? "", state: c.state,
        waitingDays,
        sla: (waitingDays > 5 ? "overdue" : waitingDays >= 3 ? "due-soon" : "on-track") as MR22Data["items"][number]["sla"],
        needReceipt, receiptComplete, needLetter, letterComplete,
        readyToVerify: (!needReceipt || receiptComplete) && (!needLetter || letterComplete),
        bill: canSee ? c.totalBill : null,
        approved: c.state === "Approved" && canSee ? c.totalApproved : null,
      };
    })
    .sort((a, b) => b.waitingDays - a.waitingDays || a.docNo.localeCompare(b.docNo));
  const stateLabels: Record<string, string> = {
    Draft: "Draft", Submitted: "Menunggu Verifikasi", Approved: "Disetujui (belum settle)",
  };
  let sumBill = 0, sumAppr = 0;
  for (const c of claims) {
    sumBill += c.totalBill;
    if (c.state === "Approved") sumAppr += c.totalApproved;
  }
  return {
    periodLabel: `Antrean verifikasi per ${dateID(ctx.now)} — SLA 3 hari kerja`,
    payload: {
      items, total: items.length,
      counts: ["Draft", "Submitted", "Approved"].map((st) => ({ state: st, label: stateLabels[st], count: items.filter((i) => i.state === st).length })),
      oldestWaiting: items.length ? Math.max(...items.map((i) => i.waitingDays)) : 0,
      docsMissing: items.filter((i) => (i.needReceipt && !i.receiptComplete) || (i.needLetter && !i.letterComplete)).length,
      sum: { bill: canSee ? round2(sumBill) : null, approved: canSee ? round2(sumAppr) : null },
    },
  };
}

// ---------- MR2.3 Family Dependent Claim Summary ----------
function mr23Dependents(ctx: Ctx): { periodLabel: string; payload: MR23Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) => c.forDependent && c.claimDate >= from && c.claimDate <= to);
  const relationOf = (empId: string, patient: string): string => {
    const fam = ctx.familyByEmp.get(empId) ?? [];
    const hit = fam.find((f) => f.name.trim().toLowerCase() === patient.trim().toLowerCase());
    return (hit && RELATION_LABELS[hit.relation]) || "Tanggungan";
  };
  const items: MR23Data["items"] = [];
  for (const c of claims) {
    for (const l of c.lines) {
      items.push({
        docNo: c.docNo, employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: c.emp.unitName,
        patient: l.treatedName, relation: relationOf(c.emp.id, l.treatedName),
        claimDate: iso(c.claimDate) ?? "", typeName: c.type.name,
        treatment: l.treatment, physician: l.physician, hospital: l.hospital,
        bill: canSee ? l.bill : null, approved: canSee ? l.approved : null,
      });
    }
  }
  const byEmpMap = new Map<string, { employeeNo: string; name: string; unit: string | null; docs: Set<string>; bill: number; approved: number }>();
  for (const c of claims) {
    for (const l of c.lines) {
      const agg = byEmpMap.get(c.emp.id) ?? { employeeNo: c.emp.employeeNo, name: c.emp.fullName, unit: c.emp.unitName, docs: new Set<string>(), bill: 0, approved: 0 };
      agg.docs.add(c.docNo); agg.bill += l.bill; agg.approved += l.approved;
      byEmpMap.set(c.emp.id, agg);
    }
  }
  const byEmployee = [...byEmpMap.values()]
    .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }))
    .map((a) => ({
      employeeNo: a.employeeNo, name: a.name, unit: a.unit, claims: a.docs.size,
      bill: canSee ? round2(a.bill) : null, approved: canSee ? round2(a.approved) : null,
    }));
  let sumBill = 0, sumAppr = 0;
  for (const c of claims) for (const l of c.lines) { sumBill += l.bill; sumAppr += l.approved; }
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      byEmployee,
      total: items.length,
      employees: byEmpMap.size,
      sum: { bill: canSee ? round2(sumBill) : null, approved: canSee ? round2(sumAppr) : null },
    },
  };
}

// ===================== G3 — ANALISIS BIAYA & UTILISASI =====================

// ---------- MR3.1 Medical Claim Distribution by Type ----------
function mr31ByType(ctx: Ctx): { periodLabel: string; payload: MR31Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) => c.year === year && c.state !== "Cancelled");
  const moneyOf = (c: CtxClaim) => c.state === "Approved" || c.state === "Settled";
  const moneyClaims = claims.filter(moneyOf);
  const totalApprovedAll = moneyClaims.reduce((s, c) => s + c.totalApproved, 0);
  const typeAgg = new Map<string, { type: CtxType; claims: CtxClaim[]; money: CtxClaim[] }>();
  for (const c of claims) {
    const agg = typeAgg.get(c.type.id) ?? { type: c.type, claims: [], money: [] };
    agg.claims.push(c);
    if (moneyOf(c)) agg.money.push(c);
    typeAgg.set(c.type.id, agg);
  }
  const rows = [...typeAgg.values()]
    .map((a) => {
      const bill = round2(a.money.reduce((s, c) => s + c.totalBill, 0));
      const approved = round2(a.money.reduce((s, c) => s + c.totalApproved, 0));
      return {
        typeCode: a.type.code, typeName: a.type.name,
        claimCount: a.claims.length, settledCount: a.claims.filter((c) => c.state === "Settled").length,
        bill: canSee ? bill : null, approved: canSee ? approved : null,
        companyPart: canSee ? round2((approved * a.type.pctCompany) / 100) : null,
        insurancePart: canSee ? round2((approved * a.type.pctInsurance) / 100) : null,
        sharePct: canSee && totalApprovedAll > 0 ? round2((approved / totalApprovedAll) * 100) : null,
        avgPerClaim: canSee && a.money.length > 0 ? round2(approved / a.money.length) : null,
        rawApproved: approved,
      };
    })
    .sort((a, b) => b.rawApproved - a.rawApproved || a.typeCode.localeCompare(b.typeCode))
    .map(({ rawApproved: _raw, ...r }) => r);
  const monthly = MONTHS_ID.map((m, i) => {
    const cc = claims.filter((c) => c.claimDate.getMonth() === i);
    const mc = moneyClaims.filter((c) => c.claimDate.getMonth() === i);
    return {
      month: m.slice(0, 3), claims: cc.length,
      bill: canSee ? round2(mc.reduce((s, c) => s + c.totalBill, 0)) : null,
      approved: canSee ? round2(mc.reduce((s, c) => s + c.totalApproved, 0)) : null,
    };
  });
  const tBill = round2(moneyClaims.reduce((s, c) => s + c.totalBill, 0));
  const tApproved = round2(totalApprovedAll);
  let tCompany = 0, tInsurance = 0;
  for (const a of typeAgg.values()) {
    const approved = a.money.reduce((s, c) => s + c.totalApproved, 0);
    tCompany += round2((approved * a.type.pctCompany) / 100);
    tInsurance += round2((approved * a.type.pctInsurance) / 100);
  }
  return {
    periodLabel: `Tahun Buku ${year}`,
    payload: {
      year, masked: !canSee, rows, monthly,
      total: {
        claimCount: claims.length,
        bill: canSee ? tBill : null, approved: canSee ? tApproved : null,
        companyPart: canSee ? round2(tCompany) : null, insurancePart: canSee ? round2(tInsurance) : null,
      },
    },
  };
}

// ---------- MR3.2 Absenteeism Due to Medical Reasons ----------
function mr32Absenteeism(ctx: Ctx): { periodLabel: string; payload: MR32Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) => c.year === year && (c.state === "Approved" || c.state === "Settled"));
  const divisions = [...new Set(ctx.active.map((e) => ctx.divNameOf(e.orgUnitId)))].sort();
  const rows = divisions.map((division) => {
    const divEmps = ctx.active.filter((e) => ctx.divNameOf(e.orgUnitId) === division);
    const ids = new Set(divEmps.map((e) => e.id));
    const dc = claims.filter((c) => ids.has(c.emp.id));
    const inpatient = dc.filter((c) => c.type.code === "RAWAT_INAP");
    const approved = round2(dc.reduce((s, c) => s + c.totalApproved, 0));
    const sick = ctx.sickLeaves.filter((s) => ids.has(s.empId) && s.dateFrom.getFullYear() === year);
    const sickLeaveDays = round1(sick.reduce((s, r) => s + r.workingDays, 0));
    // estimasi hari rawat inap: 1 baris perawatan ≈ 1 hari perawatan.
    const inpatientDays = inpatient.reduce((s, c) => s + c.lines.length, 0);
    const lostWorkdays = round1(sickLeaveDays + inpatientDays);
    return {
      division, headcount: divEmps.length,
      claimCount: dc.length, inpatientClaims: inpatient.length, outpatientClaims: dc.length - inpatient.length,
      approved: canSee ? approved : null,
      sickLeaveDays, lostWorkdays,
      costPerLostDay: canSee && lostWorkdays > 0 ? round2(approved / lostWorkdays) : null,
      rawApproved: approved,
    };
  });
  const totApproved = round2(claims.reduce((s, c) => s + c.totalApproved, 0));
  const tSick = round1(rows.reduce((s, r) => s + r.sickLeaveDays, 0));
  const tLost = round1(rows.reduce((s, r) => s + r.lostWorkdays, 0));
  return {
    periodLabel: `Tahun Buku ${year} — cuti sakit (CT-SAKIT) + estimasi hari rawat inap`,
    payload: {
      year, masked: !canSee,
      rows: rows.map(({ rawApproved: _raw, ...r }) => r),
      total: {
        headcount: ctx.active.length,
        claimCount: rows.reduce((s, r) => s + r.claimCount, 0),
        inpatientClaims: rows.reduce((s, r) => s + r.inpatientClaims, 0),
        outpatientClaims: rows.reduce((s, r) => s + r.outpatientClaims, 0),
        approved: canSee ? totApproved : null,
        sickLeaveDays: tSick, lostWorkdays: tLost,
        costPerLostDay: canSee && tLost > 0 ? round2(totApproved / tLost) : null,
      },
    },
  };
}

// ---------- MR3.3 High-Frequency Diagnosis Log (ANONIM) ----------
function mr33Diagnosis(ctx: Ctx): { periodLabel: string; payload: MR33Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const claims = ctx.claims.filter((c) =>
    (c.state === "Submitted" || c.state === "Approved" || c.state === "Settled")
    && c.claimDate >= from && c.claimDate <= to);
  interface Grp {
    diagnosis: string; docNos: Set<string>; patients: Set<string>;
    bill: number; approved: number; inpatient: boolean; first: Date | null; last: Date | null;
  }
  const groups = new Map<string, Grp>();
  for (const c of claims) {
    for (const l of c.lines) {
      const diag = (l.treatment ?? "").trim();
      if (!diag) continue;
      const g = groups.get(diag) ?? { diagnosis: diag, docNos: new Set<string>(), patients: new Set<string>(), bill: 0, approved: 0, inpatient: false, first: null, last: null };
      g.docNos.add(c.docNo);
      g.patients.add(l.treatedName);
      g.bill += l.bill; g.approved += l.approved;
      if (c.type.code === "RAWAT_INAP") g.inpatient = true;
      if (l.treatmentDate) {
        const td = new Date(l.treatmentDate);
        if (!g.first || td < g.first) g.first = td;
        if (!g.last || td > g.last) g.last = td;
      }
      groups.set(diag, g);
    }
  }
  const totalApproved = [...groups.values()].reduce((s, g) => s + g.approved, 0);
  const all = [...groups.values()].sort((a, b) => b.docNos.size - a.docNos.size || b.approved - a.approved);
  const items = all.slice(0, 50).map((g) => ({
    diagnosis: g.diagnosis, claims: g.docNos.size, patients: g.patients.size,
    bill: canSee ? round2(g.bill) : null, approved: canSee ? round2(g.approved) : null,
    sharePct: canSee && totalApproved > 0 ? round2((g.approved / totalApproved) * 100) : null,
    inpatient: g.inpatient, firstSeen: iso(g.first), lastSeen: iso(g.last),
  }));
  const claimsTotal = new Set(all.flatMap((g) => [...g.docNos])).size;
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)} — data pasien dianonimkan`,
    payload: {
      items,
      total: groups.size,
      claimsTotal,
      sum: {
        bill: canSee ? round2(all.reduce((s, g) => s + g.bill, 0)) : null,
        approved: canSee ? round2(totalApproved) : null,
      },
      privacyNote: "Identitas pasien dianonimkan (hanya agregat jumlah) sesuai kerahasiaan data kesehatan — dasar program wellness tanpa membuka riwayat medis individu.",
    },
  };
}

// ===================== G4 — REKONSILIASI ASURANSI & KEPATUHAN =====================

// ---------- MR4.1 Insurance Premium vs Utilization Reconciliation ----------
function mr41Insurance(ctx: Ctx): { periodLabel: string; payload: MR41Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const settled = ctx.claims.filter((c) => c.year === year && c.state === "Settled" && c.type.pctInsurance > 0);
  // ---- per penanggung ----
  const byIns = new Map<string, { insurer: string; claims: number; approved: number; insurancePart: number; recovered: number; outstanding: number; writtenOff: number }>();
  for (const c of settled) {
    const key = c.type.insuranceCompany ?? "Asuransi (Tanpa Nama)";
    const agg = byIns.get(key) ?? { insurer: key, claims: 0, approved: 0, insurancePart: 0, recovered: 0, outstanding: 0, writtenOff: 0 };
    agg.claims += 1;
    agg.approved += c.totalApproved;
    agg.insurancePart += c.insAmount;
    agg.recovered += c.insPaidAmount;
    if (c.insState === "NONE" || c.insState === "SUBMITTED") {
      agg.outstanding += Math.max(0, c.insAmount - c.insPaidAmount);
    }
    if (c.insState === "WRITTEN_OFF") agg.writtenOff += c.insAmount;
    byIns.set(key, agg);
  }
  const byInsurer = [...byIns.values()]
    .sort((a, b) => b.insurancePart - a.insurancePart || a.insurer.localeCompare(b.insurer))
    .map((a) => ({
      insurer: a.insurer, claims: a.claims,
      approved: g(round2(a.approved)), insurancePart: g(round2(a.insurancePart)),
      recovered: g(round2(a.recovered)), outstanding: g(round2(a.outstanding)),
      writtenOff: g(round2(a.writtenOff)),
      recoveryRate: canSee && a.insurancePart > 0 ? round2((a.recovered / a.insurancePart) * 100) : null,
    }));
  // ---- tren bulanan per tanggal settle ----
  const monthly = MONTHS_ID.map((m, i) => {
    const mc = settled.filter((c) => c.settleDate && c.settleDate.getMonth() === i);
    return {
      month: m.slice(0, 3), claims: mc.length,
      approved: g(round2(mc.reduce((s, c) => s + c.totalApproved, 0))),
      companyPart: g(round2(mc.reduce((s, c) => s + round2((c.totalApproved * c.type.pctCompany) / 100), 0))),
      insurancePart: g(round2(mc.reduce((s, c) => s + c.insAmount, 0))),
    };
  });
  // ---- rincian klaim piutang (bentuk listInsuranceReceivables, inline) ----
  const claims = settled
    .map((c) => {
      const anchor = c.insSubmittedAt ?? c.settleDate ?? c.claimDate;
      const ageDays = Math.max(0, Math.floor((ctx.now.getTime() - dayStart(anchor).getTime()) / DAY_MS));
      const closed = c.insState === "PAID" || c.insState === "WRITTEN_OFF";
      const outstanding = closed ? 0 : round2(Math.max(0, c.insAmount - c.insPaidAmount));
      return {
        docNo: c.docNo, employeeNo: c.emp.employeeNo, name: c.emp.fullName,
        typeName: c.type.name, insurer: c.type.insuranceCompany ?? "Asuransi (Tanpa Nama)",
        settleDate: iso(c.settleDate), insState: c.insState,
        insAmount: g(c.insAmount), insPaidAmount: g(c.insPaidAmount),
        outstanding: g(outstanding), ageDays,
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.docNo.localeCompare(b.docNo));
  let sApproved = 0, sIns = 0, sPaid = 0, sOut = 0, sWo = 0;
  for (const c of settled) {
    sApproved += c.totalApproved;
    sIns += c.insAmount;
    sPaid += c.insPaidAmount;
    if (c.insState === "NONE" || c.insState === "SUBMITTED") sOut += Math.max(0, c.insAmount - c.insPaidAmount);
    if (c.insState === "WRITTEN_OFF") sWo += c.insAmount;
  }
  return {
    periodLabel: `Tahun Buku ${year} — klaim settled dengan bagian asuransi`,
    payload: {
      year, masked: !canSee, byInsurer, monthly, claims,
      sum: {
        approved: g(round2(sApproved)), insurancePart: g(round2(sIns)),
        recovered: g(round2(sPaid)), outstanding: g(round2(sOut)), writtenOff: g(round2(sWo)),
      },
      unsubmitted: settled.filter((c) => c.insState === "NONE").length,
      waitingPayment: settled.filter((c) => c.insState === "SUBMITTED").length,
    },
  };
}

// ---------- MR4.2 Insurance Enrollment & De-enrollment Log ----------
function mr42Enrollment(ctx: Ctx): { periodLabel: string; payload: MR42Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const canSee = ctx.mv.canSee;
  const balByEmp = new Map<string, CtxBal[]>();
  for (const b of ctx.balances) {
    if (b.year !== year) continue;
    const arr = balByEmp.get(b.emp.id) ?? [];
    arr.push(b);
    balByEmp.set(b.emp.id, arr);
  }
  const enroll = ctx.scoped
    .filter((e) => e.status === "Active" && e.joinDate.getFullYear() === year)
    .map((e) => ({
      employeeNo: e.employeeNo, name: e.fullName, unit: e.unitName,
      gender: e.gender === "F" ? "Perempuan" : "Laki-laki",
      joinDate: iso(e.joinDate) ?? "", employmentStatus: e.employmentStatus,
      balanceGenerated: (balByEmp.get(e.id) ?? []).length > 0,
      delayedDays: Math.max(0, Math.floor((ctx.now.getTime() - e.joinDate.getTime()) / DAY_MS)),
      action: "Daftarkan ke asuransi (karyawan baru)",
    }))
    .sort((a, b) => a.joinDate.localeCompare(b.joinDate) || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  const deenroll = ctx.scoped
    .filter((e) => e.status === "Resigned" || e.status === "Terminated")
    .map((e) => {
      const claimsThisYear = ctx.claims.filter((c) => c.emp.id === e.id && c.year === year).length;
      const remaining = (balByEmp.get(e.id) ?? [])
        .reduce((s, b) => s + (b.benefit + b.adjustment + b.carriedOver - b.used - b.initialUsed), 0);
      return {
        employeeNo: e.employeeNo, name: e.fullName, unit: e.unitName,
        joinDate: iso(e.joinDate) ?? "", endDate: iso(e.endDate), status: e.status,
        claimsThisYear,
        balanceRemaining: canSee ? round2(remaining) : null,
        action: "Nonaktifkan dari asuransi (hindari premi ganda)",
      };
    })
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? "") || a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true }));
  return {
    periodLabel: `Tahun Buku ${year}`,
    payload: {
      year, enroll, deenroll,
      counts: { enroll: enroll.length, deenroll: deenroll.length },
      activeEnrolled: ctx.active.filter((e) => (balByEmp.get(e.id) ?? []).length > 0).length,
    },
  };
}

// ---------- MR4.3 Coordination of Benefits (CoB) Audit ----------
function mr43Cob(ctx: Ctx): { periodLabel: string; payload: MR43Data } {
  const from = ctx.fromD ?? new Date(ctx.now.getFullYear(), 0, 1);
  const to = ctx.toD ?? ctx.now;
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const claims = ctx.claims
    .filter((c) =>
      (c.state === "Approved" || c.state === "Settled")
      && (!ctx.fp.benefitType || c.type.id === ctx.fp.benefitType)
      && c.claimDate >= from && c.claimDate <= to)
    .slice()
    .sort((a, b) => a.claimDate.getTime() - b.claimDate.getTime() || a.docNo.localeCompare(b.docNo));
  const items = claims.map((c) => ({
    docNo: c.docNo, employeeNo: c.emp.employeeNo, name: c.emp.fullName, typeName: c.type.name,
    claimDate: iso(c.claimDate) ?? "",
    patient: c.lines.length ? c.lines[0].treatedName : c.emp.fullName,
    dependent: c.forDependent,
    bill: g(c.totalBill),
    firstPayer: g(c.totalNonRe), // non-reimbursement — ditanggung penjamin pertama (BPJS/pihak lain)
    reimburse: g(c.totalReimburse),
    approved: g(c.totalApproved),
    insurancePart: g(c.type.pctInsurance > 0 ? round2((c.totalApproved * c.type.pctInsurance) / 100) : 0),
    journalNo: c.journalNo,
  }));
  let sBill = 0, sNonRe = 0, sReimb = 0, sAppr = 0, sIns = 0;
  for (const c of claims) {
    sBill += c.totalBill; sNonRe += c.totalNonRe; sReimb += c.totalReimburse; sAppr += c.totalApproved;
    sIns += c.type.pctInsurance > 0 ? round2((c.totalApproved * c.type.pctInsurance) / 100) : 0;
  }
  return {
    periodLabel: `${dateID(from)} – ${dateID(to)}`,
    payload: {
      items,
      total: items.length,
      sum: {
        bill: g(round2(sBill)), firstPayer: g(round2(sNonRe)), reimburse: g(round2(sReimb)),
        approved: g(round2(sAppr)), insurancePart: g(round2(sIns)),
      },
      withFirstPayer: claims.filter((c) => c.totalNonRe > 0).length,
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

function buildSheets(id: string, built: { periodLabel: string; payload: unknown }, periodLabel: string): ExportSheet[] {
  const p = built.payload as AnyRec;
  const title = `${REPORT_TITLES[id]}${periodLabel ? ` — ${periodLabel}` : ""}`;
  switch (id) {
    case "mr11": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Saldo Plafon",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Status Pekerja", width: 14 }, { header: "Jenis Benefit", width: 24 },
          { header: "Pool", width: 12 }, { header: "Plafon (Rp)", width: 16 }, { header: "Terpakai (Rp)", width: 16 },
          { header: "Sisa (Rp)", width: 16 }, { header: "Terpakai %", width: 11 }, { header: "Status", width: 12 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.employeeNo), s(r.name), s(r.unit), s(r.employmentStatus), s(`${r.typeCode} — ${r.typeName}`),
            r.dependent ? "Tanggungan" : "Karyawan", rp(r.plafon), rp(r.used), rp(r.remaining),
            r.usedPct == null ? "" : r.usedPct as number, BAL_STATUS_LABELS[r.status as string] ?? s(r.status),
          ]),
          ["TOTAL", "", "", "", "", "", rp(sum.plafon), rp(sum.used), rp(sum.remaining), "", ""],
        ],
      }];
    }
    case "mr12": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Utilizer Kritis",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Jenis Benefit", width: 24 }, { header: "Plafon (Rp)", width: 16 }, { header: "Terpakai (Rp)", width: 16 },
          { header: "Sisa (Rp)", width: 16 }, { header: "Sisa %", width: 10 }, { header: "Jumlah Klaim", width: 11 },
          { header: "Urgensi", width: 18 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.employeeNo), s(i.name), s(i.unit), s(`${i.typeCode} — ${i.typeName}`),
            rp(i.plafon), rp(i.used), rp(i.remaining), (i.remainingPct as number) ?? 0,
            (i.claimCount as number) ?? 0, URGENCY_LABELS[i.urgency as string] ?? s(i.urgency),
          ])),
          ["TOTAL", "", "", "", "", "", rp(p.totalRemaining), "", "", ""],
        ],
      }];
    }
    case "mr13": {
      const byType = (p.byType as AnyRec[]) ?? [];
      const byUnit = (p.byUnit as AnyRec[]) ?? [];
      return [
        {
          name: "Liabilitas per Jenis",
          title,
          columns: [
            { header: "Jenis Benefit", width: 26 }, { header: "% Perusahaan", width: 12 },
            { header: "Karyawan", width: 10 }, { header: "Plafon (Rp)", width: 16 },
            { header: "Terpakai (Rp)", width: 16 }, { header: "Sisa (Rp)", width: 16 }, { header: "Liabilitas (Rp)", width: 18 },
          ],
          rows: [
            ...byType.map((r) => [s(`${r.typeCode} — ${r.typeName}`), (r.pctCompany as number) ?? 0, (r.employees as number) ?? 0, rp(r.plafon), rp(r.used), rp(r.remaining), rp(r.liability)]),
            ["TOTAL", "", "", "", "", rp(p.totalRemaining), rp(p.totalLiability)],
          ],
        },
        {
          name: "Liabilitas per Unit",
          title,
          columns: [
            { header: "Divisi / Unit", width: 26 }, { header: "Karyawan", width: 10 },
            { header: "Sisa (Rp)", width: 16 }, { header: "Liabilitas (Rp)", width: 18 },
          ],
          rows: [
            ...byUnit.map((r) => [s(r.unit), (r.employees as number) ?? 0, rp(r.remaining), rp(r.liability)]),
            ["TOTAL", "", rp(p.totalRemaining), rp(p.totalLiability)],
          ],
        },
      ];
    }
    case "mr21": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Register Klaim",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Jenis Benefit", width: 22 }, { header: "Tgl Klaim", width: 12 },
          { header: "Tgl Perawatan", width: 13 }, { header: "Pasien", width: 24 }, { header: "Pool", width: 12 },
          { header: "Perawatan", width: 28 }, { header: "Dokter", width: 20 }, { header: "Rumah Sakit", width: 24 },
          { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 }, { header: "Status", width: 16 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.typeName), d(i.claimDate as string),
            d(i.receiptDate as string), s(i.patient), i.dependent ? "Tanggungan" : "Karyawan",
            s(i.treatment), s(i.physician), s(i.hospital), rp(i.bill), rp(i.approved),
            STATUS_LABELS[i.state as string] ?? s(i.state),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", rp(sum.bill), rp(sum.approved), ""],
        ],
      }];
    }
    case "mr22": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Pipeline Verifikasi",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Jenis Benefit", width: 22 }, { header: "Tgl Klaim", width: 12 },
          { header: "Status", width: 18 }, { header: "Menunggu (hari)", width: 13 }, { header: "SLA", width: 14 },
          { header: "Kwitansi", width: 12 }, { header: "Surat Rujukan", width: 14 }, { header: "Siap Verifikasi", width: 13 },
          { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.typeName), d(i.claimDate as string),
            STATUS_LABELS[i.state as string] ?? s(i.state), (i.waitingDays as number) ?? 0,
            SLA_LABELS[i.sla as string] ?? s(i.sla),
            i.needReceipt ? (i.receiptComplete ? "Lengkap" : "Kurang") : "Tidak wajib",
            i.needLetter ? (i.letterComplete ? "Lengkap" : "Kurang") : "Tidak wajib",
            i.readyToVerify ? "Ya" : "Belum", rp(i.bill), rp(i.approved),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", "", "", rp(sum.bill), rp(sum.approved)],
        ],
      }];
    }
    case "mr23": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Klaim Tanggungan",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Pasien", width: 24 }, { header: "Hubungan", width: 12 },
          { header: "Tgl Klaim", width: 12 }, { header: "Jenis Benefit", width: 22 }, { header: "Perawatan", width: 28 },
          { header: "Dokter", width: 20 }, { header: "Rumah Sakit", width: 24 },
          { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.unit), s(i.patient), s(i.relation),
            d(i.claimDate as string), s(i.typeName), s(i.treatment), s(i.physician), s(i.hospital),
            rp(i.bill), rp(i.approved),
          ])),
          ["TOTAL", "", "", "", "", "", "", "", "", "", "", rp(sum.bill), rp(sum.approved)],
        ],
      }];
    }
    case "mr31": {
      const total = (p.total as AnyRec) ?? {};
      return [
        {
          name: "Distribusi Jenis",
          title,
          columns: [
            { header: "Jenis Benefit", width: 26 }, { header: "Klaim", width: 8 }, { header: "Settled", width: 9 },
            { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 },
            { header: "Porsi Perusahaan (Rp)", width: 18 }, { header: "Porsi Asuransi (Rp)", width: 18 },
            { header: "Rata-rata/Klaim (Rp)", width: 18 }, { header: "Porsi %", width: 10 },
          ],
          rows: [
            ...(((p.rows as AnyRec[]) ?? []).map((r) => [
              s(`${r.typeCode} — ${r.typeName}`), (r.claimCount as number) ?? 0, (r.settledCount as number) ?? 0,
              rp(r.bill), rp(r.approved), rp(r.companyPart), rp(r.insurancePart), rp(r.avgPerClaim), rp(r.sharePct),
            ])),
            ["TOTAL", (total.claimCount as number) ?? 0, "", rp(total.bill), rp(total.approved), rp(total.companyPart), rp(total.insurancePart), "", ""],
          ],
        },
        {
          name: "Tren Bulanan",
          title,
          columns: [
            { header: "Bulan", width: 12 }, { header: "Klaim", width: 8 },
            { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 },
          ],
          rows: [
            ...(((p.monthly as AnyRec[]) ?? []).map((r) => [s(r.month), (r.claims as number) ?? 0, rp(r.bill), rp(r.approved)])),
            ["TOTAL", ((p.monthly as AnyRec[]) ?? []).reduce((s2, r) => s2 + ((r.claims as number) ?? 0), 0), rp(total.bill), rp(total.approved)],
          ],
        },
      ];
    }
    case "mr32": {
      const total = (p.total as AnyRec) ?? {};
      return [{
        name: "Hari Kerja Hilang",
        title,
        columns: [
          { header: "Divisi", width: 26 }, { header: "Headcount", width: 10 }, { header: "Klaim Medis", width: 11 },
          { header: "Rawat Inap", width: 11 }, { header: "Rawat Jalan", width: 11 }, { header: "Disetujui (Rp)", width: 16 },
          { header: "Cuti Sakit (hari)", width: 14 }, { header: "Hari Kerja Hilang", width: 14 },
          { header: "Biaya per Hari (Rp)", width: 17 },
        ],
        rows: [
          ...(((p.rows as AnyRec[]) ?? []).map((r) => [
            s(r.division), (r.headcount as number) ?? 0, (r.claimCount as number) ?? 0,
            (r.inpatientClaims as number) ?? 0, (r.outpatientClaims as number) ?? 0, rp(r.approved),
            (r.sickLeaveDays as number) ?? 0, (r.lostWorkdays as number) ?? 0, rp(r.costPerLostDay),
          ])),
          ["TOTAL", (total.headcount as number) ?? 0, (total.claimCount as number) ?? 0, (total.inpatientClaims as number) ?? 0, (total.outpatientClaims as number) ?? 0, rp(total.approved), (total.sickLeaveDays as number) ?? 0, (total.lostWorkdays as number) ?? 0, rp(total.costPerLostDay)],
        ],
      }];
    }
    case "mr33": {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Statistik Diagnosis (Anonim)",
        title,
        columns: [
          { header: "Diagnosis / Perawatan", width: 34 }, { header: "Klaim", width: 8 }, { header: "Pasien", width: 8 },
          { header: "Tagihan (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 }, { header: "Porsi %", width: 10 },
          { header: "Rawat Inap", width: 11 }, { header: "Pertama Terlihat", width: 14 }, { header: "Terakhir", width: 14 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.diagnosis), (i.claims as number) ?? 0, (i.patients as number) ?? 0,
            rp(i.bill), rp(i.approved), rp(i.sharePct), i.inpatient ? "Ya" : "Bukan",
            d(i.firstSeen as string), d(i.lastSeen as string),
          ])),
          ["TOTAL", (p.claimsTotal as number) ?? 0, "", rp(sum.bill), rp(sum.approved), "", "", "", ""],
        ],
      }];
    }
    case "mr41": {
      const sum = (p.sum as AnyRec) ?? {};
      return [
        {
          name: "Rekonsiliasi Penanggung",
          title,
          columns: [
            { header: "Penanggung", width: 26 }, { header: "Klaim", width: 8 }, { header: "Disetujui (Rp)", width: 16 },
            { header: "Piutang Asuransi (Rp)", width: 19 }, { header: "Sudah Dibayar (Rp)", width: 18 },
            { header: "Belum Tertagih (Rp)", width: 18 }, { header: "Dihapus Bukti (Rp)", width: 18 }, { header: "Recovery %", width: 11 },
          ],
          rows: [
            ...(((p.byInsurer as AnyRec[]) ?? []).map((r) => [
              s(r.insurer), (r.claims as number) ?? 0, rp(r.approved), rp(r.insurancePart),
              rp(r.recovered), rp(r.outstanding), rp(r.writtenOff), rp(r.recoveryRate),
            ])),
            ["TOTAL", "", rp(sum.approved), rp(sum.insurancePart), rp(sum.recovered), rp(sum.outstanding), rp(sum.writtenOff), ""],
          ],
        },
        {
          name: "Rincian Klaim Piutang",
          title,
          columns: [
            { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
            { header: "Jenis Benefit", width: 22 }, { header: "Penanggung", width: 22 }, { header: "Tgl Settle", width: 12 },
            { header: "Status Asuransi", width: 18 }, { header: "Piutang (Rp)", width: 16 },
            { header: "Dibayar (Rp)", width: 16 }, { header: "Belum Tertagih (Rp)", width: 17 }, { header: "Umur (hari)", width: 11 },
          ],
          rows: [
            ...(((p.claims as AnyRec[]) ?? []).map((c) => [
              s(c.docNo), s(c.employeeNo), s(c.name), s(c.typeName), s(c.insurer), d(c.settleDate as string),
              INS_STATE_LABELS[c.insState as string] ?? s(c.insState), rp(c.insAmount), rp(c.insPaidAmount),
              rp(c.outstanding), (c.ageDays as number) ?? 0,
            ])),
            ["TOTAL", "", "", "", "", "", "", rp(sum.insurancePart), rp(sum.recovered), rp(sum.outstanding), ""],
          ],
        },
      ];
    }
    case "mr42": {
      const counts = (p.counts as AnyRec) ?? {};
      return [
        {
          name: "Wajib Enroll",
          title,
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
            { header: "L/P", width: 6 }, { header: "Tgl Masuk", width: 12 }, { header: "Status Pekerja", width: 14 },
            { header: "Saldo Medis", width: 12 }, { header: "Terlambat (hari)", width: 14 }, { header: "Tindakan", width: 34 },
          ],
          rows: [
            ...(((p.enroll as AnyRec[]) ?? []).map((e) => [
              s(e.employeeNo), s(e.name), s(e.unit), s(e.gender), d(e.joinDate as string), s(e.employmentStatus),
              e.balanceGenerated ? "Sudah" : "BELUM", (e.delayedDays as number) ?? 0, s(e.action),
            ])),
            ["TOTAL", `${(counts.enroll as number) ?? 0} karyawan`, "", "", "", "", "", "", ""],
          ],
        },
        {
          name: "Wajib Nonaktif",
          title,
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
            { header: "Tgl Masuk", width: 12 }, { header: "Tgl Keluar", width: 12 }, { header: "Status", width: 14 },
            { header: "Klaim Tahun Ini", width: 13 }, { header: "Sisa Saldo (Rp)", width: 16 }, { header: "Tindakan", width: 34 },
          ],
          rows: [
            ...(((p.deenroll as AnyRec[]) ?? []).map((e) => [
              s(e.employeeNo), s(e.name), s(e.unit), d(e.joinDate as string), d(e.endDate as string), s(e.status),
              (e.claimsThisYear as number) ?? 0, rp(e.balanceRemaining), s(e.action),
            ])),
            ["TOTAL", `${(counts.deenroll as number) ?? 0} karyawan`, "", "", "", "", "", "", ""],
          ],
        },
      ];
    }
    default: {
      const sum = (p.sum as AnyRec) ?? {};
      return [{
        name: "Audit CoB",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Jenis Benefit", width: 22 }, { header: "Tgl Klaim", width: 12 }, { header: "Pasien", width: 24 },
          { header: "Pool", width: 12 }, { header: "Tagihan (Rp)", width: 16 }, { header: "Penjamin Pertama (Rp)", width: 19 },
          { header: "Reimburse (Rp)", width: 16 }, { header: "Disetujui (Rp)", width: 16 },
          { header: "Bagian Asuransi (Rp)", width: 18 }, { header: "No. Jurnal", width: 16 },
        ],
        rows: [
          ...(((p.items as AnyRec[]) ?? []).map((i) => [
            s(i.docNo), s(i.employeeNo), s(i.name), s(i.typeName), d(i.claimDate as string), s(i.patient),
            i.dependent ? "Tanggungan" : "Karyawan", rp(i.bill), rp(i.firstPayer), rp(i.reimburse),
            rp(i.approved), rp(i.insurancePart), s(i.journalNo),
          ])),
          ["TOTAL", "", "", "", "", "", "", rp(sum.bill), rp(sum.firstPayer), rp(sum.reimburse), rp(sum.approved), rp(sum.insurancePart), ""],
        ],
      }];
    }
  }
}
