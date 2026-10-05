"use client";
// RekanKerja Leave — Informasi Cuti (Saldo): kolom a–g + formula
// (padanan Employee Leave Information + Generate + Leave Adjustment)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";

// Task 99 (F1-6) — opsi tahun dinamis (tahun berjalan −2 .. +1, bukan hardcoded).
const YEAR_OPTIONS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i);

export function LeaveBalancesPage() {
  const { t } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [genDialog, setGenDialog] = useState(false);
  const [adjTarget, setAdjTarget] = useState<BalanceRowUI | null>(null);
  const [busy, setBusy] = useState(false);
  const [genForm, setGenForm] = useState({ year: String(new Date().getFullYear()), leaveTypeId: "all" });
  const [adjForm, setAdjForm] = useState({ delta: "1", reason: "" });

  const api = useApi<{ balances: BalanceRowUI[]; summary: { rows: number; employees: number; totalRemaining: number; totalTaken: number; negative: number } }>(
    `/api/rekankerja/leave/balances?year=${year}`, [year],
  );
  const typesApi = useApi<{ types: LeaveTypeRow[]; employees: EmployeeOption[] }>("/api/rekankerja/leave/types");

  const balances = useMemo(() => (api.data?.balances ?? []).filter((b) => {
    if (typeFilter !== "all" && b.leaveTypeCode !== typeFilter) return false;
    return !query || b.fullName.toLowerCase().includes(query.toLowerCase()) || b.employeeNo.toLowerCase().includes(query.toLowerCase());
  }), [api.data, query, typeFilter]);

  // Task 72 — sorting kolom tabel saldo cuti
  const sort = useTableSort(balances, {
    employee: (b) => b.fullName,
    nip: (b) => b.employeeNo,
    type: (b) => b.leaveTypeName,
    period: (b) => b.periodLabel,
    carried: (b) => b.carriedOver,
    earned: (b) => b.earned,
    adjustment: (b) => b.adjustment,
    forfeited: (b) => b.forfeited,
    cashed: (b) => b.cashed,
    taken: (b) => b.taken,
    applied: (b) => b.applied,
    remaining: (b) => b.remaining,
  }, { defaultKey: "employee", defaultDir: "asc" });

  const generate = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ rows: number; updated: number; carryTotal: number; employees: number; types: number }>(
        "/api/rekankerja/leave/balances", "POST",
        { year: Number(genForm.year), leaveTypeId: genForm.leaveTypeId === "all" ? undefined : genForm.leaveTypeId },
      );
      toast.success(t("Generate {y}: {r} saldo baru, {u} carry-over diperbarui ({c} hari bawa)", "Generate {y}: {r} new balances, {u} carry-over updated ({c} days carried)", { y: genForm.year, r: res.rows, u: res.updated, c: res.carryTotal }));
      setGenDialog(false);
      setYear(Number(genForm.year));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal generate saldo", "Failed to generate balances"));
    } finally { setBusy(false); }
  };

  const adjust = async () => {
    if (!adjTarget) return;
    const delta = Number(adjForm.delta);
    if (!delta || !adjForm.reason.trim()) { toast.error(t("Nilai penyesuaian & alasan wajib diisi", "Adjustment value & reason are required")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ adjustment: number }>("/api/rekankerja/leave/balances", "PATCH", {
        employeeId: adjTarget.employeeId, leaveTypeId: adjTarget.leaveTypeId, year: adjTarget.year, delta, reason: adjForm.reason,
      });
      toast.success(t("Saldo {n} disesuaikan → total adjustment {a} hari", "Balance for {n} adjusted → total adjustment {a} days", { n: adjTarget.fullName, a: res.adjustment }));
      setAdjTarget(null);
      setAdjForm({ delta: "1", reason: "" });
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyesuaikan saldo", "Failed to adjust the balance"));
    } finally { setBusy(false); }
  };

  const s = api.data?.summary;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Informasi Cuti (Saldo Karyawan)", "Leave Information (Employee Balances)")}
        description={t("Saldo per karyawan × jenis — formula (a+b+c) − (d+e+f+g): carry-over, earned prorata, penyesuaian, hangus, diuangkan, terpakai", "Balance per employee × type — formula (a+b+c) − (d+e+f+g): carry-over, prorated earned, adjustment, forfeited, cashed out, taken")}
        actions={
          <Button onClick={() => { setGenForm({ year: String(year), leaveTypeId: "all" }); setGenDialog(true); }} className="gap-2 font-bold">
            <Sparkles className="h-4 w-4" /> {t("Generate Informasi Cuti", "Generate Leave Information")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: t("Baris Saldo", "Balance Rows"), value: s ? String(s.rows) : "—", sub: s ? t("{n} karyawan", "{n} employees", { n: s.employees }) : undefined, icon: Palmtree, tone: "text-orange-600" },
          { label: t("Total Saldo Tersisa", "Total Remaining Balance"), value: s ? t("{n} hari", "{n} days", { n: s.totalRemaining }) : "—", sub: t("akumulasi semua jenis", "accumulated across all types"), icon: ArrowUpDown, tone: "text-brand" },
          { label: t("Total Terpakai", "Total Taken"), value: s ? t("{n} hari", "{n} days", { n: s.totalTaken }) : "—", sub: t("cuti disetujui/massal", "approved/mass leave"), icon: Palmtree, tone: "text-amber-600" },
          { label: t("Saldo Minus (Advance)", "Negative Balance (Advance)"), value: s ? String(s.negative) : "—", sub: t("karyawan saldo minus", "employees with negative balance"), icon: Minus, tone: "text-rose-600" },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2"><Icon className={cn("h-4 w-4", k.tone)} /><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p></div>
              <p className="text-lg font-extrabold text-slate-800 dark:text-slate-100">{k.value}</p>
              {k.sub && <p className="text-[11px] text-slate-400">{k.sub}</p>}
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="h-8 w-24 text-xs font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder={t("Semua jenis", "All types")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("Semua jenis", "All types")}</SelectItem>
                  {(typesApi.data?.types ?? []).map((ty) => <SelectItem key={ty.id} value={ty.code}>{ty.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari karyawan…", "Search employees…")} className="h-8 w-52 pl-8 text-xs" />
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={8} /></div> : balances.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada saldo", "No balances yet")} description={t("Jalankan Generate Leave Information untuk tahun ini.", "Run Generate Leave Information for this year.")} icon={<Palmtree className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    {sort.head("employee", t("Karyawan"), "text-[11px] font-bold")}
                    {sort.head("type", t("Jenis Cuti", "Leave Type"), "text-[11px] font-bold")}
                    {sort.head("period", t("Periode"), "text-[11px] font-bold")}
                    {sort.head("carried", t("a · Bawa", "a · Carry"), "text-right text-[11px] font-bold")}
                    {sort.head("earned", t("b · Didapat", "b · Earned"), "text-right text-[11px] font-bold")}
                    {sort.head("adjustment", t("c · Penyesuaian", "c · Adj"), "text-right text-[11px] font-bold")}
                    {sort.head("forfeited", t("d · Hangus", "d · Forfeit"), "text-right text-[11px] font-bold")}
                    {sort.head("cashed", t("e · Diuangkan", "e · Cash"), "text-right text-[11px] font-bold")}
                    {sort.head("taken", t("f · Terpakai", "f · Taken"), "text-right text-[11px] font-bold")}
                    {sort.head("applied", t("g · Akan", "g · Upcoming"), "text-right text-[11px] font-bold")}
                    {sort.head("remaining", t("Saldo", "Balance"), "text-right text-[11px] font-bold")}
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((b) => (
                    <TableRow key={b.balanceId ?? b.employeeId + b.leaveTypeId} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{b.employeeNo}</p>
                        <p className="text-[10px] text-slate-400">{b.fullName} · {b.orgUnitName ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{b.leaveTypeName}</p>
                        <p className="font-mono text-[9px] text-slate-400">{b.leaveTypeCode}{!b.paid && t(" · tidak dibayar", " · unpaid")}</p>
                      </TableCell>
                      <TableCell className="font-mono text-[10px] text-slate-400">{loc(b.periodLabel)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">{fmtDay(b.carriedOver)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">{fmtDay(b.earned)}</TableCell>
                      <TableCell className={cn("text-right text-xs tabular-nums", b.adjustment !== 0 ? "font-bold text-amber-600" : "text-slate-500")}>{fmtDay(b.adjustment)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-400">{fmtDay(b.forfeited)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-brand">{fmtDay(b.cashed)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">{fmtDay(b.taken)}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums text-slate-500">{fmtDay(b.applied)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-extrabold tabular-nums", b.remaining < 0 ? "text-rose-600" : "ov-text-accent")}>
                        {fmtDay(b.remaining)} {b.unit === "MONTH" ? t("bln", "mo") : t("hr", "d")}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setAdjTarget(b); setAdjForm({ delta: "1", reason: "" }); }} title={t("Penyesuaian saldo", "Adjust balance")}>
                          <Plus className="h-3.5 w-3.5 text-slate-500" />
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
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 ov-text-accent" /> {t("Generate Informasi Cuti", "Generate Leave Information")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t("Membuat baris saldo per karyawan × jenis untuk tahun tertentu. Carry-over dihitung dari saldo sisa tahun sebelumnya (maksimum sesuai jenis, hangus 31 Des). Padanan", "Creates balance rows per employee × leave type for a given year. Carry-over is computed from the previous year's remaining balance (max per type, forfeited Dec 31). Equivalent of")}
              <i> GenerateLeaveInfoProcess.jsp</i>.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Tahun *", "Year *")}</Label>
                <Select value={genForm.year} onValueChange={(v) => setGenForm({ ...genForm, year: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{YEAR_OPTIONS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Jenis Cuti", "Leave Type")}</Label>
                <Select value={genForm.leaveTypeId} onValueChange={(v) => setGenForm({ ...genForm, leaveTypeId: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("Semua jenis aktif", "All active types")}</SelectItem>
                    {(typesApi.data?.types ?? []).map((ty) => <SelectItem key={ty.id} value={ty.id}>{ty.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenDialog(false)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={generate} disabled={busy} className="text-xs font-bold">{t("Generate", "Generate")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjTarget} onOpenChange={(v) => !v && setAdjTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4 text-amber-600" /> {t("Penyesuaian Saldo", "Balance Adjustment")}
            </DialogTitle>
          </DialogHeader>
          {adjTarget && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900/60">
                <p className="font-bold text-slate-800 dark:text-slate-100">{adjTarget.employeeNo} — {adjTarget.fullName}</p>
                <p className="text-slate-500">{adjTarget.leaveTypeName} · {adjTarget.year} · {t("saldo sekarang {n} hari", "current balance {n} days", { n: fmtDay(adjTarget.remaining) })}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Penyesuaian (± hari) *", "Adjustment (± days) *")}</Label>
                  <Input type="number" value={adjForm.delta} onChange={(e) => setAdjForm({ ...adjForm, delta: e.target.value })} placeholder={t("mis. 2 atau -1", "e.g. 2 or -1")} className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold">{t("Alasan *", "Reason *")}</Label>
                  <Input value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder={t("mis. kompensasi lembur libur", "e.g. holiday overtime compensation")} className="h-8 text-xs" />
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                {t("Padanan", "Equivalent of")} <i>Leave Adjustment</i>{t(" — kolom (c) pada formula saldo.", " — column (c) of the balance formula.")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjTarget(null)} className="text-xs font-bold">{t("Batal")}</Button>
            <Button onClick={adjust} disabled={busy} className="bg-amber-600 text-xs font-bold hover:bg-amber-700">{t("Terapkan")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
