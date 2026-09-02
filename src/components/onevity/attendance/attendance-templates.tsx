"use client";
// OneVity Attendance — Template Jadwal: tabs Tipe Hari (padanan DayType.jsp) /
// Jadwal cycle (WorkSchedule.jsp) / Pengaturan (Overtime Specified + Rounding).
import { useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DayTypeRow, ScheduleRow, AttendanceRule, DAY_CATEGORY_LABEL } from "@/components/onevity/attendance/attendance-types";
import { CalendarClock, Plus, Pencil, Palette, Layers, Settings2, Trash2, Minus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = ["#99CCFF", "#A7F3D0", "#FDE68A", "#C7D2FE", "#FCA5A5", "#86EFAC", "#E7E5E4", "#FDBA74", "#D9F99D", "#F5D0FE"];

export function AttendanceTemplatesPage() {
  const [tab, setTab] = useState("day-types");
  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Template Jadwal & Shift"
        description="Master tipe hari (jam kerja + toleransi), jadwal cycle rotasi, dan pengaturan perhitungan absensi"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="day-types" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Palette className="h-3.5 w-3.5" /> Tipe Hari
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <CalendarClock className="h-3.5 w-3.5" /> Jadwal Cycle
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Settings2 className="h-3.5 w-3.5" /> Pengaturan
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
  const api = useApi<{ dayTypes: DayTypeRow[] }>("/api/onevity/attendance/day-types");
  const [dialog, setDialog] = useState(false);
  const [edit, setEdit] = useState<DayTypeRow | null>(null);
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
        await apiSend(`/api/onevity/attendance/day-types`, "PATCH", { id: edit.id, ...body });
        toast.success(`Tipe hari ${form.code} diperbarui`);
      } else {
        await apiSend("/api/onevity/attendance/day-types", "POST", body);
        toast.success(`Tipe hari ${form.code} dibuat`);
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  };

  const toggleActive = async (d: DayTypeRow) => {
    try {
      await apiSend("/api/onevity/attendance/day-types", "PATCH", { id: d.id, active: !d.active });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  const dayTypes = api.data?.dayTypes ?? [];

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
          <div>
            <p className="text-[13px] font-bold">Master Tipe Hari</p>
            <p className="text-[11px] text-stone-400">Padanan oranHR Day Type — jam kerja, istirahat, toleransi telat/pulang cepat</p>
          </div>
          <Button onClick={openCreate} size="sm" className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-3.5 w-3.5" /> Tipe Hari
          </Button>
        </div>
        {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : dayTypes.length === 0 ? (
          <div className="p-5"><EmptyState title="Belum ada tipe hari" description="Buat tipe hari pertama — mis. Jam Kantor 08:00-17:00 atau shift produksi." /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                  <TableHead className="text-[11px] font-bold">Tipe Hari</TableHead>
                  <TableHead className="text-[11px] font-bold">Jam Kerja</TableHead>
                  <TableHead className="text-[11px] font-bold">Istirahat</TableHead>
                  <TableHead className="text-[11px] font-bold">Jam Normal</TableHead>
                  <TableHead className="text-[11px] font-bold">Toleransi</TableHead>
                  <TableHead className="text-[11px] font-bold">Kategori</TableHead>
                  <TableHead className="text-[11px] font-bold">Status</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dayTypes.map((d) => (
                  <TableRow key={d.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-2.5 shrink-0 rounded-full border border-stone-300/60 dark:border-stone-700" style={{ backgroundColor: d.color }} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{d.code}</p>
                          <p className="truncate text-[11px] text-stone-400">{d.name}</p>
                        </div>
                        {d.flexible && <Badge variant="outline" className="text-[9px] font-bold">FLEKSIBEL</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-stone-600 dark:text-stone-300">
                      {d.timeIn ? `${d.timeIn}–${d.timeOut}${d.nextDay ? " +1" : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-stone-600 dark:text-stone-300">
                      {d.breakMinutes > 0 ? `${d.breakMinutes} mnt${d.breakPaid ? " (dibayar)" : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-semibold">{d.normalMinutes > 0 ? `${(d.normalMinutes / 60).toLocaleString("id-ID")} jam` : "—"}</TableCell>
                    <TableCell className="text-xs text-stone-500">±{d.toleranceLateMinutes}/±{d.toleranceEarlyMinutes} mnt</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        "text-[10px] font-bold",
                        d.category === "Workday" && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-400",
                        d.category === "Off" && "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
                        d.category === "Holiday" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                      )}>{DAY_CATEGORY_LABEL[d.category] ?? d.category}</Badge>
                    </TableCell>
                    <TableCell>
                      <button onClick={() => toggleActive(d)} title={d.active ? "Nonaktifkan" : "Aktifkan"}>
                        <StatusPill status={d.active ? "Active" : "Closed"} />
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(d)} aria-label="Edit tipe hari">
                        <Pencil className="h-3.5 w-3.5 text-stone-400" />
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{edit ? `Edit Tipe Hari ${edit.code}` : "Tipe Hari Baru"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kode *</Label>
                <Input value={form.code} disabled={!!edit} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OFFICE" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Nama *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jam Kantor 08:00-17:00" className="text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kategori</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Workday">Hari Kerja</SelectItem>
                    <SelectItem value="Off">Hari Libur</SelectItem>
                    <SelectItem value="Holiday">Libur Nasional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Warna</Label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {PRESET_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })} className={cn("h-6 w-6 rounded-full border-2", form.color === c ? "border-stone-800 dark:border-stone-200" : "border-transparent")} style={{ backgroundColor: c }} aria-label={`Pilih warna ${c}`} />
                  ))}
                </div>
              </div>
            </div>
            {form.category === "Workday" && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Jam Masuk</Label>
                    <Input type="time" value={form.timeIn} onChange={(e) => setForm({ ...form, timeIn: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Jam Keluar</Label>
                    <Input type="time" value={form.timeOut} onChange={(e) => setForm({ ...form, timeOut: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Jam Normal</Label>
                    <Input type="number" min={0} max={960} value={form.normalMinutes} onChange={(e) => setForm({ ...form, normalMinutes: e.target.value })} className="text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Istirahat (menit)</Label>
                    <Input type="number" min={0} max={240} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} className="text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Toleransi telat / pulang cepat</Label>
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={0} max={120} value={form.toleranceLateMinutes} onChange={(e) => setForm({ ...form, toleranceLateMinutes: e.target.value })} className="text-sm" />
                      <span className="text-xs text-stone-400">/</span>
                      <Input type="number" min={0} max={120} value={form.toleranceEarlyMinutes} onChange={(e) => setForm({ ...form, toleranceEarlyMinutes: e.target.value })} className="text-sm" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.nextDay} onCheckedChange={(v) => setForm({ ...form, nextDay: v })} id="nextDay" />
                    <Label htmlFor="nextDay" className="text-xs font-medium">Shift lintas hari (malam)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.flexible} onCheckedChange={(v) => setForm({ ...form, flexible: v })} id="flexible" />
                    <Label htmlFor="flexible" className="text-xs font-medium">Jam fleksibel</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={form.needOvertimeOrder} onCheckedChange={(v) => setForm({ ...form, needOvertimeOrder: v })} id="needOT" />
                    <Label htmlFor="needOT" className="text-xs font-medium">Lembur wajib work order</Label>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={save} className="bg-emerald-600 font-bold hover:bg-emerald-700">{edit ? "Simpan Perubahan" : "Buat Tipe Hari"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ TAB: JADWAL CYCLE ============

function SchedulesTab() {
  const api = useApi<{ schedules: ScheduleRow[]; dayTypes: { id: string; code: string; name: string; color: string; category: string }[] }>("/api/onevity/attendance/schedules");
  const [dialog, setDialog] = useState(false);
  const [edit, setEdit] = useState<ScheduleRow | null>(null);
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
    try {
      if (edit) {
        await apiSend("/api/onevity/attendance/schedules", "PATCH", { id: edit.id, name: form.name, days: form.days });
        toast.success(`Jadwal ${form.code} diperbarui`);
      } else {
        await apiSend("/api/onevity/attendance/schedules", "POST", form);
        toast.success(`Jadwal ${form.code} dibuat — cycle ${form.days.length} hari`);
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  };

  const toggleActive = async (s: ScheduleRow) => {
    try {
      await apiSend("/api/onevity/attendance/schedules", "PATCH", { id: s.id, active: !s.active });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  const schedules = api.data?.schedules ?? [];

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
          <div>
            <p className="text-[13px] font-bold">Jadwal Cycle (Rotasi)</p>
            <p className="text-[11px] text-stone-400">Padanan oranHR Work Schedule — urutan day type per cycle (umumnya 7 hari)</p>
          </div>
          <Button onClick={openCreate} size="sm" className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-3.5 w-3.5" /> Jadwal
          </Button>
        </div>
        {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={4} /></div> : schedules.length === 0 ? (
          <div className="p-5"><EmptyState title="Belum ada jadwal" description="Buat jadwal cycle — mis. kantor Senin–Jumat atau rotasi 3 regu produksi." /></div>
        ) : (
          <div className="divide-y divide-stone-100 dark:divide-stone-800">
            {schedules.map((s) => (
              <div key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">
                        {s.name} <span className="font-mono text-[11px] font-semibold text-stone-400">({s.code})</span>
                      </p>
                      <p className="text-[11px] text-stone-400">Cycle {s.cycleDays} hari · {s._count.assignments} karyawan ter-assign</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toggleActive(s)}><StatusPill status={s.active ? "Active" : "Closed"} /></button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)} aria-label="Edit jadwal">
                      <Pencil className="h-3.5 w-3.5 text-stone-400" />
                    </Button>
                  </div>
                </div>
                {/* cycle strip */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {s.days.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200/80 px-2 py-1 text-[10px] font-bold text-stone-600 dark:border-stone-700 dark:text-stone-300">
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{edit ? `Edit Jadwal ${edit.code}` : "Jadwal Cycle Baru"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Kode *</Label>
                <Input value={form.code} disabled={!!edit} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OFFICE-STD" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Nama *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jadwal Kantor (Senin-Jumat)" className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold">Urutan Cycle ({form.days.length} hari)</Label>
                <span className="text-[10px] text-stone-400">seq 1 = hari anchor (Senin pertama)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-stone-200 bg-stone-50/60 p-2.5 dark:border-stone-800 dark:bg-stone-900/40">
                {form.days.map((code, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    {i + 1}. {code}
                    <button type="button" onClick={() => form.days.length > 1 && setForm({ ...form, days: form.days.filter((_, j) => j !== i) })} aria-label="Hapus urutan" className="text-stone-300 hover:text-rose-500">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => setForm({ ...form, days: [...form.days, "OFFICE"] })} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-2 py-1 text-[10px] font-bold text-stone-500 hover:border-emerald-400 hover:text-emerald-600 dark:border-stone-700" aria-label="Tambah urutan">
                  <Plus className="h-3 w-3" /> hari
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayTypes.map((d) => (
                  <button key={d.id} type="button" onClick={() => setForm({ ...form, days: form.days.slice(0, -1).concat([d.code]) })} className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-600 transition hover:border-emerald-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300" title={`Ganti hari terakhir → ${d.code}`}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.code}
                  </button>
                ))}
                <button type="button" onClick={() => setForm({ ...form, days: form.days.slice(0, -1) })} className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[10px] font-bold text-stone-500 hover:border-rose-300 dark:border-stone-700 dark:bg-stone-900" title="Hapus hari terakhir">
                  <Minus className="h-3 w-3" />
                </button>
              </div>
              <p className="text-[10px] leading-relaxed text-stone-400">
                Klik kode tipe hari untuk mengganti hari terakhir dalam cycle, tombol <Minus className="inline h-3 w-3" /> untuk menghapus hari terakhir, ikon <Trash2 className="inline h-3 w-3" /> pada chip untuk menghapus posisi tertentu.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={save} className="bg-emerald-600 font-bold hover:bg-emerald-700">{edit ? "Simpan Perubahan" : "Buat Jadwal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============ TAB: PENGATURAN ============

function RulesTab() {
  const api = useApi<{ rule: AttendanceRule; components: { code: string; name: string; type: string }[]; allComponents: { code: string; name: string; type: string }[] }>("/api/onevity/attendance/settings");
  const [form, setForm] = useState<AttendanceRule | null>(null);
  const [dirty, setDirty] = useState(false);

  const rule = form ?? api.data?.rule ?? null;
  const allComponents = api.data?.allComponents ?? [];

  const set = (patch: Partial<AttendanceRule>) => { setForm({ ...rule!, ...patch }); setDirty(true); };

  const save = async () => {
    if (!rule) return;
    try {
      await apiSend("/api/onevity/attendance/settings", "PATCH", rule);
      toast.success("Pengaturan absensi disimpan");
      setDirty(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan");
    }
  };

  if (api.loading && !api.data) return <div className="p-5"><LoadingRows rows={4} /></div>;
  if (!rule) return <EmptyState title="Aturan belum tersedia" />;

  const compName = (code: string) => allComponents.find((c) => c.code === code)?.name ?? code;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold">Perhitungan & Pembulatan</p>
              <p className="text-[11px] text-stone-400">Padanan oranHR User Defined Rounding + kebijakan non-clocking</p>
            </div>
            <Settings2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Pembulatan menit clocking (kelipatan)</Label>
              <Input type="number" min={1} max={60} value={rule.roundingMinutes} onChange={(e) => set({ roundingMinutes: parseInt(e.target.value, 10) || 5 })} className="text-sm" />
              <p className="text-[10px] text-stone-400">Telat/pulang cepat dibulatkan ke bawah kelipatan ini</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Minimum menit lembur</Label>
              <Input type="number" min={0} max={240} value={rule.minOvertimeMinutes} onChange={(e) => set({ minOvertimeMinutes: parseInt(e.target.value, 10) || 0 })} className="text-sm" />
              <p className="text-[10px] text-stone-400">Lembur di bawah nilai ini dianggap 0</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Pembulatan jam lembur (kelipatan)</Label>
              <Input type="number" min={1} max={60} value={rule.overtimeRoundingMinutes} onChange={(e) => set({ overtimeRoundingMinutes: parseInt(e.target.value, 10) || 30 })} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Kebijakan karyawan non-clocking</Label>
              <Select value={rule.nonClockingPolicy} onValueChange={(v) => set({ nonClockingPolicy: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AssumeNormal">Anggap jam normal penuh</SelectItem>
                  <SelectItem value="ByHours">Hitung per jam tercatat</SelectItem>
                  <SelectItem value="ByDays">Hitung per hari</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-stone-400">Padanan "Non Clocking Normal Hours Calculation" oranHR</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-5">
          <div className="mb-4">
            <p className="text-[13px] font-bold">Pemetaan Komponen Payroll & Nilai</p>
            <p className="text-[11px] text-stone-400">Padanan oranHR Overtime Specified — jam absensi → komponen upah saat Transfer to Payroll</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Komponen lembur</Label>
              <Select value={rule.overtimeComponentCode} onValueChange={(v) => set({ overtimeComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Komponen potongan telat</Label>
              <Select value={rule.lateDeductionComponentCode} onValueChange={(v) => set({ lateDeductionComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Komponen potongan absen</Label>
              <Select value={rule.absenceDeductionComponentCode} onValueChange={(v) => set({ absenceDeductionComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Komponen tunjangan kehadiran</Label>
              <Select value={rule.attendanceAllowanceComponentCode} onValueChange={(v) => set({ attendanceAllowanceComponentCode: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{allComponents.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Tunjangan kehadiran / bulan (Rp)</Label>
              <Input type="number" min={0} value={rule.attendanceAllowanceAmount} onChange={(e) => set({ attendanceAllowanceAmount: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-stone-400">Diberikan bila sebulan penuh tanpa telat & absen (0 = nonaktif)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Potongan telat / jam (Rp)</Label>
              <Input type="number" min={0} value={rule.lateDeductionPerHour} onChange={(e) => set({ lateDeductionPerHour: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-stone-400">0 = proporsional upah per jam (1/173 × gaji pokok)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Potongan absen / hari (Rp)</Label>
              <Input type="number" min={0} value={rule.absenceDeductionPerDay} onChange={(e) => set({ absenceDeductionPerDay: Number(e.target.value) || 0 })} className="text-sm" />
              <p className="text-[10px] text-stone-400">0 = 1/25 × gaji pokok per hari absen</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-stone-100 pt-4 dark:border-stone-800">
            <p className="text-[11px] text-stone-400">
              Upah lembur selalu dihitung 1/173 × gaji pokok dengan multiplier per kategori hari (PP 35/2021).
            </p>
            <div className="flex gap-2">
              {dirty && (
                <Button variant="outline" size="sm" onClick={() => { setForm(null); setDirty(false); }} className="gap-1.5">
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
              )}
              <Button size="sm" disabled={!dirty} onClick={save} className="gap-1.5 bg-emerald-600 font-bold hover:bg-emerald-700">
                Simpan Pengaturan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
