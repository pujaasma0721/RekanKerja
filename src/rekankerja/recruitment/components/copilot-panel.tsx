"use client";
// RekanKerja Recruitment F6c (2/2) — Recruiter Copilot (panel di view Seleksi).
// 6 aksi terkurasi (HRX B4/B5/B6) → POST /api/rekankerja/recruitment/ai
// { action:"copilot", params:{ action:"draft-jd"|"summarize-candidate"|
// "interview-questions"|"outreach"|"pipeline-qa"|"check-bias", … } } →
// { mode, text } (kontrak F6c-BACKEND/3c — text markdown ringan baris/bullet/⚠).
// Pilihan PR/kandidat reuse data yang sudah dimuat view selection (prs +
// board) — tidak ada fetch tambahan. Guard op copilot recruitment:selection
// (tombol toolbar disembunyikan bila canOp false — gating di selection.tsx).
// Mode jujur (D7): badge AI emerald / Simulasi amber; hasil selalu draf/
// rekomendasi — keputusan tetap manusia (P2).
import { useState } from "react";
import { apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Bot, FileText, UserRound, MessagesSquare, Send, CircleHelp, ShieldAlert,
  Sparkles, Loader2, Copy, Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ResultModeBadge } from "./ai-search-bar";

const AI_API = "/api/rekankerja/recruitment/ai";

// ---------- konfigurasi aksi (kontrak 3c) ----------

type CopilotKey =
  | "draft-jd" | "summarize-candidate" | "interview-questions"
  | "outreach" | "pipeline-qa" | "check-bias";

const ACTIONS: { key: CopilotKey; label: string; labelEn: string; icon: LucideIcon }[] = [
  { key: "draft-jd", label: "Draf JD", labelEn: "Draft JD", icon: FileText },
  { key: "summarize-candidate", label: "Ringkas Kandidat", labelEn: "Summarize Candidate", icon: UserRound },
  { key: "interview-questions", label: "Pertanyaan Interview", labelEn: "Interview Questions", icon: MessagesSquare },
  { key: "outreach", label: "Draf Outreach", labelEn: "Draft Outreach", icon: Send },
  { key: "pipeline-qa", label: "Tanya Pipeline", labelEn: "Ask Pipeline", icon: CircleHelp },
  { key: "check-bias", label: "Cek Bias JD", labelEn: "Check JD Bias", icon: ShieldAlert },
];

const RUN_LABEL: Record<CopilotKey, [string, string]> = {
  "draft-jd": ["Buat Draf JD", "Generate JD Draft"],
  "summarize-candidate": ["Ringkas Kandidat", "Summarize Candidate"],
  "interview-questions": ["Buat Pertanyaan", "Generate Questions"],
  outreach: ["Buat Draf", "Generate Draft"],
  "pipeline-qa": ["Tanya", "Ask"],
  "check-bias": ["Periksa Bias", "Check Bias"],
};

export function CopilotPanel({
  open, onClose, prs, candidates,
}: {
  open: boolean;
  onClose: () => void;
  /** PR aktif dari options view seleksi (id/prNo/posisi). */
  prs: { id: string; prNo: string; positionTitle: string | null }[];
  /** Kandidat board PR terpilih (id/nama/tahap aktif). */
  candidates: { id: string; name: string; sub: string | null }[];
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
              <Bot className="h-4 w-4" aria-hidden />
            </span>
            {t("Recruiter Copilot", "Recruiter Copilot")}
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-slate-500 dark:text-slate-400">
              {t("asisten rekrutmen — draf & analisis berbasis data PR/kandidat", "recruitment assistant — drafts & analysis from PR/candidate data")}
            </span>
          </DialogTitle>
        </DialogHeader>
        {/* state di body — Radix unmount DialogContent saat tertutup → segar tiap buka */}
        {open && <CopilotBody prs={prs} candidates={candidates} />}
      </DialogContent>
    </Dialog>
  );
}

function CopilotBody({
  prs, candidates,
}: {
  prs: { id: string; prNo: string; positionTitle: string | null }[];
  candidates: { id: string; name: string; sub: string | null }[];
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<CopilotKey>("draft-jd");
  const [prId, setPrId] = useState<string | null>(null);
  const [candId, setCandId] = useState<string | null>(null);
  const [channel, setChannel] = useState<"email" | "wa">("email");
  const [qaText, setQaText] = useState("");
  const [biasText, setBiasText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ mode: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const effPrId = prId ?? prs[0]?.id ?? null;
  const effCandId = candId ?? candidates[0]?.id ?? null;

  const switchTab = (k: CopilotKey) => {
    setTab(k);
    setResult(null);
    setCopied(false);
  };

  const run = async () => {
    if (running) return;
    let params: Record<string, unknown>;
    if (tab === "draft-jd") {
      if (!effPrId) {
        toast.error(t("Pilih PR terlebih dahulu", "Pick a PR first"));
        return;
      }
      params = { prId: effPrId };
    } else if (tab === "summarize-candidate" || tab === "interview-questions") {
      if (!effCandId) {
        toast.error(t("Pilih kandidat terlebih dahulu", "Pick a candidate first"));
        return;
      }
      params = { candidateId: effCandId };
    } else if (tab === "outreach") {
      if (!effCandId) {
        toast.error(t("Pilih kandidat terlebih dahulu", "Pick a candidate first"));
        return;
      }
      params = { candidateId: effCandId, channel };
    } else if (tab === "pipeline-qa") {
      if (!qaText.trim()) {
        toast.error(t("Tulis pertanyaan Anda tentang pipeline rekrutmen", "Type your question about the recruitment pipeline"));
        return;
      }
      params = { q: qaText.trim() };
    } else {
      if (!biasText.trim()) {
        toast.error(t("Tempel teks lowongan/JD yang ingin diperiksa", "Paste the job posting/JD text to check"));
        return;
      }
      params = { text: biasText.trim() };
    }

    setRunning(true);
    try {
      const res = await apiSend<{ mode: string; text: string }>(AI_API, "POST", {
        action: "copilot",
        lang, // BL-REC-3 — teks hasil mengikuti bahasa UI (default id di server)
        params: { action: tab, ...params },
      });
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi copilot gagal", "Copilot action failed"));
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("Gagal menyalin teks", "Failed to copy the text"));
    }
  };

  const needCandidate = tab === "summarize-candidate" || tab === "interview-questions" || tab === "outreach";

  return (
    <div className="space-y-4">
      {/* chip aksi */}
      <div className="flex flex-wrap gap-1.5">
        {ACTIONS.map((a) => {
          const Icon = a.icon;
          const active = tab === a.key;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => switchTab(a.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {t(a.label, a.labelEn)}
            </button>
          );
        })}
      </div>

      {/* input aksi */}
      <div className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        {tab === "draft-jd" && (
          <div className="space-y-1.5">
            <Label>{t("Pilih PR (aktif)", "Pick a PR (active)")}</Label>
            {prs.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("Belum ada PR — buat permintaan karyawan terlebih dahulu.", "No PRs yet — create a personnel requisition first.")}
              </p>
            ) : (
              <Select value={effPrId ?? undefined} onValueChange={setPrId}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih PR…", "Pick a PR…")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {prs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.prNo}{p.positionTitle ? ` — ${p.positionTitle}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {needCandidate && (
          <div className="space-y-1.5">
            <Label>{t("Pilih kandidat", "Pick a candidate")}</Label>
            {candidates.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("Belum ada kandidat di board PR ini — transfer kandidat terlebih dahulu.", "No candidates on this PR's board yet — transfer candidates first.")}
              </p>
            ) : (
              <Select value={effCandId ?? undefined} onValueChange={setCandId}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih kandidat…", "Pick a candidate…")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.sub ? ` — ${c.sub}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {tab === "outreach" && (
          <div className="space-y-1.5">
            <Label>{t("Kanal", "Channel")}</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v === "wa" ? "wa" : "email")}>
              <SelectTrigger className="w-full sm:w-[240px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{t("Email (formal 3 paragraf)", "Email (formal 3 paragraphs)")}</SelectItem>
                <SelectItem value="wa">{t("WhatsApp (singkat, siap salin)", "WhatsApp (short, copy-ready)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {tab === "pipeline-qa" && (
          <div className="space-y-1.5">
            <Label>{t("Pertanyaan Anda", "Your question")}</Label>
            <Input
              value={qaText}
              onChange={(e) => setQaText(e.target.value)}
              placeholder={t("mis. berapa kandidat aktif di pipeline? siapa lewat SLA?", "e.g. how many active candidates in the pipeline? who is past SLA?")}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void run(); } }}
            />
          </div>
        )}

        {tab === "check-bias" && (
          <div className="space-y-1.5">
            <Label>{t("Teks lowongan / JD", "Job posting / JD text")}</Label>
            <Textarea
              rows={5}
              value={biasText}
              onChange={(e) => setBiasText(e.target.value)}
              placeholder={t(
                "Tempel teks lowongan — frasa gender/usia/penampilan/status/kondisi fisik non-esensial akan ditandai.",
                "Paste the job posting — gender/age/appearance/status/non-essential physical phrases will be flagged.",
              )}
            />
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => void run()} disabled={running} className="ov-fill gap-2">
            {running
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <Sparkles className="h-4 w-4" aria-hidden />}
            {running ? t("Menyusun…", "Composing…") : t(RUN_LABEL[tab][0], RUN_LABEL[tab][1])}
          </Button>
        </div>
      </div>

      {/* hasil */}
      {running && <LoadingRows rows={3} />}
      {result && !running && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ResultModeBadge mode={result.mode} />
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => void copy()}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? t("Tersalin", "Copied") : t("Salin", "Copy")}
            </Button>
          </div>
          <div className="mt-2 max-h-[42vh] overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
            {result.text}
          </div>
        </div>
      )}

      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        {t(
          "Hasil copilot adalah draf/rekomendasi berbasis data rekrutmen — selalu tinjau & sunting sebelum dikirim/dipublikasikan.",
          "Copilot output is a draft/recommendation based on recruitment data — always review & edit before sending/publishing.",
        )}
      </p>
    </div>
  );
}
