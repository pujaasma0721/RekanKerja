"use client";
// P3-PERF — ESS 360 Saya (§14.3; §29-3): undangan peer/subordinate/cross/upward
// yang harus saya isi — isian ANONIM (≥3 reviewer per kategori sebelum tampil).
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { Users, Send, Sparkles, ShieldCheck } from "lucide-react";

const API = "/api/rekankerja/ess/my-360";

interface Invite {
  feedbackId: string; revieweeName: string; cycleCode: string; reviewerType: string; dueAt: string | null;
  comps: { competencyId: string; name: string; kind: string; levels: { level: number; label: string; descriptor: string }[] }[];
}

export function EssMy360Page() {
  const { t } = useI18n();
  const api = useApi<{ invites: Invite[]; historyCount: number }>(API);
  const [active, setActive] = useState<Invite | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (active) return;
    const first = api.data?.invites?.[0];
    if (first) { setActive(first); setScores({}); setComments({}); }
  }, [api.data, active]);

  const submit = async () => {
    if (!active) return;
    const answers = active.comps.map((c) => ({ competencyId: c.competencyId, score: scores[c.competencyId] ?? 3, comment: comments[c.competencyId] || undefined }));
    if (answers.some((a) => !a.score)) { toast.error(t("Nilai semua kompetensi dulu", "Score all competencies first")); return; }
    if (!window.confirm(t("Submit isian 360? Identitas Anda TIDAK ditampilkan (anonim, tampil ter-agregasi ≥3).", "Submit the 360 review? Your identity is NOT shown (anonymous, aggregated at ≥3)."))) return;
    setBusy(true);
    try {
      await apiSend(API, "POST", { action: "submit", feedbackId: active.feedbackId, answers });
      toast.success(t("Isian 360 disubmit — terima kasih", "360 review submitted — thank you"));
      setActive(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const decline = async () => {
    if (!active) return;
    try {
      await apiSend(API, "POST", { action: "decline", feedbackId: active.feedbackId });
      toast.info(t("Undangan ditolak", "Invitation declined"));
      setActive(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><Users className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden /> {t("360 Saya", "My 360")}</h1>
        <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />
          {t("Isian Anda anonim — hanya tampil ter-agregasi ≥3 reviewer per kategori (§37).", "Your input is anonymous — shown only aggregated across ≥3 reviewers per category (§37).")}
        </p>
      </div>
      {api.loading && !api.data ? <LoadingRows /> : (api.data?.invites ?? []).length === 0 ? (
        <Card><CardContent className="p-6"><EmptyState icon={Users} title={t("Tidak ada undangan 360 aktif", "No active 360 invitations")} description={api.data?.historyCount ? t("{n} isian sebelumnya tercatat.", "{n} previous submissions recorded.", { n: String(api.data.historyCount) }) : ""} /></CardContent></Card>
      ) : active ? (
        <Card><CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">{t("Menilai", "Reviewing")}: {active.revieweeName}</p>
              <p className="text-xs text-slate-500">{active.cycleCode} · {active.reviewerType}{active.dueAt ? ` · ${t("tenggat", "due")} ${new Date(active.dueAt).toLocaleDateString("id-ID")}` : ""}</p>
            </div>
            <Button variant="outline" size="sm" onClick={decline}>{t("Tolak undangan", "Decline")}</Button>
          </div>
          <div className="grid gap-3">
            {active.comps.map((c) => (
              <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 text-sm font-semibold">{c.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button key={v} title={c.levels?.[v - 1]?.descriptor ?? ""} onClick={() => setScores({ ...scores, [c.competencyId]: v })}
                      className={cn("h-8 w-8 rounded-lg border text-sm font-bold", (scores[c.competencyId] ?? 0) === v ? "border-fuchsia-400 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300" : "border-slate-200 text-slate-400 hover:border-fuchsia-300 dark:border-slate-700")}>{v}</button>
                  ))}
                </div>
                <Textarea rows={2} value={comments[c.competencyId] ?? ""} onChange={(e) => setComments({ ...comments, [c.competencyId]: e.target.value })} placeholder={t("Komentar anonim (opsional)…", "Anonymous comment (optional)…")} className="mt-2 text-xs" />
              </div>
            ))}
          </div>
          <Button className="mt-3 w-full" onClick={submit} disabled={busy}><Send className="h-4 w-4" aria-hidden /> {busy ? t("Mengirim…", "Sending…") : t("Submit Isian 360 (Anonim)", "Submit 360 Review (Anonymous)")}</Button>
        </CardContent></Card>
      ) : null}
    </div>
  );
}
