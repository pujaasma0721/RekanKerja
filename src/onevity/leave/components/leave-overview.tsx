"use client";
// OneVity Leave — Ringkasan: KPI modul cuti + alur kerja 4 langkah
import { useApi } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { apiSend } from "@/onevity/shared/lib/api";
import {
  Palmtree, Inbox, CheckCircle2, Users, Wallet, CalendarDays,
  TrendingUp, Sparkles, ArrowRight, CalendarClock,
} from "lucide-react";

interface LeaveStats {
  year: number; activeEmployees: number; types: number;
  pendingRequests: number; pendingEnc: number; massLeaves: number;
  onLeaveToday: number; upcoming30: number; approvedThisYear: number; encTransferred: number;
  avgAnnualRemaining: number;
}

export function LeaveOverview() {
  const { navigate } = useNav();
  const { data, loading, refresh } = useApi<LeaveStats>("/api/onevity/leave/overview");

  const kpi = [
    {
      label: "Menunggu Approval", value: data ? String(data.pendingRequests) : "—",
      sub: data ? `${data.pendingEnc} encashment · ${data.onLeaveToday} sedang cuti hari ini` : undefined,
      icon: Inbox, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
      onClick: () => navigate("leave", "leave-approval"),
    },
    {
      label: `Rata-rata Saldo Cuti Tahunan`, value: data ? `${data.avgAnnualRemaining} hari` : "—",
      sub: data ? `dari ${data.activeEmployees} karyawan aktif` : undefined,
      icon: Palmtree, tone: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
      onClick: () => navigate("leave", "leave-info"),
    },
    {
      label: "Cuti 30 Hari ke Depan", value: data ? String(data.upcoming30) : "—",
      sub: data ? `${data.approvedThisYear} permintaan disetujui ${data.year}` : undefined,
      icon: CalendarDays, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
      onClick: () => navigate("leave", "leave-reports"),
    },
    {
      label: "Baris Cuti Massal", value: data ? String(data.massLeaves) : "—",
      sub: data ? `${data.encTransferred} encashment masuk payroll` : undefined,
      icon: Users, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
      onClick: () => navigate("leave", "leave-mass"),
    },
  ];

  const generateThisYear = async () => {
    const year = new Date().getFullYear();
    try {
      const res = await apiSend<{ rows: number; updated: number; carryTotal: number; employees: number; types: number }>(
        "/api/onevity/leave/balances", "POST", { year },
      );
      toast.success(`Generate ${year}: ${res.rows} saldo baru (${res.employees} karyawan × ${res.types} jenis), carry-over ${res.carryTotal} hari`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal generate saldo");
    }
  };

  const steps = [
    { n: 1, title: "Jenis & Saldo", desc: "Master 12 jenis cuti (PP 35/2021) + Generate Leave Information per tahun — carry-over otomatis", icon: Palmtree, view: "leave-info" },
    { n: 2, title: "Permintaan & Approval", desc: "Karyawan mengajukan (hari kerja dihitung dari jadwal absensi) → Approve / Reject / Cancel", icon: CheckCircle2, view: "leave-request" },
    { n: 3, title: "Cuti Massal SKB", desc: "Cuti bersama pemerintah untuk seluruh organisasi — baris cuti dibuat otomatis per karyawan", icon: Users, view: "leave-mass" },
    { n: 4, title: "Uang Pengganti → Payroll", desc: "Saldo cuti diuangkan (encashment) → komponen UCT masuk payroll period → Dibayar saat run", icon: Wallet, view: "leave-encashment" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Ringkasan Cuti Karyawan"
        description="Saldo, permintaan, cuti massal, dan uang pengganti cuti — terintegrasi jadwal absensi & payroll (padanan Leave Administration)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={generateThisYear} className="gap-2 font-bold">
              <Sparkles className="h-4 w-4" /> Generate Saldo {new Date().getFullYear()}
            </Button>
            <Button onClick={() => navigate("leave", "leave-request")} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
              <Inbox className="h-4 w-4" /> Ajukan Cuti
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
                  className="group rounded-2xl border border-stone-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800 dark:bg-stone-900"
                >
                  <div className="flex items-center justify-between">
                    <div className={`rounded-xl p-2 ${k.tone}`}><Icon className="h-5 w-5" /></div>
                    <ArrowRight className="h-3.5 w-3.5 text-stone-300 transition group-hover:translate-x-0.5 group-hover:text-stone-500 dark:text-stone-600" />
                  </div>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
                  <p className="text-2xl font-extrabold text-stone-800 dark:text-stone-100">{k.value}</p>
                  {k.sub && <p className="text-[11px] text-stone-400">{k.sub}</p>}
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900 lg:col-span-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-orange-600" />
                <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">Alur Kerja Modul Cuti</h3>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {steps.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.n}
                      onClick={() => navigate("leave", s.view)}
                      className="group flex gap-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3 text-left transition hover:border-orange-200 hover:bg-orange-50/50 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-orange-900 dark:hover:bg-orange-950/30"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-xs font-extrabold text-orange-700 dark:bg-orange-500/15 dark:text-orange-400">{s.n}</div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-stone-800 dark:text-stone-100">
                          {s.title} <Icon className="h-3 w-3 text-stone-400" />
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{s.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200/80 bg-gradient-to-br from-orange-500 to-rose-500 p-5 text-white shadow-sm">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                <h3 className="text-sm font-bold">Formula Saldo</h3>
              </div>
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-orange-50">
                saldo = (a carried + b earned + c adj)<br />
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;− (d hangus + e cash + f terpakai + g terpakai mendatang)
              </p>
              <div className="mt-4 space-y-1.5 text-[11px] text-orange-50/90">
                <p>• <b>Earned</b> prorata bulanan (÷12 × bulan berlalu)</p>
                <p>• <b>Carry-over</b> maks 6 hari, hangus 31 Des</p>
                <p>• <b>Setengah hari</b> via sesi AM/PM per jadwal absensi</p>
                <p>• <b>Encashment</b> → komponen UCT (hari × upah/25)</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="mt-4 gap-1.5 bg-white/90 font-bold text-orange-700 hover:bg-white"
                onClick={() => navigate("leave", "leave-info")}
              >
                Lihat Saldo Karyawan <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
