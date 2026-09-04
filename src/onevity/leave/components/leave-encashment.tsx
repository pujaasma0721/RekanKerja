"use client";
// OneVity Leave — Uang Pengganti Cuti: encashment + transfer payroll
// (padanan LeaveEncashment + LeaveEncashmentToApprove + EmpLeaveCashable).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { EncashmentRowUI, LeaveTypeRow, EmployeeOption } from "./leave-types";
import { PeriodOption } from "@/onevity/time-attendance/components/attendance-types";
import { Wallet, Plus, CheckCircle2, XCircle, Ban, Search, Send, Coins, ArrowRightCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Transferred", label: "Ditransfer" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

export function LeaveEncashmentPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [transferDialog, setTransferDialog] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<EncashmentRowUI | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ employeeId: "", year: String(new Date().getFullYear()), days: "2", paymentDate: "", note: "" });
  const [periodId, setPeriodId] = useState("");

  const api = useApi<{ encashments: EncashmentRowUI[]; stats: { total: number; submitted: number; approved: number; transferred: number; paid: number; totalDays: number; totalAmount: number } }>(
    `/api/onevity/leave/encashment?status=${statusFilter}`,
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/onevity/leave/types");
  const periodsApi = useApi<{ periods: PeriodOption[] }>("/api/onevity/payroll-periods");

  const encashments = useMemo(() => (api.data?.encashments ?? []).filter((e) =>
    !query || e.fullName.toLowerCase().includes(query.toLowerCase()) || e.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const openPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Draft" || p.status === "Calculated");

  const submit = async () => {
    if (!form.employeeId) { toast.error("Karyawan wajib dipilih"); return; }
    const cashableTypes = (typesApi.data?.types ?? []).filter((t) => t.cashable);
    if (cashableTypes.length === 0) { toast.error("Tidak ada jenis cuti yang bisa diuangkan"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; amount: number; remaining: number }>("/api/onevity/leave/encashment", "POST", {
        employeeId: form.employeeId,
        leaveTypeId: cashableTypes[0]!.id, // jenis cashable pertama (CT-THN)
        year: Number(form.year), days: Number(form.days),
        paymentDate: form.paymentDate || undefined, note: form.note || undefined,
      });
      toast.success(`${res.docNo} diajukan — estimasi ${fmtIDR(res.amount)}, sisa saldo ${res.remaining} hari`);
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengajukan encashment");
    } finally { setBusy(false); }
  };

  const decide = async (e: EncashmentRowUI, action: "approve" | "reject" | "cancel", note?: string) => {
    try {
      const res = await apiSend<{ docNo: string; status: string }>("/api/onevity/leave/encashment", "PATCH", { id: e.id, action, note });
      toast.success(`${res.docNo} → ${res.status}${action === "approve" ? " — saldo cashed diperbarui" : ""}`);
      setRejectTarget(null);
      api.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal");
    }
  };

  const transfer = async () => {
    if (!periodId) { toast.error("Pilih period payroll tujuan"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ periodName: string; employees: number; rows: number; totalAmount: number; removed: number }>(
        "/api/onevity/leave/transfer", "POST", { periodId },
      );
      toast.success(`Transfer ke ${res.periodName}: ${res.employees} karyawan, ${res.rows} baris UCT, total ${fmtIDR(res.totalAmount)}`, { duration: 6000 });
      setTransferDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal transfer ke payroll");
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Uang Pengganti Cuti (Encashment)"
        description="Saldo cuti tahunan diuangkan → komponen UCT masuk payroll period → Dibayar saat run dikonfirmasi (padanan Employee Leave Cashable)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferDialog(true); }} className="gap-2 font-bold">
              <ArrowRightCircle className="h-4 w-4" /> Transfer ke Payroll
            </Button>
            <Button onClick={() => {
              setForm({ employeeId: typesApi.data?.employees[0]?.id ?? "", year: String(new Date().getFullYear()), days: "2", paymentDate: "", note: "" });
              setDialog(true);
            }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> Ajukan Encashment
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Menunggu Approval", value: stats?.submitted ?? 0, sub: "permintaan", icon: Send, tone: "text-amber-600" },
          { label: "Siap Transfer", value: stats?.approved ?? 0, sub: "approved — belum masuk payroll", icon: Coins, tone: "text-teal-600" },
          { label: "Total Nilai", value: fmtIDRShort(stats?.totalAmount ?? 0), sub: `${stats?.totalDays ?? 0} hari diuangkan`, icon: Wallet, tone: "text-orange-600" },
          { label: "Ditransfer / Dibayar", value: (stats?.transferred ?? 0) + (stats?.paid ?? 0), sub: `${stats?.paid ?? 0} sudah dibayar`, icon: CheckCircle2, tone: "text-emerald-600" },
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
                  statusFilter === f.key ? "ov-fill shadow-sm" : "bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800",
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
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : encashments.length === 0 ? (
            <div className="p-5"><EmptyState title="Tidak ada encashment" description="Saldo cuti tahunan yang bisa diuangkan akan muncul di sini." icon={<Wallet className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Dokumen</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Hari</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Estimasi Upah</TableHead>
                    <TableHead className="text-[11px] font-bold">Tgl Bayar</TableHead>
                    <TableHead className="text-[11px] font-bold">Payroll</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {encashments.map((e) => (
                    <TableRow key={e.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-700 dark:text-stone-200">{e.docNo}</p>
                        <p className="text-[10px] text-stone-400">{new Date(e.requestDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })} · {e.leaveTypeName} {e.year}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{e.employeeNo}</p>
                        <p className="text-[10px] text-stone-400">{e.fullName}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-stone-700 dark:text-stone-200">{e.days}</TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-teal-700 dark:text-teal-400">{fmtIDR(e.amount)}</TableCell>
                      <TableCell className="text-[11px] text-stone-500">{e.paymentDate ? new Date(e.paymentDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</TableCell>
                      <TableCell className="text-[11px] text-stone-500">
                        {e.periodCode ? <span className="font-mono">{e.periodCode}{e.transferredRunNo && <span className="block text-[9px] text-stone-400">{e.transferredRunNo}</span>}</span> : "—"}
                      </TableCell>
                      <TableCell><StatusPill status={e.status === "Submitted" ? "Submitted" : e.status === "Approved" || e.status === "Paid" ? "Approved" : e.status === "Transferred" ? "Transferred" : e.status === "Rejected" ? "Rejected" : "Cancelled"} /></TableCell>
                      <TableCell>
                        {e.status === "Submitted" && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => decide(e, "approve", "Disetujui")} className="h-7 gap-1 bg-emerald-600 text-[11px] font-bold hover:bg-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setRejectTarget(e); setRejectNote(""); }} className="h-7 gap-1 border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
                              <XCircle className="h-3.5 w-3.5" /> Tolak
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => decide(e, "cancel", "Dibatalkan")} className="h-7 text-[11px] font-bold text-stone-400" title="Batalkan">
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </div>
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 ov-text-accent" /> Ajukan Uang Pengganti Cuti
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Karyawan *</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(typesApi.data?.employees ?? []).map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.employeeNo} — {emp.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Tahun Saldo *</Label>
                <Select value={form.year} onValueChange={(v) => setForm({ ...form, year: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Hari Diuangkan *</Label>
                <Input type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Tanggal Pembayaran</Label>
              <Input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Catatan</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Opsional" className="h-8 text-xs" />
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-teal-50 p-2.5 text-[11px] leading-relaxed text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
              <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>Estimasi upah = hari × gaji pokok ÷ 25. Setelah disetujui, saldo <b>e · diuangkan</b> bertambah dan siap ditransfer sebagai komponen <b>UCT</b> ke payroll period.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">Batal</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5 text-xs font-bold">
              <Send className="h-3.5 w-3.5" /> Ajukan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ArrowRightCircle className="h-4 w-4 text-teal-600" /> Transfer ke Payroll
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              Semua encashment <b>Disetujui</b> dengan tanggal bayar dalam period terpilih ditulis sebagai
              komponen <b>UCT (Uang Pengganti Cuti)</b> — padanan <i>Employee Leave Cashable</i>.
              Idempoten: assignment UCT lama period ini ditulis ulang.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Period Payroll *</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={openPeriods.length ? "Pilih period" : "Tidak ada period terbuka"} /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({new Date(p.startDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} – {new Date(p.endDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short" })})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-teal-100 text-[10px] font-bold text-teal-700 hover:bg-teal-100 dark:bg-teal-500/15 dark:text-teal-400">Komponen UCT</Badge>
              <Badge variant="outline" className="text-[10px]">Run SALARY</Badge>
              <Badge variant="outline" className="text-[10px]">Confirm → Paid</Badge>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(false)} className="text-xs font-bold">Batal</Button>
            <Button onClick={transfer} disabled={busy || !periodId} className="gap-1.5 bg-teal-600 text-xs font-bold hover:bg-teal-700">
              <ArrowRightCircle className="h-3.5 w-3.5" /> Transfer Sekarang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-rose-600">
              <XCircle className="h-4 w-4" /> Tolak Encashment
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-900/60">
                <p className="font-bold text-stone-800 dark:text-stone-100">{rejectTarget.docNo} — {rejectTarget.fullName}</p>
                <p className="text-stone-500">{rejectTarget.days} hari · {fmtIDR(rejectTarget.amount)}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Alasan Penolakan *</Label>
                <Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="mis. kuota tahunan sudah habis" className="h-8 text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="text-xs font-bold">Batal</Button>
            <Button
              onClick={() => rejectTarget && decide(rejectTarget, "reject", rejectNote)}
              disabled={!rejectNote.trim()}
              className="bg-rose-600 text-xs font-bold hover:bg-rose-700"
            >
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
