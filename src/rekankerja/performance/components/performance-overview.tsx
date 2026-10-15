"use client";
// RekanKerja Performance — Ringkasan modul. P0: kartu master aktif. P8 (§20):
// KPI modul NYATA dari dashboard laporan (siklus aktif · peserta · selesai ·
// terbit · PIP · percobaan · merit) + distribusi rating ringkas + tautan ke
// Laporan & Analitik + status fase rencana eksekusi P0–P9 + BACKLOG B1–B4
// (KINI LENGKAP s/d B4 Succession — 14/14 fase terverifikasi; B5 benchmark
// = modul Payroll, B6–B8 = modul Rekrutmen — di luar overview modul ini).
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Target, ListChecks, Users, Scale, Grid3x3, Wallet, CalendarRange, CheckCircle2,
  Circle, Clock, BarChart3, ClipboardCheck, BadgeCheck, LifeBuoy, ChevronRight, Lock,
  ShieldCheck, Telescope, Crown,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

interface Counts {
  kpi: number;
  competency: number;
  "rating-scale": number;
  template: number;
  "merit-matrix": number;
}

interface DashboardKpi {
  kpi: {
    activeCycles: number; totalCycles: number; participants: number; completionPct: number | null;
    resultsPublished: number; pipsActive: number; pipsRecoveredPct: number | null;
    probationsOpen: number; meritAppliedCount: number; meritAppliedTotalAmount: number | null;
    money: { canSee: boolean };
  };
  /** B1-BL — ringkasan OKR kuartal berjalan (hanya bila okrEnabled — D-BL2) */
  okrSummary?: { quarter: string; posted: number; closed: number; avgProgressPct: number | null } | null;
}

const PHASES: { id: string; label: string; labelEn: string; detail: string; detailEn: string }[] = [
  { id: "P0", label: "Fondasi & Master", labelEn: "Foundation & Masters", detail: "20 tabel, pustaka KPI/kompetensi, skala, template, merit, versioning", detailEn: "20 tables, KPI/competency library, scales, templates, merit, versioning" },
  { id: "P1", label: "Siklus & Target", labelEn: "Cycle & Goals", detail: "Siklus + peserta + KPI Builder + salin periode + impor Excel + nudge", detailEn: "Cycles + enrollment + KPI Builder + copy-from-previous + Excel import + nudge" },
  { id: "P2", label: "Check-in & Monitoring", labelEn: "Check-ins & Monitoring", detail: "1-on-1 terdokumentasi + reminder + revisi tengah tahun", detailEn: "Documented 1-on-1s + reminders + mid-year revision" },
  { id: "P3", label: "Penilaian & 360", labelEn: "Appraisal & 360", detail: "Self/atasan/360 + tarikan otomatis + AI assist + estimasi dampak", detailEn: "Self/manager/360 + auto-pull + AI assist + impact preview" },
  { id: "P4", label: "Kalibrasi & Finalisasi", labelEn: "Calibration & Finalization", detail: "Bell curve + sesi kalibrasi ter-audit + publikasi", detailEn: "Bell curve + audited calibration + publication" },
  { id: "P5", label: "Merit, PA & Surat", labelEn: "Merit, PA & Letters", detail: "Matriks merit → rekomendasi → payroll/PA + surat", detailEn: "Merit matrix → recommendation → payroll/PA + letters" },
  { id: "P6", label: "PIP", labelEn: "PIP", detail: "Program perbaikan 30/60/90 + checkpoint", detailEn: "30/60/90 improvement plan + checkpoints" },
  { id: "P7", label: "Masa Percobaan", labelEn: "Probation", detail: "Trigger dari onboarding + keputusan 3 arah", detailEn: "Onboarding trigger + 3-way decision" },
  { id: "P8", label: "Laporan & Analitik", labelEn: "Reports & Analytics", detail: "16 laporan pf11–pf44 dwibahasa + snapshot metrik", detailEn: "16 bilingual reports pf11–pf44 + metric snapshots" },
  { id: "P9", label: "Kepatuhan & Hardening", labelEn: "Compliance & Hardening", detail: "DSR karyawan UU PDP + retensi arsip + matriks akses §11.3", detailEn: "Employee DSRs (UU PDP) + records retention + §11.3 access matrix" },
  // B1–B4 — backlog ekstensi modul Kinerja (DEVELOPMENT-PLAN-BACKLOG.md §4;
  // B5 benchmark = tab Payroll, B6–B8 = Rekrutmen — bukan fase modul ini)
  { id: "B1", label: "OKR Kuartalan", labelEn: "Quarterly OKR", detail: "Objective+KR ber-bobot + board transparan silang-tim (terpisah dari penilaian)", detailEn: "Weighted objectives+KRs + cross-team transparent board (separate from appraisal)" },
  { id: "B2", label: "AI Ringkasan & Deteksi Bias", labelEn: "AI Summary & Bias Detection", detail: "Ringkasan check-in stateless + moderasi komentar 360 (lexicon dwibahasa)", detailEn: "Stateless check-in summaries + 360 comment moderation (bilingual lexicon)" },
  { id: "B3", label: "Talent & Risiko Attrisi", labelEn: "Talent & Attrition Risk", detail: "Heuristik explainable 6 faktor — bukan ML; faktor data-terbatas dinetralkan", detailEn: "Explainable 6-factor heuristic — not ML; missing-data factors neutralized" },
  { id: "B4", label: "Succession Planning", labelEn: "Succession Planning", detail: "Peran kritis + kandidat ber-saran 9-box + coverage + laporan XLSX", detailEn: "Critical roles + 9-box-seeded candidates + coverage + XLSX report" },
];

export function PerformanceOverview() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<{ counts: Counts }>("/api/rekankerja/performance/masters");
  const dash = useApi<DashboardKpi>("/api/rekankerja/performance/reports");
  // B4-BL — ringkasan succession (kartu Talent; field hanya dikirim server-side
  // utk aktor HR/Direksi — fetch gagal/403 utk lain → kartu disembunyikan).
  const talentApi = useApi<{ succession?: { positions: number; candidates: number; uncovered: number } }>("/api/rekankerja/performance/talent");
  const succession = talentApi.data?.succession;

  const c = data?.counts;
  const cards: { label: string; labelEn: string; value?: number; icon: React.ElementType }[] = [
    { label: "Pustaka KPI aktif", labelEn: "Active KPI library", value: c?.kpi, icon: ListChecks },
    { label: "Kompetensi aktif", labelEn: "Active competencies", value: c?.competency, icon: Users },
    { label: "Tingkat skala rating", labelEn: "Rating scale levels", value: c?.["rating-scale"], icon: Scale },
    { label: "Template bobot", labelEn: "Weight templates", value: c?.template, icon: Grid3x3 },
    { label: "Matriks merit", labelEn: "Merit matrices", value: c?.["merit-matrix"], icon: Wallet },
  ];

  const k = dash.data?.kpi;
  const kpiTiles: { label: string; labelEn: string; value: string | null; sub?: string | null; icon: React.ElementType; tone: string }[] = [
    { label: "Siklus Aktif", labelEn: "Active Cycles", value: k ? `${k.activeCycles}` : null, sub: k ? `${k.totalCycles} ${t("total", "total")}` : null, icon: CalendarRange, tone: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
    { label: "Peserta", labelEn: "Participants", value: k ? `${k.participants}` : null, sub: t("siklus aktif", "active cycles"), icon: Users, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { label: "Penilaian Selesai", labelEn: "Appraisals Finalized", value: k?.completionPct == null ? null : `${k.completionPct}%`, icon: ClipboardCheck, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
    { label: "Hasil Terbit", labelEn: "Published Results", value: k ? `${k.resultsPublished}` : null, icon: BadgeCheck, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { label: "PIP Aktif", labelEn: "Active PIPs", value: k ? `${k.pipsActive}` : null, sub: k?.pipsRecoveredPct != null ? t(`pemulihan ${k.pipsRecoveredPct}%`, `recovery ${k.pipsRecoveredPct}%`) : null, icon: LifeBuoy, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
    { label: "Merit Diterapkan", labelEn: "Merit Applied", value: k ? `${k.meritAppliedCount}` : null, sub: k && k.money.canSee && k.meritAppliedTotalAmount != null ? `Rp ${k.meritAppliedTotalAmount.toLocaleString("id-ID")}` : k && !k.money.canSee ? "•••" : null, icon: Wallet, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title={t("Ringkasan Kinerja", "Performance Overview")}
        description={t(
          "Denyut modul penilaian kinerja: siklus berjalan, partisipasi, hasil terbit, konsekuensi (PIP · merit) — plus fondasi master (pustaka KPI & kompetensi ber-versi, skala, template, matriks merit).",
          "The pulse of the performance module: running cycles, participation, published results, consequences (PIP · merit) — plus the master foundation (versioned KPI & competency library, scales, templates, merit matrix).",
        )}
      />

      {error && (
        <EmptyState
          icon={<Target />}
          title={t("Gagal memuat ringkasan", "Failed to load overview")}
          description={error}
        />
      )}

      {/* KPI modul nyata (P8) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpiTiles.map((x) => (
          <Card key={x.label} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", x.tone)}>
                  <x.icon className="h-4 w-4" />
                </span>
                <span className="truncate text-[10px] font-bold uppercase tracking-wide" title={t(x.label, x.labelEn)}>
                  {t(x.label, x.labelEn)}
                </span>
              </div>
              {dash.loading && !dash.data ? (
                <Skeleton className="mt-2 h-7 w-14" />
              ) : (
                <p className="mt-1.5 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">
                  {x.value ?? "—"}
                  {x.sub === "•••" && <Lock className="ml-1 inline h-3.5 w-3.5 text-amber-500" />}
                </p>
              )}
              {x.sub && x.sub !== "•••" && <p className="mt-0.5 truncate text-[9.5px] font-semibold text-slate-400">{x.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Master fondasi + tautan laporan */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-2">
          <CardContent className="p-4 sm:p-5">
            <h3 className="text-sm font-bold">{t("Fondasi Master", "Master Foundation")}</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {cards.map((k2) => (
                <div key={k2.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <k2.icon className="h-3.5 w-3.5" />
                    <span className="truncate text-[9.5px] font-bold uppercase tracking-wide">{t(k2.label, k2.labelEn)}</span>
                  </div>
                  {loading ? (
                    <Skeleton className="mt-2 h-6 w-10" />
                  ) : (
                    <div className="mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">{k2.value ?? "—"}</div>
                  )}
                </div>
              ))}
            </div>
            {/* progres penyelesaian modul */}
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span>{t("Penyelesaian modul (fase terverifikasi)", "Module completion (verified phases)")}</span>
                <span className="tabular-nums">{t("P0–P9 + B1–B4 · 14/14", "P0–P9 + B1–B4 · 14/14")}</span>
              </div>
              <Progress value={100} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* tautan ke Laporan & Analitik + Kepatuhan (P9) */}
        <div className="grid gap-4">
          <a
            href="/?m=performance&v=reports"
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-slate-900"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-emerald-400 to-teal-500" />
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm transition-transform group-hover:scale-105">
                <BarChart3 className="h-5 w-5" />
              </span>
              <ChevronRight className="h-4 w-4 text-emerald-600 transition-transform group-hover:translate-x-1 dark:text-emerald-400" />
            </div>
            <p className="mt-3 text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              {t("Laporan & Analitik", "Reports & Analytics")}
            </p>
            <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t(
                "14 laporan pf11–pf44 dwibahasa (XLSX/PDF) + ringkasan analitik + register riwayat per karyawan (PP 35/2021 §7.2).",
                "14 bilingual reports pf11–pf44 (XLSX/PDF) + analytics summary + per-employee history register (PP 35/2021 §7.2).",
              )}
            </p>
            <p className="mt-3 border-t border-dashed border-emerald-200 pt-2.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 dark:border-emerald-500/20 dark:text-emerald-300">
              {t("Buka tab Laporan", "Open Reports tab")}
            </p>
          </a>
          {/* P9 — kepatuhan UU PDP: DSR karyawan + retensi arsip + matriks akses */}
          <a
            href="/?m=performance&v=compliance"
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-fuchsia-500/30 dark:from-fuchsia-500/10 dark:to-slate-900"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-fuchsia-400 to-rose-500" />
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-600 text-white shadow-sm transition-transform group-hover:scale-105">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <ChevronRight className="h-4 w-4 text-fuchsia-600 transition-transform group-hover:translate-x-1 dark:text-fuchsia-400" />
            </div>
            <p className="mt-3 text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
              {t("Kepatuhan (UU PDP)", "Compliance (UU PDP)")}
            </p>
            <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t(
                "DSR karyawan atas data kinerja (akses/ekspor/hapus — SLA 7 hari) + retensi arsip + matriks akses §11.3.",
                "Employee DSRs over performance data (access/export/erase — 7-day SLA) + records retention + §11.3 access matrix.",
              )}
            </p>
            <p className="mt-3 border-t border-dashed border-fuchsia-200 pt-2.5 text-[10px] font-extrabold uppercase tracking-wide text-fuchsia-700 dark:border-fuchsia-500/20 dark:text-fuchsia-300">
              {t("Buka tab Kepatuhan", "Open Compliance tab")}
            </p>
          </a>
          {/* B1-BL — kartu OKR kuartal (HANYA bila okrEnabled — ringkasan dari
              dashboard laporan; terpisah dari penilaian D-BL1) */}
          {dash.data?.okrSummary && (
            <a
              href="/?m=performance&v=okr"
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-fuchsia-500/30 dark:from-fuchsia-500/10 dark:to-slate-900"
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-fuchsia-400 to-pink-500" />
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-600 text-white shadow-sm transition-transform group-hover:scale-105">
                  <Telescope className="h-5 w-5" />
                </span>
                <span className="text-right">
                  <span className="block font-mono text-[10px] font-bold text-fuchsia-600 dark:text-fuchsia-300">{dash.data.okrSummary.quarter}</span>
                  <span className="block text-lg font-black tabular-nums text-slate-900 dark:text-slate-50">{dash.data.okrSummary.posted}</span>
                </span>
              </div>
              <p className="mt-3 text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
                {t("OKR Kuartalan", "Quarterly OKR")}
              </p>
              <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {dash.data.okrSummary.avgProgressPct != null
                  ? t(
                      "{n} objective Posted · rata-rata progres {p}% — board transparan, alat penyelarasan (bukan penilaian).",
                      "{n} posted objectives · average progress {p}% — a transparent board, an alignment tool (not an appraisal).",
                      { n: String(dash.data.okrSummary.posted), p: String(dash.data.okrSummary.avgProgressPct) },
                    )
                  : t(
                      "Belum ada objective Posted di kuartal ini — board transparan menunggu posting pertama.",
                      "No posted objectives in this quarter yet — the transparent board awaits its first post.",
                    )}
              </p>
              <p className="mt-3 border-t border-dashed border-fuchsia-200 pt-2.5 text-[10px] font-extrabold uppercase tracking-wide text-fuchsia-700 dark:border-fuchsia-500/20 dark:text-fuchsia-300">
                {t("Buka tab OKR", "Open OKR tab")}
              </p>
            </a>
          )}
          {/* B4-BL — kartu Talent & Succession (ringkasan register peran kritis;
              HANYA bila ada ≥1 peran terdaftar & aktor berhak melihat — data
              ringkas dihitung server-side di GET talent response) */}
          {succession != null && succession.positions >= 1 && (
            <a
              href="/?m=performance&v=talent"
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:border-amber-500/30 dark:from-amber-500/10 dark:to-slate-900"
            >
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-amber-400 to-rose-500" />
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm transition-transform group-hover:scale-105">
                  <Crown className="h-5 w-5" />
                </span>
                <span className="text-right">
                  <span className="block text-lg font-black tabular-nums text-slate-900 dark:text-slate-50">{succession.positions}</span>
                  <span className="block text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">{t("peran kritis", "critical roles")}</span>
                </span>
              </div>
              <p className="mt-3 text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
                {t("Talent & Succession", "Talent & Succession")}
              </p>
              <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {t(
                  "{c} kandidat penerus terdaftar · {u} peran tanpa penerus siap — risiko attrisi & rencana suksesi dalam satu tab.",
                  "{c} successor candidates registered · {u} roles without a ready successor — attrition risk & succession planning in one tab.",
                  { c: String(succession.candidates), u: String(succession.uncovered) },
                )}
              </p>
              <p className="mt-3 border-t border-dashed border-amber-200 pt-2.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:border-amber-500/20 dark:text-amber-300">
                {t("Buka tab Talent", "Open Talent tab")}
              </p>
            </a>
          )}
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold">{t("Rencana Eksekusi Fase P0–P9 + Backlog B1–B4", "Execution Plan Phases P0–P9 + Backlog B1–B4")}</h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PHASES.map((p) => {
              const done = true; // P0..P9 + B1..B4 selesai (B4 = succession; B5–B8 di modul lain)
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3",
                    done
                      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30"
                      : "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40",
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="font-mono text-xs">{p.id}</span>
                      {t(p.label, p.labelEn)}
                      {done ? null : <Clock className="h-3 w-3 text-slate-400" />}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {t(p.detail, p.detailEn)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
