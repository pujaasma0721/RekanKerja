"use client";
// OneVity Attendance — Lembur: perintah lembur Plan → Actual → Verified
// (padanan EmpOvertimeWrit.jsp + approval) dengan multiplier PP 35/2021.
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDate } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { OvertimeRow, EmployeeOption, OT_CATEGORY_LABEL, OT_CATEGORY_LABEL_EN } from "@/onevity/time-attendance/components/attendance-types";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { Clock, Plus, CheckCircle2, XCircle, Pencil, Ban, Search, BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "Pending", label: "Pending" },
  { key: "Approved", label: "Disetujui" },
  { key: "Paid", label: "Dibayar" },
  { key: "Rejected", label: "Ditolak" },
  { key: "Cancelled", label: "Dibatalkan" },
];

// label EN (peta paralel — render: t(f.label, STATUS_FILTERS_EN[f.key] ?? f.label))
const STATUS_FILTERS_EN: Record<string, string> = {
  all: "All", Pending: "Pending", Approved: "Approved", Paid: "Paid", Rejected: "Rejected", Cancelled: "Cancelled",
};

export function AttendanceOvertimePage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [orderDialog, setOrderDialog] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<OvertimeRow | null>(null);
  const [verifyTarget, setVerifyTarget] = useState<OvertimeRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [verifyMinutes, setVerifyMinutes] = useState("120");
  const [form, setForm] = useState({ employeeId: "", overtimeDate: new Date().toISOString().slice(0, 10), timeFrom: "17:00", timeTo: "20:00", letterNo: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const api = useApi<{ orders: OvertimeRow[]; stats: { total: number; pending: number; approved: number; paid: number; rejected: number; paidMinutes: number; approvedPay: number } }>(`/api/onevity/attendance/overtime?status=${statusFilter}`);
  const employeesApi = useApi<{ employees: EmployeeOption[] }>("/api/onevity/attendance/clocking");

  const orders = useMemo(() => (api.data?.orders ?? []).filter((o) =>
    !query || o.employee.fullName.toLowerCase().includes(query.toLowerCase()) || o.orderNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ note: string }>("/api/onevity/attendance/overtime", "POST", form);
      toast.success(res.note);
      setOrderDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan lembur", "Failed to submit overtime"));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (o: OvertimeRow, action: "approve" | "reject" | "verify" | "cancel", extra?: { note?: string; verifiedMinutes?: number }) => {
    try {
      const res = await apiSend<{ note: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>("/api/onevity/attendance/overtime", "PATCH", { id: o.id, action, ...extra });
      if (res.approval) {
        // T15-CHAIN-EXT: approval parsial — jenjang menengah disetujui, order
        // tetap menunggu jenjang berikutnya (pola workoff)
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
        title={t("Lembur (Overtime Work Order)", "Overtime (Work Order)")}
        description={t("Perintah lembur Plan → Actual → Verified — upah 1/173 × gaji pokok dengan multiplier per kategori hari (PP 35/2021)", "Overtime work orders Plan → Actual → Verified — pay 1/173 × base salary with a multiplier per day category (PP 35/2021)")}
        actions={
          <Button onClick={() => { setForm({ ...form, employeeId: employeesApi.data?.employees[0]?.id ?? "" }); setOrderDialog(true); }} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Ajukan Lembur", "Submit Overtime")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Menunggu Approval", "Awaiting Approval")}</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{stats?.pending ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("perintah lembur", "overtime orders")}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-brand" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Disetujui (siap bayar)", "Approved (ready to pay)")}</p></div>
          <p className="text-lg font-extrabold text-brand dark:text-brand/85">{stats?.approved ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("estimasi {v}", "est. {v}", { v: fmtIDRShort(stats?.approvedPay ?? 0) })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><BadgeCheck className="h-4 w-4 text-brand" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Dibayar via Payroll", "Paid via Payroll")}</p></div>
          <p className="text-lg font-extrabold text-brand dark:text-brand/85">{stats?.paid ?? 0}</p>
          <p className="text-[11px] text-stone-400">{t("{n} jam terbayar", "{n} h paid", { n: Math.round((stats?.paidMinutes ?? 0) / 60) })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-stone-400" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Ditolak / Batal", "Rejected / Cancelled")}</p></div>
          <p className="text-lg font-extrabold text-stone-500">{(stats?.rejected ?? 0)}</p>
          <p className="text-[11px] text-stone-400">{t("total keseluruhan {n}", "of {n} total", { n: stats?.total ?? 0 })}</p>
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
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan / no. order…", "Search employee / order no.…")} className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : orders.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada perintah lembur", "No overtime orders")} description={t("Ajukan work order lembur — jam akan diverifikasi dari clocking saat disetujui.", "Submit an overtime work order — hours will be verified from clocking upon approval.")} icon={<Clock className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Order</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Tanggal")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Kategori Hari", "Day Category")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Rencana", "Plan")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Aktual", "Actual")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Terverifikasi", "Verified")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Estimasi Upah", "Est. Pay")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-stone-500">{o.orderNo}</p>
                        {o.letterNo && <p className="font-mono text-[9px] text-stone-400">{t("surat {no}", "letter {no}", { no: o.letterNo })}</p>}
                        {o.reason && <p className="max-w-36 truncate text-[10px] italic text-stone-400" title={o.reason}>{o.reason}</p>}
                      </TableCell>
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{o.employee.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{o.employee.employeeNo} · {o.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-300">
                        {fmtDate(o.overtimeDate)}
                        <p className="font-mono text-[10px] text-stone-400">
                          {new Date(o.timeFrom).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}–{new Date(o.timeTo).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "text-[9px] font-bold",
                          o.dayCategory === "Weekday" && "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85",
                          o.dayCategory === "Weekend" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
                          o.dayCategory === "Holiday" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
                        )}>{t(OT_CATEGORY_LABEL[o.dayCategory] ?? o.dayCategory, OT_CATEGORY_LABEL_EN[o.dayCategory] ?? o.dayCategory)}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{t("{n} j", "{n} h", { n: (o.planMinutes / 60).toFixed(1) })}</TableCell>
                      <TableCell className="text-right text-xs">{o.actualMinutes > 0 ? t("{n} j", "{n} h", { n: (o.actualMinutes / 60).toFixed(1) }) : "—"}</TableCell>
                      <TableCell className="text-right text-xs font-bold ov-text-accent">{o.verifiedMinutes > 0 ? t("{n} j", "{n} h", { n: (o.verifiedMinutes / 60).toFixed(1) }) : "—"}</TableCell>
                      <TableCell className="text-right text-xs font-bold ov-text-accent">{o.estPay > 0 ? fmtIDR(o.estPay) : "—"}</TableCell>
                      <TableCell>
                        <StatusPill status={o.status} />
                        {o.paidRunNo && <p className="font-mono text-[9px] text-stone-400">{o.paidRunNo}</p>}
                        {o.approval && (o.approval.status === "InProgress" || o.approval.status === "Rejected") && (
                          <div className="mt-1 space-y-0.5">
                            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
                              o.approval.status === "InProgress"
                                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400")}>
                              {o.approval.status === "InProgress" ? t("Jenjang", "Tier") : t("Ditolak di", "Rejected at")} {o.approval.currentLevel}/{o.approval.totalLevels}
                            </span>
                            {o.approval.status === "InProgress" && o.approval.currentApprover && (
                              <p className="max-w-36 truncate text-[10px] text-stone-400" title={o.approval.currentApprover}>{t("menunggu", "awaiting")} {o.approval.currentApprover}</p>
                            )}
                          </div>
                        )}
                        {o.decisionNote && <p className="max-w-36 truncate text-[9px] italic text-stone-400" title={o.decisionNote}>{o.decisionNote}</p>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {o.status === "Pending" && (
                            <>
                              {perms.canOp("attendance", "overtime", "approve") && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Setujui", "Approve")} onClick={() => decide(o, "approve")} aria-label={t("Setujui lembur", "Approve overtime")}>
                                    <CheckCircle2 className="h-4 w-4 text-brand" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Tolak", "Reject")} onClick={() => { setRejectTarget(o); setRejectNote(""); }} aria-label={t("Tolak lembur", "Reject overtime")}>
                                    <XCircle className="h-4 w-4 text-rose-500" />
                                  </Button>
                                </>
                              )}
                            </>
                          )}
                          {o.status === "Approved" && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Verifikasi jam", "Verify hours")} onClick={() => { setVerifyTarget(o); setVerifyMinutes(String(o.verifiedMinutes || o.actualMinutes || o.planMinutes)); }} aria-label={t("Verifikasi jam lembur", "Verify overtime hours")}>
                                <Pencil className="h-4 w-4 ov-text-accent" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title={t("Batalkan", "Cancel")} onClick={() => decide(o, "cancel", { note: "Dibatalkan admin" })} aria-label={t("Batalkan lembur", "Cancel overtime")}>
                                <Ban className="h-4 w-4 text-stone-400" />
                              </Button>
                            </>
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
      <Dialog open={orderDialog} onOpenChange={setOrderDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("Ajukan Perintah Lembur", "Submit Overtime Order")}</DialogTitle>
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
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tanggal *", "Date *")}</Label>
                <Input type="date" value={form.overtimeDate} onChange={(e) => setForm({ ...form, overtimeDate: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Mulai *", "Start *")}</Label>
                <Input type="time" value={form.timeFrom} onChange={(e) => setForm({ ...form, timeFrom: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Selesai *", "End *")}</Label>
                <Input type="time" value={form.timeTo} onChange={(e) => setForm({ ...form, timeTo: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("No. Surat Lembur", "Overtime Letter No.")}</Label>
              <Input value={form.letterNo} onChange={(e) => setForm({ ...form, letterNo: e.target.value })} placeholder={t("opsional — mis. SL-2026-041", "optional — e.g. SL-2026-041")} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan / Pekerjaan", "Reason / Work")}</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder={t("mis. penyelesaian order ekspor unit #47", "e.g. completing export order unit #47")} className="min-h-16 text-sm" />
            </div>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              {t("Kategori hari otomatis dari jadwal karyawan (weekday / hari libur mingguan / libur nasional) → menentukan multiplier upah. Lembur dibatasi maksimal 4 jam/hari (PP 35/2021) dan disetujui berjenjang — jam aktual diambil dari clocking saat disetujui.", "The day category is automatic from the employee's schedule (weekday / weekly day off / national holiday) → determines the pay multiplier. Overtime is capped at 4 hours/day (PP 35/2021) and goes through tiered approval — actual hours are taken from clocking on approval.")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderDialog(false)}>{t("Batal")}</Button>
            <Button onClick={submit} disabled={busy || !form.employeeId} className="font-bold">
              {busy ? t("Mengirim…", "Sending…") : t("Ajukan Lembur", "Submit Overtime")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog tolak */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Tolak Lembur {no}", "Reject Overtime {no}", { no: rejectTarget?.orderNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2.5 py-1">
            {rejectTarget?.approval?.status === "InProgress" && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
                {t("Approval berjenjang: jenjang", "Tiered approval: tier")} <b>{rejectTarget.approval.currentLevel}</b> {t("dari", "of")} <b>{rejectTarget.approval.totalLevels}</b> — {t("menunggu keputusan", "awaiting decision by")} <b>{rejectTarget.approval.currentApprover ?? t("jenjang berikutnya", "the next tier")}</b>. {t("Menolak jenjang ini menghentikan seluruh proses persetujuan.", "Rejecting this tier stops the whole approval process.")}
              </p>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Alasan penolakan *", "Rejection reason *")}</Label>
              <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder={t("mis. melebihi batas 4 jam/hari PP 35/2021 / tanpa work order resmi", "e.g. exceeds the 4 h/day PP 35/2021 limit / no official work order")} className="min-h-20 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("Batal")}</Button>
            {perms.canOp("attendance", "overtime", "approve") && (
              <Button onClick={async () => { if (rejectTarget) { await decide(rejectTarget, "reject", { note: rejectNote }); setRejectTarget(null); } }} disabled={!rejectNote.trim()} className="bg-rose-600 font-bold hover:bg-rose-700">
                {t("Tolak Perintah", "Reject Order")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog verifikasi */}
      <Dialog open={!!verifyTarget} onOpenChange={(v) => !v && setVerifyTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Verifikasi Jam — {no}", "Verify Hours — {no}", { no: verifyTarget?.orderNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            {verifyTarget && (
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-stone-50 p-3 text-center text-[11px] dark:bg-stone-900/60">
                <div><p className="font-bold text-stone-400">{t("RENCANA", "PLAN")}</p><p className="font-extrabold">{t("{n} jam", "{n} h", { n: (verifyTarget.planMinutes / 60).toFixed(1) })}</p></div>
                <div><p className="font-bold text-stone-400">{t("AKTUAL", "ACTUAL")}</p><p className="font-extrabold">{t("{n} jam", "{n} h", { n: (verifyTarget.actualMinutes / 60).toFixed(1) })}</p></div>
                <div><p className="font-bold text-stone-400">{t("SAAT INI", "CURRENT")}</p><p className="font-extrabold ov-text-accent">{t("{n} jam", "{n} h", { n: (verifyTarget.verifiedMinutes / 60).toFixed(1) })}</p></div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Jam dibayar (menit) *", "Paid hours (minutes) *")}</Label>
              <Input type="number" min={30} max={600} step={15} value={verifyMinutes} onChange={(e) => setVerifyMinutes(e.target.value)} className="text-sm" />
              <p className="text-[10px] text-stone-400">{t("Padanan kolom Verified Overtime — jam inilah yang dibayar lewat transfer payroll.", "Counterpart of the Verified Overtime column — these are the hours paid via the payroll transfer.")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerifyTarget(null)}>{t("Batal")}</Button>
            <Button onClick={async () => { if (verifyTarget) { await decide(verifyTarget, "verify", { verifiedMinutes: parseInt(verifyMinutes, 10) }); setVerifyTarget(null); } }} className="font-bold">
              {t("Simpan Verifikasi", "Save Verification")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
