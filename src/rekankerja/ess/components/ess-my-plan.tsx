"use client";
// RekanKerja ESS F5 — Rencana Rekrutmen Perusahaan (padanan oranHR §2.10
// MysRecruitmentPlanning): baris plan berstatus Applied yang dipublikasikan
// HR — formula a–h ringkas + rekonsiliasi PR, TANPA anggaran gaji
// (salaryBudget disembunyikan di ESS by design).
import { useApi, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Calculator, Sigma, Target } from "lucide-react";
import { ESS_BASE } from "./ess-api";

// ---------- tipe (mirror kontrak GET /ess/my-plan) ----------

interface MyPlanRow {
  id: string;
  period: string;
  seqNo: number;
  positionTitle: string;
  officeName: string | null;
  targetA: number;
  adjustB: number;
  totalC: number;
  empD: number;
  inE: number;
  outF: number;
  resultedG: number;
  toRecruitH: number;
  basePeriod: string | null;
  note: string | null;
  appliedAt: string | null;
  recon: { requested: number; fulfilled: number; unfulfilled: number; prCount: number };
}

interface MyPlanResp {
  rows: MyPlanRow[];
  stats: { applied: number; periods: string[] };
}

/** sel formula a–h (kompak — mobile-first). */
function FormulaCell({ label, labelEn, value, strong }: { label: string; labelEn: string; value: number; strong?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cn(
      "rounded-xl border px-2.5 py-2 text-center",
      strong
        ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10"
        : "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40",
    )}>
      <p className={cn("text-[10px] font-semibold leading-tight", strong ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400")}>{t(label, labelEn)}</p>
      <p className={cn("text-lg font-bold tabular-nums", strong ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-slate-50")}>{value}</p>
    </div>
  );
}

export function EssMyPlanPage() {
  const { t } = useI18n();
  const api = useApi<MyPlanResp>(`${ESS_BASE}/my-plan`, []);

  const rows = api.data?.rows ?? [];
  const periods = api.data?.stats.periods ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={t("ESS · Rekrutmen")}
        title={t("Rencana Rekrutmen Perusahaan", "Company Recruitment Plan")}
        description={t(
          "Rencana kebutuhan karyawan per periode yang dipublikasikan HR — padanan My Recruitment Planning oranHR (formula a–h, tanpa anggaran gaji).",
          "Per-period headcount plans published by HR — the oranHR My Recruitment Planning equivalent (a–h formula, without salary budget).",
        )}
      />

      {api.loading && !api.data ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4"><LoadingRows rows={4} /></CardContent>
        </Card>
      ) : api.error ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4">
            <EmptyState title={t("Gagal memuat rencana rekrutmen", "Failed to load the recruitment plan")} description={api.error} />
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4">
            <EmptyState
              icon={Calculator}
              title={t("Belum ada rencana rekrutmen yang dipublikasikan", "No recruitment plans published yet")}
              description={t(
                "Rencana HR yang sudah diterapkan (Applied) akan tampil di sini.",
                "HR plans that have been applied will appear here.",
              )}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* chip periode */}
          {periods.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t("Periode:", "Periods:")}</span>
              {periods.map((p) => (
                <span key={p} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  {p}
                </span>
              ))}
            </div>
          )}

          {/* baris plan */}
          {rows.map((r) => (
            <Card key={r.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-4 sm:p-5">
                {/* header */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                      #{r.seqNo} · {r.period}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> Applied
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">{t("diterapkan", "applied")} {fmtDate(r.appliedAt)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Target className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{r.positionTitle}</span>
                </div>
                {r.officeName && <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{r.officeName}</p>}
                {r.note && <p className="mt-1 text-[11.5px] italic text-slate-400">{r.note}</p>}

                {/* formula a–h */}
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                  <FormulaCell label="(a) Target" labelEn="(a) Target" value={r.targetA} />
                  <FormulaCell label="(b) Adj" labelEn="(b) Adj" value={r.adjustB} />
                  <FormulaCell label="(c) Total" labelEn="(c) Total" value={r.totalC} />
                  <FormulaCell label="(d) Awal" labelEn="(d) Start" value={r.empD} />
                  <FormulaCell label="(e) Masuk" labelEn="(e) In" value={r.inE} />
                  <FormulaCell label="(f) Keluar" labelEn="(f) Out" value={r.outF} />
                  <FormulaCell label="(g) Hasil" labelEn="(g) Result" value={r.resultedG} />
                  <FormulaCell label="(h) Rekrut" labelEn="(h) Recruit" value={r.toRecruitH} strong />
                </div>
                <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-slate-400">
                  <Sigma className="h-3 w-3" aria-hidden /> c=(a)+(b) · g=(d)+(e)−(f) · h=(c)−(g)
                </p>

                {/* rekonsiliasi PR */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t("Rekonsiliasi PR:", "PR reconciliation:")}</span>
                  <span className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums",
                    r.recon.unfulfilled > 0
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                      : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300",
                  )}>
                    {t("diajukan {n}", "requested {n}", { n: String(r.recon.requested) })}
                  </span>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                    {t("terpenuhi {n}", "fulfilled {n}", { n: String(r.recon.fulfilled) })}
                  </span>
                  {r.recon.unfulfilled > 0 && (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                      {t("belum {n}", "unfulfilled {n}", { n: String(r.recon.unfulfilled) })}
                    </span>
                  )}
                  <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t("PR {n}", "PR {n}", { n: String(r.recon.prCount) })}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
