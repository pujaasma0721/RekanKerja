"use client";
// OneVity Attendance — Absensi & Izin: rekap bulanan per karyawan (padanan Query
// Employee Attendance/Absence/Tidiness) + Transfer to Payroll (jembatan payroll).
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort, fmtDate } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
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
import { RecapRow, PeriodOption, WorkoffRow } from "@/onevity/time-attendance/components/attendance-types";
import { XCircle, ArrowRightLeft, Search, Wallet, Timer, TrendingDown, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const monthIso = (d: Date) => d.toISOString().slice(0, 7);

export function AttendanceAbsencePage() {
  const { navigate } = useNav();
  const now = new Date();
  const [month, setMonth] = useState(monthIso(now));
  const [query, setQuery] = useState("");
  const [transferDialog, setTransferDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState({
    periodId: "", processTypeCode: "SALARY",
    from: `${monthIso(now)}-01`, to: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
    includeOvertime: true, includeLate: true, includeAbsence: true, includeAttendanceAllowance: true,
  });

  const from = `${month}-01`;
  const to = (() => { const [y, m] = month.split("-").map(Number); return new Date(y, m, 0).toISOString().slice(0, 10); })();
  const api = useApi<{ from: string; to: string; recap: RecapRow[]; totals: Record<string, number>; periods: PeriodOption[]; processTypes: { id: string; code: string; name: string }[] }>(`/api/onevity/attendance/absence?from=${from}&to=${to}`);
  const workoffApi = useApi<{ permits: WorkoffRow[]; stats: { pending: number } }>(`/api/onevity/attendance/workoffs?status=Pending`);

  const rows = useMemo(() => (api.data?.recap ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.employeeNo.toLowerCase().includes(query.toLowerCase())
  ), [api.data, query]);

  const totals = api.data?.totals;
  const periods = api.data?.periods ?? [];

  const openTransfer = () => {
    const p = periods[0];
    if (p) applyPeriodWindow(p, { ...transfer, periodId: p.id, from, to });
    else setTransfer({ ...transfer, periodId: "", from, to });
    setTransferDialog(true);
  };

  // fix M-4: prefill jendela absensi dari window TA period (taStartDate/taEndDate)
  // bila period sudah punya window — jendela di luar period akan ditolak server.
  const applyPeriodWindow = (p: PeriodOption, base: typeof transfer) => {
    if (p.taStartDate && p.taEndDate) {
      setTransfer({ ...base, from: p.taStartDate.slice(0, 10), to: p.taEndDate.slice(0, 10) });
    } else {
      setTransfer(base);
    }
  };

  const runTransfer = async () => {
    if (!transfer.periodId) { toast.error("Pilih period payroll tujuan"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ employees: number; components: { code: string; name: string; employees: number; amount: number }[]; removed: number; window: { from: string; to: string } }>("/api/onevity/attendance/absence", "POST", transfer);
      toast.success(
        `Transfer selesai — ${res.employees} karyawan, ${res.components.map((c) => `${c.code} ${fmtIDRShort(c.amount)}`).join(", ") || "tidak ada komponen bernilai"}`,
        { duration: 6000 },
      );
      setTransferDialog(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal transfer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL ATTENDANCE"
        title="Rekap Absensi & Transfer ke Payroll"
        description="Rekap bulanan kehadiran (padanan Query Employee Attendance/Absence/Tidiness) dan jembatan Transfer to Payroll oranHR"
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-32 text-xs font-bold" />
            <Button onClick={openTransfer} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              <ArrowRightLeft className="h-4 w-4" /> Transfer ke Payroll
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><Timer className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Total Telat</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{totals?.lateCount ?? 0} hari · {Math.round((totals?.lateMinutes ?? 0) / 60)} jam</p>
          <p className="text-[11px] text-stone-400">estimasi potongan {fmtIDRShort(totals?.lateDeduction ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-rose-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Absen + Izin Unpaid</p></div>
          <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400">{(totals?.absentDays ?? 0) + (totals?.workoffUnpaidDays ?? 0)} hari</p>
          <p className="text-[11px] text-stone-400">estimasi potongan {fmtIDRShort(totals?.absenceDeduction ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-teal-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Lembur Bulan Ini</p></div>
          <p className="text-lg font-extrabold text-teal-600 dark:text-teal-400">{Math.round((totals?.overtimeMinutes ?? 0) / 60)} jam</p>
          <p className="text-[11px] text-stone-400">estimasi dibayar {fmtIDRShort(totals?.overtimePay ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Kehadiran Sempurna</p></div>
          <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{(api.data?.recap ?? []).filter((r) => r.attendanceAllowance > 0).length} karyawan</p>
          <p className="text-[11px] text-stone-400">tunjangan {fmtIDRShort(totals?.attendanceAllowance ?? 0)}</p>
        </div>
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div>
              <p className="text-[13px] font-bold">Rekap {month} — {api.data ? `${rows.length} karyawan` : "…"}</p>
              <p className="text-[11px] text-stone-400">Jendela {api.data ? `${fmtDate(api.data.from)} – ${fmtDate(api.data.to)}` : from}</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan…" className="h-8 w-48 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada data rekap" description="Pastikan jadwal ter-assign dan clocking tercatat pada bulan ini." icon={<XCircle className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Hadir</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Telat</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Absen</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Izin Unpaid</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Lembur</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Estimasi Lembur</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Estimasi Potongan</TableHead>
                    <TableHead className="text-[11px] font-bold">Perfek</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.employeeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{r.fullName}</p>
                        <p className="font-mono text-[10px] text-stone-400">{r.employeeNo} · {r.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold text-emerald-600 dark:text-emerald-400">{r.presentDays}/{r.scheduledDays}</TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.lateCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-stone-400")}>
                        {r.lateCount > 0 ? `${r.lateCount}×` : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.absentDays > 0 ? "text-rose-600 dark:text-rose-400" : "text-stone-400")}>
                        {r.absentDays > 0 ? `${r.absentDays} h` : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.workoffUnpaidDays > 0 ? "text-orange-600 dark:text-orange-400" : "text-stone-400")}>
                        {r.workoffUnpaidDays > 0 ? `${r.workoffUnpaidDays} h` : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.overtimeMinutes > 0 ? "text-teal-600 dark:text-teal-400" : "text-stone-400")}>
                        {r.overtimeMinutes > 0 ? `${(r.overtimeMinutes / 60).toFixed(1)} j` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-teal-700 dark:text-teal-400">{r.overtimePay > 0 ? fmtIDR(r.overtimePay) : "—"}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-rose-600 dark:text-rose-400">
                        {r.lateDeduction + r.absenceDeduction > 0 ? `−${fmtIDRShort(r.lateDeduction + r.absenceDeduction)}` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.attendanceAllowance > 0
                          ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">SEMPURNA</Badge>
                          : <span className="text-[10px] text-stone-300">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(workoffApi.data?.stats?.pending ?? 0) > 0 && (
        <Card className="mt-4 rounded-2xl border-amber-200/80 bg-amber-50/60 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-amber-800 dark:text-amber-300">
              <TrendingDown className="h-4 w-4" />
              {workoffApi.data?.stats.pending} izin work-off menunggu persetujuan — hari izin belum dihitung dalam rekap.
            </p>
            <Button size="sm" variant="outline" className="gap-1.5 border-amber-300 font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300" onClick={() => navigate("attendance", "workoff")}>
              Tinjau Izin →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* dialog transfer */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer Absensi ke Payroll</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              Padanan oranHR <span className="font-bold">Transfer to Payroll</span>: rekap jendela absensi ditulis sebagai komponen gaji <span className="font-bold">Specific</span> pada period & process type terpilih (idempoten — re-transfer menimpa nilai lama). Jendela wajib berada dalam jendela period & tidak boleh beririsan dengan window period lain yang sudah ditransfer; jendela diisi otomatis dari window period bila tersedia.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Period Payroll Tujuan *</Label>
                <Select value={transfer.periodId} onValueChange={(v) => {
                  const p = periods.find((x) => x.id === v);
                  if (p) applyPeriodWindow(p, { ...transfer, periodId: v });
                  else setTransfer({ ...transfer, periodId: v });
                }}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder={periods.length ? "Pilih period" : "Belum ada period terbuka"} /></SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Process Type</Label>
                <Select value={transfer.processTypeCode} onValueChange={(v) => setTransfer({ ...transfer, processTypeCode: v })}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(api.data?.processTypes ?? []).filter((p) => ["SALARY", "BONUS", "YEAR_END_ADJ"].includes(p.code)).map((p) => (
                      <SelectItem key={p.code} value={p.code}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Jendela Absensi Dari *</Label>
                <Input type="date" value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Sampai *</Label>
                <Input type="date" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Komponen yang ikut ditransfer</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ToggleRow id="incOT" checked={transfer.includeOvertime} onChange={(v) => setTransfer({ ...transfer, includeOvertime: v })} label="Lembur (LEMBUR)" />
                <ToggleRow id="incLate" checked={transfer.includeLate} onChange={(v) => setTransfer({ ...transfer, includeLate: v })} label="Potongan telat (TLATE)" />
                <ToggleRow id="incAbs" checked={transfer.includeAbsence} onChange={(v) => setTransfer({ ...transfer, includeAbsence: v })} label="Potongan absen (TABS)" />
                <ToggleRow id="incAllw" checked={transfer.includeAttendanceAllowance} onChange={(v) => setTransfer({ ...transfer, includeAttendanceAllowance: v })} label="Tunjangan kehadiran (TKEHADIRAN)" />
              </div>
            </div>
            {totals && (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-50 p-3 text-[11px] dark:bg-stone-900/60">
                <p className="text-stone-500">Estimasi lembur: <span className="font-bold text-teal-600">{fmtIDR(totals.overtimePay ?? 0)}</span></p>
                <p className="text-stone-500">Estimasi potongan telat: <span className="font-bold text-rose-600">−{fmtIDR(totals.lateDeduction ?? 0)}</span></p>
                <p className="text-stone-500">Estimasi potongan absen: <span className="font-bold text-rose-600">−{fmtIDR(totals.absenceDeduction ?? 0)}</span></p>
                <p className="text-stone-500">Tunjangan kehadiran: <span className="font-bold text-emerald-600">{fmtIDR(totals.attendanceAllowance ?? 0)}</span></p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(false)}>Batal</Button>
            <Button onClick={runTransfer} disabled={busy || !transfer.periodId} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
              {busy ? "Memproses…" : <><ArrowRightLeft className="h-4 w-4" /> Jalankan Transfer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-[11px] font-medium">{label}</Label>
    </div>
  );
}
