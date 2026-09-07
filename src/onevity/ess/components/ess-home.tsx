"use client";
// Beranda Portal Karyawan — sapaan + jam berjalan, punch clock hari ini,
// ringkasan bulan, saldo cuti utama, slip gaji terakhir, pengajuan terakhir,
// persetujuan menunggu (bila approver), jadwal 7 hari.
import { motion } from "framer-motion";
import {
  CalendarCheck2, CalendarDays, Coins, ClipboardCheck, ChevronRight, Sparkles,
  Plane, HeartPulse, CircleDot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useApi, apiSend, fmtIDR, fmtDate, initials } from "@/onevity/shared/lib/api";
import { StatusPill, EmptyState, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { useEssNav } from "@/onevity/ess/lib/ess-store";
import { useEssSession } from "@/onevity/ess/components/ess-session";
import { EssStat, EssSection, PunchCard, BalanceBar, greeting, useLiveClock, fmtMinutes, PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { cn } from "@/lib/utils";

interface DashboardData {
  today: {
    date: string; dayName: string | null; dayCode: string | null;
    timeIn: string | null; timeOut: string | null; clockingRequired: boolean;
    status: string | null; checkIn: string | null; checkOut: string | null;
    lateMinutes: number; workMinutes: number;
  };
  month: {
    label: string; presentDays: number; lateCount: number; lateMinutes: number;
    absentDays: number; leavePaidDays: number; scheduledDays: number; overtimeMinutes: number;
  };
  balances: { leaveTypeCode: string; leaveTypeName: string; unit: string; entitlement: number; taken: number; applied: number; remaining: number }[];
  lastPayslip: { runNo: string; periodName: string; processTypeName: string; status: string; net: number; bruto: number; paidAt: string | null } | null;
  recentRequests: { id: string; docNo: string; leaveTypeName: string; dateFrom: string; dateTo: string; workingDays: number; status: string; requestDate: string }[];
  pendingApprovals: number;
  upcoming: { date: string; dayCode: string | null; dayName: string | null; color: string | null; category: string | null }[];
}

const DAY_LETTER = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

export function EssHome() {
  const { navigate } = useEssNav();
  const { data: ess } = useEssSession();
  const { data, loading, error, refresh, setData } = useApi<DashboardData>("/api/ess/dashboard");
  const clock = useLiveClock();

  const emp = ess?.employee;
  const nameFirst = (emp?.fullName ?? "").split(" ").slice(0, 2).join(" ");

  const onClock = async (direction: "IN" | "OUT") => {
    try {
      const res = await apiSend<{ ok: boolean; direction: string; time: string; today: { status: string; checkIn: string | null; checkOut: string | null } | null }>(
        "/api/ess/attendance/clock", "POST", { direction },
      );
      toast.success(
        res.direction === "IN" ? `Clock-in tercatat pukul ${new Date(res.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}` : `Clock-out tercatat pukul ${new Date(res.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`,
      );
      // patch lokal supaya tombol langsung berubah status tanpa round-trip penuh
      if (data && res.today) {
        setData({
          ...data,
          today: {
            ...data.today,
            status: res.today.status,
            checkIn: res.today.checkIn,
            checkOut: res.today.checkOut,
          },
        });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat absensi");
    }
  };

  if (loading) return <PageSkeleton />;
  if (error || !data) {
    return (
      <EmptyState
        title="Gagal memuat beranda"
        description={error ?? "Coba muat ulang halaman ini"}
        icon={<Sparkles className="h-6 w-6" />}
      />
    );
  }

  const annual = data.balances.find((b) => b.leaveTypeCode === "CT-THN") ?? data.balances.find((b) => b.leaveTypeCode === "CT-ANNIV");
  const otherBalances = data.balances.filter((b) => b !== annual).slice(0, 4);
  const attendancePct = data.month.scheduledDays > 0 ? Math.round((data.month.presentDays / data.month.scheduledDays) * 100) : null;

  return (
    <div className="space-y-6">
      {/* ===== hero ===== */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 p-6 text-white shadow-lg shadow-emerald-900/20 sm:p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-teal-400/25 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-200/90">{greeting()}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{nameFirst || "Karyawan"}</h1>
            <p className="mt-1.5 text-sm text-emerald-50/85">
              {emp?.position ?? "—"} · {emp?.orgUnit ?? "—"}
            </p>
            <p className="mt-0.5 text-xs text-emerald-200/75">
              {new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(clock ?? new Date())}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
              {clock ? new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(clock) : "--:--:--"}
            </p>
            <p className="mt-1 text-[11px] text-emerald-200/80">Waktu saat ini</p>
          </div>
        </div>
      </motion.div>

      {/* ===== punch clock ===== */}
      <PunchCard today={data.today} onClock={onClock} />

      {/* ===== stats ===== */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <EssStat
          icon={<CalendarCheck2 />}
          label="Kehadiran Bulan Ini"
          value={attendancePct != null ? `${attendancePct}%` : "—"}
          sub={`${data.month.presentDays} dari ${data.month.scheduledDays} hari terjadwal`}
          onClick={() => navigate("attendance")}
          delay={0.02}
        />
        <EssStat
          icon={<CircleDot />}
          label="Terlambat / Absen"
          value={`${data.month.lateCount} / ${data.month.absentDays}`}
          sub={data.month.lateMinutes > 0 ? `total terlambat ${fmtMinutes(data.month.lateMinutes)}` : "tepat waktu sepanjang bulan"}
          accent={data.month.lateCount + data.month.absentDays > 0 ? "amber" : "emerald"}
          onClick={() => navigate("attendance")}
          delay={0.06}
        />
        <EssStat
          icon={<CalendarDays />}
          label="Sisa Cuti Tahunan"
          value={annual ? `${annual.remaining} hari` : "—"}
          sub={annual ? `dari jatah ${annual.entitlement} hari` : undefined}
          onClick={() => navigate("leave")}
          delay={0.1}
        />
        <EssStat
          icon={<Coins />}
          label={data.lastPayslip ? `Gaji ${data.lastPayslip.periodName}` : "Slip Gaji"}
          value={data.lastPayslip ? fmtIDR(data.lastPayslip.net) : "—"}
          sub={data.lastPayslip ? data.lastPayslip.processTypeName : "belum ada slip"}
          onClick={() => navigate("payslips")}
          delay={0.14}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ===== saldo cuti ===== */}
        <EssSection title="Saldo Cuti Saya" description={`Tahun ${new Date().getFullYear()}`} icon={<CalendarDays />} action={
          <Button variant="outline" size="sm" onClick={() => navigate("leave")}>Semua saldo <ChevronRight className="h-3.5 w-3.5" /></Button>
        }>
          <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="space-y-4 p-5">
              {annual && (
                <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-teal-50/60 p-4 dark:border-emerald-500/25 dark:from-emerald-500/10 dark:to-teal-500/10">
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{annual.leaveTypeName}</p>
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{annual.remaining} <span className="text-xs font-medium text-stone-500">/ {annual.entitlement} hari</span></p>
                  </div>
                  <BalanceBar value={annual.remaining} max={annual.entitlement} className="mt-2" />
                </div>
              )}
              {otherBalances.length > 0 ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {otherBalances.map((b) => (
                    <div key={b.leaveTypeCode} className="rounded-lg border border-stone-200/80 p-3 dark:border-stone-800">
                      <p className="truncate text-xs font-medium text-stone-600 dark:text-stone-300" title={b.leaveTypeName}>{b.leaveTypeName}</p>
                      <p className="mt-0.5 text-sm font-bold text-stone-800 dark:text-stone-100">{b.remaining} <span className="text-[11px] font-normal text-stone-400">hari</span></p>
                    </div>
                  ))}
                </div>
              ) : !annual ? (
                <EmptyState title="Belum ada saldo cuti" description="Saldo cuti Anda belum diatur — hubungi HR." icon={<CalendarDays className="h-6 w-6" />} />
              ) : null}
            </CardContent>
          </Card>
        </EssSection>

        {/* ===== pengajuan terakhir ===== */}
        <EssSection title="Pengajuan Terakhir" description="5 permintaan cuti terbaru Anda" icon={<ClipboardCheck />} action={
          <Button variant="outline" size="sm" onClick={() => navigate("leave")}>Riwayat <ChevronRight className="h-3.5 w-3.5" /></Button>
        }>
          <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-2">
              {data.recentRequests.length === 0 ? (
                <EmptyState title="Belum ada pengajuan" description="Ajukan cuti pertama Anda dari menu Cuti Saya." icon={<CalendarDays className="h-6 w-6" />} />
              ) : (
                <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
                  {data.recentRequests.map((r, i) => (
                    <motion.li
                      key={r.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">{r.leaveTypeName}</p>
                        <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                          {fmtDate(r.dateFrom)} – {fmtDate(r.dateTo)} · {r.workingDays} hari · {r.docNo}
                        </p>
                      </div>
                      <StatusPill status={r.status} />
                    </motion.li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </EssSection>
      </div>

      {/* ===== persetujuan menunggu (bila approver) ===== */}
      {data.pendingApprovals > 0 && (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => navigate("approvals")}
          className="group flex w-full items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/70 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-amber-500/25 dark:from-amber-500/10 dark:to-orange-500/10"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{data.pendingApprovals} pengajuan menunggu keputusan Anda</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">Cuti · perjalanan dinas · klaim medis dari anggota tim Anda</p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-amber-500 transition-transform group-hover:translate-x-1" />
        </motion.button>
      )}

      {/* ===== jadwal 7 hari ===== */}
      <EssSection title="Jadwal 7 Hari Ke Depan" description="Pola hari kerja Anda berikutnya" icon={<CalendarCheck2 />}>
        <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-7">
          {data.upcoming.map((d, i) => {
            const date = new Date(d.date + "T00:00:00");
            const isWork = d.category === "Workday";
            return (
              <motion.div
                key={d.date}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className={cn(
                  "rounded-xl border p-3 text-center",
                  i === 0 ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-500/40 dark:bg-emerald-500/10" : isWork ? "border-stone-200/80 bg-card dark:border-stone-800" : "border-dashed border-stone-200 bg-stone-50/60 dark:border-stone-700 dark:bg-stone-900/40",
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{DAY_LETTER[date.getDay()]}</p>
                <p className={cn("mt-0.5 text-lg font-bold tabular-nums", i === 0 ? "text-emerald-700 dark:text-emerald-400" : "text-stone-800 dark:text-stone-100")}>{date.getDate()}</p>
                <p className="mt-1 truncate text-[10px] font-medium text-stone-500 dark:text-stone-400" title={d.dayName ?? "Tanpa jadwal"}>
                  {isWork ? "Kerja" : d.dayName ? (d.dayName.includes("Jam Kantor") ? "Kerja" : d.category) : "Libur"}
                </p>
              </motion.div>
            );
          })}
        </div>
      </EssSection>
    </div>
  );
}
