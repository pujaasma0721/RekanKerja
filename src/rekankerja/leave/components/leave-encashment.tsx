"use client";
// RekanKerja Leave — Uang Pengganti Cuti: encashment + transfer payroll
// (padanan LeaveEncashment + LeaveEncashmentToApprove + EmpLeaveCashable).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort } from "@/rekankerja/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { PeriodOption } from "@/rekankerja/time-attendance/components/attendance-types";
import { Wallet, Plus, CheckCircle2, XCircle, Ban, Search, Send, Coins, ArrowRightCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Submitted", label: "Menunggu" },
  { key: "Approved", label: "Disetujui" },
  { key: "Transferred", label: "Ditransfer" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
];

// LABEL EN (peta paralel — render: t(f.label, STATUS_FILTERS_EN[f.key]))
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Submitted: "Pending", Approved: "Approved", Transferred: "Transferred", Paid: "Paid", Rejected: "Rejected",
};

export function LeaveEncashmentPage() {
  const { t, locale } = useI18n();
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
    `/api/rekankerja/leave/encashment?status=${statusFilter}`,
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/rekankerja/leave/types");
  const periodsApi = useApi<{ periods: PeriodOption[] }>("/api/rekankerja/payroll-periods");

  const encashments = useMemo(() => (api.data?.encashments ?? []).filter((e) =>
    !query || e.fullName.toLowerCase().includes(query.toLowerCase()) || e.docNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const openPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Draft" || p.status === "Calculated");

  const submit = async () => {
    if (!form.employeeId) { toast.error(t("Karyawan wajib dipilih", "Employee is required")); return; }
    const cashableTypes = (typesApi.data?.types ?? []).filter((ty) => ty.cashable);
    if (cashableTypes.length === 0) { toast.error(t("Tidak ada jenis cuti yang bisa diuangkan", "No cashable leave type available")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; amount: number; remaining: number }>("/api/rekankerja/leave/encashment", "POST", {
        employeeId: form.employeeId,
        leaveTypeId: cashableTypes[0]!.id, // jenis cashable pertama (CT-THN)
        year: Number(form.year), days: Number(form.days),
        paymentDate: form.paymentDate || undefined, note: form.note || undefined,
      });
      toast.success(t("{doc} diajukan — estimasi {amt}, sisa saldo {r} hari", "{doc} submitted — estimated {amt}, remaining balance {r} days", { doc: res.docNo, amt: fmtIDR(res.amount), r: res.remaining }));
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan encashment", "Failed to submit the encashment"));
    } finally { setBusy(false); }
  };

  const decide = async (e: EncashmentRowUI, action: "approve" | "reject" | "cancel", note?: string) => {
    try {
      const res = await apiSend<{ docNo: string; status: string }>("/api/rekankerja/leave/encashment", "PATCH", { id: e.id, action, note });
      toast.success(t("{doc} → {s}", "{doc} → {s}", { doc: res.docNo, s: res.status }) + (action === "approve" ? t(" — saldo cashed diperbarui", " — cashed balance updated") : ""));
      setRejectTarget(null);
      api.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("Gagal"));
    }
  };

  const transfer = async () => {
    if (!periodId) { toast.error(t("Pilih period payroll tujuan", "Select the target payroll period")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ periodName: string; employees: number; rows: number; totalAmount: number; removed: number }>(
        "/api/rekankerja/leave/transfer", "POST", { periodId },
      );
      toast.success(t("Transfer ke {p}: {e} karyawan, {r} baris UCT, total {a}", "Transferred to {p}: {e} employees, {r} UCT rows, total {a}", { p: res.periodName, e: res.employees, r: res.rows, a: fmtIDR(res.totalAmount) }), { duration: 6000 });
      setTransferDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal transfer ke payroll", "Failed to transfer to payroll"));
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Uang Pengganti Cuti (Encashment)", "Leave Encashment")}
        description={t("Saldo cuti tahunan diuangkan → komponen UCT masuk payroll period → Dibayar saat run dikonfirmasi (padanan Employee Leave Cashable)", "Annual leave balance cashed out → the UCT component enters the payroll period → Paid when the run is confirmed (Employee Leave Cashable equivalent)")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferDialog(true); }} className="gap-2 font-bold">
              <ArrowRightCircle className="h-4 w-4" /> {t("Transfer ke Payroll", "Transfer to Payroll")}
            </Button>
            <Button onClick={() => {
              setForm({ employeeId: typesApi.data?.employees[0]?.id ?? "", year: String(new Date().getFullYear()), days: "2", paymentDate: "", note: "" });
              setDialog(true);
            }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Ajukan Encashment", "Request Encashment")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: t("Menunggu Approval", "Pending Approvals"), value: stats?.submitted ?? 0, sub: t("permintaan", "requests"), icon: Send, tone: "text-amber-600" },
          { label: t("Siap Transfer", "Ready to Transfer"), value: stats?.approved ?? 0, sub: t("approved — belum masuk payroll", "approved — not yet in payroll"), icon: Coins, tone: "text-brand" },
          { label: t("Total Nilai", "Total Value"), value: fmtIDRShort(stats?.totalAmount ?? 0), sub: t("{n} hari diuangkan", "{n} days cashed out", { n: stats?.totalDays ?? 0 }), icon: Wallet, tone: "text-orange-600" },
          { label: t("Ditransfer / Dibayar", "Transferred / Paid"), value: (stats?.transferred ?? 0) + (stats?.paid ?? 0), sub: t("{n} sudah dibayar", "{n} already paid", { n: stats?.paid ?? 0 }), icon: CheckCircle2, tone: "text-brand" },
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
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : encashments.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada encashment", "No encashments")} description={t("Saldo cuti tahunan yang bisa diuangkan akan muncul di sini.", "Cashable annual leave balances will appear here.")} icon={<Wallet className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Hari", "Days")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Estimasi Upah", "Estimated Wage")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Tgl Bayar", "Pay Date")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Payroll")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {encashments.map((e) => (
                    <TableRow key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">{e.docNo}</p>
                        <p className="text-[10px] text-slate-400">{new Date(e.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "2-digit" })} · {e.leaveTypeName} {e.year}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{e.employeeNo}</p>
                        <p className="text-[10px] text-slate-400">{e.fullName}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{e.days}</TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-brand-deep dark:text-brand/85">{fmtIDR(e.amount)}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">{e.paymentDate ? new Date(e.paymentDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</TableCell>
                      <TableCell className="text-[11px] text-slate-500">
                        {e.periodCode ? <span className="font-mono">{e.periodCode}{e.transferredRunNo && <span className="block text-[9px] text-slate-400">{e.transferredRunNo}</span>}</span> : "—"}
                      </TableCell>
                      <TableCell><StatusPill status={e.status === "Submitted" ? "Submitted" : e.status === "Approved" || e.status === "Paid" ? "Approved" : e.status === "Transferred" ? "Transferred" : e.status === "Rejected" ? "Rejected" : "Cancelled"} /></TableCell>
                      <TableCell>
                        {e.status === "Submitted" && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => decide(e, "approve", "Disetujui")} className="h-7 gap-1 bg-brand text-[11px] font-bold hover:bg-brand/70">
                              <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setRejectTarget(e); setRejectNote(""); }} className="h-7 gap-1 border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
                              <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => decide(e, "cancel", "Dibatalkan")} className="h-7 text-[11px] font-bold text-slate-400" title={t("Batalkan", "Cancel")}>
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 ov-text-accent" /> {t("Ajukan Uang Pengganti Cuti", "Request Leave Encashment")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Karyawan *", "Employee *")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm({ ...form, employeeId: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(typesApi.data?.employees ?? []).map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.employeeNo} — {emp.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tahun Saldo *", "Balance Year *")}</Label>
                <Select value={form.year} onValueChange={(v) => setForm({ ...form, year: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Hari Diuangkan *", "Days to Cash Out *")}</Label>
                <Input type="number" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} className="h-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Tanggal Pembayaran", "Payment Date")}</Label>
              <Input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Catatan")}</Label>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("Opsional", "Optional")} className="h-8 text-xs" />
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-brand/10 p-2.5 text-[11px] leading-relaxed text-brand-deep dark:bg-brand/90/30 dark:text-brand/85">
              <Coins className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>{t("Estimasi upah = hari × gaji pokok ÷ 25. Setelah disetujui, saldo ", "Estimated wage = days × base salary ÷ 25. Once approved, the ")}<b>{t("e · diuangkan", "e · cashed out")}</b>{t(" bertambah dan siap ditransfer sebagai komponen ", " increases and is ready to be transferred as the ")}<b>UCT</b>{t(" ke payroll period.", " component to the payroll period.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy} className="gap-1.5 text-xs font-bold">
              <Send className="h-3.5 w-3.5" /> {t("Ajukan", "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ArrowRightCircle className="h-4 w-4 text-brand" /> {t("Transfer ke Payroll", "Transfer to Payroll")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t("Semua encashment ", "All encashments ")}<b>{t("Disetujui")}</b>{t(" dengan tanggal bayar dalam period terpilih ditulis sebagai komponen ", " with a payment date within the selected period are written as the ")}<b>{t("UCT (Uang Pengganti Cuti)", "UCT (Leave Encashment)")}</b>{t(" — padanan ", " — equivalent of ")}<i>Employee Leave Cashable</i>.{" "}
              {t("Idempoten: assignment UCT lama period ini ditulis ulang.", "Idempotent: existing UCT assignments for this period are rewritten.")}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Period Payroll *", "Payroll Period *")}</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={openPeriods.length ? t("Pilih period", "Select period") : t("Tidak ada period terbuka", "No open period")} /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({new Date(p.startDate).toLocaleDateString(locale, { day: "2-digit", month: "short" })} – {new Date(p.endDate).toLocaleDateString(locale, { day: "2-digit", month: "short" })})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-brand/15 text-[10px] font-bold text-brand-deep hover:bg-brand/15 dark:bg-brand/15 dark:text-brand/85">{t("Komponen UCT", "UCT Component")}</Badge>
              <Badge variant="outline" className="text-[10px]">{t("Run SALARY")}</Badge>
              <Badge variant="outline" className="text-[10px]">{t("Confirm → Paid")}</Badge>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={transfer} disabled={busy || !periodId} className="gap-1.5 bg-brand text-xs font-bold hover:bg-brand/70">
              <ArrowRightCircle className="h-3.5 w-3.5" /> {t("Transfer Sekarang", "Transfer Now")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm text-rose-600">
              <XCircle className="h-4 w-4" /> {t("Tolak Encashment", "Reject Encashment")}
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900/60">
                <p className="font-bold text-slate-800 dark:text-slate-100">{rejectTarget.docNo} — {rejectTarget.fullName}</p>
                <p className="text-slate-500">{t("{n} hari", "{n} days", { n: rejectTarget.days })} · {fmtIDR(rejectTarget.amount)}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Alasan Penolakan *", "Rejection Reason *")}</Label>
                <Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t("mis. kuota tahunan sudah habis", "e.g. annual quota exhausted")} className="h-8 text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button
              onClick={() => rejectTarget && decide(rejectTarget, "reject", rejectNote)}
              disabled={!rejectNote.trim()}
              className="bg-rose-600 text-xs font-bold hover:bg-rose-700"
            >
              {t("Tolak", "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
