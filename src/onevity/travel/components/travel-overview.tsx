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
import { TravelStatsUI, BudgetRowUI, fmtIDRShort } from "./travel-types";
import { cn } from "@/lib/utils";

export function TravelOverview() {
  const { navigate } = useNav();
  const { data, loading } = useApi<{ stats: TravelStatsUI; budgets: BudgetRowUI[] }>("/api/onevity/travel/overview");
  const s = data?.stats;

  const kpi = [
    {
      label: "Menunggu Persetujuan", value: s ? String(s.pendingRequestApprovals + s.pendingClaimApprovals) : "—",
      sub: s ? `${s.pendingRequestApprovals} permintaan · ${s.pendingClaimApprovals} klaim` : undefined,
      icon: Inbox, hero: true,
      onClick: () => navigate("travel", "travel-approval"),
    },
    {
      label: "Permintaan Bulan Ini", value: s ? String(s.requestsThisMonth) : "—",
      sub: s ? `${s.requestsApprovedYtd} disetujui tahun ini` : undefined,
      icon: Plane,
      onClick: () => navigate("travel", "travel-request"),
    },
    {
      label: "Klaim Tahun Ini", value: s ? fmtIDRShort(s.claimsYtdAmount) : "—",
      sub: s ? `${s.claimsYtd} klaim · ${s.paidCount} dibayar via payroll` : undefined,
      icon: FileText,
      onClick: () => navigate("travel", "travel-claim"),
    },
    {
      label: s?.budgetYear ? `Budget ${s.budgetYear} Terpakai` : "Budget Terpakai",
      value: s ? (s.budgetTotal > 0 ? `${Math.round((s.budgetUsed / s.budgetTotal) * 100)}%` : "—") : "—",
      sub: s ? `${fmtIDRShort(s.budgetUsed)} dari ${fmtIDRShort(s.budgetTotal)}` : undefined,
      icon: Wallet,
      onClick: () => navigate("travel", "travel-budget"),
    },
  ];

  const steps = [
    { n: 1, title: "Permintaan Travel", desc: "Pengajuan perjalanan dinas — destinasi multi-kaki (kota, zona, luar negeri) + uang muka (cash advance)", icon: Plane, view: "travel-request" },
    { n: 2, title: "Persetujuan", desc: "Approve / Reject / Cancel permintaan & klaim — jatuh tempo settlement otomatis dari template (14 hari)", icon: CheckCircle2, view: "travel-approval" },
    { n: 3, title: "Klaim & Settlement", desc: "Rincian biaya per jenis (General / Allowance / Mileage / Entertainment + tamu) — formula (a)+(b)−(c)", icon: FileText, view: "travel-claim" },
    { n: 4, title: "Jurnal & Payroll", desc: "Approve → jurnal otomatis (akun per jenis biaya) → Transfer → komponen UTRP/TRVSTLIN masuk payslip → Dibayar", icon: Landmark, view: "travel-claim-approval" },
  ];

  const budget = data?.budgets?.[0];
  const budgetPct = budget && budget.totalBudget > 0 ? Math.min(100, (budget.used / budget.totalBudget) * 100) : 0;
  const overBudget = budget ? budget.used > budget.totalBudget && budget.totalBudget > 0 : false;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Ringkasan Perjalanan Dinas"
        description="Permintaan, uang muka, klaim & settlement perjalanan dinas — budget per cost center, jurnal akuntansi, dan pembayaran via payroll (padanan Travel Administration)"
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

          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80 lg:col-span-3">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 ov-text-accent" /> Alur Perjalanan Dinas
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
                    <Calculator className="h-4 w-4 ov-text-accent" /> Formula Settlement
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">(a) Biaya pihak lain + rugi kurs</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">(b) Dibayar ke karyawan</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60">
                    <span className="text-stone-600 dark:text-stone-300">(c) Kembali ke perusahaan</span>
                  </div>
                  <div className="rounded-lg border-2 ov-border-accent ov-soft px-3 py-2 text-center font-black">
                    Total = (a) + (b) − (c)
                  </div>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    Uang muka (advance) mengurangi (b) atau menambah (c) saat klaim dibuat — padanan
                    <span className="font-semibold"> Travel &amp; Entertainment Settlement </span>
                    dengan status akhir Transferred → Paid via payroll.
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
                      <span className="text-xs text-stone-500 dark:text-stone-400">dari {fmtIDRShort(budget.totalBudget)}</span>
                    </div>
                    <Progress value={budgetPct} className="h-2 [&>div]:ov-bar" />
                    {overBudget && (
                      <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-400">
                        <AlertTriangle className="h-3.5 w-3.5" /> Terpakai melebihi budget — perilaku standar: warning, klaim tetap diproses
                      </p>
                    )}
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {budget.claimCount} klaim dalam periode · sisa {fmtIDRShort(Math.max(0, budget.remaining))} · {budget.items.length} cost center
                    </p>
                  </CardContent>
                </Card>
              )}

              {s && s.topExpenseKinds.length > 0 && (
                <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-bold">Komposisi Biaya Tahun Ini</CardTitle>
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
