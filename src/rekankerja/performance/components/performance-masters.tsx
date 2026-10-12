"use client";
// P0-PERF — Master Kinerja (§17 masters; AMANDEMEN 2 §18.9 versioning pustaka):
// 5 kind via ?kind= kpi|competency|scale|template|meritMatrix.
// Fitur versioning: edit minor inline; perubahan definitif → dialog
// "Simpan sebagai versi baru" (tahun berlaku + catatan); arsip lembut;
// riwayat versi per kode (dialog diff ringkas). Badge AUTO utk KPI ber-sumber.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { COMPETENCY_LEVEL_LABELS, COMPETENCY_LEVEL_LABELS_EN } from "@/rekankerja/performance/services/perf-defaults";
import {
  Boxes, Plus, Pencil, Trash2, Search, Target, NotebookPen, Gauge, FileStack, Coins,
  History, Layers, Archive, ArchiveRestore, Zap, Lightbulb,
} from "lucide-react";

// ============ tipe baris ============
interface KpiRow {
  id: string; code: string; name: string; category: string; polarity: string; unit: string;
  dataSource: string; sourceKey: string | null; description: string | null;
  active: boolean; versionNo: number; effectiveYear: number; status: string;
  supersededById: string | null; changeNote: string | null;
}
interface CompRow {
  id: string; code: string; name: string; kind: string; levelsJson: string;
  active: boolean; versionNo: number; effectiveYear: number; status: string;
  supersededById: string | null; changeNote: string | null;
}
interface ScaleRow { id: string; value: number; labelId: string; labelEn: string; minScore: number; color: string; guideline: string | null }
interface TplItem { id: string; templateId: string; kind: string; refId: string; weight: number }
interface TplRow { id: string; code: string; name: string; weightsJson: string; active: boolean; items: TplItem[] }
interface MeritRow { id: string; code: string; name: string; gridJson: string; active: boolean }

const KIND_TABS: { kind: string; label: [string, string]; icon: React.ElementType }[] = [
  { kind: "kpi", label: ["Pustaka KPI", "KPI Library"], icon: Target },
  { kind: "competency", label: ["Kompetensi", "Competencies"], icon: NotebookPen },
  { kind: "scale", label: ["Skala Rating", "Rating Scale"], icon: Gauge },
  { kind: "template", label: ["Template Bobot", "Weight Templates"], icon: FileStack },
  { kind: "meritMatrix", label: ["Matriks Merit", "Merit Matrix"], icon: Coins },
];

// triple [value, labelID, labelEN] — konvensi R2 (render t(o[1], o[2]))
const BSC_OPTIONS: [string, string, string][] = [
  ["Financial", "Financial", "Financial"],
  ["Customer", "Customer", "Customer"],
  ["InternalProcess", "Internal Process", "Internal Process"],
  ["LearningGrowth", "Learning & Growth", "Learning & Growth"],
];
const POLARITY_OPTIONS: [string, string, string][] = [
  ["Higher", "Higher (makin tinggi makin baik)", "Higher (more is better)"],
  ["Lower", "Lower (makin rendah makin baik)", "Lower (less is better)"],
  ["Boolean", "Boolean (0/1)", "Boolean (0/1)"],
];
const SOURCE_OPTIONS: [string, string, string][] = [
  ["Manual", "Manual", "Manual"], ["Attendance", "Attendance", "Attendance"],
  ["Payroll", "Payroll", "Payroll"], ["Recruitment", "Recruitment", "Recruitment"], ["Leave", "Leave", "Leave"],
];
const COMP_KIND_OPTIONS: [string, string, string][] = [
  ["CoreValue", "Nilai Inti", "Core Values"],
  ["Managerial", "Manajerial", "Managerial"],
  ["Technical", "Teknis", "Technical"],
];
const RATING_COLORS: [string, string, string][] = [
  ["emerald", "emerald", "emerald"], ["teal", "teal", "teal"], ["lime", "lime", "lime"],
  ["amber", "amber", "amber"], ["rose", "rose", "rose"],
];
const COLOR_CLASS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400",
  lime: "bg-lime-50 text-lime-700 dark:bg-lime-950/60 dark:text-lime-400",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
  rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400",
};

function StatusPill({ status, active }: { status: string; active: boolean }) {
  const { t } = useI18n();
  if (status === "Superseded") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t("Superseded", "Superseded")}</span>;
  }
  if (status === "Archived") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{t("Arsip", "Archived")}</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
      active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
      {active ? t("Aktif") : t("Nonaktif", "Inactive")}
    </span>
  );
}

export function PerformanceMastersPage() {
  const { t } = useI18n();
  const [kind, setKind] = useState<string>("kpi");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState(""); // debounce sederhana via tombol & enter
  const [category, setCategory] = useState<string>("all");
  const [includeArchived, setIncludeArchived] = useState(true);

  const url = useMemo(() => {
    const p = new URLSearchParams({ kind });
    if (dq) p.set("q", dq);
    if (kind === "kpi" && category !== "all") p.set("category", category);
    if (kind === "kpi" || kind === "competency") p.set("includeArchived", String(includeArchived));
    return `/api/rekankerja/performance/masters?${p.toString()}`;
  }, [kind, dq, category, includeArchived]);
  const api = useApi<{ rows: unknown[] }>(url, [url]);

  const [dialog, setDialog] = useState<null | "edit" | "version">(null); // "version" = simpan sebagai versi baru (§18.9 — field definitif TERBUKA)
  const [busy, setBusy] = useState(false);
  const [historyCode, setHistoryCode] = useState<string | null>(null);

  // ============ form state (per kind) ============
  const [kpiForm, setKpiForm] = useState({ id: "", code: "", name: "", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Manual", sourceKey: "", description: "", active: true });
  const [compForm, setCompForm] = useState<{ id: string; code: string; name: string; kind: string; levels: { label: string; descriptor: string }[]; active: boolean }>({
    id: "", code: "", name: "", kind: "Technical",
    levels: COMPETENCY_LEVEL_LABELS.map((label) => ({ label, descriptor: "" })),
    active: true,
  });
  const [scaleForm, setScaleForm] = useState({ id: "", value: "5", labelId: "", labelEn: "", minScore: "90", color: "emerald", guideline: "" });
  const [tplForm, setTplForm] = useState({ id: "", code: "", name: "", kpi: "70", competency: "20", core: "10", active: true });
  const [meritForm, setMeritForm] = useState({ id: "", code: "", name: "", grid: "{}", active: true });
  const [versForm, setVersForm] = useState({ id: "", code: "", effectiveYear: String(new Date().getFullYear() + 1), changeNote: "" });

  const rows = (api.data?.rows ?? []) as unknown[];

  // ============ aksi ============
  const openNew = () => {
    if (kind === "kpi") setKpiForm({ id: "", code: "", name: "", category: "InternalProcess", polarity: "Higher", unit: "%", dataSource: "Manual", sourceKey: "", description: "", active: true });
    if (kind === "competency") setCompForm((f) => ({ ...f, id: "", code: "", name: "", kind: "Technical", active: true }));
    if (kind === "scale") setScaleForm({ id: "", value: "5", labelId: "", labelEn: "", minScore: "90", color: "emerald", guideline: "" });
    if (kind === "template") setTplForm({ id: "", code: "", name: "", kpi: "70", competency: "20", core: "10", active: true });
    if (kind === "meritMatrix") setMeritForm({ id: "", code: "", name: "", grid: JSON.stringify({ 5: { bonusMonths: 2, raisePct: [8, 12] }, 4: { bonusMonths: 1.5, raisePct: [6, 8] }, 3: { bonusMonths: 1, raisePct: [4, 6] }, 2: { bonusMonths: 0.5, raisePct: [0, 2] }, 1: { bonusMonths: 0, raisePct: [0, 0] } }, null, 2), active: true });
    setDialog("edit");
  };

  const openEditKpi = (r: KpiRow) => setKpiForm({ id: r.id, code: r.code, name: r.name, category: r.category, polarity: r.polarity, unit: r.unit, dataSource: r.dataSource, sourceKey: r.sourceKey ?? "", description: r.description ?? "", active: r.active });
  const openEditComp = (r: CompRow) => {
    let levels: { label: string; descriptor: string }[] = [];
    try {
      const parsed = JSON.parse(r.levelsJson) as { label: string; descriptor: string }[];
      levels = Array.from({ length: 5 }, (_, i) => ({ label: parsed[i]?.label ?? String(i + 1), descriptor: parsed[i]?.descriptor ?? "" }));
    } catch { levels = compForm.levels; }
    setCompForm({ id: r.id, code: r.code, name: r.name, kind: r.kind, levels, active: r.active });
  };
  const openEditScale = (r: ScaleRow) => setScaleForm({ id: r.id, value: String(r.value), labelId: r.labelId, labelEn: r.labelEn, minScore: String(r.minScore), color: r.color, guideline: r.guideline ?? "" });
  const openEditTpl = (r: TplRow) => {
    try {
      const w = JSON.parse(r.weightsJson) as { kpi?: number; competency?: number; core?: number };
      setTplForm({ id: r.id, code: r.code, name: r.name, kpi: String(w.kpi ?? 70), competency: String(w.competency ?? 20), core: String(w.core ?? 10), active: r.active });
    } catch { setTplForm({ id: r.id, code: r.code, name: r.name, kpi: "70", competency: "20", core: "10", active: r.active }); }
  };
  const openEditMerit = (r: MeritRow) => {
    let pretty = r.gridJson;
    try { pretty = JSON.stringify(JSON.parse(r.gridJson), null, 2); } catch { /* biarkan */ }
    setMeritForm({ id: r.id, code: r.code, name: r.name, grid: pretty, active: r.active });
  };

  const openEdit = (r: unknown) => {
    if (kind === "kpi") openEditKpi(r as KpiRow);
    else if (kind === "competency") openEditComp(r as CompRow);
    else if (kind === "scale") openEditScale(r as ScaleRow);
    else if (kind === "template") openEditTpl(r as TplRow);
    else openEditMerit(r as MeritRow);
    setDialog("edit");
  };

  const save = async () => {
    setBusy(true);
    try {
      if (kind === "kpi") {
        await apiSend("/api/rekankerja/performance/masters", "POST", {
          kind, id: kpiForm.id || undefined, code: kpiForm.code, name: kpiForm.name,
          category: kpiForm.id ? undefined : kpiForm.category,
          polarity: kpiForm.id ? undefined : kpiForm.polarity,
          unit: kpiForm.id ? undefined : kpiForm.unit,
          dataSource: kpiForm.id ? undefined : kpiForm.dataSource,
          sourceKey: kpiForm.id ? undefined : (kpiForm.dataSource === "Manual" ? null : kpiForm.sourceKey || null),
          description: kpiForm.description || null, active: kpiForm.active,
        });
      } else if (kind === "competency") {
        const filled = compForm.levels.every((l) => l.descriptor.trim());
        if (!filled) throw new Error(t("Deskriptor 5 level wajib terisi semua (anchor anti-halo §8)", "All 5 level descriptors must be filled (anti-halo anchors §8)"));
        await apiSend("/api/rekankerja/performance/masters", "POST", {
          kind, id: compForm.id || undefined, code: compForm.code, name: compForm.name,
          compKind: compForm.id ? undefined : compForm.kind,
          levelsJson: compForm.id ? undefined : JSON.stringify(compForm.levels.map((l, i) => ({ level: i + 1, label: l.label, descriptor: l.descriptor }))),
          active: compForm.active,
        });
      } else if (kind === "scale") {
        await apiSend("/api/rekankerja/performance/masters", "POST", {
          kind, id: scaleForm.id || undefined, value: Number(scaleForm.value), labelId: scaleForm.labelId, labelEn: scaleForm.labelEn,
          minScore: Number(scaleForm.minScore), color: scaleForm.color, guideline: scaleForm.guideline || null,
        });
      } else if (kind === "template") {
        const sum = Number(tplForm.kpi) + Number(tplForm.competency) + Number(tplForm.core);
        if (Math.abs(sum - 100) > 0.01) throw new Error(t("Jumlah bobot harus 100", "Weights must total 100"));
        await apiSend("/api/rekankerja/performance/masters", "POST", {
          kind, id: tplForm.id || undefined, code: tplForm.code, name: tplForm.name,
          weightsJson: JSON.stringify({ kpi: Number(tplForm.kpi), competency: Number(tplForm.competency), core: Number(tplForm.core) }),
          active: tplForm.active,
        });
      } else {
        JSON.parse(meritForm.grid); // validasi
        await apiSend("/api/rekankerja/performance/masters", "POST", {
          kind, id: meritForm.id || undefined, code: meritForm.code, name: meritForm.name, gridJson: meritForm.grid, active: meritForm.active,
        });
      }
      toast.success(t("Master disimpan", "Master saved"));
      setDialog(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: { id: string; code?: string; name?: string }) => {
    if (!window.confirm(t(`Hapus ${r.code ?? r.id} — ${r.name ?? ""}? (Hapus permanen — bila dirujuk penilaian akan ditolak)`, `Delete ${r.code ?? r.id} — ${r.name ?? ""}? (Permanent — rejected if referenced by appraisals)`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?kind=${kind}&id=${r.id}`, "DELETE");
      toast.success(t("Master dihapus", "Master deleted"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus", "Failed to delete"));
    }
  };

  const archive = async (r: { id: string }, unarchive: boolean) => {
    try {
      await apiSend("/api/rekankerja/performance/masters", "POST", { action: "archive", kind, id: r.id, unarchive });
      toast.success(unarchive ? t("Definisi diaktifkan kembali", "Definition reactivated") : t("Definisi diarsipkan (lembut)", "Definition archived (soft)"));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    }
  };

  const openNewVersion = (r: KpiRow | CompRow) => {
    // muat isi baris ke form (field definitif TERBUKA di mode version) lalu
    // dialog utama menyimpan sebagai versi baru — efektifTahun + catatan wajib.
    setVersForm({ id: r.id, code: r.code, effectiveYear: String(new Date().getFullYear() + 1), changeNote: "" });
    if (kind === "kpi") {
      const k = r as KpiRow;
      setKpiForm({ id: k.id, code: k.code, name: k.name, category: k.category, polarity: k.polarity, unit: k.unit, dataSource: k.dataSource, sourceKey: k.sourceKey ?? "", description: k.description ?? "", active: true });
    } else {
      const c = r as CompRow;
      openEditComp(c);
    }
    setDialog("version");
  };

  const saveNewVersion = async () => {
    setBusy(true);
    try {
      const data: Record<string, unknown> = {};
      if (kind === "kpi") {
        if (!kpiForm.name.trim()) throw new Error(t("Nama wajib diisi", "Name is required"));
        Object.assign(data, { name: kpiForm.name, category: kpiForm.category, polarity: kpiForm.polarity, unit: kpiForm.unit, dataSource: kpiForm.dataSource, sourceKey: kpiForm.dataSource === "Manual" ? null : kpiForm.sourceKey || null, description: kpiForm.description || null, active: true });
      } else {
        if (!compForm.name.trim()) throw new Error(t("Nama wajib diisi", "Name is required"));
        if (!compForm.levels.every((l) => l.descriptor.trim())) throw new Error(t("Deskriptor 5 level wajib terisi semua", "All 5 level descriptors must be filled"));
        Object.assign(data, { name: compForm.name, kind: compForm.kind, levelsJson: JSON.stringify(compForm.levels.map((l, i) => ({ level: i + 1, label: l.label, descriptor: l.descriptor }))), active: true });
      }
      await apiSend("/api/rekankerja/performance/masters", "POST", {
        action: "newVersion", kind, id: versForm.id, changeNote: versForm.changeNote, effectiveYear: Number(versForm.effectiveYear), data,
      });
      toast.success(t("Versi baru dibuat — versi lama jadi Superseded", "New version created — old one superseded"));
      setDialog(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal membuat versi", "Failed to create version"));
    } finally {
      setBusy(false);
    }
  };

  const historyApi = useApi<{ rows: (KpiRow & CompRow)[] }>(historyCode ? `/api/rekankerja/performance/masters?kind=${kind}&historyOf=${encodeURIComponent(historyCode)}` : null, [historyCode, kind]);

  // ============ render ============
  return (
    <div>
      <PageHeader
        eyebrow={t("Performance · Master Kinerja")}
        title={t("Master Kinerja", "Performance Masters")}
        description={t(
          "Pustaka KPI (starter-pack 40, 4 perspektif BSC), kompetensi ber-deskriptor 5 level, skala rating, template bobot jabatan, dan matriks merit. Pustaka ber-VERSI: perubahan definitif dibuat sebagai versi baru (tahun berlaku) — data penilaian tahun-tahun lalu tetap utuh.",
          "KPI library (40 starter-pack, 4 BSC perspectives), competencies with 5-level descriptors, rating scale, job weight templates, and the merit matrix. The library is VERSIONED: definitive changes become a new version (effective year) — past appraisal data stays intact.",
        )}
        actions={(
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" aria-hidden /> {t("Master Baru", "New Master")}
          </Button>
        )}
      />

      <Tabs value={kind} onValueChange={(v) => { setKind(v); setQ(""); setDq(""); }} className="mb-4 w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
          {KIND_TABS.map((m) => {
            const Icon = m.icon;
            return (
              <TabsTrigger key={m.kind} value={m.kind}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(m.label[0], m.label[1])}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {(kind === "kpi" || kind === "competency") && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setDq(q); }}
              placeholder={t("Cari kode / nama… (Enter)", "Search code / name… (Enter)")}
              className="w-64 pl-8" />
          </div>
          {kind === "kpi" && (
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua perspektif", "All perspectives")}</SelectItem>
                {BSC_OPTIONS.map(([v, lid, len]) => <SelectItem key={v} value={v}>{t(lid, len)}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Checkbox checked={includeArchived} onCheckedChange={(v) => setIncludeArchived(Boolean(v))} />
            {t("Tampilkan arsip", "Show archived")}
          </label>
        </div>
      )}

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-0">
          {api.loading && !api.data ? (
            <div className="p-4"><LoadingRows /></div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={t("Belum ada data master ini", "No data in this master yet")}
                description={t("Tambahkan lewat tombol Master Baru.", "Add one via the New Master button.")}
                icon={Boxes}
              />
            </div>
          ) : (
            <div className="max-h-[34rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                  <TableRow>
                    {kind === "kpi" && <TableHead>{t("Perspektif", "Perspective")}</TableHead>}
                    {kind !== "scale" && <TableHead className="font-mono text-xs">{t("Kode", "Code")}</TableHead>}
                    {kind === "scale" && <TableHead>{t("Nilai", "Value")}</TableHead>}
                    <TableHead>{t("Nama", "Name")}</TableHead>
                    {(kind === "kpi" || kind === "competency") && <TableHead>{t("Versi", "Version")}</TableHead>}
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((raw) => {
                    const r = raw as KpiRow & CompRow & ScaleRow & TplRow & MeritRow;
                    return (
                      <TableRow key={r.id} className={cn((r.status === "Archived" || r.active === false) && "opacity-60")}>
                        {kind === "kpi" && (
                          <TableCell className="text-xs">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {(() => { const o = BSC_OPTIONS.find(([v]) => v === r.category); return t(o?.[1] ?? r.category, o?.[2] ?? r.category); })()}
                            </span>
                          </TableCell>
                        )}
                        {kind !== "scale" && <TableCell className="font-mono text-xs font-semibold">{r.code}</TableCell>}
                        {kind === "scale" && <TableCell className="text-lg font-bold tabular-nums">{r.value}</TableCell>}
                        <TableCell>
                          <p className="font-semibold">{r.name}</p>
                          {kind === "kpi" && (
                            <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <span>{t("Polaritas", "Polarity")}: {r.polarity}</span>
                              <span>· {r.unit}</span>
                              {r.dataSource !== "Manual" && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-400">
                                  <Zap className="h-3 w-3" aria-hidden /> AUTO
                                </span>
                              )}
                              {r.description && <span className="hidden md:inline">· {r.description}</span>}
                            </span>
                          )}
                          {kind === "competency" && (
                            <span className="text-xs text-slate-500">
                              {(() => { const o = COMP_KIND_OPTIONS.find(([v]) => v === r.kind); return t(o?.[1] ?? r.kind, o?.[2] ?? r.kind); })()} · 5 {t("level deskriptor", "level descriptors")}
                            </span>
                          )}
                          {kind === "scale" && (
                            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold", COLOR_CLASS[r.color] ?? COLOR_CLASS.emerald)}>
                              ≥ {r.minScore} · {r.labelEn}
                            </span>
                          )}
                          {kind === "template" && (() => {
                            try {
                              const w = JSON.parse(r.weightsJson) as { kpi?: number; competency?: number; core?: number };
                              return <span className="text-xs text-slate-500">KPI {w.kpi} · {t("Kompetensi", "Competency")} {w.competency} · {t("Nilai inti", "Core")} {w.core} · {r.items?.length ?? 0} {t("item", "items")}</span>;
                            } catch { return null; }
                          })()}
                          {kind === "meritMatrix" && (() => {
                            try {
                              const g = JSON.parse(r.gridJson) as Record<string, { bonusMonths?: number }>;
                              return <span className="text-xs text-slate-500">{Object.keys(g).filter((k) => Number.isFinite(Number(k))).map((k) => `${k}:${g[k]?.bonusMonths ?? 0}${t("bln", "mo")}`).join(" · ")}</span>;
                            } catch { return null; }
                          })()}
                        </TableCell>
                        {(kind === "kpi" || kind === "competency") && (
                          <TableCell>
                            <button className="group inline-flex items-center gap-1" onClick={() => setHistoryCode(r.code)} title={t("Lihat riwayat versi", "View version history")}>
                              <span className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-[11px] font-semibold text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400">v{r.versionNo}</span>
                              <span className="text-[11px] text-slate-400">{t("sejak", "since")} {r.effectiveYear}</span>
                              <History className="h-3 w-3 text-slate-300 group-hover:text-fuchsia-500" aria-hidden />
                            </button>
                          </TableCell>
                        )}
                        <TableCell>
                          {kind === "kpi" || kind === "competency" ? <StatusPill status={r.status} active={r.active} /> : (
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                              r.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                              {r.active ? t("Aktif") : t("Nonaktif", "Inactive")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(raw)} aria-label={t("Ubah", "Edit")}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {(kind === "kpi" || kind === "competency") && r.status === "Active" && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => openNewVersion(r)} title={t("Simpan sebagai versi baru", "Save as new version")} aria-label={t("Versi baru", "New version")}>
                                  <Layers className="h-3.5 w-3.5 text-fuchsia-600 dark:text-fuchsia-400" />
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => archive(r, false)} title={t("Arsipkan (lembut)", "Archive (soft)")} aria-label={t("Arsipkan", "Archive")}>
                                  <Archive className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            {(kind === "kpi" || kind === "competency") && r.status === "Archived" && (
                              <Button size="sm" variant="ghost" onClick={() => archive(r, true)} title={t("Aktifkan kembali", "Reactivate")} aria-label={t("Aktifkan kembali", "Reactivate")}>
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => remove(r)} aria-label={t("Hapus", "Delete")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {(kind === "kpi" || kind === "competency") && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
          {t(
            "Edit inline hanya untuk perubahan minor (nama/deskripsi/aktif). Perubahan satuan, polaritas, kategori, sumber data, atau deskriptor level bersifat DEFINITIF — gunakan tombol berlapis (Simpan sebagai versi baru) agar data penilaian periode lalu tidak berubah.",
            "Inline edit is for minor changes only (name/description/active). Changing unit, polarity, category, data source, or level descriptors is DEFINITIVE — use the layered button (Save as new version) so past appraisal data stays intact.",
          )}
        </p>
      )}

      {/* ===== Dialog form per kind ===== */}
      <Dialog open={dialog !== null} onOpenChange={(o) => setDialog(o ? (dialog ?? "edit") : null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialog === "version" && <Layers className="h-5 w-5 ov-text-accent" aria-hidden />}
              {kind === "kpi" ? (kpiForm.id && dialog === "edit" ? t("Ubah Definisi KPI", "Edit KPI Definition") : dialog === "version" ? t("Versi Baru — KPI", "New Version — KPI") : t("Definisi KPI Baru", "New KPI Definition"))
                : kind === "competency" ? (compForm.id && dialog === "edit" ? t("Ubah Kompetensi", "Edit Competency") : dialog === "version" ? t("Versi Baru — Kompetensi", "New Version — Competency") : t("Kompetensi Baru", "New Competency"))
                : kind === "scale" ? (scaleForm.id ? t("Ubah Skala Rating", "Edit Rating Scale") : t("Skala Rating Baru", "New Rating Scale"))
                : kind === "template" ? (tplForm.id ? t("Ubah Template Bobot", "Edit Weight Template") : t("Template Bobot Baru", "New Weight Template"))
                : (meritForm.id ? t("Ubah Matriks Merit", "Edit Merit Matrix") : t("Matriks Merit Baru", "New Merit Matrix"))}
            </DialogTitle>
          </DialogHeader>

          {kind === "kpi" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Kode *", "Code *")}</Label>
                <Input value={kpiForm.code} onChange={(e) => setKpiForm({ ...kpiForm, code: e.target.value })} disabled={dialog === "edit"} placeholder={t("mis. IP-KEHADIRAN", "e.g. IP-KEHADIRAN")} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Nama *", "Name *")}</Label>
                <Input value={kpiForm.name} onChange={(e) => setKpiForm({ ...kpiForm, name: e.target.value })} placeholder={t("mis. Persentase kehadiran", "e.g. Attendance percentage")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Perspektif BSC *", "BSC Perspective *")}</Label>
                <Select value={kpiForm.category} onValueChange={(v) => setKpiForm({ ...kpiForm, category: v })} disabled={dialog === "edit"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BSC_OPTIONS.map(([v, lid, len]) => <SelectItem key={v} value={v}>{t(lid, len)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Polaritas *", "Polarity *")}</Label>
                <Select value={kpiForm.polarity} onValueChange={(v) => setKpiForm({ ...kpiForm, polarity: v })} disabled={dialog === "edit"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{POLARITY_OPTIONS.map(([v, lid, len]) => <SelectItem key={v} value={v}>{t(lid, len)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Satuan *", "Unit *")}</Label>
                <Input value={kpiForm.unit} onChange={(e) => setKpiForm({ ...kpiForm, unit: e.target.value })} disabled={dialog === "edit"} placeholder={t("% · Rp · hari · kasus", "% · Rp · days · cases")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Sumber Data *", "Data Source *")}</Label>
                <Select value={kpiForm.dataSource} onValueChange={(v) => setKpiForm({ ...kpiForm, dataSource: v, sourceKey: v === "Manual" ? "" : kpiForm.sourceKey })} disabled={dialog === "edit"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCE_OPTIONS.map(([v, lid, len]) => <SelectItem key={v} value={v}>{t(lid, len)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {kpiForm.dataSource !== "Manual" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("Binding Sumber Otomatis (sourceKey)", "Auto-Source Binding (sourceKey)")}</Label>
                  <Input value={kpiForm.sourceKey} onChange={(e) => setKpiForm({ ...kpiForm, sourceKey: e.target.value })} disabled={dialog === "edit"} placeholder="attendance_presence_pct" className="font-mono text-xs" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("KPI ber-sumber diisi otomatis saat fase penilaian (§18.6) — nilai + bukti sumber tersimpan.", "Sourced KPIs are auto-filled during the assessment phase (§18.6) — value + source evidence are stored.")}
                  </p>
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Deskripsi / definisi", "Description / definition")}</Label>
                <Textarea value={kpiForm.description} onChange={(e) => setKpiForm({ ...kpiForm, description: e.target.value })} rows={2} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox checked={kpiForm.active} onCheckedChange={(v) => setKpiForm({ ...kpiForm, active: Boolean(v) })} />
                {t("Aktif (muncul di picker)", "Active (shown in picker)")}
              </div>
            </div>
          )}

          {kind === "competency" && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t("Kode *", "Code *")}</Label>
                  <Input value={compForm.code} onChange={(e) => setCompForm({ ...compForm, code: e.target.value })} disabled={dialog === "edit"} placeholder="TC-ANALITIS" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Nama *", "Name *")}</Label>
                  <Input value={compForm.name} onChange={(e) => setCompForm({ ...compForm, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Jenis *", "Kind *")}</Label>
                  <Select value={compForm.kind} onValueChange={(v) => setCompForm({ ...compForm, kind: v })} disabled={dialog === "edit"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{COMP_KIND_OPTIONS.map(([v, lid, len]) => <SelectItem key={v} value={v}>{t(lid, len)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium">{t("Deskriptor 5 Level (anchor anti-halo §8)", "5-Level Descriptors (anti-halo anchors §8)")}</p>
                <div className="grid gap-2">
                  {compForm.levels.map((l, i) => (
                    <div key={i} className="grid gap-1.5 rounded-lg border border-slate-200 p-2 dark:border-slate-800 sm:grid-cols-[10rem_1fr]">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fuchsia-50 text-xs font-bold text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400">{i + 1}</span>
                        <Input value={t(l.label, COMPETENCY_LEVEL_LABELS_EN[i] ?? l.label)} onChange={(e) => setCompForm({ ...compForm, levels: compForm.levels.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} disabled={dialog === "edit"} className="h-8 text-xs" />
                      </div>
                      <Textarea value={l.descriptor} onChange={(e) => setCompForm({ ...compForm, levels: compForm.levels.map((x, j) => (j === i ? { ...x, descriptor: e.target.value } : x)) })} disabled={dialog === "edit"} rows={2} placeholder={t("Perilaku yang teramati pada level ini…", "Observable behavior at this level…")} className="text-xs" />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox checked={compForm.active} onCheckedChange={(v) => setCompForm({ ...compForm, active: Boolean(v) })} />
                {t("Aktif (muncul di picker)", "Active (shown in picker)")}
              </div>
            </div>
          )}

          {kind === "scale" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Nilai Rating (1–9) *", "Rating Value (1–9) *")}</Label>
                <Input type="number" min={1} max={9} value={scaleForm.value} onChange={(e) => setScaleForm({ ...scaleForm, value: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Skor Minimum *", "Minimum Score *")}</Label>
                <Input type="number" min={0} max={120} value={scaleForm.minScore} onChange={(e) => setScaleForm({ ...scaleForm, minScore: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Label (ID) *", "Label (ID) *")}</Label>
                <Input value={scaleForm.labelId} onChange={(e) => setScaleForm({ ...scaleForm, labelId: e.target.value })} placeholder="Sangat Baik" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Label (EN) *", "Label (EN) *")}</Label>
                <Input value={scaleForm.labelEn} onChange={(e) => setScaleForm({ ...scaleForm, labelEn: e.target.value })} placeholder="Outstanding" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Warna", "Color")}</Label>
                <Select value={scaleForm.color} onValueChange={(v) => setScaleForm({ ...scaleForm, color: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RATING_COLORS.map(([v]) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Panduan deskriptor", "Descriptor guideline")}</Label>
                <Textarea value={scaleForm.guideline} onChange={(e) => setScaleForm({ ...scaleForm, guideline: e.target.value })} rows={2} />
              </div>
            </div>
          )}

          {kind === "template" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Kode *", "Code *")}</Label>
                <Input value={tplForm.code} onChange={(e) => setTplForm({ ...tplForm, code: e.target.value })} disabled={Boolean(tplForm.id)} placeholder="STAFF-STD" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Nama *", "Name *")}</Label>
                <Input value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} placeholder={t("mis. Staff GA Standar", "e.g. GA Staff Standard")} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Bobot KPI (%) *", "KPI Weight (%) *")}</Label>
                <Input type="number" min={0} max={100} value={tplForm.kpi} onChange={(e) => setTplForm({ ...tplForm, kpi: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Bobot Kompetensi (%) *", "Competency Weight (%) *")}</Label>
                <Input type="number" min={0} max={100} value={tplForm.competency} onChange={(e) => setTplForm({ ...tplForm, competency: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("Bobot Nilai Inti (%) *", "Core Values Weight (%) *")}</Label>
                <Input type="number" min={0} max={100} value={tplForm.core} onChange={(e) => setTplForm({ ...tplForm, core: e.target.value })} />
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("Jumlah ketiganya harus 100.", "The three must total 100.")}</p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox checked={tplForm.active} onCheckedChange={(v) => setTplForm({ ...tplForm, active: Boolean(v) })} />
                {t("Aktif", "Active")}
              </div>
            </div>
          )}

          {kind === "meritMatrix" && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("Kode *", "Code *")}</Label>
                  <Input value={meritForm.code} onChange={(e) => setMeritForm({ ...meritForm, code: e.target.value })} disabled={Boolean(meritForm.id)} placeholder="MM-STD" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("Nama *", "Name *")}</Label>
                  <Input value={meritForm.name} onChange={(e) => setMeritForm({ ...meritForm, name: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Grid (JSON — rating → bulan bonus & % kenaikan)", "Grid (JSON — rating → bonus months & raise %)")}</Label>
                <Textarea value={meritForm.grid} onChange={(e) => setMeritForm({ ...meritForm, grid: e.target.value })} rows={10} className="font-mono text-xs" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('Format: {"5": {"bonusMonths": 2, "raisePct": [8, 12]}, …}. Matriks ini juga dipakai estimator dampak real-time (§18.12).', 'Format: {"5": {"bonusMonths": 2, "raisePct": [8, 12]}, …}. This matrix also powers the real-time impact estimator (§18.12).')}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Checkbox checked={meritForm.active} onCheckedChange={(v) => setMeritForm({ ...meritForm, active: Boolean(v) })} />
                {t("Aktif (matriks berlaku)", "Active (applied matrix)")}
              </div>
            </div>
          )}

          {dialog === "version" && (
            <div className="rounded-lg bg-fuchsia-50 p-3 text-xs text-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300">
              {t(
                `Mode versi baru: ${versForm.code} v-baru akan dibuat dari form ini; versi lama otomatis Superseded (tidak bisa dipilih untuk assignment baru — data penilaian lama tetap utuh).`,
                `New-version mode: a new version of ${versForm.code} is created from this form; the old one automatically becomes Superseded (not selectable for new assignments — past appraisal data stays intact).`,
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>{t("Tahun Berlaku *", "Effective Year *")}</Label>
                  <Input type="number" min={new Date().getFullYear()} max={new Date().getFullYear() + 10} value={versForm.effectiveYear} onChange={(e) => setVersForm({ ...versForm, effectiveYear: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t("Catatan Perubahan *", "Change Note *")}</Label>
                  <Input value={versForm.changeNote} onChange={(e) => setVersForm({ ...versForm, changeNote: e.target.value })} placeholder={t("mis. satuan % → hari", "e.g. unit % → days")} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>{t("Batal")}</Button>
            {dialog === "version" ? (
              <Button onClick={saveNewVersion} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Buat Versi Baru", "Create New Version")}</Button>
            ) : (
              <Button onClick={save} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Simpan")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Dialog riwayat versi ===== */}
      <Dialog open={Boolean(historyCode)} onOpenChange={(o) => { if (!o) setHistoryCode(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 ov-text-accent" aria-hidden />
              {t("Riwayat Versi — {c}", "Version History — {c}", { c: historyCode ?? "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {historyApi.loading && !historyApi.data ? (
              <LoadingRows />
            ) : (
              <div className="grid gap-2">
                {(historyApi.data?.rows ?? []).map((v) => (
                  <div key={v.id} className={cn("rounded-lg border p-3 text-sm", v.status === "Active" ? "border-fuchsia-200 bg-fuchsia-50/50 dark:border-fuchsia-900 dark:bg-fuchsia-950/20" : "border-slate-200 dark:border-slate-800")}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-semibold">
                        <Badge variant="secondary">v{v.versionNo}</Badge>
                        <span className="text-xs text-slate-500">{t("berlaku", "effective")} {v.effectiveYear}</span>
                      </span>
                      <StatusPill status={v.status} active={v.active} />
                    </div>
                    {v.changeNote && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">📝 {v.changeNote}</p>}
                    {kind === "kpi" && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{v.name} · {v.polarity} · {v.unit} · {v.category}{v.dataSource !== "Manual" ? ` · AUTO (${v.sourceKey})` : ""}</p>
                    )}
                    {kind === "competency" && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{v.name} · {v.kind}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
