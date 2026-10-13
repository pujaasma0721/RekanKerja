"use client";
// RekanKerja Performance — Master Kinerja (P0 — DEVELOPMENT-PLAN-PERFORMANCE.md
// §14.2 + §18.9 versioning pustaka AMANDEMEN 2): CRUD 5 tipe master via satu
// endpoint ?type=… (pola recruitment-masters; label dwibahasa inline t()).
// Tab: KPI library · Kompetensi · Skala Rating · Template Bobot · Matriks Merit.
// Perilaku versioning §18.9: edit minor inline; perubahan definitif → dialog
// "Simpan sebagai versi baru" (tahun berlaku + catatan wajib); versi lama
// otomatis Superseded; riwayat versi = dialog diff field demi field.
import { useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ListChecks, Users, Scale, Grid3x3, Wallet, History, GitBranch, Zap, Plus, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

// ---------- tipe baris ----------

interface KpiRowUI {
  id: string; code: string; name: string; category: string; polarity: string;
  unit: string; dataSource: string; sourceKey: string | null; description: string | null;
  active: boolean; versionNo: number; effectiveYear: number; status: string;
  supersededById: string | null; changeNote: string | null;
}
interface CompRowUI {
  id: string; code: string; name: string; kind: string; levelsJson: string;
  active: boolean; versionNo: number; effectiveYear: number; status: string;
  supersededById: string | null; changeNote: string | null;
}
interface ScaleRowUI {
  id: string; value: number; labelId: string; labelEn: string;
  minScore: number; color: string; guideline: string | null;
}
interface TplItemUI { id: string; kind: string; refId: string; weight: number }
interface TplRowUI {
  id: string; code: string; name: string; weightsJson: string; active: boolean; items: TplItemUI[];
}
interface MatrixRowUI {
  id: string; code: string; name: string; gridJson: string; active: boolean;
}

const TABS = [
  { id: "kpi", label: "Pustaka KPI", labelEn: "KPI Library", icon: ListChecks },
  { id: "competency", label: "Kompetensi", labelEn: "Competencies", icon: Users },
  { id: "rating-scale", label: "Skala Rating", labelEn: "Rating Scale", icon: Scale },
  { id: "template", label: "Template Bobot", labelEn: "Weight Templates", icon: Grid3x3 },
  { id: "merit-matrix", label: "Matriks Merit", labelEn: "Merit Matrix", icon: Wallet },
] as const;

const KPI_CATS = [
  { id: "Financial", label: "Financial", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" },
  { id: "Customer", label: "Customer", tone: "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400" },
  { id: "InternalProcess", label: "Proses Internal", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400" },
  { id: "LearningGrowth", label: "Pembelajaran", tone: "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400" },
];
const COMP_KINDS = ["CoreValue", "Managerial", "Technical"];
const SCALE_COLORS = ["emerald", "teal", "amber", "orange", "rose", "slate"];
const DATA_SOURCES = ["Manual", "Attendance", "Payroll", "Recruitment", "Leave"];

type LevelDef = { level: number; label: string; descriptor: string };

function parseLevels(json: string): LevelDef[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function catLabel(t: (a: string, b: string) => string, id: string): string {
  const c = KPI_CATS.find((x) => x.id === id);
  if (!c) return id;
  return t(c.label, c.id === "InternalProcess" ? "Internal Process" : c.id === "LearningGrowth" ? "Learning & Growth" : c.label);
}

function scaleTone(color: string): string {
  switch (color) {
    case "emerald": return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400";
    case "teal": return "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-400";
    case "amber": return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400";
    case "orange": return "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-400";
    case "rose": return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400";
    default: return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

// ============================================================================
// HALAMAN
// ============================================================================

export function PerformanceMastersPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<string>("kpi");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance · P0"
        title={t("Master Kinerja", "Performance Masters")}
        description={t(
          "Pustaka KPI & kompetensi ber-versi, skala rating, template bobot penilaian, dan matriks merit. Perubahan definitif wajib menjadi versi baru — data penilaian lama selalu aman.",
          "Versioned KPI & competency library, rating scales, appraisal weight templates, and merit matrix. Definitive changes require a new version — historical appraisal data stays safe.",
        )}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {TABS.map((x) => (
            <TabsTrigger key={x.id} value={x.id} className="gap-1.5">
              <x.icon className="h-3.5 w-3.5" />
              {t(x.label, x.labelEn)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "kpi" && <KpiTab />}
      {tab === "competency" && <CompTab />}
      {tab === "rating-scale" && <ScaleTab />}
      {tab === "template" && <TemplateTab />}
      {tab === "merit-matrix" && <MatrixTab />}
    </div>
  );
}

// ============================================================================
// TAB KPI — dengan versioning §18.9
// ============================================================================

function KpiTab() {
  const { t } = useI18n();
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [allVersions, setAllVersions] = useState(false);
  const { data, loading, error, refresh: reload } = useApi<{ rows: KpiRowUI[] }>(
    `/api/rekankerja/performance/masters?type=kpi${allVersions ? "&allVersions=1" : ""}`,
  );
  const [form, setForm] = useState<null | {
    id?: string; code: string; name: string; category: string; polarity: string;
    unit: string; dataSource: string; sourceKey: string; description: string; active: boolean;
    asNewVersion?: boolean; effectiveYear: string; changeNote: string;
  }>(null);
  const [hist, setHist] = useState<null | { code: string; versions: Record<string, unknown>[] }>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return catFilter === "ALL" ? all : all.filter((r) => r.category === catFilter);
  }, [data, catFilter]);

  const openNew = () =>
    setForm({
      code: "", name: "", category: "InternalProcess", polarity: "Higher", unit: "%",
      dataSource: "Manual", sourceKey: "", description: "", active: true,
      effectiveYear: String(new Date().getFullYear()), changeNote: "",
    });

  const openEdit = (r: KpiRowUI) =>
    setForm({
      id: r.id, code: r.code, name: r.name, category: r.category, polarity: r.polarity,
      unit: r.unit, dataSource: r.dataSource, sourceKey: r.sourceKey ?? "",
      description: r.description ?? "", active: r.active,
      asNewVersion: false,
      effectiveYear: String(new Date().getFullYear() + 1), changeNote: "",
    });

  // deteksi perubahan definitif (bandingkan vs baris asal)
  const editingOrig = useMemo(() => (form?.id ? (data?.rows ?? []).find((r) => r.id === form.id) : undefined), [form, data]);
  const dirtyVs = (orig: KpiRowUI | undefined): boolean => {
    if (!orig || !form) return false;
    return (
      orig.unit !== form.unit || orig.polarity !== form.polarity ||
      orig.category !== form.category || orig.dataSource !== form.dataSource ||
      (orig.sourceKey ?? "") !== form.sourceKey
    );
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend<{ id: string }>("/api/rekankerja/performance/masters", "POST", {
        type: "kpi",
        id: form.id, // selalu kirim id saat edit — service yang memutuskan versi-baru vs inline (§18.9)
        code: form.code, name: form.name, category: form.category, polarity: form.polarity,
        unit: form.unit, dataSource: form.dataSource,
        sourceKey: form.sourceKey || null,
        description: form.description || null, active: form.active,
        asNewVersion: form.asNewVersion === true,
        effectiveYear: Number(form.effectiveYear) || undefined,
        changeNote: form.changeNote || null,
      });
      toast.success(
        form.asNewVersion
          ? t("Versi baru dibuat — versi lama menjadi Superseded", "New version created — old version superseded")
          : t("KPI disimpan", "KPI saved"),
      );
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: KpiRowUI) {
    if (!confirm(t(`Arsipkan/hapus KPI ${r.code}?`, `Archive/delete KPI ${r.code}?`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?type=kpi&id=${r.id}`, "DELETE");
      toast.success(t("KPI diarsipkan/dihapus", "KPI archived/deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  }

  const openHist = async (code: string) => {
    try {
      const res = await fetch(`/api/rekankerja/performance/masters?type=kpi&history=${encodeURIComponent(code)}`);
      const j = (await res.json()) as { versions?: Record<string, unknown>[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? "unknown");
      setHist({ code, versions: j.versions ?? [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant={catFilter === "ALL" ? "default" : "outline"} onClick={() => setCatFilter("ALL")}>
              {t("Semua", "All")}
            </Button>
            {KPI_CATS.map((c) => (
              <Button key={c.id} size="sm" variant={catFilter === c.id ? "default" : "outline"} onClick={() => setCatFilter(c.id)}>
                {catLabel(t, c.id)}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <GitBranch className="h-3.5 w-3.5" />
              {t("Semua versi", "All versions")}
              <Switch checked={allVersions} onCheckedChange={setAllVersions} />
            </label>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4" /> {t("KPI Baru", "New KPI")}
            </Button>
          </div>
        </div>

        <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
              <TableRow>
                <TableHead>{t("Kode", "Code")}</TableHead>
                <TableHead>{t("Nama", "Name")}</TableHead>
                <TableHead>{t("Kategori", "Category")}</TableHead>
                <TableHead>{t("Polaritas", "Polarity")}</TableHead>
                <TableHead>{t("Satuan", "Unit")}</TableHead>
                <TableHead>{t("Sumber", "Source")}</TableHead>
                <TableHead>{t("Versi", "Version")}</TableHead>
                <TableHead className="w-28 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}><LoadingRows /></TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <EmptyState icon={ListChecks} title={t("Belum ada KPI", "No KPIs yet")} description={error ?? undefined} />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      {r.description ? (
                        <div className="max-w-xs truncate text-xs text-slate-500">{r.description}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs", KPI_CATS.find((c) => c.id === r.category)?.tone ?? "")}>
                        {catLabel(t, r.category)}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.polarity === "Higher" ? t("Makin tinggi makin baik", "Higher is better") : r.polarity === "Lower" ? t("Makin rendah makin baik", "Lower is better") : "Boolean"}
                    </TableCell>
                    <TableCell className="text-xs">{r.unit}</TableCell>
                    <TableCell className="text-xs">
                      {r.dataSource !== "Manual" ? (
                        <span className="inline-flex items-center gap-1 text-fuchsia-600 dark:text-fuchsia-400">
                          <Zap className="h-3 w-3" />
                          {r.dataSource}
                        </span>
                      ) : (
                        <span className="text-slate-500">{t("Manual", "Manual")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs",
                        r.status === "Active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                          : r.status === "Superseded" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400",
                      )}>
                        v{r.versionNo} · {r.effectiveYear}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title={t("Riwayat versi", "Version history")} onClick={() => openHist(r.code)}>
                          <History className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* ---------- dialog form KPI ---------- */}
      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id && !form.asNewVersion
                ? t("Ubah KPI", "Edit KPI")
                : form?.asNewVersion
                  ? t("Simpan sebagai Versi Baru", "Save as New Version")
                  : t("KPI Baru", "New KPI")}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Kode", "Code")}</Label>
                  <Input value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="FIN-RECV" />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Nama", "Name")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Kategori", "Category")}</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })} disabled={!!form.id && !form.asNewVersion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KPI_CATS.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{catLabel(t, c.id)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Polaritas", "Polarity")}</Label>
                  <Select value={form.polarity} onValueChange={(v) => setForm({ ...form, polarity: v })} disabled={!!form.id && !form.asNewVersion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Higher">{t("Makin tinggi makin baik", "Higher is better")}</SelectItem>
                      <SelectItem value="Lower">{t("Makin rendah makin baik", "Lower is better")}</SelectItem>
                      <SelectItem value="Boolean">Boolean</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Satuan", "Unit")}</Label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} disabled={!!form.id && !form.asNewVersion} placeholder={t("% | Rp | hari", "% | Rp | days")} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Sumber Data", "Data Source")}</Label>
                  <Select value={form.dataSource} onValueChange={(v) => setForm({ ...form, dataSource: v, sourceKey: v === "Manual" ? "" : form.sourceKey })} disabled={!!form.id && !form.asNewVersion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATA_SOURCES.map((d) => <SelectItem key={d} value={d}>{d === "Manual" ? t("Manual", "Manual") : d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Kunci sumber (auto)", "Source key (auto)")}</Label>
                  <Input
                    value={form.sourceKey}
                    disabled={form.dataSource === "Manual" || (!!form.id && !form.asNewVersion)}
                    onChange={(e) => setForm({ ...form, sourceKey: e.target.value })}
                    placeholder="attendance_presence_pct"
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("Deskripsi", "Description")}</Label>
                <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>

              {form.id && dirtyVs(editingOrig) && !form.asNewVersion && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {t(
                    "Anda mengubah field definitif (satuan/polaritas/kategori/sumber). Gunakan \"Simpan sebagai versi baru\" — data penilaian historis harus tetap konsisten (§18.9).",
                    "You changed a definitive field (unit/polarity/category/source). Use \"Save as new version\" — historical appraisal data must stay consistent (§18.9).",
                  )}
                </div>
              )}
              {form.id && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.asNewVersion === true}
                    onCheckedChange={(v) => setForm({ ...form, asNewVersion: v === true })}
                  />
                  <GitBranch className="h-4 w-4 text-fuchsia-600" />
                  {t("Simpan sebagai versi baru", "Save as new version")}
                </label>
              )}
              {form.id && form.asNewVersion && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("Tahun berlaku", "Effective year")}</Label>
                    <Input type="number" value={form.effectiveYear} onChange={(e) => setForm({ ...form, effectiveYear: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("Catatan perubahan", "Change note")} *</Label>
                    <Input value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} placeholder={t("mis. satuan % → hari", "e.g. unit % → days")} />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                {t("Aktif (tampil di picker)", "Active (shown in picker)")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : form?.asNewVersion ? t("Buat versi", "Create version") : t("Simpan", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- dialog riwayat versi ---------- */}
      <Dialog open={hist != null} onOpenChange={(o) => !o && setHist(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("Riwayat Versi", "Version History")} — <span className="font-mono text-sm">{hist?.code}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {(hist?.versions ?? []).map((v) => (
              <div key={String(v.id)} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">v{String(v.versionNo)}</Badge>
                  <span className="text-xs text-slate-500">
                    {t("berlaku", "effective")} {String(v.effectiveYear)}
                  </span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    v.status === "Active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800",
                  )}>
                    {String(v.status)}
                  </span>
                </div>
                {v.changeNote ? <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{String(v.changeNote)}</div> : null}
                <div className="mt-1 text-xs text-slate-500">
                  {String(v.polarity ?? "")} · {String(v.unit ?? "")} · {catLabel(t, String(v.category ?? ""))}
                </div>
              </div>
            ))}
            {(hist?.versions ?? []).length === 0 ? (
              <EmptyState icon={History} title={t("Belum ada riwayat", "No history yet")} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// TAB KOMPETENSI — editor deskriptor 5 level + versioning
// ============================================================================

function CompTab() {
  const { t } = useI18n();
  const [allVersions, setAllVersions] = useState(false);
  const { data, loading, error, refresh: reload } = useApi<{ rows: CompRowUI[] }>(
    `/api/rekankerja/performance/masters?type=competency${allVersions ? "&allVersions=1" : ""}`,
  );
  const [form, setForm] = useState<null | {
    id?: string; code: string; name: string; kind: string;
    levels: LevelDef[]; active: boolean;
    asNewVersion?: boolean; effectiveYear: string; changeNote: string;
  }>(null);
  const [hist, setHist] = useState<null | { code: string; versions: Record<string, unknown>[] }>(null);
  const [busy, setBusy] = useState(false);

  const emptyLevels = (): LevelDef[] =>
    [1, 2, 3, 4, 5].map((lv) => ({ level: lv, label: "", descriptor: "" }));

  const openNew = () =>
    setForm({ code: "", name: "", kind: "Technical", levels: emptyLevels(), active: true, effectiveYear: String(new Date().getFullYear()), changeNote: "" });

  const openEdit = (r: CompRowUI) =>
    setForm({
      id: r.id, code: r.code, name: r.name, kind: r.kind,
      levels: parseLevels(r.levelsJson).length ? parseLevels(r.levelsJson) : emptyLevels(),
      active: r.active, asNewVersion: false,
      effectiveYear: String(new Date().getFullYear() + 1), changeNote: "",
    });

  const editingOrig = useMemo(() => (form?.id ? (data?.rows ?? []).find((r) => r.id === form.id) : undefined), [form, data]);
  const dirtyVs = (orig: CompRowUI | undefined): boolean => {
    if (!orig || !form) return false;
    return orig.kind !== form.kind || orig.levelsJson !== JSON.stringify(form.levels);
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/masters", "POST", {
        type: "competency",
        id: form.id,
        code: form.code, name: form.name, kind: form.kind,
        levelsJson: JSON.stringify(form.levels.filter((l) => l.label || l.descriptor)),
        active: form.active,
        asNewVersion: form.asNewVersion === true,
        effectiveYear: Number(form.effectiveYear) || undefined,
        changeNote: form.changeNote || null,
      });
      toast.success(form.asNewVersion ? t("Versi baru dibuat", "New version created") : t("Kompetensi disimpan", "Competency saved"));
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: CompRowUI) {
    if (!confirm(t(`Arsipkan/hapus kompetensi ${r.code}?`, `Archive/delete competency ${r.code}?`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?type=competency&id=${r.id}`, "DELETE");
      toast.success(t("Kompetensi diarsipkan/dihapus", "Competency archived/deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  }

  const openHist = async (code: string) => {
    try {
      const res = await fetch(`/api/rekankerja/performance/masters?type=competency&history=${encodeURIComponent(code)}`);
      const j = (await res.json()) as { versions?: Record<string, unknown>[]; error?: string };
      if (!res.ok) throw new Error(j.error ?? "unknown");
      setHist({ code, versions: j.versions ?? [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  };

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <GitBranch className="h-3.5 w-3.5" />
            {t("Semua versi", "All versions")}
            <Switch checked={allVersions} onCheckedChange={setAllVersions} />
          </label>
          <Button size="sm" className="ml-auto" onClick={openNew}>
            <Plus className="h-4 w-4" /> {t("Kompetensi Baru", "New Competency")}
          </Button>
        </div>

        <div className="mt-4 max-h-[28rem] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
              <TableRow>
                <TableHead>{t("Kode", "Code")}</TableHead>
                <TableHead>{t("Nama", "Name")}</TableHead>
                <TableHead>{t("Jenis", "Kind")}</TableHead>
                <TableHead>{t("Level", "Levels")}</TableHead>
                <TableHead>{t("Versi", "Version")}</TableHead>
                <TableHead className="w-28 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}><LoadingRows /></TableCell>
                </TableRow>
              ) : (data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState icon={Users} title={t("Belum ada kompetensi", "No competencies yet")} description={error ?? undefined} />
                  </TableCell>
                </TableRow>
              ) : (
                (data?.rows ?? []).map((r) => {
                  const lv = parseLevels(r.levelsJson).length;
                  const kindTone =
                    r.kind === "CoreValue" ? "bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-400"
                      : r.kind === "Managerial" ? "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-400"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-0.5 text-xs", kindTone)}>
                          {r.kind === "CoreValue" ? t("Nilai Inti", "Core Value") : r.kind === "Managerial" ? t("Manajerial", "Managerial") : t("Teknis", "Technical")}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{lv} {t("level", "levels")}</TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 font-mono text-xs",
                          r.status === "Active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800",
                        )}>
                          v{r.versionNo} · {r.effectiveYear}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title={t("Riwayat versi", "Version history")} onClick={() => openHist(r.code)}>
                            <History className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {/* dialog form kompetensi */}
      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {form?.id && !form.asNewVersion ? t("Ubah Kompetensi", "Edit Competency")
                : form?.asNewVersion ? t("Simpan sebagai Versi Baru", "Save as New Version")
                  : t("Kompetensi Baru", "New Competency")}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Kode", "Code")}</Label>
                  <Input value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="CV-INTEGRITAS" />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Nama", "Name")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Jenis", "Kind")}</Label>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })} disabled={!!form.id && !form.asNewVersion}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CoreValue">{t("Nilai Inti", "Core Value")}</SelectItem>
                      <SelectItem value="Managerial">{t("Manajerial", "Managerial")}</SelectItem>
                      <SelectItem value="Technical">{t("Teknis", "Technical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>{t("Deskriptor Level (anchor perilaku anti-halo)", "Level descriptors (behavioral anchors, anti-halo)")}</Label>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border p-3">
                  {form.levels.map((l, idx) => (
                    <div key={l.level} className="grid grid-cols-[3rem_10rem_1fr] gap-2">
                      <div className="flex items-center justify-center rounded-md bg-slate-100 font-mono text-sm dark:bg-slate-800">{l.level}</div>
                      <Input
                        value={l.label}
                        placeholder={t("label ringkas", "short label")}
                        disabled={!!form.id && !form.asNewVersion}
                        onChange={(e) => {
                          const levels = [...form.levels];
                          levels[idx] = { ...l, label: e.target.value };
                          setForm({ ...form, levels });
                        }}
                      />
                      <Textarea
                        rows={1}
                        className="min-h-9"
                        value={l.descriptor}
                        placeholder={t("deskriptor perilaku teramati", "observable behavior descriptor")}
                        disabled={!!form.id && !form.asNewVersion}
                        onChange={(e) => {
                          const levels = [...form.levels];
                          levels[idx] = { ...l, descriptor: e.target.value };
                          setForm({ ...form, levels });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {form.id && dirtyVs(editingOrig) && !form.asNewVersion && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {t(
                    "Perubahan deskriptor level/jenis bersifat definitif — gunakan \"Simpan sebagai versi baru\" (§18.9).",
                    "Level descriptor/kind changes are definitive — use \"Save as new version\" (§18.9).",
                  )}
                </div>
              )}
              {form.id && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.asNewVersion === true} onCheckedChange={(v) => setForm({ ...form, asNewVersion: v === true })} />
                  <GitBranch className="h-4 w-4 text-fuchsia-600" />
                  {t("Simpan sebagai versi baru", "Save as new version")}
                </label>
              )}
              {form.id && form.asNewVersion && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("Tahun berlaku", "Effective year")}</Label>
                    <Input type="number" value={form.effectiveYear} onChange={(e) => setForm({ ...form, effectiveYear: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("Catatan perubahan", "Change note")} *</Label>
                    <Input value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} />
                  </div>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                {t("Aktif (tampil di picker)", "Active (shown in picker)")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy}>{busy ? t("Menyimpan…", "Saving…") : t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* riwayat versi kompetensi */}
      <Dialog open={hist != null} onOpenChange={(o) => !o && setHist(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Riwayat Versi", "Version History")} — <span className="font-mono text-sm">{hist?.code}</span></DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {(hist?.versions ?? []).map((v) => {
              const lv = typeof v.levelsJson === "string" ? parseLevels(v.levelsJson) : [];
              return (
                <div key={String(v.id)} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">v{String(v.versionNo)}</Badge>
                    <span className="text-xs text-slate-500">{t("berlaku", "effective")} {String(v.effectiveYear)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", v.status === "Active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800")}>
                      {String(v.status)}
                    </span>
                  </div>
                  {v.changeNote ? <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{String(v.changeNote)}</div> : null}
                  <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                    {lv.map((l) => (
                      <div key={l.level} className="truncate">· <span className="font-medium">{l.label}</span> — {l.descriptor}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// TAB SKALA RATING
// ============================================================================

function ScaleTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh: reload } = useApi<{ rows: ScaleRowUI[] }>("/api/rekankerja/performance/masters?type=rating-scale");
  const [form, setForm] = useState<null | {
    id?: string; value: string; labelId: string; labelEn: string;
    minScore: string; color: string; guideline: string;
  }>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/masters", "POST", {
        type: "rating-scale",
        id: form.id,
        value: Number(form.value), labelId: form.labelId, labelEn: form.labelEn,
        minScore: Number(form.minScore), color: form.color, guideline: form.guideline || null,
      });
      toast.success(t("Skala rating disimpan", "Rating scale saved"));
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: ScaleRowUI) {
    if (!confirm(t(`Hapus tingkat rating ${r.value}?`, `Delete rating level ${r.value}?`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?type=rating-scale&id=${r.id}`, "DELETE");
      toast.success(t("Skala dihapus", "Scale deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("Konversi skor akhir → rating (ambang min per tingkat).", "Final score → rating conversion (min threshold per level).")}
          </p>
          <Button size="sm" onClick={() => setForm({ value: "3", labelId: "", labelEn: "", minScore: "70", color: "amber", guideline: "" })}>
            <Plus className="h-4 w-4" /> {t("Tingkat Baru", "New Level")}
          </Button>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Nilai", "Value")}</TableHead>
                <TableHead>{t("Label (ID)", "Label (ID)")}</TableHead>
                <TableHead>{t("Label (EN)", "Label (EN)")}</TableHead>
                <TableHead>{t("Ambang skor ≥", "Min score ≥")}</TableHead>
                <TableHead>{t("Panduan", "Guideline")}</TableHead>
                <TableHead className="w-20 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}><LoadingRows /></TableCell>
                </TableRow>
              ) : (data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState icon={Scale} title={t("Belum ada skala", "No scale yet")} description={error ?? undefined} />
                  </TableCell>
                </TableRow>
              ) : (
                (data?.rows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full font-semibold", scaleTone(r.color))}>{r.value}</span>
                    </TableCell>
                    <TableCell className="font-medium">{r.labelId}</TableCell>
                    <TableCell className="text-slate-500">{r.labelEn}</TableCell>
                    <TableCell className="font-mono text-xs">{r.minScore}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-slate-500">{r.guideline}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setForm({
                          id: r.id, value: String(r.value), labelId: r.labelId, labelEn: r.labelEn,
                          minScore: String(r.minScore), color: r.color, guideline: r.guideline ?? "",
                        })}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("Ubah Tingkat", "Edit Level") : t("Tingkat Baru", "New Level")}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Nilai (1–10)", "Value (1–10)")}</Label>
                  <Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Ambang skor ≥", "Min score ≥")}</Label>
                  <Input type="number" value={form.minScore} onChange={(e) => setForm({ ...form, minScore: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Label (ID)", "Label (ID)")}</Label>
                  <Input value={form.labelId} onChange={(e) => setForm({ ...form, labelId: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Label (EN)", "Label (EN)")}</Label>
                  <Input value={form.labelEn} onChange={(e) => setForm({ ...form, labelEn: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("Warna", "Color")}</Label>
                <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCALE_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("Panduan deskriptor", "Guideline")}</Label>
                <Textarea rows={2} value={form.guideline} onChange={(e) => setForm({ ...form, guideline: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// TAB TEMPLATE BOBOT
// ============================================================================

function TemplateTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh: reload } = useApi<{ rows: TplRowUI[] }>("/api/rekankerja/performance/masters?type=template");
  const kpiQ = useApi<{ rows: KpiRowUI[] }>("/api/rekankerja/performance/masters?type=kpi");
  const compQ = useApi<{ rows: CompRowUI[] }>("/api/rekankerja/performance/masters?type=competency");
  const [form, setForm] = useState<null | {
    id?: string; code: string; name: string;
    kpi: number; competency: number; core: number; active: boolean;
    items: { kind: string; refId: string; weight: number }[];
  }>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => setForm({ code: "", name: "", kpi: 70, competency: 20, core: 10, active: true, items: [] });
  const openEdit = (r: TplRowUI) => {
    const w = JSON.parse(r.weightsJson || "{}") as { kpi?: number; competency?: number; core?: number };
    setForm({
      id: r.id, code: r.code, name: r.name,
      kpi: w.kpi ?? 70, competency: w.competency ?? 20, core: w.core ?? 10,
      active: r.active,
      items: (r.items ?? []).map((i) => ({ kind: i.kind, refId: i.refId, weight: i.weight })),
    });
  };

  const wSum = (form?.kpi ?? 0) + (form?.competency ?? 0) + (form?.core ?? 0);
  const kpiItems = form?.items.filter((i) => i.kind === "Kpi") ?? [];
  const compItems = form?.items.filter((i) => i.kind === "Competency") ?? [];
  const kpiSum = kpiItems.reduce((a, b) => a + b.weight, 0);
  const compSum = compItems.reduce((a, b) => a + b.weight, 0);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/masters", "POST", {
        type: "template", id: form.id, code: form.code, name: form.name,
        weights: { kpi: form.kpi, competency: form.competency, core: form.core },
        items: form.items, active: form.active,
      });
      toast.success(t("Template disimpan", "Template saved"));
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: TplRowUI) {
    if (!confirm(t(`Hapus template ${r.code}?`, `Delete template ${r.code}?`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?type=template&id=${r.id}`, "DELETE");
      toast.success(t("Template dihapus", "Template deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  }

  const addItem = (kind: string) => {
    if (!form) return;
    const pool = kind === "Kpi" ? kpiQ.data?.rows ?? [] : compQ.data?.rows ?? [];
    const first = pool[0];
    if (!first) { toast.error(t("Pustaka kosong — buat dulu di tab terkait", "Library empty — create entries first")); return; }
    setForm({ ...form, items: [...form.items, { kind, refId: first.id, weight: 20 }] });
  };

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("Bobot komponen penilaian per kelompok jabatan + item pustaka per komponen (Σ item per komponen = 100).", "Appraisal component weights per job group + library items per component (Σ items per component = 100).")}
          </p>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> {t("Template Baru", "New Template")}</Button>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Kode", "Code")}</TableHead>
                <TableHead>{t("Nama", "Name")}</TableHead>
                <TableHead>KPI / {t("Kompetensi", "Competency")} / {t("Nilai inti", "Core")}</TableHead>
                <TableHead>{t("Item", "Items")}</TableHead>
                <TableHead>{t("Status", "Status")}</TableHead>
                <TableHead className="w-20 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}><LoadingRows /></TableCell>
                </TableRow>
              ) : (data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState icon={Grid3x3} title={t("Belum ada template", "No templates yet")} description={error ?? undefined} />
                  </TableCell>
                </TableRow>
              ) : (
                (data?.rows ?? []).map((r) => {
                  const w = JSON.parse(r.weightsJson || "{}") as { kpi?: number; competency?: number; core?: number };
                  const nK = (r.items ?? []).filter((i) => i.kind === "Kpi").length;
                  const nC = (r.items ?? []).filter((i) => i.kind === "Competency").length;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{w.kpi}/{w.competency}/{w.core}</TableCell>
                      <TableCell className="text-xs">{nK} KPI + {nC} {t("komp", "comp")}</TableCell>
                      <TableCell>
                        {r.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t("Aktif", "Active")}</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{t("Nonaktif", "Inactive")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("Ubah Template", "Edit Template") : t("Template Baru", "New Template")}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Kode", "Code")}</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="TPL-UMUM" />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Nama", "Name")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{t("Bobot komponen", "Component weights")}</span>
                  <span className={cn("font-mono", wSum === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>Σ {wSum}%</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-3">
                  <div className="grid gap-1">
                    <Label className="text-xs">KPI</Label>
                    <Input type="number" value={form.kpi} onChange={(e) => setForm({ ...form, kpi: Number(e.target.value) })} />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("Kompetensi", "Competency")}</Label>
                    <Input type="number" value={form.competency} onChange={(e) => setForm({ ...form, competency: Number(e.target.value) })} />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">{t("Nilai inti", "Core values")}</Label>
                    <Input type="number" value={form.core} onChange={(e) => setForm({ ...form, core: Number(e.target.value) })} />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t("Item pustaka", "Library items")}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => addItem("Kpi")}><Plus className="h-3 w-3" /> KPI</Button>
                    <Button size="sm" variant="outline" onClick={() => addItem("Competency")}><Plus className="h-3 w-3" /> {t("Kompetensi", "Competency")}</Button>
                  </div>
                </div>
                <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
                  {form.items.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">{t("Belum ada item — tambahkan dari pustaka", "No items yet — add from library")}</p>
                  ) : (
                    form.items.map((it, idx) => {
                      const pool = it.kind === "Kpi" ? kpiQ.data?.rows ?? [] : compQ.data?.rows ?? [];
                      return (
                        <div key={idx} className="grid grid-cols-[5rem_1fr_5rem_2rem] items-center gap-2">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-center font-mono text-xs dark:bg-slate-800">{it.kind === "Kpi" ? "KPI" : t("Komp", "Comp")}</span>
                          <Select
                            value={it.refId}
                            onValueChange={(v) => {
                              const items = [...form.items];
                              items[idx] = { ...it, refId: v };
                              setForm({ ...form, items });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {pool.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number" className="h-8" value={it.weight}
                            onChange={(e) => {
                              const items = [...form.items];
                              items[idx] = { ...it, weight: Number(e.target.value) };
                              setForm({ ...form, items });
                            }}
                          />
                          <Button size="sm" variant="ghost" className="h-8 text-rose-600" onClick={() => setForm({ ...form, items: form.items.filter((_, i2) => i2 !== idx) })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
                {form.items.length > 0 && (
                  <div className="mt-2 flex gap-4 text-xs">
                    <span className={cn("font-mono", Math.abs(kpiSum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ KPI {kpiSum.toFixed(0)}%</span>
                    <span className={cn("font-mono", Math.abs(compSum - 100) < 0.01 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>Σ {t("Komp", "Comp")} {compSum.toFixed(0)}%</span>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                {t("Aktif", "Active")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy || wSum !== 100}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================================
// TAB MATRIKS MERIT
// ============================================================================

interface MeritGridCell { bonusMonths: number; raisePct: [number, number]; note?: string }

function MatrixTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh: reload } = useApi<{ rows: MatrixRowUI[] }>("/api/rekankerja/performance/masters?type=merit-matrix");
  const [form, setForm] = useState<null | {
    id?: string; code: string; name: string; active: boolean;
    grid: Record<string, MeritGridCell>;
  }>(null);
  const [busy, setBusy] = useState(false);

  const openNew = () => {
    const grid: Record<string, MeritGridCell> = {};
    for (let v = 1; v <= 5; v++) grid[String(v)] = { bonusMonths: 0, raisePct: [0, 0] };
    setForm({ code: "", name: "", active: true, grid });
  };
  const openEdit = (r: MatrixRowUI) => {
    const g = JSON.parse(r.gridJson || "{}") as Record<string, MeritGridCell>;
    const grid: Record<string, MeritGridCell> = {};
    for (let v = 1; v <= 10; v++) {
      const k = String(v);
      if (g[k]) grid[k] = { bonusMonths: Number(g[k].bonusMonths ?? 0), raisePct: [Number(g[k].raisePct?.[0] ?? 0), Number(g[k].raisePct?.[1] ?? 0)], note: g[k].note };
    }
    setForm({ id: r.id, code: r.code, name: r.name, active: r.active, grid });
  };

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/performance/masters", "POST", {
        type: "merit-matrix", id: form.id, code: form.code, name: form.name,
        grid: form.grid, active: form.active,
      });
      toast.success(t("Matriks merit disimpan", "Merit matrix saved"));
      setForm(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: MatrixRowUI) {
    if (!confirm(t(`Hapus matriks ${r.code}?`, `Delete matrix ${r.code}?`))) return;
    try {
      await apiSend(`/api/rekankerja/performance/masters?type=merit-matrix&id=${r.id}`, "DELETE");
      toast.success(t("Matriks dihapus", "Matrix deleted"));
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <Card className="border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("Rating → bonus (bulan) & kenaikan gaji (%) — dasar rekomendasi merit & estimasi dampak (AM3 §18.12).", "Rating → bonus (months) & salary raise (%) — basis for merit recommendations & impact preview (AM3 §18.12).")}
          </p>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4" /> {t("Matriks Baru", "New Matrix")}</Button>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Kode", "Code")}</TableHead>
                <TableHead>{t("Nama", "Name")}</TableHead>
                <TableHead>{t("Rentang rating", "Rating range")}</TableHead>
                <TableHead>{t("Contoh rating 5", "Example rating 5")}</TableHead>
                <TableHead>{t("Status", "Status")}</TableHead>
                <TableHead className="w-20 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}><LoadingRows /></TableCell>
                </TableRow>
              ) : (data?.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState icon={Wallet} title={t("Belum ada matriks", "No matrix yet")} description={error ?? undefined} />
                  </TableCell>
                </TableRow>
              ) : (
                (data?.rows ?? []).map((r) => {
                  const g = JSON.parse(r.gridJson || "{}") as Record<string, MeritGridCell>;
                  const keys = Object.keys(g).sort((a, b) => Number(b) - Number(a));
                  const top = g[keys[0]];
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-xs">{keys.length} {t("tingkat", "levels")}</TableCell>
                      <TableCell className="text-xs">
                        {top ? `${top.bonusMonths} bln · ${top.raisePct[0]}–${top.raisePct[1]}%` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.active ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">{t("Aktif", "Active")}</span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 dark:bg-slate-800">{t("Nonaktif", "Inactive")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(r)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? t("Ubah Matriks Merit", "Edit Merit Matrix") : t("Matriks Merit Baru", "New Merit Matrix")}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("Kode", "Code")}</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MERIT-STD" />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("Nama", "Name")}</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <span className="text-xs font-medium">{t("Grid per rating", "Grid per rating")}</span>
                <div className="mt-2 space-y-1.5">
                  {Object.entries(form.grid).sort((a, b) => Number(b[0]) - Number(a[0])).map(([rating, cell]) => (
                    <div key={rating} className="grid grid-cols-[2.5rem_6rem_1fr_1fr] items-center gap-2">
                      <span className={cn("flex h-7 items-center justify-center rounded-full text-xs font-semibold", scaleTone(["rose", "orange", "amber", "teal", "emerald"][Number(rating) - 1] ?? "slate"))}>{rating}</span>
                      <div className="grid gap-0.5">
                        <Label className="text-[10px] leading-none">{t("Bonus (bln)", "Bonus (mo)")}</Label>
                        <Input
                          type="number" className="h-8" step="0.5" value={cell.bonusMonths}
                          onChange={(e) => setForm({ ...form, grid: { ...form.grid, [rating]: { ...cell, bonusMonths: Number(e.target.value) } } })}
                        />
                      </div>
                      <div className="grid gap-0.5">
                        <Label className="text-[10px] leading-none">{t("Kenaikan % (min)", "Raise % (min)")}</Label>
                        <Input
                          type="number" className="h-8" value={cell.raisePct[0]}
                          onChange={(e) => setForm({ ...form, grid: { ...form.grid, [rating]: { ...cell, raisePct: [Number(e.target.value), cell.raisePct[1]] } } })}
                        />
                      </div>
                      <div className="grid gap-0.5">
                        <Label className="text-[10px] leading-none">{t("Kenaikan % (maks)", "Raise % (max)")}</Label>
                        <Input
                          type="number" className="h-8" value={cell.raisePct[1]}
                          onChange={(e) => setForm({ ...form, grid: { ...form.grid, [rating]: { ...cell, raisePct: [cell.raisePct[0], Number(e.target.value)] } } })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v === true })} />
                {t("Aktif", "Active")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy}>{t("Simpan", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
