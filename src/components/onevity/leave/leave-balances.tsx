"use client";
// OneVity Leave — Informasi Cuti (Saldo): kolom a–g + formula oranHR
// (padanan Employee Leave Information + Generate + Leave Adjustment)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { BalanceRowUI, LeaveTypeRow, EmployeeOption, fmtDay } from "./leave-types";
import { Palmtree, Sparkles, Search, Plus, Minus, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

export function LeaveBalancesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [genDialog, setGenDialog] = useState(false);
  const [adjTarget, setAdjTarget] = useState<BalanceRowUI | null>(null);
  const [busy, setBusy] = useState(false);
  const [genForm, setGenForm] = useState({ year: String(new Date().getFullYear()), leaveTypeId: "all" });
  const [adjForm, setAdjForm] = useState({ delta: "1", reason: "" });

  const api = useApi<{ balances: BalanceRowUI[]; summary: { rows: number; employees: number; totalRemaining: number; totalTaken: number; negative: number } }>(
    `/api/onevity/leave/balances?year=${year}`, [year],
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/onevity/leave/types");

  const balances = useMemo(() => (api.data?.balances ?? []).filter((b) => {
    if (typeFilter !== "all" && b.leaveTypeCode !== typeFilter) return false;
    return !query || b.fullName.toLowerCase().includes(query.toLowerCase()) || b.employeeNo.toLowerCase().includes(query.toLowerCase());
  }), [api.data, query, typeFilter]);

  const generate = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ rows: number; updated: number; carryTotal: number; employees: number; types: number }>(
        "/api/onevity/leave/balances", "POST",
        { year: Number(genForm.year), leaveTypeId: genForm.leaveTypeId === "all" ? undefined : genForm.leaveTypeId },
      );
      toast.success(`Generate ${genForm.year}: ${res.rows} saldo baru, ${res.updated} carry-over diperbarui (${res.carryTotal} hari bawa)`);
      setGenDialog(false);
      setYear(Number(genForm.year));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal generate saldo");
    } finally { setBusy(false); }
  };

  const adjust = async () => {
    if (!adjTarget) return;
    const delta = Number(adjForm.delta);
    if (!delta || !adjForm.reason.trim()) { toast.error("Nilai penyesuaian & alasan wajib diisi"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ adjustment: number }>("/api/onevity/leave/balances", "PATCH", {
        employeeId: adjTarget.employeeId, leaveTypeId: adjTarget.leaveTypeId, year: adjTarget.year, delta, reason: adjForm.reason,
      });
      toast.success(`Saldo ${adjTarget.fullName} disesuaikan → total adjustment ${res.adjustment} hari`);
      setAdjTarget(null);
      setAdjForm({ delta: "1", reason: "" });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyesuaikan saldo");
    } finally { setBusy(false); }
  };

  const s = api.data?.summary;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL LEAVE"
        title="Informasi Cuti (Saldo Karyawan)"
        description="Saldo per karyawan × jenis — formula oranHR (a+b+c) − (d+e+f+g): carry-over, earned prorata, penyesuaian, hangus, diuangkan, terpakai"
        actions={
          <Button onClick={() => { setGenForm({ year: String(year), leaveTypeId: "all" }); setGenDialog(true); }} className="gap-2 bg-orange-600 font-bold hover:bg-orange-700">
            <Sparkles className="h-4 w-4" /> Generate Leave Information
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Baris Saldo", value: s ? String(s.rows) : "—", sub: s ? `${s.employees} karyawan` : undefined, icon: Palmtree, tone: "text-orange-600" },
          { label: "Total Saldo Tersisa", value: s ? `${s.totalRemaining} hari` : "—", sub: "akumulasi semua jenis", icon: ArrowUpDown, tone: "text-teal-600" },
          { label: "Total Terpakai", value: s ? `${s.totalTaken} hari` : "—", sub: "cuti disetujui/massal", icon: Palmtree, tone: "text-amber-600" },
          { label: "Saldo Minus (Advance)", value: s ? String(s.negative) : "—", sub: "karyawan saldo minus", icon: Minus, tone: "text-rose-600" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", k.tone)} /><p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k.label}</p></div>
              <p className="text-lg font-extrabold text-stone-800 dark:text-stone-100">{k.value}</p>
              {k.sub && <p className="text-[11px] text-stone-400">{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="h-8 w-24 text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Semua jenis" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua jenis</SelectItem>
                  {(typesApi.data?.types ?? []).map((t) => <SelectItem key={t.id} value={t.code}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari karyawan…" className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : balances.length === 0 ? (
            <div className="p-5"><EmptyState title="Belum ada saldo" description="Jalankan Generate Leave Information untuk tahun ini." icon={<Palmtree className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Jenis Cuti</TableHead>
                    <TableHead className="text-[11px] font-bold">Periode</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(a) Carry-over">a · Carry</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(b) Earned prorata">b · Earned</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(c) Penyesuaian">c · Adj</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(d) Hangus 31-12">d · Hangus</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(e) Diuangkan">e · Cash</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(f) Terpakai (lampau)">f · Terpakai</TableHead>
                    <TableHead className="text-right text-[11px] font-bold" title="(g) Disetujui mendatang">g · Akan</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">Saldo</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => (
                    <TableRow key={b.balanceId ?? b.employeeId + b.leaveTypeId} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{b.employeeNo}</p>
                        <p className="text-[10px] text-stone-400">{b.fullName} · {b.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-semibold text-stone-700 dark:text-stone-200">{b.leaveTypeName}</p>
                        <p className="font-mono text-[9px] text-stone-400">{b.leaveTypeCode}{!b.paid && " · tidak dibayar"}</p>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-stone-400">{b.periodLabel}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-stone-500">{fmtDay(b.carriedOver)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-stone-500">{fmtDay(b.earned)}</TableCell>
                      <TableCell className={cn("text-right text-xs tabular-nums", b.adjustment !== 0 ? "font-bold text-amber-600" : "text-stone-500")}>{fmtDay(b.adjustment)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-stone-400">{fmtDay(b.forfeited)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-teal-600">{fmtDay(b.cashed)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-stone-500">{fmtDay(b.taken)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-stone-500">{fmtDay(b.applied)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-extrabold tabular-nums", b.remaining < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400")}>
                        {fmtDay(b.remaining)} {b.unit === "MONTH" ? "bln" : "hr"}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setAdjTarget(b); setAdjForm({ delta: "1", reason: "" }); }} title="Penyesuaian saldo">
                          <Plus className="h-3.5 w-3.5 text-stone-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={genDialog} onOpenChange={setGenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-orange-600" /> Generate Leave Information
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              Membuat baris saldo per karyawan × jenis untuk tahun tertentu. Carry-over dihitung dari
              saldo sisa tahun sebelumnya (maksimum sesuai jenis, hangus 31 Des). Padanan
              <i> GenerateLeaveInfoProcess.jsp</i> oranHR.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Tahun *</Label>
                <Select value={genForm.year} onValueChange={(v) => setGenForm({ ...genForm, year: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Jenis Cuti</Label>
                <Select value={genForm.leaveTypeId} onValueChange={(v) => setGenForm({ ...genForm, leaveTypeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua jenis aktif</SelectItem>
                    {(typesApi.data?.types ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialog(false)} className="text-xs font-bold">Batal</Button>
            <Button onClick={generate} disabled={busy} className="bg-orange-600 text-xs font-bold hover:bg-orange-700">Generate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjTarget} onOpenChange={(v) => !v && setAdjTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4 text-amber-600" /> Penyesuaian Saldo
            </DialogTitle>
          </DialogHeader>
          {adjTarget && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-xs dark:bg-stone-900/60">
                <p className="font-bold text-stone-800 dark:text-stone-100">{adjTarget.employeeNo} — {adjTarget.fullName}</p>
                <p className="text-stone-500">{adjTarget.leaveTypeName} · {adjTarget.year} · saldo sekarang {fmtDay(adjTarget.remaining)} hari</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Penyesuaian (± hari) *</Label>
                  <Input type="number" value={adjForm.delta} onChange={(e) => setAdjForm({ ...adjForm, delta: e.target.value })} placeholder="mis. 2 atau -1" className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">Alasan *</Label>
                  <Input value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder="mis. kompensasi lembur libur" className="h-8 text-xs" />
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-stone-400">
                Padanan <i>Leave Adjustment</i> oranHR — kolom (c) pada formula saldo.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjTarget(null)} className="text-xs font-bold">Batal</Button>
            <Button onClick={adjust} disabled={busy} className="bg-amber-600 text-xs font-bold hover:bg-amber-700">Terapkan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
