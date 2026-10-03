"use client";
// RekanKerja Attendance — Ringkasan: KPI hari ini + bulan berjalan + approval menunggu
// Task 100-impl-B (F0): error state useApi + Coba Lagi (G10), regenerasi "hari ini"
// zona LOKAL (B-10), tanggal terburuk CoverageAlert format locale (B-7).
// Task 100 F1 (G15, impl-E): panel analytics di bawah KPI — tren kehadiran
// bulanan (bar chart CSS/div murni + nav bulan), heatmap jam × hari, biaya
// lembur per unit (money-gated), top telat, sinyal anomali + burnout (G27/G29
// dari /anomalies 30 hari), KPI kecil "Kehadiran bulan ini %".
import { useApi, apiSend, fmtDate, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useState } from "react";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { getLang } from "@/rekankerja/shared/lib/i18n-core";
import { ApiErrorState, todayISO } from "@/rekankerja/time-attendance/components/attendance-ui";
import {
  CalendarCheck2, Clock, XCircle, CheckCircle2, Users, CalendarClock,
  CalendarDays, RefreshCw, Timer, BadgeCheck, TrendingUp,
  ShieldCheck, ShieldAlert, TriangleAlert, ChevronLeft, ChevronRight,
  Flame, TimerOff,
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
  const { data, loading, error, refresh } = useApi<OverviewData>("/api/rekankerja/attendance/overview");
  const today = data?.today;
  const month = data?.month;

  // G15: bulan analytics aktif (YYYY-MM zona lokal) + navigasi prev/next.
  const [analyticsMonth, setAnalyticsMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });

  const regenerateToday = async () => {
    try {
      // B-10: tanggal hari ini zona lokal (pola ess-attendance).
      const d = todayISO();
      const res = await apiSend<{ regenerated: number }>("/api/rekankerja/attendance/clocking", "PATCH", { date: d });
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
      ) : error ? (
        <ApiErrorState message={error} busy={loading} onRetry={refresh} />
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

          {/* ===== Task 100 F1 (G15): panel analytics bulanan — di bawah KPI ===== */}
          <AnalyticsPanels month={analyticsMonth} onMonth={setAnalyticsMonth} />

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
                {/* Task 88: dulu menampilkan "estimasi Rp 0" permanen (ternary mati
                    kedua cabang 0) — diganti jam lembur riil bulan ini, jujur
                    dan bisa ditindaklanjuti tanpa asumsi tarif per jam. */}
                <FlowStep no="4" title={t("Transfer Payroll", "Payroll Transfer")} desc={`${t("Rekap period → komponen LEMBUR/TLATE/TABS", "Period recap → LEMBUR/TLATE/TABS components")}${month ? t(" · {n} jam lembur bulan ini", " · {n} overtime hours this month", { n: Math.round(month.overtimeMinutes / 60) }) : ""}`} onClick={() => navigate("attendance", "absence")} />
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
    ? "border-brand/25 bg-brand/10 dark:border-brand/25 dark:bg-brand/10"
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
            {worstDay ? t(" · terburuk {d} ({n})", " · worst {d} ({n})", { d: fmtDate(worstDay.date), n: worstDay.missing }) : ""}
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

// ============================================================================
// Task 100 F1 (G15) — PANEL ANALYTICS (api/analytics.ts + api/anomalies.ts)
// ============================================================================

interface TrendDay { date: string; present: number; late: number; absent: number; onLeave: number; off: number; workoff: number }
interface AnalyticsData {
  month: string;
  trend: TrendDay[];
  heatmap: { dow: number; hour: number; count: number }[];
  otByOrg: { org: string; minutes: number; estPay: number | null }[];
  moneyView: boolean;
  topLate: { employeeNo: string; fullName: string; count: number; minutes: number }[];
}
interface AnomalyRow {
  type: "duplicateGeo" | "latePattern" | "boundaryClock" | "impossibleTravel" | "speedFlag" | string;
  severity: "tinggi" | "sedang" | "rendah" | string;
  employeeNo: string; fullName: string; detail: string;
}
interface BurnoutRow { employeeNo: string; fullName: string; otMinutes3m: number; avgMonthlyHours: number; flag: boolean }
interface AnomaliesData { from: string; to: string; anomalies: AnomalyRow[]; burnout: BurnoutRow[] }

/** Geser bulan "YYYY-MM" ± n (zona lokal — pola B-10, tanpa Date.toISOString). */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y!, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// palet segmen tren (G15 — present=emerald, late=amber, absent=rose, onLeave=sky;
// TANPA indigo/blue, dark mode paralel)
const SEG_PRESENT = "bg-emerald-500 dark:bg-emerald-400";
const SEG_LATE = "bg-amber-500 dark:bg-amber-400";
const SEG_ABSENT = "bg-rose-500 dark:bg-rose-400";
const SEG_ONLEAVE = "bg-sky-500 dark:bg-sky-400";

const ANOMALY_TYPE_LABEL: Record<string, [string, string]> = {
  duplicateGeo: ["Geo Duplikat", "Duplicate Geo"],
  latePattern: ["Pola Telat", "Late Pattern"],
  boundaryClock: ["Clock Pas Batas", "Boundary Clock"],
  impossibleTravel: ["Perjalanan Mustahil", "Impossible Travel"],
  speedFlag: ["Flag Kecepatan", "Speed Flag"],
};

function AnalyticsPanels({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { t, locale } = useI18n();
  const api = useApi<AnalyticsData>(`/api/rekankerja/attendance/analytics?month=${month}`);
  // G27/G29: anomali presensi 30 hari terakhir + burnout lembur 3 bulan rolling.
  const anom = useApi<AnomaliesData>("/api/rekankerja/attendance/anomalies");

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });

  // agregat tren bulan untuk KPI "Kehadiran bulan ini %"
  const trend = api.data?.trend ?? [];
  const totals = trend.reduce(
    (s, d) => ({ present: s.present + d.present, late: s.late + d.late, absent: s.absent + d.absent, onLeave: s.onLeave + d.onLeave, workoff: s.workoff + d.workoff }),
    { present: 0, late: 0, absent: 0, onLeave: 0, workoff: 0 },
  );
  const expected = totals.present + totals.late + totals.absent;
  const pct = expected > 0 ? ((totals.present + totals.late) / expected) * 100 : null;

  // skala bar chart: populasi hari kerja per tanggal (present+late+absent+onLeave)
  const maxTotal = Math.max(1, ...trend.map((d) => d.present + d.late + d.absent + d.onLeave));
  const maxOtMinutes = Math.max(1, ...(api.data?.otByOrg ?? []).map((o) => o.minutes));

  // heatmap lookup
  const heat = new Map((api.data?.heatmap ?? []).map((c) => [`${c.dow}|${c.hour}`, c.count]));
  const maxHeat = Math.max(1, ...(api.data?.heatmap ?? []).map((c) => c.count));
  const DAYS = [1, 2, 3, 4, 5, 6, 7];
  const HOURS = Array.from({ length: 18 }, (_, i) => i + 5); // 05..22
  const dayName = (dow: number) => [t("Sen", "Mon"), t("Sel", "Tue"), t("Rab", "Wed"), t("Kam", "Thu"), t("Jum", "Fri"), t("Sab", "Sat"), t("Min", "Sun")][dow - 1] ?? String(dow);

  return (
    <div className="space-y-4">
      {/* ===== Tren Kehadiran (bar chart CSS murni) + KPI % + nav bulan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-1.5 text-[13px] font-bold">
                <TrendingUp className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Tren Kehadiran", "Attendance Trend")}
              </p>
              <p className="text-[11px] text-slate-400">{t("Stacked harian — {m} ({n} hari)", "Daily stacked — {m} ({n} days)", { m: monthLabel, n: trend.length })}</p>
            </div>
            <div className="flex items-center gap-2">
              {pct !== null && (
                <Badge variant="outline" className="border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
                  {t("Kehadiran bulan ini", "This month attendance")} {pct.toLocaleString(locale, { maximumFractionDigits: 1 })}%
                </Badge>
              )}
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onMonth(shiftMonth(month, -1))} aria-label={t("Bulan sebelumnya", "Previous month")} disabled={api.loading}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onMonth(shiftMonth(month, 1))} aria-label={t("Bulan berikutnya", "Next month")} disabled={api.loading}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          {api.loading && !api.data ? (
            <LoadingRows rows={3} />
          ) : api.error ? (
            <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
          ) : trend.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-slate-400">{t("Belum ada data rekap bulan ini.", "No recap data for this month yet.")}</p>
          ) : (
            <>
              <div className="flex h-28 items-end gap-[2px]" role="img" aria-label={t("Grafik tren kehadiran harian", "Daily attendance trend chart")}>
                {trend.map((d) => {
                  const total = d.present + d.late + d.absent + d.onLeave;
                  const title = `${fmtDate(d.date)} — ${t("Hadir {a} · Telat {b} · Absen {c} · Cuti {e} · Izin {f}", "Present {a} · Late {b} · Absent {c} · Leave {e} · Permit {f}", { a: d.present, b: d.late, c: d.absent, e: d.onLeave, f: d.workoff })}`;
                  return (
                    <div key={d.date} className="flex h-full min-w-0 flex-1 cursor-default flex-col justify-end" title={title}>
                      {total > 0 ? (
                        <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]" style={{ height: `${(total / maxTotal) * 100}%` }}>
                          <div className={cn("w-full", SEG_ONLEAVE)} style={{ height: `${(d.onLeave / total) * 100}%` }} />
                          <div className={cn("w-full", SEG_ABSENT)} style={{ height: `${(d.absent / total) * 100}%` }} />
                          <div className={cn("w-full", SEG_LATE)} style={{ height: `${(d.late / total) * 100}%` }} />
                          <div className={cn("w-full", SEG_PRESENT)} style={{ height: `${(d.present / total) * 100}%` }} />
                        </div>
                      ) : (
                        <div className="h-[3px] w-full rounded bg-slate-200 dark:bg-slate-800" />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                {[
                  { cls: SEG_PRESENT, label: t("Hadir", "Present") },
                  { cls: SEG_LATE, label: t("Telat", "Late") },
                  { cls: SEG_ABSENT, label: t("Absen", "Absent") },
                  { cls: SEG_ONLEAVE, label: t("Cuti", "Leave") },
                ].map((l) => (
                  <span key={l.label} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    <span className={cn("h-2.5 w-2.5 rounded-[3px]", l.cls)} /> {l.label}
                  </span>
                ))}
                <span className="ml-auto text-[10px] text-slate-400">{t("arahkan kursor per hari utk detail", "hover a day for details")}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ===== Heatmap Kehadiran (jam × hari) ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-5">
            <div className="mb-3">
              <p className="flex items-center gap-1.5 text-[13px] font-bold">
                <CalendarDays className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Heatmap Kehadiran", "Attendance Heatmap")}
              </p>
              <p className="text-[11px] text-slate-400">{t("Kepadatan clock-in per hari & jam ({m})", "Clock-in density by day & hour ({m})", { m: monthLabel })}</p>
            </div>
            {api.loading && !api.data ? (
              <LoadingRows rows={3} />
            ) : api.error ? (
              <p className="py-6 text-center text-[12px] text-slate-400">—</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[540px] space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="w-8 shrink-0" />
                    {HOURS.map((h) => (
                      <span key={h} className="flex-1 text-center font-mono text-[8px] text-slate-400">{String(h).padStart(2, "0")}</span>
                    ))}
                  </div>
                  {DAYS.map((dow) => (
                    <div key={dow} className="flex items-center gap-1">
                      <span className="w-8 shrink-0 text-[10px] font-bold text-slate-500 dark:text-slate-400">{dayName(dow)}</span>
                      {HOURS.map((h) => {
                        const count = heat.get(`${dow}|${h}`) ?? 0;
                        return (
                          <div
                            key={h}
                            title={t("{day} {h}:00 — {n} clock-in", "{day} {h}:00 — {n} clock-ins", { day: dayName(dow), h, n: count })}
                            className={cn("h-4 flex-1 rounded-[3px] transition", count === 0 ? "bg-slate-100 dark:bg-slate-800/70" : "bg-brand hover:ring-2 hover:ring-brand/40")}
                            style={count > 0 ? { opacity: 0.25 + 0.75 * (count / maxHeat) } : undefined}
                          />
                        );
                      })}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400">{t("sepi", "quiet")}</span>
                    {[0.15, 0.4, 0.65, 1].map((o) => (
                      <span key={o} className="h-3 w-5 rounded-sm bg-brand" style={{ opacity: o }} />
                    ))}
                    <span className="text-[10px] text-slate-400">{t("ramai (maks {n})", "busy (max {n})", { n: maxHeat })}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Biaya Lembur per Unit (money-gated) ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="flex items-center gap-1.5 text-[13px] font-bold">
                  <Clock className="h-4 w-4 ov-text-accent" aria-hidden />
                  {t("Biaya Lembur per Unit", "Overtime Cost per Unit")}
                </p>
                <p className="text-[11px] text-slate-400">{t("Menit lembur disetujui + estimasi upah — {m}", "Approved overtime minutes + pay estimate — {m}", { m: monthLabel })}</p>
              </div>
            </div>
            {api.loading && !api.data ? (
              <LoadingRows rows={3} />
            ) : api.error ? (
              <p className="py-6 text-center text-[12px] text-slate-400">—</p>
            ) : (api.data?.otByOrg ?? []).length === 0 ? (
              <p className="py-6 text-center text-[12px] text-slate-400">{t("Tidak ada lembur disetujui bulan ini.", "No approved overtime this month.")}</p>
            ) : (
              <div className="space-y-3">
                {(api.data?.otByOrg ?? []).map((o) => (
                  <div key={o.org}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate font-bold text-slate-700 dark:text-slate-300">{o.org}</span>
                      <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                        {t("{n} j", "{n} h", { n: (o.minutes / 60).toFixed(1) })}
                        {" · "}
                        {api.data?.moneyView ? (o.estPay != null ? fmtIDR(o.estPay) : "—") : t("tersembunyi", "hidden")}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(o.minutes / maxOtMinutes) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {!api.data?.moneyView && (
                  <p className="text-[10px] text-slate-400">{t("Estimasi Rp tersembunyi — butuh hak lihat nilai uang (brankas uang).", "Rp estimates hidden — requires money view rights (money vault).")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ===== Top 5 Telat ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-5">
            <div className="mb-3">
              <p className="flex items-center gap-1.5 text-[13px] font-bold">
                <TimerOff className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Top 5 Telat", "Top 5 Latecomers")}
              </p>
              <p className="text-[11px] text-slate-400">{t("Karyawan terlambat terbanyak — {m}", "Most frequently late — {m}", { m: monthLabel })}</p>
            </div>
            {(api.data?.topLate ?? []).length === 0 ? (
              <p className="py-6 text-center text-[12px] text-slate-400">{t("Tidak ada keterlambatan bulan ini 🎉", "No lateness this month 🎉")}</p>
            ) : (
              <div className="space-y-1.5">
                {(api.data?.topLate ?? []).slice(0, 5).map((e, i) => (
                  <div key={e.employeeNo} className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-extrabold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-200">{e.fullName}</p>
                      <p className="font-mono text-[10px] text-slate-400">{e.employeeNo}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                      {t("{n}x telat", "{n}x late", { n: e.count })}
                    </Badge>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-amber-600 dark:text-amber-400">{t("{n} mnt", "{n} min", { n: e.minutes })}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Sinyal Anomali & Burnout (G27/G29) ===== */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-5">
            <div className="mb-3">
              <p className="flex items-center gap-1.5 text-[13px] font-bold">
                <TriangleAlert className="h-4 w-4 ov-text-accent" aria-hidden />
                {t("Sinyal Anomali & Burnout", "Anomaly & Burnout Signals")}
              </p>
              <p className="text-[11px] text-slate-400">{t("Deteksi otomatis 30 hari terakhir — anomali presensi & beban lembur 3 bulan", "Automatic detection over the last 30 days — attendance anomalies & 3-month overtime load")}</p>
            </div>
            {anom.loading && !anom.data ? (
              <LoadingRows rows={3} />
            ) : anom.error ? (
              <ApiErrorState message={anom.error} busy={anom.loading} onRetry={anom.refresh} />
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Anomali presensi", "Attendance anomalies")}</p>
                  {(anom.data?.anomalies ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400 dark:border-slate-800">
                      {t("Tidak ada anomali terdeteksi 30 hari terakhir.", "No anomalies detected in the last 30 days.")}
                    </p>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                      {(anom.data?.anomalies ?? []).map((a, i) => (
                        <div key={`${a.employeeNo}-${a.type}-${i}`} className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={cn(
                              "text-[9px] font-bold",
                              a.severity === "tinggi" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400",
                              a.severity === "sedang" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400",
                              a.severity === "rendah" && "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
                            )}>{a.severity}</Badge>
                            <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                              {(ANOMALY_TYPE_LABEL[a.type] ?? [a.type, a.type])[getLang() === "en" ? 1 : 0]}
                            </span>
                            <span className="ml-auto truncate font-mono text-[10px] text-slate-400">{a.employeeNo} · {a.fullName}</span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{a.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <Flame className="h-3 w-3" aria-hidden /> {t("Burnout lembur (3 bulan)", "Overtime burnout (3 months)")}
                  </p>
                  {(anom.data?.burnout ?? []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400 dark:border-slate-800">
                      {t("Tidak ada indikasi burnout — beban lembur aman.", "No burnout indication — overtime load is safe.")}
                    </p>
                  ) : (
                    <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                      {(anom.data?.burnout ?? []).map((b) => (
                        <div key={b.employeeNo} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                          {b.flag && (
                            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[9px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                              {t("burnout", "burnout")}
                            </Badge>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-bold text-slate-800 dark:text-slate-200">{b.fullName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{b.employeeNo}</p>
                          </div>
                          <span className={cn("shrink-0 text-[11px] font-bold tabular-nums", b.flag ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400")}>
                            {t("≈{n} jam/bln", "≈{n} h/mo", { n: b.avgMonthlyHours })} · {t("{n} j / 3 bln", "{n} h / 3 mo", { n: Math.round(b.otMinutes3m / 60) })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
