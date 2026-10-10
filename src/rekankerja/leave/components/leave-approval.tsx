"use client";
// RekanKerja Leave — Persetujuan: Approve | Reject | Cancel (padanan LeaveRequestToApprove.jsp
// menu Operation). Approve → hari cuti masuk rekap absensi (OnLeave).
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { RequestRowUI, LEAVE_STATUS_LABEL, LEAVE_STATUS_LABEL_EN, SESSION_LABEL, SESSION_LABEL_EN, fmtDay } from "./leave-types";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { type AdvSearch, type AdvFieldDef, txt, num, dt, sel, filterRowsByAdv } from "@/rekankerja/shared/lib/adv-search";
import { CheckCircle2, XCircle, Ban, Inbox, Search, CalendarClock, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

type Action = "approve" | "reject" | "cancel";

/** Task adv-search — field Advance Search antrean approval cuti (client-side,
 *  filter TAMBAHAN di atas query yang sudah ada). */
const ADV_FIELDS: AdvFieldDef<RequestRowUI>[] = [
  txt("docNo", "Dokumen", "Document"),
  txt("employeeNo", "No. Karyawan", "Employee No."),
  txt("fullName", "Nama Karyawan", "Employee Name"),
  txt("leaveTypeName", "Jenis", "Type"),
  dt("dateFrom", "Tanggal Mulai", "Start Date"),
  num("workingDays", "Hari Kerja", "Working Days"),
  sel("status", "Status", "Status", (["Submitted", "Approved", "MassLeave", "Rejected", "Cancelled"] as const).map((k): [string, string, string] => [k, LEAVE_STATUS_LABEL[k] ?? k, LEAVE_STATUS_LABEL_EN[k] ?? k])),
];

export function LeaveApprovalPage() {
  const { navigate } = useNav();
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [query, setQuery] = useState("");
  // Task adv-search — kondisi advance search (filter tambahan di atas query).
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [target, setTarget] = useState<RequestRowUI | null>(null);
  const [action, setAction] = useState<Action>("approve");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useApi<{ requests: RequestRowUI[]; stats: { submitted: number; pendingDays: number } }>(
    "/api/rekankerja/leave/requests?status=Submitted",
  );

  const requests = useMemo(() => filterRowsByAdv((api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase())
  ), adv, ADV_FIELDS), [api.data, query, adv]);

  // Task 99 (F2-1) — bendera risiko pola cuti per baris Submitted (padanan
  // panel "Anomali terdeteksi" travel approval; bantuan approver ala Bradford).
  const riskBadges = (r: RequestRowUI): { label: string; tone: "amber" | "rose" }[] => {
    if (!r.risk) return [];
    const out: { label: string; tone: "amber" | "rose" }[] = [];
    if (r.risk.mondayFriday >= 2) {
      out.push({ label: t("Pola Senin/Jumat ×{n}", "Monday/Friday pattern ×{n}", { n: r.risk.mondayFriday }), tone: "amber" });
    }
    if (r.risk.shortLeaves60d >= 3) {
      out.push({ label: t("Cuti pendek sering ×{n}/60hr", "Frequent short leaves ×{n}/60d", { n: r.risk.shortLeaves60d }), tone: "amber" });
    }
    if (r.risk.monthsSinceLastAnnual === null) {
      out.push({ label: t("Belum pernah cuti tahunan", "Never taken annual leave"), tone: "rose" });
    } else if (r.risk.monthsSinceLastAnnual >= 6) {
      out.push({ label: t("Tanpa cuti tahunan {n} bln", "Without annual leave {n} mo", { n: r.risk.monthsSinceLastAnnual }), tone: "rose" });
    }
    return out;
  };

  const openDialog = (r: RequestRowUI, a: Action) => {
    setTarget(r);
    setAction(a);
    setNote(a === "approve" ? "Disetujui" : a === "reject" ? "" : "Dibatalkan pemberi kuasa");
  };

  const decide = async () => {
    if (!target) return;
    if (action === "reject" && !note.trim()) { toast.error(t("Alasan penolakan wajib diisi", "Rejection reason is required")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; regeneratedDays: number; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>(
        "/api/rekankerja/leave/requests", "PATCH", { id: target.id, action, note },
      );
      if (res.approval) {
        // approval parsial — jenjang menengah disetujui, dokumen tetap menunggu jenjang berikutnya
        toast.success(t("Jenjang {l}/{n} disetujui — menunggu {a}", "Tier {l}/{n} approved — awaiting {a}", { l: res.approval.currentLevel - 1, n: res.approval.totalLevels, a: res.approval.currentApprover ?? t("jenjang berikutnya", "the next tier") }));
      } else {
        toast.success(
          res.status === "Approved"
            ? t("{doc} disetujui — {d} hari rekap absensi diperbarui (OnLeave)", "{doc} approved — {d} days of the attendance recap updated (OnLeave)", { doc: res.docNo, d: res.regeneratedDays })
            : t("{doc} → {s}", "{doc} → {s}", { doc: res.docNo, s: t(LEAVE_STATUS_LABEL[res.status] ?? res.status, LEAVE_STATUS_LABEL_EN[res.status]) }),
        );
      }
      setTarget(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses keputusan", "Failed to process the decision"));
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  // kolom Approval hanya tampil bila ada row dengan chain aktif/ditolak (Task 25)
  const hasChain = requests.some((r) => r.approval && (r.approval.status === "InProgress" || r.approval.status === "Rejected"));

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL LEAVE", "LEAVE MODULE")}
        title={t("Persetujuan Cuti", "Leave Approval")}
        description={t("Keputusan permintaan cuti menunggu — Approve / Reject / Cancel (padanan Operation); hari cuti otomatis masuk rekap absensi", "Decisions on pending leave requests — Approve / Reject / Cancel (Operation equivalent); leave days automatically flow into the attendance recap")}
        actions={
          <Button variant="outline" onClick={() => navigate("leave", "leave-request")} className="gap-2 font-bold">
            <Inbox className="h-4 w-4" /> {t("Lihat Semua Permintaan", "View All Requests")}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: t("Menunggu Keputusan", "Awaiting Decision"), value: stats?.submitted ?? 0, sub: t("permintaan cuti", "leave requests"), icon: Inbox, hero: true },
          { label: t("Total Hari Diminta", "Total Days Requested"), value: stats?.pendingDays ?? 0, sub: t("akumulasi hari kerja", "working days accumulated"), icon: CalendarClock },
          { label: t("Efek Approve", "Approve Effect"), value: "OnLeave", sub: t("status rekap absensi", "attendance recap status"), icon: ShieldCheck },
          // Task 99 (F2-1) — pakai bendera needDocs dari master jenis cuti
          // (sebelumnya heuristik prefix kode CT-MATI/NIKAH/KHITAN).
          { label: t("Dokumen Wajib", "Required Documents"), value: String(requests.filter((r) => r.needDocs).length), sub: t("jenis butuh dokumen — verifikasi", "types need documents — verify"), icon: CheckCircle2 },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <div className={cn("rounded-lg p-1.5", k.hero ? "ov-fill" : "ov-tile")}><Icon className="h-3.5 w-3.5" /></div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{k.label}</p>
              </div>
              <p className="mt-1.5 text-lg font-extrabold text-slate-800 dark:text-slate-100">{k.value}</p>
              <p className="text-[11px] text-slate-400">{k.sub}</p>
            </div>
          );
        })}
      </div>

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{t("Permintaan berstatus Menunggu — urut terbaru", "Requests in Pending status — newest first")}</p>
            <div className="flex items-center gap-2">
              <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={setAdv} />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("Cari karyawan / no. dokumen…", "Search employee / doc no. …")}
                  className="h-8 w-56 rounded-md border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none focus:ov-border-accent dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>
          </div>
          {api.loading && !api.data ? <div className="p-5"><LoadingRows rows={6} /></div> : requests.length === 0 ? (
            <div className="p-5"><EmptyState title={t("Tidak ada permintaan menunggu", "No pending requests")} description={t("Semua permintaan cuti sudah diproses — kerja bagus!", "All leave requests have been processed — great job!")} icon={<CheckCircle2 className="h-6 w-6" />} /></div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                    <TableHead className="text-[11px] font-bold">{t("Dokumen", "Document")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Karyawan")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Jenis & Alasan", "Type & Reason")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Rentang", "Range")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Hari", "Days")}</TableHead>
                    <TableHead className="text-right text-[11px] font-bold">{t("Sisa Saldo", "Remaining Balance")}</TableHead>
                    {hasChain && <TableHead className="text-[11px] font-bold">{t("Approval")}</TableHead>}
                    <TableHead className="w-44" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">{r.docNo}</p>
                        <p className="text-[10px] text-slate-400">{t("diajukan", "submitted")} {new Date(r.requestDate).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "2-digit" })}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{r.employeeNo}</p>
                        <p className="text-[10px] text-slate-400">{r.fullName}</p>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs text-slate-700 dark:text-slate-200">{r.leaveTypeName}</p>
                        <p className="max-w-52 truncate text-[10px] text-slate-400" title={r.reason ?? ""}>{r.reason}</p>
                        {(() => {
                          const badges = riskBadges(r);
                          return badges.length > 0 ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1" title={t("Sinyal pola cuti — periksa sebelum menyetujui", "Leave-pattern signals — review before approving")}>
                              <ShieldAlert className="h-3 w-3 shrink-0 text-amber-500" />
                              {badges.map((b) => (
                                <span key={b.label} className={cn("inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-bold",
                                  b.tone === "amber"
                                    ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                    : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400")}>
                                  {b.label}
                                </span>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </TableCell>
                      <TableCell className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                        {new Date(r.dateFrom).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionFrom], SESSION_LABEL_EN[r.sessionFrom])} → {new Date(r.dateTo).toLocaleDateString(locale, { day: "2-digit", month: "short" })} {t(SESSION_LABEL[r.sessionTo], SESSION_LABEL_EN[r.sessionTo])}
                        <span className="block text-[10px] font-normal text-slate-400">
                          {t("kembali", "back")} {r.backToWorkDate ? new Date(r.backToWorkDate).toLocaleDateString(locale, { day: "2-digit", month: "short" }) : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtDay(r.workingDays)}</TableCell>
                      <TableCell className={cn("text-right text-xs font-bold tabular-nums", r.remainingAtRequest < 0 ? "text-rose-600" : "text-slate-500")}>{fmtDay(r.remainingAtRequest)}</TableCell>
                      {hasChain && (
                        <TableCell>
                          {r.approval && (r.approval.status === "InProgress" || r.approval.status === "Rejected") ? (
                            <div className="space-y-0.5">
                              <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
                                r.approval.status === "InProgress"
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400")}>
                                {r.approval.status === "InProgress" ? t("Jenjang", "Tier") : t("Ditolak di", "Rejected at")} {r.approval.currentLevel}/{r.approval.totalLevels}
                              </span>
                              {r.approval.status === "InProgress" && r.approval.currentApprover && (
                                <p className="max-w-40 truncate text-[10px] text-slate-400" title={r.approval.currentApprover}>{t("menunggu", "awaiting")} {r.approval.currentApprover}</p>
                              )}
                            </div>
                          ) : null}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex gap-1">
                          {perms.canOp("leave", "leave-approval", "approve") && (
                            <>
                              <Button size="sm" onClick={() => openDialog(r, "approve")} className="h-7 gap-1 bg-brand text-[11px] font-bold hover:bg-brand/70">
                                <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openDialog(r, "reject")} className="h-7 gap-1 border-rose-200 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:hover:bg-rose-950/40">
                                <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                              </Button>
                            </>
                          )}
                          {perms.canOp("leave", "leave-request", "cancel") && (
                            <Button size="sm" variant="ghost" onClick={() => openDialog(r, "cancel")} className="h-7 text-[11px] font-bold text-slate-400" title={t("Batalkan", "Cancel")}>
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
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

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2 text-sm",
              action === "approve" ? "text-brand-deep dark:text-brand/85" : action === "reject" ? "text-rose-600" : "text-slate-500")}>
              {action === "approve" ? <CheckCircle2 className="h-4 w-4" /> : action === "reject" ? <XCircle className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              {action === "approve" ? t("Setujui Permintaan Cuti", "Approve Leave Request") : action === "reject" ? t("Tolak Permintaan Cuti", "Reject Leave Request") : t("Batalkan Permintaan Cuti", "Cancel Leave Request")}
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-900/60">
                <p className="font-bold text-slate-800 dark:text-slate-100">{target.docNo} — {target.fullName}</p>
                <p className="mt-0.5 text-slate-500">
                  {target.leaveTypeName} · {new Date(target.dateFrom).toLocaleDateString(locale)} {t(SESSION_LABEL[target.sessionFrom], SESSION_LABEL_EN[target.sessionFrom])} → {new Date(target.dateTo).toLocaleDateString(locale)} {t(SESSION_LABEL[target.sessionTo], SESSION_LABEL_EN[target.sessionTo])} · {fmtDay(target.workingDays)} {t("hari kerja", "working days")}
                </p>
                <p className="mt-0.5 text-slate-400">{t("Alasan:", "Reason:")} {target.reason}</p>
              </div>
              {action === "approve" && (
                <div className="flex items-start gap-2 rounded-lg bg-brand/10 p-2.5 text-[11px] leading-relaxed text-brand-deep dark:bg-brand/30 dark:text-brand/85">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>{t("Saat disetujui: saldo (g· terpakai mendatang) diperbarui, dan rekap absensi rentang cuti dihitung ulang menjadi ", "When approved: the balance (g· upcoming taken) is updated, and the attendance recap for the leave range is recalculated as ")}<b>OnLeave</b>{t(" (dibayar bila jenis cuti dibayar).", " (paid if the leave type is paid).")}</p>
                </div>
              )}
              {target.approval?.status === "InProgress" && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                  <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    {t("Approval berjenjang: jenjang", "Tiered approval: tier")} <b>{target.approval.currentLevel}</b> {t("dari", "of")} <b>{target.approval.totalLevels}</b> — {t("menunggu keputusan", "awaiting decision by")} <b>{target.approval.currentApprover ?? t("jenjang berikutnya", "the next tier")}</b>.{" "}
                    {action === "approve" && target.approval.currentLevel < target.approval.totalLevels && " " + t("Setujui jenjang ini untuk maju ke jenjang berikutnya.", "Approve this tier to advance to the next one.")}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{action === "reject" ? t("Alasan Penolakan *", "Rejection Reason *") : t("Catatan Keputusan", "Decision Note")}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={action === "reject" ? t("mis. Bentrok jadwal produksi — usulkan minggu berikutnya", "e.g. Conflicts with the production schedule — propose the following week") : t("Opsional", "Optional")} className="min-h-16 text-xs" />
              </div>
              {action === "reject" && (
                <Badge variant="outline" className="border-rose-200 text-[10px] text-rose-600">{t("Karyawan dapat mengajukan ulang dengan tanggal lain", "The employee can resubmit with different dates")}</Badge>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} className="text-xs font-bold">{t("Batal")}</Button>
            {(action === "cancel" ? perms.canOp("leave", "leave-request", "cancel") : perms.canOp("leave", "leave-approval", "approve")) && (
              <Button
                onClick={decide}
                disabled={busy}
                className={cn("gap-1.5 text-xs font-bold",
                  action === "approve" ? "bg-brand hover:bg-brand/70" : "bg-rose-600 hover:bg-rose-700")}
              >
                {action === "approve" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {action === "approve" ? t("Setujui", "Approve") : action === "reject" ? t("Tolak", "Reject") : t("Batalkan", "Cancel")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
