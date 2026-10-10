"use client";
// RekanKerja Recruitment F1 — kotak persetujuan PR (padanan
// PersonnelRequisitionToApprove.jsp oranHR). List semua PR Submitted;
// otorisasi keputusan sesungguhnya di engine approval (decide time).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  PR_EMPLOYMENT_LABEL, PR_EMPLOYMENT_LABEL_EN,
  type PrRowUI,
} from "./recruitment-types";
import { CheckCircle2, XCircle, Inbox, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 10;

export function PrApprovalPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      status: "Submitted", limit: String(PAGE_SIZE), offset: String(offset),
      sortBy: "requestDate", sortDir: "asc", // terlama menunggu dulu (SLA-friendly)
    });
    return `/api/rekankerja/recruitment/pr?${sp.toString()}`;
  }, [offset]);

  const api = useApi<{ rows: PrRowUI[]; total: number }>(url, [url]);

  const rows = (api.data?.rows ?? []).filter((r) =>
    !query || r.prNo.toLowerCase().includes(query.toLowerCase()) ||
    r.requesterName.toLowerCase().includes(query.toLowerCase()) ||
    (r.positionTitle ?? "").toLowerCase().includes(query.toLowerCase()),
  );
  const total = api.data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canDecide = perms.canOp("recruitment", "pr-approval", "approve");

  const [decide, setDecide] = useState<{ row: PrRowUI; action: "approve" | "reject" } | null>(null);
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
      const res = await apiSend<{ prNo: string; status: string; final: boolean; approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null }>(
        "/api/rekankerja/recruitment/pr", "PATCH", { id: decide.row.id, action: decide.action, note: note.trim() || undefined },
      );
      if (decide.action === "approve" && !res.final && res.approval) {
        toast.success(t(`PR ${res.prNo} disetujui jenjang ini — lanjut ke ${res.approval.currentApprover ?? "approver berikutnya"}`, `PR ${res.prNo} approved at this tier — forwarded to ${res.approval.currentApprover ?? "the next approver"}`));
      } else {
        toast.success(decide.action === "approve"
          ? t(`PR ${res.prNo} DISETUJUI`, `PR ${res.prNo} APPROVED`)
          : t(`PR ${res.prNo} DITOLAK`, `PR ${res.prNo} REJECTED`));
      }
      setDecide(null);
      setNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Keputusan gagal diproses", "Failed to process the decision"));
    } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Persetujuan")}
        title={t("Approval Permintaan Karyawan", "Personnel Requisition Approval")}
        description={t(
          "Kotak persetujuan PR yang berstatus Menunggu. Keputusan diotorisasi di mesin approval berjenjang — hanya approver jenjang berjalan (atau delegasi aktif) yang dapat memutus.",
          "Approval inbox for pending requisitions. Decisions are authorized by the tiered approval engine — only the current-tier approver (or an active delegate) can decide.",
        )}
      />

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
            <Inbox className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("{n} PR menunggu keputusan", "{n} requisitions awaiting decision", { n: String(total) })}
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={5} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat kotak approval", "Failed to load the approval inbox")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t("Tidak ada PR yang menunggu", "No requisitions pending")}
              description={t("Semua permintaan karyawan sudah diputuskan. Kerja bagus!", "All personnel requisitions have been decided. Great job!")}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Nomor PR", "PR No.")}</TableHead>
                    <TableHead>{t("Pengaju", "Requester")}</TableHead>
                    <TableHead>{t("Posisi / Kebutuhan", "Position / Headcount")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Jendela Kebutuhan", "Need Window")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Jenjang", "Tier")}</TableHead>
                    <TableHead className="text-right">{t("Keputusan", "Decision")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.prNo}
                        <div className="mt-0.5 font-sans text-[11px] font-normal text-slate-500 dark:text-slate-400">
                          {new Date(r.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short" })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.requesterName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.requesterNo}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.positionTitle ?? "—"}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t("{n} orang", "{n} headcount", { n: String(r.requiredNo) })} · {t(PR_EMPLOYMENT_LABEL[r.employmentStatus] ?? r.employmentStatus, PR_EMPLOYMENT_LABEL_EN[r.employmentStatus] ?? r.employmentStatus)}
                          {r.replacedEmployeeName ? ` · ${t("pengganti {n}", "replacing {n}", { n: r.replacedEmployeeName })}` : ""}
                        </div>
                        {r.reason && <div className="mt-1 max-w-xs truncate text-[11px] italic text-slate-400" title={r.reason}>{r.reason}</div>}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        {(r.earliestDate || r.latestDate) ? (
                          <div>
                            {r.earliestDate ? new Date(r.earliestDate).toLocaleDateString(locale, { day: "2-digit", month: "short" }) : "—"} →{" "}
                            {r.latestDate ? new Date(r.latestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }) : "…"}
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {r.approval ? (
                          <div className="text-xs">
                            <span className="font-semibold">{r.approval.currentLevel}/{r.approval.totalLevels}</span>
                            <div className="text-slate-500 dark:text-slate-400">{r.approval.currentApprover ?? "—"}</div>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canDecide && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                              onClick={() => { setDecide({ row: r, action: "approve" }); setNote(""); }}>
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Setujui", "Approve")}
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
                              onClick={() => { setDecide({ row: r, action: "reject" }); setNote(""); }}>
                              <XCircle className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t("Halaman {p} dari {n}", "Page {p} of {n}", { p: String(page), n: String(pages) })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog keputusan + catatan */}
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
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="font-medium">{decide.row.requesterName} — {decide.row.positionTitle ?? "—"}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("{n} orang", "{n} headcount", { n: String(decide.row.requiredNo) })} · {t(PR_EMPLOYMENT_LABEL[decide.row.employmentStatus] ?? decide.row.employmentStatus, PR_EMPLOYMENT_LABEL_EN[decide.row.employmentStatus] ?? decide.row.employmentStatus)}
                  {decide.row.approval ? ` · ${t("jenjang", "tier")} ${decide.row.approval.currentLevel}/${decide.row.approval.totalLevels}` : ""}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{decide.action === "reject" ? t("Alasan penolakan *", "Rejection reason *") : t("Catatan (opsional)", "Note (optional)")}</Label>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder={decide.action === "reject" ? t("Jelaskan mengapa PR ditolak…", "Explain why the requisition is rejected…") : t("Catatan untuk pemohon…", "Note to the requester…")} />
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
