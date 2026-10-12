"use client";
// P1-PERF — Target & KPI + KPI Builder (§18.1 AMANDEMEN 1: wizard, meter bobot,
// autosave draf, picker pustaka; §18.2 salin dari periode sebelumnya dengan
// dialog pratinjau; §18.7 AMANDEMEN 2: autosave debounce + mirror localStorage
// + progress tracker bar "Formulir Anda selesai X%"; §18.5 AMANDEMEN 2: impor
// Excel 3 langkah dengan pratinjau validasi per sel).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useNav } from "@/rekankerja/shared/lib/store";
import { cn } from "@/lib/utils";
import {
  Target, Plus, Trash2, Search, Zap, Copy, FileSpreadsheet, Upload, Download, Save,
  Scale, ClipboardCheck, History, RotateCcw, CloudOff, Cloud, X,
} from "lucide-react";

const GOALS_API = "/api/rekankerja/performance/goals";
const CYCLES_API = "/api/rekankerja/performance/cycles";

interface KpiRowUI {
  id: string;
  kpiDefId: string | null;
  title: string;
  polarity: string;
  unit: string;
  thresholdMin: number | null;
  target: number;
  stretchValue: number | null;
  weight: number;
  isCritical: boolean;
  dataSource: string;
  sourceKey: string | null;
  origin?: string;
  copiedFromId?: string | null;
}

interface ParticipantRow {
  appraisalId: string; docNo: string; employeeNo: string; employeeName: string; position: string | null;
  orgUnit: string | null; managerName: string | null; status: string; goalsCopiedFrom: string | null;
  kpiCount: number; weightSum: number; progressPct: number;
}

export function PerformanceGoalsPage() {
  const { t } = useI18n();
  const nav = useNav();
  const appraisalId = nav.params.id;
  const wizardImport = nav.params.wizard === "import";

  // ==================== DAFTAR PESERTA ====================
  const cyclesApi = useApi<{ rows: { id: string; code: string; name: string; status: string; periodEnd: string; participantCount: number }[] }>(`${CYCLES_API}?limit=100`);
  const [cycleId, setCycleId] = useState("");
  useEffect(() => {
    if (cycleId) return;
    const rows = cyclesApi.data?.rows ?? [];
    const active = rows.find((r) => r.status === "GoalSetting") ?? rows.find((r) => r.status === "Draft") ?? rows[0];
    if (active) setCycleId(active.id);
  }, [cyclesApi.data, cycleId]);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const listUrl = useMemo(() => {
    if (!cycleId) return null;
    const p = new URLSearchParams({ cycleId });
    if (dq) p.set("q", dq);
    return `${GOALS_API}?${p.toString()}`;
  }, [cycleId, dq]);
  const listApi = useApi<{ rows: ParticipantRow[]; total: number }>(listUrl, [listUrl]);

  // ==================== BUILDER ====================
  const detailApi = useApi<{
    detail: {
      id: string; docNo: string; status: string; goalsCopiedFrom: string | null;
      employee: { id: string; employeeNo: string; fullName: string; position: { title: string } | null; orgUnit: { name: string } | null };
      manager: { fullName: string } | null;
      cycle: { id: string; code: string; name: string; status: string; goalEnd: string | null };
      kpis: KpiRowUI[];
    };
  }>(appraisalId ? `${GOALS_API}?appraisalId=${appraisalId}` : null, [appraisalId]);

  const [rows, setRows] = useState<KpiRowUI[]>([]);
  const [meta, setMeta] = useState<{ docNo: string; employeeName: string; position: string | null; cycleCode: string; goalEnd: string | null; status: string; goalsCopiedFrom: string | null } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [localRecovery, setLocalRecovery] = useState<{ rows: KpiRowUI[]; savedAt: string } | null>(null);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lsKey = appraisalId ? `perf-goals-draft-${appraisalId}` : "";

  useEffect(() => {
    const d = detailApi.data?.detail;
    if (!d) return;
    setRows(d.kpis.map((k) => ({ ...k })));
    setMeta({ docNo: d.docNo, employeeName: d.employee.fullName, position: d.employee.position?.title ?? null, cycleCode: d.cycle.code, goalEnd: d.cycle.goalEnd, status: d.status, goalsCopiedFrom: d.goalsCopiedFrom });
    setDirty(false);
    // cek pemulihan draf lokal (§18.7 — mirror localStorage)
    try {
      const raw = window.localStorage.getItem(lsKey);
      if (raw) {
        const local = JSON.parse(raw) as { rows: KpiRowUI[]; savedAt: string; serverCount: number };
        if (local.rows.length !== d.kpis.length) {
          setLocalRecovery({ rows: local.rows, savedAt: local.savedAt });
        }
      }
    } catch { /* abaikan */ }
  }, [detailApi.data, lsKey]);

  // mirror localStorage tiap perubahan
  useEffect(() => {
    if (!lsKey || !meta) return;
    try {
      window.localStorage.setItem(lsKey, JSON.stringify({ rows, savedAt: new Date().toISOString() }));
    } catch { /* storage penuh/diblokir */ }
  }, [rows, lsKey, meta]);

  // beforeunload (§18.7 anti tutup tak sengaja)
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // autosave debounce 3 detik per baris (§18.7)
  const scheduleSave = useCallback((kpiId: string) => {
    clearTimeout(debounceRef.current[kpiId]);
    debounceRef.current[kpiId] = setTimeout(async () => {
      setSaveState("saving");
      try {
        await apiSend(GOALS_API, "POST", { action: "saveRow", kpiId, ...rows.find((r) => r.id === kpiId) });
        setSaveState("saved");
        setSavedAt(new Date());
        setDirty((d) => { return d; }); // tetap dirty sampai semua baris tersimpan — sederhana: clear bila semua tersinkron
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Gagal menyimpan draf", "Failed to save draft"));
        setSaveState("idle");
      }
    }, 3000);
  }, [rows, t]);

  const patchRow = (kpiId: string, patch: Partial<KpiRowUI>) => {
    setRows((rs) => rs.map((r) => (r.id === kpiId ? { ...r, ...patch } : r)));
    setDirty(true);
    scheduleSave(kpiId);
  };

  const addRow = async (kpi: Partial<KpiRowUI>) => {
    try {
      const res = await apiSend<{ id: string }>(GOALS_API, "POST", {
        action: "addRow", appraisalId,
        title: kpi.title ?? "", polarity: kpi.polarity ?? "Higher", unit: kpi.unit ?? "",
        thresholdMin: kpi.thresholdMin ?? null, target: kpi.target ?? 0, stretchValue: kpi.stretchValue ?? null,
        weight: kpi.weight ?? 0, isCritical: kpi.isCritical ?? false, kpiDefId: kpi.kpiDefId ?? null,
        dataSource: kpi.dataSource ?? "Manual", sourceKey: kpi.sourceKey ?? null,
      });
      setRows((rs) => [...rs, { id: res.id, kpiDefId: kpi.kpiDefId ?? null, title: kpi.title ?? "", polarity: kpi.polarity ?? "Higher", unit: kpi.unit ?? "", thresholdMin: kpi.thresholdMin ?? null, target: kpi.target ?? 0, stretchValue: kpi.stretchValue ?? null, weight: kpi.weight ?? 0, isCritical: kpi.isCritical ?? false, dataSource: kpi.dataSource ?? "Manual", sourceKey: kpi.sourceKey ?? null }]);
      setSaveState("saved");
      setSavedAt(new Date());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  const deleteRow = async (kpiId: string) => {
    try {
      await apiSend(GOALS_API, "POST", { action: "deleteRow", kpiId });
      setRows((rs) => rs.filter((r) => r.id !== kpiId));
      setSaveState("saved");
      setSavedAt(new Date());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  const submit = async () => {
    if (!appraisalId) return;
    const weightSum = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    if (Math.abs(weightSum - 100) > 0.01) {
      toast.error(t("Jumlah bobot harus 100 (sekarang {w}). Gunakan bagi rata atau perbaiki manual.", "Weights must total 100 (now {w}). Use distribute-evenly or fix manually.", { w: String(Math.round(weightSum)) }));
      return;
    }
    if (rows.length < 3 || rows.length > 8) {
      toast.error(t("Jumlah KPI harus 3–8 item (sekarang {n}).", "KPI count must be 3–8 items (now {n}).", { n: String(rows.length) }));
      return;
    }
    if (!window.confirm(t("Kunci target KPI peserta ini? Setelah terkunci, perubahan hanya lewat revisi mid-year.", "Lock this participant's KPI targets? After locking, changes only via mid-year revision."))) return;
    try {
      await apiSend(GOALS_API, "POST", { action: "submit", appraisalId });
      toast.success(t("Target dikunci (GoalApproved) — ringkasan dikirim ke karyawan", "Targets locked (GoalApproved) — summary sent to the employee"));
      try { window.localStorage.removeItem(lsKey); } catch { /* abaikan */ }
      nav.navigate("performance", "goals");
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  // pustaka KPI picker
  const [libDialog, setLibDialog] = useState(false);
  const [libQ, setLibQ] = useState("");
  const libApi = useApi<{ rows: { id: string; code: string; name: string; category: string; polarity: string; unit: string; dataSource: string; sourceKey: string | null; description: string | null }[] }>(
    libDialog ? `/api/rekankerja/performance/masters?kind=kpi&active=true${libQ ? `&q=${encodeURIComponent(libQ)}` : ""}` : null,
    [libDialog, libQ],
  );

  // salin periode lalu
  const [copyDialog, setCopyDialog] = useState(false);
  const [copySel, setCopySel] = useState<Set<string>>(new Set());
  const [copyTargets, setCopyTargets] = useState<Record<string, string>>({});
  const detail = detailApi.data?.detail;
  const srcApi = useApi<{ sources: { appraisalId: string; cycleId: string; cycleCode: string; cycleName: string; periodEnd: string }[] }>(
    appraisalId && detail && rows.length === 0 ? `${GOALS_API}?cycleId=${detail.cycle.id}&employeeId=${detail.employee.id}&sources=1` : null,
    [appraisalId, detail?.cycle.id, rows.length],
  );
  const [copyData, setCopyData] = useState<{ source: { cycleId: string; cycleCode: string }; rows: (KpiRowUI & { sourceKpiId: string; defInactive: boolean; unitChanged: boolean })[]; existingCount: number } | null>(null);
  const openCopyPreview = async () => {
    const d = detailApi.data?.detail;
    if (!d) return;
    try {
      const data = await apiSend<{ source: { cycleId: string; cycleCode: string }; rows: (KpiRowUI & { sourceKpiId: string; defInactive: boolean; unitChanged: boolean })[]; existingCount: number }>(GOALS_API, "POST", {
        action: "copyPreview", cycleId: d.cycle.id, employeeId: d.employee.id,
      });
      setCopyData(data);
      setCopySel(new Set(data.rows.map((r) => r.sourceKpiId)));
      setCopyTargets({});
      setCopyDialog(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memuat pratinjau", "Failed to load preview"));
    }
  };
  const doCopyFromCycle = async () => {
    const d = detailApi.data?.detail;
    if (!d || !copyData) return;
    try {
      const res = await apiSend<{ copied: number }>(GOALS_API, "POST", {
        action: "copyFromCycle", cycleId: d.cycle.id, employeeId: d.employee.id, sourceCycleId: copyData.source.cycleId,
        items: Array.from(copySel).map((sid) => ({ sourceKpiId: sid, target: copyTargets[sid] != null && copyTargets[sid] !== "" ? Number(copyTargets[sid]) : undefined })),
        mode: copyData.existingCount > 0 ? "replace" : "merge",
      });
      toast.success(t("{n} KPI disalin dari {c} — capaian & bukti direset. Periksa target sebelum submit.", "{n} KPIs copied from {c} — achievements & evidence reset. Review targets before submitting.", { n: String(res.copied), c: copyData.source.cycleCode }));
      setCopyDialog(false);
      detailApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  // impor Excel (§18.5)
  const [importDialog, setImportDialog] = useState(wizardImport);
  useEffect(() => { if (wizardImport) setImportDialog(true); }, [wizardImport]);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{ rows: { row: number; valid: boolean; errors: string[]; employeeName: string; employeeNo: string; title: string; unit: string; weight: number | null; target: number | null }[]; validCount: number; errorCount: number } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const doImportPreview = async () => {
    if (!importFile || !cycleId) return;
    setImportBusy(true);
    try {
      const fd = new FormData();
      fd.append("action", "importPreview");
      fd.append("cycleId", cycleId);
      fd.append("file", importFile);
      const res = await fetch(GOALS_API, { method: "POST", credentials: "include", body: fd });
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
      const res = await apiSend<{ created: number; updated: number; skipped: number }>(GOALS_API, "POST", {
        action: "importCommit", cycleId, rows: importPreview.rows,
      });
      toast.success(t("Impor selesai: {c} draf dibuat · {s} dilewati. IMPOR ≠ SUBMIT — tiap peserta menunggu review + submit atasan.", "Import done: {c} drafts created · {s} skipped. IMPORT ≠ SUBMIT — each participant awaits manager review + submit.", { c: String(res.created), s: String(res.skipped) }));
      setImportDialog(false);
      setImportStep(1); setImportFile(null); setImportPreview(null);
      if (nav.params.wizard) { const p = { ...nav.params }; delete p.wizard; nav.setParams(p); }
      listApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setImportBusy(false); }
  };

  const weightSum = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const progress = useMemo(() => {
    if (rows.length === 0) return 0;
    let filled = 0;
    for (const r of rows) {
      if (r.target != null && (r.polarity === "Boolean" ? r.isCritical != null : r.thresholdMin != null)) filled++;
    }
    return Math.round((filled / rows.length) * 100);
  }, [rows]);
  const locked = meta ? ["GoalApproved", "Ongoing", "SelfDone", "ManagerDone", "Calibrating", "Finalized", "Published", "Appealed", "Closed"].includes(meta.status) : false;

  // ==================== RENDER: BUILDER ====================
  if (appraisalId && meta) {
    return (
      <div>
        <PageHeader
          eyebrow={t("Performance · Target & KPI")}
          title={`${meta.docNo} — ${meta.employeeName}`}
          description={`${meta.position ?? "—"} · ${t("siklus", "cycle")} ${meta.cycleCode}${meta.goalEnd ? ` · ${t("tenggat", "deadline")} ${new Date(meta.goalEnd).toLocaleDateString("id-ID")}` : ""}`}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => nav.navigate("performance", "goals")}>
                <X className="h-4 w-4" aria-hidden /> {t("Tutup Builder", "Close Builder")}
              </Button>
              {!locked && (
                <Button onClick={submit} disabled={rows.length === 0}>
                  <ClipboardCheck className="h-4 w-4" aria-hidden /> {t("SUBMIT TARGET →", "SUBMIT TARGET →")}
                </Button>
              )}
            </div>
          )}
        />

        {/* progress tracker bar (§18.7) */}
        <div className="mb-4 rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {t("Formulir Anda selesai {p}%", "Your form is {p}% complete", { p: String(progress) })}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              {saveState === "saving" ? <><Cloud className="h-3.5 w-3.5 animate-pulse" aria-hidden /> {t("Menyimpan…", "Saving…")}</>
                : saveState === "saved" ? <><Cloud className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> {t("Tersimpan otomatis", "Auto-saved")} {savedAt?.toLocaleTimeString("id-ID")}</>
                : <><CloudOff className="h-3.5 w-3.5" aria-hidden /> {t("draf lokal", "local draft")}</>}
              <span className="ml-2">{rows.length} KPI · Σ{Math.round(weightSum)}%</span>
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className={cn("h-full rounded-full transition-all", progress >= 100 ? "bg-emerald-500" : progress >= 50 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{rows.filter((r) => r.target != null).length}/{rows.length} KPI {t("ber-target", "targeted")} · {t("autosave tiap 3 dtk + mirror lokal", "autosave every 3s + local mirror")}</p>
        </div>

        {/* banner pemulihan draf lokal (§18.7) */}
        {localRecovery && !locked && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="flex-1">{t("Draf lokal ({n} baris, {t}) lebih baru — pulihkan?", "Local draft ({n} rows, {t}) is newer — restore?", { n: String(localRecovery.rows.length), t: new Date(localRecovery.savedAt).toLocaleTimeString("id-ID") })}</span>
            <Button size="sm" variant="outline" onClick={() => { setRows(localRecovery.rows); setLocalRecovery(null); setDirty(true); }}>{t("Pulihkan", "Restore")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { try { window.localStorage.removeItem(lsKey); } catch { /* */ } setLocalRecovery(null); }}>{t("Buang", "Discard")}</Button>
          </div>
        )}

        {/* banner pasca-salin (§18.4 anti-stale) */}
        {meta.goalsCopiedFrom && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            ⚠ {t("{n} KPI disalin dari {c} — periksa target sebelum submit (capaian periode baru kosong).", "{n} KPIs copied from {c} — review targets before submitting (new period achievements are empty).", { n: String(rows.length), c: meta.goalsCopiedFrom })}
          </div>
        )}

        {locked ? (
          <Card><CardContent className="p-6 text-center">
            <p className="mb-2 font-semibold">{t("Target sudah dikunci ({s}) — perubahan hanya lewat revisi mid-year (Alur 3).", "Targets are locked ({s}) — changes only via mid-year revision (Flow 3).", { s: meta.status })}</p>
          </CardContent></Card>
        ) : rows.length === 0 ? (
          // ===== 4 titik awal (§18.1-2) =====
          <div className="grid gap-3 md:grid-cols-3">
            <button
              onClick={openCopyPreview}
              disabled={!srcApi.data || srcApi.data.sources.length === 0}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all",
                srcApi.data && srcApi.data.sources.length > 0
                  ? "border-fuchsia-300 bg-fuchsia-50/60 hover:border-fuchsia-400 dark:border-fuchsia-800 dark:bg-fuchsia-950/20"
                  : "cursor-not-allowed border-slate-200 opacity-60 dark:border-slate-800",
              )}
            >
              <span className="flex items-center gap-2 font-semibold"><Copy className="h-5 w-5 text-fuchsia-600 dark:text-fuchsia-400" aria-hidden /> {t("SALIN DARI PERIODE SEBELUMNYA", "COPY FROM PREVIOUS CYCLE")}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">
                {srcApi.data && srcApi.data.sources.length > 0
                  ? t("Sumber: {c} — ★ disarankan", "Source: {c} — ★ recommended", { c: srcApi.data.sources[0].cycleCode })
                  : t("Tidak ada siklus sumber — gunakan pustaka atau mulai kosong", "No source cycle — use the library or start empty")}
              </span>
              <span className="text-[11px] text-slate-400">{t("Salin membawa judul+target+bobot tahun lalu; capaian & bukti direset.", "Copying brings last year's titles+targets+weights; achievements & evidence are reset.")}</span>
            </button>
            <button onClick={() => setLibDialog(true)} className="flex flex-col items-start gap-2 rounded-xl border-2 border-slate-200 p-4 text-left transition-all hover:border-fuchsia-300 dark:border-slate-800">
              <span className="flex items-center gap-2 font-semibold"><Target className="h-5 w-5 ov-text-accent" aria-hidden /> {t("PILIH DARI PUSTAKA", "PICK FROM LIBRARY")}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{t("Cari KPI per perspektif BSC — nilai AUTO ditarik otomatis saat penilaian.", "Search KPIs by BSC perspective — AUTO values are pulled at assessment.")}</span>
            </button>
            <button onClick={() => addRow({ title: "", polarity: "Higher", unit: "", weight: 0, target: 0 })} className="flex flex-col items-start gap-2 rounded-xl border-2 border-slate-200 p-4 text-left transition-all hover:border-fuchsia-300 dark:border-slate-800">
              <span className="flex items-center gap-2 font-semibold"><Plus className="h-5 w-5 ov-text-accent" aria-hidden /> {t("MULAI KOSONG", "START EMPTY")}</span>
              <span className="text-xs text-slate-600 dark:text-slate-300">{t("Susun sendiri 3–8 KPI (chip ideal: 5–8).", "Compose 3–8 KPIs yourself (ideal: 5–8).")}</span>
            </button>
          </div>
        ) : (
          // ===== editor baris KPI =====
          <Card>
            <CardContent className="p-4">
              {/* meter Σbobot */}
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-900">
                <Scale className="h-4 w-4 text-slate-400" aria-hidden />
                <div className="flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                    <div className={cn("h-full rounded-full transition-all", Math.abs(weightSum - 100) < 0.01 ? "bg-emerald-500" : weightSum > 100 ? "bg-rose-500" : "bg-amber-400")} style={{ width: `${Math.min(100, weightSum)}%` }} />
                  </div>
                </div>
                <span className={cn("text-sm font-bold tabular-nums", Math.abs(weightSum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {Math.round(weightSum)}%</span>
                {Math.abs(weightSum - 100) > 0.01 && (
                  <Button size="sm" variant="outline" onClick={() => {
                    // bagi rata sisa bobot ke baris yang bobotnya 0 (bantu cepat §18.1-3)
                    const rest = 100 - rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
                    const zeroRows = rows.filter((r) => !r.weight);
                    if (zeroRows.length > 0) {
                      const each = Math.round((rest / zeroRows.length) * 10) / 10;
                      zeroRows.forEach((z) => patchRow(z.id, { weight: each }));
                    } else {
                      const each = Math.round((rest / rows.length) * 10) / 10;
                      rows.forEach((r) => patchRow(r.id, { weight: (Number(r.weight) || 0) + each }));
                    }
                  }}>{t("Bagi rata sisa", "Distribute remainder")}</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setLibDialog(true)}><Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah KPI", "Add KPI")}</Button>
                <Button size="sm" variant="outline" onClick={openCopyPreview}><Copy className="h-3.5 w-3.5" aria-hidden /> {t("Salin periode lalu", "Copy previous")}</Button>
              </div>

              {/* baris KPI — mobile: kartu; desktop: grid */}
              <div className="grid gap-3">
                {rows.map((r, i) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800">{i + 1}</span>
                      <Input value={r.title} onChange={(e) => patchRow(r.id, { title: e.target.value })} placeholder={t("Judul KPI", "KPI title")} className="min-w-40 flex-1 font-medium" />
                      {r.dataSource !== "Manual" && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"><Zap className="h-3 w-3" aria-hidden /> AUTO</span>
                      )}
                      {r.origin === "CopiedFromCycle" && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400"><History className="h-3 w-3" aria-hidden /> {t("disalin", "copied")}</span>
                      )}
                      <Button size="sm" variant="ghost" className="ml-auto text-rose-600 dark:text-rose-400" onClick={() => deleteRow(r.id)} aria-label={t("Hapus", "Delete")}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Polaritas", "Polarity")}</Label>
                        <Select value={r.polarity} onValueChange={(v) => patchRow(r.id, { polarity: v })}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Higher">Higher ↑</SelectItem>
                            <SelectItem value="Lower">Lower ↓</SelectItem>
                            <SelectItem value="Boolean">0/1</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Satuan", "Unit")}</Label>
                        <Input value={r.unit} onChange={(e) => patchRow(r.id, { unit: e.target.value })} placeholder={t("% · Rp · hari", "% · Rp · days")} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Ambang (F)", "Threshold (F)")}</Label>
                        <Input type="number" inputMode="decimal" value={r.thresholdMin ?? ""} onChange={(e) => patchRow(r.id, { thresholdMin: e.target.value === "" ? null : Number(e.target.value) })} disabled={r.polarity === "Boolean"} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Target (T)", "Target (T)")}</Label>
                        <Input type="number" inputMode="decimal" value={r.target ?? ""} onChange={(e) => patchRow(r.id, { target: e.target.value === "" ? 0 : Number(e.target.value) })} className="h-8 text-xs font-semibold" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Stretch (S)", "Stretch (S)")}</Label>
                        <Input type="number" inputMode="decimal" value={r.stretchValue ?? ""} onChange={(e) => patchRow(r.id, { stretchValue: e.target.value === "" ? null : Number(e.target.value) })} className="h-8 text-xs" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-400">{t("Bobot %", "Weight %")}</Label>
                        <Input type="number" inputMode="decimal" value={r.weight ?? ""} onChange={(e) => patchRow(r.id, { weight: e.target.value === "" ? 0 : Number(e.target.value) })} className="h-8 text-xs font-semibold" />
                      </div>
                      <div className="flex items-end pb-1">
                        {r.polarity === "Boolean" && (
                          <label className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={r.isCritical} onCheckedChange={(v) => patchRow(r.id, { isCritical: Boolean(v) })} />
                            {t("kritis", "critical")}
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== picker pustaka ===== */}
        <Dialog open={libDialog} onOpenChange={setLibDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Target className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Pilih dari Pustaka KPI", "Pick from KPI Library")}</DialogTitle></DialogHeader>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input value={libQ} onChange={(e) => setLibQ(e.target.value)} placeholder={t("Cari pustaka… (Enter)", "Search library… (Enter)")} className="pl-8" />
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
              {(libApi.data?.rows ?? []).map((k) => (
                <button key={k.id} className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                  onClick={() => { addRow({ kpiDefId: k.id, title: k.name, polarity: k.polarity, unit: k.unit, dataSource: k.dataSource, sourceKey: k.sourceKey, weight: 0, target: 0 }); setLibDialog(false); }}>
                  <span className="flex-1">
                    <span className="font-medium">{k.name}</span>
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{k.code}</span>
                    <span className="block text-xs text-slate-500">{k.category} · {k.polarity} · {k.unit}{k.dataSource !== "Manual" ? " · AUTO" : ""}</span>
                  </span>
                  <Plus className="h-4 w-4 text-fuchsia-500" aria-hidden />
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* ===== dialog pratinjau salinan (§18.2) ===== */}
        <Dialog open={copyDialog} onOpenChange={setCopyDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t("Salin dari {c} — pratinjau", "Copy from {c} — preview", { c: copyData?.source.cycleCode ?? "" })}</DialogTitle>
            </DialogHeader>
            {copyData && (
              <>
                <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {t("Capaian & bukti TIDAK ikut disalin — direset kosong. Target baru dapat diedit sebelum menyalin. {n} dari {m} dipilih.", "Achievements & evidence are NOT copied — reset empty. New targets are editable before copying. {n} of {m} selected.", { n: String(copySel.size), m: String(copyData.rows.length) })}
                  {copyData.existingCount > 0 && t(" Peringatan: peserta sudah punya baris — mode GANTI.", " Note: participant already has rows — REPLACE mode.")}
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>{t("KPI", "KPI")}</TableHead>
                        <TableHead>{t("Polaritas", "Polarity")}</TableHead>
                        <TableHead>{t("Target lama", "Old target")}</TableHead>
                        <TableHead>{t("Target baru", "New target")}</TableHead>
                        <TableHead>{t("Bobot", "Weight")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {copyData.rows.map((r) => (
                        <TableRow key={r.sourceKpiId}>
                          <TableCell>
                            <Checkbox
                              checked={copySel.has(r.sourceKpiId)}
                              onCheckedChange={(v) => {
                                const next = new Set(copySel);
                                if (v) next.add(r.sourceKpiId); else next.delete(r.sourceKpiId);
                                setCopySel(next);
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <p className="font-medium">{r.title}</p>
                            {(r.defInactive || r.unitChanged) && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                {r.defInactive ? "⚠ " + t("pustaka non-aktif — periksa penggantinya", "library inactive — check its replacement") : ""}
                                {r.unitChanged ? "ⓘ " + t("satuan berubah", "unit changed") : ""}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{r.polarity} · {r.unit}</TableCell>
                          <TableCell className="tabular-nums">{r.target}</TableCell>
                          <TableCell>
                            <Input
                              type="number" inputMode="decimal"
                              value={copyTargets[r.sourceKpiId] ?? String(r.target)}
                              onChange={(e) => setCopyTargets({ ...copyTargets, [r.sourceKpiId]: e.target.value })}
                              className="h-8 w-20 text-xs"
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">{r.weight}%</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-slate-500">
                  Σ {t("bobot terpilih", "selected weight")}: {Array.from(copySel).reduce((s, sid) => s + (copyData.rows.find((r) => r.sourceKpiId === sid)?.weight ?? 0), 0).toFixed(0)}% {t("(validasi Σ=100 hanya saat submit)", "(Σ=100 validated at submit only)")}
                </p>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCopyDialog(false)}>{t("Batal")}</Button>
              <Button onClick={doCopyFromCycle} disabled={copySel.size === 0}>
                <Copy className="h-4 w-4" aria-hidden /> {t("Salin {n} baris → builder", "Copy {n} rows → builder", { n: String(copySel.size) })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ==================== RENDER: DAFTAR PESERTA ====================
  const parts = listApi.data?.rows ?? [];
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Target & KPI")}
        title={t("Target & KPI", "Goals & KPI")}
        description={t(
          "KPI Builder per peserta: salin dari periode sebelumnya, pilih dari pustaka, impor Excel massal — autosave + progress bar. Submit = kunci (Σbobot 100, 3–8 item).",
          "Per-participant KPI Builder: copy from previous cycle, pick from library, bulk Excel import — autosave + progress bar. Submit = lock (Σweight 100, 3–8 items).",
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setImportDialog(true); }} disabled={!cycleId}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden /> {t("Impor Excel", "Excel Import")}
            </Button>
          </div>
        )}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={cycleId} onValueChange={setCycleId}>
          <SelectTrigger className="w-72"><SelectValue placeholder={t("Pilih siklus…", "Pick a cycle…")} /></SelectTrigger>
          <SelectContent>
            {(cyclesApi.data?.rows ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setDq(q); }} placeholder={t("Cari peserta… (Enter)", "Search participants… (Enter)")} className="w-56 pl-8" />
        </div>
      </div>

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {!cycleId || cyclesApi.loading ? (
            <div className="p-4"><LoadingRows /></div>
          ) : parts.length === 0 ? (
            <div className="p-6">
              <EmptyState title={t("Belum ada peserta di siklus ini", "No participants in this cycle")} description={t("Buka Siklus Penilaian untuk enroll karyawan.", "Open Appraisal Cycles to enroll employees.")} icon={Users_} />
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    <TableHead>{t("Dokumen")}</TableHead>
                    <TableHead>{t("Karyawan", "Employee")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Atasan", "Manager")}</TableHead>
                    <TableHead>{t("KPI")}</TableHead>
                    <TableHead>{t("Progres")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parts.map((p) => (
                    <TableRow key={p.appraisalId} className="cursor-pointer" onClick={() => nav.navigate("performance", "goals", { id: p.appraisalId })}>
                      <TableCell className="font-mono text-xs">{p.docNo}</TableCell>
                      <TableCell>
                        <p className="font-semibold">{p.employeeName}</p>
                        <p className="text-xs text-slate-500">{p.employeeNo} · {p.position ?? "—"}</p>
                        {p.goalsCopiedFrom && <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-fuchsia-50 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400"><Copy className="h-2.5 w-2.5" aria-hidden /> {p.goalsCopiedFrom}</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">{p.managerName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{p.kpiCount > 0 ? `${p.kpiCount} · Σ${Math.round(p.weightSum)}%` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <div className={cn("h-full rounded-full", p.progressPct >= 100 ? "bg-emerald-500" : p.progressPct >= 50 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${p.progressPct}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-500">{p.progressPct}%</span>
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={p.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog impor Excel (§18.5 — 3 langkah) ===== */}
      <Dialog open={importDialog} onOpenChange={(o) => { setImportDialog(o); if (!o) setImportStep(1); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 ov-text-accent" aria-hidden /> {t("Impor Target via Excel", "Import Targets via Excel")}</DialogTitle>
          </DialogHeader>
          <div className="mb-3 flex items-center gap-2 text-xs">
            {[
              [1, t("1 Unduh template", "1 Download template")],
              [2, t("2 Unggah file", "2 Upload file")],
              [3, t("3 Pratinjau & commit", "3 Preview & commit")],
            ].map(([n, l]) => (
              <span key={String(n)} className={cn("rounded-full px-2.5 py-1 font-medium", importStep === n ? "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>{l}</span>
            ))}
          </div>
          {importStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {t("Template berisi sheet instruksi, sheet Data (header dwibahasa + baris contoh + dropdown validasi), dan daftar kode KPI pustaka. Batas: 500 baris, 2 MB.", "The template contains an instructions sheet, a Data sheet (bilingual headers + example row + validation dropdowns), and the KPI library code list. Limits: 500 rows, 2 MB.")}
              </p>
              <a href={`${GOALS_API}?importTemplate=targets&cycleId=${cycleId}`} download>
                <Button variant="outline"><Download className="h-4 w-4" aria-hidden /> {t("Unduh Template (.xlsx)", "Download Template (.xlsx)")}</Button>
              </a>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportDialog(false)}>{t("Batal")}</Button>
                <Button onClick={() => setImportStep(2)}>{t("Sudah punya file → Unggah", "Have a file → Upload")}</Button>
              </div>
            </div>
          )}
          {importStep === 2 && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-8 text-center transition-colors hover:border-fuchsia-400 dark:border-slate-700">
                <Upload className="h-8 w-8 text-slate-400" aria-hidden />
                <span className="text-sm font-medium">{importFile ? importFile.name : t("Pilih atau jatuhkan file .xlsx di sini", "Choose or drop a .xlsx file here")}</span>
                <input
                  type="file" accept=".xlsx" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportStep(1)}>{t("Kembali", "Back")}</Button>
                <Button onClick={doImportPreview} disabled={!importFile || importBusy}>{importBusy ? t("Memvalidasi…", "Validating…") : t("Pratinjau Validasi →", "Validate Preview →")}</Button>
              </div>
            </div>
          )}
          {importStep === 3 && importPreview && (
            <div className="space-y-3">
              <p className={cn("rounded-lg p-2.5 text-sm", importPreview.errorCount > 0 ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300")}>
                {t("{v} baris valid ✓ · {e} error — commit hanya baris valid (baris error TIDAK membatalkan baris lain).", "{v} valid rows ✓ · {e} errors — only valid rows commit (error rows do NOT cancel others).", { v: String(importPreview.validCount), e: String(importPreview.errorCount) })}
              </p>
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50/95 dark:bg-slate-900/95">
                    <TableRow>
                      <TableHead>{t("Baris", "Row")}</TableHead>
                      <TableHead>{t("Karyawan", "Employee")}</TableHead>
                      <TableHead>{t("KPI")}</TableHead>
                      <TableHead>{t("Target / Bobot", "Target / Weight")}</TableHead>
                      <TableHead>{t("Hasil", "Result")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.rows.map((r) => (
                      <TableRow key={r.row} className={r.valid ? "" : "bg-rose-50/60 dark:bg-rose-950/20"}>
                        <TableCell className="font-mono text-xs">{r.row}</TableCell>
                        <TableCell className="text-sm">{r.employeeName}<span className="block text-[10px] text-slate-400">{r.employeeNo}</span></TableCell>
                        <TableCell className="text-sm">{r.title}</TableCell>
                        <TableCell className="text-xs tabular-nums">{r.target ?? "—"} / {r.weight ?? "—"}%</TableCell>
                        <TableCell className="text-xs">
                          {r.valid
                            ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                            : <ul className="list-disc pl-3 text-rose-600 dark:text-rose-400">{r.errors.map((er, i) => <li key={i}>{er}</li>)}</ul>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportStep(2)}>{t("Unggah ulang", "Re-upload")}</Button>
                <Button onClick={doImportCommit} disabled={importBusy || importPreview.validCount === 0}>
                  <Save className="h-4 w-4" aria-hidden /> {t("Commit {n} baris valid →", "Commit {n} valid rows →", { n: String(importPreview.validCount) })}
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">{t("IMPOR ≠ SUBMIT — hasil = baris draf; tiap peserta tetap menunggu review + submit atasan.", "IMPORT ≠ SUBMIT — result = draft rows; each participant still awaits manager review + submit.")}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ikon lokal utk EmptyState (hindari konflik nama)
import { Users as Users_ } from "lucide-react";
