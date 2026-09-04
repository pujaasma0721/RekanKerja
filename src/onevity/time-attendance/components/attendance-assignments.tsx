"use client";
// OneVity Attendance — Assign Jadwal: penugasan jadwal per karyawan
// (padanan EmpWorkSchedule.jsp) + anchor Senin + non-clocking.
import { useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
import { AssignmentRow, EmployeeOption } from "@/onevity/time-attendance/components/attendance-types";
import { useI18n } from "@/onevity/shared/lib/i18n";
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
  const { t } = useI18n();
  const api = useApi<{ assignments: AssignmentRow[]; schedules: { id: string; code: string; name: string; cycleDays: number }[]; employees: EmployeeOption[] }>("/api/onevity/attendance/assignments");
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
      await apiSend("/api/onevity/attendance/assignments", "POST", {
        ...form,
        anchorSequence: parseInt(form.anchorSequence, 10) || 1,
      });
      toast.success(t("Jadwal ditugaskan — rekap hari-hari berikutnya akan memakai jadwal baru", "Schedule assigned — subsequent days' recap will use the new schedule"));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menugaskan jadwal", "Failed to assign schedule"));
    }
  };

  const endAssignment = async (a: AssignmentRow) => {
    try {
      await apiSend("/api/onevity/attendance/assignments", "PATCH", { id: a.id, action: "end" });
      toast.success(t("Penugasan {name} diakhiri", "Assignment for {name} ended", { name: a.employee.fullName }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  const toggleClocking = async (a: AssignmentRow) => {
    try {
      await apiSend("/api/onevity/attendance/assignments", "PATCH", { id: a.id, clockingRequired: !a.clockingRequired });
      toast.success(t("{name} kini {mode} clocking (jam {jam})", "{name} is now {mode} clocking (hours {jam})", { name: a.employee.fullName, mode: !a.clockingRequired ? t("wajib", "required") : t("tidak wajib", "not required"), jam: !a.clockingRequired ? t("dicatat", "recorded") : t("dianggap normal", "assumed normal") }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  const kpi = [
    { label: t("Karyawan Ter-Assign", "Assigned Employees"), value: String(active.length), sub: t("{n} karyawan aktif", "{n} active employees", { n: employees.length }) },
    { label: t("Belum Ter-assign", "Not Yet Assigned"), value: String(unassigned.length), sub: unassigned.length ? t("perlu penugasan jadwal", "needs schedule assignment") : t("semua sudah ter-assign", "all assigned") },
    { label: t("Jadwal Dipakai", "Schedules In Use"), value: String(new Set(active.map((a) => a.schedule.code)).size), sub: t("{n} template tersedia", "{n} templates available", { n: schedules.length }) },
    { label: t("Non-Clocking"), value: String(active.filter((a) => !a.clockingRequired).length), sub: t("jam dianggap normal", "hours assumed normal") },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Assign Jadwal Karyawan", "Employee Schedule Assignment")}
        description={t("Penugasan jadwal cycle per karyawan — padanan Employee Schedule Assignment dengan anchor Senin rotasi", "Per-employee cycle schedule assignment — counterpart of Employee Schedule Assignment with a rotating Monday anchor")}
        actions={
          <Button onClick={() => setDialog(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Assign Jadwal")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpi.map((k) => (
          <div key={k.label} className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p>
            <p className="text-lg font-extrabold text-stone-900 dark:text-stone-50">{k.value}</p>
            <p className="truncate text-[11px] text-stone-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {unassigned.length > 0 && (
        <Card className="mb-4 rounded-2xl border-amber-200/80 bg-amber-50/60 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
              {t("{n} karyawan belum punya jadwal — hari tanpa jadwal dianggap Off dalam rekap absensi.", "{n} employees have no schedule yet — unscheduled days count as Off in the attendance recap.", { n: unassigned.length })}
            </p>
            <Button size="sm" variant="outline" className="gap-1.5 border-amber-300 font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300" onClick={() => { setForm({ ...form, employeeId: unassigned[0]!.id }); setDialog(true); }}>
              <CalendarRange className="h-3.5 w-3.5" /> {t("Assign Sekarang", "Assign Now")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <p className="text-[13px] font-bold">{t("Penugasan Aktif ({n})", "Active Assignments ({n})", { n: active.length })}</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. pegawai…", "Search employee / employee no.…")} className="h-8 w-56 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : filtered.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada penugasan jadwal", "No schedule assignments yet")} description={t("Assign jadwal cycle ke karyawan — rekap absensi mengikuti day type efektif.", "Assign a cycle schedule to an employee — the attendance recap follows the effective day type.")} icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jadwal", "Schedule")}</TableHead>
                    <TableHead className="text-[11px] font-bold">Cycle</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Berlaku Sejak", "Valid Since")}</TableHead>
                    <TableHead className="text-[11px] font-bold">Clocking</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.slice(0, 100).map((a) => (
                    <TableRow key={a.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{a.employee.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{a.employee.employeeNo} · {a.employee.assignments[0]?.orgUnit?.name ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-semibold">{a.schedule.name}</p>
                        <p className="font-mono text-[10px] text-stone-400">{a.schedule.code}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {a.schedule.days.slice(0, 7).map((d) => (
                            <span key={d.sequence} className="inline-flex h-5 w-5 items-center justify-center rounded-md text-[8px] font-extrabold text-stone-700 dark:text-stone-300" style={{ backgroundColor: d.dayType.color + "66" }} title={`seq ${d.sequence}: ${d.dayType.name}`}>
                              {d.dayType.code.slice(0, 3)}
                            </span>
                          ))}
                          {a.schedule.days.length > 7 && <span className="text-[9px] font-bold text-stone-400">+{a.schedule.days.length - 7}</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-stone-600 dark:text-stone-300">{fmtDate(a.validFrom)}</p>
                        <p className="flex items-center gap-1 text-[10px] text-stone-400"><Anchor className="h-2.5 w-2.5" /> anchor seq {a.anchorSequence} · {fmtDate(a.anchorMonday)}</p>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleClocking(a)} className="inline-flex items-center gap-1.5" title={a.clockingRequired ? t("Non-clocking: jam dianggap normal", "Non-clocking: hours assumed normal") : t("Wajib clocking", "Clocking required")}>
                          <span className={cn("relative h-4 w-7 rounded-full transition", a.clockingRequired ? "ov-fill" : "bg-stone-300 dark:bg-stone-700")}>
                            <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition", a.clockingRequired ? "left-3.5" : "left-0.5")} />
                          </span>
                          <span className="text-[10px] font-bold text-stone-500">{a.clockingRequired ? t("Wajib", "Required") : "Non-clock"}</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => endAssignment(a)} title={t("Akhiri penugasan", "End assignment")} aria-label={t("Akhiri penugasan", "End assignment")}>
                          <LogOut className="h-3.5 w-3.5 text-stone-400 hover:text-rose-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {history.length > 0 && (
            <div className="border-t border-stone-100 px-5 py-3 dark:border-stone-800">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Riwayat Penugatan ({n})", "Assignment History ({n})", { n: history.length })}</p>
              <div className="max-h-40 overflow-y-auto">
                {history.slice(0, 30).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[11px] hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <span className="font-semibold text-stone-600 dark:text-stone-300">{a.employee.employeeNo} · {a.employee.fullName}</span>
                    <span className="text-stone-400">{a.schedule.name}</span>
                    <span className="text-stone-400">{fmtDate(a.validFrom)} → {fmtDate(a.validTo)}</span>
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
            <DialogTitle>{t("Assign Jadwal Karyawan", "Employee Schedule Assignment")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
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
              <Label className="text-xs font-bold">{t("Jadwal *", "Schedule *")}</Label>
              <Select value={form.scheduleId} onValueChange={(v) => setForm({ ...form, scheduleId: v, anchorSequence: "1" })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih jadwal cycle", "Select cycle schedule")} /></SelectTrigger>
                <SelectContent>
                  {schedules.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{t("{name} ({code}) — cycle {n} hari", "{name} ({code}) — {n}-day cycle", { name: s.name, code: s.code, n: s.cycleDays })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Berlaku Mulai", "Valid From")}</Label>
                <Input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value, anchorMonday: iso(mondayOf(new Date(e.target.value))) })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Anchor Senin", "Monday Anchor")}</Label>
                <Input type="date" value={form.anchorMonday} onChange={(e) => setForm({ ...form, anchorMonday: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Seq di Anchor", "Seq at Anchor")}</Label>
                <Input type="number" min={1} max={28} value={form.anchorSequence} onChange={(e) => setForm({ ...form, anchorSequence: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="clockingReq" checked={form.clockingRequired} onCheckedChange={(v) => setForm({ ...form, clockingRequired: v })} />
              <Label htmlFor="clockingReq" className="flex items-center gap-1.5 text-xs font-medium">
                <Clock className="h-3.5 w-3.5 text-stone-400" /> {t("Wajib clocking (nonaktif = jam dianggap normal, padanan clocking_all)", "Clocking required (off = hours assumed normal, counterpart of clocking_all)")}
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("mis. pindah regu produksi", "e.g. moved to another production crew")} className="text-sm" />
            </div>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              {t("Assignment lama otomatis ditutup sehari sebelum tanggal mulai (riwayat tetap tersimpan). Cycle dihitung dari anchor Senin: tanggal = sequence ke-((selisih hari + seq anchor) mod cycle).", "The previous assignment is automatically closed one day before the start date (history is kept). The cycle is computed from the Monday anchor: date = sequence ((day difference + anchor seq) mod cycle).")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={submit} disabled={!form.employeeId || !form.scheduleId} className="font-bold">{t("Assign Jadwal")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
