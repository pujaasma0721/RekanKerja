import { NextRequest, NextResponse } from "next/server";
import { requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { toXlsxMulti, xlsxResponse, exportFilename, type ExportSheet, type ExportCell } from "@/rekankerja/shared/lib/export";
import { trFor, locReportFor, type Lang } from "@/rekankerja/shared/lib/i18n-core";
import { attachChainSummaries } from "@/rekankerja/shared/services/approval-engine";
import { scoreKpiItem } from "@/rekankerja/performance/services/perf-scoring";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
// KONTRAK payload — tipe dipakai compile-time supaya field TIDAK BISA menyimpang
// dari src/rekankerja/performance/components/report-documents/types.ts (P8).
import type {
  PF11Data, PF12Data, PF13Data, PF21Data, PF22Data, PF23Data, PF24Data,
  PF31Data, PF32Data, PF33Data, PF41Data, PF42Data, PF43Data, PF44Data,
} from "@/rekankerja/performance/components/report-documents/types";

// =============================================================================
// P8-PERF — LAPORAN DOKUMEN PERFORMANCE (print & PDF ready) ====================
// =============================================================================
// GET /api/rekankerja/performance/reports/documents?id=<pfId> — data satu laporan
// siap cetak (14 laporan / 4 grup: siklus & partisipasi, penilaian & hasil,
// kualitas & kepatuhan, konsekuensi & analitik — §11.2).
//
// Alur pola medical/travel/HR (T110/T112): form parameter awal di klien
// mengirim query string (cycle/unit/employee) → diterapkan SERVER-SIDE sebelum
// builder berjalan. ?id=_params → daftar opsi filter (cycles/units/employees
// — employees mengikuti ?cycleId bila diberikan). ?export=xlsx → stream XLSX.
// ?id=employee-history&employeeId=…&export=xlsx → riwayat penuh satu karyawan
// lintas siklus (PP 35/2021 §7.2) sebagai workbook multi-sheet.
//
// Guard: requireMenuViewAny performance:reports | performance:overview.
//
// UANG (pf41): nominal MeritRecommendation TERENKRIPSI vault — didekripsi via
// tenantCryptoForDb di batas serializer dan dikembalikan sebagai NUMBER (laporan
// internal HR/Finance — tanpa gerbang brankas, beda dari medical).

const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const REPORT_IDS = new Set([
  "pf11", "pf12", "pf13",
  "pf21", "pf22", "pf23", "pf24",
  "pf31", "pf32", "pf33",
  "pf41", "pf42", "pf43", "pf44",
]);

const REPORT_TITLES: Record<string, string> = {
  pf11: "Appraisal Cycle & Phase Register (Register Siklus & Fase)",
  pf12: "Per-Phase Completion (Tingkat Penyelesaian per Fase)",
  pf13: "KPI Assignment Register (Register Penetapan KPI)",
  pf21: "Per-Period Results Register (Register Hasil per Periode)",
  pf22: "Rating Distribution by Unit & Manager (Distribusi Rating)",
  pf23: "Per-Employee KPI & Competency Scorecard (Scorecard Karyawan)",
  pf24: "Aggregated 360 Summary (Ringkasan 360 — Anonim)",
  pf31: "Calibration Audit Trail (Jejak Kalibrasi)",
  pf32: "Rater Bias Indicators (Indikator Bias Atasan)",
  pf33: "Appeals Register & Decisions (Register Banding)",
  pf41: "Merit Register (Register Merit)",
  pf42: "PIP Register & Outcomes (Register PIP & Outcome)",
  pf43: "9-Box Snapshot (Snapshot 9-Box)",
  pf44: "Multi-Year Performance Trend per Unit (Tren Kinerja per Unit)",
};

/** Status appraisal yang sudah melewati fase penilaian atasan (mirror calibration-service). */
const SCORED = ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];
/** Status appraisal = proses tuntas (finalisasi selesai). */
const DONE = ["Finalized", "Published", "Appealed", "Closed"];
/** Status appraisal pasca self-assessment. */
const SELF_DONE = ["SelfDone", ...SCORED];
/** Ranking jenjang SP (mirror pip-service §33-4). */
const SP_RANK: Record<string, number> = { Verbal: 1, Written: 2, Final: 3 };

interface ReportFilters {
  cycleId: string | null;
  unitId: string | null;
  employeeId: string | null;
}

// ============ util kecil ============

/* eslint-disable @typescript-eslint/no-explicit-any — payload laporan di-cast longgar utk builder XLSX generik (pola medical-report-documents). */
type AnyRec = Record<string, any>;
const s = (v: unknown) => (v == null ? "—" : String(v));
const rp = (n: unknown) => (n == null ? "" : n as number);
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const dateID = (d: Date) => `${d.getDate()} ${MONTHS_ID[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const r1n = (n: number | null) => (n == null ? null : round1(n));
const r2n = (n: number | null) => (n == null ? null : round2(n));

/** Konversi skor→rating darurat bila rating final belum tersedia (mirror calibration-dashboard). */
const ratingFallback = (score: number): number =>
  Math.min(5, Math.max(1, Math.floor(score / 20) + (score % 20 === 0 ? 0 : 1)));

async function getCycle(db: TenantDb, cycleId: string | null) {
  if (!cycleId) throw new Error("Parameter siklus (cycleId) wajib untuk laporan ini");
  const c = await db.performanceCycle.findUnique({ where: { id: cycleId } });
  if (!c) throw new Error("Siklus penilaian tidak ditemukan");
  return c;
}

/** Cakupan subtree unit (unit + seluruh anaknya — pola medical). */
async function unitSubtreeIds(db: TenantDb, rootId: string): Promise<Set<string>> {
  const units = await db.orgUnit.findMany({ select: { id: true, parentId: true } });
  const ids = new Set<string>();
  const walk = (pid: string) => {
    ids.add(pid);
    for (const u of units) if (u.parentId === pid) walk(u.id);
  };
  walk(rootId);
  return ids;
}

/** Peserta ter-scope utk satu siklus (filter subtree unit). */
async function cycleParticipants(
  db: TenantDb,
  cycleId: string,
  unitId: string | null,
  extraWhere: AnyRec = {},
) {
  const scopedUnitIds = unitId ? await unitSubtreeIds(db, unitId) : null;
  return db.appraisalRecord.findMany({
    where: {
      cycleId,
      ...extraWhere,
      ...(scopedUnitIds ? { employee: { orgUnitId: { in: [...scopedUnitIds] } } } : {}),
    },
    include: {
      employee: { select: { id: true, employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
      manager: { select: { id: true, fullName: true } },
    },
    orderBy: [{ employee: { employeeNo: "asc" } }, { docNo: "asc" }],
  });
}

// ============ handler utama ============

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["performance:reports", "performance:overview"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id") ?? "";

    // ---- ?id=_params — daftar opsi filter (ringan). ----
    if (id === "_params") {
      const [cycles, units, cycleIdParam] = [
        await db.performanceCycle.findMany({ select: { id: true, code: true, name: true, status: true, periodEnd: true }, orderBy: { periodEnd: "desc" } }),
        await db.orgUnit.findMany({ select: { id: true, name: true, level: true } }),
        sp.get("cycleId"),
      ];
      // Karyawan peserta — mengikuti siklus terpilih (bila ada); tanpa siklus →
      // semua karyawan yang pernah terdaftar di siklus mana pun.
      const emps = await db.appraisalRecord.findMany({
        ...(cycleIdParam ? { where: { cycleId: cycleIdParam } } : {}),
        select: { employeeId: true, employee: { select: { id: true, employeeNo: true, fullName: true } } },
        distinct: ["employeeId"],
        orderBy: [{ employee: { employeeNo: "asc" } }],
      });
      const seen = new Set<string>();
      const employees = emps
        .map((e) => e.employee)
        .filter((e) => {
          if (!e || seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .map((e) => ({ id: e.id, label: `${e.employeeNo} — ${e.fullName}` }));
      return NextResponse.json({
        cycles: cycles.map((c) => ({ id: c.id, label: `${c.code} — ${c.name} (${c.status})` })),
        units: [...units].sort((a, b) => a.name.localeCompare(b.name, "id")).map((u) => ({ id: u.id, label: `${"— ".repeat(Math.max(0, u.level - 1))}${u.name}` })),
        employees,
      });
    }

    // ---- ?id=employee-history — riwayat penuh satu karyawan (PP 35/2021 §7.2). ----
    if (id === "employee-history") {
      const employeeId = sp.get("employeeId");
      if (!employeeId) return NextResponse.json({ error: "Parameter employeeId wajib untuk riwayat karyawan" }, { status: 400 });
      if (sp.get("export") !== "xlsx") {
        return NextResponse.json({ error: "Riwayat karyawan hanya tersedia sebagai ekspor XLSX (?export=xlsx)" }, { status: 400 });
      }
      const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeNo: true, fullName: true } });
      if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });
      const lang: Lang = sp.get("lang") === "id" ? "id" : "en";
      const sheets = await buildEmployeeHistorySheets(db, employeeId, lang);
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "AppraisalRecord",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX riwayat kinerja karyawan (PP 35/2021 §7.2): ${emp.employeeNo} — ${emp.fullName}`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-perf-history-${emp.employeeNo}`, "xlsx"));
    }

    if (!REPORT_IDS.has(id)) {
      return NextResponse.json({ error: "Parameter id laporan tidak dikenal (pf11…pf44)" }, { status: 400 });
    }

    // ---- parse parameter filter ----
    const fp: ReportFilters = {
      cycleId: sp.get("cycle") || null,
      unitId: sp.get("unit") || null,
      employeeId: sp.get("employee") || null,
    };

    const [company, unitsAll] = await Promise.all([
      db.company.findFirst({ select: { name: true, address: true, city: true, taxId: true, logoUrl: true } }),
      db.orgUnit.findMany({ select: { id: true, name: true } }),
    ]);
    const unitName = new Map(unitsAll.map((u) => [u.id, u.name]));
    const now = new Date();

    // ---- chip parameter terpasang (kop dokumen) ----
    const filterChips: { label: string; value: string }[] = [];
    let cycleChip: string | null = null;
    if (fp.cycleId) {
      const c = await db.performanceCycle.findUnique({ where: { id: fp.cycleId }, select: { code: true, name: true } });
      if (c) { cycleChip = c.code; filterChips.push({ label: "Siklus", value: `${c.code} — ${c.name}` }); }
    }
    if (fp.unitId) {
      const u = unitName.get(fp.unitId);
      if (u) filterChips.push({ label: "Unit", value: u });
    }
    if (fp.employeeId) {
      const e = await db.employee.findUnique({ where: { id: fp.employeeId }, select: { employeeNo: true, fullName: true } });
      if (e) filterChips.push({ label: "Karyawan", value: `${e.employeeNo} — ${e.fullName}` });
    }

    const meta = {
      companyName: company?.name ?? "Perusahaan",
      companyAddress: company?.address ?? null,
      companyCity: company?.city ?? null,
      companyTaxId: company?.taxId ?? null,
      companyLogoUrl: company?.logoUrl ?? null,
      branchLabel: fp.unitId ? unitName.get(fp.unitId) ?? "Semua Unit Kerja" : "Semua Unit Kerja",
      printedBy: m.actor.name,
      generatedAt: now.toISOString(),
      year: now.getFullYear(),
      scope: "all" as const,
      filters: filterChips,
    };

    const built = await buildReport(id, db, fp, now);

    // ---- mode export XLSX ----
    if (sp.get("export") === "xlsx") {
      // BL-4: bahasa ekspor — default EN (frontend selalu mengirim ?lang=).
      const lang: Lang = sp.get("lang") === "id" ? "id" : "en";
      const sheets = buildSheets(id, built.payload as AnyRec, built.periodLabel, lang);
      const buf = await toXlsxMulti(sheets, { lang });
      try {
        await db.activityLog.create({
          data: {
            action: "Exported", entity: "PerformanceReportDocument",
            ...(m.actor.appUserId ? { appUserId: m.actor.appUserId } : {}),
            detail: `Ekspor XLSX laporan Performance (${id} — ${REPORT_TITLES[id]})`,
          },
        });
      } catch { /* ActivityLog opsional */ }
      return xlsxResponse(buf, exportFilename(`rekankerja-performance-${id}`, "xlsx"));
    }

    return NextResponse.json({ id, meta: { ...meta, periodLabel: built.periodLabel }, data: built.payload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ============ dispatch builder ============

async function buildReport(id: string, db: TenantDb, fp: ReportFilters, now: Date): Promise<{ periodLabel: string; payload: unknown }> {
  switch (id) {
    case "pf11": return pf11Cycles(db, now);
    case "pf12": return pf12Completion(db, fp);
    case "pf13": return pf13KpiRegister(db, fp);
    case "pf21": return pf21Results(db, fp);
    case "pf22": return pf22RatingDist(db, fp);
    case "pf23": return pf23Scorecard(db, fp);
    case "pf24": return pf24Agg360(db, fp);
    case "pf31": return pf31Calibration(db, fp);
    case "pf32": return pf32Bias(db, fp);
    case "pf33": return pf33Appeals(db, fp);
    case "pf41": return pf41Merit(db, fp);
    case "pf42": return pf42Pip(db);
    case "pf43": return pf43Ninebox(db, fp);
    default: return pf44Trend(db, fp);
  }
}

const fmtGate = (s: Date | null, e: Date | null): string | null =>
  s && e ? `${dateID(new Date(s))} – ${dateID(new Date(e))}` : null;

// ===================== G1 — SIKLUS & PARTISIPASI =====================

// ---------- PF1.1 Register Siklus & Fase ----------
async function pf11Cycles(db: TenantDb, now: Date): Promise<{ periodLabel: string; payload: PF11Data }> {
  const cycles = await db.performanceCycle.findMany({ orderBy: { periodEnd: "desc" } });
  const counts = await db.appraisalRecord.groupBy({
    by: ["cycleId"],
    _count: { _all: true },
    where: { cycleId: { in: cycles.map((c) => c.id) } },
  });
  const doneCounts = await db.appraisalRecord.groupBy({
    by: ["cycleId"],
    _count: { _all: true },
    where: { cycleId: { in: cycles.map((c) => c.id) }, status: { in: DONE } },
  });
  const totalBy = new Map(counts.map((c) => [c.cycleId, c._count._all]));
  const doneBy = new Map(doneCounts.map((c) => [c.cycleId, c._count._all]));
  const rows: PF11Data["rows"] = cycles.map((c) => {
    const participants = totalBy.get(c.id) ?? 0;
    const completed = doneBy.get(c.id) ?? 0;
    return {
      code: c.code, name: c.name, cycleType: c.cycleType,
      periodStart: c.periodStart.toISOString(), periodEnd: c.periodEnd.toISOString(), status: c.status,
      gates: {
        goal: fmtGate(c.goalStart, c.goalEnd),
        mid: fmtGate(c.midStart, c.midEnd),
        self: fmtGate(c.selfStart, c.selfEnd),
        mgr: fmtGate(c.mgrStart, c.mgrEnd),
        calib: fmtGate(c.calibStart, c.calibEnd),
      },
      feedback360: c.feedback360,
      participants, completed,
      completionPct: participants ? round2((completed / participants) * 100) : 0,
    };
  });
  return {
    periodLabel: `Semua siklus · data per ${dateID(now)}`,
    payload: {
      rows,
      totalCycles: cycles.length,
      activeCycles: cycles.filter((c) => c.status !== "Closed").length,
      totalParticipants: participants_sum(rows),
    },
  };
}

function participants_sum(rows: PF11Data["rows"]): number {
  return rows.reduce((s, r) => s + r.participants, 0);
}

// ---------- PF1.2 Completion per Fase ----------
async function pf12Completion(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF12Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = await cycleParticipants(db, cycle.id, fp.unitId);
  const rows: PF12Data["rows"] = recs.map((r) => ({
    docNo: r.docNo, employeeNo: r.employee.employeeNo, name: r.employee.fullName,
    unit: r.employee.orgUnit?.name ?? null, status: r.status,
    targetDone: r.kpiTotalWeight != null,
    selfDone: SELF_DONE.includes(r.status) || r.selfScore != null,
    managerDone: SCORED.includes(r.status) || r.managerScore != null,
    acknowledged: r.acknowledgedAt != null,
    finalScore: r1n(r.finalScore),
  }));
  const sum = {
    participants: rows.length,
    target: rows.filter((r) => r.targetDone).length,
    self: rows.filter((r) => r.selfDone).length,
    manager: rows.filter((r) => r.managerDone).length,
    acknowledged: rows.filter((r) => r.acknowledged).length,
  };
  return {
    periodLabel: `Siklus ${cycle.code} · ${dateID(cycle.periodStart)} – ${dateID(cycle.periodEnd)}`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name, status: cycle.status, periodStart: cycle.periodStart.toISOString(), periodEnd: cycle.periodEnd.toISOString() },
      rows,
      summary: sum,
      pending: {
        target: sum.participants - sum.target,
        self: sum.participants - sum.self,
        manager: sum.participants - sum.manager,
        ack: sum.participants - sum.acknowledged,
      },
    },
  };
}

// ---------- PF1.3 Register Penetapan KPI ----------
async function pf13KpiRegister(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF13Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = await cycleParticipants(db, cycle.id, fp.unitId, { kpis: { some: {} } });
  const kpiDefs = await db.kpiDefinition.findMany({ select: { id: true, code: true } });
  const codeBy = new Map(kpiDefs.map((k) => [k.id, k.code]));
  const kpiRows = recs.length
    ? await db.appraisalKpi.findMany({ where: { appraisalId: { in: recs.map((r) => r.id) } }, orderBy: { createdAt: "asc" } })
    : [];
  const recBy = new Map(recs.map((r) => [r.id, r]));
  const rows: PF13Data["rows"] = [];
  for (const k of kpiRows) {
    const r = recBy.get(k.appraisalId);
    if (!r) continue;
    rows.push({
      employeeNo: r.employee.employeeNo, name: r.employee.fullName,
      unit: r.employee.orgUnit?.name ?? null, docNo: r.docNo,
      kpiCode: k.kpiDefId ? codeBy.get(k.kpiDefId) ?? null : null,
      title: k.title, unitOf: k.unit, polarity: k.polarity,
      weight: k.weight, thresholdMin: k.thresholdMin, target: k.target, stretch: k.stretchValue,
      isCritical: k.isCritical, origin: k.origin, proposedBy: k.proposedBy, finalActual: k.finalActual,
    });
  }
  return {
    periodLabel: `Siklus ${cycle.code} · penetapan KPI`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name },
      rows,
      employees: recs.length,
      kpiRows: rows.length,
      sumWeight: round1(rows.reduce((s, r) => s + r.weight, 0)),
    },
  };
}

// ===================== G2 — PENILAIAN & HASIL =====================

// ---------- PF2.1 Register Hasil per Periode ----------
async function pf21Results(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF21Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = await cycleParticipants(db, cycle.id, fp.unitId);
  const calibratedIds = new Set(
    (await db.calibrationDecision.findMany({ where: { appraisalId: { in: recs.map((r) => r.id) } }, select: { appraisalId: true } })).map((d) => d.appraisalId),
  );
  const rows: PF21Data["rows"] = recs.map((r) => ({
    docNo: r.docNo, employeeNo: r.employee.employeeNo, name: r.employee.fullName,
    unit: r.employee.orgUnit?.name ?? null, managerName: r.manager?.fullName ?? null,
    status: r.status, managerScore: r1n(r.managerScore), finalScore: r1n(r.finalScore),
    finalRating: r.finalRating, potentialBand: r.potentialBand,
    calibrated: calibratedIds.has(r.id), acknowledgedAt: iso(r.acknowledgedAt),
  }));
  const scored = rows.filter((r) => r.finalScore != null).map((r) => r.finalScore as number);
  return {
    periodLabel: `Siklus ${cycle.code} · data per ${dateID(new Date())}`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name, status: cycle.status, publishAt: iso(cycle.publishAt) },
      rows,
      summary: {
        participants: rows.length,
        scored: scored.length,
        finalized: rows.filter((r) => DONE.includes(r.status)).length,
        mean: scored.length ? round1(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
        min: scored.length ? Math.min(...scored) : null,
        max: scored.length ? Math.max(...scored) : null,
      },
    },
  };
}

// ---------- PF2.2 Distribusi Rating per Unit & Atasan ----------
async function pf22RatingDist(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF22Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = (await cycleParticipants(db, cycle.id, fp.unitId, { status: { in: SCORED } }))
    .map((r) => ({
      unit: r.employee.orgUnit?.name ?? "(tanpa unit)",
      managerName: r.manager?.fullName ?? "(tanpa atasan)",
      score: (r.finalScore ?? r.managerScore) as number | null,
      rating: r.finalRating,
    }))
    .filter((r) => r.score != null) as { unit: string; managerName: string; score: number; rating: number | null }[];

  const mkGroup = (key: string) => ({ key, participants: 0, counts: [0, 0, 0, 0, 0], sum: 0, scores: [] as number[] });
  const group = (rows: typeof recs, pick: (r: typeof recs[number]) => string) => {
    const map = new Map<string, ReturnType<typeof mkGroup>>();
    for (const r of rows) {
      const g = map.get(pick(r)) ?? mkGroup(pick(r));
      g.participants++;
      g.counts[(r.rating ?? ratingFallback(r.score)) - 1]++;
      g.sum += r.score;
      g.scores.push(r.score);
      map.set(pick(r), g);
    }
    return Array.from(map.values()).map((g) => ({
      key: g.key, participants: g.participants, counts: g.counts,
      mean: g.participants ? round1(g.sum / g.participants) : null,
      sigma: g.scores.length >= 2 ? round2(Math.sqrt(g.scores.reduce((s, x) => s + (x - g.sum / g.scores.length) ** 2, 0) / g.scores.length)) : null,
    })).sort((a, b) => a.key.localeCompare(b.key, "id"));
  };
  const byUnit = group(recs, (r) => r.unit);
  const byManager = group(recs, (r) => r.managerName);
  const overall = group(recs, () => "ALL")[0] ?? { key: "ALL", participants: 0, counts: [0, 0, 0, 0, 0], mean: null, sigma: null };
  return {
    periodLabel: `Siklus ${cycle.code} · peserta ter-skor`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name },
      byUnit: byUnit.map(({ key, ...x }) => ({ unit: key, ...x })),
      byManager: byManager.map(({ key, ...x }) => ({ managerName: key, ...x })),
      overall: { participants: overall.participants, counts: overall.counts, mean: overall.mean, sigma: overall.sigma },
    },
  };
}

// ---------- PF2.3 Detail Skor KPI & Kompetensi per Karyawan ----------
async function pf23Scorecard(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF23Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  if (!fp.employeeId) throw new Error("Parameter karyawan (employee) wajib untuk laporan ini");
  const rec = await db.appraisalRecord.findFirst({
    where: { cycleId: cycle.id, employeeId: fp.employeeId },
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
      manager: { select: { fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
      comps: { include: { competency: { select: { name: true, kind: true } } } },
      f360: { where: { status: "Submitted" }, include: { answers: true } },
    },
  });
  if (!rec) throw new Error("Karyawan bukan peserta pada siklus ini");
  const calibrated = await db.calibrationDecision.findFirst({ where: { appraisalId: rec.id }, select: { id: true } });

  // ringkasan 360 per kelompok (≥3 — jaminan anonimitas §37)
  const byType = new Map<string, number[]>();
  for (const f of rec.f360) {
    const arr = byType.get(f.reviewerType) ?? [];
    for (const a of f.answers) arr.push(a.score);
    byType.set(f.reviewerType, arr);
  }
  const f360: PF23Data["f360"] = Array.from(byType.entries())
    .filter(([, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      group,
      count: rec.f360.filter((f) => f.reviewerType === group).length,
      overallAvg: arr.length >= 3 ? round1(arr.reduce((a, b) => a + b, 0) / arr.length) : null,
    }));

  return {
    periodLabel: `Siklus ${cycle.code} · ${rec.employee.employeeNo} — ${rec.employee.fullName}`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name, status: cycle.status },
      employee: {
        docNo: rec.docNo, employeeNo: rec.employee.employeeNo, name: rec.employee.fullName,
        unit: rec.employee.orgUnit?.name ?? null, managerName: rec.manager?.fullName ?? null, status: rec.status,
      },
      kpis: rec.kpis.map((k) => ({
        title: k.title, unit: k.unit, polarity: k.polarity, weight: k.weight,
        thresholdMin: k.thresholdMin, target: k.target, stretch: k.stretchValue,
        finalActual: k.finalActual, score: scoreKpiItem(k), dataSource: k.dataSource,
        isCritical: k.isCritical, origin: k.origin,
      })),
      comps: rec.comps.map((c) => ({
        name: c.competency.name, kind: c.competency.kind,
        selfScore: c.selfScore, score: c.score, comment: c.comment,
      })),
      f360,
      final: {
        selfScore: r1n(rec.selfScore), managerScore: r1n(rec.managerScore), finalScore: r1n(rec.finalScore),
        finalRating: rec.finalRating, potentialBand: rec.potentialBand,
        calibrated: calibrated != null, acknowledgedAt: iso(rec.acknowledgedAt),
      },
    },
  };
}

// ---------- PF2.4 Ringkasan 360 Ter-agregasi (ANONIM ≥3) ----------
async function pf24Agg360(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF24Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const feedbacks = await db.feedback360.findMany({
    where: { status: "Submitted", appraisal: { cycleId: cycle.id } },
    include: { answers: true },
  });
  // nama kompetensi — Feedback360Answer tak punya relasi langsung; batch query.
  const compIds = [...new Set(feedbacks.flatMap((f) => f.answers.map((a) => a.competencyId)))];
  const comps = compIds.length > 0
    ? await db.competency.findMany({ where: { id: { in: compIds } }, select: { id: true, name: true } })
    : [];
  const compName = new Map(comps.map((c) => [c.id, c.name]));
  // agregat per kelompok reviewer — HANYA count ≥3 yang boleh tampil nilai (§37).
  // (helper bertipe eksplisit — fallback `??` literal dgn `new Map()` nested
  // membuat skor ter-infer `never[]`; helper dgn return type memutus ambigu.)
  interface F360Group { count: number; scores: number[]; byComp: Map<string, { name: string; sum: number; n: number }> }
  const newGroup = (): F360Group => ({ count: 0, scores: [], byComp: new Map() });
  const byType = new Map<string, F360Group>();
  for (const f of feedbacks) {
    const g = byType.get(f.reviewerType) ?? newGroup();
    g.count++;
    for (const a of f.answers) {
      g.scores.push(a.score);
      const c = g.byComp.get(a.competencyId);
      if (c) { c.sum += a.score; c.n += 1; }
      else g.byComp.set(a.competencyId, { name: compName.get(a.competencyId) ?? "—", sum: a.score, n: 1 });
    }
    byType.set(f.reviewerType, g);
  }
  const groups: PF24Data["groups"] = [];
  const excluded: PF24Data["excluded"] = [];
  for (const [group, g] of byType) {
    if (g.count < 3) { excluded.push({ group, count: g.count }); continue; }
    // merge lintas competencyId dgn NAMA sama (kompetensi serumpun, cth. core
    // vs managerial same-name) — Σbobot & n digabung sebelum rata-rata.
    const compAgg = new Map<string, { name: string; sum: number; n: number }>();
    for (const c of g.byComp.values()) {
      const e = compAgg.get(c.name) ?? { name: c.name, sum: 0, n: 0 };
      e.sum += c.sum; e.n += c.n;
      compAgg.set(c.name, e);
    }
    groups.push({
      group,
      count: g.count,
      overallAvg: g.scores.length ? round1(g.scores.reduce((a, b) => a + b, 0) / g.scores.length) : null,
      byComp: Array.from(compAgg.values())
        .sort((a, b) => a.name.localeCompare(b.name, "id"))
        .map((c) => ({ competency: c.name, avg: round1(c.sum / c.n) })),
    });
  }
  groups.sort((a, b) => a.group.localeCompare(b.group, "id"));
  return {
    periodLabel: `Siklus ${cycle.code} · umpan balik 360 ter-agregasi`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name },
      groups,
      excluded,
      note: "Anonimitas §37: hanya kelompok dengan ≥3 responden yang ditampilkan.",
    },
  };
}

// ===================== G3 — KUALITAS & KEPATUHAN =====================

// ---------- PF3.1 Jejak Kalibrasi ----------
async function pf31Calibration(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF31Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const sessions = await db.calibrationSession.findMany({
    where: { cycleId: cycle.id },
    include: {
      chair: { select: { fullName: true } },
      decisions: {
        include: { appraisal: { include: { employee: { select: { fullName: true } } } } },
        orderBy: { decidedAt: "desc" },
      },
    },
    orderBy: { heldAt: "desc" },
  });
  const unitsAll = await db.orgUnit.findMany({ select: { id: true, name: true } });
  const unitName = new Map(unitsAll.map((u) => [u.id, u.name]));
  const rows: PF31Data["sessions"] = sessions.map((ss) => ({
    id: ss.id, heldAt: ss.heldAt.toISOString(),
    unit: ss.orgUnitId ? unitName.get(ss.orgUnitId) ?? null : null,
    chairName: ss.chair?.fullName ?? null, notes: ss.notes,
    decisions: ss.decisions.map((d) => ({
      docNo: d.appraisal.docNo, employeeName: d.appraisal.employee.fullName,
      oldScore: r1n(d.oldScore), newScore: r1n(d.newScore),
      oldRating: d.oldRating, newRating: d.newRating, potentialBand: d.potentialBand,
      reason: d.reason, decidedBy: d.decidedBy, decidedAt: d.decidedAt.toISOString(),
    })),
  }));
  return {
    periodLabel: `Siklus ${cycle.code} · jejak kalibrasi ter-audit`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name },
      sessions: rows,
      totalSessions: rows.length,
      totalDecisions: rows.reduce((s, x) => s + x.decisions.length, 0),
    },
  };
}

// ---------- PF3.2 Indikator Bias Atasan (D19) ----------
async function pf32Bias(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF32Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = await cycleParticipants(db, cycle.id, fp.unitId, { status: { in: SCORED } });
  const pts = recs
    .map((r) => ({ managerName: r.manager?.fullName ?? "(tanpa atasan)", score: (r.finalScore ?? r.managerScore) as number | null }))
    .filter((p): p is { managerName: string; score: number } => p.score != null);
  const n = pts.length;
  const mean = n ? pts.reduce((s, p) => s + p.score, 0) / n : null;
  const sigma = n >= 2 && mean != null ? Math.sqrt(pts.reduce((s, p) => s + (p.score - mean) ** 2, 0) / n) : null;

  const byMgr = new Map<string, number[]>();
  for (const p of pts) {
    const arr = byMgr.get(p.managerName) ?? [];
    arr.push(p.score);
    byMgr.set(p.managerName, arr);
  }
  const rows: PF32Data["rows"] = [];
  for (const [managerName, scores] of byMgr) {
    if (scores.length < 2) continue; // butuh ≥2 utk z bermakna (mirror D19)
    const teamMean = scores.reduce((s, x) => s + x, 0) / scores.length;
    const teamSigma = Math.sqrt(scores.reduce((s, x) => s + (x - teamMean) ** 2, 0) / scores.length);
    const z = sigma != null && sigma > 0 ? round2((teamMean - (mean ?? 0)) / sigma) : null;
    let flag: PF32Data["rows"][number]["flag"] = "ok";
    let flagLabelId = "Kewajaran dalam batas";
    let flagLabelEn = "Within normal bounds";
    if (z != null) {
      if (z <= -2) { flag = "red-pelis"; flagLabelId = "TERLALU PELIS (z ≤ −2)"; flagLabelEn = "TOO STRICT (z ≤ −2)"; }
      else if (z <= -1) { flag = "amber-pelis"; flagLabelId = "cenderung pelis (z ≤ −1)"; flagLabelEn = "leans strict (z ≤ −1)"; }
      else if (z >= 2) { flag = "red-royal"; flagLabelId = "TERLALU ROYAL (z ≥ +2)"; flagLabelEn = "TOO LENIENT (z ≥ +2)"; }
      else if (z >= 1) { flag = "amber-royal"; flagLabelId = "cenderung royal (z ≥ +1)"; flagLabelEn = "leans lenient (z ≥ +1)"; }
      else if (sigma != null && sigma > 0 && teamSigma < sigma / 2) { flag = "central"; flagLabelId = "central tendency — semua nilai “aman” di tengah"; flagLabelEn = "central tendency — all scores “safe” mid-range"; }
    }
    rows.push({
      managerName, teamSize: scores.length, teamMean: round1(teamMean), teamSigma: round2(teamSigma),
      sigmaRatio: sigma != null && sigma > 0 ? round2(teamSigma / sigma) : null,
      z, flag, flagLabelId, flagLabelEn,
    });
  }
  rows.sort((a, b) => Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0));

  const FLAG_LABELS: Record<string, [string, string]> = {
    "red-pelis": ["Terlalu pelis", "Too strict"], "amber-pelis": ["Cenderung pelis", "Leans strict"],
    "red-royal": ["Terlalu royal", "Too lenient"], "amber-royal": ["Cenderung royal", "Leans lenient"],
    central: ["Central tendency", "Central tendency"], ok: ["Wajar", "Within bounds"],
  };
  const flags = ["red-pelis", "amber-pelis", "amber-royal", "red-royal", "central", "ok"]
    .map((f) => ({ flag: f, count: rows.filter((r) => r.flag === f).length }))
    .filter((f) => f.count > 0)
    .map((f) => ({ ...f, label: `${FLAG_LABELS[f.flag][0]} (${FLAG_LABELS[f.flag][1]})` }));

  return {
    periodLabel: `Siklus ${cycle.code} · deteksi bias atasan (D19)`,
    payload: {
      cycle: { code: cycle.code, name: cycle.name },
      company: { n, mean: r1n(mean), sigma: r2n(sigma) },
      rows,
      flags,
    },
  };
}

// ---------- PF3.3 Register Banding & Keputusannya ----------
async function pf33Appeals(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF33Data }> {
  const APPEAL_DAYS = 7; // D6 — mirror PerformanceSetting default appealDays
  const recs = await db.appraisalRecord.findMany({
    where: {
      appealStatus: { not: null },
      ...(fp.cycleId ? { cycleId: fp.cycleId } : {}),
    },
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
      cycle: { select: { code: true, publishAt: true } },
    },
    orderBy: [{ appealDecidedAt: "desc" }, { docNo: "asc" }],
  });
  // tanggal ajuk — best-effort dari ActivityLog "BANDING …" per dokumen.
  const logs = await db.activityLog.findMany({
    where: { entity: "AppraisalRecord", detail: { startsWith: "BANDING" } },
    select: { entityId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const submittedBy = new Map<string, string>();
  for (const l of logs) {
    if (l.entityId && !submittedBy.has(l.entityId)) submittedBy.set(l.entityId, l.createdAt.toISOString());
  }
  const rows: PF33Data["rows"] = recs.map((r) => ({
    docNo: r.docNo, employeeNo: r.employee.employeeNo, name: r.employee.fullName,
    unit: r.employee.orgUnit?.name ?? null,
    appealNote: r.appealNote, appealStatus: r.appealStatus,
    submittedAt: submittedBy.get(r.id) ?? null,
    decidedBy: r.appealDecidedBy, decidedAt: iso(r.appealDecidedAt),
    windowEnd: r.cycle.publishAt ? new Date(r.cycle.publishAt.getTime() + APPEAL_DAYS * 24 * 3600 * 1000).toISOString() : null,
    cycleCode: r.cycle.code,
  }));
  const cycleChipCode = fp.cycleId ? (await db.performanceCycle.findUnique({ where: { id: fp.cycleId }, select: { code: true } }))?.code ?? "" : "";
  return {
    periodLabel: fp.cycleId
      ? `Siklus ${cycleChipCode} · register banding`
      : `Semua siklus · register banding · data per ${dateID(new Date())}`,
    payload: {
      rows,
      total: rows.length,
      pending: rows.filter((r) => r.appealStatus === "Submitted").length,
      decided: rows.filter((r) => r.appealStatus && r.appealStatus !== "Submitted").length,
    },
  };
}

// ===================== G4 — KONSEKUENSI & ANALITIK =====================

// ---------- PF4.1 Register Merit ----------
async function pf41Merit(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF41Data }> {
  const tc = tenantCryptoForDb(db as unknown as object);
  const recs = await db.meritRecommendation.findMany({
    where: fp.cycleId ? { appraisal: { cycleId: fp.cycleId } } : {},
    include: {
      appraisal: {
        select: {
          docNo: true, finalRating: true, cycleId: true,
          employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
        },
      },
    },
    orderBy: { docNo: "asc" },
  });
  const chains = await attachChainSummaries(db, "MeritRecommendation", recs.map((r) => ({ id: r.id })));
  const cycleIds = [...new Set(recs.map((r) => r.appraisal.cycleId))];
  const cycles = cycleIds.length ? await db.performanceCycle.findMany({ where: { id: { in: cycleIds } }, select: { id: true, code: true } }) : [];
  const cycleBy = new Map(cycles.map((c) => [c.id, c.code]));
  const matrixIds = [...new Set(recs.map((r) => r.matrixId).filter((x): x is string => x != null))];
  const matrices = matrixIds.length ? await db.meritMatrix.findMany({ where: { id: { in: matrixIds } }, select: { id: true, code: true } }) : [];
  const matrixBy = new Map(matrices.map((m) => [m.id, m.code]));
  const paIds = recs.map((r) => r.personnelActionId).filter((x): x is string => x != null);
  const pas = paIds.length ? await db.personnelAction.findMany({ where: { id: { in: paIds } }, select: { id: true, docNo: true } }) : [];
  const paBy = new Map(pas.map((p) => [p.id, p.docNo]));
  const letters = await db.letterDocument.findMany({ where: { templateKey: "PERF_RESULT" }, select: { metaJson: true, refNo: true }, orderBy: { issuedAt: "desc" } });
  const letterBy = new Map<string, string>();
  for (const l of letters) {
    try {
      const mj = JSON.parse(l.metaJson ?? "{}") as { appraisalDocNo?: string; sourceRef?: string };
      const key = mj.sourceRef ?? mj.appraisalDocNo;
      if (key && !letterBy.has(key)) letterBy.set(key, l.refNo);
    } catch { /* abaikan */ }
  }
  const rows: PF41Data["rows"] = recs.map((r) => ({
    docNo: r.docNo, cycleCode: cycleBy.get(r.appraisal.cycleId) ?? "—",
    employeeNo: r.appraisal.employee.employeeNo, name: r.appraisal.employee.fullName,
    unit: r.appraisal.employee.orgUnit?.name ?? null, finalRating: r.appraisal.finalRating,
    matrixCode: r.matrixId ? matrixBy.get(r.matrixId) ?? null : null,
    bonusMonths: r.bonusMonths, bonusAmount: r.bonusAmount ? tc.decryptMoney(r.bonusAmount) : null,
    raisePct: r.raisePct, raiseAmount: r.raiseAmount ? tc.decryptMoney(r.raiseAmount) : null,
    status: r.status, chainStatus: chains.get(r.id)?.status ?? null,
    appliedRunNo: r.appliedRunNo, paDocNo: r.personnelActionId ? paBy.get(r.personnelActionId) ?? null : null,
    letterRefNo: letterBy.get(r.appraisal.docNo) ?? null,
  }));
  return {
    periodLabel: fp.cycleId ? `Siklus ${cycleBy.get(fp.cycleId) ?? ""} · register merit` : `Semua siklus · register merit · data per ${dateID(new Date())}`,
    payload: {
      rows,
      summary: {
        count: rows.length,
        approved: rows.filter((r) => r.status === "Approved").length,
        applied: rows.filter((r) => r.status === "Applied").length,
        sumBonus: round2(rows.reduce((s, r) => s + (r.bonusAmount ?? 0), 0)),
        sumRaise: round2(rows.reduce((s, r) => s + (r.raiseAmount ?? 0), 0)),
      },
    },
  };
}

// ---------- PF4.2 Register PIP & Outcome ----------
async function pf42Pip(db: TenantDb): Promise<{ periodLabel: string; payload: PF42Data }> {
  const pips = await db.pipPlan.findMany({
    include: {
      employee: { select: { employeeNo: true, fullName: true, orgUnit: { select: { name: true } } } },
      checkpoints: { orderBy: { seq: "asc" } },
    },
    orderBy: { docNo: "asc" },
  });
  // riwayat SP per karyawan (saran jenjang berikut — mirror pip-service §33-4).
  const empIds = [...new Set(pips.map((p) => p.employeeId))];
  const disc = empIds.length
    ? await db.disciplinaryRecord.findMany({ where: { employeeId: { in: empIds } }, select: { employeeId: true, warningLevel: true } })
    : [];
  const discByEmp = new Map<string, string[]>();
  for (const d of disc) {
    const arr = discByEmp.get(d.employeeId) ?? [];
    arr.push(d.warningLevel);
    discByEmp.set(d.employeeId, arr);
  }
  const spSuggest = (employeeId: string): string | null => {
    const levels = (discByEmp.get(employeeId) ?? []).filter((l) => SP_RANK[l] != null);
    const highest = levels.reduce<string | null>((h, l) => (h == null || SP_RANK[l] > SP_RANK[h] ? l : h), null);
    if (highest == null) return "SP1 Verbal (belum ada riwayat SP)";
    if (SP_RANK[highest] >= 3) return `SP terakhir: ${highest} — eskalasi keputusan direksi (PHK manual via HR Base)`;
    const next = SP_RANK[highest] === 1 ? "SP2 Tertulis" : "SP3 Final";
    return `SP terakhir: ${highest} — saran berikut: ${next}`;
  };
  const rows: PF42Data["rows"] = pips.map((p) => {
    const reviewed = p.checkpoints.filter((c) => c.status === "Reviewed");
    const last = p.checkpoints[p.checkpoints.length - 1] ?? null;
    return {
      docNo: p.docNo, employeeNo: p.employee.employeeNo, name: p.employee.fullName,
      unit: p.employee.orgUnit?.name ?? null,
      startDate: p.startDate.toISOString(), endDate: p.endDate.toISOString(),
      status: p.status, reviewerName: null,
      checkpoints: {
        total: p.checkpoints.length,
        reviewed: reviewed.length,
        lastAchievement: (last?.achievementPct ?? reviewed[reviewed.length - 1]?.achievementPct ?? null),
      },
      spSuggestion: p.status === "NotRecovered" ? spSuggest(p.employeeId) : null,
    };
  });
  // nama pembina (1 query ringkas — diisikan ke baris via docNo → reviewerId).
  const revIds = [...new Set(pips.map((p) => p.reviewerId))];
  const reviewers = revIds.length ? await db.employee.findMany({ where: { id: { in: revIds } }, select: { id: true, fullName: true } }) : [];
  const revBy = new Map(reviewers.map((r) => [r.id, r.fullName]));
  const revOfDoc = new Map(pips.map((p) => [p.docNo, revBy.get(p.reviewerId) ?? null]));
  for (const r of rows) r.reviewerName = revOfDoc.get(r.docNo) ?? null;

  const recovered = rows.filter((r) => r.status === "Recovered").length;
  const notRecovered = rows.filter((r) => r.status === "NotRecovered").length;
  return {
    periodLabel: `Semua PIP · data per ${dateID(new Date())}`,
    payload: {
      rows,
      summary: {
        total: rows.length,
        active: rows.filter((r) => r.status === "Active" || r.status === "Extended").length,
        recovered, notRecovered,
        recoveryRate: recovered + notRecovered > 0 ? round1((recovered / (recovered + notRecovered)) * 100) : null,
      },
    },
  };
}

// ---------- PF4.3 Snapshot 9-Box ----------
async function pf43Ninebox(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF43Data }> {
  const cycle = await getCycle(db, fp.cycleId);
  const recs = await cycleParticipants(db, cycle.id, null, { status: { in: SCORED } });
  const cells: PF43Data["cells"] = [];
  for (let pot = 1; pot <= 3; pot++) for (let perf = 1 as 1 | 2 | 3; perf <= 3; perf++) {
    cells.push({ pot, perf, participants: [] });
  }
  let placed = 0;
  let unplaced = 0;
  for (const r of recs) {
    if (r.potentialBand == null || r.finalRating == null) { unplaced++; continue; }
    const perf: 1 | 2 | 3 = r.finalRating <= 2 ? 1 : r.finalRating === 3 ? 2 : 3;
    cells.find((c) => c.pot === r.potentialBand && c.perf === perf)?.participants.push({
      employeeNo: r.employee.employeeNo, name: r.employee.fullName,
      unit: r.employee.orgUnit?.name ?? null,
      score: r.finalScore == null ? null : round1(r.finalScore), rating: r.finalRating,
    });
    placed++;
  }
  return {
    periodLabel: `Siklus ${cycle.code} · snapshot 9-box`,
    payload: { cycle: { code: cycle.code, name: cycle.name }, cells, placed, unplaced },
  };
}

// ---------- PF4.4 Tren Kinerja Multi-Tahun per Unit ----------
async function pf44Trend(db: TenantDb, fp: ReportFilters): Promise<{ periodLabel: string; payload: PF44Data }> {
  const cycles = await db.performanceCycle.findMany({ select: { id: true, code: true, periodStart: true } });
  const cycleYear = new Map(cycles.map((c) => [c.id, c.periodStart.getFullYear()]));
  const cycleCode = new Map(cycles.map((c) => [c.id, c.code]));
  const scopedUnitIds = fp.unitId ? await unitSubtreeIds(db, fp.unitId) : null;
  const recs = await db.appraisalRecord.findMany({
    where: {
      status: { in: SCORED },
      finalScore: { not: null },
      ...(scopedUnitIds ? { employee: { orgUnitId: { in: [...scopedUnitIds] } } } : {}),
    },
    include: {
      employee: { select: { orgUnit: { select: { name: true } } } },
      cycle: { select: { id: true } },
    },
  });
  const agg = new Map<string, { unit: string; year: number; cycles: Set<string>; participants: number; sum: number; counts: number[] }>();
  for (const r of recs) {
    const unit = r.employee.orgUnit?.name ?? "(tanpa unit)";
    const year = cycleYear.get(r.cycle.id) ?? 0;
    if (!year) continue;
    const key = `${unit}||${year}`;
    const e = agg.get(key) ?? { unit, year, cycles: new Set<string>(), participants: 0, sum: 0, counts: [0, 0, 0, 0, 0] };
    const code = cycleCode.get(r.cycle.id) ?? "?";
    e.cycles.add(code);
    e.participants++;
    e.sum += r.finalScore as number;
    e.counts[(r.finalRating ?? ratingFallback(r.finalScore as number)) - 1]++;
    agg.set(key, e);
  }
  const rows: PF44Data["rows"] = Array.from(agg.values())
    .map((e) => ({
      unit: e.unit, year: e.year, cycles: Array.from(e.cycles).sort().join(", "),
      participants: e.participants, counts: e.counts,
      meanScore: round1(e.sum / e.participants),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit, "id") || a.year - b.year);
  return {
    periodLabel: `Tren lintas siklus · data per ${dateID(new Date())}`,
    payload: { rows, years: [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b) },
  };
}

// ============ riwayat karyawan penuh (PP 35/2021 §7.2) — sheet builder ============

/** Workbook multi-sheet riwayat kinerja satu karyawan lintas siklus — dipakai
 *  API admin (employee-history) DAN ESS my-history (data sendiri). */
export async function buildEmployeeHistorySheets(db: TenantDb, employeeId: string, lang: Lang): Promise<ExportSheet[]> {
  const tc = tenantCryptoForDb(db as unknown as object);
  const recs = await db.appraisalRecord.findMany({
    where: { employeeId },
    include: {
      cycle: { select: { code: true, name: true, periodStart: true, periodEnd: true } },
      manager: { select: { fullName: true } },
      kpis: { orderBy: { createdAt: "asc" } },
      comps: { include: { competency: { select: { name: true, kind: true } } } },
    },
    orderBy: { docNo: "asc" },
  });
  const pips = await db.pipPlan.findMany({
    where: { employeeId },
    include: { checkpoints: { orderBy: { seq: "asc" } } },
    orderBy: { docNo: "asc" },
  });
  const merits = recs.length ? await db.meritRecommendation.findMany({
    where: { appraisalId: { in: recs.map((r) => r.id) } },
    orderBy: { docNo: "asc" },
  }) : [];
  const recBy = new Map(recs.map((r) => [r.id, r]));
  const title = `${trFor(lang, "Riwayat Penilaian Kinerja Karyawan (PP 35/2021 §7.2)", "Employee Performance History (PP 35/2021 §7.2)")} — ${dateID(new Date())}`;

  const sheet1: ExportSheet = {
    name: "Ringkasan",
    title,
    columns: [
      { header: "No. Dokumen", width: 16 }, { header: "Siklus", width: 14 }, { header: "Periode Siklus", width: 24 },
      { header: "Atasan Penilai", width: 22 }, { header: "Status", width: 14 },
      { header: "Skor Self", width: 10 }, { header: "Skor Atasan", width: 11 }, { header: "Skor Final", width: 10 },
      { header: "Rating", width: 8 }, { header: "Band Potensi", width: 12 },
      { header: "Ack", width: 8 }, { header: "Banding", width: 12 },
    ],
    rows: recs.map((r) => [
      s(r.docNo), s(r.cycle.code), `${dateID(r.cycle.periodStart)} – ${dateID(r.cycle.periodEnd)}`,
      s(r.manager?.fullName), s(r.status),
      r.selfScore ?? "", r.managerScore ?? "", r.finalScore ?? "",
      r.finalRating ?? "", r.potentialBand ?? "",
      r.acknowledgedAt ? "✓" : "", s(r.appealStatus ?? ""),
    ]),
  };

  const sheet2: ExportSheet = {
    name: "Target & Skor KPI",
    title,
    columns: [
      { header: "Siklus", width: 14 }, { header: "No. Dokumen", width: 16 }, { header: "Judul KPI", width: 30 },
      { header: "Satuan", width: 8 }, { header: "Polaritas", width: 10 }, { header: "Bobot %", width: 9 },
      { header: "Ambang (F)", width: 10 }, { header: "Target (T)", width: 10 }, { header: "Stretch", width: 9 },
      { header: "Aktual Mid", width: 10 }, { header: "Aktual Akhir", width: 12 }, { header: "Skor", width: 8 },
      { header: "Kritis", width: 7 }, { header: "Asal Baris", width: 18 },
    ],
    rows: recs.flatMap((r) => r.kpis.map((k) => [
      s(r.cycle.code), s(r.docNo), s(k.title), s(k.unit), s(k.polarity), k.weight,
      k.thresholdMin ?? "", k.target, k.stretchValue ?? "",
      k.midActual ?? "", k.finalActual ?? "", scoreKpiItem(k) ?? "",
      k.isCritical ? "F" : "", s(k.origin),
    ])),
  };

  const sheet3: ExportSheet = {
    name: "Kompetensi",
    title,
    columns: [
      { header: "Siklus", width: 14 }, { header: "No. Dokumen", width: 16 }, { header: "Kompetensi", width: 26 },
      { header: "Jenis", width: 14 }, { header: "Self", width: 7 }, { header: "Nilai Atasan", width: 12 },
      { header: "Catatan Atasan", width: 34 },
    ],
    rows: recs.flatMap((r) => r.comps.map((c) => [
      s(r.cycle.code), s(r.docNo), s(c.competency.name), s(c.competency.kind),
      c.selfScore ?? "", c.score, s(c.comment),
    ])),
  };

  const sheet4: ExportSheet = {
    name: "PIP",
    title,
    columns: [
      { header: "No. Dokumen", width: 16 }, { header: "Periode", width: 24 }, { header: "Status", width: 14 },
      { header: "Checkpoint Ter-review", width: 18 }, { header: "Capaian Terakhir %", width: 16 },
      { header: "Catatan Outcome", width: 36 },
    ],
    rows: pips.map((p) => {
      const reviewed = p.checkpoints.filter((c) => c.status === "Reviewed");
      const last = p.checkpoints[p.checkpoints.length - 1] ?? null;
      return [
        s(p.docNo), `${dateID(p.startDate)} – ${dateID(p.endDate)}`, s(p.status),
        `${reviewed.length}/${p.checkpoints.length}`,
        (last?.achievementPct ?? reviewed[reviewed.length - 1]?.achievementPct ?? "") as ExportCell,
        s(p.outcomeNotes),
      ];
    }),
  };

  const sheet5: ExportSheet = {
    name: "Merit",
    title,
    columns: [
      { header: "No. Dokumen", width: 16 }, { header: "Siklus", width: 14 }, { header: "No. Penilaian", width: 16 },
      { header: "Bonus (bln)", width: 11 }, { header: "Bonus (Rp)", width: 16 },
      { header: "Kenaikan %", width: 11 }, { header: "Kenaikan (Rp)", width: 16 },
      { header: "Status", width: 12 }, { header: "Run Payroll", width: 16 },
    ],
    rows: merits.map((mr) => [
      s(mr.docNo), s(recBy.get(mr.appraisalId)?.cycle.code), s(recBy.get(mr.appraisalId)?.docNo),
      mr.bonusMonths ?? "", rp(mr.bonusAmount ? tc.decryptMoney(mr.bonusAmount) : null),
      mr.raisePct ?? "", rp(mr.raiseAmount ? tc.decryptMoney(mr.raiseAmount) : null),
      s(mr.status), s(mr.appliedRunNo),
    ]),
  };

  return [sheet1, sheet2, sheet3, sheet4, sheet5];
}

// ============ XLSX per laporan ============

const d = (isoStr: string | null): string => (isoStr ? dateID(new Date(isoStr)) : "");

function buildSheets(id: string, p: AnyRec, periodLabel: string, lang: Lang = "id"): ExportSheet[] {
  const title = `${trFor(lang, REPORT_TITLES[id])}${periodLabel ? ` — ${locReportFor(lang, periodLabel)}` : ""}`;
  switch (id) {
    case "pf11": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Siklus",
        title,
        columns: [
          { header: "Kode", width: 14 }, { header: "Nama Siklus", width: 26 }, { header: "Jenis", width: 12 },
          { header: "Periode", width: 24 }, { header: "Status", width: 14 },
          { header: "Fase Target", width: 20 }, { header: "Mid-Year", width: 20 }, { header: "Fase Self", width: 20 },
          { header: "Fase Atasan", width: 20 }, { header: "Kalibrasi", width: 20 },
          { header: "Peserta", width: 9 }, { header: "Selesai", width: 9 }, { header: "Penyelesaian %", width: 13 },
        ],
        rows: rows.map((r) => {
          const g = r.gates as Record<string, string | null>;
          return [
            s(r.code), s(r.name), s(r.cycleType), `${d(r.periodStart as string)} – ${d(r.periodEnd as string)}`, s(r.status),
            s(g.goal), s(g.mid), s(g.self), s(g.mgr), s(g.calib),
            r.participants as number, r.completed as number, r.completionPct as number,
          ];
        }),
      }];
    }
    case "pf12": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Completion",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 22 }, { header: "Status", width: 16 },
          { header: "Target", width: 8 }, { header: "Self", width: 7 }, { header: "Atasan", width: 8 },
          { header: "Ack", width: 7 }, { header: "Skor Final", width: 10 },
        ],
        rows: rows.map((r) => [
          s(r.docNo), s(r.employeeNo), s(r.name), s(r.unit), s(r.status),
          r.targetDone ? "✓" : "✗", r.selfDone ? "✓" : "✗", r.managerDone ? "✓" : "✗",
          r.acknowledged ? "✓" : "✗", r.finalScore ?? "",
        ]),
      }];
    }
    case "pf13": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "KPI",
        title,
        columns: [
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 }, { header: "Unit", width: 20 },
          { header: "Kode KPI", width: 12 }, { header: "Judul KPI", width: 30 }, { header: "Satuan", width: 8 },
          { header: "Polaritas", width: 10 }, { header: "Bobot %", width: 9 }, { header: "Ambang (F)", width: 10 },
          { header: "Target (T)", width: 10 }, { header: "Stretch", width: 9 }, { header: "Kritis", width: 7 },
          { header: "Asal Baris", width: 18 },
        ],
        rows: rows.map((r) => [
          s(r.employeeNo), s(r.name), s(r.unit), s(r.kpiCode), s(r.title), s(r.unitOf),
          s(r.polarity), r.weight as number, r.thresholdMin ?? "", r.target as number, r.stretch ?? "",
          r.isCritical ? "F" : "", s(r.origin),
        ]),
      }];
    }
    case "pf21": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Hasil",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Atasan Penilai", width: 22 }, { header: "Status", width: 14 },
          { header: "Skor Atasan", width: 11 }, { header: "Skor Final", width: 10 }, { header: "Rating", width: 8 },
          { header: "Band Potensi", width: 12 }, { header: "Kalibrasi", width: 10 }, { header: "Ack", width: 7 },
        ],
        rows: rows.map((r) => [
          s(r.docNo), s(r.employeeNo), s(r.name), s(r.unit), s(r.managerName), s(r.status),
          r.managerScore ?? "", r.finalScore ?? "", r.finalRating ?? "", r.potentialBand ?? "",
          r.calibrated ? "✓" : "", r.acknowledgedAt ? "✓" : "",
        ]),
      }];
    }
    case "pf22": {
      const mk = (rows: AnyRec[] | undefined, keyName: string, sheetName: string): ExportSheet => ({
        name: sheetName,
        title,
        columns: [
          { header: keyName, width: 26 }, { header: "Peserta", width: 9 },
          { header: "Rating 1", width: 9 }, { header: "Rating 2", width: 9 }, { header: "Rating 3", width: 9 },
          { header: "Rating 4", width: 9 }, { header: "Rating 5", width: 9 },
          { header: "Rata-rata", width: 10 }, { header: "σ", width: 9 },
        ],
        rows: (rows ?? []).map((r) => [
          s(r.key), r.participants as number,
          ...((r.counts as number[]) ?? []),
          r.mean ?? "", r.sigma ?? "",
        ]),
      });
      return [
        mk(p.byUnit as AnyRec[], "Unit Kerja", "Per Unit"),
        mk(p.byManager as AnyRec[], "Atasan Penilai", "Per Atasan"),
        mk([{ ...(p.overall as AnyRec), key: "TOTAL" }], "Ringkasan", "Ringkasan"),
      ];
    }
    case "pf23": {
      const emp = p.employee as AnyRec;
      const kpis = (p.kpis as AnyRec[]) ?? [];
      const comps = (p.comps as AnyRec[]) ?? [];
      const fin = p.final as AnyRec;
      return [
        {
          name: "Skor KPI",
          title,
          columns: [
            { header: "Judul KPI", width: 30 }, { header: "Satuan", width: 8 }, { header: "Polaritas", width: 10 },
            { header: "Bobot %", width: 9 }, { header: "Ambang (F)", width: 10 }, { header: "Target (T)", width: 10 },
            { header: "Stretch", width: 9 }, { header: "Aktual", width: 10 }, { header: "Skor", width: 8 }, { header: "Kritis", width: 7 },
          ],
          rows: kpis.map((k) => [
            s(k.title), s(k.unit), s(k.polarity), k.weight as number, k.thresholdMin ?? "", k.target as number,
            k.stretch ?? "", k.finalActual ?? "", k.score ?? "", k.isCritical ? "F" : "",
          ]),
        },
        {
          name: "Kompetensi",
          title,
          columns: [
            { header: "Kompetensi", width: 26 }, { header: "Jenis", width: 14 }, { header: "Self", width: 7 },
            { header: "Nilai Atasan", width: 12 }, { header: "Catatan Atasan", width: 34 },
          ],
          rows: comps.map((c) => [s(c.name), s(c.kind), c.selfScore ?? "", c.score ?? "", s(c.comment)]),
        },
        {
          name: "Ringkasan",
          title,
          columns: [
            { header: "No. Dokumen", width: 16 }, { header: "Karyawan", width: 26 },
            { header: "Skor Self", width: 10 }, { header: "Skor Atasan", width: 11 }, { header: "Skor Final", width: 10 },
            { header: "Rating", width: 8 }, { header: "Band Potensi", width: 12 }, { header: "Kalibrasi", width: 10 },
          ],
          rows: [[
            s(emp.docNo), `${s(emp.employeeNo)} — ${s(emp.name)}`,
            fin.selfScore ?? "", fin.managerScore ?? "", fin.finalScore ?? "",
            fin.finalRating ?? "", fin.potentialBand ?? "", fin.calibrated ? "✓" : "",
          ]],
        },
      ];
    }
    case "pf24": {
      const groups = (p.groups as AnyRec[]) ?? [];
      const excluded = (p.excluded as AnyRec[]) ?? [];
      return [{
        name: "360 Agregat",
        title,
        columns: [
          { header: "Kelompok Reviewer", width: 20 }, { header: "Responden", width: 11 },
          { header: "Rata-rata Keseluruhan", width: 18 }, { header: "Rata-rata per Kompetensi", width: 40 },
        ],
        rows: [
          ...groups.map((g) => [
            s(g.group), g.count as number, g.overallAvg ?? "",
            (g.byComp as AnyRec[]).map((c) => `${s(c.competency)}: ${s(c.avg)}`).join(" · "),
          ]),
          ...excluded.map((g) => [s(g.group), g.count as number, "(disembunyikan — <3)", ""]),
        ],
      }];
    }
    case "pf31": {
      const sessions = (p.sessions as AnyRec[]) ?? [];
      return [{
        name: "Kalibrasi",
        title,
        columns: [
          { header: "Sesi", width: 8 }, { header: "Tanggal Sesi", width: 13 }, { header: "Unit", width: 18 },
          { header: "Ketua", width: 20 }, { header: "No. Penilaian", width: 16 }, { header: "Karyawan", width: 22 },
          { header: "Skor Dari", width: 10 }, { header: "Skor Ke", width: 9 }, { header: "Rating Dari", width: 10 },
          { header: "Rating Ke", width: 9 }, { header: "Band", width: 7 }, { header: "Alasan", width: 40 },
          { header: "Pemutus", width: 18 }, { header: "Waktu", width: 13 },
        ],
        rows: sessions.flatMap((ss, si) => (ss.decisions as AnyRec[]).map((dd) => [
          si + 1, d(ss.heldAt as string), s(ss.unit), s(ss.chairName), s(dd.docNo), s(dd.employeeName),
          dd.oldScore ?? "", dd.newScore ?? "", dd.oldRating ?? "", dd.newRating ?? "", dd.potentialBand ?? "",
          s(dd.reason), s(dd.decidedBy), d(dd.decidedAt as string),
        ])),
      }];
    }
    case "pf32": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const company = p.company as AnyRec;
      return [{
        name: "Bias Atasan",
        title,
        columns: [
          { header: "Atasan Penilai", width: 24 }, { header: "Tim (n)", width: 8 }, { header: "Rata-rata Tim", width: 12 },
          { header: "σ Tim", width: 8 }, { header: "σ-Rasio", width: 9 }, { header: "z", width: 8 },
          { header: "Flag", width: 34 },
        ],
        rows: [
          [trFor(lang, "RATA-RATA PERUSAHAAN", "COMPANY BASELINE"), company.n as number, company.mean ?? "", company.sigma ?? "", "", "", ""],
          ...rows.map((r) => [
            s(r.managerName), r.teamSize as number, r.teamMean as number, r.teamSigma as number,
            r.sigmaRatio ?? "", r.z ?? "", `${s(r.flagLabelId)} (${s(r.flagLabelEn)})`,
          ]),
        ],
      }];
    }
    case "pf33": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Banding",
        title,
        columns: [
          { header: "Siklus", width: 12 }, { header: "No. Penilaian", width: 16 }, { header: "No. Karyawan", width: 14 },
          { header: "Nama", width: 24 }, { header: "Unit", width: 20 }, { header: "Alasan Pengaju", width: 40 },
          { header: "Status", width: 16 }, { header: "Diajukan", width: 12 }, { header: "Diputus oleh", width: 18 },
          { header: "Waktu Keputusan", width: 14 }, { header: "Akhir Jendela D6", width: 14 },
        ],
        rows: rows.map((r) => [
          s(r.cycleCode), s(r.docNo), s(r.employeeNo), s(r.name), s(r.unit), s(r.appealNote),
          s(r.appealStatus), d(r.submittedAt as string), s(r.decidedBy), d(r.decidedAt as string), d(r.windowEnd as string),
        ]),
      }];
    }
    case "pf41": {
      const rows = (p.rows as AnyRec[]) ?? [];
      const sum = (p.summary as AnyRec) ?? {};
      return [{
        name: "Merit",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "Siklus", width: 12 }, { header: "No. Karyawan", width: 14 },
          { header: "Nama", width: 24 }, { header: "Unit", width: 20 }, { header: "Rating", width: 8 },
          { header: "Matriks", width: 12 }, { header: "Bonus (bln)", width: 11 }, { header: "Bonus (Rp)", width: 16 },
          { header: "Kenaikan %", width: 11 }, { header: "Kenaikan (Rp)", width: 16 }, { header: "Status", width: 14 },
          { header: "Approval", width: 14 }, { header: "Run Payroll", width: 16 }, { header: "No. PA", width: 14 }, { header: "Surat", width: 14 },
        ],
        rows: [
          ...rows.map((r) => [
            s(r.docNo), s(r.cycleCode), s(r.employeeNo), s(r.name), s(r.unit), r.finalRating ?? "",
            s(r.matrixCode), r.bonusMonths ?? "", rp(r.bonusAmount), r.raisePct ?? "", rp(r.raiseAmount),
            s(r.status), s(r.chainStatus), s(r.appliedRunNo), s(r.paDocNo), s(r.letterRefNo),
          ]),
          ["TOTAL", "", "", "", "", "", "", "", rp(sum.sumBonus), "", rp(sum.sumRaise), "", "", "", "", ""],
        ],
      }];
    }
    case "pf42": {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "PIP",
        title,
        columns: [
          { header: "No. Dokumen", width: 16 }, { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Periode", width: 24 }, { header: "Pembina", width: 22 },
          { header: "Checkpoint", width: 12 }, { header: "Capaian Terakhir %", width: 16 },
          { header: "Status", width: 14 }, { header: "Saran Tindak Lanjut", width: 40 },
        ],
        rows: rows.map((r) => {
          const cp = r.checkpoints as AnyRec;
          return [
            s(r.docNo), s(r.employeeNo), s(r.name), s(r.unit),
            `${d(r.startDate as string)} – ${d(r.endDate as string)}`, s(r.reviewerName),
            `${s(cp.reviewed)}/${s(cp.total)}`, cp.lastAchievement ?? "", s(r.status), s(r.spSuggestion),
          ];
        }),
      }];
    }
    case "pf43": {
      const cells = (p.cells as AnyRec[]) ?? [];
      return [{
        name: "9-Box",
        title,
        columns: [
          { header: "Band Potensi", width: 13 }, { header: "Kinerja", width: 20 },
          { header: "No. Karyawan", width: 14 }, { header: "Nama", width: 24 },
          { header: "Unit", width: 20 }, { header: "Skor Final", width: 10 }, { header: "Rating", width: 8 },
        ],
        rows: cells.flatMap((c) => (c.participants as AnyRec[]).map((pt) => [
          c.pot as number, c.perf === 1 ? "Rendah (≤2)" : c.perf === 2 ? "Tengah (3)" : "Tinggi (≥4)",
          s(pt.employeeNo), s(pt.name), s(pt.unit), pt.score ?? "", pt.rating ?? "",
        ])),
      }];
    }
    default: {
      const rows = (p.rows as AnyRec[]) ?? [];
      return [{
        name: "Tren Unit",
        title,
        columns: [
          { header: "Unit Kerja", width: 26 }, { header: "Tahun", width: 8 }, { header: "Siklus", width: 18 },
          { header: "Peserta", width: 9 }, { header: "Rating 1", width: 9 }, { header: "Rating 2", width: 9 },
          { header: "Rating 3", width: 9 }, { header: "Rating 4", width: 9 }, { header: "Rating 5", width: 9 },
          { header: "Rata-rata Skor", width: 13 },
        ],
        rows: rows.map((r) => [
          s(r.unit), r.year as number, s(r.cycles), r.participants as number,
          ...((r.counts as number[]) ?? []), r.meanScore ?? "",
        ]),
      }];
    }
  }
}
