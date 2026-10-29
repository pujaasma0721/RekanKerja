"use client";
// OneVity — Personnel Action document detail: header, workflow action bar,
// approval timeline, detail payload, activity trail
import { useMemo, useState } from "react";
import { useNav } from "@/lib/onevity/store";
import { useApi, apiSend, fmtDate, fmtDateTime, fmtIDR, initials, avatarColor, tenure } from "@/lib/onevity/api";
import { PageHeader, StatusPill, paTypeLabel, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DecisionDialog } from "./pa-decision-dialog";
import { parseDetail, DETAIL_LABELS, detailValue, processEffectSummary } from "./pa-types";
import type { PADetailResp, PADetail as PADetailType, PAActivity } from "./pa-types";
import { toast } from "sonner";
import {
  ArrowLeft, Clock3, CheckCircle2, XCircle, Send, Ban, Undo2, Zap, Loader2, FileText,
  User, Building2, BriefcaseBusiness, GraduationCap, Wallet, CalendarDays, History,
  ChevronDown, CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function PADetail({ id }: { id: string }) {
  const { setParams, navigate } = useNav();
  const { data, loading, error, refresh } = useApi<PADetailResp>(`/api/onevity/personnel-actions/${id}`, [id]);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [confirm, setConfirm] = useState<"process" | "cancel" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
      toast.error("Aksi gagal", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="PENGAJUAN & PERSETUJUAN" title="Detail Pengajuan" description="Memuat dokumen…" />
        <LoadingRows rows={8} />
      </div>
    );
  }
  if (error || !pa) {
    return (
      <div>
        <PageHeader eyebrow="PENGAJUAN & PERSETUJUAN" title="Detail Pengajuan" />
        <EmptyState
          title="Pengajuan tidak ditemukan"
          description={error ?? "Pengajuan mungkin telah dihapus."}
          icon={<FileText className="h-6 w-6" />}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={back} className="h-11 gap-2"><ArrowLeft className="h-4 w-4" /> Kembali ke daftar</Button>
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
        eyebrow="PENGAJUAN & PERSETUJUAN"
        title={`Detail Pengajuan ${pa.docNo}`}
        description=""
        actions={
          <Button variant="outline" onClick={back} className="h-11 gap-2">
            <ArrowLeft className="h-4 w-4" /> Kembali
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
              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                {paTypeLabel(pa.type)}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              {pa.reason || "Tanpa keterangan alasan."}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-4">
            <MetaItem label="Efektif" value={fmtDate(pa.effectiveDate)} />
            <MetaItem label="Dibuat" value={fmtDate(pa.createdAt)} />
            <MetaItem label="Oleh" value={pa.createdBy ?? "—"} mono />
            <MetaItem label="Submitted" value={pa.submittedAt ? fmtDate(pa.submittedAt) : "—"} />
          </dl>
        </div>

        {/* employee strip */}
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-slate-700/70 dark:bg-slate-800/40">
          <button
            onClick={() => navigate("employee", "detail", { id: emp.id })}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-left"
            aria-label={`Buka profil ${emp.fullName}`}
          >
            <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(emp.fullName))}>
              {initials(emp.fullName)}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate text-base font-bold text-slate-900 hover:text-emerald-700 dark:text-slate-50 dark:hover:text-emerald-400">{emp.fullName}</span>
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
      />

      {/* ===== two column: payload + activity | timeline ===== */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* detail payload */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label="Detail perubahan">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
              <FileText className="h-4 w-4" /> Detail Perubahan
            </h3>
            {Object.keys(detail).length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">Tidak ada payload detail untuk dokumen ini.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {Object.entries(detail).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-slate-200/70 bg-slate-50/60 px-4 py-3 dark:border-slate-700/70 dark:bg-slate-800/40">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{DETAIL_LABELS[k] ?? k}</p>
                    <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{detailValue(k, v)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* activity trail */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label="Jejak aktivitas">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
              <History className="h-4 w-4" /> Jejak Aktivitas
            </h3>
            <ol className="mt-4 max-h-96 space-y-0 overflow-y-auto pr-1">
              {pa.activities.length === 0 && <p className="text-sm text-slate-400">Belum ada aktivitas tercatat.</p>}
              {pa.activities.map((a, i) => (
                <ActivityRow key={a.id} a={a} last={i === pa.activities.length - 1} />
              ))}
            </ol>
          </section>
        </div>

        {/* approval timeline */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-6" aria-label="Timeline approval">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-400">
            <ChevronDown className="h-4 w-4 -rotate-90" /> Timeline Approval
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
                        l.status === "Approved" ? "bg-emerald-300 dark:bg-emerald-500/40" : "bg-slate-200 dark:bg-slate-700"
                      )}
                      aria-hidden
                    />
                  )}
                  {/* node */}
                  <span
                    className={cn(
                      "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2",
                      l.status === "Approved" && "border-emerald-200 bg-emerald-100 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400",
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
                      {isCurrent && <Badge className="rounded-full bg-amber-400/90 px-2 text-[10px] font-extrabold text-slate-900 hover:bg-amber-400">SEKARANG</Badge>}
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                      {l.approver ? `${l.approver.fullName} · ${l.approver.username}` : "Approver belum ditentukan"}
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
              <CircleDot className="h-3.5 w-3.5" /> Dokumen belum disubmit — timeline aktif setelah submit.
            </p>
          )}
        </section>
      </div>

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
  const icon =
    a.action === "Approved" ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
    : a.action === "Rejected" ? <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
    : a.action === "Processed" ? <Zap className="h-4 w-4 text-teal-600 dark:text-teal-400" />
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
        <p className="mt-0.5 text-[11px] text-slate-400">oleh {a.appUser?.fullName ?? "Sistem"}</p>
      </div>
    </li>
  );
}

function WorkflowBar({
  pa, canAct, curRole, busy, onRefresh, onDecision, onConfirm,
}: {
  pa: PADetailType;
  canAct: boolean;
  curRole?: string;
  busy: string | null;
  onRefresh: () => void;
  onDecision: (v: "approve" | "reject") => void;
  onConfirm: (v: "process" | "cancel") => void;
}) {
  const [busyLocal, setBusyLocal] = useState(false);

  const send = async (action: string, noteArg?: string | null) => {
    setBusyLocal(true);
    try {
      await apiSend(`/api/onevity/personnel-actions/${pa.id}`, "PATCH", { action, note: noteArg ?? null });
      toast.success(aksiLabel(action, pa.docNo));
      onRefresh();
    } catch (e) {
      toast.error("Aksi gagal", { description: (e as Error).message });
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
        : pa.status === "Approved" ? "border-emerald-300/70 bg-gradient-to-r from-emerald-50/80 to-slate-50/50 dark:border-emerald-500/30 dark:from-emerald-500/[0.07] dark:to-slate-900/40"
        : "border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900/60"
      )}
      aria-label="Aksi dokumen"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
          {pa.status === "Prepared" && "Dokumen Draft — submit untuk memulai proses approval 3 layer."}
          {pa.status === "Submitted" && (canAct
            ? `Menunggu keputusan Anda (Layer ${Math.max(pa.currentLayer, 1)} — ${curRole ?? "—"}).`
            : `Menunggu keputusan Layer ${Math.max(pa.currentLayer, 1)} (${curRole ?? "—"}).`)}
          {pa.status === "Approved" && "Disetujui semua layer — siap diproses untuk diterapkan ke data karyawan."}
          {pa.status === "Rejected" && "Dokumen ditolak — kembalikan ke Draft untuk revisi atau arsipkan."}
          {pa.status === "Processed" && "Dokumen telah diproses dan efeknya diterapkan ke data karyawan. Read-only."}
          {pa.status === "Cancelled" && "Dokumen dibatalkan. Read-only."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pa.status === "Prepared" && (
          <>
            <Button onClick={() => void send("submit")} disabled={loading} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
              {busyLocal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit untuk Approval
            </Button>
            <Button variant="outline" onClick={() => onConfirm("cancel")} disabled={loading} className="h-11 gap-2 px-5">
              <Ban className="h-4 w-4" /> Batalkan
            </Button>
          </>
        )}

        {pa.status === "Submitted" && canAct && (
          <>
            <Button onClick={() => onDecision("approve")} disabled={loading} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
            <Button variant="outline" onClick={() => onDecision("reject")} disabled={loading} className="h-11 gap-2 border-rose-300 px-5 font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-500/10">
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </>
        )}
        {pa.status === "Submitted" && !canAct && (
          <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <Clock3 className="h-4 w-4" /> Menunggu approver lain
          </span>
        )}

        {pa.status === "Approved" && (
          <Button onClick={() => onConfirm("process")} disabled={loading} className="h-11 gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 px-6 text-[15px] font-extrabold shadow-md shadow-emerald-600/25 hover:from-emerald-600 hover:to-teal-700">
            <Zap className="h-5 w-5" /> Proses Sekarang
          </Button>
        )}

        {pa.status === "Rejected" && (
          <Button variant="outline" onClick={() => void send("return")} disabled={loading} className="h-11 gap-2 px-5">
            <Undo2 className="h-4 w-4" /> Return to Draft
          </Button>
        )}

        {(pa.status === "Processed" || pa.status === "Cancelled") && (
          <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <Ban className="h-3.5 w-3.5" /> Dokumen terkunci
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
  const [note, setNote] = useState("");
  const isProcess = kind === "process";
  const effects = processEffectSummary(pa);

  return (
    <AlertDialog open={kind !== null} onOpenChange={(v) => { if (!v) { setNote(""); onClose(); } }}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2.5">
            {isProcess ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
                <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </span>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Ban className="h-5 w-5 text-slate-500" />
              </span>
            )}
            {isProcess ? "Proses Dokumen?" : "Batalkan Dokumen?"}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isProcess ? (
                <>
                  <p>Dokumen <b>{pa.docNo}</b> akan diproses dan perubahan berikut diterapkan ke data <b>{pa.employee.fullName}</b>:</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">
                    {effects.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                  <p className="text-xs text-slate-400">Aksi ini tidak dapat dibatalkan. Setiap efek dicatat di jejak aktivitas.</p>
                </>
              ) : (
                <p>Dokumen <b>{pa.docNo}</b> akan dibatalkan dan tidak dapat diproses lagi.</p>
              )}
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <Label htmlFor="confirm-note" className="text-xs">Catatan (opsional)</Label>
                <Textarea id="confirm-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="resize-none" placeholder={isProcess ? "Contoh: Diproses sesuai jadwal efektif." : "Contoh: Dibatalkan karena data belum final."} />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="h-11">Batal</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); onConfirm(note.trim() || null); }}
            className={cn("h-11 gap-2 font-bold", isProcess ? "bg-emerald-600 hover:bg-emerald-700" : "")}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isProcess ? "Ya, Proses Sekarang" : "Ya, Batalkan"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function aksiLabel(action: string, docNo: string): string {
  switch (action) {
    case "submit": return `${docNo} disubmit untuk approval`;
    case "process": return `${docNo} diproses — efek diterapkan ke data karyawan`;
    case "cancel": return `${docNo} dibatalkan`;
    case "return": return `${docNo} dikembalikan ke Draft`;
    default: return `${docNo} diperbarui`;
  }
}