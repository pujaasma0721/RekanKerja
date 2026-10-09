"use client";
// RekanKerja Attendance — Work Off Permission: izin tidak masuk (padanan
// EmployeeWorkOff.jsp) — paid/unpaid, potong cuti, approval.
// Task 100-impl-B (F0): pembatalan izin kini lewat AlertDialog + alasan
// opsional + busy (G9 — status Approved tegas soal pengembalian saldo cuti),
// error state useApi + Coba Lagi (G10), filter default "Pending" gaya inbox
// approval konsisten shift-swap (B-14), tanggal default form zona LOKAL (B-10).
// Task 100 F1 (G25, impl-E): putuskan massal — checkbox per baris Pending +
// toolbar pilih semua + Setujui/Tolak Terpilih → PATCH op:bulk.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { nextServerSort, ServerSortHead, type ServerSortDir } from "@/rekankerja/shared/lib/use-table-sort";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { WorkoffRow, EmployeeOption } from "@/rekankerja/time-attendance/components/attendance-types";
import { ApiErrorState, todayISO } from "@/rekankerja/time-attendance/components/attendance-ui";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { CheckCircle2, Plus, XCircle, Ban, Search, FileInput, CalendarOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// B-14: urutan inbox approval — Pending dulu, Semua terakhir (pola shift-swap).
const STATUS_FILTERS = [
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
  { key: "all", label: "Semua" },
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
  // B-14: default "Pending" — inbox approval (konsisten shift-swap).
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<WorkoffRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [cancelTarget, setCancelTarget] = useState<WorkoffRow | null>(null); // G9: konfirmasi batalkan
  const [cancelNote, setCancelNote] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  // ===== Task 100 F1 (G25): pilihan massal utk bulk decide =====
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"approve" | "reject" | null>(null);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [form, setForm] = useState({
    employeeId: "", dateFrom: todayISO(), dateTo: todayISO(),
    allDay: true, timeFrom: "13:00", timeTo: "17:00",
    paid: true, deductLeave: true, reason: "", documentNote: "",
  });

  // Task 76 — sorting SERVER-SIDE: sortBy/sortDir dikirim ke API (whitelist di route).
  const [sortKey, setSortKey] = useState<"doc" | "employee" | "date" | "duration" | "pay" | "deduct" | "status">("date");
  const [sortDir, setSortDir] = useState<ServerSortDir>("desc");
  const clickSort = (k: typeof sortKey) => {
    const n = nextServerSort(sortKey, sortDir, k);
    setSortKey(n.sortBy as typeof sortKey);
    setSortDir(n.sortDir);
  };
  const api = useApi<{ permits: WorkoffRow[]; stats: { total: number; pending: number; approved: number; paid: number; unpaid: number; deductLeave: number; totalDays: number } }>(`/api/rekankerja/attendance/workoffs?status=${statusFilter}&sortBy=${sortKey}&sortDir=${sortDir}`);
  const employeesApi = useApi<{ employees: EmployeeOption[] }>("/api/rekankerja/attendance/clocking");

  const permits = useMemo(() => (api.data?.permits ?? []).filter((p) =>
    !query || p.employee.fullName.toLowerCase().includes(query.toLowerCase()) || p.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  // G25: hanya baris Pending yang bisa dipilih; seleksi dipangkas saat data berubah.
  const pendingPermits = useMemo(() => permits.filter((p) => p.status === "Pending"), [permits]);
  const pendingIds = useMemo(() => new Set(pendingPermits.map((p) => p.id)), [pendingPermits]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => pendingIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pendingIds]);
  const selectedCount = selected.size;
  const allPendingSelected = pendingPermits.length > 0 && pendingPermits.every((p) => selected.has(p.id));
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelected((prev) => (prev.size >= pendingPermits.length ? new Set() : new Set(pendingPermits.map((p) => p.id))));

  // G25: kirim op:bulk → { results, okCount, failCount } (kontrak api/workoffs.ts impl-D).
  const runBulk = async () => {
    if (!bulkAction || selectedCount === 0) return;
    setBulkBusy(true);
    try {
      const res = await apiSend<{ results: { id: string; ok: boolean; error?: string }[]; okCount: number; failCount: number }>(
        "/api/rekankerja/attendance/workoffs", "PATCH", { op: "bulk", ids: [...selected], action: bulkAction, reason: bulkNote.trim() || undefined },
      );
      const firstError = res.results.find((r) => !r.ok)?.error;
      if (res.failCount === 0) {
        toast.success(t("{n} izin diproses", "{n} permits processed", { n: res.okCount }));
      } else {
        toast.warning(t("{ok} berhasil · {fail} gagal — {err}", "{ok} succeeded · {fail} failed — {err}", { ok: res.okCount, fail: res.failCount, err: firstError ?? "-" }));
      }
      setSelected(new Set());
      setBulkAction(null);
      setBulkNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses massal", "Failed to bulk process"));
    } finally {
      setBulkBusy(false);
    }
  };

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
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan izin", "Failed to submit permit"));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (p: WorkoffRow, action: "approve" | "reject" | "cancel", note?: string) => {
    try {
      const res = await apiSend<{ note: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>("/api/rekankerja/attendance/workoffs", "PATCH", { id: p.id, action, note });
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
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal"));
      return false;
    }
  };

  // G9: batalkan izin — konfirmasi AlertDialog (Approved = tegas soal saldo cuti) + busy.
  const runCancel = async () => {
    if (!cancelTarget) return;
    setCancelBusy(true);
    try {
      const ok = await decide(cancelTarget, "cancel", cancelNote.trim() || "Dibatalkan admin");
      if (ok) setCancelTarget(null);
    } finally {
      setCancelBusy(false);
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
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><CalendarOff className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Menunggu Approval", "Awaiting Approval")}</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats?.pending ?? 0}</p>
          <p className="text-[11px] text-slate-400">{t("dokumen izin", "permit documents")}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Disetujui")}</p></div>
          <p className="text-lg font-extrabold text-brand dark:text-brand/85">{t("{a} · {b} hari", "{a} · {b} days", { a: stats?.approved ?? 0, b: stats?.totalDays ?? 0 })}</p>
          <p className="text-[11px] text-slate-400">{t("{n} memotong saldo cuti", "{n} deduct leave balance", { n: stats?.deductLeave ?? 0 })}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><FileInput className="h-4 w-4 text-brand" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Dibayar (gaji tetap)", "Paid (salary kept)")}</p></div>
          <p className="text-lg font-extrabold text-brand dark:text-brand/85">{stats?.paid ?? 0}</p>
          <p className="text-[11px] text-slate-400">{t("{n} tidak dibayar (potongan)", "{n} unpaid (deducted)", { n: stats?.unpaid ?? 0 })}</p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-slate-400" /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Total Dokumen", "Total Documents")}</p></div>
          <p className="text-lg font-extrabold text-slate-500">{stats?.total ?? 0}</p>
          <p className="text-[11px] text-slate-400">{t("seluruh status", "all statuses")}</p>
        </div>
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "ov-fill shadow-sm" : "ov-tile hover:ov-soft text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white",
                )}>
                  {t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label)}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. dokumen…", "Search employee / document no.…")} className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {/* ===== G25: toolbar pilihan massal (hanya baris Pending) ===== */}
          {pendingPermits.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <Checkbox
                  checked={allPendingSelected ? true : selectedCount > 0 ? "indeterminate" : false}
                  onCheckedChange={toggleSelectAll}
                  aria-label={t("Pilih semua izin Pending", "Select all pending permits")}
                />
                {t("Pilih semua (Pending)", "Select all (Pending)")}
              </label>
              <span className="text-[11px] font-semibold text-slate-400">{t("{n} terpilih", "{n} selected", { n: selectedCount })}</span>
              {selectedCount > 0 && perms.canOp("attendance", "workoff", "approve") && (
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" className="h-7 gap-1 px-2.5 text-[11px] font-bold" onClick={() => { setBulkAction("approve"); setBulkNote(""); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui Terpilih ({n})", "Approve Selected ({n})", { n: selectedCount })}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10" onClick={() => { setBulkAction("reject"); setBulkNote(""); }}>
                    <XCircle className="h-3.5 w-3.5" /> {t("Tolak Terpilih ({n})", "Reject Selected ({n})", { n: selectedCount })}
                  </Button>
                </div>
              )}
            </div>
          )}
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : api.error ? (
            <ApiErrorState message={api.error} busy={api.loading} onRetry={api.refresh} />
          ) : permits.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada izin", "No permits")} description={t("Ajukan izin tidak masuk — disetujui otomatis mengubah rekap absensi hari tsb.", "Submit an absence permit — approval automatically updates that day's attendance recap.")} icon={<CalendarOff className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="w-8" aria-label={t("Pilih", "Select")} />
                    <ServerSortHead label={t("Dokumen", "Document")} active={sortKey === "doc"} dir={sortDir} onClick={() => clickSort("doc")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Karyawan")} active={sortKey === "employee"} dir={sortDir} onClick={() => clickSort("employee")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Tanggal")} active={sortKey === "date"} dir={sortDir} onClick={() => clickSort("date")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Durasi", "Duration")} active={sortKey === "duration"} dir={sortDir} onClick={() => clickSort("duration")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Upah", "Pay")} active={sortKey === "pay"} dir={sortDir} onClick={() => clickSort("pay")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Potong Cuti", "Deduct Leave")} active={sortKey === "deduct"} dir={sortDir} onClick={() => clickSort("deduct")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Status")} active={sortKey === "status"} dir={sortDir} onClick={() => clickSort("status")} className="text-[11px] font-bold" />
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {permits.map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell className="w-8">
                        {p.status === "Pending" && (
                          <Checkbox
                            checked={selected.has(p.id)}
                            onCheckedChange={() => toggleSelect(p.id)}
                            aria-label={t("Pilih izin {no}", "Select permit {no}", { no: p.docNo })}
                          />
                        )}
                      </TableCell>
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
                          ? <Badge variant="outline" className="text-[10px] font-bold">{t("{n} hari penuh", "{n} full days", { n: daysBetween(p.dateFrom, p.dateTo) })}</Badge>
                          : <Badge variant="outline" className="text-[10px] font-bold text-amber-600">{t("½ hari {t}", "½ day {t}", { t: p.timeFrom ?? "" })}</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold",
                          p.paid ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                        )}>{p.paid ? t("Dibayar", "Paid") : t("Tanpa upah", "Unpaid")}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-[11px] font-bold", p.deductLeave ? "text-brand dark:text-brand/85" : "text-slate-400")}>
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
                              <p className="max-w-36 truncate text-[10px] text-slate-400" title={p.approval.currentApprover}>{t("menunggu", "awaiting")} {p.approval.currentApprover}</p>
                            )}
                          </div>
                        )}
                        {p.decisionNote && <p className="max-w-36 truncate text-[9px] italic text-slate-400" title={p.decisionNote}>{p.decisionNote}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {p.status === "Pending" && (
                            <>
                              {perms.canOp("attendance", "workoff", "approve") && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui", "Approve")} onClick={() => decide(p, "approve")} aria-label={t("Setujui izin", "Approve permit")}>
                                    <CheckCircle2 className="h-4 w-4 text-brand" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak", "Reject")} onClick={() => { setRejectTarget(p); setRejectNote(""); }} aria-label={t("Tolak izin", "Reject permit")}>
                                    <XCircle className="h-4 w-4 text-rose-500" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                          {["Pending", "Approved"].includes(p.status) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Batalkan", "Cancel")} onClick={() => { setCancelTarget(p); setCancelNote(""); }} aria-label={t("Batalkan izin", "Cancel permit")}>
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
              <p className="text-[10px] text-slate-400">{t("Padanan Need Supporting Documents — beberapa kebijakan izin mewajibkan bukti.", "Counterpart of Need Supporting Documents — some permit policies require proof.")}</p>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] leading-relaxed text-slate-500 dark:bg-slate-900/60">
              {t("Setelah disetujui, rekap absensi pada tanggal izin otomatis dihitung ulang (status ", "Once approved, the attendance recap for the permit dates is automatically recalculated (status ")}<b>{t("Izin", "Permit")}</b>{t("): dibayar → jam normal diakui penuh; tanpa upah → dihitung sebagai potongan absen saat transfer payroll.", "): paid → normal hours fully counted; unpaid → counted as an absence deduction on the payroll transfer.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} disabled={busy}>{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy || !form.employeeId || !form.reason.trim()} className="gap-1.5 font-bold">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("Mengirim…", "Sending…")}</> : <>{t("Ajukan Izin", "Submit Permit")}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* G9: dialog konfirmasi batalkan izin (pola AlertDialog shift-swap) */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(v) => { if (!v && !cancelBusy) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Batalkan Izin {no}?", "Cancel Permit {no}?", { no: cancelTarget?.docNo ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.status === "Approved"
                ? t(
                    "Izin sudah disetujui — pembatalan MENGHITUNG ULANG rekap absensi tanggal izin dan mengembalikan saldo cuti yang dipotong (bila memotong cuti).",
                    "This permit is already approved — cancelling RECALCULATES the attendance recap for the permit dates and refunds the deducted leave balance (if it deducted leave).",
                  )
                : t(
                    "Izin akan dibatalkan dan karyawan menerima notifikasi pembatalan.",
                    "The permit will be cancelled and the employee receives a cancellation notification.",
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {cancelTarget && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800 dark:text-slate-200">{cancelTarget.employee.fullName}</p>
                  <p className="truncate text-[11px] text-slate-400">{fmtDate(cancelTarget.dateFrom)} · {cancelTarget.deductLeave ? t("memotong saldo cuti", "deducts leave balance") : t("tanpa potongan cuti", "no leave deduction")}</p>
                </div>
                <StatusPill status={cancelTarget.status} />
              </div>
              <div className="mt-2 space-y-1.5">
                <Label className="text-xs font-bold">{t("Alasan pembatalan (opsional)", "Cancellation reason (optional)")}</Label>
                <Textarea value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder={t("mis. salah tanggal / dokumen pendukung tidak sah", "e.g. wrong date / invalid supporting document")} className="min-h-16 text-sm" maxLength={300} />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelBusy}
              className={cn("gap-1.5 font-bold", cancelBusy && "opacity-70")}
              onClick={(e) => { e.preventDefault(); void runCancel(); }}
            >
              {cancelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              {t("Ya, Batalkan Izin", "Yes, Cancel Permit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* ===== G25: AlertDialog putuskan massal (approve/reject) ===== */}
      <AlertDialog open={!!bulkAction} onOpenChange={(v) => { if (!v && !bulkBusy) { setBulkAction(null); setBulkNote(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === "approve"
                ? t("Setujui {n} izin sekaligus?", "Approve {n} permits at once?")
                : t("Tolak {n} izin sekaligus?", "Reject {n} permits at once?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === "approve"
                ? t("Approval berjenjang tetap berjalan per dokumen — dokumen yang sudah diputuskan proses lain gagal per-item tanpa membatalkan sisa batch. Rekap absensi tanggal izin otomatis dihitung ulang.", "Tiered approval still runs per document — documents already decided elsewhere fail per-item without aborting the rest of the batch. The attendance recap for the permit dates is recalculated automatically.")
                : t("Seluruh izin terpilih akan ditolak — karyawan menerima notifikasi per dokumen.", "All selected permits will be rejected — employees are notified per document.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
            <p className="mb-1.5 font-bold text-slate-700 dark:text-slate-200">{t("Ringkasan pilihan", "Selection summary")}</p>
            <ul className="max-h-36 space-y-0.5 overflow-y-auto font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {pendingPermits.filter((p) => selected.has(p.id)).slice(0, 8).map((p) => (
                <li key={p.id}>• {p.docNo} — {p.employee.fullName}</li>
              ))}
              {selectedCount > 8 && <li className="text-slate-400">+{selectedCount - 8} {t("lainnya", "more")}</li>}
            </ul>
            {bulkAction === "reject" && (
              <div className="mt-2 space-y-1.5">
                <Label className="text-xs font-bold">{t("Alasan (opsional)", "Reason (optional)")}</Label>
                <Textarea value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder={t("mis. dokumen pendukung tidak lengkap", "e.g. incomplete supporting documents")} className="min-h-16 text-sm" maxLength={300} />
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              className={cn("gap-1.5 font-bold", bulkBusy && "opacity-70", bulkAction === "reject" && "bg-rose-600 hover:bg-rose-700")}
              onClick={(e) => { e.preventDefault(); void runBulk(); }}
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : bulkAction === "approve" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {bulkAction === "approve" ? t("Ya, Setujui Terpilih", "Yes, Approve Selected") : t("Ya, Tolak Terpilih", "Yes, Reject Selected")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
