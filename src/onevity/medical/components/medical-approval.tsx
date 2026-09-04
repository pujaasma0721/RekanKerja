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
import { cn } from "@/lib/utils";

type Action = "approve" | "reject" | "cancel" | "settle" | "return";

const ACTION_META: Record<Action, { title: string; label: string; tone: string; icon: typeof CheckCircle2 }> = {
  approve: { title: "Setujui Klaim", label: "Setujui", tone: "bg-emerald-600 hover:bg-emerald-700", icon: CheckCircle2 },
  settle: { title: "Settle Klaim", label: "Settle", tone: "bg-teal-600 hover:bg-teal-700", icon: Landmark },
  reject: { title: "Tolak Klaim", label: "Tolak", tone: "bg-rose-600 hover:bg-rose-700", icon: XCircle },
  cancel: { title: "Batalkan Klaim", label: "Batalkan", tone: "bg-stone-600 hover:bg-stone-700", icon: Ban },
  return: { title: "Kembalikan ke Pemohon", label: "Kembalikan", tone: "bg-amber-600 hover:bg-amber-700", icon: History },
};

export function MedicalApprovalPage() {
  const perms = useMenuPerms();
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
        toast.success(`Jenjang ${res.approval.currentLevel - 1}/${res.approval.totalLevels} disetujui — menunggu ${res.approval.currentApprover ?? "jenjang berikutnya"}`);
      } else if (action === "settle") {
        toast.success(
          `${res.docNo} settled — used +${fmtIDR(res.usedAdded)}, sisa ${fmtIDR(res.remaining)}${res.journalNo ? ` · jurnal ${res.journalNo} (${res.journalLines} baris)` : ""}`,
        );
      } else {
        toast.success(`${res.docNo} → ${res.state}`);
      }
      setDialog(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal memproses klaim");
    } finally {
      setBusy(false);
    }
  };

  const transfer = async () => {
    if (!periodId) { toast.error("Pilih period payroll target"); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ periodName: string; employees: number; rows: number; totalAmount: number; removed: number }>(
        "/api/onevity/medical/transfer", "POST",
        { periodId, year: Number(transferYear) },
      );
      toast.success(
        `Sisa saldo medis ${transferYear} → ${res.periodName}: ${res.employees} karyawan, ${fmtIDR(res.totalAmount)} (komponen UMC)`,
      );
      setTransferOpen(false);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal transfer sisa saldo");
    } finally {
      setBusy(false);
    }
  };

  const actionMeta = ACTION_META[action];

  return (
    <div>
      <PageHeader
        eyebrow="MEDICAL · PERSETUJUAN"
        title="Persetujuan Klaim & Settlement"
        description="Operation: Submit → Approve → Settle. Settle membuat jurnal otomatis (Debit 5106 Beban Medis / Credit Kas) dan menambah saldo terpakai — plus transfer sisa saldo CASH ke payroll (UMC)"
        actions={(
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <Wallet className="h-4 w-4" /> Tarik Sisa Saldo → Payroll
          </Button>
        )}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Menunggu Persetujuan</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{pending.length}</p>
            <p className="mt-1 text-xs text-stone-500">{fmtIDRShort(pending.reduce((s, c) => s + c.totalApproved, 0))} menunggu diputuskan</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Siap Settle</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{approved.length}</p>
            <p className="mt-1 text-xs text-stone-500">approved → settle = jurnal + saldo bertambah</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Settled (Dibayar)</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">{fmtIDRShort(api.data?.stats?.settledAmount ?? 0)}</p>
            <p className="mt-1 text-xs text-stone-500">reimbursement dibayarkan via jurnal settlement</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-500">Transfer UMC</p>
            <p className="mt-1 text-2xl font-black text-stone-900 dark:text-stone-100">Akhir Tahun</p>
            <p className="mt-1 text-xs text-stone-500">sisa saldo jenis CASH ditarik tunai via payslip</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold">
            <Inbox className="h-4 w-4 ov-text-accent" /> Antrean Persetujuan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {api.loading && !api.data ? (
            <LoadingRows />
          ) : queue.length === 0 ? (
            <EmptyState title="Antrean kosong" description="Tidak ada klaim menunggu persetujuan atau settlement." icon={CheckCircle2} />
          ) : queue.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border p-3",
                c.state === "Approved"
                  ? "border-teal-200 bg-teal-50/50 dark:border-teal-800 dark:bg-teal-950/20"
                  : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-stone-900 dark:text-stone-100">{c.docNo}</span>
                  <StatusPill status={c.state} />
                  {c.approval?.status === "InProgress" && (
                    <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                      Jenjang {c.approval.currentLevel}/{c.approval.totalLevels}
                    </span>
                  )}
                  {c.forDependent && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-400">dependent</span>}
                </div>
                <p className="mt-0.5 text-sm text-stone-600 dark:text-stone-300">
                  {c.fullName} · {c.typeName} · {fmtDateID(c.claimDate)}
                </p>
                <p className="text-xs text-stone-500">
                  tagihan {fmtIDR(c.totalBill)} → approved <span className="font-semibold text-stone-700 dark:text-stone-300">{fmtIDR(c.totalApproved)}</span>
                  {" · snapshot sisa saat ajukan: "}{fmtIDR(Math.max(0, c.maxBenefitAt - c.usedAt))}
                </p>
                {c.approval?.status === "InProgress" && (
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    menunggu keputusan {c.approval.currentApprover ?? "jenjang berikutnya"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(c.state === "Submitted" || c.state === "Returned") && (
                  <>
                    {perms.canOp("medical", "medical-approval", "approve") && (
                      <>
                        <Button size="sm" onClick={() => openDialog("approve", c)} className="h-8 bg-emerald-600 hover:bg-emerald-700">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Setujui
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDialog("return", c)} className="h-8 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400">
                          <History className="mr-1 h-3.5 w-3.5" /> Kembalikan
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDialog("reject", c)} className="h-8 border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-400">
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Tolak
                        </Button>
                      </>
                    )}
                  </>
                )}
                {c.state === "Approved" && (
                  <>
                    {perms.canOp("medical", "medical-approval", "settle") && (
                      <Button size="sm" onClick={() => openDialog("settle", c)} className="h-8 bg-teal-600 hover:bg-teal-700">
                        <Landmark className="mr-1 h-3.5 w-3.5" /> Settle & Jurnal
                      </Button>
                    )}
                    {perms.canOp("medical", "medical-claim", "cancel") && (
                      <Button size="sm" variant="outline" onClick={() => openDialog("cancel", c)} className="h-8">
                        <Ban className="mr-1 h-3.5 w-3.5" /> Batalkan
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
              <FileText className="h-4 w-4 text-teal-600" /> Riwayat Settlement Terbaru
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {settledHistory.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm dark:bg-stone-800/60">
                <span className="font-semibold">{c.docNo} · {c.fullName} · {c.typeName}</span>
                <span className="text-stone-500">
                  {fmtDateID(c.settleDate)}{c.journalNo ? ` · jurnal ${c.journalNo}` : ""} · <span className="font-semibold text-stone-700 dark:text-stone-300">{fmtIDR(c.totalApproved)}</span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* dialog keputusan */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <actionMeta.icon className="h-5 w-5" /> {actionMeta.title}
            </DialogTitle>
          </DialogHeader>
          {claim && (
            <div className="space-y-3">
              <div className="rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
                <p className="font-bold">{claim.docNo} — {claim.fullName}</p>
                <p className="text-stone-600 dark:text-stone-300">{claim.typeName} · {fmtDateID(claim.claimDate)}</p>
                <p className="text-xs text-stone-500">
                  Tagihan {fmtIDR(claim.totalBill)} · Approved <span className="font-semibold">{fmtIDR(claim.totalApproved)}</span> · Non-re {fmtIDR(claim.totalNonRe)}
                </p>
              </div>
              {claim.approval?.status === "InProgress" && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                  Approval berjenjang: jenjang {claim.approval.currentLevel} dari {claim.approval.totalLevels} — menunggu keputusan {claim.approval.currentApprover ?? "jenjang berikutnya"}.
                  {action === "approve" && claim.approval.currentLevel < claim.approval.totalLevels && " Setujui jenjang ini untuk maju ke jenjang berikutnya."}
                </p>
              )}
              {action === "settle" && (
                <p className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs leading-relaxed text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-300">
                  Settle akan: (1) membuat jurnal otomatis Debit 5106 Beban Kesejahteraan Medis / Credit 1101 Kas,
                  (2) menambah saldo terpakai sebesar approved ({fmtIDR(claim.totalApproved)}).
                </p>
              )}
              <div className="space-y-1.5">
                <Label>Alasan (padanan &quot;Enter Reason&quot;)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="mis. sesuai kwitansi & surat rujukan" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Batal</Button>
            {(action === "settle"
              ? perms.canOp("medical", "medical-approval", "settle")
              : action === "cancel"
                ? perms.canOp("medical", "medical-claim", "cancel")
                : perms.canOp("medical", "medical-approval", "approve")) && (
              <Button onClick={run} disabled={busy} className={actionMeta.tone}>
                {busy ? "Memproses…" : actionMeta.label}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* dialog transfer sisa saldo */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 ov-text-accent" /> Tarik Sisa Saldo → Payroll (UMC)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Padanan <span className="font-semibold">&quot;Paid to employee in cash at end of period with Wage Code&quot;</span>:
              sisa saldo jenis dengan kebijakan <span className="font-semibold">CASH</span> (mis. Rawat Jalan)
              dibayarkan tunai ke karyawan melalui komponen upah <span className="font-semibold">UMC</span> di period payroll terpilih.
            </p>
            <div className="space-y-1.5">
              <Label>Tahun Saldo</Label>
              <Input type="number" value={transferYear} onChange={(e) => setTransferYear(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Period Payroll Target *</Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger><SelectValue placeholder="Pilih period terbuka" /></SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Batal</Button>
            <Button onClick={transfer} disabled={busy}>
              {busy ? "Mentransfer…" : "Transfer ke Payroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
