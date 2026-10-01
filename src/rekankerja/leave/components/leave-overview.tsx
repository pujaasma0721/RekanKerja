"use client";
// RekanKerja Leave — Ringkasan: KPI modul cuti + alur kerja 4 langkah
import { useApi } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { apiSend } from "@/rekankerja/shared/lib/api";
import {
  Palmtree, Inbox, CheckCircle2, Users, Wallet, CalendarDays,
  TrendingUp, Sparkles, ArrowRight, CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

interface LeaveStats {
  year: number; activeEmployees: number; types: number;
  pendingRequests: number; pendingEnc: number; massLeaves: number;
  onLeaveToday: number; upcoming30: number; approvedThisYear: number; encTransferred: number;
  avgAnnualRemaining: number;
}

export function LeaveOverview() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<LeaveStats>("/api/rekankerja/leave/overview");

  const kpi = [
    {
      label: t("Menunggu Approval", "Pending Approvals"), value: data ? String(data.pendingRequests) : "—",
      sub: data ? t("{n} encashment · {m} sedang cuti hari ini", "{n} encashment · {m} on leave today", { n: data.pendingEnc, m: data.onLeaveToday }) : undefined,
      icon: Inbox, hero: true,
      onClick: () => navigate("leave", "leave-approval"),
    },
    {
      label: t("Rata-rata Saldo Cuti Tahunan", "Average Annual Leave Balance"), value: data ? t("{n} hari", "{n} days", { n: data.avgAnnualRemaining }) : "—",
      sub: data ? t("dari {n} karyawan aktif", "of {n} active employees", { n: data.activeEmployees }) : undefined,
      icon: Palmtree,
      onClick: () => navigate("leave", "leave-info"),
    },
    {
      label: t("Cuti 30 Hari ke Depan", "Leave in the Next 30 Days"), value: data ? String(data.upcoming30) : "—",
      sub: data ? t("{n} permintaan disetujui {y}", "{n} requests approved in {y}", { n: data.approvedThisYear, y: data.year }) : undefined,
      icon: CalendarDays,
      onClick: () => navigate("leave", "leave-reports"),
    },
    {
      label: t("Baris Cuti Massal", "Mass Leave Rows"), value: data ? String(data.massLeaves) : "—",
      sub: data ? t("{n} encashment masuk payroll", "{n} encashments transferred to payroll", { n: data.encTransferred }) : undefined,
      icon: Users,
      onClick: () => navigate("leave", "leave-mass"),
    },
  ];

  const generateThisYear = async () => {
    const year = new Date().getFullYear();
    try {
      const res = await apiSend<{ rows: number; updated: number; carryTotal: number; employees: number; types: number }>(
        "/api/rekankerja/leave/balances", "POST", { year },
      );
      toast.success(t(
        "Generate {y}: {r} saldo baru ({e} karyawan × {tp} jenis), carry-over {c} hari",
        "Generate {y}: {r} new balances ({e} employees × {tp} types), carry-over {c} days",
        { y: year, r: res.rows, e: res.employees, tp: res.types, c: res.carryTotal },
      ));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal generate saldo", "Failed to generate balances"));
    }
  };

  const steps = [
    { n: 1, title: t("Jenis & Saldo", "Types & Balances"), desc: t("Master 12 jenis cuti (PP 35/2021) + Generate Leave Information per tahun — carry-over otomatis", "Master of 12 leave types (PP 35/2021) + Generate Leave Information per year — automatic carry-over"), icon: Palmtree, view: "leave-info" },
    { n: 2, title: t("Permintaan & Approval", "Requests & Approval"), desc: t("Karyawan mengajukan (hari kerja dihitung dari jadwal absensi) → Approve / Reject / Cancel", "Employees submit (working days computed from the attendance schedule) → Approve / Reject / Cancel"), icon: CheckCircle2, view: "leave-request" },
    { n: 3, title: t("Cuti Massal SKB", "Mass Leave (SKB)"), desc: t("Cuti bersama pemerintah untuk seluruh organisasi — baris cuti dibuat otomatis per karyawan", "Government joint leave for the entire organization — leave rows created automatically per employee"), icon: Users, view: "leave-mass" },
    { n: 4, title: t("Uang Pengganti → Payroll", "Encashment → Payroll"), desc: t("Saldo cuti diuangkan (encashment) → komponen UCT masuk payroll period → Dibayar saat run", "Leave balance cashed out (encashment) → UCT component enters the payroll period → Paid on run"), icon: Wallet, view: "leave-encashment" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Ringkasan Cuti Karyawan", "Employee Leave Overview")}
        description={t("Saldo, permintaan, cuti massal, dan uang pengganti cuti — terintegrasi jadwal absensi & payroll (padanan Leave Administration)", "Balances, requests, mass leave, and leave encashment — integrated with attendance schedules & payroll (Leave Administration equivalent)")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={generateThisYear} className="gap-2 font-bold">
              <Sparkles className="h-4 w-4" /> {t("Generate Saldo {y}", "Generate Balances {y}", { y: new Date().getFullYear() })}
            </Button>
            <Button onClick={() => navigate("leave", "leave-request")} className="gap-2 font-bold">
              <Inbox className="h-4 w-4" /> {t("Ajukan Cuti", "Request Leave")}
            </Button>
          </div>
        }
      />

      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpi.map((k) => {
              const Icon = k.icon;
              return (
                <button
                  key={k.label}
                  onClick={k.onClick}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <div className={cn("rounded-xl p-2", k.hero ? "ov-fill" : "ov-tile")}><Icon className="h-5 w-5" /></div>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500 dark:text-slate-600" />
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
                  <p className="text-2xl font-extrabold text-slate-800 dark:text-slate-100">{k.value}</p>
                  {k.sub && <p className="text-[11px] text-slate-400">{k.sub}</p>}
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 ov-text-accent" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("Alur Kerja Modul Cuti", "Leave Module Workflow")}</h3>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {steps.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.n}
                      onClick={() => navigate("leave", s.view)}
                      className="group flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-left transition hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/60"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ov-tile text-xs font-extrabold">{s.n}</div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                          {s.title} <Icon className="h-3 w-3 text-slate-400" />
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{s.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 ov-hero p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                <h3 className="text-sm font-bold">{t("Formula Saldo", "Balance Formula")}</h3>
              </div>
              <p className="mt-3 font-mono text-[11px] leading-relaxed">
                {t("saldo = (a carried + b earned + c adj)", "balance = (a carried + b earned + c adj)")}<br />
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{t("− (d hangus + e cash + f terpakai + g terpakai mendatang)", "− (d forfeited + e cash + f taken + g upcoming taken)")}
              </p>
              <div className="mt-4 space-y-1.5 text-[11px] text-white/90">
                <p>• <b>Earned</b> {t("prorata bulanan (÷12 × bulan berlalu)", "prorated monthly (÷12 × months elapsed)")}</p>
                <p>• <b>Carry-over</b> {t("maks 6 hari, hangus 31 Des", "max 6 days, forfeited Dec 31")}</p>
                <p>• <b>{t("Setengah hari", "Half day")}</b> {t("via sesi AM/PM per jadwal absensi", "via AM/PM sessions per the attendance schedule")}</p>
                <p>• <b>Encashment</b> {t("→ komponen UCT (hari × upah/25)", "→ UCT component (days × wage/25)")}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-4 gap-1.5 bg-white/90 font-bold text-primary hover:bg-white"
                onClick={() => navigate("leave", "leave-info")}
              >
                {t("Lihat Saldo Karyawan", "View Employee Balances")} <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
