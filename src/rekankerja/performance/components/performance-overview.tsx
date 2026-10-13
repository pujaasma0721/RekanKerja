"use client";
// RekanKerja Performance — Ringkasan modul (P0): kartu jumlah master aktif +
// status fase rencana eksekusi P0–P9 (§20). Fase berikutnya menambah KPI
// siklus/peserta progres nyata di sini.
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, ListChecks, Users, Scale, Grid3x3, Wallet, CalendarRange, CheckCircle2, Circle, Clock } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

interface Counts {
  kpi: number;
  competency: number;
  "rating-scale": number;
  template: number;
  "merit-matrix": number;
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
  { id: "P9", label: "Kepatuhan & Hardening", labelEn: "Compliance & Hardening", detail: "Visibility matrix + DSR + retensi + uji beban", detailEn: "Visibility matrix + DSR + retention + load tests" },
];

export function PerformanceOverview() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<{ counts: Counts }>("/api/rekankerja/performance/masters");

  const c = data?.counts;
  const cards: { label: string; labelEn: string; value?: number; icon: React.ElementType }[] = [
    { label: "Pustaka KPI aktif", labelEn: "Active KPI library", value: c?.kpi, icon: ListChecks },
    { label: "Kompetensi aktif", labelEn: "Active competencies", value: c?.competency, icon: Users },
    { label: "Tingkat skala rating", labelEn: "Rating scale levels", value: c?.["rating-scale"], icon: Scale },
    { label: "Template bobot", labelEn: "Weight templates", value: c?.template, icon: Grid3x3 },
    { label: "Matriks merit", labelEn: "Merit matrices", value: c?.["merit-matrix"], icon: Wallet },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance · P0"
        title={t("Ringkasan Kinerja", "Performance Overview")}
        desc={t(
          "Fondasi modul penilaian kinerja: pustaka KPI & kompetensi ber-versi, skala rating, template bobot, dan matriks merit.",
          "Performance module foundation: versioned KPI & competency library, rating scales, weight templates, and merit matrix.",
        )}
      />

      {error && (
        <EmptyState
          icon={Target}
          title={t("Gagal memuat ringkasan", "Failed to load overview")}
          desc={error}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((k) => (
          <Card key={k.label} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <k.icon className="h-4 w-4" />
                <span className="text-xs font-medium">{t(k.label, k.labelEn)}</span>
              </div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-12" />
              ) : (
                <div className="mt-1 text-2xl font-semibold tabular-nums">{k.value ?? "—"}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold">{t("Rencana Eksekusi Fase P0–P9", "Execution Plan Phases P0–P9")}</h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {PHASES.map((p, i) => {
              const done = i === 0;
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
