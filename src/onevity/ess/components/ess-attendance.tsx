"use client";
// OneVity ESS — Presensi Saya (REFACTOR: kalender bulanan interaktif):
// chip statistik + KALENDER warna status per hari (klik hari → panel detail)
// + riwayat harian ringkas (mobile-friendly, bukan tabel lebar) + legenda.
// Navigasi bulan prev/next; hari ini bertanda; i18n penuh.
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, RotateCcw, Loader2, AlertTriangle, Fingerprint, CalendarDays, Clock3, Timer, TrendingUp, LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ESS_BASE } from "./ess-api";
import type { EssAttendanceData, EssRecord } from "./ess-types";

const monthISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/** geser bulan YYYY-MM sebanyak delta bulan */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return monthISO(d);
}

// ============ peta warna status (konsisten, aksen amber utk hari ini) ============
const STATUS_META: Record<string, { id: string; en: string; cell: string; dot: string }> = {
  Present: { id: "Hadir", en: "Present", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  Late: { id: "Telat", en: "Late", cell: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-400", dot: "bg-amber-500" },
  Absent: { id: "Absen", en: "Absent", cell: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-400", dot: "bg-rose-500" },
  Off: { id: "Libur", en: "Off", cell: "bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-500", dot: "bg-slate-300" },
  OnLeave: { id: "Cuti", en: "Leave", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  WorkOff: { id: "Izin", en: "Permit", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  Holiday: { id: "Hari Libur", en: "Holiday", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  "Non-clocking": { id: "Non-clocking", en: "Non-clocking", cell: "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400", dot: "bg-slate-400" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { id: status, en: status, cell: "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400", dot: "bg-slate-400" };
}

const fmtMin = (m: number | null | undefined, t: (id: string, en: string) => string) => {
  if (!m) return "—";
  if (m < 60) return `${Math.round(m)} ${t("mnt", "min")}`;
  return `${Math.floor(m / 60)} ${t("jam", "h")} ${Math.round(m % 60) ? `${Math.round(m % 60)} ${t("mnt", "min")}` : ""}`.trim();
};

export function EssAttendance() {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(() => monthISO(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  const api = useApi<EssAttendanceData>(`${ESS_BASE}/attendance?month=${month}`, [month]);

  const currentMonth = monthISO(new Date());
  const isCurrent = month === currentMonth;
  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, (m ?? 1) - 1, 1));
  }, [month, locale]);

  const summary = api.data?.summary ?? null;
  const days: EssRecord[] = api.data?.days ?? [];
  const byDate = useMemo(() => new Map(days.map((d) => [String(d.date ?? ""), d])), [days]);

  const selectedDay = selected ? byDate.get(selected) ?? null : null;

  // kalender Senin-kolom-pertama
  const calendar = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, (m ?? 1) - 1, 1);
    const daysInMonth = new Date(y, m ?? 12, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells: ({ date: string; day: number; rec?: EssRecord } | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date, day: d, rec: byDate.get(date) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month, byDate]);

  const dayHeaders = useMemo(() => {
    const base = new Date(2024, 0, 1); // Senin
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(1 + i);
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
    });
  }, [locale]);

  const stats = [
    { label: t("Hadir", "Present"), value: summary ? String(summary.present ?? 0) : "—", accent: "text-brand dark:text-brand/85", icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { label: t("Telat", "Late"), value: summary ? String(summary.late ?? 0) : "—", accent: "text-amber-600 dark:text-amber-400", icon: <Timer className="h-3.5 w-3.5" /> },
    { label: t("Absen", "Absent"), value: summary ? String(summary.absent ?? 0) : "—", accent: "text-rose-600 dark:text-rose-400", icon: <Clock3 className="h-3.5 w-3.5" /> },
    { label: t("Cuti / Izin", "Leave / Permit"), value: summary ? String((Number(summary.onLeave ?? 0) + Number(summary.workoff ?? 0))) : "—", accent: "text-brand dark:text-brand/85", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { label: t("Lembur", "Overtime"), value: summary ? `${summary.overtimeHours ?? 0} ${t("jam", "h")}` : "—", accent: "text-amber-700 dark:text-amber-400", icon: <Clock3 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Presensi Saya", "My Attendance")}
        description={t("Kalender kehadiran, jam kerja, dan lembur per bulan.", "Attendance calendar, work hours, and overtime per month.")}
        actions={
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }} aria-label={t("Bulan sebelumnya", "Previous month")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[130px] text-center text-[13px] font-bold capitalize text-slate-700 dark:text-slate-200">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={month >= currentMonth} onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }} aria-label={t("Bulan berikutnya", "Next month")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrent && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-lg px-2 text-[11px] font-bold" onClick={() => { setMonth(currentMonth); setSelected(null); }}>
                <RotateCcw className="h-3 w-3" /> {t("Bulan ini", "This month")}
              </Button>
            )}
          </div>
        }
      />

      {/* ===== statistik ringkas ===== */}
      {api.loading && !api.data ? (
        <LoadingRows rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className={s.accent}>{s.icon}</span> {s.label}
              </p>
              <p className={cn("mt-1 text-lg font-extrabold tabular-nums", s.accent)}>{s.value}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* ===== kalender bulanan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Fingerprint className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Kalender Kehadiran — {m}", "Attendance Calendar — {m}", { m: monthLabel })}
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-slate-400">{t("Klik hari berwarna untuk detail clock in/out & lembur.", "Click a colored day for clock in/out & overtime details.")}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 sm:px-5">
          {api.loading && !api.data ? (
            <LoadingRows rows={5} />
          ) : api.error && !api.data ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
              <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat data presensi", "Failed to load attendance data")}</p>
              <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
              </Button>
            </div>
          ) : (
            <>
              {/* header hari */}
              <div className="mb-2 grid grid-cols-7 gap-1.5 sm:gap-2">
                {dayHeaders.map((d) => (
                  <p key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</p>
                ))}
              </div>
              {/* grid hari */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {calendar.map((cell, i) => {
                  if (!cell) return <div key={`e${i}`} aria-hidden />;
                  const rec = cell.rec;
                  const meta = rec ? statusMeta(String(rec.status ?? "")) : null;
                  const isToday = cell.date === todayISO();
                  const isSel = cell.date === selected;
                  const future = cell.date > todayISO();
                  return (
                    <button
                      key={cell.date}
                      onClick={() => { if (rec) setSelected(isSel ? null : cell.date); }}
                      disabled={!rec}
                      className={cn(
                        "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-center transition-all",
                        isSel && "ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-950",
                        isToday && "border-amber-400 font-extrabold dark:border-amber-500/50",
                        rec
                          ? cn(meta!.cell, "cursor-pointer hover:scale-[1.04] hover:shadow-md")
                          : future
                            ? "border-dashed border-slate-200 text-slate-300 dark:border-slate-700 dark:text-slate-600"
                            : "border-slate-200/70 bg-slate-50/40 text-slate-400 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-600",
                      )}
                      title={rec ? `${meta?.id ?? rec.status}${rec.clockIn ? ` · in ${rec.clockIn}` : ""}` : undefined}
                    >
                      <span className="text-sm tabular-nums sm:text-base">{cell.day}</span>
                      {rec && <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", meta!.dot)} aria-hidden />}
                      {isToday && (
                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 text-[8px] font-extrabold uppercase text-white">
                          {t("ini", "now")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* legenda */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800/70">
                {["Present", "Late", "Absent", "OnLeave", "WorkOff", "Off"].map((s) => {
                  const m = statusMeta(s);
                  return (
                    <span key={s} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className={cn("h-2 w-2 rounded-full", m.dot)} aria-hidden /> {t(m.id, m.en)}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== detail hari terpilih ===== */}
      <AnimatePresence mode="wait">
        {selectedDay && (
          <motion.div
            key={String(selectedDay.date)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="rounded-2xl border-amber-500/25 shadow-md dark:border-amber-500/20">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                      {selectedDay.date ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${String(selectedDay.date).slice(0, 10)}T00:00:00`)) : "—"}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      {t("Kategori hari", "Day category")}: {String(selectedDay.category ?? selectedDay.dayTypeCode ?? "—")}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold", statusMeta(String(selectedDay.status ?? "")).cell)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta(String(selectedDay.status ?? "")).dot)} aria-hidden />
                    {t(statusMeta(String(selectedDay.status ?? "")).id, statusMeta(String(selectedDay.status ?? "")).en)}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: t("Clock In", "Clock In"), v: selectedDay.clockIn ? String(selectedDay.clockIn) : "—", icon: <LogIn className="h-3 w-3" /> },
                    { l: t("Clock Out", "Clock Out"), v: selectedDay.clockOut ? String(selectedDay.clockOut) : "—", icon: <LogOut className="h-3 w-3" /> },
                    { l: t("Jam Kerja", "Work Time"), v: fmtMin(selectedDay.workMinutes as number | null ?? null, t), icon: <Clock3 className="h-3 w-3" /> },
                    { l: t("Lembur", "Overtime"), v: fmtMin(selectedDay.overtimeMinutes as number | null ?? null, t), icon: <Timer className="h-3 w-3" /> },
                    { l: t("Telat", "Late"), v: (selectedDay.lateMinutes as number | undefined) ? `+${fmtMin(selectedDay.lateMinutes as number, t)}` : "—", icon: <Timer className="h-3 w-3" /> },
                    { l: t("Pulang Cepat", "Early Out"), v: (selectedDay.earlyMinutes as number | undefined) ? `−${fmtMin(selectedDay.earlyMinutes as number, t)}` : "—", icon: <Clock3 className="h-3 w-3" /> },
                  ].map((x) => (
                    <div key={x.l} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{x.icon} {x.l}</p>
                      <p className="mt-0.5 font-mono text-[13px] font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{x.v}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== riwayat harian (daftar ringkas — ramah mobile) ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarDays className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Riwayat Harian — {m}", "Daily History — {m}", { m: monthLabel })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-0 sm:px-4">
          {api.loading && !api.data ? (
            <div className="px-2"><LoadingRows rows={5} /></div>
          ) : days.length === 0 ? (
            <EmptyState
              title={t("Tidak ada data bulan ini", "No data for this month")}
              description={t("Data presensi akan muncul setelah ada catatan clock atau jadwal.", "Attendance data appears once clock records or schedules exist.")}
              icon={CalendarDays}
            />
          ) : (
            <div className="max-h-[380px] overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar]:w-1.5">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {[...days].reverse().map((d, i) => {
                  const dateStr = String(d.date ?? "");
                  const isToday = dateStr.slice(0, 10) === todayISO();
                  const meta = statusMeta(String(d.status ?? ""));
                  const late = (d.lateMinutes as number | undefined) ?? 0;
                  const early = (d.earlyMinutes as number | undefined) ?? 0;
                  const inTime = d.clockIn ? String(d.clockIn) : null;
                  const outTime = d.clockOut ? String(d.clockOut) : null;
                  const ot = (d.overtimeMinutes as number | undefined) ?? 0;
                  return (
                    <li key={dateStr || i}>
                      <button
                        onClick={() => setSelected(selected === dateStr ? null : dateStr)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60",
                          selected === dateStr && "bg-amber-50/70 dark:bg-amber-500/10",
                          isToday && "font-bold",
                        )}
                      >
                        <div className="w-20 shrink-0 sm:w-24">
                          <p className={cn("text-[12.5px] font-bold", isToday ? "text-amber-800 dark:text-amber-300" : "text-slate-700 dark:text-slate-300")}>
                            {dateStr ? fmtDate(dateStr) : "—"}
                          </p>
                          {isToday && <span className="rounded-full bg-amber-500 px-1.5 text-[8px] font-extrabold uppercase text-white">{t("ini", "now")}</span>}
                        </div>
                        <span className="hidden min-w-0 flex-1 gap-4 sm:flex">
                          <span className="font-mono text-[11.5px] tabular-nums text-slate-500 dark:text-slate-400">
                            {inTime ?? "—:—"} → {outTime ?? "—:—"}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {(d.workMinutes as number | undefined) ? fmtMin(d.workMinutes as number, t) : "—"}
                          </span>
                        </span>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          {late > 0 && <span className="text-[11px] font-bold tabular-nums text-rose-600 dark:text-rose-400">+{fmtMin(late, t)}</span>}
                          {early > 0 && <span className="hidden text-[11px] font-bold tabular-nums text-brand dark:text-brand/85 sm:inline">−{fmtMin(early, t)}</span>}
                          {ot > 0 && <span className="text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-400">{t("lem", "OT")} {fmtMin(ot, t)}</span>}
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", meta.cell)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden /> {t(meta.id, meta.en)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
