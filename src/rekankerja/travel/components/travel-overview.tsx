"use client";
// RekanKerja Travel — Ringkasan: KPI modul + alur 4 langkah + kartu formula settlement
// Task 98: kolom uang null-safe (Brankas Uang) + bagian ANALYTICS PINTAR (F2-5):
// tren settlement 6 bulan, compliance rate, aging approval, top traveler,
// burn-rate budget vs waktu berjalan.
import { useApi } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, LoadingCards } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Plane, Inbox, CheckCircle2, Wallet, FileText, TrendingUp,
  ArrowRight, Calculator, Landmark, AlertTriangle, Clock, Users, Gauge, BarChart3,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { TravelStatsUI, BudgetRowUI, TravelAnalyticsUI, EXPENSE_KIND_LABEL, EXPENSE_KIND_LABEL_EN, fmtIDRShort } from "./travel-types";
import { cn } from "@/lib/utils";

export function TravelOverview() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, loading } = useApi<{ stats: TravelStatsUI; budgets: BudgetRowUI[]; analytics: TravelAnalyticsUI }>("/api/rekankerja/travel/overview");
  const s = data?.stats;
  const an = data?.analytics;

  const kpi = [
    {
      label: t("Menunggu Persetujuan"), value: s ? String(s.pendingRequestApprovals + s.pendingClaimApprovals) : "—",
      sub: s ? t("{n} permintaan · {m} klaim", "{n} requests · {m} claims", { n: s.pendingRequestApprovals, m: s.pendingClaimApprovals }) : undefined,
      icon: Inbox, hero: true,
      onClick: () => navigate("travel", "travel-approval"),
    },
    {
      label: t("Permintaan Bulan Ini", "Requests This Month"), value: s ? String(s.requestsThisMonth) : "—",
      sub: s ? t("{n} disetujui tahun ini", "{n} approved year to date", { n: s.requestsApprovedYtd }) : undefined,
      icon: Plane,
      onClick: () => navigate("travel", "travel-request"),
    },
    {
      label: t("Klaim Tahun Ini", "Claims This Year"), value: s ? fmtIDRShort(s.claimsYtdAmount) : "—",
      sub: s ? t("{n} klaim realisasi · {m} dibayar via payroll", "{n} realized claims · {m} paid via payroll", { n: s.claimsYtd, m: s.paidCount }) : undefined,
      icon: FileText,
      onClick: () => navigate("travel", "travel-claim"),
    },
    {
      label: s?.budgetYear ? t("Budget {y} Terpakai", "Budget {y} Used", { y: s.budgetYear }) : t("Budget Terpakai", "Budget Used"),
      value: s && s.budgetTotal != null && s.budgetTotal > 0 && s.budgetUsed != null ? `${Math.round((s.budgetUsed / s.budgetTotal) * 100)}%` : "—",
      sub: s ? t("{used} dari {total}", "{used} of {total}", { used: fmtIDRShort(s.budgetUsed), total: fmtIDRShort(s.budgetTotal) }) : undefined,
      icon: Wallet,
      onClick: () => navigate("travel", "travel-budget"),
    },
  ];

  const steps = [
    { n: 1, title: t("Permintaan Travel"), desc: t("Pengajuan perjalanan dinas — destinasi multi-kaki (kota, zona, luar negeri) + uang muka (cash advance)", "Business trip requests — multi-leg destinations (city, zone, overseas) + cash advance"), icon: Plane, view: "travel-request" },
    { n: 2, title: t("Persetujuan"), desc: t("Approve / Reject / Cancel permintaan & klaim — jatuh tempo settlement otomatis dari template (14 hari)", "Approve / Reject / Cancel requests & claims — settlement due date automatic from template (14 days)"), icon: CheckCircle2, view: "travel-approval" },
    { n: 3, title: t("Klaim & Settlement"), desc: t("Rincian biaya per jenis (General / Allowance / Mileage / Entertainment + tamu) — formula Total = rincian + rugi kurs − (a)", "Expense details per type (General / Allowance / Mileage / Entertainment + guests) — formula Total = expenses + exchange loss − (a)"), icon: FileText, view: "travel-claim" },
    { n: 4, title: t("Jurnal & Payroll", "Journal & Payroll"), desc: t("Approve → jurnal otomatis (akun per jenis biaya) → Transfer → komponen UTRP/TRVSTLIN masuk payslip → Dibayar", "Approve → automatic journal (accounts per expense type) → Transfer → UTRP/TRVSTLIN components on the payslip → Paid"), icon: Landmark, view: "travel-claim-approval" },
  ];

  const budget = data?.budgets?.[0];
  const budgetPct = budget && budget.totalBudget != null && budget.totalBudget > 0 && budget.used != null ? Math.min(100, (budget.used / budget.totalBudget) * 100) : 0;
  const overBudget = budget && budget.totalBudget != null && budget.used != null ? budget.used > budget.totalBudget && budget.totalBudget > 0 : false;
  const maxMonthly = an ? Math.max(1, ...an.monthly.map((m) => m.amount)) : 1;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Ringkasan Perjalanan Dinas", "Business Travel Overview")}
        description={t("Permintaan, uang muka, klaim & settlement perjalanan dinas — budget per cost center, jurnal akuntansi, dan pembayaran via payroll (padanan Travel Administration)", "Travel requests, advances, claims & settlement — budget per cost center, accounting journal, and payment via payroll (Travel Administration equivalent)")}
      />

      {loading && !data ? (
        <LoadingCards cards={4} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpi.map((k) => (
              <Card
                key={k.label}
                className="cursor-pointer border-slate-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80"
                onClick={k.onClick}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{k.label}</p>
                    <p className="mt-1 truncate text-2xl font-black text-slate-900 dark:text-slate-100">{k.value}</p>
                    {k.sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{k.sub}</p>}
                  </div>
                  <div className={cn("rounded-xl p-2.5", k.hero ? "ov-fill" : "ov-tile")}>
                    <k.icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {s && (s.advanceOutstanding ?? 0) > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/20">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-400">
                <Wallet className="h-4 w-4" /> {t("Uang muka beredar (belum lunas)", "Outstanding advances (unsettled)")}
              </p>
              <p className="text-sm font-black text-amber-800 dark:text-amber-400">
                {fmtIDRShort(s.advanceOutstanding)}
                <span className="ml-2 font-normal text-amber-700/80 dark:text-amber-400/80">{t("— klaim Paid = lunas; dikurangi (b)/dipotong (c) di settlement", "— Paid claim = settled; netted via (b)/(c) at settlement")}</span>
              </p>
            </div>
          )}

          {an && (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {/* F2-5 — tren settlement 6 bulan */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <BarChart3 className="h-4 w-4 ov-text-accent" /> {t("Tren Settlement 6 Bulan", "6-Month Settlement Trend")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex h-32 items-end gap-1.5">
                  {an.monthly.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.label}: ${fmtIDRShort(m.amount)} · ${m.claims} klaim`}>
                      <div
                        className="w-full rounded-t ov-bar transition-all"
                        style={{ height: `${Math.max(3, (m.amount / maxMonthly) * 88)}px` }}
                      />
                      <span className="text-[9px] font-bold text-slate-400">{m.label}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* F2-5 — compliance rate kebijakan */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Gauge className="h-4 w-4 ov-text-accent" /> {t("Kepatuhan Plafon (YTD)", "Policy Compliance (YTD)")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-black text-slate-900 dark:text-slate-100">
                    {an.complianceRate != null ? `${an.complianceRate}%` : "—"}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {an.totalLines > 0
                      ? t("{ok} dari {n} baris biaya dalam plafon per unit · {over} lewat", "{ok} of {n} expense lines within per-unit limits · {over} over", { ok: an.totalLines - an.overLimitLines, n: an.totalLines, over: an.overLimitLines })
                      : t("Belum ada baris biaya realisasi tahun ini", "No realized expense lines this year")}
                  </p>
                  <p className="mt-1.5 text-[11px] text-slate-400">{t("Rata-rata settlement per trip: {amt}", "Average settlement per trip: {amt}", { amt: an.avgSettlement != null ? fmtIDRShort(an.avgSettlement) : "—" })}</p>
                </CardContent>
              </Card>

              {/* F2-5 — aging approval */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Clock className="h-4 w-4 ov-text-accent" /> {t("Klaim Menunggu > 3 Hari", "Claims Pending > 3 Days")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {an.agingPendingClaims.length === 0 ? (
                    <p className="text-[12px] text-slate-400">{t("Tidak ada klaim mengganjal — SLA sehat", "No stuck claims — SLA healthy")}</p>
                  ) : (
                    an.agingPendingClaims.slice(0, 3).map((c) => (
                      <div key={c.docNo} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{c.docNo}</span>
                        <span className="truncate text-slate-500">{c.fullName}</span>
                        <Badge className="shrink-0 bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{c.days} {t("hari", "days")}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* F2-5 — top traveler + burn-rate */}
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <Users className="h-4 w-4 ov-text-accent" /> {t("Top Traveler YTD", "Top Travelers YTD")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {an.topTravelers.length === 0 ? (
                    <p className="text-[12px] text-slate-400">{t("Belum ada realisasi tahun ini", "No realized trips this year")}</p>
                  ) : (
                    an.topTravelers.slice(0, 3).map((tr, i) => (
                      <div key={tr.employeeNo} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full ov-fill text-[9px] font-black">{i + 1}</span>
                          <span className="truncate font-semibold text-slate-700 dark:text-slate-300">{tr.fullName}</span>
                        </span>
                        <span className="shrink-0 text-slate-500">{fmtIDRShort(tr.amount)} · {tr.claims}×</span>
                      </div>
                    ))
                  )}
                  {an.burnRate.usedPct != null && (
                    <p className="mt-1 border-t border-dashed border-slate-200 pt-1.5 text-[10px] leading-relaxed text-slate-500 dark:border-slate-700">
                      {t("Burn-rate: {u}% budget terpakai vs {e}% waktu berjalan", "Burn rate: {u}% of budget used vs {e}% of the year elapsed", { u: an.burnRate.usedPct, e: an.burnRate.elapsedPct ?? 0 })}
                      {(an.burnRate.usedPct ?? 0) > (an.burnRate.elapsedPct ?? 0) + 15 ? ` · ${t("lebih cepat dari waktu — waspadai", "ahead of pace — watch out")}` : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 ov-text-accent" /> {t("Alur Perjalanan Dinas", "Business Travel Flow")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {steps.map((st) => (
                  <button
                    key={st.n}
                    onClick={() => navigate("travel", st.view)}
                    className="flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-fill text-sm font-black">
                      {st.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                        {st.title}
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{st.desc}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <Calculator className="h-4 w-4 ov-text-accent" /> {t("Formula Settlement")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300">{t("(a) Biaya pihak lain (kontra) + rugi kurs", "(a) Third-party costs (contra) + exchange loss")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300">{t("(b) Dibayar ke karyawan", "(b) Paid to employee")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className="text-slate-600 dark:text-slate-300">{t("(c) Kembali ke perusahaan", "(c) Returned to company")}</span>
                  </div>
                  <div className="rounded-lg border-2 ov-border-accent ov-soft px-3 py-2 text-center font-black">
                    {t("Total = Rincian + Rugi kurs − (a)", "Total = Expenses + Exchange loss − (a)")}
                  </div>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("Uang muka (advance) mengurangi (b) atau menambah (c) saat klaim dibuat; biaya pihak lain tidak dibayar ke karyawan — padanan", "The advance reduces (b) or adds to (c) when the claim is created; third-party costs are not paid to the employee — equivalent to")}
                    <span className="font-semibold"> Travel &amp; Entertainment Settlement </span>
                    {t("dengan status akhir Transferred → Paid via payroll.", "with final status Transferred → Paid via payroll.")}
                  </p>
                </CardContent>
              </Card>

              {budget && (
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-bold">
                      <Wallet className="h-4 w-4 ov-text-accent" /> Budget {budget.year}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{fmtIDRShort(budget.used)}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t("dari {total}", "of {total}", { total: fmtIDRShort(budget.totalBudget) })}</span>
                    </div>
                    <Progress value={budgetPct} className="h-2 [&>div]:ov-bar" />
                    {overBudget && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> {t("Terpakai melebihi budget — perilaku standar: warning, klaim tetap diproses", "Usage exceeds budget — standard behavior: warning, claims still processed")}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t("{n} klaim dalam periode · sisa {sisa} · {m} cost center", "{n} claims in period · {sisa} remaining · {m} cost centers", { n: budget.claimCount, sisa: budget.remaining != null ? fmtIDRShort(Math.max(0, budget.remaining)) : "—", m: budget.items.length })}
                    </p>
                  </CardContent>
                </Card>
              )}

              {s && s.topExpenseKinds.length > 0 && (
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">{t("Komposisi Biaya Tahun Ini", "Expense Composition This Year")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {s.topExpenseKinds.slice(0, 4).map((k) => {
                      const max = s.topExpenseKinds[0]?.amount || 1;
                      return (
                        <div key={k.kind}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{t(EXPENSE_KIND_LABEL[k.kind] ?? k.kind, EXPENSE_KIND_LABEL_EN[k.kind] ?? k.kind)}</span>
                            <span className="text-slate-500 dark:text-slate-400">{fmtIDRShort(k.amount)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className="h-full rounded-full ov-bar" style={{ width: `${((k.amount ?? 0) / max) * 100}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
