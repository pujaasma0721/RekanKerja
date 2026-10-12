"use client";
// P0-PERF — Ringkasan modul Performance: kartu KPI master + status modul
// (pola recruitment-overview; data dari /api/rekankerja/performance/masters
// tanpa kind → { counts }).
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { Button } from "@/components/ui/button";
import { Boxes, ClipboardList, Gauge, NotebookPen, Target, Users, CalendarRange, Percent, MessageSquareText, Waypoints, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";

interface Counts {
  kpi: number;
  competency: number;
  scale: number;
  template: number;
  meritMatrix: number;
  cycle: number;
  appraisal: number;
}

export function PerformanceOverviewPage() {
  const { t } = useI18n();
  const nav = useNav();
  const api = useApi<{ counts: Counts }>("/api/rekankerja/performance/masters");

  const c = api.data?.counts;
  const tiles: { key: string; label: [string, string]; value: number | string; icon: React.ElementType; onClick: () => void; hint?: [string, string] }[] = [
    { key: "cycle", label: ["Siklus Penilaian", "Appraisal Cycles"], value: c?.cycle ?? "—", icon: CalendarRange, onClick: () => nav.navigate("performance", "cycles"), hint: ["P1", "P1"] },
    { key: "appraisal", label: ["Peserta Penilaian", "Appraisal Participants"], value: c?.appraisal ?? "—", icon: Users, onClick: () => nav.navigate("performance", "cycles"), hint: ["P1", "P1"] },
    { key: "kpi", label: ["Pustaka KPI Aktif", "Active KPI Library"], value: c?.kpi ?? "—", icon: Target, onClick: () => nav.navigate("performance", "masters") },
    { key: "comp", label: ["Kompetensi Aktif", "Active Competencies"], value: c?.competency ?? "—", icon: NotebookPen, onClick: () => nav.navigate("performance", "masters") },
  ];

  const menu: { label: [string, string]; desc: [string, string]; view: string; icon: React.ElementType; phase?: [string, string] }[] = [
    { label: ["Siklus Penilaian", "Appraisal Cycles"], desc: ["Buka siklus, enroll peserta, gerbang fase + Command Center nudge (P1)", "Open cycles, enroll participants, phase gates + Command Center nudge (P1)"], view: "cycles", icon: CalendarRange, phase: ["P1", "P1"] },
    { label: ["Target & KPI", "Goals & KPI"], desc: ["KPI Builder + salin dari periode sebelumnya + impor Excel (P1)", "KPI Builder + copy from previous cycle + Excel import (P1)"], view: "goals", icon: Target, phase: ["P1", "P1"] },
    { label: ["Check-in", "Check-ins"], desc: ["1-on-1 terdokumentasi + progress tengah tahun (P2)", "Documented 1-on-1s + mid-year progress (P2)"], view: "checkins", icon: MessageSquareText, phase: ["P2", "P2"] },
    { label: ["Penilaian", "Appraisals"], desc: ["Self → atasan → 360, tarikan otomatis, AI assist, estimasi dampak (P3)", "Self → manager → 360, auto-pull, AI assist, impact estimate (P3)"], view: "appraisals", icon: NotebookPen, phase: ["P3", "P3"] },
    { label: ["Kalibrasi", "Calibration"], desc: ["Distribusi + bell curve + keputusan ter-audit (P4)", "Distribution + bell curve + audited decisions (P4)"], view: "calibration", icon: Gauge, phase: ["P4", "P4"] },
    { label: ["Hasil & 9-Box", "Results & 9-Box"], desc: ["Publikasi, acknowledgement, banding, lensa talenta (P4)", "Publication, acknowledgement, appeals, talent lens (P4)"], view: "results", icon: FileBarChart, phase: ["P4", "P4"] },
    { label: ["PIP", "PIP"], desc: ["Program perbaikan kinerja 30/60/90 hari (P6)", "30/60/90-day improvement program (P6)"], view: "pip", icon: Waypoints, phase: ["P6", "P6"] },
    { label: ["Evaluasi Masa Percobaan", "Probation Evaluation"], desc: ["Keputusan percobaan dari hiring rekrutmen (P7)", "Probation decisions from recruitment hires (P7)"], view: "probation", icon: ClipboardList, phase: ["P7", "P7"] },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian Kinerja")}
        title={t("Ringkasan Kinerja", "Performance Overview")}
        description={t(
          "Modul manajemen kinerja: siklus penilaian → target KPI → check-in → penilaian → kalibrasi → konsekuensi (merit, PA, PIP, surat). Fondasi master aktif; fase lain menyusul per rencana P0–P9.",
          "Performance management module: appraisal cycles → KPI targets → check-ins → appraisal → calibration → consequences (merit, PA, PIP, letters). Master foundation is live; other phases follow the P0–P9 plan.",
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
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {t(tile.label[0], tile.label[1])}
                      {tile.hint && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{tile.hint[0]}</span>}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

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
                    {m.phase && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{m.phase[0]}</span>
                    )}
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
