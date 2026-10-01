"use client";
// RekanKerja ESS — Surat: permintaan surat layanan karyawan (Task 26-a) ========
// =====================================================================
// Dua arah: karyawan meminta surat → HR memutuskan (Template Surat →
// Permintaan Masuk) → karyawan mengunduh PDF hasil terbitan.
//   · Kartu jenis surat (katalog EmployeeService aktif) — kartu menandai
//     bila masih ada permintaan menunggu keputusan (maks 1 per jenis);
//   · Dialog permintaan: jenis + keperluan (pilihan cepat Kredit/KPR/Visa/
//     Asuransi/Lainnya + tulis bebas) + catatan;
//   · Riwayat: timeline status (Diajukan → Menunggu HR → Diterbitkan/Ditolak
//     + alasan), tombol "Unduh PDF" bila Issued (endpoint ESS milik permintaan).
import { useState } from "react";
import { toast } from "sonner";
import {
  FileText, Loader2, Send, AlertTriangle, History, FileDown, Clock3, CheckCircle2,
  XCircle, HeartHandshake,
} from "lucide-react";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ESS_BASE, submitLetterRequest } from "./ess-api";
import type { EssLettersData, EssLetterRequest } from "./ess-types";
import { fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";

// pilihan keperluan cepat + "Lainnya" (tulis bebas)
const PURPOSE_OPTIONS = ["Kredit", "KPR", "Visa", "Asuransi", "Lainnya"] as const;

function FormError({ message }: { message: string | null }) {
  const { t } = useI18n();
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="break-words">{message}</span>
    </div>
  );
}

// ===== satu baris riwayat permintaan: timeline 3 langkah + aksi =====
function RequestTimelineItem({ r }: { r: EssLetterRequest }) {
  const { t } = useI18n();
  return (
    <li className="relative pl-8">
      {/* rel timeline */}
      <span
        aria-hidden
        className={cnDot(
          r.status === "Pending" ? "bg-amber-400" : r.status === "Issued" ? "bg-brand" : "bg-rose-500",
        )}
      />
      <div className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">{r.templateName}</p>
          <span className="font-mono text-[11px] font-semibold text-slate-400">{r.reqNo}</span>
          <StatusPill status={r.status} />
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          {t("diajukan", "requested")} {fmtDateTime(r.createdAt)}
          {r.purpose ? ` · ${t("keperluan", "for")}: ${r.purpose}` : ""}
        </p>
        {r.notes && (
          <p className="mt-1 rounded-lg bg-slate-100/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            “{r.notes}”
          </p>
        )}

        {/* timeline status ringkas */}
        <ol className="mt-2.5 space-y-1.5" aria-label={t("Status permintaan", "Request status")}>
          <li className="flex items-center gap-2 text-[11.5px] font-semibold text-slate-600 dark:text-slate-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            {t("Permintaan diterima — menunggu keputusan HR", "Request received — awaiting HR decision")}
          </li>
          {r.status === "Pending" && (
            <li className="flex items-center gap-2 text-[11.5px] font-semibold text-amber-700 dark:text-amber-400">
              <Clock3 className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden />
              {t("Sedang diproses HR", "Being processed by HR")}
            </li>
          )}
          {r.status === "Issued" && (
            <li className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-brand-deep dark:text-brand/85">
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("Diterbitkan", "Issued")} — <span className="font-mono">{r.letterRefNo ?? "—"}</span>
              {r.issuedAt ? ` · ${fmtDate(r.issuedAt)}` : ""}
            </li>
          )}
          {r.status === "Rejected" && (
            <li className="flex items-start gap-2 text-[11.5px] font-semibold text-rose-600 dark:text-rose-400">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {t("Ditolak", "Rejected")}
                {r.rejectReason ? ` — ${r.rejectReason}` : ""}
              </span>
            </li>
          )}
        </ol>

        {r.status === "Issued" && r.id && (
          <Button asChild size="sm" variant="outline" className="mt-2.5 h-8 gap-1.5 rounded-lg px-3 text-[11px] font-bold">
            <a href={`${ESS_BASE}/letters/${r.id}/pdf`} download>
              <FileDown className="h-3.5 w-3.5" /> {t("Unduh PDF", "Download PDF")}
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

/** titik timeline bulat di kiri baris. */
function cnDot(color: string): string {
  return `absolute -left-0.5 top-4 h-3.5 w-3.5 rounded-full border-[3px] border-white dark:border-slate-950 ${color}`;
}

export function EssLetters() {
  const { t } = useI18n();
  const api = useApi<EssLettersData>(`${ESS_BASE}/letters`);
  const [reqOpen, setReqOpen] = useState(false);
  const [form, setForm] = useState({ templateKey: "", purpose: "", customPurpose: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = api.data?.templates ?? [];
  const requests = api.data?.requests ?? [];
  // permintaan menunggu per jenis (kartu disable + chip status)
  const pendingByTemplate = new Map(
    requests.filter((r) => r.status === "Pending").map((r) => [r.templateKey, r]),
  );

  const openDialog = (templateKey: string) => {
    setError(null);
    setForm({ templateKey, purpose: "", customPurpose: "", notes: "" });
    setReqOpen(true);
  };

  const submit = async () => {
    if (busy) return;
    const purpose =
      form.purpose === "Lainnya" ? form.customPurpose.trim() : form.purpose;
    if (!form.templateKey) { setError(t("Jenis surat wajib dipilih.", "A letter type is required.")); return; }
    if (form.purpose === "Lainnya" && !purpose) {
      setError(t("Tuliskan keperluan Anda.", "Please describe your purpose."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await submitLetterRequest({
        templateKey: form.templateKey,
        purpose: purpose || undefined,
        notes: form.notes.trim() || undefined,
      });
      toast.success(t(
        "Permintaan {doc} diajukan — menunggu keputusan HR",
        "Request {doc} submitted — awaiting HR decision",
        { doc: res.docNo },
      ));
      setReqOpen(false);
      api.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Gagal mengajukan permintaan surat.", "Failed to submit the letter request."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Employee Self Service", "Employee Self Service")}
        title={t("Surat", "Letters")}
        description={t(
          "Minta surat keterangan kerja, keterangan gaji, pengalaman kerja, referensi, atau PKWT — HR menyetujui lalu PDF siap diunduh.",
          "Request employment, salary, experience, reference letters or a PKWT — once HR approves, the PDF is ready to download.",
        )}
      />

      {/* ===== kartu jenis surat ===== */}
      {api.loading && !api.data ? (
        <LoadingRows rows={4} />
      ) : templates.length === 0 ? (
        <EmptyState
          title={t("Belum ada jenis surat tersedia", "No letter types available yet")}
          description={t("Perusahaan belum mengaktifkan template surat layanan karyawan.", "Your company has not enabled employee service letter templates yet.")}
          icon={FileText}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {templates.map((tpl) => {
            const pending = pendingByTemplate.get(tpl.key) ?? null;
            return (
              <Card key={tpl.key} className="flex flex-col rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <FileText className="h-4 w-4" aria-hidden />
                    </span>
                    {tpl.name}
                  </CardTitle>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-slate-400">
                    {tpl.description ?? tpl.subject ?? ""}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-1">
                  <div className="rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-800">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <History className="h-3 w-3" aria-hidden /> {t("Status Terakhir", "Latest Status")}
                    </p>
                    {pending ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] font-semibold text-slate-600 dark:text-slate-300">{pending.reqNo}</span>
                        <StatusPill status={pending.status} />
                      </div>
                    ) : (
                      <p className="text-[12px] text-slate-400">{t("Belum ada permintaan aktif.", "No active request.")}</p>
                    )}
                  </div>
                  <Button
                    onClick={() => openDialog(tpl.key)}
                    disabled={!!pending}
                    className="w-full gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700"
                  >
                    {pending ? <Clock3 className="h-4 w-4" /> : <HeartHandshake className="h-4 w-4" />}
                    {pending
                      ? t("Menunggu keputusan HR", "Awaiting HR decision")
                      : t("Minta Surat Ini", "Request This Letter")}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ===== riwayat permintaan ===== */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            {t("Riwayat Permintaan Surat", "Letter Request History")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          {api.loading && !api.data ? (
            <p className="py-4 text-center text-[12px] text-slate-400">{t("Memuat…")}</p>
          ) : requests.length === 0 ? (
            <EmptyState
              title={t("Belum ada permintaan surat", "No letter requests yet")}
              description={t("Permintaan surat Anda dan status persetujuannya tampil di sini.", "Your letter requests and their approval status appear here.")}
              icon={History}
            />
          ) : (
            <ol className="relative ml-2 space-y-3 border-l border-slate-200 pl-6 dark:border-slate-800">
              {requests.map((r) => <RequestTimelineItem key={r.id} r={r} />)}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog permintaan surat ===== */}
      <Dialog open={reqOpen} onOpenChange={(v) => { if (!busy) setReqOpen(v); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
              {t("Ajukan Permintaan Surat", "Request a Letter")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "HR akan meninjau permintaan Anda — surat PDF siap diunduh setelah disetujui.",
                "HR will review your request — the letter PDF is downloadable once approved.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ess-lt-key">{t("Jenis Surat", "Letter Type")}</Label>
              <Select value={form.templateKey} onValueChange={(v) => setForm((f) => ({ ...f, templateKey: v }))}>
                <SelectTrigger id="ess-lt-key" className="w-full">
                  <SelectValue placeholder={t("Pilih jenis surat…", "Choose a letter type…")} />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((tpl) => (
                    <SelectItem key={tpl.key} value={tpl.key}>
                      {tpl.name}
                      {pendingByTemplate.has(tpl.key) ? t(" (menunggu)", " (pending)") : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ess-lt-purpose">{t("Keperluan", "Purpose")}</Label>
              <Select value={form.purpose} onValueChange={(v) => setForm((f) => ({ ...f, purpose: v }))}>
                <SelectTrigger id="ess-lt-purpose" className="w-full">
                  <SelectValue placeholder={t("pilih atau tulis bebas…", "pick or write freely…")} />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSE_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.purpose === "Lainnya" && (
                <Input
                  className="mt-1.5"
                  value={form.customPurpose}
                  maxLength={200}
                  onChange={(e) => setForm((f) => ({ ...f, customPurpose: e.target.value }))}
                  placeholder={t("mis. pendaftaran sekolah anak…", "e.g. child's school enrolment…")}
                  aria-label={t("Keperluan lain", "Other purpose")}
                />
              )}
              <p className="text-[10px] text-slate-400">
                {t("Dapat dikosongkan — surat akan memuat \"sesuai keperluan\".", "Optional — the letter will print \"as needed\".")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ess-lt-notes">{t("Catatan untuk HR (opsional)", "Note to HR (optional)")}</Label>
              <Textarea
                id="ess-lt-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                maxLength={300}
                placeholder={t("mis. dibutuhkan sebelum tanggal…", "e.g. needed before a certain date…")}
              />
            </div>

            <FormError message={error} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setReqOpen(false)} className="rounded-xl font-bold">{t("Batal")}</Button>
            <Button onClick={() => void submit()} disabled={busy} className="gap-2 rounded-xl bg-amber-600 font-bold text-white hover:bg-amber-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t("Menyimpan…") : t("Ajukan Permintaan", "Submit Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
