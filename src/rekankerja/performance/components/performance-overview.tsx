"use client";
// RekanKerja Performance — Ringkasan: dashboard informatif modul (pola REC-OV
// recruitment / leave / travel): banner siklus aktif → KPI klik (penilaian
// berjalan · check-in · PIP · merit · OKR) → pipeline appraisal per status +
// kesehatan target → indikator alur siklus HORIZONTAL (7 fase, fase aktif
// disorot) → 360 (agregat, anonimitas ≥3 reviewer) → watchlist percobaan/PIP
// → feed aktivitas terakhir.
// Satu endpoint /api/rekankerja/performance/overview (menggantikan peta fase
// pengembangan + 3 panggilan API terpisah pada overview lama).
import { useApi, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, EmptyState, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CalendarRange, ClipboardCheck, MessagesSquare, LifeBuoy, Wallet, Lock, Telescope,
  BarChart3, Users, AlertTriangle, CheckCircle2, ArrowRight, Activity, Workflow,
  Hourglass, ShieldCheck, Target, Plus,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

// ============ tipe (cermin perf-overview-service) ============

interface PerfOverviewCycle {
  id: string; code: string; name: string;
  status: string; cycleType: string;
  periodStart: string; periodEnd: string;
  goalEnd: string | null; selfEnd: string | null; mgrEnd: string | null; calibEnd: string | null;
  publishAt: string | null;
  feedback360: boolean;
  isActive: boolean;
  participants: number;
}

interface OverviewData {
  cycle: PerfOverviewCycle | null;
  totals: { cycles: number; activeCycles: number };
  pipeline: { status: string; count: number }[];
  goals: {
    kpiRows: number; kpiWithActual: number;
    goalLocked: number; goalLockedPct: number | null;
    selfSubmitted: number; selfSubmittedPct: number | null;
  };
  checkins: { held30d: number; upcoming: number; missed: number };
  f360: { invited: number; submitted: number; declined: number; expired: number };
  calibration: { sessions: number; upcoming: number; decisions: number };
  pip: { draft: number; active: number; recovered: number; notRecovered: number; cancelled: number; recoveredPct: number | null };
  probation: { open: number; dueSoon: number; overdue: number };
  merit: {
    byStatus: { status: string; count: number }[];
    appliedCount: number; appliedTotal: number | null;
    money: { canSee: boolean };
  };
  okr: { quarter: string; draft: number; posted: number; closed: number; avgProgressPct: number | null } | null;
  activity: { action: string; entity: string; entityId: string | null; detail: string | null; createdAt: string }[];
}

// ============ peta label dwibahasa (sumber terjemahan — render via t) ============

/** 7 fase siklus penilaian (urutan state machine perf-cycle-service). */
const CYCLE_PHASES: { key: string; id: string; en: string }[] = [
  { key: "Draft", id: "Draf", en: "Draft" },
  { key: "GoalSetting", id: "Penetapan Target", en: "Goal Setting" },
  { key: "Ongoing", id: "Siklus Berjalan", en: "Ongoing" },
  { key: "Assessment", id: "Penilaian Diri & Atasan", en: "Self & Manager Review" },
  { key: "Calibration", id: "Kalibrasi", en: "Calibration" },
  { key: "Published", id: "Hasil Terbit", en: "Published" },
  { key: "Closed", id: "Ditutup", en: "Closed" },
];

const CYCLE_PHASE_BADGE: Record<string, { id: string; en: string; cls: string }> = {
  Draft: { id: "Draf", en: "Draft", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400" },
  GoalSetting: { id: "Penetapan Target", en: "Goal Setting", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300" },
  Ongoing: { id: "Siklus Berjalan", en: "Ongoing", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300" },
  Assessment: { id: "Penilaian Diri & Atasan", en: "Self & Manager Review", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300" },
  Calibration: { id: "Kalibrasi", en: "Calibration", cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300" },
  Published: { id: "Hasil Terbit", en: "Published", cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-300" },
  Closed: { id: "Ditutup", en: "Closed", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400" },
};

const CYCLE_TYPE_LABEL: Record<string, { id: string; en: string }> = {
  Annual: { id: "Tahunan", en: "Annual" },
  MidYearOnly: { id: "Setengah Tahun", en: "Mid-Year" },
  OffCycle: { id: "Luar Siklus", en: "Off-Cycle" },
};

/** Urutan tampilan pipeline appraisal (state machine AppraisalRecord). */
const PIPELINE_ORDER = [
  "Enrolled", "GoalProposed", "GoalApproved", "Ongoing", "SelfDone",
  "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed",
];

const APPRAISAL_STATUS_LABEL: Record<string, { id: string; en: string }> = {
  Enrolled: { id: "Terdaftar", en: "Enrolled" },
  GoalProposed: { id: "Usulan target", en: "Goal proposed" },
  GoalApproved: { id: "Target disetujui", en: "Goals approved" },
  Ongoing: { id: "Siklus berjalan", en: "Ongoing" },
  SelfDone: { id: "Penilaian diri selesai", en: "Self review done" },
  ManagerDone: { id: "Penilaian atasan selesai", en: "Manager review done" },
  Calibrating: { id: "Dalam kalibrasi", en: "In calibration" },
  Finalized: { id: "Finalisasi", en: "Finalized" },
  Published: { id: "Hasil terbit", en: "Published" },
  Appealed: { id: "Dalam banding", en: "Under appeal" },
  Closed: { id: "Ditutup", en: "Closed" },
};

/** Status appraisal yang sudah final (tidak dihitung sebagai "berjalan"). */
const FINAL_STATUSES = ["Finalized", "Published", "Appealed", "Closed"];

const ACT_ENTITY_LABEL: Record<string, { id: string; en: string }> = {
  AppraisalRecord: { id: "Penilaian", en: "Appraisal" },
  CheckIn: { id: "Check-in 1-on-1", en: "1-on-1 check-in" },
  CalibrationSession: { id: "Sesi kalibrasi", en: "Calibration session" },
  MeritRecommendation: { id: "Rekomendasi merit", en: "Merit recommendation" },
  PipPlan: { id: "Program PIP", en: "PIP plan" },
  ProbationEvaluation: { id: "Evaluasi percobaan", en: "Probation evaluation" },
  OkrObjective: { id: "Objective OKR", en: "OKR objective" },
  Feedback360: { id: "Umpan balik 360", en: "360 feedback" },
  PerformanceCycle: { id: "Siklus penilaian", en: "Performance cycle" },
};

const ACT_ACTION_LABEL: Record<string, { id: string; en: string }> = {
  Created: { id: "Dibuat", en: "Created" },
  Updated: { id: "Diperbarui", en: "Updated" },
  Deleted: { id: "Dihapus", en: "Deleted" },
  Submitted: { id: "Disubmit", en: "Submitted" },
  Approved: { id: "Disetujui", en: "Approved" },
  Rejected: { id: "Ditolak", en: "Rejected" },
  Processed: { id: "Diproses", en: "Processed" },
  Cancelled: { id: "Dibatalkan", en: "Cancelled" },
  Nudged: { id: "Pengingat terkirim", en: "Reminder sent" },
  Expired: { id: "Kedaluwarsa", en: "Expired" },
  Missed: { id: "Terlewat", en: "Missed" },
};

/** Aksi klik-navigasi div/card (role=button) — mouse + keyboard + aria. */
function clickHandlers(onClick: () => void) {
  return {
    onClick,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  };
}

// ============ komponen ============

/** Tile KPI klik-navigasi — tombol penuh (keyboard + aria-label). */
function KpiTile({
  label, value, sub, subLocked, Icon, warn, hero, onClick, ariaLabel,
}: {
  label: string; value: string; sub?: string | null; subLocked?: boolean;
  Icon: React.ElementType; warn?: boolean; hero?: boolean;
  onClick: () => void; ariaLabel: string;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      {...clickHandlers(onClick)}
      className="min-w-0 cursor-pointer border-slate-200 bg-white/80 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:border-slate-800 dark:bg-slate-900/80"
    >
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
          <p className={cn(
            "mt-1 text-2xl font-black tabular-nums",
            warn ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-100",
          )}>{value}</p>
          {sub && (
            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {subLocked && <Lock className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />}
              <span>{sub}</span>
            </p>
          )}
        </div>
        <div className={cn("rounded-xl p-2.5 shrink-0", hero ? "ov-fill" : "ov-tile")}>
          <Icon className="h-5 w-5" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

/** Baris progres klik-navigasi pada kartu kesehatan target. */
function GoalRow({
  label, num, den, pct, hint, onClick, ariaLabel,
}: {
  label: string; num: number; den: number; pct: number | null; hint: string;
  onClick: () => void; ariaLabel: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      {...clickHandlers(onClick)}
      className="cursor-pointer rounded-xl p-1 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-slate-800/60"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</span>
        <span className="shrink-0 text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">{num}/{den}</span>
      </div>
      <Progress value={pct ?? 0} className="mt-1 h-2 [&>div]:ov-bar" />
      <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

export function PerformanceOverview() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, loading, error } = useApi<{ overview: OverviewData }>("/api/rekankerja/performance/overview");
  const d = data?.overview ?? null;

  const phaseBadge = (s: string) => CYCLE_PHASE_BADGE[s] ?? { id: s, en: s, cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400" };
  const statusLabel = (s: string) => APPRAISAL_STATUS_LABEL[s] ?? { id: s, en: s };

  // ---- header ----
  const header = (
    <PageHeader
      eyebrow={t("MODUL PERFORMANCE", "PERFORMANCE MODULE")}
      title={t("Ringkasan Kinerja", "Performance Overview")}
      description={t(
        "Denyut modul penilaian kinerja: siklus berjalan, progres penilaian, check-in 1-on-1, umpan balik 360, kalibrasi, sampai tindak lanjut PIP, percobaan, dan merit.",
        "The pulse of the performance module: running cycles, appraisal progress, 1-on-1 check-ins, 360 feedback, calibration, through PIP, probation, and merit follow-ups.",
      )}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("performance", "reports")} className="gap-2 font-bold">
            <BarChart3 className="h-4 w-4" /> {t("Lihat Laporan", "View Reports")}
          </Button>
          <Button onClick={() => navigate("performance", "cycles")} className="gap-2 font-bold">
            <CalendarRange className="h-4 w-4" /> {t("Kelola Siklus", "Manage Cycles")}
          </Button>
        </div>
      }
    />
  );

  if (error) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Target />}
          title={t("Gagal memuat ringkasan", "Failed to load overview")}
          description={error}
        />
      </div>
    );
  }

  if (loading && !d) {
    return (
      <div>
        {header}
        <LoadingCards cards={4} />
      </div>
    );
  }

  if (!d) {
    return (
      <div>
        {header}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-6 text-sm text-slate-500">
            {t("Data ringkasan belum termuat — coba muat ulang halaman.", "Overview data could not be loaded — try reloading the page.")}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- empty state: belum ada siklus sama sekali ----
  if (!d.cycle) {
    return (
      <div>
        {header}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
              <CalendarRange className="h-7 w-7" aria-hidden />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {t("Belum ada siklus penilaian", "No performance cycle yet")}
            </p>
            <p className="max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t(
                "Buat siklus pertama (mis. PER-2026), daftarkan peserta, lalu buka fase penetapan target — ringkasan modul akan terisi otomatis seiring proses berjalan.",
                "Create the first cycle (e.g. PERF-2026), enroll participants, then open the goal-setting phase — this overview fills itself in as the process runs.",
              )}
            </p>
            <Button onClick={() => navigate("performance", "cycles")} className="mt-1 gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Buat Siklus Penilaian", "Create Performance Cycle")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const c = d.cycle;
  const badge = phaseBadge(c.status);
  const phaseIdx = CYCLE_PHASES.findIndex((p) => p.key === c.status);

  // ---- KPI pipeline ----
  const finalizedCount = d.pipeline
    .filter((r) => FINAL_STATUSES.includes(r.status))
    .reduce((a, r) => a + r.count, 0);
  const inFlight = Math.max(0, c.participants - finalizedCount);
  // Uang merit: nominal hanya terkirim saat brankas terbuka — selain itu "Rp •••".
  const meritSub = d.merit.money.canSee && d.merit.appliedTotal != null
    ? `Rp ${d.merit.appliedTotal.toLocaleString("id-ID")}`
    : d.merit.money.canSee
      ? t("nominal belum tersedia", "amount not available")
      : "Rp •••";

  const kpiTiles: {
    label: string; value: string; sub?: string | null; subLocked?: boolean;
    Icon: React.ElementType; warn?: boolean; hero?: boolean;
    onClick: () => void; ariaLabel: string;
  }[] = [
    {
      label: t("Penilaian Berjalan", "Appraisals In Flight"),
      value: String(inFlight),
      sub: d.goals.selfSubmittedPct != null
        ? t("{n} dari {m} peserta · penilaian diri {p}%", "{n} of {m} participants · self review {p}%", { n: d.goals.selfSubmitted, m: c.participants, p: d.goals.selfSubmittedPct })
        : t("{m} peserta terdaftar", "{m} participants enrolled", { m: c.participants }),
      Icon: ClipboardCheck, hero: true,
      onClick: () => navigate("performance", "appraisals"),
      ariaLabel: t("Buka daftar penilaian", "Open the appraisals list"),
    },
    {
      label: t("Check-in 30 Hari", "Check-ins Last 30 Days"),
      value: String(d.checkins.held30d),
      sub: t("{n} terjadwal · {m} terlewat", "{n} scheduled · {m} missed", { n: d.checkins.upcoming, m: d.checkins.missed }),
      Icon: MessagesSquare,
      warn: d.checkins.missed > 0,
      onClick: () => navigate("performance", "checkins"),
      ariaLabel: t("Buka riwayat check-in 1-on-1", "Open the 1-on-1 check-in history"),
    },
    {
      label: t("PIP Aktif", "Active PIPs"),
      value: String(d.pip.active),
      sub: d.pip.recoveredPct != null
        ? t("tingkat pemulihan {p}%", "recovery rate {p}%", { p: d.pip.recoveredPct })
        : t("{n} selesai dipantau", "{n} concluded to date", { n: d.pip.recovered + d.pip.notRecovered }),
      Icon: LifeBuoy,
      onClick: () => navigate("performance", "pip"),
      ariaLabel: t("Buka register PIP", "Open the PIP register"),
    },
    {
      label: t("Merit Diterapkan", "Merit Applied"),
      value: String(d.merit.appliedCount),
      sub: d.merit.appliedCount > 0 ? meritSub : t("belum ada merit diterapkan", "no merit applied yet"),
      subLocked: !d.merit.money.canSee && d.merit.appliedCount > 0,
      Icon: Wallet,
      onClick: () => navigate("performance", "results"),
      ariaLabel: t("Buka hasil dan 9-box", "Open results and 9-box"),
    },
  ];
  if (d.okr) {
    kpiTiles.push({
      label: t("OKR {q}", "OKR {q}", { q: d.okr.quarter }),
      value: String(d.okr.posted),
      sub: d.okr.avgProgressPct != null
        ? t("rata-rata progres {p}%", "average progress {p}%", { p: d.okr.avgProgressPct })
        : t("belum ada objective diposting", "no objectives posted yet"),
      Icon: Telescope,
      onClick: () => navigate("performance", "okr"),
      ariaLabel: t("Buka board OKR kuartalan", "Open the quarterly OKR board"),
    });
  }

  // ---- pipeline (urut state machine, bar relatif jumlah terbesar) ----
  const pipeline = PIPELINE_ORDER
    .map((s) => ({ status: s, count: d.pipeline.find((r) => r.status === s)?.count ?? 0 }))
    .filter((r) => r.count > 0);
  const maxPipe = Math.max(1, ...pipeline.map((r) => r.count));

  // ---- 360 ----
  const f360Total = d.f360.invited + d.f360.submitted + d.f360.declined + d.f360.expired;
  const f360Rate = f360Total > 0 ? Math.round((d.f360.submitted / f360Total) * 100) : null;

  // ---- kesehatan target ----
  const kpiActualPct = d.goals.kpiRows > 0 ? Math.round((d.goals.kpiWithActual / d.goals.kpiRows) * 100) : null;

  return (
    <div>
      {header}

      <div className="space-y-4">
        {/* ---- banner siklus aktif ---- */}
        <section aria-label={t("Siklus berjalan", "Running cycle")}>
          <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap", badge.cls)}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                    {t(badge.id, badge.en)}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {t(CYCLE_TYPE_LABEL[c.cycleType]?.id ?? c.cycleType, CYCLE_TYPE_LABEL[c.cycleType]?.en ?? c.cycleType)}
                  </span>
                  {c.feedback360 && (
                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                      {t("360 aktif", "360 enabled")}
                    </span>
                  )}
                  {!c.isActive && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                      {t("tidak ada siklus berjalan — menampilkan siklus terakhir", "no running cycle — showing the latest")}
                    </span>
                  )}
                </div>
                <p className="mt-2 truncate font-mono text-xs font-bold text-slate-400">{c.code}</p>
                <h2 className="truncate text-base font-bold text-slate-900 dark:text-slate-50">{c.name}</h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {t("Periode {a} – {b}", "Period {a} – {b}", { a: fmtDate(c.periodStart), b: fmtDate(c.periodEnd) })}
                  {" · "}
                  {t("{n} siklus aktif dari {m} total", "{n} active of {m} cycles total", { n: d.totals.activeCycles, m: d.totals.cycles })}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[
                    { v: c.goalEnd, id: "Tenggat target", en: "Goal deadline" },
                    { v: c.selfEnd, id: "Tenggat penilaian diri", en: "Self review deadline" },
                    { v: c.mgrEnd, id: "Tenggat penilaian atasan", en: "Manager review deadline" },
                    { v: c.calibEnd, id: "Tenggat kalibrasi", en: "Calibration deadline" },
                    { v: c.publishAt, id: "Rencana terbit", en: "Planned publish" },
                  ].filter((x) => x.v != null).map((x) => (
                    <span key={x.id} className="rounded-lg border border-dashed border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      {t(x.id, x.en)}: {fmtDate(x.v)}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => navigate("performance", "cycles")}
                className="flex shrink-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-left transition-all hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40"
                aria-label={t("Buka command center siklus", "Open the cycle command center")}
              >
                <Users className="h-5 w-5 text-slate-400" aria-hidden />
                <span>
                  <span className="block text-2xl font-black leading-none tabular-nums text-slate-900 dark:text-slate-100">{c.participants}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Peserta", "Participants")}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" aria-hidden />
              </button>
            </CardContent>
          </Card>
        </section>

        {/* ---- KPI pipeline ---- */}
        <section aria-label={t("KPI modul kinerja", "Performance module KPIs")}>
          <div className={cn(
            "grid grid-cols-1 gap-4 sm:grid-cols-2",
            d.okr ? "lg:grid-cols-3 2xl:grid-cols-5" : "xl:grid-cols-4",
          )}>
            {kpiTiles.map((k) => (
              <KpiTile key={k.label} {...k} />
            ))}
          </div>
        </section>

        {/* ---- pipeline appraisal + kesehatan target ---- */}
        <div className="grid gap-4 lg:grid-cols-5">
          <section aria-label={t("Pipeline penilaian siklus", "Cycle appraisal pipeline")} className="min-w-0 lg:col-span-3">
            <Card className="h-full border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold">
                  <span className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 ov-text-accent" aria-hidden />
                    {t("Pipeline Penilaian Siklus", "Cycle Appraisal Pipeline")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pipeline.length === 0 ? (
                  <p className="text-[12px] text-slate-400">
                    {t("Belum ada peserta terdaftar di siklus ini.", "No participants enrolled in this cycle yet.")}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {pipeline.map((r) => {
                      const lb = statusLabel(r.status);
                      return (
                        <button
                          key={r.status}
                          onClick={() => navigate("performance", "appraisals")}
                          className="block w-full text-left"
                          title={t("Buka daftar penilaian", "Open the appraisals list")}
                        >
                          <span className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="min-w-0 truncate font-semibold text-slate-600 dark:text-slate-300">{t(lb.id, lb.en)}</span>
                            <span className="shrink-0 font-bold tabular-nums text-slate-800 dark:text-slate-100">{r.count}</span>
                          </span>
                          <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <span className="block h-full rounded-full ov-bar" style={{ width: `${Math.max(2, (r.count / maxPipe) * 100)}%` }} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 border-t border-dashed border-slate-200 pt-2.5 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t(
                    "{n} peserta terdaftar · {m} hasil final tercatat",
                    "{n} participants enrolled · {m} final results recorded",
                    { n: c.participants, m: finalizedCount },
                  )}
                  {" · "}
                  {d.calibration.sessions > 0
                    ? t("{n} sesi kalibrasi · {m} keputusan tercatat", "{n} calibration sessions · {m} decisions recorded", { n: d.calibration.sessions, m: d.calibration.decisions })
                    : t("belum ada sesi kalibrasi", "no calibration sessions yet")}
                </div>
              </CardContent>
            </Card>
          </section>

          <section aria-label={t("Kesehatan target dan penilaian", "Goal and assessment health")} className="min-w-0 lg:col-span-2">
            <Card className="h-full border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Target className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Kesehatan Target & Penilaian", "Goal & Assessment Health")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <GoalRow
                  label={t("Target terkunci & disetujui", "Goals locked & approved")}
                  num={d.goals.goalLocked}
                  den={c.participants}
                  pct={d.goals.goalLockedPct}
                  hint={d.goals.goalLockedPct != null
                    ? t("{p}% peserta sudah menyetujui target", "{p}% of participants have locked goals", { p: d.goals.goalLockedPct })
                    : t("belum ada peserta terdaftar", "no participants enrolled yet")}
                  onClick={() => navigate("performance", "goals")}
                  ariaLabel={t("Buka target dan KPI", "Open goals and KPIs")}
                />
                <GoalRow
                  label={t("Penilaian diri selesai", "Self reviews submitted")}
                  num={d.goals.selfSubmitted}
                  den={c.participants}
                  pct={d.goals.selfSubmittedPct}
                  hint={d.goals.selfSubmittedPct != null
                    ? t("{p}% peserta telah submit penilaian diri", "{p}% of participants have submitted self reviews", { p: d.goals.selfSubmittedPct })
                    : t("menunggu fase penilaian", "awaiting the assessment phase")}
                  onClick={() => navigate("performance", "appraisals")}
                  ariaLabel={t("Buka daftar penilaian", "Open the appraisals list")}
                />
                <GoalRow
                  label={t("Realisasi KPI terisi", "KPI actuals filled")}
                  num={d.goals.kpiWithActual}
                  den={d.goals.kpiRows}
                  pct={kpiActualPct}
                  hint={kpiActualPct != null
                    ? t("{p}% baris KPI sudah punya realisasi", "{p}% of KPI rows have actuals", { p: kpiActualPct })
                    : t("belum ada baris KPI pada siklus ini", "no KPI rows in this cycle yet")}
                  onClick={() => navigate("performance", "appraisals")}
                  ariaLabel={t("Buka daftar penilaian", "Open the appraisals list")}
                />
              </CardContent>
            </Card>
          </section>
        </div>

        {/* ---- alur kerja siklus: indikator fase horizontal ---- */}
        <section aria-label={t("Alur kerja siklus penilaian", "Performance cycle workflow")}>
          <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold">
                <Workflow className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Alur Siklus Penilaian", "Performance Cycle Flow")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex items-start overflow-x-auto pb-1">
                {CYCLE_PHASES.map((p, i) => {
                  const done = phaseIdx >= 0 && i < phaseIdx;
                  const current = phaseIdx === i;
                  // konektor antara fase i dan i+1 terlewati bila siklus sudah mencapai fase i+1
                  const connDone = (from: number) => phaseIdx > from;
                  const connCls = (passed: boolean) =>
                    passed ? "bg-emerald-400/70 dark:bg-emerald-600/60" : "bg-slate-200 dark:bg-slate-700";
                  return (
                    <li key={p.key} className="flex min-w-[108px] flex-1 flex-col">
                      <button
                        onClick={() => navigate("performance", "cycles")}
                        aria-current={current ? "step" : undefined}
                        aria-label={t("Fase {n}: {f}", "Phase {n}: {f}", { n: i + 1, f: t(p.id, p.en) })}
                        className="group flex w-full flex-col items-center gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-slate-800/60"
                      >
                        <span className="flex w-full items-center" aria-hidden>
                          <span className={cn("h-[3px] flex-1 rounded-full", i === 0 ? "bg-transparent" : connCls(connDone(i - 1)))} />
                          <span className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                            done
                              ? "bg-emerald-500 text-white"
                              : current
                                ? "ov-fill ring-2 ring-brand/30 ring-offset-1 ring-offset-white dark:ring-offset-slate-900"
                                : "border-2 border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500",
                          )}>
                            {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : i + 1}
                          </span>
                          <span className={cn("h-[3px] flex-1 rounded-full", i === CYCLE_PHASES.length - 1 ? "bg-transparent" : connCls(connDone(i)))} />
                        </span>
                        <span className={cn(
                          "text-center text-[10px] font-semibold leading-tight",
                          current ? "text-slate-900 dark:text-slate-50" : done ? "text-slate-600 dark:text-slate-300" : "text-slate-400 dark:text-slate-500",
                        )}>
                          {t(p.id, p.en)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-slate-200 pt-2.5 dark:border-slate-700">
                <p className="min-w-0 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {phaseIdx >= 0
                    ? t(
                        "Fase aktif: {f} · {n} dari {m} fase terlewati",
                        "Active phase: {f} · {n} of {m} phases complete",
                        { f: t(CYCLE_PHASES[phaseIdx].id, CYCLE_PHASES[phaseIdx].en), n: phaseIdx, m: CYCLE_PHASES.length },
                      )
                    : t("Status siklus tidak dikenal — buka pengelolaan siklus", "Unknown cycle status — open cycle management")}
                </p>
                <p className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                  {t("klik fase untuk membuka pengelolaan siklus", "click a phase to open cycle management")}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ---- 360 · watchlist percobaan/PIP · feed aktivitas ---- */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 360 */}
          <section aria-label={t("Progres umpan balik 360", "360 feedback progress")} className="min-w-0">
            <Card className="h-full border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <ShieldCheck className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Umpan Balik 360", "360 Feedback")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-black text-slate-900 dark:text-slate-100">{d.f360.submitted}</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {f360Rate != null
                    ? t("terkirim dari {n} undangan ({r}%)", "submitted of {n} invitations ({r}%)", { n: f360Total, r: f360Rate })
                    : t("belum ada undangan pada siklus ini", "no invitations in this cycle yet")}
                </p>
                {f360Total > 0 && f360Rate != null && (
                  <Progress value={f360Rate} className="mt-2 h-2 [&>div]:ov-bar" />
                )}
                <dl className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
                  {[
                    { n: d.f360.invited, id: "Menunggu", en: "Pending" },
                    { n: d.f360.declined, id: "Ditolak", en: "Declined" },
                    { n: d.f360.expired, id: "Kedaluwarsa", en: "Expired" },
                  ].map((x) => (
                    <div key={x.id} className="rounded-lg border border-slate-200 bg-slate-50/60 px-1.5 py-1.5 dark:border-slate-800 dark:bg-slate-900/40">
                      <dd className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">{x.n}</dd>
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t(x.id, x.en)}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  {t(
                    "Anonimitas dijaga: hasil hanya tampil ter-agregasi untuk minimal 3 reviewer — identitas dan skor individual tidak pernah ditampilkan.",
                    "Anonymity preserved: results appear only when aggregated for at least 3 reviewers — identities and individual scores are never shown.",
                  )}
                </p>
              </CardContent>
            </Card>
          </section>

          {/* watchlist percobaan & PIP */}
          <section aria-label={t("Pantauan percobaan dan PIP", "Probation and PIP watchlist")} className="min-w-0">
            <Card className="h-full border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Hourglass className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Pantauan Percobaan & PIP", "Probation & PIP Watchlist")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <button
                  onClick={() => navigate("performance", "probation")}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition-all hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40"
                  aria-label={t("Buka evaluasi masa percobaan", "Open probation evaluations")}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">{t("Masa percobaan terbuka", "Open probations")}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {d.probation.dueSoon > 0
                        ? t("{n} jatuh tempo ≤14 hari", "{n} due within 14 days", { n: d.probation.dueSoon })
                        : t("tidak ada jatuh tempo dekat", "none due soon")}
                    </span>
                  </span>
                  <span className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{d.probation.open}</span>
                </button>
                {d.probation.overdue > 0 && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {t("{n} evaluasi percobaan melewati tenggat", "{n} probation evaluations past due", { n: d.probation.overdue })}
                  </p>
                )}
                <button
                  onClick={() => navigate("performance", "pip")}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition-all hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40"
                  aria-label={t("Buka register PIP", "Open the PIP register")}
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">{t("Program PIP aktif", "Active PIPs")}</span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {d.pip.recoveredPct != null
                        ? t("pemulihan {p}% · {n} tidak pulih", "recovery {p}% · {n} not recovered", { p: d.pip.recoveredPct, n: d.pip.notRecovered })
                        : t("belum ada PIP berakhir", "no concluded PIPs yet")}
                    </span>
                  </span>
                  <span className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">{d.pip.active}</span>
                </button>
                <p className="border-t border-dashed border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {t(
                    "Register detail bersifat terbatas — angka agregat di sini untuk pemantauan, nama peserta tersedia pada menu PIP dan Evaluasi Masa Percobaan.",
                    "The detailed register is restricted — aggregate counts here are for monitoring; participant names live in the PIP and Probation menus.",
                  )}
                </p>
              </CardContent>
            </Card>
          </section>

          {/* feed aktivitas */}
          <section aria-label={t("Aktivitas terakhir", "Recent activity")} className="min-w-0">
            <Card className="h-full border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Activity className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Aktivitas Terakhir", "Recent Activity")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.activity.length === 0 ? (
                  <p className="text-[12px] text-slate-400">
                    {t("Belum ada aktivitas kinerja tercatat.", "No performance activity recorded yet.")}
                  </p>
                ) : (
                  <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                    {d.activity.map((a, i) => {
                      const ent = ACT_ENTITY_LABEL[a.entity] ?? { id: a.entity, en: a.entity };
                      const act = ACT_ACTION_LABEL[a.action] ?? { id: a.action, en: a.action };
                      return (
                        <li key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-1.5 dark:border-slate-800/60 dark:bg-slate-900/40">
                          <p className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
                              {t(act.id, act.en)} · {t(ent.id, ent.en)}
                            </span>
                            <time className="shrink-0 text-[9px] text-slate-400" dateTime={a.createdAt}>{fmtDateTime(a.createdAt)}</time>
                          </p>
                          {a.detail && <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{a.detail}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
