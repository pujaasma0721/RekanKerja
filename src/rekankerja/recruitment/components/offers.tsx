"use client";
// RekanKerja Recruitment F4 — view "Offer & Pengangkatan": penawaran kerja
// terlacak (nomor OFF, gaji final terenkripsi, timer kedaluwarsa), approval
// offer opsional, respons kandidat (diterima/ditolak + note counter),
// pengangkatan (surat + penolakan batch saat PR fulfilled) + lanjutan ke
// onboarding karyawan baru, dan funnel rekrutmen. Padanan oranHR
// OfferTracking/JoiningProcess + HRX E1/E3/H1 (DEVELOPMENT-PLAN-RECRUITMENT.md
// §7 F4). Dialog di offer-dialogs.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  OFFERS_API,
  type ApprovalInboxRow, type OfferRow, type OfferablePr, type LetterTarget,
  type DecisionTarget, type OfferFormTarget,
  OfferStatusPill, ChainSteps,
  OfferFormDialog, ApprovalChainDialog, DecisionDialog, OfferLetterDialog, AppointFlowDialog,
} from "./offer-dialogs";
import {
  AlarmClock, BadgeCheck, Check, Eye, FileText, Filter, Handshake, ListChecks,
  Pencil, Plus, Send, Trash2, TrendingUp, UserRoundCheck, X,
} from "lucide-react";

interface ListResp {
  rows: OfferRow[];
  stats: Record<string, number>;
  moneyVisible: boolean;
}

interface FunnelStageRow { key: string; label: string; labelEn: string; count: number }
interface FunnelResp {
  funnel: {
    prId: string | null;
    stages: FunnelStageRow[];
    selectionStages: { name: string; processOrder: number | null; reached: number; passed: number }[];
    offerAcceptanceRate: number | null;
  };
}

/** badge countdown expiry — "n hari" (amber/merah ≤3) / "lewat n hari". */
function ExpiryCell({ row }: { row: OfferRow }) {
  const { t } = useI18n();
  const d = row.expiryDate ? fmtDate(row.expiryDate) : "—";
  const n = row.expiresInDays;
  const pending = row.status === "Sent" || row.status === "Viewed";
  if (n == null || !pending) return <span className="tabular-nums">{d}</span>;
  if (n <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400">
        <AlarmClock className="h-3.5 w-3.5" aria-hidden />
        <span className="tabular-nums">{t("lewat {n} hari", "{n} days past", { n: String(-n) })}</span>
      </span>
    );
  }
  if (n <= 3) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{d}</span>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 tabular-nums dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
          {t("{n} hari", "{n} days", { n: String(n) })}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">{d}</span>
      <span className="rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 tabular-nums dark:border-slate-700 dark:text-slate-400">
        {t("{n} hari", "{n} days", { n: String(n) })}
      </span>
    </span>
  );
}

export function OffersPage() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const nav = useNav();

  // ---------- filter state ----------
  const [prFilter, setPrFilter] = useState<string>(""); // "" = semua PR
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // ---------- data ----------
  const listApi = useApi<ListResp>(`${OFFERS_API}?list=1${prFilter ? `&prId=${prFilter}` : ""}`, [prFilter]);
  const optionsApi = useApi<{ prs: OfferablePr[] }>(`${OFFERS_API}?options=1`, []);
  const funnelApi = useApi<FunnelResp>(`${OFFERS_API}?funnel=1${prFilter ? `&prId=${prFilter}` : ""}`, [prFilter]);
  const approvalsApi = useApi<{ rows: ApprovalInboxRow[] }>(`${OFFERS_API}?approvals=1`, []);

  const rows = listApi.data?.rows ?? [];
  const stats = listApi.data?.stats ?? {};
  const prs = optionsApi.data?.prs ?? [];
  const funnel = funnelApi.data?.funnel ?? null;
  const approvalRows = approvalsApi.data?.rows ?? [];
  const selectedPr = prs.find((p) => p.id === prFilter) ?? null;

  // ---------- gating ----------
  const canCreate = perms.can("recruitment", "offers", "create");
  const canUpdate = perms.can("recruitment", "offers", "update");
  const canDelete = perms.can("recruitment", "offers", "delete");
  const canSend = perms.canOp("recruitment", "offers", "op:send");
  const canRespond = perms.canOp("recruitment", "offers", "op:respond");
  const canAppoint = perms.canOp("recruitment", "offers", "op:appoint");

  // ---------- dialog state ----------
  const [formTarget, setFormTarget] = useState<OfferFormTarget | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionTarget | null>(null);
  const [letter, setLetter] = useState<LetterTarget | null>(null);
  const [appointId, setAppointId] = useState<string | null>(null);
  const [letterBusyId, setLetterBusyId] = useState<string | null>(null);

  // ---------- prefill kandidat dari board seleksi (navigate ... {id}) ----------
  const prefillCandidateId = nav.params?.id ?? null;
  const prefillDone = useRef(false);
  useEffect(() => {
    if (!prefillCandidateId || prefillDone.current || optionsApi.loading || prs.length === 0) return;
    prefillDone.current = true;
    const pr = prs.find((p) => p.candidates.some((c) => c.id === prefillCandidateId));
    if (pr) setFormTarget({ mode: "create", prId: pr.id, candidateId: prefillCandidateId });
  }, [prefillCandidateId, optionsApi.loading, prs]);

  // ---------- employeeNo baris ber-pengangkatan (fetch detail malas) ----------
  const [empNos, setEmpNos] = useState<Record<string, string | null>>({});
  const fetchedAppt = useRef<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    const targets = rows.filter((r) => r.hasAppointment && !fetchedAppt.current.has(r.id));
    if (targets.length === 0) return;
    targets.forEach((r) => fetchedAppt.current.add(r.id));
    (async () => {
      for (const r of targets) {
        try {
          const res = await fetch(`${OFFERS_API}?offerId=${r.id}`);
          const d = res.ok ? await res.json() : null;
          if (!alive) return;
          setEmpNos((prev) => ({ ...prev, [r.id]: d?.row?.appointment?.employeeNo ?? null }));
        } catch {
          if (alive) setEmpNos((prev) => ({ ...prev, [r.id]: null }));
        }
      }
    })();
    return () => { alive = false; };
  }, [rows]);

  const refreshAll = () => {
    listApi.refresh(); optionsApi.refresh(); funnelApi.refresh(); approvalsApi.refresh();
    fetchedAppt.current.clear();
    setEmpNos({});
  };

  // ---------- aksi ----------
  const doSend = async (row: OfferRow) => {
    if (!window.confirm(t(
      `Kirim offer ${row.offerNo} ke ${row.candidateName}? Surat penawaran terbit + email/notifikasi. Bila ada struktur approval RecruitmentOffer, offer menunggu persetujuan dulu.`,
      `Send offer ${row.offerNo} to ${row.candidateName}? The offer letter is issued + email/notification. If a RecruitmentOffer approval structure exists, the offer awaits approval first.`,
    ))) return;
    try {
      const res = await apiSend<{ offerNo: string; status: string; sent: boolean; letterNo?: string | null; approvalLevels?: number; firstApprover?: string | null }>(
        OFFERS_API, "POST", { action: "send", id: row.id },
      );
      if (res.sent) {
        toast.success(t(`Offer ${res.offerNo} terkirim — surat ${res.letterNo ?? "-"}`, `Offer ${res.offerNo} sent — letter ${res.letterNo ?? "-"}`));
      } else {
        toast.info(t(
          `Offer ${res.offerNo} menunggu approval (${res.approvalLevels ?? "?"} jenjang) — berikutnya: ${res.firstApprover ?? "-"}`,
          `Offer ${res.offerNo} awaits approval (${res.approvalLevels ?? "?"} level) — next: ${res.firstApprover ?? "-"}`,
        ), { duration: 9000 });
      }
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengirim offer", "Failed to send the offer"));
    }
  };

  const doDelete = async (row: OfferRow) => {
    if (!window.confirm(t(`Hapus offer Draft ${row.offerNo} (${row.candidateName})?`, `Delete Draft offer ${row.offerNo} (${row.candidateName})?`))) return;
    try {
      const res = await apiSend<{ offerNo: string }>(OFFERS_API, "POST", { action: "delete", id: row.id });
      toast.success(t(`Offer ${res.offerNo} dihapus`, `Offer ${res.offerNo} deleted`));
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus offer", "Failed to delete the offer"));
    }
  };

  const doViewed = async (row: OfferRow) => {
    try {
      await apiSend(OFFERS_API, "POST", { action: "viewed", id: row.id });
      toast.success(t(`Offer ${row.offerNo} ditandai sudah dilihat kandidat`, `Offer ${row.offerNo} marked as viewed by the candidate`));
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menandai dilihat", "Failed to mark as viewed"));
    }
  };

  const doApprove = async (row: { id: string; offerNo: string }) => {
    try {
      const res = await apiSend<{ offerNo: string; status: string; sent: boolean; letterNo?: string | null }>(
        OFFERS_API, "POST", { action: "approve", id: row.id },
      );
      if (res.sent) {
        toast.success(t(`Offer ${res.offerNo} disetujui & terkirim — surat ${res.letterNo ?? "-"}`, `Offer ${res.offerNo} approved & sent — letter ${res.letterNo ?? "-"}`));
      } else {
        toast.success(t(`Offer ${res.offerNo} disetujui — menunggu jenjang berikutnya`, `Offer ${res.offerNo} approved — awaiting the next level`));
      }
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyetujui offer", "Failed to approve the offer"));
    }
  };

  /** buka pratinjau surat (letterId hanya tersedia di detail). */
  const openLetter = async (row: OfferRow) => {
    setLetterBusyId(row.id);
    try {
      const res = await fetch(`${OFFERS_API}?offerId=${row.id}`);
      const d = res.ok ? await res.json() : null;
      const r = d?.row as (OfferRow & { letterId: string | null }) | undefined;
      if (r?.letterId) {
        setLetter({
          letterId: r.letterId,
          letterNo: r.letterNo ?? "—",
          offerNo: r.offerNo,
          candidateName: r.candidateName,
          kind: "Offer",
        });
      } else {
        toast.info(t(`Surat offer ${row.offerNo} belum tersedia (terbit saat offer dikirim).`, `No letter for offer ${row.offerNo} yet (issued when the offer is sent).`));
      }
    } catch {
      toast.error(t("Gagal memuat surat", "Failed to load the letter"));
    } finally {
      setLetterBusyId(null);
    }
  };

  // ---------- filter helpers ----------
  const isExpiring = (row: OfferRow): boolean =>
    row.expiresInDays != null && row.expiresInDays > 0 && row.expiresInDays <= 3
    && (row.status === "Sent" || row.status === "Viewed");
  const matchFilter = (row: OfferRow): boolean => {
    if (!statusFilter) return true;
    if (statusFilter === "__expiring") return isExpiring(row);
    return row.status === statusFilter;
  };
  const visibleRows = useMemo(() => rows.filter(matchFilter), [rows, statusFilter]);

  const statChip = (key: string, label: string, labelEn: string, value: number | undefined, opts?: { accent?: boolean; title?: string }) => (
    <button key={key} type="button"
      onClick={() => setStatusFilter(statusFilter === key ? null : key)}
      title={opts?.title}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statusFilter === key
          ? "ov-border-accent ov-soft"
          : opts?.accent
            ? "border-amber-200 bg-amber-50/70 hover:border-amber-300 dark:border-amber-500/30 dark:bg-amber-500/10"
            : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className={cn(
        "mt-0.5 text-xl font-semibold tabular-nums",
        opts?.accent ? "text-amber-700 dark:text-amber-400" : "text-slate-900 dark:text-slate-50",
      )}>{value ?? 0}</div>
    </button>
  );

  // ---------- render tabel ----------
  const rowActions = (row: OfferRow) => {
    const st = row.status;
    return (
      <div className="flex flex-wrap items-center justify-end gap-1">
        {st === "Draft" && (
          <>
            {canUpdate && (
              <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => setFormTarget({ mode: "edit", row })}>
                <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Edit", "Edit")}
              </Button>
            )}
            {canSend && (
              <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => doSend(row)}>
                <Send className="h-3.5 w-3.5" aria-hidden /> {t("Kirim", "Send")}
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => doDelete(row)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("Hapus", "Delete")}
              </Button>
            )}
          </>
        )}
        {st === "PendingApproval" && (
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => setChainId(row.id)}>
              <ListChecks className="h-3.5 w-3.5" aria-hidden /> {t("Jenjang", "Chain")}
            </Button>
            {canSend && (
              <>
                <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => doApprove(row)}>
                  <Check className="h-3.5 w-3.5" aria-hidden /> {t("Setujui", "Approve")}
                </Button>
                <Button variant="outline" size="sm" className="h-8 gap-1 border-rose-200 px-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400" onClick={() => setDecision({ id: row.id, offerNo: row.offerNo, candidateName: row.candidateName, kind: "reject-approval" })}>
                  <X className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                </Button>
              </>
            )}
          </>
        )}
        {st === "Sent" && canRespond && (
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => doViewed(row)}>
            <Eye className="h-3.5 w-3.5" aria-hidden /> {t("Catat Dilihat", "Mark Viewed")}
          </Button>
        )}
        {(st === "Sent" || st === "Viewed") && canRespond && (
          <>
            <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => setDecision({ id: row.id, offerNo: row.offerNo, candidateName: row.candidateName, kind: "accept" })}>
              <Check className="h-3.5 w-3.5" aria-hidden /> {t("Terima", "Accept")}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1 border-rose-200 px-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400" onClick={() => setDecision({ id: row.id, offerNo: row.offerNo, candidateName: row.candidateName, kind: "decline" })}>
              <X className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Decline")}
            </Button>
          </>
        )}
        {st === "Accepted" && canAppoint && !row.hasAppointment && (
          <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => setAppointId(row.id)}>
            <UserRoundCheck className="h-3.5 w-3.5" aria-hidden /> {t("Angkat Kandidat", "Appoint Candidate")}
          </Button>
        )}
        {st === "Accepted" && row.hasAppointment && (
          <Button variant="outline" size="sm" className="h-8 gap-1 border-emerald-200 px-2 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-400" onClick={() => setAppointId(row.id)}>
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {empNos[row.id] ? t("Onboarding / Hasil", "Onboarding / Result") : t("Lanjutkan ke Onboarding", "Continue to Onboarding")}
          </Button>
        )}
        {row.letterNo && (
          <Button variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={letterBusyId === row.id} onClick={() => openLetter(row)}>
            <FileText className="h-3.5 w-3.5" aria-hidden /> {letterBusyId === row.id ? t("…" , "…") : t("Surat", "Letter")}
          </Button>
        )}
      </div>
    );
  };

  // ---------- funnel ----------
  const funnelMax = funnel ? Math.max(...funnel.stages.map((s) => s.count), 1) : 1;
  const stageMax = funnel && funnel.selectionStages.length > 0
    ? Math.max(...funnel.selectionStages.map((s) => s.reached), 1) : 1;

  // ---------- render ----------
  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F4")}
        title={t("Offer & Pengangkatan", "Offers & Appointment")}
        description={t(
          "Penawaran kerja terlacak (nomor OFF, gaji final, timer kedaluwarsa + pengingat), persetujuan offer opsional via Approval Berjenjang, pengangkatan dengan surat + penolakan batch, dan lanjutan ke onboarding karyawan baru.",
          "Trackable job offers (OFF number, final salary, expiry timer + reminders), optional offer approval via layered approval, appointment with letter + batch rejection, and continue-to-onboarding for new employees.",
        )}
        actions={canCreate && prs.length > 0 ? (
          <Button onClick={() => setFormTarget({ mode: "create", prId: prFilter || undefined })} className="ov-fill ov-glow gap-2">
            <Plus className="h-4 w-4" aria-hidden /> {t("Buat Offer", "Create Offer")}
          </Button>
        ) : undefined}
      />

      {/* chips statistik (klik → filter status) */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {statChip("__all", "Total Offer", "Total Offers", stats.total, {
          title: t("klik lagi untuk menghapus filter", "click again to clear the filter"),
        })}
        {statChip("PendingApproval", "Menunggu Approval", "Pending Approval", stats.PendingApproval)}
        {statChip("Sent", "Terkirim", "Sent", stats.Sent)}
        {statChip("Accepted", "Diterima", "Accepted", stats.Accepted)}
        {statChip("Declined", "Ditolak", "Declined", stats.Declined)}
        {statChip("Expired", "Kedaluwarsa", "Expired", stats.Expired)}
        {statChip("__expiring", "Akan Berakhir ≤3 hari", "Expiring ≤3 days", rows.filter(isExpiring).length, {
          accent: true,
          title: t("IncompleteResponse — offer Terkirim/Dilihat berakhir ≤3 hari (pengingat scheduler)", "IncompleteResponse — Sent/Viewed offers expiring within 3 days (scheduler reminders)"),
        })}
      </div>

      {/* kotak approval offer */}
      {approvalRows.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Kotak Approval Offer ({n})", "Offer Approval Inbox ({n})", { n: String(approvalRows.length) })}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("Offer menunggu keputusan Anda — approve jenjang terakhir otomatis mengirim surat ke kandidat.", "Offers awaiting your decision — approving the final level automatically sends the letter to the candidate.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {approvalRows.map((r) => {
              const current = r.approval.steps.find((s) => s.status === "Current") ?? null;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-white/80 p-3 dark:border-amber-500/25 dark:bg-slate-900/70">
                  <span className="font-mono text-xs font-semibold">{r.offerNo}</span>
                  <span className="text-sm font-semibold">{r.candidateName}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{r.prNo}{r.positionTitle ? ` — ${r.positionTitle}` : ""}</span>
                  {r.salary && <span className="tabular-nums text-xs font-medium">{r.salary}</span>}
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                    {t("jenjang {a}/{b}", "level {a}/{b}", { a: String(r.approval.currentLevel), b: String(r.approval.totalLevels) })}
                    {current ? ` — ${current.approverLabel}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => setChainId(r.id)}>
                      {t("Jenjang", "Chain")}
                    </Button>
                    {canSend && (
                      <>
                        <Button size="sm" className="ov-fill h-8 gap-1 px-2" onClick={() => doApprove(r)}>
                          <Check className="h-3.5 w-3.5" aria-hidden /> {t("Setujui", "Approve")}
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 gap-1 border-rose-200 px-2 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400"
                          onClick={() => setDecision({ id: r.id, offerNo: r.offerNo, candidateName: r.candidateName, kind: "reject-approval" })}>
                          <X className="h-3.5 w-3.5" aria-hidden /> {t("Tolak", "Reject")}
                        </Button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* toolbar: PR picker + info guidance */}
      <Card className="mb-4 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="flex flex-wrap items-end justify-between gap-3 p-4">
          <div className="flex min-w-[260px] flex-1 flex-wrap items-end gap-3">
            <div className="w-[320px] space-y-1.5">
              <Label>{t("Filter PR (kandidat offerable)", "PR Filter (offerable candidates)")}</Label>
              <Select value={prFilter || "__all__"} onValueChange={(v) => { setPrFilter(v === "__all__" ? "" : v); setStatusFilter(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="__all__">{t("Semua PR", "All PRs")}</SelectItem>
                  {prs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.prNo} — {p.positionTitle ?? t("tanpa posisi", "no position")} · {t("terangkat {a}/{b}", "{a}/{b} appointed", { a: String(p.appointedCount), b: String(p.requiredNo) })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPr && (
              <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{selectedPr.prNo}</span>
                <span>{t("kebutuhan {n} org", "{n} headcount", { n: String(selectedPr.requiredNo) })}</span>
                <span>· {t("terangkat {n}", "{n} appointed", { n: String(selectedPr.appointedCount) })}</span>
                <span>· {selectedPr.employmentStatus}</span>
                {selectedPr.salaryGuide && (selectedPr.salaryGuide.min != null || selectedPr.salaryGuide.max != null) && (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 font-medium tabular-nums dark:border-slate-700">
                    {t("rentang iklan", "ad range")}: {fmtIDR(selectedPr.salaryGuide.min) === "—" ? "Rp 0" : fmtIDR(selectedPr.salaryGuide.min)} – {selectedPr.salaryGuide.max != null ? fmtIDR(selectedPr.salaryGuide.max) : "…"}
                  </span>
                )}
                {selectedPr.salaryBudget != null && (
                  <span className="rounded-full border border-slate-200 px-2 py-0.5 font-medium tabular-nums dark:border-slate-700">
                    {t("budget gaji", "salary budget")}: {fmtIDR(selectedPr.salaryBudget)}
                  </span>
                )}
              </div>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            {t("klik chip statistik utk memfilter status", "click a stat chip to filter by status")}
          </p>
        </CardContent>
      </Card>

      {/* tabel offer */}
      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("Daftar Offer", "Offer List")}
            <Badge variant="secondary" className="ml-2 font-mono">{visibleRows.length}</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            {listApi.data && !listApi.data.moneyVisible
              ? t("Gaji tersembunyi — buka Brankas Uang untuk melihat nilai (hak akses).", "Salary masked — unlock the Money Vault to see values (access rights).")
              : t("Gaji final tersimpan terenkripsi (brankas uang) — kolom berubah otomatis saat brankas dibuka/dikunci.", "Final salary is stored encrypted (money vault) — columns switch automatically when the vault is unlocked/locked.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {listApi.loading && !listApi.data ? (
            <LoadingRows rows={4} />
          ) : listApi.error ? (
            <EmptyState title={t("Gagal memuat offer", "Failed to load offers")} description={listApi.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title={t("Belum ada offer", "No offers yet")}
              description={t(
                "Offer dibuat dari kandidat yang lulus seleksi (Passed) — buat lewat tombol “Buat Offer” atau ikon handshake di kartu Lulus pada view Kandidat & Seleksi.",
                "Offers are created from selection-passed candidates — use “Create Offer” or the handshake icon on Passed cards in the Candidates & Selection view.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Offer", "Offer")}</TableHead>
                    <TableHead>{t("Kandidat", "Candidate")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("PR / Posisi", "PR / Position")}</TableHead>
                    <TableHead>{t("Gaji", "Salary")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Mulai", "Starts")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Berlaku S.d.", "Valid Until")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="w-56 text-right">{t("Aksi", "Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const dim = row.status === "Declined" || row.status === "Expired";
                    return (
                      <TableRow key={row.id} className={cn(dim && "opacity-60")} title={row.note ?? undefined}>
                        <TableCell>
                          <div className="font-mono text-xs font-semibold">{row.offerNo}</div>
                          {row.joRefNo && <div className="text-[10px] text-slate-400">{row.joRefNo}</div>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-[13px] font-semibold">{row.candidateName}</span>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                                row.candidateSource === "Internal"
                                  ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85"
                                  : "border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400")}>
                                {row.candidateSource === "Internal" ? t("Internal", "Internal") : t("Eksternal", "External")}
                              </span>
                              {row.hasAppointment && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400"
                                  title={t("kandidat sudah diangkat jadi karyawan", "candidate has been appointed as an employee")}>
                                  <BadgeCheck className="h-3 w-3" aria-hidden />
                                  {empNos[row.id] ? t("Karyawan {n}", "Employee {n}", { n: empNos[row.id]! }) : t("Diangkat", "Appointed")}
                                </span>
                              )}
                            </div>
                            {row.note && dim && (
                              <span className="max-w-[220px] truncate text-[10px] italic text-slate-400" title={row.note}>“{row.note}”</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="font-mono text-xs">{row.prNo}</span>
                          {row.positionTitle && <div className="max-w-[160px] truncate text-[11px] text-slate-500 dark:text-slate-400">{row.positionTitle}</div>}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {row.salary != null ? (
                            <span className="font-semibold">{fmtIDR(row.salary)}</span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">---</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden tabular-nums md:table-cell">{fmtDate(row.startDate)}</TableCell>
                        <TableCell className="hidden md:table-cell"><ExpiryCell row={row} /></TableCell>
                        <TableCell><OfferStatusPill status={row.status} /></TableCell>
                        <TableCell className="text-right">{rowActions(row)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== funnel rekrutmen ===== */}
      <Card className="mt-4 border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 ov-text-accent" aria-hidden />
            {t("Funnel Rekrutmen", "Recruitment Funnel")}
            {funnel?.offerAcceptanceRate != null && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                {t("Offer Acceptance Rate: {n}%", "Offer Acceptance Rate: {n}%", { n: String(funnel.offerAcceptanceRate) })}
              </span>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            {prFilter
              ? t("Corong untuk PR terpilih — dari talent pool hingga kandidat diangkat.", "Funnel for the selected PR — from the talent pool to hired candidates.")
              : t("Corong keseluruhan rekrutmen (semua PR) — dari talent pool hingga kandidat diangkat.", "Overall recruitment funnel (all PRs) — from the talent pool to hired candidates.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnelApi.loading && !funnelApi.data ? (
            <LoadingRows rows={3} />
          ) : !funnel ? (
            <EmptyState title={t("Funnel gagal dimuat", "Failed to load the funnel")} description={funnelApi.error ?? undefined} />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* 6 tahap corong */}
              <div className="space-y-2.5">
                {funnel.stages.map((s, i) => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600 dark:text-slate-300">{t(s.label, s.labelEn)}</span>
                      <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{s.count}</span>
                    </div>
                    <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                      <div
                        className={cn("h-2.5 rounded-full",
                          i === funnel.stages.length - 1
                            ? "bg-gradient-to-r from-emerald-400 to-emerald-600 dark:from-emerald-500 dark:to-emerald-400"
                            : "bg-gradient-to-r from-amber-300 to-amber-500 dark:from-amber-600 dark:to-amber-400")}
                        style={{ width: `${Math.max(2, Math.round((s.count / funnelMax) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {/* konversi per tahap seleksi */}
              <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <span>{t("Tahap Seleksi (mencapai → lulus)", "Selection Stages (reached → passed)")}</span>
                  <span className="flex items-center gap-2 normal-case">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300 dark:bg-slate-600" />{t("mencapai", "reached")}</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" />{t("lulus", "passed")}</span>
                  </span>
                </p>
                <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                  {funnel.selectionStages.map((s) => (
                    <div key={s.name} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate font-medium text-slate-600 dark:text-slate-300" title={s.name}>{s.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                        <div className="h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" style={{ width: `${Math.round((s.reached / stageMax) * 100)}%` }} />
                      </div>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.round((s.passed / stageMax) * 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-slate-500 dark:text-slate-400">{s.passed}/{s.reached}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog ===== */}
      <OfferFormDialog target={formTarget} prs={prs} onClose={() => setFormTarget(null)} onDone={refreshAll} />
      <ApprovalChainDialog offerId={chainId} onClose={() => setChainId(null)} />
      <DecisionDialog target={decision} onClose={() => setDecision(null)} onDone={refreshAll} />
      <OfferLetterDialog letter={letter} onClose={() => setLetter(null)} />
      <AppointFlowDialog offerId={appointId} onClose={() => setAppointId(null)} onDone={refreshAll} />
    </div>
  );
}
