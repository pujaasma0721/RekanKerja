"use client";
// RekanKerja Payroll — Transaksi: pinjaman karyawan (skedul cicilan) + komponen
// khusus/periodik + rapel/back-pay retroaktif lintas period (P4).
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeftRight, Plus, Trash2, Landmark, Coins, ChevronDown, ChevronUp, History, PlayCircle, Calculator, CheckCircle2, XCircle } from "lucide-react";
import { LoanRow, CompAssignmentRow, WageCompFull, PeriodRow, ProcessTypeRow, RapelBreakdownRow } from "@/rekankerja/payroll/components/payroll-types";
import { cn } from "@/lib/utils";
import { useI18n, loc } from "@/rekankerja/shared/lib/i18n";

export function PayrollTransactionsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("loans");
  const [loanDialog, setLoanDialog] = useState(false);
  const [compDialog, setCompDialog] = useState(false);
  const [rapelDialog, setRapelDialog] = useState(false);

  const loansApi = useApi<{ loans: LoanRow[] }>("/api/rekankerja/loans");
  const compsApi = useApi<{ assignments: CompAssignmentRow[] }>("/api/rekankerja/component-assignments");

  // Task 72 — sorting kolom tabel transaksi komponen
  const compSort = useTableSort(compsApi.data?.assignments, {
    employee: (a) => a.employee.fullName,
    component: (a) => a.wageComponent.name,
    kind: (a) => a.kind,
    basedDate: (a) => a.basedDate,
    amount: (a) => a.amount,
  }, { defaultKey: "employee", defaultDir: "asc" });

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL PAYROLL", "PAYROLL MODULE")}
        title={t("Transaksi Payroll", "Payroll Transactions")}
        description={t("Pinjaman karyawan dengan skedul cicilan otomatis, komponen khusus/periodik, serta rapel (back-pay) retroaktif lintas period", "Employee loans with automatic installment schedules, special/periodic components, and cross-period retroactive retro pay (back-pay)")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRapelDialog(true)} className="gap-2 font-bold"><History className="h-4 w-4 text-brand" /> {t("Rapel Baru", "New Retro Pay")}</Button>
            <Button variant="outline" onClick={() => setCompDialog(true)} className="gap-2 font-bold"><Coins className="h-4 w-4 text-brand" /> {t("Komponen Baru", "New Component")}</Button>
            <Button onClick={() => setLoanDialog(true)} className="gap-2 font-bold"><Plus className="h-4 w-4" /> {t("Pinjaman Baru", "New Loan")}</Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
          <TabsTrigger value="loans" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800">
            <Landmark className="h-3.5 w-3.5" /> {t("Pinjaman", "Loans")} ({loansApi.data?.loans.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="components" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800">
            <Coins className="h-3.5 w-3.5" /> {t("Komponen Khusus & Periodik", "Special & Periodic Components")} ({compsApi.data?.assignments.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="rapel" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800">
            <History className="h-3.5 w-3.5" /> {t("Rapel / Back-Pay", "Retro Pay / Back-Pay")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="loans">
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              {loansApi.loading && !loansApi.data ? (
                <div className="p-4"><LoadingRows rows={4} /></div>
              ) : (loansApi.data?.loans.length ?? 0) === 0 ? (
                <div className="p-5"><EmptyState title={t("Belum ada pinjaman", "No loans yet")} description={t("Ajukan pinjaman karyawan — cicilan otomatis dipotong payroll.", "Submit an employee loan — installments are automatically deducted from payroll.")} icon={<Landmark className="h-6 w-6" />} /></div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(loansApi.data?.loans ?? []).map((l) => <LoanCard key={l.id} loan={l} onChanged={loansApi.refresh} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components">
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-0">
              {compsApi.loading && !compsApi.data ? (
                <div className="p-4"><LoadingRows rows={4} /></div>
              ) : (compsApi.data?.assignments.length ?? 0) === 0 ? (
                <div className="p-5"><EmptyState title={t("Belum ada komponen transaksi", "No transaction components yet")} description={t("Tambahkan bonus spesifik period ini atau komponen periodik (mis. transport khusus).", "Add a bonus specific to this period or a periodic component (e.g. special transport).")} icon={<Coins className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        {compSort.head("employee", t("Karyawan"), "text-[11px] font-bold")}
                        {compSort.head("component", t("Komponen"), "text-[11px] font-bold")}
                        {compSort.head("kind", t("Jenis"), "text-[11px] font-bold")}
                        {compSort.head("basedDate", t("Berlaku", "Effective"), "text-[11px] font-bold")}
                        {compSort.head("amount", t("Nilai", "Value"), "text-right text-[11px] font-bold")}
                        <TableHead className="w-14" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compSort.sorted.map((a) => (
                        <TableRow key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell>
                            <p className="text-[13px] font-bold">{a.employee.fullName}</p>
                            <p className="font-mono text-[10px] text-slate-400">{a.employee.employeeNo}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-[13px] font-semibold">{a.wageComponent.name}</p>
                            <p className="font-mono text-[10px] text-slate-400">{a.wageComponent.code}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] font-bold", a.kind === "Specific" ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85" : "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85")}>
                              {a.kind === "Specific" ? t("Khusus (sekali)", "Specific (one-time)") : t("Periodik (tiap period)", "Periodic (every period)")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">
                            {a.kind === "Specific" ? `${loc(a.period?.name) || "—"} · ${a.processType?.name ?? "—"}` : t("Seluruh period aktif", "All active periods")}
                            {a.notes && <p className="text-[10px] italic text-slate-400">{a.notes}</p>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(a.amount)}</TableCell>
                          <TableCell>
                            <button
                              onClick={async () => {
                                if (!window.confirm(t("Hapus komponen {comp} milik {emp}?", "Delete component {comp} belonging to {emp}?", { comp: a.wageComponent.name, emp: a.employee.fullName }))) return;
                                try {
                                  await apiSend(`/api/rekankerja/component-assignments?id=${a.id}`, "DELETE");
                                  toast.success(t("Komponen dihapus", "Component deleted"));
                                  compsApi.refresh();
                                } catch (e) { toast.error((e as Error).message); }
                              }}
                              className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                              aria-label={t("Hapus")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rapel">
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardContent className="p-5">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl ov-fill shadow-md">
                  <History className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">{t("Rapel / Back-Pay retroaktif", "Retroactive Retro Pay / Back-Pay")}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t("Nilai komponen naik di tengah tahun? Hitung selisih ", "Component value increased mid-year? Calculate the difference ")}
                    <b>{t("dari period s.d. period", "from period to period")}</b>
                    {t(" terhadap run gaji yang sudah dibayarkan, lalu bayarkan selisihnya sekali sebagai komponen Back Pay pada period target — pola ", " against already-paid salary runs, then pay the difference once as a Back Pay component on the target period — the ")}
                    <i>{t("Back Pay Process", "Back Pay Process")}</i>
                    {t(" (fromPeriod → wageCode back pay).", " (fromPeriod → back pay wageCode).")}
                  </p>
                </div>
                <Button onClick={() => setRapelDialog(true)} className="gap-2 bg-brand font-bold hover:bg-brand/70">
                  <PlayCircle className="h-4 w-4" /> {t("Hitung Rapel", "Calculate Retro Pay")}
                </Button>
              </div>
              <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="font-bold text-slate-700 dark:text-slate-300">{t("1 · Pilih rentang", "1 · Pick a range")}</p>
                  <p className="text-slate-500">{t("Karyawan + komponen (cth. gaji pokok) + nilai baru + dari–sampai period", "Employee + component (e.g. base salary) + new value + from–to period")}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="font-bold text-slate-700 dark:text-slate-300">{t("2 · Preview selisih", "2 · Preview the difference")}</p>
                  <p className="text-slate-500">{t("Per period: dibayar vs seharusnya → total selisih (harus > 0)", "Per period: paid vs expected → total difference (must be > 0)")}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="font-bold text-slate-700 dark:text-slate-300">{t("3 · Run rapel", "3 · Retro Pay run")}</p>
                  <p className="text-slate-500">{t("Komponen RAPEL dibuat di period target, run dihitung (pajak irreguler)", "RAPEL component created on the target period, run calculated (irregular tax)")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LoanDialog open={loanDialog} onClose={() => { setLoanDialog(false); loansApi.refresh(); }} />
      <CompAssignmentDialog open={compDialog} onClose={() => { setCompDialog(false); compsApi.refresh(); }} />
      <RapelDialog open={rapelDialog} onClose={() => { setRapelDialog(false); compsApi.refresh(); }} />
    </div>
  );
}

function LoanCard({ loan, onChanged }: { loan: LoanRow; onChanged: () => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  // pinjaman Submitted belum punya cicilan (dibuat saat disetujui penuh) — guard length
  const settled = loan.installments.filter((i) => i.status !== "Pending").length;
  const progress = loan.installments.length > 0 ? settled / loan.installments.length : 0;

  // keputusan approval berjenjang pengajuan (Task 25) — PATCH { id, action }
  const decide = async (action: "approve" | "reject") => {
    setBusy(true);
    try {
      const res = await apiSend<{ loan: { status: string }; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null; final?: boolean } }>(
        "/api/rekankerja/loans", "PATCH", { id: loan.id, action },
      );
      if (res.approval && res.approval.final !== true) {
        // jenjang menengah disetujui — pinjaman tetap Submitted menunggu jenjang berikutnya
        toast.success(t("Jenjang {l} disetujui — menunggu {a}", "Level {l} approved — waiting for {a}", { l: `${res.approval.currentLevel - 1}/${res.approval.totalLevels}`, a: res.approval.currentApprover ?? t("jenjang berikutnya", "the next level") }));
      } else if (action === "approve") {
        toast.success(t("{no} disetujui penuh — skedul {n}× cicilan dibuat, status Active", "{no} fully approved — schedule of {n} installments created, status Active", { no: loan.letterNo, n: loan.installmentCount }));
      } else {
        toast.success(t("{no} ditolak", "{no} rejected", { no: loan.letterNo }));
      }
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand/60 to-brand text-white shadow">
          <Landmark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold">{loan.letterNo} — {loan.employee.fullName}</p>
            <StatusPill status={
              loan.status === "Active" ? "Open" :
              loan.status === "PaidOff" ? "Paid" :
              loan.status === "Submitted" ? "Submitted" :
              loan.status === "Rejected" ? "Rejected" : "Cancelled"
            } />
            {loan.approval?.status === "InProgress" && (
              <span className="whitespace-nowrap rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
                {t("Jenjang {l}/{n}", "Level {l}/{n}", { l: loan.approval.currentLevel, n: loan.approval.totalLevels })}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {t("Pokok {p} · {n}× cicilan {i}", "Principal {p} · {n}× installments of {i}", { p: fmtIDR(loan.amount), n: loan.installmentCount, i: fmtIDR(loan.installmentAmount) })}{loan.interestRate > 0 ? t(" · bunga {r}%/thn flat", " · interest {r}%/yr flat", { r: loan.interestRate }) : t(" · tanpa bunga", " · interest-free")}
            {loan.purpose && ` · ${loan.purpose}`}
          </p>
          {loan.approval?.status === "InProgress" && (
            <p className="mt-0.5 text-[10px] font-semibold text-brand-deep dark:text-brand/85">
              {t("pengajuan menunggu {a}", "request awaiting {a}", { a: loan.approval.currentApprover ?? t("jenjang berikutnya", "the next level") })}
            </p>
          )}
          {loan.status !== "Submitted" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full ov-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="text-[10px] font-bold text-slate-400">{t("{n}% lunas", "{n}% settled", { n: Math.round(progress * 100) })}</span>
            </div>
          )}
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Outstanding")}</p>
          <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(loan.outstanding)}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {expanded && loan.status === "Submitted" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/25 bg-brand/10 p-3 dark:border-brand/25 dark:bg-brand/5">
          <p className="min-w-40 flex-1 text-[11px] leading-relaxed text-brand-deep dark:text-brand/85">
            {t("Pengajuan menunggu persetujuan", "Request awaiting approval")}{loan.approval?.status === "InProgress" ? t(" berjenjang (jenjang {l}/{n})", " tiered (level {l}/{n})", { l: loan.approval.currentLevel, n: loan.approval.totalLevels }) : ""}{t(" — skedul cicilan dibuat otomatis setelah seluruh jenjang disetujui.", " — the installment schedule is created automatically after every level approves.")}
          </p>
          <Button size="sm" onClick={() => decide("approve")} disabled={busy} className="h-8 gap-1.5 bg-brand text-xs font-bold hover:bg-brand/70">
            <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide("reject")} disabled={busy} className="h-8 gap-1.5 border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
            <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
          </Button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          {loan.installments.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">
              {t("Cicilan belum dibuat — skedul dibuat otomatis setelah seluruh jenjang approval disetujui.", "Installments not created yet — the schedule is created automatically after all approval levels approve.")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead className="text-[10px] font-bold">{t("Cicilan", "Installment")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Jatuh Tempo", "Due Date")}</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">{t("Nilai", "Value")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Status")}</TableHead>
                  <TableHead className="text-[10px] font-bold">{t("Run")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.installments.map((i) => (
                  <TableRow key={i.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                    <TableCell className="text-xs font-bold">#{i.sequence}</TableCell>
                    <TableCell className="text-xs text-slate-500">{fmtDate(i.dueDate)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{fmtIDR(i.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[9px] font-bold",
                        i.status === "Deducted" ? "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85" :
                        i.status === "Skipped" ? "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-600" :
                        "border-brand/40 bg-brand/10 text-brand-deep dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85")}>
                        {i.status === "Deducted" ? t("Terpotong", "Deducted") : i.status === "Skipped" ? t("Dilewati", "Skipped") : t("Menunggu")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-slate-400">{i.deductedRunNo ?? (i.periodCode ?? "—")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}

function LoanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/rekankerja/payroll-profiles" : null);
  const [employeeId, setEmployeeId] = useState("");
  const [letterNo, setLetterNo] = useState("");
  const [amount, setAmount] = useState("");
  const [installmentCount, setInstallmentCount] = useState("12");
  const [interestRate, setInterestRate] = useState("0");
  const [purpose, setPurpose] = useState("");
  const [startPaymentDate, setStartPaymentDate] = useState("");
  const [busy, setBusy] = useState(false);

  const totalDue = Number(amount) * (1 + (Number(interestRate) / 100) * (Number(installmentCount) / 12));
  const per = Number(installmentCount) > 0 ? totalDue / Number(installmentCount) : 0;

  const submit = async () => {
    if (!employeeId || !letterNo.trim() || !amount || Number(amount) <= 0) { toast.error(t("Lengkapi karyawan, no surat & jumlah pinjaman", "Complete employee, letter no. & loan amount")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ loan: { letterNo: string }; approval?: { levels?: number; firstApprover?: string | null } }>("/api/rekankerja/loans", "POST", {
        employeeId, letterNo: letterNo.trim().toUpperCase(),
        amount: Number(amount), installmentCount: Number(installmentCount),
        interestRate: Number(interestRate) || 0,
        purpose: purpose.trim() || null,
        startPaymentDate: startPaymentDate || undefined,
      });
      toast.success(
        t("Pengajuan {no} tersimpan — menunggu approval {a}", "Request {no} saved — awaiting approval by {a}", { no: letterNo.trim().toUpperCase(), a: res.approval?.firstApprover ?? t("jenjang berikutnya", "the next level") }) +
        (res.approval?.levels && res.approval.levels > 1 ? t(" (jenjang 1/{n})", " (level 1/{n})", { n: res.approval.levels }) : ""),
      );
      setEmployeeId(""); setLetterNo(""); setAmount(""); setInstallmentCount("12"); setInterestRate("0"); setPurpose(""); setStartPaymentDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4 ov-text-accent" /> {t("Pinjaman Karyawan", "Employee Loan")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("Karyawan *")}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("No. Surat *", "Letter No. *")}</Label>
              <Input value={letterNo} onChange={(e) => setLetterNo(e.target.value)} placeholder="LTR-2026-004" className="mt-1.5 font-mono uppercase" />
            </div>
            <div>
              <Label className="text-xs">{t("Tanggal Mulai Bayar", "First Payment Date")}</Label>
              <Input type="date" value={startPaymentDate} onChange={(e) => setStartPaymentDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">{t("Jumlah Pinjaman (Rp) *", "Loan Amount (Rp) *")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">{t("Bunga %/thn", "Interest %/yr")}</Label>
              <Input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="mt-1.5 font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("Jumlah Cicilan", "Number of Installments")}</Label>
            <Input type="number" min={1} max={60} value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Keperluan", "Purpose")}</Label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("cth: renovasi rumah", "e.g. house renovation")} className="mt-1.5" />
          </div>
          {Number(amount) > 0 && (
            <p className="ov-soft rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold">
              {t("Total tagihan {td} · cicilan ± {per}/bulan (bunga flat)", "Total due {td} · installment ± {per}/month (flat interest)", { td: fmtIDR(totalDue), per: fmtIDR(per) })}
            </p>
          )}
          <p className="rounded-xl bg-brand/10 px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold text-brand-deep dark:bg-brand/10 dark:text-brand/85">
            {t("Pinjaman diajukan berstatus Menunggu — skedul cicilan dibuat otomatis setelah seluruh jenjang approval disetujui, lalu terpotong payroll saat run dikonfirmasi.", "Loans are submitted as Pending — the installment schedule is created automatically after all approval levels approve, then deducted from payroll when the run is confirmed.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Buat Pinjaman", "Create Loan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompAssignmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/rekankerja/payroll-profiles" : null);
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/rekankerja/wage-components" : null);
  const periodsApi = useApi<{ periods: PeriodRow[] }>(open ? "/api/rekankerja/payroll-periods" : null);
  const typesApi = useApi<{ processTypes: ProcessTypeRow[] }>(open ? "/api/rekankerja/process-types" : null);

  const [employeeId, setEmployeeId] = useState("");
  const [wageComponentId, setWageComponentId] = useState("");
  const [kind, setKind] = useState("Specific");
  const [amount, setAmount] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [processTypeId, setProcessTypeId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!employeeId || !wageComponentId || !amount) { toast.error(t("Lengkapi karyawan, komponen & nilai", "Complete employee, component & amount")); return; }
    if (kind === "Specific" && (!periodId || !processTypeId)) { toast.error(t("Komponen khusus perlu period & jenis proses", "Specific components need a period & process type")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/component-assignments", "POST", {
        employeeId, wageComponentId, kind, amount: Number(amount),
        periodId: kind === "Specific" ? periodId : null,
        processTypeId: kind === "Specific" ? processTypeId : null,
        notes: notes.trim() || null,
      });
      toast.success(kind === "Specific" ? t("Komponen khusus ditambahkan", "Special component added") : t("Komponen periodik ditambahkan", "Periodic component added"));
      setEmployeeId(""); setWageComponentId(""); setAmount(""); setPeriodId(""); setProcessTypeId(""); setNotes("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-brand" /> {t("Komponen Upah Karyawan", "Employee Wage Component")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">{t("Karyawan *")}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Komponen Upah *", "Wage Component *")}</Label>
            <Select value={wageComponentId} onValueChange={setWageComponentId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("cth: Bonus Kinerja", "e.g. Performance Bonus")} /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(compsApi.data?.components ?? []).filter((c) => c.type === "Earning" || c.type === "Deduction").map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Jenis")}</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Specific">{t("Khusus (sekali, period ini)", "Specific (one-time, this period)")}</SelectItem>
                  <SelectItem value="Periodic">{t("Periodik (tiap period)", "Periodic (every period)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("Nilai (Rp) *", "Amount (Rp) *")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500000" className="mt-1.5 font-mono" />
            </div>
          </div>
          {kind === "Specific" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("Period *")}</Label>
                <Select value={periodId} onValueChange={setPeriodId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("pilih", "select")} /></SelectTrigger>
                  <SelectContent>
                    {(periodsApi.data?.periods ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("Jenis Proses *", "Process Type *")}</Label>
                <Select value={processTypeId} onValueChange={setProcessTypeId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("pilih", "select")} /></SelectTrigger>
                  <SelectContent>
                    {(typesApi.data?.processTypes ?? []).map((pt) => (
                      <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Catatan")}</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("cth: Bonus kinerja Q3", "e.g. Q3 performance bonus")} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Tambah")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RapelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string; baseSalary: number }[] }>(open ? "/api/rekankerja/payroll-profiles" : null);
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/rekankerja/wage-components" : null);
  const periodsApi = useApi<{ periods: PeriodRow[] }>(open ? "/api/rekankerja/payroll-periods" : null);

  const [employeeId, setEmployeeId] = useState("");
  const [componentCode, setComponentCode] = useState("BASIC");
  const [newAmount, setNewAmount] = useState("");
  const [fromPeriodId, setFromPeriodId] = useState("");
  const [toPeriodId, setToPeriodId] = useState("");
  const [targetPeriodId, setTargetPeriodId] = useState("");
  const [preview, setPreview] = useState<{ breakdown: RapelBreakdownRow[]; totalDiff: number; periods: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const periods = periodsApi.data?.periods ?? [];
  const processedPeriods = periods.filter((p) => p.status === "Processed" || p.status === "Closed" || p.status === "Locked");
  const openPeriods = periods.filter((p) => p.status === "Open");
  const emp = (employeesApi.data?.employees ?? []).find((e) => e.employeeId === employeeId);

  const doPreview = async () => {
    if (!employeeId || !componentCode || !newAmount || !fromPeriodId || !toPeriodId || !targetPeriodId) {
      toast.error(t("Lengkapi seluruh pilihan rapel", "Complete all retro pay selections")); return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{
        breakdown: RapelBreakdownRow[]; totalDiff: number; periods: number;
      }>("/api/rekankerja/payroll-rapel", "POST", {
        employeeId, componentCode, newAmount: Number(newAmount),
        fromPeriodId, toPeriodId, targetPeriodId, preview: true,
      });
      setPreview(res);
    } catch (e) {
      toast.error((e as Error).message);
      setPreview(null);
    } finally { setBusy(false); }
  };

  const doCreate = async () => {
    setSaving(true);
    try {
      const res = await apiSend<{ run: { id: string; runNo: string; totalNet: number } | null; totalDiff: number; periods: number }>("/api/rekankerja/payroll-rapel", "POST", {
        employeeId, componentCode, newAmount: Number(newAmount),
        fromPeriodId, toPeriodId, targetPeriodId, autoRun: true,
      });
      toast.success(
        res.run
          ? t("Run rapel {no} dibuat & dihitung — selisih {v} ({n} period)", "Retro pay run {no} created & calculated — difference {v} ({n} periods)", { no: res.run.runNo, v: fmtIDR(res.totalDiff), n: res.periods })
          : t("Komponen rapel {v} dibuat di period target", "Retro pay component {v} created on the target period", { v: fmtIDR(res.totalDiff) })
      );
      setPreview(null); setEmployeeId(""); setNewAmount(""); setFromPeriodId(""); setToPeriodId(""); setTargetPeriodId("");
      onClose();
      if (res.run) navigate("payroll", "run", { id: res.run.id });
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setPreview(null); onClose(); } }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-brand" /> {t("Rapel / Back-Pay", "Retro Pay / Back-Pay")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Karyawan *")}</Label>
              <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("Pilih karyawan", "Select employee")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(employeesApi.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("Komponen yang naik *", "Component being increased *")}</Label>
              <Select value={componentCode} onValueChange={(v) => { setComponentCode(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(compsApi.data?.components ?? []).filter((c) => c.type === "Earning").map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">{t("Nilai Baru / Bulan (Rp) *", "New Value / Month (Rp) *")}</Label>
              <Input
                type="number" value={newAmount}
                onChange={(e) => { setNewAmount(e.target.value); setPreview(null); }}
                placeholder={emp ? String(emp.baseSalary) : t("cth: 6500000", "e.g. 6500000")}
                className="mt-1.5 font-mono"
              />
              {emp && <p className="mt-1 text-[10px] text-slate-400">{t("Nilai sekarang: {v}/bln", "Current value: {v}/mo", { v: fmtIDR(emp.baseSalary) })}</p>}
            </div>
            <div>
              <Label className="text-xs">{t("Dibayar di *", "Paid in *")}</Label>
              <Select value={targetPeriodId} onValueChange={(v) => { setTargetPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("period target", "target period")} /></SelectTrigger>
                <SelectContent>
                  {(openPeriods.length ? openPeriods : periods).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("Rapel Dari Period *", "Retro Pay From Period *")}</Label>
              <Select value={fromPeriodId} onValueChange={(v) => { setFromPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("period awal", "start period")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {processedPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("Sampai Period *", "To Period *")}</Label>
              <Select value={toPeriodId} onValueChange={(v) => { setToPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("period akhir", "end period")} /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {processedPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {preview && (
            <div className="overflow-hidden rounded-xl border border-brand/25 dark:border-brand/30">
              <div className="flex items-center justify-between bg-brand/10 px-3.5 py-2.5 dark:bg-brand/10">
                <p className="text-[11px] font-bold text-brand-deep dark:text-brand/85">
                  {t("Selisih rapel — {n} period · {c}", "Retro pay difference — {n} periods · {c}", { n: preview.periods, c: componentCode })}
                </p>
                <p className="text-sm font-extrabold text-brand-deep dark:text-brand/85">{fmtIDR(preview.totalDiff)}</p>
              </div>
              <div className="max-h-44 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                    <TableRow>
                      <TableHead className="text-[10px] font-bold">{t("Period")}</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">{t("Dibayar", "Paid")}</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">{t("Seharusnya", "Expected")}</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">{t("Selisih", "Difference")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.breakdown.map((b) => (
                      <TableRow key={b.periodCode}>
                        <TableCell className="text-[11px] font-semibold">{loc(b.periodName)}</TableCell>
                        <TableCell className="text-right text-[11px] text-slate-500">{fmtIDR(b.paid)}</TableCell>
                        <TableCell className="text-right text-[11px]">{fmtIDR(b.expected)}</TableCell>
                        <TableCell className="text-right text-[11px] font-bold ov-text-accent">+{fmtIDR(b.diff)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900">
            {t("Selisih dibayarkan sekali sebagai komponen", "The difference is paid once as a")} <b>{t("RAPEL (Back Pay)", "RAPEL (Back Pay)")}</b> {t("pada period target dengan pajak", "component on the target period with")} <b>{t("irreguler", "irregular")}</b> {t(". Prorata per period diabaikan — hanya period yang run gajinya sudah final yang dihitung.", " tax. Per-period prorating is ignored — only periods whose salary run is already final are counted.")}
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{t("Batal")}</Button>
          {!preview ? (
            <Button onClick={doPreview} disabled={busy} className="gap-2 bg-brand font-bold hover:bg-brand/70">
              <Calculator className="h-4 w-4" />{busy ? t("Menghitung…", "Calculating…") : t("Preview Selisih", "Preview Difference")}
            </Button>
          ) : (
            <Button onClick={doCreate} disabled={saving} className="gap-2 font-bold">
              <PlayCircle className="h-4 w-4" />{saving ? t("Membuat run…", "Creating run…") : t("Buat Run Rapel · {v}", "Create Retro Pay Run · {v}", { v: fmtIDR(preview.totalDiff) })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
