import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, locFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";

// =============================================================================
// T104 — LAPORAN DISTRIBUSI HR (print & PDF ready) ===========================
// =============================================================================
// GET /api/rekankerja/hr/reports/documents?id=<rId> — data satu laporan siap
// cetak (16 laporan / 4 grup: biodata, kontrak & tenure, pergerakan, kepatuhan
// legal Indonesia). Payload = dokumen final: header perusahaan + metadata
// (periode, tanggal cetak, pengunduh) dirakit di klien; data di sini murni
// baris tabel + ringkasan. ?export=xlsx → stream XLSX per laporan (pola
// reports.ts).
//
// Guard: requireMenuAction hr:directory view + cakupan akses efektif (semua
// query Employee di-scope scopeWhere; relasi ikut otomatis).
// Uang: agregasi internal (bucket WLKP, cek UMK) via tenantCryptoForDb (pola
// payroll engine — tidak pernah di query SQL); NILAI upah yang diserialisasi
// (R4.3) digerbang money-view (masked saat brankas terkunci → null).

const EXIT_STATUSES = new Set(["Resigned", "Terminated"]);
const MOVEMENT_REASONS = new Set(["Promotion", "Demotion", "Transfer", "Mutation"]);
const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "r11", "r12", "r13", "r14", "r15",
  "r21", "r22", "r23",
  "r31", "r32", "r33", "r34",
  "r41", "r42", "r43", "r44",
]);

const REPORT_TITLES: Record<string, string> = {
  r11: "Master Employee Report (Sensus Karyawan Lengkap)",
  r12: "Employee Demography Summary",
  r13: "Department & Position Distribution Report",
  r14: "Employment Status Report",
  r15: "Multi-branch Location Mapping Report",
  r21: "Contract Expiry Alert Report",
  r22: "Employee Tenure Summary Report",
  r23: "Probation Evaluation Schedule",
  r31: "New Hire Welcoming Report",
  r32: "Employee Termination & Exit Interview Summary",
  r33: "Employee Turnover Executive Summary",
  r34: "Promotion, Demotion & Transfer History Log",
  r41: "WLKP — Wajib Lapor Ketenagakerjaan (UU 7/1981)",
  r42: "BPJS Kesehatan & Ketenagakerjaan Reconciliation Sheet",
  r43: "Struktur dan Skala Upah (Kemnaker)",
  r44: "Employee Competency & Certification Audit Sheet",
};

// ============ T110: parameter & filter awal (sebelum laporan digenerate) =====
// Form parameter di klien mengirim kombinasi: office/unit/status (cakupan),
// urgency/category/certStatus (daftar dipisah koma), month (YYYY-MM), year,
// from/to (YYYY-MM-DD). Filter diterapkan SERVER-SIDE pada basis karyawan
// sebelum builder laporan berjalan — XLSX & cetak otomatis mengikuti.

const URGENCY_LABELS: Record<string, string> = {
  overdue: "Lewat Jatuh Tempo", critical: "Kritis (< 30 hari)", warning: "Perhatian (30–60 hari)",
  caution: "Waspada (60–90 hari)", safe: "Aman (> 90 hari)",
};

const CERT_STATUS_LABELS: Record<string, string> = {
  expired: "Kedaluwarsa", expiring: "Segera Berakhir", active: "Aktif", "no-expiry": "Tanpa Masa Berlaku",
};

interface ReportFilters {
  office: string | null;
  unit: string | null;
  status: string | null;
  urgency: string[];
  category: string[];
  certStatus: string[];
  /** YYYY-MM */
  month: string | null;
  year: number | null;
  /** YYYY-MM-DD */
  from: string | null;
  to: string | null;
}

const isYM = (v: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
const isYMD = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ============ util kecil (server-side, tanpa import klien) ============

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const monthLabel = (d: Date) => `${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;

interface CountRow { label: string; count: number }

const distBy = (vals: (string | null)[], order?: string[]): CountRow[] => {
  const map = new Map<string, number>();
  for (const v of vals) map.set(v ?? "—", (map.get(v ?? "—") ?? 0) + 1);
  let entries = [...map.entries()];
  entries = order
    ? entries.sort((a, b) => {
        const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b[1] - a[1];
      })
    : entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.map(([label, count]) => ({ label, count }));
};

// ============ baris karyawan + relasi (satu fetch utk semua laporan) ============

interface AssnRow {
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  managerId: string | null;
  employmentStatus: string;
  baseSalary: string | null;
  validFrom: Date;
  validTo: Date | null;
  changeReason: string;
  sourceDocNo: string | null;
  notes: string | null;
}

interface EmpRow {
  id: string;
  employeeNo: string;
  fullName: string;
  gender: string;
  birthDate: Date | null;
  joinDate: Date;
  endDate: Date | null;
  status: string;
  maritalStatus: string | null;
  religion: string | null;
  nationalId: string | null;
  bpjsHealth: string | null;
  bpjsEmpSkill: string | null;
  orgUnitId: string | null;
  positionId: string | null;
  gradeId: string | null;
  companyOfficeId: string | null;
  workLocationId: string | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  renewalCount: number;
  eduLevels: string[];
  documents: { docType: string; docNumber: string | null; issuedAt: Date | null; expiresAt: Date | null; notes: string | null }[];
  onboarding: { status: string; tasks: { status: string }[] } | null;
  offboarding: { lastDay: Date | null; reason: string | null; status: string; exitInterviewJson: string | null; tasks: { status: string }[] } | null;
  assignments: AssnRow[];
}

interface Enriched extends EmpRow {
  activeAssn: AssnRow | null;
}

// ============ bucket bersama (pola reports.ts) ============

const TENURE_BUCKETS: { key: string; label: string; test: (y: number) => boolean }[] = [
  { key: "lt1", label: "< 1 tahun", test: (y) => y < 1 },
  { key: "b13", label: "1 – 3 tahun", test: (y) => y >= 1 && y < 3 },
  { key: "b35", label: "3 – 5 tahun", test: (y) => y >= 3 && y < 5 },
  { key: "b510", label: "5 – 10 tahun", test: (y) => y >= 5 && y < 10 },
  { key: "gt10", label: "> 10 tahun", test: (y) => y >= 10 },
];

const AGE_BUCKETS: { key: string; label: string; test: (y: number) => boolean }[] = [
  { key: "lt25", label: "< 25", test: (a) => a < 25 },
  { key: "b2534", label: "25 – 34", test: (a) => a >= 25 && a < 35 },
  { key: "b3544", label: "35 – 44", test: (a) => a >= 35 && a < 45 },
  { key: "b4554", label: "45 – 54", test: (a) => a >= 45 && a < 55 },
  { key: "gt55", label: "≥ 55", test: (a) => a >= 55 },
];

const EDU_ORDER = ["S3", "S2", "S1", "Diploma (D1–D4)", "SMA & Sederajat", "Tanpa data"];
const EDU_RANK: Record<string, number> = {
  S3: 6, S2: 5, S1: 4,
  D1: 3, D2: 3, D3: 3, D4: 3,
  SD: 2, SMP: 2, "PAKET A": 2, "PAKET B": 2, SMA: 2, SMK: 2,
};
const eduBucketOf = (levels: string[]): string => {
  let rank = 0;
  for (const lv of levels) {
    const r = EDU_RANK[lv.trim().toUpperCase()];
    if (r != null && r > rank) rank = r;
  }
  if (rank === 0) return "Tanpa data";
  if (rank >= 6) return "S3";
  if (rank === 5) return "S2";
  if (rank === 4) return "S1";
  if (rank === 3) return "Diploma (D1–D4)";
  return "SMA & Sederajat";
};

const urgencyOf = (days: number): "overdue" | "critical" | "warning" | "caution" | "safe" => {
  if (days < 0) return "overdue";
  if (days < 30) return "critical";
  if (days < 60) return "warning";
  if (days < 90) return "caution";
  return "safe";
};

const certCategoryOf = (docType: string, notes: string | null): string => {
  const n = (notes ?? "").toLowerCase();
  if (/k3|apar|forklift|first aid|p3k|p2k3|fire/.test(n)) return "Keselamatan Kerja (K3)";
  if (docType === "SIM") return "SIM (Lisensi Mengemudi)";
  if (docType === "Paspor") return "Paspor (Perjalanan Dinas)";
  return "Sertifikat Profesional";
};

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- T110: ?id=_params — daftar opsi filter (ringan, tanpa fetch karyawan).
    // Dipakai form parameter awal: cabang, unit, status kepegawaian, tahun.
    if (id === "_params") {
      const [offices, units, minJoin, assnStats] = await Promise.all([
        db.companyOffice.findMany({ where: { active: true }, select: { id: true, code: true, name: true, city: true }, orderBy: { code: "asc" } }),
        db.orgUnit.findMany({ select: { id: true, code: true, name: true, level: true } }),
        db.employee.aggregate({ _min: { joinDate: true } }),
        db.employeeAssignment.findMany({ select: { employmentStatus: true }, distinct: ["employmentStatus"] }),
      ]);
      const nowP = new Date();
      const years: number[] = [];
      const minYear = minJoin._min.joinDate?.getFullYear() ?? nowP.getFullYear();
      for (let y = nowP.getFullYear(); y >= Math.min(minYear, nowP.getFullYear()) && years.length < 15; y--) years.push(y);
      const STATUS_ORDER = ["Permanent", "Contract", "Probation", "Outsourcing"];
      const rank = (s: string) => { const i = STATUS_ORDER.indexOf(s); return i === -1 ? 99 : i; };
      const present = [...new Set(assnStats.map((a) => a.employmentStatus).filter(Boolean))]
        .sort((a, b) => rank(a!) - rank(b!) || a!.localeCompare(b!));
      // T110: opsi murni tanpa entri id="" — pilihan "Semua" dirender klien
      // sebagai sentinel "all" (Radix SelectItem tidak boleh value="").
      return NextResponse.json({
        offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}${o.city ? ` (${o.city})` : ""}` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        statuses: present.map((s) => ({ id: s, label: s })),
        years,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (r11…r44)" }, { status: 400 });
    }

    // ---- T110: parse parameter filter dari query string ----
    const sp = req.nextUrl.searchParams;
    const monthParam = sp.get("month");
    const yearParam = sp.get("year");
    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const list = (key: string) => (sp.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const fp: ReportFilters = {
      office: sp.get("office") || null,
      unit: sp.get("unit") || null,
      status: sp.get("status") || null,
      urgency: list("urgency"),
      category: list("category"),
      certStatus: list("certStatus"),
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
    const year = now.getFullYear();

    // ---- fetch utama: karyawan (scope) + master referensi ----
    const [rawEmps, unitsAll, positionsAll, gradesAll, officesAll, locsAll, minWages, company] = await Promise.all([
      db.employee.findMany({
        where: scopeCond,
        select: {
          id: true, employeeNo: true, fullName: true, gender: true, birthDate: true,
          joinDate: true, endDate: true, status: true, maritalStatus: true, religion: true,
          nationalId: true, bpjsHealth: true, bpjsEmpSkill: true,
          orgUnitId: true, positionId: true, gradeId: true, companyOfficeId: true, workLocationId: true,
          contractStart: true, contractEnd: true, renewalCount: true,
          education: { select: { level: true } },
          documents: { select: { docType: true, docNumber: true, issuedAt: true, expiresAt: true, notes: true } },
          onboardings: { select: { status: true, tasks: { select: { status: true } } }, take: 1 },
          offboardings: { select: { lastDay: true, reason: true, status: true, exitInterviewJson: true, tasks: { select: { status: true } } }, take: 1 },
          assignments: {
            select: {
              orgUnitId: true, positionId: true, gradeId: true, managerId: true, employmentStatus: true,
              baseSalary: true, validFrom: true, validTo: true, changeReason: true, sourceDocNo: true, notes: true,
            },
          },
        },
      }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true, headcountBudget: true } }),
      db.position.findMany({ select: { id: true, code: true, title: true, orgUnitId: true, headcount: true, filled: true, active: true } }),
      db.grade.findMany({ select: { id: true, code: true, name: true, minSalary: true, maxSalary: true, sortOrder: true } }),
      db.companyOffice.findMany({ select: { id: true, code: true, name: true, city: true, address: true, phone: true, npwp: true, active: true } }),
      db.workLocation.findMany({ select: { id: true, code: true, name: true, city: true, officeId: true } }),
      db.minimumWage.findMany({ select: { label: true, monthlyAmount: true, year: true, active: true } }),
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
    ]);

    // ---- maps nama master ----
    const unitById = new Map(unitsAll.map((u) => [u.id, u]));
    const posById = new Map(positionsAll.map((p) => [p.id, p]));
    const gradeById = new Map(gradesAll.map((g) => [g.id, g]));
    const officeById = new Map(officesAll.map((o) => [o.id, o]));
    const locById = new Map(locsAll.map((l) => [l.id, l]));
    const empNameById = new Map(rawEmps.map((e) => [e.id, e.fullName]));

    const divUnits = unitsAll.filter((u) => u.level === 3);
    const divMap = new Map(divUnits.map((d) => [d.id, d.name]));
    const subToDiv = new Map(unitsAll.filter((u) => u.level === 4).map((s) => [s.id, s.parentId]));
    const divNameOf = (unitId: string | null): string => {
      if (!unitId) return "Tanpa Unit";
      const divId = divMap.has(unitId) ? unitId : (subToDiv.get(unitId) ?? unitId);
      return divMap.get(divId) ?? "Lainnya";
    };

    // ---- normalisasi baris karyawan ----
    // PII terenkripsi (NIK, no. BPJS, no. dokumen — enc:v1:t via pipeline
    // parity) didekripsi HANYA di batas serializer ini (pola employee-documents
    // / employees.ts); query & agregasi internal tetap tanpa decrypt.
    const emps: Enriched[] = rawEmps.map((e) => {
      const sorted = [...e.assignments].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
      const activeAssn = [...sorted].reverse().find((a) => a.validTo === null) ?? null;
      return {
        id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, gender: e.gender,
        birthDate: e.birthDate, joinDate: e.joinDate, endDate: e.endDate, status: e.status,
        maritalStatus: e.maritalStatus, religion: e.religion,
        nationalId: e.nationalId,
        bpjsHealth: e.bpjsHealth != null ? tc.decryptText(e.bpjsHealth) : null,
        bpjsEmpSkill: e.bpjsEmpSkill != null ? tc.decryptText(e.bpjsEmpSkill) : null,
        orgUnitId: e.orgUnitId, positionId: e.positionId, gradeId: e.gradeId,
        companyOfficeId: e.companyOfficeId, workLocationId: e.workLocationId,
        contractStart: e.contractStart, contractEnd: e.contractEnd, renewalCount: e.renewalCount,
        eduLevels: e.education.map((ed) => ed.level),
        documents: e.documents.map((d) => ({
          docType: d.docType,
          docNumber: d.docNumber != null ? tc.decryptText(d.docNumber) : null,
          issuedAt: d.issuedAt, expiresAt: d.expiresAt, notes: d.notes,
        })),
        onboarding: e.onboardings[0] ?? null,
        offboarding: e.offboardings[0] ?? null,
        assignments: sorted,
        activeAssn,
      };
    });

    // ---- T110: terapkan filter cakupan (cabang / unit+subtree / status) ----
    // Seluruh laporan memakai basis karyawan terfilter yang sama; laporan
    // pergerakan (r32/r33/r34) ikut ter-scope karena `emps` di Ctx memakai hasil
    // filter ini. Filter unit mencakup seluruh subtree unit terpilih.
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
    const statOfEmp = (e: Enriched) => e.activeAssn?.employmentStatus ?? null;
    const empsScoped = emps.filter((e) =>
      (!fp.office || e.companyOfficeId === fp.office)
      && (!scopedUnitIds || (!!e.orgUnitId && scopedUnitIds.has(e.orgUnitId)))
      && (!fp.status || statOfEmp(e) === fp.status)
    );
    const active = empsScoped.filter((e) => e.status === "Active");
    const tenureOf = (e: EmpRow) => (now.getTime() - e.joinDate.getTime()) / YEAR_MS;
    const ageOf = (e: EmpRow) => (e.birthDate ? (now.getTime() - e.birthDate.getTime()) / YEAR_MS : null);
    const unitName = (id: string | null) => (id ? unitById.get(id)?.name ?? null : null);
    const posTitle = (id: string | null) => (id ? posById.get(id)?.title ?? null : null);
    const gradeCode = (id: string | null) => (id ? gradeById.get(id)?.code ?? null : null);
    const statusOf = (e: Enriched) => e.activeAssn?.employmentStatus ?? null;

    // ---- meta dokumen (header semua laporan) ----
    const activeOffices = officesAll.filter((o) => o.active);
    // T110: chip parameter terpasang — tampil di kop dokumen (DocMetaStrip)
    // dan toolbar viewer, sehingga penerima tahu cakupan data laporan.
    const filterChips: { label: string; value: string }[] = [];
    if (fp.office) {
      const o = officeById.get(fp.office);
      if (o) filterChips.push({ label: "Cabang", value: `${o.name}${o.city ? ` — ${o.city}` : ""}` });
    }
    if (fp.unit) {
      const u = unitById.get(fp.unit);
      if (u) filterChips.push({ label: "Unit", value: u.name });
    }
    if (fp.status) filterChips.push({ label: "Status Kepegawaian", value: fp.status });
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
    if (fp.urgency.length) filterChips.push({ label: "Urgensi Kontrak", value: fp.urgency.map((u) => URGENCY_LABELS[u] ?? u).join(", ") });
    if (fp.category.length) filterChips.push({ label: "Kategori Sertifikasi", value: fp.category.join(", ") });
    if (fp.certStatus.length) filterChips.push({ label: "Status Sertifikasi", value: fp.certStatus.map((c) => CERT_STATUS_LABELS[c] ?? c).join(", ") });
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
      year,
      scope: scope.all ? "all" : "scoped",
      filters: filterChips,
    };

    const empStatLabel = (e: Enriched) => statusOf(e) ?? "Tanpa data";
    const sortByNo = (a: Enriched, b: Enriched) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // ===================== perhitungan per laporan =====================

    const data = buildReport(id, { db, emps: empsScoped, active, now, year, fp, meta, tc, mv, unitById, posById, gradeById, officeById, locById, empNameById, divNameOf, minWages, sortByNo, tenureOf, ageOf, unitName, posTitle, gradeCode, empStatLabel });

    // ---- mode export XLSX ----
    if (req.nextUrl.searchParams.get("export") === "xlsx") {
      // BL-4: bahasa ekspor — default EN (frontend selalu mengirim ?lang=;
      // "id" eksplisit → Indonesia, tanpa param pun → EN utk kompatibilitas maju).
      const lang: Lang = req.nextUrl.searchParams.get("lang") === "id" ? "id" : "en";
      const sheets = buildSheets(id, data, data.periodLabel, lang);
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "HrReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan distribusi HR (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-hr-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ konteks perhitungan ============

interface Ctx {
  db: TenantDb;
  emps: Enriched[];
  active: Enriched[];
  now: Date;
  year: number;
  /** T110: parameter filter terpasang saat generate. */
  fp: ReportFilters;
  meta: {
    companyName: string; companyAddress: string | null; companyCity: string | null;
    companyTaxId: string | null; companyLogoUrl: string | null; branchLabel: string;
    printedBy: string; generatedAt: string; year: number; scope: string;
    filters: { label: string; value: string }[];
  };
  tc: ReturnType<typeof tenantCryptoForDb>;
  mv: Awaited<ReturnType<typeof moneyViewForReq>>;
  unitById: Map<string, { id: string; code: string; name: string; parentId: string | null; level: number; headcountBudget: number }>;
  posById: Map<string, { id: string; code: string; title: string; orgUnitId: string | null; headcount: number; filled: number; active: boolean }>;
  gradeById: Map<string, { id: string; code: string; name: string; minSalary: number; maxSalary: number; sortOrder: number }>;
  officeById: Map<string, { id: string; code: string; name: string; city: string | null; address: string | null; phone: string | null; npwp: string | null; active: boolean }>;
  locById: Map<string, { id: string; code: string; name: string; city: string | null; officeId: string | null }>;
  empNameById: Map<string, string>;
  divNameOf: (unitId: string | null) => string;
  minWages: { label: string; monthlyAmount: number; year: number; active: boolean }[];
  sortByNo: (a: Enriched, b: Enriched) => number;
  tenureOf: (e: EmpRow) => number;
  ageOf: (e: EmpRow) => number | null;
  unitName: (id: string | null) => string | null;
  posTitle: (id: string | null) => string | null;
  gradeCode: (id: string | null) => string | null;
  empStatLabel: (e: Enriched) => string;
}

function buildReport(id: string, ctx: Ctx): { periodLabel: string; payload: unknown } {
  switch (id) {
    case "r11": return r11Master(ctx);
    case "r12": return r12Demography(ctx);
    case "r13": return r13DeptPosition(ctx);
    case "r14": return r14Status(ctx);
    case "r15": return r15Locations(ctx);
    case "r21": return r21ContractExpiry(ctx);
    case "r22": return r22Tenure(ctx);
    case "r23": return r23Probation(ctx);
    case "r31": return r31NewHire(ctx);
    case "r32": return r32Termination(ctx);
    case "r33": return r33TurnoverMatrix(ctx);
    case "r34": return r34Movement(ctx);
    case "r41": return r41Wlkp(ctx);
    case "r42": return r42Bpjs(ctx);
    case "r43": return r43WageStructure(ctx);
    default: return r44Certification(ctx);
  }
}

// ---------- R1.1 Master Employee ----------
function r11Master(ctx: Ctx) {
  const { active, sortByNo, empStatLabel } = ctx;
  const rows = [...active].sort((a, b) => (ctx.unitName(a.orgUnitId) ?? "").localeCompare(ctx.unitName(b.orgUnitId) ?? "") || a.fullName.localeCompare(b.fullName, "id"));
  const tc = ctx.tc;
  return {
    periodLabel: `Sensus per ${dateID(ctx.now)}`,
    payload: {
      employees: rows.map((e) => ({
        employeeNo: e.employeeNo,
        name: e.fullName,
        nik: e.nationalId ? tc.maskNik(tc.decryptText(e.nationalId)) : null,
        gender: e.gender === "F" ? "Perempuan" : "Laki-laki",
        birthDate: iso(e.birthDate),
        age: ctx.ageOf(e) != null ? Math.floor(ctx.ageOf(e)!) : null,
        education: eduBucketOf(e.eduLevels),
        marital: e.maritalStatus,
        religion: e.religion,
        unit: ctx.unitName(e.orgUnitId),
        position: ctx.posTitle(e.positionId),
        employmentStatus: empStatLabel(e),
        joinDate: iso(e.joinDate),
        tenureYears: round1(ctx.tenureOf(e)),
      })),
      totalActive: active.length,
      male: active.filter((e) => e.gender !== "F").length,
      female: active.filter((e) => e.gender === "F").length,
      byStatus: distBy(active.map(empStatLabel), ["Permanent", "Contract", "Probation", "Outsourcing"]),
      noUnit: active.filter((e) => !e.orgUnitId).length,
    },
  };
}

// ---------- R1.2 Demography Summary ----------
function r12Demography(ctx: Ctx) {
  const { active, ageOf } = ctx;
  const ages = active.map(ageOf).filter((a): a is number => a != null);
  const buckets = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: active.filter((e) => { const a = ageOf(e); return a != null && b.test(a); }).length }));
  const noBirth = active.filter((e) => !e.birthDate).length;
  return {
    periodLabel: `Per ${dateID(ctx.now)}`,
    payload: {
      total: active.length,
      avgAge: ages.length ? round1(ages.reduce((s, a) => s + a, 0) / ages.length) : null,
      minAge: ages.length ? Math.floor(Math.min(...ages)) : null,
      maxAge: ages.length ? Math.floor(Math.max(...ages)) : null,
      ageBuckets: noBirth > 0 ? [...buckets, { key: "na", label: "Tanpa data", count: noBirth }] : buckets,
      gender: distBy(active.map((e) => (e.gender === "F" ? "Perempuan" : "Laki-laki")), ["Laki-laki", "Perempuan"]),
      education: (() => {
        const m = new Map<string, number>();
        for (const e of active) {
          const b = eduBucketOf(e.eduLevels);
          m.set(b, (m.get(b) ?? 0) + 1);
        }
        return EDU_ORDER.filter((l) => l !== "Tanpa data" || (m.get(l) ?? 0) > 0).map((l) => ({ label: l, count: m.get(l) ?? 0 }));
      })(),
      marital: distBy(active.map((e) => e.maritalStatus), ["Belum Menikah", "Menikah", "Cerai", "Janda/Duda"]),
      religion: distBy(active.map((e) => e.religion), ["Islam", "Kristen", "Katolik", "Hindu", "Buddha", "Konghucu"]),
    },
  };
}

// ---------- R1.3 Department & Position Distribution ----------
function r13DeptPosition(ctx: Ctx) {
  const { active, unitsAll } = { ...ctx, unitsAll: [...ctx.unitById.values()] };
  // T110: filter unit → pohon berakar pada unit terpilih (subtree-nya saja).
  const roots = (ctx.fp.unit ? unitsAll.filter((u) => u.id === ctx.fp.unit) : unitsAll.filter((u) => !u.parentId))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const childrenOf = (parentId: string) => unitsAll
    .filter((u) => u.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, "id"));
  const activeCountOf = (unitId: string) => active.filter((e) => {
    if (e.orgUnitId === unitId) return true;
    return false;
  }).length;
  // headcount unit = karyawan aktif yang snapshot unit-nya di subtree unit tsb.
  const descendants = (unitId: string): string[] => [unitId, ...childrenOf(unitId).flatMap((c) => descendants(c.id))];
  const subtreeCount = (unitId: string) => {
    const ids = new Set(descendants(unitId));
    return active.filter((e) => e.orgUnitId && ids.has(e.orgUnitId)).length;
  };
  const positionsOf = (unitId: string) => [...ctx.posById.values()]
    .filter((p) => p.orgUnitId === unitId)
    .sort((a, b) => a.code.localeCompare(b.code));

  interface PosNode { code: string; title: string; headcount: number; filled: number; gap: number }
  interface UnitNode { code: string; name: string; level: number; headcount: number; budget: number; positions: PosNode[]; children: UnitNode[] }
  const buildUnit = (u: { id: string; code: string; name: string; level: number; headcountBudget: number }): UnitNode => ({
    code: u.code, name: u.name, level: u.level,
    headcount: subtreeCount(u.id), budget: u.headcountBudget,
    positions: positionsOf(u.id).map((p) => ({ code: p.code, title: p.title, headcount: p.headcount, filled: p.filled, gap: p.headcount - p.filled })),
    children: childrenOf(u.id).map(buildUnit),
  });
  const tree = roots.map(buildUnit);
  const totalActive = active.length;
  const totalBudget = unitsAll.reduce((s, u) => s + u.headcountBudget, 0);
  const vacant = [...ctx.posById.values()].filter((p) => p.active).reduce((s, p) => s + Math.max(0, p.headcount - p.filled), 0);
  return {
    periodLabel: `Per ${dateID(ctx.now)}`,
    payload: { tree, totalActive, totalBudget, vacant, units: unitsAll.length },
  };
}

// ---------- R1.4 Employment Status ----------
function r14Status(ctx: Ctx) {
  const { active, empStatLabel } = ctx;
  const order = ["Permanent", "Contract", "Probation", "Outsourcing", "Tanpa data"];
  const groups = order
    .map((st) => {
      const rows = active.filter((e) => empStatLabel(e) === st).sort(ctx.sortByNo);
      const tenures = rows.map(ctx.tenureOf);
      return {
        status: st,
        employees: rows.map((e) => ({
          employeeNo: e.employeeNo, name: e.fullName, gender: e.gender === "F" ? "Perempuan" : "Laki-laki",
          joinDate: iso(e.joinDate), unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
          tenureYears: round1(ctx.tenureOf(e)),
        })),
        male: rows.filter((e) => e.gender !== "F").length,
        female: rows.filter((e) => e.gender === "F").length,
        avgTenure: tenures.length ? round1(tenures.reduce((s, t) => s + t, 0) / tenures.length) : 0,
      };
    })
    .filter((g) => g.employees.length > 0);
  return {
    periodLabel: `Per ${dateID(ctx.now)}`,
    payload: {
      groups,
      total: active.length,
      permanentPct: active.length ? round1((groups.find((g) => g.status === "Permanent")?.employees.length ?? 0) / active.length * 100) : 0,
    },
  };
}

// ---------- R1.5 Multi-branch Location Mapping ----------
function r15Locations(ctx: Ctx) {
  const { active, officeById, locById } = ctx;
  const offices = [...officeById.values()].sort((a, b) => a.code.localeCompare(b.code));
  const rows = offices.map((o) => {
    const empIn = active.filter((e) => e.companyOfficeId === o.id);
    const locs = [...locById.values()].filter((l) => l.officeId === o.id).map((l) => ({
      code: l.code, name: l.name, city: l.city,
      headcount: active.filter((e) => e.workLocationId === l.id).length,
    }));
    return {
      code: o.code, name: o.name, city: o.city, address: o.address, phone: o.phone, npwp: o.npwp, active: o.active,
      headcount: empIn.length,
      male: empIn.filter((e) => e.gender !== "F").length,
      female: empIn.filter((e) => e.gender === "F").length,
      statusMix: distBy(empIn.map(ctx.empStatLabel), ["Permanent", "Contract", "Probation", "Outsourcing"]),
      workLocations: locs,
    };
  });
  return {
    periodLabel: `Per ${dateID(ctx.now)}`,
    payload: {
      offices: rows,
      noOffice: active.filter((e) => !e.companyOfficeId).length,
      total: active.length,
    },
  };
}

// ---------- R2.1 Contract Expiry Alert ----------
function r21ContractExpiry(ctx: Ctx) {
  const { active } = ctx;
  const items = active
    .filter((e) => e.contractEnd)
    .map((e) => {
      const end = e.contractEnd!;
      const days = Math.ceil((end.getTime() - ctx.now.getTime()) / DAY_MS);
      return {
        employeeNo: e.employeeNo, name: e.fullName,
        unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
        contractStart: iso(e.contractStart), contractEnd: iso(end),
        daysRemaining: days, urgency: urgencyOf(days),
        renewalCount: e.renewalCount,
        employmentStatus: ctx.empStatLabel(e),
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
  const levels: { urgency: string; label: string }[] = [
    { urgency: "overdue", label: "Lewat Jatuh Tempo" },
    { urgency: "critical", label: "Kritis (< 30 hari)" },
    { urgency: "warning", label: "Perhatian (30 – 60 hari)" },
    { urgency: "caution", label: "Waspada (60 – 90 hari)" },
    { urgency: "safe", label: "Aman (> 90 hari)" },
  ];
  // T110: filter urgensi (multi-pilih) — hanya level terpilih yang ditampilkan.
  const shown = ctx.fp.urgency.length ? items.filter((i) => ctx.fp.urgency.includes(i.urgency)) : items;
  return {
    periodLabel: `Per ${dateID(ctx.now)} — horizon 90 hari`,
    payload: {
      items: shown,
      total: shown.length,
      counts: levels.map((l) => ({ ...l, count: shown.filter((i) => i.urgency === l.urgency).length })),
    },
  };
}

// ---------- R2.2 Tenure Summary ----------
function r22Tenure(ctx: Ctx) {
  const { active, tenureOf } = ctx;
  const buckets = TENURE_BUCKETS.map((b) => {
    const count = active.filter((e) => b.test(tenureOf(e))).length;
    return { key: b.key, label: b.label, count, pct: active.length ? round1((count / active.length) * 100) : 0 };
  });
  const longService = active
    .filter((e) => tenureOf(e) >= 5)
    .sort((a, b) => tenureOf(b) - tenureOf(a))
    .map((e) => ({
      employeeNo: e.employeeNo, name: e.fullName, joinDate: iso(e.joinDate),
      tenureYears: round1(tenureOf(e)), unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
    }));
  const tenures = active.map(tenureOf);
  const longest = active.length ? active.reduce((a, b) => (tenureOf(a) > tenureOf(b) ? a : b)) : null;
  return {
    periodLabel: `Per ${dateID(ctx.now)}`,
    payload: {
      buckets,
      longService,
      total: active.length,
      avgTenure: tenures.length ? round1(tenures.reduce((s, t) => s + t, 0) / tenures.length) : 0,
      longest: longest ? { name: longest.fullName, joinDate: iso(longest.joinDate), tenureYears: round1(tenureOf(longest)) } : null,
      eligible5yr: longService.length,
    },
  };
}

// ---------- R2.3 Probation Evaluation Schedule ----------
function r23Probation(ctx: Ctx) {
  const { active, empStatLabel } = ctx;
  const items = active
    .filter((e) => empStatLabel(e) === "Probation")
    .map((e) => {
      const due = new Date(e.joinDate); due.setMonth(due.getMonth() + 3); // PP 35/2021: maks 3 bln
      const days = Math.ceil((due.getTime() - ctx.now.getTime()) / DAY_MS);
      return {
        employeeNo: e.employeeNo, name: e.fullName,
        unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
        manager: e.activeAssn?.managerId ? ctx.empNameById.get(e.activeAssn.managerId) ?? null : null,
        joinDate: iso(e.joinDate), evalDue: iso(due), daysRemaining: days,
        status: days < 0 ? "overdue" : days <= 14 ? "due-soon" : "scheduled",
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
  return {
    periodLabel: `Periode berjalan — per ${dateID(ctx.now)}`,
    payload: {
      items,
      total: items.length,
      overdue: items.filter((i) => i.status === "overdue").length,
      dueSoon: items.filter((i) => i.status === "due-soon").length,
      scheduled: items.filter((i) => i.status === "scheduled").length,
    },
  };
}

// ---------- R3.1 New Hire Welcoming ----------
function r31NewHire(ctx: Ctx) {
  const { active } = ctx;
  // T110: bulan data (parameter month YYYY-MM) — default bulan berjalan.
  // Parameter bulan menggeser jangkar; fallback 90 hari hanya untuk default.
  const [ay, am] = (ctx.fp.month ?? "").split("-").map(Number);
  const anchor = ctx.fp.month && ay && am ? new Date(ay, am - 1, 1) : ctx.now;
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59);
  let window = "month";
  let items = active.filter((e) => e.joinDate >= monthStart && e.joinDate <= monthEnd);
  if (items.length === 0 && !ctx.fp.month) {
    window = "90d";
    const from = new Date(ctx.now.getTime() - 90 * DAY_MS);
    items = active.filter((e) => e.joinDate >= from);
  }
  const rows = items.sort(ctx.sortByNo).map((e) => ({
    employeeNo: e.employeeNo, name: e.fullName,
    gender: e.gender === "F" ? "Perempuan" : "Laki-laki",
    position: ctx.posTitle(e.positionId), unit: ctx.unitName(e.orgUnitId),
    manager: e.activeAssn?.managerId ? ctx.empNameById.get(e.activeAssn.managerId) ?? null : null,
    joinDate: iso(e.joinDate),
    employmentStatus: ctx.empStatLabel(e),
    onboarding: e.onboarding
      ? {
        status: e.onboarding.status,
        done: e.onboarding.tasks.filter((t) => t.status === "Done").length,
        total: e.onboarding.tasks.length,
      }
      : null,
  }));
  const quarterStart = new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1);
  const refEnd = ctx.fp.month ? monthEnd : ctx.now;
  return {
    periodLabel: window === "month"
      ? monthLabel(anchor)
      : `90 hari terakhir s.d. ${dateID(ctx.now)}`,
    payload: {
      window,
      items: rows,
      thisMonth: active.filter((e) => e.joinDate >= monthStart && e.joinDate <= monthEnd).length,
      last90: active.filter((e) => e.joinDate >= new Date(refEnd.getTime() - 90 * DAY_MS) && e.joinDate <= refEnd).length,
      qtd: active.filter((e) => e.joinDate >= quarterStart && e.joinDate <= refEnd).length,
      probation: rows.filter((r) => r.employmentStatus === "Probation").length,
    },
  };
}

// ---------- R3.2 Termination & Exit Interview ----------
function r32Termination(ctx: Ctx) {
  const { emps } = ctx;
  const yearStart = new Date(ctx.year, 0, 1);
  // T110: rentang tanggal keluar (from/to) — default seluruh riwayat.
  const fromD = ctx.fp.from ? new Date(`${ctx.fp.from}T00:00:00`) : null;
  const toD = ctx.fp.to ? new Date(`${ctx.fp.to}T23:59:59`) : null;
  const exits = emps
    .filter((e) => EXIT_STATUSES.has(e.status) && e.endDate)
    .filter((e) => (!fromD || e.endDate! >= fromD) && (!toD || e.endDate! <= toD))
    .sort((a, b) => b.endDate!.getTime() - a.endDate!.getTime());
  const items = exits.map((e) => {
    const ob = e.offboarding;
    let interview: { reason: string | null; nextPlan: string | null; feedback: string | null; satisfaction: number | null } | null = null;
    if (ob?.exitInterviewJson) {
      try {
        const j = JSON.parse(ob.exitInterviewJson) as { reason?: string; nextPlan?: string; feedback?: string; satisfaction?: number };
        interview = {
          reason: j.reason ?? null, nextPlan: j.nextPlan ?? null,
          feedback: j.feedback ?? null, satisfaction: typeof j.satisfaction === "number" ? j.satisfaction : null,
        };
      } catch { /* json rusak → null */ }
    }
    const tasks = ob?.tasks ?? [];
    const done = tasks.filter((t) => t.status === "Done").length;
    return {
      employeeNo: e.employeeNo, name: e.fullName, status: e.status,
      joinDate: iso(e.joinDate), endDate: iso(e.endDate),
      tenureYears: round1((e.endDate!.getTime() - e.joinDate.getTime()) / YEAR_MS),
      unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
      exitReason: ob?.reason ?? null,
      interview,
      handoverDone: done, handoverTotal: tasks.length,
      handoverPct: tasks.length ? Math.round((done / tasks.length) * 100) : null,
      offboardingStatus: ob?.status ?? null,
    };
  });
  // T110: bila rentang from/to dipakai, statistik ringkasan mengikuti rentang
  // (items sudah terfilter); tanpa rentang → perilaku lama (YTD tahun berjalan).
  const ranged = !!(fromD || toD);
  const ytd = ranged ? items : items.filter((i) => i.endDate && new Date(i.endDate) >= yearStart);
  return {
    periodLabel: ranged
      ? `Rentang ${fromD ? dateID(fromD) : "awal"} – ${toD ? dateID(toD) : dateID(ctx.now)}`
      : `${ctx.year} YTD — s.d. ${dateID(ctx.now)} (seluruh riwayat ditampilkan)`,
    payload: {
      items,
      ytdExits: ytd.length,
      resigned: ytd.filter((i) => i.status === "Resigned").length,
      terminated: ytd.filter((i) => i.status === "Terminated").length,
      withInterview: ytd.filter((i) => i.interview).length,
      avgSatisfaction: (() => {
        const s = items.filter((i) => i.interview?.satisfaction != null).map((i) => i.interview!.satisfaction!);
        return s.length ? round1(s.reduce((a, b) => a + b, 0) / s.length) : null;
      })(),
      byReason: distBy(ytd.map((i) => {
        if (!i.interview?.reason) return "Tanpa kategori";
        const r = i.interview.reason.toLowerCase();
        if (r.includes("karier") || r.includes("karir") || r.includes("tawaran")) return "Karier / tawaran lain";
        if (r.includes("keluarga")) return "Faktor keluarga";
        if (r.includes("disiplin") || r.includes("pelanggaran")) return "Pelanggaran disiplin";
        return "Lainnya";
      })),
    },
  };
}

// ---------- R3.3 Turnover Executive Summary (matrix 12 bulan) ----------
function r33TurnoverMatrix(ctx: Ctx) {
  const { emps } = ctx;
  // T110: tahun data — tahun lampau = jendela Jan–Des tahun tsb.; tahun
  // berjalan / tanpa parameter = 12 bulan trailing s.d. bulan ini.
  const yr = ctx.fp.year ?? ctx.year;
  const anchorEnd = yr < ctx.now.getFullYear() ? new Date(yr, 11, 1) : ctx.now;
  const yearStart = new Date(yr, 0, 1);
  const months: Date[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(anchorEnd.getFullYear(), anchorEnd.getMonth() - i, 1));
  const divisions = [...new Set(emps.map((e) => ctx.divNameOf(e.orgUnitId)))].sort((a, b) => a.localeCompare(b, "id"));

  const employedAt = (e: Enriched, d: Date) => e.joinDate <= d && (!e.endDate || e.endDate >= d);
  const inMonth = (d: Date | null | undefined, m: Date) =>
    !!d && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();

  const rows = divisions.map((division) => {
    const inDiv = emps.filter((e) => ctx.divNameOf(e.orgUnitId) === division);
    const cells = months.map((m) => {
      const hc = inDiv.filter((e) => employedAt(e, m)).length;
      const exits = inDiv.filter((e) => EXIT_STATUSES.has(e.status) && inMonth(e.endDate, m)).length;
      const hires = inDiv.filter((e) => inMonth(e.joinDate, m)).length;
      return { hires, exits, rate: hc > 0 ? round1((exits / hc) * 100) : null };
    });
    const headcount = inDiv.filter((e) => e.status === "Active").length;
    const exitsYtd = inDiv.filter((e) => EXIT_STATUSES.has(e.status) && e.endDate && e.endDate >= yearStart).length;
    return {
      division, headcount, cells,
      exitsYtd,
      rateYtd: headcount > 0 ? round1((exitsYtd / headcount) * 100) : 0,
    };
  });

  const companyCells = months.map((m, i) => {
    const hc = emps.filter((e) => employedAt(e, m)).length;
    const exits = emps.filter((e) => EXIT_STATUSES.has(e.status) && inMonth(e.endDate, m)).length;
    const hires = emps.filter((e) => inMonth(e.joinDate, m)).length;
    return { hires, exits, rate: hc > 0 ? round1((exits / hc) * 100) : null, headcount: hc, month: MONTHS_ID[m.getMonth()].slice(0, 3) };
  });
  const startHC = emps.filter((e) => employedAt(e, yearStart)).length;
  const nowHC = emps.filter((e) => e.status === "Active").length;
  const hiresYtd = emps.filter((e) => e.joinDate >= yearStart).length;
  const exitsYtd = emps.filter((e) => EXIT_STATUSES.has(e.status) && e.endDate && e.endDate >= yearStart).length;
  return {
    periodLabel: `12 bulan — ${MONTHS_ID[months[0].getMonth()]} ${months[0].getFullYear()} s.d. ${MONTHS_ID[months[11].getMonth()]} ${months[11].getFullYear()}`,
    payload: {
      months: months.map((m) => ({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, label: MONTHS_ID[m.getMonth()].slice(0, 3), full: monthLabel(m) })),
      rows,
      companyCells,
      kpi: {
        startHC, nowHC, hiresYtd, exitsYtd,
        avgHC: round1((startHC + nowHC) / 2),
        turnoverRate: startHC + nowHC > 0 ? round1((exitsYtd / ((startHC + nowHC) / 2)) * 100) : 0,
      },
    },
  };
}

// ---------- R3.4 Movement History Log ----------
function r34Movement(ctx: Ctx) {
  const { emps } = ctx;
  // T110: rentang tanggal efektif (from/to) — default seluruh riwayat.
  const fromD = ctx.fp.from ? new Date(`${ctx.fp.from}T00:00:00`) : null;
  const toD = ctx.fp.to ? new Date(`${ctx.fp.to}T23:59:59`) : null;
  const items: {
    employeeNo: string; name: string; effectiveDate: string | null; reason: string;
    fromUnit: string | null; toUnit: string | null; fromPosition: string | null; toPosition: string | null;
    fromGrade: string | null; toGrade: string | null; docNo: string | null; notes: string | null;
  }[] = [];
  for (const e of emps) {
    const list = e.assignments;
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      if (!MOVEMENT_REASONS.has(cur.changeReason)) continue;
      if (fromD && cur.validFrom < fromD) continue;
      if (toD && cur.validFrom > toD) continue;
      const prev = list[i - 1];
      items.push({
        employeeNo: e.employeeNo, name: e.fullName,
        effectiveDate: iso(cur.validFrom),
        reason: cur.changeReason,
        fromUnit: ctx.unitName(prev.orgUnitId), toUnit: ctx.unitName(cur.orgUnitId),
        fromPosition: ctx.posTitle(prev.positionId), toPosition: ctx.posTitle(cur.positionId),
        fromGrade: ctx.gradeCode(prev.gradeId), toGrade: ctx.gradeCode(cur.gradeId),
        docNo: cur.sourceDocNo, notes: cur.notes,
      });
    }
  }
  items.sort((a, b) => (b.effectiveDate ?? "").localeCompare(a.effectiveDate ?? ""));
  const order = ["Promotion", "Demotion", "Transfer", "Mutation"];
  return {
    periodLabel: (fromD || toD)
      ? `Rentang ${fromD ? dateID(fromD) : "awal"} – ${toD ? dateID(toD) : "kini"}`
      : `Seluruh riwayat — per ${dateID(ctx.now)}`,
    payload: {
      items,
      total: items.length,
      byReason: order.map((r) => ({ label: r, count: items.filter((i) => i.reason === r).length })),
    },
  };
}

// ---------- R4.1 WLKP ----------
function r41Wlkp(ctx: Ctx) {
  const { active, empStatLabel, tc } = ctx;
  // T110: tahun data — UMK diutamakan dari tahun terpilih; periodLabel ikut.
  const yr = ctx.fp.year ?? ctx.year;
  const umk = [...ctx.minWages].filter((w) => w.active && w.year === yr)[0]
    ?? [...ctx.minWages].filter((w) => w.active).sort((a, b) => b.year - a.year)[0] ?? null;
  const umkAmount = umk?.monthlyAmount ?? 0;

  const genderPair = (list: Enriched[]) => ({
    male: list.filter((e) => e.gender !== "F").length,
    female: list.filter((e) => e.gender === "F").length,
  });
  const cat = {
    permanent: active.filter((e) => empStatLabel(e) === "Permanent"),
    contract: active.filter((e) => empStatLabel(e) === "Contract"),
    probation: active.filter((e) => empStatLabel(e) === "Probation"),
    outsourcing: active.filter((e) => empStatLabel(e) === "Outsourcing"),
  };

  // bucket upah vs UMK (dekripsi internal — pola payroll engine)
  const salOf = (e: Enriched) => (e.activeAssn?.baseSalary ? tc.decryptMoney(e.activeAssn.baseSalary) ?? 0 : 0);
  const wageRows = active.map((e) => ({ e, s: salOf(e) }));
  const bucketTest: { label: string; test: (s: number) => boolean }[] = [
    { label: "Kurang dari 1× UMK (< UMK)", test: (s) => s < umkAmount },
    { label: "1× UMK s.d. < 2× UMK", test: (s) => s >= umkAmount && s < 2 * umkAmount },
    { label: "2× UMK s.d. < 3× UMK", test: (s) => s >= 2 * umkAmount && s < 3 * umkAmount },
    { label: "3× UMK ke atas (≥ 3× UMK)", test: (s) => s >= 3 * umkAmount },
  ];
  const wageBuckets = bucketTest.map((b) => {
    const rows = wageRows.filter((r) => b.test(r.s));
    return { label: b.label, ...genderPair(rows.map((r) => r.e)), total: rows.length };
  });

  const healthOk = active.filter((e) => e.bpjsHealth).length;
  const jkkOk = active.filter((e) => e.bpjsEmpSkill).length;

  const sum = (n: { male: number; female: number }) => n.male + n.female;
  return {
    periodLabel: `Tahun ${yr}`,
    payload: {
      identity: {
        name: ctx.meta.companyName, address: ctx.meta.companyAddress,
        city: ctx.meta.companyCity, taxId: ctx.meta.companyTaxId,
        offices: [...ctx.officeById.values()].filter((o) => o.active).map((o) => `${o.name} (${o.city ?? "—"})`),
      },
      workers: {
        permanent: genderPair(cat.permanent),
        contract: genderPair(cat.contract),
        probation: genderPair(cat.probation),
        outsourcing: genderPair(cat.outsourcing),
      },
      workersTotal: active.length,
      wageBuckets,
      wageTotal: wageBuckets.reduce((s, b) => s + b.total, 0),
      umk: umk ? { label: umk.label, monthlyAmount: umk.monthlyAmount, year: umk.year } : null,
      bpjs: {
        healthRegistered: healthOk, healthMissing: active.length - healthOk,
        jkkRegistered: jkkOk, jkkMissing: active.length - jkkOk,
      },
      totalAll: sum(genderPair(cat.permanent)) + sum(genderPair(cat.contract)) + sum(genderPair(cat.probation)) + sum(genderPair(cat.outsourcing)),
    },
  };
}

// ---------- R4.2 BPJS Reconciliation ----------
function r42Bpjs(ctx: Ctx) {
  const { active } = ctx;
  const items = [...active].sort(ctx.sortByNo).map((e) => {
    const health = !!e.bpjsHealth;
    const jkk = !!e.bpjsEmpSkill;
    // no. kepesertaan disimpan terenkripsi (enc:v1:t) — didekripsi di batas
    // serializer normalisasi Enriched (pola employee-documents.ts).
    return {
      employeeNo: e.employeeNo, name: e.fullName,
      unit: ctx.unitName(e.orgUnitId), employmentStatus: ctx.empStatLabel(e),
      nik: e.nationalId ? ctx.tc.maskNik(ctx.tc.decryptText(e.nationalId)) : null,
      bpjsHealth: e.bpjsHealth, bpjsEmpSkill: e.bpjsEmpSkill,
      health, jkk,
      status: health && jkk ? "match" : health || jkk ? "partial" : "missing",
    };
  });
  const matched = items.filter((i) => i.status === "match").length;
  const partial = items.filter((i) => i.status === "partial").length;
  const missing = items.filter((i) => i.status === "missing").length;
  return {
    periodLabel: `Per ${dateID(ctx.now)} — dibandingkan payroll aktif`,
    payload: {
      items, total: items.length, matched, partial, missing,
      healthMissing: items.filter((i) => !i.health).length,
      jkkMissing: items.filter((i) => !i.jkk).length,
      compliancePct: items.length ? round1((matched / items.length) * 100) : 0,
    },
  };
}

// ---------- R4.3 Struktur & Skala Upah ----------
function r43WageStructure(ctx: Ctx) {
  const { active, gradeById, tc, mv } = ctx;
  const umk = [...ctx.minWages].filter((w) => w.active).sort((a, b) => b.year - a.year)[0] ?? null;
  const umkAmount = umk?.monthlyAmount ?? 0;
  const salOf = (e: Enriched) => (e.activeAssn?.baseSalary ? tc.decryptMoney(e.activeAssn.baseSalary) ?? 0 : 0);

  const grades = [...gradeById.values()]
    .filter((g) => active.some((e) => e.gradeId === g.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((g) => {
      const rows = active.filter((e) => e.gradeId === g.id);
      const sal = rows.map(salOf);
      const canSee = mv.canSee;
      return {
        code: g.code, name: g.name,
        minSalary: g.minSalary, maxSalary: g.maxSalary,
        midSalary: Math.round((g.minSalary + g.maxSalary) / 2),
        employees: rows.length,
        actualMin: canSee && sal.length ? Math.min(...sal) : null,
        actualAvg: canSee && sal.length ? Math.round(sal.reduce((s, v) => s + v, 0) / sal.length) : null,
        actualMax: canSee && sal.length ? Math.max(...sal) : null,
        belowUmk: sal.filter((s) => s < umkAmount).length,
      };
    });
  const noGrade = active.filter((e) => !e.gradeId).length;
  const allSal = active.map(salOf);
  return {
    periodLabel: `Berlaku per ${dateID(ctx.now)}`,
    payload: {
      grades,
      umk: umk ? { label: umk.label, monthlyAmount: umk.monthlyAmount, year: umk.year } : null,
      masked: !mv.canSee,
      noGrade,
      total: active.length,
      overallBelowUmk: allSal.filter((s) => s < umkAmount).length,
    },
  };
}

// ---------- R4.4 Competency & Certification Audit ----------
function r44Certification(ctx: Ctx) {
  const { active } = ctx;
  const items = active
    .flatMap((e) => e.documents.map((d) => {
      const exp = d.expiresAt ? new Date(d.expiresAt) : null;
      const days = exp ? Math.ceil((exp.getTime() - ctx.now.getTime()) / DAY_MS) : null;
      return {
        employeeNo: e.employeeNo, name: e.fullName,
        unit: ctx.unitName(e.orgUnitId), position: ctx.posTitle(e.positionId),
        docType: d.docType, docNumber: d.docNumber, notes: d.notes,
        category: certCategoryOf(d.docType, d.notes),
        issuedAt: iso(d.issuedAt), expiresAt: iso(exp),
        daysRemaining: days,
        status: days == null ? "no-expiry" : days < 0 ? "expired" : days <= 90 ? "expiring" : "active",
      };
    }))
    .sort((a, b) => {
      const rank = { expired: 0, expiring: 1, active: 2, "no-expiry": 3 } as const;
      return rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank]
        || (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999")
        || a.name.localeCompare(b.name, "id");
    });
  // T110: filter kategori + status sertifikasi (multi-pilih).
  const shown = items.filter((i) =>
    (ctx.fp.category.length === 0 || ctx.fp.category.includes(i.category))
    && (ctx.fp.certStatus.length === 0 || ctx.fp.certStatus.includes(i.status))
  );
  const expired = shown.filter((i) => i.status === "expired").length;
  const expiring = shown.filter((i) => i.status === "expiring").length;
  const activeC = shown.filter((i) => i.status === "active").length;
  const withExpiry = expired + expiring + activeC;
  const categories = ctx.fp.category.length
    ? ctx.fp.category
    : ["Keselamatan Kerja (K3)", "Sertifikat Profesional", "SIM (Lisensi Mengemudi)", "Paspor (Perjalanan Dinas)"];
  return {
    periodLabel: `Per ${dateID(ctx.now)} — audit lisensi & sertifikasi`,
    payload: {
      items: shown,
      total: shown.length,
      expired, expiring, active: activeC, noExpiry: shown.filter((i) => i.status === "no-expiry").length,
      compliancePct: withExpiry ? round1(((expiring + activeC) / withExpiry) * 100) : 100,
      byCategory: categories.map((c) => ({
        label: c,
        total: shown.filter((i) => i.category === c).length,
        expired: shown.filter((i) => i.category === c && i.status === "expired").length,
        expiring: shown.filter((i) => i.category === c && i.status === "expiring").length,
      })),
      employeesCovered: new Set(shown.map((i) => i.employeeNo)).size,
    },
  };
}

// ============ export XLSX per laporan ============

type AnyRec = Record<string, unknown>;
const s = (v: unknown): string => (v == null || v === "" ? "—" : String(v));
const d = (isoStr: string | null): ExportCell => {
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
    case "r11": {
      const rows = (p.employees as AnyRec[]) ?? [];
      return [{
        name: "Sensus Karyawan",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama Lengkap", width: 24 }, { header: "NIK (masked)", width: 20 },
          { header: "L/P", width: 6 }, { header: "Tgl Lahir", width: 12 }, { header: "Usia", width: 7 },
          { header: "Pendidikan", width: 18 }, { header: "Status Keluarga", width: 15 }, { header: "Agama", width: 12 },
          { header: "Unit", width: 22 }, { header: "Posisi", width: 24 }, { header: "Status Kepegawaian", width: 16 },
          { header: "Tgl Masuk", width: 12 }, { header: "Masa Kerja (thn)", width: 12 },
        ],
        rows: rows.map((e) => [s(e.employeeNo), s(e.name), s(e.nik), s(e.gender), d(e.birthDate as string), (e.age as number) ?? "—", s(e.education), s(e.marital), s(e.religion), s(e.unit), s(e.position), s(e.employmentStatus), d(e.joinDate as string), (e.tenureYears as number) ?? "—"]),
      }];
    }
    case "r12": {
      const mk = (name: string, rows: AnyRec[]) => ({ name, title, columns: [{ header: "Kategori", width: 26 }, { header: "Jumlah", width: 12 }], rows: rows.map((r) => [s(r.label), (r.count as number) ?? 0]) });
      return [
        mk("Usia", (p.ageBuckets as AnyRec[]) ?? []),
        mk("Gender", (p.gender as AnyRec[]) ?? []),
        mk("Pendidikan", (p.education as AnyRec[]) ?? []),
        mk("Status Pernikahan", (p.marital as AnyRec[]) ?? []),
        mk("Agama", (p.religion as AnyRec[]) ?? []),
        { name: "Ringkasan", title, columns: [{ header: "Indikator", width: 28 }, { header: "Nilai", width: 16 }], rows: [["Total Karyawan Aktif", (p.total as number) ?? 0], ["Rata-rata Usia", (p.avgAge as number) ?? "—"], ["Usia Termuda", (p.minAge as number) ?? "—"], ["Usia Tertua", (p.maxAge as number) ?? "—"]] },
      ];
    }
    case "r13": {
      const flat: ExportCell[][] = [];
      const walk = (nodes: AnyRec[], depth: number) => {
        for (const n of nodes) {
          flat.push([`${"  ".repeat(depth)}${s(n.code)} — ${s(n.name)}`, depth === 0 ? "DIVISI/ROOT" : `Level ${n.level}`, (n.headcount as number) ?? 0, (n.budget as number) ?? 0]);
          for (const pos of (n.positions as AnyRec[]) ?? []) flat.push([`${"  ".repeat(depth + 1)}▸ ${s(pos.code)} ${s(pos.title)}`, "POSISI", (pos.filled as number) ?? 0, (pos.headcount as number) ?? 0]);
          walk((n.children as AnyRec[]) ?? [], depth + 1);
        }
      };
      walk((p.tree as AnyRec[]) ?? [], 0);
      return [{ name: "Struktur & Posisi", title, columns: [{ header: "Unit / Posisi", width: 52 }, { header: "Jenis", width: 16 }, { header: "Headcount Aktif", width: 14 }, { header: "Anggaran/Slot", width: 14 }], rows: flat }];
    }
    case "r14": {
      const sheets: ExportSheet[] = [];
      for (const g of (p.groups as AnyRec[]) ?? []) {
        sheets.push({
          name: g.status === "Tanpa data" ? "Tanpa Data" : String(g.status),
          title: `${title} — ${s(g.status)}`,
          columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "L/P", width: 6 }, { header: "Tgl Masuk", width: 12 }, { header: "Unit", width: 22 }, { header: "Posisi", width: 24 }, { header: "Masa Kerja (thn)", width: 12 }],
          rows: ((g.employees as AnyRec[]) ?? []).map((e) => [s(e.employeeNo), s(e.name), s(e.gender), d(e.joinDate as string), s(e.unit), s(e.position), (e.tenureYears as number) ?? 0]),
        });
      }
      return sheets;
    }
    case "r15": {
      const rows: ExportCell[][] = [];
      for (const o of (p.offices as AnyRec[]) ?? []) {
        rows.push([s(o.code), s(o.name), s(o.city), s(o.address), s(o.phone), (o.headcount as number) ?? 0, (o.male as number) ?? 0, (o.female as number) ?? 0]);
      }
      return [{ name: "Lokasi", title, columns: [{ header: "Kode", width: 10 }, { header: "Kantor", width: 26 }, { header: "Kota", width: 16 }, { header: "Alamat", width: 34 }, { header: "Telepon", width: 16 }, { header: "Headcount", width: 12 }, { header: "L", width: 7 }, { header: "P", width: 7 }], rows }];
    }
    case "r21": {
      const label: Record<string, string> = { overdue: "Lewat Jatuh Tempo", critical: "Kritis (<30 hr)", warning: "Perhatian (30–60)", caution: "Waspada (60–90)", safe: "Aman (>90)" };
      return [{
        name: "Kontrak Jatuh Tempo",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Posisi", width: 22 }, { header: "Mulai", width: 12 }, { header: "Berakhir", width: 12 }, { header: "Sisa Hari", width: 10 }, { header: "Urgensi", width: 18 }, { header: "Perpanjangan ke-", width: 14 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.position), d(i.contractStart as string), d(i.contractEnd as string), (i.daysRemaining as number) ?? 0, label[i.urgency as string] ?? s(i.urgency), (i.renewalCount as number) ?? 0]),
      }];
    }
    case "r22": {
      return [
        { name: "Bracket Masa Kerja", title, columns: [{ header: "Bracket", width: 18 }, { header: "Jumlah", width: 10 }, { header: "%", width: 8 }], rows: ((p.buckets as AnyRec[]) ?? []).map((b) => [s(b.label), (b.count as number) ?? 0, (b.pct as number) ?? 0]) },
        { name: "Long Service", title, columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Tgl Masuk", width: 12 }, { header: "Masa Kerja (thn)", width: 14 }, { header: "Unit", width: 22 }, { header: "Posisi", width: 22 }], rows: ((p.longService as AnyRec[]) ?? []).map((e) => [s(e.employeeNo), s(e.name), d(e.joinDate as string), (e.tenureYears as number) ?? 0, s(e.unit), s(e.position)]) },
      ];
    }
    case "r23": {
      return [{
        name: "Jadwal Evaluasi Probation",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Posisi", width: 22 }, { header: "Atasan", width: 22 }, { header: "Tgl Masuk", width: 12 }, { header: "Jatuh Tempo Evaluasi", width: 16 }, { header: "Sisa Hari", width: 10 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.position), s(i.manager), d(i.joinDate as string), d(i.evalDue as string), (i.daysRemaining as number) ?? 0]),
      }];
    }
    case "r31": {
      return [{
        name: "Karyawan Baru",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "L/P", width: 6 }, { header: "Posisi", width: 22 }, { header: "Unit", width: 22 }, { header: "Atasan", width: 22 }, { header: "Tgl Masuk", width: 12 }, { header: "Status", width: 12 }, { header: "Onboarding", width: 16 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => {
          const ob = i.onboarding as AnyRec | null;
          return [s(i.employeeNo), s(i.name), s(i.gender), s(i.position), s(i.unit), s(i.manager), d(i.joinDate as string), s(i.employmentStatus), ob ? `${ob.done}/${ob.total} selesai` : "—"];
        }),
      }];
    }
    case "r32": {
      return [{
        name: "Keluar & Exit Interview",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Status", width: 12 }, { header: "Tgl Masuk", width: 12 }, { header: "Tgl Keluar", width: 12 }, { header: "Masa Kerja (thn)", width: 12 }, { header: "Unit", width: 20 }, { header: "Alasan Keluar", width: 30 }, { header: "Exit Interview", width: 30 }, { header: "Handover", width: 12 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => {
          const iv = i.interview as AnyRec | null;
          return [s(i.employeeNo), s(i.name), s(i.status), d(i.joinDate as string), d(i.endDate as string), (i.tenureYears as number) ?? 0, s(i.unit), s(i.exitReason), iv ? `${s(iv.reason)} (${s(iv.satisfaction)}/5)` : "—", i.handoverPct != null ? `${i.handoverPct}%` : "—"];
        }),
      }];
    }
    case "r33": {
      const months = (p.months as AnyRec[]) ?? [];
      const cols = [{ header: "Divisi", width: 26 }, ...months.map((m) => ({ header: s(m.label), width: 8 })), { header: "HC Kini", width: 9 }, { header: "Exits YTD", width: 9 }, { header: "Rate YTD %", width: 10 }];
      const rows = ((p.rows as AnyRec[]) ?? []).map((r) => [s(r.division), ...((r.cells as AnyRec[]) ?? []).map((c) => (c.rate as number) ?? "—"), (r.headcount as number) ?? 0, (r.exitsYtd as number) ?? 0, (r.rateYtd as number) ?? 0]);
      const cc = (p.companyCells as AnyRec[]) ?? [];
      rows.push(["TOTAL PERUSAHAAN", ...cc.map((c) => (c.rate as number) ?? "—"), (p.kpi as AnyRec).nowHC as number, (p.kpi as AnyRec).exitsYtd as number, (p.kpi as AnyRec).turnoverRate as number]);
      return [{ name: "Turnover 12 Bulan", title, columns: cols, rows }];
    }
    case "r34": {
      const label: Record<string, string> = { Promotion: "Promosi", Demotion: "Demosi", Transfer: "Rotasi/Transfer", Mutation: "Mutasi" };
      return [{
        name: "Riwayat Pergerakan",
        title,
        columns: [{ header: "Tanggal Efektif", width: 14 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Jenis", width: 12 }, { header: "Unit Asal", width: 20 }, { header: "Unit Tujuan", width: 20 }, { header: "Posisi Asal", width: 22 }, { header: "Posisi Tujuan", width: 22 }, { header: "No. Dokumen", width: 14 }, { header: "Catatan", width: 30 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [d(i.effectiveDate as string), s(i.employeeNo), s(i.name), label[i.reason as string] ?? s(i.reason), s(i.fromUnit), s(i.toUnit), s(i.fromPosition), s(i.toPosition), s(i.docNo), s(i.notes)]),
      }];
    }
    case "r41": {
      const w = (p.workers as AnyRec) ?? {};
      // total L/P dihitung dari 4 kategori pekerja (kolom Laki-laki/Perempuan/Jumlah
      // harus terisi penuh di baris TOTAL — sebelumnya 3 sel vs 4 kolom).
      const wGroups = (["permanent", "contract", "probation", "outsourcing"] as const).map((k) => (w[k] as AnyRec) ?? {});
      const mTot = wGroups.reduce((s, g) => s + ((g.male as number) ?? 0), 0);
      const fTot = wGroups.reduce((s, g) => s + ((g.female as number) ?? 0), 0);
      const rows: ExportCell[][] = [
        ["A. PEKERJA TETAP", (w.permanent as AnyRec).male as number, (w.permanent as AnyRec).female as number, ((w.permanent as AnyRec).male as number) + ((w.permanent as AnyRec).female as number)],
        ["B. PKWT / KONTRAK", (w.contract as AnyRec).male as number, (w.contract as AnyRec).female as number, ((w.contract as AnyRec).male as number) + ((w.contract as AnyRec).female as number)],
        ["C. PROBATION / MAGANG", (w.probation as AnyRec).male as number, (w.probation as AnyRec).female as number, ((w.probation as AnyRec).male as number) + ((w.probation as AnyRec).female as number)],
        ["D. OUTSOURCING", (w.outsourcing as AnyRec).male as number, (w.outsourcing as AnyRec).female as number, ((w.outsourcing as AnyRec).male as number) + ((w.outsourcing as AnyRec).female as number)],
        ["TOTAL", mTot, fTot, (p.workersTotal as number) ?? (mTot + fTot)],
      ];
      const wb = ((p.wageBuckets as AnyRec[]) ?? []).map((b) => [s(b.label), (b.male as number) ?? 0, (b.female as number) ?? 0, (b.total as number) ?? 0]);
      return [
        { name: "Data Pekerja", title, columns: [{ header: "Kategori", width: 28 }, { header: "Laki-laki", width: 12 }, { header: "Perempuan", width: 12 }, { header: "Jumlah", width: 10 }], rows },
        { name: "Distribusi Upah", title, columns: [{ header: "Kelas Upah", width: 28 }, { header: "Laki-laki", width: 12 }, { header: "Perempuan", width: 12 }, { header: "Jumlah", width: 10 }], rows: wb },
      ];
    }
    case "r42": {
      return [{
        name: "Rekon BPJS",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 }, { header: "Status", width: 12 }, { header: "No. BPJS Kesehatan", width: 20 }, { header: "No. BPJS Ketenagakerjaan", width: 22 }, { header: "Keterangan", width: 26 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.employmentStatus), s(i.bpjsHealth), s(i.bpjsEmpSkill), i.status === "match" ? "Sesuai" : i.status === "partial" ? [i.health ? "" : "Kesehatan belum terdaftar", i.jkk ? "" : "Ketenagakerjaan belum terdaftar"].filter(Boolean).join(" + ") : "Belum terdaftar sama sekali"]),
      }];
    }
    case "r43": {
      const rp = (n: unknown) => (n == null ? "—" : n as number);
      return [{
        name: "Struktur Skala Upah",
        title,
        columns: [{ header: "Grade", width: 10 }, { header: "Nama Grade", width: 22 }, { header: "Upah Min. (Rp)", width: 16 }, { header: "Titik Tengah (Rp)", width: 16 }, { header: "Upah Maks. (Rp)", width: 16 }, { header: "Jumlah Karyawan", width: 14 }, { header: "Aktual Min. (Rp)", width: 16 }, { header: "Aktual Rata-rata (Rp)", width: 18 }, { header: "Aktual Maks. (Rp)", width: 16 }, { header: "Di Bawah UMK", width: 12 }],
        rows: ((p.grades as AnyRec[]) ?? []).map((g) => [s(g.code), s(g.name), rp(g.minSalary), rp(g.midSalary), rp(g.maxSalary), (g.employees as number) ?? 0, rp(g.actualMin), rp(g.actualAvg), rp(g.actualMax), (g.belowUmk as number) ?? 0]),
      }];
    }
    default: {
      const label: Record<string, string> = { expired: "Kedaluwarsa", expiring: "Segera Berakhir", active: "Aktif", "no-expiry": "Tanpa Masa Berlaku" };
      return [{
        name: "Audit Sertifikasi",
        title,
        columns: [{ header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 20 }, { header: "Kategori", width: 22 }, { header: "Dokumen / Lisensi", width: 30 }, { header: "No. Dokumen", width: 18 }, { header: "Terbit", width: 12 }, { header: "Berakhir", width: 12 }, { header: "Sisa Hari", width: 10 }, { header: "Status", width: 16 }],
        rows: ((p.items as AnyRec[]) ?? []).map((i) => [s(i.employeeNo), s(i.name), s(i.unit), s(i.category), s(i.notes), s(i.docNumber), d(i.issuedAt as string), d(i.expiresAt as string), (i.daysRemaining as number) ?? "—", label[i.status as string] ?? s(i.status)]),
      }];
    }
  }
}
