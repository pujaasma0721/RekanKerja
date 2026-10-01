"use client";
// RekanKerja Payroll — Proses & Hasil: daftar run (period × processType), buat run,
// hitung, konfirmasi, tandai dibayar, export CSV
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
import { PlayCircle, Plus, Calculator, CheckCircle2, Wallet, Trash2, Play, ChevronRight, Receipt, Gift, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { BonusMassalDialog } from "@/rekankerja/payroll/components/bonus-massal-dialog";
import { PeriodRow, ProcessTypeRow, RunRow } from "@/rekankerja/payroll/components/payroll-types";
import { BankExportMenu } from "@/rekankerja/payroll/components/bank-export-menu";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";

export function PayrollRunsPage() {
  const { navigate, params } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [periodFilter, setPeriodFilter] = useState(params.period ?? "all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Task 75 — sorting SERVER-SIDE (pola Task 74): sortBy/sortDir dikirim ke API.
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (k: string) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const url = `/api/rekankerja/payroll-runs${periodFilter !== "all" || statusFilter !== "all" || sortKey ? `?${new URLSearchParams({ ...(periodFilter !== "all" ? { periodId: periodFilter } : {}), ...(statusFilter !== "all" ? { status: statusFilter } : {}), ...(sortKey ? { sortBy: sortKey, sortDir } : {}) }).toString()}` : ""}`;
  const { data, loading, refresh } = useApi<{ runs: RunRow[] }>(url, [periodFilter, statusFilter, sortKey, sortDir]);
  const periodsApi = useApi<{ periods: PeriodRow[] }>("/api/rekankerja/payroll-periods");

  const act = async (run: RunRow, action: "calculate" | "confirm" | "markPaid" | "cancel") => {
    const labels: Record<string, string> = {
      calculate: "Menghitung payroll…", confirm: "Mengonfirmasi run…", markPaid: "Menandai dibayar…", cancel: "Membatalkan run…",
    };
    const confirmMsgs: Record<string, string> = {
      confirm: t("Konfirmasi run {no}? Hasil akan dikunci & angsuran pinjaman akan dipotong.", "Confirm run {no}? Results will be locked & loan installments will be deducted.", { no: run.runNo }),
      markPaid: t("Tandai {no} sebagai DIBAYAR?", "Mark {no} as PAID?", { no: run.runNo }),
      cancel: t("Batalkan run {no}? Data hasil akan dihapus.", "Cancel run {no}? Result data will be deleted.", { no: run.runNo }),
    };
    if (confirmMsgs[action] && !window.confirm(confirmMsgs[action])) return;
    setBusyId(run.id);
    try {
      const res = await apiSend<{ summary?: { employees: number; totalNet: number } }>("/api/rekankerja/payroll-runs", "PATCH", { id: run.id, action });
      if (action === "calculate" && res?.summary) {
        toast.success(t("Hitung selesai — {n} karyawan, THP {v}", "Calculation completed — {n} employees, net pay {v}", { n: res.summary.employees, v: fmtIDR(res.summary.totalNet) }));
      } else {
        const verb = action === "confirm" ? t("dikonfirmasi", "confirmed") : action === "markPaid" ? t("ditandai dibayar", "marked as paid") : t("dibatalkan", "cancelled");
        toast.success(t("Run {no} {v}", "Run {no} {v}", { no: run.runNo, v: verb }));
      }
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusyId(null); }
  };

  const runs = data?.runs ?? [];
  const sortedRows = runs;

  // Header sort memakai state server-side (Task 75) — ikon ↑/↓/↕ konsisten
  const sortHead = (k: string, label: React.ReactNode, className?: string) => (
    <TableHead className={className}>
      <button type="button" onClick={() => toggleSort(k)} title="Klik untuk urutkan"
        className="inline-flex items-center gap-1 whitespace-nowrap transition hover:opacity-70">
        {label}
        {sortKey === k ? (
          sortDir === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />
        ) : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-35" />}
      </button>
    </TableHead>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Proses & Hasil Payroll", "Payroll Runs & Results")}
        description={t("Satu period dapat diproses berkali-kali (gaji, THR, bonus) — tiap run menyimpan snapshot hasil per karyawan", "One period can be processed multiple times (salary, THR, bonus) — each run stores a per-employee result snapshot")}
        actions={
          <div className="flex flex-wrap gap-2">
            {perms.canOp("payroll", "runs", "calculate") && (
              <Button variant="outline" onClick={() => setBonusOpen(true)} className="gap-2 font-bold">
                <Gift className="h-4 w-4" /> {t("Bonus / THR Massal", "Bulk Bonus / THR")}
              </Button>
            )}
            {perms.can("payroll", "runs", "create") && (
              <Button onClick={() => setOpen(true)} className="gap-2 font-bold">
                <Plus className="h-4 w-4" /> {t("Proses Payroll Baru", "New Payroll Run")}
              </Button>
            )}
          </div>
        }
      />

      {/* filter bar */}
      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5">
          <Select value={periodFilter} onValueChange={setPeriodFilter}>
            <SelectTrigger className="h-9 w-[190px] text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua Period", "All Periods")}</SelectItem>
              {(periodsApi.data?.periods ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[160px] text-xs font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
              <SelectItem value="Draft">{t("Draft")}</SelectItem>
              <SelectItem value="Calculated">{t("Terhitung", "Calculated")}</SelectItem>
              <SelectItem value="Confirmed">{t("Dikonfirmasi", "Confirmed")}</SelectItem>
              <SelectItem value="Paid">{t("Dibayar", "Paid")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-[11px] font-bold text-slate-400">{t("{n} run", "{n} runs", { n: runs.length })}</span>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : runs.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Belum ada proses payroll", "No payroll runs yet")} description={t("Mulai proses payroll: pilih period & jenis proses (gaji bulanan, THR, bonus).", "Start a payroll run: pick a period & process type (monthly salary, THR, bonus).")} icon={<PlayCircle className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sortHead("runNo", t("Run"), "text-[11px] font-bold")}
                    {sortHead("period", t("Period"), "text-[11px] font-bold")}
                    {sortHead("type", t("Jenis Proses", "Process Type"), "text-[11px] font-bold")}
                    {sortHead("status", t("Status"), "text-[11px] font-bold")}
                    {sortHead("employees", t("Karyawan"), "text-center text-[11px] font-bold")}
                    {sortHead("bruto", t("Bruto", "Gross"), "text-right text-[11px] font-bold")}
                    {sortHead("tax", t("PPh21"), "text-right text-[11px] font-bold")}
                    {sortHead("net", t("THP", "Net Pay"), "text-right text-[11px] font-bold")}
                    <TableHead className="w-[290px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => navigate("payroll", "run", { id: r.id })}>
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-500">{r.runNo}</p>
                        <p className="text-[10px] text-slate-400">{r.calculatedAt ? fmtDateTime(r.calculatedAt) : "—"}</p>
                      </TableCell>
                      <TableCell className="text-[13px] font-semibold">{loc(r.period.name)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold">{r.processType.name}</span>
                          {!r.calculateTax && <Badge variant="outline" className="text-[9px]">{t("tanpa pajak", "no tax")}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={r.status} /></TableCell>
                      <TableCell className="text-center text-xs font-semibold">{r.employeeCount || "—"}</TableCell>
                      <TableCell className="text-right text-xs">{r.status === "Draft" ? "—" : fmtIDR(r.totalBruto)}</TableCell>
                      <TableCell className="text-right text-xs text-brand-deep dark:text-brand/85">{r.status === "Draft" ? "—" : fmtIDR(r.totalTax)}</TableCell>
                      <TableCell className="text-right text-xs font-bold ov-text-accent">{r.status === "Draft" ? "—" : fmtIDR(r.totalNet)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {(r.status === "Draft" || r.status === "Calculated") && perms.canOp("payroll", "runs", "calculate") && (
                            <RunActionButton icon={Calculator} label={busyId === r.id ? "…" : t("Hitung", "Calculate")} tone="sky" disabled={busyId === r.id} onClick={() => act(r, "calculate")} />
                          )}
                          {r.status === "Calculated" && perms.canOp("payroll", "runs", "confirm") && (
                            <RunActionButton icon={CheckCircle2} label={t("Konfirmasi")} tone="emerald" disabled={busyId === r.id} onClick={() => act(r, "confirm")} />
                          )}
                          {r.status === "Confirmed" && (
                            <>
                              {perms.canOp("payroll", "runs", "markPaid") && (
                                <RunActionButton icon={Wallet} label={t("Dibayar", "Paid")} tone="teal" disabled={busyId === r.id} onClick={() => act(r, "markPaid")} />
                              )}
                              {perms.canOp("payroll", "runs", "export") && (
                                <BankExportMenu runId={r.id} runNo={r.runNo} compact />
                              )}
                            </>
                          )}
                          {(r.status === "Draft" || r.status === "Calculated") && perms.canOp("payroll", "runs", "cancel") && (
                            <RunActionButton icon={Trash2} label="" tone="rose" disabled={busyId === r.id} onClick={() => act(r, "cancel")} />
                          )}
                          <RunActionButton icon={ChevronRight} label="" tone="stone" disabled={false} onClick={() => navigate("payroll", "run", { id: r.id })} />
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

      <NewRunDialog open={open} periods={periodsApi.data?.periods ?? []} onClose={() => { setOpen(false); refresh(); }} />
      <BonusMassalDialog open={bonusOpen} onOpenChange={setBonusOpen} onCommitted={() => refresh()} />
    </div>
  );
}

function RunActionButton({ icon: Icon, label, tone, disabled, onClick }: { icon: React.ElementType; label: string; tone: string; disabled: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const tones: Record<string, string> = {
    sky: "border-brand/40 text-brand-deep hover:bg-brand/10 dark:border-brand/40 dark:text-brand/85 dark:hover:bg-brand/10",
    emerald: "border-brand/40 text-brand-deep hover:bg-brand/10 dark:border-brand/40 dark:text-brand/85 dark:hover:bg-brand/10",
    teal: "border-brand/40 text-brand-deep hover:bg-brand/10 dark:border-brand/40 dark:text-brand/85 dark:hover:bg-brand/10",
    rose: "border-rose-200 text-rose-500 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10",
    stone: "border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn("inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] font-bold transition disabled:opacity-50", tones[tone])}
      aria-label={label || t("buka", "open")}
    >
      <Icon className="h-3 w-3" />{label}
    </button>
  );
}

function NewRunDialog({ open, periods, onClose }: { open: boolean; periods: PeriodRow[]; onClose: () => void }) {
  const { t } = useI18n();
  const typesApi = useApi<{ processTypes: ProcessTypeRow[] }>(open ? "/api/rekankerja/process-types" : null);
  const [periodId, setPeriodId] = useState("");
  const [processTypeId, setProcessTypeId] = useState("");
  const [calculateTax, setCalculateTax] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const openPeriods = periods.filter((p) => p.status === "Open");
  const defaultPeriod = openPeriods[0]?.id ?? periods[0]?.id ?? "";

  const submit = async () => {
    const pid = periodId || defaultPeriod;
    if (!pid || !processTypeId) { toast.error(t("Pilih period & jenis proses", "Select a period & process type")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ run: RunRow }>("/api/rekankerja/payroll-runs", "POST", { periodId: pid, processTypeId, calculateTax, notes: notes || null });
      toast.success(t('Run {no} dibuat (Draft) — klik "Hitung" untuk memproses', 'Run {no} created (Draft) — click "Calculate" to process', { no: res.run.runNo }));
      setProcessTypeId(""); setNotes(""); setPeriodId("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Play className="h-4 w-4 ov-text-accent" /> {t("Proses Payroll Baru", "New Payroll Run")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("Period Payroll *", "Payroll Period *")}</Label>
            <Select value={periodId || defaultPeriod} onValueChange={setPeriodId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih period", "Select period")} /></SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id} disabled={p.status === "Closed" || p.status === "Locked"}>
                    {p.name} {p.status !== "Open" && `(${p.status})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Jenis Proses *", "Process Type *")}</Label>
            <Select value={processTypeId} onValueChange={setProcessTypeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("cth: Gaji Bulanan", "e.g. Monthly Salary")} /></SelectTrigger>
              <SelectContent>
                {(typesApi.data?.processTypes ?? []).map((pt) => (
                  <SelectItem key={pt.id} value={pt.id}>
                    {pt.name} {pt.calculateTax ? <Receipt className="ml-1 inline h-3 w-3 text-brand" /> : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold">{t("Hitung PPh21", "Calculate PPh21")}</p>
              <p className="text-[10px] text-slate-400">{t("Kalkulasi pajak progresif + BPJS saat proses", "Progressive tax + BPJS calculation during the run")}</p>
            </div>
            <Switch checked={calculateTax} onCheckedChange={setCalculateTax} />
          </div>
          <div>
            <Label className="text-xs">{t("Catatan")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("opsional", "optional")} className="mt-1.5" />
          </div>
          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
            {t("Run", "A")} <b>{t("Gaji Bulanan", "Monthly Salary")}</b> {t("memproses payroll penuh (template + pinjaman + komponen periodik). Jenis lain (THR/Bonus/Benefit/Rapel) bersifat ", "run processes full payroll (template + loans + periodic components). Other types (THR/Bonus/Benefit/Retro Pay) are ")}
            <b>{t("suplemental", "supplemental")}</b>: {t("hanya komponen khusus yang didaftarkan untuk period & jenis proses ini yang dibayarkan — tidak mengulang gaji bulanan. Run ", "only special components registered for this period & process type are paid — monthly salary is not repeated. A ")}
            <b>{t("Benefit")}</b> {t("membayar klaim benefit yang dijadwalkan pada period terpilih.", "run pays benefit claims scheduled on the selected period.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Membuat…", "Creating…") : t("Buat Run", "Create Run")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
