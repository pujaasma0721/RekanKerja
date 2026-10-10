"use client";
// RekanKerja ESS F1-REC — Approval PR (padanan oranHR
// MyPersonnelRequisitionToApprove): kotak keputusan PR yang menunggu aktor.
import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, CheckCircle2, XCircle, Inbox } from "lucide-react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ESS_BASE } from "./ess-api";
import {
  PR_EMPLOYMENT_LABEL, PR_EMPLOYMENT_LABEL_EN,
} from "@/rekankerja/recruitment/components/recruitment-types";

interface ToApproveRow {
  id: string; prNo: string; requestDate: string;
  requesterName: string; requesterNo: string;
  positionTitle: string | null; requiredNo: number;
  employmentStatus: string; reason: string | null;
  earliestDate: string | null; latestDate: string | null;
  approval: { level: number; total: number } | null;
}

export function EssPrApprovalPage() {
  const { t, locale } = useI18n();
  const api = useApi<{ requests: ToApproveRow[] }>(`${ESS_BASE}/pr-to-approve`, [ESS_BASE]);
  const rows = api.data?.requests ?? [];

  const [decide, setDecide] = useState<{ row: ToApproveRow; action: "approve" | "reject" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submitDecide = async () => {
    if (!decide) return;
    if (decide.action === "reject" && !note.trim()) {
      toast.error(t("Alasan penolakan wajib diisi", "A rejection note is required"));
      return;
    }
    setBusy(true);
    try {
      const res = await apiSend<{ prNo: string; status: string; final: boolean; approval: { level: number; total: number; currentApproverName: string | null } | null }>(
        `${ESS_BASE}/pr-to-approve`, "PATCH", { id: decide.row.id, action: decide.action, note: note.trim() || undefined },
      );
      if (decide.action === "approve" && !res.final && res.approval) {
        toast.success(t(
          `PR ${res.prNo} disetujui jenjang ini — lanjut ke ${res.approval.currentApproverName ?? "approver berikutnya"}`,
          `Requisition ${res.prNo} approved at this tier — forwarded to ${res.approval.currentApproverName ?? "the next approver"}`,
        ));
      } else {
        toast.success(decide.action === "approve"
          ? t(`PR ${res.prNo} DISETUJUI`, `Requisition ${res.prNo} APPROVED`)
          : t(`PR ${res.prNo} DITOLAK`, `Requisition ${res.prNo} REJECTED`));
      }
      setDecide(null);
      setNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Keputusan gagal diproses", "Failed to process the decision"));
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={t("ESS · Rekrutmen")}
        title={t("Approval Permintaan Karyawan", "Personnel Requisition Approval")}
        description={t(
          "Permintaan karyawan yang menunggu keputusan Anda sebagai approver jenjang berjalan (termasuk delegasi aktif).",
          "Personnel requisitions awaiting your decision as the current-tier approver (active delegations included).",
        )}
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Inbox className="h-3 w-3" aria-hidden />
            {t("{n} PR menunggu keputusan Anda", "{n} requisitions awaiting your decision", { n: String(rows.length) })}
          </p>

          {api.loading && !api.data ? (
            <LoadingRows rows={3} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat kotak approval", "Failed to load the approval inbox")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t("Tidak ada PR yang menunggu Anda", "No requisitions awaiting you")}
              description={t("Semua permintaan karyawan di zona Anda sudah diputuskan.", "All requisitions in your zone have been decided.")}
            />
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-700 dark:bg-slate-800/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-xs font-semibold">{r.prNo}</span>
                      {r.approval && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                          {t("jenjang", "tier")} {r.approval.level}/{r.approval.total}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {new Date(r.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400"
                        onClick={() => { setDecide({ row: r, action: "approve" }); setNote(""); }}>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Setujui", "Approve")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1 border-rose-300 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-400"
                        onClick={() => { setDecide({ row: r, action: "reject" }); setNote(""); }}>
                        <XCircle className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 text-sm">
                    <span className="font-semibold">{r.requesterName}</span>
                    <span className="text-slate-400"> ({r.requesterNo})</span>
                  </div>
                  <div className="text-sm font-semibold">{r.positionTitle ?? "—"}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                    {t("{n} orang", "{n} headcount", { n: String(r.requiredNo) })} · {t(PR_EMPLOYMENT_LABEL[r.employmentStatus] ?? r.employmentStatus, PR_EMPLOYMENT_LABEL_EN[r.employmentStatus] ?? r.employmentStatus)}
                    {(r.earliestDate || r.latestDate) ? ` · ${t("jendela", "window")}: ${r.earliestDate ?? "—"} → ${r.latestDate ?? "…"}` : ""}
                  </div>
                  {r.reason && <p className="mt-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11.5px] italic text-slate-500 dark:bg-slate-900 dark:text-slate-400">{r.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* dialog keputusan */}
      <Dialog open={decide != null} onOpenChange={(o) => { if (!o) setDecide(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2", decide?.action === "reject" && "text-rose-600 dark:text-rose-400")}>
              {decide?.action === "approve" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
              {decide?.action === "approve"
                ? t("Setujui PR {no}?", "Approve PR {no}?", { no: decide.row.prNo })
                : t("Tolak PR {no}?", "Reject PR {no}?", { no: decide?.row.prNo ?? "" })}
            </DialogTitle>
          </DialogHeader>
          {decide && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="text-sm font-semibold">{decide.row.requesterName} — {decide.row.positionTitle ?? "—"}</div>
                <div className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  {t("{n} orang", "{n} headcount", { n: String(decide.row.requiredNo) })}
                  {decide.row.approval ? ` · ${t("jenjang", "tier")} ${decide.row.approval.level}/${decide.row.approval.total}` : ""}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{decide.action === "reject" ? t("Alasan penolakan *", "Rejection reason *") : t("Catatan (opsional)", "Note (optional)")}</Label>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecide(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submitDecide} disabled={busy}
              className={decide?.action === "reject" ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}>
              {busy ? t("Memproses…", "Processing…") : decide?.action === "approve" ? t("Setujui", "Approve") : t("Tolak", "Reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
