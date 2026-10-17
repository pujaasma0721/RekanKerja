"use client";
// RekanKerja ESS — Presensi Saya (REFACTOR: kalender bulanan interaktif):
// chip statistik + KALENDER warna status per hari (klik hari → panel detail)
// + riwayat harian ringkas (mobile-friendly, bukan tabel lebar) + legenda.
// Navigasi bulan prev/next; hari ini bertanda; i18n penuh.
// P1.3-BM (D-BM7) — tab "Regularisasi": pengajuan koreksi absensi mandiri
// (lupa absen / jam salah) — form (tanggal ≤30 hari ke belakang, jenis, jam,
// alasan ≥10 karakter, lampiran opsional) + daftar pengajuan saya + status
// approval + tarik pengajuan yang masih menunggu.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, RotateCcw, Loader2, AlertTriangle, Fingerprint, CalendarDays, Clock3, Timer, TrendingUp, LogIn, LogOut, Download, ClipboardPen, Send, Undo2, Paperclip, CheckCircle2, XCircle, Ban, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi, apiSend, apiUpload, fmtDate } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { AttachmentUploadArea } from "@/rekankerja/shared/components/attachment-upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ESS_BASE } from "./ess-api";
import type { EssAttendanceData, EssRecord } from "./ess-types";

const monthISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/** geser bulan YYYY-MM sebanyak delta bulan */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, (m ?? 1) - 1 + delta, 1);
  return monthISO(d);
}

// ============ peta warna status (konsisten, aksen amber utk hari ini) ============
const STATUS_META: Record<string, { id: string; en: string; cell: string; dot: string }> = {
  Present: { id: "Hadir", en: "Present", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  Late: { id: "Telat", en: "Late", cell: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-500/10 dark:border-amber-500/25 dark:text-amber-400", dot: "bg-amber-500" },
  Absent: { id: "Absen", en: "Absent", cell: "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/25 dark:text-rose-400", dot: "bg-rose-500" },
  Off: { id: "Libur", en: "Off", cell: "bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-500", dot: "bg-slate-300" },
  OnLeave: { id: "Cuti", en: "Leave", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  WorkOff: { id: "Izin", en: "Permit", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  Holiday: { id: "Hari Libur", en: "Holiday", cell: "bg-brand/10 border-brand/25 text-brand-deep dark:bg-brand/10 dark:border-brand/25 dark:text-brand/85", dot: "bg-brand" },
  "Non-clocking": { id: "Non-clocking", en: "Non-clocking", cell: "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400", dot: "bg-slate-400" },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { id: status, en: status, cell: "bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-400", dot: "bg-slate-400" };
}

// Task 103-e — kategori hari dari DB (EN: Workday/Off/Holiday) → label
// dwibahasa (nilai tak dikenal → raw, kode day type fallback apa adanya).
const DAY_CATEGORY: Record<string, { id: string; en: string }> = {
  Workday: { id: "Hari Kerja", en: "Workday" },
  Off: { id: "Libur", en: "Off" },
  Holiday: { id: "Hari Libur", en: "Holiday" },
};
function dayCategoryLabel(raw: string, t: (id: string, en: string) => string): string {
  const m = DAY_CATEGORY[raw];
  return m ? t(m.id, m.en) : raw;
}

const fmtMin = (m: number | null | undefined, t: (id: string, en: string) => string) => {
  if (!m) return "—";
  if (m < 60) return `${Math.round(m)} ${t("mnt", "min")}`;
  return `${Math.floor(m / 60)} ${t("jam", "h")} ${Math.round(m % 60) ? `${Math.round(m % 60)} ${t("mnt", "min")}` : ""}`.trim();
};

// ===== P1.3-BM (D-BM7) — opsi jenis regularisasi (pasangan id/en + jam wajib) =====
const REG_KIND_OPTIONS = [
  { value: "MissingClockIn", id: "Lupa Clock In", en: "Missing Clock In", needIn: true, needOut: false, hintId: "Jam masuk yang seharusnya tercatat", hintEn: "The clock-in time that should have been recorded" },
  { value: "MissingClockOut", id: "Lupa Clock Out", en: "Missing Clock Out", needIn: false, needOut: true, hintId: "Jam pulang yang seharusnya tercatat", hintEn: "The clock-out time that should have been recorded" },
  { value: "WrongTime", id: "Jam Tercatat Salah", en: "Wrong Recorded Time", needIn: true, needOut: true, hintId: "Koreksi jam masuk & pulang yang salah", hintEn: "Correct the wrong clock-in & out times" },
  { value: "MissingBoth", id: "Lupa Clock In & Out", en: "Missing Both", needIn: true, needOut: true, hintId: "Lengkap kedua jam (masuk & pulang)", hintEn: "Provide both times (in & out)" },
] as const;

/** MyRegRow — kontrak GET /api/rekankerja/ess/regularization. */
interface EssRegRow {
  id: string;
  docNo: string;
  workDate: string;
  kind: string;
  clockIn: string | null;
  clockOut: string | null;
  reason: string;
  status: string;
  createdAt: string;
  decisionNote: string | null;
  decidedAt: string | null;
  attachmentCount: number;
  approval: { currentLevel: number; totalLevels: number; currentApprover: string | null } | null;
}

interface EssRegData {
  rows: EssRegRow[];
  stats: { submitted: number; approved: number; rejected: number; cancelled: number; monthQuotaLeft: number };
}

function essRegKindLabel(kind: string, t: (id: string, en: string) => string): string {
  const o = REG_KIND_OPTIONS.find((k) => k.value === kind);
  return o ? t(o.id, o.en) : kind;
}

// ===== P1.3-BM — seksi REGULARISASI (form + daftar pengajuan saya) =====
function EssRegularizationSection() {
  const { t } = useI18n();
  const api = useApi<EssRegData>(`${ESS_BASE}/regularization`);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [withdraw, setWithdraw] = useState<EssRegRow | null>(null);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const minDate = new Date(today.getTime() - 30 * 86_400_000);
  const minStr = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, "0")}-${String(minDate.getDate()).padStart(2, "0")}`;

  const [form, setForm] = useState({ workDate: todayStr, kind: "MissingClockIn", clockIn: "08:00", clockOut: "17:00", reason: "" });
  const kindOpt = REG_KIND_OPTIONS.find((k) => k.value === form.kind) ?? REG_KIND_OPTIONS[0];

  const rows = api.data?.rows ?? [];
  const stats = api.data?.stats;

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      // unggah lampiran sbg draf DULU (entityType AttendanceRegularization,
      // entityId draft:uuid — di-rebind server ke dokumen final), lalu submit.
      const attachmentIds: string[] = [];
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        fd.append("entityType", "AttendanceRegularization");
        fd.append("entityId", `draft:${crypto.randomUUID()}`);
        const res = await apiUpload<{ id: string }>("/api/rekankerja/attachments", fd);
        attachmentIds.push(res.id);
      }
      const res = await apiSend<{ docNo: string; approvalLevels: number; firstApprover: string | null }>(`${ESS_BASE}/regularization`, "POST", {
        workDate: form.workDate,
        kind: form.kind,
        clockIn: kindOpt.needIn ? form.clockIn : undefined,
        clockOut: kindOpt.needOut ? form.clockOut : undefined,
        reason: form.reason,
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
      });
      toast.success(t("Pengajuan {d} terkirim — menunggu persetujuan {a}", "Request {d} submitted — awaiting {a}'s approval", { d: res.docNo, a: res.firstApprover ?? t("approver", "approver") }));
      setForm({ ...form, reason: "" });
      setFiles([]);
      api.refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("Gagal mengajukan regularisasi", "Failed to submit regularization"));
    } finally {
      setBusy(false);
    }
  };

  const runWithdraw = async () => {
    if (!withdraw) return;
    setWithdrawBusy(true);
    try {
      const res = await apiSend<{ docNo: string; status: string }>(`${ESS_BASE}/regularization`, "PATCH", {
        id: withdraw.id,
        note: withdrawNote.trim() || undefined,
      });
      toast.success(t("{d} ditarik", "{d} withdrawn", { d: res.docNo }));
      setWithdraw(null);
      setWithdrawNote("");
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menarik pengajuan", "Failed to withdraw request"));
    } finally {
      setWithdrawBusy(false);
    }
  };

  return (
    <>
      {/* ===== form pengajuan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <ClipboardPen className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Ajukan Regularisasi Absensi", "Submit Attendance Regularization")}
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {t("Lupa absen atau jam tercatat salah? Ajukan koreksi (maks 30 hari ke belakang) — disetujui otomatis memperbarui rekap Anda.", "Missed a clock or wrong recorded time? Submit a correction (max 30 days back) — approval updates your recap automatically.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-3.5 px-4 pb-4 pt-0 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="reg-date" className="text-xs font-bold">{t("Tanggal Kerja *", "Work Date *")}</Label>
              <Input
                id="reg-date"
                type="date"
                value={form.workDate}
                min={minStr}
                max={todayStr}
                onChange={(e) => setForm({ ...form, workDate: e.target.value })}
                className="text-sm"
              />
              <p className="text-[10px] text-slate-400">{t("Maks 30 hari ke belakang, bukan tanggal masa depan.", "Max 30 days back, not a future date.")}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">{t("Jenis Koreksi *", "Correction Kind *")}</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {REG_KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{t(k.id, k.en)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">{t(kindOpt.hintId, kindOpt.hintEn)}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {kindOpt.needIn && (
              <div className="space-y-1.5">
                <Label htmlFor="reg-in" className="text-xs font-bold">{t("Jam Masuk Diajukan *", "Proposed Clock In *")}</Label>
                <Input id="reg-in" type="time" value={form.clockIn} onChange={(e) => setForm({ ...form, clockIn: e.target.value })} className="text-sm" />
              </div>
            )}
            {kindOpt.needOut && (
              <div className="space-y-1.5">
                <Label htmlFor="reg-out" className="text-xs font-bold">{t("Jam Pulang Diajukan *", "Proposed Clock Out *")}</Label>
                <Input id="reg-out" type="time" value={form.clockOut} onChange={(e) => setForm({ ...form, clockOut: e.target.value })} className="text-sm" />
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-reason" className="text-xs font-bold">{t("Alasan * (min. 10 karakter)", "Reason * (min. 10 characters)")}</Label>
            <Textarea
              id="reg-reason"
              rows={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={t("Jelaskan kronologinya — mis. lupa clock out saat lembur selesai 17:30…", "Explain what happened — e.g. forgot to clock out after overtime ended at 5:30 PM…")}
              className="text-[13px]"
            />
            <p className={cn("text-right text-[10px] font-bold", form.reason.trim().length >= 10 ? "text-slate-400" : "text-amber-600 dark:text-amber-400")}>
              {form.reason.trim().length}/500 · {t("min 10 karakter", "min 10 characters")}
            </p>
          </div>
          {/* lampiran opsional */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("Lampiran Bukti (opsional)", "Supporting Attachment (optional)")}</Label>
            <AttachmentUploadArea
              files={files}
              onChange={setFiles}
              compact
              hint={t("Foto layar clock / bukti kehadiran — JPG/PNG/WEBP/PDF maks 5 MB.", "Clock screenshot / proof of presence — JPG/PNG/WEBP/PDF up to 5 MB.")}
            />
          </div>
          {formError && (
            <p className="flex items-start gap-1.5 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400" role="alert">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {formError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* hint kuota hanya saat stats termuat (bukan saat loading/error —
                kondisi lama menampilkan "habis" saat data belum tersedia). */}
            {stats && (
              <p className="text-[11px] text-slate-400">
                {stats.monthQuotaLeft > 0
                  ? t("Sisa kuota bulan ini: {n} pengajuan aktif.", "Remaining quota this month: {n} active requests.", { n: stats.monthQuotaLeft })
                  : t("Kuota pengajuan aktif bulan ini sudah habis (maks 4).", "Active request quota for this month is used up (max 4).")}
              </p>
            )}
            <Button className="gap-1.5 font-bold" disabled={busy || form.reason.trim().length < 10 || !form.workDate} onClick={submit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("Kirim Pengajuan", "Send Request")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== daftar pengajuan saya ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarClock className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Pengajuan Saya", "My Requests")}
          </CardTitle>
          {stats && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              {t("{s} menunggu · {a} disetujui · {r} ditolak · {c} ditarik", "{s} waiting · {a} approved · {r} rejected · {c} withdrawn", { s: stats.submitted, a: stats.approved, r: stats.rejected, c: stats.cancelled })}
            </p>
          )}
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-0 sm:px-4">
          {api.loading && !api.data ? (
            <div className="px-2"><LoadingRows rows={4} /></div>
          ) : api.error ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-8 text-center dark:border-slate-700 dark:bg-slate-900/30">
              <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat pengajuan", "Failed to load requests")}</p>
              <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={t("Belum ada pengajuan", "No requests yet")}
              description={t("Pengajuan regularisasi absensi Anda akan tampil di sini.", "Your attendance regularization requests will appear here.")}
              icon={ClipboardPen}
            />
          ) : (
            <div className="max-h-[380px] overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar]:w-1.5">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {rows.map((r) => (
                  <li key={r.id} className="px-2.5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-slate-700 dark:text-slate-300">
                          <span className="font-mono text-[11px] text-slate-400">{r.docNo}</span>
                          {fmtDate(r.workDate)} · {essRegKindLabel(r.kind, t)}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                          {t("masuk", "in")} {r.clockIn ?? "—"} · {t("pulang", "out")} {r.clockOut ?? "—"}
                          {r.attachmentCount > 0 && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-slate-400"><Paperclip className="h-3 w-3" aria-hidden /> {r.attachmentCount}</span>
                          )}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] italic text-slate-400">{r.reason}</p>
                        {r.status === "Submitted" && r.approval && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                            <Clock3 className="h-3 w-3" aria-hidden />
                            {t("menunggu {a} (jenjang {l}/{n})", "awaiting {a} (tier {l}/{n})", { a: r.approval.currentApprover ?? t("approver", "approver"), l: r.approval.currentLevel, n: r.approval.totalLevels })}
                          </p>
                        )}
                        {r.status !== "Submitted" && r.decisionNote && (
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {r.status === "Approved" ? <CheckCircle2 className="mr-1 inline h-3 w-3 text-brand" aria-hidden /> : r.status === "Rejected" ? <XCircle className="mr-1 inline h-3 w-3 text-rose-500" aria-hidden /> : <Ban className="mr-1 inline h-3 w-3 text-slate-400" aria-hidden />}
                            {t("Catatan", "Note")}: {r.decisionNote}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <StatusPill status={r.status} />
                        {r.status === "Submitted" && (
                          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px] font-bold" onClick={() => { setWithdraw(r); setWithdrawNote(""); }}>
                            <Undo2 className="h-3.5 w-3.5" /> {t("Tarik", "Withdraw")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* dialog tarik pengajuan */}
      <Dialog open={!!withdraw} onOpenChange={(o) => { if (!o) setWithdraw(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Tarik Pengajuan {d}?", "Withdraw Request {d}?", { d: withdraw?.docNo ?? "—" })}</DialogTitle>
            <DialogDescription>
              {t("Pengajuan yang sudah diputus tidak bisa ditarik kembali.", "Requests that have already been decided cannot be withdrawn.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reg-withdraw-note" className="text-xs font-bold">{t("Catatan (opsional)", "Note (optional)")}</Label>
            <Textarea
              id="reg-withdraw-note"
              rows={2}
              maxLength={300}
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              placeholder={t("Mis. salah tanggal — akan diajukan ulang.", "E.g. wrong date — will resubmit.")}
              className="text-[13px]"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="font-bold" disabled={withdrawBusy} onClick={() => setWithdraw(null)}>
              <Ban className="h-4 w-4" /> {t("Batal", "Cancel")}
            </Button>
            <Button variant="destructive" className="gap-1.5 font-bold" disabled={withdrawBusy} onClick={runWithdraw}>
              {withdrawBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              {t("Tarik Pengajuan", "Withdraw Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EssAttendance() {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(() => monthISO(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  // P1.3-BM — tab internal: "rekap" (kalender bulanan) | "reg" (regularisasi).
  const [tab, setTab] = useState<"rekap" | "reg">("rekap");
  const api = useApi<EssAttendanceData>(`${ESS_BASE}/attendance?month=${month}`, [month]);

  const currentMonth = monthISO(new Date());
  const isCurrent = month === currentMonth;
  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(y, (m ?? 1) - 1, 1));
  }, [month, locale]);

  const summary = api.data?.summary ?? null;
  const days: EssRecord[] = api.data?.days ?? [];
  const byDate = useMemo(() => new Map(days.map((d) => [String(d.date ?? ""), d])), [days]);

  const selectedDay = selected ? byDate.get(selected) ?? null : null;

  // kalender Senin-kolom-pertama
  const calendar = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, (m ?? 1) - 1, 1);
    const daysInMonth = new Date(y, m ?? 12, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const cells: ({ date: string; day: number; rec?: EssRecord } | null)[] = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ date, day: d, rec: byDate.get(date) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month, byDate]);

  const dayHeaders = useMemo(() => {
    const base = new Date(2024, 0, 1); // Senin
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(1 + i);
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d);
    });
  }, [locale]);

  const stats = [
    { label: t("Hadir", "Present"), value: summary ? String(summary.present ?? 0) : "—", accent: "text-brand dark:text-brand/85", icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { label: t("Telat", "Late"), value: summary ? String(summary.late ?? 0) : "—", accent: "text-amber-600 dark:text-amber-400", icon: <Timer className="h-3.5 w-3.5" /> },
    { label: t("Absen", "Absent"), value: summary ? String(summary.absent ?? 0) : "—", accent: "text-rose-600 dark:text-rose-400", icon: <Clock3 className="h-3.5 w-3.5" /> },
    { label: t("Cuti / Izin", "Leave / Permit"), value: summary ? String((Number(summary.onLeave ?? 0) + Number(summary.workoff ?? 0))) : "—", accent: "text-brand dark:text-brand/85", icon: <TrendingUp className="h-3.5 w-3.5" /> },
    { label: t("Lembur", "Overtime"), value: summary ? `${summary.overtimeHours ?? 0} ${t("jam", "h")}` : "—", accent: "text-amber-700 dark:text-amber-400", icon: <Clock3 className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Presensi Saya", "My Attendance")}
        description={t("Kalender kehadiran, jam kerja, lembur per bulan, dan pengajuan regularisasi absensi.", "Attendance calendar, work hours, overtime per month, and attendance regularization requests.")}
        actions={
          tab === "rekap" ? (
            <div className="flex flex-wrap items-center gap-2">
              {/* Task 100 F1 (G26) — feed ICS jadwal shift 60 hari utk kalender ponsel */}
              <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl px-2.5 text-[11px] font-bold" title={t("Unduh jadwal shift saya 60 hari (.ics)", "Download my 60-day shift schedule (.ics)")}>
                <a href={`${ESS_BASE}/attendance/ics`} download aria-label={t("Unduh jadwal shift saya 60 hari (.ics)", "Download my 60-day shift schedule (.ics)")}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> {t("Jadwal (.ics)", "Schedule (.ics)")}
                </a>
              </Button>
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => { setMonth(shiftMonth(month, -1)); setSelected(null); }} aria-label={t("Bulan sebelumnya", "Previous month")}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[130px] text-center text-[13px] font-bold capitalize text-slate-700 dark:text-slate-200">{monthLabel}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" disabled={month >= currentMonth} onClick={() => { setMonth(shiftMonth(month, 1)); setSelected(null); }} aria-label={t("Bulan berikutnya", "Next month")}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {!isCurrent && (
                  <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-lg px-2 text-[11px] font-bold" onClick={() => { setMonth(currentMonth); setSelected(null); }}>
                    <RotateCcw className="h-3 w-3" /> {t("Bulan ini", "This month")}
                  </Button>
                )}
              </div>
            </div>
          ) : undefined
        }
      />

      {/* P1.3-BM — tab internal: rekap bulanan | regularisasi (mobile-friendly) */}
      <div className="flex w-full max-w-sm items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist" aria-label={t("Bagian presensi", "Attendance sections")}>
        {([
          { key: "rekap", label: t("Rekap Bulanan", "Monthly Recap"), icon: <CalendarDays className="h-3.5 w-3.5" aria-hidden /> },
          { key: "reg", label: t("Regularisasi", "Regularization"), icon: <ClipboardPen className="h-3.5 w-3.5" aria-hidden /> },
        ] as const).map((x) => (
          <button
            key={x.key}
            role="tab"
            aria-selected={tab === x.key}
            onClick={() => { setTab(x.key); setSelected(null); }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition",
              tab === x.key
                ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200",
            )}
          >
            {x.icon} {x.label}
          </button>
        ))}
      </div>

      {tab === "reg" && <EssRegularizationSection />}

      <div className={cn("space-y-4", tab !== "rekap" && "hidden")} aria-hidden={tab !== "rekap"}>

      {/* ===== statistik ringkas ===== */}
      {api.loading && !api.data ? (
        <LoadingRows rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className={s.accent}>{s.icon}</span> {s.label}
              </p>
              <p className={cn("mt-1 text-lg font-extrabold tabular-nums", s.accent)}>{s.value}</p>
            </motion.div>
          ))}
        </div>
      )}

      {/* ===== kalender bulanan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <Fingerprint className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Kalender Kehadiran — {m}", "Attendance Calendar — {m}", { m: monthLabel })}
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-slate-400">{t("Klik hari berwarna untuk detail clock in/out & lembur.", "Click a colored day for clock in/out & overtime details.")}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 sm:px-5">
          {api.loading && !api.data ? (
            <LoadingRows rows={5} />
          ) : api.error && !api.data ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
              <AlertTriangle className="h-5 w-5 text-rose-400" aria-hidden />
              <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">{t("Gagal memuat data presensi", "Failed to load attendance data")}</p>
              <Button onClick={api.refresh} variant="outline" size="sm" className="mt-1 gap-1.5 rounded-lg font-bold">
                <Loader2 className="h-3.5 w-3.5" /> {t("Coba Lagi", "Try Again")}
              </Button>
            </div>
          ) : (
            <>
              {/* header hari */}
              <div className="mb-2 grid grid-cols-7 gap-1.5 sm:gap-2">
                {dayHeaders.map((d) => (
                  <p key={d} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{d}</p>
                ))}
              </div>
              {/* grid hari */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {calendar.map((cell, i) => {
                  if (!cell) return <div key={`e${i}`} aria-hidden />;
                  const rec = cell.rec;
                  const meta = rec ? statusMeta(String(rec.status ?? "")) : null;
                  const isToday = cell.date === todayISO();
                  const isSel = cell.date === selected;
                  const future = cell.date > todayISO();
                  return (
                    <button
                      key={cell.date}
                      onClick={() => { if (rec) setSelected(isSel ? null : cell.date); }}
                      disabled={!rec}
                      className={cn(
                        "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-center transition-all",
                        isSel && "ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-950",
                        isToday && "border-amber-400 font-extrabold dark:border-amber-500/50",
                        rec
                          ? cn(meta!.cell, "cursor-pointer hover:scale-[1.04] hover:shadow-md")
                          : future
                            ? "border-dashed border-slate-200 text-slate-300 dark:border-slate-700 dark:text-slate-600"
                            : "border-slate-200/70 bg-slate-50/40 text-slate-400 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-600",
                      )}
                      title={rec ? `${t(meta?.id ?? String(rec.status), meta?.en ?? String(rec.status))}${rec.clockIn ? ` · in ${rec.clockIn}` : ""}` : undefined}
                    >
                      <span className="text-sm tabular-nums sm:text-base">{cell.day}</span>
                      {rec && <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", meta!.dot)} aria-hidden />}
                      {isToday && (
                        <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-1.5 text-[8px] font-extrabold uppercase text-white">
                          {t("ini", "now")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* legenda */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800/70">
                {["Present", "Late", "Absent", "OnLeave", "WorkOff", "Off"].map((s) => {
                  const m = statusMeta(s);
                  return (
                    <span key={s} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span className={cn("h-2 w-2 rounded-full", m.dot)} aria-hidden /> {t(m.id, m.en)}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== detail hari terpilih ===== */}
      <AnimatePresence mode="wait">
        {selectedDay && (
          <motion.div
            key={String(selectedDay.date)}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="rounded-2xl border-amber-500/25 shadow-md dark:border-amber-500/20">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                      {selectedDay.date ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${String(selectedDay.date).slice(0, 10)}T00:00:00`)) : "—"}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      {t("Kategori hari", "Day category")}: {selectedDay.category ?? selectedDay.dayTypeCode ? dayCategoryLabel(String(selectedDay.category ?? selectedDay.dayTypeCode), t) : "—"}
                    </p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold", statusMeta(String(selectedDay.status ?? "")).cell)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta(String(selectedDay.status ?? "")).dot)} aria-hidden />
                    {t(statusMeta(String(selectedDay.status ?? "")).id, statusMeta(String(selectedDay.status ?? "")).en)}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { l: t("Clock In", "Clock In"), v: selectedDay.clockIn ? String(selectedDay.clockIn) : "—", icon: <LogIn className="h-3 w-3" /> },
                    { l: t("Clock Out", "Clock Out"), v: selectedDay.clockOut ? String(selectedDay.clockOut) : "—", icon: <LogOut className="h-3 w-3" /> },
                    { l: t("Jam Kerja", "Work Time"), v: fmtMin(selectedDay.workMinutes as number | null ?? null, t), icon: <Clock3 className="h-3 w-3" /> },
                    { l: t("Lembur", "Overtime"), v: fmtMin(selectedDay.overtimeMinutes as number | null ?? null, t), icon: <Timer className="h-3 w-3" /> },
                    { l: t("Telat", "Late"), v: (selectedDay.lateMinutes as number | undefined) ? `+${fmtMin(selectedDay.lateMinutes as number, t)}` : "—", icon: <Timer className="h-3 w-3" /> },
                    { l: t("Pulang Cepat", "Early Out"), v: (selectedDay.earlyMinutes as number | undefined) ? `−${fmtMin(selectedDay.earlyMinutes as number, t)}` : "—", icon: <Clock3 className="h-3 w-3" /> },
                  ].map((x) => (
                    <div key={x.l} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{x.icon} {x.l}</p>
                      <p className="mt-0.5 font-mono text-[13px] font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{x.v}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== riwayat harian (daftar ringkas — ramah mobile) ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <CalendarDays className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Riwayat Harian — {m}", "Daily History — {m}", { m: monthLabel })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-3 pt-0 sm:px-4">
          {api.loading && !api.data ? (
            <div className="px-2"><LoadingRows rows={5} /></div>
          ) : days.length === 0 ? (
            <EmptyState
              title={t("Tidak ada data bulan ini", "No data for this month")}
              description={t("Data presensi akan muncul setelah ada catatan clock atau jadwal.", "Attendance data appears once clock records or schedules exist.")}
              icon={CalendarDays}
            />
          ) : (
            <div className="max-h-[380px] overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar]:w-1.5">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {[...days].reverse().map((d, i) => {
                  const dateStr = String(d.date ?? "");
                  const isToday = dateStr.slice(0, 10) === todayISO();
                  const meta = statusMeta(String(d.status ?? ""));
                  const late = (d.lateMinutes as number | undefined) ?? 0;
                  const early = (d.earlyMinutes as number | undefined) ?? 0;
                  const inTime = d.clockIn ? String(d.clockIn) : null;
                  const outTime = d.clockOut ? String(d.clockOut) : null;
                  const ot = (d.overtimeMinutes as number | undefined) ?? 0;
                  return (
                    <li key={dateStr || i}>
                      <button
                        onClick={() => setSelected(selected === dateStr ? null : dateStr)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60",
                          selected === dateStr && "bg-amber-50/70 dark:bg-amber-500/10",
                          isToday && "font-bold",
                        )}
                      >
                        <div className="w-20 shrink-0 sm:w-24">
                          <p className={cn("text-[12.5px] font-bold", isToday ? "text-amber-800 dark:text-amber-300" : "text-slate-700 dark:text-slate-300")}>
                            {dateStr ? fmtDate(dateStr) : "—"}
                          </p>
                          {isToday && <span className="rounded-full bg-amber-500 px-1.5 text-[8px] font-extrabold uppercase text-white">{t("ini", "now")}</span>}
                        </div>
                        <span className="hidden min-w-0 flex-1 gap-4 sm:flex">
                          <span className="font-mono text-[11.5px] tabular-nums text-slate-500 dark:text-slate-400">
                            {inTime ?? "—:—"} → {outTime ?? "—:—"}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {(d.workMinutes as number | undefined) ? fmtMin(d.workMinutes as number, t) : "—"}
                          </span>
                        </span>
                        <div className="ml-auto flex shrink-0 items-center gap-2">
                          {late > 0 && <span className="text-[11px] font-bold tabular-nums text-rose-600 dark:text-rose-400">+{fmtMin(late, t)}</span>}
                          {early > 0 && <span className="hidden text-[11px] font-bold tabular-nums text-brand dark:text-brand/85 sm:inline">−{fmtMin(early, t)}</span>}
                          {ot > 0 && <span className="text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-400">{t("lem", "OT")} {fmtMin(ot, t)}</span>}
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold", meta.cell)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden /> {t(meta.id, meta.en)}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
