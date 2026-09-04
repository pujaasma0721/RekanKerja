"use client";
// OneVity Travel — Persetujuan Klaim & Transfer Payroll: approve → jurnal otomatis
// → Transfer → komponen UTRP/TRVSTLIN (padanan TravelClaimToApprove.jsp +
// Operation Transfer + Travel Wage Definition)
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { TravelClaimRowUI, PeriodOptionUI, TRAVEL_STATUS_LABEL, TRAVEL_STATUS_LABEL_EN, fmtIDR, fmtDateID } from "./travel-types";
import { CheckCircle2, XCircle, Ban, Landmark, Wallet, Inbox, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

interface DecideState {
  claim: TravelClaimRowUI | null;
  action: "approve" | "reject" | "cancel" | null;
}

export function TravelClaimApprovalPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [decide, setDecide] = useState<DecideState>({ claim: null, action: null });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [periodId, setPeriodId] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  const api = useApi<{ claims: TravelClaimRowUI[]; stats: { submitted: number; approved: number; transferred: number; paid: number; totalSettlement: number; payableEmployee: number; payableCompany: number } }>(
    "/api/onevity/travel/claims?status=Submitted",
  );
  const approved = useApi<{ claims: TravelClaimRowUI[]; stats: { submitted: number; approved: number; transferred: number; paid: number; totalSettlement: number; payableEmployee: number; payableCompany: number } }>("/api/onevity/travel/claims?status=Approved");
  const all = useApi<{ claims: TravelClaimRowUI[] }>("/api/onevity/travel/claims?status=all");
  const periods = useApi<{ periods: PeriodOptionUI[] }>("/api/onevity/payroll-periods");

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
        "/api/onevity/travel/claims", "PATCH",
        { id: decide.claim.id, action: decide.action, note: note || undefined },
      );
      toast.success(
        res.journalNo
          ? t("{no} disetujui — jurnal {j} otomatis dibuat ({n} baris)", "{no} approved — journal {j} created automatically ({n} lines)", { no: res.docNo, j: res.journalNo, n: res.journalLines })
          : t("{no} — {status}", "{no} — {status}", { no: res.docNo, status: t(TRAVEL_STATUS_LABEL[res.status] ?? res.status, TRAVEL_STATUS_LABEL_EN[res.status] ?? res.status) }),
      );
      setDecide({ claim: null, action: null });
      setNote("");
      api.refresh();
      approved.refresh();
      all.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses keputusan", "Failed to process decision"));
    } finally { setBusy(false); }
  };

  const doTransfer = async () => {
    if (!periodId) { toast.error(t("Pilih period payroll target", "Select the target payroll period")); return; }
    setTransferBusy(true);
    try {
      const res = await apiSend<{ periodName: string; claims: number; employees: number; earningTotal: number; deductionTotal: number; removed: number }>(
        "/api/onevity/travel/transfer", "POST", { periodId },
      );
      toast.success(
        t("Transfer ke {p}: {n} klaim, {m} karyawan — bayar {pay}, potong {ded} (UTRP/TRVSTLIN)", "Transfer to {p}: {n} claims, {m} employees — pay {pay}, deduct {ded} (UTRP/TRVSTLIN)", { p: res.periodName, n: res.claims, m: res.employees, pay: fmtIDR(res.earningTotal), ded: fmtIDR(res.deductionTotal) }),
      );
      setTransferOpen(false);
      approved.refresh();
      all.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal transfer ke payroll", "Failed to transfer to payroll"));
    } finally { setTransferBusy(false); }
  };

  const stats = api.data?.stats;
  const aStats = approved.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Persetujuan Klaim & Transfer Payroll", "Claim Approval & Payroll Transfer")}
        description={t("Approve klaim → jurnal akuntansi otomatis per baris biaya → Transfer ke payroll (UTRP bayar karyawan / TRVSTLIN potong kelebihan uang muka) — padanan Settlement Approval + Wage Definition", "Approve claims → automatic accounting journal per expense line → Transfer to payroll (UTRP pays employees / TRVSTLIN deducts excess advance) — Settlement Approval + Wage Definition equivalent")}
        actions={
          perms.canOp("travel", "travel-claim-approval", "transfer") && (
            <Button
              onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferOpen(true); }}
              disabled={!approvedClaims.length}
              className="gap-2 font-bold"
            >
              <Landmark className="h-4 w-4" /> {t("Transfer ke Payroll", "Transfer to Payroll")} {approvedClaims.length ? `(${approvedClaims.length})` : ""}
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">{t("Klaim Menunggu", "Pending Claims")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{stats?.submitted ?? "—"}</p>
            </div>
            <Inbox className="h-7 w-7 text-amber-600" />
          </CardContent>
        </Card>
        <Card className="border-teal-200 bg-teal-50/60 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">{t("Siap Transfer (Approved)", "Ready to Transfer (Approved)")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{aStats ? fmtIDR(aStats.payableEmployee) : "—"}</p>
              <p className="text-[11px] text-stone-500">{t("{n} klaim · potongan {amt}", "{n} claims · deductions {amt}", { n: approvedClaims.length, amt: aStats ? fmtIDR(aStats.payableCompany) : "—" })}</p>
            </div>
            <Wallet className="h-7 w-7 text-teal-600" />
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Sudah Ditransfer / Dibayar", "Transferred / Paid")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{((stats?.transferred ?? 0) + (stats?.paid ?? 0)) || "—"}</p>
            </div>
            <Landmark className="h-7 w-7 text-stone-400" />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-stone-500">{t("Antrean Klaim", "Claim Queue")}</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {api.loading && !api.data ? (
          <div className="lg:col-span-2"><LoadingRows rows={4} /></div>
        ) : pending.length === 0 ? (
          <div className="lg:col-span-2">
            <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
              <CardContent className="p-0">
                <EmptyState icon={CheckCircle2} title={t("Tidak ada klaim menunggu", "No pending claims")} description={t("Semua klaim settlement sudah diputuskan.", "All settlement claims have been decided.")} />
              </CardContent>
            </Card>
          </div>
        ) : (
          pending.map((c) => (
            <Card key={c.id} className="border-stone-200 bg-white/80 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold ov-text-accent">{c.docNo}</p>
                    <p className="mt-0.5 truncate text-sm font-bold text-stone-900 dark:text-stone-100">{c.fullName}</p>
                    <p className="text-[11px] text-stone-500">
                      {c.employeeNo}{c.requestDocNo ? t(" · dari {no}", " · from {no}", { no: c.requestDocNo }) : t(" · mandiri", " · standalone")} · {fmtDateID(c.claimDate)}
                    </p>
                  </div>
                  <StatusPill status={t(TRAVEL_STATUS_LABEL[c.status] ?? c.status, TRAVEL_STATUS_LABEL_EN[c.status] ?? c.status)} />
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg bg-stone-50 py-1.5 dark:bg-stone-800/60">
                    <p className="text-[9px] font-bold text-stone-500">{t("(a) lain+kurs", "(a) other+fx")}</p>
                    <p className="text-xs font-black text-stone-800 dark:text-stone-200">{fmtIDR(c.otherCompanyExp + c.exchangeLoss)}</p>
                  </div>
                  <div className="rounded-lg bg-teal-50 py-1.5 dark:bg-teal-950/30">
                    <p className="text-[9px] font-bold text-teal-700 dark:text-teal-400">{t("(b) karyawan", "(b) employee")}</p>
                    <p className="text-xs font-black text-teal-700 dark:text-teal-400">{fmtIDR(c.payableEmployee)}</p>
                  </div>
                  <div className="rounded-lg bg-rose-50 py-1.5 dark:bg-rose-950/30">
                    <p className="text-[9px] font-bold text-rose-700 dark:text-rose-400">{t("(c) perusahaan", "(c) company")}</p>
                    <p className="text-xs font-black text-rose-700 dark:text-rose-400">{fmtIDR(c.payableCompany)}</p>
                  </div>
                  <div className="rounded-lg border ov-border-accent ov-soft py-1.5">
                    <p className="text-[9px] font-bold">TOTAL</p>
                    <p className="text-xs font-black">{fmtIDR(c.totalSettlement)}</p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                  <span>{t("{n} baris biaya · {amt}", "{n} expense lines · {amt}", { n: c.expenseLines, amt: fmtIDR(c.totalExpenses) })}</span>
                  {c.advanceAmount > 0 && <Badge className="bg-amber-100 text-[9px] font-bold text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400">{t("MUKA {amt}", "ADVANCE {amt}", { amt: fmtIDR(c.advanceAmount) })}</Badge>}
                  {c.overLimitLines > 0 && <Badge className="bg-rose-100 text-[9px] font-bold text-rose-700 hover:bg-rose-100 dark:bg-rose-500/15 dark:text-rose-400">{t("{n} LEBIH LIMIT", "{n} OVER LIMIT", { n: c.overLimitLines })}</Badge>}
                  {c.expenseKinds.map((k) => (
                    <Badge key={k} variant="outline" className="text-[9px] font-bold">{k}</Badge>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.canOp("travel", "travel-claim-approval", "approve") && (
                    <>
                      <Button size="sm" className="h-8 gap-1.5 bg-teal-600 text-xs font-bold hover:bg-teal-700" onClick={() => { setDecide({ claim: c, action: "approve" }); setNote(""); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui + Jurnal", "Approve + Journal")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-700" onClick={() => { setDecide({ claim: c, action: "reject" }); setNote(""); }}>
                        <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                      </Button>
                    </>
                  )}
                  {perms.canOp("travel", "travel-claim", "cancel") && (
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs font-bold text-stone-500" onClick={() => { setDecide({ claim: c, action: "cancel" }); setNote(""); }}>
                      <Ban className="h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {approvedClaims.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-sm font-black uppercase tracking-wide text-stone-500">
            {t("Siap Transfer ke Payroll ({n})", "Ready to Transfer to Payroll ({n})", { n: approvedClaims.length })}
          </h2>
          <Card className="border-teal-200 bg-teal-50/40 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <p className="font-bold text-stone-800 dark:text-stone-200">
                    {t("{n} klaim Approved — bayar karyawan {a} + potong perusahaan {b}", "{n} Approved claims — pay employees {a} + company deduction {b}", { n: approvedClaims.length, a: fmtIDR(aStats?.payableEmployee ?? 0), b: fmtIDR(aStats?.payableCompany ?? 0) })}
                  </p>
                  <p className="text-xs text-stone-500">{t("Komponen payroll: UTRP (earning) untuk (b) & TRVSTLIN (deduction) untuk (c) — padanan Travel Wage Definition", "Payroll components: UTRP (earning) for (b) & TRVSTLIN (deduction) for (c) — Travel Wage Definition equivalent")}</p>
                </div>
                {perms.canOp("travel", "travel-claim-approval", "transfer") && (
                  <Button onClick={() => { setPeriodId(openPeriods[0]?.id ?? ""); setTransferOpen(true); }} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                    <Landmark className="h-4 w-4" /> Transfer
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {recent.length > 0 && (
        <Card className="mt-6 border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-0">
            <div className="border-b border-stone-100 px-4 py-3 text-sm font-black uppercase tracking-wide text-stone-500 dark:border-stone-800">
              {t("Riwayat Keputusan & Pembayaran", "Decision & Payment History")}
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id} className="border-b border-stone-50 last:border-0 dark:border-stone-800/60">
                      <td className="px-4 py-2 font-mono font-bold ov-text-accent">{c.docNo}</td>
                      <td className="px-2 py-2 font-semibold text-stone-700 dark:text-stone-300">{c.fullName}</td>
                      <td className="px-2 py-2 text-right font-bold text-stone-700 dark:text-stone-300">{fmtIDR(c.totalSettlement)}</td>
                      <td className="px-2 py-2"><StatusPill status={t(TRAVEL_STATUS_LABEL[c.status] ?? c.status, TRAVEL_STATUS_LABEL_EN[c.status] ?? c.status)} /></td>
                      <td className="hidden px-2 py-2 md:table-cell">
                        {c.journalNo ? <span className="font-mono text-[11px] font-bold text-teal-700 dark:text-teal-400">{c.journalNo}</span> : <span className="text-stone-400">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right text-stone-400">
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
              {decide.action === "approve" ? <CheckCircle2 className="h-5 w-5 text-teal-600" /> : decide.action === "reject" ? <XCircle className="h-5 w-5 text-rose-600" /> : <Ban className="h-5 w-5 text-stone-500" />}
              {decide.action === "approve" ? t("Setujui Klaim", "Approve Claim") : decide.action === "reject" ? t("Tolak Klaim", "Reject Claim") : t("Batalkan Klaim", "Cancel Claim")}
            </DialogTitle>
          </DialogHeader>
          {decide.claim && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/60">
                <p className="font-mono text-xs font-bold ov-text-accent">{decide.claim.docNo}</p>
                <p className="mt-1 font-bold text-stone-900 dark:text-stone-100">{decide.claim.fullName}</p>
                <p className="text-xs text-stone-500">{t("{n} baris biaya · {amt}", "{n} expense lines · {amt}", { n: decide.claim.expenseLines, amt: fmtIDR(decide.claim.totalExpenses) })}</p>
                <div className="mt-2 grid grid-cols-4 gap-1.5 text-center text-[10px]">
                  <div className="rounded bg-white py-1 dark:bg-stone-900"><p className="text-stone-500">(a)</p><p className="font-black">{fmtIDR(decide.claim.otherCompanyExp + decide.claim.exchangeLoss)}</p></div>
                  <div className="rounded bg-white py-1 dark:bg-stone-900"><p className="text-teal-600">(b)</p><p className="font-black text-teal-700">{fmtIDR(decide.claim.payableEmployee)}</p></div>
                  <div className="rounded bg-white py-1 dark:bg-stone-900"><p className="text-rose-600">(c)</p><p className="font-black text-rose-700">{fmtIDR(decide.claim.payableCompany)}</p></div>
                  <div className="rounded border ov-border-accent ov-soft py-1"><p>TOTAL</p><p className="font-black">{fmtIDR(decide.claim.totalSettlement)}</p></div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Catatan keputusan (opsional)", "Decision note (optional)")}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("Mis. Disetujui — dokumen lengkap", "e.g. Approved — documents complete")} className="text-sm" />
              </div>
              {decide.action === "approve" && (
                <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
                  {t("Jurnal otomatis dibuat: tiap baris biaya → Debit akun beban (Expense Chart of Account), Credit Kas & Bank. Klaim bisa langsung ditransfer ke payroll setelah ini.", "A journal is created automatically: each expense line → Debit expense account (Expense Chart of Account), Credit Cash & Bank. The claim can be transferred to payroll right after this.")}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDecide({ claim: null, action: null })} className="font-bold">{t("Batal")}</Button>
            {(decide.action === "cancel" ? perms.canOp("travel", "travel-claim", "cancel") : perms.canOp("travel", "travel-claim-approval", "approve")) && (
              <Button
                onClick={submitDecision} disabled={busy}
                className={decide.action === "approve" ? "gap-2 bg-teal-600 font-bold hover:bg-teal-700" : "gap-2 bg-rose-600 font-bold hover:bg-rose-700"}
              >
                {busy ? t("Memproses…", "Processing…") : decide.action === "approve" ? t("Setujui + Buat Jurnal", "Approve + Create Journal") : decide.action === "reject" ? t("Tolak", "Reject") : t("Batalkan", "Cancel")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-teal-600" /> {t("Transfer Klaim ke Payroll", "Transfer Claims to Payroll")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="leading-relaxed text-stone-600 dark:text-stone-300">
              {t("{n} klaim Approved akan masuk payroll sebagai komponen ", "{n} Approved claims will enter payroll as components ", { n: approvedClaims.length })}
              <span className="font-bold">UTRP</span>
              {t(" (bayar ke karyawan)", " (pay to employee)")}
              {" "}/ <span className="font-bold">TRVSTLIN</span>
              {t(" (potongan kelebihan uang muka). Idempoten — assignment periode ini ditulis ulang.", " (deduction of excess advance). Idempotent — this period's assignments are rewritten.")}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Period Payroll Target *", "Target Payroll Period *")}</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger className="text-sm"><SelectValue placeholder={t("Pilih period", "Select period")} /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name} ({p.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-stone-50 p-3 text-xs dark:bg-stone-800/60">
              <p className="font-bold text-stone-700 dark:text-stone-300">{t("Setelah transfer:", "After the transfer:")}</p>
              <ol className="mt-1 list-inside list-decimal space-y-1 text-stone-600 dark:text-stone-400">
                <li>{t("Klaim berstatus ", "Claims become ")}<span className="font-bold">Transferred</span></li>
                <li>{t("Jalankan payroll run period ini (proses Salary)", "Run payroll for this period (Salary process)")}</li>
                <li>{t("Saat run dikonfirmasi → klaim otomatis ", "When the run is confirmed → the claim automatically becomes ")}<span className="font-bold">{t("Dibayar", "Paid")}</span>{t(" + nomor run tercatat", " + the run number is recorded")}</li>
              </ol>
              <p className="mt-2 flex items-center gap-1.5 font-bold text-teal-700 dark:text-teal-400">
                <FileText className="h-3 w-3" /> {t("Payslip karyawan menampilkan komponen travel ", "Employee payslips display the travel component ")}<ArrowRight className="h-3 w-3" />
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTransferOpen(false)} className="font-bold">{t("Batal")}</Button>
            {perms.canOp("travel", "travel-claim-approval", "transfer") && (
              <Button onClick={doTransfer} disabled={transferBusy || !periodId} className="gap-2 bg-teal-600 font-bold hover:bg-teal-700">
                <Landmark className="h-4 w-4" /> {transferBusy ? t("Mentransfer…", "Transferring…") : t("Transfer Sekarang", "Transfer Now")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
