"use client";
// P3-PERF — Penilaian (§18-4 form; §29 alur 5; AMANDEMEN 2: impor realisasi
// §18.5 + tarikan otomatis berpratinjau §18.6 + autosave/progress §18.7;
// AMANDEMEN 3: AI assist ulasan §18.11 + estimasi dampak real-time §18.12).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { cn } from "@/lib/utils";
import {
  NotebookPen, Zap, Gauge, Sparkles, FileSpreadsheet, Upload, Download, Save, Users, Search, X, Send, Coins, Lock,
} from "lucide-react";

const APPRAISALS_API = "/api/rekankerja/performance/appraisals";
const CYCLES_API = "/api/rekankerja/performance/cycles";
const F360_API = "/api/rekankerja/performance/feedback360";

interface AssessmentView {
  appraisal: {
    id: string; docNo: string; status: string;
    employee: { employeeNo: string; fullName: string; position: { title: string } | null };
    manager: { fullName: string } | null;
    cycle: { id: string; code: string; status: string; weightsJson: string; feedback360: boolean };
    selfScore: number | null; managerScore: number | null;
  };
  kpis: { id: string; title: string; polarity: string; unit: string; thresholdMin: number | null; target: number; stretchValue: number | null; finalActual: number | null; dataSource: string; autoValueJson: string | null; isCritical: boolean }[];
  comps: { id: string; competencyId: string; name: string; kind: string; levels: { level: number; label: string; descriptor: string }[]; score: number; comment: string | null; aiAssisted: boolean; weight: number }[];
  f360summary: Record<string, { count: number; avgByComp: Record<string, number> }>;
}

export function PerformanceAppraisalsPage() {
  const { t } = useI18n();
  const nav = useNav();
  const appraisalId = nav.params.id;

  const cyclesApi = useApi<{ rows: { id: string; code: string; name: string; status: string }[] }>(`${CYCLES_API}?limit=100`);
  const [cycleId, setCycleId] = useState("");
  useEffect(() => {
    if (cycleId || !cyclesApi.data?.rows?.length) return;
    const active = cyclesApi.data.rows.find((r) => r.status === "Assessment") ?? cyclesApi.data.rows.find((r) => r.status === "Calibration") ?? cyclesApi.data.rows[0];
    if (active) setCycleId(active.id);
  }, [cyclesApi.data, cycleId]);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const listUrl = useMemo(() => {
    if (!cycleId) return null;
    const p = new URLSearchParams({ cycleId });
    if (dq) p.set("q", dq);
    return `${APPRAISALS_API}?${p.toString()}`;
  }, [cycleId, dq]);
  const listApi = useApi<{ rows: { appraisalId: string; docNo: string; employeeName: string; employeeNo: string; position: string | null; status: string; managerScore: number | null; finalRating: number | null; kpiFilled: number; kpiTotal: number }[]; total: number }>(listUrl, [listUrl]);

  // ============ FORM PENILAIAN (atasan) ============
  const viewApi = useApi<AssessmentView>(appraisalId ? `${APPRAISALS_API}?id=${appraisalId}` : null, [appraisalId]);
  const [kpis, setKpis] = useState<AssessmentView["kpis"]>([]);
  const [comps, setComps] = useState<AssessmentView["comps"]>([]);
  const [meta, setMeta] = useState<AssessmentView["appraisal"] | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const impactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [impact, setImpact] = useState<{ pScore: number | null; pRating: { value: number; labelId: string; labelEn: string; color: string } | null; bonusMonths: number | null; raisePct: [number, number] | null; kritisGagal: boolean; completeness: { kpiFilled: number; kpiTotal: number; compFilled: number; compTotal: number } } | null>(null);

  useEffect(() => {
    const v = viewApi.data;
    if (!v) return;
    setKpis(v.kpis.map((k) => ({ ...k })));
    setComps(v.comps.map((c) => ({ ...c })));
    setMeta(v.appraisal);
  }, [viewApi.data]);

  const locked = meta ? ["ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(meta.status) : false;

  // autosave debounce 3s (§18.7)
  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!meta || locked) return;
      setSaveState("saving");
      try {
        await apiSend(APPRAISALS_API, "POST", {
          action: "saveDraft",
          appraisalId: meta.id,
          kpiUpdates: kpis.map((k) => ({ kpiId: k.id, finalActual: k.finalActual })),
          compUpdates: comps.map((c) => ({ competencyId: c.competencyId, score: c.score, comment: c.comment ?? "", aiAssisted: c.aiAssisted })),
        });
        setSaveState("saved");
        setSavedAt(new Date());
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Gagal menyimpan draf", "Failed to save draft"));
        setSaveState("idle");
      }
    }, 3000);
  }, [kpis, comps, meta, locked, t]);

  // previewImpact debounce 1s (§18.12)
  const scheduleImpact = useCallback(() => {
    if (impactDebounceRef.current) clearTimeout(impactDebounceRef.current);
    impactDebounceRef.current = setTimeout(async () => {
      if (!meta) return;
      try {
        const res = await apiSend<typeof impact>(APPRAISALS_API, "POST", {
          action: "previewImpact",
          appraisalId: meta.id,
          kpis: kpis.map((k) => ({ polarity: k.polarity, thresholdMin: k.thresholdMin, target: k.target, stretchValue: k.stretchValue, finalActual: k.finalActual, weight: 20, isCritical: k.isCritical })),
          comps: comps.filter((c) => c.weight > 0 || true).map((c) => ({ score: c.score || 3, weight: c.weight || 10, kind: c.kind })),
        });
        setImpact(res);
      } catch { /* tenang — estimasi opsional */ }
    }, 1000);
  }, [kpis, comps, meta]);

  const patchKpi = (id: string, patch: Partial<AssessmentView["kpis"][number]>) => {
    setKpis((rs) => rs.map((k) => (k.id === id ? { ...k, ...patch } : k)));
    scheduleAutosave();
    scheduleImpact();
  };
  const patchComp = (competencyId: string, patch: Partial<AssessmentView["comps"][number]>) => {
    setComps((rs) => rs.map((c) => (c.competencyId === competencyId ? { ...c, ...patch } : c)));
    scheduleAutosave();
    scheduleImpact();
  };

  // tarikan otomatis (§18.6)
  const [pullDialog, setPullDialog] = useState(false);
  const [pullPreview, setPullPreview] = useState<{ rows: { kpiId: string; title: string; value: number | null; evidence: string; error?: string }[] } | null>(null);
  const doPull = async (apply: boolean) => {
    if (!meta) return;
    try {
      const res = await apiSend<{ rows: { kpiId: string; title: string; value: number | null; evidence: string; error?: string }[]; applied: number }>(APPRAISALS_API, "POST", { action: "pullAutoSources", appraisalId: meta.id, apply });
      if (!apply) {
        setPullPreview(res);
        setPullDialog(true);
      } else {
        toast.success(t("Tarikan diterapkan: {n} KPI terisi otomatis (bukti tersimpan)", "Auto-pull applied: {n} KPIs auto-filled (evidence saved)", { n: String(res.applied) }));
        setPullDialog(false);
        viewApi.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  // AI assist (§18.11)
  const [aiTarget, setAiTarget] = useState<{ competencyId: string; name: string } | null>(null);
  const [aiPoints, setAiPoints] = useState("");
  const [aiTone, setAiTone] = useState("neutral");
  const [aiLen, setAiLen] = useState<"short" | "medium">("short");
  const [aiDraft, setAiDraft] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const runAiCompose = async () => {
    if (!aiTarget) return;
    setAiBusy(true);
    try {
      const res = await apiSend<{ draft: string }>(APPRAISALS_API, "POST", {
        action: "aiCompose",
        points: aiPoints.split("\n").map((x) => x.trim()).filter(Boolean),
        competencyName: aiTarget.name,
        tone: aiTone,
        length: aiLen,
        lang: "id",
      });
      setAiDraft(res.draft);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setAiBusy(false); }
  };

  const submitManager = async () => {
    if (!meta) return;
    if (!window.confirm(t("Submit penilaian? Skor dihitung server (§16) dan penilaian terkunci.", "Submit appraisal? Scores are computed server-side (§16) and the appraisal locks."))) return;
    try {
      const res = await apiSend<{ managerScore: number }>(APPRAISALS_API, "POST", { action: "submitManager", appraisalId: meta.id });
      toast.success(t("Penilaian disubmit — managerScore {s}", "Appraisal submitted — managerScore {s}", { s: res.managerScore.toFixed(1) }));
      viewApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  // impor realisasi
  const [importDialog, setImportDialog] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: { row: number; valid: boolean; errors: string[]; employeeName: string; kpiTitle: string; finalActual: number | null }[]; validCount: number; errorCount: number } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const doImportPreview = async () => {
    if (!importFile || !cycleId) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("action", "importActualsPreview");
      fd.append("cycleId", cycleId);
      fd.append("file", importFile);
      const res = await fetch(APPRAISALS_API, { method: "POST", credentials: "include", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "unknown");
      setImportPreview(data);
      setImportStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membaca file", "Failed to read file"));
    } finally { setImportBusy(false); }
  };
  const doImportCommit = async () => {
    if (!importPreview || !cycleId) return;
    setImportBusy(true);
    try {
      const res = await apiSend<{ updated: number; skipped: number }>(APPRAISALS_API, "POST", { action: "importActualsCommit", cycleId, rows: importPreview.rows });
      toast.success(t("Impor realisasi: {u} diperbarui · {s} dilewati — status TIDAK berubah (impor ≠ submit)", "Actuals import: {u} updated · {s} skipped — status NOT changed (import ≠ submit)", { u: String(res.updated), s: String(res.skipped) }));
      setImportDialog(false); setImportStep(1); setImportFile(null); setImportPreview(null);
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setImportBusy(false); }
  };

  // 360 invite
  const [inviteDialog, setInviteDialog] = useState(false);
  const employeesApi = useApi<{ employees: { id: string; employeeNo: string; fullName: string; position: string | null }[] }>(
    inviteDialog && meta ? `${CYCLES_API}?employees=1&cycleId=${meta.cycle.id}&q=` : null, [inviteDialog, meta?.cycle.id],
  );
  const [inviteSel, setInviteSel] = useState<Set<string>>(new Set());
  const [inviteType, setInviteType] = useState("Peer");
  const doInvite = async () => {
    if (!meta || inviteSel.size === 0) return;
    try {
      const res = await apiSend<{ invited: number }>(F360_API, "POST", {
        action: "invite", appraisalId: meta.id,
        reviewers: Array.from(inviteSel).map((eid) => ({ employeeId: eid, reviewerType: inviteType })),
      });
      toast.success(t("{n} reviewer 360 diundang", "{n} 360 reviewers invited", { n: String(res.invited) }));
      setInviteDialog(false); setInviteSel(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  // progress form (§18.7) — di-hook-kan TANPA syarat (Rules of Hooks)
  const progress = useMemo(() => {
    const kpiFilled = kpis.filter((k) => k.finalActual != null).length;
    const compFilled = comps.filter((c) => c.score > 0).length;
    const total = kpis.length + comps.length;
    return { pct: total === 0 ? 0 : Math.round(((kpiFilled + compFilled) / total) * 100), kpiFilled, compFilled, total };
  }, [kpis, comps]);

  // ============ RENDER: FORM ============
  if (appraisalId && meta) {
    return (
      <div>
        <PageHeader
          eyebrow={t("Performance · Penilaian")}
          title={`${meta.docNo} — ${meta.employee.fullName}`}
          description={`${meta.employee.position?.title ?? "—"} · ${t("siklus", "cycle")} ${meta.cycle.code}${meta.selfScore != null ? ` · self ${meta.selfScore.toFixed(1)}` : ""}`}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => nav.navigate("performance", "appraisals")}><X className="h-4 w-4" aria-hidden /> {t("Tutup", "Close")}</Button>
              {!locked && <Button onClick={submitManager}><Send className="h-4 w-4" aria-hidden /> {t("SUBMIT PENILAIAN →", "SUBMIT APPRAISAL →")}</Button>}
            </div>
          )}
        />
        {/* progress + autosave (§18.7) */}
        <div className="mb-4 rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("Formulir Anda selesai {p}%", "Your form is {p}% complete", { p: String(progress.pct) })}</p>
            <p className="text-xs text-slate-500">
              {saveState === "saving" ? t("Menyimpan…", "Saving…") : saveState === "saved" ? t("Tersimpan otomatis", "Auto-saved") + " " + (savedAt?.toLocaleTimeString("id-ID") ?? "") : t("autosave 3 dtk", "3s autosave")}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={cn("h-full rounded-full", progress.pct >= 100 ? "bg-emerald-500" : progress.pct >= 50 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${progress.pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{progress.kpiFilled}/{kpis.length} KPI · {progress.compFilled}/{comps.length} kompetensi</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {/* KPI + tarikan otomatis */}
            <Card>
              <CardContent className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{t("KPI — aktual & bukti", "KPIs — actuals & evidence")}</h3>
                  {!locked && (
                    <Button size="sm" variant="outline" onClick={() => doPull(false)}><Zap className="h-3.5 w-3.5" aria-hidden /> {t("Tarik semua data otomatis", "Pull all auto data")}</Button>
                  )}
                </div>
                <div className="grid gap-2">
                  {kpis.map((k, i) => (
                    <div key={k.id} className={cn("flex flex-wrap items-center gap-2 rounded-lg border p-2.5", k.dataSource !== "Manual" ? "border-teal-200 bg-teal-50/30 dark:border-teal-900 dark:bg-teal-950/20" : "border-slate-200 dark:border-slate-800")}>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800">{i + 1}</span>
                      <span className="min-w-36 flex-1">
                        <span className="block text-sm font-medium">{k.title}</span>
                        <span className="text-[11px] text-slate-400">F {k.thresholdMin ?? "—"} · T {k.target} {k.unit}{k.stretchValue != null ? ` · S ${k.stretchValue}` : ""}{k.isCritical ? " · ⚠ kritis" : ""}</span>
                        {k.autoValueJson && <AutoEvidence json={k.autoValueJson} />}
                      </span>
                      <Input
                        type="number" inputMode="decimal"
                        value={k.finalActual ?? ""}
                        onChange={(e) => patchKpi(k.id, { finalActual: e.target.value === "" ? null : Number(e.target.value) })}
                        disabled={locked || k.dataSource !== "Manual"}
                        placeholder={t("aktual", "actual")}
                        className="h-8 w-28 text-xs"
                      />
                      {k.dataSource !== "Manual" && <span className="inline-flex items-center gap-0.5 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"><Zap className="h-3 w-3" aria-hidden /> AUTO</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* kompetensi + AI assist */}
            <Card>
              <CardContent className="p-4">
                <h3 className="mb-1 font-semibold">{t("Kompetensi (deskriptor muncul saat hover)", "Competencies (descriptors on hover)")}</h3>
                <p className="mb-3 text-xs text-slate-500">{t("Skor 1–5 · komentar WAJIB bila skor ekstrem (≤2 atau =5) — §18-4", "Score 1–5 · comments REQUIRED for extreme scores (≤2 or =5) — §18-4")}</p>
                <div className="grid gap-3">
                  {comps.map((c) => (
                    <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="flex-1 text-sm font-semibold">{c.name}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">{c.kind === "CoreValue" ? t("nilai inti", "core value") : c.kind}</span>
                        {c.aiAssisted && <span className="inline-flex items-center gap-0.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-400"><Sparkles className="h-3 w-3" aria-hidden /> AI</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((v) => (
                          <button
                            key={v}
                            title={c.levels?.[v - 1]?.descriptor ?? ""}
                            disabled={locked}
                            onClick={() => patchComp(c.competencyId, { score: v })}
                            className={cn("h-8 w-8 rounded-lg border text-sm font-bold transition-colors",
                              c.score === v ? "border-fuchsia-400 bg-fuchsia-100 text-fuchsia-700 dark:border-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300"
                              : "border-slate-200 text-slate-400 hover:border-fuchsia-300 dark:border-slate-700")}
                          >{v}</button>
                        ))}
                      </div>
                      {c.levels && c.levels[c.score - 1] && (
                        <p className="mt-1.5 text-[11px] italic text-slate-400">“{c.levels[c.score - 1].descriptor}”</p>
                      )}
                      {!locked && (
                        <div className="mt-2 flex gap-1.5">
                          <Textarea
                            value={c.comment ?? ""}
                            onChange={(e) => patchComp(c.competencyId, { comment: e.target.value })}
                            rows={2}
                            placeholder={t("Komentar (wajib bila skor ekstrem)…", "Comment (required for extreme scores)…")}
                            className="text-xs"
                          />
                          <Button size="sm" variant="outline" className="shrink-0 self-start" title={t("Susun dengan AI dari poin Anda", "Compose with AI from your points")} onClick={() => { setAiTarget({ competencyId: c.competencyId, name: c.name }); setAiPoints(""); setAiDraft(""); setAiTone("neutral"); }}>
                            <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
                          </Button>
                        </div>
                      )}
                      {locked && c.comment && <p className="mt-1.5 text-xs italic text-slate-500">“{c.comment}”</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* panel estimasi dampak sticky (§18.12) */}
          <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <Card className="border-fuchsia-200 dark:border-fuchsia-900">
              <CardContent className="p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Coins className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden /> {t("ESTIMASI DAMPAK (draf)", "IMPACT ESTIMATE (draft)")}</h3>
                {!impact ? (
                  <p className="text-xs text-slate-400">{t("Terisi otomatis saat nilai berubah…", "Updates automatically as values change…")}</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-slate-500">{t("Skor provisional", "Provisional score")}</span>
                      <span className="text-2xl font-bold tabular-nums">{impact.pScore != null ? impact.pScore.toFixed(1) : "—"}</span>
                    </div>
                    {impact.pRating && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">{t("Rating provisional", "Provisional rating")}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold dark:bg-slate-800">{impact.pRating.value} · {t(impact.pRating.labelId, impact.pRating.labelEn)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{t("Bonus (matriks aktif)", "Bonus (active matrix)")}</span>
                      <span className="font-semibold">{impact.bonusMonths != null ? `± ${impact.bonusMonths} ${t("bulan", "mo")}` : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">{t("Kenaikan gaji", "Salary raise")}</span>
                      <span className="font-semibold">{impact.raisePct ? `${impact.raisePct[0]}–${impact.raisePct[1]}%` : "—"}</span>
                    </div>
                    {impact.kritisGagal && <p className="rounded bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">⚠ {t("KPI kritis gagal — rating maksimal 2 (§4.5)", "Critical KPI failed — rating capped at 2 (§4.5)")}</p>}
                    {impact.pScore != null && impact.completeness.kpiFilled < impact.completeness.kpiTotal && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("belum lengkap: {f}/{t} KPI — nilai masih bisa berubah", "incomplete: {f}/{t} KPIs — values may still change", { f: String(impact.completeness.kpiFilled), t: String(impact.completeness.kpiTotal) })}</p>
                    )}
                    <p className="border-t border-dashed border-slate-200 pt-2 text-[10px] leading-snug text-slate-400 dark:border-slate-700">
                      ⓘ {t("ESTIMASI berdasar nilai sementara & matriks merit aktif — bukan keputusan; tunduk pada kalibrasi, approval, dan kebijakan final HR. Nominal Rp tidak ditampilkan (D21).", "ESTIMATE based on provisional values & the active merit matrix — not a decision; subject to calibration, approval, and final HR policy. Rp amounts are not shown (D21).")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 360 ringkasan */}
            {meta.cycle.feedback360 && Object.keys(viewApi.data?.f360summary ?? {}).length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4 ov-text-accent" aria-hidden /> {t("Ringkasan 360", "360 Summary")}</h3>
                  {Object.entries(viewApi.data?.f360summary ?? {}).map(([type, s]) => (
                    <div key={type} className="mb-1.5 flex items-center justify-between text-xs">
                      <span>{type} {s.count < 3 && <span className="text-slate-400">({t("butuh ≥3 utk tampil", "needs ≥3 to show")})</span>}</span>
                      <span className="font-semibold tabular-nums">{s.count >= 3 ? Object.values(s.avgByComp).map((v) => v.toFixed(1)).slice(0, 4).join(" · ") : "—"}</span>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setInviteDialog(true)} disabled={locked}>
                    <Users className="h-3.5 w-3.5" aria-hidden /> {t("Undang Reviewer 360", "Invite 360 Reviewers")}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* dialog pratinjau tarikan (§18.6) */}
        <Dialog open={pullDialog} onOpenChange={setPullDialog}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-teal-600 dark:text-teal-400" aria-hidden /> {t("Pratinjau Tarikan Otomatis", "Auto-Pull Preview")}</DialogTitle></DialogHeader>
            <p className="rounded-lg bg-teal-50 p-2.5 text-xs text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
              {t("Nilai akan mengisi finalActual + bukti sumber (autoValueJson). KPI ber-input manual TIDAK tersentuh.", "Values will fill finalActual + source evidence (autoValueJson). Manually-entered KPIs are NOT touched.")}
            </p>
            <Table>
              <TableHeader><TableRow><TableHead>KPI</TableHead><TableHead>{t("Nilai", "Value")}</TableHead><TableHead>{t("Bukti sumber", "Source evidence")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {(pullPreview?.rows ?? []).map((r) => (
                  <TableRow key={r.kpiId}>
                    <TableCell className="text-sm font-medium">{r.title}</TableCell>
                    <TableCell className={cn("font-bold tabular-nums", r.value == null && "text-rose-500")}>{r.value ?? r.error ?? "—"}</TableCell>
                    <TableCell className="text-[11px] text-slate-500">{r.evidence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPullDialog(false)}>{t("Batal")}</Button>
              <Button onClick={() => doPull(true)}><Zap className="h-4 w-4" aria-hidden /> {t("Terapkan", "Apply")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* dialog AI compose (§18.11) */}
        <Dialog open={aiTarget !== null} onOpenChange={(o) => { if (!o) setAiTarget(null); }}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600 dark:text-violet-400" aria-hidden /> {t("Susun Ulasan dengan AI", "Compose Review with AI")}</DialogTitle></DialogHeader>
            <p className="text-xs text-slate-500">{aiTarget?.name} · {t("rate-limit 20 susunan/jam (D20)", "rate limit 20 compositions/hour (D20)")}</p>
            <div className="space-y-2">
              <Label>{t("Poin saya (1–6, bahasa seadanya):", "My points (1–6, any style):")}</Label>
              <Textarea value={aiPoints} onChange={(e) => setAiPoints(e.target.value)} rows={4} placeholder={t("mis. sering telat kirim laporan\npresentasi ke klien bagus", "e.g. often late with reports\ngreat client presentation")} />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("Nada", "Tone")}</Label>
                  <Select value={aiTone} onValueChange={setAiTone}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="neutral">{t("Profesional netral", "Professional neutral")}</SelectItem>
                      <SelectItem value="encouraging">{t("Memberi semangat", "Encouraging")}</SelectItem>
                      <SelectItem value="firm">{t("Tegas namun konstruktif", "Firm yet constructive")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("Panjang", "Length")}</Label>
                  <Select value={aiLen} onValueChange={(v) => setAiLen(v as "short" | "medium")}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">{t("Ringkas 2–3 kalimat", "Short 2–3 sentences")}</SelectItem>
                      <SelectItem value="medium">{t("Sedang 4–6", "Medium 4–6")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {aiDraft && (
                <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900 dark:bg-violet-950/20">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-500">{t("DRAF (edit bebas — AI tidak menambah fakta di luar poin Anda)", "DRAFT (edit freely — the AI adds no facts beyond your points)")}</p>
                  <Textarea value={aiDraft} onChange={(e) => setAiDraft(e.target.value)} rows={4} className="text-xs" />
                </div>
              )}
            </div>
            <DialogFooter>
              {aiDraft ? (
                <>
                  <Button variant="outline" onClick={runAiCompose} disabled={aiBusy}>{t("Susun ulang", "Re-compose")}</Button>
                  <Button onClick={() => { if (aiTarget) patchComp(aiTarget.competencyId, { comment: aiDraft, aiAssisted: true }); setAiTarget(null); toast.success(t("Dipakai sebagai komentar — ditandai aiAssisted (audit internal)", "Used as the comment — flagged aiAssisted (internal audit)")); }}>
                    {t("Pakai sebagai komentar", "Use as comment")}
                  </Button>
                </>
              ) : (
                <Button onClick={runAiCompose} disabled={aiBusy || !aiPoints.trim()}><Sparkles className="h-4 w-4" aria-hidden /> {aiBusy ? t("Menyusun…", "Composing…") : t("Susun →", "Compose →")}</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* dialog invite 360 */}
        <Dialog open={inviteDialog} onOpenChange={setInviteDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{t("Undang Reviewer 360", "Invite 360 Reviewers")}</DialogTitle></DialogHeader>
            <div className="space-y-1.5">
              <Label>{t("Jenis reviewer", "Reviewer type")}</Label>
              <Select value={inviteType} onValueChange={setInviteType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Peer">Peer</SelectItem>
                  <SelectItem value="Subordinate">{t("Bawahan", "Subordinate")}</SelectItem>
                  <SelectItem value="CrossTeam">{t("Lintas tim", "Cross-team")}</SelectItem>
                  <SelectItem value="Upward">{t("Upward", "Upward")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              {(employeesApi.data?.employees ?? []).map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 dark:border-slate-800">
                  <Checkbox checked={inviteSel.has(e.id)} onCheckedChange={(v) => { const n = new Set(inviteSel); if (v) n.add(e.id); else n.delete(e.id); setInviteSel(n); }} />
                  <span className="flex-1">{e.fullName} <span className="text-xs text-slate-500">{e.employeeNo}</span></span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteDialog(false)}>{t("Batal")}</Button>
              <Button onClick={doInvite} disabled={inviteSel.size === 0}>{t("Undang {n}", "Invite {n}", { n: String(inviteSel.size) })}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ============ RENDER: DAFTAR ============
  const rows = listApi.data?.rows ?? [];
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Penilaian")}
        title={t("Penilaian", "Appraisals")}
        description={t(
          "Form atasan: aktual KPI (tarik otomatis berpratinjau) + skor kompetensi ber-deskriptor + AI assist ulasan + panel estimasi dampak real-time. Impor realisasi Excel mengisi nilai TANPA mengubah status.",
          "Manager form: KPI actuals (previewed auto-pull) + descriptor-anchored competency scores + AI-assisted reviews + real-time impact estimate panel. Excel actuals import fills values WITHOUT changing status.",
        )}
        actions={(
          <Button variant="outline" onClick={() => { setImportDialog(true); }} disabled={!cycleId}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden /> {t("Impor Realisasi", "Import Actuals")}
          </Button>
        )}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={cycleId} onValueChange={setCycleId}>
          <SelectTrigger className="w-72"><SelectValue placeholder={t("Pilih siklus…", "Pick a cycle…")} /></SelectTrigger>
          <SelectContent>{(cyclesApi.data?.rows ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>)}</SelectContent>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setDq(q); }} placeholder={t("Cari peserta… (Enter)", "Search participants… (Enter)")} className="w-56 pl-8" />
        </div>
      </div>
      <Card><CardContent className="p-0">
        {listApi.loading && !listApi.data ? (
          <div className="p-4"><LoadingRows /></div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={NotebookPen} title={t("Belum ada peserta", "No participants yet")} description="" /></div>
        ) : (
          <div className="max-h-[34rem] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                <TableRow>
                  <TableHead>{t("Dokumen")}</TableHead>
                  <TableHead>{t("Karyawan", "Employee")}</TableHead>
                  <TableHead>{t("Aktual KPI", "KPI Actuals")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("Skor")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.appraisalId} className="cursor-pointer" onClick={() => nav.navigate("performance", "appraisals", { id: r.appraisalId })}>
                    <TableCell className="font-mono text-xs">{r.docNo}</TableCell>
                    <TableCell><p className="font-semibold">{r.employeeName}</p><p className="text-xs text-slate-500">{r.employeeNo} · {r.position ?? "—"}</p></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className={cn("h-full rounded-full", r.kpiFilled >= r.kpiTotal ? "bg-emerald-500" : r.kpiFilled > 0 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${r.kpiTotal ? (r.kpiFilled / r.kpiTotal) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-slate-500">{r.kpiFilled}/{r.kpiTotal}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">{r.managerScore != null ? r.managerScore.toFixed(1) : "—"}</TableCell>
                    <TableCell><StatusPill status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent></Card>

      {/* dialog impor realisasi 3 langkah */}
      <Dialog open={importDialog} onOpenChange={(o) => { setImportDialog(o); if (!o) setImportStep(1); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Impor Realisasi Akhir via Excel", "Import Final Actuals via Excel")}</DialogTitle></DialogHeader>
          <div className="mb-3 flex items-center gap-2 text-xs">
            {[1, 2, 3].map((n) => (
              <span key={n} className={cn("rounded-full px-2.5 py-1 font-medium", importStep === n ? "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                {n === 1 ? t("1 Unduh template", "1 Download template") : n === 2 ? t("2 Unggah", "2 Upload") : t("3 Pratinjau & commit", "3 Preview & commit")}
              </span>
            ))}
          </div>
          {importStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">{t("Template berisi semua peserta & KPI siklus (nilai saat ini disertakan). Isi kolom Realisasi Akhir.", "The template contains all cycle participants & KPIs (current values included). Fill the Final Actual column.")}</p>
              <a href={`${APPRAISALS_API}?importTemplate=actuals&cycleId=${cycleId}`} download><Button variant="outline"><Download className="h-4 w-4" aria-hidden /> {t("Unduh Template (.xlsx)", "Download Template (.xlsx)")}</Button></a>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportDialog(false)}>{t("Batal")}</Button>
                <Button onClick={() => setImportStep(2)}>{t("Sudah punya file → Unggah", "Have a file → Upload")}</Button>
              </div>
            </div>
          )}
          {importStep === 2 && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center hover:border-fuchsia-400 dark:border-slate-700">
                <Upload className="h-8 w-8 text-slate-400" aria-hidden />
                <span className="text-sm font-medium">{importFile ? importFile.name : t("Pilih file .xlsx", "Pick a .xlsx file")}</span>
                <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }} />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportStep(1)}>{t("Kembali", "Back")}</Button>
                <Button onClick={doImportPreview} disabled={!importFile || importBusy}>{importBusy ? t("Memvalidasi…", "Validating…") : t("Pratinjau →", "Preview →")}</Button>
              </div>
            </div>
          )}
          {importStep === 3 && importPreview && (
            <div className="space-y-3">
              <p className={cn("rounded-lg p-2.5 text-sm", importPreview.errorCount > 0 ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300")}>
                {t("{v} valid · {e} error", "{v} valid · {e} errors", { v: String(importPreview.validCount), e: String(importPreview.errorCount) })}
              </p>
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95"><TableRow><TableHead>{t("Baris", "Row")}</TableHead><TableHead>{t("Karyawan", "Employee")}</TableHead><TableHead>KPI</TableHead><TableHead>{t("Realisasi", "Actual")}</TableHead><TableHead>{t("Hasil", "Result")}</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {importPreview.rows.map((r) => (
                      <TableRow key={r.row} className={r.valid ? "" : "bg-rose-50/60 dark:bg-rose-950/20"}>
                        <TableCell className="font-mono text-xs">{r.row}</TableCell>
                        <TableCell className="text-sm">{r.employeeName}</TableCell>
                        <TableCell className="text-sm">{r.kpiTitle}</TableCell>
                        <TableCell className="tabular-nums">{r.finalActual ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.valid ? "✓" : <ul className="list-disc pl-3 text-rose-600 dark:text-rose-400">{r.errors.map((er, i) => <li key={i}>{er}</li>)}</ul>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportStep(2)}>{t("Unggah ulang", "Re-upload")}</Button>
                <Button onClick={doImportCommit} disabled={importBusy || importPreview.validCount === 0}><Save className="h-4 w-4" aria-hidden /> {t("Commit {n} baris →", "Commit {n} rows →", { n: String(importPreview.validCount) })}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutoEvidence({ json }: { json: string }) {
  const { t } = useI18n();
  // parse di luar render-JSX (react-hooks/error-boundaries): null bila rusak
  let ev: { source: string; periodStart: string; periodEnd: string; value: number; pulledAt: string; evidence: string } | null = null;
  try {
    ev = JSON.parse(json) as { source: string; periodStart: string; periodEnd: string; value: number; pulledAt: string; evidence: string };
  } catch {
    ev = null;
  }
  if (!ev) return null;
  return (
    <span className="mt-0.5 block text-[10px] text-teal-600 dark:text-teal-400" title={ev.evidence}>
      <Zap className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />
      {t("Sumber", "Source")}: {ev.source} · {ev.periodStart}→{ev.periodEnd} · {ev.value} · {t("ditarik", "pulled")} {new Date(ev.pulledAt).toLocaleString("id-ID")}
    </span>
  );
}
