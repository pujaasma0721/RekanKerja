"use client";
// ============================================================================
// B5-BL — BENCHMARK PASAR GAJI (DEVELOPMENT-PLAN-BACKLOG.md §4 B5; D-BL16–D-BL18).
// Tab baru modul Payroll "Benchmark Pasar" (nav Analisis Pasar):
//   • Banner disclaimer amber (mitigasi risiko §5 "Benchmark bocor ke
//     karyawan"): benchmark = data eksternal manual HR (impor survei);
//     kompa-ratio = alat analisis, BUKAN dasar otomatis kenaikan gaji.
//   • Selector konteks: tahun + sumber (dari register benchmark) + refresh.
//   • Dashboard 3 tile distribusi band (Di bawah p25 / Dalam rentang / Di atas
//     p75) + rata-rata ratio + chip jumlah tanpa benchmark.
//   • Tabel master register (tahun, sumber, kunci grade/posisi, p25/p50/p75,
//     aksi edit/hapus utk HR) + dialog upsert + tombol "Impor XLSX"
//     (unduh template → unggah multipart → pratinjau PER SEL dgn alasan →
//     commit hanya baris valid — pola D16).
//   • Tabel kompa-ratio per karyawan (nama, unit, posisi, grade, ratio badge,
//     band, p50, gaji nominal bila money-view canSee (null → "—"), kunci
//     match, filter unit + pencarian + filter band; baris tanpa benchmark →
//     chip "belum ada benchmark" — TIDAK difabrikasi).
//   • Tombol "Ekspor XLSX" (lang ikut UI aktif).
//   • ESS tidak melihat tab ini (menu payroll:benchmark admin-only — D-BL17).
// Mobile <640px: kartu; desktop tabel. Dwibahasa penuh t() BASE_EN.
// DialogContent sm:max-w-* (Aturan Emas).
// ============================================================================
import { useMemo, useRef, useState } from "react";
import { useApi, apiSend, apiUpload, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Scale, Search, AlertTriangle, Plus, Pencil, Trash2, Download, Upload,
  RefreshCw, Loader2, FileWarning, FileSpreadsheet, CheckCircle2, Info,
} from "lucide-react";

const API = "/api/rekankerja/payroll/benchmark";
const MENU_KEY = "payroll:benchmark";

// ---- bentuk baris (mirror service benchmark-service.ts — deklarasi lokal client) ----
interface MasterRow {
  id: string;
  year: number;
  sourceLabel: string;
  gradeCode: string | null;
  positionId: string | null;
  positionCode: string | null;
  positionTitle: string | null;
  currency: string;
  p25: number;
  p50: number;
  p75: number;
}
interface MasterData {
  rows: MasterRow[];
  viewer: { isHr: boolean };
}
type Band = "below" | "within" | "above" | null;
interface CompaRow {
  employeeNo: string;
  fullName: string;
  unit: string | null;
  positionTitle: string | null;
  gradeCode: string | null;
  ratio: number | null;
  band: Band;
  p50: number | null;
  matchedKey: "grade" | "position" | null;
  baseSalaryNominal: number | null;
}
interface DashData {
  stats: { below: number; within: number; above: number; avgRatio: number | null; noBenchmark: number; total: number };
  rows: CompaRow[];
  context: { year: number | null; sourceLabel: string | null; sources: { year: number; sourceLabel: string }[] };
}
interface ImportCells {
  year: string;
  sourceLabel: string;
  gradeCode: string;
  positionCode: string;
  p25: string;
  p50: string;
  p75: string;
  currency: string;
}
interface ImportRow {
  rowNo: number;
  cells: ImportCells;
  valid: boolean;
  errors: { col: string; reason: string }[];
  dup?: string | null;
}
interface ImportPreview {
  rows: ImportRow[];
  summary: { valid: number; error: number; dup: number };
}

// label band dwibahasa
const BAND_LABEL: Record<string, { id: string; en: string; chip: string }> = {
  below: {
    id: "Di bawah p25", en: "Below p25",
    chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500",
  },
  within: {
    id: "Dalam rentang", en: "Within band",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400",
  },
  above: {
    id: "Di atas p75", en: "Above p75",
    chip: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400",
  },
};

// label kolom error pratinjau (col key → dwibahasa)
const COL_LABEL: Record<string, { id: string; en: string }> = {
  year: { id: "Tahun", en: "Year" },
  sourceLabel: { id: "Label sumber", en: "Source label" },
  gradeCode: { id: "Kode grade", en: "Grade code" },
  positionCode: { id: "Kode posisi", en: "Position code" },
  p25: { id: "p25", en: "p25" },
  p50: { id: "p50", en: "p50" },
  p75: { id: "p75", en: "p75" },
  currency: { id: "Mata uang", en: "Currency" },
  kunci: { id: "Kunci", en: "Key" },
};

export function PayrollBenchmarkPage() {
  const { t, lang, locale } = useI18n();
  const perms = useMenuPerms();

  // ---- konteks selector (tahun + sumber) ----
  const sourcesApi = useApi<{ sources: { year: number; sourceLabel: string }[] }>(`${API}?sources=1`);
  const [year, setYear] = useState<number | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const dashUrl = useMemo(() => {
    const p = new URLSearchParams({ dashboard: "1" });
    if (year != null) p.set("year", String(year));
    if (sourceLabel) p.set("sourceLabel", sourceLabel);
    return `${API}?${p.toString()}`;
  }, [year, sourceLabel]);
  const dash = useApi<DashData>(`${dashUrl}&_=${nonce}`, [dashUrl, nonce]);
  const master = useApi<MasterData>(`${API}?list=1&_=${nonce}`, [nonce]);
  const unitsApi = useApi<{ units: { id: string; name: string }[] }>("/api/rekankerja/org-units");

  // ---- filter tabel kompa ----
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [unitId, setUnitId] = useState("all");
  const [bandFilter, setBandFilter] = useState("all");

  // ---- dialog upsert ----
  const [upsertOpen, setUpsertOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editRow, setEditRow] = useState<MasterRow | null>(null);
  const [form, setForm] = useState({
    year: String(new Date().getFullYear()),
    sourceLabel: "",
    keyType: "grade" as "grade" | "position",
    gradeCode: "",
    positionId: "",
    currency: "IDR",
    p25: "",
    p50: "",
    p75: "",
  });
  const gradesApi = useApi<{ grades: { code: string; name: string; active: boolean }[] }>("/api/rekankerja/grades");
  const positionsApi = useApi<{ positions: { id: string; code: string; title: string }[] }>(
    upsertOpen ? `${API}?positions=1` : null,
  );

  // ---- dialog hapus ----
  const [confirmDelete, setConfirmDelete] = useState<MasterRow | null>(null);

  // ---- dialog impor (D16) ----
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [report, setReport] = useState<{ inserted: number; skipped: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- ekspor ----
  const [exporting, setExporting] = useState(false);

  const sources = sourcesApi.data?.sources ?? [];
  const context = dash.data?.context;
  const years = [...new Set(sources.map((s) => s.year))].sort((a, b) => b - a);
  const sourceOptions = (year != null ? sources.filter((s) => s.year === year) : sources)
    .map((s) => s.sourceLabel).filter((v, i, arr) => arr.indexOf(v) === i).sort();
  const activeYear = year ?? context?.year ?? null;
  const activeSource = sourceLabel ?? context?.sourceLabel ?? null;

  const canManage = perms.isSuperAdmin || perms.all
    || perms.can("payroll", "benchmark", "update") || perms.can("payroll", "benchmark", "create") || perms.can("payroll", "benchmark", "delete");
  const canImport = perms.isSuperAdmin || perms.all || perms.canOp("payroll", "benchmark", "import");
  const canExport = perms.isSuperAdmin || perms.all || perms.canOp("payroll", "benchmark", "export");
  // Direksi read-only (server mengirim viewer.isHr=false) — tombol mutasi disembunyikan
  const isHr = master.data?.viewer?.isHr !== false;

  const stats = dash.data?.stats;

  // ---- baris kompa terfilter ----
  const compaRows = useMemo(() => {
    let rows = dash.data?.rows ?? [];
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter((r) => r.fullName.toLowerCase().includes(s) || r.employeeNo.toLowerCase().includes(s));
    }
    if (unitId !== "all") rows = rows.filter((r) => r.unit != null && r.unit === (unitsApi.data?.units ?? []).find((u) => u.id === unitId)?.name);
    if (bandFilter === "none") rows = rows.filter((r) => r.matchedKey == null);
    else if (bandFilter !== "all") rows = rows.filter((r) => r.band === bandFilter);
    return rows;
  }, [dash.data, search, unitId, bandFilter, unitsApi.data]);

  // ---- aksi master ----
  const openAdd = () => {
    setEditRow(null);
    setForm({
      year: String(activeYear ?? new Date().getFullYear()),
      sourceLabel: activeSource ?? "",
      keyType: "grade",
      gradeCode: "",
      positionId: "",
      currency: "IDR",
      p25: "", p50: "", p75: "",
    });
    setUpsertOpen(true);
  };

  const openEdit = (m: MasterRow) => {
    setEditRow(m);
    setForm({
      year: String(m.year),
      sourceLabel: m.sourceLabel,
      keyType: m.gradeCode != null ? "grade" : "position",
      gradeCode: m.gradeCode ?? "",
      positionId: m.positionId ?? "",
      currency: m.currency,
      p25: String(m.p25), p50: String(m.p50), p75: String(m.p75),
    });
    setUpsertOpen(true);
  };

  const saveUpsert = async () => {
    setSaving(true);
    try {
      await apiSend(API, "POST", {
        action: "upsert",
        id: editRow?.id,
        year: Number(form.year),
        sourceLabel: form.sourceLabel,
        gradeCode: form.keyType === "grade" ? form.gradeCode : null,
        positionId: form.keyType === "position" ? form.positionId : null,
        currency: form.currency || undefined,
        p25: Number(form.p25), p50: Number(form.p50), p75: Number(form.p75),
      });
      toast.success(editRow
        ? t("Entri benchmark diperbarui", "Benchmark entry updated")
        : t("Entri benchmark ditambahkan", "Benchmark entry added"));
      setUpsertOpen(false);
      setNonce((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  const remove = async (m: MasterRow) => {
    try {
      await apiSend(API, "POST", { action: "delete", id: m.id });
      toast.success(t("Entri benchmark dihapus", "Benchmark entry deleted"));
      setConfirmDelete(null);
      setNonce((n) => n + 1);
    } catch (e) { toast.error((e as Error).message); }
  };

  // ---- impor (D16) ----
  const upload = async (f: File) => {
    if (f.size > 2 * 1024 * 1024) { toast.error(t("Ukuran file melebihi 2 MB (D16)", "File size exceeds 2 MB (D16)")); return; }
    setUploading(true);
    try {
      const formdata = new FormData();
      formdata.append("action", "importPreview");
      formdata.append("file", f);
      const res = await apiUpload<ImportPreview>(API, formdata);
      setPreview(res);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setUploading(false); }
  };

  const commit = async () => {
    if (!preview) return;
    setCommitting(true);
    try {
      const rows = preview.rows.filter((r) => r.valid).map((r) => r.cells);
      const res = await apiSend<{ inserted: number; skipped: number }>(API, "POST", { action: "importCommit", rows });
      setReport(res);
      setNonce((n) => n + 1);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setCommitting(false); }
  };

  // ---- ekspor (POST blob → anchor click — pola D-BL15) ----
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "exportXlsx",
          lang: locale.startsWith("en") ? "en" : "id",
          year: activeYear ?? undefined,
          sourceLabel: activeSource ?? undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m?.[1] ?? "rekankerja-salary-benchmark.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5_000);
      toast.success(t("Laporan benchmark terunduh (XLSX).", "The benchmark report was downloaded (XLSX)."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ekspor gagal", "Export failed"));
    } finally { setExporting(false); }
  };

  // ---- elemen kecil ----
  const ratioBadge = (r: CompaRow) => {
    if (r.ratio == null) {
      return (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-dashed border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
          {t("belum ada benchmark", "no benchmark yet")}
        </span>
      );
    }
    const meta = BAND_LABEL[r.band ?? "within"];
    return (
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums", meta.chip)}>
        {r.ratio.toFixed(2)}
      </span>
    );
  };

  const bandBadge = (b: Band) => {
    if (b == null) {
      return (
        <span className="text-[11px] text-slate-400">{t("— (tanpa benchmark)", "— (no benchmark)")}</span>
      );
    }
    const meta = BAND_LABEL[b];
    return (
      <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold", meta.chip)}>
        {t(meta.id, meta.en)}
      </span>
    );
  };

  const keyChip = (m: MasterRow) => (
    m.gradeCode != null ? (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
        {t("Grade", "Grade")} {m.gradeCode}
      </Badge>
    ) : (
      <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] font-bold text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-400">
        {t("Posisi", "Position")} {m.positionCode ?? "—"}
        {m.positionTitle ? ` · ${m.positionTitle}` : ""}
      </Badge>
    )
  );

  if (!dash.data && dash.loading) return <LoadingRows />;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Payroll · B5"
        title={t("Benchmark Pasar Gaji", "Salary Market Benchmark")}
        description={t(
          "Master benchmark gaji eksternal (impor survei HR) per tahun × sumber × kunci grade/posisi + kompa-ratio karyawan vs p50 pasar (D-BL16/D-BL17).",
          "External salary benchmark master (HR survey import) per year × source × grade/position key + employee compa-ratio vs market p50 (D-BL16/D-BL17).",
        )}
      />

      {dash.error && <EmptyState icon={<Scale />} title={t("Gagal memuat benchmark", "Failed to load benchmark")} description={dash.error} />}

      {/* ---- banner disclaimer amber (mitigasi risiko §5) ---- */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
            {t("Data eksternal manual HR — bukan dasar otomatis kenaikan gaji", "External manual HR data — not an automatic raise basis")}
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-amber-700/90 dark:text-amber-400/80">
            {t(
              "Benchmark diimpor manual dari survei pasar oleh HR dan bisa kedaluwarsa. Kompa-ratio adalah alat analisis posisi gaji terhadap pasar — keputusan penyesuaian gaji tetap melalui proses personnel action ber-persetujuan, TIDAK otomatis dari angka ini. Nominal gaji hanya tampil bagi pengguna dengan hak lihat nilai uang.",
              "The benchmark is manually imported from market surveys by HR and may be outdated. The compa-ratio is an analytical tool for salary positioning against the market — pay adjustments still go through the approved personnel-action process, NEVER automatically from this figure. Salary nominals are only shown to users with the money-view grant.",
            )}
          </p>
        </div>
      </div>

      {/* ---- selector konteks: tahun + sumber + refresh + aksi HR ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={activeYear != null ? String(activeYear) : "auto"}
          onValueChange={(v) => { setYear(v === "auto" ? null : Number(v)); setSourceLabel(null); }}
        >
          <SelectTrigger className="h-9 w-[110px] rounded-xl" aria-label={t("Filter tahun", "Year filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("Tahun terbaru", "Latest year")}</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={activeSource ?? "auto"}
          onValueChange={(v) => setSourceLabel(v === "auto" ? null : v)}
        >
          <SelectTrigger className="h-9 w-[220px] rounded-xl sm:w-[280px]" aria-label={t("Filter sumber benchmark", "Benchmark source filter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("Sumber terbaru (tahun terpilih)", "Latest source (selected year)")}</SelectItem>
            {sourceOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-9 rounded-xl gap-1.5" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw className="h-3.5 w-3.5" /> {t("Segarkan", "Refresh")}
        </Button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {isHr && canManage && (
            <Button size="sm" onClick={openAdd} className="h-9 rounded-xl gap-1.5">
              <Plus className="h-3.5 w-3.5" /> {t("Entri Baru", "New Entry")}
            </Button>
          )}
          {isHr && canImport && (
            <Button size="sm" variant="outline" onClick={() => { setImportOpen(true); setPreview(null); setReport(null); }} className="h-9 rounded-xl gap-1.5">
              <Upload className="h-3.5 w-3.5" /> {t("Impor XLSX", "Import XLSX")}
            </Button>
          )}
          {canExport && (
            <Button size="sm" variant="outline" onClick={exportXlsx} disabled={exporting} className="h-9 rounded-xl gap-1.5">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {t("Ekspor XLSX", "Export XLSX")}
            </Button>
          )}
        </span>
      </div>

      {/* ---- dashboard 3 tile + rata-ratio + chip tanpa benchmark ---- */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {([
            { k: "below", label: t("Di bawah p25", "Below p25"), value: stats.below, style: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10", num: "text-amber-600 dark:text-amber-500" },
            { k: "within", label: t("Dalam rentang", "Within band"), value: stats.within, style: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10", num: "text-emerald-600 dark:text-emerald-400" },
            { k: "above", label: t("Di atas p75", "Above p75"), value: stats.above, style: "border-violet-200 bg-violet-50/70 dark:border-violet-500/30 dark:bg-violet-500/10", num: "text-violet-600 dark:text-violet-400" },
          ]).map((x) => (
            <Card key={x.k} className={cn("border", x.style)}>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{x.label}</p>
                <p className={cn("mt-1 text-2xl font-black tabular-nums", x.num)}>{x.value}</p>
                <p className="text-[10px] text-slate-400">{t("dari {n} karyawan", "of {n} employees", { n: stats.total })}</p>
              </CardContent>
            </Card>
          ))}
          <Card className="border border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/40">
            <CardContent className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Rata-rata ratio", "Average ratio")}</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-700 dark:text-slate-200">
                {stats.avgRatio != null ? stats.avgRatio.toFixed(2) : "—"}
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {stats.noBenchmark > 0
                  ? t("{n} karyawan tanpa benchmark", "{n} employees without a benchmark", { n: stats.noBenchmark })
                  : t("semua karyawan termatch", "all employees matched")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================= TABEL KOMPA-RATIO (D-BL17) ================= */}
      <Card className="min-w-0">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">{t("Kompa-Ratio Karyawan", "Employee Compa-Ratio")}</p>
            <Badge variant="outline" className="text-[10px]">
              {activeYear != null && activeSource ? `${activeYear} · ${activeSource}` : t("belum ada data benchmark", "no benchmark data yet")}
            </Badge>
            <form
              className="ml-auto flex min-w-0 gap-2"
              onSubmit={(ev) => { ev.preventDefault(); setSearch(q); }}
            >
              <div className="relative min-w-0 flex-1 sm:w-52">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Cari nama / no. karyawan…", "Search name / employee no.…")}
                  className="h-9 rounded-xl pl-8"
                  aria-label={t("Cari karyawan", "Search employee")}
                />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-9 rounded-xl">{t("Cari", "Search")}</Button>
            </form>
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="h-9 w-40 rounded-xl" aria-label={t("Filter unit kerja", "Org unit filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua unit", "All units")}</SelectItem>
                {(unitsApi.data?.units ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={bandFilter} onValueChange={setBandFilter}>
              <SelectTrigger className="h-9 w-44 rounded-xl" aria-label={t("Filter band", "Band filter")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Semua band", "All bands")}</SelectItem>
                <SelectItem value="below">{t("Di bawah p25", "Below p25")}</SelectItem>
                <SelectItem value="within">{t("Dalam rentang", "Within band")}</SelectItem>
                <SelectItem value="above">{t("Di atas p75", "Above p75")}</SelectItem>
                <SelectItem value="none">{t("Tanpa benchmark", "No benchmark")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {compaRows.length === 0 ? (
            <EmptyState
              icon={Scale}
              title={t("Tidak ada karyawan pada filter ini", "No employees under this filter")}
              description={t(
                "Coba ubah pencarian, unit, atau filter band. Daftar hanya memuat karyawan berstatus Aktif dgn penempatan aktif.",
                "Try changing the search, unit, or band filter. The list only includes Active employees with an active assignment.",
              )}
            />
          ) : (
            <>
              {/* ---- tabel desktop (≥640px) ---- */}
              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Karyawan", "Employee")}</TableHead>
                      <TableHead>{t("Unit", "Unit")}</TableHead>
                      <TableHead>{t("Jabatan", "Position")}</TableHead>
                      <TableHead>{t("Grade", "Grade")}</TableHead>
                      <TableHead className="text-right">{t("Ratio", "Ratio")}</TableHead>
                      <TableHead>{t("Band", "Band")}</TableHead>
                      <TableHead className="text-right">{t("p50 Pasar", "Market p50")}</TableHead>
                      <TableHead className="text-right">{t("Gaji Pokok", "Base Salary")}</TableHead>
                      <TableHead>{t("Kunci Match", "Match Key")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {compaRows.map((r) => (
                      <TableRow key={r.employeeNo}>
                        <TableCell className="max-w-52">
                          <p className="font-semibold">{r.fullName}</p>
                          <p className="text-[11px] text-slate-500">{r.employeeNo}</p>
                        </TableCell>
                        <TableCell className="max-w-36 truncate text-xs" title={r.unit ?? undefined}>{r.unit ?? "—"}</TableCell>
                        <TableCell className="max-w-44 truncate text-xs" title={r.positionTitle ?? undefined}>{r.positionTitle ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.gradeCode ?? "—"}</TableCell>
                        <TableCell className="text-right">{ratioBadge(r)}</TableCell>
                        <TableCell>{bandBadge(r.band)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{r.p50 != null ? fmtIDR(r.p50) : "—"}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">
                          {r.baseSalaryNominal != null ? fmtIDR(r.baseSalaryNominal) : "—"}
                        </TableCell>
                        <TableCell>
                          {r.matchedKey == null ? (
                            <span className="text-[11px] text-slate-400">—</span>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              {r.matchedKey === "grade" ? t("Grade", "Grade") : t("Posisi", "Position")}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ---- kartu mobile (<640px) ---- */}
              <div className="space-y-2 sm:hidden">
                {compaRows.map((r) => (
                  <div key={r.employeeNo} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.fullName}</p>
                        <p className="truncate text-xs text-slate-500">{r.employeeNo} · {r.unit ?? "—"}</p>
                        <p className="truncate text-[11px] text-slate-400">{r.positionTitle ?? "—"}{r.gradeCode ? ` · ${r.gradeCode}` : ""}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {ratioBadge(r)}
                        {bandBadge(r.band)}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>
                        {t("p50 pasar", "market p50")}: <span className="font-semibold tabular-nums">{r.p50 != null ? fmtIDR(r.p50) : "—"}</span>
                      </span>
                      <span>
                        {t("Gaji pokok", "Base salary")}: <span className="font-semibold tabular-nums">{r.baseSalaryNominal != null ? fmtIDR(r.baseSalaryNominal) : "—"}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ================= TABEL MASTER REGISTER (D-BL16) ================= */}
      <Card className="min-w-0">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold">{t("Master Benchmark", "Benchmark Master")}</p>
            <Badge variant="outline" className="text-[10px]">{(master.data?.rows ?? []).length} {t("entri", "entries")}</Badge>
          </div>

          {master.loading && !master.data ? (
            <LoadingRows rows={3} />
          ) : (master.data?.rows ?? []).length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="h-6 w-6" />}
              title={t("Belum ada benchmark", "No benchmark yet")}
              description={t(
                "Impor data survei pasar via tombol \"Impor XLSX\" (unduh template dulu) atau tambah entri manual. Kompa-ratio baru terhitung setelah benchmark tersedia.",
                "Import market survey data via the \"Import XLSX\" button (download the template first) or add an entry manually. The compa-ratio only computes once benchmark data exists.",
              )}
            />
          ) : (
            <>
              {/* ---- tabel desktop (≥640px) ---- */}
              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Tahun", "Year")}</TableHead>
                      <TableHead>{t("Label Sumber", "Source Label")}</TableHead>
                      <TableHead>{t("Kunci (Grade / Posisi)", "Key (Grade / Position)")}</TableHead>
                      <TableHead className="text-right">p25</TableHead>
                      <TableHead className="text-right">p50</TableHead>
                      <TableHead className="text-right">p75</TableHead>
                      <TableHead>{t("Mata Uang", "Currency")}</TableHead>
                      {isHr && canManage && <TableHead className="w-24" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(master.data?.rows ?? []).map((m) => (
                      <TableRow key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className="text-xs font-bold tabular-nums">{m.year}</TableCell>
                        <TableCell className="max-w-56 truncate text-xs" title={m.sourceLabel}>{m.sourceLabel}</TableCell>
                        <TableCell>{keyChip(m)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtIDR(m.p25)}</TableCell>
                        <TableCell className="text-right text-xs font-semibold tabular-nums">{fmtIDR(m.p50)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{fmtIDR(m.p75)}</TableCell>
                        <TableCell className="text-xs">{m.currency}</TableCell>
                        {isHr && canManage && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(m)} aria-label={t("Ubah entri benchmark", "Edit benchmark entry")}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setConfirmDelete(m)} aria-label={t("Hapus entri benchmark", "Delete benchmark entry")}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ---- kartu mobile (<640px) ---- */}
              <div className="space-y-2 sm:hidden">
                {(master.data?.rows ?? []).map((m) => (
                  <div key={m.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{m.sourceLabel}</p>
                        <p className="text-xs text-slate-500">{m.year} · {m.currency}</p>
                        <div className="mt-1">{keyChip(m)}</div>
                      </div>
                      {isHr && canManage && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(m)} aria-label={t("Ubah entri benchmark", "Edit benchmark entry")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setConfirmDelete(m)} aria-label={t("Hapus entri benchmark", "Delete benchmark entry")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      p25 <span className="font-semibold tabular-nums">{fmtIDR(m.p25)}</span> · p50 <span className="font-semibold tabular-nums">{fmtIDR(m.p50)}</span> · p75 <span className="font-semibold tabular-nums">{fmtIDR(m.p75)}</span>
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ================= DIALOG UPSERT MASTER (D-BL16) ================= */}
      <Dialog open={upsertOpen} onOpenChange={(o) => !o && setUpsertOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editRow ? t("Ubah Entri Benchmark", "Edit Benchmark Entry") : t("Entri Benchmark Baru", "New Benchmark Entry")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Kunci TEPAT SATU: kode grade ATAU posisi. Persentil harus berurut p25 ≤ p50 ≤ p75 (> 0).",
                "Exactly ONE key: grade code OR position. Percentiles must be ordered p25 ≤ p50 ≤ p75 (> 0).",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bm-year">{t("Tahun", "Year")}</Label>
                <Input id="bm-year" type="number" min={2000} max={2100} value={form.year}
                  onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bm-currency">{t("Mata Uang", "Currency")}</Label>
                <Input id="bm-currency" placeholder="IDR" value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bm-source">{t("Label Sumber", "Source Label")}</Label>
              <Input id="bm-source" placeholder={t("mis. Survei Gaji Nusantara 2026", "e.g. Nusantara Salary Survey 2026")} value={form.sourceLabel}
                onChange={(e) => setForm((f) => ({ ...f, sourceLabel: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Jenis Kunci", "Key Type")}</Label>
              <Select value={form.keyType} onValueChange={(v) => setForm((f) => ({ ...f, keyType: v as "grade" | "position" }))}>
                <SelectTrigger className="h-9 rounded-xl" aria-label={t("Jenis kunci benchmark", "Benchmark key type")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grade">{t("Grade (umum)", "Grade (general)")}</SelectItem>
                  <SelectItem value="position">{t("Posisi (spesifik)", "Position (specific)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.keyType === "grade" ? (
              <div className="space-y-1.5">
                <Label>{t("Kode Grade (master aktif)", "Grade Code (active master)")}</Label>
                <Select value={form.gradeCode} onValueChange={(v) => setForm((f) => ({ ...f, gradeCode: v }))}>
                  <SelectTrigger className="h-9 rounded-xl" aria-label={t("Pilih grade", "Pick a grade")}>
                    <SelectValue placeholder={t("Pilih grade…", "Pick a grade…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(gradesApi.data?.grades ?? []).filter((g) => g.active).map((g) => (
                      <SelectItem key={g.code} value={g.code}>{g.code} — {g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("Posisi (master aktif)", "Position (active master)")}</Label>
                <Select value={form.positionId} onValueChange={(v) => setForm((f) => ({ ...f, positionId: v }))}>
                  <SelectTrigger className="h-9 rounded-xl" aria-label={t("Pilih posisi", "Pick a position")}>
                    <SelectValue placeholder={t("Pilih posisi…", "Pick a position…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(positionsApi.data?.positions ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {(["p25", "p50", "p75"] as const).map((k) => (
                <div key={k} className="space-y-1.5">
                  <Label htmlFor={`bm-${k}`}>{k}</Label>
                  <Input id={`bm-${k}`} type="number" min={0} step="any" placeholder="0"
                    value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpsertOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={saveUpsert} disabled={saving || !form.sourceLabel.trim() || !form.year
              || (form.keyType === "grade" ? !form.gradeCode : !form.positionId)
              || !form.p25 || !form.p50 || !form.p75}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editRow ? t("Simpan Perubahan", "Save Changes") : t("Tambah Entri", "Add Entry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= DIALOG HAPUS ================= */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Hapus Entri Benchmark?", "Delete Benchmark Entry?")}</DialogTitle>
            <DialogDescription>
              {confirmDelete && t(
                "Benchmark {y} \"{s}\" kunci {k} akan dihapus permanen — kompa-ratio karyawan terkait akan kehilangan patokan.",
                "The benchmark {y} \"{s}\" key {k} will be permanently deleted — related employee compa-ratios lose their reference.",
                { y: String(confirmDelete.year), s: confirmDelete.sourceLabel, k: confirmDelete.gradeCode ?? confirmDelete.positionCode ?? "—" },
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={() => confirmDelete && remove(confirmDelete)}>
              <Trash2 className="h-4 w-4" /> {t("Hapus", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= DIALOG IMPOR XLSX (D16) ================= */}
      <Dialog open={importOpen} onOpenChange={(o) => !o && setImportOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("Impor XLSX Benchmark Gaji", "Excel Import — Salary Benchmark")}</DialogTitle>
            <DialogDescription>
              {t(
                "Baris kotor ditolak per sel dengan alasan — TIDAK membatalkan baris lain (D16). Commit hanya memasukkan baris valid.",
                "Dirty rows are rejected per-cell with reasons — other rows are NOT affected (D16). Commit only inserts the valid rows.",
              )}
            </DialogDescription>
          </DialogHeader>

          {!preview && !report && (
            <div className="space-y-3">
              <a
                href={`${API}?template=1&lang=${lang}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-brand/50 dark:border-slate-800"
              >
                <Download className="h-5 w-5 shrink-0 text-brand" />
                <div>
                  <p className="text-sm font-semibold">{t("1 · Unduh Template (.xlsx)", "1 · Download Template (.xlsx)")}</p>
                  <p className="text-xs text-slate-500">{t("Header dwibahasa + sheet petunjuk + baris contoh", "Bilingual headers + instruction sheet + example row")}</p>
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
                {uploading ? <Loader2 className="h-6 w-6 animate-spin text-brand" /> : <Upload className="h-6 w-6 text-slate-400" />}
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
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t(`${preview.summary.valid} valid`, `${preview.summary.valid} valid`)}</Badge>
                <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400">{t(`${preview.summary.error} error`, `${preview.summary.error} errors`)}</Badge>
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">{t(`${preview.summary.dup} duplikat`, `${preview.summary.dup} duplicates`)}</Badge>
                {preview.summary.error + preview.summary.dup > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <FileWarning className="h-3.5 w-3.5" />
                    {t("perbaiki baris merah lalu unggah ulang", "fix the red rows and re-upload")}
                  </span>
                )}
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                    <tr className="text-left text-slate-500">
                      <th className="p-1.5">#</th>
                      <th className="p-1.5">{t("Tahun", "Year")}</th>
                      <th className="p-1.5">{t("Sumber", "Source")}</th>
                      <th className="p-1.5">{t("Grade", "Grade")}</th>
                      <th className="p-1.5">{t("Posisi", "Position")}</th>
                      <th className="p-1.5">p25</th>
                      <th className="p-1.5">p50</th>
                      <th className="p-1.5">p75</th>
                      <th className="p-1.5">{t("Uang", "Cur.")}</th>
                      <th className="p-1.5">{t("Status", "Status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.rowNo} className={cn(
                        "border-t border-slate-100 dark:border-slate-800/60",
                        !r.valid ? "bg-rose-50/60 dark:bg-rose-950/10" : "",
                      )}>
                        <td className="p-1.5 tabular-nums text-slate-400">{r.rowNo}</td>
                        <td className="p-1.5 tabular-nums">{r.cells.year}</td>
                        <td className="p-1.5 max-w-36 truncate" title={r.cells.sourceLabel}>{r.cells.sourceLabel}</td>
                        <td className="p-1.5">{r.cells.gradeCode}</td>
                        <td className="p-1.5">{r.cells.positionCode}</td>
                        <td className="p-1.5 tabular-nums">{r.cells.p25}</td>
                        <td className="p-1.5 tabular-nums">{r.cells.p50}</td>
                        <td className="p-1.5 tabular-nums">{r.cells.p75}</td>
                        <td className="p-1.5">{r.cells.currency}</td>
                        <td className="p-1.5">
                          {r.valid
                            ? <span className="text-emerald-600 dark:text-emerald-400">✓ {t("valid", "valid")}</span>
                            : r.errors.map((e, i) => (
                              <span key={i} className="block text-rose-600 dark:text-rose-400">
                                {COL_LABEL[e.col] ? t(COL_LABEL[e.col].id, COL_LABEL[e.col].en) : e.col}: {e.reason}
                              </span>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPreview(null)}>{t("Unggah ulang", "Re-upload")}</Button>
                <Button onClick={commit} disabled={committing || preview.summary.valid === 0}>
                  {committing && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t(`Commit ${preview.summary.valid} baris valid`, `Commit ${preview.summary.valid} valid rows`)}
                </Button>
              </DialogFooter>
            </>
          )}

          {report && (
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                {t(`${report.inserted} baris dimasukkan · ${report.skipped} lompat`, `${report.inserted} rows inserted · ${report.skipped} skipped`)}
              </p>
              <p className="flex items-start gap-1.5 text-xs text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(
                  "Master benchmark siap dipakai kompa-ratio — periksa tab atas. Impor tidak mengubah gaji karyawan mana pun.",
                  "The benchmark master is now used by the compa-ratio — check the sections above. Importing changes no employee salary.",
                )}
              </p>
              <DialogFooter>
                <Button onClick={() => setImportOpen(false)}>{t("Selesai", "Done")}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
