"use client";
// OneVity Attendance — Work Off Permission: izin tidak masuk (padanan
// EmployeeWorkOff.jsp) — paid/unpaid, potong cuti, approval.
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
import { WorkoffRow, EmployeeOption } from "@/onevity/time-attendance/components/attendance-types";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { CheckCircle2, Plus, XCircle, Ban, Search, FileInput, CalendarOff } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

// label EN (peta paralel — render: t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label))
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Pending: "Pending", Approved: "Approved", Rejected: "Rejected", Cancelled: "Cancelled",
};

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86_400_000) + 1;

export function AttendanceWorkoffPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
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

  const api = useApi<{ permits: WorkoffRow[]; stats: { total: number; pending: number; approved: number; paid: number; unpaid: number; deductLeave: number; totalDays: number } }>(`/api/onevity/attendance/workoffs?status=${statusFilter}`);
  const employeesApi = useApi<{ employees: EmployeeOption[] }>("/api/onevity/attendance/clocking");

  const permits = useMemo(() => (api.data?.permits ?? []).filter((p) =>
    !query || p.employee.fullName.toLowerCase().includes(query.toLowerCase()) || p.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ note: string }>("/api/onevity/attendance/workoffs", "POST", {
        ...form,
        dateTo: form.allDay ? form.dateFrom : form.dateTo,
      });
      toast.success(res.note);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan izin", "Failed to submit permit"));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (p: WorkoffRow, action: "approve" | "reject" | "cancel", note?: string) => {
    try {
      const res = await apiSend<{ note: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>("/api/onevity/attendance/workoffs", "PATCH", { id: p.id, action, note });
      if (res.approval) {
        // approval parsial — jenjang menengah disetujui, izin tetap menunggu jenjang berikutnya
        toast.success(t("Jenjang {l}/{n} disetujui — menunggu {a}", "Tier {l}/{n} approved — awaiting {a}", {
          l: res.approval.currentLevel - 1,
          n: res.approval.totalLevels,
          a: res.approval.currentApprover ?? t("jenjang berikutnya", "the next tier"),
        }));
      } else {
        toast.success(res.note);
      }
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Work Off Permission (Izin Tidak Masuk)", "Work Off Permission (Absence Permit)")}
        description={t("Izin dengan kebijakan dibayar/tidak & potong saldo cuti — padanan Employee Work Off Permission", "Permits with paid/unpaid policy & leave balance deduction — counterpart of Employee Work Off Permission")}
        actions={
          <Button onClick={() => { setForm({ ...form, employeeId: employeesApi.data?.employees[0]?.id ?? "" }); setDialog(true); }} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Ajukan Izin", "Submit Permit")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><CalendarOff className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Menunggu Approval", "Awaiting Approval")}</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats?.pending ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("dokumen izin", "permit documents")}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Disetujui")}</p></div>
          <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{t("{a} · {b} hari", "{a} · {b} days", { a: stats?.approved ?? 0, b: stats?.totalDays ?? 0 })}</p>
          <p className="text-[11px] text-stone-400">{t("{n} memotong saldo cuti", "{n} deduct leave balance", { n: stats?.deductLeave ?? 0 })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><FileInput className="h-4 w-4 text-teal-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Dibayar (gaji tetap)", "Paid (salary kept)")}</p></div>
          <p className="text-lg font-extrabold text-teal-600 dark:text-teal-400">{stats?.paid ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("{n} tidak dibayar (potongan)", "{n} unpaid (deducted)", { n: stats?.unpaid ?? 0 })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-stone-400" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Total Dokumen", "Total Documents")}</p></div>
          <p className="text-lg font-extrabold text-stone-500">{stats?.total ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("seluruh status", "all statuses")}</p>
        </div>
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "ov-fill shadow-sm" : "bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800",
                )}>
                  {t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label)}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. dokumen…", "Search employee / document no.…")} className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : permits.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada izin", "No permits")} description={t("Ajukan izin tidak masuk — disetujui otomatis mengubah rekap absensi hari tsb.", "Submit an absence permit — approval automatically updates that day's attendance recap.")} icon={<CalendarOff className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Tanggal")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Durasi", "Duration")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Upah", "Pay")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Potong Cuti", "Deduct Leave")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permits.map((p) => (
                    <TableRow key={p.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-500">{p.docNo}</p>
                        {p.reason && <p className="max-w-44 truncate text-[10px] italic text-stone-400" title={p.reason}>{p.reason}</p>}
                        {p.documentNote && <p className="max-w-44 truncate text-[9px] text-stone-400" title={p.documentNote}>📄 {p.documentNote}</p>}
                      </TableCell>
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{p.employee.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{p.employee.employeeNo} · {p.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-300">
                        {fmtDate(p.dateFrom)}{daysBetween(p.dateFrom, p.dateTo) > 1 ? ` → ${fmtDate(p.dateTo)}` : ""}
                      </TableCell>
                      <TableCell>
                        {p.allDay
                          ? <Badge variant="outline" className="text-[10px] font-bold">{t("{n} hari penuh", "{n} full days", { n: daysBetween(p.dateFrom, p.dateTo) })}</Badge>
                          : <Badge variant="outline" className="text-[10px] font-bold text-amber-600">{t("½ hari {t}", "½ day {t}", { t: p.timeFrom ?? "" })}</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold",
                          p.paid ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                        )}>{p.paid ? t("Dibayar", "Paid") : t("Tanpa upah", "Unpaid")}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", p.deductLeave ? "text-violet-600 dark:text-violet-400" : "text-stone-400")}>
                          {p.deductLeave ? t("Ya") : t("Tidak")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusPill status={p.status} />
                        {p.approval && (p.approval.status === "InProgress" || p.approval.status === "Rejected") && (
                          <div className="mt-1 space-y-0.5">
                            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              p.approval.status === "InProgress"
                                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400")}>
                              {p.approval.status === "InProgress" ? t("Jenjang", "Tier") : t("Ditolak di", "Rejected at")} {p.approval.currentLevel}/{p.approval.totalLevels}
                            </span>
                            {p.approval.status === "InProgress" && p.approval.currentApprover && (
                              <p className="max-w-36 truncate text-[10px] text-stone-400" title={p.approval.currentApprover}>{t("menunggu", "awaiting")} {p.approval.currentApprover}</p>
                            )}
                          </div>
                        )}
                        {p.decisionNote && <p className="max-w-36 truncate text-[9px] italic text-stone-400" title={p.decisionNote}>{p.decisionNote}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {p.status === "Pending" && (
                            <>
                              {perms.canOp("attendance", "workoff", "approve") && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui", "Approve")} onClick={() => decide(p, "approve")} aria-label={t("Setujui izin", "Approve permit")}>
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak", "Reject")} onClick={() => { setRejectTarget(p); setRejectNote(""); }} aria-label={t("Tolak izin", "Reject permit")}>
                                    <XCircle className="h-4 w-4 text-rose-500" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                          {["Pending", "Approved"].includes(p.status) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Batalkan", "Cancel")} onClick={() => decide(p, "cancel", "Dibatalkan admin")} aria-label={t("Batalkan izin", "Cancel permit")}>
                              <Ban className="h-4 w-4 text-stone-400" />
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Ajukan Izin Tidak Masuk", "Submit Absence Permit")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(employeesApi.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Mulai *", "Start Date *")}</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value, dateTo: form.allDay ? e.target.value : form.dateTo })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal Selesai", "End Date")}</Label>
                <Input type="date" value={form.dateTo} disabled={form.allDay} min={form.dateFrom} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="allDay" checked={form.allDay} onCheckedChange={(v) => setForm({ ...form, allDay: v, dateTo: v ? form.dateFrom : form.dateTo })} />
              <Label htmlFor="allDay" className="text-xs font-medium">{t("Sehari penuh (nonaktif = setengah hari)", "Full day (off = half day)")}</Label>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Jam Mulai *", "Start Time *")}</Label>
                  <Input type="time" value={form.timeFrom} onChange={(e) => setForm({ ...form, timeFrom: e.target.value })} className="text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Jam Selesai", "End Time")}</Label>
                  <Input type="time" value={form.timeTo} onChange={(e) => setForm({ ...form, timeTo: e.target.value })} className="text-sm" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <Switch id="paid" checked={form.paid} onCheckedChange={(v) => setForm({ ...form, paid: v })} />
                <Label htmlFor="paid" className="text-xs font-medium">{t("Dibayar (gaji tetap masuk)", "Paid (salary still counted)")}</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="deduct" checked={form.deductLeave} onCheckedChange={(v) => setForm({ ...form, deductLeave: v })} />
                <Label htmlFor="deduct" className="text-xs font-medium">{t("Potong saldo cuti", "Deduct leave balance")}</Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan *", "Reason *")}</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("mis. acara keluarga / sakit ringan", "e.g. family event / mild illness")} className="min-h-16 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Keterangan Dokumen Pendukung", "Supporting Document Notes")}</Label>
              <Input value={form.documentNote} onChange={(e) => setForm({ ...form, documentNote: e.target.value })} placeholder={t("mis. surat dokter dr. Siti, 01-09-2026", "e.g. doctor's note dr. Siti, 01-09-2026")} className="text-sm" />
              <p className="text-[10px] text-stone-400">{t("Padanan Need Supporting Documents — beberapa kebijakan izin mewajibkan bukti.", "Counterpart of Need Supporting Documents — some permit policies require proof.")}</p>
            </div>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              {t("Setelah disetujui, rekap absensi pada tanggal izin otomatis dihitung ulang (status ", "Once approved, the attendance recap for the permit dates is automatically recalculated (status ")}<b>{t("Izin", "Permit")}</b>{t("): dibayar → jam normal diakui penuh; tanpa upah → dihitung sebagai potongan absen saat transfer payroll.", "): paid → normal hours fully counted; unpaid → counted as an absence deduction on the payroll transfer.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy || !form.employeeId || !form.reason.trim()} className="font-bold">
              {busy ? t("Mengirim…", "Sending…") : t("Ajukan Izin", "Submit Permit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog tolak */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Tolak Izin {no}", "Reject Permit {no}", { no: rejectTarget?.docNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5 py-1">
            {rejectTarget?.approval?.status === "InProgress" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
                {t("Approval berjenjang: jenjang", "Tiered approval: tier")} <b>{rejectTarget.approval.currentLevel}</b> {t("dari", "of")} <b>{rejectTarget.approval.totalLevels}</b> — {t("menunggu keputusan", "awaiting decision by")} <b>{rejectTarget.approval.currentApprover ?? t("jenjang berikutnya", "the next tier")}</b>. {t("Menolak jenjang ini menghentikan seluruh proses persetujuan.", "Rejecting this tier stops the whole approval process.")}
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan penolakan *", "Rejection reason *")}</Label>
              <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t("mis. dokumen pendukung tidak lengkap", "e.g. incomplete supporting documents")} className="min-h-20 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("Batal")}</Button>
            {perms.canOp("attendance", "workoff", "approve") && (
              <Button onClick={async () => { if (rejectTarget) { await decide(rejectTarget, "reject", rejectNote); setRejectTarget(null); } }} disabled={!rejectNote.trim()} className="bg-rose-600 font-bold hover:bg-rose-700">
                {t("Tolak Izin", "Reject Permit")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
