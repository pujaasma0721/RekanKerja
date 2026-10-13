"use client";
// P0-PERF — Ringkasan modul Performance: kartu KPI LIVE + distribusi =======
// (P8): data dari /api/rekankerja/performance/overview — jumlah siklus, peserta
// aktif (siklus belum Closed), pustaka KPI & kompetensi aktif, distribusi
// rating final (mini-bar div) + status formulir siklus berjalan + rekap PIP.
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { Button } from "@/components/ui/button";
import { Boxes, ClipboardList, Gauge, NotebookPen, ShieldCheck, Target, Users, CalendarRange, Percent, MessageSquareText, Waypoints, FileBarChart, BarChart3, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface OverviewData {
  counts: { cycles: number; activeParticipants: number; kpi: number; competency: number };
  ratingDist: { rating: number; count: number }[];
  statusDist: { status: string; count: number }[];
  pip: { active: number; recovered: number; notRecovered: number };
}

const RATING_COLOR = ["bg-rose-400", "bg-orange-400", "bg-amber-400", "bg-lime-500", "bg-emerald-500"];
const RATING_LABEL: [string, string][] = [
  ["Sangat Kurang", "Very Poor"],
  ["Kurang", "Poor"],
  ["Cukup", "Satisfactory"],
  ["Baik", "Good"],
  ["Sangat Baik", "Outstanding"],
];
const STATUS_LABEL: Record<string, [string, string]> = {
  Enrolled: ["Terdaftar", "Enrolled"], GoalProposed: ["Usulan Target", "Goal Proposed"],
  GoalApproved: ["Target Disetujui", "Goals Approved"], Ongoing: ["Berjalan", "Ongoing"],
  SelfDone: ["Self Selesai", "Self Done"], ManagerDone: ["Atasan Selesai", "Manager Done"],
  Calibrating: ["Kalibrasi", "Calibrating"], Finalized: ["Difinalisasi", "Finalized"],
  Published: ["Terpublikasi", "Published"], Appealed: ["Banding", "Appealed"],
  Closed: ["Ditutup", "Closed"],
};
const STATUS_COLOR = "bg-fuchsia-400";

export function PerformanceOverviewPage() {
  const { t } = useI18n();
  const nav = useNav();
  const api = useApi<OverviewData>("/api/rekankerja/performance/overview");

  const d = api.data;
  const tiles: { key: string; label: [string, string]; value: number | string; icon: React.ElementType; onClick: () => void }[] = [
    { key: "cycle", label: ["Siklus Penilaian", "Appraisal Cycles"], value: d?.counts.cycles ?? "—", icon: CalendarRange, onClick: () => nav.navigate("performance", "cycles") },
    { key: "participants", label: ["Peserta Aktif (siklus berjalan)", "Active Participants (running cycles)"], value: d?.counts.activeParticipants ?? "—", icon: Users, onClick: () => nav.navigate("performance", "cycles") },
    { key: "kpi", label: ["Pustaka KPI Aktif", "Active KPI Library"], value: d?.counts.kpi ?? "—", icon: Target, onClick: () => nav.navigate("performance", "masters") },
    { key: "comp", label: ["Kompetensi Aktif", "Active Competencies"], value: d?.counts.competency ?? "—", icon: NotebookPen, onClick: () => nav.navigate("performance", "masters") },
  ];

  const menu: { label: [string, string]; desc: [string, string]; view: string; icon: React.ElementType }[] = [
    { label: ["Siklus Penilaian", "Appraisal Cycles"], desc: ["Buka siklus, enroll peserta, gerbang fase + Command Center nudge", "Open cycles, enroll participants, phase gates + Command Center nudge"], view: "cycles", icon: CalendarRange },
    { label: ["Target & KPI", "Goals & KPI"], desc: ["KPI Builder + salin dari periode sebelumnya + impor Excel", "KPI Builder + copy from previous cycle + Excel import"], view: "goals", icon: Target },
    { label: ["Check-in", "Check-ins"], desc: ["1-on-1 terdokumentasi + progress tengah tahun", "Documented 1-on-1s + mid-year progress"], view: "checkins", icon: MessageSquareText },
    { label: ["Penilaian", "Appraisals"], desc: ["Self → atasan → 360, tarikan otomatis, AI assist, estimasi dampak", "Self → manager → 360, auto-pull, AI assist, impact estimate"], view: "appraisals", icon: NotebookPen },
    { label: ["Kalibrasi", "Calibration"], desc: ["Distribusi + bell curve + keputusan ter-audit", "Distribution + bell curve + audited decisions"], view: "calibration", icon: Gauge },
    { label: ["Hasil & 9-Box", "Results & 9-Box"], desc: ["Publikasi, acknowledgement, banding, lensa talenta", "Publication, acknowledgement, appeals, talent lens"], view: "results", icon: FileBarChart },
    { label: ["PIP", "PIP"], desc: ["Program perbaikan kinerja 1–3 bulan: target mini-KPI, checkpoint, outcome", "1–3-month improvement program: mini-KPI targets, checkpoints, outcome"], view: "pip", icon: Waypoints },
    { label: ["Evaluasi Masa Percobaan", "Probation Evaluation"], desc: ["Keputusan percobaan dari hiring rekrutmen", "Probation decisions from recruitment hires"], view: "probation", icon: ClipboardList },
    { label: ["Laporan", "Reports"], desc: ["Katalog 14 laporan dokumen dwibahasa (pf11–pf44) siap cetak + XLSX", "Catalog of 14 bilingual report documents (pf11–pf44), print + XLSX ready"], view: "reports", icon: BarChart3 },
    // P9 — kepatuhan UU PDP: DSR karyawan (data kinerja) + retensi arsip
    { label: ["Kepatuhan", "Compliance"], desc: ["DSR karyawan UU PDP (akses/ekspor/hapus — SLA 7 hari) + retensi arsip", "Employee DSRs under UU PDP (access/export/erase — 7-day SLA) + records retention"], view: "compliance", icon: ShieldCheck },
  ];

  const maxRating = Math.max(1, ...(d?.ratingDist ?? []).map((r) => r.count));
  const statusSorted = [...(d?.statusDist ?? [])].sort((a, b) => b.count - a.count);
  const maxStatus = Math.max(1, ...statusSorted.map((r) => r.count));

  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t("Ringkasan Kinerja", "Performance Overview")}
        description={t(
          "Modul manajemen kinerja: siklus penilaian → target KPI → check-in → penilaian → kalibrasi → konsekuensi (merit, PA, PIP, surat). Kartu dan distribusi di bawah dihitung LANGSUNG dari data terkini.",
          "Performance management module: appraisal cycles → KPI targets → check-ins → appraisal → calibration → consequences (merit, PA, PIP, letters). The cards and distributions below are computed LIVE from current data.",
        )}
        actions={(
          <Button onClick={() => nav.navigate("performance", "masters")}>
            <Boxes className="h-4 w-4" aria-hidden /> {t("Kelola Master Kinerja", "Manage Performance Masters")}
          </Button>
        )}
      />

      {api.loading && !api.data ? (
        <LoadingCards />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Card key={tile.key} className="cursor-pointer transition-shadow hover:shadow-md" onClick={tile.onClick}>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/50 dark:text-fuchsia-400">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold tabular-nums">{tile.value}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{t(tile.label[0], tile.label[1])}</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* P8 — dua mini-chart distribusi (div sederhana, tanpa pustaka grafik) */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <TrendingUp className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Distribusi Rating Final (semua siklus)", "Final Rating Distribution (all cycles)")}
            </h2>
            {d && d.ratingDist.some((r) => r.count > 0) ? (
              <div className="space-y-2">
                {d.ratingDist.map((r) => (
                  <button
                    key={r.rating}
                    type="button"
                    onClick={() => nav.navigate("performance", "calibration")}
                    className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="w-28 shrink-0 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {r.rating} · {t(RATING_LABEL[r.rating - 1][0], RATING_LABEL[r.rating - 1][1])}
                    </span>
                    <span className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800" aria-hidden>
                      <span className={cn("block h-full rounded", RATING_COLOR[r.rating - 1])} style={{ width: `${(r.count / maxRating) * 100}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{r.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-slate-400">{t("Belum ada rating final terpublikasi.", "No final ratings published yet.")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <Percent className="h-4 w-4 ov-text-accent" aria-hidden />
              {t("Status Formulir · Siklus Berjalan", "Form Status · Running Cycles")}
            </h2>
            {statusSorted.length > 0 ? (
              <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {statusSorted.map((r) => (
                  <div key={r.status} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t(...(STATUS_LABEL[r.status] ?? [r.status, r.status]))}
                    </span>
                    <span className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800" aria-hidden>
                      <span className={cn("block h-full rounded", STATUS_COLOR)} style={{ width: `${(r.count / maxStatus) * 100}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right text-xs font-bold tabular-nums">{r.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-slate-400">{t("Belum ada peserta pada siklus berjalan.", "No participants in running cycles.")}</p>
            )}
            {d && d.pip.recovered + d.pip.notRecovered > 0 && (
              <p className="mt-3 border-t border-dashed pt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {t(
                  "PIP: {a} aktif · {r} pulih / {n} belum pulih (tingkat pemulihan {p}%)",
                  "PIP: {a} active · {r} recovered / {n} not recovered (recovery rate {p}%)",
                  { a: String(d.pip.active), r: String(d.pip.recovered), n: String(d.pip.notRecovered), p: String(Math.round((d.pip.recovered / (d.pip.recovered + d.pip.notRecovered)) * 100)) },
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Percent className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Peta Menu Modul", "Module Menu Map")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {menu.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.view}
                  onClick={() => nav.navigate("performance", m.view)}
                  className={cn(
                    "flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white/80 p-3 text-left transition-colors hover:border-fuchsia-300 hover:bg-fuchsia-50/50",
                    "dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-fuchsia-800 dark:hover:bg-fuchsia-950/20",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden />
                    <span className="text-sm font-semibold">{t(m.label[0], m.label[1])}</span>
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{t(m.desc[0], m.desc[1])}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
