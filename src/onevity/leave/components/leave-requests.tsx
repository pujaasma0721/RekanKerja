"use client";
// OneVity Leave — Permintaan Cuti: form auto-compute (padanan LeaveRequest.jsp)
// hari kerja dihitung dari jadwal absensi, saldo & HP kembali kerja otomatis.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { nextServerSort, ServerSortHead, type ServerSortDir } from "@/onevity/shared/lib/use-table-sort";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RequestRowUI, LeaveTypeRow, EmployeeOption, LEAVE_STATUS_LABEL, SESSION_LABEL, SESSION_LABEL_EN, fmtDay } from "./leave-types";
import { Inbox, Plus, Search, CalendarClock, Send, Ban, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "MassLeave", label: "Cuti Massal" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

// LABEL EN (peta paralel — render: t(f.label, STATUS_FILTERS_EN[f.key]))
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Submitted: "Pending", Approved: "Approved", MassLeave: "Mass Leave", Rejected: "Rejected", Cancelled: "Cancelled",
};

interface PreviewResult {
  workingDays: number; balance: number; remaining: number;
  backToWork: string | null; maxPerRequest: number; unit: string;
  waitingMonths: number; allowAdvance: boolean; periodLabel: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function LeaveRequestsPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [form, setForm] = useState({
    employeeId: "", leaveTypeId: "", dateFrom: todayISO(), sessionFrom: "AM",
    dateTo: todayISO(), sessionTo: "PM", reason: "", note: "",
  });

  // Task 76 — sorting SERVER-SIDE: sortBy/sortDir dikirim ke API (whitelist di service).
  const [sortKey, setSortKey] = useState<"doc" | "employee" | "type" | "dateFrom" | "workingDays" | "remaining" | "backToWork" | "status">("dateFrom");
  const [sortDir, setSortDir] = useState<ServerSortDir>("desc");
  const clickSort = (k: typeof sortKey) => {
    const n = nextServerSort(sortKey, sortDir, k);
    setSortKey(n.sortBy as typeof sortKey);
    setSortDir(n.sortDir);
  };
  const api = useApi<{ requests: RequestRowUI[]; stats: { total: number; submitted: number; approved: number; rejected: number; cancelled: number; massLeave: number; pendingDays: number; approvedDays: number } }>(
    `/api/onevity/leave/requests?status=${statusFilter}&sortBy=${sortKey}&sortDir=${sortDir}`,
    [statusFilter, sortKey, sortDir],
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/onevity/leave/types");

  const requests = useMemo(() => (api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  // preview auto-compute saat form berubah (debounce)
  useEffect(() => {
    if (!dialog || !form.employeeId || !form.leaveTypeId || !form.dateFrom || !form.dateTo) { setPreview(null); return; }
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const res = await apiSend<PreviewResult>("/api/onevity/leave/requests", "POST", { ...form, preview: true });
        setPreview(res);
      } catch {
        setPreview(null);
        // error validasi ditampilkan saat submit; preview silent-fail
      } finally { setPreviewBusy(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [dialog, form]);

  const selectedType = (typesApi.data?.types ?? []).find((ty) => ty.id === form.leaveTypeId);

  const submit = async () => {
    if (!form.employeeId || !form.leaveTypeId) { toast.error(t("Karyawan & jenis cuti wajib dipilih", "Employee & leave type are required")); return; }
    if (!form.reason.trim()) { toast.error(t("Alasan cuti wajib diisi", "Leave reason is required")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; workingDays: number; remaining: number; backToWork: string | null; approvalLevels?: number; firstApprover?: string | null }>(
        "/api/onevity/leave/requests", "POST", form,
      );
      toast.success(
        t("{doc} diajukan — {d} hari kerja, sisa saldo {r}", "{doc} submitted — {d} working days, remaining balance {r}", { doc: res.docNo, d: res.workingDays, r: res.remaining }) +
        (res.firstApprover ? t(" · menunggu approval {a}", " · awaiting approval by {a}", { a: res.firstApprover }) + (res.approvalLevels && res.approvalLevels > 1 ? t(" (jenjang 1/{n})", " (tier 1/{n})", { n: res.approvalLevels }) : "") : ""),
      );
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan cuti", "Failed to submit the leave request"));
    } finally { setBusy(false); }
  };

  const cancelRequest = async (r: RequestRowUI) => {
    if (r.status !== "Submitted") { toast.error(t("Hanya permintaan berstatus Menunggu yang bisa dibatalkan", "Only requests in Pending status can be cancelled")); return; }
    try {
      const res = await apiSend<{ docNo: string; status: string }>("/api/onevity/leave/requests", "PATCH", { id: r.id, action: "cancel", note: "Dibatalkan pemberi kuasa" });
      toast.success(t("{doc} dibatalkan", "{doc} cancelled", { doc: res.docNo }));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membatalkan", "Failed to cancel"));
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Permintaan Cuti")}
        description={t("Pengajuan cuti dengan hitungan otomatis — hari kerja dari jadwal absensi, saldo saat ini, sisa saldo & tanggal kembali kerja", "Leave requests with automatic computation — working days from the attendance schedule, current balance, remaining balance & back-to-work date")}
        actions={
          perms.can("leave", "leave-request", "create") && (
            <Button onClick={() => {
              setForm({
                employeeId: typesApi.data?.employees[0]?.id ?? "", leaveTypeId: (typesApi.data?.types ?? []).find((ty) => ty.code === "CT-THN")?.id ?? typesApi.data?.types[0]?.id ?? "",
                dateFrom: todayISO(), sessionFrom: "AM", dateTo: todayISO(), sessionTo: "PM", reason: "", note: "",
              });
              setPreview(null);
              setDialog(true);
            }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Ajukan Cuti", "Request Leave")}
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: t("Menunggu Approval", "Pending Approvals"), value: stats?.submitted ?? 0, sub: t("{n} hari diminta", "{n} days requested", { n: stats?.pendingDays ?? 0 }), icon: Inbox, tone: "text-amber-600" },
          { label: t("Disetujui"), value: (stats?.approved ?? 0) + (stats?.massLeave ?? 0), sub: t("{n} hari total", "{n} days total", { n: stats?.approvedDays ?? 0 }), icon: CheckCircle2, tone: "text-brand" },
          { label: t("Cuti Massal", "Mass Leave"), value: stats?.massLeave ?? 0, sub: t("baris dari SKB", "rows from SKB"), icon: Inbox, tone: "text-rose-600" },
          { label: t("Total Permintaan", "Total Requests"), value: stats?.total ?? 0, sub: t("{r} ditolak · {c} batal", "{r} rejected · {c} cancelled", { r: stats?.rejected ?? 0, c: stats?.cancelled ?? 0 }), icon: Inbox, tone: "text-slate-500" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", k.tone)} /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p></div>
              <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{k.value}</p>
              <p className="text-[11px] text-slate-400">{k.sub}</p>
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "ov-fill shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800",
                )}>
                  {t(f.label, STATUS_FILTERS_EN[f.key])}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. dokumen…", "Search employee / doc no. …")} className="h-8 w-56 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : requests.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada permintaan cuti", "No leave requests")} description={t("Ajukan cuti baru — hari kerja & saldo dihitung otomatis dari jadwal.", "Submit a new leave request — working days & balance are computed automatically from schedules.")} icon={<Inbox className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    <ServerSortHead label={t("Dokumen", "Document")} active={sortKey === "doc"} dir={sortDir} onClick={() => clickSort("doc")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Karyawan")} active={sortKey === "employee"} dir={sortDir} onClick={() => clickSort("employee")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Jenis")} active={sortKey === "type"} dir={sortDir} onClick={() => clickSort("type")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Rentang", "Range")} active={sortKey === "dateFrom"} dir={sortDir} onClick={() => clickSort("dateFrom")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Hari Kerja", "Working Days")} active={sortKey === "workingDays"} dir={sortDir} onClick={() => clickSort("workingDays")} className="text-right text-[11px] font-bold" />
                    <ServerSortHead label={t("Sisa Saldo", "Remaining Balance")} active={sortKey === "remaining"} dir={sortDir} onClick={() => clickSort("remaining")} className="text-right text-[11px] font-bold" />
                    <ServerSortHead label={t("Kembali Kerja", "Back to Work")} active={sortKey === "backToWork"} dir={sortDir} onClick={() => clickSort("backToWork")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Status")} active={sortKey === "status"} dir={sortDir} onClick={() => clickSort("status")} className="text-[11px] font-bold" />
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">{r.docNo}</p>
                        <p className="text-[10px] text-slate-400">{new Date(r.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "2-digit" })} · {r.source}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.employeeNo}</p>
                        <p className="text-[10px] text-slate-400">{r.fullName}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-slate-700 dark:text-slate-200">{r.leaveTypeName}</p>
                        {!r.paid && <Badge className="mt-0.5 bg-slate-100 text-[9px] font-bold text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{t("Tidak dibayar", "Unpaid")}</Badge>}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <p className="font-semibold text-slate-700 dark:text-slate-200">
                          {new Date(r.dateFrom).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionFrom], SESSION_LABEL_EN[r.sessionFrom])} → {new Date(r.dateTo).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionTo], SESSION_LABEL_EN[r.sessionTo])}
                        </p>
                        <p className="max-w-56 truncate text-[10px] text-slate-400" title={r.reason ?? ""}>{r.reason}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtDay(r.workingDays)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-bold tabular-nums", r.remainingAtRequest < 0 ? "text-rose-600" : "text-slate-500")}>{fmtDay(r.remainingAtRequest)}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">
                        {r.backToWorkDate ? <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3 text-slate-400" />{new Date(r.backToWorkDate).toLocaleDateString(locale, { day: "2-digit", month: "short" })}</span> : "—"}
                      </TableCell>
                      <TableCell><StatusPill status={r.status === "Submitted" ? "Submitted" : r.status === "Approved" || r.status === "MassLeave" ? "Approved" : r.status === "Rejected" ? "Rejected" : "Cancelled"} /></TableCell>
                      <TableCell>
                        {r.status === "Submitted" && perms.canOp("leave", "leave-request", "cancel") && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelRequest(r)} title={t("Batalkan", "Cancel")}>
                            <Ban className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Send className="h-4 w-4 ov-text-accent" /> {t("Ajukan Permintaan Cuti", "Submit Leave Request")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
                <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(typesApi.data?.employees ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jenis Cuti *", "Leave Type *")}</Label>
                <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("Pilih jenis", "Select type")} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(typesApi.data?.types ?? []).map((ty) => (
                      <SelectItem key={ty.id} value={ty.id}>{ty.name} ({ty.entitlement} {ty.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Mulai *", "Start *")}</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sesi", "Session")}</Label>
                <Select value={form.sessionFrom} onValueChange={(v) => setForm({ ...form, sessionFrom: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AM">{t("Pagi", "Morning")}</SelectItem><SelectItem value="PM">{t("Siang", "Afternoon")}</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sampai *", "Until *")}</Label>
                <Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sesi", "Session")}</Label>
                <Select value={form.sessionTo} onValueChange={(v) => setForm({ ...form, sessionTo: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AM">{t("Pagi", "Morning")}</SelectItem><SelectItem value="PM">{t("Siang", "Afternoon")}</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            {/* panel auto-compute — padanan (Number of Working Applied dsb.) */}
            <div className="rounded-xl border ov-border-accent ov-soft p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wide">{t("Hitungan Otomatis", "Auto Computation")} {previewBusy && "…"}</p>
                {selectedType && (
                  <div className="flex gap-1">
                    {selectedType.allowHalfDay && <Badge className="bg-white text-[9px] font-bold">{t("½ hari OK", "½ day OK")}</Badge>}
                    {selectedType.allowAdvance && <Badge className="bg-white text-[9px] font-bold">{t("advance OK")}</Badge>}
                    {selectedType.waitingMonths > 0 && <Badge className="bg-white text-[9px] font-bold">{t("tunggu {n} bln", "wait {n} mo", { n: selectedType.waitingMonths })}</Badge>}
                  </div>
                )}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{t("Hari Kerja", "Working Days")}</p>
                  <p className="text-sm font-extrabold">{preview ? fmtDay(preview.workingDays) : "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{t("Saldo Saat Ini", "Current Balance")}</p>
                  <p className="text-sm font-extrabold text-slate-700 dark:text-slate-200">{preview ? fmtDay(preview.balance) : "—"}{preview && <span className="ml-0.5 text-[9px] font-bold text-slate-400">{preview.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")}</span>}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{t("Sisa Saldo", "Remaining Balance")}</p>
                  <p className={cn("text-sm font-extrabold", preview && preview.remaining < 0 ? "text-rose-600" : "ov-text-accent")}>{preview ? fmtDay(preview.remaining) : "—"}{preview && <span className="ml-0.5 text-[9px] font-bold text-slate-400">{preview.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")}</span>}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">{t("Kembali Kerja", "Back to Work")}</p>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {preview?.backToWork ? new Date(preview.backToWork).toLocaleDateString(locale, { day: "2-digit", month: "short" }) : "—"}
                  </p>
                </div>
              </div>
              {preview && (
                <p className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {t("Periode saldo:", "Balance period:")} {loc(preview.periodLabel)} · {t("max {n} per permintaan", "max {n} per request", { n: preview.maxPerRequest })}{preview.remaining < 0 && t(" · saldo minus (advance leave)", " · negative balance (advance leave)")}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan *", "Reason *")}</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("mis. Acara keluarga / wisuda / kesehatan", "e.g. Family event / graduation / health")} className="min-h-16 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("Opsional — no. surat dsb.", "Optional — letter no. etc.")} className="h-8 text-xs" />
            </div>
            {selectedType?.needDocs && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                {t("Jenis ini memerlukan dokumen pendukung — serahkan ke HR saat approval.", "This type requires supporting documents — hand them to HR during approval.")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5 text-xs font-bold">
              <Send className="h-3.5 w-3.5" /> {t("Ajukan Permintaan", "Submit Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
