"use client";
// OneVity — Report Builder kustom (Task 28-b) ==============================
// =====================================================================
// Laporan ad-hoc: pilih ENTITY → FIELD (chip grup + urutan kolom ↑↓) →
// FILTER (baris dinamis, operator per tipe field) → JALANKAN / EKSPOR
// CSV/Excel / SIMPAN. Layout 2 kolom (lg): kiri daftar laporan tersimpan
// (Jalankan/Ubah/Hapus), kanan builder + tabel hasil (tanggal "dd MMM yyyy",
// angka rata kanan, max-h-96 scroll custom, indikator truncate 500 baris).
// Aksi digerbang hak menu hr:custom-reports (op:run, op:export, CRUD).
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  SlidersHorizontal, Play, Pencil, Trash2, Plus, Search, Check, ChevronUp,
  ChevronDown, X, FileSpreadsheet, FileText, Save, Loader2, Filter,
  Table2, Info, FileDown, Copy,
} from "lucide-react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const CATALOG_URL = "/api/onevity/custom-reports/catalog";
const SAVED_URL = "/api/onevity/custom-reports";
const RUN_URL = "/api/onevity/custom-reports/run";
const EXPORT_URL = "/api/onevity/custom-reports/export";

// ================= TIPE DATA =================
type FieldType = "string" | "number" | "date" | "boolean";

interface CatalogField {
  key: string; label: string; labelEn: string; type: FieldType; filterable: boolean; group: string;
}
interface CatalogEntity {
  key: string; label: string; labelEn: string; description: string; descriptionEn: string; fields: CatalogField[];
}
interface CatalogData {
  entities: CatalogEntity[];
  ops: Record<string, { label: string; labelEn: string }>;
  opsByType: Record<FieldType, string[]>;
  limits: { maxFields: number; maxFilters: number; runPageSize: number; exportRows: number };
}
interface SavedReport {
  id: string; code: string; name: string; description: string | null; entity: string;
  fields: string[]; filters: { field: string; op: string; value: string }[];
  createdAt: string; updatedAt: string;
}
interface RunColumn { key: string; label: string; labelEn: string; type: FieldType }
interface RunResult {
  entity: string; columns: RunColumn[]; rows: Record<string, unknown>[];
  total: number; page: number; pageSize: number; truncated: boolean;
}
interface FilterRow { uid: number; field: string; op: string; value: string }

const TYPE_LABEL: Record<FieldType, { id: string; en: string }> = {
  string: { id: "Teks", en: "Text" },
  number: { id: "Angka", en: "Number" },
  date: { id: "Tanggal", en: "Date" },
  boolean: { id: "Ya/Tidak", en: "Yes/No" },
};

/** Sel nilai — diformat sesuai tipe kolom (tanggal ISO mentah → UI). */
function CellValue({ v, type }: { v: unknown; type: FieldType }) {
  const { t, locale } = useI18n();
  if (v === null || v === undefined || v === "") {
    return <span className="text-stone-300 dark:text-stone-600">—</span>;
  }
  if (type === "boolean") {
    return (
      <Badge variant="outline" className={cn(
        "text-[10px] font-bold",
        v
          ? "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25"
          : "bg-stone-100 text-stone-500 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25",
      )}>
        {v ? t("Ya", "Yes") : t("Tidak", "No")}
      </Badge>
    );
  }
  if (type === "number") {
    const n = Number(v);
    return <span className="tabular-nums">{Number.isFinite(n) ? new Intl.NumberFormat(locale).format(n) : String(v)}</span>;
  }
  if (type === "date") {
    const s = String(v);
    const timePart = s.length >= 16 ? s.slice(11, 16) : "";
    const isMidnight = !timePart || timePart === "00:00";
    return <span className="whitespace-nowrap">{isMidnight ? fmtDate(s) : fmtDateTime(s)}</span>;
  }
  return <span className="max-w-[260px] truncate" title={String(v)}>{String(v)}</span>;
}

// ================= KOMPONEN UTAMA =================
export function CustomReportsView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const catalog = useApi<CatalogData>(CATALOG_URL);
  const saved = useApi<{ reports: SavedReport[] }>(SAVED_URL);

  const [entityKey, setEntityKey] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [fieldQuery, setFieldQuery] = useState("");
  const [filterRows, setFilterRows] = useState<FilterRow[]>([]);
  const uidRef = useRef(1);

  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [editing, setEditing] = useState<{ id: string; code: string; name: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const builderRef = useRef<HTMLDivElement | null>(null);

  // hak aksi menu
  const canRun = perms.canOp("hr", "custom-reports", "run");
  const canExport = perms.canOp("hr", "custom-reports", "export");
  const canCreate = perms.can("hr", "custom-reports", "create");
  const canUpdate = perms.can("hr", "custom-reports", "update");
  const canDelete = perms.can("hr", "custom-reports", "delete");

  const entities = catalog.data?.entities ?? [];
  const entity = entities.find((e) => e.key === entityKey) ?? null;
  const limits = catalog.data?.limits;
  const opsMeta = catalog.data?.ops ?? {};
  const opsByType = catalog.data?.opsByType;

  const fieldDefOf = (key: string): CatalogField | undefined => entity?.fields.find((f) => f.key === key);

  /** field terpilih berurutan, dgn definisinya. */
  const selectedDefs = useMemo(
    () => selected.map((k) => fieldDefOf(k)).filter((f): f is CatalogField => !!f),
    [selected, entity],
  );

  /** grup utk chip picker (urutan kemunculan pertama). */
  const fieldGroups = useMemo(() => {
    if (!entity) return [] as { group: string; fields: CatalogField[] }[];
    const q = fieldQuery.trim().toLowerCase();
    const groups: { group: string; fields: CatalogField[] }[] = [];
    for (const f of entity.fields) {
      if (q && !f.label.toLowerCase().includes(q) && !f.key.toLowerCase().includes(q)) continue;
      let g = groups.find((x) => x.group === f.group);
      if (!g) {
        g = { group: f.group, fields: [] };
        groups.push(g);
      }
      g.fields.push(f);
    }
    return groups;
  }, [entity, fieldQuery]);

  const filterableFields = useMemo(
    () => (entity?.fields ?? []).filter((f) => f.filterable),
    [entity],
  );

  const opLabel = (op: string): string => {
    const m = opsMeta[op];
    return m ? t(m.label, m.labelEn) : op;
  };

  // ================= aksi builder =================

  const scrollBuilder = () => {
    builderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onEntityChange = (key: string) => {
    setEntityKey(key);
    setSelected([]);
    setFilterRows([]);
    setResult(null);
    setFieldQuery("");
  };

  const toggleField = (key: string) => {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= (limits?.maxFields ?? 25)) {
        toast.error(t("Maksimal {n} field per laporan", "Maximum {n} fields per report", { n: limits?.maxFields ?? 25 }));
        return prev;
      }
      return [...prev, key];
    });
  };

  const moveField = (i: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
      return next;
    });
  };

  const addFilter = () => {
    if (filterRows.length >= (limits?.maxFilters ?? 10)) {
      toast.error(t("Maksimal {n} filter per laporan", "Maximum {n} filters per report", { n: limits?.maxFilters ?? 10 }));
      return;
    }
    const firstField = filterableFields[0];
    const type = firstField?.type ?? "string";
    const firstOp = opsByType?.[type]?.[0] ?? "eq";
    setFilterRows((prev) => [...prev, { uid: uidRef.current++, field: firstField?.key ?? "", op: firstOp, value: "" }]);
  };

  const onFilterField = (uid: number, key: string) => {
    const def = filterableFields.find((f) => f.key === key);
    const type = def?.type ?? "string";
    const firstOp = opsByType?.[type]?.[0] ?? "eq";
    setFilterRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, field: key, op: firstOp, value: "" } : r)));
  };

  /** Validasi ringan sisi klien — server memvalidasi ulang (400). */
  const buildSpec = (): { entity: string; fields: string[]; filters: { field: string; op: string; value: string }[] } | null => {
    if (!entityKey) {
      toast.error(t("Pilih sumber data laporan terlebih dahulu", "Pick a report data source first"));
      return null;
    }
    if (selected.length === 0) {
      toast.error(t("Pilih minimal 1 field untuk ditampilkan", "Select at least 1 field to display"));
      return null;
    }
    for (const r of filterRows) {
      if (!r.field || !r.op) {
        toast.error(t("Baris filter belum lengkap — pilih field & operator", "Incomplete filter row — pick field & operator"));
        return null;
      }
      if (r.op !== "empty" && r.op !== "notEmpty" && r.value.trim() === "") {
        toast.error(t("Nilai filter wajib diisi (kosongkan baris bila tak perlu)", "Filter value is required (remove the row if unneeded)"));
        return null;
      }
    }
    return {
      entity: entityKey,
      fields: selected,
      filters: filterRows.map(({ field, op, value }) => ({ field, op, value })),
    };
  };

  const runSpec = async (spec: { entity: string; fields: string[]; filters: { field: string; op: string; value: string }[] }) => {
    if (!canRun) {
      toast.error(t("Anda tidak memiliki hak menjalankan laporan kustom", "You lack permission to run custom reports"));
      return;
    }
    setRunning(true);
    try {
      const res = await apiSend<RunResult>(RUN_URL, "POST", spec);
      setResult(res);
      if (res.rows.length === 0) {
        toast.info(t("Laporan dijalankan — 0 baris cocok. Longgarkan filter?", "Report ran — 0 matching rows. Relax filters?"));
      } else {
        toast.success(t("{n} baris ditemukan", "{n} rows found", { n: res.total }));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setRunning(false);
    }
  };

  const doRun = () => {
    const spec = buildSpec();
    if (spec) void runSpec(spec);
  };

  const doExport = async (format: "csv" | "xlsx") => {
    if (!canExport) {
      toast.error(t("Anda tidak memiliki hak mengekspor laporan", "You lack permission to export reports"));
      return;
    }
    const spec = buildSpec();
    if (!spec) return;
    setExporting(format);
    try {
      const res = await fetch(EXPORT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...spec, format, id: editing?.id, name: editing?.name }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] ?? `laporan-kustom.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        format === "csv"
          ? t("CSV diunduh", "CSV downloaded")
          : t("Excel diunduh", "Excel downloaded"),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setExporting(null);
    }
  };

  // ================= laporan tersimpan =================

  const openSaveDialog = () => {
    if (!buildSpec()) return;
    setSaveName(editing?.name ?? "");
    setSaveDesc("");
    setSaveOpen(true);
  };

  const doSave = async () => {
    const spec = buildSpec();
    if (!spec) return;
    const name = saveName.trim();
    if (!name) {
      toast.error(t("Nama laporan wajib diisi", "Report name is required"));
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await apiSend<{ report: SavedReport }>(SAVED_URL, "PATCH", {
          id: editing.id, name, description: saveDesc.trim() || null, ...spec,
        });
        setEditing({ id: res.report.id, code: res.report.code, name: res.report.name });
        toast.success(t("Laporan {code} tersimpan", "Report {code} saved", { code: res.report.code }));
      } else {
        const res = await apiSend<{ report: SavedReport }>(SAVED_URL, "POST", {
          name, description: saveDesc.trim() || null, ...spec,
        });
        setEditing({ id: res.report.id, code: res.report.code, name: res.report.name });
        toast.success(t("Laporan {code} tersimpan di daftar", "Report {code} saved to the list", { code: res.report.code }));
      }
      setSaveOpen(false);
      saved.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setSaving(false);
    }
  };

  /** Muat laporan tersimpan ke builder (mode Ubah). */
  const loadForEdit = (r: SavedReport) => {
    setEntityKey(r.entity);
    setSelected(r.fields);
    setFilterRows(r.filters.map((f) => ({ uid: uidRef.current++, field: f.field, op: f.op, value: f.value })));
    setResult(null);
    setEditing({ id: r.id, code: r.code, name: r.name });
    scrollBuilder();
    toast.info(t("Definisi {code} dimuat ke builder", "{code} definition loaded into the builder", { code: r.code }));
  };

  /** Jalankan laporan tersimpan — dimuat ke builder LALU langsung dieksekusi. */
  const runSaved = async (r: SavedReport) => {
    if (!canRun) {
      toast.error(t("Anda tidak memiliki hak menjalankan laporan kustom", "You lack permission to run custom reports"));
      return;
    }
    setBusyId(r.id);
    setEntityKey(r.entity);
    setSelected(r.fields);
    setFilterRows(r.filters.map((f) => ({ uid: uidRef.current++, field: f.field, op: f.op, value: f.value })));
    setEditing({ id: r.id, code: r.code, name: r.name });
    scrollBuilder();
    await runSpec({ entity: r.entity, fields: r.fields, filters: r.filters });
    setBusyId(null);
  };

  const doDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await apiSend(`${SAVED_URL}?id=${deleteId}`, "DELETE");
      toast.success(t("Laporan dihapus", "Report deleted"));
      if (editing?.id === deleteId) setEditing(null);
      setDeleteId(null);
      saved.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setDeleting(false);
    }
  };

  const resetBuilder = () => {
    setEntityKey("");
    setSelected([]);
    setFilterRows([]);
    setResult(null);
    setEditing(null);
    setFieldQuery("");
    scrollBuilder();
  };

  const reports = saved.data?.reports ?? [];
  const entityLabelOf = (key: string): string => {
    const e = entities.find((x) => x.key === key);
    return e ? t(e.label, e.labelEn) : key;
  };

  // ================= RENDER =================
  return (
    <div>
      <PageHeader
        eyebrow="Laporan"
        title={t("Laporan Kustom", "Custom Reports")}
        description={t(
          "Bangun laporan ad-hoc: pilih sumber data, field & filter — jalankan, simpan, lalu ekspor ke CSV/Excel.",
          "Build ad-hoc reports: pick a data source, fields & filters — run, save, then export to CSV/Excel.",
        )}
      />

      <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
        {/* ============ KOLOM KIRI — laporan tersimpan ============ */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <SlidersHorizontal className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
              {t("Laporan Tersimpan", "Saved Reports")}
              <Badge variant="outline" className="ml-auto text-[10px] font-bold tabular-nums">{reports.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {canCreate && (
              <Button onClick={resetBuilder} className="w-full" size="sm">
                <Plus className="h-4 w-4" aria-hidden /> {t("Laporan Baru", "New Report")}
              </Button>
            )}
            <div className={cn("mt-3", canCreate && "space-y-2.5")}>
              {saved.loading ? (
                <LoadingRows rows={3} />
              ) : saved.error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400" role="alert">
                  {saved.error}
                </p>
              ) : reports.length === 0 ? (
                <EmptyState
                  icon={FileDown}
                  title={t("Belum ada laporan tersimpan", "No saved reports yet")}
                  description={t("Susun laporan di builder lalu klik Simpan.", "Build a report in the builder then click Save.")}
                />
              ) : (
                <ul className="max-h-[540px] space-y-2.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
                  {reports.map((r) => (
                    <li key={r.id} className="rounded-xl border border-stone-200 p-3 transition-colors hover:border-brand/40 dark:border-stone-800 dark:hover:border-brand/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">{r.name}</p>
                          <p className="text-[10px] font-mono text-stone-400">{r.code}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 bg-brand/10 text-[10px] font-bold text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25">
                          {entityLabelOf(r.entity)}
                        </Badge>
                      </div>
                      {r.description && (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-500 dark:text-stone-400">{r.description}</p>
                      )}
                      <p className="mt-1 text-[10px] text-stone-400">
                        {t("{n} field · {m} filter · diubah {d}", "{n} fields · {m} filters · updated {d}", {
                          n: r.fields.length, m: r.filters.length, d: fmtDate(r.updatedAt),
                        })}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {canRun && (
                          <Button size="sm" onClick={() => void runSaved(r)} disabled={busyId === r.id} className="h-8 gap-1 px-2.5 text-[11px]">
                            {busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
                            {t("Jalankan", "Run")}
                          </Button>
                        )}
                        {canUpdate && (
                          <Button size="sm" variant="outline" onClick={() => loadForEdit(r)} className="h-8 gap-1 px-2.5 text-[11px]">
                            <Pencil className="h-3.5 w-3.5" aria-hidden /> {t("Ubah", "Edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm" variant="outline"
                            onClick={() => setDeleteId(r.id)}
                            aria-label={t("Hapus laporan {code}", "Delete report {code}", { code: r.code })}
                            className="h-8 gap-1 px-2.5 text-[11px] text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ============ KOLOM KANAN — builder ============ */}
        <div className="space-y-4" ref={builderRef}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                <Table2 className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
                {t("Susun Laporan", "Report Builder")}
                {editing && (
                  <Badge variant="outline" className="gap-1 bg-amber-50 text-[10px] font-bold text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25">
                    <Copy className="h-3 w-3" aria-hidden /> {editing.code} — {editing.name}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* ---- 1. entity ---- */}
              <div className="space-y-1.5">
                <Label htmlFor="cr-entity">{t("Sumber Data", "Data Source")}</Label>
                <Select value={entityKey || undefined} onValueChange={onEntityChange}>
                  <SelectTrigger id="cr-entity" className="w-full sm:w-[320px]">
                    <SelectValue placeholder={t("Pilih entity laporan…", "Pick a report entity…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((e) => (
                      <SelectItem key={e.key} value={e.key}>
                        <span className="font-medium">{t(e.label, e.labelEn)}</span>
                        <span className="ml-1.5 text-[10px] text-stone-400">{e.fields.length} {t("field", "fields")}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {entity && (
                  <p className="text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                    {t(entity.description, entity.descriptionEn)}
                  </p>
                )}
              </div>

              {/* ---- 2. field picker + urutan kolom ---- */}
              <Collapsible defaultOpen>
                <div className="rounded-xl border border-stone-200 dark:border-stone-800">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-900/60">
                    <ChevronDown className="h-4 w-4 text-stone-400 transition-transform [[data-state=open]>&]:rotate-180" aria-hidden />
                    <Filter className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
                    {t("Pilih Field", "Pick Fields")}
                    <Badge variant="outline" className={cn(
                      "ml-auto text-[10px] font-bold tabular-nums",
                      selected.length > 0
                        ? "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25"
                        : "bg-stone-100 text-stone-500 border-stone-200",
                    )}>
                      {selected.length}/{limits?.maxFields ?? 25}
                    </Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 border-t border-stone-200 px-3 py-3 dark:border-stone-800">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
                      <Input
                        value={fieldQuery}
                        onChange={(e) => setFieldQuery(e.target.value)}
                        placeholder={t("Cari field…", "Search fields…")}
                        className="h-9 pl-8 text-[13px]"
                        aria-label={t("Cari field", "Search fields")}
                      />
                    </div>
                    {fieldGroups.length === 0 ? (
                      <p className="py-2 text-center text-xs text-stone-400">{t("Tidak ada field cocok.", "No matching fields.")}</p>
                    ) : (
                      <div className="max-h-56 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
                        {fieldGroups.map((g) => (
                          <div key={g.group}>
                            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">{g.group}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {g.fields.map((f) => {
                                const on = selected.includes(f.key);
                                return (
                                  <button
                                    key={f.key}
                                    type="button"
                                    onClick={() => toggleField(f.key)}
                                    aria-pressed={on}
                                    title={`${f.label} · ${t(TYPE_LABEL[f.type].id, TYPE_LABEL[f.type].en)}`}
                                    className={cn(
                                      "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
                                      on
                                        ? "border-brand/40 bg-brand/10 text-brand-deep hover:border-brand/40 dark:border-brand/40 dark:bg-brand/10 dark:text-brand/75"
                                        : "border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800",
                                    )}
                                  >
                                    {on && <Check className="h-3 w-3" aria-hidden />}
                                    {t(f.label, f.labelEn)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* urutan kolom */}
                    {selectedDefs.length > 0 && (
                      <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-2 dark:border-stone-800 dark:bg-stone-900/40">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                          <ChevronUp className="h-3 w-3" aria-hidden /> {t("Urutan Kolom", "Column Order")}
                        </p>
                        <ol className="space-y-1">
                          {selectedDefs.map((f, i) => (
                            <li key={f.key} className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 dark:bg-stone-900">
                              <span className="w-5 shrink-0 text-center text-[10px] font-bold tabular-nums text-stone-400">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-stone-700 dark:text-stone-200">
                                {t(f.label, f.labelEn)}
                              </span>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => moveField(i, -1)} disabled={i === 0}
                                aria-label={t("Naikkan kolom {f}", "Move column {f} up", { f: f.label })}
                                className="h-7 w-7"
                              >
                                <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => moveField(i, 1)} disabled={i === selectedDefs.length - 1}
                                aria-label={t("Turunkan kolom {f}", "Move column {f} down", { f: f.label })}
                                className="h-7 w-7"
                              >
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => toggleField(f.key)}
                                aria-label={t("Hapus kolom {f}", "Remove column {f}", { f: f.label })}
                                className="h-7 w-7 text-rose-500 hover:text-rose-600"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* ---- 3. filter builder ---- */}
              <Collapsible defaultOpen>
                <div className="rounded-xl border border-stone-200 dark:border-stone-800">
                  <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-900/60">
                    <ChevronDown className="h-4 w-4 text-stone-400 transition-transform [[data-state=open]>&]:rotate-180" aria-hidden />
                    <Filter className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
                    {t("Filter Data", "Data Filters")}
                    <Badge variant="outline" className={cn(
                      "ml-auto text-[10px] font-bold tabular-nums",
                      filterRows.length > 0
                        ? "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25"
                        : "bg-stone-100 text-stone-500 border-stone-200",
                    )}>
                      {filterRows.length}/{limits?.maxFilters ?? 10}
                    </Badge>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2.5 border-t border-stone-200 px-3 py-3 dark:border-stone-800">
                    {filterRows.length === 0 && (
                      <p className="text-[11px] text-stone-500 dark:text-stone-400">
                        {t("Tanpa filter — seluruh baris entity diambil (maks 500 baris per halaman).", "No filters — the whole entity is fetched (max 500 rows per page).")}
                      </p>
                    )}
                    {filterRows.map((r, idx) => {
                      const def = filterableFields.find((f) => f.key === r.field);
                      const type = def?.type ?? "string";
                      const ops = opsByType?.[type] ?? ["eq"];
                      const noValue = r.op === "empty" || r.op === "notEmpty";
                      return (
                        <div key={r.uid} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50/60 p-2 dark:border-stone-800 dark:bg-stone-900/40">
                          <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-stone-400">{idx + 1}</span>
                          <Select value={r.field} onValueChange={(v) => onFilterField(r.uid, v)}>
                            <SelectTrigger className="h-8 w-[170px] text-[12px]" aria-label={t("Field filter baris {n}", "Filter field row {n}", { n: idx + 1 })}>
                              <SelectValue placeholder={t("Field…", "Field…")} />
                            </SelectTrigger>
                            <SelectContent>
                              {filterableFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>{t(f.label, f.labelEn)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={r.op} onValueChange={(v) => setFilterRows((prev) => prev.map((x) => (x.uid === r.uid ? { ...x, op: v } : x)))}>
                            <SelectTrigger className="h-8 w-[150px] text-[12px]" aria-label={t("Operator filter baris {n}", "Filter operator row {n}", { n: idx + 1 })}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ops.map((op) => (
                                <SelectItem key={op} value={op}>{opLabel(op)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {noValue ? (
                            <span className="flex h-8 items-center px-2 text-[11px] text-stone-400">
                              {t("(tanpa nilai)", "(no value)")}
                            </span>
                          ) : type === "date" ? (
                            <Input
                              type="date" value={r.value}
                              onChange={(e) => setFilterRows((prev) => prev.map((x) => (x.uid === r.uid ? { ...x, value: e.target.value } : x)))}
                              className="h-8 w-[150px] text-[12px]"
                              aria-label={t("Nilai filter baris {n}", "Filter value row {n}", { n: idx + 1 })}
                            />
                          ) : type === "boolean" ? (
                            <Select value={r.value || undefined} onValueChange={(v) => setFilterRows((prev) => prev.map((x) => (x.uid === r.uid ? { ...x, value: v } : x)))}>
                              <SelectTrigger className="h-8 w-[130px] text-[12px]" aria-label={t("Nilai filter baris {n}", "Filter value row {n}", { n: idx + 1 })}>
                                <SelectValue placeholder={t("Ya/Tidak…", "Yes/No…")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">{t("Ya", "Yes")}</SelectItem>
                                <SelectItem value="false">{t("Tidak", "No")}</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              type={type === "number" ? "number" : "text"}
                              inputMode={type === "number" ? "decimal" : undefined}
                              value={r.value}
                              onChange={(e) => setFilterRows((prev) => prev.map((x) => (x.uid === r.uid ? { ...x, value: e.target.value } : x)))}
                              placeholder={r.op === "in" ? t("nilai1, nilai2, …", "value1, value2, …") : t("nilai", "value")}
                              className="h-8 w-[150px] flex-1 text-[12px]"
                              aria-label={t("Nilai filter baris {n}", "Filter value row {n}", { n: idx + 1 })}
                            />
                          )}
                          <Button
                            variant="ghost" size="icon"
                            onClick={() => setFilterRows((prev) => prev.filter((x) => x.uid !== r.uid))}
                            aria-label={t("Hapus baris filter {n}", "Remove filter row {n}", { n: idx + 1 })}
                            className="ml-auto h-8 w-8 shrink-0 text-rose-500 hover:text-rose-600"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </div>
                      );
                    })}
                    <Button variant="outline" size="sm" onClick={addFilter} className="h-8 gap-1 text-[12px]">
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah Filter", "Add Filter")}
                    </Button>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              {/* ---- 4. aksi ---- */}
              <div className="flex flex-wrap items-center gap-2">
                {canRun && (
                  <Button onClick={doRun} disabled={running || !entityKey || selected.length === 0} className="gap-1.5">
                    {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    {t("Jalankan", "Run")}
                  </Button>
                )}
                {canExport && (
                  <>
                    <Button variant="outline" onClick={() => void doExport("csv")} disabled={exporting !== null || !entityKey || selected.length === 0} className="gap-1.5">
                      {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                      {t("Ekspor CSV", "Export CSV")}
                    </Button>
                    <Button variant="outline" onClick={() => void doExport("xlsx")} disabled={exporting !== null || !entityKey || selected.length === 0} className="gap-1.5">
                      {exporting === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />}
                      {t("Ekspor Excel", "Export Excel")}
                    </Button>
                  </>
                )}
                {(canCreate || (editing && canUpdate)) && (
                  <Button variant="outline" onClick={openSaveDialog} disabled={!entityKey || selected.length === 0} className="gap-1.5">
                    <Save className="h-4 w-4" aria-hidden />
                    {editing ? t("Simpan Perubahan…", "Save Changes…") : t("Simpan…", "Save…")}
                  </Button>
                )}
                {!canRun && !canExport && !canCreate && (
                  <p className="flex items-center gap-1.5 text-[11px] text-stone-400">
                    <Info className="h-3.5 w-3.5" aria-hidden />
                    {t("Anda hanya dapat melihat laporan tersimpan.", "You can only view saved reports.")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ---- 5. hasil ---- */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-[15px]">
                <Table2 className="h-4 w-4 text-brand dark:text-brand/85" aria-hidden />
                {t("Hasil", "Result")}
                {result && (
                  <span className="text-[11px] font-normal text-stone-500 dark:text-stone-400">
                    {entityLabelOf(result.entity)} · {t("{n} baris", "{n} rows", { n: result.total })}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {catalog.loading ? (
                <LoadingRows rows={5} />
              ) : catalog.error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400" role="alert">
                  {catalog.error}
                </p>
              ) : running ? (
                <LoadingRows rows={8} />
              ) : !result ? (
                <EmptyState
                  icon={Table2}
                  title={t("Belum ada hasil", "No result yet")}
                  description={t("Susun entity, field & filter lalu klik Jalankan.", "Pick entity, fields & filters then click Run.")}
                />
              ) : result.rows.length === 0 ? (
                <EmptyState
                  icon={Table2}
                  title={t("0 baris cocok", "0 matching rows")}
                  description={t("Tidak ada data yang memenuhi filter — longgarkan kriteria.", "No data matches the filters — relax the criteria.")}
                />
              ) : (
                <div className="space-y-2">
                  {result.truncated && (
                    <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400" role="status">
                      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t(
                        "Menampilkan {n} baris pertama dari {total} — persempit filter utk hasil lengkap.",
                        "Showing the first {n} of {total} rows — narrow the filters for the full result.",
                        { n: result.pageSize, total: result.total },
                      )}
                    </p>
                  )}
                  <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-xl border border-stone-200 pr-1 [scrollbar-width:thin] dark:border-stone-800">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-stone-50/95 backdrop-blur dark:bg-stone-900/95">
                        <TableRow>
                          <TableHead className="w-8 text-[10px] text-stone-400">#</TableHead>
                          {result.columns.map((c) => (
                            <TableHead
                              key={c.key}
                              title={t(TYPE_LABEL[c.type].id, TYPE_LABEL[c.type].en)}
                              className={cn("whitespace-nowrap text-[11px]", c.type === "number" && "text-right")}
                            >
                              {t(c.label, c.labelEn)}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.rows.map((row, i) => (
                          <TableRow key={i} className="text-[12px]">
                            <TableCell className="text-[10px] tabular-nums text-stone-400">{(result.page - 1) * result.pageSize + i + 1}</TableCell>
                            {result.columns.map((c) => (
                              <TableCell
                                key={c.key}
                                className={cn("max-w-[280px]", c.type === "number" && "text-right tabular-nums")}
                              >
                                <CellValue v={row[c.key]} type={c.type} />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ============ dialog simpan ============ */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-h-[calc(100dvh-3rem)] sm:max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t("Simpan Perubahan Laporan", "Save Report Changes") : t("Simpan Laporan Baru", "Save New Report")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Definisi entity, field & filter saat ini akan disimpan ke daftar Laporan Tersimpan.",
                "The current entity, fields & filters will be saved to the Saved Reports list.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cr-save-name">{t("Nama Laporan", "Report Name")}</Label>
              <Input
                id="cr-save-name" value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={t("mis. Karyawan Aktif per Unit", "e.g. Active Employees by Unit")}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-save-desc">{t("Deskripsi (opsional)", "Description (optional)")}</Label>
              <Textarea
                id="cr-save-desc" value={saveDesc} rows={3}
                onChange={(e) => setSaveDesc(e.target.value)}
                placeholder={t("Tujuan / periode / catatan penggunaan laporan…", "Purpose / period / usage notes…")}
                maxLength={500}
              />
            </div>
            {entity && (
              <p className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] text-stone-500 dark:bg-stone-900/60 dark:text-stone-400">
                {entityLabelOf(entity.key)} · {selected.length} {t("field", "fields")} · {filterRows.length} {t("filter", "filters")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              {t("Batal", "Cancel")}
            </Button>
            <Button onClick={() => void doSave()} disabled={saving || !saveName.trim()} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {editing ? t("Simpan Perubahan", "Save Changes") : t("Simpan", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ dialog hapus ============ */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus Laporan Tersimpan?", "Delete Saved Report?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Definisi laporan dihapus permanen dari daftar. Data entity tidak terpengaruh.",
                "The report definition is permanently removed from the list. Entity data is unaffected.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // tombol jangan menutup otomatis — menunggu DELETE selesai
                void doDelete();
              }}
              disabled={deleting}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {t("Hapus", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
