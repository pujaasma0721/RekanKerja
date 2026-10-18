"use client";
// P3.5-BM (D-BM27) — Jalur Karier Saya: peta pengembangan karier karyawan
// (READ-ONLY): kartu posisi saat ini (+ grade/unit + masa kerja) → kartu
// jalur dari posisi itu (posisi tujuan + syarat keahlian + GAP PRIBADI vs
// EmployeeSkill: hijau = terpenuhi · amber "Lv 3/5" = dinilai tapi kurang ·
// abu-abu "belum dinilai") + ringkasan "{x}/{y} terpenuhi" + daftar level
// keahlian saya. Jalur karier = teks + level keahlian — BUKAN modul training
// (D-BM28 exclude permanen; aksi pengembangan = teks terstruktur succession).
import { useMemo } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/rekankerja/shared/lib/api";
import { ESS_BASE } from "./ess-api";
import {
  Route, BriefcaseBusiness, CalendarClock, CheckCircle2, AlertTriangle,
  CircleDashed, ArrowRight, Wrench, Sparkles,
} from "lucide-react";

// ============ kontrak GET /ess/my-career ============

interface MyReq {
  skillId: string;
  name: string;
  required: number;
  my: number | null;
  ok: boolean;
}
interface MyPath {
  id: string;
  toPosition: { id: string; code: string; title: string; gradeName: string | null };
  note: string | null;
  requirements: MyReq[];
  met: number;
  total: number;
}
interface MyCareerData {
  employee: { fullName: string; employeeNo: string; joinDate: string | null; tenureYears: number; tenureMonths: number };
  position: {
    id: string; code: string; title: string; gradeName: string | null; unitName: string | null; since: string | null;
  } | null;
  paths: MyPath[];
  skills: { skillId: string; name: string; category: string | null; level: number }[];
}

/** Label masa kerja dwibahasa ("2 thn 3 bln" / "2 yr 3 mo"). */
function tenureLabel(years: number, months: number, t: (id: string, en?: string, vars?: Record<string, string | number>) => string): string {
  if (years === 0 && months === 0) return t("baru bergabung", "just joined");
  const parts: string[] = [];
  if (years > 0) parts.push(t("{n} thn", "{n} yr", { n: String(years) }));
  if (months > 0 || years === 0) parts.push(t("{n} bln", "{n} mo", { n: String(months) }));
  return parts.join(" ");
}

export function EssMyCareerPage() {
  const { t } = useI18n();
  const { data, loading, error } = useApi<MyCareerData>(`${ESS_BASE}/my-career`);

  const skillChips = useMemo(
    () => (data?.skills ?? []).slice().sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    [data],
  );

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={t("Employee Self Service", "Employee Self Service")}
          title={t("Jalur Karier Saya", "My Career Path")}
          description={t("Peta pengembangan karier Anda", "Your career development map")}
        />
        <LoadingCards cards={3} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={t("Employee Self Service", "Employee Self Service")}
          title={t("Jalur Karier Saya", "My Career Path")}
          description={t("Peta pengembangan karier Anda", "Your career development map")}
        />
        <EmptyState icon={Route} title={t("Gagal memuat jalur karier", "Failed to load your career path")} description={error} />
      </div>
    );
  }

  const paths = data?.paths ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Jalur Karier Saya", "My Career Path")}
        description={t(
          "Peta pengembangan karier Anda — jalur dari posisi saat ini beserta syarat keahliannya",
          "Your career development map — paths from your current position with their skill requirements",
        )}
      />

      {/* ===== kartu posisi saat ini (hero) ===== */}
      <Card className="min-w-0 overflow-hidden border-brand/30 dark:border-brand/30">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-start gap-4 bg-gradient-to-br from-brand/10 via-transparent to-transparent p-4 sm:p-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30">
              <BriefcaseBusiness className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-deep dark:text-brand">
                {t("Posisi Anda Saat Ini", "Your Current Position")}
              </p>
              <h2 className="mt-0.5 truncate text-lg font-black text-slate-900 dark:text-slate-50">
                {data?.position?.title ?? t("Belum ada penempatan aktif", "No active placement")}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                {data?.position?.code && (
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[10px] font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                    {data.position.code}
                  </span>
                )}
                {data?.position?.gradeName && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Sparkles className="h-3 w-3 text-amber-500" aria-hidden />
                    {data.position.gradeName}
                  </span>
                )}
                {data?.position?.unitName && <span>{data.position.unitName}</span>}
                {data?.position?.since && (
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="h-3 w-3" aria-hidden />
                    {t("di posisi ini sejak {d}", "in this position since {d}", { d: fmtDate(data.position.since) })}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 rounded-2xl border border-brand/25 bg-white/70 px-4 py-2.5 text-center dark:bg-slate-900/60">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Masa Kerja", "Tenure")}</p>
              <p className="text-sm font-black tabular-nums text-brand-deep dark:text-brand">
                {tenureLabel(data?.employee.tenureYears ?? 0, data?.employee.tenureMonths ?? 0, t)}
              </p>
              {data?.employee.joinDate && (
                <p className="text-[10px] text-slate-400">{t("gabung {d}", "joined {d}", { d: fmtDate(data.employee.joinDate) })}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== level keahlian saya ===== */}
      {skillChips.length > 0 && (
        <Card className="min-w-0">
          <CardContent className="p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
              <Wrench className="h-4 w-4 text-brand" aria-hidden />
              {t("Level Keahlian Saya", "My Skill Levels")}
              <Badge variant="outline" className="ml-1 text-[10px]">{skillChips.length}</Badge>
            </h3>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {skillChips.map((s) => (
                <span
                  key={s.skillId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  title={s.category ?? undefined}
                >
                  {s.name}
                  <span className="rounded-full bg-brand/15 px-1.5 py-px text-[9px] font-black tabular-nums text-brand-deep dark:text-brand">
                    {t("Lv {n}/5", "Lv {n}/5", { n: String(s.level) })}
                  </span>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== jalur karier ===== */}
      {paths.length === 0 ? (
        <EmptyState
          icon={Route}
          title={t(
            "Belum ada jalur karier terdaftar dari posisi Anda — hubungi HR",
            "No career paths registered from your position yet — contact HR",
          )}
          description={t(
            "HR dapat mendaftarkan jalur posisi berikutnya dari jabatan Anda beserta syarat keahliannya; jalur itu akan tampil di sini beserta analisis gap Anda.",
            "HR can register next-position paths from your job title along with their skill requirements; those paths will appear here with your gap analysis.",
          )}
        />
      ) : (
        <div className="space-y-3">
          {paths.map((p) => {
            const allMet = p.total > 0 && p.met === p.total;
            return (
              <Card key={p.id} className="min-w-0">
                <CardContent className="p-4">
                  {/* posisi tujuan */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13px] font-bold text-slate-400">{data?.position?.title ?? "—"}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                        <p className="truncate text-sm font-black text-slate-900 dark:text-slate-50">{p.toPosition.title}</p>
                        {p.toPosition.gradeName && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
                            <Sparkles className="h-3 w-3" aria-hidden />
                            {p.toPosition.gradeName}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">{p.toPosition.code}</p>
                    </div>
                    {/* ringkasan terpenuhi */}
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black tabular-nums",
                        allMet
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500",
                      )}
                    >
                      {t("{x}/{y} terpenuhi", "{x}/{y} met", { x: String(p.met), y: String(p.total) })}
                    </span>
                  </div>

                  {/* syarat keahlian + gap pribadi */}
                  {p.total === 0 ? (
                    <p className="mt-2.5 text-[11px] italic text-slate-400">{t("tanpa syarat keahlian", "no skill requirements")}</p>
                  ) : (
                    <div className="mt-2.5 space-y-1.5">
                      {p.requirements.map((r) => (
                        <div
                          key={r.skillId}
                          className={cn(
                            "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border px-3 py-2",
                            r.ok
                              ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/25 dark:bg-emerald-500/10"
                              : r.my == null
                                ? "border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40"
                                : "border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-500/10",
                          )}
                        >
                          {r.ok ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          ) : r.my == null ? (
                            <CircleDashed className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                          ) : (
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-700 dark:text-slate-200">{r.name}</span>
                          {r.ok ? (
                            <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-emerald-400">
                              {t("Lv {n}/5 ✓", "Lv {n}/5 ✓", { n: String(r.my) })}
                            </span>
                          ) : r.my == null ? (
                            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-900">
                              {t("belum dinilai · butuh Lv ≥ {n}", "not assessed · needs Lv ≥ {n}", { n: String(r.required) })}
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-slate-900 dark:text-amber-500">
                              {t("Lv {my}/5 · butuh ≥ {req}", "Lv {my}/5 · needs ≥ {req}", { my: String(r.my), req: String(r.required) })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {p.note && (
                    <p className="mt-2.5 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                      {p.note}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
