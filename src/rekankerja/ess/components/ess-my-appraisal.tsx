"use client";
// P3-PERF — ESS Penilaian Saya (§14.3; §29-2): self-assessment kompetensi
// (1–5 + komentar + AI assist §18.11) + lihat hasil terpublikasi.
// Estimator dampak TIDAK ada di ESS (D21 — karyawan tidak melihat).
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { NotebookPen, Sparkles, Send, Zap } from "lucide-react";

const API = "/api/rekankerja/ess/my-appraisal";

interface CompRow { competencyId: string; name: string; kind: string; levels: { level: number; label: string; descriptor: string }[]; selfScore: number | null; selfComment: string | null }
interface Data {
  active: {
    appraisalId: string; docNo: string; status: string;
    cycle: { code: string; selfStart: string | null; selfEnd: string | null };
    kpis: { id: string; title: string; unit: string; target: number; finalActual: number | null; midActual: number | null; dataSource: string }[];
    comps: CompRow[];
    published: { managerScore: number | null; selfScore: number | null } | null;
  } | null;
}

export function EssMyAppraisalPage() {
  const { t } = useI18n();
  const api = useApi<Data>(API);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [aiTarget, setAiTarget] = useState<CompRow | null>(null);
  const [aiPoints, setAiPoints] = useState("");
  const [aiTone, setAiTone] = useState("neutral");
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const a = api.data?.active;
  const canSubmit = a && a.status !== "SelfDone" && !["ManagerDone", "Calibrating", "Finalized", "Published", "Closed"].includes(a.status);

  useEffect(() => {
    if (!a) return;
    const s: Record<string, number> = {};
    const c: Record<string, string> = {};
    for (const comp of a.comps) {
      s[comp.competencyId] = comp.selfScore ?? 0;
      c[comp.competencyId] = comp.selfComment ?? "";
    }
    setScores(s); setComments(c);
  }, [a]);

  const runAi = async () => {
    if (!aiTarget) return;
    setAiBusy(true);
    try {
      const res = await apiSend<{ draft: string }>(API, "POST", {
        action: "aiCompose", points: aiPoints.split("\n").map((x) => x.trim()).filter(Boolean),
        competencyName: aiTarget.name, tone: aiTone, length: "short", lang: "id",
      });
      setAiDraft(res.draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setAiBusy(false); }
  };

  const submitSelf = async () => {
    if (!a) return;
    const compScores = a.comps.map((c) => ({ competencyId: c.competencyId, score: scores[c.competencyId] ?? 3, comment: comments[c.competencyId] || undefined }));
    const missing = compScores.filter((c) => !c.score || c.score < 1);
    if (missing.length > 0) { toast.error(t("Nilai semua kompetensi dulu (1–5)", "Score all competencies first (1–5)")); return; }
    if (!window.confirm(t("Submit self-assessment? Setelah submit, penilaian atasan dimulai.", "Submit self-assessment? The manager review starts after."))) return;
    setBusy(true);
    try {
      await apiSend(API, "POST", { action: "submitSelf", compScores });
      toast.success(t("Self-assessment disubmit (SelfDone)", "Self-assessment submitted (SelfDone)"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><NotebookPen className="h-6 w-6 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden /> {t("Penilaian Saya", "My Appraisal")}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("Self-assessment kompetensi + hasil terpublikasi (satu sumber kebenaran — §31).", "Competency self-assessment + published results (single source of truth — §31).")}</p>
      </div>
      {api.loading && !api.data ? <LoadingRows /> : !a ? (
        <Card><CardContent className="p-6"><EmptyState icon={NotebookPen} title={t("Belum terdaftar di siklus aktif", "Not enrolled in an active cycle")} description="" /></CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-fuchsia-50/60 p-3 text-sm dark:bg-fuchsia-950/20">
            <span><strong>{a.docNo}</strong> · {a.cycle.code}</span>
            <span className="flex items-center gap-2"><StatusPill status={a.status} />{a.published?.managerScore != null && <span className="font-bold">{t("hasil", "result")}: {a.published.managerScore.toFixed(1)}</span>}</span>
          </div>

          {/* KPI ringkas (mid progress) */}
          {a.kpis.length > 0 && (
            <Card><CardContent className="p-4">
              <h3 className="mb-2 text-sm font-semibold">{t("Target KPI Anda", "Your KPI Targets")}</h3>
              <div className="grid gap-1.5">
                {a.kpis.map((k) => (
                  <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-800">
                    <span className="flex items-center gap-1.5">{k.title}{k.dataSource !== "Manual" && <span className="inline-flex items-center gap-0.5 rounded bg-teal-50 px-1 py-0.5 text-[9px] font-bold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"><Zap className="h-2.5 w-2.5" aria-hidden /> AUTO</span>}</span>
                    <span className="text-xs text-slate-500">{t("Target", "Target")} {k.target} {k.unit}{k.midActual != null ? ` · ${t("mid", "mid")}: ${k.midActual}` : ""}</span>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          )}

          {/* self-assessment kompetensi */}
          <Card><CardContent className="p-4">
            <h3 className="mb-1 text-sm font-semibold">{t("Self-Assessment Kompetensi", "Competency Self-Assessment")}</h3>
            <p className="mb-3 text-xs text-slate-500">{t("Nilai diri Anda 1–5 (deskriptor di hover). Komentar opsional.", "Rate yourself 1–5 (descriptors on hover). Comments optional.")}</p>
            <div className="grid gap-3">
              {a.comps.map((c) => (
                <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="flex-1 text-sm font-semibold">{c.name}</span>
                    {c.selfScore != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t("tersimpan", "saved")}: {c.selfScore}</span>}
                  </div>
                  {canSubmit ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((v) => (
                          <button key={v} title={c.levels?.[v - 1]?.descriptor ?? ""} onClick={() => setScores({ ...scores, [c.competencyId]: v })}
                            className={cn("h-8 w-8 rounded-lg border text-sm font-bold", (scores[c.competencyId] ?? 0) === v ? "border-fuchsia-400 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300" : "border-slate-200 text-slate-400 hover:border-fuchsia-300 dark:border-slate-700")}>{v}</button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <Textarea rows={2} value={comments[c.competencyId] ?? ""} onChange={(e) => setComments({ ...comments, [c.competencyId]: e.target.value })} placeholder={t("Ulasan singkat (opsional)…", "Brief review (optional)…")} className="text-xs" />
                        <Button size="sm" variant="outline" className="shrink-0 self-start" onClick={() => { setAiTarget(c); setAiPoints(""); setAiDraft(""); }}><Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" aria-hidden /></Button>
                      </div>
                    </>
                  ) : c.selfScore != null ? (
                    <p className="text-sm">{t("Nilai Anda", "Your score")}: <strong>{c.selfScore}</strong>{c.selfComment ? <span className="block text-xs italic text-slate-500">“{c.selfComment}”</span> : null}</p>
                  ) : null}
                </div>
              ))}
            </div>
            {canSubmit && (
              <Button className="mt-3 w-full" onClick={submitSelf} disabled={busy}><Send className="h-4 w-4" aria-hidden /> {busy ? t("Mengirim…", "Sending…") : t("Submit Self-Assessment", "Submit Self-Assessment")}</Button>
            )}
          </CardContent></Card>
        </>
      )}

      {/* dialog AI (§18.11) */}
      <Dialog open={aiTarget !== null} onOpenChange={(o) => { if (!o) setAiTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden /> {t("Susun Ulasan dengan AI", "Compose Review with AI")}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Textarea value={aiPoints} onChange={(e) => setAiPoints(e.target.value)} rows={4} placeholder={t("Poin Anda (1 per baris, bahasa seadanya)…", "Your points (1 per line, any style)…")} />
            <div className="space-y-1">
              <Select value={aiTone} onValueChange={setAiTone}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">{t("Profesional netral", "Professional neutral")}</SelectItem>
                  <SelectItem value="encouraging">{t("Memberi semangat", "Encouraging")}</SelectItem>
                  <SelectItem value="firm">{t("Tegas namun konstruktif", "Firm yet constructive")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {aiDraft && <Textarea value={aiDraft} onChange={(e) => setAiDraft(e.target.value)} rows={4} className="border-violet-300 text-xs" />}
          </div>
          <DialogFooter>
            {aiDraft ? (
              <>
                <Button variant="outline" onClick={runAi} disabled={aiBusy}>{t("Susun ulang", "Re-compose")}</Button>
                <Button onClick={() => { if (aiTarget) setComments({ ...comments, [aiTarget.competencyId]: aiDraft }); setAiTarget(null); toast.success(t("Dipakai — edit bebas sebelum submit", "Used — edit freely before submitting")); }}>{t("Pakai", "Use")}</Button>
              </>
            ) : (
              <Button onClick={runAi} disabled={aiBusy || !aiPoints.trim()}><Sparkles className="h-4 w-4" aria-hidden /> {aiBusy ? t("Menyusun…", "Composing…") : t("Susun →", "Compose →")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
