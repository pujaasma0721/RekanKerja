"use client";
// OneVity Payroll — Transaksi: pinjaman karyawan (skedul cicilan) + komponen khusus/periodik
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
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
import { ArrowLeftRight, Plus, Trash2, Landmark, Coins, ChevronDown, ChevronUp } from "lucide-react";
import { LoanRow, CompAssignmentRow, WageCompFull, PeriodRow, ProcessTypeRow } from "@/components/onevity/payroll/payroll-types";
import { cn } from "@/lib/utils";

export function PayrollTransactionsPage() {
  const [tab, setTab] = useState("loans");
  const [loanDialog, setLoanDialog] = useState(false);
  const [compDialog, setCompDialog] = useState(false);

  const loansApi = useApi<{ loans: LoanRow[] }>("/api/onevity/loans");
  const compsApi = useApi<{ assignments: CompAssignmentRow[] }>("/api/onevity/component-assignments");

  return (
    <div>
      <PageHeader
        eyebrow="MODUL PAYROLL"
        title="Pinjaman & Komponen Transaksi"
        description="Pinjaman karyawan dengan skedul cicilan otomatis terpotong saat run dikonfirmasi, serta komponen khusus (bonus period ini) & periodik"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCompDialog(true)} className="gap-2 font-bold"><Coins className="h-4 w-4 text-amber-600" /> Komponen Baru</Button>
            <Button onClick={() => setLoanDialog(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700"><Plus className="h-4 w-4" /> Pinjaman Baru</Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="loans" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Landmark className="h-3.5 w-3.5" /> Pinjaman ({loansApi.data?.loans.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="components" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
            <Coins className="h-3.5 w-3.5" /> Komponen Khusus & Periodik ({compsApi.data?.assignments.length ?? 0})
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
      </Tabs>

      <LoanDialog open={loanDialog} onClose={() => { setLoanDialog(false); loansApi.refresh(); }} />
      <CompAssignmentDialog open={compDialog} onClose={() => { setCompDialog(false); compsApi.refresh(); }} />
    </div>
  );
}

function LoanCard({ loan, onChanged }: { loan: LoanRow; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const pending = loan.installments.filter((i) => i.status === "Pending").length;
  const progress = loan.installmentCount > 0 ? (loan.installmentCount - pending) / loan.installmentCount : 0;

  return (
    <div className="p-4">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow">
          <Landmark className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-bold">{loan.letterNo} — {loan.employee.fullName}</p>
            <StatusPill status={loan.status === "Active" ? "Open" : loan.status === "PaidOff" ? "Paid" : "Cancelled"} />
          </div>
          <p className="mt-0.5 text-[11px] text-stone-400">
            Pokok {fmtIDR(loan.amount)} · {loan.installmentCount}× cicilan {fmtIDR(loan.installmentAmount)}{loan.interestRate > 0 ? ` · bunga ${loan.interestRate}%/thn flat` : " · tanpa bunga"}
            {loan.purpose && ` · ${loan.purpose}`}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="text-[10px] font-bold text-stone-400">{Math.round(progress * 100)}% lunas</span>
          </div>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Outstanding</p>
          <p className="text-sm font-extrabold text-rose-600 dark:text-rose-400">{fmtIDR(loan.outstanding)}</p>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0 text-stone-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-stone-400" />}
      </button>

      {expanded && (
        <div className="mt-3 overflow-hidden rounded-xl border border-stone-200 dark:border-stone-800">
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
      await apiSend("/api/onevity/loans", "POST", {
        employeeId, letterNo: letterNo.trim().toUpperCase(),
        amount: Number(amount), installmentCount: Number(installmentCount),
        interestRate: Number(interestRate) || 0,
        purpose: purpose.trim() || null,
        startPaymentDate: startPaymentDate || undefined,
      });
      toast.success("Pinjaman dibuat — cicilan terpotong otomatis saat run dikonfirmasi");
      setEmployeeId(""); setLetterNo(""); setAmount(""); setInstallmentCount("12"); setInterestRate("0"); setPurpose(""); setStartPaymentDate("");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4 text-emerald-600" /> Pinjaman Karyawan</DialogTitle></DialogHeader>
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
            <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-[11px] leading-relaxed font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
              Total tagihan {fmtIDR(totalDue)} · cicilan ± {fmtIDR(per)}/bulan (bunga flat)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Buat Pinjaman"}</Button>
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
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Tambah"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
