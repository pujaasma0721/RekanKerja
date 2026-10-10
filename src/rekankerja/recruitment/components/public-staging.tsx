"use client";
// RekanKerja Recruitment F2 — view "Lamaran Publik" (staging inbox):
// PublicApplication menunggu verifikasi manual HR (D1) → tombol Verifikasi
// meng-upload pelamar ke talent pool (+ lamaran slot + pindah CV), Tolak
// (alasan), Tandai Spam. Sub-request ?cv=1&id= untuk tombol unduh CV.
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR } from "@/rekankerja/shared/lib/api";
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
  Inbox, Ban, ShieldAlert, UserCheck, Download, ChevronLeft, ChevronRight, GraduationCap,
} from "lucide-react";

const PAGE_SIZE = 20;

function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

interface StagingRowUI {
  id: string;
  submittedAt: string;
  status: string;
  jobOpeningId: string | null;
  slotTitle: string | null;
  joRefNo: string | null;
  applicantName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  gpa: number | null;
  expYears: number | null;
  expectedSalary: number | null;
  notes: string | null;
  cvAttachmentId: string | null;
  cvFileName: string | null;
  ipHashShort: string | null;
  consentVersion: string | null;
  rejectNote: string | null;
}

interface ListResp {
  rows: StagingRowUI[];
  total: number;
  stats: { pending: number; verified: number; rejected: number; spam: number };
}

const PA_STATUSES: { key: string; label: string; labelEn: string; tone: string }[] = [
  { key: "Pending", label: "Menunggu", labelEn: "Pending", tone: "amber" },
  { key: "Verified", label: "Terverifikasi", labelEn: "Verified", tone: "emerald" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected", tone: "rose" },
  { key: "Spam", label: "Spam", labelEn: "Spam", tone: "zinc" },
];
const PA_LABEL: Record<string, string> = Object.fromEntries(PA_STATUSES.map((s) => [s.key, s.label]));
const PA_LABEL_EN: Record<string, string> = Object.fromEntries(PA_STATUSES.map((s) => [s.key, s.labelEn]));
const PA_TONE: Record<string, string> = Object.fromEntries(PA_STATUSES.map((s) => [s.key, s.tone]));

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
};
const TONE_DOT: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", zinc: "bg-zinc-400", slate: "bg-slate-400",
};

function PaPill({ status }: { status: string }) {
  const { t } = useI18n();
  const tone = PA_TONE[status] ?? "slate";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE_CLS[tone], TONE_DOT[tone])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} />
      {t(PA_LABEL[status] ?? status, PA_LABEL_EN[status] ?? status)}
    </span>
  );
}

export function PublicStagingPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("Pending");
  const [offset, setOffset] = useState(0);

  // dialog tolak / spam (alasan)
  const [rejectTarget, setRejectTarget] = useState<{ row: StagingRowUI; spam: boolean } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      status: statusFilter, limit: String(PAGE_SIZE), offset: String(offset),
    });
    return `/api/rekankerja/recruitment/public-applications?${sp.toString()}`;
  }, [statusFilter, offset]);

  const api = useApi<ListResp>(url, [url]);

  const rows = api.data?.rows ?? [];
  const total = api.data?.total ?? 0;
  const stats = api.data?.stats;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canVerify = perms.canOp("recruitment", "public-staging", "verify");

  const setFilter = (f: string) => { setStatusFilter(f); setOffset(0); };

  /** unduh CV staging: sub-request id attachment → buka tab baru */
  const downloadCv = async (row: StagingRowUI) => {
    try {
      const res = await apiSend<{ cvAttachmentId: string | null }>(
        `/api/rekankerja/recruitment/public-applications?cv=1&id=${row.id}`, "GET",
      );
      if (!res.cvAttachmentId) {
        toast.info(t("Lamaran ini tidak melampirkan CV", "This application has no CV attached"));
        return;
      }
      window.open(`/api/rekankerja/attachments/${res.cvAttachmentId}?download=1`, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengambil CV", "Failed to fetch the CV"));
    }
  };

  const doVerify = async (row: StagingRowUI) => {
    if (!window.confirm(t(`Verifikasi lamaran ${row.applicantName}? Pelamar akan di-upload ke talent pool.`, `Verify ${row.applicantName}'s application? The applicant will be uploaded to the talent pool.`))) return;
    setActionBusy(true);
    try {
      const res = await apiSend<{ applicantNo?: string; status: string }>("/api/rekankerja/recruitment/public-applications", "PATCH", {
        id: row.id, action: "verify",
      });
      toast.success(
        res.applicantNo
          ? t(`Terverifikasi — pelamar ${res.applicantNo} masuk talent pool`, `Verified — applicant ${res.applicantNo} added to the talent pool`)
          : t("Lamaran terverifikasi", "Application verified"),
      );
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memverifikasi", "Failed to verify"));
    } finally { setActionBusy(false); }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (rejectTarget.spam && !noteText.trim()) {
      toast.error(t("Isi alasan penandaan spam", "Provide a reason for marking spam"));
      return;
    }
    setActionBusy(true);
    try {
      await apiSend<{ status: string }>("/api/rekankerja/recruitment/public-applications", "PATCH", {
        id: rejectTarget.row.id,
        action: rejectTarget.spam ? "spam" : "reject",
        note: noteText.trim() || null,
      });
      toast.success(rejectTarget.spam
        ? t("Lamaran ditandai spam", "Application marked as spam")
        : t(`Lamaran ${rejectTarget.row.applicantName} ditolak`, `Application from ${rejectTarget.row.applicantName} rejected`));
      setRejectTarget(null);
      setNoteText("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    } finally { setActionBusy(false); }
  };

  const statCard = (key: string, label: string, labelEn: string, value: number | undefined) => (
    <button
      key={key}
      onClick={() => setFilter(statusFilter === key ? "" : key)}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statusFilter === key
          ? "ov-border-accent ov-soft"
          : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}
    >
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value ?? 0}</div>
    </button>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Lamaran Publik")}
        title={t("Lamaran Publik (Staging)", "Public Applications (Staging)")}
        description={t(
          "Kotak masuk lamaran dari form publik portal karir — verifikasi manual sebelum pelamar masuk talent pool. Verifikasi otomatis membuat pelamar + lamaran ke slot terkait + memindahkan CV.",
          "Inbox for applications from the public career-portal form — manual verification before an applicant enters the talent pool. Verify automatically creates the applicant + application to the related slot + moves the CV.",
        )}
      />

      {/* ringkasan status */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCard("Pending", "Menunggu", "Pending", stats?.pending)}
        {statCard("Verified", "Terverifikasi", "Verified", stats?.verified)}
        {statCard("Rejected", "Ditolak", "Rejected", stats?.rejected)}
        {statCard("Spam", "Spam", "Spam", stats?.spam)}
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat lamaran publik", "Failed to load public applications")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={statusFilter
                ? t("Tidak ada lamaran dengan status ini", "No applications with this status")
                : t("Belum ada lamaran publik", "No public applications yet")}
              description={t(
                "Lamaran dari form publik portal karir akan muncul di sini untuk diverifikasi.",
                "Applications from the public career-portal form will appear here for verification.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Tanggal", "Date")}</TableHead>
                    <TableHead>{t("Pelamar", "Applicant")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Pendidikan", "Education")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Pengalaman", "Experience")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("Ekspektasi Gaji", "Expected Salary")}</TableHead>
                    <TableHead>{t("Slot Dituju", "Target Slot")}</TableHead>
                    <TableHead>{t("CV", "CV")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">{fmtDay(r.submittedAt, locale)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.applicantName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {r.email ?? "—"}{r.phone ? ` · ${r.phone}` : ""}
                          {r.city ? ` · ${r.city}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {r.educationLevel ? (
                          <span className="inline-flex items-center gap-1">
                            <GraduationCap className="h-3 w-3 text-slate-400" aria-hidden />
                            {r.educationLevel}
                            {r.gpa != null && <span className="text-slate-500 dark:text-slate-400"> · {r.gpa.toFixed(2)}</span>}
                            {r.fieldOfStudy ? <span className="text-slate-500 dark:text-slate-400"> · {r.fieldOfStudy}</span> : null}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">
                        {r.expYears != null ? t("{n} thn", "{n} yr", { n: String(r.expYears) }) : "—"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs tabular-nums"
                        title={r.expectedSalary == null ? t("disembunyikan vault uang / kosong", "hidden by money vault / empty") : undefined}>
                        {r.expectedSalary != null ? fmtIDR(r.expectedSalary) : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell>
                        {r.slotTitle ? (
                          <>
                            <div className="max-w-[12rem] truncate text-xs font-medium" title={r.slotTitle}>{r.slotTitle}</div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{r.joRefNo}</div>
                          </>
                        ) : <span className="text-xs text-slate-400">{t("umum (tanpa slot)", "general (no slot)")}</span>}
                      </TableCell>
                      <TableCell>
                        {r.cvFileName ? (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void downloadCv(r)}>
                            <Download className="h-3 w-3" aria-hidden />
                            <span className="max-w-[8rem] truncate">{r.cvFileName}</span>
                          </Button>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <PaPill status={r.status} />
                          {r.rejectNote && (
                            <div className="max-w-[10rem] text-[10px] leading-tight text-slate-500 dark:text-slate-400" title={r.rejectNote}>
                              {t("alasan:", "reason:")} {r.rejectNote}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {r.status === "Pending" && canVerify ? (
                          <div className="flex flex-wrap items-center gap-1">
                            <Button size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => void doVerify(r)} disabled={actionBusy}>
                              <UserCheck className="h-3 w-3" aria-hidden /> {t("Verifikasi", "Verify")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { setRejectTarget({ row: r, spam: false }); setNoteText(""); }}>
                              <Ban className="h-3 w-3" aria-hidden /> {t("Tolak", "Reject")}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-slate-500" onClick={() => { setRejectTarget({ row: r, spam: true }); setNoteText(""); }}>
                              <ShieldAlert className="h-3 w-3" aria-hidden /> {t("Spam", "Spam")}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">{t("sudah diproses", "processed")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t("Halaman {p} dari {n} — {t2} lamaran", "Page {p} of {n} — {t2} applications", { p: String(page), n: String(pages), t2: String(total) })}</span>
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

      {/* ===== dialog tolak / spam ===== */}
      <Dialog open={rejectTarget != null} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rejectTarget?.spam ? t("Tandai Spam", "Mark as Spam") : t("Tolak Lamaran", "Reject Application")} — {rejectTarget?.row.applicantName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {rejectTarget?.spam
                ? t("Lamaran ditandai spam (honeypot terpicu / data sampah) — tidak masuk talent pool.", "The application is marked as spam (honeypot triggered / junk data) — it will not enter the talent pool.")
                : t("Lamaran ditolak — pelamar TIDAK masuk talent pool. Data staging tetap tersimpan untuk jejak.", "The application is rejected — the applicant does NOT enter the talent pool. Staging data is kept for audit.")}
            </p>
            <div className="space-y-1.5">
              <Label>{rejectTarget?.spam ? t("Alasan (wajib)", "Reason (required)") : t("Catatan tolak (opsional)", "Rejection note (optional)")}</Label>
              <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("alasan…", "reason…")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={submitReject} disabled={actionBusy}>
              {actionBusy ? t("Memproses…", "Processing…") : rejectTarget?.spam ? t("Tandai Spam", "Mark as Spam") : t("Tolak Lamaran", "Reject Application")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
