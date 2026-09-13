"use client";
// OneVity Payroll — Ringkasan modul: KPI period aktif, payroll terakhir, run berjalan
import { useApi, fmtIDR, fmtDate, fmtIDRShort } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_STATUS_LABEL, PeriodRow, RunRow } from "@/onevity/payroll/components/payroll-types";
import { CalendarRange, PlayCircle, Wallet, Users, BanknoteArrowDown, Receipt, ChevronRight, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";

interface OverviewData {
  periods: PeriodRow[];
  runs: RunRow[];
  activeEmployees: number;
}

export function PayrollOverview() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading } = useApi<OverviewData>("/api/onevity/payroll-periods");
  const runsApi = useApi<{ runs: RunRow[] }>("/api/onevity/payroll-runs");
  const employeesApi = useApi<{ employees: unknown[] }>("/api/onevity/payroll-profiles");

  const periods = data?.periods ?? [];
  const activePeriod = periods.find((p) => p.status === "Open") ?? periods[0];
  const runs = runsApi.data?.runs ?? [];
  const lastPaid = runs.find((r) => r.status === "Paid");
  const drafts = runs.filter((r) => r.status === "Draft" || r.status === "Calculated");
  const profileCount = employeesApi.data?.employees?.length ?? 0;

  const kpi = [
    {
      label: t("Period Aktif", "Active Period"), value: activePeriod ? loc(activePeriod.name) : "—", sub: activePeriod ? `${fmtDate(activePeriod.startDate)} – ${fmtDate(activePeriod.endDate)}` : t("Buat period payroll pertama", "Create the first payroll period"),
      icon: CalendarRange, hero: true,
      onClick: () => navigate("payroll", "periods"),
    },
    {
      label: t("Payroll Terakhir Dibayar", "Last Payroll Paid"), value: lastPaid ? fmtIDRShort(lastPaid.totalNet) : "—", sub: lastPaid ? t("{no} · {n} karyawan", "{no} · {n} employees", { no: lastPaid.runNo, n: lastPaid.employeeCount }) : t("Belum ada run selesai", "No completed runs yet"),
      icon: Wallet,
      onClick: () => navigate("payroll", "runs"),
    },
    {
      label: t("Run Berjalan", "Runs In Progress"), value: String(drafts.length), sub: drafts.length ? t("{d} draft · {c} terhitung", "{d} draft · {c} calculated", { d: drafts.filter((r) => r.status === "Draft").length, c: drafts.filter((r) => r.status === "Calculated").length }) : t("Semua run selesai", "All runs completed"),
      icon: PlayCircle,
      onClick: () => navigate("payroll", "runs"),
    },
    {
      label: t("Karyawan Payroll", "Payroll Employees"), value: String(profileCount), sub: t("Profil pajak & template upah aktif", "Active tax profiles & wage templates"),
      icon: Users,
      onClick: () => navigate("payroll", "profiles"),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Ringkasan Payroll", "Payroll Overview")}
        description={t("Period, proses, hasil, dan parameter pajak — dari master komponen sampai take home pay", "Periods, runs, results, and tax parameters — from component master to take home pay")}
        actions={
          <Button onClick={() => navigate("payroll", "runs")} className="gap-2 font-bold">
            <PlayCircle className="h-4 w-4" /> {t("Proses Payroll")}
          </Button>
        }
      />

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpi.map((k) => {
              const Icon = k.icon;
              return (
                <button key={k.label} onClick={k.onClick} className="group flex items-start gap-3 rounded-2xl border border-stone-200/80 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:ov-border-accent hover:shadow-md dark:border-stone-800 dark:bg-stone-900">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", k.hero ? "ov-fill" : "ov-tile")}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
                    <p className="truncate text-lg font-extrabold text-stone-900 dark:text-stone-50">{k.value}</p>
                    <p className="truncate text-[11px] text-stone-400">{k.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Breakdown payroll terakhir */}
          {lastPaid && (
            <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Payroll Terakhir — {p} ({r})", "Last Payroll — {p} ({r})", { p: loc(lastPaid.period.name), r: lastPaid.runNo })}</p>
                    <p className="text-sm font-bold text-stone-900 dark:text-stone-50">{t("Distribusi {v}", "Distribution {v}", { v: fmtIDR(lastPaid.totalNet) })}</p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("payroll", "run", { id: lastPaid.id })}>
                    {t("Lihat Detail", "View Details")} <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat icon={Receipt} label={t("Bruto", "Gross")} value={fmtIDR(lastPaid.totalBruto)} tone="text-brand dark:text-brand/85" />
                  <MiniStat icon={BanknoteArrowDown} label={t("Potongan", "Deductions")} value={fmtIDR(lastPaid.totalDeduction)} tone="text-rose-600 dark:text-rose-400" />
                  <MiniStat icon={Receipt} label={t("PPh21")} value={fmtIDR(lastPaid.totalTax)} tone="text-brand dark:text-brand/85" />
                  <MiniStat icon={Wallet} label={t("Take Home Pay")} value={fmtIDR(lastPaid.totalNet)} tone="text-brand dark:text-brand/85" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Riwayat run */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
                <p className="text-[13px] font-bold">{t("Riwayat Proses Payroll", "Payroll Run History")}</p>
                <Button variant="ghost" size="sm" className="ov-text-accent gap-1 text-xs font-bold hover:ov-text-accent" onClick={() => navigate("payroll", "runs")}>
                  {t("Semua run", "All runs")} <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {runs.length === 0 ? (
                <div className="p-5"><EmptyState title={t("Belum ada proses payroll", "No payroll runs yet")} description={t("Buat period dan proses run payroll pertama Anda.", "Create a period and run your first payroll.")} icon={<Coins className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Run")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Period")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Jenis")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Karyawan")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("THP", "Net Pay")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.slice(0, 6).map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => navigate("payroll", "run", { id: r.id })}>
                          <TableCell className="font-mono text-[11px] font-bold text-stone-500">{r.runNo}</TableCell>
                          <TableCell className="text-[13px] font-semibold">{loc(r.period.name)}</TableCell>
                          <TableCell className="text-xs text-stone-500">{r.processType.name}</TableCell>
                          <TableCell><StatusPill status={r.status} /></TableCell>
                          <TableCell className="text-right text-xs font-semibold">{r.employeeCount}</TableCell>
                          <TableCell className="text-right text-xs font-bold ov-text-accent">{r.status === "Draft" ? "—" : fmtIDR(r.totalNet)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-stone-200/70 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-900/40">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
      </div>
      <p className={`mt-1 text-sm font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}
