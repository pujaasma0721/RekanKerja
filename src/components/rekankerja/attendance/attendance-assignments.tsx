"use client";
// RekanKerja Attendance — Assign Jadwal: penugasan jadwal per karyawan
// (padanan oranHR EmpWorkSchedule.jsp) + anchor Senin + non-clocking.
import { useState } from "react";
import { useApi, apiSend, fmtDate } from "@/lib/rekankerja/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AssignmentRow, EmployeeOption } from "@/components/rekankerja/attendance/attendance-types";
import { CalendarRange, Plus, LogOut, Search, Anchor, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function AttendanceAssignmentsPage() {
  const api = useApi<{ assignments: AssignmentRow[]; schedules: { id: string; code: string; name: string; cycleDays: number }[]; employees: EmployeeOption[] }>("/api/rekankerja/attendance/assignments");
  const [dialog, setDialog] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    employeeId: "", scheduleId: "",
    validFrom: iso(new Date()), anchorMonday: iso(mondayOf(new Date())),
    anchorSequence: "1", clockingRequired: true, notes: "",
  });

  const assignments = api.data?.assignments ?? [];
  const schedules = api.data?.schedules ?? [];
  const employees = api.data?.employees ?? [];
  const active = assignments.filter((a) => !a.validTo);
  const history = assignments.filter((a) => a.validTo);
  const filtered = active.filter((a) =>
    !query || a.employee.fullName.toLowerCase().includes(query.toLowerCase()) || a.employee.employeeNo.toLowerCase().includes(query.toLowerCase())
  );
  const scheduledIds = new Set(active.map((a) => a.employeeId));
  const unassigned = employees.filter((e) => !scheduledIds.has(e.id));

  const submit = async () => {
    try {
      await apiSend("/api/rekankerja/attendance/assignments", "POST", {
        ...form,
        anchorSequence: parseInt(form.anchorSequence, 10) || 1,
      });
      toast.success("Jadwal ditugaskan — rekap hari-hari berikutnya akan memakai jadwal baru");
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menugaskan jadwal");
    }
  };

  const endAssignment = async (a: AssignmentRow) => {
    try {
      await apiSend("/api/rekankerja/attendance/assignments", "PATCH", { id: a.id, action: "end" });
      toast.success(`Penugasan ${a.employee.fullName} diakhiri`);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  const toggleClocking = async (a: AssignmentRow) => {
    try {
      await apiSend("/api/rekankerja/attendance/assignments", "PATCH", { id: a.id, clockingRequired: !a.clockingRequired });
      toast.success(`${a.employee.fullName} kini ${!a.clockingRequired ? "wajib" : "tidak wajib"} clocking (jam ${!a.clockingRequired ? "dicatat" : "dianggap normal"})`);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  const kpi = [
    { label: "Karyawan Ter-Assign", value: String(active.length), sub: `${employees.length} karyawan aktif` },
    { label: "Belum Ter-assign", value: String(unassigned.length), sub: unassigned.length ? "perlu penugasan jadwal" : "semua sudah ter-assign" },
    { label: "Jadwal Dipakai", value: String(new Set(active.map((a) => a.schedule.code)).size), sub: `${schedules.length} template tersedia` },
    { label: "Non-Clocking", value: String(active.filter((a) => !a.clockingRequired).length), sub: "jam dianggap normal" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Assign Jadwal Karyawan"
        description="Penugasan jadwal cycle per karyawan — padanan Employee Schedule Assignment oranHR dengan anchor Senin rotasi"
        actions={
          <Button onClick={() => setDialog(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Assign Jadwal
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpi.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-slate-50">{k.value}</p>
            <p className="truncate text-[11px] text-slate-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {unassigned.length > 0 && (
        <Card className="mb-4 rounded-2xl border-amber-200/80 bg-amber-50/60 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
              {unassigned.length} karyawan belum punya jadwal — hari tanpa jadwal dianggap Off dalam rekap absensi.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5 border-amber-300 font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300" onClick={() => { setForm({ ...form, employeeId: unassigned[0]!.id }); setDialog(true); }}>
              <CalendarRange className="h-3.5 w-3.5" /> Assign Sekarang
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <p className="text-[13px] font-bold">Penugasan Aktif ({active.length})</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan / no. pegawai…" className="h-8 w-56 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : filtered.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada penugasan jadwal" description="Assign jadwal cycle ke karyawan — rekap absensi mengikuti day type efektif." icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Jadwal</TableHead>
                    <TableHead className="text-[11px] font-bold">Cycle</TableHead>
                    <TableHead className="text-[11px] font-bold">Berlaku Sejak</TableHead>
                    <TableHead className="text-[11px] font-bold">Clocking</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map((a) => (
                    <TableRow key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{a.employee.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-400">{a.employee.employeeNo} · {a.employee.assignments[0]?.orgUnit?.name ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-semibold">{a.schedule.name}</p>
                        <p className="font-mono text-[10px] text-slate-400">{a.schedule.code}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {a.schedule.days.slice(0, 7).map((d) => (
                            <span key={d.sequence} className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[8px] font-extrabold text-slate-700 dark:text-slate-300" style={{ backgroundColor: d.dayType.color + "66" }} title={`seq ${d.sequence}: ${d.dayType.name}`}>
                              {d.dayType.code.slice(0, 3)}
                            </span>
                          ))}
                          {a.schedule.days.length > 7 && <span className="text-[9px] font-bold text-slate-400">+{a.schedule.days.length - 7}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-slate-600 dark:text-slate-300">{fmtDate(a.validFrom)}</p>
                        <p className="flex items-center gap-1 text-[10px] text-slate-400"><Anchor className="h-2.5 w-2.5" /> anchor seq {a.anchorSequence} · {fmtDate(a.anchorMonday)}</p>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleClocking(a)} className="inline-flex items-center gap-1.5" title={a.clockingRequired ? "Non-clocking: jam dianggap normal" : "Wajib clocking"}>
                          <span className={cn("relative h-4 w-7 rounded-full transition", a.clockingRequired ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700")}>
                            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition", a.clockingRequired ? "left-3.5" : "left-0.5")} />
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">{a.clockingRequired ? "Wajib" : "Non-clock"}</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => endAssignment(a)} title="Akhiri penugasan" aria-label="Akhiri penugasan">
                          <LogOut className="h-3.5 w-3.5 text-slate-400 hover:text-rose-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {history.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Riwayat Penugatan ({history.length})</p>
              <div className="max-h-40 overflow-y-auto">
                {history.slice(0, 30).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">{a.employee.employeeNo} · {a.employee.fullName}</span>
                    <span className="text-slate-400">{a.schedule.name}</span>
                    <span className="text-slate-400">{fmtDate(a.validFrom)} → {fmtDate(a.validTo)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Jadwal Karyawan</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Karyawan *</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.employeeNo} · {e.fullName} {scheduledIds.has(e.id) && <Badge variant="outline" className="ml-1 text-[9px]">re-assign</Badge>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Jadwal *</Label>
              <Select value={form.scheduleId} onValueChange={(v) => setForm({ ...form, scheduleId: v, anchorSequence: "1" })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih jadwal cycle" /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({s.code}) — cycle {s.cycleDays} hari</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Berlaku Mulai</Label>
                <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value, anchorMonday: iso(mondayOf(new Date(e.target.value))) })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Anchor Senin</Label>
                <Input type="date" value={form.anchorMonday} onChange={(e) => setForm({ ...form, anchorMonday: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Seq di Anchor</Label>
                <Input type="number" min={1} max={28} value={form.anchorSequence} onChange={(e) => setForm({ ...form, anchorSequence: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="clockingReq" checked={form.clockingRequired} onCheckedChange={(v) => setForm({ ...form, clockingRequired: v })} />
              <Label htmlFor="clockingReq" className="flex items-center gap-1.5 text-xs font-medium">
                <Clock className="h-3.5 w-3.5 text-slate-400" /> Wajib clocking (nonaktif = jam dianggap normal, padanan clocking_all)
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Catatan</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="mis. pindah regu produksi" className="text-sm" />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              Assignment lama otomatis ditutup sehari sebelum tanggal mulai (riwayat tetap tersimpan). Cycle dihitung dari anchor Senin: tanggal = sequence ke-((selisih hari + seq anchor) mod cycle).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={submit} disabled={!form.employeeId || !form.scheduleId} className="bg-emerald-600 font-bold hover:bg-emerald-700">Assign Jadwal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
