"use client";
// Absensi Saya — punch clock + kalender bulanan (chip status per hari) +
// navigasi bulan + statistik + daftar detail hari (klik hari → sorot).
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, RotateCcw, CalendarCheck2, Clock3, Timer, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { EmptyState } from "@/onevity/shared/components/ui-kit";
import { EssSection, PunchCard, attStatusMeta, fmtTime, fmtMinutes, PageSkeleton } from "@/onevity/ess/components/ess-ui";
import { cn } from "@/lib/utils";

interface AttendanceData {
  month: { year: number; month: number; label: string; isCurrent: boolean };
  today: { date: string; dayName: string | null; dayCode: string | null; timeIn: string | null; timeOut: string | null; clockingRequired: boolean };
  rows: {
    date: string; dayCode: string | null; dayName: string | null; dayColor: string | null; category: string | null;
    status: string; checkIn: string | null; checkOut: string | null;
    lateMinutes: number; earlyMinutes: number; workMinutes: number; normalMinutes: number; overtimeMinutes: number; notes: string | null;
  }[];
  recap: {
    scheduledDays: number; presentDays: number; lateCount: number; lateMinutes: number;
    absentDays: number; leavePaidDays: number; leaveUnpaidDays: number; offDays: number;
    workoffPaidDays: number; overtimeMinutes: number; normalMinutes: number;
  } | null;
}

const DAY_HEADERS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

function monthParam(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function EssAttendance() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh, setData } = useApi<AttendanceData>(
    `/api/ess/attendance?month=${monthParam(ym.y, ym.m)}`,
    [ym.y, ym.m],
  );

  const isCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth() + 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const goMonth = (delta: number) => {
    const d = new Date(ym.y, ym.m - 1 + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setSelected(null);
  };

  // grid kalender: Senin sebagai kolom pertama
  const calendar = useMemo(() => {
    if (!data) return [];
    const first = new Date(ym.y, ym.m - 1, 1);
    const daysInMonth = new Date(ym.y, ym.m, 0).getDate();
    const offset = (first.getDay() + 6) % 7; // Sen=0 … Min=6
    const byDate = new Map(data.rows.map((r) => [r.date, r]));
    const cells: ({ date: string; day: number; row?: AttendanceData["rows"][number] } | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${ym.y}-${String(ym.m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date, day: d, row: byDate.get(date) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [data, ym]);

  const selectedRow = data?.rows.find((r) => r.date === selected) ?? null;

  const onClock = async (direction: "IN" | "OUT") => {
    try {
      const res = await apiSend<{ ok: boolean; direction: string; time: string; today: { status: string; checkIn: string | null; checkOut: string | null } | null }>(
        "/api/ess/attendance/clock", "POST", { direction },
      );
      toast.success(`${res.direction === "IN" ? "Clock-in" : "Clock-out"} tercatat pukul ${new Date(res.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`);
      if (data && res.today) {
        setData({
          ...data,
          rows: data.rows.map((r) => r.date === res.today!.date ? { ...r, status: res.today!.status, checkIn: res.today!.checkIn, checkOut: res.today!.checkOut } : r),
        });
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat absensi");
    }
  };

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <EmptyState title="Gagal memuat absensi" description={error} icon={<CalendarCheck2 className="h-6 w-6" />} />;

  const monthNames = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" });
  const statItems = data?.recap ? [
    { label: "Hadir", value: `${data.recap.presentDays} hari`, accent: "text-emerald-600 dark:text-emerald-400", icon: <CalendarCheck2 className="h-3.5 w-3.5" /> },
    { label: "Terlambat", value: `${data.recap.lateCount}× · ${fmtMinutes(data.recap.lateMinutes)}`, accent: "text-amber-600 dark:text-amber-400", icon: <Timer className="h-3.5 w-3.5" /> },
    { label: "Absen", value: `${data.recap.absentDays} hari`, accent: "text-rose-600 dark:text-rose-400", icon: <Clock3 className="h-3.5 w-3.5" /> },
    { label: "Cuti dibayar", value: `${data.recap.leavePaidDays} hari`, accent: "text-teal-600 dark:text-teal-400", icon: <TrendingUp className="h-3.5 w-3.5" /> },
  ] : [];

  return (
    <div className="space-y-6">
      {/* punch clock hari ini */}
      <PunchCard
        today={data?.today ? { ...data.today, status: data.rows.find((r) => r.date === todayStr)?.status ?? null, checkIn: data.rows.find((r) => r.date === todayStr)?.checkIn ?? null, checkOut: data.rows.find((r) => r.date === todayStr)?.checkOut ?? null, lateMinutes: data.rows.find((r) => r.date === todayStr)?.lateMinutes ?? 0, workMinutes: data.rows.find((r) => r.date === todayStr)?.workMinutes ?? 0 } : null}
        onClock={onClock}
      />

      {/* ===== kalender bulanan ===== */}
      <EssSection
        title="Kalender Kehadiran"
        description={data?.month.label ?? monthNames.format(new Date(ym.y, ym.m - 1))}
        icon={<CalendarCheck2 />}
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => goMonth(-1)} aria-label="Bulan sebelumnya">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg px-3 text-xs font-semibold" disabled={isCurrentMonth} onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() + 1 }); setSelected(null); }}>
              {!isCurrentMonth && <RotateCcw className="mr-1 h-3 w-3" />} Bulan ini
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => goMonth(1)} aria-label="Bulan berikutnya">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-4 sm:p-5">
            {/* header hari */}
            <div className="mb-2 grid grid-cols-7 gap-1.5 sm:gap-2">
              {DAY_HEADERS.map((d) => (
                <p key={d} className="text-center text-[10px] font-semibold uppercase tracking-wide text-stone-400">{d}</p>
              ))}
            </div>
            {/* grid hari */}
            <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
              {calendar.map((cell, i) => {
                if (!cell) return <div key={`e${i}`} />;
                const meta = cell.row ? attStatusMeta(cell.row.status) : null;
                const isToday = cell.date === todayStr;
                const isSel = cell.date === selected;
                const future = cell.date > todayStr;
                return (
                  <button
                    key={cell.date}
                    onClick={() => cell.row && setSelected(isSel ? null : cell.date)}
                    className={cn(
                      "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-center transition-all",
                      isSel ? "ring-2 ring-emerald-500 ring-offset-1 dark:ring-offset-stone-950" : "",
                      isToday ? "border-emerald-400 font-bold dark:border-emerald-500/50" : "",
                      cell.row
                        ? cn(meta!.cell, "hover:scale-[1.04] hover:shadow-md cursor-pointer")
                        : future
                          ? "border-dashed border-stone-200 text-stone-300 dark:border-stone-700 dark:text-stone-600"
                          : "border-stone-200/70 bg-stone-50/40 text-stone-400 dark:border-stone-800 dark:bg-stone-900/30 dark:text-stone-600",
                    )}
                    title={cell.row ? `${cell.row.status}${cell.row.checkIn ? ` · in ${fmtTime(cell.row.checkIn)}` : ""}` : undefined}
                  >
                    <span className="text-sm tabular-nums sm:text-base">{cell.day}</span>
                    {cell.row && <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", meta!.dot)} />}
                    {isToday && <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-1.5 text-[8px] font-bold uppercase text-white">ini</span>}
                  </button>
                );
              })}
            </div>

            {/* legenda */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-stone-100 pt-3 dark:border-stone-800/70">
              {["Present", "Late", "Absent", "OnLeave", "Off", "Holiday"].map((s) => {
                const m = attStatusMeta(s);
                return (
                  <span key={s} className="flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                    <span className={cn("h-2 w-2 rounded-full", m.dot)} /> {m.label}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </EssSection>

      {/* ===== statistik bulan ===== */}
      {statItems.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {statItems.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-stone-200/80 bg-card p-4 shadow-sm dark:border-stone-800"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">
                <span className={s.accent}>{s.icon}</span> {s.label}
              </p>
              <p className={cn("mt-1 text-base font-bold tracking-tight", s.accent)}>{s.value}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* ===== detail hari terpilih ===== */}
      <AnimatePresence mode="wait">
        {selectedRow && (
          <motion.div
            key={selectedRow.date}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                      {new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(selectedRow.date + "T00:00:00"))}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{selectedRow.dayName ?? "Tanpa jadwal"}</p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", attStatusMeta(selectedRow.status).cell)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", attStatusMeta(selectedRow.status).dot)} />
                    {attStatusMeta(selectedRow.status).label}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: "Clock In", v: fmtTime(selectedRow.checkIn) },
                    { l: "Clock Out", v: fmtTime(selectedRow.checkOut) },
                    { l: "Jam Kerja", v: fmtMinutes(selectedRow.workMinutes) },
                    { l: "Lembur", v: fmtMinutes(selectedRow.overtimeMinutes) },
                    { l: "Terlambat", v: selectedRow.lateMinutes > 0 ? fmtMinutes(selectedRow.lateMinutes) : "—" },
                    { l: "Pulang Cepat", v: selectedRow.earlyMinutes > 0 ? fmtMinutes(selectedRow.earlyMinutes) : "—" },
                    { l: "Normal", v: fmtMinutes(selectedRow.normalMinutes) },
                    { l: "Keterangan", v: selectedRow.notes ?? "—" },
                  ].map((x) => (
                    <div key={x.l} className="rounded-lg bg-stone-50 p-3 dark:bg-stone-900/50">
                      <p className="text-[11px] font-medium text-stone-400">{x.l}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-100">{x.v}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== daftar hari ===== */}
      <EssSection title="Riwayat Harian" description="Klik hari pada kalender untuk melihat detail">
        <Card className="border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-2">
            {data && data.rows.length > 0 ? (
              <div className="max-h-96 overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar]:w-1.5">
                <ul className="divide-y divide-stone-100 dark:divide-stone-800/70">
                  {[...data.rows].reverse().map((r) => {
                    const m = attStatusMeta(r.status);
                    return (
                      <li key={r.date}>
                        <button
                          onClick={() => setSelected(selected === r.date ? null : r.date)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-stone-50 dark:hover:bg-stone-900/50",
                            selected === r.date && "bg-emerald-50/70 dark:bg-emerald-500/10",
                          )}
                        >
                          <div className="w-24 shrink-0">
                            <p className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                              {new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(r.date + "T00:00:00"))}
                            </p>
                            <p className="text-[10px] text-stone-400">{new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(new Date(r.date + "T00:00:00"))}</p>
                          </div>
                          <div className="hidden min-w-0 flex-1 gap-4 sm:flex">
                            <span className="font-mono text-xs tabular-nums text-stone-500 dark:text-stone-400">{fmtTime(r.checkIn)} → {fmtTime(r.checkOut)}</span>
                            <span className="truncate text-xs text-stone-500 dark:text-stone-400">{r.workMinutes > 0 ? fmtMinutes(r.workMinutes) : "—"}</span>
                          </div>
                          <div className="ml-auto flex items-center gap-2">
                            {r.lateMinutes > 0 && <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">+{fmtMinutes(r.lateMinutes)}</span>}
                            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold", m.cell)}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} /> {m.label}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <EmptyState title="Belum ada data bulan ini" description="Absensi akan muncul setelah clock-in pertama Anda." icon={<CalendarCheck2 className="h-6 w-6" />} />
            )}
          </CardContent>
        </Card>
      </EssSection>
    </div>
  );
}
