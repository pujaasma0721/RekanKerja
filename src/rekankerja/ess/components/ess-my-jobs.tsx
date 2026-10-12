"use client";
// RekanKerja ESS F5 — Lowongan Internal (padanan RekanKerja §2.10 MyJobOpportunity
// + MyEmpAppliedJobOpportunity): daftar slot lowongan aktif yang bisa dilamar
// karyawan (termasuk JO khusus internal / dalam jendela internal-first yang
// tidak tayang di portal publik) + riwayat lamaran internal + tarik lamaran.
import { useState } from "react";
import { toast } from "sonner";
import {
  Briefcase, Building2, CalendarClock, CheckCircle2, ChevronDown, ChevronRight,
  ClipboardCheck, Inbox, Loader2, Lock, MapPin, Send, Wallet, XCircle,
} from "lucide-react";
import { useApi, apiSend, fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ESS_BASE } from "./ess-api";

const MY_JOBS_API = `${ESS_BASE}/my-jobs`;

// ---------- tipe (mirror kontrak internal-apply-service) ----------

interface MyOpeningRow {
  slotId: string;
  joRefNo: string;
  joTitle: string;
  title: string;
  positionTitle: string | null;
  prNo: string;
  requiredNo: number;
  employmentStatus: string | null;
  workLocationName: string | null;
  city: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  closingDate: string | null;
  internalOnly: boolean;
  internalFirstUntil: string | null;
  postedAt: string | null;
  myApplication: { id: string; appliedAt: string; withdrawnAt: string | null } | null;
  canApply: boolean;
  reason: string | null;
}

interface MyAppliedRow {
  id: string;
  joRefNo: string;
  title: string;
  positionTitle: string | null;
  prNo: string;
  appliedAt: string;
  withdrawnAt: string | null;
  note: string | null;
  candidateStatus: string | null;
  currentStep: string | null;
  currentStepDue: string | null;
}

interface MyJobsResp {
  openings: MyOpeningRow[];
  stats: { total: number; internalWindow: number; applied: number };
  myApplications: MyAppliedRow[];
}

// ---------- pill status kandidat (pola ess-my-selection) ----------

const CAND_STATUS: Record<string, { id: string; en: string; cls: string; strike?: boolean }> = {
  Nominated: { id: "Dinominasikan", en: "Nominated", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25" },
  InProcess: { id: "Proses Seleksi", en: "In Process", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25" },
  Passed: { id: "Lulus Seleksi", en: "Passed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25" },
  Failed: { id: "Tidak Lulus", en: "Failed", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" },
  Withdrawn: { id: "Ditarik", en: "Withdrawn", cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-500 dark:border-slate-500/25", strike: true },
  Hired: { id: "Dipekerjakan", en: "Hired", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25" },
};

function CandPill({ status }: { status: string }) {
  const { t } = useI18n();
  const s = CAND_STATUS[status] ?? { id: status, en: status, cls: CAND_STATUS.Nominated.cls };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      <span className={cn(s.strike && "line-through")}>{t(s.id, s.en)}</span>
    </span>
  );
}

const UNIT_LABEL: Record<string, { id: string; en: string }> = {
  Month: { id: "bulan", en: "month" },
  Monthly: { id: "bulan", en: "month" },
  Year: { id: "tahun", en: "year" },
  Yearly: { id: "tahun", en: "year" },
  Week: { id: "minggu", en: "week" },
  Weekly: { id: "minggu", en: "week" },
  Day: { id: "hari", en: "day" },
  Daily: { id: "hari", en: "day" },
  Hour: { id: "jam", en: "hour" },
  Hourly: { id: "jam", en: "hour" },
};

/** Satu kartu lowongan internal (ringkas + detail expand). */
function OpeningCard({ o, onApply, busy }: {
  o: MyOpeningRow;
  onApply: (o: MyOpeningRow) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const mine = o.myApplication;
  const applied = mine && !mine.withdrawnAt;
  const withdrawn = mine && mine.withdrawnAt != null;

  const salary = o.salaryMin != null && o.salaryMax != null
    ? `${fmtIDR(o.salaryMin)} – ${fmtIDR(o.salaryMax)}`
    : o.salaryMin != null ? fmtIDR(o.salaryMin)
      : o.salaryMax != null ? fmtIDR(o.salaryMax)
        : null;

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="p-4 sm:p-5">
        {/* header kartu */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">{o.joRefNo}</span>
              {o.internalOnly && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
                  {t("Khusus Internal", "Internal Only")}
                </span>
              )}
              {o.internalFirstUntil && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  {t("Internal dulu s.d. {d}", "Internal-first until {d}", { d: fmtDate(o.internalFirstUntil) })}
                </span>
              )}
              {applied && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("Sudah Dilamar", "Applied")} {fmtDate(mine!.appliedAt)}
                </span>
              )}
              {withdrawn && (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-500/10 dark:text-slate-400">
                  {t("Ditarik", "Withdrawn")}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-base font-bold leading-tight text-slate-900 dark:text-slate-50">{o.title}</h3>
            <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
              {o.positionTitle ?? o.joTitle} · PR <span className="font-mono">{o.prNo}</span>
              {o.requiredNo > 1 ? ` · ${t("{n} slot", "{n} slots", { n: String(o.requiredNo) })}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {o.canApply ? (
              <Button size="sm" onClick={() => onApply(o)} disabled={busy}
                className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
                <Send className="h-4 w-4" aria-hidden /> {t("Lamar", "Apply")}
              </Button>
            ) : (
              <span className="max-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-right text-[10.5px] font-medium leading-snug text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
                title={o.reason ?? undefined}>
                <Lock className="mr-1 inline h-3 w-3" aria-hidden />
                {t(
                  o.reason === "Sudah melamar slot ini" ? "Sudah melamar slot ini"
                    : o.reason === "Permintaan karyawan tidak lagi aktif" ? "Permintaan karyawan tidak lagi aktif"
                      : o.reason === "Lamaran ke slot ini sudah ditarik — hubungi HR untuk melamar ulang" ? "Lamaran ke slot ini sudah ditarik — hubungi HR untuk melamar ulang"
                        : (o.reason ?? "—"),
                  o.reason === "Sudah melamar slot ini" ? "You already applied to this slot"
                    : o.reason === "Permintaan karyawan tidak lagi aktif" ? "This requisition is no longer accepting applicants"
                      : o.reason === "Lamaran ke slot ini sudah ditarik — hubungi HR untuk melamar ulang" ? "You withdrew this application — contact HR to re-apply"
                        : (o.reason ?? "—"),
                )}
              </span>
            )}
          </div>
        </div>

        {/* meta */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-slate-600 dark:text-slate-300">
          {o.workLocationName && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {o.workLocationName}{o.city ? `, ${o.city}` : ""}
            </span>
          )}
          {salary && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Wallet className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {salary}
              <span className="text-slate-400">/ {UNIT_LABEL[o.salaryUnit] ? t(UNIT_LABEL[o.salaryUnit].id, UNIT_LABEL[o.salaryUnit].en) : o.salaryUnit.toLowerCase()}</span>
            </span>
          )}
          {o.employmentStatus && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {o.employmentStatus}
            </span>
          )}
          {o.closingDate && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden /> {t("Batas lamar: {d}", "Apply by: {d}", { d: fmtDate(o.closingDate) })}
            </span>
          )}
        </div>

        {/* ringkasan + expand */}
        {(o.jobDescSummary || o.jobSpecSummary) && (
          <div className="mt-3">
            <div className={cn("space-y-2 text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300", !open && "hidden")}>
              {o.jobDescSummary && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Ringkasan Tugas", "Job Description")}</p>
                  <p className="whitespace-pre-wrap">{o.jobDescSummary}</p>
                </div>
              )}
              {o.jobSpecSummary && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Ringkasan Kualifikasi", "Job Specification")}</p>
                  <p className="whitespace-pre-wrap">{o.jobSpecSummary}</p>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setOpen(!open)}
              className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-400">
              {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
              {open ? t("Tutup detail", "Hide details") : t("Selengkapnya", "View details")}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// halaman
// =====================================================================

export function EssMyJobsPage() {
  const { t } = useI18n();
  const api = useApi<MyJobsResp>(MY_JOBS_API, []);
  const [busy, setBusy] = useState(false);

  const openings = api.data?.openings ?? [];
  const stats = api.data?.stats;
  const myApplications = api.data?.myApplications ?? [];

  // dialog apply
  const [applyTarget, setApplyTarget] = useState<MyOpeningRow | null>(null);
  const [applyNote, setApplyNote] = useState("");

  // dialog withdraw
  const [withdrawTarget, setWithdrawTarget] = useState<MyAppliedRow | null>(null);
  const [withdrawNote, setWithdrawNote] = useState("");

  const doApply = async () => {
    if (!applyTarget) return;
    setBusy(true);
    try {
      const res = await apiSend<{ applicationId: string; prNo: string; title: string }>(MY_JOBS_API, "POST", {
        action: "apply",
        jobOpeningId: applyTarget.slotId,
        note: applyNote.trim() || undefined,
      });
      toast.success(t(
        "Lamaran terkirim — pantau di Seleksi Saya",
        "Application sent — track it in My Selection",
      ), { description: t(`"${res.title}" (PR ${res.prNo})`, `"${res.title}" (PR ${res.prNo})`) });
      setApplyTarget(null);
      setApplyNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengirim lamaran", "Failed to submit the application"));
    } finally { setBusy(false); }
  };

  const doWithdraw = async () => {
    if (!withdrawTarget) return;
    setBusy(true);
    try {
      await apiSend(MY_JOBS_API, "POST", {
        action: "withdraw",
        applicationId: withdrawTarget.id,
        note: withdrawNote.trim() || undefined,
      });
      toast.success(t("Lamaran ditarik", "Application withdrawn"));
      setWithdrawTarget(null);
      setWithdrawNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menarik lamaran", "Failed to withdraw the application"));
    } finally { setBusy(false); }
  };

  /** status terminal — tombol tarik disembunyikan. */
  const terminal = (r: MyAppliedRow) =>
    r.withdrawnAt != null || ["Passed", "Failed", "Hired"].includes(r.candidateStatus ?? "");

  const statChip = (label: string, labelEn: string, value: number | undefined) => (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</p>
      <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{value ?? 0}</p>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={t("ESS · Rekrutmen")}
        title={t("Lowongan Internal", "Internal Jobs")}
        description={t(
          "Lowongan aktif yang bisa Anda lamar — termasuk iklan khusus internal / jendela internal-first yang tidak tayang di portal publik. Padanan My Job Opportunity RekanKerja.",
          "Active openings you can apply to — including internal-only ads / internal-first windows that are not shown on the public portal. The RekanKerja My Job Opportunity counterpart.",
        )}
      />

      {/* chips statistik */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {statChip("Total Lowongan", "Total Openings", stats?.total)}
        {statChip("Jendela Internal", "Internal Window", stats?.internalWindow)}
        {statChip("Sudah Dilamar", "Applied", stats?.applied)}
      </div>

      {api.loading && !api.data ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4"><LoadingRows rows={5} /></CardContent>
        </Card>
      ) : api.error ? (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-4">
            <EmptyState title={t("Gagal memuat lowongan", "Failed to load openings")} description={api.error} />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ===== daftar lowongan ===== */}
          <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Inbox className="h-3 w-3" aria-hidden /> {t("Lowongan Internal", "Internal Jobs")}
          </p>
          {openings.length === 0 ? (
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-4">
                <EmptyState
                  icon={Inbox}
                  title={t("Belum ada lowongan aktif", "No active openings yet")}
                  description={t(
                    "Lowongan baru akan muncul di sini begitu dipublikasikan HR.",
                    "New openings will appear here as soon as HR publishes them.",
                  )}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {openings.map((o) => (
                <OpeningCard key={o.slotId} o={o} onApply={(x) => { setApplyTarget(x); setApplyNote(""); }} busy={busy} />
              ))}
            </div>
          )}

          {/* ===== riwayat lamaran ===== */}
          <p className="mb-2 mt-6 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <ClipboardCheck className="h-3 w-3" aria-hidden /> {t("Riwayat Lamaran Saya", "My Application History")}
          </p>
          {myApplications.length === 0 ? (
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-4">
                <EmptyState
                  icon={ClipboardCheck}
                  title={t("Belum ada riwayat lamaran", "No application history yet")}
                  description={t(
                    "Lamaran Anda ke lowongan internal akan tercatat di sini.",
                    "Your applications to internal openings will be recorded here.",
                  )}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {myApplications.map((r) => (
                <Card key={r.id} className={cn(
                  "rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800",
                  r.withdrawnAt != null && "opacity-70",
                )}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">{r.joRefNo}</span>
                          {r.candidateStatus ? <CandPill status={r.candidateStatus} /> : null}
                        </div>
                        <h3 className={cn("mt-1 text-sm font-bold leading-tight text-slate-900 dark:text-slate-50", r.withdrawnAt != null && "line-through")}>
                          {r.title}
                        </h3>
                        <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
                          {r.positionTitle ?? "—"} · PR <span className="font-mono">{r.prNo}</span> · {t("dilamar", "applied")} {fmtDate(r.appliedAt)}
                        </p>
                        {r.currentStep && r.candidateStatus && !["Passed", "Failed", "Withdrawn", "Hired"].includes(r.candidateStatus) && (
                          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                            <Loader2 className="h-3 w-3" aria-hidden /> {t("Tahap: {s}", "Stage: {s}", { s: r.currentStep })}
                          </p>
                        )}
                        {r.note && <p className="mt-1 text-[11px] italic text-slate-400">“{r.note}”</p>}
                      </div>
                      {!terminal(r) && (
                        <Button variant="outline" size="sm" onClick={() => { setWithdrawTarget(r); setWithdrawNote(""); }} disabled={busy}
                          className="shrink-0 gap-1.5 rounded-xl border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400">
                          <XCircle className="h-4 w-4" aria-hidden /> {t("Tarik Lamaran", "Withdraw")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ===== dialog apply ===== */}
      <Dialog open={applyTarget != null} onOpenChange={(o) => { if (!o) setApplyTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Lamar: {title}", "Apply: {title}", { title: applyTarget?.title ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[12px] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300">
              <p className="flex items-start gap-2">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {t(
                  "Lamaran membuat Anda kandidat INTERNAL di PR ini — tahapan seleksi otomatis dibuat (pantau di Seleksi Saya) dan tim rekrutmen menerima notifikasi.",
                  "Applying registers you as an INTERNAL candidate for this PR — selection stages are created automatically (track in My Selection) and the recruitment team is notified.",
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={3} value={applyNote} onChange={(e) => setApplyNote(e.target.value)}
                placeholder={t("mis. alasan minat / pengalaman relevan…", "e.g. motivation / relevant experience…")} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setApplyTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doApply} disabled={busy} className="gap-2 bg-amber-600 font-bold text-white hover:bg-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {busy ? t("Mengirim…", "Submitting…") : t("Kirim Lamaran", "Submit Application")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog withdraw ===== */}
      <Dialog open={withdrawTarget != null} onOpenChange={(o) => { if (!o) setWithdrawTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tarik Lamaran: {title}", "Withdraw: {title}", { title: withdrawTarget?.title ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              {t(
                "Lamaran dan proses seleksi Anda pada lowongan ini akan dibatalkan. Slot ini tidak bisa dilamar ulang sendiri — hubungi HR bila berubah pikiran.",
                "Your application and selection process for this opening will be cancelled. You cannot re-apply to this slot yourself — contact HR if you change your mind.",
              )}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Alasan (opsional)", "Reason (optional)")}</Label>
              <Textarea rows={2} value={withdrawNote} onChange={(e) => setWithdrawNote(e.target.value)}
                placeholder={t("mis. menerima tawaran lain…", "e.g. accepted another offer…")} />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setWithdrawTarget(null)}>{t("Batal", "Keep Application")}</Button>
            <Button onClick={doWithdraw} disabled={busy} className="gap-2 bg-rose-600 font-bold text-white hover:bg-rose-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
              {busy ? t("Menarik…", "Withdrawing…") : t("Tarik Lamaran", "Withdraw Application")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
