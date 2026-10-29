"use client";
// OneVity Attendance — Ringkasan: KPI hari ini + bulan berjalan + approval menunggu
import { useApi, fmtIDRShort } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiSend } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  CalendarCheck2, Clock, XCircle, CheckCircle2, Users, CalendarClock,
  CalendarDays, RefreshCw, Timer, BadgeCheck, TrendingUp,
  ShieldCheck, ShieldAlert, TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  /** T9-HOLIDAY: jumlah hari libur tahun berjalan + libur terdekat */
  holidaysThisYear: number;
  nextHoliday: { date: string; name: string; kind: string } | null;
  /** G-04 (audit 42): coverage kualitas data — populasi harapan vs baris
   *  AttendanceDaily yang ada (opsional: payload lama tanpa coverage tetap
   *  di-render tanpa indikator). */
  coverage?: CoverageData;
}

interface CoverageData {
  expected: number;
  actual: number;
  missing: number;
  coveragePct: number;
  asOf: string;
  missingByDay: { date: string; missing: number }[];
  missingByEmployee: { employeeId: string; employeeNo: string; fullName: string; missing: number }[];
}

export function AttendanceOverview() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<OverviewData>("/api/onevity/attendance/overview");
  const today = data?.today;
  const month = data?.month;

  const regenerateToday = async () => {
    try {
      const d = new Date().toISOString().slice(0, 10);
      const res = await apiSend<{ regenerated: number }>("/api/onevity/attendance/clocking", "PATCH", { date: d });
      toast.success(t("Rekap hari ini dihitung ulang — {n} karyawan diproses", "Today's recap recalculated — {n} employees processed", { n: res.regenerated }));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghitung ulang", "Failed to recalculate"));
    }
  };

  const kpi = [
    {
      label: t("Hadir Hari Ini", "Present Today"), value: today ? `${today.present} / ${today.total}` : "—",
      sub: today ? t("{a} telat · {b} absen · {c} izin", "{a} late · {b} absent · {c} permit", { a: today.late, b: today.absent, c: today.workoff }) : undefined,
      icon: CalendarCheck2, hero: true,
      onClick: () => navigate("attendance", "clocking"),
    },
    {
      label: t("Keterlambatan Bulan Ini", "Lateness This Month"), value: month ? t("{n} hari", "{n} days", { n: month.late }) : "—",
      sub: month ? t("{n} jam total telat", "{n} h total late", { n: Math.round(month.lateMinutes / 60) }) : undefined,
      icon: Timer,
      onClick: () => navigate("attendance", "absence"),
    },
    {
      label: t("Approval Menunggu", "Pending Approvals"), value: data ? String(data.pendingOvertime + data.pendingWorkoff) : "—",
      sub: data ? t("{a} lembur · {b} izin", "{a} overtime · {b} permits", { a: data.pendingOvertime, b: data.pendingWorkoff }) : undefined,
      icon: CheckCircle2,
      onClick: () => navigate("attendance", "overtime"),
    },
    {
      label: t("Lembur Bulan Ini", "Overtime This Month"), value: month ? t("{n} jam", "{n} h", { n: Math.round(month.overtimeMinutes / 60) }) : "—",
      sub: t("jam terverifikasi siap dibayar", "verified hours ready for payment"),
      icon: Clock,
      onClick: () => navigate("attendance", "overtime"),
    },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Ringkasan Time & Attendance", "Time & Attendance Overview")}
        description={t("Jadwal kerja, presensi harian, lembur, dan izin — dari clock in/out sampai transfer ke payroll", "Work schedules, daily presence, overtime and permits — from clock in/out to the payroll transfer")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={regenerateToday} className="gap-2 font-bold">
              <RefreshCw className="h-4 w-4" /> {t("Hitung Ulang Hari Ini", "Recalculate Today")}
            </Button>
            <Button onClick={() => navigate("attendance", "clocking")} className="gap-2 font-bold">
              <CalendarCheck2 className="h-4 w-4" /> {t("Buka Data Clocking", "Open Clocking Data")}
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
                <button key={k.label} onClick={k.onClick} className="group flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:ov-border-accent hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", k.hero ? "ov-fill" : "ov-tile")}><Icon className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
                    <p className="truncate text-lg font-extrabold text-slate-900 dark:text-slate-50">{k.value}</p>
                    <p className="truncate text-[11px] text-slate-400">{k.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* G-04 (audit 42): indikator coverage kualitas data presensi —
              peringatan bila regenerasi belum/tidak lengkap */}
          {data?.coverage ? <CoverageAlert cov={data.coverage} onOpenClocking={() => navigate("attendance", "clocking")} /> : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* bulan berjalan */}
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Rekap Bulan Berjalan", "Current Month Recap")}</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{month ? `${month.from} – ${month.to}` : "—"}</p>
                  </div>
                  <TrendingUp className="h-5 w-5 ov-text-accent" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MiniStat label={t("Hadir", "Present")} value={month ? t("{n} hari", "{n} days", { n: month.present }) : "—"} tone="text-brand dark:text-brand/85" />
                  <MiniStat label={t("Absen", "Absent")} value={month ? t("{n} hari", "{n} days", { n: month.absent }) : "—"} tone="text-rose-600 dark:text-rose-400" />
                  <MiniStat label={t("Izin", "Permit")} value={month ? t("{n} hari", "{n} days", { n: month.workoff }) : "—"} tone="text-amber-600 dark:text-amber-400" />
                  <MiniStat label={t("Telat", "Late")} value={month ? t("{n} hari", "{n} days", { n: month.late }) : "—"} tone="text-amber-600 dark:text-amber-400" />
                  <MiniStat label={t("Jam Telat", "Late Hours")} value={month ? t("{n} jam", "{n} h", { n: Math.round(month.lateMinutes / 60) }) : "—"} tone="text-slate-700 dark:text-slate-300" />
                  <MiniStat label={t("Lembur", "Overtime")} value={month ? t("{n} jam", "{n} h", { n: Math.round(month.overtimeMinutes / 60) }) : "—"} tone="text-brand dark:text-brand/85" />
                </div>
                <Button variant="ghost" size="sm" className="mt-3 w-full gap-1 text-xs font-bold ov-text-accent hover:ov-text-accent" onClick={() => navigate("attendance", "absence")}>
                  {t("Lihat rekap & transfer ke payroll →", "View recap & transfer to payroll →")}
                </Button>
              </CardContent>
            </Card>

            {/* status pengaturan */}
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Kesiapan Modul", "Module Readiness")}</p>
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-50">{t("Jadwal & Konfigurasi", "Schedules & Configuration")}</p>
                  </div>
                  <BadgeCheck className="h-5 w-5 ov-text-accent" />
                </div>
                <div className="space-y-2.5">
                  <SetupRow icon={CalendarClock} label={t("Template jadwal aktif", "Active schedule templates")} value={data ? t("{n} jadwal", "{n} schedules", { n: data.activeSchedules }) : "—"} ok={(data?.activeSchedules ?? 0) > 0} onClick={() => navigate("attendance", "templates-schedule")} />
                  <SetupRow icon={Users} label={t("Karyawan ter-assign jadwal", "Employees with assigned schedules")} value={data ? t("{n} karyawan", "{n} employees", { n: data.assignedEmployees }) : "—"} ok={(data?.assignedEmployees ?? 0) > 0} onClick={() => navigate("attendance", "assignment-schedule")} />
                  <SetupRow icon={XCircle} label={t("Karyawan non-clocking", "Non-clocking employees")} value={data ? t("{n} (jam dianggap normal)", "{n} (hours assumed normal)", { n: data.nonClocking }) : "—"} ok={true} onClick={() => navigate("attendance", "assignment-schedule")} />
                  <SetupRow icon={Clock} label={t("Lembur menunggu approval", "Overtime awaiting approval")} value={data ? t("{n} perintah", "{n} orders", { n: data.pendingOvertime }) : "—"} ok={(data?.pendingOvertime ?? 0) === 0} onClick={() => navigate("attendance", "overtime")} />
                  {/* T9-HOLIDAY: KPI kalender — hari libur tahun ini + libur terdekat */}
                  <SetupRow icon={CalendarDays} label={t("Hari libur tahun ini", "Holidays this year")} value={data ? t("{n} hari · terdekat {d}: {name}", "{n} days · next {d}: {name}", { n: data.holidaysThisYear, d: data.nextHoliday?.date ?? "—", name: data.nextHoliday?.name ?? "—" }) : "—"} ok={true} onClick={() => navigate("attendance", "holidays")} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* alur kerja */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Alur Kerja (mengikuti Time Attendance)", "Workflow (following Time Attendance)")}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FlowStep no="1" title={t("Setup Master", "Master Setup")} desc={t("Tipe hari, jadwal cycle, aturan toleransi & pembulatan", "Day types, cycle schedules, tolerance & rounding rules")} onClick={() => navigate("attendance", "templates-schedule")} />
                <FlowStep no="2" title={t("Assign Jadwal")} desc={t("Penugasan jadwal per karyawan + anchor Senin", "Per-employee schedule assignment + Monday anchor")} onClick={() => navigate("attendance", "assignment-schedule")} />
                <FlowStep no="3" title={t("Presensi Harian", "Daily Presence")} desc={t("Clock in/out, refresh rekap, koreksi manual", "Clock in/out, refresh recap, manual corrections")} onClick={() => navigate("attendance", "clocking")} />
                <FlowStep no="4" title={t("Transfer Payroll", "Payroll Transfer")} desc={`${t("Rekap period → komponen LEMBUR/TLATE/TABS", "Period recap → LEMBUR/TLATE/TABS components")}${data ? t(" · estimasi {v}", " · est. {v}", { v: fmtIDRShort((month?.overtimeMinutes ?? 0) > 0 ? 0 : 0) }) : ""}`} onClick={() => navigate("attendance", "absence")} />
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

/**
 * G-04 (audit 42): indikator coverage data presensi bulan berjalan.
 * ≥98% hijau (data lengkap) · 90–98% kuning · <90% merah + detail + hint regen.
 * Badge shadcn (variant outline + warna) — responsif (flex-wrap di mobile).
 */
function CoverageAlert({ cov, onOpenClocking }: { cov: CoverageData; onOpenClocking: () => void }) {
  const { t, locale } = useI18n();
  const pct = cov.coveragePct;
  const pctLabel = pct.toLocaleString(locale, { maximumFractionDigits: 1 });
  const asOfLabel = new Date(`${cov.asOf}T00:00:00`).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });

  // ambang: hijau ≥98 · kuning 90–<98 · merah <90 (merah = keputusan payroll berisiko)
  const good = pct >= 98;
  const warn = !good && pct >= 90;
  const Icon = good ? ShieldCheck : warn ? TriangleAlert : ShieldAlert;
  const box = good
    ? "border-brand/25 bg-brand/10/70 dark:border-brand/25 dark:bg-brand/10"
    : warn
      ? "border-amber-200 bg-amber-50/70 dark:border-amber-500/25 dark:bg-amber-500/10"
      : "border-rose-200 bg-rose-50/70 dark:border-rose-500/25 dark:bg-rose-500/10";
  const iconTone = good
    ? "bg-brand/15 text-brand-deep dark:bg-brand/20 dark:text-brand/85"
    : warn
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
      : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400";
  const badge = good
    ? "border-brand/25 bg-white text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-transparent dark:text-brand/85"
    : warn
      ? "border-amber-300 bg-white text-[10px] font-bold text-amber-700 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-400"
      : "border-rose-300 bg-white text-[10px] font-bold text-rose-700 dark:border-rose-500/40 dark:bg-transparent dark:text-rose-400";

  const badgeText = good
    ? t("Data Lengkap", "Complete Data")
    : warn
      ? t("Data Belum Lengkap ({p}%)", "Data Incomplete ({p}%)", { p: pctLabel })
      : t("Data Tidak Lengkap ({p}%)", "Data Incomplete ({p}%)", { p: pctLabel });

  const worstDay = cov.missingByDay[0];
  const worstEmps = cov.missingByEmployee.slice(0, 3)
    .map((e) => t("{no} ({n})", "{no} ({n})", { no: e.employeeNo, n: e.missing }))
    .join(", ");

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 shadow-sm", box)}>
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", iconTone)}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t("Kualitas Data Presensi", "Attendance Data Quality")}</p>
          <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">
            {t("{a}/{b} kombinasi karyawan-hari terhitung · s.d. {d}", "{a}/{b} employee-day combinations recorded · as of {d}", { a: cov.actual.toLocaleString(locale), b: cov.expected.toLocaleString(locale), d: asOfLabel })}
          </p>
        </div>
      </div>
      <Badge variant="outline" className={cn("shrink-0", badge)}>{badgeText}</Badge>
      {!good ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {t("{n} kombinasi hilang", "{n} combinations missing", { n: cov.missing.toLocaleString(locale) })}
            {worstDay ? t(" · terburuk {d} ({n})", " · worst {d} ({n})", { d: worstDay.date, n: worstDay.missing }) : ""}
            {worstEmps ? t(" · karyawan: {list}", " · employees: {list}", { list: worstEmps }) : ""}
          </p>
          <Button size="sm" variant="outline" className="h-7 gap-1 border-slate-300/80 px-2.5 text-[11px] font-bold" onClick={onOpenClocking}>
            {t("Jalankan Regenerasi Presensi", "Run Attendance Regeneration")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SetupRow({ icon: Icon, label, value, ok, onClick }: { icon: React.ElementType; label: string; value: string; ok: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3.5 py-2.5 text-left transition hover:ov-border-accent dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-500">{value}</span>
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-brand" : "bg-amber-400"}`} />
      </div>
    </button>
  );
}

function FlowStep({ no, title, desc, onClick }: { no: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:ov-border-accent hover:shadow-sm dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ov-fill text-xs font-extrabold">{no}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{title}</p>
        <p className="text-[11px] leading-relaxed text-slate-500">{desc}</p>
      </div>
    </button>
  );
}
