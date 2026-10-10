"use client";
// RekanKerja Attendance — Template Jadwal: tabs Tipe Hari (padanan DayType.jsp) /
// Jadwal cycle (WorkSchedule.jsp) / Pengaturan (Overtime Specified + Rounding).
// Task 100-impl-B (F0): error state useApi + Coba Lagi di ketiga tab (G10),
// dialog tipe hari / jadwal & tombol Simpan Pengaturan punya busy state anti
// double-submit (G11).
import { useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DayTypeRow, ScheduleRow, AttendanceRule, DAY_CATEGORY_LABEL, DAY_CATEGORY_LABEL_EN } from "@/rekankerja/time-attendance/components/attendance-types";
import { ApiErrorState } from "@/rekankerja/time-attendance/components/attendance-ui";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { CalendarClock, Plus, Pencil, Palette, Layers, Settings2, Trash2, Minus, RotateCcw, MapPin, Radar, Loader2, Camera, ScanFace, Gauge, Flame, KeyRound, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = ["#99CCFF", "#A7F3D0", "#FDE68A", "#C7D2FE", "#FCA5A5", "#86EFAC", "#E7E5E4", "#FDBA74", "#D9F99D", "#F5D0FE"];

export function AttendanceTemplatesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("day-types");
  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Template Jadwal & Shift", "Schedule & Shift Templates")}
        description={t("Master tipe hari (jam kerja + toleransi), jadwal cycle rotasi, dan pengaturan perhitungan absensi", "Day type master (work hours + tolerances), rotating cycle schedules, and attendance calculation settings")}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl ov-tile p-1.5">
          <TabsTrigger value="day-types" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
            <Palette className="h-3.5 w-3.5" /> {t("Tipe Hari", "Day Types")}
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
            <CalendarClock className="h-3.5 w-3.5" /> {t("Jadwal Cycle", "Cycle Schedules")}
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:ov-fill">
            <Settings2 className="h-3.5 w-3.5" /> {t("Pengaturan")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="day-types"><DayTypesTab /></TabsContent>
        <TabsContent value="schedules"><SchedulesTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ============ TAB: TIPE HARI ============

function DayTypesTab() {
  const { t, locale } = useI18n();
  const api = useApi<{ dayTypes: DayTypeRow[] }>("/api/rekankerja/attendance/day-types");
  const [dialog, setDialog] = useState(false);
  const [edit, setEdit] = useState<DayTypeRow | null>(null);
  const [busy, setBusy] = useState(false); // G11: dialog tipe hari sedang mengirim
  const [form, setForm] = useState({
    code: "", name: "", category: "Workday", color: "#99CCFF",
    timeIn: "08:00", timeOut: "17:00", nextDay: false,
    breakMinutes: "60", normalMinutes: "480",
    toleranceLateMinutes: "10", toleranceEarlyMinutes: "10",
    flexible: false, needOvertimeOrder: true,
  });

  const openCreate = () => {
    setEdit(null);
    setForm({ code: "", name: "", category: "Workday", color: "#99CCFF", timeIn: "08:00", timeOut: "17:00", nextDay: false, breakMinutes: "60", normalMinutes: "480", toleranceLateMinutes: "10", toleranceEarlyMinutes: "10", flexible: false, needOvertimeOrder: true });
    setDialog(true);
  };
  const openEdit = (d: DayTypeRow) => {
    setEdit(d);
    setForm({
      code: d.code, name: d.name, category: d.category, color: d.color,
      timeIn: d.timeIn ?? "08:00", timeOut: d.timeOut ?? "17:00", nextDay: d.nextDay,
      breakMinutes: String(d.breakMinutes), normalMinutes: String(d.normalMinutes),
      toleranceLateMinutes: String(d.toleranceLateMinutes), toleranceEarlyMinutes: String(d.toleranceEarlyMinutes),
      flexible: d.flexible, needOvertimeOrder: d.needOvertimeOrder,
    });
    setDialog(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        ...form,
        breakMinutes: parseInt(form.breakMinutes, 10) || 0,
        normalMinutes: parseInt(form.normalMinutes, 10) || 0,
        toleranceLateMinutes: parseInt(form.toleranceLateMinutes, 10) || 0,
        toleranceEarlyMinutes: parseInt(form.toleranceEarlyMinutes, 10) || 0,
        timeIn: form.category === "Workday" ? form.timeIn : null,
        timeOut: form.category === "Workday" ? form.timeOut : null,
      };
      if (edit) {
        await apiSend(`/api/rekankerja/attendance/day-types`, "PATCH", { id: edit.id, ...body });
        toast.success(t("Tipe hari {code} diperbarui", "Day type {code} updated", { code: form.code }));
      } else {
        await apiSend("/api/rekankerja/attendance/day-types", "POST", body);
        toast.success(t("Tipe hari {code} dibuat", "Day type {code} created", { code: form.code }));
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (d: DayTypeRow) => {
    try {
      await apiSend("/api/rekankerja/attendance/day-types", "PATCH", { id: d.id, active: !d.active });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  const dayTypes = api.data?.dayTypes ?? [];

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div>
            <p className="text-[13px] font-bold">{t("Master Tipe Hari", "Day Type Master")}</p>
            <p className="text-[11px] text-slate-400">{t("Padanan Day Type — jam kerja, istirahat, toleransi telat/pulang cepat", "Counterpart of Day Type — work hours, breaks, late/early-out tolerance")}</p>
          </div>
          <Button onClick={openCreate} size="sm" className="gap-1.5 font-bold">
            <Plus className="h-3.5 w-3.5" /> {t("Tipe Hari", "Day Type")}
          </Button>
        </div>
        {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : api.error ? (
          <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
        ) : dayTypes.length === 0 ? (
          <div className="p-5"><EmptyState title={t("Belum ada tipe hari", "No day types yet")} description={t("Buat tipe hari pertama — mis. Jam Kantor 08:00-17:00 atau shift produksi.", "Create the first day type — e.g. Office Hours 08:00-17:00 or a production shift.")} /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead className="text-[11px] font-bold">{t("Tipe Hari", "Day Type")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Jam Kerja", "Work Hours")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Istirahat", "Break")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Jam Normal", "Normal Hours")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Toleransi", "Tolerance")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Kategori", "Category")}</TableHead>
                  <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayTypes.map((d) => (
                  <TableRow key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-2.5 shrink-0 rounded-full border border-slate-300/60 dark:border-slate-700" style={{ backgroundColor: d.color }} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{d.code}</p>
                          <p className="truncate text-[11px] text-slate-400">{d.name}</p>
                        </div>
                        {d.flexible && <Badge variant="outline" className="text-[9px] font-bold">{t("FLEKSIBEL", "FLEXIBLE")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                      {d.timeIn ? `${d.timeIn}–${d.timeOut}${d.nextDay ? " +1" : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                      {d.breakMinutes > 0 ? `${t("{n} mnt", "{n} min", { n: d.breakMinutes })}${d.breakPaid ? t(" (dibayar)", " (paid)") : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{d.normalMinutes > 0 ? `${(d.normalMinutes / 60).toLocaleString(locale)} ${t("jam", "hours")}` : "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">±{d.toleranceLateMinutes}/±{d.toleranceEarlyMinutes} {t("mnt", "min")}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        "text-[10px] font-bold",
                        d.category === "Workday" && "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85",
                        d.category === "Off" && "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
                        d.category === "Holiday" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                      )}>{t(DAY_CATEGORY_LABEL[d.category] ?? d.category, DAY_CATEGORY_LABEL_EN[d.category] ?? d.category)}</Badge>
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(d)} title={d.active ? t("Nonaktifkan", "Deactivate") : t("Aktifkan", "Activate")}>
                        <StatusPill status={d.active ? "Active" : "Closed"} />
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)} aria-label={t("Edit tipe hari", "Edit day type")}>
                        <Pencil className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* dialog create/edit */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{edit ? t("Edit Tipe Hari {code}", "Edit Day Type {code}", { code: edit.code }) : t("Tipe Hari Baru", "New Day Type")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kode *", "Code *")}</Label>
                <Input value={form.code} disabled={!!edit} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OFFICE" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Nama *", "Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Jam Kantor 08:00-17:00", "Office Hours 08:00-17:00")} className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kategori", "Category")}</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Workday">{t("Hari Kerja", "Workday")}</SelectItem>
                    <SelectItem value="Off">{t("Hari Libur", "Day Off")}</SelectItem>
                    <SelectItem value="Holiday">{t("Libur Nasional", "National Holiday")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Warna", "Color")}</Label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PRESET_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={cn("h-6 w-6 rounded-full border-2", form.color === c ? "border-slate-800 dark:border-slate-200" : "border-transparent")} style={{ backgroundColor: c }} aria-label={t("Pilih warna {c}", "Pick color {c}", { c })} />
                  ))}
                </div>
              </div>
            </div>
            {form.category === "Workday" && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("Jam Masuk", "Time In")}</Label>
                    <Input type="time" value={form.timeIn} onChange={(e) => setForm({ ...form, timeIn: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("Jam Keluar", "Time Out")}</Label>
                    <Input type="time" value={form.timeOut} onChange={(e) => setForm({ ...form, timeOut: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("Jam Normal", "Normal Hours")}</Label>
                    <Input type="number" min={0} max={960} value={form.normalMinutes} onChange={(e) => setForm({ ...form, normalMinutes: e.target.value })} className="text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("Istirahat (menit)", "Break (minutes)")}</Label>
                    <Input type="number" min={0} max={240} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">{t("Toleransi telat / pulang cepat", "Late / early-out tolerance")}</Label>
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={0} max={120} value={form.toleranceLateMinutes} onChange={(e) => setForm({ ...form, toleranceLateMinutes: e.target.value })} className="text-sm" />
                      <span className="text-xs text-slate-400">/</span>
                      <Input type="number" min={0} max={120} value={form.toleranceEarlyMinutes} onChange={(e) => setForm({ ...form, toleranceEarlyMinutes: e.target.value })} className="text-sm" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.nextDay} onCheckedChange={(v) => setForm({ ...form, nextDay: v })} id="nextDay" />
                    <Label htmlFor="nextDay" className="text-xs font-medium">{t("Shift lintas hari (malam)", "Cross-day shift (night)")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.flexible} onCheckedChange={(v) => setForm({ ...form, flexible: v })} id="flexible" />
                    <Label htmlFor="flexible" className="text-xs font-medium">{t("Jam fleksibel", "Flexible hours")}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.needOvertimeOrder} onCheckedChange={(v) => setForm({ ...form, needOvertimeOrder: v })} id="needOT" />
                    <Label htmlFor="needOT" className="text-xs font-medium">{t("Lembur wajib work order", "Overtime requires a work order")}</Label>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} disabled={busy}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy || !form.code.trim() || !form.name.trim()} className="gap-1.5 font-bold">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Menyimpan…", "Saving…")}</> : <>{edit ? t("Simpan Perubahan", "Save Changes") : t("Buat Tipe Hari", "Create Day Type")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ TAB: JADWAL CYCLE ============

function SchedulesTab() {
  const { t } = useI18n();
  const api = useApi<{ schedules: ScheduleRow[]; dayTypes: { id: string; code: string; name: string; color: string; category: string }[] }>("/api/rekankerja/attendance/schedules");
  const [dialog, setDialog] = useState(false);
  const [edit, setEdit] = useState<ScheduleRow | null>(null);
  const [busy, setBusy] = useState(false); // G11: dialog jadwal sedang mengirim
  const [form, setForm] = useState({ code: "", name: "", days: ["OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFSAT", "OFFSPH"] });

  const dayTypes = api.data?.dayTypes ?? [];

  const openCreate = () => {
    setEdit(null);
    setForm({ code: "", name: "", days: ["OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFICE", "OFFSAT", "OFFSPH"] });
    setDialog(true);
  };
  const openEdit = (s: ScheduleRow) => {
    setEdit(s);
    setForm({ code: s.code, name: s.name, days: s.days.map((d) => d.dayType.code) });
    setDialog(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (edit) {
        await apiSend("/api/rekankerja/attendance/schedules", "PATCH", { id: edit.id, name: form.name, days: form.days });
        toast.success(t("Jadwal {code} diperbarui", "Schedule {code} updated", { code: form.code }));
      } else {
        await apiSend("/api/rekankerja/attendance/schedules", "POST", form);
        toast.success(t("Jadwal {code} dibuat — cycle {n} hari", "Schedule {code} created — {n}-day cycle", { code: form.code, n: form.days.length }));
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: ScheduleRow) => {
    try {
      await apiSend("/api/rekankerja/attendance/schedules", "PATCH", { id: s.id, active: !s.active });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  const schedules = api.data?.schedules ?? [];

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div>
            <p className="text-[13px] font-bold">{t("Jadwal Cycle (Rotasi)", "Cycle Schedules (Rotation)")}</p>
            <p className="text-[11px] text-slate-400">{t("Padanan Work Schedule — urutan day type per cycle (umumnya 7 hari)", "Counterpart of Work Schedule — day type sequence per cycle (usually 7 days)")}</p>
          </div>
          <Button onClick={openCreate} size="sm" className="gap-1.5 font-bold">
            <Plus className="h-3.5 w-3.5" /> {t("Jadwal", "Schedule")}
          </Button>
        </div>
        {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={4} /></div> : api.error ? (
          <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
        ) : schedules.length === 0 ? (
          <div className="p-5"><EmptyState title={t("Belum ada jadwal", "No schedules yet")} description={t("Buat jadwal cycle — mis. kantor Senin–Jumat atau rotasi 3 regu produksi.", "Create a cycle schedule — e.g. office Monday–Friday or a 3-shift production rotation.")} /></div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {schedules.map((s) => (
              <div key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl ov-tile">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">
                        {s.name} <span className="font-mono text-[11px] font-semibold text-slate-400">({s.code})</span>
                      </p>
                      <p className="text-[11px] text-slate-400">{t("Cycle {n} hari · {m} karyawan ter-assign", "{n}-day cycle · {m} employees assigned", { n: s.cycleDays, m: s._count.assignments })}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleActive(s)}><StatusPill status={s.active ? "Active" : "Closed"} /></button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} aria-label={t("Edit jadwal", "Edit schedule")}>
                      <Pencil className="h-3.5 w-3.5 text-slate-400" />
                    </Button>
                  </div>
                </div>
                {/* cycle strip */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {s.days.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.dayType.color }} />
                      {d.sequence}. {d.dayType.code}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{edit ? t("Edit Jadwal {code}", "Edit Schedule {code}", { code: edit.code }) : t("Jadwal Cycle Baru", "New Cycle Schedule")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Kode *", "Code *")}</Label>
                <Input value={form.code} disabled={!!edit} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OFFICE-STD" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Nama *", "Name *")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("Jadwal Kantor (Senin-Jumat)", "Office Schedule (Monday-Friday)")} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">{t("Urutan Cycle ({n} hari)", "Cycle Sequence ({n} days)", { n: form.days.length })}</Label>
                <span className="text-[10px] text-slate-400">{t("seq 1 = hari anchor (Senin pertama)", "seq 1 = anchor day (first Monday)")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                {form.days.map((code, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    {i + 1}. {code}
                    <button type="button" onClick={() => form.days.length > 1 && setForm({ ...form, days: form.days.filter((_, j) => j !== i) })} aria-label={t("Hapus urutan", "Remove sequence")} className="text-slate-300 hover:text-rose-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setForm({ ...form, days: [...form.days, "OFFICE"] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-[10px] font-bold text-slate-500 hover:ov-border-accent hover:ov-text-accent dark:border-slate-700" aria-label={t("Tambah urutan", "Add sequence")}>
                  <Plus className="h-3 w-3" /> {t("hari", "day")}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayTypes.map((d) => (
                  <button key={d.id} type="button" onClick={() => setForm({ ...form, days: form.days.slice(0, -1).concat([d.code]) })} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 transition hover:ov-border-accent dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300" title={t("Ganti hari terakhir → {code}", "Replace last day → {code}", { code: d.code })}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.code}
                  </button>
                ))}
                <button type="button" onClick={() => setForm({ ...form, days: form.days.slice(0, -1) })} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:border-rose-300 dark:border-slate-700 dark:bg-slate-900" title={t("Hapus hari terakhir", "Remove last day")}>
                  <Minus className="h-3 w-3" />
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                {t("Klik kode tipe hari untuk mengganti hari terakhir dalam cycle, tombol ", "Click a day type code to replace the last day in the cycle, the ")}<Minus className="inline h-3 w-3" />{t(" untuk menghapus hari terakhir, ikon ", " button to remove the last day, the ")}<Trash2 className="inline h-3 w-3" />{t(" pada chip untuk menghapus posisi tertentu.", " icon on a chip to remove a specific position.")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} disabled={busy}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy || !form.code.trim() || !form.name.trim()} className="gap-1.5 font-bold">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Menyimpan…", "Saving…")}</> : <>{edit ? t("Simpan Perubahan", "Save Changes") : t("Buat Jadwal", "Create Schedule")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ TAB: PENGATURAN ============

function RulesTab() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const api = useApi<{ rule: AttendanceRule; components: { code: string; name: string; type: string }[]; allComponents: { code: string; name: string; type: string }[] }>("/api/rekankerja/attendance/settings");
  const [form, setForm] = useState<AttendanceRule | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false); // G11: Simpan Pengaturan sedang mengirim

  // ===== Task 100 F1 (G16, impl-E): generate kunci perangkat (tampil sekali) =====
  const canUpdateRules = perms.canOp("attendance", "templates-schedule", "update");
  const [keyConfirm, setKeyConfirm] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const regenDeviceKey = async () => {
    setKeyBusy(true);
    try {
      const res = await apiSend<{ rule: AttendanceRule; deviceApiKey: string }>("/api/rekankerja/attendance/settings", "PATCH", { op: "regenDeviceKey" });
      setKeyConfirm(false);
      setGeneratedKey(res.deviceApiKey);
      setKeyCopied(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menggenerate kunci", "Failed to generate the key"));
    } finally {
      setKeyBusy(false);
    }
  };

  const rule = form ?? api.data?.rule ?? null;
  const allComponents = api.data?.allComponents ?? [];

  const set = (patch: Partial<AttendanceRule>) => { setForm({ ...rule!, ...patch }); setDirty(true); };

  const save = async () => {
    if (!rule) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/attendance/settings", "PATCH", rule);
      toast.success(t("Pengaturan absensi disimpan", "Attendance settings saved"));
      setDirty(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  if (api.loading && !api.data) return <div className="p-5"><LoadingRows rows={4} /></div>;
  if (api.error) return <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />;
  if (!rule) return <EmptyState title={t("Aturan belum tersedia", "Rules not available")} />;

  const compName = (code: string) => allComponents.find((c) => c.code === code)?.name ?? code;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold">{t("Perhitungan & Pembulatan", "Calculation & Rounding")}</p>
              <p className="text-[11px] text-slate-400">{t("Padanan User Defined Rounding + kebijakan non-clocking", "Counterpart of User Defined Rounding + non-clocking policy")}</p>
            </div>
            <Settings2 className="h-5 w-5 ov-text-accent" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Pembulatan menit clocking (kelipatan)", "Clocking minute rounding (multiple of)")}</Label>
              <Input type="number" min={1} max={60} value={rule.roundingMinutes} onChange={(e) => set({ roundingMinutes: parseInt(e.target.value, 10) || 5 })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Telat/pulang cepat dibulatkan ke bawah kelipatan ini", "Late/early-out is rounded down to this multiple")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Minimum menit lembur", "Minimum overtime minutes")}</Label>
              <Input type="number" min={0} max={240} value={rule.minOvertimeMinutes} onChange={(e) => set({ minOvertimeMinutes: parseInt(e.target.value, 10) || 0 })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Lembur di bawah nilai ini dianggap 0", "Overtime below this value counts as 0")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Pembulatan jam lembur (kelipatan)", "Overtime hour rounding (multiple of)")}</Label>
              <Input type="number" min={1} max={60} value={rule.overtimeRoundingMinutes} onChange={(e) => set({ overtimeRoundingMinutes: parseInt(e.target.value, 10) || 30 })} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Kebijakan karyawan non-clocking", "Non-clocking employee policy")}</Label>
              <Select value={rule.nonClockingPolicy} onValueChange={(v) => set({ nonClockingPolicy: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AssumeNormal">{t("Anggap jam normal penuh", "Assume full normal hours")}</SelectItem>
                  <SelectItem value="ByHours">{t("Hitung per jam tercatat", "Count by recorded hours")}</SelectItem>
                  <SelectItem value="ByDays">{t("Hitung per hari", "Count by day")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Padanan \"Non Clocking Normal Hours Calculation\"", "Counterpart of \"Non Clocking Normal Hours Calculation\"")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Maksimal lembur / hari (jam) *", "Max overtime / day (hours) *")}</Label>
              <Input type="number" min={1} max={8} value={rule.maxOvertimeHours} onChange={(e) => set({ maxOvertimeHours: Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 4)) })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Batas PP 35/2021 — pengajuan lembur di atas nilai ini DITOLAK saat submit & approve", "PP 35/2021 limit — overtime requests above this are REJECTED on submit & approve")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Maksimal lembur / bulan (jam)", "Max overtime / month (hours)")}</Label>
              <Input type="number" min={0} max={200} value={rule.maxOvertimeHoursMonthly ?? 0} onChange={(e) => { const v = parseInt(e.target.value, 10) || 0; set({ maxOvertimeHoursMonthly: v > 0 ? v : null }); }} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Cap bulanan opsional (0 / kosong = tanpa cap bulanan)", "Optional monthly cap (0 / empty = no monthly cap)")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== 27-a: Geofencing Presensi ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold">{t("Geofencing Presensi", "Attendance Geofencing")}</p>
              <p className="text-[11px] text-slate-400">{t("Validasi radius GPS saat clock in/out ESS dari perangkat karyawan", "GPS radius validation for ESS clock in/out from employee devices")}</p>
            </div>
            <Radar className="h-5 w-5 ov-text-accent" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Mode geofencing *", "Geofence mode *")}</Label>
              <Select value={rule.geofenceMode || "Off"} onValueChange={(v) => set({ geofenceMode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Off">{t("Nonaktif (Off)", "Disabled (Off)")}</SelectItem>
                  <SelectItem value="Warn">{t("Peringatan (Warn)", "Warning (Warn)")}</SelectItem>
                  <SelectItem value="Strict">{t("Ketat (Strict)", "Strict (Strict)")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{
                (rule.geofenceMode || "Off") === "Strict"
                  ? t("Clock ESS DITOLAK bila di luar radius atau GPS tidak aktif — presensi hanya sah di dalam area lokasi kerja.", "ESS clock is REJECTED outside the radius or without GPS — attendance is only valid inside the work location area.")
                  : (rule.geofenceMode || "Off") === "Warn"
                    ? t("Clock di luar radius tetap tercatat, tetapi diberi catatan peringatan [geofence] jarak vs radius pada log.", "Clocking outside the radius is still recorded but flagged with a [geofence] distance-vs-radius note on the log.")
                    : t("Koordinat dicatat bila tersedia — tanpa validasi radius (semua clock diterima).", "Coordinates are stored when available — no radius validation (all clocks accepted).")
              }</p>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-bold"><MapPin className="h-3.5 w-3.5 ov-text-accent" aria-hidden /> {t("Koordinat lokasi kerja", "Work location coordinates")}</p>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
                {t(
                  "Koordinat (latitude/longitude/radius) diatur per lokasi kerja di menu Perusahaan & Organisasi › Kantor & Lokasi Kerja. Karyawan tanpa lokasi berkoordinat tidak divalidasi. Radius kosong = 200 m.",
                  "Coordinates (latitude/longitude/radius) are set per work location under Company & Organization › Offices & Work Locations. Employees without a coordinated location are not validated. Empty radius = 200 m.",
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== Task 100 F1 (G13/G18/G30/G14/G23/G29, impl-E): Kehadiran Lanjutan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold">{t("Kehadiran Lanjutan", "Advanced Attendance")}</p>
              <p className="text-[11px] text-slate-400">{t("Verifikasi identitas clock ESS, cap lembur konfiguratif, fatigue & burnout, kunci perangkat push", "ESS clock identity verification, configurable overtime caps, fatigue & burnout, push device key")}</p>
            </div>
            <Gauge className="h-5 w-5 ov-text-accent" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* G13 — mode selfie */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-bold"><Camera className="h-3.5 w-3.5 ov-text-accent" aria-hidden /> {t("Selfie saat clock *", "Selfie on clock *")}</Label>
              <Select value={rule.selfieMode ?? "off"} onValueChange={(v) => set({ selfieMode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("Nonaktif (off)", "Disabled (off)")}</SelectItem>
                  <SelectItem value="warn">{t("Peringatan (warn)", "Warning (warn)")}</SelectItem>
                  <SelectItem value="required">{t("Wajib (required)", "Required")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("required: clock ESS tanpa foto DITOLAK; warn: clock sah + catatan flag.", "required: ESS clock without a photo is REJECTED; warn: clock valid + flagged.")}</p>
            </div>
            {/* G30 — verifikasi wajah */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-bold"><ScanFace className="h-3.5 w-3.5 ov-text-accent" aria-hidden /> {t("Verifikasi wajah (VLM) *", "Face verification (VLM) *")}</Label>
              <Select value={rule.faceVerifyMode ?? "off"} onValueChange={(v) => set({ faceVerifyMode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("Nonaktif (off)", "Disabled (off)")}</SelectItem>
                  <SelectItem value="warn">{t("Peringatan (warn)", "Warning (warn)")}</SelectItem>
                  <SelectItem value="strict">{t("Ketat (strict)", "Strict (strict)")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Foto pertama jadi referensi; strict: wajah berbeda → clock ditolak. Model VLM sisi server.", "The first photo becomes the reference; strict: a different face → clock rejected. Server-side VLM model.")}</p>
            </div>
            {/* G18 — geofence multi-site */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-bold"><Radar className="h-3.5 w-3.5 ov-text-accent" aria-hidden /> {t("Geofence multi-lokasi", "Multi-site geofence")}</Label>
              <div className="flex items-center gap-2">
                <Switch id="geofenceMultiSite" checked={rule.geofenceMultiSite === true} onCheckedChange={(v) => set({ geofenceMultiSite: v })} />
                <Label htmlFor="geofenceMultiSite" className="text-xs font-medium">
                  {rule.geofenceMultiSite === true ? t("aktif — lokasi terdekat menang", "on — nearest location wins") : t("nonaktif — hanya lokasi utama", "off — main location only")}
                </Label>
              </div>
              <p className="text-[10px] text-slate-400">{t("Cocokkan jarak ke SEMUA lokasi kerja berkoordinat — karyawan di cabang lain tetap bisa absen sah.", "Match distance against ALL coordinated work locations — employees at other branches can still clock in validly.")}</p>
            </div>
            {/* G14 — mode cap lembur */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Batas cap lembur *", "Overtime cap preset *")}</Label>
              <Select value={rule.otCapMode ?? "PP35"} onValueChange={(v) => set({ otCapMode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PP35">{t("PP 35/2021 — 4 jam/hari, 18 jam/minggu", "PP 35/2021 — 4 h/day, 18 h/week")}</SelectItem>
                  <SelectItem value="KEPMEN102">{t("Kepmen 102/2004 — 3 jam/hari, 14 jam/minggu", "Kepmen 102/2004 — 3 h/day, 14 h/week")}</SelectItem>
                  <SelectItem value="CUSTOM">{t("Kustom", "Custom")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Cap 4 j/hari & 18 j/minggu hanya menghitung lembur HARI KERJA — lembur hari istirahat mingguan/libur resmi dikecualikan (PP 35/2021 Ps.26 ayat 2). Divalidasi ulang saat submit, approve & verifikasi.", "The 4 h/day & 18 h/week caps count weekday overtime only — rest-day/public-holiday overtime is excluded (GR 35/2021 Art. 26 (2)). Re-validated on submit, approve & verify.")}</p>
            </div>
            {(rule.otCapMode ?? "PP35") === "CUSTOM" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Cap lembur / hari (jam) *", "Overtime cap / day (hours) *")}</Label>
                  <Input type="number" min={1} max={40} value={rule.otCapDayHours ?? 4} onChange={(e) => set({ otCapDayHours: Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 4)) })} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Cap lembur / minggu (jam) *", "Overtime cap / week (hours) *")}</Label>
                  <Input type="number" min={1} max={40} value={rule.otCapWeekHours ?? 18} onChange={(e) => set({ otCapWeekHours: Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 18)) })} className="text-sm" />
                </div>
              </>
            )}
            {/* AUD-OT (PP 35/2021 Ps.31) — model minggu kerja → tabel rate
                upah lembur hari istirahat mingguan / libur resmi. */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Minggu kerja perusahaan *", "Company work week *")}</Label>
              <Select value={String(rule.otWorkweekDays ?? 5)} onValueChange={(v) => set({ otWorkweekDays: Number(v) })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">{t("5 hari × 8 jam (40 jam/minggu)", "5 days × 8 hours (40 h/week)")}</SelectItem>
                  <SelectItem value="6">{t("6 hari × ±7 jam (40 jam/minggu)", "6 days × ~7 hours (40 h/week)")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Menentukan tabel rate hari libur (PP 35/2021 Ps.31): 5 hari — 2× jam 1–8, 3× jam ke-9, 4× jam 10–12; 6 hari — 2× jam 1–7, 3× jam ke-8, 4× jam 9–11.", "Sets the rest-day rate table (GR 35/2021 Art. 31): 5-day — 2× hours 1–8, 3× hour 9, 4× hours 10–12; 6-day — 2× hours 1–7, 3× hour 8, 4× hours 9–11.")}</p>
            </div>
            {/* AUD-OT (PP 35/2021 Ps.32 ayat 3) — dasar upah lembur. */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Dasar upah lembur *", "Overtime pay basis *")}</Label>
              <Select value={rule.otBasisMode ?? "BASE"} onValueChange={(v) => set({ otBasisMode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BASE">{t("Gaji pokok saja", "Base salary only")}</SelectItem>
                  <SelectItem value="BASE_FIXED">{t("Gaji pokok + tunjangan tetap (Ps.32 ayat 3)", "Base salary + fixed allowances (Art. 32 (3))")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t("Upah/jam = dasar ÷ 173 (Ps.32 ayat 2). Ps.32 ayat 3: bila upah terdiri dari pokok + tunjangan tetap, dasar perhitungan = 100% upah — pilih komponen tunjangan tetap bila mode kedua.", "Hourly pay = basis ÷ 173 (Art. 32 (2)). Art. 32 (3): when pay consists of base + fixed allowances, the basis is 100% of pay — pick the fixed-allowance components in the second mode.")}</p>
            </div>
            {(rule.otBasisMode ?? "BASE") === "BASE_FIXED" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Komponen tunjangan tetap (kode)", "Fixed-allowance components (codes)")}</Label>
                <Input
                  value={rule.otBasisComponentCodes ?? ""}
                  onChange={(e) => set({ otBasisComponentCodes: e.target.value.toUpperCase() })}
                  placeholder={t("mis. TJAB,TKEL,TTRANS,TMAKAN", "e.g. TJAB,TKEL,TTRANS,TMAKAN")}
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-slate-400">{t("Pisahkan dengan koma — maks 12 kode. Nilai = assignment periodik karyawan (bila ada) atau default komponen (amount tetap / formula BASE_SALARY×k).", "Comma-separated — max 12 codes. Value = the employee's periodic assignment (if any) or the component default (fixed amount / BASE_SALARY×k formula).")}</p>
              </div>
            )}
            {/* G23 — fatigue rules */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Maks malam berturut-turut", "Max consecutive nights")}</Label>
              <Input type="number" min={1} max={10} value={rule.fatigueMaxConsecutiveNights ?? 4} onChange={(e) => set({ fatigueMaxConsecutiveNights: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 4)) })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Aturan fatigue 1–10 malam — shift malam berturut melebihi nilai ini ditandai.", "Fatigue rule 1–10 nights — consecutive night shifts above this are flagged.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Min istirahat antar shift (jam)", "Min rest between shifts (hours)")}</Label>
              <Input type="number" min={4} max={36} value={rule.fatigueMinRestHours ?? 8} onChange={(e) => set({ fatigueMinRestHours: Math.max(4, Math.min(36, parseInt(e.target.value, 10) || 8)) })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("4–36 jam — jeda istirahat minimum antar dua shift (fatigue G23).", "4–36 hours — minimum rest gap between two shifts (G23 fatigue).")}</p>
            </div>
            {/* G29 — burnout */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs font-bold"><Flame className="h-3.5 w-3.5 text-rose-500" aria-hidden /> {t("Ambang burnout lembur (jam/bulan)", "Overtime burnout threshold (hours/month)")}</Label>
              <Input type="number" min={1} max={200} value={rule.burnoutOtHoursMonthly ?? 40} onChange={(e) => set({ burnoutOtHoursMonthly: Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 40)) })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("1–200 jam — rata-rata lembur 3 bulan di atas ambang ini ditandai burnout di Ringkasan.", "1–200 hours — a 3-month overtime average above this is flagged as burnout on the Overview.")}</p>
            </div>
            {/* G16 — kunci perangkat push */}
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="flex items-center gap-1.5 text-xs font-bold"><KeyRound className="h-3.5 w-3.5 ov-text-accent" aria-hidden /> {t("Kunci Perangkat Push (ZKTeco)", "Push Device Key (ZKTeco)")}</Label>
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
                {rule.deviceApiKeySet ? (
                  <Badge variant="outline" className="border-brand/25 bg-brand/10 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
                    {t("kunci aktif", "key active")} <span className="font-mono font-normal">{rule.deviceApiKeyMasked ?? ""}</span>
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">{t("belum ada kunci", "no key yet")}</Badge>
                )}
                {canUpdateRules && (
                  <Button size="sm" variant="outline" className="ml-auto h-7 gap-1.5 px-2.5 text-[11px] font-bold" onClick={() => setKeyConfirm(true)} disabled={keyBusy}>
                    {keyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                    {t("Generate Kunci Perangkat", "Generate Device Key")}
                  </Button>
                )}
              </div>
              <p className="text-[10px] leading-relaxed text-amber-700 dark:text-amber-500">
                {t("⚠ Kunci penuh HANYA ditampilkan sekali di hasil generate (GET selalu masked) — salin & simpan di vault kredensial. Generate ulang mencabut kunci lama (mesin harus dikonfigurasi ulang).", "⚠ The full key is shown ONLY once on generation (GET is always masked) — copy & store it in a credentials vault. Regenerating revokes the old key (machines must be reconfigured).")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-5">
          <div className="mb-4">
            <p className="text-[13px] font-bold">{t("Pemetaan Komponen Payroll & Nilai", "Payroll Component Mapping & Values")}</p>
            <p className="text-[11px] text-slate-400">{t("Padanan Overtime Specified — jam absensi → komponen upah saat Transfer to Payroll", "Counterpart of Overtime Specified — attendance hours → wage components on Transfer to Payroll")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Komponen lembur", "Overtime component")}</Label>
              <Select value={rule.overtimeComponentCode} onValueChange={(v) => set({ overtimeComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Komponen potongan telat", "Late deduction component")}</Label>
              <Select value={rule.lateDeductionComponentCode} onValueChange={(v) => set({ lateDeductionComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Komponen potongan absen", "Absence deduction component")}</Label>
              <Select value={rule.absenceDeductionComponentCode} onValueChange={(v) => set({ absenceDeductionComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Komponen tunjangan kehadiran", "Attendance allowance component")}</Label>
              <Select value={rule.attendanceAllowanceComponentCode} onValueChange={(v) => set({ attendanceAllowanceComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Tunjangan kehadiran / bulan (Rp)", "Attendance allowance / month (Rp)")}</Label>
              <Input type="number" min={0} value={rule.attendanceAllowanceAmount} onChange={(e) => set({ attendanceAllowanceAmount: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("Diberikan bila sebulan penuh tanpa telat & absen (0 = nonaktif)", "Granted for a full month without lateness & absence (0 = disabled)")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Potongan telat / jam (Rp)", "Late deduction / hour (Rp)")}</Label>
              <Input type="number" min={0} value={rule.lateDeductionPerHour} onChange={(e) => set({ lateDeductionPerHour: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("0 = proporsional upah per jam (1/173 × gaji pokok)", "0 = proportional hourly wage (1/173 × base salary)")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Potongan absen / hari (Rp)", "Absence deduction / day (Rp)")}</Label>
              <Input type="number" min={0} value={rule.absenceDeductionPerDay} onChange={(e) => set({ absenceDeductionPerDay: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-slate-400">{t("0 = 1/25 × gaji pokok per hari absen", "0 = 1/25 × base salary per absent day")}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="text-[11px] text-slate-400">
              {t("Upah lembur selalu dihitung 1/173 × gaji pokok dengan multiplier per kategori hari (PP 35/2021).", "Overtime pay is always computed as 1/173 × base salary with a multiplier per day category (PP 35/2021).")}
            </p>
            <div className="flex gap-2">
              {dirty && (
                <Button variant="outline" size="sm" onClick={() => { setForm(null); setDirty(false); }} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> {t("Reset")}
                </Button>
              )}
              <Button size="sm" disabled={!dirty || busy} onClick={save} className="gap-1.5 font-bold">
                {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Menyimpan…", "Saving…")}</> : <>{t("Simpan Pengaturan", "Save Settings")}</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ===== G16: konfirmasi generate kunci perangkat ===== */}
      <AlertDialog open={keyConfirm} onOpenChange={(v) => { if (!v && !keyBusy) setKeyConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Generate kunci perangkat baru?", "Generate a new device key?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {rule.deviceApiKeySet
                ? t("Kunci lama akan DICABUT — mesin absen push yang memakai kunci lama berhenti sinkron sampai dikonfigurasi ulang.", "The OLD key is REVOKED — push attendance machines using the old key stop syncing until reconfigured.")
                : t("Kunci dipakai mesin absen PUSH SDK (ZKTeco) utk autentikasi ke /device-punch.", "The key is used by PUSH SDK (ZKTeco) attendance machines to authenticate against /device-punch.")}
              {" "}
              {t("Kunci penuh hanya ditampilkan SEKALI setelah ini — tidak bisa dilihat lagi.", "The full key is shown only ONCE afterwards — it cannot be viewed again.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={keyBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={keyBusy}
              className={cn("gap-1.5 font-bold", keyBusy && "opacity-70")}
              onClick={(e) => { e.preventDefault(); void regenDeviceKey(); }}
            >
              {keyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {t("Ya, Generate Kunci", "Yes, Generate Key")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== G16: dialog hasil generate — kunci penuh TAMPIL SEKALI + tombol salin ===== */}
      <Dialog open={!!generatedKey} onOpenChange={(v) => { if (!v) setGeneratedKey(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Kunci Perangkat Baru (tampilkan sekali)", "New Device Key (shown once)")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
              {t("Salin sekarang — kunci ini TIDAK akan ditampilkan lagi (GET selalu masked). Konfigurasikan mesin absen push (ZKTeco PUSH SDK): header X-Api-Key atau field key.", "Copy it now — this key is NEVER shown again (GET is always masked). Configure the push attendance machine (ZKTeco PUSH SDK): X-Api-Key header or key field.")}
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-slate-800 dark:bg-slate-900/60">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px] font-bold text-slate-800 dark:text-slate-100">{generatedKey}</code>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 font-bold"
                onClick={async () => {
                  if (!generatedKey) return;
                  try {
                    await navigator.clipboard.writeText(generatedKey);
                    setKeyCopied(true);
                    toast.success(t("Kunci disalin ke clipboard", "Key copied to clipboard"));
                  } catch {
                    toast.error(t("Gagal menyalin — salin manual dari teks", "Copy failed — copy the text manually"));
                  }
                }}
                aria-label={t("Salin kunci perangkat", "Copy the device key")}
              >
                {keyCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {keyCopied ? t("Tersalin", "Copied") : t("Salin", "Copy")}
              </Button>
            </div>
            <p className="text-[10px] text-slate-400">
              {t("Uji kunci dari halaman Import Mesin Absen → kartu Perangkat Push → Simulasikan Punch.", "Test the key from the Machine Import page → Push Device card → Simulate Punch.")}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setGeneratedKey(null)} className="font-bold">{t("Sudah Kusimpan", "I've Saved It")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
