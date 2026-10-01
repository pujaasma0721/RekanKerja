"use client";
// RekanKerja Payroll — Periode Payroll: daftar period multi-jendela + buat/tutup period
import { useState } from "react";
import { useApi, apiSend, fmtDate } from "@/lib/rekankerja/api";
import { useNav } from "@/lib/rekankerja/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { CalendarRange, Plus, Lock, ChevronRight } from "lucide-react";
import { PeriodRow } from "@/components/rekankerja/payroll/payroll-types";

export function PayrollPeriodsPage() {
  const { navigate } = useNav();
  const { data, loading, refresh } = useApi<{ periods: PeriodRow[] }>("/api/rekankerja/payroll-periods");
  const [open, setOpen] = useState(false);

  const closePeriod = async (p: PeriodRow) => {
    try {
      await apiSend("/api/rekankerja/payroll-periods", "PATCH", { id: p.id, status: "Closed" });
      toast.success(`Period ${p.name} ditutup`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Periode Payroll"
        description="Period gaji dengan jendela payroll & kehadiran (TA) terpisah, bulan pajak, dan status kunci period"
        actions={
          <Button onClick={() => setOpen(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Period Baru
          </Button>
        }
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : (data?.periods.length ?? 0) === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada period" description="Buat period payroll pertama untuk memulai proses gaji." icon={<CalendarRange className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="text-[11px] font-bold">Period</TableHead>
                    <TableHead className="text-[11px] font-bold">Jendela Payroll</TableHead>
                    <TableHead className="text-[11px] font-bold">Jendela Kehadiran (TA)</TableHead>
                    <TableHead className="text-[11px] font-bold">Bulan Pajak</TableHead>
                    <TableHead className="text-center text-[11px] font-bold">Run</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.periods ?? []).map((p) => (
                    <TableRow key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold">{p.name}</p>
                        <p className="font-mono text-[10px] text-slate-400">{p.code} · {p.payType}</p>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {p.taStartDate ? `${fmtDate(p.taStartDate)} – ${fmtDate(p.taEndDate ?? p.endDate)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">{p.sptMonth}/{p.sptYear}</TableCell>
                      <TableCell className="text-center">
                        <button
                          onClick={() => navigate("payroll", "runs", { period: p.id })}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 transition hover:bg-emerald-100 hover:text-emerald-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-400"
                        >
                          {p._count.runs} <ChevronRight className="h-3 w-3" />
                        </button>
                      </TableCell>
                      <TableCell><StatusPill status={p.status} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {p.status === "Open" && (
                            <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => closePeriod(p)}>
                              <Lock className="h-3 w-3" /> Tutup
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400" onClick={() => navigate("payroll", "runs", { period: p.id })}>
                            Runs <ChevronRight className="h-3 w-3" />
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
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !startDate || !endDate) { toast.error("Nama & tanggal period wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/payroll-periods", "POST", { name: name.trim(), startDate, endDate });
      toast.success("Period payroll dibuat");
      setName(""); setStartDate(""); setEndDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><CalendarRange className="h-4 w-4 text-emerald-600" /> Period Payroll Baru</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Nama Period *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="cth: OKTOBER 2026" className="mt-1.5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Tanggal Mulai *</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">Tanggal Selesai *</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
            Kode period, bulan pajak (SPT), dan jendela kehadiran (TA) diisi otomatis dari rentang tanggal. Jendela TA dapat disesuaikan setelah period dibuat.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Buat Period"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
