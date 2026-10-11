"use client";
// RekanKerja Recruitment F6b — UI skor AI explainable + manager rubrik skor per PR.
// Mirror kontrak API /api/rekankerja/recruitment/ai (pola F2/F3/F6a: file service
// BUKAN client-safe — tipe lokal di selection-shared.tsx):
//   GET  ?rubric=<prId>                              → { rubric: RubricFactor[] }
//   POST { action:"score", candidateId, mode? }       → 201 { score }
//   POST { action:"save-rubric", prId, factors[] }   → { rubric } (ternormalisasi)
//   POST { action:"latest-scores", candidateIds[] }   → { scores: AiScore[] }
// Dipakai selection.tsx (dialog Skor AI per kandidat + tombol Rubrik Skor) dan
// selection-dialogs.tsx (tab "Skor AI" di detail kandidat — panel sama).
// Mode jujur (D7): "AI (model)" emerald / "Simulasi" amber — skor SELALU
// rekomendasi; keputusan tetap manusia (P2).
import { useEffect, useState } from "react";
import { apiSend, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Sparkles, RefreshCw, Info, Plus, Trash2, SlidersHorizontal, History,
} from "lucide-react";
import {
  AI_API, type AiScore, type RubricFactorUI, isDefaultRubric, scoreToneKey, ScoreBar,
} from "./selection-shared";

// ============ atom kecil ============

const MODE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
};

/** badge mode jujur hasil skor — "AI (model)" emerald / "Simulasi" amber. */
export function AiModeBadge({ mode, model }: { mode: string; model: string | null }) {
  const { t } = useI18n();
  const isAi = mode === "ai";
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      MODE_CLS[isAi ? "emerald" : "amber"],
    )}>
      {isAi && <Sparkles className="h-3 w-3" aria-hidden />}
      {isAi ? `AI (${model ?? "builtin"})` : t("Simulasi", "Simulated")}
    </span>
  );
}

// ============ panel skor AI (dipakai dialog & tab detail) ============

/**
 * Panel skor AI satu kandidat: fetch skor terbaru (POST latest-scores — API
 * baca-satunya), tombol generate (auto/simulated), breakdown per faktor dgn
 * evidence, dan histori ringkas (akumulasi sesi dialog: terbaru + hasil generate).
 */
export function AiScorePanel({
  candidateId, displayName, canGenerate, onScored,
}: {
  candidateId: string;
  displayName: string;
  canGenerate: boolean;
  onScored?: (score: AiScore) => void;
}) {
  const { t } = useI18n();
  const [score, setScore] = useState<AiScore | null>(null);
  const [history, setHistory] = useState<AiScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [generating, setGenerating] = useState(false);

  // skor terbaru saat mount (Radix unmount dialog/tab saat tertutup → segar)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setScore(null);
    setHistory([]);
    apiSend<{ scores: AiScore[] }>(AI_API, "POST", { action: "latest-scores", candidateIds: [candidateId] })
      .then((res) => {
        if (!alive) return;
        const s = res.scores?.[0] ?? null;
        setScore(s);
        setHistory(s ? [s] : []);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "unknown"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [candidateId]);

  const doGenerate = async () => {
    setGenerating(true);
    try {
      const res = await apiSend<{ score: AiScore }>(AI_API, "POST", {
        action: "score",
        candidateId,
        mode: simulated ? "simulated" : "auto",
      });
      setScore(res.score);
      setHistory((h) => [res.score, ...h.filter((x) => x.id !== res.score.id)]);
      toast.success(t(
        "Skor AI {name}: {total}/100 ({mode})",
        "AI score {name}: {total}/100 ({mode})",
        { name: displayName, total: res.score.total.toFixed(1), mode: res.score.mode === "ai" ? `AI (${res.score.model ?? "builtin"})` : t("Simulasi", "Simulated") },
      ));
      onScored?.(res.score);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal generate skor AI", "Failed to generate the AI score"));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <LoadingRows rows={4} />;
  if (error) {
    return <EmptyState title={t("Gagal memuat skor AI", "Failed to load the AI score")} description={error} />;
  }

  const totalTone = score ? scoreToneKey(score.total) : null;

  return (
    <div className="space-y-4">
      {/* ===== aksi generate ===== */}
      {canGenerate && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
          <label className="flex min-w-0 items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Checkbox checked={simulated} onCheckedChange={(c) => setSimulated(c === true)} className="mt-0.5" />
            <span>
              {t("Mode simulasi (deterministik, tanpa AI)", "Simulated mode (deterministic, no AI)")}
              <span className="block text-[11px] text-slate-400">
                {t("heuristik profil pelamar — hasil berlabel jujur", "applicant-profile heuristics — honestly labelled")}
              </span>
            </span>
          </label>
          <Button type="button" size="sm" className="ov-fill h-9 gap-1.5" onClick={() => void doGenerate()} disabled={generating}>
            <RefreshCw className={cn("h-3.5 w-3.5", generating && "animate-spin")} aria-hidden />
            {generating
              ? t("Menghitung…", "Scoring…")
              : score
                ? t("Generate Ulang", "Regenerate")
                : t("Generate Skor AI", "Generate AI Score")}
          </Button>
        </div>
      )}

      {/* ===== hasil ===== */}
      {!score ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
          {canGenerate
            ? t("Belum ada skor AI untuk kandidat ini — generate lewat tombol di atas.", "No AI score for this candidate yet — generate one via the button above.")
            : t("Belum ada skor AI untuk kandidat ini.", "No AI score for this candidate yet.")}
        </p>
      ) : (
        <>
          {/* total besar + mode */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-4xl font-bold tabular-nums",
                totalTone === "emerald" ? "text-emerald-600 dark:text-emerald-400"
                  : totalTone === "amber" ? "text-amber-600 dark:text-amber-400"
                    : "text-rose-600 dark:text-rose-400",
              )}>{score.total.toFixed(1)}</span>
              <span className="text-xs font-medium text-slate-400">/100</span>
            </div>
            <AiModeBadge mode={score.mode} model={score.model} />
            <div className="min-w-0 flex-1 text-right text-[11px] text-slate-500 dark:text-slate-400">
              {fmtDateTime(score.generatedAt)}
              {score.generatedByName ? ` · ${t("oleh", "by")} ${score.generatedByName}` : ""}
            </div>
          </div>
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(
              "Skor AI hanyalah REKOMENDASI berbasis rubrik — keputusan akhir tetap di tangan HR.",
              "The AI score is only a rubric-based RECOMMENDATION — the final decision stays with HR.",
            )}
          </p>

          {/* breakdown per faktor */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <SlidersHorizontal className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              {t("Breakdown per Faktor ({n})", "Per-Factor Breakdown ({n})", { n: String(score.factors.length) })}
            </h4>
            <div className="space-y-2">
              {score.factors.map((f, i) => (
                <div key={`${f.factor}-${i}`} className="rounded-xl border border-slate-200 bg-white/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-900 dark:text-slate-100" title={f.factor}>{f.factor}</span>
                    <span className="text-[10px] font-medium text-slate-400">
                      {t("bobot", "weight")} <b className="tabular-nums">{(f.weight * 100).toFixed(0)}%</b>
                    </span>
                    <span className={cn(
                      "text-sm font-bold tabular-nums",
                      scoreToneKey(f.score) === "emerald" ? "text-emerald-600 dark:text-emerald-400"
                        : scoreToneKey(f.score) === "amber" ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400",
                    )}>{f.score}</span>
                  </div>
                  <ScoreBar value={f.score} className="mt-1.5" />
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="min-w-0 flex-1 text-[11px] italic leading-relaxed text-slate-500 dark:text-slate-400">
                      “{f.evidence || t("tanpa evidence", "no evidence")}”
                    </p>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400"
                      title={t("kontribusi = bobot × skor", "contribution = weight × score")}>
                      {t("kontribusi", "contribution")} <b className="tabular-nums">{f.contribution.toFixed(1)}</b>
                    </span>
                  </div>
                </div>
              ))}
              {score.factors.length === 0 && (
                <p className="text-xs text-slate-400">{t("rubrik kosong — tidak ada faktor.", "empty rubric — no factors.")}</p>
              )}
            </div>
          </div>

          {/* histori ringkas */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <History className="h-3.5 w-3.5" aria-hidden /> {t("Riwayat Skor", "Score History")}
            </h4>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {history.map((h, i) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {fmtDateTime(h.generatedAt)}
                    {i === 0 && <b className="ml-1.5 text-slate-700 dark:text-slate-200">{t("· terbaru", "· latest")}</b>}
                  </span>
                  <span className={cn(
                    "text-xs font-bold tabular-nums",
                    scoreToneKey(h.total) === "emerald" ? "text-emerald-600 dark:text-emerald-400"
                      : scoreToneKey(h.total) === "amber" ? "text-amber-600 dark:text-amber-400"
                        : "text-rose-600 dark:text-rose-400",
                  )}>{h.total.toFixed(1)}</span>
                  <span className="w-[70px] text-right text-[10px] font-medium text-slate-400">
                    {h.mode === "ai" ? `AI (${h.model ?? "builtin"})` : t("Simulasi", "Simulated")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-slate-400">
              {t("Skor tersimpan per generate — daftar sesi ini memuat hasil yang diketahui UI.", "Scores are stored per generation — this session list holds what the UI knows.")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ============ dialog Skor AI (aksi kartu board) ============

/** Dialog skor AI satu kandidat (dari badge/tombol di kartu board). */
export function AiScoreDialog({
  candidate, canGenerate, onClose, onScored,
}: {
  candidate: { id: string; displayName: string } | null;
  canGenerate: boolean;
  onClose: () => void;
  onScored?: (score: AiScore) => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={candidate != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-deep dark:text-brand/80" aria-hidden />
            {t("Skor AI — {name}", "AI Score — {name}", { name: candidate?.displayName ?? "…" })}
          </DialogTitle>
        </DialogHeader>
        {candidate
          ? <AiScorePanel candidateId={candidate.id} displayName={candidate.displayName} canGenerate={canGenerate} onScored={onScored} />
          : <LoadingRows rows={3} />}
      </DialogContent>
    </Dialog>
  );
}

// ============ dialog manager rubrik skor (per PR) ============

interface RubricDraftRow {
  key: number; // react key stabil (bukan id server — baris bisa ditambah/hapus)
  name: string;
  weightPct: string; // input % (0–100, relatif)
  guide: string;
}

let rubricRowSeq = 1;

function draftFromRubric(rubric: RubricFactorUI[]): RubricDraftRow[] {
  return rubric.map((r) => ({ key: rubricRowSeq++, name: r.name, weightPct: String(Math.round(r.weight * 1000) / 10), guide: r.guide ?? "" }));
}

/**
 * Manager rubrik skor AI per PR (no-code, HRX B2): daftar faktor editable
 * (nama/bobot/panduan) + normalisasi otomatis ditampilkan (Σ bobot = 100%).
 * Simpan → POST save-rubric (server menormalisasi proporsional & snapshot
 * ke setiap skor berikutnya).
 */
export function AiRubricDialog({
  pr, onClose, onSaved,
}: {
  pr: { id: string; prNo: string; positionTitle: string | null } | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RubricDraftRow[]>([]);
  const [loaded, setLoaded] = useState<RubricFactorUI[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prId = pr?.id ?? null;

  useEffect(() => {
    if (!prId) { setRows([]); setLoaded(null); setError(null); return; }
    let alive = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const json = await apiSend<{ rubric: RubricFactorUI[] }>(`${AI_API}?rubric=${encodeURIComponent(prId)}`, "GET");
        if (!alive) return;
        const rubric = Array.isArray(json.rubric) ? json.rubric : [];
        setLoaded(rubric);
        setRows(draftFromRubric(rubric));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "unknown");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [prId]);

  const sumPct = rows.reduce((s, r) => s + (Number(r.weightPct) || 0), 0);
  const normPct = (r: RubricDraftRow) => (sumPct > 0 ? ((Number(r.weightPct) || 0) / sumPct) * 100 : 0);

  const setRow = (key: number, patch: Partial<RubricDraftRow>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addRow = () => {
    if (rows.length >= 8) return;
    setRows((rs) => [...rs, { key: rubricRowSeq++, name: "", weightPct: "10", guide: "" }]);
  };
  const removeRow = (key: number) => {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));
  };

  const doSave = async () => {
    if (!pr) return;
    const factors = rows.map((r) => ({ name: r.name.trim(), weight: (Number(r.weightPct) || 0) / 100, guide: r.guide.trim() || null }));
    setBusy(true);
    try {
      const res = await apiSend<{ rubric: RubricFactorUI[] }>(AI_API, "POST", { action: "save-rubric", prId: pr.id, factors });
      setLoaded(res.rubric);
      setRows(draftFromRubric(res.rubric));
      toast.success(t(
        "Rubrik skor {pr} disimpan — {n} faktor, bobot ternormalisasi Σ=100%",
        "Score rubric for {pr} saved — {n} factors, weights normalized Σ=100%",
        { pr: pr.prNo, n: String(res.rubric.length) },
      ));
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan rubrik", "Failed to save the rubric"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={pr != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-brand-deep dark:text-brand/80" aria-hidden />
            {t("Rubrik Skor AI — {pr}", "AI Score Rubric — {pr}", { pr: pr?.prNo ?? "…" })}
            {pr?.positionTitle && (
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-slate-500 dark:text-slate-400">{pr.positionTitle}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <LoadingRows rows={3} />
        ) : error ? (
          <EmptyState title={t("Gagal memuat rubrik", "Failed to load the rubric")} description={error} />
        ) : (
          <div className="space-y-3">
            {isDefaultRubric(loaded) && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(
                  "PR ini masih memakai rubrik DEFAULT (3 faktor generik) — simpan untuk menyesuaikan dengan posisi.",
                  "This PR still uses the DEFAULT rubric (3 generic factors) — save to tailor it to the position.",
                )}
              </p>
            )}

            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={r.key} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Label className="shrink-0 text-[11px] text-slate-400">#{i + 1}</Label>
                        <Input
                          className="h-8 flex-1 text-xs"
                          value={r.name}
                          maxLength={80}
                          onChange={(e) => setRow(r.key, { name: e.target.value })}
                          placeholder={t("nama faktor (mis. Relevansi Pengalaman)", "factor name (e.g. Experience Relevance)")}
                          aria-label={t("nama faktor", "factor name")}
                        />
                        <div className="flex shrink-0 items-center gap-1">
                          <Input
                            type="number" min={0} max={100} step="1"
                            className="h-8 w-[74px] text-xs tabular-nums"
                            value={r.weightPct}
                            onChange={(e) => setRow(r.key, { weightPct: e.target.value })}
                            aria-label={t("bobot faktor (%)", "factor weight (%)")}
                          />
                          <span className="text-xs font-semibold text-slate-400">%</span>
                        </div>
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                          title={t("porsi ternormalisasi (server menyimpan proporsi, Σ=100%)", "normalized share (the server stores proportions, Σ=100%)")}>
                          → {normPct(r).toFixed(1)}%
                        </span>
                      </div>
                      <Input
                        className="h-8 text-xs"
                        value={r.guide}
                        maxLength={300}
                        onChange={(e) => setRow(r.key, { guide: e.target.value })}
                        placeholder={t("panduan penilaian (opsional — dipakai AI sebagai konteks)", "scoring guide (optional — used as AI context)")}
                        aria-label={t("panduan faktor", "factor guide")}
                      />
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon"
                      className="h-8 w-8 shrink-0 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      disabled={rows.length <= 1}
                      onClick={() => removeRow(r.key)}
                      title={rows.length <= 1 ? t("minimal 1 faktor", "at least 1 factor") : t("hapus faktor", "delete factor")}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={addRow} disabled={rows.length >= 8}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Faktor", "Add Factor")}
                <span className="text-[10px] text-slate-400">({rows.length}/8)</span>
              </Button>
              <span className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums",
                Math.abs(sumPct - 100) < 0.05
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
              )} title={t("server menormalisasi proporsional saat menyimpan", "the server normalizes proportionally on save")}>
                Σ {t("bobot", "weights")} = {sumPct.toFixed(1)}% {Math.abs(sumPct - 100) < 0.05 ? "✓" : `→ ${t("dinormalisasi", "normalized")}`}
              </span>
            </div>

            <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t(
                "Rubrik disimpan ke PR dan di-snapshot ke setiap skor berikutnya — skor yang sudah ada tidak berubah.",
                "The rubric is saved to the PR and snapshotted into every subsequent score — existing scores stay unchanged.",
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
          <Button className="ov-fill gap-1.5" onClick={() => void doSave()} disabled={busy || loading || !!error}>
            {busy ? t("Menyimpan…", "Saving…") : t("Simpan Rubrik", "Save Rubric")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
