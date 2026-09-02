"use client";
// OneVity Leave — Permintaan Cuti: form auto-compute (padanan LeaveRequest.jsp)
// hari kerja dihitung dari jadwal absensi, saldo & HP kembali kerja otomatis.
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
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
import { RequestRowUI, LeaveTypeRow, EmployeeOption, LEAVE_STATUS_LABEL, SESSION_LABEL, fmtDay } from "./leave-types";
import { Inbox, Plus, Search, CalendarClock, Send, Ban, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "MassLeave", label: "Cuti Massal" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

interface PreviewResult {
  workingDays: number; balance: number; remaining: number;
  backToWork: string | null; maxPerRequest: number; unit: string;
  waitingMonths: number; allowAdvance: boolean; periodLabel: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function LeaveRequestsPage() {
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

  const api = useApi<{ requests: RequestRowUI[]; stats: { total: number; submitted: number; approved: number; rejected: number; cancelled: number; massLeave: number; pendingDays: number; approvedDays: number } }>(
    `/api/onevity/leave/requests?status=${statusFilter}`,
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/onevity/leave/types");

  const requests = useMemo(() => (api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  // preview auto-compute saat form berubah (debounce)
  useEffect(() => {
    if (!dialog || !form.employeeId || !form.leaveTypeId || !form.dateFrom || !form.dateTo) { setPreview(null); return; }
    const t = setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const res = await apiSend<PreviewResult>("/api/onevity/leave/requests", "POST", { ...form, preview: true });
        setPreview(res);
      } catch {
        setPreview(null);
        // error validasi ditampilkan saat submit; preview silent-fail
      } finally { setPreviewBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [dialog, form]);

  const selectedType = (typesApi.data?.types ?? []).find((t) => t.id === form.leaveTypeId);

  const submit = async () => {
    if (!form.employeeId || !form.leaveTypeId) { toast.error("Karyawan & jenis cuti wajib dipilih"); return; }
    if (!form.reason.trim()) { toast.error("Alasan cuti wajib diisi"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; workingDays: number; remaining: number; backToWork: string | null }>(
        "/api/onevity/leave/requests", "POST", form,
      );
      toast.success(`${res.docNo} diajukan — ${res.workingDays} hari kerja, sisa saldo ${res.remaining}`);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan cuti");
    } finally { setBusy(false); }
  };

  const cancelRequest = async (r: RequestRowUI) => {
    if (r.status !== "Submitted") { toast.error("Hanya permintaan berstatus Menunggu yang bisa dibatalkan"); return; }
    try {
      const res = await apiSend<{ docNo: string; status: string }>("/api/onevity/leave/requests", "PATCH", { id: r.id, action: "cancel", note: "Dibatalkan pemberi kuasa" });
      toast.success(`${res.docNo} dibatalkan`);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal membatalkan");
    }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Permintaan Cuti"
        description="Pengajuan cuti dengan hitungan otomatis — hari kerja dari jadwal absensi, saldo saat ini, sisa saldo & tanggal kembali kerja"
        actions={
          <Button onClick={() => {
            setForm({
              employeeId: typesApi.data?.employees[0]?.id ?? "", leaveTypeId: (typesApi.data?.types ?? []).find((t) => t.code === "CT-THN")?.id ?? typesApi.data?.types[0]?.id ?? "",
              dateFrom: todayISO(), sessionFrom: "AM", dateTo: todayISO(), sessionTo: "PM", reason: "", note: "",
            });
            setPreview(null);
            setDialog(true);
          }} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
            <Plus className="h-4 w-4" /> Ajukan Cuti
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Menunggu Approval", value: stats?.submitted ?? 0, sub: `${stats?.pendingDays ?? 0} hari diminta`, icon: Inbox, tone: "text-amber-600" },
          { label: "Disetujui", value: (stats?.approved ?? 0) + (stats?.massLeave ?? 0), sub: `${stats?.approvedDays ?? 0} hari total`, icon: CheckCircle2, tone: "text-emerald-600" },
          { label: "Cuti Massal", value: stats?.massLeave ?? 0, sub: "baris dari SKB", icon: Inbox, tone: "text-rose-600" },
          { label: "Total Permintaan", value: stats?.total ?? 0, sub: `${stats?.rejected ?? 0} ditolak · ${stats?.cancelled ?? 0} batal`, icon: Inbox, tone: "text-stone-500" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", k.tone)} /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p></div>
              <p className="text-lg font-extrabold text-stone-800 dark:text-stone-100">{k.value}</p>
              <p className="text-[11px] text-stone-400">{k.sub}</p>
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-bold transition",
                  statusFilter === f.key ? "bg-orange-600 text-white shadow-sm" : "bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800",
                )}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan / no. dokumen…" className="h-8 w-56 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : requests.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada permintaan cuti" description="Ajukan cuti baru — hari kerja & saldo dihitung otomatis dari jadwal." icon={<Inbox className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                    <TableHead className="text-[11px] font-bold">Dokumen</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Jenis</TableHead>
                    <TableHead className="text-[11px] font-bold">Rentang</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Hari Kerja</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Sisa Saldo</TableHead>
                    <TableHead className="text-[11px] font-bold">Kembali Kerja</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">{r.docNo}</p>
                        <p className="text-[10px] text-stone-400">{new Date(r.requestDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })} · {r.source}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{r.employeeNo}</p>
                        <p className="text-[10px] text-stone-400">{r.fullName}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-stone-700 dark:text-stone-200">{r.leaveTypeName}</p>
                        {!r.paid && <Badge className="mt-0.5 bg-stone-100 text-[9px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">Tidak dibayar</Badge>}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        <p className="font-semibold text-stone-700 dark:text-stone-200">
                          {new Date(r.dateFrom).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionFrom]} → {new Date(r.dateTo).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} {SESSION_LABEL[r.sessionTo]}
                        </p>
                        <p className="max-w-56 truncate text-[10px] text-stone-400" title={r.reason ?? ""}>{r.reason}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{fmtDay(r.workingDays)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-bold tabular-nums", r.remainingAtRequest < 0 ? "text-rose-600" : "text-stone-500")}>{fmtDay(r.remainingAtRequest)}</TableCell>
                      <TableCell className="text-[11px] text-stone-500">
                        {r.backToWorkDate ? <span className="flex items-center gap-1"><CalendarClock className="h-3 w-3 text-stone-400" />{new Date(r.backToWorkDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })}</span> : "—"}
                      </TableCell>
                      <TableCell><StatusPill status={r.status === "Submitted" ? "Submitted" : r.status === "Approved" || r.status === "MassLeave" ? "Approved" : r.status === "Rejected" ? "Rejected" : "Cancelled"} /></TableCell>
                      <TableCell>
                        {r.status === "Submitted" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => cancelRequest(r)} title="Batalkan">
                            <Ban className="h-3.5 w-3.5 text-stone-400" />
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Send className="h-4 w-4 text-orange-600" /> Ajukan Permintaan Cuti
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Karyawan *</Label>
                <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(typesApi.data?.employees ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Jenis Cuti *</Label>
                <Select value={form.leaveTypeId} onValueChange={(v) => setForm({ ...form, leaveTypeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih jenis" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {(typesApi.data?.types ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name} ({t.entitlement} {t.unit === "MONTH" ? "bln" : "hr"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Mulai *</Label>
                <Input type="date" value={form.dateFrom} onChange={(e) => setForm({ ...form, dateFrom: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Sesi</Label>
                <Select value={form.sessionFrom} onValueChange={(v) => setForm({ ...form, sessionFrom: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AM">Pagi</SelectItem><SelectItem value="PM">Siang</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Sampai *</Label>
                <Input type="date" value={form.dateTo} onChange={(e) => setForm({ ...form, dateTo: e.target.value })} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Sesi</Label>
                <Select value={form.sessionTo} onValueChange={(v) => setForm({ ...form, sessionTo: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="AM">Pagi</SelectItem><SelectItem value="PM">Siang</SelectItem></SelectContent>
                </Select>
              </div>
            </div>

            {/* panel auto-compute — padanan oranHR (Number of Working Applied dsb.) */}
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/30">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">Hitungan Otomatis {previewBusy && "…"}</p>
                {selectedType && (
                  <div className="flex gap-1">
                    {selectedType.allowHalfDay && <Badge className="bg-white text-[9px] font-bold text-orange-700">½ hari OK</Badge>}
                    {selectedType.allowAdvance && <Badge className="bg-white text-[9px] font-bold text-orange-700">advance OK</Badge>}
                    {selectedType.waitingMonths > 0 && <Badge className="bg-white text-[9px] font-bold text-orange-700">tunggu {selectedType.waitingMonths} bln</Badge>}
                  </div>
                )}
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                <div>
                  <p className="text-[9px] font-bold uppercase text-stone-400">Hari Kerja</p>
                  <p className="text-sm font-extrabold text-orange-700 dark:text-orange-400">{preview ? fmtDay(preview.workingDays) : "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-stone-400">Saldo Saat Ini</p>
                  <p className="text-sm font-extrabold text-stone-700 dark:text-stone-200">{preview ? fmtDay(preview.balance) : "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-stone-400">Sisa Saldo</p>
                  <p className={cn("text-sm font-extrabold", preview && preview.remaining < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400")}>{preview ? fmtDay(preview.remaining) : "—"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-stone-400">Kembali Kerja</p>
                  <p className="text-xs font-bold text-stone-700 dark:text-stone-200">
                    {preview?.backToWork ? new Date(preview.backToWork).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : "—"}
                  </p>
                </div>
              </div>
              {preview && (
                <p className="mt-1.5 text-[10px] text-stone-500 dark:text-stone-400">
                  Periode saldo: {preview.periodLabel} · max {preview.maxPerRequest} per permintaan{preview.remaining < 0 && " · saldo minus (advance leave)"}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Alasan *</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="mis. Acara keluarga / wisuda / kesehatan" className="min-h-16 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Catatan</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Opsional — no. surat dsb." className="h-8 text-xs" />
            </div>
            {selectedType?.needDocs && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                Jenis ini memerlukan dokumen pendukung — serahkan ke HR saat approval.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">Batal</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5 bg-orange-600 text-xs font-bold hover:bg-orange-700">
              <Send className="h-3.5 w-3.5" /> Ajukan Permintaan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
