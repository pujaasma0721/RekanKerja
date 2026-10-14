"use client";
// ============================================================================
// RekanKerja ESS P3-PERF — "Penilaian Saya" (§17 ess/my-appraisal, Alur 5
// §29-2, §18.11 AI assist self, §18.7 autosave mirror lokal):
//   • Fase Assessment → form self-assessment: kompetensi radio 1–5 + komentar
//     (tombol "✨ Susun dengan AI") + usulan final aktual utk KPI manual +
//     bukti catatan; draf MIRROR localStorage (pulihkan/buang — server = sumber
//     kebenaran) + progress bar; SUBMIT sekali di akhir (§35-7).
//   • Fase Published → hasil final read-only (skor/rating/rincian + ringkasan
//     360) — acknowledge/banding menyusul P4.
//   • Tab "Periode lalu" — riwayat siklus final (read-only §18.3 gaya).
// Estimator dampak TIDAK ada di ESS (D21 — karyawan tidak melihat).
// ============================================================================
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ProgressTrackerBar, AiComposeDialog } from "@/rekankerja/performance/components/perf-form-kit";
import { ESS_BASE } from "./ess-api";
import {
  ClipboardCheck, AlertTriangle, Loader2, Sparkles, Send, RotateCcw, History,
  ChevronDown, Info, ShieldAlert,
} from "lucide-react";

// ---------- tipe (kontrak API) ----------

interface SelfComp {
  competencyId: string; code: string; name: string; kind: string;
  weight: number; levels: { level: number; label: string; descriptor: string }[];
  selfScore: number | null; selfComment: string | null; selfAiAssisted: boolean;
}
interface SelfData {
  appraisal: {
    id: string; docNo: string; status: string;
    employeeNo: string; fullName: string; unit: string | null;
    selfScore: number | null; managerScore: number | null;
    finalScore: number | null; finalRating: number | null;
  };
  cycle: { code: string; status: string; periodStart: string; periodEnd: string; selfStart: string | null; selfEnd: string | null };
  selfWindowOpen: boolean;
  canSubmit: boolean;
  comps: SelfComp[];
  manualKpis: { id: string; title: string; unit: string; target: number; midActual: number | null; finalActual: number | null; evidenceJson: string | null }[];
  autoKpis: { id: string; title: string; unit: string; target: number; finalActual: number | null }[];
  progress: { total: number; filled: number };
}
interface PublishedData {
  appraisal: {
    id: string; docNo: string; status: string;
    selfScore: number | null; managerScore: number | null;
    finalScore: number | null; finalRating: number | null; acknowledgedAt: string | null;
  };
  cycle: { code: string; status: string; periodStart: string; periodEnd: string };
  rating: { value: number; labelId: string; labelEn: string; color: string } | null;
  kpis: { title: string; unit: string; target: number; finalActual: number | null; midActual: number | null; weight: number }[];
  comps: { name: string; kind: string; score: number; selfScore: number | null; comment: string | null; selfComment: string | null }[];
  feedback360: { perCompetency: { name: string; avg: number | null; count: number; comments: string[] | null }[]; reviewers: { submitted: number }; hidden: string | null } | null;
}
interface PrevRow {
  appraisalId: string; docNo: string; cycleCode: string;
  periodStart: string; periodEnd: string;
  selfScore: number | null; managerScore: number | null; finalScore: number | null;
  finalRating: number | null; rating: { value: number; labelId: string; labelEn: string; color: string } | null;
}

interface SelfDraft {
  scores: Record<string, number>;
  comments: Record<string, string>;
  aiAssistedIds: string[];
  actuals: Record<string, string>;
  evidence: Record<string, string>;
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");

// ============================================================================
// HALAMAN
// ============================================================================

export function EssMyAppraisalPage() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ current: CurrentBlock | null; published: PublishedData | null; previous: PrevRow[] }>(`${ESS_BASE}/my-appraisal`);
  const [tab, setTab] = useState<"current" | "previous">("current");

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("Penilaian Saya", "My Appraisal")}
        description={t(
          "Self-assessment periode berjalan (kompetensi + usulan aktual) + hasil final yang telah dipublikasikan.",
          "Current-period self-assessment (competencies + proposed actuals) + published final results.",
        )}
      />

      {error && <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={AlertTriangle} />}
      {loading && <LoadingRows rows={4} />}

      {data && !data.current && data.previous.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title={t("Belum ada penilaian", "No appraisal yet")}
          description={t("Anda belum terdaftar sebagai peserta siklus penilaian apa pun.", "You are not enrolled in any appraisal cycle yet.")}
        />
      )}

      {data && (data.current || data.previous.length > 0) && (
        <>
          {(data.current && !("waiting" in data.current)) && data.previous.length > 0 && (
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/60">
              <button onClick={() => setTab("current")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", tab === "current" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
                aria-pressed={tab === "current"}>
                {t("Periode Berjalan", "Current Period")}
              </button>
              <button onClick={() => setTab("previous")}
                className={cn("flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition", tab === "previous" ? "bg-white shadow-sm dark:bg-slate-900" : "text-slate-500")}
                aria-pressed={tab === "previous"}>
                {t(`Periode Lalu (${data.previous.length})`, `Past Periods (${data.previous.length})`)}
              </button>
            </div>
          )}

          {tab === "current" && data.current && (
            "waiting" in data.current
              ? <WaitingPhase c={data.current} />
              : <SelfAssessmentForm d={data.current} onDone={refresh} />
          )}
          {tab === "current" && !data.current && data.published && <PublishedResultCard d={data.published} />}
          {tab === "current" && !data.current && !data.published && data.previous.length > 0 && (
            <EmptyState icon={ClipboardCheck} title={t("Tidak ada siklus berjalan", "No running cycle")}
              description={t("Anda tidak terdaftar di siklus aktif mana pun — lihat Periode Lalu.", "You are not enrolled in any active cycle — see Past Periods.")} />
          )}

          {tab === "previous" && (
            <div className="space-y-2">
              {data.previous.map((p) => (
                <Card key={p.appraisalId} className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{p.cycleCode}</span>
                      {p.rating && (
                        <Badge variant="outline" className="text-[10px]">
                          {t(`rating ${p.rating.value}`, `rating ${p.rating.value}`)} · {p.rating.labelId}
                        </Badge>
                      )}
                      <span className="ml-auto font-mono text-xs text-slate-400">{p.docNo}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t(
                        `Periode ${fmtD(p.periodStart)} – ${fmtD(p.periodEnd)} · skor diri ${p.selfScore ?? "—"} · atasan ${p.managerScore ?? "—"} · final ${p.finalScore ?? "—"}`,
                        `Period ${fmtD(p.periodStart)} – ${fmtD(p.periodEnd)} · self ${p.selfScore ?? "—"} · manager ${p.managerScore ?? "—"} · final ${p.finalScore ?? "—"}`,
                      )}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Blok "current" — form self (fase Assessment) atau penanda menunggu fase. */
type CurrentBlock =
  | SelfData
  | { appraisalId: string; docNo: string; status: string; cycleCode: string; phase: string; waiting: true };

function WaitingPhase({ c }: { c: { docNo: string; status: string; cycleCode: string; phase: string } }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Info}
      title={t(`Menunggu fase penilaian (${c.phase})`, `Awaiting the appraisal phase (${c.phase})`)}
      description={t(
        `Siklus ${c.cycleCode} masih pada fase ${c.phase}. Formulir penilaian diri terbuka saat fase Assessment.`,
        `Cycle ${c.cycleCode} is still in the ${c.phase} phase. The self-assessment form opens during the Assessment phase.`,
      )}
    />
  );
}

// ============================================================================
// FORM SELF-ASSESSMENT (§29-2 + §18.7 mirror lokal + §18.11 AI)
// ============================================================================

function SelfAssessmentForm({ d, onDone }: { d: SelfData; onDone: () => void }) {
  const { t } = useI18n();
  const storageKey = `rekankerja:perf-draft:self:${d.appraisal.id}`;
  const [draft, setDraft] = useState<SelfDraft>({ scores: {}, comments: {}, aiAssistedIds: [], actuals: {}, evidence: {} });
  const [mirror, setMirror] = useState<SelfDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiFor, setAiFor] = useState<SelfComp | null>(null);

  // muat nilai server → state
  useEffect(() => {
    const s: SelfDraft = { scores: {}, comments: {}, aiAssistedIds: [], actuals: {}, evidence: {} };
    for (const c of d.comps) {
      s.scores[c.competencyId] = c.selfScore ?? 0;
      s.comments[c.competencyId] = c.selfComment ?? "";
    }
    for (const k of d.manualKpis) {
      s.actuals[k.id] = k.finalActual != null ? String(Math.round(k.finalActual * 1e6) / 1e6) : "";
    }
    setDraft(s);
    // mirror lokal §18.7 — tawarkan pulihkan HANYA bila salinan lokal BERBEDA
    // dari state server (banner identik = berisik; pola P1 form-kit).
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw && JSON.stringify(JSON.parse(raw) as SelfDraft) !== JSON.stringify(s)) {
        setMirror(JSON.parse(raw) as SelfDraft);
      }
    } catch { /* storage rusak */ }
  }, [d.appraisal.id]);

  // persist mirror lokal tiap perubahan (autosave klien-side — submit eksplisit di akhir)
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* kuota */ }
  }, [draft, storageKey]);

  const filled = d.comps.filter((c) => (draft.scores[c.competencyId] ?? 0) >= 1).length;
  const pct = d.comps.length ? Math.round((filled / d.comps.length) * 100) : 0;
  const canEdit = d.selfWindowOpen && !["ManagerDone", "Calibrating", "Finalized", "Published", "Closed"].includes(d.appraisal.status);

  const submit = async () => {
    const missing = d.comps.filter((c) => !((draft.scores[c.competencyId] ?? 0) >= 1 && (draft.scores[c.competencyId] ?? 0) <= 5));
    if (missing.length > 0) {
      toast.error(t(`Masih ada ${missing.length} kompetensi belum dinilai — semua baris wajib skor 1–5 (§35-7)`, `${missing.length} competencies unscored — all rows require a 1–5 score (§35-7)`));
      return;
    }
    setBusy(true);
    try {
      const out = await apiSend<{ selfScore: number }>(`${ESS_BASE}/my-appraisal`, "POST", {
        action: "submitSelf",
        appraisalId: d.appraisal.id,
        selfScores: d.comps.map((c) => ({ competencyId: c.competencyId, score: draft.scores[c.competencyId] ?? 0 })),
        selfComments: d.comps.filter((c) => (draft.comments[c.competencyId] ?? "").trim()).map((c) => ({ competencyId: c.competencyId, comment: draft.comments[c.competencyId] })),
        selfAiAssistedIds: draft.aiAssistedIds,
        manualActuals: d.manualKpis
          .filter((k) => (draft.actuals[k.id] ?? "") !== "")
          .map((k) => ({ kpiId: k.id, finalActual: Number(draft.actuals[k.id]) })),
        evidence: d.manualKpis
          .filter((k) => (draft.evidence[k.id] ?? "").trim())
          .map((k) => ({ kpiId: k.id, note: draft.evidence[k.id] })),
      });
      toast.success(t(`Penilaian diri terkirim — skor ${out.selfScore}. Atasan Anda dinotifikasi.`, `Self-assessment submitted — score ${out.selfScore}. Your manager has been notified.`));
      try { localStorage.removeItem(storageKey); } catch { /* never */ }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{d.cycle.code}</span>
            <StatusPill status={d.appraisal.status} />
            <span className="ml-auto font-mono text-xs text-slate-400">{d.appraisal.docNo}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(
              `Jendela penilaian diri: ${fmtD(d.cycle.selfStart)} – ${fmtD(d.cycle.selfEnd)}${d.selfWindowOpen ? "" : " (sudah tutup)"}. Atasan memverifikasi aktual KPI & menilai setelah ini.`,
              `Self-assessment window: ${fmtD(d.cycle.selfStart)} – ${fmtD(d.cycle.selfEnd)}${d.selfWindowOpen ? "" : " (closed)"}. Your manager verifies KPI actuals & scores after this.`,
            )}
          </p>
          {canEdit && (
            <div className="mt-3">
              <ProgressTrackerBar pct={pct} breakdown={t(`${filled}/${d.comps.length} kompetensi`, `${filled}/${d.comps.length} competencies`)} />
            </div>
          )}
          {mirror && canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1">{t("Draf lokal tersimpan di perangkat ini — pulihkan untuk melanjutkan mengisi.", "A local draft is saved on this device — restore to continue filling in.")}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => { setDraft(mirror); setMirror(null); }}>{t("Pulihkan", "Restore")}</Button>
              <Button size="sm" variant="ghost" className="h-7"
                onClick={() => { try { localStorage.removeItem(storageKey); } catch { /* never */ } setMirror(null); }}>
                {t("Buang", "Discard")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* kompetensi */}
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{t("Penilaian Kompetensi Diri", "Self Competency Assessment")}</h3>
            <span className="text-[11px] text-slate-400">{t("semua baris wajib skor 1–5 (§35-7)", "all rows require a 1–5 score (§35-7)")}</span>
          </div>
          <div className="space-y-3">
            {d.comps.map((c) => {
              const score = draft.scores[c.competencyId] ?? 0;
              const comment = draft.comments[c.competencyId] ?? "";
              const descriptor = c.levels.find((l) => l.level === score);
              return (
                <div key={c.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{c.name}</p>
                    <Badge variant="outline" className="h-4 px-1 text-[9px]">
                      {c.kind === "CoreValue" ? t("nilai inti", "core value") : c.kind === "Managerial" ? t("manajerial", "managerial") : t("teknis", "technical")}
                    </Badge>
                    <span className="text-[10px] text-slate-400">{t(`bobot ${c.weight}%`, `weight ${c.weight}%`)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map((v) => {
                      const lv = c.levels.find((l) => l.level === v);
                      return (
                        <label key={v}
                          title={lv ? `${lv.label}: ${lv.descriptor}` : undefined}
                          className={cn(
                            "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition",
                            score === v ? "border-brand bg-brand/10 text-brand" : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
                          )}
                        >
                          <input type="radio" className="sr-only" name={`self-${c.competencyId}`} value={v}
                            disabled={!canEdit} checked={score === v}
                            onChange={() => setDraft({ ...draft, scores: { ...draft.scores, [c.competencyId]: v } })}
                            aria-label={t(`${c.name} — level ${v}`, `${c.name} — level ${v}`)} />
                          {v}
                        </label>
                      );
                    })}
                    {descriptor && (
                      <span className="ml-1 min-w-0 flex-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="font-semibold">{descriptor.label}:</span> {descriptor.descriptor}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Label className="text-xs">{t("Ulasan singkat (opsional)", "Brief review (optional)")}</Label>
                      {canEdit && (
                        <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setAiFor(c)}>
                          <Sparkles className="h-3.5 w-3.5 text-brand" />{t("Susun dengan AI", "Compose with AI")}
                        </Button>
                      )}
                    </div>
                    <Textarea rows={2} value={comment} disabled={!canEdit}
                      placeholder={t("Contoh capaian/perilaku Anda pada kompetensi ini…", "Examples of your achievements/behaviors for this competency…")}
                      onChange={(e) => setDraft({ ...draft, comments: { ...draft.comments, [c.competencyId]: e.target.value } })}
                      aria-label={t(`Ulasan ${c.name}`, `${c.name} review`)} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* KPI manual */}
      {d.manualKpis.length > 0 && (
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4 sm:p-5">
            <h3 className="mb-1 text-sm font-semibold">{t("Usulan Capaian KPI Manual", "Proposed Manual KPI Actuals")}</h3>
            <p className="mb-3 text-[11px] text-slate-400">
              {t("KPI bersumber otomatis ditarik atasan (tidak perlu diisi). Usulan Anda diverifikasi atasan saat menilai.", "Auto-sourced KPIs are pulled by the manager (no input needed). Your proposals are verified by the manager when scoring.")}
            </p>
            <div className="space-y-3">
              {d.manualKpis.map((k) => (
                <div key={k.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium">{k.title}</p>
                    <span className="text-[11px] text-slate-400">
                      {t("target", "target")} {k.target} {k.unit}
                      {k.midActual != null ? ` · ${t("tengah tahun", "mid")} ${k.midActual}` : ""}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-[140px_1fr]">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Capaian akhir", "Final actual")}</Label>
                      <Input type="number" inputMode="decimal" value={draft.actuals[k.id] ?? ""} disabled={!canEdit}
                        onChange={(e) => setDraft({ ...draft, actuals: { ...draft.actuals, [k.id]: e.target.value } })}
                        aria-label={t(`Capaian akhir ${k.title}`, `Final actual ${k.title}`)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t("Catatan bukti (opsional)", "Evidence note (optional)")}</Label>
                      <Input value={draft.evidence[k.id] ?? ""} disabled={!canEdit}
                        placeholder={t("mis. lampiran ada di email tim", "e.g. attachment is in the team email")}
                        onChange={(e) => setDraft({ ...draft, evidence: { ...draft.evidence, [k.id]: e.target.value } })}
                        aria-label={t(`Bukti ${k.title}`, `Evidence ${k.title}`)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {d.autoKpis.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-medium">
            <Info className="h-4 w-4 text-slate-400" />
            {t(`KPI otomatis (${d.autoKpis.length}) — ditarik dari sistem`, `Auto KPIs (${d.autoKpis.length}) — pulled from the system`)}
            <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
          </summary>
          <div className="px-4 pb-3 text-xs text-slate-500">
            {d.autoKpis.map((k) => (
              <p key={k.id}>• {k.title} — {t("target", "target")} {k.target} {k.unit} · {t("nilai ditarik atasan saat penilaian", "value pulled by the manager during appraisal")}</p>
            ))}
          </div>
        </details>
      )}

      {canEdit && d.canSubmit && (
        <Button onClick={submit} disabled={busy || filled < d.comps.length} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t("Submit Penilaian Diri", "Submit Self-Assessment")}
        </Button>
      )}
      {canEdit && !d.canSubmit && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {t("Status peserta belum mengizinkan submit — target harus dikunci atasan lebih dulu (§35-7).", "Participant status does not allow submitting — goals must be locked by the manager first (§35-7).")}
        </p>
      )}

      {aiFor && (
        <AiComposeDialog
          title={t(`Ulasan diri — ${aiFor.name}`, `Self review — ${aiFor.name}`)}
          target={{ endpoint: `${ESS_BASE}/my-appraisal`, extra: { scope: "self", appraisalId: d.appraisal.id, competencyId: aiFor.competencyId } }}
          onClose={() => setAiFor(null)}
          onUse={(text) => {
            setDraft((s) => ({
              ...s,
              comments: { ...s.comments, [aiFor.competencyId]: text },
              aiAssistedIds: s.aiAssistedIds.includes(aiFor.competencyId) ? s.aiAssistedIds : [...s.aiAssistedIds, aiFor.competencyId],
            }));
            setAiFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Hasil final read-only (siklus Published) — acknowledge menyusul P4. */
export function PublishedResultCard({ d }: { d: PublishedData }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{d.cycle.code}</span>
          <StatusPill status={d.appraisal.status} />
          {d.rating && (
            <Badge variant="outline" className="text-[10px]">{d.rating.value} · {locale.startsWith("en") ? d.rating.labelEn : d.rating.labelId}</Badge>
          )}
          <span className="ml-auto font-mono text-xs text-slate-400">{d.appraisal.docNo}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60">
            <p className="text-[10px] text-slate-400">{t("Skor diri", "Self score")}</p>
            <p className="text-lg font-bold tabular-nums">{d.appraisal.selfScore ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900/60">
            <p className="text-[10px] text-slate-400">{t("Skor atasan", "Manager score")}</p>
            <p className="text-lg font-bold tabular-nums">{d.appraisal.managerScore ?? "—"}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/30">
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{t("Skor final", "Final score")}</p>
            <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{d.appraisal.finalScore ?? "—"}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
          <History className="h-3.5 w-3.5" />{open ? t("Sembunyikan rincian", "Hide details") : t("Lihat rincian", "View details")}
        </Button>
        {open && (
          <div className="mt-2 space-y-3 text-xs">
            <div>
              <p className="mb-1 font-semibold">{t("KPI", "KPIs")}</p>
              {d.kpis.map((k, i) => (
                <p key={i} className="flex flex-wrap items-baseline gap-1.5 py-0.5">
                  <span className="min-w-0 flex-1 truncate">{k.title}</span>
                  <span className="tabular-nums text-slate-500">{k.target} → <span className="font-semibold">{k.finalActual ?? "—"}</span> {k.unit}</span>
                  <span className="w-9 text-right text-slate-400">{k.weight}%</span>
                </p>
              ))}
            </div>
            {d.comps.length > 0 && (
              <div>
                <p className="mb-1 font-semibold">{t("Kompetensi", "Competencies")}</p>
                {d.comps.map((c, i) => (
                  <div key={i} className="py-0.5">
                    <p className="flex flex-wrap items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="tabular-nums">{t(`atasan ${c.score}`, `manager ${c.score}`)}{c.selfScore != null ? ` · ${t(`diri ${c.selfScore}`, `self ${c.selfScore}`)}` : ""}</span>
                    </p>
                    {c.comment && <p className="pl-3 text-[11px] text-slate-500 dark:text-slate-400">{t("catatan atasan:", "manager note:")} {c.comment}</p>}
                  </div>
                ))}
              </div>
            )}
            {d.feedback360 && !d.feedback360.hidden && d.feedback360.perCompetency.length > 0 && (
              <div>
                <p className="mb-1 font-semibold">{t("Ringkasan 360 (anonim)", "360 summary (anonymous)")}</p>
                {d.feedback360.perCompetency.map((p, i) => (
                  <p key={i} className="flex items-baseline gap-1.5 py-0.5">
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="tabular-nums">{p.avg ?? "—"} / 5 · {p.count}x</span>
                  </p>
                ))}
              </div>
            )}
            {d.feedback360?.hidden && (
              <p className="flex items-center gap-1.5 text-slate-400"><ShieldAlert className="h-3.5 w-3.5" />{t("360 dirahasiakan (<3 reviewer)", "360 hidden (<3 reviewers)")}</p>
            )}
            <p className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-[11px] text-slate-400 dark:border-slate-700">
              {t("Konfirmasi penerimaan (acknowledge) & banding menyusul fase P4.", "Acknowledgement & appeals arrive in phase P4.")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
