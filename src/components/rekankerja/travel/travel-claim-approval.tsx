"use client";
// RekanKerja Travel — Persetujuan Klaim & Transfer Payroll: approve → jurnal otomatis
// → Transfer → komponen UTRP/TRVSTLIN (padanan TravelClaimToApprove.jsp +
// Operation Transfer + Travel Wage Definition oranHR)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/lib/rekankerja/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/rekankerja/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TravelClaimRowUI, PeriodOptionUI, TRAVEL_STATUS_LABEL, fmtIDR, fmtDateID } from "./travel-types";
import { CheckCircle2, XCircle, Ban, Landmark, Wallet, Inbox, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DecideState {
  claim: TravelClaimRowUI | null;
  action: "approve" | "reject" | "cancel" | null;
}

export function TravelClaimApprovalPage() {
  const [decide, setDecide] = useState<DecideState>({ claim: null, action: null });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  const api = useApi<{ claims: TravelClaimRowUI[]; stats: { submitted: number; approved: number; transferred: number; paid: number; totalSettlement: number; payableEmployee: number; payableCompany: number } }>(
    "/api/rekankerja/travel/claims?status=Submitted",
  );
  const approved = useApi<{ claims: TravelClaimRowUI[] }>("/api/rekankerja/travel/claims?status=Approved");
  const all = useApi<{ claims: TravelClaimRowUI[] }>("/api/rekankerja/travel/claims?status=all");
  const periods = useApi<{ periods: PeriodOptionUI[] }>("/api/rekankerja/payroll-periods");

  const pending = api.data?.claims ?? [];
  const approvedClaims = approved.data?.claims ?? [];
  const recent = useMemo(
    () => (all.data?.claims ?? []).filter((c) => ["Approved", "Transferred", "Paid", "Rejected", "Cancelled"].includes(c.status)).slice(0, 8),
    [all.data],
  );

  const openPeriods = (periods.data?.periods ?? []).filter((p) => p.status !== "Locked" && p.status !== "Closed");

  const submitDecision = async () => {
    if (!decide.claim || !decide.action) return;
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; journalNo: string | null; journalLines: number }>(
        "/api/rekankerja/travel/claims", "PATCH",
        { id: decide.claim.id, action: decide.action, note: note || undefined },
      );
      toast.success(
        res.journalNo
          ? `${res.docNo} disetujui — jurnal ${res.journalNo} otomatis dibuat (${res.journalLines} baris)`
          : `${res.docNo} — ${TRAVEL_STATUS_LABEL[res.status] ?? res.status}`,
      );
      setDecide({ claim: null, action: null });
      setNote("");
      api.refresh();
      approved.refresh();
      all.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses keputusan");
    } finally { setBusy(false); }
  };

  const doTransfer = async () => {
    if (!periodId) { toast.error("Pilih period payroll target"); return; }
    setTransferBusy(true);
    try {
      const res = await apiSend<{ periodName: string; claims: number; employees: number; earningTotal: number; deductionTotal: number; removed: number }>(
        "/api/rekankerja/travel/transfer", "POST", { periodId },
      );
      toast.success(
        `Transfer ke ${res.periodName}: ${res.claims} klaim, ${res.employees} karyawan — bayar ${fmtIDR(res.earningTotal)}, potong ${fmtIDR(res.deductionTotal)} (UTRP/TRVSTLIN)`,
      );
      setTransferOpen(false);
      approved.refresh();
      all.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal transfer ke payroll");
    } finally { setTransferBusy(false); }
  };

  const stats = api.data?.stats;
  const aStats = approved.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow="MODUL TRAVEL"
        title="Persetujuan Klaim & Transfer Payroll"
        description="Approve klaim → jurnal akuntansi otomatis per baris biaya → Transfer ke payroll (UTRP bayar karyawan / TRVSTLIN potong kelebihan uang muka) — padanan Settlement Approval + Wage Definition oranHR"
        actions={
          <Button
            onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferOpen(true); }}
            disabled={!approvedClaims.length}
            className="gap-2 bg-orange-600 font-bold hover:bg-orange-700"
          >
            <Landmark className="h-4 w-4" /> Transfer ke Payroll {approvedClaims.length ? `(${approvedClaims.length})` : ""}
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Klaim Menunggu</p>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{stats?.submitted ?? "—"}</p>
            </div>
            <Inbox className="h-7 w-7 text-amber-600" />
          </CardContent>
        </Card>
        <Card className="border-teal-200 bg-teal-50/60 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">Siap Transfer (Approved)</p>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{aStats ? fmtIDR(aStats.payableEmployee) : "—"}</p>
              <p className="text-[11px] text-slate-500">{approvedClaims.length} klaim · potongan {aStats ? fmtIDR(aStats.payableCompany) : "—"}</p>
            </div>
            <Wallet className="h-7 w-7 text-teal-600" />
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sudah Ditransfer / Dibayar</p>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100">{((stats?.transferred ?? 0) + (stats?.paid ?? 0)) || "—"}</p>
            </div>
            <Landmark className="h-7 w-7 text-slate-400" />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">Antrean Klaim</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {api.loading && !api.data ? (
          <div className="lg:col-span-2"><LoadingRows rows={4} /></div>
        ) : pending.length === 0 ? (
          <div className="lg:col-span-2">
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-0">
                <EmptyState icon={CheckCircle2} title="Tidak ada klaim menunggu" description="Semua klaim settlement sudah diputuskan." />
              </CardContent>
            </Card>
          </div>
        ) : (
          pending.map((c) => (
            <Card key={c.id} className="border-slate-200 bg-white/80 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{c.docNo}</p>
                    <p className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-slate-100">{c.fullName}</p>
                    <p className="text-[11px] text-slate-500">
                      {c.employeeNo}{c.requestDocNo ? ` · dari ${c.requestDocNo}` : " · mandiri"} · {fmtDateID(c.claimDate)}
                    </p>
                  </div>
                  <StatusPill status={TRAVEL_STATUS_LABEL[c.status] ?? c.status} />
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 py-1.5 dark:bg-slate-800/60">
                    <p className="text-[9px] font-bold text-slate-500">(a) lain+kurs</p>
                    <p className="text-xs font-black text-slate-800 dark:text-slate-200">{fmtIDR(c.otherCompanyExp + c.exchangeLoss)}</p>
                  </div>
                  <div className="rounded-lg bg-teal-50 py-1.5 dark:bg-teal-950/30">
                    <p className="text-[9px] font-bold text-teal-700 dark:text-teal-400">(b) karyawan</p>
                    <p className="text-xs font-black text-teal-700 dark:text-teal-400">{fmtIDR(c.payableEmployee)}</p>
                  </div>
                  <div className="rounded-lg bg-rose-50 py-1.5 dark:bg-rose-950/30">
                    <p className="text-[9px] font-bold text-rose-700 dark:text-rose-400">(c) perusahaan</p>
                    <p className="text-xs font-black text-rose-700 dark:text-rose-400">{fmtIDR(c.payableCompany)}</p>
                  </div>
                  <div className="rounded-lg border border-orange-200 bg-orange-50 py-1.5 dark:border-orange-800 dark:bg-orange-950/40">
                    <p className="text-[9px] font-bold text-orange-700 dark:text-orange-400">TOTAL</p>
                    <p className="text-xs font-black text-orange-700 dark:text-orange-400">{fmtIDR(c.totalSettlement)}</p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span>{c.expenseLines} baris biaya · {fmtIDR(c.totalExpenses)}</span>
                  {c.advanceAmount > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">MUKA {fmtIDR(c.advanceAmount)}</Badge>}
                  {c.overLimitLines > 0 && <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">{c.overLimitLines} LEBIH LIMIT</Badge>}
                  {c.expenseKinds.map((k) => (
                    <Badge key={k} variant="outline" className="text-[9px] font-bold">{k}</Badge>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" className="h-8 gap-1.5 bg-teal-600 text-xs font-bold hover:bg-teal-700" onClick={() => { setDecide({ claim: c, action: "approve" }); setNote(""); }}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Setujui + Jurnal
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-700" onClick={() => { setDecide({ claim: c, action: "reject" }); setNote(""); }}>
                    <XCircle className="h-3.5 w-3.5" /> Tolak
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs font-bold text-slate-500" onClick={() => { setDecide({ claim: c, action: "cancel" }); setNote(""); }}>
                    <Ban className="h-3.5 w-3.5" /> Batalkan
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {approvedClaims.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-sm font-black uppercase tracking-wide text-slate-500">
            Siap Transfer ke Payroll ({approvedClaims.length})
          </h2>
          <Card className="border-teal-200 bg-teal-50/40 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <p className="font-bold text-slate-800 dark:text-slate-200">
                    {approvedClaims.length} klaim Approved — bayar karyawan {fmtIDR(aStats?.payableEmployee ?? 0)} + potong perusahaan {fmtIDR(aStats?.payableCompany ?? 0)}
                  </p>
                  <p className="text-xs text-slate-500">Komponen payroll: UTRP (earning) untuk (b) &amp; TRVSTLIN (deduction) untuk (c) — padanan Travel Wage Definition oranHR</p>
                </div>
                <Button onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferOpen(true); }} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                  <Landmark className="h-4 w-4" /> Transfer
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {recent.length > 0 && (
        <Card className="mt-6 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-0">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-black uppercase tracking-wide text-slate-500 dark:border-slate-800">
              Riwayat Keputusan &amp; Pembayaran
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800/60">
                      <td className="px-4 py-2 font-mono font-bold text-orange-700 dark:text-orange-400">{c.docNo}</td>
                      <td className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-300">{c.fullName}</td>
                      <td className="px-2 py-2 text-right font-bold text-slate-700 dark:text-slate-300">{fmtIDR(c.totalSettlement)}</td>
                      <td className="px-2 py-2"><StatusPill status={TRAVEL_STATUS_LABEL[c.status] ?? c.status} /></td>
                      <td className="hidden px-2 py-2 md:table-cell">
                        {c.journalNo ? <span className="font-mono text-[11px] font-bold text-teal-700 dark:text-teal-400">{c.journalNo}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-400">
                        {c.paidRunNo ? `run ${c.paidRunNo}` : c.periodCode ? `period ${c.periodCode}` : c.decidedAt ? fmtDateID(c.decidedAt) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(decide.claim)} onOpenChange={(o) => !o && setDecide({ claim: null, action: null })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decide.action === "approve" ? <CheckCircle2 className="h-5 w-5 text-teal-600" /> : decide.action === "reject" ? <XCircle className="h-5 w-5 text-rose-600" /> : <Ban className="h-5 w-5 text-slate-500" />}
              {decide.action === "approve" ? "Setujui Klaim" : decide.action === "reject" ? "Tolak Klaim" : "Batalkan Klaim"}
            </DialogTitle>
          </DialogHeader>
          {decide.claim && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="font-mono text-xs font-bold text-orange-700 dark:text-orange-400">{decide.claim.docNo}</p>
                <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{decide.claim.fullName}</p>
                <p className="text-xs text-slate-500">{decide.claim.expenseLines} baris biaya · {fmtIDR(decide.claim.totalExpenses)}</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5 text-center text-[10px]">
                  <div className="rounded bg-white py-1 dark:bg-slate-900"><p className="text-slate-500">(a)</p><p className="font-black">{fmtIDR(decide.claim.otherCompanyExp + decide.claim.exchangeLoss)}</p></div>
                  <div className="rounded bg-white py-1 dark:bg-slate-900"><p className="text-teal-600">(b)</p><p className="font-black text-teal-700">{fmtIDR(decide.claim.payableEmployee)}</p></div>
                  <div className="rounded bg-white py-1 dark:bg-slate-900"><p className="text-rose-600">(c)</p><p className="font-black text-rose-700">{fmtIDR(decide.claim.payableCompany)}</p></div>
                  <div className="rounded border border-orange-200 bg-orange-50 py-1 dark:border-orange-800 dark:bg-orange-950/40"><p className="text-orange-600">TOTAL</p><p className="font-black text-orange-700">{fmtIDR(decide.claim.totalSettlement)}</p></div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">Catatan keputusan (opsional)</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Mis. Disetujui — dokumen lengkap" className="text-sm" />
              </div>
              {decide.action === "approve" && (
                <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
                  Jurnal otomatis dibuat: tiap baris biaya → Debit akun beban (Expense Chart of Account), Credit Kas &amp; Bank. Klaim bisa langsung ditransfer ke payroll setelah ini.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecide({ claim: null, action: null })} className="font-bold">Batal</Button>
            <Button
              onClick={submitDecision} disabled={busy}
              className={decide.action === "approve" ? "gap-2 bg-teal-600 font-bold hover:bg-teal-700" : "gap-2 bg-rose-600 font-bold hover:bg-rose-700"}
            >
              {busy ? "Memproses…" : decide.action === "approve" ? "Setujui + Buat Jurnal" : decide.action === "reject" ? "Tolak" : "Batalkan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-teal-600" /> Transfer Klaim ke Payroll
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="leading-relaxed text-slate-600 dark:text-slate-300">
              {approvedClaims.length} klaim Approved akan masuk payroll sebagai komponen <span className="font-bold">UTRP</span> (bayar ke karyawan)
              {" "}/ <span className="font-bold">TRVSTLIN</span> (potongan kelebihan uang muka). Idempoten — assignment periode ini ditulis ulang.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Period Payroll Target *</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Pilih period" /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name} ({p.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              <p className="font-bold text-slate-700 dark:text-slate-300">Setelah transfer:</p>
              <ol className="mt-1 list-inside list-decimal space-y-1 text-slate-600 dark:text-slate-400">
                <li>Klaim berstatus <span className="font-bold">Transferred</span></li>
                <li>Jalankan payroll run period ini (proses Salary)</li>
                <li>Saat run dikonfirmasi → klaim otomatis <span className="font-bold">Dibayar</span> + nomor run tercatat</li>
              </ol>
              <p className="mt-2 flex items-center gap-1.5 font-bold text-teal-700 dark:text-teal-400">
                <FileText className="h-3 w-3" /> Payslip karyawan menampilkan komponen travel <ArrowRight className="h-3 w-3" />
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)} className="font-bold">Batal</Button>
            <Button onClick={doTransfer} disabled={transferBusy || !periodId} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
              <Landmark className="h-4 w-4" /> {transferBusy ? "Mentransfer…" : "Transfer Sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
