"use client";
// OneVity Travel — Ringkasan: KPI modul + alur 4 langkah + kartu formula settlement
import { useApi } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Plane, Inbox, CheckCircle2, Wallet, FileText, TrendingUp,
  ArrowRight, Calculator, Landmark, AlertTriangle,
} from "lucide-react";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { TravelStatsUI, BudgetRowUI, fmtIDRShort } from "./travel-types";
import { cn } from "@/lib/utils";

export function TravelOverview() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, loading } = useApi<{ stats: TravelStatsUI; budgets: BudgetRowUI[] }>("/api/onevity/travel/overview");
  const s = data?.stats;

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
      sub: s ? t("{n} klaim · {m} dibayar via payroll", "{n} claims · {m} paid via payroll", { n: s.claimsYtd, m: s.paidCount }) : undefined,
      icon: FileText,
      onClick: () => navigate("travel", "travel-claim"),
    },
    {
      label: s?.budgetYear ? t("Budget {y} Terpakai", "Budget {y} Used", { y: s.budgetYear }) : t("Budget Terpakai", "Budget Used"),
      value: s ? (s.budgetTotal > 0 ? `${Math.round((s.budgetUsed / s.budgetTotal) * 100)}%` : "—") : "—",
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
  const budgetPct = budget && budget.totalBudget > 0 ? Math.min(100, (budget.used / budget.totalBudget) * 100) : 0;
  const overBudget = budget ? budget.used > budget.totalBudget && budget.totalBudget > 0 : false;

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
                className="cursor-pointer border-stone-200 bg-white/80 shadow-sm transition-all hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80"
                onClick={k.onClick}
              >
                <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{k.label}</p>
                    <p className="mt-1 truncate text-2xl font-black text-stone-900 dark:text-stone-100">{k.value}</p>
                    {k.sub && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{k.sub}</p>}
                  </div>
                  <div className={cn("rounded-xl p-2.5", k.hero ? "ov-fill" : "ov-tile")}>
                    <k.icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {s && s.advanceOutstanding > 0 && (
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

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80 lg:col-span-3">
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
                    className="flex w-full items-start gap-3 rounded-xl border border-stone-200 bg-white p-3 text-left transition-all hover:ov-border-accent dark:border-stone-800 dark:bg-stone-900"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-fill text-sm font-black">
                      {st.n}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 font-bold text-stone-900 dark:text-stone-100">
                        {st.title}
                        <ArrowRight className="h-3 w-3 text-stone-400" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-stone-500 dark:text-stone-400">{st.desc}</span>
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-4 lg:col-span-2">
              <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <Calculator className="h-4 w-4 ov-text-accent" /> {t("Formula Settlement")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">{t("(a) Biaya pihak lain (kontra) + rugi kurs", "(a) Third-party costs (contra) + exchange loss")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">{t("(b) Dibayar ke karyawan", "(b) Paid to employee")}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">{t("(c) Kembali ke perusahaan", "(c) Returned to company")}</span>
                  </div>
                  <div className="rounded-lg border-2 ov-border-accent ov-soft px-3 py-2 text-center font-black">
                    {t("Total = Rincian + Rugi kurs − (a)", "Total = Expenses + Exchange loss − (a)")}
                  </div>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    {t("Uang muka (advance) mengurangi (b) atau menambah (c) saat klaim dibuat; biaya pihak lain tidak dibayar ke karyawan — padanan", "The advance reduces (b) or adds to (c) when the claim is created; third-party costs are not paid to the employee — equivalent to")}
                    <span className="font-semibold"> Travel &amp; Entertainment Settlement </span>
                    {t("dengan status akhir Transferred → Paid via payroll.", "with final status Transferred → Paid via payroll.")}
                  </p>
                </CardContent>
              </Card>

              {budget && (
                <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base font-bold">
                      <Wallet className="h-4 w-4 ov-text-accent" /> Budget {budget.year}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(budget.used)}</span>
                      <span className="text-xs text-stone-500 dark:text-stone-400">{t("dari {total}", "of {total}", { total: fmtIDRShort(budget.totalBudget) })}</span>
                    </div>
                    <Progress value={budgetPct} className="h-2 [&>div]:ov-bar" />
                    {overBudget && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> {t("Terpakai melebihi budget — perilaku standar: warning, klaim tetap diproses", "Usage exceeds budget — standard behavior: warning, claims still processed")}
                      </p>
                    )}
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {t("{n} klaim dalam periode · sisa {sisa} · {m} cost center", "{n} claims in period · {sisa} remaining · {m} cost centers", { n: budget.claimCount, sisa: fmtIDRShort(Math.max(0, budget.remaining)), m: budget.items.length })}
                    </p>
                  </CardContent>
                </Card>
              )}

              {s && s.topExpenseKinds.length > 0 && (
                <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">{t("Komposisi Biaya Tahun Ini", "Expense Composition This Year")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {s.topExpenseKinds.slice(0, 4).map((k) => {
                      const max = s.topExpenseKinds[0]?.amount || 1;
                      return (
                        <div key={k.kind}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-stone-700 dark:text-stone-300">{k.kind}</span>
                            <span className="text-stone-500 dark:text-stone-400">{fmtIDRShort(k.amount)}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                            <div className="h-full rounded-full ov-bar" style={{ width: `${(k.amount / max) * 100}%` }} />
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
