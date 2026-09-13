"use client";
// OneVity Medical — Persetujuan Klaim & Settlement: antrean Submitted/Approved,
// Operation (Approve/Reject/Cancel/Settle — settle = jurnal otomatis +
// saldo used bertambah) + Transfer Sisa Saldo CASH → payroll UMC.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  ClaimUI, PeriodOptionUI,
  fmtIDR, fmtIDRShort, fmtDateID,
} from "./medical-types";
import {
  CheckCircle2, XCircle, Ban, Landmark, Wallet, FileText, Inbox, History,
} from "lucide-react";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { cn } from "@/lib/utils";

type Action = "approve" | "reject" | "cancel" | "settle" | "return";

const ACTION_META: Record<Action, { title: string; label: string; tone: string; icon: typeof CheckCircle2 }> = {
  approve: { title: "Setujui Klaim", label: "Setujui", tone: "bg-brand hover:bg-brand/70", icon: CheckCircle2 },
  settle: { title: "Settle Klaim", label: "Settle", tone: "bg-brand hover:bg-brand/70", icon: Landmark },
  reject: { title: "Tolak Klaim", label: "Tolak", tone: "bg-brand hover:bg-brand/70", icon: XCircle },
  cancel: { title: "Batalkan Klaim", label: "Batalkan", tone: "bg-stone-600 hover:bg-stone-700", icon: Ban },
  return: { title: "Kembalikan ke Pemohon", label: "Kembalikan", tone: "bg-amber-600 hover:bg-amber-700", icon: History },
};

// peta EN paralel — render: t(META[a].title, ACTION_META_EN[a].title)
const ACTION_META_EN: Record<Action, { title: string; label: string }> = {
  approve: { title: "Approve Claim", label: "Approve" },
  settle: { title: "Settle Claim", label: "Settle" },
  reject: { title: "Reject Claim", label: "Reject" },
  cancel: { title: "Cancel Claim", label: "Cancel" },
  return: { title: "Return to Requester", label: "Return" },
};

export function MedicalApprovalPage() {
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action>("approve");
  const [claim, setClaim] = useState<ClaimUI | null>(null);
  const [reason, setReason] = useState("");

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferYear, setTransferYear] = useState(String(new Date().getFullYear()));
  const [periodId, setPeriodId] = useState("");

  const api = useApi<{ claims: ClaimUI[]; stats: { pendingAmount: number; settledAmount: number } }>(
    "/api/onevity/medical/claims?state=all",
  );
  const periodsApi = useApi<{ periods: PeriodOptionUI[] }>("/api/onevity/payroll-periods");

  const queue = useMemo(
    () => (api.data?.claims ?? []).filter((c) => c.state === "Submitted" || c.state === "Returned" || c.state === "Approved"),
    [api.data],
  );
  const pending = queue.filter((c) => c.state === "Submitted" || c.state === "Returned");
  const approved = queue.filter((c) => c.state === "Approved");
  const settledHistory = useMemo(
    () => (api.data?.claims ?? []).filter((c) => c.state === "Settled").slice(0, 8),
    [api.data],
  );
  const openPeriods = (periodsApi.data?.periods ?? []).filter((p) => p.status === "Open" || p.status === "Scheduled");

  const openDialog = (a: Action, c: ClaimUI) => {
    setAction(a);
    setClaim(c);
    setReason("");
    setDialog(true);
  };

  const run = async () => {
    if (!claim) return;
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; state: string; journalNo: string | null; journalLines: number; usedAdded: number; remaining: number; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>(
        "/api/onevity/medical/claims", "PATCH",
        { id: claim.id, action, note: reason || undefined },
      );
      if (res.approval) {
        // approval parsial — jenjang menengah disetujui, klaim tetap menunggu jenjang berikutnya
        toast.success(t("Jenjang {l} disetujui — menunggu {w}", "Tier {l} approved — awaiting {w}", { l: `${res.approval.currentLevel - 1}/${res.approval.totalLevels}`, w: res.approval.currentApprover ?? t("jenjang berikutnya", "next tier") }));
      } else if (action === "settle") {
        toast.success(
          t("{d} settled — used +{u}, sisa {r}", "{d} settled — used +{u}, remaining {r}", { d: res.docNo, u: fmtIDR(res.usedAdded), r: fmtIDR(res.remaining) })
          + (res.journalNo ? " · " + t("jurnal {n} ({m} baris)", "journal {n} ({m} rows)", { n: res.journalNo, m: res.journalLines }) : ""),
        );
      } else {
        toast.success(`${res.docNo} → ${res.state}`);
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses klaim", "Failed to process claim"));
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!periodId) { toast.error(t("Pilih period payroll target", "Select the target payroll period")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ periodName: string; employees: number; rows: number; totalAmount: number; removed: number }>(
        "/api/onevity/medical/transfer", "POST",
        { periodId, year: Number(transferYear) },
      );
      toast.success(
        t("Sisa saldo medis {y} → {p}: {e} karyawan, {a} (komponen UMC)", "Remaining medical balance {y} → {p}: {e} employees, {a} (UMC component)", { y: transferYear, p: res.periodName, e: res.employees, a: fmtIDR(res.totalAmount) }),
      );
      setTransferOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal transfer sisa saldo", "Failed to transfer remaining balance"));
    } finally {
      setBusy(false);
    }
  };

  const actionMeta = ACTION_META[action];

  return (
    <div>
      <PageHeader
        eyebrow={t("Medical · Persetujuan", "Medical · Approval")}
        title={t("Persetujuan Klaim & Settlement", "Claim Approval & Settlement")}
        description={t("Operation: Submit → Approve → Settle. Settle membuat jurnal otomatis (Debit 5106 Beban Medis / Credit Kas) dan menambah saldo terpakai — plus transfer sisa saldo CASH ke payroll (UMC)", "Operation: Submit → Approve → Settle. Settle creates an automatic journal (Debit 5106 Medical Expense / Credit Cash) and increases the used balance — plus transfer the CASH remaining balance to payroll (UMC)")}
        actions={(
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <Wallet className="h-4 w-4" /> {t("Tarik Sisa Saldo → Payroll", "Draw Remaining Balance → Payroll")}
          </Button>
        )}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Menunggu Persetujuan")}</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{pending.length}</p>
            <p className="mt-1 text-xs text-stone-500">{t("{a} menunggu diputuskan", "{a} awaiting decision", { a: fmtIDRShort(pending.reduce((s, c) => s + c.totalApproved, 0)) })}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Siap Settle", "Ready to Settle")}</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{approved.length}</p>
            <p className="mt-1 text-xs text-stone-500">{t("approved → settle = jurnal + saldo bertambah", "approved → settle = journal + balance increases")}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">{t("Settled (Dibayar)", "Settled (Paid)")}</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(api.data?.stats?.settledAmount ?? 0)}</p>
            <p className="mt-1 text-xs text-stone-500">{t("reimbursement dibayarkan via jurnal settlement", "reimbursement paid out via the settlement journal")}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Transfer UMC</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{t("Akhir Tahun", "Year-End")}</p>
            <p className="mt-1 text-xs text-stone-500">{t("sisa saldo jenis CASH ditarik tunai via payslip", "remaining balance of CASH types is cashed out via payslip")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Inbox className="h-4 w-4 ov-text-accent" /> {t("Antrean Persetujuan", "Approval Queue")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {api.loading && !api.data ? (
            <LoadingRows />
          ) : queue.length === 0 ? (
            <EmptyState title={t("Antrean kosong", "Queue is empty")} description={t("Tidak ada klaim menunggu persetujuan atau settlement.", "No claims awaiting approval or settlement.")} icon={CheckCircle2} />
          ) : queue.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border p-3",
                c.state === "Approved"
                  ? "border-brand/25 bg-brand/10/50 dark:border-brand/70 dark:bg-brand/90/20"
                  : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-stone-900 dark:text-stone-100">{c.docNo}</span>
                  <StatusPill status={c.state} />
                  {c.approval?.status === "InProgress" && (
                    <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                      {t("Jenjang {l}", "Tier {l}", { l: `${c.approval.currentLevel}/${c.approval.totalLevels}` })}
                    </span>
                  )}
                  {c.forDependent && <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand-deep dark:bg-brand/15 dark:text-brand/85">dependent</span>}
                </div>
                <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">
                  {c.fullName} · {c.typeName} · {fmtDateID(c.claimDate)}
                </p>
                <p className="text-xs text-stone-500">
                  {t("tagihan", "bill")} {fmtIDR(c.totalBill)} → approved <span className="font-semibold text-stone-700 dark:text-stone-300">{fmtIDR(c.totalApproved)}</span>
                  {t(" · snapshot sisa saat ajukan: ", " · remaining snapshot at submission: ")}{fmtIDR(Math.max(0, c.maxBenefitAt - c.usedAt))}
                </p>
                {c.approval?.status === "InProgress" && (
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    {t("menunggu keputusan {w}", "awaiting decision by {w}", { w: c.approval.currentApprover ?? t("jenjang berikutnya", "next tier") })}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(c.state === "Submitted" || c.state === "Returned") && (
                  <>
                    {perms.canOp("medical", "medical-approval", "approve") && (
                      <>
                        <Button size="sm" onClick={() => openDialog("approve", c)} className="h-8 bg-brand hover:bg-brand/70">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDialog("return", c)} className="h-8 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400">
                          <History className="mr-1 h-3.5 w-3.5" /> {t("Kembalikan", "Return")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDialog("reject", c)} className="h-8 border-brand/40 text-brand-deep hover:bg-brand/10 dark:border-brand/70 dark:text-brand/85">
                          <XCircle className="mr-1 h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                        </Button>
                      </>
                    )}
                  </>
                )}
                {c.state === "Approved" && (
                  <>
                    {perms.canOp("medical", "medical-approval", "settle") && (
                      <Button size="sm" onClick={() => openDialog("settle", c)} className="h-8 bg-brand hover:bg-brand/70">
                        <Landmark className="mr-1 h-3.5 w-3.5" /> {t("Settle & Jurnal", "Settle & Journal")}
                      </Button>
                    )}
                    {perms.canOp("medical", "medical-claim", "cancel") && (
                      <Button size="sm" variant="outline" onClick={() => openDialog("cancel", c)} className="h-8">
                        <Ban className="mr-1 h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {settledHistory.length > 0 && (
        <Card className="mt-4 border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <FileText className="h-4 w-4 text-brand" /> {t("Riwayat Settlement Terbaru", "Recent Settlement History")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {settledHistory.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60">
                <span className="font-semibold">{c.docNo} · {c.fullName} · {c.typeName}</span>
                <span className="text-stone-500">
                  {fmtDateID(c.settleDate)}{c.journalNo ? ` · ${t("jurnal {n}", "journal {n}", { n: c.journalNo })}` : ""} · <span className="font-semibold text-stone-700 dark:text-stone-300">{fmtIDR(c.totalApproved)}</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* dialog keputusan */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <actionMeta.icon className="h-5 w-5" /> {t(actionMeta.title, ACTION_META_EN[action].title)}
            </DialogTitle>
          </DialogHeader>
          {claim && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
                <p className="font-bold">{claim.docNo} — {claim.fullName}</p>
                <p className="text-stone-600 dark:text-stone-300">{claim.typeName} · {fmtDateID(claim.claimDate)}</p>
                <p className="text-xs text-stone-500">
                  {t("Tagihan", "Bill")} {fmtIDR(claim.totalBill)} · Approved <span className="font-semibold">{fmtIDR(claim.totalApproved)}</span> · Non-re {fmtIDR(claim.totalNonRe)}
                </p>
              </div>
              {claim.approval?.status === "InProgress" && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                  {t("Approval berjenjang: jenjang {a} dari {b} — menunggu keputusan {w}.", "Tiered approval: tier {a} of {b} — awaiting decision by {w}.", { a: claim.approval.currentLevel, b: claim.approval.totalLevels, w: claim.approval.currentApprover ?? t("jenjang berikutnya", "next tier") })}
                  {action === "approve" && claim.approval.currentLevel < claim.approval.totalLevels && t(" Setujui jenjang ini untuk maju ke jenjang berikutnya.", " Approve this tier to advance to the next one.")}
                </p>
              )}
              {action === "settle" && (
                <p className="rounded-lg border border-brand/25 bg-brand/10 p-3 text-xs leading-relaxed text-brand-deep dark:border-brand/70 dark:bg-brand/90/30 dark:text-brand/75">
                  {t("Settle akan: (1) membuat jurnal otomatis Debit 5106 Beban Kesejahteraan Medis / Credit 1101 Kas, (2) menambah saldo terpakai sebesar approved ({a}).", "Settle will: (1) create an automatic journal Debit 5106 Medical Welfare Expense / Credit 1101 Cash, (2) increase the used balance by the approved amount ({a}).", { a: fmtIDR(claim.totalApproved) })}
                </p>
              )}
              <div className="space-y-1.5">
                <Label>{t('Alasan (padanan "Enter Reason")', 'Reason (equivalent to "Enter Reason")')}</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t("mis. sesuai kwitansi & surat rujukan", "e.g. per receipt & referral letter")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>{t("Batal")}</Button>
            {(action === "settle"
              ? perms.canOp("medical", "medical-approval", "settle")
              : action === "cancel"
                ? perms.canOp("medical", "medical-claim", "cancel")
                : perms.canOp("medical", "medical-approval", "approve")) && (
              <Button onClick={run} disabled={busy} className={actionMeta.tone}>
                {busy ? t("Memproses…", "Processing…") : t(actionMeta.label, ACTION_META_EN[action].label)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog transfer sisa saldo */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 ov-text-accent" /> {t("Tarik Sisa Saldo → Payroll (UMC)", "Draw Remaining Balance → Payroll (UMC)")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {t("Padanan ", "Equivalent to ")}<span className="font-semibold">&quot;Paid to employee in cash at end of period with Wage Code&quot;</span>{t(": sisa saldo jenis dengan kebijakan ", ": remaining balance of types with the ")}<span className="font-semibold">CASH</span>{t(" (mis. Rawat Jalan) dibayarkan tunai ke karyawan melalui komponen upah ", " (e.g. Outpatient) is paid in cash to the employee via the wage component ")}<span className="font-semibold">UMC</span>{t(" di period payroll terpilih.", " in the selected payroll period.")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Tahun Saldo", "Balance Year")}</Label>
              <Input type="number" value={transferYear} onChange={(e) => setTransferYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Period Payroll Target *", "Target Payroll Period *")}</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder={t("Pilih period terbuka", "Select an open period")} /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t("Batal")}</Button>
            <Button onClick={transfer} disabled={busy}>
              {busy ? t("Mentransfer…", "Transferring…") : t("Transfer ke Payroll", "Transfer to Payroll")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
