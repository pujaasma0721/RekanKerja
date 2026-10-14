"use client";
// RekanKerja Performance — P8 Laporan & Analitik (DEVELOPMENT-PLAN-PERFORMANCE.md
// §20 P8): tab ① "Ringkasan Analitik" — KPI modul + distribusi rating + fase
// siklus + tren multi-tahun + histori MetricSnapshot (perf_completion /
// rating_distribution / pip_recovery_rate) dari GET /api/rekankerja/performance/
// reports; tab ② "Dokumen Laporan" — katalog 14 laporan pf11–pf44 (pola medical
// MED-1-b). PageHeader tetap di ATAS Tabs. Nominal merit mengikuti Brankas Uang
// (null → •••). Mobile-first: grid tile collapse 1→2→4 kolom, bar tanpa chart lib.
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { PerformanceReportDocumentsTab } from "./report-documents/report-documents-tab";
import {
  BarChart3, FolderOpen, Users, CalendarRange, ClipboardCheck, LifeBuoy,
  Wallet, BadgeCheck, TrendingUp, Lock, Target,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

// ---------- kontrak payload (mirror performance-reports.ts) ----------

interface DistBucket { count: number; avgScore: number | null }
interface DashboardPayload {
  kpi: {
    activeCycles: number; totalCycles: number; participants: number; completionPct: number | null;
    resultsPublished: number; pipsActive: number; pipsRecoveredPct: number | null;
    probationsOpen: number; meritAppliedCount: number; meritAppliedTotalAmount: number | null;
    money: { canSee: boolean };
  };
  distribution: {
    latestCycle: { id: string; code: string } | null;
    latest: { r1: DistBucket; r2: DistBucket; r3: DistBucket; r4: DistBucket; r5: DistBucket };
    allTime: { r1: DistBucket; r2: DistBucket; r3: DistBucket; r4: DistBucket; r5: DistBucket };
  };
  cycles: {
    id: string; code: string; name: string; status: string; cycleType: string;
    periodStart: string; periodEnd: string; participants: number;
    phase: { goalPct: number | null; selfPct: number | null; mgrPct: number | null; calibPct: number | null };
    activePhase: string | null;
  }[];
  snapshots: Record<string, { period: string; value: number }[]>;
  trend: { year: number; n: number; avg: number }[];
}

const MONTHS_SHORT_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function fmtPeriod(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_SHORT_ID[d.getMonth()]} ${d.getFullYear()}`;
}

/** Bar distribusi rating — murni CSS (tanpa chart lib), warna semantik rating. */
function RatingBars({ dist, showAvg }: { dist: DashboardPayload["distribution"]["allTime"]; showAvg: boolean }) {
  const { t } = useI18n();
  const buckets = [dist.r1, dist.r2, dist.r3, dist.r4, dist.r5];
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const tone = (r: number) => (r >= 4 ? "bg-emerald-500" : r === 3 ? "bg-amber-500" : "bg-rose-500");
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div className="space-y-2.5">
      {buckets.map((b, i) => {
        const r = i + 1;
        const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
        return (
          <div key={r} className="flex items-center gap-2.5">
            <span className="w-14 shrink-0 text-right text-[10.5px] font-extrabold text-slate-500 dark:text-slate-400">
              {t("Rating", "Rating")} {r}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
              <div className={cn("h-full rounded-md transition-all", tone(r))} style={{ width: `${Math.round((b.count / max) * 100)}%` }} />
            </div>
            <span className="w-24 shrink-0 text-[10.5px] font-bold tabular-nums text-slate-600 dark:text-slate-300">
              {b.count} · {pct}%
            </span>
            {showAvg && (
              <span className="hidden w-14 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400 sm:block">
                {b.avgScore == null ? "—" : b.avgScore.toFixed(1)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Mini tren rata-rata skor per tahun — bar sederhana lintas tahun. */
function TrendBars({ trend }: { trend: DashboardPayload["trend"] }) {
  const { t } = useI18n();
  if (trend.length === 0) {
    return <p className="text-[11px] text-slate-400">{t("Belum ada skor final terpublikasi.", "No published final scores yet.")}</p>;
  }
  const max = Math.max(...trend.map((x) => x.avg), 100);
  return (
    <div className="flex items-end gap-3">
      {trend.map((x) => (
        <div key={x.year} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="text-[11px] font-black tabular-nums text-slate-700 dark:text-slate-200">{x.avg.toFixed(1)}</span>
          <div className="flex h-20 w-full items-end rounded-md bg-slate-100 dark:bg-slate-800">
            <div className="w-full rounded-md bg-gradient-to-t from-slate-700 to-slate-500 dark:from-slate-300 dark:to-slate-400" style={{ height: `${Math.max(6, Math.round((x.avg / max) * 100))}%` }} />
          </div>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{x.year}</span>
          <span className="text-[9px] text-slate-400">{x.n} {t("org", "ppl")}</span>
        </div>
      ))}
    </div>
  );
}

// ===================== tab 1 — ringkasan analitik =====================

function AnalyticsTab() {
  const { t } = useI18n();
  const api = useApi<DashboardPayload>("/api/rekankerja/performance/reports");
  const d = api.data;

  if (api.error) {
    return <EmptyState icon={<BarChart3 className="h-6 w-6" />} title={t("Gagal memuat analitik", "Failed to load analytics")} description={api.error} />;
  }
  if (api.loading && !d) {
    return (
      <Card className="rounded-2xl"><CardContent className="p-6">
        <LoadingRows rows={8} />
      </CardContent></Card>
    );
  }
  if (!d) return null;

  const k = d.kpi;
  const tiles: { label: string; labelEn: string; value: string; sub?: string | null; icon: React.ElementType; tone: string }[] = [
    { label: "Siklus Aktif", labelEn: "Active Cycles", value: `${k.activeCycles}`, sub: `${k.totalCycles} ${t("total", "total")}`, icon: CalendarRange, tone: "text-sky-700 bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300" },
    { label: "Peserta Siklus Aktif", labelEn: "Active-Cycle Participants", value: `${k.participants}`, sub: null, icon: Users, tone: "text-emerald-700 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { label: "Penilaian Selesai", labelEn: "Appraisals Finalized", value: k.completionPct == null ? "—" : `${k.completionPct}%`, sub: t("dari peserta siklus aktif", "of active-cycle participants"), icon: ClipboardCheck, tone: "text-amber-700 bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300" },
    { label: "Hasil Terbit", labelEn: "Published Results", value: `${k.resultsPublished}`, sub: null, icon: BadgeCheck, tone: "text-emerald-700 bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { label: "PIP Aktif", labelEn: "Active PIPs", value: `${k.pipsActive}`, sub: k.pipsRecoveredPct == null ? null : t(`pemulihan ${k.pipsRecoveredPct}%`, `recovery ${k.pipsRecoveredPct}%`), icon: LifeBuoy, tone: "text-rose-700 bg-rose-100 dark:bg-rose-500/15 dark:text-rose-300" },
    { label: "Percobaan Terbuka", labelEn: "Open Probations", value: `${k.probationsOpen}`, sub: null, icon: Target, tone: "text-violet-700 bg-violet-100 dark:bg-violet-500/15 dark:text-violet-300" },
    { label: "Merit Diterapkan", labelEn: "Merit Applied", value: `${k.meritAppliedCount}`, sub: k.money.canSee && k.meritAppliedTotalAmount != null ? `Rp ${k.meritAppliedTotalAmount.toLocaleString("id-ID")}` : null, icon: Wallet, tone: "text-teal-700 bg-teal-100 dark:bg-teal-500/15 dark:text-teal-300" },
  ];

  const latest = d.distribution.latestCycle;

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {tiles.map((x) => (
          <Card key={x.label} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-1.5">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-md", x.tone)}>
                  <x.icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate text-[9.5px] font-extrabold uppercase tracking-wide text-slate-500 dark:text-slate-400" title={t(x.label, x.labelEn)}>
                  {t(x.label, x.labelEn)}
                </span>
              </div>
              {api.loading && !d ? (
                <Skeleton className="mt-2 h-7 w-14" />
              ) : (
                <p className="mt-1.5 text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">{x.value}</p>
              )}
              {x.sub && <p className="mt-0.5 truncate text-[9px] font-semibold text-slate-400">{x.sub}</p>}
            </CardContent>
          </Card>
        ))}
        {!k.money.canSee && (
          <Card className="border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <CardContent className="p-3.5">
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  <Lock className="h-3.5 w-3.5" />
                </span>
                <span className="text-[9.5px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t("Brankas Uang", "Money Vault")}</span>
              </div>
              <p className="mt-1.5 text-sm font-bold text-amber-800 dark:text-amber-200">•••</p>
              <p className="mt-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                {t("Nominal merit tersembunyi", "Merit amounts hidden")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Distribusi rating */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex flex-wrap items-center gap-2 text-[13px] font-bold">
              <BarChart3 className="h-4 w-4 text-slate-500" />
              {t("Distribusi Rating", "Rating Distribution")}
              <span className="rounded-full bg-slate-100 px-2 py-px font-mono text-[9px] font-bold text-slate-500 dark:bg-slate-800">
                {latest ? `${latest.code} · ${t("semua waktu", "all time")}` : t("semua waktu", "all time")}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {latest && (
              <div>
                <p className="mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-400">
                  {t("Siklus final terbaru", "Latest finalized cycle")} — {latest.code}
                </p>
                <RatingBars dist={d.distribution.latest} showAvg />
              </div>
            )}
            <div className={cn(latest && "border-t border-dashed border-slate-200 pt-3 dark:border-slate-700")}>
              <p className="mb-1.5 text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{t("Semua waktu", "All time")}</p>
              <RatingBars dist={d.distribution.allTime} showAvg />
            </div>
          </CardContent>
        </Card>

        {/* Tren multi-tahun */}
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-[13px] font-bold">
              <TrendingUp className="h-4 w-4 text-slate-500" />
              {t("Tren Skor Final per Tahun", "Final Score Trend by Year")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <TrendBars trend={d.trend} />
            <p className="mt-3 text-[9.5px] leading-relaxed text-slate-400">
              {t(
                "Rata-rata skor final peserta terpublikasi per tahun siklus — detail per unit tersedia di laporan F4.4.",
                "Average final score of published participants per cycle year — per-unit detail is available in report F4.4.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Partisipasi fase per siklus */}
      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-[13px] font-bold">
            <ClipboardCheck className="h-4 w-4 text-slate-500" />
            {t("Partisipasi Fase per Siklus", "Phase Participation per Cycle")}
            <span className="rounded-full bg-slate-100 px-2 py-px font-mono text-[9px] font-bold text-slate-500 dark:bg-slate-800">
              {t("pola Command Center §18.8", "Command Center pattern §18.8")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="space-y-3">
            {d.cycles.length === 0 && (
              <p className="text-[11px] text-slate-400">{t("Belum ada siklus — buat siklus pertama Anda.", "No cycles yet — create your first cycle.")}</p>
            )}
            {d.cycles.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-black text-slate-700 dark:text-slate-200">{c.code}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-500 dark:text-slate-400">{c.name}</span>
                  <StatusPill status={c.status} />
                  <span className="text-[10px] font-bold text-slate-400">
                    {fmtPeriod(c.periodStart)} – {fmtPeriod(c.periodEnd)} · {c.participants} {t("peserta", "participants")}
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {([
                    ["goalPct", t("Target", "Goals")],
                    ["selfPct", t("Penilaian Diri", "Self")],
                    ["mgrPct", t("Penilaian Atasan", "Manager")],
                    ["calibPct", t("Finalisasi", "Finalized")],
                  ] as const).map(([key, label]) => {
                    const v = c.phase[key];
                    return (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between text-[9.5px] font-bold text-slate-500 dark:text-slate-400">
                          <span>{label}</span>
                          <span className="tabular-nums">{v == null ? "—" : `${v}%`}</span>
                        </div>
                        <Progress value={v ?? 0} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Snapshot metrik */}
      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="flex items-center gap-2 text-[13px] font-bold">
            <TrendingUp className="h-4 w-4 text-slate-500" />
            {t("Snapshot Metrik (MetricSnapshot)", "Metric Snapshots (MetricSnapshot)")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["perf_completion", t("% penilaian final", "% finalized appraisals")],
              ["pip_recovery_rate", t("% pemulihan PIP", "% PIP recovery")],
              ["rating_distribution", t("peserta ber-rating", "rated participants")],
            ] as const).map(([metric, label]) => {
              const pts = d.snapshots[metric] ?? [];
              const last = pts[pts.length - 1];
              return (
                <div key={metric} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <p className="font-mono text-[10px] font-black text-slate-600 dark:text-slate-300">{metric}</p>
                  <p className="mt-0.5 text-[9.5px] font-semibold text-slate-400">{label}</p>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">
                      {last ? last.value.toLocaleString("id-ID") : "—"}
                    </span>
                    <span className="text-[9.5px] font-bold text-slate-400">{last ? last.period : t("belum ada snapshot", "no snapshot yet")}</span>
                  </div>
                  {pts.length > 1 && (
                    <p className="mt-1 text-[9px] text-slate-400">
                      {pts.length} {t("periode tercatat", "periods recorded")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[9.5px] leading-relaxed text-slate-400">
            {t(
              "Diperbarui harian oleh job scheduler perf-metrics-snapshot (idempoten per periode YYYY-MM) — pola analytics rekrutmen.",
              "Refreshed daily by the perf-metrics-snapshot scheduler job (idempotent per YYYY-MM period) — following the recruitment analytics pattern.",
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ===================== halaman =====================

export function PerformanceReportsPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("Kinerja · Laporan", "Performance · Reports")}
        title={t("Laporan & Analitik Kinerja", "Performance Reports & Analytics")}
        description={t(
          "Ringkasan KPI modul, distribusi rating, tren multi-tahun, snapshot metrik — plus 14 laporan distribusi siap-cetak pf11–pf44 (kop, parameter, XLSX/PDF dwibahasa). Register riwayat per karyawan memenuhi PP 35/2021 §7.2.",
          "Module KPI summary, rating distribution, multi-year trend, metric snapshots — plus 14 print-ready distribution reports pf11–pf44 (letterhead, parameters, bilingual XLSX/PDF). The per-employee history register fulfils PP 35/2021 §7.2.",
        )}
      />

      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList>
          <TabsTrigger value="analytics" className="gap-1.5 text-xs font-bold">
            <BarChart3 className="h-3.5 w-3.5" /> {t("Ringkasan Analitik", "Analytics Summary")}
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5 text-xs font-bold">
            <FolderOpen className="h-3.5 w-3.5" /> {t("Dokumen Laporan", "Report Documents")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="space-y-4">
          <AnalyticsTab />
        </TabsContent>
        <TabsContent value="documents" className="space-y-4">
          <PerformanceReportDocumentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
