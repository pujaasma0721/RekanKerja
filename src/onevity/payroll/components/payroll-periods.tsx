"use client";
// OneVity Payroll — Periode Payroll: daftar period multi-jendela + buat/tutup period
import { useState } from "react";
import { useApi, apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CalendarRange, Plus, Lock, ChevronRight } from "lucide-react";
import { PeriodRow } from "@/onevity/payroll/components/payroll-types";
import { useI18n, loc } from "@/onevity/shared/lib/i18n";

export function PayrollPeriodsPage() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ periods: PeriodRow[] }>("/api/onevity/payroll-periods");
  const [open, setOpen] = useState(false);

  const closePeriod = async (p: PeriodRow) => {
    try {
      await apiSend("/api/onevity/payroll-periods", "PATCH", { id: p.id, status: "Closed" });
      toast.success(t("Period {name} ditutup", "Period {name} closed", { name: loc(p.name) }));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Periode Payroll")}
        description={t("Period gaji dengan jendela payroll & kehadiran (TA) terpisah, bulan pajak, dan status kunci period", "Salary periods with separate payroll & attendance (TA) windows, tax month, and period lock status")}
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Period Baru", "New Period")}
          </Button>
        }
      />

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : (data?.periods.length ?? 0) === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada period", "No periods yet")} description={t("Buat period payroll pertama untuk memulai proses gaji.", "Create the first payroll period to start paying salaries.")} icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">{t("Period")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jendela Payroll", "Payroll Window")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jendela Kehadiran (TA)", "Attendance Window (TA)")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Bulan Pajak", "Tax Month")}</TableHead>
                    <TableHead className="text-center text-[11px] font-bold">{t("Run")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.periods ?? []).map((p) => (
                    <TableRow key={p.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold">{loc(p.name)}</p>
                        <p className="font-mono text-[10px] text-stone-400">{p.code} · {p.payType}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-500">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</TableCell>
                      <TableCell className="text-xs text-stone-500">
                        {p.taStartDate ? `${fmtDate(p.taStartDate)} – ${fmtDate(p.taEndDate ?? p.endDate)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{p.sptMonth}/{p.sptYear}</TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => navigate("payroll", "runs", { period: p.id })}
                          className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] font-bold text-stone-600 transition hover:ov-soft dark:bg-stone-800 dark:text-stone-300"
                        >
                          {p._count.runs} <ChevronRight className="h-3 w-3" />
                        </button>
                      </TableCell>
                      <TableCell><StatusPill status={p.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {p.status === "Open" && (
                            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => closePeriod(p)}>
                              <Lock className="h-3 w-3" /> {t("Tutup")}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] font-bold ov-text-accent" onClick={() => navigate("payroll", "runs", { period: p.id })}>
                            {t("Runs")} <ChevronRight className="h-3 w-3" />
                          </Button>
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

      <PeriodDialog open={open} onClose={() => { setOpen(false); refresh(); }} />
    </div>
  );
}

function PeriodDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !startDate || !endDate) { toast.error(t("Nama & tanggal period wajib diisi", "Period name & dates are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/payroll-periods", "POST", { name: name.trim(), startDate, endDate });
      toast.success(t("Period payroll dibuat", "Payroll period created"));
      setName(""); setStartDate(""); setEndDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4 ov-text-accent" /> {t("Period Payroll Baru", "New Payroll Period")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("Nama Period *", "Period Name *")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("cth: OKTOBER 2026", "e.g. OCTOBER 2026")} className="mt-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Tanggal Mulai *", "Start Date *")}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("Tanggal Selesai *", "End Date *")}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <p className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900">
            {t("Kode period, bulan pajak (SPT), dan jendela kehadiran (TA) diisi otomatis dari rentang tanggal. Jendela TA dapat disesuaikan setelah period dibuat.", "Period code, tax month (SPT), and attendance (TA) window are filled automatically from the date range. The TA window can be adjusted after the period is created.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Buat Period", "Create Period")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
