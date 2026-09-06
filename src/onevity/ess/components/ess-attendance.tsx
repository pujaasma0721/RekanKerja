"use client";
// OneVity ESS — Presensi Saya: pemilih bulan (prev/next), statistik ringkas
// bulan, tabel hari (kategori, clock in/out, telat/cepat, menit kerja, lembur).
// Hari ini ditonjolkan dengan latar amber. Field hari dibaca defensif
// (nama kolom backend bisa varian — fallback "—").
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Fingerprint, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ESS_BASE, pickNum, pickStr, fmtClockTime } from "./ess-api";
import type { EssAttendanceData, EssRecord } from "./ess-types";

const monthISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

/** geser bulan YYYY-MM sebanyak delta bulan */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return monthISO(d);
}

function StatChip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn(
      "rounded-xl border px-3.5 py-2.5",
      accent ? "border-amber-300 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10" : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/40",
    )}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{label}</p>
      <p className={cn("mt-0.5 text-lg font-extrabold tabular-nums", accent ? "text-amber-700 dark:text-amber-400" : "text-stone-800 dark:text-stone-100")}>{value}</p>
    </div>
  );
}

export function EssAttendance() {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(() => monthISO(new Date()));
  const api = useApi<EssAttendanceData>(`${ESS_BASE}/attendance?month=${month}`, [month]);

  const currentMonth = monthISO(new Date());
  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, (m ?? 1) - 1, 1));
  }, [month, locale]);

  const summary = api.data?.summary ?? null;
  const days: EssRecord[] = api.data?.days ?? [];

  // statistik ringkas — baca defensif dari summary (nama kunci bisa varian)
  const stats = [
    { label: t("Hadir", "Present"), value: pickNum(summary, ["present", "hadir"]) },
    { label: t("Telat", "Late"), value: pickNum(summary, ["late", "telat"]) },
    { label: t("Absen", "Absent"), value: pickNum(summary, ["absent", "absen", "alpha"]) },
    { label: t("Off", "Off"), value: pickNum(summary, ["off", "dayOff"]) },
    { label: t("Cuti", "Leave"), value: pickNum(summary, ["onLeave", "leave", "cuti"]) },
    { label: t("Izin", "Permit"), value: pickNum(summary, ["permit", "izin", "workoff", "workOff"]) },
    { label: t("Lembur (jam)", "Overtime (h)"), value: pickNum(summary, ["overtimeHours", "overtime", "lembur"]), accent: true },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Presensi Saya", "My Attendance")}
        description={t("Riwaykan clock in/out, kategori hari, dan lembur per bulan.", "Your clock in/out history, day categories, and overtime per month.")}
        actions={
          <div className="flex items-center gap-1.5 rounded-xl border border-stone-200 bg-white p-1 dark:border-stone-700 dark:bg-stone-900">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Bulan sebelumnya", "Previous month")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[150px] text-center text-[13px] font-bold capitalize text-stone-700 dark:text-stone-200">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={month >= currentMonth} onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Bulan berikutnya", "Next month")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* statistik ringkas */}
      {api.loading && !api.data ? (
        <LoadingRows rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {stats.map((s) => (
            <StatChip key={s.label} label={s.label} value={s.value != null ? String(s.value) : "—"} accent={s.accent} />
          ))}
        </div>
      )}

      {/* tabel hari */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Fingerprint className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Detail Hari — {m}", "Daily Detail — {m}", { m: monthLabel })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-2 pt-0">
          {api.loading && !api.data ? (
            <div className="px-6"><LoadingRows rows={6} /></div>
          ) : api.error && !api.data ? (
            <div className="px-6 pb-2">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-10 text-center dark:border-stone-700 dark:bg-stone-900/30">
                <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
                <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-300">{t("Gagal memuat data presensi", "Failed to load attendance data")}</p>
                <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                  <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
                </Button>
              </div>
            </div>
          ) : days.length === 0 ? (
            <div className="px-6 pb-2">
              <EmptyState
                title={t("Tidak ada data bulan ini", "No data for this month")}
                description={t("Data presensi akan muncul setelah ada catatan clock atau jadwal.", "Attendance data appears once clock records or schedules exist.")}
                icon={CalendarDays}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Tanggal", "Date")}</TableHead>
                    <TableHead>{t("Kategori", "Category")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="text-right">{t("Clock In", "Clock In")}</TableHead>
                    <TableHead className="text-right">{t("Clock Out", "Clock Out")}</TableHead>
                    <TableHead className="text-right">{t("Telat / Cepat", "Late / Early")}</TableHead>
                    <TableHead className="text-right">{t("Menit Kerja", "Work Minutes")}</TableHead>
                    <TableHead className="text-right">{t("Lembur", "Overtime")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((d, i) => {
                    const dateStr = pickStr(d, ["date", "day", "tanggal"]);
                    const isToday = !!dateStr && dateStr.slice(0, 10) === todayISO();
                    const late = pickNum(d, ["lateMinutes", "late", "telat"]);
                    const early = pickNum(d, ["earlyMinutes", "early", "cepat"]);
                    const inTime = pickStr(d, ["clockIn", "in", "checkIn", "inTime"]);
                    const outTime = pickStr(d, ["clockOut", "out", "checkOut", "outTime"]);
                    const status = pickStr(d, ["status"]);
                    return (
                      <TableRow key={(dateStr ?? "") + i} className={cn(isToday && "bg-amber-50/70 dark:bg-amber-500/10")}>
                        <TableCell>
                          <span className={cn("text-[12.5px] font-semibold", isToday ? "font-extrabold text-amber-800 dark:text-amber-300" : "text-stone-700 dark:text-stone-300")}>
                            {dateStr ? fmtDate(dateStr) : "—"}
                          </span>
                          {isToday && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">{t("Hari ini", "Today")}</span>}
                        </TableCell>
                        <TableCell>
                          <span className="text-[12px] font-medium text-stone-500 dark:text-stone-400">
                            {pickStr(d, ["category", "kategori", "dayType", "type"]) ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>{status ? <StatusPill status={status} /> : <span className="text-[12px] text-stone-300 dark:text-stone-600">—</span>}</TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-stone-600 dark:text-stone-300">{inTime ? fmtClockTime(inTime, locale) : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-[12px] tabular-nums text-stone-600 dark:text-stone-300">{outTime ? fmtClockTime(outTime, locale) : "—"}</TableCell>
                        <TableCell className="text-right">
                          {late != null && late > 0 ? (
                            <span className="text-[12px] font-bold tabular-nums text-rose-600 dark:text-rose-400">+{late}′</span>
                          ) : early != null && early > 0 ? (
                            <span className="text-[12px] font-bold tabular-nums text-teal-600 dark:text-teal-400">−{early}′</span>
                          ) : (
                            <span className="text-[12px] tabular-nums text-stone-300 dark:text-stone-600">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-[12px] tabular-nums text-stone-600 dark:text-stone-300">{pickNum(d, ["workMinutes", "work", "minutes", "menitKerja"]) ?? "—"}</TableCell>
                        <TableCell className="text-right text-[12px] font-semibold tabular-nums text-amber-700 dark:text-amber-400">{pickNum(d, ["overtimeMinutes", "overtime", "ot"]) ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
