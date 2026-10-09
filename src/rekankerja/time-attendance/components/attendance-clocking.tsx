"use client";
// RekanKerja Attendance — Data Clocking: rekap harian per tanggal (padanan
// EmpClocking.jsp) + input clock manual + Refresh Clocking.
// Task 100-impl-B (F0): error state useApi + Coba Lagi (G10), dialog Catat
// Clock & tombol Refresh punya busy state anti double-submit (G11), "hari
// ini" zona LOKAL (B-10), judul dialog pakai fmtDate locale (B-7).
// Task 100 F1 (G24, impl-E): koreksi data — hapus log mentah per baris
// (DELETE ?id= + regen hari itu), Regen Rentang (PATCH op:regen-range maks
// 62 hari, validasi client), Koreksi rekap per baris (PATCH op:override-daily
// — status/jam/berbayar + alasan WAJIB) + badge "Dikoreksi" utk baris
// state Revised (field id/state/revised belum diekspos listDaily — lihat
// catatan worklog; UI siap begitu tersaji).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DailyRow, ClockLogRow, EmployeeOption, ATT_STATUS_LABEL, ATT_STATUS_LABEL_EN } from "@/rekankerja/time-attendance/components/attendance-types";
import { ApiErrorState, todayISO } from "@/rekankerja/time-attendance/components/attendance-ui";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Activity, Plus, RefreshCw, Search, LogIn, LogOut, Clock, Loader2, Trash2, Pencil, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  Present: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  Late: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Absent: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  WorkOff: "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85",
  Off: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const fmtTime = (d: string | null, locale: string) => {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
};
// B-10: zona lokal (pola ess-attendance) — toISOString UTC salah hari 00:00–07:00 WIB.
const todayIso = () => todayISO();

export function AttendanceClockingPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [date, setDate] = useState(todayIso());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clockDialog, setClockDialog] = useState(false);
  const [busy, setBusy] = useState(false); // G11: dialog Catat Clock sedang mengirim
  const [regenBusy, setRegenBusy] = useState(false); // G11: Refresh Clocking (anti double-click)
  const [form, setForm] = useState({ employeeId: "", time: "08:00", direction: "IN", note: "" });

  // ===== G24: koreksi data =====
  const canUpdate = perms.canOp("attendance", "clocking", "update");
  const [deleteTarget, setDeleteTarget] = useState<ClockLogRow | null>(null); // hapus log mentah
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false); // regen rentang
  const [rangeForm, setRangeForm] = useState({ from: todayISO(), to: todayISO() });
  const [rangeBusy, setRangeBusy] = useState(false);
  const [editTarget, setEditTarget] = useState<DailyRow | null>(null); // koreksi rekap
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({ status: "Present", checkIn: "", checkOut: "", paidFlag: "-", reason: "" });

  const api = useApi<{ date: string; rows: DailyRow[]; logs: ClockLogRow[]; employees: EmployeeOption[]; stats: { total: number; present: number; late: number; absent: number; workoff: number; off: number; lateMinutes: number; overtimeMinutes: number } }>(`/api/rekankerja/attendance/clocking?date=${date}`);

  const rows = useMemo(() => (api.data?.rows ?? []).filter((r) =>
    (!query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.employeeNo.toLowerCase().includes(query.toLowerCase())) &&
    (statusFilter === "all" || r.status === statusFilter)
  ), [api.data, query, statusFilter]);

  const submitClock = async () => {
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/clocking", "POST", { ...form, date });
      toast.success(t("Clock {dir} {time} tercatat — rekap harian diperbarui", "Clock {dir} {time} recorded — daily recap updated", { dir: form.direction, time: form.time }));
      setClockDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mencatat clock", "Failed to record clock"));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setRegenBusy(true);
    try {
      const res = await apiSend<{ regenerated: number }>("/api/rekankerja/attendance/clocking", "PATCH", { date });
      toast.success(t("Refresh Clocking selesai — {n} karyawan dihitung ulang", "Clocking refresh completed — {n} employees recalculated", { n: res.regenerated }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghitung ulang", "Failed to recalculate"));
    } finally {
      setRegenBusy(false);
    }
  };

  // ===== G24: hapus satu log mentah → rekap hari itu dihitung ulang =====
  const runDeleteLog = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiSend(`/api/rekankerja/attendance/clocking?id=${deleteTarget.id}`, "DELETE");
      toast.success(t("Log clock dihapus — rekap hari itu dihitung ulang", "Clock log deleted — that day's recap is recalculated"));
      setDeleteTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus log", "Failed to delete log"));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ===== G24: regen rentang (maks 62 hari — validasi client + server) =====
  const rangeDays = (() => {
    const a = new Date(`${rangeForm.from}T00:00:00`).getTime();
    const b = new Date(`${rangeForm.to}T00:00:00`).getTime();
    if (isNaN(a) || isNaN(b) || b < a) return -1;
    return Math.round((b - a) / 86_400_000) + 1;
  })();
  const runRegenRange = async () => {
    if (rangeDays < 1) {
      toast.error(t("Tanggal awal tidak boleh setelah tanggal akhir", "Start date must not be after the end date"));
      return;
    }
    if (rangeDays > 62) {
      toast.error(t("Rentang maksimal 62 hari (diminta {n}) — pecah menjadi beberapa batch", "Range is capped at 62 days (requested {n}) — split into batches", { n: rangeDays }));
      return;
    }
    setRangeBusy(true);
    try {
      const res = await apiSend<{ days: number; rows: number }>("/api/rekankerja/attendance/clocking", "PATCH", { op: "regen-range", from: rangeForm.from, to: rangeForm.to });
      toast.success(t("{days} hari diregenerasi — {rows} baris rekap dihitung ulang", "{days} days regenerated — {rows} recap rows recalculated", { days: res.days, rows: res.rows }));
      setRangeOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal meregenerasi rentang", "Failed to regenerate the range"));
    } finally {
      setRangeBusy(false);
    }
  };

  // ===== G24: koreksi manual satu baris rekap (override-daily) =====
  const openEdit = (r: DailyRow) => {
    setEditTarget(r);
    setEditForm({
      status: r.status,
      checkIn: r.checkIn ? new Date(r.checkIn).toTimeString().slice(0, 5) : "",
      checkOut: r.checkOut ? new Date(r.checkOut).toTimeString().slice(0, 5) : "",
      paidFlag: r.paidFlag == null ? "-" : r.paidFlag ? "paid" : "unpaid",
      reason: "",
    });
  };
  const runOverride = async () => {
    if (!editTarget || !editTarget.id) return;
    setEditBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/clocking", "PATCH", {
        op: "override-daily",
        id: editTarget.id,
        status: editForm.status,
        ...(editForm.checkIn ? { checkIn: editForm.checkIn } : {}),
        ...(editForm.checkOut ? { checkOut: editForm.checkOut } : {}),
        ...(editForm.paidFlag !== "-" ? { paidFlag: editForm.paidFlag === "paid" } : {}),
        reason: editForm.reason.trim(),
      });
      toast.success(t("Koreksi rekap disimpan — baris ditandai Revised & dipertahankan saat regenerasi", "Recap correction saved — the row is marked Revised & preserved on regeneration"));
      setEditTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan koreksi", "Failed to save the correction"));
    } finally {
      setEditBusy(false);
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Data Clocking Harian", "Daily Clocking Data")}
        description={t("Rekap presensi per tanggal — hour buckets telat/pulang cepat/normal/absen, padanan Employee Clocking", "Presence recap per date — late/early-out/normal/absent hour buckets, counterpart of Employee Clocking")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-36 text-xs font-bold" />
            <Button variant="outline" onClick={regenerate} disabled={regenBusy} className="gap-2 font-bold">
              <RefreshCw className={cn("h-4 w-4", regenBusy && "animate-spin")} aria-hidden /> {regenBusy ? t("Memproses…", "Processing…") : t("Refresh Clocking")}
            </Button>
            {/* G24: regen rentang histori (maks 62 hari) */}
            {canUpdate && (
              <Button variant="outline" onClick={() => { setRangeForm({ from: date, to: date }); setRangeOpen(true); }} className="gap-2 font-bold">
                <CalendarRange className="h-4 w-4" aria-hidden /> {t("Regen Rentang", "Regenerate Range")}
              </Button>
            )}
            <Button onClick={() => { setForm({ employeeId: api.data?.employees[0]?.id ?? "", time: "08:00", direction: "IN", note: "" }); setClockDialog(true); }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Catat Clock", "Record Clock")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3 xl:grid-cols-6">
        {[
          { label: t("Hadir", "Present"), value: stats?.present ?? 0, tone: "text-brand dark:text-brand/85" },
          { label: t("Telat", "Late"), value: stats?.late ?? 0, tone: "text-amber-600 dark:text-amber-400" },
          { label: t("Absen", "Absent"), value: stats?.absent ?? 0, tone: "text-rose-600 dark:text-rose-400" },
          { label: t("Izin", "Permit"), value: stats?.workoff ?? 0, tone: "text-brand dark:text-brand/85" },
          { label: "Off", value: stats?.off ?? 0, tone: "text-slate-500" },
          { label: t("Total Telat", "Total Late"), value: t("{n} j", "{n} h", { n: Math.round((stats?.lateMinutes ?? 0) / 60) }), tone: "text-amber-700" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className={cn("text-lg font-extrabold", k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <Tabs defaultValue="recap">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
              <TabsList className="h-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
                <TabsTrigger value="recap" className="gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold data-[state=active]:ov-fill">
                  <Activity className="h-3.5 w-3.5" /> {t("Rekap ({n})", "Recap ({n})", { n: api.data?.rows.length ?? 0 })}
                </TabsTrigger>
                <TabsTrigger value="logs" className="gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold data-[state=active]:ov-fill">
                  <Clock className="h-3.5 w-3.5" /> {t("Log Mentah ({n})", "Raw Logs ({n})", { n: api.data?.logs.length ?? 0 })}
                </TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-32 text-xs font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
                    <SelectItem value="Present">{t("Hadir", "Present")}</SelectItem>
                    <SelectItem value="Late">{t("Telat", "Late")}</SelectItem>
                    <SelectItem value="Absent">{t("Absen", "Absent")}</SelectItem>
                    <SelectItem value="WorkOff">{t("Izin", "Permit")}</SelectItem>
                    <SelectItem value="Off">{t("Off", "Off")}</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employee…")} className="h-8 w-48 pl-8 text-xs" />
                </div>
              </div>
            </div>

            <TabsContent value="recap">
              {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : api.error ? (
                <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
              ) : rows.length === 0 ? (
                <div className="p-5"><EmptyState title={t("Tidak ada data rekap", "No recap data")} description={t("Pilih tanggal lain atau catat clock terlebih dahulu.", "Pick another date or record a clock first.")} icon={<Activity className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Tipe Hari", "Day Type")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Jam Masuk", "Clock In")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Jam Pulang", "Clock Out")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Telat", "Late")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Pulang Cepat", "Early Out")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Jam Kerja", "Work Hours")}</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">{t("Lembur", "Overtime")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.employeeId} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell>
                            <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{r.fullName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                            {r.notes && <p className="text-[10px] italic text-slate-400">{r.notes}</p>}
                          </TableCell>
                          <TableCell>
                            {r.dayTypeCode ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.dayTypeColor ?? "#E7E5E4" }} />
                                {r.dayTypeCode}
                              </span>
                            ) : <span className="text-xs text-slate-400">{t("tanpa jadwal", "no schedule")}</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{fmtTime(r.checkIn, locale)}</TableCell>
                          <TableCell className="font-mono text-xs">{fmtTime(r.checkOut, locale)}</TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.lateMinutes > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>
                            {r.lateMinutes > 0 ? t("{n} mnt", "{n} min", { n: r.lateMinutes }) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.earlyMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-slate-400")}>
                            {r.earlyMinutes > 0 ? t("{n} mnt", "{n} min", { n: r.earlyMinutes }) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            {r.workMinutes > 0 ? t("{n} j", "{n} h", { n: (r.workMinutes / 60).toFixed(1) }) : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.overtimeMinutes > 0 ? "ov-text-accent" : "text-slate-400")}>
                            {r.overtimeMinutes > 0 ? t("{n} j", "{n} h", { n: (r.overtimeMinutes / 60).toFixed(1) }) : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", STATUS_TONE[r.status] ?? "bg-slate-100 text-slate-500")}>
                                {t(ATT_STATUS_LABEL[r.status] ?? r.status, ATT_STATUS_LABEL_EN[r.status] ?? r.status)}
                              </span>
                              {/* G24: badge baris hasil koreksi manual (state Revised —
                                  field menyusul di-serve listDaily, lihat worklog impl-E) */}
                              {(r.state === "Revised" || r.revised === true) && (
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[9px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" title={t("Dikoreksi oleh {by}", "Corrected by {by}", { by: r.revisedBy ?? "-" })}>
                                  {t("Dikoreksi", "Corrected")}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {canUpdate && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} title={t("Koreksi baris rekap", "Correct recap row")} aria-label={t("Koreksi rekap {name}", "Correct recap for {name}", { name: r.fullName })}>
                                <Pencil className="h-3.5 w-3.5 ov-text-accent" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs">
              {api.error ? (
                <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
              ) : (api.data?.logs ?? []).length === 0 ? (
                <div className="p-5"><EmptyState title={t("Belum ada log pada tanggal ini", "No logs for this date yet")} description={t("Catat clock manual atau hubungkan mesin absensi.", "Record a manual clock or connect an attendance machine.")} icon={<Clock className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">{t("Waktu", "Time")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Arah", "Direction")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Sumber", "Source")}</TableHead>
                        <TableHead className="text-[11px] font-bold">{t("Catatan")}</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(api.data?.logs ?? []).map((l) => (
                        <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell className="font-mono text-xs font-bold">{fmtTime(l.timestamp, locale)}</TableCell>
                          <TableCell className="text-xs">
                            <p className="font-semibold">{l.employee.fullName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{l.employee.employeeNo}</p>
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold", l.direction === "IN" ? "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400")}>
                              {l.direction === "IN" ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />} {l.direction}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">{l.source}</TableCell>
                          <TableCell className="text-xs text-slate-500">{l.note ?? "—"}</TableCell>
                          <TableCell>
                            {canUpdate && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteTarget(l)} title={t("Hapus log clock", "Delete clock log")} aria-label={t("Hapus log clock {time} {dir}", "Delete clock log {time} {dir}", { time: fmtTime(l.timestamp, locale), dir: l.direction })}>
                                <Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-rose-500" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={clockDialog} onOpenChange={setClockDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Catat Clock Manual — {date}", "Record Manual Clock — {date}", { date: fmtDate(date) })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(api.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Arah", "Direction")}</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN">{t("Clock IN (masuk)", "Clock IN (in)")}</SelectItem>
                    <SelectItem value="OUT">{t("Clock OUT (pulang)", "Clock OUT (out)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jam *", "Time *")}</Label>
                <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("mis. lupa kartu, input operator", "e.g. forgot card, operator input")} className="text-sm" />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              {t("Rekap harian karyawan otomatis dihitung ulang setelah clock dicatat (padanan Temporary Employee Clocking + Refresh).", "The employee's daily recap is automatically recalculated after a clock is recorded (counterpart of Temporary Employee Clocking + Refresh).")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClockDialog(false)} disabled={busy}>{t("Batal")}</Button>
            <Button onClick={submitClock} disabled={busy || !form.employeeId} className="gap-1.5 font-bold">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Mengirim…", "Sending…")}</> : <>{t("Catat Clock", "Record Clock")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== G24: AlertDialog hapus log mentah ===== */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v && !deleteBusy) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus log clock ini?", "Delete this clock log?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Log clock {ts} {dir} akan dihapus permanen — rekap absensi hari itu dihitung ulang. Gunakan untuk clock ganda / clock salah orang di mesin.",
                "The clock log {ts} {dir} will be permanently deleted — that day's attendance recap is recalculated. Use this for duplicate clocks / wrong-person machine clocks.",
                { ts: deleteTarget ? fmtTime(deleteTarget.timestamp, locale) : "", dir: deleteTarget?.direction ?? "" },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{deleteTarget.employee.fullName}</p>
                  <p className="truncate text-[11px] text-slate-400">{deleteTarget.employee.employeeNo} · {deleteTarget.source}{deleteTarget.note ? ` · ${deleteTarget.note}` : ""}</p>
                </div>
                <Trash2 className="h-4 w-4 shrink-0 text-rose-500" aria-hidden />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className={cn("gap-1.5 bg-rose-600 font-bold hover:bg-rose-700", deleteBusy && "opacity-70")}
              onClick={(e) => { e.preventDefault(); void runDeleteLog(); }}
            >
              {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("Ya, Hapus Log", "Yes, Delete Log")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== G24: dialog regen rentang ===== */}
      <Dialog open={rangeOpen} onOpenChange={(v) => { if (!rangeBusy) setRangeOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Regenerasi Rentang Rekap", "Regenerate Recap Range")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Dari *", "From *")}</Label>
                <Input type="date" value={rangeForm.from} onChange={(e) => setRangeForm({ ...rangeForm, from: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sampai *", "To *")}</Label>
                <Input type="date" value={rangeForm.to} onChange={(e) => setRangeForm({ ...rangeForm, to: e.target.value })} className="text-sm" />
              </div>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              {t(
                "Seluruh karyawan aktif pada rentang dihitung ulang (maksimal 62 hari per batch). Baris rekap hasil koreksi manual (Revised) dipertahankan — tidak ditimpa kalkulasi ulang.",
                "All active employees in the range are recalculated (max 62 days per batch). Manually corrected recap rows (Revised) are preserved — not overwritten by recalculation.",
              )}
            </p>
            {rangeDays >= 1 && (
              <p className={cn("text-[11px] font-bold", rangeDays > 62 ? "text-rose-600 dark:text-rose-400" : "text-slate-500")}>
                {t("{n} hari akan diregenerasi", "{n} days will be regenerated", { n: rangeDays })}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRangeOpen(false)} disabled={rangeBusy}>{t("Batal")}</Button>
            <Button onClick={runRegenRange} disabled={rangeBusy || rangeDays < 1 || rangeDays > 62} className="gap-1.5 font-bold">
              {rangeBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Meregenerasi…", "Regenerating…")}</> : <><CalendarRange className="h-4 w-4" /> {t("Regenerasi", "Regenerate")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== G24: dialog koreksi rekap (override-daily) ===== */}
      <Dialog open={!!editTarget} onOpenChange={(v) => { if (!v && !editBusy) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Koreksi Rekap — {name}", "Correct Recap — {name}", { name: editTarget?.fullName ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            {editTarget && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-900/60">
                {fmtDate(editTarget.workDate)} · {editTarget.dayTypeName ?? t("tanpa tipe hari", "no day type")} · {t("status saat ini: {s}", "current status: {s}", { s: t(ATT_STATUS_LABEL[editTarget.status] ?? editTarget.status, ATT_STATUS_LABEL_EN[editTarget.status] ?? editTarget.status) })}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Status")}</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Present", "Late", "Absent", "Off", "Holiday", "WorkOff", "OnLeave"].map((s) => (
                      <SelectItem key={s} value={s}>{t(ATT_STATUS_LABEL[s] ?? s, ATT_STATUS_LABEL_EN[s] ?? s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jam Masuk", "Clock In")}</Label>
                <Input type="time" value={editForm.checkIn} onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jam Pulang", "Clock Out")}</Label>
                <Input type="time" value={editForm.checkOut} onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Kebayaran Hari", "Day Payment")}</Label>
              <Select value={editForm.paidFlag} onValueChange={(v) => setEditForm({ ...editForm, paidFlag: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="-">{t("— tetap —", "— keep —")}</SelectItem>
                  <SelectItem value="paid">{t("Berbayar", "Paid")}</SelectItem>
                  <SelectItem value="unpaid">{t("Tidak berbayar", "Unpaid")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan koreksi *", "Correction reason *")}</Label>
              <Textarea value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} placeholder={t("mis. mesin rusak — absen 07:55 terverifikasi security", "e.g. machine broken — 07:55 arrival verified by security")} className="min-h-20 text-sm" maxLength={300} />
              <p className="text-[10px] text-slate-400">{t("Tercatat di log aktivitas + ditampilkan pada rekap; baris ditandai Revised dan tidak ditimpa regenerasi.", "Recorded in the activity log + shown on the recap; the row is marked Revised and survives regeneration.")}</p>
            </div>
            {editTarget && !editTarget.id && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                {t(
                  "API clocking belum menyajikan id baris rekap (field id/state/revised belum diekspos listDaily — dicatat di worklog Task 100-impl-E). Simpan diaktifkan setelah backend mengeksposnya.",
                  "The clocking API does not expose the recap row id yet (id/state/revised fields not exposed by listDaily — noted in the Task 100-impl-E worklog). Saving is enabled once the backend exposes them.",
                )}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={editBusy}>{t("Batal")}</Button>
            <Button onClick={runOverride} disabled={editBusy || !editForm.reason.trim() || !editTarget?.id} className="gap-1.5 font-bold">
              {editBusy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Menyimpan…", "Saving…")}</> : <><Pencil className="h-4 w-4" /> {t("Simpan Koreksi", "Save Correction")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
