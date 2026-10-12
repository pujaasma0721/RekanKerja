"use client";
// RekanKerja Recruitment F5 — view "Demografi & Segmen": demografi pelamar
// (padanan ApplicantDemography §2.5 — chart "Display Chart"), segmen
// talent pool, dan silver medalist (kandidat lulus seleksi tanpa pengangkatan
// — auto-saran HRX). Chart bar murni CSS/div (tanpa library eksternal).
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  Award, CalendarClock, CheckCircle2, CircleSlash, Layers3, Medal, PieChart, UserRoundCheck, UsersRound,
} from "lucide-react";

const DEMOG_API = "/api/rekankerja/recruitment/demographics";

// ---------- tipe (mirror kontrak demographics-service) ----------

interface DemogSlice {
  key: string;
  label: string;
  labelEn: string;
  count: number;
}

interface DemogResp {
  total: number;
  byGender: DemogSlice[];
  byAge: DemogSlice[];
  byEdu: DemogSlice[];
  bySource: DemogSlice[];
  byStatus: DemogSlice[];
  segments: {
    active: number;
    rejected: number;
    outdated: number;
    employed: number;
    blacklisted: number;
    expiringSoon: number;
  };
  silver: {
    rows: {
      candidateId: string;
      fullName: string;
      source: string;
      status: string;
      prNo: string;
      positionTitle: string | null;
      applicantNo: string | null;
      nominatedAt: string;
      note: string | null;
    }[];
    count: number;
  };
}

/** palet bar chart — tanpa indigo/blue (pola funnel offers.tsx). */
const BAR_GRADIENTS = [
  "bg-gradient-to-r from-amber-300 to-amber-500 dark:from-amber-600 dark:to-amber-400",
  "bg-gradient-to-r from-emerald-400 to-emerald-600 dark:from-emerald-500 dark:to-emerald-400",
  "bg-gradient-to-r from-cyan-300 to-cyan-500 dark:from-cyan-600 dark:to-cyan-400",
  "bg-gradient-to-r from-violet-300 to-violet-500 dark:from-violet-600 dark:to-violet-400",
  "bg-gradient-to-r from-rose-300 to-rose-500 dark:from-rose-600 dark:to-rose-400",
  "bg-gradient-to-r from-slate-300 to-slate-500 dark:from-slate-600 dark:to-slate-400",
];

/** satu kelompok bar chart murni CSS (pola funnel offers.tsx — width %). */
function BarGroup({ title, icon: Icon, slices, t }: {
  title: string;
  icon: React.ElementType;
  slices: DemogSlice[];
  t: (id: string, en?: string) => string;
}) {
  const max = Math.max(...slices.map((s) => s.count), 1);
  return (
    <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {title}
      </p>
      <div className="space-y-2.5">
        {slices.length === 0 && <p className="text-[11px] italic text-slate-400">{t("belum ada data", "no data yet")}</p>}
        {slices.map((s, i) => (
          <div key={s.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-300">{t(s.label, s.labelEn)}</span>
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{s.count}</span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
              <div
                className={cn("h-2.5 rounded-full", BAR_GRADIENTS[i % BAR_GRADIENTS.length])}
                style={{ width: `${Math.max(s.count > 0 ? 3 : 0, Math.round((s.count / max) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// halaman
// =====================================================================

export function DemographicsPage() {
  const { t, locale } = useI18n();
  const api = useApi<DemogResp>(`${DEMOG_API}?stats=1`, []);

  const d = api.data;
  const seg = d?.segments;

  const segTiles: { icon: React.ElementType; label: string; labelEn: string; value: number | undefined; accent?: "amber" | "emerald" | "rose" | "slate" }[] = [
    { icon: UsersRound, label: "Aktif", labelEn: "Active", value: seg?.active, accent: "emerald" },
    { icon: UserRoundCheck, label: "Dipekerjakan", labelEn: "Employed", value: seg?.employed, accent: "emerald" },
    { icon: CircleSlash, label: "Ditolak", labelEn: "Rejected", value: seg?.rejected, accent: "rose" },
    { icon: Layers3, label: "Kedaluwarsa", labelEn: "Outdated", value: seg?.outdated, accent: "slate" },
    { icon: CircleSlash, label: "Blacklist", labelEn: "Blacklisted", value: seg?.blacklisted, accent: "rose" },
    { icon: CalendarClock, label: "Keep-on-file ≤60 hari", labelEn: "Keep-on-file ≤60 days", value: seg?.expiringSoon, accent: "amber" },
  ];

  const fmtShort = (v: string | null) => {
    if (!v) return "—";
    const dt = new Date(v);
    if (isNaN(dt.getTime())) return "—";
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(dt);
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F5")}
        title={t("Demografi & Segmen Pelamar", "Applicant Demographics & Segments")}
        description={t(
          "Profil talent pool — jenis kelamin, kelompok umur, pendidikan tertinggi, sumber pelamar & status (padanan ApplicantDemography), segmen talent pool, dan kandidat silver medalist.",
          "Talent pool profile — gender, age group, highest education, applicant source & status (ApplicantDemography equivalent), talent pool segments, and silver medalist candidates.",
        )}
      />

      {/* chip total */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Total Pelamar", "Total Applicants")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{d?.total ?? 0}</div>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
          <div className="text-xs font-medium text-violet-600 dark:text-violet-400">{t("Silver Medalist", "Silver Medalists")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-violet-700 dark:text-violet-400">{d?.silver.count ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Keep-on-file ≤60 hari", "Keep-on-file ≤60 days")}</div>
          <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", (seg?.expiringSoon ?? 0) > 0 ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-50")}>{seg?.expiringSoon ?? 0}</div>
        </div>
      </div>

      {api.loading && !api.data ? (
        <LoadingRows rows={6} />
      ) : api.error ? (
        <EmptyState title={t("Gagal memuat demografi", "Failed to load demographics")} description={api.error} />
      ) : !d ? null : (
        <>
          {/* chart demografi — bar murni CSS (pola funnel offers.tsx) */}
          <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChart className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Demografi Pelamar", "Applicant Demographics")}
              </CardTitle>
              <CardDescription className="text-xs">
                {t(
                  "Agregat dari kolom data pelamar polos (bukan PII terenkripsi) — aman dianalisis per kelompok.",
                  "Aggregated from plain applicant columns (not encrypted PII) — safe to analyze per group.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 lg:grid-cols-2">
                <BarGroup title={t("Jenis Kelamin", "Gender")} icon={UsersRound} slices={d.byGender} t={t} />
                <BarGroup title={t("Kelompok Umur", "Age Group")} icon={Layers3} slices={d.byAge} t={t} />
                <BarGroup title={t("Pendidikan Tertinggi", "Highest Education")} icon={Award} slices={d.byEdu} t={t} />
                <BarGroup title={t("Sumber Pelamar", "Applicant Source")} icon={Medal} slices={d.bySource} t={t} />
                <BarGroup title={t("Status Talent Pool", "Talent Pool Status")} icon={CheckCircle2} slices={d.byStatus} t={t} />
                {/* segmen talent pool */}
                <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                  <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <Layers3 className="h-3.5 w-3.5" aria-hidden /> {t("Segmen Talent Pool", "Talent Pool Segments")}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {segTiles.map((s) => {
                      const Icon = s.icon;
                      return (
                        <div key={s.labelEn} className={cn(
                          "rounded-xl border px-3 py-2.5",
                          s.accent === "emerald" ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                            : s.accent === "rose" ? "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10"
                              : s.accent === "amber" ? "border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10"
                                : "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40",
                        )}>
                          <Icon className={cn(
                            "h-4 w-4",
                            s.accent === "emerald" ? "text-emerald-600 dark:text-emerald-400"
                              : s.accent === "rose" ? "text-rose-600 dark:text-rose-400"
                                : s.accent === "amber" ? "text-amber-600 dark:text-amber-400"
                                  : "text-slate-500 dark:text-slate-400",
                          )} aria-hidden />
                          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{s.value ?? 0}</p>
                          <p className="text-[11px] font-medium leading-tight text-slate-500 dark:text-slate-400">{t(s.label, s.labelEn)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* silver medalist — auto-saran talent pool */}
          <Card className="mt-4 border-violet-200 bg-white/80 shadow-sm dark:border-violet-500/30 dark:bg-slate-900/80">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Medal className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden />
                {t("Kandidat Silver Medalist ({n})", "Silver Medalist Candidates ({n})", { n: String(d.silver.count) })}
              </CardTitle>
              <CardDescription className="text-xs">
                {t(
                  "Saran otomatis: kandidat lulus seleksi tanpa pengangkatan — pertimbangkan saat slot serupa terbuka.",
                  "Auto-suggestion: selection-passed candidates without an appointment — consider them when a similar slot opens.",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {d.silver.rows.length === 0 ? (
                <EmptyState
                  icon={Medal}
                  title={t("Belum ada kandidat silver medalist (lulus seleksi namun belum diangkat)", "No silver medalist candidates yet (passed selection but not appointed)")}
                  description={t(
                    "Kandidat yang lulus seleksi namun belum diangkat akan muncul di sini sebagai talent siap pakai.",
                    "Candidates who passed selection but were not appointed will appear here as ready talent.",
                  )}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800">
                        <th className="py-2 pr-3 font-semibold">{t("Kandidat", "Candidate")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("Sumber", "Source")}</th>
                        <th className="hidden py-2 pr-3 font-semibold md:table-cell">{t("No. Pelamar", "Applicant No.")}</th>
                        <th className="py-2 pr-3 font-semibold">{t("PR / Posisi", "PR / Position")}</th>
                        <th className="hidden py-2 pr-3 font-semibold lg:table-cell">{t("Dinominasikan", "Nominated")}</th>
                        <th className="hidden py-2 font-semibold sm:table-cell">{t("Catatan", "Note")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.silver.rows.map((r) => (
                        <tr key={r.candidateId} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                          <td className="py-2.5 pr-3">
                            <span className="font-semibold">{r.fullName}</span>
                            {r.note && <p className="max-w-[260px] truncate text-[11px] italic text-slate-400" title={r.note}>“{r.note}”</p>}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                              r.source === "Internal"
                                ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85"
                                : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400")}>
                              {r.source === "Internal" ? t("Internal", "Internal") : t("Eksternal", "External")}
                            </span>
                          </td>
                          <td className="hidden py-2.5 pr-3 font-mono text-[11px] md:table-cell">{r.applicantNo ?? "—"}</td>
                          <td className="py-2.5 pr-3">
                            <span className="font-mono text-xs">{r.prNo}</span>
                            {r.positionTitle && <div className="max-w-[160px] truncate text-[11px] text-slate-500 dark:text-slate-400">{r.positionTitle}</div>}
                          </td>
                          <td className="hidden py-2.5 pr-3 text-xs tabular-nums lg:table-cell">{fmtShort(r.nominatedAt)}</td>
                          <td className="hidden max-w-[200px] py-2.5 text-[11px] sm:table-cell">{r.note ? <span className="italic text-slate-400" title={r.note}>{r.note}</span> : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
