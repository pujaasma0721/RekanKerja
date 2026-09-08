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
import { useI18n } from "@/onevity/shared/lib/i18n";
import { XCircle, ArrowRightLeft, Search, Wallet, Timer, TrendingDown, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const monthIso = (d: Date) => d.toISOString().slice(0, 7);

export function AttendanceAbsencePage() {
  const { navigate } = useNav();
  const { t } = useI18n();
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
    if (!transfer.periodId) { toast.error(t("Pilih period payroll tujuan", "Select the target payroll period")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ employees: number; components: { code: string; name: string; employees: number; amount: number }[]; removed: number; window: { from: string; to: string } }>("/api/onevity/attendance/absence", "POST", transfer);
      toast.success(
        t("Transfer selesai — {n} karyawan, {components}", "Transfer completed — {n} employees, {components}", { n: res.employees, components: res.components.map((c) => `${c.code} ${fmtIDRShort(c.amount)}`).join(", ") || t("tidak ada komponen bernilai", "no valued components") }),
        { duration: 6000 },
      );
      setTransferDialog(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal transfer", "Transfer failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ATTENDANCE", "ATTENDANCE MODULE")}
        title={t("Rekap Absensi & Transfer ke Payroll", "Attendance Recap & Transfer to Payroll")}
        description={t("Rekap bulanan kehadiran (padanan Query Employee Attendance/Absence/Tidiness) dan jembatan Transfer to Payroll", "Monthly attendance recap (counterpart of Query Employee Attendance/Absence/Tidiness) and the Transfer to Payroll bridge")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-32 text-xs font-bold" />
            <Button onClick={openTransfer} className="gap-2 font-bold">
              <ArrowRightLeft className="h-4 w-4" /> {t("Transfer ke Payroll", "Transfer to Payroll")}
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><Timer className="h-4 w-4 text-amber-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Total Telat", "Total Late")}</p></div>
          <p className="text-lg font-extrabold text-amber-600 dark:text-amber-400">{t("{a} hari · {b} jam", "{a} days · {b} h", { a: totals?.lateCount ?? 0, b: Math.round((totals?.lateMinutes ?? 0) / 60) })}</p>
          <p className="text-[11px] text-stone-400">{t("estimasi potongan {v}", "estimated deduction {v}", { v: fmtIDRShort(totals?.lateDeduction ?? 0) })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-rose-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Absen + Izin Unpaid", "Absent + Unpaid Permits")}</p></div>
          <p className="text-lg font-extrabold text-rose-600 dark:text-rose-400">{t("{n} hari", "{n} days", { n: (totals?.absentDays ?? 0) + (totals?.workoffUnpaidDays ?? 0) })}</p>
          <p className="text-[11px] text-stone-400">{t("estimasi potongan {v}", "estimated deduction {v}", { v: fmtIDRShort(totals?.absenceDeduction ?? 0) })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-teal-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Lembur Bulan Ini", "Overtime This Month")}</p></div>
          <p className="text-lg font-extrabold text-teal-600 dark:text-teal-400">{t("{n} jam", "{n} h", { n: Math.round((totals?.overtimeMinutes ?? 0) / 60) })}</p>
          <p className="text-[11px] text-stone-400">{t("estimasi dibayar {v}", "estimated pay {v}", { v: fmtIDRShort(totals?.overtimePay ?? 0) })}</p>
        </div>
        <div className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Kehadiran Sempurna", "Perfect Attendance")}</p></div>
          <p className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">{t("{n} karyawan", "{n} employees", { n: (api.data?.recap ?? []).filter((r) => r.attendanceAllowance > 0).length })}</p>
          <p className="text-[11px] text-stone-400">{t("tunjangan {v}", "allowance {v}", { v: fmtIDRShort(totals?.attendanceAllowance ?? 0) })}</p>
        </div>
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div>
              <p className="text-[13px] font-bold">{t("Rekap {m} — {s}", "Recap {m} — {s}", { m: month, s: api.data ? t("{n} karyawan", "{n} employees", { n: rows.length }) : "…" })}</p>
              <p className="text-[11px] text-stone-400">{t("Jendela {s}", "Window {s}", { s: api.data ? `${fmtDate(api.data.from)} – ${fmtDate(api.data.to)}` : from })}</p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employee…")} className="h-8 w-48 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : rows.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada data rekap", "No recap data yet")} description={t("Pastikan jadwal ter-assign dan clocking tercatat pada bulan ini.", "Make sure schedules are assigned and clocking is recorded for this month.")} icon={<XCircle className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Hadir", "Present")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Telat", "Late")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Absen", "Absent")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Izin Unpaid", "Unpaid Permits")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Lembur", "Overtime")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Estimasi Lembur", "Est. Overtime")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Estimasi Potongan", "Est. Deduction")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Perfek", "Perfect")}</TableHead>
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
                        {r.lateCount > 0 ? t("{n}×", "{n}×", { n: r.lateCount }) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.absentDays > 0 ? "text-rose-600 dark:text-rose-400" : "text-stone-400")}>
                        {r.absentDays > 0 ? t("{n} h", "{n} d", { n: r.absentDays }) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.workoffUnpaidDays > 0 ? "text-orange-600 dark:text-orange-400" : "text-stone-400")}>
                        {r.workoffUnpaidDays > 0 ? t("{n} h", "{n} d", { n: r.workoffUnpaidDays }) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-right text-xs font-bold", r.overtimeMinutes > 0 ? "ov-text-accent" : "text-stone-400")}>
                        {r.overtimeMinutes > 0 ? t("{n} j", "{n} h", { n: (r.overtimeMinutes / 60).toFixed(1) }) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold ov-text-accent">{r.overtimePay > 0 ? fmtIDR(r.overtimePay) : "—"}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-rose-600 dark:text-rose-400">
                        {r.lateDeduction + r.absenceDeduction > 0 ? `−${fmtIDRShort(r.lateDeduction + r.absenceDeduction)}` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.attendanceAllowance > 0
                          ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">{t("SEMPURNA", "PERFECT")}</Badge>
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
              {t("{n} izin work-off menunggu persetujuan — hari izin belum dihitung dalam rekap.", "{n} work-off permits awaiting approval — permit days are not yet counted in the recap.", { n: workoffApi.data?.stats.pending ?? 0 })}
            </p>
            <Button size="sm" variant="outline" className="gap-1.5 border-amber-300 font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-300" onClick={() => navigate("attendance", "workoff")}>
              {t("Tinjau Izin →", "Review Permits →")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* dialog transfer */}
      <Dialog open={transferDialog} onOpenChange={setTransferDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Transfer Absensi ke Payroll", "Transfer Attendance to Payroll")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-[10px] leading-relaxed text-stone-500 dark:bg-stone-900/60">
              {t("Padanan ", "Counterpart of ")}<span className="font-bold">Transfer to Payroll</span>{t(": rekap jendela absensi ditulis sebagai komponen gaji ", ": the attendance window recap is written as ")}<span className="font-bold">Specific</span>{t(" pada period & process type terpilih (idempoten — re-transfer menimpa nilai lama). Jendela wajib berada dalam jendela period & tidak boleh beririsan dengan window period lain yang sudah ditransfer; jendela diisi otomatis dari window period bila tersedia.", " wage components on the selected period & process type (idempotent — re-transfer overwrites old values). The window must fall within the period window and must not overlap another already-transferred period window; the window is auto-filled from the period window when available.")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Period Payroll Tujuan *", "Target Payroll Period *")}</Label>
                <Select value={transfer.periodId} onValueChange={(v) => {
                  const p = periods.find((x) => x.id === v);
                  if (p) applyPeriodWindow(p, { ...transfer, periodId: v });
                  else setTransfer({ ...transfer, periodId: v });
                }}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder={periods.length ? t("Pilih period", "Select period") : t("Belum ada period terbuka", "No open periods yet")} /></SelectTrigger>
                  <SelectContent>
                    {periods.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.status})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Process Type")}</Label>
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
                <Label className="text-xs font-bold">{t("Jendela Absensi Dari *", "Attendance Window From *")}</Label>
                <Input type="date" value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Sampai *", "Until *")}</Label>
                <Input type="date" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} className="text-sm" />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-stone-200 p-3 dark:border-stone-800">
              <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">{t("Komponen yang ikut ditransfer", "Components to transfer")}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <ToggleRow id="incOT" checked={transfer.includeOvertime} onChange={(v) => setTransfer({ ...transfer, includeOvertime: v })} label={t("Lembur (LEMBUR)", "Overtime (LEMBUR)")} />
                <ToggleRow id="incLate" checked={transfer.includeLate} onChange={(v) => setTransfer({ ...transfer, includeLate: v })} label={t("Potongan telat (TLATE)", "Late deduction (TLATE)")} />
                <ToggleRow id="incAbs" checked={transfer.includeAbsence} onChange={(v) => setTransfer({ ...transfer, includeAbsence: v })} label={t("Potongan absen (TABS)", "Absence deduction (TABS)")} />
                <ToggleRow id="incAllw" checked={transfer.includeAttendanceAllowance} onChange={(v) => setTransfer({ ...transfer, includeAttendanceAllowance: v })} label={t("Tunjangan kehadiran (TKEHADIRAN)", "Attendance allowance (TKEHADIRAN)")} />
              </div>
            </div>
            {totals && (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-50 p-3 text-[11px] dark:bg-stone-900/60">
                <p className="text-stone-500">{t("Estimasi lembur: ", "Est. overtime: ")}<span className="font-bold text-teal-600">{fmtIDR(totals.overtimePay ?? 0)}</span></p>
                <p className="text-stone-500">{t("Estimasi potongan telat: ", "Est. late deduction: ")}<span className="font-bold text-rose-600">−{fmtIDR(totals.lateDeduction ?? 0)}</span></p>
                <p className="text-stone-500">{t("Estimasi potongan absen: ", "Est. absence deduction: ")}<span className="font-bold text-rose-600">−{fmtIDR(totals.absenceDeduction ?? 0)}</span></p>
                <p className="text-stone-500">{t("Tunjangan kehadiran: ", "Attendance allowance: ")}<span className="font-bold text-emerald-600">{fmtIDR(totals.attendanceAllowance ?? 0)}</span></p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferDialog(false)}>{t("Batal")}</Button>
            <Button onClick={runTransfer} disabled={busy || !transfer.periodId} className="gap-2 font-bold">
              {busy ? t("Memproses…", "Processing…") : <><ArrowRightLeft className="h-4 w-4" /> {t("Jalankan Transfer", "Run Transfer")}</>}
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
