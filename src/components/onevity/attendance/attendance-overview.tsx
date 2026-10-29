"use client";
// OneVity Attendance — Ringkasan: KPI hari ini + bulan berjalan + approval menunggu
import { useApi, fmtIDRShort } from "@/lib/onevity/api";
import { useNav } from "@/lib/onevity/store";
import { PageHeader, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { apiSend } from "@/lib/onevity/api";
import {
  CalendarCheck2, Clock, XCircle, CheckCircle2, Users, CalendarClock,
  RefreshCw, Timer, BadgeCheck, TrendingUp,
} from "lucide-react";

interface OverviewData {
  today: {
    date: string; present: number; late: number; absent: number; workoff: number; off: number;
    lateMinutes: number; absenceMinutes: number; overtimeMinutes: number; total: number;
  };
  month: {
    from: string; to: string; present: number; late: number; absent: number; workoff: number; off: number;
    lateMinutes: number; absenceMinutes: number; overtimeMinutes: number; total: number;
  };
  pendingOvertime: number;
  pendingWorkoff: number;
  activeSchedules: number;
  assignedEmployees: number;
  nonClocking: number;
}

export function AttendanceOverview() {
  const { navigate } = useNav();
  const { data, loading, refresh } = useApi<OverviewData>("/api/onevity/attendance/overview");
  const today = data?.today;
  const month = data?.month;

  const regenerateToday = async () => {
    try {
      const d = new Date().toISOString().slice(0, 10);
      const res = await apiSend<{ regenerated: number }>("/api/onevity/attendance/clocking", "PATCH", { date: d });
      toast.success(`Rekap hari ini dihitung ulang — ${res.regenerated} karyawan diproses`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghitung ulang");
    }
  };

  const kpi = [
    {
      label: "Hadir Hari Ini", value: today ? `${today.present} / ${today.total}` : "—",
      sub: today ? `${today.late} telat · ${today.absent} absen · ${today.workoff} izin` : undefined,
      icon: CalendarCheck2, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
      onClick: () => navigate("attendance", "clocking"),
    },
    {
      label: "Keterlambatan Bulan Ini", value: month ? `${month.late} hari` : "—",
      sub: month ? `${Math.round(month.lateMinutes / 60)} jam total telat` : undefined,
      icon: Timer, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
      onClick: () => navigate("attendance", "absence"),
    },
    {
      label: "Approval Menunggu", value: data ? String(data.pendingOvertime + data.pendingWorkoff) : "—",
      sub: data ? `${data.pendingOvertime} lembur · ${data.pendingWorkoff} izin` : undefined,
      icon: CheckCircle2, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
      onClick: () => navigate("attendance", "overtime"),
    },
    {
      label: "Lembur Bulan Ini", value: month ? `${Math.round(month.overtimeMinutes / 60)} jam` : "—",
      sub: "jam terverifikasi siap dibayar",
      icon: Clock, tone: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
      onClick: () => navigate("attendance", "overtime"),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Ringkasan Time & Attendance"
        description="Jadwal kerja, presensi harian, lembur, dan izin — dari clock in/out sampai transfer ke payroll"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={regenerateToday} className="gap-2 font-bold">
              <RefreshCw className="h-4 w-4" /> Hitung Ulang Hari Ini
            </Button>
            <Button onClick={() => navigate("attendance", "clocking")} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              <CalendarCheck2 className="h-4 w-4" /> Buka Data Clocking
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

          <div className="grid gap-4 lg:grid-cols-2">
            {/* bulan berjalan */}
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rekap Bulan Berjalan</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{month ? `${month.from} – ${month.to}` : "—"}</p>
                  </div>
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MiniStat label="Hadir" value={month ? `${month.present} hari` : "—"} tone="text-emerald-600 dark:text-emerald-400" />
                  <MiniStat label="Absen" value={month ? `${month.absent} hari` : "—"} tone="text-rose-600 dark:text-rose-400" />
                  <MiniStat label="Izin" value={month ? `${month.workoff} hari` : "—"} tone="text-amber-600 dark:text-amber-400" />
                  <MiniStat label="Telat" value={month ? `${month.late} hari` : "—"} tone="text-amber-600 dark:text-amber-400" />
                  <MiniStat label="Jam Telat" value={month ? `${Math.round(month.lateMinutes / 60)} jam` : "—"} tone="text-slate-700 dark:text-slate-300" />
                  <MiniStat label="Lembur" value={month ? `${Math.round(month.overtimeMinutes / 60)} jam` : "—"} tone="text-teal-600 dark:text-teal-400" />
                </div>
                <Button variant="ghost" size="sm" className="mt-3 w-full gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400" onClick={() => navigate("attendance", "absence")}>
                  Lihat rekap & transfer ke payroll →
                </Button>
              </CardContent>
            </Card>

            {/* status pengaturan */}
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Kesiapan Modul</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">Jadwal & Konfigurasi</p>
                  </div>
                  <BadgeCheck className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="space-y-2.5">
                  <SetupRow icon={CalendarClock} label="Template jadwal aktif" value={data ? `${data.activeSchedules} jadwal` : "—"} ok={(data?.activeSchedules ?? 0) > 0} onClick={() => navigate("attendance", "templates-schedule")} />
                  <SetupRow icon={Users} label="Karyawan ter-assign jadwal" value={data ? `${data.assignedEmployees} karyawan` : "—"} ok={(data?.assignedEmployees ?? 0) > 0} onClick={() => navigate("attendance", "assignment-schedule")} />
                  <SetupRow icon={XCircle} label="Karyawan non-clocking" value={data ? `${data.nonClocking} (jam dianggap normal)` : "—"} ok={true} onClick={() => navigate("attendance", "assignment-schedule")} />
                  <SetupRow icon={Clock} label="Lembur menunggu approval" value={data ? `${data.pendingOvertime} perintah` : "—"} ok={(data?.pendingOvertime ?? 0) === 0} onClick={() => navigate("attendance", "overtime")} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* alur kerja */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Alur Kerja (mengikuti oranHR Time Attendance)</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FlowStep no="1" title="Setup Master" desc="Tipe hari, jadwal cycle, aturan toleransi & pembulatan" onClick={() => navigate("attendance", "templates-schedule")} />
                <FlowStep no="2" title="Assign Jadwal" desc="Penugasan jadwal per karyawan + anchor Senin" onClick={() => navigate("attendance", "assignment-schedule")} />
                <FlowStep no="3" title="Presensi Harian" desc="Clock in/out, refresh rekap, koreksi manual" onClick={() => navigate("attendance", "clocking")} />
                <FlowStep no="4" title="Transfer Payroll" desc={`Rekap period → komponen LEMBUR/TLATE/TABS${data ? ` · estimasi ${fmtIDRShort((month?.overtimeMinutes ?? 0) > 0 ? 0 : 0)}` : ""}`} onClick={() => navigate("attendance", "absence")} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm font-extrabold ${tone}`}>{value}</p>
    </div>
  );
}

function SetupRow({ icon: Icon, label, value, ok, onClick }: { icon: React.ElementType; label: string; value: string; ok: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3.5 py-2.5 text-left transition hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-emerald-600/40">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500">{value}</span>
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`} />
      </div>
    </button>
  );
}

function FlowStep({ no, title, desc, onClick }: { no: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-sm dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-extrabold text-white">{no}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{title}</p>
        <p className="text-[11px] leading-relaxed text-slate-500">{desc}</p>
      </div>
    </button>
  );
}
