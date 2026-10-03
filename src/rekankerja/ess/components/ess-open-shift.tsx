"use client";
// RekanKerja ESS — Open Shift Marketplace (Task 100 F1 G19, agen E) ==========
// =====================================================================
// Halaman "Open Shift" (nav ESS, ikut pola halaman Tukar Shift):
//   · daftar posting Open ≤ 30 hari ke depan (GET /ess/open-shift) — kartu
//     per posting: tanggal, nama shift + jam, unit, slot terisi/total;
//   · status klaim SAYA per posting (belum / sedang diajukan / disetujui /
//     ditolak) — tombol "Ambil Shift" nonaktif bila sudah klaim atau penuh;
//   · "Ambil Shift" → AlertDialog ("Anda akan ditugaskan shift ini bila
//     disetujui atasan") → POST klaim → toast (approve ada di sisi admin,
//     override jadwal 1-hari dibuat saat disetujui);
//   · posting penuh (filled ≥ slots) tampil disabled "Penuh";
//   · link kecil "Unduh jadwal saya (.ics)" → /ess/attendance/ics (G26).
import { useState } from "react";
import { toast } from "sonner";
import {
  CalendarPlus, Loader2, AlertTriangle, Building2, Clock3, Users, Download, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ESS_BASE, claimOpenShift } from "./ess-api";
import type { EssOpenShiftData, EssOpenShiftPost } from "./ess-types";

const timeLabel = (timeIn: string | null, timeOut: string | null) =>
  !timeIn && !timeOut ? "—" : `${timeIn ?? "?"}–${timeOut ?? "?"}`;

/** Label status klaim saya pada satu posting. */
function myClaimLabel(status: string, t: (a: string, b: string) => string) {
  if (status === "Pending") return t("Sedang diajukan", "Submitted");
  if (status === "Approved") return t("Disetujui", "Approved");
  if (status === "Rejected") return t("Ditolak", "Rejected");
  return status;
}

// ===== satu kartu posting open shift =====
function OpenShiftCard({
  p, t, busy, onClaim,
}: {
  p: EssOpenShiftPost;
  t: (a: string, b: string, v?: Record<string, string | number>) => string;
  busy: boolean;
  onClaim: (p: EssOpenShiftPost) => void;
}) {
  const full = p.filled >= p.slots;
  const mine = p.myClaim;
  const pct = p.slots > 0 ? Math.min(100, Math.round((p.filled / p.slots) * 100)) : 0;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* kiri: tanggal + shift + unit */}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-slate-50">
            <CalendarPlus className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            {fmtDate(p.workDate)}
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold"
              style={{ borderColor: `${p.dayTypeColor ?? "#f59e0b"}66` }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.dayTypeColor ?? "#f59e0b" }} aria-hidden />
              {p.dayTypeName}
            </span>
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 font-mono font-semibold">
              <Clock3 className="h-3.5 w-3.5" aria-hidden /> {timeLabel(p.timeIn, p.timeOut)}
            </span>
            {p.orgUnitName && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{p.orgUnitName}</span>
              </span>
            )}
            <span className="truncate">{p.scheduleName}</span>
          </p>
          {p.notes && (
            <p className="mt-1.5 rounded-lg bg-slate-100/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              “{p.notes}”
            </p>
          )}
        </div>

        {/* kanan: slot + status klaim + aksi */}
        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-52 sm:items-end">
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="flex items-center gap-1.5 text-[12px] font-bold tabular-nums text-slate-600 dark:text-slate-300" aria-label={t("Slot terisi {f} dari {s}", "Slots filled {f} of {s}", { f: p.filled, s: p.slots })}>
              <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              {p.filled}/{p.slots}
            </span>
            {full ? (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {t("Penuh", "Full")}
              </span>
            ) : (
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {t("{n} slot tersisa", "{n} slot(s) left", { n: p.slotsLeft })}
              </span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: `${pct}%` }} />
          </div>

          {mine ? (
            <div className="flex items-center gap-1.5">
              <StatusPill status={mine.status} />
              <span className="text-[10.5px] font-semibold text-slate-400">
                {mine.status === "Pending"
                  ? t("menunggu atasan", "awaiting supervisor")
                  : mine.status === "Approved"
                    ? t("shift ini milik Anda", "this shift is yours")
                    : t("klaim Anda", "your claim")}
              </span>
            </div>
          ) : (
            <Button
              size="sm"
              disabled={full || busy}
              onClick={() => onClaim(p)}
              className="h-11 w-full gap-1.5 rounded-xl bg-amber-600 px-4 text-[12.5px] font-bold text-white hover:bg-amber-700 sm:w-auto"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {full ? t("Penuh", "Full") : t("Ambil Shift", "Take Shift")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EssOpenShift() {
  const { t } = useI18n();
  const api = useApi<EssOpenShiftData>(`${ESS_BASE}/open-shift`);
  const [confirmTarget, setConfirmTarget] = useState<EssOpenShiftPost | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);

  const posts = api.data?.posts ?? [];

  const submitClaim = async () => {
    if (!confirmTarget || claimBusy) return;
    setClaimBusy(true);
    try {
      await claimOpenShift(confirmTarget.id);
      toast.success(t(
        "Klaim open shift {date} diajukan — Anda ditugaskan shift ini bila disetujui atasan.",
        "Open shift claim for {date} submitted — you are assigned this shift once your supervisor approves.",
        { date: fmtDate(confirmTarget.workDate) },
      ));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengajukan klaim open shift", "Failed to submit the open shift claim"));
    } finally {
      setClaimBusy(false);
      setConfirmTarget(null);
      api.refresh(); // status klaim terbaru (mis. 409 "sudah mengajukan")
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Open Shift", "Open Shift")}
        description={t(
          "Shift tambahan yang dibuka HR utk 30 hari ke depan. Ambil slot yang kosong — atasan menyetujui klaim Anda.",
          "Extra shifts opened by HR for the next 30 days. Take an open slot — your supervisor approves your claim.",
        )}
        actions={
          <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 rounded-xl px-3 text-[11px] font-bold">
            <a href={`${ESS_BASE}/attendance/ics`} download aria-label={t("Unduh jadwal saya (.ics)", "Download my schedule (.ics)")}>
              <Download className="h-3.5 w-3.5" aria-hidden /> {t("Unduh jadwal saya (.ics)", "Download my schedule (.ics)")}
            </a>
          </Button>
        }
      />

      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarPlus className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Posting Terbuka", "Open Postings")}
            {posts.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {posts.length}
              </span>
            )}
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {t("Setelah klaim disetujui, jadwal Anda pada tanggal tsb diganti shift ini (rekap absensi ikut terhitung).", "Once your claim is approved, your schedule on that date is switched to this shift (attendance recap follows).")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4 pt-0 sm:px-5">
          {api.loading && !api.data ? (
            <LoadingRows rows={3} />
          ) : api.error && !api.data ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
              <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat open shift", "Failed to load open shifts")}</p>
              <p className="max-w-sm break-words text-xs text-slate-500">{api.error}</p>
              <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
              </Button>
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              title={t("Belum ada open shift terbuka", "No open shifts available")}
              description={t("HR belum membuka shift tambahan utk 30 hari ke depan — cek kembali nanti.", "HR has not opened any extra shifts for the next 30 days — check back later.")}
              icon={CalendarPlus}
            />
          ) : (
            <div className="space-y-3">
              {posts.map((p) => (
                <OpenShiftCard key={p.id} p={p} t={t} busy={claimBusy} onClaim={setConfirmTarget} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* G19 — dialog konfirmasi klaim (pola AlertDialog attendance admin) */}
      <AlertDialog open={!!confirmTarget} onOpenChange={(v) => { if (!v && !claimBusy) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Ambil Open Shift {date}?", "Take the Open Shift on {date}?", { date: confirmTarget ? fmtDate(confirmTarget.workDate) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Anda akan ditugaskan shift ini bila disetujui atasan. Rekap absensi & jam kerja pada tanggal tsb dihitung mengikuti shift ini.",
                "You will be assigned this shift once your supervisor approves. Attendance recap and working hours on that date follow this shift.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmTarget && (
            <div className="rounded-xl border border-slate-200 px-3.5 py-3 text-[12px] dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("Tanggal", "Date")}</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">{fmtDate(confirmTarget.workDate)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("Shift", "Shift")}</span>
                <span className="font-bold text-slate-800 dark:text-slate-100">
                  {confirmTarget.dayTypeName}
                  <span className="ml-1.5 font-mono text-[11px] font-semibold text-slate-400">{timeLabel(confirmTarget.timeIn, confirmTarget.timeOut)}</span>
                </span>
              </div>
              {confirmTarget.orgUnitName && (
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-500">{t("Unit", "Unit")}</span>
                  <span className="max-w-[60%] truncate font-bold text-slate-800 dark:text-slate-100">{confirmTarget.orgUnitName}</span>
                </div>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-slate-500">{t("Slot", "Slots")}</span>
                <span className="font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {confirmTarget.filled}/{confirmTarget.slots} · {t("{n} tersisa", "{n} left", { n: confirmTarget.slotsLeft })}
                </span>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={claimBusy}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={claimBusy}
              className={cn("gap-1.5 font-bold", claimBusy && "opacity-70")}
              onClick={(e) => { e.preventDefault(); void submitClaim(); }}
            >
              {claimBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {claimBusy ? t("Mengirim…") : t("Ya, Ambil Shift", "Yes, Take Shift")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
