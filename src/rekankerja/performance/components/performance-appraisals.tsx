"use client";
// ============================================================================
// PERFORMANCE — Penilaian (P3 — §20 P3, form penilaian atasan §18-4/§29-4):
//   • Daftar peserta per siklus (progress % + skor + status) → FORM PENILAIAN:
//     tabel KPI (input final aktual + tombol tarik per baris + chip AUTO +
//     bukti tooltip + midActual konteks) → "Tarik semua data otomatis" dialog
//     pratinjau §18.6 → "Impor Excel realisasi" 3 langkah §18.5 → grid
//     kompetensi radio 1–5 + deskriptor level + komentar WAJIB skor ekstrem
//     + "✨ Susun dengan AI" §18.11 → ringkasan 360 ter-agregasi (≥3 §37)
//     → PANEL ESTIMASI DAMPAK §18.12 (sticky desktop / collapsible mobile,
//     debounce 1 dtk, tanpa nominal Rp D21) → SUBMIT guard keras §35-8.
//   • Autosave §18.7 (debounce 3 dtk + mirror lokal + pemulihan) +
//     ProgressTrackerBar. Dwibahasa; mobile: KPI collapse ke kartu, tombol
//     flex-wrap, tanpa h-scroll 375px.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useDraftAutosave, AutosaveIndicator, DraftRecoveryBanner, ProgressTrackerBar, AiComposeDialog,
} from "@/rekankerja/performance/components/perf-form-kit";
import {
  ClipboardCheck, Search, AlertTriangle, Loader2, Zap, FileSpreadsheet, Upload, Download,
  FileWarning, CheckCircle2, Sparkles, Send, Users, ChevronDown, Info, Coins, ShieldAlert, UserPlus,
  ShieldCheck, EyeOff, Ruler,
} from "lucide-react";

// ---------- KPI-METRIC — parse level deskriptor (paritas KpiFormDialog goals) ----------

const parseApprLv = (json: string | null | undefined): { level: number; descriptor: string }[] => {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v)
      ? v.filter((l) => Number(l?.level) >= 1 && Number(l?.level) <= 5 && String(l?.descriptor ?? "").trim())
        .map((l) => ({ level: Number(l.level), descriptor: String(l.descriptor) }))
      : [];
  } catch { return []; }
};
const apprLvTone = (lv: number): string =>
  lv === 1 ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
  : lv === 2 ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400"
  : lv === 3 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
  : lv === 4 ? "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"
  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400";

// ---------- tipe (kontrak API §17) ----------

interface CycleRow {
  id: string; code: string; name: string; status: string;
  periodStart: string; periodEnd: string;
}
interface ParticipantRow {
  appraisalId: string; docNo: string; status: string;
  employeeNo: string; fullName: string; managerName: string | null;
  kpiCount: number; compCount: number; progressPct: number;
  selfScore: number | null; managerScore: number | null;
  selfDone: boolean; managerDone: boolean;
}
interface DetailKpi {
  id: string; kpiDefId: string | null; title: string; polarity: string; unit: string;
  description: string | null; measureMode: string; metricLevelsJson: string | null;
  thresholdMin: number | null; target: number; stretchValue: number | null;
  weight: number; isCritical: boolean; dataSource: string;
  autoValueJson: string | null; midActual: number | null; finalActual: number | null;
  proposedBy: string; origin: string;
}
interface DetailComp {
  id: string; competencyId: string; code: string; name: string; kind: string;
  score: number; selfScore: number | null; comment: string | null; selfComment: string | null;
  weight: number; levels: { level: number; label: string; descriptor: string }[];
}
interface Detail360 {
  perCompetency: { competencyId: string; name: string; kind: string; avg: number | null; count: number; comments: string[] | null }[];
  reviewers: { total: number; submitted: number; invited: number; declined: number; expired: number };
  hidden: string | null;
}
interface AppraisalDetail {
  appraisal: {
    id: string; docNo: string; status: string; templateId: string | null;
    employeeNo: string; fullName: string; unit: string | null; position: string | null;
    managerName: string | null; selfScore: number | null; managerScore: number | null;
    finalScore: number | null; finalRating: number | null;
  };
  cycle: {
    id: string; code: string; name: string; status: string;
    periodStart: string; periodEnd: string;
    selfStart: string | null; selfEnd: string | null; mgrStart: string | null; mgrEnd: string | null;
    feedback360: boolean;
  };
  weights: { kpi: number; competency: number; core: number };
  kpis: DetailKpi[];
  comps: DetailComp[];
  progress: { pct: number; kpiFilled: number; kpiTotal: number; compScored: number; compTotal: number };
  selfProgress: { total: number; filled: number };
  feedback360: Detail360 | null;
}
interface PullRow {
  kpiId: string; title: string; unit: string; sourceKey: string | null;
  currentFinal: number | null; newValue: number | null;
  sourceLabel: string; periodLabel: string; computedAt: string;
  isOverwrite: boolean; needsManual: boolean; note: string | null;
}
interface ImpactData {
  pScore: number;
  pRating: number | null;
  ratingLabel: { id: string; en: string } | null;
  ratingColor: string | null;
  bonusMonths: number | null;
  raisePct: [number, number] | null;
  criticalFailed: string[];
  kpiFilled: number; kpiTotal: number; compScored: number; compTotal: number;
  components: { kpi: number | null; competency: number | null; core: number | null };
  incomplete: boolean;
  weights: { kpi: number; competency: number; core: number };
}
interface ImportRow {
  rowNo: number; employeeNo: string; fullName: string; kpi: string;
  target: string; finalActual: string; unit: string;
  valid: boolean; errors: { field: string; message: string }[];
}
interface Invite360Row {
  id: string; appraisalId: string; docNo: string; subjectName: string;
  reviewerName: string; reviewerType: string; status: string;
  dueAt: string | null; submittedAt: string | null;
}
// B2-BL — advisori bias (D-BL7a) + antrean moderasi HR (D-BL7b)
interface BiasWarningRow {
  category: string;
  phrase: string;
  suggestion: string;
  compName?: string;
}
interface FlaggedAnswerCard {
  id: string;
  feedbackId: string;
  competencyId: string;
  competencyName: string;
  comment: string | null;
  flagged: { category: string; phrase: string }[];
  appraisalDocNo: string;
  cycleCode: string;
  submittedAt: string | null;
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
// B2-BL — marker komentar ter-Redaksi HR (PERSIS REDACTED_360_COMMENT service;
// didefinisikan lokal agar client tidak mengimpor service server-only).
const REDACTED_360_COMMENT = "[dikensorkan oleh HR — potensi bias]";
const num = (v: string | number | null | undefined, fb = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fb;
};

const LOCKED_STATUS = ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"];

const RATING_TONE: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
  teal: "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400",
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400",
};

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceAppraisalsPage() {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [pickedCycleId, setPickedCycleId] = useState("");
  const [appraisalId, setAppraisalId] = useState<string | null>(null);

  const activeCycles = cycles.data?.rows ?? [];
  const cycleId = pickedCycleId || activeCycles.find((c) => c.status === "Assessment")?.id || activeCycles[0]?.id || "";
  const cycle = activeCycles.find((c) => c.id === cycleId);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · P3"
        title={t("Penilaian", "Appraisals")}
        description={t(
          "Penilaian akhir periode: verifikasi aktual KPI (tarik otomatis / impor / manual), skor kompetensi, ringkasan 360, dan estimasi dampak real-time — skor dihitung server (§16).",
          "End-of-period appraisal: verify KPI actuals (auto-pull / import / manual), competency scores, 360 summary, and real-time impact estimate — scores are computed server-side (§16).",
        )}
        actions={(
          <Select value={cycleId} onValueChange={(v) => { setPickedCycleId(v); setAppraisalId(null); }}>
            <SelectTrigger className="w-56" aria-label={t("Pilih siklus", "Select cycle")}>
              <SelectValue placeholder={t("Pilih siklus…", "Select cycle…")} />
            </SelectTrigger>
            <SelectContent>
              {activeCycles.map((c) => (<SelectItem key={c.id} value={c.id}>{c.code} — {c.status}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
      />

      {appraisalId && cycle
        ? <AppraisalForm key={appraisalId} appraisalId={appraisalId} cycleId={cycle.id} onBack={() => setAppraisalId(null)} />
        : cycle && (
          <ParticipantList cycleId={cycle.id} cycle={cycle} onOpen={(id) => setAppraisalId(id)} />
        )}
    </div>
  );
}

// ============================================================================
// DAFTAR PESERTA
// ============================================================================

function ParticipantList({ cycleId, cycle, onOpen }: { cycleId: string; cycle: CycleRow; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const { data, loading, error } = useApi<{ rows: ParticipantRow[] }>(
    `/api/rekankerja/performance/appraisals?cycleId=${cycleId}&status=${status === "all" ? "" : status}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    [cycleId, q, status],
  );

  const assessment = cycle.status === "Assessment";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="w-48 pl-8" placeholder={t("Cari peserta…", "Search…")} value={q}
            onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label={t("Filter status", "Status filter")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua status", "All statuses")}</SelectItem>
            <SelectItem value="Ongoing">{t("Menunggu penilaian diri", "Awaiting self")}</SelectItem>
            <SelectItem value="SelfDone">{t("Menunggu penilaian atasan", "Awaiting manager")}</SelectItem>
            <SelectItem value="ManagerDone">{t("Selesai dinilai", "Manager done")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!assessment && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
          {t(
            `Fase siklus ${cycle.status} — pengisian & submit hanya sah saat Assessment (§35-7/8). Data terbaca read-only.`,
            `Cycle phase is ${cycle.status} — filling & submit are valid during Assessment only (§35-7/8). Data is read-only.`,
          )}
        </div>
      )}

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat peserta", "Failed to load participants")} description={error} />}
      {loading && <LoadingRows rows={6} />}

      {data && data.rows.length === 0 && (
        <EmptyState icon={ClipboardCheck} title={t("Belum ada peserta", "No participants yet")}
          description={t("Enroll peserta lewat halaman Siklus Penilaian terlebih dahulu.", "Enroll participants via the Appraisal Cycles page first.")} />
      )}

      {data && data.rows.length > 0 && (
        <div className="space-y-2">
          {data.rows.map((r) => {
            const canOpen = LOCKED_STATUS.includes(r.status);
            return (
              <button
                key={r.appraisalId}
                onClick={() => canOpen && onOpen(r.appraisalId)}
                disabled={!canOpen}
                className={cn(
                  "block w-full rounded-xl border bg-white/80 p-3.5 text-left transition dark:bg-slate-900/80",
                  canOpen ? "hover:border-brand/40 hover:shadow-sm" : "opacity-60",
                  r.managerDone ? "border-emerald-200 dark:border-emerald-900/50" : "border-slate-200 dark:border-slate-800",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.fullName}
                      <span className="ml-1.5 font-mono text-[11px] text-slate-400">{r.employeeNo}</span>
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{r.docNo}</span>
                      <span>{t(`${r.kpiCount} KPI · ${r.compCount} komp.`, `${r.kpiCount} KPIs · ${r.compCount} comps.`)}</span>
                      {r.selfDone && <Badge variant="outline" className="h-4 px-1 text-[9px] text-sky-600 dark:text-sky-400">{t("diri", "self")}: {num(r.selfScore)}</Badge>}
                      {r.managerDone && <Badge variant="outline" className="h-4 px-1 text-[9px] text-emerald-600 dark:text-emerald-400">{t("atasan", "mgr")}: {num(r.managerScore)}</Badge>}
                      {!canOpen && <span className="text-amber-600 dark:text-amber-400">{t("target belum dikunci", "goals not locked")}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className={cn("h-full rounded-full", r.progressPct >= 100 ? "bg-emerald-500" : "bg-brand")} style={{ width: `${Math.min(r.progressPct, 100)}%` }} />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-slate-500">{r.progressPct}%</span>
                    <StatusPill status={r.status} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FORM PENILAIAN ATASAN §18-4
// ============================================================================

interface ManagerDraft {
  kpiFinals: Record<string, number | null>;
  compScores: Record<string, number>;
  compComments: Record<string, string>;
  aiAssistedIds: string[];
}

function AppraisalForm({ appraisalId, cycleId, onBack }: { appraisalId: string; cycleId: string; onBack: () => void }) {
  const { t } = useI18n();
  const detail = useApi<AppraisalDetail>(`/api/rekankerja/performance/appraisals?id=${appraisalId}`, [appraisalId]);
  const [pullOpen, setPullOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [aiFor, setAiFor] = useState<DetailComp | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const impactTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // B2-BL (D-BL7a) — advisori bias dari respons autosave (NON-BLOKIR)
  const [biasWarnings, setBiasWarnings] = useState<BiasWarningRow[]>([]);
  // B2-BL (D-BL7b) — dialog antrean moderasi komentar 360 (HR)
  const [moderateOpen, setModerateOpen] = useState(false);

  const d = detail.data;
  const canEdit = !!d && d.cycle.status === "Assessment" && ["GoalApproved", "Ongoing", "SelfDone"].includes(d.appraisal.status);

  const patch = useCallback(async (v: ManagerDraft) => {
    // B2-BL (D-BL7a) — respons autosave membawa biasWarnings ADVISORI
    const out = await apiSend<{ biasWarnings?: BiasWarningRow[] }>(
      "/api/rekankerja/performance/appraisals", "POST",
      {
        action: "saveManagerScore",
        appraisalId,
        kpiFinals: Object.entries(v.kpiFinals).filter(([, x]) => x != null).map(([kpiId, finalActual]) => ({ kpiId, finalActual })),
        compScores: Object.entries(v.compScores).map(([compId, score]) => ({ compId, score })),
        compComments: Object.entries(v.compComments).filter(([, x]) => x !== "").map(([compId, comment]) => ({ compId, comment })),
        aiAssistedIds: v.aiAssistedIds,
      },
    );
    setBiasWarnings(out.biasWarnings ?? []);
  }, [appraisalId]);

  const autosave = useDraftAutosave<ManagerDraft>(`mgr:${appraisalId}`, patch, {
    enabled: canEdit,
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  const draft = autosave.draft;

  // muat server → draf (touch=false — bukan ketikan). Nilai dibulatkan 6
  // desimal utk membersihkan noise float historis (impor exceljs) di tampilan.
  useEffect(() => {
    if (!d) return;
    const kpiFinals: Record<string, number | null> = {};
    for (const k of d.kpis) kpiFinals[k.id] = k.finalActual != null ? Math.round(k.finalActual * 1e6) / 1e6 : null;
    const compScores: Record<string, number> = {};
    const compComments: Record<string, string> = {};
    for (const c of d.comps) {
      compScores[c.id] = c.score;
      compComments[c.id] = c.comment ?? "";
    }
    autosave.setDraft({ kpiFinals, compScores, compComments, aiAssistedIds: [] }, { touch: false });
  }, [d]);

  // live progress (dari draf — ProgressTrackerBar §18.7)
  const live = useMemo(() => {
    if (!d || !draft) return { pct: 0, kpiFilled: 0, kpiTotal: 0, compScored: 0, compTotal: 0 };
    const kpiFilled = d.kpis.filter((k) => draft.kpiFinals[k.id] != null).length;
    const compScored = d.comps.filter((c) => (draft.compScores[c.id] ?? 0) >= 1 && (draft.compScores[c.id] ?? 0) <= 5).length;
    const total = d.kpis.length + d.comps.length;
    return {
      pct: total === 0 ? 0 : Math.round(((kpiFilled + compScored) / total) * 100),
      kpiFilled, kpiTotal: d.kpis.length, compScored, compTotal: d.comps.length,
    };
  }, [d, draft]);

  // PANEL ESTIMASI DAMPAK §18.12 — debounce 1 dtk per perubahan nilai
  useEffect(() => {
    if (!d || !draft || !canEdit) return;
    if (impactTimer.current) clearTimeout(impactTimer.current);
    impactTimer.current = setTimeout(async () => {
      try {
        const res = await apiSend<ImpactData>("/api/rekankerja/performance/appraisals", "POST", {
          action: "previewImpact",
          appraisalId,
          kpiFinals: draft.kpiFinals,
          compScores: draft.compScores,
        });
        setImpact(res);
      } catch {
        setImpact(null); // estimator tidak boleh mengganggu pengisian
      }
    }, 1000);
    return () => { if (impactTimer.current) clearTimeout(impactTimer.current); };
  }, [draft, canEdit]);

  const setKpiFinal = (kpiId: string, raw: string) => {
    if (!draft) return;
    const v = raw === "" ? null : Number(raw);
    autosave.setDraft({
      ...draft,
      kpiFinals: { ...draft.kpiFinals, [kpiId]: v != null && Number.isFinite(v) ? v : null },
    });
  };
  const setCompScore = (compId: string, score: number) => {
    if (!draft) return;
    autosave.setDraft({ ...draft, compScores: { ...draft.compScores, [compId]: score } });
  };
  const setCompComment = (compId: string, comment: string) => {
    if (!draft) return;
    autosave.setDraft({ ...draft, compComments: { ...draft.compComments, [compId]: comment } });
  };

  // tarik satu baris (tombol kecil per KPI §18.6-3)
  const pullRow = async (kpiId: string) => {
    setBusy(true);
    try {
      const res = await apiSend<{ rows: PullRow[] }>("/api/rekankerja/performance/appraisals", "POST", {
        action: "pullAutoSources", appraisalId, apply: true, overwrite: true, kpiIds: [kpiId],
      });
      const row = res.rows[0];
      if (!row) return;
      if (row.needsManual) {
        toast.info(t(`Perlu input manual — ${row.note ?? "tanpa sumber otomatis"}`, `Manual input needed — ${row.note ?? "no auto source"}`));
      } else {
        setKpiFinal(kpiId, String(row.newValue ?? ""));
        toast.success(t(`Ditarik otomatis: ${row.newValue} ${row.unit} (${row.sourceLabel})`, `Auto-pulled: ${row.newValue} ${row.unit} (${row.sourceLabel})`));
      }
      void detail.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  // validasi keras §35-8 (klien → konfirmasi; server menolak dengan pesan §)
  const hardErrors = useMemo(() => {
    if (!d || !draft) return [] as string[];
    const errs: string[] = [];
    const missingKpi = d.kpis.filter((k) => draft.kpiFinals[k.id] == null);
    if (missingKpi.length > 0) errs.push(t(`${missingKpi.length} KPI tanpa final aktual (mis. "${missingKpi[0].title}")`, `${missingKpi.length} KPIs without final actual (e.g. "${missingKpi[0].title}")`));
    const unscored = d.comps.filter((c) => !(draft.compScores[c.id] >= 1 && draft.compScores[c.id] <= 5));
    if (unscored.length > 0) errs.push(t(`${unscored.length} kompetensi belum dinilai (1–5)`, `${unscored.length} competencies unscored (1–5)`));
    const extremeNoComment = d.comps.filter((c) => {
      const s = draft.compScores[c.id] ?? 0;
      return (s >= 1 && s <= 5) && (s <= 2 || s === 5) && !(draft.compComments[c.id] ?? "").trim();
    });
    if (extremeNoComment.length > 0) errs.push(t(`Komentar wajib untuk ${extremeNoComment.length} skor ekstrem (≤2 / =5)`, `Comment required for ${extremeNoComment.length} extreme scores (≤2 / =5)`));
    return errs;
  }, [d, draft, t]);

  const submit = async () => {
    setBusy(true);
    try {
      await autosave.saveNow(); // flush draf sebelum submit (server membaca DB)
      const out = await apiSend<{ docNo: string; managerScore: number }>("/api/rekankerja/performance/appraisals", "POST", {
        action: "submitManager", appraisalId,
      });
      toast.success(t(`Penilaian terkirim — skor atasan ${out.managerScore} (${out.docNo})`, `Appraisal submitted — manager score ${out.managerScore} (${out.docNo})`));
      setConfirmOpen(false);
      onBack();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  if (detail.error) return <EmptyState icon={AlertTriangle} title={t("Gagal memuat", "Failed to load")} description={detail.error} />;
  if (!d) return <LoadingRows rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>← {t("Semua peserta", "All participants")}</Button>
        <span className="font-mono text-xs text-slate-400">{d.appraisal.docNo}</span>
      </div>

      {/* header peserta + jendela */}
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold">{d.appraisal.fullName} <span className="font-mono text-xs text-slate-400">{d.appraisal.employeeNo}</span></p>
            <StatusPill status={d.appraisal.status} />
            {d.appraisal.selfScore != null && (
              <Badge variant="outline" className="text-[10px]">{t(`penilaian diri ${num(d.appraisal.selfScore)}`, `self score ${num(d.appraisal.selfScore)}`)}</Badge>
            )}
            <span className="ml-auto text-xs text-slate-500">{d.appraisal.unit ?? "—"} · {d.appraisal.position ?? "—"}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t(
              `Siklus ${d.cycle.code} · bobot KPI/Komp/Core ${d.weights.kpi}/${d.weights.competency}/${d.weights.core} · jendela atasan ${fmtD(d.cycle.mgrStart)}–${fmtD(d.cycle.mgrEnd)}${d.selfProgress.total > 0 ? ` · penilaian diri ${d.selfProgress.filled}/${d.selfProgress.total}` : ""}`,
              `Cycle ${d.cycle.code} · KPI/Competency/Core weights ${d.weights.kpi}/${d.weights.competency}/${d.weights.core} · manager window ${fmtD(d.cycle.mgrStart)}–${fmtD(d.cycle.mgrEnd)}${d.selfProgress.total > 0 ? ` · self ${d.selfProgress.filled}/${d.selfProgress.total}` : ""}`,
            )}
          </p>
          {!canEdit && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
              {d.appraisal.status === "ManagerDone" || d.appraisal.status === "Calibrating" || d.appraisal.status === "Finalized" || d.appraisal.status === "Published" || d.appraisal.status === "Closed"
                ? t("Penilaian sudah dikirim — read-only (perubahan hasil lewat kalibrasi P4).", "The appraisal has been submitted — read-only (result changes go through P4 calibration).")
                : t(
                  `Fase ${d.cycle.status} / status ${d.appraisal.status} — pengisian hanya sah saat Assessment dengan target terkunci (§35-8).`,
                  `Phase ${d.cycle.status} / status ${d.appraisal.status} — filling is valid during Assessment with locked goals (§35-8).`,
                )}
            </div>
          )}
          {canEdit && d.appraisal.status === "Ongoing" && (
            <p className="mt-2 text-[11px] text-slate-400">
              {t("Karyawan belum submit penilaian diri — Anda tetap dapat menyiapkan draf (§29-4).", "The employee has not submitted their self-assessment — you can still prepare a draft (§29-4).")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* PROGRESS + AUTOSAVE §18.7 */}
      {canEdit && draft && (
        <div className="space-y-2">
          <ProgressTrackerBar pct={live.pct} breakdown={t(`${live.kpiFilled}/${live.kpiTotal} KPI · ${live.compScored}/${live.compTotal} kompetensi`, `${live.kpiFilled}/${live.kpiTotal} KPIs · ${live.compScored}/${live.compTotal} competencies`)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AutosaveIndicator state={autosave as never} />
            <span className="text-[11px] text-slate-400">{t("draf tersimpan otomatis — submit tetap eksplisit", "draft auto-saved — submit is still explicit")}</span>
          </div>
          <DraftRecoveryBanner state={autosave as never} describe={(v) => { const m = v as ManagerDraft | null; return m ? t("draf penilaian tersimpan lokal", "locally saved appraisal draft") : null; }} />
        </div>
      )}

      {/* B2-BL — ADVISORI BIAS (D-BL7a): dari respons autosave; NON-BLOKIR */}
      {biasWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/30" role="status">
          <p className="flex items-start gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {t("Periksa bahasa ulasan Anda — potensi bias terdeteksi", "Review your wording — potential bias detected")}
          </p>
          <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-400/90">
            {t(
              "Draf tetap tersimpan & submit tidak diblokir — peringatan advisori. Pertimbangkan menulis ulang agar berbasis perilaku terukur (D-BL7).",
              "Your draft stays saved and submission is not blocked — this is an advisory. Consider rewording to focus on observable behavior (D-BL7).",
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {biasWarnings.map((w) => (
              <li key={`${w.phrase}-${w.compName ?? ""}`} className="rounded-lg border border-amber-200 bg-white/70 px-2.5 py-1.5 text-[11px] dark:border-amber-900/50 dark:bg-slate-900/60">
                <span className="font-semibold text-amber-800 dark:text-amber-300">“{w.phrase}”</span>
                {w.compName ? <span className="text-slate-500 dark:text-slate-400"> · {w.compName}</span> : null}
                <span className="ml-1 text-slate-500 dark:text-slate-400">({t("kategori", "category")}: {w.category})</span>
                <p className="mt-0.5 text-slate-600 dark:text-slate-300">{w.suggestion}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* ===== KPI ===== */}
          <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("KPI — Final Aktual", "KPIs — Final Actuals")}</h3>
                <span className="text-[11px] text-slate-400">{t("Σbobot harus 100", "weights must total 100")}</span>
                {canEdit && (
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPullOpen(true)} disabled={busy}>
                      <Zap className="h-4 w-4" /> {t("Tarik semua data otomatis", "Pull All Auto Data")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                      <FileSpreadsheet className="h-4 w-4" /> {t("Impor Excel realisasi", "Import Actuals Excel")}
                    </Button>
                  </div>
                )}
              </div>

              {/* desktop: tabel (scroll-x diperbolehkan); mobile: kartu */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="py-1.5 pr-2 font-medium">{t("KPI", "KPI")}</th>
                      <th className="py-1.5 pr-2 font-medium">{t("Target / Ambang / Stretch", "Target / Threshold / Stretch")}</th>
                      <th className="py-1.5 pr-2 font-medium">{t("Bobot", "Weight")}</th>
                      <th className="py-1.5 pr-2 font-medium">{t("Tengah tahun", "Mid-year")}</th>
                      <th className="py-1.5 font-medium">{t("Final aktual", "Final actual")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.kpis.map((k) => (
                      <tr key={k.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                        <td className="py-1.5 pr-2">
                          <p className="font-medium">{k.title}{k.isCritical && <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] text-rose-600 dark:text-rose-400">{t("kritis", "critical")}</Badge>}</p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                            <span>{k.unit} · {k.polarity}</span>
                            {k.measureMode === "Descriptor" && <Badge variant="outline" className="h-4 px-1 text-[9px] text-brand border-brand/40">{t("Deskriptif 1–5", "Descriptor 1–5")}</Badge>}
                            {k.dataSource !== "Manual" && <AutoChip k={k} />}
                          </div>
                          {k.description && (
                            <p className="mt-0.5 line-clamp-1 max-w-md text-[10px] text-slate-500 dark:text-slate-400" title={k.description}>{k.description}</p>
                          )}
                          {(() => {
                            const lvs = parseApprLv(k.metricLevelsJson);
                            if (lvs.length === 0) return null;
                            return (
                              <details className="mt-0.5">
                                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-brand hover:underline">
                                  <Ruler className="h-3 w-3" />{t("Metric / Measure of Success", "Metric / Measure of Success")}
                                </summary>
                                <div className="mt-1 max-w-md space-y-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                                  {lvs.map((l) => (
                                    <p key={l.level} className="flex gap-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-300">
                                      <span className={cn("mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-bold", apprLvTone(l.level))}>{l.level}</span>
                                      <span>{l.descriptor}</span>
                                    </p>
                                  ))}
                                </div>
                              </details>
                            );
                          })()}
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums text-xs">
                          {k.target}{k.thresholdMin != null ? ` / ${k.thresholdMin}` : ""}{k.stretchValue != null ? ` / ${k.stretchValue}` : ""}
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums text-xs">{k.weight}%</td>
                        <td className="py-1.5 pr-2 tabular-nums text-xs text-slate-500">{k.midActual ?? "—"}</td>
                        <td className="py-1.5">
                          <KpiFinalCell k={k} draft={draft} canEdit={canEdit} busy={busy} onChange={setKpiFinal} onPull={pullRow} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 md:hidden">
                {d.kpis.map((k) => (
                  <div key={k.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-start gap-1.5">
                      <p className="min-w-0 flex-1 text-sm font-medium">{k.title}{k.isCritical && <Badge variant="outline" className="ml-1 h-4 px-1 text-[9px] text-rose-600 dark:text-rose-400">{t("kritis", "critical")}</Badge>}</p>
                      {k.dataSource !== "Manual" && <AutoChip k={k} />}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {k.measureMode === "Descriptor"
                        ? t("dinilai level 1–5 sesuai metric", "scored by level 1–5 per the metric")
                        : <>{t("Target", "Target")} {k.target} · {t("ambang", "threshold")} {k.thresholdMin ?? "—"} · {t("bobot", "weight")} {k.weight}% · {t("tengah tahun", "mid")} {k.midActual ?? "—"}</>}
                    </p>
                    {k.description && (
                      <p className="mt-1 line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400" title={k.description}>{k.description}</p>
                    )}
                    {(() => {
                      const lvs = parseApprLv(k.metricLevelsJson);
                      if (lvs.length === 0) return null;
                      return (
                        <details className="mt-1">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-brand hover:underline">
                            <Ruler className="h-3 w-3" />{t("Metric / Measure of Success", "Metric / Measure of Success")}
                          </summary>
                          <div className="mt-1 space-y-1 rounded-lg border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-900/40">
                            {lvs.map((l) => (
                              <p key={l.level} className="flex gap-1.5 text-[10px] leading-snug text-slate-600 dark:text-slate-300">
                                <span className={cn("mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-0.5 text-[9px] font-bold", apprLvTone(l.level))}>{l.level}</span>
                                <span>{l.descriptor}</span>
                              </p>
                            ))}
                          </div>
                        </details>
                      );
                    })()}
                    <div className="mt-2">
                      <KpiFinalCell k={k} draft={draft} canEdit={canEdit} busy={busy} onChange={setKpiFinal} onPull={pullRow} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ===== KOMPETENSI ===== */}
          <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
            <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{t("Kompetensi", "Competencies")}</h3>
                <span className="text-[11px] text-slate-400">{t("radio 1–5 — arahkan kursor ke angka utk deskriptor level", "radio 1–5 — hover a number for the level descriptor")}</span>
                <span className="ml-auto text-[11px] text-slate-400">{t("komentar WAJIB bila skor ≤2 atau =5", "comment REQUIRED for scores ≤2 or =5")}</span>
              </div>
              <div className="space-y-3">
                {d.comps.map((c) => {
                  const score = draft?.compScores[c.id] ?? 0;
                  const comment = draft?.compComments[c.id] ?? "";
                  const extreme = score >= 1 && (score <= 2 || score === 5);
                  const needComment = extreme && !comment.trim();
                  const descriptor = c.levels.find((l) => l.level === score);
                  return (
                    <div key={c.id} className={cn("rounded-lg border p-3", needComment ? "border-rose-300 dark:border-rose-900/60" : "border-slate-200 dark:border-slate-800")}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{c.name}</p>
                        <Badge variant="outline" className="h-4 px-1 text-[9px]">
                          {c.kind === "CoreValue" ? t("nilai inti", "core value") : c.kind === "Managerial" ? t("manajerial", "managerial") : t("teknis", "technical")}
                        </Badge>
                        <span className="text-[10px] text-slate-400">{t(`bobot ${c.weight}%`, `weight ${c.weight}%`)}</span>
                        {c.selfScore != null && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px] text-sky-600 dark:text-sky-400">{t(`diri: ${c.selfScore}`, `self: ${c.selfScore}`)}</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((v) => {
                          const lv = c.levels.find((l) => l.level === v);
                          return (
                            <label
                              key={v}
                              title={lv ? `${lv.label}: ${lv.descriptor}` : undefined}
                              className={cn(
                                "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition",
                                score === v
                                  ? "border-brand bg-brand/10 text-brand"
                                  : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
                              )}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name={`comp-${c.id}`}
                                value={v}
                                disabled={!canEdit}
                                checked={score === v}
                                onChange={() => setCompScore(c.id, v)}
                                aria-label={t(`${c.name} — level ${v}`, `${c.name} — level ${v}`)}
                              />
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
                          <Label className="text-xs">
                            {t("Komentar", "Comment")}
                            {extreme && <span className="ml-1 text-rose-600 dark:text-rose-400">* {t("wajib (skor ekstrem)", "required (extreme score)")}</span>}
                          </Label>
                          {canEdit && (
                            <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setAiFor(c)}>
                              <Sparkles className="h-3.5 w-3.5 text-brand" />{t("Susun dengan AI", "Compose with AI")}
                            </Button>
                          )}
                        </div>
                        <Textarea
                          rows={2}
                          value={comment}
                          disabled={!canEdit}
                          placeholder={t("Perilaku teramati yang mendukung skor ini…", "Observed behaviors supporting this score…")}
                          onChange={(e) => setCompComment(c.id, e.target.value)}
                          aria-label={t(`Komentar ${c.name}`, `${c.name} comment`)}
                          className={needComment ? "border-rose-300 focus-visible:ring-rose-300" : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* ===== 360 ===== */}
          {d.cycle.feedback360 && d.feedback360 && (
            <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{t("Umpan Balik 360", "360 Feedback")}</h3>
                  <span className="text-[11px] text-slate-400">
                    {t(
                      `${d.feedback360.reviewers.submitted} submitted · ${d.feedback360.reviewers.invited} menunggu · ${d.feedback360.reviewers.declined} tolak · ${d.feedback360.reviewers.expired} kedaluwarsa`,
                      `${d.feedback360.reviewers.submitted} submitted · ${d.feedback360.reviewers.invited} pending · ${d.feedback360.reviewers.declined} declined · ${d.feedback360.reviewers.expired} expired`,
                    )}
                  </span>
                  <div className="ml-auto flex flex-wrap justify-end gap-2">
                    {/* B2-BL — antrean moderasi komentar ter-flag (HR; D-BL7b) */}
                    <ModerationQueueButton cycleId={cycleId} onOpen={() => setModerateOpen(true)} />
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                        <UserPlus className="h-4 w-4" /> {t("Undang reviewer", "Invite reviewers")}
                      </Button>
                    )}
                  </div>
                </div>
                {d.feedback360.hidden ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t("Kurang dari 3 reviewer, dirahasiakan — hasil agregat tampil setelah minimal 3 reviewer submit (§37).", "Fewer than 3 reviewers — hidden; aggregated results appear once at least 3 reviewers submit (§37).")}</span>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {d.feedback360.perCompetency.map((p) => (
                      <div key={p.competencyId} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-xs font-medium">{p.name}</p>
                          <Badge variant="outline" className="tabular-nums text-[10px]">{p.avg ?? "—"} / 5</Badge>
                        </div>
                        {p.comments && p.comments.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5 pl-3 text-[11px] text-slate-500 dark:text-slate-400">
                            {p.comments.slice(0, 4).map((c, i) => (
                              <li key={i} className={cn("line-clamp-2", c === REDACTED_360_COMMENT && "italic text-slate-400")}>
                                “{c === REDACTED_360_COMMENT ? t(c, "[redacted by HR — potential bias]") : c}”
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 text-[10px] text-slate-400">{t(`anonim · ${p.count} reviewer`, `anonymous · ${p.count} reviewers`)}</p>
                      </div>
                    ))}
                  </div>
                )}
                <Invitations360 cycleId={cycleId} appraisalId={appraisalId} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* ===== PANEL ESTIMASI DAMPAK §18.12 ===== */}
        <div className="space-y-4">
          <ImpactPanel impact={impact} weights={d.weights} hidden={!canEdit} />
        </div>
      </div>

      {/* submit */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setConfirmOpen(true)} disabled={busy || hardErrors.length > 0}>
            <Send className="h-4 w-4" /> {t("Submit Penilaian", "Submit Appraisal")}
          </Button>
          {hardErrors.length > 0 && (
            <div className="min-w-0 flex-1 space-y-0.5 text-xs text-rose-600 dark:text-rose-400">
              {hardErrors.slice(0, 2).map((e, i) => (<p key={i}>• {e}</p>))}
              {hardErrors.length > 2 && <p>…</p>}
            </div>
          )}
        </div>
      )}

      {pullOpen && <PullDialog appraisalId={appraisalId} onClose={() => setPullOpen(false)} onDone={detail.refresh} />}
      {importOpen && <ImportActualsDialog cycleId={cycleId} onClose={() => setImportOpen(false)} onDone={detail.refresh} />}
      {inviteOpen && <Invite360Dialog appraisalId={appraisalId} onClose={() => setInviteOpen(false)} onDone={detail.refresh} />}
      {moderateOpen && <ModerationDialog cycleId={cycleId} onClose={() => setModerateOpen(false)} onDecided={detail.refresh} />}
      {aiFor && (
        <AiComposeDialog
          title={t(`Ulasan kompetensi — ${aiFor.name}`, `Competency review — ${aiFor.name}`)}
          target={{
            endpoint: "/api/rekankerja/performance/appraisals",
            extra: { scope: "manager", appraisalId, competencyId: aiFor.competencyId },
          }}
          onClose={() => setAiFor(null)}
          onUse={(text) => {
            setCompComment(aiFor.id, text);
            if (draft && !draft.aiAssistedIds.includes(aiFor.id)) {
              autosave.setDraft({ ...draft, compComments: { ...draft.compComments, [aiFor.id]: text }, aiAssistedIds: [...draft.aiAssistedIds, aiFor.id] });
            }
            setAiFor(null);
            toast.info(t("Draf AI dipakai — bebas diedit; kualitas teks tetap tanggung jawab Anda", "AI draft applied — feel free to edit; text quality remains your responsibility"));
          }}
        />
      )}
      {confirmOpen && impact && (
        <Dialog open onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("Konfirmasi Submit Penilaian", "Confirm Appraisal Submission")}</DialogTitle>
              <DialogDescription>
                {t(
                  `Skor sementara ${impact.pScore} (rating ${impact.pRating ?? "—"}). Setelah submit, perubahan hanya lewat kalibrasi P4. Karyawan akan dinotifikasi.`,
                  `Provisional score ${impact.pScore} (rating ${impact.pRating ?? "—"}). After submitting, changes go through P4 calibration only. The employee will be notified.`,
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t("Batal", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Ya, Submit", "Yes, Submit")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============================================================================
// SUB-KOMPONEN
// ============================================================================

/** Chip AUTO + tooltip bukti tarikan (§18.6-3). */
function AutoChip({ k }: { k: DetailKpi }) {
  const { t } = useI18n();
  let tip = t("KPI bersumber otomatis", "Auto-sourced KPI");
  try {
    if (k.autoValueJson) {
      const ev = JSON.parse(k.autoValueJson) as { source?: string; period?: string; value?: number; computedAt?: string };
      tip = t(
        `Sumber: ${ev.source ?? "—"} · periode ${ev.period ?? "—"} · nilai ${ev.value ?? "—"} · ditarik ${ev.computedAt ? ev.computedAt.slice(0, 16).replace("T", " ") : "—"}`,
        `Source: ${ev.source ?? "—"} · period ${ev.period ?? "—"} · value ${ev.value ?? "—"} · pulled ${ev.computedAt ? ev.computedAt.slice(0, 16).replace("T", " ") : "—"}`,
      );
    }
  } catch { /* bukti rusak — tooltip default */ }
  return (
    <Badge className="h-4 bg-brand/10 px-1 text-[9px] text-brand" title={tip}>
      <Zap className="mr-0.5 h-2.5 w-2.5" />AUTO
    </Badge>
  );
}

/** Input final aktual + tombol tarik kecil per baris (§18.6-3). */
function KpiFinalCell({ k, draft, canEdit, busy, onChange, onPull }: {
  k: DetailKpi; draft: ManagerDraft | null; canEdit: boolean; busy: boolean;
  onChange: (kpiId: string, raw: string) => void; onPull: (kpiId: string) => void;
}) {
  const { t } = useI18n();
  const val = draft?.kpiFinals[k.id];
  // KPI-METRIC mode Descriptor — pilih LEVEL 1–5 langsung (tooltip = deskriptor metric)
  if (k.measureMode === "Descriptor") {
    const lvs = parseApprLv(k.metricLevelsJson);
    const picked = val != null ? Math.round(Number(val)) : null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((v) => {
            const lv = lvs.find((l) => l.level === v);
            return (
              <label key={v} title={lv?.descriptor} className={cn(
                "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition",
                picked === v
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400",
              )}>
                <input
                  type="radio"
                  className="sr-only"
                  name={`kpi-final-${k.id}`}
                  value={v}
                  disabled={!canEdit}
                  checked={picked === v}
                  onChange={() => onChange(k.id, String(v))}
                  aria-label={t(`${k.title} — level ${v}`, `${k.title} — level ${v}`)}
                />
                {v}
              </label>
            );
          })}
        </div>
        {picked != null && <span className="text-[10px] text-slate-400">{t("skor", "score")} {picked * 20}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="decimal"
        className="h-8 w-28 tabular-nums"
        value={val != null ? String(val) : ""}
        placeholder={k.midActual != null ? String(k.midActual) : "—"}
        disabled={!canEdit}
        onChange={(e) => onChange(k.id, e.target.value)}
        aria-label={t(`Final aktual ${k.title}`, `Final actual ${k.title}`)}
      />
      {canEdit && k.dataSource !== "Manual" && (
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={busy}
          onClick={() => onPull(k.id)} title={t("Tarik nilai otomatis untuk KPI ini", "Pull the auto value for this KPI")}
          aria-label={t("Tarik otomatis", "Auto pull")}>
          <Zap className="h-3.5 w-3.5 text-brand" />
        </Button>
      )}
    </div>
  );
}

/** Panel estimasi dampak §18.12 — sticky samping kanan desktop / collapsible mobile. */
function ImpactPanel({ impact, weights, hidden }: { impact: ImpactData | null; weights: { kpi: number; competency: number; core: number }; hidden: boolean }) {
  const { t, locale } = useI18n();
  if (hidden) return null;
  const isEn = locale.startsWith("en");
  const body = (
    <>
      {impact ? (
        <>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-bold tabular-nums">{impact.pScore}</p>
            <span className="pb-1 text-xs text-slate-500">{t("skor provisional", "provisional score")}</span>
            {impact.ratingLabel && (
              <span className={cn("ml-auto mb-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", RATING_TONE[impact.ratingColor ?? "amber"] ?? RATING_TONE.amber)}>
                {impact.pRating} · {isEn ? impact.ratingLabel.en : impact.ratingLabel.id}
              </span>
            )}
          </div>
          <div className="mt-2 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-900/60">
            {impact.bonusMonths != null ? (
              <p className="flex items-center gap-1.5">
                <Coins className="h-3.5 w-3.5 text-brand" />
                {t(`bonus ± ${impact.bonusMonths} bulan`, `bonus ~ ${impact.bonusMonths} months`)}
              </p>
            ) : (
              <p className="text-slate-400">{t("matriks merit aktif tidak tersedia", "no active merit matrix")}</p>
            )}
            {impact.raisePct && (
              <p className="mt-0.5 pl-5 text-slate-600 dark:text-slate-300">
                {t(`kenaikan gaji ${impact.raisePct[0]}–${impact.raisePct[1]}%`, `salary raise ${impact.raisePct[0]}–${impact.raisePct[1]}%`)}
              </p>
            )}
          </div>
          <div className="mt-2 space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            <p>{t("Breakdown komponen:", "Component breakdown:")}</p>
            <p className="pl-3">{t(`KPI ${impact.components.kpi ?? "—"} × ${weights.kpi}%`, `KPI ${impact.components.kpi ?? "—"} × ${weights.kpi}%`)}</p>
            {impact.components.competency != null && <p className="pl-3">{t(`Kompetensi ${impact.components.competency} × ${weights.competency}%`, `Competency ${impact.components.competency} × ${weights.competency}%`)}</p>}
            {impact.components.core != null && <p className="pl-3">{t(`Nilai inti ${impact.components.core} × ${weights.core}%`, `Core values ${impact.components.core} × ${weights.core}%`)}</p>}
          </div>
          {impact.incomplete && (
            <p className="mt-2 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {t(`Belum lengkap: ${impact.kpiFilled}/${impact.kpiTotal} KPI · ${impact.compScored}/${impact.compTotal} kompetensi — nilai masih bisa berubah`, `Incomplete: ${impact.kpiFilled}/${impact.kpiTotal} KPIs · ${impact.compScored}/${impact.compTotal} competencies — values may still change`)}
            </p>
          )}
          {impact.criticalFailed.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 text-[11px] font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-400">
              <p><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />{t("KPI kritis gagal — rating maksimal 2 (§4.5)", "Critical KPI failed — rating capped at 2 (§4.5)")}</p>
              <ul className="mt-0.5 list-disc pl-5">{impact.criticalFailed.map((x, i) => (<li key={i}>{x}</li>))}</ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-400">{t("Menghitung estimasi…", "Computing estimate…")}</p>
      )}
      <p className="mt-3 border-t border-slate-200 pt-2 text-[10px] leading-snug text-slate-400 dark:border-slate-800">
        {t(
          "ESTIMASI berdasar nilai sementara & matriks merit aktif — BUKAN keputusan; tunduk pada kalibrasi, approval, dan kebijakan final HR (§18.12).",
          "ESTIMATE based on draft values & the active merit matrix — NOT a decision; subject to calibration, approval, and final HR policy (§18.12).",
        )}
      </p>
    </>
  );
  return (
    <>
      {/* desktop: sticky kanan */}
      <Card className="hidden border-brand/30 bg-white/90 lg:sticky lg:top-20 lg:block dark:border-brand/30 dark:bg-slate-900/90">
        <CardContent className="p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Coins className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold">{t("Estimasi dampak (draf)", "Impact estimate (draft)")}</h3>
          </div>
          {body}
        </CardContent>
      </Card>
      {/* mobile: kartu collapsible paling bawah */}
      <details className="rounded-xl border border-brand/30 bg-white/90 lg:hidden dark:bg-slate-900/90">
        <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-semibold">
          <Coins className="h-4 w-4 text-brand" />{t("Estimasi dampak (draf)", "Impact estimate (draft)")}
          <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />
        </summary>
        <div className="px-4 pb-4">{body}</div>
      </details>
    </>
  );
}

/** Dialog pratinjau tarikan otomatis §18.6-2 — centang per baris + terapkan. */
function PullDialog({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<{ rows: PullRow[] } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<{ applied: number; skippedManual: number } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiSend<{ rows: PullRow[] }>("/api/rekankerja/performance/appraisals", "POST", { action: "pullAutoSources", appraisalId });
        if (!alive) return;
        setData(res);
        const c: Record<string, boolean> = {};
        for (const r of res.rows) c[r.kpiId] = !r.needsManual;
        setChecked(c);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "unknown");
        onClose();
      }
    })();
    return () => { alive = false; };
  }, [appraisalId]);

  const apply = async () => {
    setBusy(true);
    try {
      const kpiIds = (data?.rows ?? []).filter((r) => !r.needsManual && checked[r.kpiId]).map((r) => r.kpiId);
      const out = await apiSend<{ applied: number; skippedManual: number }>("/api/rekankerja/performance/appraisals", "POST", {
        action: "pullAutoSources", appraisalId, apply: true, overwrite: true, kpiIds,
      });
      setApplied(out);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle><Zap className="mr-1 inline h-4 w-4 text-brand" />{t("Tarik Data Otomatis", "Pull Auto Data")}</DialogTitle>
          <DialogDescription>
            {t(
              "Pratinjau nilai baru vs nilai terisi — centang baris untuk diterapkan. Baris ber-input manual ditandai (menimpa = keputusan Anda); KPI tanpa sumber ditandai perlu input manual (§18.6).",
              "Preview new vs current values — tick rows to apply. Rows with manual input are flagged (overwriting is your call); KPIs without a source are flagged as manual-input needed (§18.6).",
            )}
          </DialogDescription>
        </DialogHeader>
        {!data && <LoadingRows rows={4} />}
        {data && !applied && (
          <>
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                  <tr className="text-left text-slate-500">
                    <th className="p-1.5"></th>
                    <th className="p-1.5">KPI</th>
                    <th className="p-1.5">{t("Sekarang", "Current")}</th>
                    <th className="p-1.5">{t("Baru", "New")}</th>
                    <th className="p-1.5">{t("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.kpiId} className={cn("border-t border-slate-100 dark:border-slate-800/60", r.needsManual && "bg-rose-50/40 dark:bg-rose-950/10")}>
                      <td className="p-1.5">
                        <Checkbox checked={checked[r.kpiId] ?? false} disabled={r.needsManual}
                          onCheckedChange={(v) => setChecked({ ...checked, [r.kpiId]: v === true })}
                          aria-label={t(`Terapkan ${r.title}`, `Apply ${r.title}`)} />
                      </td>
                      <td className="p-1.5">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-[10px] text-slate-400">{r.sourceKey ?? "—"}</p>
                      </td>
                      <td className="p-1.5 tabular-nums">{r.currentFinal ?? "—"}</td>
                      <td className="p-1.5 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{r.needsManual ? "—" : r.newValue}</td>
                      <td className="p-1.5">
                        {r.needsManual
                          ? <span className="text-rose-600 dark:text-rose-400">{t("perlu input manual", "manual input needed")} — {r.note}</span>
                          : r.isOverwrite
                            ? <span className="text-amber-600 dark:text-amber-400">{t("akan menimpa input manual", "will overwrite manual input")}</span>
                            : <span className="text-slate-500">{r.sourceLabel}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={apply} disabled={busy || data.rows.every((r) => r.needsManual || !checked[r.kpiId])}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t(`Terapkan ${data.rows.filter((r) => !r.needsManual && checked[r.kpiId]).length} baris`, `Apply ${data.rows.filter((r) => !r.needsManual && checked[r.kpiId]).length} rows`)}
              </Button>
            </DialogFooter>
          </>
        )}
        {applied && (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              {t(`${applied.applied} KPI terisi otomatis (bukti tersimpan)${applied.skippedManual ? ` · ${applied.skippedManual} input manual dilewati` : ""}`, `${applied.applied} KPIs auto-filled (evidence saved)${applied.skippedManual ? ` · ${applied.skippedManual} manual inputs skipped` : ""}`)}
            </p>
            <DialogFooter>
              <Button onClick={onClose}>{t("Selesai", "Done")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Dialog impor realisasi Excel 3 langkah (tiru P1 §18.5). */
function ImportActualsDialog({ cycleId, onClose, onDone }: { cycleId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ rows: ImportRow[]; counts: { valid: number; error: number }; cycleCode: string } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [report, setReport] = useState<{ updated: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("action", "importActualsPreview");
      form.append("cycleId", cycleId);
      form.append("file", file);
      const res = await apiUpload<{ rows: ImportRow[]; counts: { valid: number; error: number }; cycleCode: string }>(
        "/api/rekankerja/performance/appraisals", form,
      );
      setPreview(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const rows = preview.rows.filter((r) => r.valid);
      const out = await apiSend<{ updated: number; skipped: number }>(
        "/api/rekankerja/performance/appraisals", "POST",
        { action: "importActualsCommit", cycleId, rows },
      );
      setReport(out);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setCommitting(false);
    }
  };

  const downloadErrors = () => {
    if (!preview) return;
    const errs = preview.rows.filter((r) => !r.valid);
    const csv = [
      "row,employeeNo,kpi,field,error",
      ...errs.flatMap((r) => r.errors.map((e) => `${r.rowNo},"${r.employeeNo}","${(r.kpi ?? "").replace(/"/g, "'")}",${e.field},"${e.message.replace(/"/g, "'")}"`)),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `impor-realisasi-error-${preview.cycleCode}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("Impor Excel Realisasi", "Excel Import — Actuals")}</DialogTitle>
          <DialogDescription>
            {t(
              "Mengisi Final Aktual TANPA mengubah status — submitManager tetap tindakan terpisah. Baris kotor ditolak per sel, tidak membatalkan baris lain (D16 §18.5).",
              "Fills Final Actuals WITHOUT changing status — manager submit remains separate. Dirty rows are rejected per-cell without affecting other rows (D16 §18.5).",
            )}
          </DialogDescription>
        </DialogHeader>

        {!preview && !report && (
          <div className="space-y-3">
            <a
              href={`/api/rekankerja/performance/appraisals?importTemplate=actuals&cycleId=${cycleId}`}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-brand/50 dark:border-slate-800"
            >
              <Download className="h-5 w-5 shrink-0 text-brand" />
              <div>
                <p className="text-sm font-semibold">{t("1 · Unduh Template (.xlsx)", "1 · Download Template (.xlsx)")}</p>
                <p className="text-xs text-slate-500">{t("Peserta terkunci tercetak sebagai panduan — isi kolom Final Aktual saja", "Locked participants are pre-printed as a guide — fill the Final Actual column only")}</p>
              </div>
            </a>
            <div
              role="button"
              tabIndex={0}
              aria-label={t("Unggah berkas", "Upload file")}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition",
                dragOver ? "border-brand bg-brand/5" : "border-slate-300 hover:border-slate-400 dark:border-slate-700",
              )}
            >
              {busy ? <Loader2 className="h-6 w-6 animate-spin text-brand" /> : <Upload className="h-6 w-6 text-slate-400" />}
              <p className="text-sm font-medium">{t("2 · Unggah berkas terisi", "2 · Upload the filled file")}</p>
              <p className="text-xs text-slate-500">{t(".xlsx ≤ 2 MB · ≤ 500 baris", ".xlsx ≤ 2 MB · ≤ 500 rows")}</p>
              <input
                ref={fileRef} type="file" accept=".xlsx" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}
              />
            </div>
          </div>
        )}

        {preview && !report && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t(`${preview.counts.valid} valid`, `${preview.counts.valid} valid`)}</Badge>
              <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">{t(`${preview.counts.error} error`, `${preview.counts.error} errors`)}</Badge>
              {preview.counts.error > 0 && (
                <button onClick={downloadErrors} className="ml-auto inline-flex items-center gap-1 text-brand hover:underline">
                  <FileWarning className="h-3.5 w-3.5" />{t("Unduh laporan error (CSV)", "Download error report (CSV)")}
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                  <tr className="text-left text-slate-500">
                    <th className="p-1.5">#</th>
                    <th className="p-1.5">{t("Karyawan", "Employee")}</th>
                    <th className="p-1.5">KPI</th>
                    <th className="p-1.5">{t("Final aktual", "Final actual")}</th>
                    <th className="p-1.5">{t("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNo} className={cn("border-t border-slate-100 dark:border-slate-800/60", !r.valid && "bg-rose-50/60 dark:bg-rose-950/10")}>
                      <td className="p-1.5 tabular-nums text-slate-400">{r.rowNo}</td>
                      <td className="p-1.5"><span className="font-mono">{r.employeeNo}</span> {r.fullName}</td>
                      <td className="p-1.5">{r.kpi}</td>
                      <td className="p-1.5 tabular-nums">{r.finalActual}</td>
                      <td className="p-1.5">
                        {!r.valid
                          ? r.errors.map((e, i) => (<span key={i} className="block text-rose-600 dark:text-rose-400">{e.field}: {e.message}</span>))
                          : <span className="text-emerald-600 dark:text-emerald-400">✓ {t("valid", "valid")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>{t("Unggah ulang", "Re-upload")}</Button>
              <Button onClick={commit} disabled={committing || preview.counts.valid === 0}>
                {committing && <Loader2 className="h-4 w-4 animate-spin" />}
                {t(`Commit ${preview.counts.valid} baris valid`, `Commit ${preview.counts.valid} valid rows`)}
              </Button>
            </DialogFooter>
          </>
        )}

        {report && (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              {t(`${report.updated} final aktual terisi · ${report.skipped} lompat`, `${report.updated} final actuals filled · ${report.skipped} skipped`)}
            </p>
            <p className="text-xs text-slate-500">
              {t("Impor ≠ submit — penilaian tetap menunggu review + submit atasan (§18.5).", "Import ≠ submit — the appraisal still awaits manager review + submit (§18.5).")}
            </p>
            <DialogFooter>
              <Button onClick={onClose}>{t("Selesai", "Done")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Daftar undangan 360 peserta ini (+ remind in-app). */
function Invitations360({ cycleId, appraisalId }: { cycleId: string; appraisalId: string }) {
  const { t } = useI18n();
  const { data } = useApi<{ rows: Invite360Row[] }>(`/api/rekankerja/performance/feedback360?cycleId=${cycleId}`, [cycleId]);
  const rows = (data?.rows ?? []).filter((r) => r.appraisalId === appraisalId);
  if (rows.length === 0) return null;
  const remind = async (id: string) => {
    try {
      await apiSend("/api/rekankerja/performance/feedback360", "POST", { action: "remind", id });
      toast.success(t("Pengingat in-app terkirim ke reviewer", "In-app reminder sent to the reviewer"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };
  return (
    <details className="mt-3 rounded-lg border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs font-medium">
        <Users className="h-3.5 w-3.5 text-slate-400" />{t(`Undangan reviewer (${rows.length})`, `Reviewer invitations (${rows.length})`)}
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-400" />
      </summary>
      <div className="space-y-1.5 px-3 pb-3">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs dark:border-slate-800/60">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{r.reviewerName}</span>
              <span className="ml-1.5 text-slate-400">{r.reviewerType}{r.dueAt ? ` · ${t("tenggat", "due")} ${fmtD(r.dueAt)}` : ""}</span>
            </span>
            <StatusPill status={r.status} />
            {r.status === "Invited" && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => remind(r.id)}>
                {t("Ingatkan", "Remind")}
              </Button>
            )}
          </div>
        ))}
        <p className="text-[10px] text-slate-400">
          <Info className="mr-1 inline h-3 w-3" />
          {t("Identitas reviewer dirahasiakan — agregat tampil hanya bila ≥3 reviewer submit (§37).", "Reviewer identities are hidden — aggregates appear only once ≥3 reviewers submit (§37).")}
        </p>
      </div>
    </details>
  );
}

/** Dialog undang reviewer 360 (§29-3). */
function Invite360Dialog({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [picked, setPicked] = useState<{ employeeId: string; employeeNo: string; fullName: string; reviewerType: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{
    invited: { employeeNo: string; fullName: string; reviewerType: string }[];
    skippedDuplicate: { employeeNo: string; fullName: string; reviewerType: string }[];
    skippedSelf: { employeeNo: string; fullName: string }[];
    skippedInactive: { employeeNo: string; fullName: string }[];
  } | null>(null);

  const results = useApi<{ employees: { id: string; employeeNo: string; fullName: string }[] }>(
    q.length >= 2 ? `/api/rekankerja/employees?q=${encodeURIComponent(q)}&limit=8&status=Active` : null,
    [q],
  );

  const add = (e: { id: string; employeeNo: string; fullName: string }, reviewerType: string) => {
    if (picked.some((p) => p.employeeId === e.id && p.reviewerType === reviewerType)) return;
    setPicked([...picked, { employeeId: e.id, employeeNo: e.employeeNo, fullName: e.fullName, reviewerType }]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ report: NonNullable<typeof report> }>("/api/rekankerja/performance/feedback360", "POST", {
        action: "invite", appraisalId,
        reviewers: picked.map((p) => ({ employeeId: p.employeeId, reviewerType: p.reviewerType })),
        dueAt: dueAt || undefined,
      });
      setReport(res.report);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setReport(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Undang Reviewer 360", "Invite 360 Reviewers")}</DialogTitle>
          <DialogDescription>
            {t(
              "Cari karyawan aktif, pilih tipe reviewer (Peer/Subordinate/CrossTeam/Upward). Reviewer tidak boleh karyawan yang dinilai; identitasnya dirahasiakan (§37).",
              "Search active employees, pick the reviewer type (Peer/Subordinate/CrossTeam/Upward). A reviewer cannot be the appraised employee; identities stay anonymous (§37).",
            )}
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <>
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-8" placeholder={t("Cari karyawan (nama / kode)…", "Search employee (name / no.)…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari karyawan", "Search employees")} />
              </div>
              {q.length >= 2 && (results.data?.employees ?? []).length > 0 && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5 dark:border-slate-800">
                  {results.data?.employees.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <span className="min-w-0 flex-1 truncate"><span className="font-mono text-[10px] text-slate-400">{e.employeeNo}</span> {e.fullName}</span>
                      <Select value="" onValueChange={(v) => { if (v) add(e, v); }}>
                        <SelectTrigger className="h-7 w-36 text-xs" aria-label={t(`Tambah ${e.fullName} sebagai reviewer`, `Add ${e.fullName} as reviewer`)}>
                          <SelectValue placeholder={t("+ undang sebagai…", "+ invite as…")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Peer">{t("Peer (setara)", "Peer")}</SelectItem>
                          <SelectItem value="Subordinate">{t("Subordinate (bawahan)", "Subordinate")}</SelectItem>
                          <SelectItem value="CrossTeam">{t("CrossTeam (lintas tim)", "CrossTeam")}</SelectItem>
                          <SelectItem value="Upward">{t("Upward", "Upward")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              {picked.length > 0 && (
                <div className="space-y-1">
                  {picked.map((p, i) => (
                    <div key={`${p.employeeId}-${p.reviewerType}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-800">
                      <span className="min-w-0 flex-1 truncate"><span className="font-mono text-[10px] text-slate-400">{p.employeeNo}</span> {p.fullName} · {p.reviewerType}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2" aria-label={t("Hapus", "Remove")} onClick={() => setPicked(picked.filter((_, j) => j !== i))}>×</Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">{t("Tenggat pengisian (opsional)", "Due date (optional)")}</Label>
                <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label={t("Tenggat", "Due date")} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy || picked.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Undang", "Invite")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              {t(`${report.invited.length} undangan terkirim`, `${report.invited.length} invitations sent`)}
            </p>
            <div className="max-h-40 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
              {report.invited.map((x, i) => (<p key={i}><span className="font-mono">{x.employeeNo}</span> {x.fullName} — {x.reviewerType}</p>))}
            </div>
            {report.skippedSelf.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400">{t(`${report.skippedSelf.length} dilewati: karyawan peserta sendiri`, `${report.skippedSelf.length} skipped: the appraised employee`)}</p>}
            {report.skippedDuplicate.length > 0 && <p className="text-xs text-slate-500">{t(`${report.skippedDuplicate.length} duplikat dilompati`, `${report.skippedDuplicate.length} duplicates skipped`)}</p>}
            <DialogFooter>
              <Button onClick={onClose}>{t("Selesai", "Done")}</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// B2-BL — MODERASI KOMENTAR 360 (D-BL7b): tombol badge Pending + dialog antrean
// HR (Setujui / Redaksi / Pindai AI advisori). ANONIMITAS: kartu TIDAK
// memuat identitas reviewer — hanya kompetensi, docNo peserta, teks & flag.
// ============================================================================

/** Tombol "Moderasi (N)" — hanya render utk HR (superadmin); badge jumlah Pending. */
function ModerationQueueButton({ cycleId, onOpen }: { cycleId: string; onOpen: () => void }) {
  const { t } = useI18n();
  const perms = useMenuPerms();
  // non-HR (bukan superadmin & config siap) → sembunyikan (API tetap 403-guard)
  const mayModerate = !perms.ready || perms.all || perms.isSuperAdmin;
  const { data } = useApi<{ rows: FlaggedAnswerCard[] }>(
    mayModerate ? `/api/rekankerja/performance/feedback360?flagged=1&cycleId=${cycleId}` : null,
    [cycleId, mayModerate],
  );
  if (!mayModerate) return null;
  const n = (data?.rows ?? []).length;
  return (
    <Button size="sm" variant="outline" className={cn(n > 0 && "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300")} onClick={onOpen}>
      <ShieldCheck className="h-4 w-4" />
      {n > 0
        ? t(`Moderasi (${n})`, `Moderation (${n})`)
        : t("Moderasi", "Moderation")}
    </Button>
  );
}

/** Dialog antrean moderasi komentar ter-flag (HR — D-BL7b/D-BL8). */
function ModerationDialog({ cycleId, onClose, onDecided }: { cycleId: string; onClose: () => void; onDecided: () => void }) {
  const { t, locale } = useI18n();
  const { data, loading, refresh } = useApi<{ rows: FlaggedAnswerCard[] }>(
    `/api/rekankerja/performance/feedback360?flagged=1&cycleId=${cycleId}`,
    [cycleId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  // hasil deep-scan AI per kartu — advisori ephemeral (tidak disimpan)
  const [scanFor, setScanFor] = useState<string | null>(null);
  const [scans, setScans] = useState<Record<string, string>>({});

  const decide = async (answerId: string, decision: "Approved" | "Redacted") => {
    setBusy(answerId);
    try {
      await apiSend("/api/rekankerja/performance/feedback360", "POST", { action: "moderate", answerId, decision });
      toast.success(decision === "Approved"
        ? t("Komentar disetujui — tampil normal ter-agregat", "Comment approved — appears normally in aggregates")
        : t("Komentar ter-redaksi — tampil string sensor", "Comment redacted — shows a censored placeholder"));
      refresh();
      onDecided();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(null);
    }
  };

  const runScan = async (answerId: string) => {
    setScanFor(answerId);
    try {
      const out = await apiSend<{ scan: string | null; unavailable?: boolean; error?: string }>(
        "/api/rekankerja/performance/feedback360", "POST",
        { action: "aiScan", answerId, lang: locale.startsWith("en") ? "en" : "id" },
      );
      setScans((s) => ({ ...s, [answerId]: out.scan ?? (out.error ?? t("AI tidak tersedia — coba lagi nanti", "AI unavailable — try again later")) }));
    } catch (e) {
      setScans((s) => ({ ...s, [answerId]: e instanceof Error ? e.message : "unknown" }));
    } finally {
      setScanFor(null);
    }
  };

  const rows = data?.rows ?? [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand" />{t("Moderasi Komentar 360", "360 Comment Moderation")}
            {rows.length > 0 && <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400">{rows.length} {t("menunggu", "pending")}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Komentar ter-flag lexicon bias menunggu keputusan HR: Setujui → tampil normal ter-agregat; Redaksi → tampil string sensor (isi tidak dibocorkan). Identitas reviewer TIDAK PERNAH tampil (D-BL7b).",
              "Comments flagged by the bias lexicon await HR decisions: Approve → appear normally in aggregates; Redact → show a censored placeholder (content is not revealed). Reviewer identities NEVER appear (D-BL7b).",
            )}
          </DialogDescription>
        </DialogHeader>

        {loading && <LoadingRows rows={2} />}
        {!loading && rows.length === 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400">
            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
            {t("Tidak ada komentar menunggu moderasi — antrean bersih.", "No comments awaiting moderation — the queue is clear.")}
          </div>
        )}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">{r.appraisalDocNo}</span>
                <span>· {r.competencyName}</span>
                {r.submittedAt ? <span>· {t("submit", "submitted")} {fmtD(r.submittedAt)}</span> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {r.flagged.map((f) => (
                  <Badge key={f.phrase} variant="outline" className="h-5 border-amber-300 px-1.5 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                    {f.category}: “{f.phrase}”
                  </Badge>
                ))}
              </div>
              <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">“{r.comment ?? "—"}”</p>
              {scans[r.id] && (
                <div className="mt-1.5 rounded-lg border border-brand/30 bg-brand/5 p-2 text-[11px] text-slate-700 dark:text-slate-200">
                  <p className="font-semibold text-brand"><Sparkles className="mr-1 inline h-3 w-3" />{t("Pindai AI (advisori)", "AI scan (advisory)")}</p>
                  <p className="whitespace-pre-wrap">{scans[r.id]}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{t("saran AI — keputusan akhir tetap milik HR (D-BL8)", "AI suggestion — the final decision remains HR's (D-BL8)")}</p>
                </div>
              )}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" className="h-7" disabled={scanFor === r.id} onClick={() => runScan(r.id)}>
                  {scanFor === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-brand" />}
                  {t("Pindai AI", "Scan with AI")}
                </Button>
                <Button size="sm" variant="outline" className="h-7" disabled={busy === r.id} onClick={() => decide(r.id, "Redacted")}>
                  <EyeOff className="h-3.5 w-3.5" />{t("Redaksi", "Redact")}
                </Button>
                <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700" disabled={busy === r.id} onClick={() => decide(r.id, "Approved")}>
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{t("Setujui", "Approve")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
