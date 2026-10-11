"use client";
// RekanKerja Recruitment F6a — UI "Parse CV" & human-verify (Talent Pool).
// Mirror kontrak API /api/rekankerja/recruitment/ai (pola F2/F3: file service
// BUKAN client-safe — interface lokal identik dgn ai-cv-service.ts):
//   GET  ?applicantId=                            → { parse: CvParseSerializer | null }
//   POST { action:"parse-text", applicantId, text, mode? }
//   POST { action:"parse-document", applicantId, documentId, mode? }
//   POST { action:"verify", parseId }             → { ok:true }
// Dipakai applicants.tsx: (1) dialog Parse CV dari aksi baris tabel,
// (2) tab "Parse CV" di dialog detail pelamar (komponen CvParseSection sama).
// Label mode jujur (D7): "AI (model)" emerald / "Simulasi" amber / "Manual"
// slate — simulated tidak pernah mengklaim AI.
import { useState } from "react";
import { useApi, apiSend, fmtIDR, fmtDate, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { fmtSize } from "@/rekankerja/shared/components/attachment-upload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  FileSearch, Sparkles, ClipboardPaste, FileText, GraduationCap, BriefcaseBusiness,
  BadgeCheck, Info,
} from "lucide-react";

export const AI_CV_API = "/api/rekankerja/recruitment/ai";

// ============ tipe (mirror JSON API F6a — jangan import service) ============

export interface CvField<T> {
  value: T | null;
  /** keyakinan 0–1 (simulated maks 0.5 — label jujur). */
  confidence: number;
}

export interface CvEducationItem {
  level: string;
  fieldOfStudy: string | null;
  institution: string | null;
  graduationYear: number | null;
  gpa: number | null;
}

export interface CvExperienceItem {
  position: string;
  company: string | null;
  years: number | null;
}

export interface CvParsedFields {
  fullName: CvField<string>;
  email: CvField<string>;
  phone: CvField<string>;
  city: CvField<string>;
  /** "YYYY-MM-DD" (atau string mentah belum dinormalkan). */
  birthDate: CvField<string>;
  education: CvField<CvEducationItem[]>;
  experiences: CvField<CvExperienceItem[]>;
  skills: CvField<string[]>;
  /** rupiah per bulan. */
  expectedSalary: CvField<number>;
}

export interface CvParseSerializer {
  id: string;
  applicantId: string;
  sourceKind: string; // pdf|docx|txt|paste
  mode: string; // ai|simulated|manual
  model: string | null;
  fields: CvParsedFields;
  verifiedAt: string | null;
  createdAt: string;
}

/** dokumen pelamar (baris documents dari detail applicants API). */
export interface CvSourceDoc {
  id: string;
  title: string;
  requiredDocTitle?: string | null;
  fileName?: string | null;
  sizeBytes?: number | null;
  verified?: boolean;
}

interface CvApplicantRef {
  id: string;
  applicantNo: string;
  fullName: string;
}

// ============ atom kecil ============

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
};
const TONE_DOT: Record<string, string> = { emerald: "bg-emerald-500", amber: "bg-amber-500", slate: "bg-slate-400" };

/** badge mode jujur — "AI (model)" / "Simulasi" / "Manual" (pola Pill F2). */
function ModeBadge({ mode, model }: { mode: string; model: string | null }) {
  const { t } = useI18n();
  const label = mode === "ai"
    ? `AI (${model ?? "builtin"})`
    : mode === "simulated"
      ? t("Simulasi", "Simulated")
      : mode === "manual"
        ? t("Manual", "Manual")
        : mode;
  const tone = mode === "ai" ? "emerald" : mode === "simulated" ? "amber" : "slate";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      TONE_CLS[tone] ?? TONE_CLS.slate,
    )}>
      {mode === "ai" && <Sparkles className="h-3 w-3" aria-hidden />}
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} aria-hidden />
      {label}
    </span>
  );
}

/** bar confidence mini — width % = confidence×100; ≥0.8 emerald · ≥0.5 amber · <0.5 rose. */
function ConfidenceBar({ value }: { value: number }) {
  const { t } = useI18n();
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  const tone = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={t("Keyakinan {p}%", "Confidence {p}%", { p: String(pct) })}
    >
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-right text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
    </span>
  );
}

/** label sumber parse — paste → dwibahasa; pdf/docx/txt → uppercase netral. */
function sourceKindText(t: (id: string, en?: string) => string, sourceKind: string): string {
  if (sourceKind === "paste") return t("teks tempel", "pasted text");
  return sourceKind.toUpperCase();
}

// ============ panel hasil parse (human-verify) ============

function CvResultPanel({
  parse, canVerify, verifying, onVerify,
}: {
  parse: CvParseSerializer;
  canVerify: boolean;
  verifying: boolean;
  onVerify: () => void;
}) {
  const { t } = useI18n();
  const f = parse.fields;
  const birthText = f.birthDate.value
    ? (/^\d{4}-\d{2}-\d{2}$/.test(f.birthDate.value) ? fmtDate(f.birthDate.value) : f.birthDate.value)
    : "—";

  /** kotak field utama: label + bar confidence + nilai. */
  const fieldBox = (label: string, value: string, field: CvField<unknown>, wide?: boolean) => (
    <div key={label} className={cn("rounded-xl border border-slate-200 bg-white/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60", wide && "sm:col-span-2")}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
        <ConfidenceBar value={field.confidence} />
      </div>
      <div className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* header: badge mode jujur + timestamp + sumber + status verifikasi */}
      <div className="flex flex-wrap items-center gap-2">
        <ModeBadge mode={parse.mode} model={parse.model} />
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {fmtDateTime(parse.createdAt)} · {t("Sumber", "Source")}: {sourceKindText(t, parse.sourceKind)}
        </span>
        <span className="flex-1" />
        {parse.verifiedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {t("Terverifikasi", "Verified")} ✓ {fmtDate(parse.verifiedAt)}
          </span>
        ) : canVerify ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
            onClick={onVerify}
            disabled={verifying}
          >
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {verifying ? t("Menandai…", "Marking…") : t("Tandai Diverifikasi", "Mark Verified")}
          </Button>
        ) : null}
      </div>

      {/* field utama */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {fieldBox(t("Nama Lengkap", "Full Name"), f.fullName.value ?? "—", f.fullName)}
        {fieldBox(t("Email", "Email"), f.email.value ?? "—", f.email)}
        {fieldBox(t("Telepon", "Phone"), f.phone.value ?? "—", f.phone)}
        {fieldBox(t("Kota", "City"), f.city.value ?? "—", f.city)}
        {fieldBox(t("Tanggal Lahir", "Birth Date"), birthText, f.birthDate)}
        {fieldBox(t("Ekspektasi Gaji", "Expected Salary"), f.expectedSalary.value != null ? fmtIDR(f.expectedSalary.value) : "—", f.expectedSalary)}
        {/* skills — lebar penuh dgn chips */}
        <div className="rounded-xl border border-slate-200 bg-white/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60 sm:col-span-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Keahlian", "Skills")}</span>
            <ConfidenceBar value={f.skills.confidence} />
          </div>
          {f.skills.value && f.skills.value.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {f.skills.value.map((s) => (
                <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>
              ))}
            </div>
          ) : (
            <div className="text-sm font-medium text-slate-400">—</div>
          )}
        </div>
      </div>

      {/* pendidikan terdeteksi */}
      {f.education.value && f.education.value.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h5 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden /> {t("Pendidikan Terdeteksi", "Detected Education")}
            </h5>
            <ConfidenceBar value={f.education.confidence} />
          </div>
          <ul className="space-y-1">
            {f.education.value.map((e, i) => (
              <li key={i} className="text-xs text-slate-700 dark:text-slate-300">
                <span className="font-semibold">{e.level}</span>
                {e.fieldOfStudy ? ` — ${e.fieldOfStudy}` : ""}
                <span className="text-slate-500 dark:text-slate-400">
                  {" · "}{e.institution ?? "—"}{" · "}{t("lulus", "graduated")} {e.graduationYear ?? "—"}
                </span>
                {e.gpa != null && <span className="text-slate-500 dark:text-slate-400">{" · "}IPK {e.gpa.toFixed(2)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* pengalaman terdeteksi */}
      {f.experiences.value && f.experiences.value.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h5 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden /> {t("Pengalaman Terdeteksi", "Detected Experience")}
            </h5>
            <ConfidenceBar value={f.experiences.confidence} />
          </div>
          <ul className="space-y-1">
            {f.experiences.value.map((e, i) => (
              <li key={i} className="text-xs text-slate-700 dark:text-slate-300">
                <span className="font-semibold">{e.position}</span>
                {e.company ? ` ${t("di", "at")} ${e.company}` : ""}
                {e.years != null && <span className="text-slate-500 dark:text-slate-400"> — {e.years} {t("thn", "yr")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============ seksi lengkap: sumber parse + hasil (human-verify) ============

/**
 * Seksi Parse CV — dipakai (a) di dalam dialog ParseCvDialog, (b) sebagai tab
 * "Parse CV" dialog detail pelamar. GET hasil terakhir saat mount (Radix
 * unmount dialog/tab saat tertutup → selalu segar), lalu parse/verify via POST.
 */
export function CvParseSection({
  applicant, documents, canVerify, docsLoading = false,
}: {
  applicant: CvApplicantRef;
  documents: CvSourceDoc[];
  canVerify: boolean;
  docsLoading?: boolean;
}) {
  const { t } = useI18n();
  const parseApi = useApi<{ parse: CvParseSerializer | null }>(`${AI_CV_API}?applicantId=${applicant.id}`, [applicant.id]);
  const parse = parseApi.data?.parse ?? null;

  const [cvText, setCvText] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const doParseText = async () => {
    if (!cvText.trim()) {
      toast.error(t("Tempel teks CV terlebih dahulu", "Paste the CV text first"));
      return;
    }
    setParsing(true);
    try {
      const res = await apiSend<{ parse: CvParseSerializer }>(AI_CV_API, "POST", {
        action: "parse-text",
        applicantId: applicant.id,
        text: cvText,
        mode: simulated ? "simulated" : "auto",
      });
      parseApi.setData({ parse: res.parse });
      toast.success(t("CV berhasil diparsing — periksa & verifikasi hasilnya", "CV parsed — review & verify the result"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mem-parsing CV", "Failed to parse the CV"));
    } finally {
      setParsing(false);
    }
  };

  const doParseDoc = async (documentId: string) => {
    setDocBusy(documentId);
    try {
      const res = await apiSend<{ parse: CvParseSerializer }>(AI_CV_API, "POST", {
        action: "parse-document",
        applicantId: applicant.id,
        documentId,
        mode: "auto",
      });
      parseApi.setData({ parse: res.parse });
      toast.success(t("Dokumen CV berhasil diparsing — periksa & verifikasi hasilnya", "CV document parsed — review & verify the result"));
    } catch (e) {
      // 400 ramah dari backend (mis. PDF scan/gambar) — pesan server langsung dipakai.
      toast.error(e instanceof Error ? e.message : t("Gagal mem-parsing dokumen", "Failed to parse the document"));
    } finally {
      setDocBusy(null);
    }
  };

  const doVerify = async () => {
    if (!parse) return;
    setVerifying(true);
    try {
      await apiSend<{ ok: boolean }>(AI_CV_API, "POST", { action: "verify", parseId: parse.id });
      toast.success(t("Hasil parse ditandai diverifikasi", "Parse result marked as verified"));
      parseApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memverifikasi hasil parse", "Failed to verify the parse result"));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ===== sumber ===== */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <FileSearch className="h-3.5 w-3.5" aria-hidden /> {t("Sumber CV", "CV Source")}
        </h4>
        <Tabs defaultValue="paste">
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
            <TabsTrigger value="paste" className="gap-1.5 px-3 py-1.5 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              <ClipboardPaste className="h-3.5 w-3.5" aria-hidden /> {t("Tempel Teks", "Paste Text")}
            </TabsTrigger>
            <TabsTrigger value="docs" className="gap-1.5 px-3 py-1.5 text-xs data-[state=active]:bg-white data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-slate-100">
              <FileText className="h-3.5 w-3.5" aria-hidden /> {t("Dari Dokumen", "From Document")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="mt-3 space-y-2">
            <Textarea
              rows={9}
              value={cvText}
              onChange={(e) => setCvText(e.target.value)}
              placeholder={t(
                "Tempel isi CV di sini — nama, kontak, pendidikan, pengalaman, keahlian, ekspektasi gaji…",
                "Paste the CV contents here — name, contact, education, experience, skills, expected salary…",
              )}
              className="font-mono text-xs leading-relaxed"
              aria-label={t("Teks CV", "CV text")}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-w-0 items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                <Checkbox checked={simulated} onCheckedChange={(c) => setSimulated(c === true)} className="mt-0.5" />
                <span>{t("Mode simulasi (tanpa AI)", "Simulated mode (no AI)")}</span>
              </label>
              <Button type="button" size="sm" className="ov-fill gap-1.5" onClick={() => void doParseText()} disabled={parsing}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {parsing ? t("Mem-parsing…", "Parsing…") : t("Parse Teks", "Parse Text")}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(
                "Mode otomatis memakai AI bila tersedia; bila gagal jatuh ke simulasi — mode selalu diberi label jujur.",
                "Automatic mode uses AI when available; on failure it falls back to simulation — the mode is always honestly labelled.",
              )}
            </p>
          </TabsContent>

          <TabsContent value="docs" className="mt-3 space-y-2">
            {docsLoading ? (
              <LoadingRows rows={2} />
            ) : documents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                {t(
                  "Belum ada dokumen terunggah — unggah CV di tab Dokumen pada detail pelamar.",
                  "No uploaded documents yet — upload a CV in the applicant detail's Documents tab.",
                )}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">{d.title}</div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {d.requiredDocTitle ?? t("tanpa jenis wajib", "no required type")}
                        {d.fileName ? ` · ${d.fileName}` : ""}
                        {d.sizeBytes != null ? ` · ${fmtSize(d.sizeBytes)}` : ""}
                        {d.verified ? ` · ${t("terverifikasi", "verified")}` : ""}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1.5"
                      disabled={docBusy != null}
                      onClick={() => void doParseDoc(d.id)}
                    >
                      <FileSearch className="h-3.5 w-3.5" aria-hidden />
                      {docBusy === d.id ? t("Mem-parsing…", "Parsing…") : t("Parse", "Parse")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t(
                "PDF/DOCX/TXT dengan lapisan teks didukung — CV hasil scan/gambar ditolak dengan pesan ramah.",
                "PDF/DOCX/TXT with a text layer is supported — scanned/image CVs are rejected with a friendly message.",
              )}
            </p>
          </TabsContent>
        </Tabs>
      </section>

      {/* ===== hasil parse terakhir ===== */}
      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("Hasil Parse Terakhir", "Latest Parse Result")}
        </h4>
        {parseApi.loading && !parseApi.data ? (
          <LoadingRows rows={3} />
        ) : parseApi.error ? (
          <EmptyState title={t("Gagal memuat hasil parse", "Failed to load the parse result")} description={parseApi.error} />
        ) : !parse ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
            {t(
              "Belum ada hasil parse untuk pelamar ini — tempel teks CV atau pilih dokumen di atas.",
              "No parse result for this applicant yet — paste the CV text or pick a document above.",
            )}
          </p>
        ) : (
          <CvResultPanel parse={parse} canVerify={canVerify} verifying={verifying} onVerify={() => void doVerify()} />
        )}
      </section>

      {/* disclaim keputusan manusia */}
      <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {t(
          "Skor & keyakinan AI hanya membantu — keputusan tetap di tangan HR.",
          "AI scores & confidence are only an aid — the decision stays with HR.",
        )}
      </p>
    </div>
  );
}

// ============ dialog Parse CV (aksi baris tabel) ============

/**
 * Dialog Parse CV dari aksi baris tabel — memuat dokumen pelamar sendiri
 * (detail applicants API) supaya pemanggil cukup pass identitas pelamar.
 */
export function ParseCvDialog({
  open, onOpenChange, applicant, canVerify,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  applicant: CvApplicantRef | null;
  canVerify: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <FileSearch className="h-4 w-4 text-brand-deep dark:text-brand/80" aria-hidden />
            {t("Parse CV — {no}", "Parse CV — {no}", { no: applicant?.applicantNo ?? "…" })}
            {applicant && (
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-slate-500 dark:text-slate-400">{applicant.fullName}</span>
            )}
          </DialogTitle>
        </DialogHeader>
        {applicant
          ? <ParseCvDialogBody applicant={applicant} canVerify={canVerify} />
          : <LoadingRows rows={3} />}
      </DialogContent>
    </Dialog>
  );
}

/** body dialog — terpisah supaya fetch dokumen hanya berjalan saat dialog terbuka. */
function ParseCvDialogBody({ applicant, canVerify }: { applicant: CvApplicantRef; canVerify: boolean }) {
  const { t } = useI18n();
  const detailApi = useApi<{ row: { documents: CvSourceDoc[] } }>(
    `/api/rekankerja/recruitment/applicants?id=${applicant.id}`,
    [applicant.id],
  );
  const documents = detailApi.data?.row.documents ?? [];
  return (
    <>
      {detailApi.error && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          {t("Daftar dokumen gagal dimuat — parse teks tetap tersedia.", "Document list failed to load — text parsing is still available.")}
        </p>
      )}
      <CvParseSection
        applicant={applicant}
        documents={documents}
        docsLoading={detailApi.loading && !detailApi.data}
        canVerify={canVerify}
      />
    </>
  );
}
