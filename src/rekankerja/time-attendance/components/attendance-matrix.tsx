"use client";
// RekanKerja Attendance — Matriks Jadwal: karyawan × 7 hari (padanan Employee
// Schedule Matrix) dengan warna day type.
// Task 100-impl-B (F0): error state useApi + Coba Lagi (G10), header pekan
// format locale (B-7), dan navigasi/default pekan zona LOKAL (B-10 —
// toISOString membuat Senin-default bergeser ke Minggu & tombol Prev/Next
// mundur 6 hari di WIB).
import { useState } from "react";
import { useApi, fmtDate } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MatrixRow, DAY_CATEGORY_LABEL, DAY_CATEGORY_LABEL_EN } from "@/rekankerja/time-attendance/components/attendance-types";
import { ApiErrorState, isoLocal } from "@/rekankerja/time-attendance/components/attendance-ui";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Layers, ChevronLeft, ChevronRight, CalendarRange, CalendarDays, Search } from "lucide-react";
import { cn } from "@/lib/utils";

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
// B-10: zona lokal —Senin-default & navigasi ±7 hari akurat di semua zona.
const iso = (d: Date) => isoLocal(d);
const shiftDate = (isoDate: string, days: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
};

export function AttendanceMatrixPage() {
  const { navigate } = useNav();
  const { t, locale } = useI18n();
  const [from, setFrom] = useState(iso(mondayOf(new Date())));
  const [query, setQuery] = useState("");
  // Task 103-e (B-16): server mengirim date ISO mentah — label kolom hari
  // diformat CLIENT dengan locale aktif (bukan toLocaleDateString id-ID server).
  const api = useApi<{ from: string; days: { date: string }[]; rows: MatrixRow[]; total: number }>(`/api/rekankerja/attendance/matrix?from=${from}`);

  const rows = (api.data?.rows ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.employeeNo.toLowerCase().includes(query.toLowerCase())
  );
  const days = api.data?.days ?? [];
  const unassigned = (api.data?.rows ?? []).filter((r) => !r.assigned).length;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Matriks Jadwal Karyawan", "Employee Schedule Matrix")}
        description={t("Day type efektif per karyawan × 7 hari — padanan Employee Schedule Matrix", "Effective day type per employee × 7 days — counterpart of Employee Schedule Matrix")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFrom(iso(shiftDate(from, -7)))} className="gap-1" aria-label={t("Minggu sebelumnya", "Previous week")}>
              <ChevronLeft className="h-4 w-4" /> {t("Sebelumnya", "Prev")}
            </Button>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 text-xs" />
            <Button variant="outline" size="sm" onClick={() => setFrom(iso(shiftDate(from, 7)))} className="gap-1" aria-label={t("Minggu berikutnya", "Next week")}>
              {t("Berikutnya", "Next")} <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <Layers className="h-4 w-4 ov-text-accent" />
              <p className="text-[13px] font-bold">{t("Pekan {a} — {b} · {n} karyawan", "Week {a} — {b} · {n} employees", { a: fmtDate(from), b: fmtDate(shiftDate(from, 6)), n: api.data?.total ?? 0 })}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employee…")} className="h-8 w-48 pl-8 text-xs" />
              </div>
            </div>
          </div>

          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : api.error ? (
            <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
          ) : rows.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada karyawan aktif", "No active employees yet")} description={t("Assign jadwal untuk melihat matriks.", "Assign schedules to view the matrix.")} icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="min-w-52 text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    {days.map((d) => (
                      <TableHead key={d.date} className="min-w-24 text-center text-[10px] font-bold uppercase">
                        {new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "short" }).format(new Date(`${d.date}T00:00:00`))}
                      </TableHead>
                    ))}
                    <TableHead className="text-[11px] font-bold">{t("Wajib Clocking", "Clocking Required")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 80).map((r) => (
                    <TableRow key={r.employeeId} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", !r.assigned && "opacity-60")}>
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                      </TableCell>
                      {r.cells.map((c) => (
                        <TableCell key={c.date} className="p-1.5 text-center">
                          {c.holiday ? (
                            // T9-HOLIDAY: sel tanggal libur — merah bata + nama libur
                            <div
                              className="rounded-lg border border-rose-400 bg-rose-500/90 px-1.5 py-1.5 text-white"
                              title={`${c.holiday.name}${c.holiday.kind === "Joint" ? t(" (cuti bersama)", " (joint leave)") : c.holiday.kind === "Company" ? t(" (libur perusahaan)", " (company holiday)") : ""}`}
                            >
                              <p className="text-[10px] font-extrabold">{t("LIBUR", "HOL")}</p>
                              <p className="hidden truncate text-[8px] font-medium text-rose-50 sm:block" title={c.holiday.name}>{c.holiday.name}</p>
                            </div>
                          ) : c.code ? (
                            <div
                              className="rounded-lg border px-1.5 py-1.5"
                              style={{ backgroundColor: (c.color ?? "#E7E5E4") + "55", borderColor: (c.color ?? "#E7E5E4") }}
                              title={`${c.name} (${c.category ? t(DAY_CATEGORY_LABEL[c.category] ?? c.category, DAY_CATEGORY_LABEL_EN[c.category] ?? c.category) : "—"})`}
                            >
                              <p className="text-[10px] font-extrabold text-slate-800 dark:text-slate-200">{c.code}</p>
                              <p className="hidden text-[8px] font-medium text-slate-500 sm:block">{c.category === "Off" ? t("LIBUR", "OFF") : c.code === "OFFICE" ? t("KANTOR", "OFFICE") : ""}</p>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-300 py-1.5 text-[10px] font-bold text-slate-400 dark:border-slate-700" title={t("Tidak ada jadwal", "No schedule")}>
                              —
                            </div>
                          )}
                        </TableCell>
                      ))}
                      <TableCell>
                        <span className={cn("text-[10px] font-bold", r.clockingRequired ? "text-brand dark:text-brand/85" : "text-slate-400")}>
                          {r.clockingRequired ? t("Wajib", "Required") : t("Non-clocking", "Non-clocking")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {(api.data?.rows.length ?? 0) > 80 && (
            <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400 dark:border-slate-800">
              {t("Menampilkan 80 dari {n} karyawan — gunakan pencarian untuk memfilter.", "Showing 80 of {n} employees — use search to filter.", { n: api.data?.rows.length ?? 0 })}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              {legend(t).map((l) => (
                <span key={l.code} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  <span className={cn("h-2.5 w-2.5 rounded-full", l.holiday && "bg-rose-500")} style={l.holiday ? undefined : { backgroundColor: l.color }} /> {l.code}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {unassigned > 0 && (
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-bold text-amber-600" onClick={() => navigate("attendance", "assignment-schedule")}>
                  {t("{n} karyawan belum ter-assign →", "{n} employees not yet assigned →", { n: unassigned })}
                </Button>
              )}
              {/* T9-HOLIDAY: navigasi internal ke kalender libur */}
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-bold text-rose-600 dark:text-rose-400" onClick={() => navigate("attendance", "holidays")}>
                <CalendarDays className="h-3.5 w-3.5" /> {t("Kalender Libur →", "Holiday Calendar →")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function legend(t: (id: string, en: string) => string) {
  // Task 103-e — entri bercampur ID/EN ("OFF/Off", "HOLIDAY/Libur") → t() dua-argumen.
  return [
    { code: "OFFICE", color: "#99CCFF" }, { code: "FLEX", color: "#E7E5E4" },
    { code: "SHIFT1", color: "#A7F3D0" }, { code: "SHIFT2", color: "#FDE68A" },
    { code: "SHIFT3", color: "#C7D2FE" }, { code: t("OFF/Libur", "OFF/Off"), color: "#FCA5A5" },
    { code: t("HOLIDAY/Libur", "HOLIDAY/Holiday"), color: "#F87171", holiday: true },
  ];
}
