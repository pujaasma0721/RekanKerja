"use client";
// OneVity Travel — Persetujuan Permintaan: antrean Approve/Reject/Cancel
// (padanan TravelRequestToApprove.jsp + Operation menu)
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
import { toast } from "sonner";
import { TravelRequestRowUI, TRAVEL_STATUS_LABEL, TRAVEL_STATUS_LABEL_EN, fmtIDR, fmtDateID } from "./travel-types";
import { CheckCircle2, XCircle, Ban, Search, Inbox, MapPin, Wallet, Globe2, Clock } from "lucide-react";
import { useI18n } from "@/onevity/shared/lib/i18n";

interface DecideDialogState {
  request: TravelRequestRowUI | null;
  action: "approve" | "reject" | "cancel" | null;
}

export function TravelApprovalPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DecideDialogState>({ request: null, action: null });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const api = useApi<{ requests: TravelRequestRowUI[]; stats: { submitted: number; approved: number; withClaim: number; overdueSettlement: number; advanceTotal: number } }>(
    "/api/onevity/travel/requests?status=Submitted",
  );

  const pending = useMemo(() => (api.data?.requests ?? []).filter((r) =>
    !query || r.fullName.toLowerCase().includes(query.toLowerCase()) || r.docNo.toLowerCase().includes(query.toLowerCase()),
  ), [api.data, query]);

  const decided = useApi<{ requests: TravelRequestRowUI[] }>("/api/onevity/travel/requests?status=all");
  const recent = useMemo(
    () => (decided.data?.requests ?? []).filter((r) => ["Approved", "Rejected", "Cancelled"].includes(r.status)).slice(0, 8),
    [decided.data],
  );

  const submitDecision = async () => {
    if (!dialog.request || !dialog.action) return;
    setBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string; approval?: { currentLevel: number; totalLevels: number; currentApprover: string | null } }>("/api/onevity/travel/requests", "PATCH", {
        id: dialog.request.id, action: dialog.action, note: note || undefined,
      });
      if (res.approval) {
        // approval parsial — jenjang menengah disetujui, request tetap menunggu jenjang berikutnya
        toast.success(t("Jenjang {a}/{b} disetujui — menunggu {who}", "Tier {a}/{b} approved — awaiting {who}", { a: res.approval.currentLevel - 1, b: res.approval.totalLevels, who: res.approval.currentApprover ?? t("jenjang berikutnya", "the next tier") }));
      } else {
        toast.success(t("{no} — {status}", "{no} — {status}", { no: res.docNo, status: t(TRAVEL_STATUS_LABEL[res.status] ?? res.status, TRAVEL_STATUS_LABEL_EN[res.status] ?? res.status) }));
      }
      setDialog({ request: null, action: null });
      setNote("");
      api.refresh();
      decided.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses keputusan", "Failed to process decision"));
    } finally { setBusy(false); }
  };

  const stats = api.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL TRAVEL", "TRAVEL MODULE")}
        title={t("Persetujuan Perjalanan Dinas", "Business Travel Approval")}
        description={t("Antrean permintaan travel menunggu keputusan — padanan Travel Request Approval (24 antrean MII) dengan operasi Approve / Reject / Cancel", "Queue of travel requests awaiting a decision — Travel Request Approval equivalent (24 MII queues) with Approve / Reject / Cancel operations")}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card className="border-amber-200 bg-amber-50/60 shadow-sm dark:border-amber-800 dark:bg-amber-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">{t("Menunggu Keputusan", "Awaiting Decision")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{stats?.submitted ?? "—"}</p>
            </div>
            <Inbox className="h-7 w-7 text-amber-600" />
          </CardContent>
        </Card>
        <Card className="border-teal-200 bg-teal-50/60 shadow-sm dark:border-teal-800 dark:bg-teal-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">{t("Uang Muka Menunggu", "Pending Advances")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{stats ? fmtIDR(stats.advanceTotal) : "—"}</p>
            </div>
            <Wallet className="h-7 w-7 text-teal-600" />
          </CardContent>
        </Card>
        <Card className="border-rose-200 bg-rose-50/60 shadow-sm dark:border-rose-800 dark:bg-rose-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">{t("Telat Settlement", "Overdue Settlement")}</p>
              <p className="text-2xl font-black text-stone-900 dark:text-stone-100">{stats?.overdueSettlement ?? "—"}</p>
            </div>
            <Clock className="h-7 w-7 text-rose-600" />
          </CardContent>
        </Card>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">{t("Antrean Persetujuan", "Approval Queue")}</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Cari antrean…", "Search queue…")} className="w-52 pl-9 text-sm" />
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {api.loading && !api.data ? (
          <div className="lg:col-span-2"><LoadingRows rows={4} /></div>
        ) : pending.length === 0 ? (
          <div className="lg:col-span-2">
            <Card className="border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
              <CardContent className="p-0">
                <EmptyState icon={CheckCircle2} title={t("Semua permintaan sudah diputuskan", "All requests have been decided")} description={t("Tidak ada antrean persetujuan travel saat ini.", "No travel approval queue at the moment.")} />
              </CardContent>
            </Card>
          </div>
        ) : (
          pending.map((r) => (
            <Card key={r.id} className="border-stone-200 bg-white/80 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900/80">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold ov-text-accent">{r.docNo}</p>
                    <p className="mt-0.5 truncate text-sm font-bold text-stone-900 dark:text-stone-100">{r.fullName}</p>
                    <p className="text-[11px] text-stone-500">{r.employeeNo}{r.orgUnitName ? ` · ${r.orgUnitName}` : ""}{r.costCenter ? ` · CC ${r.costCenter}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusPill status={t(TRAVEL_STATUS_LABEL[r.status] ?? r.status, TRAVEL_STATUS_LABEL_EN[r.status] ?? r.status)} />
                    {r.approval?.status === "InProgress" && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                        {t("Jenjang {a}/{b}", "Tier {a}/{b}", { a: r.approval.currentLevel, b: r.approval.totalLevels })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-xs">
                  <p className="rounded-lg bg-stone-50 px-3 py-2 leading-relaxed text-stone-700 dark:bg-stone-800/60 dark:text-stone-300">{r.purpose}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.destinations.map((d, i) => (
                      <Badge key={i} variant="outline" className="gap-1 text-[10px] font-semibold">
                        <MapPin className="h-2.5 w-2.5" /> {d.city}
                        {d.overseas && <Globe2 className="h-2.5 w-2.5 text-teal-600" />}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                    <span>{fmtDateID(r.dateFrom)} → {fmtDateID(r.dateTo)} {t("({n} hari)", "({n} days)", { n: r.days })}</span>
                    <span className="font-semibold">{r.templateName}</span>
                    {r.advanceAmount > 0 && <span className="font-bold text-amber-700 dark:text-amber-400">{t("Muka {amt}", "Advance {amt}", { amt: fmtIDR(r.advanceAmount) })}</span>}
                  </div>
                  {r.approval?.status === "InProgress" && (
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span className="truncate">{t("Menunggu jenjang {a}/{b} — {who}", "Awaiting tier {a}/{b} — {who}", { a: r.approval.currentLevel, b: r.approval.totalLevels, who: r.approval.currentApprover ?? t("approver jenjang berikutnya", "the next-tier approver") })}</span>
                    </p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.canOp("travel", "travel-approval", "approve") && (
                    <>
                      <Button
                        size="sm" className="h-8 gap-1.5 bg-teal-600 text-xs font-bold hover:bg-teal-700"
                        onClick={() => { setDialog({ request: r, action: "approve" }); setNote(""); }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("Setujui", "Approve")}
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-700"
                        onClick={() => { setDialog({ request: r, action: "reject" }); setNote(""); }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                      </Button>
                    </>
                  )}
                  {perms.canOp("travel", "travel-request", "cancel") && (
                    <Button
                      size="sm" variant="ghost" className="h-8 gap-1.5 text-xs font-bold text-stone-500"
                      onClick={() => { setDialog({ request: r, action: "cancel" }); setNote(""); }}
                    >
                      <Ban className="h-3.5 w-3.5" /> {t("Batalkan", "Cancel")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {recent.length > 0 && (
        <Card className="mt-6 border-stone-200 bg-white/80 shadow-sm dark:border-stone-800 dark:bg-stone-900/80">
          <CardContent className="p-0">
            <div className="border-b border-stone-100 px-4 py-3 text-sm font-black uppercase tracking-wide text-stone-500 dark:border-stone-800">
              {t("Keputusan Terbaru", "Recent Decisions")}
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="border-b border-stone-50 last:border-0 dark:border-stone-800/60">
                      <td className="px-4 py-2 font-mono font-bold ov-text-accent">{r.docNo}</td>
                      <td className="px-2 py-2 font-semibold text-stone-700 dark:text-stone-300">{r.fullName}</td>
                      <td className="hidden px-2 py-2 text-stone-500 sm:table-cell">{r.destinations.map((d) => d.city).join(" → ")}</td>
                      <td className="px-2 py-2"><StatusPill status={t(TRAVEL_STATUS_LABEL[r.status] ?? r.status, TRAVEL_STATUS_LABEL_EN[r.status] ?? r.status)} /></td>
                      <td className="hidden px-2 py-2 text-stone-500 md:table-cell">{r.decisionNote ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-stone-400">{r.decidedAt ? fmtDateID(r.decidedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(dialog.request)} onOpenChange={(o) => !o && setDialog({ request: null, action: null })}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog.action === "approve" ? <CheckCircle2 className="h-5 w-5 text-teal-600" /> : dialog.action === "reject" ? <XCircle className="h-5 w-5 text-rose-600" /> : <Ban className="h-5 w-5 text-stone-500" />}
              {dialog.action === "approve" ? t("Setujui Permintaan", "Approve Request") : dialog.action === "reject" ? t("Tolak Permintaan", "Reject Request") : t("Batalkan Permintaan", "Cancel Request")}
            </DialogTitle>
          </DialogHeader>
          {dialog.request && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-stone-50 p-3 dark:bg-stone-800/60">
                <p className="font-mono text-xs font-bold ov-text-accent">{dialog.request.docNo}</p>
                <p className="mt-1 font-bold text-stone-900 dark:text-stone-100">{dialog.request.fullName}</p>
                <p className="text-xs text-stone-500">{dialog.request.destinations.map((d) => d.city).join(" → ")} · {t("{n} hari", "{n} days", { n: dialog.request.days })}</p>
                {dialog.request.advanceAmount > 0 && (
                  <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-400">{t("Uang muka {amt} akan dicairkan", "Advance of {amt} will be disbursed", { amt: fmtIDR(dialog.request.advanceAmount) })}</p>
                )}
              </div>
              {dialog.request.approval?.status === "InProgress" && (
                <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                  {t("Approval berjenjang: jenjang {a} dari {b} — menunggu keputusan {who}.", "Tiered approval: tier {a} of {b} — awaiting decision from {who}.", { a: dialog.request.approval.currentLevel, b: dialog.request.approval.totalLevels, who: dialog.request.approval.currentApprover ?? t("jenjang berikutnya", "the next tier") })}
                  {dialog.action === "approve" && dialog.request.approval.currentLevel < dialog.request.approval.totalLevels && t(" Setujui jenjang ini untuk maju ke jenjang berikutnya.", " Approve this tier to advance to the next tier.")}
                </p>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold">{t("Catatan keputusan (opsional)", "Decision note (optional)")}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={t("Mis. Disetujui — sertakan laporan audit", "e.g. Approved — attach the audit report")} className="text-sm" />
              </div>
              {dialog.action === "approve" && (
                <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-700 dark:bg-teal-950/30 dark:text-teal-400">
                  {t("Setelah disetujui: karyawan berangkat → klaim settlement dibuat dari permintaan ini (jatuh tempo {due}).", "After approval: the employee departs → a settlement claim is created from this request (due {due}).", { due: dialog.request.settlementDue ? fmtDateID(dialog.request.settlementDue) : t("14 hari setelah kembali", "14 days after return") })}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog({ request: null, action: null })} className="font-bold">{t("Batal")}</Button>
            {(dialog.action === "cancel" ? perms.canOp("travel", "travel-request", "cancel") : perms.canOp("travel", "travel-approval", "approve")) && (
              <Button
                onClick={submitDecision} disabled={busy}
                className={
                  dialog.action === "approve"
                    ? "gap-2 bg-teal-600 font-bold hover:bg-teal-700"
                    : "gap-2 bg-rose-600 font-bold hover:bg-rose-700"
                }
              >
                {busy ? t("Memproses…", "Processing…") : dialog.action === "approve" ? t("Setujui", "Approve") : dialog.action === "reject" ? t("Tolak", "Reject") : t("Batalkan", "Cancel")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
