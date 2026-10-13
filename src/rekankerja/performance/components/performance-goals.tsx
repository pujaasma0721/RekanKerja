"use client";
// ============================================================================
// PERFORMANCE — Target & KPI: KPI BUILDER (P1 — §18.1 AM1 "mudah mengisi KPI
// sebagai fitur kelas satu" + §18.2 salin periode sebelumnya + §18.5 impor
// Excel target AM2 + §18.7 autosave/progress + submit §35-3).
//
// Alur atasan/HR: pilih siklus → daftar peserta (progres %) → builder satu
// peserta: 4 titik awal (salin periode lalu §18.2-a disarankan · template
// jabatan · pustaka KPI · kosong) → baris draf diedit inline dengan meter
// Σbobot live + validasi ramah per baris + autosave (debounce 3s + mirror
// localStorage + pemulihan draf) → SUBMIT eksplisit (salin/impor ≠ submit).
// Bulk: salin tim §18.2-c + impor Excel §18.5 (unduh → unggah → pratinjau
// per sel → commit hanya baris valid) + keputusan usulan MBO §26-4.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useDraftAutosave, AutosaveIndicator, DraftRecoveryBanner, WeightMeter, ProgressTrackerBar, distributeEvenly,
} from "@/rekankerja/performance/components/perf-form-kit";
import {
  ListChecks, ChevronLeft, Search, Copy, Upload, Download, FileSpreadsheet, Zap, CheckCircle2,
  AlertTriangle, Loader2, Trash2, Scale as ScaleIcon, ChevronDown, Sparkles, Send, Undo2, BookOpen,
  LayoutTemplate, ArrowRightLeft, FileWarning,
} from "lucide-react";

// ---------- tipe (kontrak API §17) ----------

interface CycleRow {
  id: string; code: string; name: string; status: string;
  periodStart: string; periodEnd: string; goalStart: string | null; goalEnd: string | null;
  participantCount: number; goalApprovedCount: number;
}

interface ParticipantRow {
  appraisalId: string; docNo: string; status: string;
  employeeNo: string; fullName: string;
  kpiCount: number; progressPct: number;
  hasProposal: boolean; goalsCopiedFrom: string | null; locked: boolean;
  lastSavedAt: string | null;
}

interface KpiRow {
  id: string; kpiDefId: string | null; title: string; polarity: string; unit: string;
  thresholdMin: number | null; target: number; stretchValue: number | null;
  weight: number; isCritical: boolean; dataSource: string;
  origin: string; proposedBy: string; copiedFromId: string | null;
}

interface GoalDetail {
  appraisal: {
    id: string; docNo: string; status: string; goalsCopiedFrom: string | null;
    employeeNo: string; fullName: string; unit: string | null; position: string | null;
    managerName: string | null;
  };
  cycle: { id: string; code: string; name: string; status: string; goalEnd: string | null };
  kpis: KpiRow[];
  progress: { pct: number; filledRows: number; totalRows: number; sumWeight: number };
  draftErrors: string[];
  locked: boolean;
}

interface CopySource { appraisalId: string; cycleId: string; code: string; name: string; kpiCount: number; status: string; suggested: boolean }
interface CopyPreviewRow {
  sourceKpiId: string; title: string; polarity: string; unit: string;
  thresholdMin: number | null; oldTarget: number; target: number; stretchValue: number | null;
  weight: number; isCritical: boolean; kpiDefId: string | null; defCode: string | null;
  auto: boolean; defInactive: boolean; unitChanged: boolean; duplicate: boolean;
}
interface CopyPreviewData {
  source: { appraisalId: string; cycleCode: string; docNo: string; periodEnd: string };
  placementChanged: boolean; placementNote: string | null; hasExistingRows: boolean;
  rows: CopyPreviewRow[]; reminder: string;
}
interface ImportRow {
  rowNo: number; employeeNo: string; fullName: string; kpi: string; polarity: string;
  unit: string; threshold: string; target: string; stretch: string; weight: string; critical: string;
  valid: boolean; errors: { field: string; message: string }[]; kpiDefId?: string | null; skip?: string | null;
}

const fmtD = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "—");
const num = (v: string | number | null | undefined, fb = 0): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fb;
};

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceGoalsPage() {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [pickedCycleId, setPickedCycleId] = useState<string>("");
  const [appraisalId, setAppraisalId] = useState<string | null>(null);

  const activeCycles = (cycles.data?.rows ?? []);
  // default turunan (tanpa effect): siklus fase penetapan bila ada, selain itu terbaru
  const cycleId = pickedCycleId || activeCycles.find((c) => c.status === "GoalSetting")?.id || activeCycles[0]?.id || "";
  const setCycleId = setPickedCycleId;

  const cycle = activeCycles.find((c) => c.id === cycleId);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Performance · P1"
        title={t("Target & KPI", "Goals & KPIs")}
        description={t(
          "KPI Builder: salin dari periode sebelumnya, susun dari pustaka/template, impor Excel massal — hasil selalu draf hingga atasan submit.",
          "KPI Builder: copy from the previous period, build from the library/template, bulk-import Excel — results stay drafts until the manager submits.",
        )}
        actions={(
          <Select value={cycleId} onValueChange={(v) => { setCycleId(v); setAppraisalId(null); }}>
            <SelectTrigger className="w-56" aria-label={t("Pilih siklus", "Select cycle")}>
              <SelectValue placeholder={t("Pilih siklus…", "Select cycle…")} />
            </SelectTrigger>
            <SelectContent>
              {activeCycles.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code} — {c.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      {appraisalId && cycle
        ? <GoalBuilder appraisalId={appraisalId} onBack={() => setAppraisalId(null)} onChanged={cycles.refresh} />
        : cycle && (
          <ParticipantList
            cycleId={cycleId} cycle={cycle}
            onOpen={(id) => setAppraisalId(id)}
          />
        )}
    </div>
  );
}

// ============================================================================
// DAFTAR PESERTA + bulk (salin tim §18.2-c + impor §18.5)
// ============================================================================

function ParticipantList({ cycleId, cycle, onOpen }: { cycleId: string; cycle: CycleRow; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data, loading, error, refresh } = useApi<{ rows: ParticipantRow[] }>(
    `/api/rekankerja/performance/goals?cycleId=${cycleId}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    [cycleId, q],
  );
  const [copyTeamOpen, setCopyTeamOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const canWork = cycle.status === "GoalSetting";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="w-48 pl-8" placeholder={t("Cari peserta…", "Search…")} value={q}
            onChange={(e) => setQ(e.target.value)} aria-label={t("Cari peserta", "Search participants")} />
        </div>
        {canWork && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setCopyTeamOpen(true)}>
              <ArrowRightLeft className="h-4 w-4" /> {t("Salin Tim dari Periode Lalu", "Copy Team From Previous")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" /> {t("Impor Excel", "Excel Import")}
            </Button>
          </div>
        )}
      </div>

      {!canWork && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
          {t(
            `Fase penetapan target tidak aktif (siklus ${cycle.status}) — salin/impor/ubah/submit dikunci (§35-3/24). Jendela: ${fmtD(cycle.goalStart)}–${fmtD(cycle.goalEnd)}.`,
            `Goal-setting phase inactive (cycle ${cycle.status}) — copy/import/edit/submit locked (§35-3/24). Window: ${fmtD(cycle.goalStart)}–${fmtD(cycle.goalEnd)}.`,
          )}
        </div>
      )}

      {error && <EmptyState icon={AlertTriangle} title={t("Gagal memuat peserta", "Failed to load participants")} description={error} />}
      {loading && <LoadingRows rows={6} />}

      {data && data.rows.length === 0 && (
        <EmptyState
          icon={ListChecks}
          title={t("Belum ada peserta di siklus ini", "No participants in this cycle")}
          description={t("Enroll peserta lewat halaman Siklus Penilaian terlebih dahulu.", "Enroll participants via the Appraisal Cycles page first.")}
        />
      )}

      {data && data.rows.length > 0 && (
        <div className="space-y-2">
          {data.rows.map((r) => (
            <button
              key={r.appraisalId}
              onClick={() => onOpen(r.appraisalId)}
              className={cn(
                "block w-full rounded-xl border bg-white/80 p-3.5 text-left transition hover:border-brand/40 hover:shadow-sm dark:bg-slate-900/80",
                r.locked ? "border-emerald-200 dark:border-emerald-900/50" : "border-slate-200 dark:border-slate-800",
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
                    <span>{t(`${r.kpiCount} KPI`, `${r.kpiCount} KPIs`)}</span>
                    {r.goalsCopiedFrom && (
                      <span className="inline-flex items-center gap-0.5 text-brand"><Copy className="h-3 w-3" />{t(`disalin dari ${r.goalsCopiedFrom}`, `copied from ${r.goalsCopiedFrom}`)}</span>
                    )}
                    {r.hasProposal && <Badge variant="outline" className="h-4 px-1 text-[9px] text-amber-600 border-amber-300 dark:border-amber-800"><Sparkles className="mr-0.5 h-2.5 w-2.5" />{t("usulan karyawan", "employee proposal")}</Badge>}
                    {r.lastSavedAt && <span>{t("tersimpan", "saved")} {new Date(r.lastSavedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
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
          ))}
        </div>
      )}

      {copyTeamOpen && (
        <CopyTeamDialog cycleId={cycleId} onClose={() => setCopyTeamOpen(false)} onDone={refresh} />
      )}
      {importOpen && (
        <ImportDialog cycleId={cycleId} onClose={() => setImportOpen(false)} onDone={refresh} />
      )}
    </div>
  );
}

// ============================================================================
// KPI BUILDER — satu peserta (§18.1)
// ============================================================================

function GoalBuilder({ appraisalId, onBack, onChanged }: { appraisalId: string; onBack: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<"library" | "template" | "copy" | "add" | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await apiSend<GoalDetail>(`/api/rekankerja/performance/goals?appraisalId=${appraisalId}`, "GET");
      setDetail(d);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "unknown");
    }
  };
  useEffect(() => { void load(); }, [appraisalId]);

  // ---- autosave §18.7: baris = draf; PATCH debounce 3s; mirror localStorage ----
  const patchRows = useMemo(() => async (rows: KpiRow[]) => {
    await apiSend("/api/rekankerja/performance/goals", "POST", {
      action: "patchDraft",
      appraisalId,
      rows: rows
        .map((r) => ({
          id: r.id,
          target: r.target, thresholdMin: r.thresholdMin, stretchValue: r.stretchValue,
          weight: r.weight, isCritical: r.isCritical,
        })),
    });
  }, [appraisalId]);

  const autosave = useDraftAutosave<KpiRow[]>(
    `goals-${appraisalId}`,
    patchRows,
    { enabled: detail != null && !detail.locked && detail.cycle.status === "GoalSetting" },
  );

  // muat baris server → draf (baseline, bukan ketikan)
  useEffect(() => {
    if (detail) autosave.setDraft(detail.kpis, { touch: false });
  }, [detail?.appraisal.id, (detail?.kpis ?? []).length]);

  const rows = autosave.draft ?? [];
  const sumW = rows.reduce((s, r) => s + (num(r.weight) || 0), 0);
  const draftWarnings = clientValidate(rows);

  const setRow = (id: string, patch: Partial<KpiRow>) => {
    autosave.setDraft(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = async (id: string) => {
    const prev = rows;
    autosave.setDraft(rows.filter((r) => r.id !== id));
    try {
      await apiSend("/api/rekankerja/performance/goals", "POST", { action: "patchDraft", appraisalId, rows: [], removedIds: [id] });
      toast.info(t("Baris dihapus", "Row removed"), {
        action: { label: t("Urungkan", "Undo"), onClick: () => { autosave.setDraft(prev); void apiSend("/api/rekankerja/performance/goals", "POST", { action: "assignBatch", appraisalId, mode: "append", items: prev.filter((p) => p.id === id).map((p) => ({ kpiDefId: p.kpiDefId, title: p.title, polarity: p.polarity, unit: p.unit, thresholdMin: p.thresholdMin, target: p.target, stretchValue: p.stretchValue, weight: p.weight, isCritical: p.isCritical })) }).then(load); } },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };
  const evenSplit = () => {
    const w = distributeEvenly(rows.map((r) => num(r.weight)));
    autosave.setDraft(rows.map((r, i) => ({ ...r, weight: w[i] })));
  };

  const refreshAll = async () => { await load(); onChanged(); };

  const submit = async () => {
    setBusy(true);
    try {
      const ok = await autosave.saveNow();
      if (!ok) throw new Error(t("Draf belum tersimpan — periksa koneksi lalu coba lagi", "Draft not saved — check your connection and retry"));
      const res = await apiSend<{ docNo: string; kpiCount: number; notified: boolean }>(
        "/api/rekankerja/performance/goals", "POST", { action: "lockGoals", appraisalId },
      );
      toast.success(t(
        `Target terkunci — ${res.kpiCount} KPI (${res.docNo})${res.notified ? " · karyawan dinotifikasi" : ""}`,
        `Goals locked — ${res.kpiCount} KPIs (${res.docNo})${res.notified ? " · employee notified" : ""}`,
      ));
      setSubmitOpen(false);
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  const decideProposal = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      const out = await apiSend<{ kept: number; removed: number }>(
        "/api/rekankerja/performance/goals", "POST", { action: "approveProposal", appraisalId, decision },
      );
      toast.success(decision === "approve"
        ? t(`${out.kept} usulan KPI diterima masuk daftar resmi`, `${out.kept} proposed KPIs accepted into the official list`)
        : t("Usulan KPI karyawan ditolak", "Employee KPI proposal rejected"));
      await refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) return <EmptyState icon={AlertTriangle} title={t("Gagal memuat", "Failed to load")} description={loadErr} />;
  if (!detail) return <LoadingRows rows={5} />;

  const a = detail.appraisal;
  const copiedRows = rows.filter((r) => r.origin === "CopiedFromCycle");
  const proposalRows = detail.kpis.filter((r) => r.proposedBy === "Employee");
  const editable = !detail.locked && detail.cycle.status === "GoalSetting";
  const canSubmit = editable && rows.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}><ChevronLeft className="h-4 w-4" />{t("Semua peserta", "All participants")}</Button>
        <div className="ml-auto"><AutosaveIndicator state={autosave as never} /></div>
      </div>

      {/* header peserta */}
      <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0">
              <p className="text-base font-semibold">{a.fullName} <span className="font-mono text-xs font-normal text-slate-400">{a.employeeNo}</span></p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{a.position ?? "—"} · {a.unit ?? "—"} · {t("atasan", "manager")}: {a.managerName ?? "—"}</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <StatusPill status={a.status} />
              <span className="font-mono text-xs text-slate-400">{a.docNo}</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {a.goalsCopiedFrom && (
              <Badge variant="outline" className="text-brand border-brand/40"><Copy className="mr-1 h-3 w-3" />{t(`disalin dari ${a.goalsCopiedFrom}`, `copied from ${a.goalsCopiedFrom}`)}</Badge>
            )}
            <Badge variant="outline">{detail.cycle.code}</Badge>
            <Badge variant="outline">{t(`tenggat target ${fmtD(detail.cycle.goalEnd)}`, `goal deadline ${fmtD(detail.cycle.goalEnd)}`)}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* banner usulan MBO §26-4 */}
      {proposalRows.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="min-w-0 flex-1 text-sm text-amber-800 dark:text-amber-300">
              {t(
                `Karyawan mengusulkan ${proposalRows.length} KPI (MBO) — terima untuk memasukkan ke daftar resmi, atau tolak.`,
                `The employee proposed ${proposalRows.length} KPIs (MBO) — accept to add to the official list, or reject.`,
              )}
            </p>
            {editable && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 border-amber-300 dark:border-amber-800" disabled={busy} onClick={() => decideProposal("reject")}>{t("Tolak", "Reject")}</Button>
                <Button size="sm" className="h-7 bg-amber-600 hover:bg-amber-700" disabled={busy} onClick={() => decideProposal("approve")}>{t("Terima", "Accept")}</Button>
              </div>
            )}
          </div>
          <ul className="mt-2 space-y-0.5 pl-6 text-xs text-amber-700 dark:text-amber-400">
            {proposalRows.map((p) => (<li key={p.id}>• {p.title} — {t("target", "target")} {p.target} {p.unit} · {t("bobot", "weight")} {p.weight}%</li>))}
          </ul>
        </div>
      )}

      {/* banner review salinan §18.4 */}
      {copiedRows.length > 0 && !detail.locked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
          {t(
            `${copiedRows.length} KPI disalin dari periode lalu — periksa target sebelum submit (salin ≠ setor).`,
            `${copiedRows.length} KPIs copied from the previous period — review targets before submitting (copy ≠ submit).`,
          )}
        </div>
      )}

      {/* pemulihan draf lokal §18.7 */}
      <DraftRecoveryBanner state={autosave as never} describe={(v) => (Array.isArray(v) ? t(`${(v as KpiRow[]).length} baris KPI`, `${(v as KpiRow[]).length} KPI rows`) : null)} />

      {/* progress bar ATAS formulir §18.7 */}
      <ProgressTrackerBar
        pct={detail.locked ? 100 : autosave.dirty || rows.length !== detail.kpis.length ? progressOfRowsClient(rows) : detail.progress.pct}
        breakdown={t(`${rows.filter((r) => r.target != null || r.polarity === "Boolean").length}/${rows.length} KPI · Σbobot ${Math.round(sumW * 10) / 10}%`, `${rows.filter((r) => r.target != null || r.polarity === "Boolean").length}/${rows.length} KPIs · Σweight ${Math.round(sumW * 10) / 10}%`)}
      />

      {/* 4 titik awal §18.1-2 — tampil saat kosong */}
      {rows.length === 0 && !detail.locked && (
        <StartingPoints appraisalId={appraisalId} onPick={setPickerOpen} />
      )}

      {/* baris KPI */}
      {(rows.length > 0 || detail.locked) && (
        <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{t("Daftar KPI", "KPI List")}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {t("5–8 KPI ideal", "5–8 KPIs ideal")}
              </span>
              {editable && (
                <div className="ml-auto flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setPickerOpen("library")}><BookOpen className="h-3.5 w-3.5" />{t("Pustaka", "Library")}</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setPickerOpen("template")}><LayoutTemplate className="h-3.5 w-3.5" />{t("Template", "Template")}</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setPickerOpen("copy")}><Copy className="h-3.5 w-3.5" />{t("Salin periode lalu", "Copy previous")}</Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => setPickerOpen("add")}><Zap className="h-3.5 w-3.5" />{t("Baris baru", "New row")}</Button>
                </div>
              )}
            </div>

            {/* desktop tabel */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="pb-2 pr-2 font-medium">{t("KPI", "KPI")}</th>
                    <th className="pb-2 pr-2 font-medium">{t("Ambang (gagal)", "Threshold (fail)")}</th>
                    <th className="pb-2 pr-2 font-medium">{t("Target", "Target")}</th>
                    <th className="pb-2 pr-2 font-medium">{t("Stretch", "Stretch")}</th>
                    <th className="pb-2 pr-2 font-medium">{t("Bobot %", "Weight %")}</th>
                    <th className="pb-2 pr-2 font-medium">{t("Kritis", "Critical")}</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <KpiRowEditor key={r.id} r={r} editable={editable} onChange={(p) => setRow(r.id, p)} onRemove={() => removeRow(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile kartu expand */}
            <div className="space-y-2 lg:hidden">
              {rows.map((r) => (
                <MobileKpiCard key={r.id} r={r} editable={editable} onChange={(p) => setRow(r.id, p)} onRemove={() => removeRow(r.id)} />
              ))}
            </div>

            {/* meter Σbobot + bantuan bagi rata §18.1-3 */}
            <div className="mt-4 space-y-2">
              <WeightMeter value={Math.round(sumW * 10) / 10} />
              {editable && rows.length > 1 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={evenSplit}>
                  <ScaleIcon className="h-3.5 w-3.5" />{t("Bagi rata sisa bobot ke semua baris", "Split the remaining weight evenly")}
                </Button>
              )}
            </div>

            {/* validasi ramah §18.1-4 */}
            {!detail.locked && draftWarnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {draftWarnings.map((w, i) => (
                  <p key={i} className={cn("text-xs", w.startsWith("Total bobot") || w.includes("ideal") || w.includes("terlalu banyak") ? "text-amber-600 dark:text-amber-400" : "text-slate-500 dark:text-slate-400")}>
                    <AlertTriangle className="mr-1 inline h-3 w-3" />{w}
                  </p>
                ))}
              </div>
            )}
            {detail.locked && (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />{t("Target terkunci (GoalApproved) — perubahan hanya lewat revisi mid-year.", "Goals locked (GoalApproved) — changes only via mid-year revision.")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* submit §35-3 */}
      {editable && rows.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => setSubmitOpen(true)} disabled={busy || Math.abs(sumW - 100) > 0.01 || rows.length < 3}>
            <Send className="h-4 w-4" /> {t("Submit & Kunci Target", "Submit & Lock Goals")}
          </Button>
        </div>
      )}

      {/* dialog titik awal */}
      {pickerOpen === "copy" && <CopyDialog appraisalId={appraisalId} onClose={() => setPickerOpen(null)} onDone={refreshAll} />}
      {pickerOpen === "library" && <LibraryPicker appraisalId={appraisalId} excludeTitles={rows.map((r) => r.title)} onClose={() => setPickerOpen(null)} onDone={refreshAll} />}
      {pickerOpen === "template" && <TemplatePicker appraisalId={appraisalId} onClose={() => setPickerOpen(null)} onDone={refreshAll} />}
      {pickerOpen === "add" && <QuickAddDialog appraisalId={appraisalId} onClose={() => setPickerOpen(null)} onDone={refreshAll} />}

      {/* dialog submit */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Kunci target sekarang?", "Lock goals now?")}</DialogTitle>
            <DialogDescription>
              {t(
                "Submit = keputusan final untuk periode ini (perubahan selanjutnya hanya lewat revisi mid-year). Karyawan akan menerima ringkasan target.",
                "Submitting is final for this period (later changes only via mid-year revision). The employee will receive the target summary.",
              )}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            <li>• {t(`${rows.length} KPI`, `${rows.length} KPIs`)}</li>
            <li>• {t(`Σbobot ${Math.round(sumW * 10) / 10}%`, `Σweight ${Math.round(sumW * 10) / 10}%`)}</li>
            {draftWarnings.length > 0 && (
              <li className="text-amber-600 dark:text-amber-400">• {draftWarnings[0]}</li>
            )}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("Kunci Target", "Lock Goals")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- validasi ramah klien (mirror validateDraft server) ----------

function clientValidate(rows: KpiRow[]): string[] {
  const errs: string[] = [];
  const n = rows.length;
  if (n > 0 && n < 3) errs.push(`Baru ${n} KPI — ideal 3–8 item`);
  if (n > 8) errs.push(`${n} KPI — terlalu banyak; ideal 3–8 item`);
  const sumW = rows.reduce((s, r) => s + (num(r.weight) || 0), 0);
  if (n > 0 && Math.abs(sumW - 100) > 0.01) {
    errs.push(`Total bobot ${Math.round(sumW * 10) / 10}% — sisakan ${Math.round((100 - sumW) * 10) / 10}% atau bagi rata?`);
  }
  for (const r of rows) {
    if (r.polarity !== "Boolean" && r.thresholdMin == null) errs.push(`"${r.title}": ambang gagal belum diisi`);
    if (!(num(r.weight) > 0)) errs.push(`"${r.title}": bobot harus > 0`);
    if (r.polarity === "Boolean" && num(r.target) !== 0 && num(r.target) !== 1) errs.push(`"${r.title}": Boolean — target 1 (sukses) atau 0 (gagal)`);
  }
  return errs;
}

function progressOfRowsClient(rows: KpiRow[]): number {
  const n = rows.length;
  if (n === 0) return 0;
  let filled = 0;
  for (const k of rows) {
    if (k.target != null || k.polarity === "Boolean") filled++;
    if (k.thresholdMin != null || k.polarity === "Boolean") filled++;
    if (num(k.weight) > 0) filled++;
  }
  const sumW = rows.reduce((s, k) => s + (num(k.weight) || 0), 0);
  if (Math.abs(sumW - 100) < 0.01) filled++;
  return Math.round((filled / (3 * n + 1)) * 100);
}

// ============================================================================
// 4 TITIK AWAL (§18.1-2 — radio besar + jumlah KPI yang dibawa)
// ============================================================================

function StartingPoints({ appraisalId, onPick }: {
  appraisalId: string; onPick: (p: "library" | "template" | "copy" | "add") => void;
}) {
  const { t } = useI18n();
  const sources = useApi<{ sources: CopySource[] }>(`/api/rekankerja/performance/goals?copySources=1&appraisalId=${appraisalId}`);
  const best = sources.data?.sources?.[0];

  const opts: { key: "copy" | "template" | "library" | "add"; label: string; labelEn: string; desc: string; descEn: string; icon: React.ElementType; badge?: string; primary?: boolean }[] = [
    {
      key: "copy", label: "Salin dari periode sebelumnya", labelEn: "Copy from previous period",
      desc: best ? `PER lalu — ${best.kpiCount} KPI tahun lalu` : "Belum ada periode sumber",
      descEn: best ? `Previous period — ${best.kpiCount} KPIs` : "No source period yet",
      icon: Copy, badge: best ? best.code : undefined, primary: !!best,
    },
    {
      key: "template", label: "Dari template jabatan", labelEn: "From position template",
      desc: "Susunan bobot per kelompok jabatan", descEn: "Weight structure per job group",
      icon: LayoutTemplate,
    },
    {
      key: "library", label: "Pilih dari pustaka", labelEn: "Pick from library",
      desc: "40 KPI 4 perspektif BSC — cari & pilih", descEn: "40 KPIs across 4 BSC perspectives — search & pick",
      icon: BookOpen,
    },
    {
      key: "add", label: "Mulai kosong", labelEn: "Start blank",
      desc: "Tambah baris KPI kustom sendiri", descEn: "Add your own custom KPI rows",
      icon: Zap,
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Titik awal", "Starting point")}>
      {opts.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={false}
          disabled={o.key === "copy" && !best}
          onClick={() => onPick(o.key)}
          className={cn(
            "rounded-xl border p-4 text-left transition disabled:opacity-50",
            o.primary ? "border-brand/60 bg-brand/5 hover:border-brand" : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80",
          )}
        >
          <div className="flex items-center gap-2">
            <o.icon className={cn("h-4 w-4", o.primary ? "text-brand" : "text-slate-500")} />
            <span className="text-sm font-semibold">{t(o.label, o.labelEn)}</span>
            {o.badge && <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-brand border-brand/40">{o.badge}</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(o.desc, o.descEn)}</p>
          {o.key === "copy" && (
            <p className="mt-1 text-[10px] text-slate-400">{t("Capaian & bukti tidak ikut disalin", "Achievements & evidence are never copied")}</p>
          )}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// EDITOR BARIS (desktop tabel + mobile kartu expand)
// ============================================================================

function KpiRowEditor({ r, editable, onChange, onRemove }: {
  r: KpiRow; editable: boolean;
  onChange: (patch: Partial<KpiRow>) => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          {r.dataSource !== "Manual" && <Badge className="h-4 bg-sky-100 px-1 text-[9px] text-sky-700 dark:bg-sky-950/60 dark:text-sky-400" title={t("Nilai ditarik otomatis saat penilaian", "Value auto-pulled at appraisal")}>AUTO</Badge>}
          {r.proposedBy === "Employee" && <Badge variant="outline" className="h-4 px-1 text-[9px] text-amber-600">MBO</Badge>}
          <span className="font-medium">{r.title}</span>
          <span className="text-xs text-slate-400">{r.unit}</span>
        </div>
        <p className="text-[10px] text-slate-400">
          {r.polarity}
          {r.isCritical ? t(" · kritis", " · critical") : ""}
          {r.origin === "CopiedFromCycle" ? t(" · salinan periode lalu", " · copied from previous") : ""}
        </p>
      </td>
      <td className="py-2 pr-2">
        {r.polarity === "Boolean"
          ? <span className="text-xs text-slate-400">{t("1=sukses", "1=success")}</span>
          : editable
            ? <Input type="number" inputMode="decimal" className="h-8 w-20" value={r.thresholdMin ?? ""} onChange={(e) => onChange({ thresholdMin: e.target.value === "" ? null : Number(e.target.value) })} aria-label={t("Ambang", "Threshold")} />
            : <span className="tabular-nums">{r.thresholdMin ?? "—"}</span>}
      </td>
      <td className="py-2 pr-2">
        {editable
          ? r.polarity === "Boolean"
            ? (
              <Select value={String(r.target)} onValueChange={(v) => onChange({ target: Number(v) })}>
                <SelectTrigger className="h-8 w-24" aria-label={t("Target", "Target")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1 — {t("sukses", "success")}</SelectItem><SelectItem value="0">0 — {t("gagal", "fail")}</SelectItem></SelectContent>
              </Select>
            )
            : <Input type="number" inputMode="decimal" className="h-8 w-24" value={r.target} onChange={(e) => onChange({ target: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={t("Target", "Target")} />
          : <span className="tabular-nums">{r.target}</span>}
      </td>
      <td className="py-2 pr-2">
        {editable
          ? <Input type="number" inputMode="decimal" className="h-8 w-20" value={r.stretchValue ?? ""} onChange={(e) => onChange({ stretchValue: e.target.value === "" ? null : Number(e.target.value) })} aria-label={t("Stretch", "Stretch")} />
          : <span className="tabular-nums">{r.stretchValue ?? "—"}</span>}
      </td>
      <td className="py-2 pr-2">
        {editable
          ? <Input type="number" inputMode="decimal" className="h-8 w-16" value={r.weight} onChange={(e) => onChange({ weight: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={t("Bobot", "Weight")} />
          : <span className="tabular-nums">{r.weight}%</span>}
      </td>
      <td className="py-2 pr-2">
        <Checkbox checked={r.isCritical} disabled={!editable} onCheckedChange={(v) => onChange({ isCritical: v === true })} aria-label={t("Kritis", "Critical")} />
      </td>
      <td className="py-2 text-right">
        {editable && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600" onClick={onRemove} aria-label={t("Hapus baris", "Remove row")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </td>
    </tr>
  );
}

function MobileKpiCard({ r, editable, onChange, onRemove }: {
  r: KpiRow; editable: boolean;
  onChange: (patch: Partial<KpiRow>) => void; onRemove: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <button className="flex w-full items-center gap-2 p-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {r.dataSource !== "Manual" && <Badge className="h-4 bg-sky-100 px-1 text-[9px] text-sky-700 dark:bg-sky-950/60 dark:text-sky-400">AUTO</Badge>}
            <span className="truncate text-sm font-medium">{r.title}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {t("Target", "Target")} <span className="tabular-nums">{r.target}</span> {r.unit} · {t("bobot", "weight")} <span className="tabular-nums">{r.weight}%</span>
            {r.isCritical ? ` · ${t("kritis", "critical")}` : ""}
          </p>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3 dark:border-slate-800/60">
          <div className="space-y-1">
            <Label className="text-[10px]">{t("Ambang (gagal)", "Threshold (fail)")}</Label>
            {r.polarity === "Boolean"
              ? <p className="text-xs text-slate-400">1 = {t("sukses", "success")}</p>
              : <Input type="number" inputMode="decimal" disabled={!editable} value={r.thresholdMin ?? ""} onChange={(e) => onChange({ thresholdMin: e.target.value === "" ? null : Number(e.target.value) })} aria-label={t("Ambang", "Threshold")} />}
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">{t("Target", "Target")}</Label>
            {r.polarity === "Boolean" ? (
              <Select value={String(r.target)} onValueChange={(v) => onChange({ target: Number(v) })} disabled={!editable}>
                <SelectTrigger className="h-9" aria-label={t("Target", "Target")}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1 — {t("sukses", "success")}</SelectItem><SelectItem value="0">0 — {t("gagal", "fail")}</SelectItem></SelectContent>
              </Select>
            ) : (
              <Input type="number" inputMode="decimal" disabled={!editable} value={r.target} onChange={(e) => onChange({ target: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={t("Target", "Target")} />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Stretch</Label>
            <Input type="number" inputMode="decimal" disabled={!editable} value={r.stretchValue ?? ""} onChange={(e) => onChange({ stretchValue: e.target.value === "" ? null : Number(e.target.value) })} aria-label="Stretch" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">{t("Bobot %", "Weight %")}</Label>
            <Input type="number" inputMode="decimal" disabled={!editable} value={r.weight} onChange={(e) => onChange({ weight: e.target.value === "" ? 0 : Number(e.target.value) })} aria-label={t("Bobot", "Weight")} />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={r.isCritical} disabled={!editable} onCheckedChange={(v) => onChange({ isCritical: v === true })} aria-label={t("Kritis", "Critical")} />
            {t("KPI kritis (gagal = rating maks 2)", "Critical KPI (fail = rating max 2)")}
          </label>
          {editable && (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-rose-600" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" />{t("Hapus", "Remove")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DIALOG SALIN PER PESERTA (§18.2 a/b)
// ============================================================================

function CopyDialog({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const sources = useApi<{ sources: CopySource[] }>(`/api/rekankerja/performance/goals?copySources=1&appraisalId=${appraisalId}`);
  const [srcId, setSrcId] = useState<string>("");
  const [preview, setPreview] = useState<CopyPreviewData | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const best = sources.data?.sources?.[0];
    if (best && !srcId) {
      setSrcId(best.appraisalId);
      // muat pratinjau sumber terbaik secara otomatis saat dialog dibuka (§18.2-a)
      void loadPreview(best.appraisalId);
    }
  }, [sources.data]);

  const loadPreview = async (id: string) => {
    setSrcId(id);
    setPreview(null);
    setBusy(true);
    try {
      const p = await apiSend<CopyPreviewData>("/api/rekankerja/performance/goals", "POST", {
        action: "copyPreview", appraisalId, sourceAppraisalId: id,
      });
      setPreview(p);
      setSel(Object.fromEntries(p.rows.map((r) => [r.sourceKpiId, true])));
      setTargets(Object.fromEntries(p.rows.map((r) => [r.sourceKpiId, r.target])));
      setWeights(Object.fromEntries(p.rows.map((r) => [r.sourceKpiId, r.weight])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const chosen = preview ? preview.rows.filter((r) => sel[r.sourceKpiId]) : [];
  const sumW = chosen.reduce((s, r) => s + (weights[r.sourceKpiId] ?? r.weight), 0);

  const doCopy = async (mode?: "merge" | "replace") => {
    if (!preview) return;
    setBusy(true);
    try {
      if (mode === "replace" && preview.hasExistingRows) {
        await apiSend("/api/rekankerja/performance/goals", "POST", {
          action: "assignBatch", appraisalId, mode: "replace", items: [],
        });
      }
      const out = await apiSend<{ created: number; cycleCode: string }>(
        "/api/rekankerja/performance/goals", "POST",
        {
          action: "copyFromCycle", appraisalId, sourceAppraisalId: preview.source.appraisalId,
          rows: preview.rows
            .filter((r) => sel[r.sourceKpiId])
            .map((r) => ({
              sourceKpiId: r.sourceKpiId, include: true,
              target: targets[r.sourceKpiId] ?? r.target,
              weight: weights[r.sourceKpiId] ?? r.weight,
              isCritical: r.isCritical,
            })),
        },
      );
      toast.success(t(
        `${out.created} KPI disalin dari ${out.cycleCode} — capaian direset; status tetap draf. Periksa target sebelum submit.`,
        `${out.created} KPIs copied from ${out.cycleCode} — achievements reset; still a draft. Review targets before submitting.`,
      ));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("Salin dari Periode Sebelumnya", "Copy from Previous Period")}</DialogTitle>
          <DialogDescription>
            {t(
              "Target lama menjadi titik awal (bebas diedit). Capaian & bukti TIDAK ikut disalin — periode baru selalu mulai bersih.",
              "Old targets become the starting point (editable). Achievements & evidence are NOT copied — the new period always starts clean.",
            )}
          </DialogDescription>
        </DialogHeader>

        {sources.loading && <LoadingRows rows={3} />}
        {sources.data && sources.data.sources.length === 0 && (
          <EmptyState icon={Copy} title={t("Tidak ada periode sumber", "No source period")} description={t("Peserta belum punya siklus terdahulu dengan KPI terkunci — gunakan template jabatan atau pustaka.", "The participant has no prior cycle with locked KPIs — use a position template or the library.")} />
        )}

        {sources.data && sources.data.sources.length > 0 && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{t("Siklus sumber", "Source cycle")}</Label>
              <Select value={srcId} onValueChange={loadPreview}>
                <SelectTrigger aria-label={t("Siklus sumber", "Source cycle")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {sources.data.sources.map((s) => (
                    <SelectItem key={s.appraisalId} value={s.appraisalId}>
                      {s.code} — {t(`${s.kpiCount} KPI`, `${s.kpiCount} KPIs`)}{s.suggested ? t(" (disarankan)", " (recommended)") : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {busy && !preview && <LoadingRows rows={4} />}

            {preview && (
              <>
                {preview.placementChanged && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400">
                    <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{preview.placementNote}
                  </div>
                )}
                {preview.hasExistingRows && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                    {t("Peserta sudah punya baris KPI — baris salinan akan digabungkan. Ganti seluruhnya?", "The participant already has KPI rows — copied rows will be merged. Replace all instead?")}
                    <Button size="sm" variant="ghost" className="ml-2 h-6 text-xs" onClick={() => doCopy("replace")}>{t("Ganti semua", "Replace all")}</Button>
                  </div>
                )}

                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                      <tr className="text-left text-slate-500">
                        <th className="p-2" />
                        <th className="p-2 font-medium">{t("KPI", "KPI")}</th>
                        <th className="p-2 font-medium">{t("Target lama", "Old target")}</th>
                        <th className="p-2 font-medium">{t("Target baru", "New target")}</th>
                        <th className="p-2 font-medium">{t("Bobot", "Weight")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((r) => (
                        <tr key={r.sourceKpiId} className={cn("border-t border-slate-100 dark:border-slate-800/60", !sel[r.sourceKpiId] && "opacity-50")}>
                          <td className="p-2">
                            <Checkbox
                              checked={sel[r.sourceKpiId] ?? false}
                              onCheckedChange={(v) => setSel((s) => ({ ...s, [r.sourceKpiId]: v === true }))}
                              aria-label={t(`Pilih ${r.title}`, `Select ${r.title}`)}
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {r.auto && <Badge className="h-4 bg-sky-100 px-1 text-[9px] text-sky-700 dark:bg-sky-950/60 dark:text-sky-400">AUTO</Badge>}
                              <span className="font-medium">{r.title}</span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {r.defInactive && <Badge variant="outline" className="h-4 px-1 text-[9px] text-amber-600 border-amber-300 dark:border-amber-800">{t("pustaka non-aktif — periksa penggantinya", "library inactive — check a replacement")}</Badge>}
                              {r.unitChanged && <Badge variant="outline" className="h-4 px-1 text-[9px]">{t("satuan berubah", "unit changed")}</Badge>}
                              {r.duplicate && <Badge variant="outline" className="h-4 px-1 text-[9px] text-slate-500">{t("duplikat baris ada", "duplicate exists")}</Badge>}
                            </div>
                          </td>
                          <td className="p-2 tabular-nums text-slate-500">{r.oldTarget} {r.unit}</td>
                          <td className="p-2">
                            <Input type="number" inputMode="decimal" className="h-8 w-20" value={targets[r.sourceKpiId] ?? r.target}
                              onChange={(e) => setTargets((s) => ({ ...s, [r.sourceKpiId]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                              aria-label={t("Target baru", "New target")} />
                          </td>
                          <td className="p-2">
                            <Input type="number" inputMode="decimal" className="h-8 w-16" value={weights[r.sourceKpiId] ?? r.weight}
                              onChange={(e) => setWeights((s) => ({ ...s, [r.sourceKpiId]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                              aria-label={t("Bobot", "Weight")} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {t(`${chosen.length} dari ${preview.rows.length} dipilih`, `${chosen.length} of ${preview.rows.length} selected`)}
                  </span>
                  <div className="min-w-40 flex-1"><WeightMeter value={Math.round(sumW * 10) / 10} compact /></div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => {
                      const w = distributeEvenly(chosen.map((r) => weights[r.sourceKpiId] ?? r.weight));
                      setWeights(Object.fromEntries(chosen.map((r, i) => [r.sourceKpiId, w[i]])));
                    }}>
                    <ScaleIcon className="h-3.5 w-3.5" />{t("bagi rata terpilih", "split evenly")}
                  </Button>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{preview.reminder}</p>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={() => doCopy()} disabled={busy || !preview || chosen.length === 0}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t(`Salin ${chosen.length} baris`, `Copy ${chosen.length} rows`)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// PICKER PUSTAKA KPI (§18.1-6 — search + filter BSC + badge AUTO)
// ============================================================================

function LibraryPicker({ appraisalId, excludeTitles, onClose, onDone }: {
  appraisalId: string; excludeTitles: string[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lib = useApi<{ rows: { id: string; code: string; name: string; category: string; unit: string; polarity: string; dataSource: string; sourceKey: string | null }[] }>(
    `/api/rekankerja/performance/masters?type=kpi`,
  );

  const rows = (lib.data?.rows ?? []).filter((r) =>
    (cat === "all" || r.category === cat) &&
    (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.code.toLowerCase().includes(q.toLowerCase())) &&
    !excludeTitles.includes(r.name),
  );

  const CATS: [string, string, string][] = [
    ["all", "Semua", "All"],
    ["Financial", "Finansial", "Financial"],
    ["Customer", "Pelanggan", "Customer"],
    ["InternalProcess", "Proses Internal", "Internal Process"],
    ["LearningGrowth", "Pembelajaran", "Learning & Growth"],
  ];

  const add = async () => {
    if (!sel.length) return;
    setBusy(true);
    try {
      const chosen = (lib.data?.rows ?? []).filter((r) => sel.includes(r.id));
      const w = distributeEvenly(sel.map(() => 10), 100);
      const out = await apiSend<{ created: number }>("/api/rekankerja/performance/goals", "POST", {
        action: "assignBatch", appraisalId, mode: "append",
        items: chosen.map((c, i) => ({
          kpiDefId: c.id, title: c.name, polarity: c.polarity, unit: c.unit,
          thresholdMin: null, target: 0, weight: w[i], isCritical: false,
        })),
      });
      toast.success(t(`${out.created} KPI ditambahkan dari pustaka — isi target & ambang lalu atur bobot`, `${out.created} KPIs added from the library — fill targets & thresholds then adjust weights`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Pilih dari Pustaka KPI", "Pick from the KPI Library")}</DialogTitle>
          <DialogDescription>
            {t("Badge AUTO = nilai ditarik otomatis dari modul lain saat penilaian.", "AUTO badge = value auto-pulled from other modules at appraisal time.")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Input className="flex-1" placeholder={t("Cari KPI…", "Search KPIs…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Cari KPI", "Search KPIs")} />
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-40" aria-label={t("Perspektif BSC", "BSC perspective")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATS.map(([v, id, en]) => (<SelectItem key={v} value={v}>{t(id, en)}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {lib.loading && <LoadingRows rows={4} />}
          {rows.map((r) => {
            const on = sel.includes(r.id);
            return (
              <button
                key={r.id}
                onClick={() => setSel((s) => on ? s.filter((x) => x !== r.id) : [...s, r.id])}
                aria-pressed={on}
                className={cn("flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition", on ? "border-brand bg-brand/5" : "border-slate-200 hover:border-slate-300 dark:border-slate-800")}
              >
                <Checkbox checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.name}
                    {r.sourceKey && <Badge className="ml-1.5 h-4 bg-sky-100 px-1 text-[9px] text-sky-700 dark:bg-sky-950/60 dark:text-sky-400">AUTO</Badge>}
                  </p>
                  <p className="font-mono text-[10px] text-slate-400">{r.code} · {r.unit} · {r.polarity}</p>
                </div>
              </button>
            );
          })}
          {rows.length === 0 && !lib.loading && (
            <p className="py-6 text-center text-sm text-slate-400">{t("Tidak ada KPI cocok", "No matching KPIs")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={add} disabled={busy || sel.length === 0}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t(`Tambah ${sel.length} KPI`, `Add ${sel.length} KPIs`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// PICKER TEMPLATE JABATAN
// ============================================================================

function TemplatePicker({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const tpl = useApi<{ rows: { id: string; code: string; name: string; weightsJson: string; active: boolean; items: { kind: string; refId: string; weight: number }[] }[] }>(
    `/api/rekankerja/performance/masters?type=template`,
  );
  const rows = (tpl.data?.rows ?? []).filter((r) => r.active);

  const apply = async (tplId: string) => {
    setBusy(true);
    try {
      const chosen = rows.find((r) => r.id === tplId);
      if (!chosen) return;
      // item KPI template → baris draf (target 0 — diisi atasan; bobot dari template)
      const kpiItems = chosen.items.filter((i) => i.kind === "Kpi");
      if (kpiItems.length === 0) throw new Error("Template tidak punya item KPI");
      const defs = await apiSend<{ rows: { id: string; name: string; polarity: string; unit: string }[] }>(
        "/api/rekankerja/performance/masters?type=kpi", "GET",
      );
      const defById = new Map(defs.rows.map((d) => [d.id, d]));
      const items = kpiItems
        .map((i) => {
          const d = defById.get(i.refId);
          return d ? { kpiDefId: d.id, title: d.name, polarity: d.polarity, unit: d.unit, thresholdMin: null, target: 0, weight: i.weight, isCritical: false } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
      const out = await apiSend<{ created: number }>("/api/rekankerja/performance/goals", "POST", {
        action: "assignBatch", appraisalId, mode: "append", items,
      });
      toast.success(t(`${out.created} KPI dari template ${chosen.code} — isi target lalu submit`, `${out.created} KPIs from template ${chosen.code} — fill targets then submit`));
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Dari Template Jabatan", "From Position Template")}</DialogTitle>
          <DialogDescription>{t("Susunan bobot per kelompok jabatan — target tetap diisi atasan.", "Weight structure per job group — targets still filled by the manager.")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {tpl.loading && <LoadingRows rows={3} />}
          {rows.map((r) => {
            const w = (() => { try { return JSON.parse(r.weightsJson) as { kpi?: number; competency?: number; core?: number }; } catch { return {}; } })();
            const kpiN = r.items.filter((i) => i.kind === "Kpi").length;
            return (
              <button key={r.id} disabled={busy} onClick={() => apply(r.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand/50 disabled:opacity-50 dark:border-slate-800">
                <LayoutTemplate className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="font-mono text-[10px] text-slate-400">{r.code} · {t(`${kpiN} KPI`, `${kpiN} KPIs`)} · {w.kpi ?? 0}/{w.competency ?? 0}/{w.core ?? 0}</p>
                </div>
                <ArrowRightLeft className="h-3.5 w-3.5 text-slate-300" />
              </button>
            );
          })}
          {rows.length === 0 && !tpl.loading && <p className="py-6 text-center text-sm text-slate-400">{t("Tidak ada template aktif", "No active templates")}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// BARIS CEPAT (mulai kosong §18.1-9 — Enter menambah baris)
// ============================================================================

function QuickAddDialog({ appraisalId, onClose, onDone }: { appraisalId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ title: "", polarity: "Higher", unit: "%", threshold: "", target: "", weight: "10", critical: false });
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async () => {
    setBusy(true);
    try {
      const out = await apiSend<{ created: number }>("/api/rekankerja/performance/goals", "POST", {
        action: "assignBatch", appraisalId, mode: "append",
        items: [{
          title: form.title.trim(), polarity: form.polarity, unit: form.unit || "%",
          thresholdMin: form.threshold === "" ? null : Number(form.threshold),
          target: form.target === "" ? 0 : Number(form.target),
          weight: Number(form.weight) || 10, isCritical: form.critical,
        }],
      });
      toast.success(t("Baris KPI ditambahkan", "KPI row added"));
      if (out.created > 0) { onDone(); }
      setForm({ ...form, title: "", target: "" });
      titleRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Tambah Baris KPI", "Add KPI Row")}</DialogTitle>
          <DialogDescription>{t("KPI kustom bebas — atau gunakan pustaka untuk KPI baku perusahaan.", "Free-form custom KPI — or use the library for company-standard KPIs.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("Judul KPI", "KPI title")}</Label>
            <Input ref={titleRef} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter" && form.title.trim()) { e.preventDefault(); void submit(); } }}
              placeholder={t("mis. Kecepatan respons keluhan pelanggan", "e.g. Customer complaint response time")} aria-label={t("Judul KPI", "KPI title")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("Polaritas", "Polarity")}</Label>
              <Select value={form.polarity} onValueChange={(v) => setForm((f) => ({ ...f, polarity: v }))}>
                <SelectTrigger aria-label={t("Polaritas", "Polarity")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Higher">{t("Lebih tinggi lebih baik", "Higher is better")}</SelectItem>
                  <SelectItem value="Lower">{t("Lebih rendah lebih baik", "Lower is better")}</SelectItem>
                  <SelectItem value="Boolean">{t("Boolean (sukses/gagal)", "Boolean (success/fail)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Satuan", "Unit")}</Label>
              <Input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} aria-label={t("Satuan", "Unit")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Ambang gagal", "Fail threshold")}</Label>
              <Input type="number" inputMode="decimal" value={form.threshold} onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))} aria-label={t("Ambang gagal", "Fail threshold")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Target", "Target")}</Label>
              <Input type="number" inputMode="decimal" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} aria-label={t("Target", "Target")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("Bobot %", "Weight %")}</Label>
              <Input type="number" inputMode="decimal" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} aria-label={t("Bobot", "Weight")} />
            </div>
            <label className="flex items-end gap-2 pb-1 text-xs">
              <Checkbox checked={form.critical} onCheckedChange={(v) => setForm((f) => ({ ...f, critical: v === true }))} aria-label={t("Kritis", "Critical")} />
              {t("Kritis", "Critical")}
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
          <Button onClick={submit} disabled={busy || !form.title.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("Tambah", "Add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// DIALOG SALIN TIM (§18.2-c)
// ============================================================================

function CopyTeamDialog({ cycleId, onClose, onDone }: { cycleId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const cycles = useApi<{ rows: CycleRow[] }>("/api/rekankerja/performance/cycles");
  const [srcId, setSrcId] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ filled: string[]; skipped: string[]; noSource: string[] } | null>(null);

  const current = cycles.data?.rows.find((c) => c.id === cycleId);
  const candidates = (cycles.data?.rows ?? []).filter((c) => c.id !== cycleId && current && c.periodEnd < current.periodStart);

  const run = async () => {
    setBusy(true);
    try {
      const out = await apiSend<{ filled: string[]; skipped: string[]; noSource: string[] }>(
        "/api/rekankerja/performance/goals", "POST", { action: "copyTeam", cycleId, sourceCycleId: srcId },
      );
      setReport(out);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Salin Tim dari Periode Lalu", "Copy Team From Previous Period")}</DialogTitle>
          <DialogDescription>
            {t(
              "Peserta TANPA baris KPI diisi salinan periode lalunya (sama karyawan). Yang sudah punya baris DILEWATI (dilaporkan, bukan error §35-25); tanpa sumber ditawarkan template.",
              "Participants WITHOUT KPI rows get copies from their own previous period. Those with rows are SKIPPED (reported, not an error §35-25); those without sources are offered a template.",
            )}
          </DialogDescription>
        </DialogHeader>
        {!report ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs">{t("Siklus sumber", "Source cycle")}</Label>
              <Select value={srcId} onValueChange={setSrcId}>
                <SelectTrigger aria-label={t("Siklus sumber", "Source cycle")}><SelectValue placeholder={t("Pilih periode lalu…", "Pick a previous period…")} /></SelectTrigger>
                <SelectContent>
                  {candidates.map((c) => (<SelectItem key={c.id} value={c.id}>{c.code} — {c.status}</SelectItem>))}
                </SelectContent>
              </Select>
              {candidates.length === 0 && <p className="text-xs text-slate-400">{t("Tidak ada siklus periode terdahulu.", "No earlier-period cycles.")}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
              <Button onClick={run} disabled={busy || !srcId}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("Salin Tim", "Copy Team")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="mr-1 inline h-4 w-4" />{t(`${report.filled.length} peserta terisi`, `${report.filled.length} filled`)}</p>
            <p className="text-slate-500">{t(`${report.skipped.length} dilewati (sudah punya baris)`, `${report.skipped.length} skipped (already have rows)`)}</p>
            <p className="text-amber-600 dark:text-amber-400">{t(`${report.noSource.length} tanpa sumber — tawarkan template jabatan`, `${report.noSource.length} without source — offer a position template`)}</p>
            {(report.filled.length > 0 || report.noSource.length > 0) && (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-800">
                {report.filled.map((x) => (<p key={x} className="text-emerald-700 dark:text-emerald-400">✓ {x}</p>))}
                {report.noSource.map((x) => (<p key={x} className="text-amber-600 dark:text-amber-400">? {x}</p>))}
              </div>
            )}
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
// DIALOG IMPOR EXCEL (§18.5 — unduh → unggah → pratinjau → commit)
// ============================================================================

function ImportDialog({ cycleId, onClose, onDone }: { cycleId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<{ rows: ImportRow[]; counts: { valid: number; error: number; skip: number }; cycleCode: string } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [report, setReport] = useState<{ created: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("action", "importTargetsPreview");
      form.append("cycleId", cycleId);
      form.append("file", file);
      const res = await apiUpload<{ rows: ImportRow[]; counts: { valid: number; error: number; skip: number }; cycleCode: string }>(
        "/api/rekankerja/performance/goals", form,
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
      const rows = preview.rows.filter((r) => r.valid && !r.skip);
      const out = await apiSend<{ created: number; skipped: number }>(
        "/api/rekankerja/performance/goals", "POST",
        { action: "importTargetsCommit", cycleId, rows },
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
    a.href = url; a.download = `impor-target-error-${preview.cycleCode}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("Impor Excel Target KPI", "Excel Import — KPI Targets")}</DialogTitle>
          <DialogDescription>
            {t(
              "Hasil impor = baris DRAF (belum submit). Baris kotor ditolak per sel dengan alasan — TIDAK membatalkan baris lain (D16).",
              "Import results are DRAFT rows (not submitted). Dirty rows are rejected per-cell with reasons — other rows are NOT affected (D16).",
            )}
          </DialogDescription>
        </DialogHeader>

        {!preview && !report && (
          <div className="space-y-3">
            <a
              href={`/api/rekankerja/performance/goals?importTemplate=targets&cycleId=${cycleId}`}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-brand/50 dark:border-slate-800"
            >
              <Download className="h-5 w-5 shrink-0 text-brand" />
              <div>
                <p className="text-sm font-semibold">{t("1 · Unduh Template (.xlsx)", "1 · Download Template (.xlsx)")}</p>
                <p className="text-xs text-slate-500">{t("Header dwibahasa + sheet instruksi + baris contoh + dropdown validasi", "Bilingual headers + instruction sheet + example row + validation dropdowns")}</p>
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
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{t(`${preview.counts.skip} lompat`, `${preview.counts.skip} skip`)}</Badge>
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
                    <th className="p-1.5">{t("Target", "Target")}</th>
                    <th className="p-1.5">{t("Bobot", "Weight")}</th>
                    <th className="p-1.5">{t("Status", "Status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.rowNo} className={cn(
                      "border-t border-slate-100 dark:border-slate-800/60",
                      !r.valid ? "bg-rose-50/60 dark:bg-rose-950/10" : r.skip ? "bg-amber-50/50 dark:bg-amber-950/10" : "",
                    )}>
                      <td className="p-1.5 tabular-nums text-slate-400">{r.rowNo}</td>
                      <td className="p-1.5"><span className="font-mono">{r.employeeNo}</span> {r.fullName}</td>
                      <td className="p-1.5">{r.kpi}</td>
                      <td className="p-1.5 tabular-nums">{r.target}</td>
                      <td className="p-1.5 tabular-nums">{r.weight}</td>
                      <td className="p-1.5">
                        {!r.valid
                          ? r.errors.map((e, i) => (<span key={i} className="block text-rose-600 dark:text-rose-400">{e.field}: {e.message}</span>))
                          : r.skip
                            ? <span className="text-amber-600 dark:text-amber-400">{t("lompati", "skip")} — {r.skip}</span>
                            : <span className="text-emerald-600 dark:text-emerald-400">✓ {t("valid (draf)", "valid (draft)")}</span>}
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
              {t(`${report.created} baris draf dibuat · ${report.skipped} lompat`, `${report.created} draft rows created · ${report.skipped} skipped`)}
            </p>
            <p className="text-xs text-slate-500">
              {t("Impor ≠ submit — tiap peserta tetap menunggu review + submit oleh atasan (§18.5).", "Import ≠ submit — each participant still awaits manager review + submit (§18.5).")}
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
