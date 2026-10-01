"use client";
// RekanKerja Payroll — Ringkasan modul: KPI period aktif, payroll terakhir, run berjalan
import { useApi, fmtIDR, fmtDate, fmtIDRShort } from "@/lib/rekankerja/api";
import { useNav } from "@/lib/rekankerja/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RUN_STATUS_LABEL, PeriodRow, RunRow } from "@/components/rekankerja/payroll/payroll-types";
import { CalendarRange, PlayCircle, Wallet, Users, BanknoteArrowDown, Receipt, ChevronRight, Coins } from "lucide-react";

interface OverviewData {
  periods: PeriodRow[];
  runs: RunRow[];
  activeEmployees: number;
}

export function PayrollOverview() {
  const { navigate } = useNav();
  const { data, loading } = useApi<OverviewData>("/api/rekankerja/payroll-periods");
  const runsApi = useApi<{ runs: RunRow[] }>("/api/rekankerja/payroll-runs");
  const employeesApi = useApi<{ employees: unknown[] }>("/api/rekankerja/payroll-profiles");

  const periods = data?.periods ?? [];
  const activePeriod = periods.find((p) => p.status === "Open") ?? periods[0];
  const runs = runsApi.data?.runs ?? [];
  const lastPaid = runs.find((r) => r.status === "Paid");
  const drafts = runs.filter((r) => r.status === "Draft" || r.status === "Calculated");
  const profileCount = employeesApi.data?.employees?.length ?? 0;

  const kpi = [
    {
      label: "Period Aktif", value: activePeriod?.name ?? "—", sub: activePeriod ? `${fmtDate(activePeriod.startDate)} – ${fmtDate(activePeriod.endDate)}` : "Buat period payroll pertama",
      icon: CalendarRange, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
      onClick: () => navigate("payroll", "periods"),
    },
    {
      label: "Payroll Terakhir Dibayar", value: lastPaid ? fmtIDRShort(lastPaid.totalNet) : "—", sub: lastPaid ? `${lastPaid.runNo} · ${lastPaid.employeeCount} karyawan` : "Belum ada run selesai",
      icon: Wallet, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
      onClick: () => navigate("payroll", "runs"),
    },
    {
      label: "Run Berjalan", value: String(drafts.length), sub: drafts.length ? `${drafts.filter((r) => r.status === "Draft").length} draft · ${drafts.filter((r) => r.status === "Calculated").length} terhitung` : "Semua run selesai",
      icon: PlayCircle, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
      onClick: () => navigate("payroll", "runs"),
    },
    {
      label: "Karyawan Payroll", value: String(profileCount), sub: "Profil pajak & template upah aktif",
      icon: Users, tone: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
      onClick: () => navigate("payroll", "profiles"),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Ringkasan Payroll"
        description="Period, proses, hasil, dan parameter pajak — dari master komponen sampai take home pay"
        actions={
          <Button onClick={() => navigate("payroll", "runs")} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <PlayCircle className="h-4 w-4" /> Proses Payroll
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
                <button key={k.label} onClick={k.onClick} className="group flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-600/40">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${k.tone}`}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
                    <p className="truncate text-lg font-extrabold text-slate-900 dark:text-slate-50">{k.value}</p>
                    <p className="truncate text-[11px] text-slate-400">{k.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Breakdown payroll terakhir */}
          {lastPaid && (
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Payroll Terakhir — {lastPaid.period.name} ({lastPaid.runNo})</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">Distribusi {fmtIDR(lastPaid.totalNet)}</p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("payroll", "run", { id: lastPaid.id })}>
                    Lihat Detail <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <MiniStat icon={Receipt} label="Bruto" value={fmtIDR(lastPaid.totalBruto)} tone="text-emerald-600 dark:text-emerald-400" />
                  <MiniStat icon={BanknoteArrowDown} label="Potongan" value={fmtIDR(lastPaid.totalDeduction)} tone="text-rose-600 dark:text-rose-400" />
                  <MiniStat icon={Receipt} label="PPh21" value={fmtIDR(lastPaid.totalTax)} tone="text-amber-600 dark:text-amber-400" />
                  <MiniStat icon={Wallet} label="Take Home Pay" value={fmtIDR(lastPaid.totalNet)} tone="text-teal-600 dark:text-teal-400" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Riwayat run */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                <p className="text-[13px] font-bold">Riwayat Proses Payroll</p>
                <Button variant="ghost" size="sm" className="gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400" onClick={() => navigate("payroll", "runs")}>
                  Semua run <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {runs.length === 0 ? (
                <div className="p-5"><EmptyState title="Belum ada proses payroll" description="Buat period dan proses run payroll pertama Anda." icon={<Coins className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">Run</TableHead>
                        <TableHead className="text-[11px] font-bold">Period</TableHead>
                        <TableHead className="text-[11px] font-bold">Jenis</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">THP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.slice(0, 6).map((r) => (
                        <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => navigate("payroll", "run", { id: r.id })}>
                          <TableCell className="font-mono text-[11px] font-bold text-slate-500">{r.runNo}</TableCell>
                          <TableCell className="text-[13px] font-semibold">{r.period.name}</TableCell>
                          <TableCell className="text-xs text-slate-500">{r.processType.name}</TableCell>
                          <TableCell><StatusPill status={r.status} /></TableCell>
                          <TableCell className="text-right text-xs font-semibold">{r.employeeCount}</TableCell>
                          <TableCell className="text-right text-xs font-bold text-emerald-700 dark:text-emerald-400">{r.status === "Draft" ? "—" : fmtIDR(r.totalNet)}</TableCell>
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
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-1.5">
        <Icon className={`h-3.5 w-3.5 ${tone}`} />
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className={`mt-1 text-sm font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}
