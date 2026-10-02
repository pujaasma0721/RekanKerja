"use client";
// RekanKerja Leave — Laporan: siapa sedang cuti (Query Emp on Leave) + ringkasan per jenis
// (padanan History: Summary Based on Leave Type / Employee).
// Task 99 (F1-3/F1-4) — toggle Tabel | Kalender: tabel + Export CSV; kalender
// bulanan (grid murni CSS, tanpa lib) + filter unit + unduh ICS.
import { useMemo, useState } from "react";
import { useApi, initials } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SESSION_LABEL, SESSION_LABEL_EN, fmtDay } from "./leave-types";
import { BarChart3, CalendarSearch, CalendarDays, RefreshCw, Palmtree, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

const iso = (d: Date) => d.toISOString().slice(0, 10);

interface OnLeaveRow {
  id: string; docNo: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeName: string; paid: boolean;
  dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
  workingDays: number; status: string; reason: string | null;
}

interface TypeUsageRow {
  leaveTypeId: string; code: string; name: string; unit: string;
  employees: number; carriedOver: number; taken: number;
}

/** Baris kalender bulanan (GET /api/rekankerja/leave/calendar?month=&org=). */
interface CalendarRow {
  id: string; docNo: string; employeeNo: string; fullName: string;
  orgUnitName: string | null; leaveTypeName: string; paid: boolean;
  dateFrom: string; sessionFrom: string; dateTo: string; sessionTo: string;
  workingDays: number; status: string;
}

/** Key "YYYY-MM-DD" lokal (tanpa geser UTC). */
const localDayKey = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Key "YYYY-MM-DD" lokal dari string tanggal API (ISO datetime / date-only).
 *  Diparse dgn zona lokal browser — cermin toLocaleDateString pada view tabel. */
const isoToLocalKey = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : localDayKey(d.getFullYear(), d.getMonth(), d.getDate());
};

// Task 99 (F1-6) — opsi tahun dinamis (tahun berjalan −2 .. +1, bukan hardcoded).
const YEAR_OPTIONS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i);

export function LeaveReportsPage() {
  const { t, locale } = useI18n();
  const now = new Date();
  const [view, setView] = useState<"tabel" | "kalender">("tabel");
  const [from, setFrom] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [year, setYear] = useState(now.getFullYear());
  // kalender — bulan aktif (tanggal 1) + filter unit ("" = semua)
  const [calMonth, setCalMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [calOrg, setCalOrg] = useState("");

  const api = useApi<{ window: { from: string; to: string }; year: number; onLeave: OnLeaveRow[]; typeUsage: TypeUsageRow[]; onLeaveToday: number }>(
    `/api/rekankerja/leave/reports?from=${from}&to=${to}&year=${year}`,
    [from, to, year],
  );

  const monthKey = `${calMonth.getFullYear()}-${String(calMonth.getMonth() + 1).padStart(2, "0")}`;
  const calApi = useApi<{ month: string; from: string; to: string; rows: CalendarRow[] }>(
    view === "kalender" ? `/api/rekankerja/leave/calendar?month=${monthKey}${calOrg ? `&org=${encodeURIComponent(calOrg)}` : ""}` : null,
    [monthKey, calOrg, view],
  );

  const calRows = useMemo(() => calApi.data?.rows ?? [], [calApi.data]);

  // opsi unit — dari orgUnitName distinct pada baris kalender saat ini
  // (self-contained, tanpa API tambahan; pilihan aktif selalu dipertahankan).
  const orgOptions = useMemo(() => {
    const orgs = new Set<string>(calRows.map((r) => r.orgUnitName).filter((o): o is string => !!o));
    if (calOrg) orgs.add(calOrg);
    return [...orgs].sort();
  }, [calRows, calOrg]);

  const onLeave = useMemo(() => api.data?.onLeave ?? [], [api.data]);
  const today = new Date();

  const maxTaken = Math.max(1, ...(api.data?.typeUsage ?? []).map((ty) => ty.taken));

  // ===== grid kalender (murni Date + CSS — tanpa lib) =====
  const cy = calMonth.getFullYear();
  const cm = calMonth.getMonth();
  const daysInMonth = new Date(cy, cm + 1, 0).getDate();
  const firstWeekday = (new Date(cy, cm, 1).getDay() + 6) % 7; // Senin = 0
  const weekDayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 2 + i).toLocaleDateString(locale, { weekday: "short" })),
    [locale],
  );
  const todayKey = localDayKey(today.getFullYear(), today.getMonth(), today.getDate());

  // peta hari → baris cuti yang mencakup hari itu (bandingkan "YYYY-MM-DD" lokal).
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarRow[]>();
    for (const r of calRows) {
      const fromD = isoToLocalKey(r.dateFrom);
      const toD = isoToLocalKey(r.dateTo);
      if (!fromD || !toD) continue;
      for (let d = 1; d <= daysInMonth; d++) {
        const key = localDayKey(cy, cm, d);
        if (key >= fromD && key <= toD) {
          const arr = map.get(key);
          if (arr) arr.push(r); else map.set(key, [r]);
        }
      }
    }
    for (const arr of map.values()) arr.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
    return map;
  }, [calRows, cy, cm, daysInMonth]);

  const distinctEmployees = useMemo(() => new Set(calRows.map((r) => r.employeeNo)).size, [calRows]);
  const totalWorkingDays = useMemo(() => Math.round(calRows.reduce((s, r) => s + r.workingDays, 0) * 10) / 10, [calRows]);
  const unpaidCount = useMemo(() => calRows.filter((r) => !r.paid).length, [calRows]);

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Laporan Cuti")}
        description={t("Siapa yang sedang cuti pada rentang tanggal + ringkasan penggunaan per jenis cuti (padanan Query Employee on Leave & History)", "Who is on leave within a date range + usage summary per leave type (Query Employee on Leave & History equivalent)")}
        actions={
          <Button variant="outline" onClick={() => { api.refresh(); calApi.refresh(); }} className="gap-2 font-bold">
            <RefreshCw className="h-4 w-4" /> {t("Segarkan")}
          </Button>
        }
      />

      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          {/* Task 99 — toggle Tabel | Kalender */}
          <div className="flex items-center gap-1.5">
            {(["tabel", "kalender"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn(
                "rounded-full px-3 py-1 text-[11px] font-bold transition",
                view === v ? "ov-fill shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800",
              )}>
                {v === "tabel" ? t("Tabel", "Table") : t("Kalender", "Calendar")}
              </button>
            ))}
          </div>

          {view === "tabel" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Dari Tanggal", "From Date")}</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-40 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sampai Tanggal", "To Date")}</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-40 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tahun Ringkasan", "Summary Year")}</Label>
                <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                  <SelectTrigger className="h-8 w-24 text-xs font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {/* Task 99 (F1-3) — unduh CSV karyawan cuti (filter saat ini) */}
              <a
                href={`/api/rekankerja/leave/reports?from=${from}&to=${to}&year=${year}&export=csv`}
                className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                aria-label={t("Unduh daftar karyawan cuti sebagai CSV", "Download the on-leave list as CSV")}
              >
                <Download className="h-3.5 w-3.5" /> {t("Export CSV")}
              </a>
              <div className="ml-auto flex items-center gap-2 rounded-xl ov-soft px-3 py-2">
                <CalendarDays className="h-4 w-4" />
                <p className="text-xs font-bold">{t("{n} karyawan sedang cuti hari ini", "{n} employees on leave today", { n: api.data?.onLeaveToday ?? 0 })}</p>
              </div>
            </>
          ) : (
            <>
              {/* navigasi bulan — murni Date, tanpa lib */}
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setCalMonth(new Date(cy, cm - 1, 1))} title={t("Bulan sebelumnya", "Previous month")}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <p className="min-w-24 text-center text-sm font-extrabold text-slate-800 dark:text-slate-100">
                  {calMonth.toLocaleDateString(locale, { month: "short", year: "numeric" })}
                </p>
                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setCalMonth(new Date(cy, cm + 1, 1))} title={t("Bulan berikutnya", "Next month")}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px] font-bold text-slate-500" onClick={() => setCalMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
                  {t("Hari ini", "Today")}
                </Button>
              </div>
              {/* filter unit — dari orgUnitName distinct baris bulan ini */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Unit Kerja", "Org Unit")}</Label>
                <Select value={calOrg || "__all__"} onValueChange={(v) => setCalOrg(v === "__all__" ? "" : v)}>
                  <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t("Semua unit", "All units")}</SelectItem>
                    {orgOptions.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {/* Task 99 (F1-4) — unduh ICS (bulan + unit saat ini) */}
              <a
                href={`/api/rekankerja/leave/calendar?month=${monthKey}${calOrg ? `&org=${encodeURIComponent(calOrg)}` : ""}&format=ics`}
                className="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                aria-label={t("Unduh kalender cuti sebagai ICS", "Download the leave calendar as ICS")}
              >
                <Download className="h-3.5 w-3.5" /> {t("Unduh ICS", "Download ICS")}
              </a>
              <div className="ml-auto flex items-center gap-2 rounded-xl ov-soft px-3 py-2">
                <CalendarDays className="h-4 w-4" />
                <p className="text-xs font-bold">
                  {t("{n} karyawan cuti bulan ini · {m} hari kerja", "{n} employees on leave this month · {m} working days", { n: distinctEmployees, m: fmtDay(totalWorkingDays) })}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {view === "kalender" ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-0">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
              <CalendarDays className="h-4 w-4 ov-text-accent" />
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {t("Kalender Cuti", "Leave Calendar")} — {calMonth.toLocaleDateString(locale, { month: "long", year: "numeric" })}
                {calOrg ? ` · ${calOrg}` : ""}
              </p>
            </div>
            {calApi.loading && !calApi.data ? (
              <div className="p-5"><LoadingRows rows={6} /></div>
            ) : calApi.error ? (
              <div className="p-5"><EmptyState title={t("Gagal memuat kalender", "Failed to load the calendar")} description={calApi.error} icon={<CalendarDays className="h-6 w-6" />} /></div>
            ) : calRows.length === 0 ? (
              <div className="p-5"><EmptyState title={t("Tidak ada cuti bulan ini", "No leave this month")} description={t("Tidak ada cuti efektif pada bulan/unit ini.", "No effective leave for this month/unit.")} icon={<Palmtree className="h-6 w-6" />} /></div>
            ) : (
              <div className="p-4">
                {/* header hari: Sen Sel Rab Kam Jum Sab Min */}
                <div className="mb-1 grid grid-cols-7 gap-1">
                  {weekDayLabels.map((d) => (
                    <p key={d} className="py-1 text-center text-[10px] font-black uppercase tracking-wide text-slate-400">{d}</p>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: firstWeekday }, (_, i) => <div key={`pad-${i}`} />)}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const key = localDayKey(cy, cm, day);
                    const dow = (firstWeekday + i) % 7; // 5=Sabtu 6=Minggu
                    const weekend = dow >= 5;
                    const isToday = key === todayKey;
                    const chips = byDay.get(key) ?? [];
                    return (
                      <div
                        key={key}
                        className={cn(
                          "min-h-20 rounded-lg border p-1.5",
                          weekend ? "border-slate-200/60 bg-accent/50 dark:border-slate-800/60" : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900",
                          isToday && "ring-2 ring-brand/40",
                        )}
                      >
                        <p className={cn("text-[10px] font-bold", weekend ? "text-slate-400" : "text-slate-500 dark:text-slate-400", isToday && "ov-text-accent")}>{day}</p>
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {chips.slice(0, 3).map((r) => (
                            <span
                              key={r.id}
                              title={`${r.employeeNo} — ${r.fullName} · ${r.leaveTypeName} · ${fmtDay(r.workingDays)} ${t("hari", "days")}${r.paid ? "" : ` · ${t("tidak dibayar", "unpaid")}`} · ${r.docNo}`}
                              className={cn(
                                "truncate rounded px-1 py-px text-[9px] font-bold leading-4",
                                r.paid
                                  ? "bg-brand/15 text-brand-deep dark:bg-brand/20 dark:text-brand/85"
                                  : "border border-dashed border-slate-300 bg-transparent text-slate-400 dark:border-slate-600 dark:text-slate-500",
                              )}
                            >
                              {initials(r.fullName)}
                            </span>
                          ))}
                          {chips.length > 3 && (
                            <span className="truncate rounded px-1 py-px text-[9px] font-bold leading-4 text-slate-400" title={chips.slice(3).map((r) => `${r.employeeNo} — ${r.fullName}`).join("\n")}>
                              +{chips.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* legenda ringkas */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                    {t("{n} karyawan cuti bulan ini · {m} hari kerja", "{n} employees on leave this month · {m} working days", { n: distinctEmployees, m: fmtDay(totalWorkingDays) })}
                  </p>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="inline-block h-2.5 w-2.5 rounded bg-brand/25" /> {t("dibayar", "paid")}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="inline-block h-2.5 w-2.5 rounded border border-dashed border-slate-400" /> {t("tidak dibayar", "unpaid")} ({unpaidCount})
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="inline-block h-2.5 w-2.5 rounded bg-accent" /> {t("akhir pekan", "weekend")}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        api.loading && !api.data ? <LoadingRows rows={8} /> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="min-w-0 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 lg:col-span-2">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                  <CalendarSearch className="h-4 w-4 ov-text-accent" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    {t("Karyawan Cuti", "Employees on Leave")} {new Date(from).toLocaleDateString(locale, { day: "2-digit", month: "short" })} – {new Date(to).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })} — {onLeave.length} {t("orang", "people")}
                  </p>
                </div>
                {onLeave.length === 0 ? (
                  <div className="p-5"><EmptyState title={t("Tidak ada karyawan cuti", "No employees on leave")} description={t("Tidak ada cuti disetujui pada rentang tanggal ini.", "No approved leave in this date range.")} icon={<Palmtree className="h-6 w-6" />} /></div>
                ) : (
                  <div className="max-h-96 overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 z-10">
                        <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                          <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Jenis")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Rentang", "Range")}</TableHead>
                          <TableHead className="text-right text-[11px] font-bold">{t("Hari", "Days")}</TableHead>
                          <TableHead className="text-[11px] font-bold">{t("Alasan", "Reason")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {onLeave.map((r) => {
                          const isToday = new Date(r.dateFrom) <= today && new Date(r.dateTo) >= today;
                          return (
                            <TableRow key={r.id} className={cn("hover:bg-slate-50 dark:hover:bg-slate-900/60", isToday && "ov-soft")}>
                              <TableCell>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.employeeNo} {isToday && t("· hari ini", "· today")}</p>
                                <p className="text-[10px] text-slate-400">{r.fullName} · {r.orgUnitName ?? "—"}</p>
                              </TableCell>
                              <TableCell>
                                <p className="text-xs text-slate-700 dark:text-slate-200">{r.leaveTypeName}</p>
                                {!r.paid && <Badge className="mt-0.5 bg-slate-100 text-[9px] font-bold text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{t("Tidak dibayar", "Unpaid")}</Badge>}
                              </TableCell>
                              <TableCell className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                {new Date(r.dateFrom).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionFrom], SESSION_LABEL_EN[r.sessionFrom])} → {new Date(r.dateTo).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionTo], SESSION_LABEL_EN[r.sessionTo])}
                              </TableCell>
                              <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtDay(r.workingDays)}</TableCell>
                              <TableCell className="max-w-52 text-[10px] text-slate-400">{r.reason ?? "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
                  <BarChart3 className="h-4 w-4 ov-text-accent" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">{t("Penggunaan per Jenis", "Usage by Type")} {year}</p>
                </div>
                {(api.data?.typeUsage ?? []).length === 0 ? (
                  <div className="p-5"><EmptyState title={t("Belum ada data", "No data yet")} description={t("Generate saldo tahun ini terlebih dahulu.", "Generate this year's balances first.")} /></div>
                ) : (
                  <div className="space-y-2.5 p-4">
                    {(api.data?.typeUsage ?? []).slice(0, 14).map((ty) => (
                      <div key={ty.leaveTypeId}>
                        <div className="flex items-baseline justify-between">
                          <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">{ty.name}</p>
                          <p className="text-[11px] font-bold tabular-nums text-slate-500">{ty.taken} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")} · {ty.employees} {t("kry", "emp")}</p>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full ov-chart"
                            style={{ width: `${Math.max(3, (ty.taken / maxTaken) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )
      )}
    </div>
  );
}
