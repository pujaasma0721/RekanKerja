"use client";
// OneVity — Personnel Action document detail: header, workflow action bar,
// approval timeline, detail payload, activity trail
import { useMemo, useState } from "react";
import { useNav } from "@/onevity/shared/lib/store";
import { useApi, apiSend, fmtDate, fmtDateTime, fmtIDR, initials, avatarColor, tenure, paTypeLabelSafe } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { translate } from "@/onevity/shared/lib/i18n-core";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DecisionDialog } from "./pa-decision-dialog";
import { parseDetail, DETAIL_LABELS, DETAIL_LABELS_EN, detailValue, processEffectSummary } from "./pa-types";
import type { PADetailResp, PADetail as PADetailType, PAActivity } from "./pa-types";
import { toast } from "sonner";
import {
  ArrowLeft, Clock3, CheckCircle2, XCircle, Send, Ban, Undo2, Zap, Loader2, FileText,
  User, Building2, BriefcaseBusiness, GraduationCap, Wallet, CalendarDays, History,
  ChevronDown, CircleDot, FileSignature,
} from "lucide-react";
import { EsignSignDialog } from "@/onevity/shared/components/esign/sign-dialog";
import { cn } from "@/lib/utils";
import { LetterPreviewDialog } from "../employee/letter-preview-dialog";

export function PADetail({ id }: { id: string }) {
  const { setParams, navigate } = useNav();
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<PADetailResp>(`/api/onevity/personnel-actions/${id}`, [id]);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [confirm, setConfirm] = useState<"process" | "cancel" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Task 3-LETTERS: dialog terbitkan & cetak surat dari dokumen PA
  const [letterOpen, setLetterOpen] = useState(false);
  // Task 80c: eSign — dialog tanda tangan elektronik atas dokumen PA
  const [signOpen, setSignOpen] = useState(false);

  const pa = data?.action;
  const detail = useMemo(() => parseDetail(pa?.detailJson ?? null), [pa?.detailJson]);

  const back = () => setParams({});

  const doAction = async (action: string, note?: string | null) => {
    if (!pa) return;
    setBusy(action);
    try {
      await apiSend(`/api/onevity/personnel-actions/${pa.id}`, "PATCH", { action, note: note ?? null });
      toast.success(aksiLabel(action, pa.docNo));
      refresh();
      setConfirm(null);
      setDecision(null);
    } catch (e) {
      toast.error(t("Aksi gagal", "Action failed"), { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow={t("Pengajuan & Persetujuan")} title={t("Detail Pengajuan", "Request Details")} description={t("Memuat dokumen…", "Loading document…")} />
        <LoadingRows rows={8} />
      </div>
    );
  }
  if (error || !pa) {
    return (
      <div>
        <PageHeader eyebrow={t("Pengajuan & Persetujuan")} title={t("Detail Pengajuan", "Request Details")} />
        <EmptyState
          title={t("Pengajuan tidak ditemukan", "Request not found")}
          description={error ?? t("Pengajuan mungkin telah dihapus.", "The request may have been deleted.")}
          icon={<FileText className="h-6 w-6" />}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={back} className="h-11 gap-2"><ArrowLeft className="h-4 w-4" /> {t("Kembali ke daftar", "Back to list")}</Button>
        </div>
      </div>
    );
  }

  const emp = pa.employee;
  const canAct = data?.canAct ?? false;
  const curNo = Math.max(pa.currentLayer, 1);
  const curLayer = pa.layers.find((l) => l.layerNo === curNo);

  return (
    <div>
      <PageHeader
        eyebrow={t("Pengajuan & Persetujuan")}
        title={t("Detail Pengajuan {doc}", "Request Details {doc}", { doc: pa.docNo })}
        description=""
        actions={
          <Button variant="outline" onClick={back} className="h-11 gap-2">
            <ArrowLeft className="h-4 w-4" /> {t("Kembali")}
          </Button>
        }
      />

      {/* ===== document header card ===== */}
      <div className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-mono text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">{pa.docNo}</h2>
              <StatusPill status={pa.status} className="px-3 py-1 text-xs" />
              <Badge variant="outline" className="rounded-full ov-border-accent ov-soft px-3 py-1 text-[11px] font-bold">
                {paTypeLabelSafe(pa.type)}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              {pa.reason || t("Tanpa keterangan alasan.", "No reason provided.")}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
            <MetaItem label={t("Efektif", "Effective")} value={fmtDate(pa.effectiveDate)} />
            <MetaItem label={t("Dibuat", "Created")} value={fmtDate(pa.createdAt)} />
            <MetaItem label={t("Oleh", "By")} value={pa.createdBy ?? "—"} mono />
            <MetaItem label="Submitted" value={pa.submittedAt ? fmtDate(pa.submittedAt) : "—"} />
          </dl>
        </div>

        {/* employee strip */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-800/40">
          <button
            onClick={() => navigate("employee", "detail", { id: emp.id })}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-left"
            aria-label={t("Buka profil {name}", "Open profile {name}", { name: emp.fullName })}
          >
            <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(emp.fullName))}>
              {initials(emp.fullName)}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-base font-bold text-slate-900 hover:ov-text-accent dark:text-slate-50">{emp.fullName}</span>
                <span className="font-mono text-[11px] text-slate-400">{emp.employeeNo}</span>
                <StatusPill status={emp.status} />
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1"><BriefcaseBusiness className="h-3.5 w-3.5" /> {emp.position?.title ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {emp.orgUnit?.name ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><GraduationCap className="h-3.5 w-3.5" /> {emp.grade?.code ?? "—"}</span>
                <span className="inline-flex items-center gap-1"><Wallet className="h-3.5 w-3.5" /> {fmtIDR(emp.baseSalary)}</span>
              </span>
            </span>
          </button>
          <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> Join {fmtDate(emp.joinDate)} · {tenure(emp.joinDate)}</span>
            <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {emp.employmentStatus} · {emp.company?.shortName ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* ===== workflow action bar ===== */}
      <WorkflowBar
        pa={pa}
        canAct={canAct}
        curRole={curLayer?.approverRole}
        busy={busy}
        onRefresh={refresh}
        onDecision={setDecision}
        onConfirm={setConfirm}
        onPrint={() => setLetterOpen(true)}
        onSign={() => setSignOpen(true)}
      />

      {/* ===== two column: payload + activity | timeline ===== */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* detail payload */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label={t("Detail perubahan", "Change details")}>
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
              <FileText className="h-4 w-4" /> {t("Detail Perubahan", "Change Details")}
            </h3>
            {Object.keys(detail).length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">{t("Tidak ada payload detail untuk dokumen ini.", "No detail payload for this document.")}</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(detail).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-800/40">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t(DETAIL_LABELS[k] ?? k, DETAIL_LABELS_EN[k])}</p>
                    <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{detailValue(k, v)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* activity trail */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label={t("Jejak aktivitas", "Activity trail")}>
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
              <History className="h-4 w-4" /> {t("Jejak Aktivitas", "Activity Trail")}
            </h3>
            <ol className="mt-4 max-h-96 space-y-0 overflow-y-auto pr-1">
              {pa.activities.length === 0 && <p className="text-sm text-slate-400">{t("Belum ada aktivitas tercatat.", "No activity recorded yet.")}</p>}
              {pa.activities.map((a, i) => (
                <ActivityRow key={a.id} a={a} last={i === pa.activities.length - 1} />
              ))}
            </ol>
          </section>
        </div>

        {/* approval timeline */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label={t("Timeline approval", "Approval timeline")}>
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
            <ChevronDown className="h-4 w-4 -rotate-90" /> {t("Timeline Approval", "Approval Timeline")}
          </h3>
          <ol className="relative mt-5 space-y-0">
            {pa.layers.map((l, idx) => {
              const isCurrent = pa.status === "Submitted" && l.layerNo === curNo && l.status === "Pending";
              return (
                <li key={l.id} className="relative flex gap-4 pb-6 last:pb-1">
                  {/* connector */}
                  {idx < pa.layers.length - 1 && (
                    <span
                      className={cn(
                        "absolute left-[19px] top-10 h-[calc(100%-40px)] w-0.5 rounded",
                        l.status === "Approved" ? "bg-brand/35 dark:bg-brand/40" : "bg-slate-200 dark:bg-slate-700"
                      )}
                      aria-hidden
                    />
                  )}
                  {/* node */}
                  <span
                    className={cn(
                      "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2",
                      l.status === "Approved" && "border-brand/25 bg-brand/15 text-brand dark:border-brand/30 dark:bg-brand/15 dark:text-brand/85",
                      l.status === "Rejected" && "border-rose-200 bg-rose-100 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-400",
                      l.status === "Pending" && (isCurrent
                        ? "animate-pulse border-amber-300 bg-amber-100 text-amber-600 shadow-md shadow-amber-200 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-400 dark:shadow-none"
                        : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800")
                    )}
                    aria-label={`Layer ${l.layerNo}: ${l.status}`}
                  >
                    {l.status === "Approved" ? <CheckCircle2 className="h-5 w-5" />
                      : l.status === "Rejected" ? <XCircle className="h-5 w-5" />
                      : <Clock3 className="h-5 w-5" />}
                  </span>
                  {/* content */}
                  <div className={cn("min-w-0 flex-1 rounded-xl border px-4 py-3", isCurrent
                    ? "border-amber-300 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/[0.07]"
                    : "border-slate-200/70 bg-slate-50/50 dark:border-slate-700/60 dark:bg-slate-800/30")}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="outline" className="h-5 rounded-md px-1.5 font-mono text-[10px] font-bold text-slate-500 dark:text-slate-400">L{l.layerNo}</Badge>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{l.approverRole}</p>
                      {isCurrent && <Badge className="rounded-full bg-amber-400/90 px-2 text-[10px] font-extrabold text-slate-900 hover:bg-amber-400">{t("SEKARANG", "NOW")}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {l.approver ? `${l.approver.fullName} · ${l.approver.username}` : t("Approver belum ditentukan", "Approver not assigned yet")}
                    </p>
                    {l.note && (
                      <p className={cn("mt-2 rounded-lg px-3 py-2 text-xs italic", l.status === "Rejected" ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400" : "bg-slate-100/80 text-slate-500 dark:bg-slate-800/80 dark:text-slate-400")}>
                        “{l.note}”
                      </p>
                    )}
                    {l.decidedAt && <p className="mt-2 text-[11px] text-slate-400">{fmtDateTime(l.decidedAt)}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {pa.status === "Prepared" && (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-900/40">
              <CircleDot className="h-3.5 w-3.5" /> {t("Dokumen belum disubmit — timeline aktif setelah submit.", "Document not submitted yet — the timeline activates after submission.")}
            </p>
          )}
        </section>
      </div>

      {/* ===== dialog surat PA (Approved/Processed; mount-on-open) ===== */}
      {letterOpen && (
        <LetterPreviewDialog
          category="PersonnelAction"
          personnelActionId={pa.id}
          employeeName={emp.fullName}
          onClose={() => setLetterOpen(false)}
        />
      )}

      {/* ===== Task 80c: dialog eSign atas dokumen PA (PIN/OTP) ===== */}
      <EsignSignDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        docType="PersonnelAction"
        docId={pa.id}
        docLabel={pa.docNo}
        onSigned={() => void refresh()}
      />

      {/* ===== dialogs ===== */}
      {decision && (
        <DecisionDialog
          open
          onOpenChange={(v) => { if (!v) setDecision(null); }}
          docId={pa.id}
          docNo={pa.docNo}
          employeeName={emp.fullName}
          variant={decision}
          currentLayer={curNo}
          onDone={refresh}
        />
      )}

      <ConfirmDialog
        kind={confirm}
        pa={pa}
        onClose={() => setConfirm(null)}
        onConfirm={(note) => void doAction(confirm === "process" ? "process" : "cancel", note)}
        busy={busy !== null}
      />
    </div>
  );
}

// ---------- small pieces ----------
function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={cn("mt-0.5 font-semibold text-slate-700 dark:text-slate-200", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  );
}

function ActivityRow({ a, last }: { a: PAActivity; last: boolean }) {
  const { t } = useI18n();
  const icon =
    a.action === "Approved" ? <CheckCircle2 className="h-4 w-4 text-brand dark:text-brand/85" />
    : a.action === "Rejected" ? <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
    : a.action === "Processed" ? <Zap className="h-4 w-4 text-brand dark:text-brand/85" />
    : a.action === "Submitted" ? <Send className="h-4 w-4 text-amber-600 dark:text-amber-400" />
    : a.action === "Cancelled" ? <Ban className="h-4 w-4 text-slate-400" />
    : <History className="h-4 w-4 text-slate-400" />;
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-1">
      {!last && <span className="absolute left-[15px] top-8 h-[calc(100%-32px)] w-0.5 rounded bg-slate-100 dark:bg-slate-800" aria-hidden />}
      <span className="relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200/80 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{a.action}</p>
          <p className="text-[11px] text-slate-400">{fmtDateTime(a.createdAt)}</p>
        </div>
        {a.detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{a.detail}</p>}
        <p className="mt-0.5 text-[11px] text-slate-400">{t("oleh", "by")} {a.appUser?.fullName ?? t("Sistem", "System")}</p>
      </div>
    </li>
  );
}

function WorkflowBar({
  pa, canAct, curRole, busy, onRefresh, onDecision, onConfirm, onPrint, onSign,
}: {
  pa: PADetailType;
  canAct: boolean;
  curRole?: string;
  busy: string | null;
  onRefresh: () => void;
  onDecision: (v: "approve" | "reject") => void;
  onConfirm: (v: "process" | "cancel") => void;
  onPrint: () => void;
  onSign: () => void;
}) {
  const { t } = useI18n();
  const [busyLocal, setBusyLocal] = useState(false);

  const send = async (action: string, noteArg?: string | null) => {
    setBusyLocal(true);
    try {
      await apiSend(`/api/onevity/personnel-actions/${pa.id}`, "PATCH", { action, note: noteArg ?? null });
      toast.success(aksiLabel(action, pa.docNo));
      onRefresh();
    } catch (e) {
      toast.error(t("Aksi gagal", "Action failed"), { description: (e as Error).message });
    } finally {
      setBusyLocal(false);
    }
  };

  const loading = busy !== null || busyLocal;

  return (
    <section
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border p-4 shadow-sm sm:p-5",
        pa.status === "Submitted" ? "border-amber-300/70 bg-gradient-to-r from-amber-50/80 to-slate-50/50 dark:border-amber-500/30 dark:from-amber-500/[0.07] dark:to-slate-900/40"
        : pa.status === "Approved" ? "border-brand/40/70 bg-gradient-to-r from-brand/20/80 to-slate-50/50 dark:border-brand/30 dark:from-brand/[0.07] dark:to-slate-900/40"
        : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60"
      )}
      aria-label={t("Aksi dokumen", "Document actions")}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          {pa.status === "Prepared" && t("Dokumen Draft — submit untuk memulai proses approval 3 layer.", "Draft document — submit to start the 3-layer approval process.")}
          {pa.status === "Submitted" && (canAct
            ? t("Menunggu keputusan Anda (Layer {n} — {role}).", "Waiting for your decision (Layer {n} — {role}).", { n: Math.max(pa.currentLayer, 1), role: curRole ?? "—" })
            : t("Menunggu keputusan Layer {n} ({role}).", "Waiting for the Layer {n} decision ({role}).", { n: Math.max(pa.currentLayer, 1), role: curRole ?? "—" }))}
          {pa.status === "Approved" && t("Disetujui semua layer — siap diproses untuk diterapkan ke data karyawan.", "Approved by all layers — ready to be processed and applied to employee data.")}
          {pa.status === "Rejected" && t("Dokumen ditolak — kembalikan ke Draft untuk revisi atau arsipkan.", "Document rejected — return it to Draft for revision or archive it.")}
          {pa.status === "Processed" && t("Dokumen telah diproses dan efeknya diterapkan ke data karyawan. Read-only.", "The document has been processed and its effects applied to employee data. Read-only.")}
          {pa.status === "Cancelled" && t("Dokumen dibatalkan. Read-only.", "Document cancelled. Read-only.")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pa.status === "Prepared" && (
          <>
            <Button onClick={() => void send("submit")} disabled={loading} className="h-11 gap-2 px-5 font-bold">
              {busyLocal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("Submit untuk Approval", "Submit for Approval")}
            </Button>
            <Button variant="outline" onClick={() => onConfirm("cancel")} disabled={loading} className="h-11 gap-2 px-5">
              <Ban className="h-4 w-4" /> {t("Batalkan", "Cancel")}
            </Button>
          </>
        )}

        {pa.status === "Submitted" && canAct && (
          <>
            <Button onClick={() => onDecision("approve")} disabled={loading} className="h-11 gap-2 bg-brand px-5 font-bold hover:bg-brand/70">
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" onClick={() => onDecision("reject")} disabled={loading} className="h-11 gap-2 border-rose-300 px-5 font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </>
        )}
        {pa.status === "Submitted" && !canAct && (
          <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <Clock3 className="h-4 w-4" /> {t("Menunggu approver lain", "Waiting for another approver")}
          </span>
        )}

        {pa.status === "Approved" && (
          <Button onClick={() => onConfirm("process")} disabled={loading} className="h-11 gap-2 bg-gradient-to-r from-brand to-brand px-6 text-[15px] font-extrabold shadow-md shadow-brand/25 hover:from-brand hover:to-brand/70">
            <Zap className="h-5 w-5" /> {t("Proses Sekarang", "Process Now")}
          </Button>
        )}

        {/* Task 80c: eSign — tanda tangan elektronik pada PA final (Approved/Processed) */}
        {(pa.status === "Approved" || pa.status === "Processed") && (
          <Button variant="outline" onClick={onSign} disabled={loading} className="h-11 gap-2 px-5 font-semibold">
            <FileSignature className="h-4 w-4" /> {t("Tandatangani", "Sign Electronically")}
          </Button>
        )}

        {/* Task 3-LETTERS — cetak surat: hanya dokumen final (Approved/Processed) */}
        {(pa.status === "Approved" || pa.status === "Processed") && (
          <Button variant="outline" onClick={onPrint} disabled={loading} className="h-11 gap-2 px-5 font-semibold">
            <FileText className="h-4 w-4" /> {t("Cetak Surat", "Print Letter")}
          </Button>
        )}

        {pa.status === "Rejected" && (
          <Button variant="outline" onClick={() => void send("return")} disabled={loading} className="h-11 gap-2 px-5">
            <Undo2 className="h-4 w-4" /> Return to Draft
          </Button>
        )}

        {(pa.status === "Processed" || pa.status === "Cancelled") && (
          <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Ban className="h-3.5 w-3.5" /> {t("Dokumen terkunci", "Document locked")}
          </Badge>
        )}
      </div>

    </section>
  );
}

function ConfirmDialog({
  kind, pa, onClose, onConfirm, busy,
}: {
  kind: "process" | "cancel" | null;
  pa: PADetailType;
  onClose: () => void;
  onConfirm: (note: string | null) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const isProcess = kind === "process";
  const effects = processEffectSummary(pa);

  return (
    <AlertDialog open={kind !== null} onOpenChange={(v) => { if (!v) { setNote(""); onClose(); } }}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5">
            {isProcess ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 dark:bg-brand/15">
                <Zap className="h-5 w-5 text-brand dark:text-brand/85" />
              </span>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ban className="h-5 w-5 text-slate-500" />
              </span>
            )}
            {isProcess ? t("Proses Dokumen?", "Process Document?") : t("Batalkan Dokumen?", "Cancel Document?")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isProcess ? (
                <>
                  <p>{t("Dokumen", "Document")} <b>{pa.docNo}</b> {t("akan diproses dan perubahan berikut diterapkan ke data", "will be processed and the following changes applied to the data of")} <b>{pa.employee.fullName}</b>:</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                    {effects.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                  <p className="text-xs text-slate-400">{t("Aksi ini tidak dapat dibatalkan. Setiap efek dicatat di jejak aktivitas.", "This action cannot be undone. Every effect is recorded in the activity trail.")}</p>
                </>
              ) : (
                <p>{t("Dokumen", "Document")} <b>{pa.docNo}</b> {t("akan dibatalkan dan tidak dapat diproses lagi.", "will be cancelled and can no longer be processed.")}</p>
              )}
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <Label htmlFor="confirm-note" className="text-xs">{t("Catatan (opsional)", "Note (optional)")}</Label>
                <Textarea id="confirm-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="resize-none" placeholder={isProcess ? t("Contoh: Diproses sesuai jadwal efektif.", "Example: Processed per the effective schedule.") : t("Contoh: Dibatalkan karena data belum final.", "Example: Cancelled because the data is not final.")} />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="h-11">{t("Batal")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); onConfirm(note.trim() || null); }}
            className={cn("h-11 gap-2 font-bold", isProcess ? "bg-brand hover:bg-brand/70" : "")}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isProcess ? t("Ya, Proses Sekarang", "Yes, Process Now") : t("Ya, Batalkan", "Yes, Cancel")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function aksiLabel(action: string, docNo: string): string {
  // helper non-React → translate() dari i18n-core (ikut bahasa aktif — Task I-3)
  switch (action) {
    case "submit": return translate("{doc} disubmit untuk approval", "{doc} submitted for approval", { doc: docNo });
    case "process": return translate("{doc} diproses — efek diterapkan ke data karyawan", "{doc} processed — effects applied to employee data", { doc: docNo });
    case "cancel": return translate("{doc} dibatalkan", "{doc} cancelled", { doc: docNo });
    case "return": return translate("{doc} dikembalikan ke Draft", "{doc} returned to Draft", { doc: docNo });
    default: return translate("{doc} diperbarui", "{doc} updated", { doc: docNo });
  }
}