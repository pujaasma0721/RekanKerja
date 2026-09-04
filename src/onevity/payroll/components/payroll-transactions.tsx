"use client";
// OneVity Payroll — Transaksi: pinjaman karyawan (skedul cicilan) + komponen
// khusus/periodik + rapel/back-pay retroaktif lintas period (P4).
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
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
import { LoanRow, CompAssignmentRow, WageCompFull, PeriodRow, ProcessTypeRow, RapelBreakdownRow } from "@/onevity/payroll/components/payroll-types";
import { cn } from "@/lib/utils";

export function PayrollTransactionsPage() {
  const [tab, setTab] = useState("loans");
  const [loanDialog, setLoanDialog] = useState(false);
  const [compDialog, setCompDialog] = useState(false);
  const [rapelDialog, setRapelDialog] = useState(false);

  const loansApi = useApi<{ loans: LoanRow[] }>("/api/onevity/loans");
  const compsApi = useApi<{ assignments: CompAssignmentRow[] }>("/api/onevity/component-assignments");

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Transaksi Payroll"
        description="Pinjaman karyawan dengan skedul cicilan otomatis, komponen khusus/periodik, serta rapel (back-pay) retroaktif lintas period"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRapelDialog(true)} className="gap-2 font-bold"><History className="h-4 w-4 text-teal-600" /> Rapel Baru</Button>
            <Button variant="outline" onClick={() => setCompDialog(true)} className="gap-2 font-bold"><Coins className="h-4 w-4 text-amber-600" /> Komponen Baru</Button>
            <Button onClick={() => setLoanDialog(true)} className="gap-2 font-bold"><Plus className="h-4 w-4" /> Pinjaman Baru</Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="loans" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
            <Landmark className="h-3.5 w-3.5" /> Pinjaman ({loansApi.data?.loans.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="components" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
            <Coins className="h-3.5 w-3.5" /> Komponen Khusus & Periodik ({compsApi.data?.assignments.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="rapel" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800">
            <History className="h-3.5 w-3.5" /> Rapel / Back-Pay
          </TabsTrigger>
        </TabsList>

        <TabsContent value="loans">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              {loansApi.loading && !loansApi.data ? (
                <div className="p-4"><LoadingRows rows={4} /></div>
              ) : (loansApi.data?.loans.length ?? 0) === 0 ? (
                <div className="p-5"><EmptyState title="Belum ada pinjaman" description="Ajukan pinjaman karyawan — cicilan otomatis dipotong payroll." icon={<Landmark className="h-6 w-6" />} /></div>
              ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-800">
                  {(loansApi.data?.loans ?? []).map((l) => <LoanCard key={l.id} loan={l} onChanged={loansApi.refresh} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="components">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-0">
              {compsApi.loading && !compsApi.data ? (
                <div className="p-4"><LoadingRows rows={4} /></div>
              ) : (compsApi.data?.assignments.length ?? 0) === 0 ? (
                <div className="p-5"><EmptyState title="Belum ada komponen transaksi" description="Tambahkan bonus spesifik period ini atau komponen periodik (mis. transport khusus)." icon={<Coins className="h-6 w-6" />} /></div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                        <TableHead className="text-[11px] font-bold">Komponen</TableHead>
                        <TableHead className="text-[11px] font-bold">Jenis</TableHead>
                        <TableHead className="text-[11px] font-bold">Berlaku</TableHead>
                        <TableHead className="text-right text-[11px] font-bold">Nilai</TableHead>
                        <TableHead className="w-14" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(compsApi.data?.assignments ?? []).map((a) => (
                        <TableRow key={a.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                          <TableCell>
                            <p className="text-[13px] font-bold">{a.employee.fullName}</p>
                            <p className="font-mono text-[10px] text-stone-400">{a.employee.employeeNo}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-[13px] font-semibold">{a.wageComponent.name}</p>
                            <p className="font-mono text-[10px] text-stone-400">{a.wageComponent.code}</p>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[9px] font-bold", a.kind === "Specific" ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" : "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-400")}>
                              {a.kind === "Specific" ? "Khusus (sekali)" : "Periodik (tiap period)"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-stone-500">
                            {a.kind === "Specific" ? `${a.period?.name ?? "—"} · ${a.processType?.name ?? "—"}` : "Seluruh period aktif"}
                            {a.notes && <p className="text-[10px] italic text-stone-400">{a.notes}</p>}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold">{fmtIDR(a.amount)}</TableCell>
                          <TableCell>
                            <button
                              onClick={async () => {
                                if (!window.confirm(`Hapus komponen ${a.wageComponent.name} milik ${a.employee.fullName}?`)) return;
                                try {
                                  await apiSend(`/api/onevity/component-assignments?id=${a.id}`, "DELETE");
                                  toast.success("Komponen dihapus");
                                  compsApi.refresh();
                                } catch (e) { toast.error((e as Error).message); }
                              }}
                              className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                              aria-label="Hapus"
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
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-5">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl ov-fill shadow-md">
                  <History className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold">Rapel / Back-Pay retroaktif</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
                    Nilai komponen naik di tengah tahun? Hitung selisih <b>dari period s.d. period</b> terhadap run gaji yang
                    sudah dibayarkan, lalu bayarkan selisihnya sekali sebagai komponen Back Pay pada period target —
                    pola <i>Back Pay Process</i> (fromPeriod → wageCode back pay).
                  </p>
                </div>
                <Button onClick={() => setRapelDialog(true)} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                  <PlayCircle className="h-4 w-4" /> Hitung Rapel
                </Button>
              </div>
              <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-3">
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">1 · Pilih rentang</p>
                  <p className="text-stone-500">Karyawan + komponen (cth. gaji pokok) + nilai baru + dari–sampai period</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">2 · Preview selisih</p>
                  <p className="text-stone-500">Per period: dibayar vs seharusnya → total selisih (harus &gt; 0)</p>
                </div>
                <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-900">
                  <p className="font-bold text-stone-700 dark:text-stone-300">3 · Run rapel</p>
                  <p className="text-stone-500">Komponen RAPEL dibuat di period target, run dihitung (pajak irreguler)</p>
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
        "/api/onevity/loans", "PATCH", { id: loan.id, action },
      );
      if (res.approval && res.approval.final !== true) {
        // jenjang menengah disetujui — pinjaman tetap Submitted menunggu jenjang berikutnya
        toast.success(`Jenjang ${res.approval.currentLevel - 1}/${res.approval.totalLevels} disetujui — menunggu ${res.approval.currentApprover ?? "jenjang berikutnya"}`);
      } else if (action === "approve") {
        toast.success(`${loan.letterNo} disetujui penuh — skedul ${loan.installmentCount}× cicilan dibuat, status Active`);
      } else {
        toast.success(`${loan.letterNo} ditolak`);
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
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow">
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
              <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                Jenjang {loan.approval.currentLevel}/{loan.approval.totalLevels}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">
            Pokok {fmtIDR(loan.amount)} · {loan.installmentCount}× cicilan {fmtIDR(loan.installmentAmount)}{loan.interestRate > 0 ? ` · bunga ${loan.interestRate}%/thn flat` : " · tanpa bunga"}
            {loan.purpose && ` · ${loan.purpose}`}
          </p>
          {loan.approval?.status === "InProgress" && (
            <p className="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
              pengajuan menunggu {loan.approval.currentApprover ?? "jenjang berikutnya"}
            </p>
          )}
          {loan.status !== "Submitted" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                <div className="h-full rounded-full ov-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="text-[10px] font-bold text-stone-400">{Math.round(progress * 100)}% lunas</span>
            </div>
          )}
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Outstanding</p>
          <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(loan.outstanding)}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-stone-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" />}
      </button>

      {expanded && loan.status === "Submitted" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/25 dark:bg-amber-500/5">
          <p className="min-w-40 flex-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            Pengajuan menunggu persetujuan{loan.approval?.status === "InProgress" ? ` berjenjang (jenjang ${loan.approval.currentLevel}/${loan.approval.totalLevels})` : ""} — skedul cicilan dibuat otomatis setelah seluruh jenjang disetujui.
          </p>
          <Button size="sm" onClick={() => decide("approve")} disabled={busy} className="h-8 gap-1.5 bg-emerald-600 text-xs font-bold hover:bg-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Setujui
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide("reject")} disabled={busy} className="h-8 gap-1.5 border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
            <XCircle className="h-3.5 w-3.5" /> Tolak
          </Button>
        </div>
      )}

      {expanded && (
        <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
          {loan.installments.length === 0 ? (
            <p className="px-4 py-3 text-xs text-stone-500">
              Cicilan belum dibuat — skedul dibuat otomatis setelah seluruh jenjang approval disetujui.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                  <TableHead className="text-[10px] font-bold">Cicilan</TableHead>
                  <TableHead className="text-[10px] font-bold">Jatuh Tempo</TableHead>
                  <TableHead className="text-right text-[10px] font-bold">Nilai</TableHead>
                  <TableHead className="text-[10px] font-bold">Status</TableHead>
                  <TableHead className="text-[10px] font-bold">Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.installments.map((i) => (
                  <TableRow key={i.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                    <TableCell className="text-xs font-bold">#{i.sequence}</TableCell>
                    <TableCell className="text-xs text-stone-500">{fmtDate(i.dueDate)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{fmtIDR(i.amount)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[9px] font-bold",
                        i.status === "Deducted" ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400" :
                        i.status === "Skipped" ? "border-stone-300 bg-stone-50 text-stone-500 dark:border-stone-600" :
                        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400")}>
                        {i.status === "Deducted" ? "Terpotong" : i.status === "Skipped" ? "Dilewati" : "Menunggu"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-stone-400">{i.deductedRunNo ?? (i.periodCode ?? "—")}</TableCell>
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
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/onevity/payroll-profiles" : null);
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
    if (!employeeId || !letterNo.trim() || !amount || Number(amount) <= 0) { toast.error("Lengkapi karyawan, no surat & jumlah pinjaman"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ loan: { letterNo: string }; approval?: { levels?: number; firstApprover?: string | null } }>("/api/onevity/loans", "POST", {
        employeeId, letterNo: letterNo.trim().toUpperCase(),
        amount: Number(amount), installmentCount: Number(installmentCount),
        interestRate: Number(interestRate) || 0,
        purpose: purpose.trim() || null,
        startPaymentDate: startPaymentDate || undefined,
      });
      toast.success(
        `Pengajuan ${letterNo.trim().toUpperCase()} tersimpan — menunggu approval ${res.approval?.firstApprover ?? "jenjang berikutnya"}` +
        (res.approval?.levels && res.approval.levels > 1 ? ` (jenjang 1/${res.approval.levels})` : ""),
      );
      setEmployeeId(""); setLetterNo(""); setAmount(""); setInstallmentCount("12"); setInterestRate("0"); setPurpose(""); setStartPaymentDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4 ov-text-accent" /> Pinjaman Karyawan</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Karyawan *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">No. Surat *</Label>
              <Input value={letterNo} onChange={(e) => setLetterNo(e.target.value)} placeholder="LTR-2026-004" className="mt-1.5 font-mono uppercase" />
            </div>
            <div>
              <Label className="text-xs">Tanggal Mulai Bayar</Label>
              <Input type="date" value={startPaymentDate} onChange={(e) => setStartPaymentDate(e.target.value)} className="mt-1.5" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Jumlah Pinjaman (Rp) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000000" className="mt-1.5 font-mono" />
            </div>
            <div>
              <Label className="text-xs">Bunga %/thn</Label>
              <Input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="mt-1.5 font-mono" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Jumlah Cicilan</Label>
            <Input type="number" min={1} max={60} value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Keperluan</Label>
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="cth: renovasi rumah" className="mt-1.5" />
          </div>
          {Number(amount) > 0 && (
            <p className="ov-soft rounded-xl px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold">
              Total tagihan {fmtIDR(totalDue)} · cicilan ± {fmtIDR(per)}/bulan (bunga flat)
            </p>
          )}
          <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            Pinjaman diajukan berstatus Menunggu — skedul cicilan dibuat otomatis setelah seluruh jenjang approval disetujui, lalu terpotong payroll saat run dikonfirmasi.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? "Menyimpan…" : "Buat Pinjaman"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompAssignmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string }[] }>(open ? "/api/onevity/payroll-profiles" : null);
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/onevity/wage-components" : null);
  const periodsApi = useApi<{ periods: PeriodRow[] }>(open ? "/api/onevity/payroll-periods" : null);
  const typesApi = useApi<{ processTypes: ProcessTypeRow[] }>(open ? "/api/onevity/process-types" : null);

  const [employeeId, setEmployeeId] = useState("");
  const [wageComponentId, setWageComponentId] = useState("");
  const [kind, setKind] = useState("Specific");
  const [amount, setAmount] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [processTypeId, setProcessTypeId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!employeeId || !wageComponentId || !amount) { toast.error("Lengkapi karyawan, komponen & nilai"); return; }
    if (kind === "Specific" && (!periodId || !processTypeId)) { toast.error("Komponen khusus perlu period & jenis proses"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/component-assignments", "POST", {
        employeeId, wageComponentId, kind, amount: Number(amount),
        periodId: kind === "Specific" ? periodId : null,
        processTypeId: kind === "Specific" ? processTypeId : null,
        notes: notes.trim() || null,
      });
      toast.success(kind === "Specific" ? "Komponen khusus ditambahkan" : "Komponen periodik ditambahkan");
      setEmployeeId(""); setWageComponentId(""); setAmount(""); setPeriodId(""); setProcessTypeId(""); setNotes("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-amber-600" /> Komponen Upah Karyawan</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs">Karyawan *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(employeesApi.data?.employees ?? []).map((e) => (
                  <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Komponen Upah *</Label>
            <Select value={wageComponentId} onValueChange={setWageComponentId}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="cth: Bonus Kinerja" /></SelectTrigger>
              <SelectContent className="max-h-52">
                {(compsApi.data?.components ?? []).filter((c) => c.type === "Earning" || c.type === "Deduction").map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Jenis</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Specific">Khusus (sekali, period ini)</SelectItem>
                  <SelectItem value="Periodic">Periodik (tiap period)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Nilai (Rp) *</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2500000" className="mt-1.5 font-mono" />
            </div>
          </div>
          {kind === "Specific" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Period *</Label>
                <Select value={periodId} onValueChange={setPeriodId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="pilih" /></SelectTrigger>
                  <SelectContent>
                    {(periodsApi.data?.periods ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Jenis Proses *</Label>
                <Select value={processTypeId} onValueChange={setProcessTypeId}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="pilih" /></SelectTrigger>
                  <SelectContent>
                    {(typesApi.data?.processTypes ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs">Catatan</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="cth: Bonus kinerja Q3" className="mt-1.5" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? "Menyimpan…" : "Tambah"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RapelDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { navigate } = useNav();
  const employeesApi = useApi<{ employees: { employeeId: string; fullName: string; employeeNo: string; baseSalary: number }[] }>(open ? "/api/onevity/payroll-profiles" : null);
  const compsApi = useApi<{ components: WageCompFull[] }>(open ? "/api/onevity/wage-components" : null);
  const periodsApi = useApi<{ periods: PeriodRow[] }>(open ? "/api/onevity/payroll-periods" : null);

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
      toast.error("Lengkapi seluruh pilihan rapel"); return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{
        breakdown: RapelBreakdownRow[]; totalDiff: number; periods: number;
      }>("/api/onevity/payroll-rapel", "POST", {
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
      const res = await apiSend<{ run: { id: string; runNo: string; totalNet: number } | null; totalDiff: number; periods: number }>("/api/onevity/payroll-rapel", "POST", {
        employeeId, componentCode, newAmount: Number(newAmount),
        fromPeriodId, toPeriodId, targetPeriodId, autoRun: true,
      });
      toast.success(
        res.run
          ? `Run rapel ${res.run.runNo} dibuat & dihitung — selisih ${fmtIDR(res.totalDiff)} (${res.periods} period)`
          : `Komponen rapel ${fmtIDR(res.totalDiff)} dibuat di period target`
      );
      setPreview(null); setEmployeeId(""); setNewAmount(""); setFromPeriodId(""); setToPeriodId(""); setTargetPeriodId("");
      onClose();
      if (res.run) navigate("payroll", "run", { id: res.run.id });
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setPreview(null); onClose(); } }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-teal-600" /> Rapel / Back-Pay</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Karyawan *</Label>
              <Select value={employeeId} onValueChange={(v) => { setEmployeeId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih karyawan" /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {(employeesApi.data?.employees ?? []).map((e) => (
                    <SelectItem key={e.employeeId} value={e.employeeId}>{e.employeeNo} — {e.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Komponen yang naik *</Label>
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
              <Label className="text-xs">Nilai Baru / Bulan (Rp) *</Label>
              <Input
                type="number" value={newAmount}
                onChange={(e) => { setNewAmount(e.target.value); setPreview(null); }}
                placeholder={emp ? String(emp.baseSalary) : "cth: 6500000"}
                className="mt-1.5 font-mono"
              />
              {emp && <p className="mt-1 text-[10px] text-stone-400">Nilai sekarang: {fmtIDR(emp.baseSalary)}/bln</p>}
            </div>
            <div>
              <Label className="text-xs">Dibayar di *</Label>
              <Select value={targetPeriodId} onValueChange={(v) => { setTargetPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="period target" /></SelectTrigger>
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
              <Label className="text-xs">Rapel Dari Period *</Label>
              <Select value={fromPeriodId} onValueChange={(v) => { setFromPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="period awal" /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {processedPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sampai Period *</Label>
              <Select value={toPeriodId} onValueChange={(v) => { setToPeriodId(v); setPreview(null); }}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="period akhir" /></SelectTrigger>
                <SelectContent className="max-h-52">
                  {processedPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {preview && (
            <div className="overflow-hidden rounded-xl border border-teal-200 dark:border-teal-500/30">
              <div className="flex items-center justify-between bg-teal-50 px-3.5 py-2.5 dark:bg-teal-500/10">
                <p className="text-[11px] font-bold text-teal-700 dark:text-teal-400">
                  Selisih rapel — {preview.periods} period · {componentCode}
                </p>
                <p className="text-sm font-extrabold text-teal-700 dark:text-teal-400">{fmtIDR(preview.totalDiff)}</p>
              </div>
              <div className="max-h-44 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-stone-50 dark:bg-stone-900">
                    <TableRow>
                      <TableHead className="text-[10px] font-bold">Period</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">Dibayar</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">Seharusnya</TableHead>
                      <TableHead className="text-right text-[10px] font-bold">Selisih</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.breakdown.map((b) => (
                      <TableRow key={b.periodCode}>
                        <TableCell className="text-[11px] font-semibold">{b.periodName}</TableCell>
                        <TableCell className="text-right text-[11px] text-stone-500">{fmtIDR(b.paid)}</TableCell>
                        <TableCell className="text-right text-[11px]">{fmtIDR(b.expected)}</TableCell>
                        <TableCell className="text-right text-[11px] font-bold ov-text-accent">+{fmtIDR(b.diff)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <p className="rounded-xl bg-stone-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900">
            Selisih dibayarkan sekali sebagai komponen <b>RAPEL (Back Pay)</b> pada period target dengan pajak <b>irreguler</b>.
            Prorata per period diabaikan — hanya period yang run gajinya sudah final yang dihitung.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Batal</Button>
          {!preview ? (
            <Button onClick={doPreview} disabled={busy} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
              <Calculator className="h-4 w-4" />{busy ? "Menghitung…" : "Preview Selisih"}
            </Button>
          ) : (
            <Button onClick={doCreate} disabled={saving} className="gap-2 font-bold">
              <PlayCircle className="h-4 w-4" />{saving ? "Membuat run…" : `Buat Run Rapel · ${fmtIDR(preview.totalDiff)}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
