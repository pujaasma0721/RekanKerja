"use client";
// RekanKerja Attendance — Work Off Permission: izin tidak masuk (padanan
// EmployeeWorkOff.jsp) — paid/unpaid, potong cuti, approval.
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/lib/rekankerja/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { WorkoffRow, EmployeeOption } from "@/components/rekankerja/attendance/attendance-types";
import { CheckCircle2, Plus, XCircle, Ban, Search, FileInput, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86_400_000) + 1;

export function AttendanceWorkoffPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<WorkoffRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    employeeId: "", dateFrom: new Date().toISOString().slice(0, 10), dateTo: new Date().toISOString().slice(0, 10),
    allDay: true, timeFrom: "13:00", timeTo: "17:00",
    paid: true, deductLeave: true, reason: "", documentNote: "",
  });

  const api = useApi<{ permits: WorkoffRow[]; stats: { total: number; pending: number; approved: number; paid: number; unpaid: number; deductLeave: number; totalDays: number } }>(`/api/rekankerja/attendance/workoffs?status=${statusFilter}`);
  const employeesApi = useApi<{ employees: EmployeeOption[] }>("/api/rekankerja/attendance/clocking");

  const permits = useMemo(() => (api.data?.permits ?? []).filter((p) =>
    !query || p.employee.fullName.toLowerCase().includes(query.toLowerCase()) || p.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ note: string }>("/api/rekankerja/attendance/workoffs", "POST", {
        ...form,
        dateTo: form.allDay ? form.dateFrom : form.dateTo,
      });
      toast.success(res.note);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan izin");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (p: WorkoffRow, action: "approve" | "reject" | "cancel", note?: string) => {
    try {
      const res = await apiSend<{ note: string }>("/api/rekankerja/attendance/workoffs", "PATCH", { id: p.id, action, note });
      toast.success(res.note);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal");
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Work Off Permission (Izin Tidak Masuk)"
        description="Izin dengan kebijakan dibayar/tidak & potong saldo cuti — padanan Employee Work Off Permission oranHR"
        actions={
          <Button onClick={() => { setForm({ ...form, employeeId: employeesApi.data?.employees[0]?.id ?? "" }); setDialog(true); }} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Ajukan Izin
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><CalendarOff className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Menunggu Approval</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats?.pending ?? 0}</p>
          <p className="text-[11px] text-slate-400">dokumen izin</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Disetujui</p></div>
          <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{stats?.approved ?? 0} · {stats?.totalDays ?? 0} hari</p>
          <p className="text-[11px] text-slate-400">{stats?.deductLeave ?? 0} memotong saldo cuti</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><FileInput className="h-4 w-4 text-teal-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Dibayar (gaji tetap)</p></div>
          <p className="text-lg font-extrabold text-teal-600 dark:text-teal-400">{stats?.paid ?? 0}</p>
          <p className="text-[11px] text-slate-400">{stats?.unpaid ?? 0} tidak dibayar (potongan)</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-slate-400" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total Dokumen</p></div>
          <p className="text-lg font-extrabold text-slate-500">{stats?.total ?? 0}</p>
          <p className="text-[11px] text-slate-400">seluruh status</p>
        </div>
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800",
                )}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan / no. dokumen…" className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : permits.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada izin" description="Ajukan izin tidak masuk — disetujui otomatis mengubah rekap absensi hari tsb." icon={<CalendarOff className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">Dokumen</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Tanggal</TableHead>
                    <TableHead className="text-[11px] font-bold">Durasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Upah</TableHead>
                    <TableHead className="text-[11px] font-bold">Potong Cuti</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permits.map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-500">{p.docNo}</p>
                        {p.reason && <p className="max-w-44 truncate text-[10px] italic text-slate-400" title={p.reason}>{p.reason}</p>}
                        {p.documentNote && <p className="max-w-44 truncate text-[9px] text-slate-400" title={p.documentNote}>📄 {p.documentNote}</p>}
                      </TableCell>
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{p.employee.fullName}</p>
                        <p className="font-mono text-[10px] text-slate-400">{p.employee.employeeNo} · {p.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                        {fmtDate(p.dateFrom)}{daysBetween(p.dateFrom, p.dateTo) > 1 ? ` → ${fmtDate(p.dateTo)}` : ""}
                      </TableCell>
                      <TableCell>
                        {p.allDay
                          ? <Badge variant="outline" className="text-[10px] font-bold">{daysBetween(p.dateFrom, p.dateTo)} hari penuh</Badge>
                          : <Badge variant="outline" className="text-[10px] font-bold text-amber-600">½ hari {p.timeFrom}</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold",
                          p.paid ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                        )}>{p.paid ? "Dibayar" : "Tanpa upah"}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", p.deductLeave ? "text-violet-600 dark:text-violet-400" : "text-slate-400")}>
                          {p.deductLeave ? "Ya" : "Tidak"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill status={p.status} />
                        {p.decisionNote && <p className="max-w-36 truncate text-[9px] italic text-slate-400" title={p.decisionNote}>{p.decisionNote}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {p.status === "Pending" && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Setujui" onClick={() => decide(p, "approve")} aria-label="Setujui izin">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Tolak" onClick={() => { setRejectTarget(p); setRejectNote(""); }} aria-label="Tolak izin">
                                <XCircle className="h-4 w-4 text-rose-500" />
                              </Button>
                            </>
                          )}
                          {["Pending", "Approved"].includes(p.status) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Batalkan" onClick={() => decide(p, "cancel", "Dibatalkan admin")} aria-label="Batalkan izin">
                              <Ban className="h-4 w-4 text-slate-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog ajukan */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajukan Izin Tidak Masuk</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Karyawan *</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(employeesApi.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Tanggal Mulai *</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value, dateTo: form.allDay ? e.target.value : form.dateTo })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Tanggal Selesai</Label>
                <Input type="date" value={form.dateTo} disabled={form.allDay} min={form.dateFrom} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="allDay" checked={form.allDay} onCheckedChange={(v) => setForm({ ...form, allDay: v, dateTo: v ? form.dateFrom : form.dateTo })} />
              <Label htmlFor="allDay" className="text-xs font-medium">Sehari penuh (nonaktif = setengah hari)</Label>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Jam Mulai *</Label>
                  <Input type="time" value={form.timeFrom} onChange={(e) => setForm({ ...form, timeFrom: e.target.value })} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Jam Selesai</Label>
                  <Input type="time" value={form.timeTo} onChange={(e) => setForm({ ...form, timeTo: e.target.value })} className="text-sm" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Switch id="paid" checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: v })} />
                <Label htmlFor="paid" className="text-xs font-medium">Dibayar (gaji tetap masuk)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="deduct" checked={form.deductLeave} onCheckedChange={(v) => setForm({ ...form, deductLeave: v })} />
                <Label htmlFor="deduct" className="text-xs font-medium">Potong saldo cuti</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Alasan *</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="mis. acara keluarga / sakit ringan" className="min-h-16 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Keterangan Dokumen Pendukung</Label>
              <Input value={form.documentNote} onChange={(e) => setForm({ ...form, documentNote: e.target.value })} placeholder="mis. surat dokter dr. Siti, 01-09-2026" className="text-sm" />
              <p className="text-[10px] text-slate-400">Padanan Need Supporting Documents — beberapa kebijakan izin mewajibkan bukti.</p>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              Setelah disetujui, rekap absensi pada tanggal izin otomatis dihitung ulang (status <b>Izin</b>): dibayar → jam normal diakui penuh; tanpa upah → dihitung sebagai potongan absen saat transfer payroll.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            <Button onClick={submit} disabled={busy || !form.employeeId || !form.reason.trim()} className="bg-emerald-600 font-bold hover:bg-emerald-700">
              {busy ? "Mengirim…" : "Ajukan Izin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog tolak */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak Izin {rejectTarget?.docNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-xs font-bold">Alasan penolakan *</Label>
            <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="mis. dokumen pendukung tidak lengkap" className="min-h-20 text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Batal</Button>
            <Button onClick={async () => { if (rejectTarget) { await decide(rejectTarget, "reject", rejectNote); setRejectTarget(null); } }} disabled={!rejectNote.trim()} className="bg-rose-600 font-bold hover:bg-rose-700">
              Tolak Izin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
