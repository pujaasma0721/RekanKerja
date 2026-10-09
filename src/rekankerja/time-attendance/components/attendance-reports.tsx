"use client";
// RekanKerja Attendance — Laporan Attendance (padanan Laporan HR — T12-REPORTS):
// TAB "Dasbor & Rekap": KPI bulan berjalan + tren 12 bulan + komposisi status +
// top pelanggaran jadwal + rekap per karyawan & per unit kerja. Export XLSX
// multi-sheet via API.
// TAB "Reports" (T113): 12 laporan distribusi siap-cetak 4 grup — alur
// katalog → form parameter → dokumen (mirror HR T110 / Leave T112).
// Data: GET /api/rekankerja/attendance/reports?month=YYYY-MM
// Export:  GET /api/rekankerja/attendance/reports?month=...&export=kpi
import { useMemo, useState } from "react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from "recharts";
import { motion } from "framer-motion";
import {
  CalendarCheck2, Timer, XCircle, FileText, Users, Clock, TrendingUp, Download, RefreshCw,
  BarChart3, PieChart as PieIcon, UserMinus, Building2, FolderOpen,
} from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { AttendanceReportDocumentsTab } from "./report-documents/report-documents-tab";

interface KpiData {
  month: string; headcount: number; present: number; late: number; absent: number;
  workoff: number; onLeave: number; off: number; lateMinutes: number;
  workHours: number; overtimeHours: number; attendanceRate: number;
}
interface TrendRow { month: string; ym: string; present: number; absent: number; onLeave: number; off: number }
interface StatusRow { status: string; count: number }
interface ViolationRow {
  employeeNo: string; fullName: string; orgUnitName: string | null;
  lateCount: number; lateMinutes: number; absentCount: number; workoffCount: number; onLeaveCount: number;
}
interface EmployeeRow {
  employeeNo: string; fullName: string; orgUnitName: string | null;
  presentDays: number; lateDays: number; lateMinutes: number; absentDays: number;
  workoffDays: number; onLeaveDays: number; offDays: number; workHours: number; overtimeHours: number;
}
interface OrgRow {
  orgUnitName: string; headcount: number;
  presentDays: number; lateDays: number; lateMinutes: number; absentDays: number;
  workoffDays: number; onLeaveDays: number; offDays: number; workHours: number; overtimeHours: number;
}
interface ReportsData {
  generatedAt: string;
  kpi: KpiData;
  trend: TrendRow[];
  statusComposition: StatusRow[];
  topViolations: ViolationRow[];
  perEmployee: EmployeeRow[];
  perOrg: OrgRow[];
}

const CHART_COLORS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
const TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-popover)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" };

/** Padanan STATUS_COLOR di attendance-ui (ringan — tanpa import berat modul kios). */
const STATUS_COLORS: Record<string, string> = {
  Present: "#10b981", Late: "#f59e0b", Absent: "#ef4444",
  WorkOff: "#06b6d4", OnLeave: "#8b5cf6", Off: "#94a3b8", Holiday: "#f43f5e",
};
/** Label Indonesia + EN per status (padanan ATT_STATUS_LABEL di attendance-types). */
const STATUS_LABELS: Record<string, [string, string]> = {
  Present: ["Hadir", "Present"], Late: ["Telat", "Late"], Absent: ["Absen", "Absent"],
  WorkOff: ["Izin", "Permit"], OnLeave: ["Cuti", "On Leave"], Off: ["Off", "Off"], Holiday: ["Libur", "Holiday"],
};
const statusLabel = (s: string, t: (id: string, en?: string) => string) => {
  const pair = STATUS_LABELS[s];
  return pair ? t(pair[0], pair[1]) : s;
};

/** Buka unduhan export XLSX (Content-Disposition attachment — pola hr/reports).
 *  BL-5: ?lang= diteruskan — ekspor bilingual. */
function downloadExport(month: string, lang: string) {
  window.location.href = `/api/rekankerja/attendance/reports?month=${month}&export=kpi&lang=${lang}`;
}

export function AttendanceReportsPage() {
  const { t, locale, lang } = useI18n();
  const now = new Date();
  const [month, setMonth] = useState(() => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [empQuery, setEmpQuery] = useState("");

  const api = useApi<ReportsData>(`/api/rekankerja/attendance/reports?month=${month}`, [month]);
  const data = api.data;

  const fmtNum = (n: number | null | undefined) => (n ?? 0).toLocaleString(locale);

  // filter sisi klien tabel per karyawan (nama / no. karyawan / unit)
  const empRows = useMemo(() => {
    const rows = data?.perEmployee ?? [];
    const q = empQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.fullName.toLowerCase().includes(q) || r.employeeNo.toLowerCase().includes(q) ||
      (r.orgUnitName ?? "").toLowerCase().includes(q));
  }, [data, empQuery]);

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Laporan Attendance", "Attendance Reports")}
        description={t(
          "Kehadiran, keterlambatan, lembur & kepatuhan — dasbor rekap bulanan plus 12 laporan distribusi siap-cetak (parameter awal → dokumen A4).",
          "Presence, lateness, overtime & compliance — a monthly recap dashboard plus 12 distribution-ready reports (parameter form → A4 document).",
        )}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 w-40 text-xs font-bold"
            />
            <Button variant="outline" onClick={() => api.refresh()} className="gap-2 font-bold">
              <RefreshCw className="h-4 w-4" /> {t("Segarkan", "Refresh")}
            </Button>
            <Button onClick={() => downloadExport(month, lang)} className="gap-2 font-bold">
              <Download className="h-4 w-4" /> {t("Export XLSX")}
            </Button>
          </div>
        }
      />

      {/* T113 — tab atas: dasbor rekap lama + tab Reports (mirror HR/Leave) */}
      <Tabs defaultValue="dashboard">
        <TabsList className="mb-4">
          <TabsTrigger value="dashboard" className="gap-1.5 text-xs font-bold"><TrendingUp className="h-3.5 w-3.5" /> {t("Dasbor & Rekap", "Dashboard & Recap")}</TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5 text-xs font-bold"><FolderOpen className="h-3.5 w-3.5" /> {t("Reports")}</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {api.loading && !data ? (
            <LoadingRows rows={8} />
          ) : !data ? (
            <Card className="rounded-2xl"><CardContent className="p-5">
              <EmptyState title={t("Laporan belum tersedia", "Report not available")} description={api.error ?? undefined} icon={<BarChart3 className="h-6 w-6" />} />
            </CardContent></Card>
          ) : (
            <Tabs defaultValue="rekap">
          <TabsList className="mb-4">
            <TabsTrigger value="rekap" className="gap-1.5 text-xs font-bold"><TrendingUp className="h-3.5 w-3.5" /> {t("Rekap Bulan Ini", "This Month")}</TabsTrigger>
            <TabsTrigger value="karyawan" className="gap-1.5 text-xs font-bold"><Users className="h-3.5 w-3.5" /> {t("Per Karyawan", "Per Employee")}</TabsTrigger>
            <TabsTrigger value="unit" className="gap-1.5 text-xs font-bold"><Building2 className="h-3.5 w-3.5" /> {t("Per Unit Kerja", "Per Org Unit")}</TabsTrigger>
          </TabsList>

          {/* ================= TAB REKAP BULAN INI ================= */}
          <TabsContent value="rekap" className="space-y-4">
            {/* KPI cards — padanan Turnover KPI hr-reports */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: t("Tingkat Kehadiran", "Attendance Rate"), value: `${data.kpi.attendanceRate.toLocaleString(locale)}%`, sub: t("hadir / (hadir + tidak hadir)", "present / (present + absence)"), icon: CalendarCheck2, hero: true, trend: t("bulan {m}", "month {m}", { m: data.kpi.month }) },
                { label: t("Hadir (incl. Telat)", "Present (incl. Late)"), value: fmtNum(data.kpi.present), sub: t("populasi {n} karyawan terjadwal", "population of {n} scheduled employees", { n: fmtNum(data.kpi.headcount) }), icon: Users },
                { label: t("Telat", "Late"), value: fmtNum(data.kpi.late), sub: t("{n} menit total", "{n} minutes total", { n: fmtNum(data.kpi.lateMinutes) }), icon: Timer },
                { label: t("Absen + Izin + Cuti", "Absent + Permit + Leave"), value: fmtNum(data.kpi.absent + data.kpi.workoff + data.kpi.onLeave), sub: t("{a} absen · {b} izin · {c} cuti", "{a} absent · {b} permit · {c} leave", { a: data.kpi.absent, b: data.kpi.workoff, c: data.kpi.onLeave }), icon: XCircle },
                { label: t("Jam Kerja & Lembur", "Work & Overtime Hours"), value: `${fmtNum(data.kpi.workHours)} / ${fmtNum(data.kpi.overtimeHours)}`, sub: t("jam kerja / jam lembur", "work / overtime hours"), icon: Clock },
              ].map((k, i) => {
                const Icon = k.icon;
                return (
                  <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.3 }}>
                    <Card className="h-full overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{k.label}</p>
                            <p className="mt-1 text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{k.value}</p>
                            <p className="mt-0.5 text-[10px] text-slate-400">{k.sub}</p>
                          </div>
                          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", k.hero ? "ov-fill" : "ov-tile")}>
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        {k.trend && <p className="mt-2.5 border-t border-dashed border-slate-100 pt-2 text-[10px] font-bold ov-text-accent dark:border-slate-800">{k.trend}</p>}
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
              {/* tren 12 bulan — padanan Tren Hires vs Exits */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm lg:col-span-2 dark:border-slate-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-sm font-bold">{t("Tren Kehadiran — 12 Bulan", "Attendance Trend — 12 Months")}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-slate-400">{t("Hadir vs tidak hadir (absen + izin) per bulan", "Present vs absent (absent + permit) per month")}</p>
                  </div>
                  <Badge className="bg-slate-100 text-[9px] font-bold text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400">{t("12 bln", "12 mo")}</Badge>
                </CardHeader>
                <CardContent className="pt-2">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ fontWeight: 700 }} cursor={{ fill: "var(--color-muted)" }} />
                        <Bar dataKey="present" name={t("Hadir", "Present")} stackId="a" fill="var(--color-chart-1)" maxBarSize={18} />
                        <Bar dataKey="absent" name={t("Absen + Izin", "Absent + Permit")} stackId="a" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* komposisi status — donut, padanan Komposisi Gender */}
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold"><PieIcon className="h-4 w-4 ov-text-accent" /> {t("Komposisi Status", "Status Composition")}</CardTitle>
                  <p className="mt-0.5 text-[11px] text-slate-400">{t("Hari-karyawan bulan terpilih", "Employee-days of selected month")}</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.statusComposition.map((s) => ({ name: statusLabel(s.status, t), value: s.count }))} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={3} strokeWidth={0}>
                            {data.statusComposition.map((s, i) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? CHART_COLORS[i % CHART_COLORS.length]} />)}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col justify-center gap-1.5 overflow-hidden">
                      {data.statusComposition.slice(0, 7).map((s) => (
                        <div key={s.status} className="flex items-center gap-2 text-[11px]">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[s.status] ?? "var(--color-muted)" }} />
                          <span className="truncate font-semibold text-slate-700 dark:text-slate-300">{statusLabel(s.status, t)}</span>
                          <span className="ml-auto font-bold text-slate-900 dark:text-slate-100">{fmtNum(s.count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* top pelanggaran jadwal */}
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                  <p className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                    <UserMinus className="h-4 w-4 ov-text-accent" /> {t("Top 10 Pelanggaran Jadwal", "Top 10 Schedule Violations")} — {data.kpi.month}
                  </p>
                </div>
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                        <TableHead className="text-[11px] font-bold">{t("No.")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Nama")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Unit Kerja", "Org Unit")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Telat (hari)", "Late (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Telat (menit)", "Late (min)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Absen (hari)", "Absent (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Izin (hari)", "Permit (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Cuti (hari)", "Leave (days)")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topViolations.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="py-8 text-center text-xs text-slate-400">{t("Tidak ada pelanggaran jadwal bulan ini", "No schedule violations this month")}</TableCell></TableRow>
                      ) : data.topViolations.map((v, i) => (
                        <TableRow key={v.employeeNo} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="text-xs font-bold text-slate-400">{i + 1}</TableCell>
                          <TableCell className="text-xs font-bold text-slate-800 dark:text-slate-100">{v.fullName}</TableCell>
                          <TableCell className="text-xs text-slate-500">{v.orgUnitName ?? "—"}</TableCell>
                          <TableCell className={cn("text-right text-xs font-semibold tabular-nums", v.lateCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-300 dark:text-slate-600")}>{fmtNum(v.lateCount)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(v.lateMinutes)}</TableCell>
                          <TableCell className={cn("text-right text-xs font-semibold tabular-nums", v.absentCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-slate-300 dark:text-slate-600")}>{fmtNum(v.absentCount)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(v.workoffCount)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(v.onLeaveCount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= TAB PER KARYAWAN ================= */}
          <TabsContent value="karyawan" className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                value={empQuery}
                onChange={(e) => setEmpQuery(e.target.value)}
                placeholder={t("Cari nama / no. karyawan / unit…", "Search name / employee no. / unit…")}
                className="h-9 w-72 text-xs"
              />
              <span className="text-[11px] font-bold text-slate-400">{fmtNum(empRows.length)} {t("karyawan", "employees")}</span>
            </div>
            <EmployeeTable rows={empRows} t={t} locale={locale} />
          </TabsContent>

          {/* ================= TAB PER UNIT KERJA ================= */}
          <TabsContent value="unit" className="space-y-4">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-0">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                  <p className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                    <BarChart3 className="h-4 w-4 ov-text-accent" /> {t("Rekap per Unit Kerja", "Recap per Org Unit")} — {data.kpi.month}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => downloadExport(month, lang)} className="h-7 gap-1.5 px-2.5 text-[11px] font-bold">
                    <Download className="h-3.5 w-3.5" /> {t("Export XLSX")}
                  </Button>
                </div>
                <div className="max-h-[520px] overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                        <TableHead className="text-[11px] font-bold">{t("Unit Kerja", "Org Unit")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Karyawan", "Employees")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Hari Hadir", "Present Days")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Telat (hari)", "Late (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Absen (hari)", "Absent (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Izin (hari)", "Permit (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Cuti (hari)", "Leave (days)")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Off/Libur", "Off/Holiday")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Jam Kerja", "Work Hours")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Jam Lembur", "Overtime Hours")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.perOrg.length === 0 ? (
                        <TableRow><TableCell colSpan={10} className="py-8 text-center text-xs text-slate-400">{t("Belum ada data kehadiran bulan ini", "No attendance data this month")}</TableCell></TableRow>
                      ) : data.perOrg.map((r) => (
                        <TableRow key={r.orgUnitName} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.orgUnitName}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.headcount)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.presentDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtNum(r.lateDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">{fmtNum(r.absentDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.workoffDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.onLeaveDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(r.offDays)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.workHours)}</TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.overtimeHours)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* T113 — 12 laporan distribusi (katalog → parameter → dokumen A4) */}
        <TabsContent value="reports">
          <AttendanceReportDocumentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Tabel rekap per karyawan (dipakai tab Per Karyawan). */
function EmployeeTable({ rows, t, locale }: {
  rows: EmployeeRow[];
  t: (id: string, en?: string) => string;
  locale: string;
}) {
  const fmtNum = (n: number) => n.toLocaleString(locale);
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <p className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
            <FileText className="h-4 w-4 ov-text-accent" /> {t("Rekap per Karyawan", "Recap per Employee")}
          </p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                <TableHead className="text-[11px] font-bold">{t("No. Karyawan", "Employee No.")}</TableHead>
                <TableHead className="text-[11px] font-bold">{t("Nama")}</TableHead>
                <TableHead className="text-[11px] font-bold">{t("Unit Kerja", "Org Unit")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Hari Hadir", "Present Days")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Telat (hari)", "Late (days)")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Telat (menit)", "Late (min)")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Absen (hari)", "Absent (days)")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Izin (hari)", "Permit (days)")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Cuti (hari)", "Leave (days)")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Off/Libur", "Off/Holiday")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Jam Kerja", "Work Hours")}</TableHead>
                <TableHead className="text-right text-[11px] font-bold">{t("Jam Lembur", "Overtime Hours")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={12} className="py-8 text-center text-xs text-slate-400">{t("Tidak ada data yang cocok", "No matching data")}</TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.employeeNo} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <TableCell className="whitespace-nowrap text-xs font-bold text-slate-600 dark:text-slate-300">{r.employeeNo}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-bold text-slate-800 dark:text-slate-100">{r.fullName}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-slate-500">{r.orgUnitName ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.presentDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmtNum(r.lateDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(r.lateMinutes)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">{fmtNum(r.absentDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.workoffDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.onLeaveDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-500">{fmtNum(r.offDays)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.workHours)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{fmtNum(r.overtimeHours)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
