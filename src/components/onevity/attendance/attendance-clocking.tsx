"use client";
// OneVity Attendance — Data Clocking: rekap harian per tanggal (padanan
// EmpClocking.jsp) + input clock manual + Refresh Clocking.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { DailyRow, ClockLogRow, EmployeeOption, ATT_STATUS_LABEL } from "@/components/onevity/attendance/attendance-types";
import { Activity, Plus, RefreshCw, Search, LogIn, LogOut, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  Present: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  Late: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  Absent: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  WorkOff: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  Off: "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400",
};

const fmtTime = (d: string | null) => {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export function AttendanceClockingPage() {
  const [date, setDate] = useState(todayIso());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [clockDialog, setClockDialog] = useState(false);
  const [form, setForm] = useState({ employeeId: "", time: "08:00", direction: "IN", note: "" });

  const api = useApi<{ date: string; rows: DailyRow[]; logs: ClockLogRow[]; employees: EmployeeOption[]; stats: { total: number; present: number; late: number; absent: number; workoff: number; off: number; lateMinutes: number; overtimeMinutes: number } }>(`/api/onevity/attendance/clocking?date=${date}`);

  const rows = useMemo(() => (api.data?.rows ?? []).filter((r) =>
    (!query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.employeeNo.toLowerCase().includes(query.toLowerCase())) &&
    (statusFilter === "all" || r.status === statusFilter)
  ), [api.data, query, statusFilter]);

  const submitClock = async () => {
    try {
      await apiSend("/api/onevity/attendance/clocking", "POST", { ...form, date });
      toast.success(`Clock ${form.direction} ${form.time} tercatat — rekap harian diperbarui`);
      setClockDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mencatat clock");
    }
  };

  const regenerate = async () => {
    try {
      const res = await apiSend<{ regenerated: number }>("/api/onevity/attendance/clocking", "PATCH", { date });
      toast.success(`Refresh Clocking selesai — ${res.regenerated} karyawan dihitung ulang`);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghitung ulang");
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Data Clocking Harian"
        description="Rekap presensi per tanggal — hour buckets telat/pulang cepat/normal/absen, padanan Employee Clocking oranHR"
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-36 text-xs font-bold" />
            <Button variant="outline" onClick={regenerate} className="gap-2 font-bold">
              <RefreshCw className="h-4 w-4" /> Refresh Clocking
            </Button>
            <Button onClick={() => { setForm({ employeeId: api.data?.employees[0]?.id ?? "", time: "08:00", direction: "IN", note: "" }); setClockDialog(true); }} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              <Plus className="h-4 w-4" /> Catat Clock
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3 xl:grid-cols-6">
        {[
          { label: "Hadir", value: stats?.present ?? 0, tone: "text-emerald-600 dark:text-emerald-400" },
          { label: "Telat", value: stats?.late ?? 0, tone: "text-amber-600 dark:text-amber-400" },
          { label: "Absen", value: stats?.absent ?? 0, tone: "text-rose-600 dark:text-rose-400" },
          { label: "Izin", value: stats?.workoff ?? 0, tone: "text-violet-600 dark:text-violet-400" },
          { label: "Off", value: stats?.off ?? 0, tone: "text-stone-500" },
          { label: "Total Telat", value: `${Math.round((stats?.lateMinutes ?? 0) / 60)} j`, tone: "text-amber-700" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
            <p className={cn("text-lg font-extrabold", k.tone)}>{k.value}</p>
          </div>
        ))}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <Tabs defaultValue="recap">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3 dark:border-stone-800">
              <TabsList className="h-auto rounded-xl bg-stone-100 p-1 dark:bg-stone-900">
                <TabsTrigger value="recap" className="gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                  <Activity className="h-3.5 w-3.5" /> Rekap ({api.data?.rows.length ?? 0})
                </TabsTrigger>
                <TabsTrigger value="logs" className="gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
                  <Clock className="h-3.5 w-3.5" /> Log Mentah ({api.data?.logs.length ?? 0})
                </TabsTrigger>
              </TabsList>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-32 text-xs font-bold"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="Present">Hadir</SelectItem>
                    <SelectItem value="Late">Telat</SelectItem>
                    <SelectItem value="Absent">Absen</SelectItem>
                    <SelectItem value="WorkOff">Izin</SelectItem>
                    <SelectItem value="Off">Off</SelectItem>
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan…" className="h-8 w-48 pl-8 text-xs" />
                </div>
              </div>
            </div>

            <TabsContent value="recap">
              {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : rows.length === 0 ? (
                <div className="p-5"><EmptyState title="Tidak ada data rekap" description="Pilih tanggal lain atau catat clock terlebih dahulu." icon={<Activity className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-[11px] font-bold">Tipe Hari</TableHead>
                        <TableHead className="text-[11px] font-bold">Clock In</TableHead>
                        <TableHead className="text-[11px] font-bold">Clock Out</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Telat</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Pulang Cepat</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Jam Kerja</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Lembur</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.employeeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                          <TableCell>
                            <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{r.fullName}</p>
                            <p className="font-mono text-[10px] text-stone-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                            {r.notes && <p className="text-[10px] italic text-stone-400">{r.notes}</p>}
                          </TableCell>
                          <TableCell>
                            {r.dayTypeCode ? (
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.dayTypeColor ?? "#E7E5E4" }} />
                                {r.dayTypeCode}
                              </span>
                            ) : <span className="text-xs text-stone-400">tanpa jadwal</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{fmtTime(r.checkIn)}</TableCell>
                          <TableCell className="font-mono text-xs">{fmtTime(r.checkOut)}</TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.lateMinutes > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-400")}>
                            {r.lateMinutes > 0 ? `${r.lateMinutes} mnt` : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.earlyMinutes > 0 ? "text-orange-600 dark:text-orange-400" : "text-stone-400")}>
                            {r.earlyMinutes > 0 ? `${r.earlyMinutes} mnt` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold">
                            {r.workMinutes > 0 ? `${(r.workMinutes / 60).toFixed(1)} j` : "—"}
                          </TableCell>
                          <TableCell className={cn("text-right text-xs font-bold", r.overtimeMinutes > 0 ? "text-teal-600 dark:text-teal-400" : "text-stone-400")}>
                            {r.overtimeMinutes > 0 ? `${(r.overtimeMinutes / 60).toFixed(1)} j` : "—"}
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold", STATUS_TONE[r.status] ?? "bg-stone-100 text-stone-500")}>
                              {ATT_STATUS_LABEL[r.status] ?? r.status}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs">
              {(api.data?.logs ?? []).length === 0 ? (
                <div className="p-5"><EmptyState title="Belum ada log pada tanggal ini" description="Catat clock manual atau hubungkan mesin absensi." icon={<Clock className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">Waktu</TableHead>
                        <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-[11px] font-bold">Arah</TableHead>
                        <TableHead className="text-[11px] font-bold">Sumber</TableHead>
                        <TableHead className="text-[11px] font-bold">Catatan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(api.data?.logs ?? []).map((l) => (
                        <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                          <TableCell className="font-mono text-xs font-bold">{fmtTime(l.timestamp)}</TableCell>
                          <TableCell className="text-xs">
                            <p className="font-semibold">{l.employee.fullName}</p>
                            <p className="font-mono text-[10px] text-stone-400">{l.employee.employeeNo}</p>
                          </TableCell>
                          <TableCell>
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold", l.direction === "IN" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400")}>
                              {l.direction === "IN" ? <LogIn className="h-3 w-3" /> : <LogOut className="h-3 w-3" />} {l.direction}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-stone-500">{l.source}</TableCell>
                          <TableCell className="text-xs text-stone-500">{l.note ?? "—"}</TableCell>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Catat Clock Manual — {date}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Karyawan *</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(api.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Arah</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN">Clock IN (masuk)</SelectItem>
                    <SelectItem value="OUT">Clock OUT (pulang)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Jam *</Label>
                <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Catatan</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="mis. lupa kartu, input operator" className="text-sm" />
            </div>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              Rekap harian karyawan otomatis dihitung ulang setelah clock dicatat (padanan Temporary Employee Clocking + Refresh).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClockDialog(false)}>Batal</Button>
            <Button onClick={submitClock} disabled={!form.employeeId} className="bg-emerald-600 font-bold hover:bg-emerald-700">Catat Clock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
