import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { resolveAccessScope, scopeWhere } from "@/rekankerja/shared/services/access-scope";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, locFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import { attachChainSummaries } from "@/rekankerja/shared/services/approval-engine";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
// KONTRAK payload — tipe dipakai compile-time supaya field TIDAK BISA menyimpang
// dari src/rekankerja/performance/components/report-documents/types.ts.
import type {
  PF11Data, PF12Data, PF13Data, PF21Data, PF22Data, PF23Data, PF24Data,
  PF31Data, PF32Data, PF33Data, PF41Data, PF42Data, PF43Data, PF44Data,
  PF22Row, PF23HistoryRow, PF23Detail, PF24Row, PF31Session, PF31Row, PF32Row,
  PF33Row, PF41Row, PF42Row, PF43Cell, PF44Row,
} from "@/rekankerja/performance/components/report-documents/types";

// =============================================================================
// P8-PERF — LAPORAN DISTRIBUSI KINERJA (print & PDF ready) =====================
// =============================================================================
// GET /api/rekankerja/performance/reports/documents?id=<pfId> — data satu
// laporan siap cetak (14 laporan / 4 grup: siklus & partisipasi, penilaian &
// hasil, kualitas & kepatuhan, konsekuensi & analitik — katalog AUTHORITATIVE
// §11.2). Mirror alur medical/travel (T110/T112): form parameter awal di klien
// mengirim query string (siklus/tahun/unit/status/kelompok/karyawan/sesi) →
// diterapkan SERVER-SIDE sebelum builder berjalan.
// ?id=_params → daftar opsi filter. ?export=xlsx → stream XLSX per laporan.
//
// Guard: requireMenuViewAny performance:reports + performance:overview.
//
// UANG (pf41): kolom nominal MeritRecommendation TERENKRIPSI vault — didekripsi
// via tenantCryptoForDb HANYA untuk kalkulasi internal; nilai yang diserialisasi
// digerbang money-view (masked saat brankas terkunci → null, UI "•••").
//
// pf23 = REGISTER RIWAYAT PER KARYAWAN (PP 35/2021 §7.2): tanpa parameter siklus
// → seluruh riwayat penilaian per karyawan (skor/rating/kalibrasi/banding/
// acknowledge) — dasar hukum konversi PKWT → audit kinerja eksporabel.
// =============================================================================

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "pf11", "pf12", "pf13",
  "pf21", "pf22", "pf23", "pf24",
  "pf31", "pf32", "pf33",
  "pf41", "pf42", "pf43", "pf44",
]);

/** Judul sheet XLSX — string komposit "English (Indonesian)" (pola medical). */
const REPORT_TITLES: Record<string, string> = {
  pf11: "Cycle & Phase Register (Register Siklus & Fase)",
  pf12: "Phase Completion Report (Completion per Fase)",
  pf13: "KPI Assignment Register (Register Penetapan KPI)",
  pf21: "Period Results Register (Register Hasil per Periode)",
  pf22: "Rating Distribution by Unit/Manager (Distribusi Rating per Unit/Atasan)",
  pf23: "Employee KPI & Competency Detail (Detail Skor per Karyawan)",
  pf24: "Aggregated 360 Summary (Ringkasan 360 Ter-agregasi)",
  pf31: "Calibration Audit Trail (Jejak Kalibrasi)",
  pf32: "Manager Bias Indicator (Indikator Bias Atasan)",
  pf33: "Appeal Register (Register Banding)",
  pf41: "Merit Register (Register Merit)",
  pf42: "PIP & Outcome Register (Register PIP & Outcome)",
  pf43: "9-Box Snapshot (Snapshot 9-Box)",
  pf44: "Multi-Year Performance Trend (Tren Kinerja Multi-Tahun per Unit)",
};

// ---------- label status (dwibahasa: [ID, EN] — ID utk XLSX, keduanya UI) ----------

const CYCLE_STATUS_LABELS: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  GoalSetting: ["Pengaturan Target", "Goal Setting"],
  Ongoing: ["Berjalan", "Ongoing"],
  Assessment: ["Penilaian", "Assessment"],
  Calibration: ["Kalibrasi", "Calibration"],
  Published: ["Terbit", "Published"],
  Closed: ["Tertutup", "Closed"],
};
const CYCLE_TYPE_LABELS: Record<string, [string, string]> = {
  Annual: ["Tahunan", "Annual"],
  MidYearOnly: ["Tengah Tahun", "Mid-Year Only"],
  OffCycle: ["Luar Siklus", "Off-Cycle"],
};

/** Status appraisal yang menandakan target TERKUNCI (APPRAISAL_LOCKED P1). */
const LOCKED = ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const SELF_DONE = ["SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const MGR_DONE = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
const SCORED = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"]; // SCORED_STATUSES P4

const APPRAISAL_STATUS_LABELS: Record<string, [string, string]> = {
  Enrolled: ["Terdaftar", "Enrolled"],
  GoalProposed: ["Usulan Target", "Goal Proposed"],
  GoalApproved: ["Target Disetujui", "Goals Approved"],
  Ongoing: ["Berjalan", "Ongoing"],
  SelfDone: ["Penilaian Diri Selesai", "Self Done"],
  ManagerDone: ["Penilaian Atasan Selesai", "Manager Done"],
  Calibrating: ["Sedang Kalibrasi", "Calibrating"],
  Finalized: ["Final", "Finalized"],
  Published: ["Terbit", "Published"],
  Appealed: ["Banding", "Appealed"],
  Closed: ["Tertutup", "Closed"],
};
const MERIT_STATUS_LABELS: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  Submitted: ["Menunggu Persetujuan", "Awaiting Approval"],
  Approved: ["Disetujui", "Approved"],
  Rejected: ["Ditolak", "Rejected"],
  Applied: ["Diterapkan", "Applied"],
  Cancelled: ["Dibatalkan", "Cancelled"],
};
const PIP_STATUS_LABELS: Record<string, [string, string]> = {
  Draft: ["Draft", "Draft"],
  Active: ["Aktif", "Active"],
  Extended: ["Diperpanjang", "Extended"],
  Recovered: ["Pulih", "Recovered"],
  NotRecovered: ["Tidak Pulih", "Not Recovered"],
  Cancelled: ["Dibatalkan", "Cancelled"],
};
const APPEAL_STATUS_LABELS: Record<string, [string, string]> = {
  Submitted: ["Menunggu Putusan", "Awaiting Decision"],
  Rejected: ["Ditolak", "Rejected"],
  Adjusted: ["Disetujui — Skor Disesuaikan", "Approved — Score Adjusted"],
  Withdrawn: ["Ditarik Kembali", "Withdrawn"],
};
const ORIGIN_LABELS: Record<string, [string, string]> = {
  Fresh: ["Baru", "Fresh"],
  Template: ["Pustaka", "Library"],
  CopiedFromCycle: ["Salin Periode", "Copied from Cycle"],
  EmployeeProposal: ["Usulan Karyawan", "Employee Proposal"],
};

// ============ parameter & filter awal (mirror medical) ============

interface ReportFilters {
  cycle: string | null;
  year: number | null;
  unit: string | null;
  status: string | null; // semantik per laporan: siklus|penilaian|merit|pip
  groupBy: "unit" | "atasan";
  employee: string | null;
  session: string | null;
}

// ============ util kecil ============

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:reports", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan). ----
    if (id === "_params") {
      const [cycles, units, employees, apprStats, meritStats, pipStats, sessions] = await Promise.all([
        db.performanceCycle.findMany({ select: { id: true, code: true, name: true, status: true, periodStart: true }, orderBy: { createdAt: "desc" }, take: 100 }),
        db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        db.employee.findMany({ where: { status: "Active" }, select: { id: true, employeeNo: true, fullName: true }, orderBy: { employeeNo: "asc" }, take: 500 }),
        db.appraisalRecord.findMany({ select: { status: true }, distinct: ["status"] }),
        db.meritRecommendation.findMany({ select: { status: true }, distinct: ["status"] }),
        db.pipPlan.findMany({ select: { status: true }, distinct: ["status"] }),
        db.calibrationSession.findMany({ select: { id: true, heldAt: true, cycle: { select: { code: true } } }, orderBy: { heldAt: "desc" }, take: 100 }),
      ]);
      // tahun: dari tahun awal siklus → sekarang (maks 15, terbaru dulu)
      const now = new Date();
      const years: number[] = [];
      const minY = cycles.reduce((lo, c) => Math.min(lo, c.periodStart.getFullYear()), now.getFullYear());
      for (let y = now.getFullYear(); y >= Math.min(minY, now.getFullYear()) && years.length < 15; y--) years.push(y);
      const defaultCycle =
        cycles.find((c) => !["Published", "Closed"].includes(c.status)) ?? cycles[0] ?? null;
      return NextResponse.json({
        cycles: cycles.map((c) => ({ id: c.id, code: c.code, label: `${c.code} — ${c.name}`.slice(0, 64) })),
        years,
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        employees: employees.map((e) => ({ id: e.id, label: `${e.employeeNo} — ${e.fullName}` })),
        cycleStatuses: Object.entries(CYCLE_STATUS_LABELS).map(([k, v]) => ({ id: k, label: v[0] })),
        appraisalStatuses: apprStats.length > 0
          ? apprStats.map((r) => ({ id: r.status, label: APPRAISAL_STATUS_LABELS[r.status]?.[0] ?? r.status })).sort((a, b) => (APPRAISAL_STATUS_LABELS[a.id] ? 1 : 0) - (APPRAISAL_STATUS_LABELS[b.id] ? 1 : 0))
          : Object.entries(APPRAISAL_STATUS_LABELS).map(([k, v]) => ({ id: k, label: v[0] })),
        meritStatuses: meritStats.length > 0
          ? meritStats.map((r) => ({ id: r.status, label: MERIT_STATUS_LABELS[r.status]?.[0] ?? r.status }))
          : Object.entries(MERIT_STATUS_LABELS).map(([k, v]) => ({ id: k, label: v[0] })),
        pipStatuses: pipStats.length > 0
          ? pipStats.map((r) => ({ id: r.status, label: PIP_STATUS_LABELS[r.status]?.[0] ?? r.status }))
          : Object.entries(PIP_STATUS_LABELS).map(([k, v]) => ({ id: k, label: v[0] })),
        sessions: sessions.map((s) => ({ id: s.id, label: `${s.cycle.code} · ${dateID(s.heldAt)}` })),
        defaultCycleId: defaultCycle?.id ?? null,
      });
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (pf11…pf44)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const sp = req.nextUrl.searchParams;
    const yearParam = sp.get("year");
    const groupByParam = sp.get("groupBy");
    const fp: ReportFilters = {
      cycle: sp.get("cycle") || null,
      year: yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null,
      unit: sp.get("unit") || null,
      status: sp.get("status") || null,
      groupBy: groupByParam === "atasan" ? "atasan" : "unit",
      employee: sp.get("employee") || null,
      session: sp.get("session") || null,
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

    // ---- fetch utama (bulk + take-caps, mirror medical) ----
    const [company, cycles, units, positions, emps, kpiDefs, competencies, apprAll, kpiAll, compAll, checkins, f360All, sessionsAll, decisionsAll, merits, pips] = await Promise.all([
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
      db.performanceCycle.findMany({ orderBy: { periodStart: "asc" }, take: 100 }),
      db.orgUnit.findMany({ select: { id: true, code: true, name: true, parentId: true, level: true } }),
      db.position.findMany({ select: { id: true, title: true } }),
      db.employee.findMany({
        where: scopeCond,
        select: { id: true, employeeNo: true, fullName: true, status: true, orgUnitId: true, positionId: true },
        take: 1000,
      }),
      db.kpiDefinition.findMany({ select: { id: true, category: true }, take: 300 }),
      db.competency.findMany({ select: { id: true, name: true }, take: 200 }),
      db.appraisalRecord.findMany({
        select: {
          id: true, docNo: true, cycleId: true, employeeId: true, managerId: true,
          selfScore: true, managerScore: true, finalScore: true, finalRating: true, potentialBand: true,
          status: true, acknowledgedAt: true, appealNote: true, appealStatus: true,
          appealDecidedBy: true, appealDecidedAt: true, updatedAt: true,
        },
        orderBy: { docNo: "asc" },
        take: 500,
      }),
      db.appraisalKpi.findMany({
        select: {
          id: true, appraisalId: true, kpiDefId: true, title: true, polarity: true, unit: true,
          thresholdMin: true, target: true, stretchValue: true, weight: true, isCritical: true,
          dataSource: true, autoValueJson: true, midActual: true, finalActual: true, evidenceJson: true,
          origin: true, proposedBy: true,
        },
        take: 2500,
      }),
      db.appraisalCompetencyScore.findMany({
        select: { id: true, appraisalId: true, competencyId: true, score: true, selfScore: true },
        take: 2500,
      }),
      db.checkIn.findMany({ select: { id: true, appraisalId: true, heldAt: true, status: true }, take: 1000 }),
      db.feedback360.findMany({
        select: { id: true, appraisalId: true, reviewerType: true, status: true, submittedAt: true, answers: { select: { score: true } } },
        take: 1000,
      }),
      db.calibrationSession.findMany({
        select: { id: true, cycleId: true, orgUnitId: true, heldAt: true, participantsJson: true, chairId: true, notes: true },
        orderBy: { heldAt: "asc" },
        take: 200,
      }),
      db.calibrationDecision.findMany({
        select: {
          id: true, sessionId: true, appraisalId: true, oldScore: true, newScore: true,
          oldRating: true, newRating: true, potentialBand: true, reason: true, decidedBy: true, decidedAt: true,
        },
        orderBy: { decidedAt: "asc" },
        take: 1000,
      }),
      db.meritRecommendation.findMany({
        select: {
          id: true, docNo: true, appraisalId: true, bonusMonths: true, bonusAmount: true,
          raisePct: true, raiseAmount: true, note: true, status: true,
          personnelActionId: true, appliedRunNo: true, createdAt: true, updatedAt: true,
          appraisal: {
            select: {
              id: true, docNo: true, cycleId: true, finalRating: true,
              employee: { select: { id: true, employeeNo: true, fullName: true, orgUnitId: true } },
            },
          },
        },
        orderBy: { docNo: "asc" },
        take: 500,
      }),
      db.pipPlan.findMany({
        select: {
          id: true, docNo: true, employeeId: true, appraisalId: true, startDate: true, endDate: true,
          targetsJson: true, reviewerId: true, status: true, outcomeNotes: true, createdAt: true,
          employee: { select: { employeeNo: true, fullName: true, orgUnitId: true } },
          reviewer: { select: { fullName: true } },
          checkpoints: { select: { id: true, seq: true, achievementPct: true, status: true }, orderBy: { seq: "asc" } },
        },
        orderBy: { docNo: "asc" },
        take: 500,
      }),
    ]);

    // ---- maps & enrichment ----
    const unitById = new Map(units.map((u) => [u.id, u]));
    const unitNameOf = (unitId: string | null) => (unitId ? unitById.get(unitId)?.name ?? null : null);
    const posNameOf = (posId: string | null) => {
      if (!posId) return null;
      return positions.find((p) => p.id === posId)?.title ?? null;
    };
    const empById = new Map(emps.map((e) => [e.id, e]));
    const compNameOf = new Map(competencies.map((c) => [c.id, c.name]));
    const kpiCatOf = new Map(kpiDefs.map((k) => [k.id, k.category]));
    const cycleById = new Map(cycles.map((c) => [c.id, c]));
    const scales = await db.ratingScale.findMany();
    const scaleOf = new Map(scales.map((s) => [s.value, s]));
    const decMoney = (v: string | null | undefined) => tc.decryptMoney(v) ?? 0;

    /** Skor efektif "pasca kalibrasi" (final) — fallback manager (P4). */
    const effScore = (a: (typeof apprAll)[number]) => a.finalScore ?? a.managerScore;

    // cakupan akses → appraisal yang boleh dibaca
    const scopedIds = new Set(emps.map((e) => e.id));
    const apprs = apprAll.filter((a) => scopedIds.has(a.employeeId));
    const sortByNo = (a: { employeeNo: string }, b: { employeeNo: string }) => a.employeeNo.localeCompare(b.employeeNo, "id", { numeric: true });

    // subtre unit (pf13/pf21/pf44 — unit beserta turunannya)
    const unitSubtreeIds = (rootId: string): Set<string> => {
      const ids = new Set<string>();
      const walk = (pid: string) => {
        ids.add(pid);
        for (const u of units) if (u.parentId === pid) walk(u.id);
      };
      walk(rootId);
      return ids;
    };

    // manager name map (dari karyawan scoped — cukup utk label)
    const mgrIds = [...new Set(apprs.map((a) => a.managerId).filter((x): x is string => !!x))];
    const mgrRows = mgrIds.length > 0
      ? await db.employee.findMany({ where: { id: { in: mgrIds } }, select: { id: true, fullName: true } })
      : [];
    const mgrNameOf = new Map(mgrRows.map((r) => [r.id, r.fullName]));

    // ---- chip parameter terpasang (kop dokumen) ----
    const cycleOf = fp.cycle ? cycleById.get(fp.cycle) : undefined;
    const empOf = fp.employee ? empById.get(fp.employee) : undefined;
    const statusLabelOf = (v: string): string =>
      id === "pf11" ? (CYCLE_STATUS_LABELS[v]?.[0] ?? v)
      : id === "pf41" ? (MERIT_STATUS_LABELS[v]?.[0] ?? v)
      : id === "pf42" ? (PIP_STATUS_LABELS[v]?.[0] ?? v)
      : (APPRAISAL_STATUS_LABELS[v]?.[0] ?? v);
    const statusKeyLabel = id === "pf11" ? "Status Siklus" : id === "pf41" ? "Status Merit" : id === "pf42" ? "Status PIP" : "Status Penilaian";
    const filterChips: { label: string; value: string }[] = [];
    if (cycleOf) filterChips.push({ label: "Siklus", value: cycleOf.code });
    if (empOf) filterChips.push({ label: "Karyawan", value: `${empOf.employeeNo} — ${empOf.fullName}` });
    if (fp.unit) {
      const u = unitById.get(fp.unit);
      if (u) filterChips.push({ label: "Unit", value: u.name });
    }
    if (fp.status) filterChips.push({ label: statusKeyLabel, value: statusLabelOf(fp.status) });
    if (id === "pf22") filterChips.push({ label: "Kelompok", value: fp.groupBy === "atasan" ? "Atasan Penilai" : "Unit Kerja" });
    if (fp.session) {
      const ses = sessionsAll.find((s) => s.id === fp.session);
      if (ses) filterChips.push({ label: "Sesi", value: `${cycleById.get(ses.cycleId)?.code ?? "—"} · ${dateID(ses.heldAt)}` });
    }
    if (fp.year) filterChips.push({ label: "Tahun", value: String(fp.year) });

    const meta = {
      companyName: company?.name ?? "Perusahaan",
      companyAddress: company?.address ?? null,
      companyCity: company?.city ?? null,
      companyTaxId: company?.taxId ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      branchLabel: "Seluruh Unit & Cabang",
      printedBy: m.actor.name,
      generatedAt: now.toISOString(),
      year: now.getFullYear(),
      scope: scope.all ? "all" : "scoped",
      filters: filterChips,
    };

    // ---- validasi parameter wajib (400 — bukan 500 dari throw builder) ----
    const CYCLE_REQUIRED = new Set(["pf12", "pf13", "pf21", "pf22", "pf24", "pf31", "pf32", "pf41", "pf43"]);
    if (CYCLE_REQUIRED.has(id) && !fp.cycle) {
      return NextResponse.json({ error: "Parameter siklus wajib — pilih siklus penilaian terlebih dahulu" }, { status: 400 });
    }
    if (id === "pf23" && !fp.employee) {
      return NextResponse.json({ error: "Parameter karyawan wajib — pilih karyawan terlebih dahulu (register riwayat PP 35/2021 §7.2)" }, { status: 400 });
    }

    // ---- konteks builder ----
    const ctx: Ctx = {
      db, apprs, kpiAll, compAll, checkins, f360All, sessionsAll, decisionsAll, merits, pips,
      cycles, cycleById, empById, compNameOf, kpiCatOf, scaleOf, unitNameOf, posNameOf, mgrNameOf,
      effScore, unitSubtreeIds, sortByNo, fp, meta, mv, decMoney, now,
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
            action: "Exported", entity: "PerformanceReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan kinerja (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-performance-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: data.periodLabel }, data: data.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ tipe konteks ============

interface CtxEmp { id: string; employeeNo: string; fullName: string; status: string; orgUnitId: string | null; positionId: string | null }

interface Ctx {
  db: TenantDb;
  apprs: {
    id: string; docNo: string; cycleId: string; employeeId: string; managerId: string | null;
    selfScore: number | null; managerScore: number | null; finalScore: number | null; finalRating: number | null;
    potentialBand: number | null; status: string; acknowledgedAt: Date | null;
    appealNote: string | null; appealStatus: string | null; appealDecidedBy: string | null; appealDecidedAt: Date | null;
    updatedAt: Date;
  }[];
  kpiAll: {
    id: string; appraisalId: string; kpiDefId: string | null; title: string; polarity: string; unit: string;
    thresholdMin: number | null; target: number; stretchValue: number | null; weight: number; isCritical: boolean;
    dataSource: string; autoValueJson: string | null; midActual: number | null; finalActual: number | null;
    evidenceJson: string | null; origin: string; proposedBy: string;
  }[];
  compAll: { id: string; appraisalId: string; competencyId: string; score: number; selfScore: number | null }[];
  checkins: { id: string; appraisalId: string; heldAt: Date; status: string }[];
  f360All: { id: string; appraisalId: string; reviewerType: string; status: string; submittedAt: Date | null; answers: { score: number }[] }[];
  sessionsAll: { id: string; cycleId: string; orgUnitId: string | null; heldAt: Date; participantsJson: string; chairId: string | null; notes: string | null }[];
  decisionsAll: {
    id: string; sessionId: string; appraisalId: string; oldScore: number | null; newScore: number | null;
    oldRating: number | null; newRating: number | null; potentialBand: number | null; reason: string;
    decidedBy: string; decidedAt: Date;
  }[];
  merits: {
    id: string; docNo: string; appraisalId: string; bonusMonths: number | null; bonusAmount: string | null;
    raisePct: number | null; raiseAmount: string | null; note: string | null; status: string;
    personnelActionId: string | null; appliedRunNo: string | null; createdAt: Date; updatedAt: Date;
    appraisal: {
      id: string; docNo: string; cycleId: string; finalRating: number | null;
      employee: { id: string; employeeNo: string; fullName: string; orgUnitId: string | null };
    };
  }[];
  pips: {
    id: string; docNo: string; employeeId: string; appraisalId: string | null; startDate: Date; endDate: Date;
    targetsJson: string; reviewerId: string; status: string; outcomeNotes: string | null; createdAt: Date;
    employee: { employeeNo: string; fullName: string; orgUnitId: string | null };
    reviewer: { fullName: string } | null;
    checkpoints: { id: string; seq: number; achievementPct: number | null; status: string }[];
  }[];
  cycles: {
    id: string; code: string; name: string; cycleType: string; periodStart: Date; periodEnd: Date;
    goalStart: Date | null; goalEnd: Date | null; midStart: Date | null; midEnd: Date | null;
    selfStart: Date | null; selfEnd: Date | null; mgrStart: Date | null; mgrEnd: Date | null;
    calibStart: Date | null; calibEnd: Date | null; publishAt: Date | null; status: string;
  }[];
  cycleById: Map<string, Ctx["cycles"][number]>;
  empById: Map<string, CtxEmp>;
  compNameOf: Map<string, string>;
  kpiCatOf: Map<string, string>;
  scaleOf: Map<number, { value: number; labelId: string; labelEn: string; color: string }>;
  unitNameOf: (unitId: string | null) => string | null;
  posNameOf: (posId: string | null) => string | null;
  mgrNameOf: Map<string, string>;
  effScore: (a: Ctx["apprs"][number]) => number | null;
  unitSubtreeIds: (rootId: string) => Set<string>;
  sortByNo: (a: { employeeNo: string }, b: { employeeNo: string }) => number;
  fp: ReportFilters;
  meta: {
    companyName: string; companyAddress: string | null; companyCity: string | null;
    companyTaxId: string | null; companyLogoUrl: string | null; branchLabel: string;
    printedBy: string; generatedAt: string; year: number; scope: string;
    filters: { label: string; value: string }[];
  };
  mv: Awaited<ReturnType<typeof moneyViewForReq>>;
  decMoney: (v: string | null | undefined) => number;
  now: Date;
}

async function buildReport(id: string, ctx: Ctx): Promise<{ periodLabel: string; payload: unknown }> {
  switch (id) {
    case "pf11": return pf11Cycles(ctx);
    case "pf12": return pf12Completion(ctx);
    case "pf13": return pf13KpiRegister(ctx);
    case "pf21": return pf21Results(ctx);
    case "pf22": return pf22Distribution(ctx);
    case "pf23": return pf23EmployeeDetail(ctx);
    case "pf24": return pf24ThreeSixty(ctx);
    case "pf31": return pf31Calibration(ctx);
    case "pf32": return pf32Bias(ctx);
    case "pf33": return pf33Appeals(ctx);
    case "pf41": return pf41Merit(ctx);
    case "pf42": return pf42Pips(ctx);
    case "pf43": return pf43NineBox(ctx);
    default: return pf44Trend(ctx);
  }
}

/** Fase aktif siklus berdasar jendela & waktu kini. */
function activePhaseOf(c: Ctx["cycles"][number], now: Date): string | null {
  const inWin = (s: Date | null, e: Date | null) => !!(s && e && now >= s && now <= e);
  if (inWin(c.goalStart, c.goalEnd)) return "Target";
  if (inWin(c.midStart, c.midEnd)) return "Tengah Tahun";
  if (inWin(c.selfStart, c.selfEnd)) return "Penilaian Diri";
  if (inWin(c.mgrStart, c.mgrEnd)) return "Penilaian Atasan";
  if (inWin(c.calibStart, c.calibEnd)) return "Kalibrasi";
  return null;
}

// ===================== G1 — SIKLUS & PARTISIPASI =====================

// ---------- pf11 Register Siklus & Fase ----------
function pf11Cycles(ctx: Ctx): { periodLabel: string; payload: PF11Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const sel = ctx.cycles.filter((c) =>
    c.periodStart.getFullYear() === year && (!ctx.fp.status || c.status === ctx.fp.status));
  const rows: PF11Data["rows"] = [];
  let totalParticipants = 0;
  for (const c of sel) {
    const part = ctx.apprs.filter((a) => a.cycleId === c.id);
    const goalsLocked = part.filter((a) => LOCKED.includes(a.status)).length;
    const published = part.filter((a) => ["Published", "Appealed", "Closed"].includes(a.status)).length;
    const win = (s: Date | null, e: Date | null, lbl: string) => (s && e ? `${lbl}: ${dateID(s)}–${dateID(e)}` : null);
    const phases = [
      win(c.goalStart, c.goalEnd, "Target"),
      win(c.midStart, c.midEnd, "Mid"),
      win(c.selfStart, c.selfEnd, "Diri"),
      win(c.mgrStart, c.mgrEnd, "Atasan"),
      win(c.calibStart, c.calibEnd, "Kal"),
    ].filter(Boolean).join(" · ") || "—";
    rows.push({
      code: c.code, name: c.name,
      cycleType: CYCLE_TYPE_LABELS[c.cycleType]?.[0] ?? c.cycleType,
      period: `${dateID(c.periodStart)} – ${dateID(c.periodEnd)}`,
      phases,
      activePhase: activePhaseOf(c, ctx.now),
      status: CYCLE_STATUS_LABELS[c.status]?.[0] ?? c.status,
      participants: part.length, goalsLocked, resultsPublished: published,
    });
    totalParticipants += part.length;
  }
  const statusChip = ctx.fp.status ? ` — ${CYCLE_STATUS_LABELS[ctx.fp.status]?.[0] ?? ctx.fp.status}` : "";
  return {
    periodLabel: `Tahun ${year}${statusChip} · ${sel.length} siklus`,
    payload: {
      year,
      rows,
      total: { cycles: rows.length, participants: totalParticipants },
    },
  };
}

// ---------- pf12 Completion per Fase ("siapa belum isi") ----------
function pf12Completion(ctx: Ctx): { periodLabel: string; payload: PF12Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const rows0 = ctx.apprs.filter((a) => a.cycleId === cycle.id);
  const kpisByAppr = new Map<string, Ctx["kpiAll"]>();
  for (const k of ctx.kpiAll) {
    const arr = kpisByAppr.get(k.appraisalId) ?? [];
    arr.push(k);
    kpisByAppr.set(k.appraisalId, arr);
  }
  const checkinCount = new Map<string, number>();
  for (const c of ctx.checkins) checkinCount.set(c.appraisalId, (checkinCount.get(c.appraisalId) ?? 0) + 1);

  const rows: PF12Data["rows"] = rows0.map((a) => {
    const e = ctx.empById.get(a.employeeId);
    const kpis = kpisByAppr.get(a.id) ?? [];
    const selfSubmitted = a.selfScore != null || SELF_DONE.includes(a.status);
    const managerDone = MGR_DONE.includes(a.status);
    const goalLocked = LOCKED.includes(a.status);
    const missing: string[] = [];
    if (!goalLocked) missing.push("Target");
    if (!selfSubmitted) missing.push("Penilaian Diri");
    if (!managerDone) missing.push("Penilaian Atasan");
    return {
      employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?",
      unit: ctx.unitNameOf(e?.orgUnitId ?? null), position: ctx.posNameOf(e?.positionId ?? null),
      status: APPRAISAL_STATUS_LABELS[a.status]?.[0] ?? a.status,
      kpiCount: kpis.length,
      totalWeight: kpis.length ? round2(kpis.reduce((s, k) => s + k.weight, 0)) : null,
      selfSubmitted, managerDone,
      checkinCount: checkinCount.get(a.id) ?? 0,
      missing,
    };
  }).sort(ctx.sortByNo);

  const total = rows.length;
  const targetDone = rows.filter((r) => !r.missing.includes("Target")).length;
  const selfDone = rows.filter((r) => r.selfSubmitted).length;
  const managerDone = rows.filter((r) => r.managerDone).length;
  return {
    periodLabel: `Siklus ${cycle.code} · ${dateID(cycle.periodStart)} – ${dateID(cycle.periodEnd)}`,
    payload: {
      cycleCode: cycle.code, cycleStatus: CYCLE_STATUS_LABELS[cycle.status]?.[0] ?? cycle.status,
      rows,
      summary: {
        total, targetDone, selfDone, managerDone,
        selfPct: total ? Math.round((selfDone / total) * 100) : null,
        managerPct: total ? Math.round((managerDone / total) * 100) : null,
      },
    },
  };
}

// ---------- pf13 Register Penetapan KPI ----------
function pf13KpiRegister(ctx: Ctx): { periodLabel: string; payload: PF13Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const scopedUnit = ctx.fp.unit ? ctx.unitSubtreeIds(ctx.fp.unit) : null;
  const rows0 = ctx.apprs.filter((a) => a.cycleId === cycle.id);
  const rows: PF13Data["rows"] = [];
  const byEmp = new Map<string, { employeeNo: string; name: string; unit: string | null; kpiCount: number; sumWeight: number }>();
  for (const a of rows0) {
    const e = ctx.empById.get(a.employeeId);
    if (!e) continue;
    if (scopedUnit && (!e.orgUnitId || !scopedUnit.has(e.orgUnitId))) continue;
    const kpis = ctx.kpiAll.filter((k) => k.appraisalId === a.id);
    for (const k of kpis) {
      const isAuto = k.dataSource !== "Manual";
      let sourceKey: string | null = null;
      if (isAuto && k.autoValueJson) {
        try { sourceKey = String((JSON.parse(k.autoValueJson) as Record<string, unknown>).source ?? ""); } catch { sourceKey = null; }
      }
      rows.push({
        employeeNo: e.employeeNo, fullName: e.fullName, unit: ctx.unitNameOf(e.orgUnitId),
        title: k.title,
        category: k.kpiDefId ? ctx.kpiCatOf.get(k.kpiDefId) ?? "—" : "—",
        polarity: k.polarity,
        weight: k.weight,
        thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
        measure: k.unit,
        origin: ORIGIN_LABELS[k.origin]?.[0] ?? k.origin,
        source: isAuto ? `AUTO${sourceKey ? `: ${sourceKey}` : ""}` : "Manual",
        isCritical: k.isCritical,
      });
    }
    if (kpis.length > 0) {
      byEmp.set(a.employeeId, {
        employeeNo: e.employeeNo, name: e.fullName, unit: ctx.unitNameOf(e.orgUnitId),
        kpiCount: kpis.length, sumWeight: round2(kpis.reduce((s, k) => s + k.weight, 0)),
      });
    }
  }
  rows.sort((a, b) => ctx.sortByNo(a, b) || a.title.localeCompare(b.title, "id"));
  const unitChip = ctx.fp.unit ? ` — ${ctx.unitNameOf(ctx.fp.unit) ?? ""}` : "";
  return {
    periodLabel: `Siklus ${cycle.code} · ${rows.length} penetapan KPI${unitChip}`,
    payload: {
      cycleCode: cycle.code,
      rows,
      byEmployee: [...byEmp.values()].sort(ctx.sortByNo),
      total: rows.length,
    },
  };
}

// ===================== G2 — PENILAIAN & HASIL =====================

// ---------- pf21 Register Hasil per Periode ----------
function pf21Results(ctx: Ctx): { periodLabel: string; payload: PF21Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const scopedUnit = ctx.fp.unit ? ctx.unitSubtreeIds(ctx.fp.unit) : null;
  const calibratedIds = new Set(ctx.decisionsAll.map((d) => d.appraisalId));
  const rows: PF21Data["rows"] = ctx.apprs
    .filter((a) => a.cycleId === cycle.id)
    .filter((a) => !ctx.fp.status || a.status === ctx.fp.status)
    .filter((a) => {
      const e = ctx.empById.get(a.employeeId);
      return !scopedUnit || (!!e?.orgUnitId && scopedUnit.has(e.orgUnitId));
    })
    .map((a) => {
      const e = ctx.empById.get(a.employeeId);
      const sc = a.finalRating != null ? ctx.scaleOf.get(a.finalRating) : undefined;
      return {
        docNo: a.docNo, employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?",
        unit: ctx.unitNameOf(e?.orgUnitId ?? null), position: ctx.posNameOf(e?.positionId ?? null),
        managerName: a.managerId ? ctx.mgrNameOf.get(a.managerId) ?? null : null,
        selfScore: a.selfScore, managerScore: a.managerScore,
        finalScore: a.finalScore, finalRating: a.finalRating,
        ratingLabel: sc?.labelId ?? null, ratingLabelEn: sc?.labelEn ?? null,
        status: APPRAISAL_STATUS_LABELS[a.status]?.[0] ?? a.status,
        calibrated: calibratedIds.has(a.id),
        appealStatus: a.appealStatus,
      };
    })
    .sort(ctx.sortByNo);
  const scored = rows.filter((r) => r.finalScore != null);
  const ratings = { r1: 0, r2: 0, r3: 0, r4: 0, r5: 0 };
  for (const r of rows) if (r.finalRating != null && r.finalRating >= 1 && r.finalRating <= 5) ratings[`r${r.finalRating}` as "r1"]++;
  return {
    periodLabel: `Siklus ${cycle.code} · ${dateID(cycle.periodStart)} – ${dateID(cycle.periodEnd)}`,
    payload: {
      cycleCode: cycle.code,
      rows,
      summary: {
        n: rows.length,
        avgFinal: scored.length ? round2(mean(scored.map((r) => r.finalScore as number))) : null,
        ratings,
      },
    },
  };
}

// ---------- pf22 Distribusi Rating per Unit/Atasan ----------
function pf22Distribution(ctx: Ctx): { periodLabel: string; payload: PF22Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const rows0 = ctx.apprs.filter((a) => a.cycleId === cycle.id && a.finalRating != null);
  const mkRow = (label: string): PF22Row => ({ label, n: 0, r1: 0, r2: 0, r3: 0, r4: 0, r5: 0, avg: null });
  const groups = new Map<string, { row: PF22Row; scores: number[] }>();
  for (const a of rows0) {
    const e = ctx.empById.get(a.employeeId);
    const key = ctx.fp.groupBy === "atasan"
      ? a.managerId ?? "__none__"
      : e?.orgUnitId ?? "__none__";
    const label = ctx.fp.groupBy === "atasan"
      ? (a.managerId ? ctx.mgrNameOf.get(a.managerId) ?? "(tanpa atasan)" : "(tanpa atasan)")
      : ctx.unitNameOf(e?.orgUnitId ?? null) ?? "(tanpa unit)";
    let g = groups.get(key);
    if (!g) { g = { row: mkRow(label), scores: [] }; groups.set(key, g); }
    g.row.n++;
    const rt = a.finalRating as number;
    if (rt >= 1 && rt <= 5) g.row[`r${rt}` as "r1"]++;
    const sc = ctx.effScore(a);
    if (sc != null) g.scores.push(sc);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g.row,
    avg: g.scores.length ? round2(mean(g.scores)) : null,
  })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "id"));
  const total = mkRow("Total Perusahaan");
  for (const r of rows) {
    total.n += r.n; total.r1 += r.r1; total.r2 += r.r2; total.r3 += r.r3; total.r4 += r.r4; total.r5 += r.r5;
  }
  const allScores = rows0.map((a) => ctx.effScore(a)).filter((s): s is number => s != null);
  total.avg = allScores.length ? round2(mean(allScores)) : null;
  const groupChip = ctx.fp.groupBy === "atasan" ? " · per Atasan" : " · per Unit";
  return {
    periodLabel: `Siklus ${cycle.code}${groupChip} · ${rows0.length} dinilai`,
    payload: { cycleCode: cycle.code, groupBy: ctx.fp.groupBy, rows, total },
  };
}

// ---------- pf23 Detail Skor per Karyawan (PP 35/2021 §7.2) ----------
function pf23EmployeeDetail(ctx: Ctx): { periodLabel: string; payload: PF23Data } {
  const emp = ctx.fp.employee ? ctx.empById.get(ctx.fp.employee) : undefined;
  if (!emp) throw new Error("Parameter karyawan wajib (pilih karyawan terlebih dahulu)");
  const mine = ctx.apprs.filter((a) => a.employeeId === emp.id);
  // keputusan kalibrasi per appraisal (urut waktu)
  const decisionsByAppr = new Map<string, Ctx["decisionsAll"]>();
  for (const d of ctx.decisionsAll) {
    if (!mine.some((a) => a.id === d.appraisalId)) continue;
    const arr = decisionsByAppr.get(d.appraisalId) ?? [];
    arr.push(d);
    decisionsByAppr.set(d.appraisalId, arr);
  }

  const history: PF23HistoryRow[] = mine
    .map((a) => {
      const c = ctx.cycleById.get(a.cycleId);
      const ds = decisionsByAppr.get(a.id) ?? [];
      const sc = a.finalRating != null ? ctx.scaleOf.get(a.finalRating) : undefined;
      return {
        docNo: a.docNo, cycleCode: c?.code ?? "?",
        period: c ? `${dateID(c.periodStart)} – ${dateID(c.periodEnd)}` : "—",
        status: APPRAISAL_STATUS_LABELS[a.status]?.[0] ?? a.status,
        finalScore: a.finalScore, finalRating: a.finalRating,
        ratingLabel: sc?.labelId ?? null,
        calibratedFrom: ds.length ? ds[0].oldScore ?? null : null,
        calibratedTo: ds.length ? ds[ds.length - 1].newScore ?? null : null,
        appealStatus: a.appealStatus,
        appealDecision: a.appealStatus ? APPEAL_STATUS_LABELS[a.appealStatus]?.[0] ?? a.appealStatus : null,
        acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
        _start: c?.periodStart.getTime() ?? 0,
      };
    })
    .sort((a, b) => a._start - b._start)
    .map(({ _start, ...r }) => r);

  // mode siklus spesifik → detail penuh
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  let detail: PF23Detail | null = null;
  if (cycle) {
    const a = mine.find((x) => x.cycleId === cycle.id);
    if (a) {
      const kpis: PF23Detail["kpis"] = ctx.kpiAll
        .filter((k) => k.appraisalId === a.id)
        .map((k) => {
          let evidence = false;
          if (k.evidenceJson) { try { evidence = (JSON.parse(k.evidenceJson) as unknown[]).length > 0; } catch { evidence = false; } }
          return {
            title: k.title, weight: k.weight,
            thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue,
            actual: k.finalActual, midActual: k.midActual,
            source: k.dataSource !== "Manual" ? "AUTO" : "Manual",
            evidence,
          };
        });
      const comps: PF23Detail["comps"] = ctx.compAll
        .filter((c) => c.appraisalId === a.id)
        .map((c) => ({ name: ctx.compNameOf.get(c.competencyId) ?? "?", score: c.score, selfScore: c.selfScore }));
      const f360rows = ctx.f360All.filter((f) => f.appraisalId === a.id);
      const submitted = f360rows.filter((f) => f.status === "Submitted");
      const allAnswerScores = submitted.flatMap((f) => f.answers.map((x) => x.score));
      const f360 = f360rows.length > 0
        ? {
            invited: f360rows.length, submitted: submitted.length,
            avg: allAnswerScores.length ? round2(mean(allAnswerScores)) : null,
          }
        : null;
      detail = {
        cycleCode: cycle.code, docNo: a.docNo, status: APPRAISAL_STATUS_LABELS[a.status]?.[0] ?? a.status,
        finalScore: a.finalScore, finalRating: a.finalRating, potentialBand: a.potentialBand,
        kpis, comps, f360,
        calibration: (decisionsByAppr.get(a.id) ?? []).map((d) => ({
          decidedAt: d.decidedAt.toISOString(),
          oldScore: d.oldScore, newScore: d.newScore, oldRating: d.oldRating, newRating: d.newRating,
          reason: d.reason, decidedBy: d.decidedBy,
        })),
        appeal: a.appealStatus || a.appealNote
          ? { status: a.appealStatus, note: a.appealNote, decidedBy: a.appealDecidedBy, decidedAt: a.appealDecidedAt?.toISOString() ?? null }
          : null,
      };
    }
  }

  const periodLabel = cycle
    ? `Siklus ${cycle.code} · ${dateID(cycle.periodStart)} – ${dateID(cycle.periodEnd)}`
    : `Seluruh riwayat per ${dateID(ctx.now)} · ${mine.length} siklus`;
  return {
    periodLabel,
    payload: {
      employeeNo: emp.employeeNo, fullName: emp.fullName, unit: ctx.unitNameOf(emp.orgUnitId),
      mode: cycle ? "cycle" : "history",
      history, detail,
      note: "PP 35/2021 §7.2 — riwayat penilaian kinerja wajib eksporabel & ter-audit (dasar keputusan konversi/perpanjangan PKWT).",
    },
  };
}

// ---------- pf24 Ringkasan 360 Ter-agregasi (anonim ≥3) ----------
function pf24ThreeSixty(ctx: Ctx): { periodLabel: string; payload: PF24Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const THRESHOLD = 3; // ambang anonimitas aggregate360 (P3)
  const apprInCycle = new Set(ctx.apprs.filter((a) => a.cycleId === cycle.id).map((a) => a.id));
  const byAppr = new Map<string, Ctx["f360All"]>();
  for (const f of ctx.f360All) {
    if (!apprInCycle.has(f.appraisalId)) continue;
    const arr = byAppr.get(f.appraisalId) ?? [];
    arr.push(f);
    byAppr.set(f.appraisalId, arr);
  }
  const rows: PF24Row[] = [];
  let sumInvited = 0, sumSubmitted = 0, hiddenCount = 0;
  for (const [appraisalId, fs] of byAppr) {
    const a = ctx.apprs.find((x) => x.id === appraisalId);
    if (!a) continue;
    const e = ctx.empById.get(a.employeeId);
    const invited = fs.length;
    const submitted = fs.filter((f) => f.status === "Submitted");
    const hidden = submitted.length < THRESHOLD;
    // rata-rata per kategori reviewer — HANYA bila ambang anonimitas terpenuhi
    const catAvg = (type: string): number | null => {
      const scores = submitted.filter((f) => f.reviewerType === type).flatMap((f) => f.answers.map((x) => x.score));
      return scores.length ? round2(mean(scores)) : null;
    };
    const allScores = submitted.flatMap((f) => f.answers.map((x) => x.score));
    rows.push({
      employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?", unit: ctx.unitNameOf(e?.orgUnitId ?? null),
      invited, submitted: submitted.length,
      participationPct: invited ? Math.round((submitted.length / invited) * 100) : null,
      peer: hidden ? null : catAvg("Peer"),
      subordinate: hidden ? null : catAvg("Subordinate"),
      crossTeam: hidden ? null : catAvg("CrossTeam"),
      upward: hidden ? null : catAvg("Upward"),
      overall: hidden ? null : (allScores.length ? round2(mean(allScores)) : null),
      hidden,
    });
    sumInvited += invited; sumSubmitted += submitted.length;
    if (hidden) hiddenCount++;
  }
  rows.sort(ctx.sortByNo);
  return {
    periodLabel: `Siklus ${cycle.code} · ambang anonimitas ≥${THRESHOLD}`,
    payload: {
      cycleCode: cycle.code, threshold: THRESHOLD, rows,
      summary: {
        invited: sumInvited, submitted: sumSubmitted,
        participationPct: sumInvited ? Math.round((sumSubmitted / sumInvited) * 100) : null,
        hidden: hiddenCount,
      },
    },
  };
}

// ===================== G3 — KUALITAS & KEPATUHAN =====================

// ---------- pf31 Jejak Kalibrasi ----------
function pf31Calibration(ctx: Ctx): { periodLabel: string; payload: PF31Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const sessions = ctx.sessionsAll
    .filter((s) => s.cycleId === cycle.id && (!ctx.fp.session || s.id === ctx.fp.session));
  const labelOf = (s: Ctx["sessionsAll"][number]): string =>
    `${ctx.cycleById.get(s.cycleId)?.code ?? "?"} · ${dateID(s.heldAt)}`;
  const sessionsOut: PF31Session[] = [];
  const sessionLabelById = new Map<string, string>();
  let closedInfo: "Terbuka" | "Tertutup" = "Terbuka";
  for (const s of sessions) {
    let participants: string[] = [];
    let closedAt: string | undefined;
    try {
      const v = JSON.parse(s.participantsJson) as unknown;
      if (Array.isArray(v)) participants = v.map(String);
      else if (v && typeof v === "object" && Array.isArray((v as { participants?: string[] }).participants)) {
        participants = (v as { participants: string[] }).participants;
        closedAt = (v as { closedAt?: string }).closedAt;
      }
    } catch { participants = []; }
    const decisions = ctx.decisionsAll.filter((d) => d.sessionId === s.id);
    const chair = s.chairId ? ctx.empById.get(s.chairId)?.fullName ?? null : null;
    const label = labelOf(s);
    sessionLabelById.set(s.id, label);
    sessionsOut.push({
      id: s.id, label, chair,
      participants: participants.length,
      status: closedAt ? "Tertutup" : "Terbuka",
      decisions: decisions.length,
    });
  }
  void closedInfo;
  const apprById = new Map(ctx.apprs.map((a) => [a.id, a]));
  const rows: PF31Row[] = ctx.decisionsAll
    .filter((d) => sessionLabelById.has(d.sessionId))
    .map((d) => {
      const a = apprById.get(d.appraisalId);
      const e = a ? ctx.empById.get(a.employeeId) : undefined;
      return {
        sessionLabel: sessionLabelById.get(d.sessionId) ?? "?",
        chair: sessions.find((s) => s.id === d.sessionId)?.chairId ? ctx.empById.get(sessions.find((s) => s.id === d.sessionId)!.chairId!)?.fullName ?? null : null,
        employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?",
        unit: ctx.unitNameOf(e?.orgUnitId ?? null),
        oldScore: d.oldScore, newScore: d.newScore, oldRating: d.oldRating, newRating: d.newRating,
        potentialBand: d.potentialBand, reason: d.reason, decidedBy: d.decidedBy,
        decidedAt: d.decidedAt.toISOString(),
      };
    })
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  const totalScoreDelta = round2(rows.reduce((s, r) => s + ((r.newScore ?? 0) - (r.oldScore ?? 0)), 0));
  return {
    periodLabel: `Siklus ${cycle.code} · ${rows.length} keputusan ter-audit`,
    payload: { cycleCode: cycle.code, sessions: sessionsOut, rows, summary: { decisions: rows.length, sessions: sessionsOut.length, totalScoreDelta } },
  };
}

// ---------- pf32 Indikator Bias Atasan (z-score D19) ----------
function pf32Bias(ctx: Ctx): { periodLabel: string; payload: PF32Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const scored = ctx.apprs.filter((a) => a.cycleId === cycle.id && SCORED.includes(a.status) && ctx.effScore(a) != null);
  const allScores = scored.map((a) => ctx.effScore(a) as number);
  const cMean = mean(allScores);
  const cSigma = stdev(allScores);
  const byMgr = new Map<string | null, { name: string; scores: number[] }>();
  for (const a of scored) {
    const k = a.managerId ?? "__none__";
    const nm = a.managerId ? ctx.mgrNameOf.get(a.managerId) ?? "(tanpa atasan)" : "(tanpa atasan)";
    if (!byMgr.has(k)) byMgr.set(k, { name: nm, scores: [] });
    byMgr.get(k)!.scores.push(ctx.effScore(a) as number);
  }
  const rows: PF32Row[] = [...byMgr.entries()]
    .filter(([, g]) => g.scores.length >= 2) // ≥2 bawahan dinilai agar statistik bermakna
    .map(([mid, g]) => {
      const gm = mean(g.scores);
      const gs = stdev(g.scores);
      const z = cSigma > 0 ? round2((gm - cMean) / cSigma) : null;
      let flag: PF32Row["flag"] = null;
      let flagLevel: PF32Row["flagLevel"] = null;
      if (z != null) {
        if (Math.abs(z) >= 2) { flag = z < 0 ? "strictness" : "leniency"; flagLevel = "red"; }
        else if (z <= -1) { flag = "strictness"; flagLevel = "amber"; }
        else if (z >= 1) { flag = "leniency"; flagLevel = "amber"; }
      }
      return {
        managerId: mid === "__none__" ? null : mid,
        managerName: g.name,
        n: g.scores.length, meanScore: round2(gm), stdDev: round2(gs),
        z, flag, flagLevel,
        centralTendency: cSigma > 0 && gs > 0 && gs < cSigma / 2,
      };
    })
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  return {
    periodLabel: `Siklus ${cycle.code} · ${scored.length} penilaian ber-skor`,
    payload: {
      cycleCode: cycle.code,
      company: { n: allScores.length, mean: round2(cMean), sigma: round2(cSigma) },
      rows,
      summary: { flagged: rows.filter((r) => r.flag).length },
    },
  };
}

// ---------- pf33 Register Banding ----------
function pf33Appeals(ctx: Ctx): { periodLabel: string; payload: PF33Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const rows: PF33Row[] = ctx.apprs
    .filter((a) => a.appealStatus != null)
    .filter((a) => {
      const c = ctx.cycleById.get(a.cycleId);
      return c ? c.periodStart.getFullYear() === year : false;
    })
    .map((a) => {
      const c = ctx.cycleById.get(a.cycleId);
      const e = ctx.empById.get(a.employeeId);
      // skor awal banding = skor pasca-kalibrasi (jejak lama ada di pf31)
      const decs = ctx.decisionsAll.filter((d) => d.appraisalId === a.id);
      const original = decs.length ? decs[0].oldScore : a.finalScore;
      const newScore = a.appealStatus === "Adjusted" ? a.finalScore : null;
      return {
        docNo: a.docNo, employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?",
        unit: ctx.unitNameOf(e?.orgUnitId ?? null), cycleCode: c?.code ?? "?",
        score: original, rating: a.finalRating,
        appealNote: a.appealNote ?? "—",
        appealDate: (a.appealDecidedAt ?? a.updatedAt).toISOString(),
        decision: a.appealStatus ? APPEAL_STATUS_LABELS[a.appealStatus]?.[0] ?? a.appealStatus : null,
        newScore,
        decidedBy: a.appealDecidedBy, decidedAt: a.appealDecidedAt?.toISOString() ?? null,
      };
    })
    .sort(ctx.sortByNo);
  const adjusted = rows.filter((r) => r.decision === APPEAL_STATUS_LABELS.Adjusted[0]).length;
  const rejected = rows.filter((r) => r.decision === APPEAL_STATUS_LABELS.Rejected[0]).length;
  const open = rows.filter((r) => r.decision === APPEAL_STATUS_LABELS.Submitted[0]).length;
  return {
    periodLabel: `Tahun ${year} · ${rows.length} banding`,
    payload: {
      year, rows,
      summary: { appeals: rows.length, adjusted, rejected, open },
    },
  };
}

// ===================== G4 — KONSEKUENSI & ANALITIK =====================

// ---------- pf41 Register Merit (vault) ----------
async function pf41Merit(ctx: Ctx): Promise<{ periodLabel: string; payload: PF41Data }> {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const sel = ctx.merits.filter((m) => m.appraisal.cycleId === cycle.id && (!ctx.fp.status || m.status === ctx.fp.status));
  const canSee = ctx.mv.canSee;
  const g = (n: number) => (canSee ? n : null);
  const chains = await attachChainSummaries(ctx.db, "MeritRecommendation", sel.map((m) => ({ id: m.id })));
  const rows: PF41Row[] = sel.map((m) => {
    const e = m.appraisal.employee;
    const sc = m.appraisal.finalRating != null ? ctx.scaleOf.get(m.appraisal.finalRating) : undefined;
    const bonus = ctx.decMoney(m.bonusAmount);
    const raise = ctx.decMoney(m.raiseAmount);
    const c = chains.get(m.id) ?? null;
    return {
      docNo: m.docNo, employeeNo: e.employeeNo, fullName: e.fullName, unit: ctx.unitNameOf(e.orgUnitId),
      appraisalNo: m.appraisal.docNo, rating: m.appraisal.finalRating, ratingLabel: sc?.labelId ?? null,
      bonusMonths: m.bonusMonths, raisePct: m.raisePct,
      bonusAmount: g(bonus), raiseAmount: g(raise), totalAmount: g(bonus + raise),
      status: MERIT_STATUS_LABELS[m.status]?.[0] ?? m.status,
      approval: c ? { status: c.status, currentLevel: c.currentLevel, totalLevels: c.totalLevels, currentApprover: c.currentApprover } : null,
      appliedRunNo: m.appliedRunNo, personnelActionId: m.personnelActionId,
      appliedAt: m.status === "Applied" ? m.updatedAt.toISOString() : null,
      note: m.note,
    };
  }).sort(ctx.sortByNo);
  const sumMoney = (pick: (r: PF41Row) => number | null): number | null => {
    let out: number | null = 0;
    for (const r of rows) {
      const v = pick(r);
      if (v == null || out == null) out = null;
      else out += v;
    }
    return out;
  };
  return {
    periodLabel: `Siklus ${cycle.code} · ${rows.length} usulan merit`,
    payload: {
      cycleCode: cycle.code, masked: !canSee, rows,
      summary: {
        n: rows.length,
        sumBonus: sumMoney((r) => r.bonusAmount),
        sumRaise: sumMoney((r) => r.raiseAmount),
        sumTotal: sumMoney((r) => r.totalAmount),
      },
    },
  };
}

// ---------- pf42 Register PIP & Outcome ----------
function pf42Pips(ctx: Ctx): { periodLabel: string; payload: PF42Data } {
  const year = ctx.fp.year ?? ctx.now.getFullYear();
  const sel = ctx.pips.filter((p) => p.startDate.getFullYear() === year && (!ctx.fp.status || p.status === ctx.fp.status));
  const rows: PF42Row[] = sel.map((p) => {
    let targets: unknown[] = [];
    try { targets = JSON.parse(p.targetsJson) as unknown[]; } catch { targets = []; }
    const reviewed = p.checkpoints.filter((c) => c.achievementPct != null);
    const last = reviewed[reviewed.length - 1];
    const extDays = Math.round((p.endDate.getTime() - p.startDate.getTime()) / 86_400_000);
    return {
      docNo: p.docNo, employeeNo: p.employee.employeeNo, fullName: p.employee.fullName,
      unit: ctx.unitNameOf(p.employee.orgUnitId),
      period: `${dateID(p.startDate)} – ${dateID(p.endDate)}`,
      extended: extDays > 100 || p.status === "Extended",
      targetsCount: Array.isArray(targets) ? targets.length : 0,
      checkpoints: p.checkpoints.map((c) => `${c.seq}: ${c.achievementPct != null ? `${round1(c.achievementPct)}%` : "—"}`).join(" · ") || "—",
      lastReviewPct: last?.achievementPct != null ? round1(last.achievementPct) : null,
      status: PIP_STATUS_LABELS[p.status]?.[0] ?? p.status,
      reviewer: p.reviewer?.fullName ?? null,
      note: p.outcomeNotes,
    };
  }).sort(ctx.sortByNo);
  const closed = rows.filter((r) => [PIP_STATUS_LABELS.Recovered[0], PIP_STATUS_LABELS.NotRecovered[0]].includes(r.status));
  const recovered = rows.filter((r) => r.status === PIP_STATUS_LABELS.Recovered[0]).length;
  return {
    periodLabel: `Tahun ${year} · ${rows.length} program PIP`,
    payload: {
      year, rows,
      summary: {
        n: rows.length, recovered,
        active: rows.filter((r) => [PIP_STATUS_LABELS.Active[0], PIP_STATUS_LABELS.Extended[0]].includes(r.status)).length,
        recoveryRate: closed.length ? Math.round((recovered / closed.length) * 100) : null,
      },
    },
  };
}

// ---------- pf43 Snapshot 9-Box ----------
function pf43NineBox(ctx: Ctx): { periodLabel: string; payload: PF43Data } {
  const cycle = ctx.fp.cycle ? ctx.cycleById.get(ctx.fp.cycle) : undefined;
  if (!cycle) throw new Error("Parameter siklus wajib (pilih siklus terlebih dahulu)");
  const rows0 = ctx.apprs.filter((a) => a.cycleId === cycle.id);
  const perfBandOf = (rating: number): 1 | 2 | 3 => (rating <= 2 ? 1 : rating === 3 ? 2 : 3);
  const CELL_LABELS: Record<string, [string, string]> = {
    "3-3": ["Bintang", "Stars"],
    "3-2": ["Performa Tinggi", "High Performer"],
    "3-1": ["Ahli Andal", "Trusted Expert"],
    "2-3": ["Potensi Tinggi", "High Potential"],
    "2-2": ["Pemain Inti", "Core Player"],
    "2-1": ["Efektif", "Effective"],
    "1-3": ["Permata Mentah", "Rough Diamond"],
    "1-2": ["Tidak Konsisten", "Inconsistent"],
    "1-1": ["Perlu Perbaikan", "Underperformer"],
  };
  const cells: PF43Cell[] = ([3, 2, 1] as const).flatMap((perf) =>
    ([1, 2, 3] as const).map((potential) => ({
      perf, potential, label: "", count: 0,
      employees: [] as PF43Cell["employees"],
    })));
  const idxOf = (perf: 1 | 2 | 3, potential: 1 | 2 | 3) => cells.findIndex((c) => c.perf === perf && c.potential === potential);
  const placed = rows0.filter((a) => a.finalRating != null && a.potentialBand != null);
  for (const a of placed) {
    const p = perfBandOf(a.finalRating as number);
    const b = Math.min(3, Math.max(1, a.potentialBand as number)) as 1 | 2 | 3;
    const c = cells[idxOf(p, b)];
    const e = ctx.empById.get(a.employeeId);
    c.count++;
    c.employees.push({
      employeeNo: e?.employeeNo ?? "?", fullName: e?.fullName ?? "?",
      unit: ctx.unitNameOf(e?.orgUnitId ?? null),
      finalScore: a.finalScore, finalRating: a.finalRating as number,
    });
  }
  for (const c of cells) {
    c.label = CELL_LABELS[`${c.perf}-${c.potential}`]?.[0] ?? `${c.perf}×${c.potential}`;
    c.employees.sort(ctx.sortByNo);
  }
  const unplaced = rows0.filter((a) => a.finalRating == null || a.potentialBand == null)
    .map((a) => ({ docNo: a.docNo, fullName: ctx.empById.get(a.employeeId)?.fullName ?? "?", finalRating: a.finalRating, potentialBand: a.potentialBand }));
  return {
    periodLabel: `Siklus ${cycle.code} · ${placed.length} terpetakan`,
    payload: {
      cycleCode: cycle.code, cells, unplaced,
      totals: { placed: placed.length, unplaced: unplaced.length },
    },
  };
}

// ---------- pf44 Tren Kinerja Multi-Tahun per Unit ----------
function pf44Trend(ctx: Ctx): { periodLabel: string; payload: PF44Data } {
  const scopedUnit = ctx.fp.unit ? ctx.unitSubtreeIds(ctx.fp.unit) : null;
  const scored = ctx.apprs
    .filter((a) => a.finalScore != null)
    .filter((a) => {
      const e = ctx.empById.get(a.employeeId);
      return !scopedUnit || (!!e?.orgUnitId && scopedUnit.has(e.orgUnitId));
    });
  const yearOf = new Map<string, number>();
  for (const a of scored) {
    const c = ctx.cycleById.get(a.cycleId);
    if (c) yearOf.set(a.id, c.periodStart.getFullYear());
  }
  const years = [...new Set(scored.map((a) => yearOf.get(a.id)).filter((y): y is number => !!y))].sort((a, b) => a - b);
  const rows0 = scored.filter((a) => yearOf.has(a.id));

  // per unit × tahun
  const byUnit = new Map<string, Map<number, number[]>>();
  for (const a of rows0) {
    const e = ctx.empById.get(a.employeeId);
    const u = ctx.unitNameOf(e?.orgUnitId ?? null) ?? "(tanpa unit)";
    const y = yearOf.get(a.id)!;
    if (!byUnit.has(u)) byUnit.set(u, new Map());
    const m = byUnit.get(u)!;
    if (!m.has(y)) m.set(y, []);
    m.get(y)!.push(a.finalScore as number);
  }
  const rows: PF44Row[] = [...byUnit.entries()]
    .map(([unit, ym]) => ({
      unit,
      perYear: years.map((y) => {
        const arr = ym.get(y) ?? [];
        return { year: y, n: arr.length, avg: arr.length ? round2(mean(arr)) : null };
      }),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit, "id"));

  const company = years.map((y) => {
    const arr = rows0.filter((a) => yearOf.get(a.id) === y).map((a) => a.finalScore as number);
    return { year: y, n: arr.length, avg: arr.length ? round2(mean(arr)) : null };
  });
  const range = years.length ? `${years[0]}–${years[years.length - 1]}` : "—";
  const unitChip = ctx.fp.unit ? ` — ${ctx.unitNameOf(ctx.fp.unit) ?? ""}` : " · seluruh unit";
  return {
    periodLabel: `Periode ${range}${unitChip}`,
    payload: { years, rows, company },
  };
}

// ============ XLSX ============

type AnyRec = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "—" : String(v));
const d = (isoStr: unknown): string => {
  if (!isoStr) return "—";
  const dt = new Date(String(isoStr));
  return dt.getDate() ? `${dt.getDate()} ${MONTHS_ID[dt.getMonth()].slice(0, 3)} ${dt.getFullYear()}` : "—";
};
/** Uang null (brankas terkunci) → "" — BUKAN 0 (aturan audit kolom R1.2/LR3.1). */
const rp = (n: unknown) => (n == null ? "" : n as number);
const yn = (b: unknown) => (b == null ? "—" : b ? "✓" : "–");

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
    case "pf11": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Register Siklus",
        title,
        columns: [
          { header: "Kode", width: 14 }, { header: "Nama Siklus", width: 30 }, { header: "Tipe", width: 12 },
          { header: "Periode", width: 22 }, { header: "Jendela Fase", width: 40 },
          { header: "Fase Aktif", width: 14 }, { header: "Status", width: 14 },
          { header: "Peserta", width: 9 }, { header: "Target Terkunci", width: 14 }, { header: "Hasil Terbit", width: 12 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.code), s(r.name), s(r.cycleType), s(r.period), s(r.phases), s(r.activePhase), s(r.status),
            (r.participants as number) ?? 0, (r.goalsLocked as number) ?? 0, (r.resultsPublished as number) ?? 0,
          ]),
          ["TOTAL", `${(p.total as AnyRec)?.cycles ?? 0} siklus`, "", "", "", "", "", ((p.total as AnyRec)?.participants as number | undefined) ?? 0, "", ""],
        ],
      }];
    }
    case "pf12": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Completion Fase",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 22 },
          { header: "Posisi", width: 20 }, { header: "Status", width: 18 }, { header: "# KPI", width: 8 },
          { header: "Σ Bobot", width: 10 }, { header: "Diri ✓", width: 9 }, { header: "Atasan ✓", width: 10 },
          { header: "Check-in", width: 10 }, { header: "Belum Mengisi", width: 26 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.employeeNo), s(r.fullName), s(r.unit), s(r.position), s(r.status),
            (r.kpiCount as number) ?? 0, r.totalWeight == null ? "—" : r.totalWeight as number,
            yn(r.selfSubmitted), yn(r.managerDone), (r.checkinCount as number) ?? 0,
            ((r.missing as string[]) ?? []).join(", ") || "—",
          ]),
          ["TOTAL", `${(sm.total as number) ?? 0} peserta`, "", "", "", "", "", `${(sm.selfDone as number) ?? 0}/${sm.total ?? 0}`, `${(sm.managerDone as number) ?? 0}/${sm.total ?? 0}`, "", ""],
        ],
      }];
    }
    case "pf13": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const byEmp = (p.byEmployee as AnyRec[]) ?? [];
      return [
        {
          name: "Register KPI",
          title,
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama Karyawan", width: 24 }, { header: "Unit", width: 20 },
            { header: "Judul KPI", width: 30 }, { header: "Kategori BSC", width: 16 }, { header: "Polaritas", width: 11 },
            { header: "Bobot (%)", width: 10 }, { header: "Ambang (F)", width: 11 }, { header: "Target (T)", width: 11 },
            { header: "Stretch", width: 10 }, { header: "Satuan", width: 9 }, { header: "Asal", width: 15 },
            { header: "Sumber Data", width: 18 }, { header: "Kritis", width: 8 },
          ],
          rows: [
            ...rows.map((r) => [
              s(r.employeeNo), s(r.fullName), s(r.unit), s(r.title), s(r.category), s(r.polarity),
              (r.weight as number) ?? 0, r.thresholdMin == null ? "—" : r.thresholdMin as number,
              (r.target as number) ?? 0, r.stretchValue == null ? "—" : r.stretchValue as number,
              s(r.measure), s(r.origin), s(r.source), r.isCritical ? "✓" : "–",
            ]),
            ["TOTAL", `${(p.total as number) ?? 0} baris`, "", "", "", "", "", "", "", "", "", "", "", ""],
          ],
        },
        {
          name: "Validasi Bobot",
          title,
          columns: [
            { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 26 }, { header: "Jumlah KPI", width: 11 }, { header: "Σ Bobot", width: 10 }, { header: "Valid (100)", width: 11 },
          ],
          rows: byEmp.map((b) => [
            s(b.employeeNo), s(b.name), (b.kpiCount as number) ?? 0, (b.sumWeight as number) ?? 0,
            Math.abs(((b.sumWeight as number) ?? 0) - 100) < 0.01 ? "✓" : "✗",
          ]),
        },
      ];
    }
    case "pf21": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      const rt = (sm.ratings as AnyRec) ?? {};
      return [{
        name: "Register Hasil",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Posisi", width: 18 }, { header: "Atasan Penilai", width: 22 },
          { header: "Skor Diri", width: 10 }, { header: "Skor Atasan", width: 11 }, { header: "Skor Final", width: 10 },
          { header: "Rating", width: 20 }, { header: "Status", width: 18 },
          { header: "Kalibrasi", width: 10 }, { header: "Banding", width: 22 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.docNo), s(r.employeeNo), s(r.fullName), s(r.unit), s(r.position), s(r.managerName),
            r.selfScore == null ? "—" : r.selfScore as number, r.managerScore == null ? "—" : r.managerScore as number,
            r.finalScore == null ? "—" : r.finalScore as number, s(r.ratingLabel), s(r.status),
            yn(r.calibrated), r.appealStatus == null ? "–" : s(r.appealStatus),
          ]),
          ["TOTAL", `${(sm.n as number) ?? 0} peserta`, "", "", "", "", "", "", (sm.avgFinal as number) ?? "—", `R1:${rt.r1 ?? 0} R2:${rt.r2 ?? 0} R3:${rt.r3 ?? 0} R4:${rt.r4 ?? 0} R5:${rt.r5 ?? 0}`, "", "", ""],
        ],
      }];
    }
    case "pf22": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const tot = (p.total as AnyRec) ?? {};
      const gb = p.groupBy === "atasan" ? "Atasan Penilai" : "Unit Kerja";
      return [{
        name: "Distribusi Rating",
        title,
        columns: [
          { header: gb, width: 26 }, { header: "N Dinilai", width: 10 },
          { header: "Rating 1", width: 10 }, { header: "Rating 2", width: 10 }, { header: "Rating 3", width: 10 },
          { header: "Rating 4", width: 10 }, { header: "Rating 5", width: 10 }, { header: "Rata-rata Skor", width: 13 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.label), (r.n as number) ?? 0, (r.r1 as number) ?? 0, (r.r2 as number) ?? 0, (r.r3 as number) ?? 0,
            (r.r4 as number) ?? 0, (r.r5 as number) ?? 0, r.avg == null ? "—" : r.avg as number,
          ]),
          ["TOTAL PERUSAHAAN", (tot.n as number) ?? 0, (tot.r1 as number) ?? 0, (tot.r2 as number) ?? 0, (tot.r3 as number) ?? 0, (tot.r4 as number) ?? 0, (tot.r5 as number) ?? 0, tot.avg == null ? "—" : tot.avg as number],
        ],
      }];
    }
    case "pf23": {
      const hist = (p.history as AnyRec[]) ?? [];
      const det = p.detail as AnyRec | null;
      const sheets: ExportSheet[] = [{
        name: "Riwayat Karyawan",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "Siklus", width: 16 }, { header: "Periode", width: 22 },
          { header: "Status", width: 18 }, { header: "Skor Final", width: 10 }, { header: "Rating", width: 20 },
          { header: "Kalibrasi (dari→ke)", width: 18 }, { header: "Banding", width: 24 }, { header: "Acknowledge", width: 13 },
        ],
        rows: [
          ...hist.map((r) => [
            s(r.docNo), s(r.cycleCode), s(r.period), s(r.status),
            r.finalScore == null ? "—" : r.finalScore as number, s(r.ratingLabel),
            r.calibratedFrom == null ? "—" : `${r.calibratedFrom} → ${r.calibratedTo}`,
            s(r.appealDecision), r.acknowledgedAt == null ? "–" : d(r.acknowledgedAt as string),
          ]),
        ],
      }];
      if (det) {
        sheets.push({
          name: "Detail KPI",
          title,
          columns: [
            { header: "Judul KPI", width: 32 }, { header: "Bobot (%)", width: 10 }, { header: "Ambang (F)", width: 11 },
            { header: "Target (T)", width: 11 }, { header: "Stretch", width: 10 }, { header: "Realisasi", width: 11 },
            { header: "Realisasi Mid", width: 12 }, { header: "Sumber", width: 10 }, { header: "Bukti", width: 8 },
          ],
          rows: ((det.kpis as AnyRec[]) ?? []).map((k) => [
            s(k.title), (k.weight as number) ?? 0, k.thresholdMin == null ? "—" : k.thresholdMin as number,
            (k.target as number) ?? 0, k.stretchValue == null ? "—" : k.stretchValue as number,
            k.actual == null ? "—" : k.actual as number, k.midActual == null ? "—" : k.midActual as number,
            s(k.source), yn(k.evidence),
          ]),
        });
        sheets.push({
          name: "Kompetensi",
          title,
          columns: [
            { header: "Kompetensi", width: 32 }, { header: "Skor Penilai (1–5)", width: 16 }, { header: "Skor Diri (1–5)", width: 15 },
          ],
          rows: ((det.comps as AnyRec[]) ?? []).map((c) => [s(c.name), c.score == null ? "—" : c.score as number, c.selfScore == null ? "—" : c.selfScore as number]),
        });
      }
      return sheets;
    }
    case "pf24": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Ringkasan 360",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 20 },
          { header: "Diundang", width: 10 }, { header: "Submit", width: 9 }, { header: "Partisipasi %", width: 12 },
          { header: "Rekan", width: 9 }, { header: "Bawahan", width: 9 }, { header: "Lintas Tim", width: 11 },
          { header: "Upward", width: 9 }, { header: "Keseluruhan", width: 12 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.employeeNo), s(r.fullName), s(r.unit), (r.invited as number) ?? 0, (r.submitted as number) ?? 0,
            r.participationPct == null ? "—" : r.participationPct as number,
            ...(["peer", "subordinate", "crossTeam", "upward", "overall"] as const).map((k) =>
              r.hidden ? `Dirahasiakan (<${p.threshold ?? 3})` : r[k] == null ? "—" : r[k] as number),
          ]),
          ["TOTAL", "", "", (sm.invited as number) ?? 0, (sm.submitted as number) ?? 0, sm.participationPct == null ? "—" : sm.participationPct as number, "", "", "", "", ""],
        ],
      }];
    }
    case "pf31": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sessions = (p.sessions as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [
        {
          name: "Keputusan Kalibrasi",
          title,
          columns: [
            { header: "Sesi", width: 26 }, { header: "Ketua", width: 22 }, { header: "No. Karyawan", width: 14 },
            { header: "Nama", width: 24 }, { header: "Unit", width: 20 },
            { header: "Skor dari", width: 10 }, { header: "Skor ke", width: 10 },
            { header: "Rating dari", width: 11 }, { header: "Rating ke", width: 10 }, { header: "Band", width: 7 },
            { header: "Alasan (WAJIB)", width: 44 }, { header: "Diputus oleh", width: 22 }, { header: "Waktu", width: 13 },
          ],
          rows: [
            ...rows.map((r) => [
              s(r.sessionLabel), s(r.chair), s(r.employeeNo), s(r.fullName), s(r.unit),
              r.oldScore == null ? "—" : r.oldScore as number, r.newScore == null ? "—" : r.newScore as number,
              r.oldRating == null ? "—" : r.oldRating as number, r.newRating == null ? "—" : r.newRating as number,
              r.potentialBand == null ? "—" : r.potentialBand as number,
              s(r.reason), s(r.decidedBy), d(r.decidedAt as string),
            ]),
            ["TOTAL", `${(sm.decisions as number) ?? 0} keputusan`, "", "", "", "", `Δ ${sm.totalScoreDelta ?? 0}`, "", "", "", "", "", ""],
          ],
        },
        {
          name: "Sesi Kalibrasi",
          title,
          columns: [
            { header: "Sesi", width: 26 }, { header: "Ketua", width: 22 }, { header: "Peserta Forum", width: 13 }, { header: "Status", width: 12 }, { header: "Keputusan", width: 10 },
          ],
          rows: sessions.map((x) => [s(x.label), s(x.chair), (x.participants as number) ?? 0, s(x.status), (x.decisions as number) ?? 0]),
        },
      ];
    }
    case "pf32": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const comp = (p.company as AnyRec) ?? {};
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Indikator Bias",
        title,
        columns: [
          { header: "Atasan Penilai", width: 26 }, { header: "N Bawahan", width: 11 },
          { header: "Rata-rata Tim", width: 13 }, { header: "Simpangan Tim", width: 14 },
          { header: "z-Score", width: 9 }, { header: "Indikasi", width: 22 }, { header: "Tingkat", width: 9 }, { header: "Central Tendency", width: 17 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.managerName), (r.n as number) ?? 0, (r.meanScore as number) ?? 0, (r.stdDev as number) ?? 0,
            r.z == null ? "—" : r.z as number,
            r.flag === "strictness" ? "Terlalu pelis (skor rendah)" : r.flag === "leniency" ? "Terlalu royal (skor tinggi)" : "Seimbang",
            r.flagLevel == null ? "—" : s(r.flagLevel),
            r.centralTendency ? "✓ (σ tim < ½ σ perusahaan)" : "–",
          ]),
          ["PERUSAHAAN", (comp.n as number) ?? 0, (comp.mean as number) ?? 0, (comp.sigma as number) ?? 0, "", `${(sm.flagged as number) ?? 0} atasan ter-flag`, "", ""],
        ],
      }];
    }
    case "pf33": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Register Banding",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Siklus", width: 16 },
          { header: "Skor Awal", width: 10 }, { header: "Rating", width: 8 },
          { header: "Alasan Banding", width: 44 }, { header: "Tgl Banding", width: 13 },
          { header: "Keputusan", width: 26 }, { header: "Skor Baru", width: 10 },
          { header: "Diputus oleh", width: 22 }, { header: "Waktu Putusan", width: 13 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.docNo), s(r.employeeNo), s(r.fullName), s(r.unit), s(r.cycleCode),
            r.score == null ? "—" : r.score as number, r.rating == null ? "—" : r.rating as number,
            s(r.appealNote), d(r.appealDate as string),
            s(r.decision), r.newScore == null ? "—" : r.newScore as number,
            s(r.decidedBy), d(r.decidedAt),
          ]),
          ["TOTAL", `${(sm.appeals as number) ?? 0} banding`, "", "", "", "", "", `Disetujui: ${sm.adjusted ?? 0} · Ditolak: ${sm.rejected ?? 0} · Terbuka: ${sm.open ?? 0}`, "", "", "", "", ""],
        ],
      }];
    }
    case "pf41": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Register Merit",
        title,
        columns: [
          { header: "No. Usulan", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "No. Penilaian", width: 16 }, { header: "Rating", width: 20 },
          { header: "Bonus (bln)", width: 11 }, { header: "Bonus (Rp)", width: 16 },
          { header: "Raise %", width: 9 }, { header: "Raise (Rp)", width: 15 }, { header: "Total (Rp)", width: 16 },
          { header: "Status", width: 18 }, { header: "Approval", width: 24 },
          { header: "Run Payroll", width: 18 }, { header: "PA", width: 20 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.docNo), s(r.employeeNo), s(r.fullName), s(r.unit), s(r.appraisalNo), s(r.ratingLabel),
            r.bonusMonths == null ? "—" : r.bonusMonths as number, rp(r.bonusAmount),
            r.raisePct == null ? "—" : r.raisePct as number, rp(r.raiseAmount), rp(r.totalAmount),
            s(r.status),
            r.approval == null ? "—" : `L${(r.approval as AnyRec).currentLevel}/${(r.approval as AnyRec).totalLevels} (${s((r.approval as AnyRec).currentApprover)})`,
            s(r.appliedRunNo), r.personnelActionId == null ? "–" : "Ter-link",
          ]),
          ["TOTAL", `${(sm.n as number) ?? 0} usulan`, "", "", "", "", "", rp(sm.sumBonus), "", rp(sm.sumRaise), rp(sm.sumTotal), "", "", "", ""],
        ],
      }];
    }
    case "pf42": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sm = (p.summary as AnyRec) ?? {};
      return [{
        name: "Register PIP",
        title,
        columns: [
          { header: "No. PIP", width: 15 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Periode", width: 24 }, { header: "Diperpanjang", width: 12 },
          { header: "Sasaran", width: 8 }, { header: "Checkpoint (capaian)", width: 26 },
          { header: "Capaian Akhir %", width: 14 }, { header: "Status", width: 14 },
          { header: "Pembina", width: 22 }, { header: "Catatan Hasil", width: 36 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.docNo), s(r.employeeNo), s(r.fullName), s(r.unit), s(r.period), r.extended ? "✓" : "–",
            (r.targetsCount as number) ?? 0, s(r.checkpoints),
            r.lastReviewPct == null ? "—" : r.lastReviewPct as number,
            s(r.status), s(r.reviewer), s(r.note),
          ]),
          ["TOTAL", `${(sm.n as number) ?? 0} PIP`, "", "", "", "", "", "", "", `Pulih: ${sm.recovered ?? 0}/${sm.n ?? 0} (${sm.recoveryRate == null ? "—" : sm.recoveryRate + "%"})`, "", ""],
        ],
      }];
    }
    case "pf43": {
      const cells = (p.cells as AnyRec[]) ?? [];
      const unplaced = (p.unplaced as AnyRec[]) ?? [];
      const tot = (p.totals as AnyRec) ?? {};
      return [
        {
          name: "Matriks 9-Box",
          title,
          columns: [
            { header: "Performa \\ Potensi", width: 22 }, { header: "Potensi Rendah (1)", width: 18 },
            { header: "Potensi Sedang (2)", width: 18 }, { header: "Potensi Tinggi (3)", width: 18 }, { header: "Total", width: 8 },
          ],
          rows: [3, 2, 1].map((perf) => {
            const row = cells.filter((c) => c.perf === perf).sort((a, b) => (a.potential as number) - (b.potential as number));
            const sum = row.reduce((x, c) => x + ((c.count as number) ?? 0), 0);
            return [
              `Performa ${perf === 3 ? "Tinggi" : perf === 2 ? "Sedang" : "Rendah"}`,
              ...row.map((c) => `${c.label} (${c.count ?? 0})`),
              sum,
            ];
          }),
        },
        {
          name: "Detail Sel",
          title,
          columns: [
            { header: "Sel", width: 26 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
            { header: "Unit", width: 20 }, { header: "Skor Final", width: 10 }, { header: "Rating", width: 8 },
          ],
          rows: cells.flatMap((c) =>
            ((c.employees as AnyRec[]) ?? []).map((e) => [
              `${c.label} (P${c.perf}×B${c.potential})`, s(e.employeeNo), s(e.fullName), s(e.unit),
              e.finalScore == null ? "—" : e.finalScore as number, (e.finalRating as number) ?? 0,
            ])),
        },
        {
          name: "Belum Terpetakan",
          title,
          columns: [
            { header: "No. Dokumen", width: 16 }, { header: "Nama", width: 24 }, { header: "Rating", width: 8 }, { header: "Band Potensi", width: 12 },
          ],
          rows: unplaced.map((u) => [s(u.docNo), s(u.fullName), u.finalRating == null ? "—" : u.finalRating as number, u.potentialBand == null ? "—" : u.potentialBand as number]),
        },
      ];
    }
    default: {
      const rows = (p.rows as AnyRec[]) ?? [];
      const comp = (p.company as AnyRec[]) ?? [];
      const years = (p.years as number[]) ?? [];
      const yearCols = years.map((y) => ({ header: String(y), width: 12 }));
      const compRow = ["PERUSAHAAN (semua unit)", ...comp.map((c) => (c.avg == null ? "—" : `${c.avg} (${c.n} org)`))];
      return [{
        name: "Tren per Unit",
        title,
        columns: [
          { header: "Unit Kerja", width: 30 }, ...yearCols, { header: "Total Org-Tahun", width: 15 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.unit),
            ...((r.perYear as AnyRec[]) ?? []).map((y) => (y.avg == null ? "—" : `${y.avg} (${y.n} org)`)),
            ((r.perYear as AnyRec[]) ?? []).reduce((x, y) => x + ((y.n as number) ?? 0), 0),
          ]),
          compRow,
        ],
      }];
    }
  }
}
