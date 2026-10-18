"use client";
// RekanKerja — POSISI › Katalog Jabatan (P3.1-BM / D-BM23 — job architecture):
// tab "Katalog Job" (tabel job + filter family + detail sheet profil job) dan
// tab "Family Jabatan" (tree 2-level + CRUD + laporan struktur jabatan XLSX).
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Plus, RefreshCw, Pencil, Trash2, Boxes, Eye, Download, Network,
  FileText, ListChecks, ClipboardList, GraduationCap, BriefcaseBusiness,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobRow } from "./types";
import { JOB_CATEGORIES } from "./types";

// ============ Tipe (P3.1 — diperluas lokal, types.ts tidak diubah) ============

/** Baris job + field profil (D-BM23) dari GET /api/rekankerja/jobs. */
type JobProfileRow = JobRow & {
  family: { id: string; code: string; name: string } | null;
  mission: string | null;
  dutiesJson: string | null;
  qualificationsJson: string | null;
  minEducation: string | null;
  workingConditions: string | null;
};

/** Node family tree 2-level dari GET /api/rekankerja/job-families. */
interface FamilyNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  jobCount: number;
  children: FamilyNode[];
}

interface FamiliesRes {
  families: FamilyNode[];
}

const EDUCATION_OPTIONS = ["SMA/SMK", "D3", "S1", "S2", "S3"] as const;
const LIST_MAX_ITEMS = 20;

/** Saran kode family: nama → JF-<SLUG> (mis. "Teknikal" → JF-TEKNIKAL). */
function suggestFamilyCode(name: string): string {
  const slug = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `JF-${slug}`.slice(0, 40) : "";
}

/** Parse aman dutiesJson/qualificationsJson (array string). */
function parseJsonList(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((it): it is string => typeof it === "string") : [];
  } catch {
    return [];
  }
}

/** Opsi family datar utk select (root dulu, anak ber-prefix "— "). */
function flattenFamilyOptions(families: FamilyNode[]): { id: string; label: string; isChild: boolean }[] {
  const out: { id: string; label: string; isChild: boolean }[] = [];
  for (const f of families) {
    out.push({ id: f.id, label: f.name, isChild: false });
    for (const c of f.children) out.push({ id: c.id, label: `— ${c.name}`, isChild: true });
  }
  return out;
}

// ============ Editor daftar teks (duties / qualifications) ============
function StringListEditor({ items, onChange, addLabel, itemPlaceholder, removeLabel }: {
  items: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  itemPlaceholder: string;
  removeLabel: string;
}) {
  const { t } = useI18n();
  const setAt = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const removeAt = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  return (
    <div className="space-y-2">
      <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-2.5 text-xs text-slate-400 dark:border-slate-700">
            {t("Belum ada item — tambahkan baris pertama.", "No items yet — add the first line.")}
          </p>
        ) : items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
            <Input
              value={it}
              maxLength={500}
              onChange={(e) => setAt(i, e.target.value)}
              placeholder={itemPlaceholder}
              aria-label={`${t("Item")} ${i + 1}`}
              className="h-9"
            />
            <Button
              type="button" variant="ghost"
              className="h-11 w-11 shrink-0 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
              onClick={() => removeAt(i)}
              aria-label={`${removeLabel} ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button" variant="outline" size="sm"
        className="h-11 gap-1.5 px-3"
        onClick={() => onChange([...items, ""])}
        disabled={items.length >= LIST_MAX_ITEMS}
      >
        <Plus className="h-4 w-4" /> {addLabel}
        <span className="text-[10px] text-slate-400">({items.length}/{LIST_MAX_ITEMS})</span>
      </Button>
    </div>
  );
}

// ============ Job form dialog (create / edit — + job profile D-BM23) ============
function JobFormDialog({ open, onOpenChange, job, families, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: JobProfileRow | null;
  families: FamilyNode[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    code: "", title: "", category: "Staff", familyId: "", description: "",
    mission: "", duties: [] as string[], qualifications: [] as string[],
    minEducation: "", workingConditions: "",
  });
  const [saving, setSaving] = useState(false);
  const familyOptions = useMemo(() => flattenFamilyOptions(families), [families]);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: job?.code ?? "",
      title: job?.title ?? "",
      category: job?.category ?? "Staff",
      familyId: job?.family?.id ?? "",
      description: job?.description ?? "",
      mission: job?.mission ?? "",
      duties: parseJsonList(job?.dutiesJson ?? null),
      qualifications: parseJsonList(job?.qualificationsJson ?? null),
      minEducation: job?.minEducation ?? "",
      workingConditions: job?.workingConditions ?? "",
    });
  }, [open, job]);

  const submit = async () => {
    if (!form.code.trim() || !form.title.trim()) { toast.error(t("Kode dan judul job wajib diisi", "Code and job title are required")); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        category: form.category,
        familyId: form.familyId || null,
        description: form.description.trim() || null,
        mission: form.mission.trim() || null,
        duties: form.duties.map((d) => d.trim()).filter(Boolean),
        qualifications: form.qualifications.map((q) => q.trim()).filter(Boolean),
        minEducation: form.minEducation || null,
        workingConditions: form.workingConditions.trim() || null,
      };
      if (job) {
        await apiSend("/api/rekankerja/jobs", "PATCH", { id: job.id, ...payload });
        toast.success(t("Job berhasil diperbarui", "Job updated successfully"));
      } else {
        await apiSend("/api/rekankerja/jobs", "POST", payload);
        toast.success(t('Job "{title}" berhasil dibuat', 'Job "{title}" created successfully', { title: payload.title }));
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan job", "Failed to save job"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job ? t("Ubah Job", "Edit Job") : t("Job Baru", "New Job")}</DialogTitle>
          <DialogDescription>
            {job
              ? t("Perbarui definisi job {code} beserta profil jabatannya.", "Update job {code} definition and its job profile.", { code: job.code })
              : t("Definisikan job baru + profil jabatan (family, mission, tugas, kualifikasi).", "Define a new job + job profile (family, mission, duties, qualifications).")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="j-code">{t("Kode Job", "Job Code")}</Label>
              <Input id="j-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="J-HRM" className="font-mono text-xs uppercase" disabled={!!job} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("Kategori", "Category")}</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-title">{t("Judul Job", "Job Title")}</Label>
            <Input id="j-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="HR Manager" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("Family Jabatan", "Job Family")}</Label>
              <Select value={form.familyId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, familyId: v === "none" ? "" : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("Tanpa family", "No family")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— Tanpa family —", "— No family —")}</SelectItem>
                  {familyOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("Syarat Pendidikan Minimal", "Minimum Education")}</Label>
              <Select value={form.minEducation || "none"} onValueChange={(v) => setForm((f) => ({ ...f, minEducation: v === "none" ? "" : v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder={t("Tidak ditetapkan", "Not set")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("— Tidak ditetapkan —", "— Not set —")}</SelectItem>
                  {EDUCATION_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-desc">{t("Deskripsi", "Description")}</Label>
            <Textarea id="j-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t("Ringkasan singkat job ini…", "A short summary of this job…")} className="min-h-16" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-mission">{t("Mission (tujuan jabatan)", "Mission (job purpose)")}</Label>
            <Textarea id="j-mission" value={form.mission} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, mission: e.target.value }))} placeholder={t("Mengapa jabatan ini ada & dampak yang diharapkan…", "Why this job exists & the expected impact…")} className="min-h-16" />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> {t("Tugas & Tanggung Jawab", "Duties & Responsibilities")}</Label>
            <StringListEditor
              items={form.duties}
              onChange={(next) => setForm((f) => ({ ...f, duties: next }))}
              addLabel={t("Tambah Tugas", "Add Duty")}
              itemPlaceholder={t("tugas utama jabatan…", "a main duty of the job…")}
              removeLabel={t("Hapus tugas", "Remove duty")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> {t("Kualifikasi", "Qualifications")}</Label>
            <StringListEditor
              items={form.qualifications}
              onChange={(next) => setForm((f) => ({ ...f, qualifications: next }))}
              addLabel={t("Tambah Kualifikasi", "Add Qualification")}
              itemPlaceholder={t("kualifikasi/pengalaman yang dibutuhkan…", "a required skill or experience…")}
              removeLabel={t("Hapus kualifikasi", "Remove qualification")}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-wc">{t("Kondisi Kerja", "Working Conditions")}</Label>
            <Textarea id="j-wc" value={form.workingConditions} maxLength={2000} onChange={(e) => setForm((f) => ({ ...f, workingConditions: e.target.value }))} placeholder={t("Lokasi/shift/paparan risiko/peralatan…", "Location/shift/risk exposure/equipment…")} className="min-h-16" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button className="h-11" onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : job ? t("Simpan") : t("Buat Job", "Create Job")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Family form dialog (create / edit) ============
function FamilyFormDialog({ open, onOpenChange, family, families, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  family: FamilyNode | null;
  families: FamilyNode[];
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ code: "", name: "", parentId: "", sortOrder: "0" });
  const [codeTouched, setCodeTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({ code: family?.code ?? "", name: family?.name ?? "", parentId: family?.parentId ?? "", sortOrder: String(family?.sortOrder ?? 0) });
    setCodeTouched(!!family);
  }, [open, family]);

  // edit family yang punya sub-family → tidak boleh dipindah (guard depth-2).
  const hasChildren = (family?.children.length ?? 0) > 0;

  const onNameChange = (v: string) => {
    setForm((f) => ({
      ...f,
      name: v,
      // auto-suggest kode selama pengguna belum menyentuh field kode (mode buat).
      code: !family && !codeTouched ? suggestFamilyCode(v) : f.code,
    }));
  };

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode dan nama family wajib diisi", "Family code and name are required")); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        parentId: form.parentId || null,
        sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      };
      if (family) {
        await apiSend("/api/rekankerja/job-families", "PATCH", { id: family.id, ...payload });
        toast.success(t('Family "{name}" diperbarui', 'Family "{name}" updated', { name: payload.name }));
      } else {
        await apiSend("/api/rekankerja/job-families", "POST", payload);
        toast.success(t('Family "{name}" dibuat', 'Family "{name}" created', { name: payload.name }));
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan family", "Failed to save family"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{family ? t("Ubah Family Jabatan", "Edit Job Family") : t("Family Jabatan Baru", "New Job Family")}</DialogTitle>
          <DialogDescription>
            {family
              ? t("Perbarui family {code}. Struktur maksimal 2 tingkat.", "Update family {code}. The structure supports a maximum of 2 levels.", { code: family.code })
              : t("Family root atau sub-family (maksimal 2 tingkat).", "A root family or sub-family (maximum 2 levels).")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="f-name">{t("Nama Family", "Family Name")}</Label>
            <Input id="f-name" value={form.name} onChange={(e) => onNameChange(e.target.value)} placeholder={t("Teknikal", "Technical")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="f-code">{t("Kode Family", "Family Code")}</Label>
              <Input
                id="f-code" value={form.code} maxLength={40}
                onChange={(e) => { setCodeTouched(true); setForm((f) => ({ ...f, code: e.target.value })); }}
                placeholder="JF-TEKNIKAL" className="font-mono text-xs uppercase"
              />
              <p className="text-[10px] text-slate-400">{t("Saran otomatis JF-<SLUG> dari nama.", "Auto-suggested as JF-<SLUG> from the name.")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-sort">{t("Urutan Tampil", "Display Order")}</Label>
              <Input id="f-sort" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} className="tabular-nums" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Parent Family", "Parent Family")}</Label>
            <Select
              value={form.parentId || "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, parentId: v === "none" ? "" : v }))}
              disabled={hasChildren}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Root (tanpa parent) —", "— Root (no parent) —")}</SelectItem>
                {families
                  .filter((f) => f.id !== family?.id)
                  .map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">
              {hasChildren
                ? t("Family ini memiliki sub-family — tidak dapat dipindahkan.", "This family has sub-families — it cannot be moved.")
                : t("Hanya family root yang bisa menjadi parent (maks. 2 tingkat).", "Only root families can be a parent (max. 2 levels).")}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button className="h-11" onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Tab: Katalog Job (tabel + filter family + detail sheet) ============
function JobCatalogTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<{ jobs: JobProfileRow[] }>("/api/rekankerja/jobs");
  const fams = useApi<FamiliesRes>("/api/rekankerja/job-families");
  const [q, setQ] = useState("");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobProfileRow | null>(null);
  const [detail, setDetail] = useState<JobProfileRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const jobs = data?.jobs ?? [];
  const families = fams.data?.families ?? [];
  const familyOptions = useMemo(() => flattenFamilyOptions(families), [families]);
  const totalPositions = jobs.reduce((acc, j) => acc + j._count.positions, 0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (needle && !`${j.code} ${j.title}`.toLowerCase().includes(needle)) return false;
      if (familyFilter !== "all" && j.family?.id !== familyFilter) return false;
      return true;
    });
  }, [jobs, q, familyFilter]);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (j: JobProfileRow) => { setEditing(j); setFormOpen(true); };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/jobs?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(t('Job "{title}" dihapus', 'Job "{title}" deleted', { title: editing.title }));
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus job", "Failed to delete job"));
    } finally {
      setDeleting(false);
    }
  };

  const duties = parseJsonList(detail?.dutiesJson ?? null);
  const quals = parseJsonList(detail?.qualificationsJson ?? null);

  return (
    <div className="space-y-4">
      {/* toolbar filter */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Cari kode / judul job…", "Search job code / title…")}
            className="h-11 sm:max-w-64"
            aria-label={t("Cari kode / judul job", "Search job code / title")}
          />
          <Select value={familyFilter} onValueChange={setFamilyFilter}>
            <SelectTrigger className="h-11 w-full sm:w-56"><SelectValue placeholder={t("Semua family", "All families")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua family", "All families")}</SelectItem>
              {familyOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <span className="hidden text-[11px] font-medium text-slate-400 lg:inline">
              {t("{n} job · {p} posisi terpetakan", "{n} jobs · {p} positions mapped", { n: filtered.length, p: totalPositions })}
            </span>
            <Button variant="outline" size="sm" className="h-11 gap-1.5 px-3" onClick={() => { refresh(); fams.refresh(); }}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
            </Button>
            <Button size="sm" className="h-11 gap-1.5 px-4 font-bold" onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("Job Baru", "New Job")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* tabel job */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : error ? (
            <div className="p-4"><EmptyState title={t("Gagal memuat", "Failed to load")} description={error} /></div>
          ) : filtered.length === 0 ? (
            <div className="p-4"><EmptyState title={t("Belum ada job", "No jobs yet")} description={t("Buat job pertama dengan tombol Job Baru.", "Create the first job with the New Job button.")} icon={<FileText className="h-6 w-6" />} /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="min-w-36 text-[11px] font-bold">{t("Kode Job", "Job Code")}</TableHead>
                    <TableHead className="min-w-40 text-[11px] font-bold">{t("Judul Job", "Job Title")}</TableHead>
                    <TableHead className="min-w-32 text-[11px] font-bold">{t("Family", "Family")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Kategori", "Category")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Posisi")}</TableHead>
                    <TableHead className="w-36 text-[11px] font-bold">{t("Aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => setDetail(j)}>
                      <TableCell><Badge variant="outline" className="font-mono text-[10px]">{j.code}</Badge></TableCell>
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{j.title}</p>
                      </TableCell>
                      <TableCell>
                        {j.family ? (
                          <Badge variant="secondary" className="text-[10px] font-semibold">{j.family.name}</Badge>
                        ) : (
                          <span className="text-[10px] text-slate-400">{t("Tanpa family", "No family")}</span>
                        )}
                      </TableCell>
                      <TableCell><span className="text-[10px] font-semibold text-slate-500">{j.category ?? "—"}</span></TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
                          j.active
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400"
                        )}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", j.active ? "bg-emerald-500" : "bg-slate-400")} />
                          {j.active ? t("Aktif") : t("Nonaktif")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                          <Boxes className="h-3.5 w-3.5 text-slate-400" /> {j._count.positions}
                        </span>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setDetail(j)} aria-label={t("Detail job {title}", "Job detail {title}", { title: j.title })} title={t("Detail job", "Job detail")}>
                            <Eye className="h-4 w-4 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => openEdit(j)} aria-label={t("Ubah job {title}", "Edit job {title}", { title: j.title })} title={t("Ubah job", "Edit job")}>
                            <Pencil className="h-4 w-4 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-11 w-11 hover:text-rose-600" onClick={() => { setEditing(j); setDeleteOpen(true); }} aria-label={t("Hapus job {title}", "Delete job {title}", { title: j.title })} title={t("Hapus job", "Delete job")}>
                            <Trash2 className="h-4 w-4 text-slate-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* detail sheet — profil job lengkap */}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader className="border-b border-slate-100 dark:border-slate-800">
                <SheetTitle className="text-left">{detail.title}</SheetTitle>
                <p className="font-mono text-xs text-slate-400">{detail.code}{detail.family ? ` · ${detail.family.code}` : ""}</p>
                <Button variant="outline" size="sm" className="mt-3 h-11 w-fit gap-2 font-bold" onClick={() => { setEditing(detail); setDetail(null); setFormOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" /> {t("Ubah Job Ini", "Edit This Job")}
                </Button>
              </SheetHeader>
              <div className="space-y-5 p-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-900">
                    <p className="flex items-center justify-center gap-1.5 text-lg font-extrabold text-brand"><Boxes className="h-4 w-4" /> {detail._count.positions}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400">{t("Posisi Memakai Job", "Positions Using Job")}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-900">
                    <p className="flex items-center justify-center gap-1.5 text-lg font-extrabold text-slate-700 dark:text-slate-300"><Network className="h-4 w-4" /> {detail.family?.name ?? "—"}</p>
                    <p className="text-[9px] font-bold uppercase text-slate-400">{t("Family Jabatan", "Job Family")}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Kategori")}</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{detail.category ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Syarat Pendidikan Minimal", "Minimum Education")}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-800 dark:text-slate-200"><GraduationCap className="h-3.5 w-3.5 text-slate-400" /> {detail.minEducation ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Status")}</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-slate-800 dark:text-slate-200">{detail.active ? t("Aktif") : t("Nonaktif")}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Kode Family", "Family Code")}</p>
                    <p className="mt-0.5 font-mono text-[13px] font-semibold text-slate-800 dark:text-slate-200">{detail.family?.code ?? "—"}</p>
                  </div>
                </div>
                {detail.description && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Deskripsi", "Description")}</p>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{detail.description}</p>
                  </div>
                )}
                {detail.mission && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><BriefcaseBusiness className="h-3.5 w-3.5" /> {t("Mission (tujuan jabatan)", "Mission (job purpose)")}</p>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{detail.mission}</p>
                  </div>
                )}
                {duties.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><ListChecks className="h-3.5 w-3.5" /> {t("Tugas & Tanggung Jawab", "Duties & Responsibilities")}</p>
                    <ol className="space-y-1.5">
                      {duties.map((d, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-extrabold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                          <span className="min-w-0 break-words">{d}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {quals.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><ClipboardList className="h-3.5 w-3.5" /> {t("Kualifikasi", "Qualifications")}</p>
                    <ol className="space-y-1.5">
                      {quals.map((d, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-extrabold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{i + 1}</span>
                          <span className="min-w-0 break-words">{d}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {detail.workingConditions && (
                  <div>
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t("Kondisi Kerja", "Working Conditions")}</p>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{detail.workingConditions}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <JobFormDialog open={formOpen} onOpenChange={setFormOpen} job={editing} families={families} onDone={() => { refresh(); fams.refresh(); }} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus job “{title}”?", "Delete job “{title}”?", { title: editing?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Job yang masih dipakai oleh posisi tidak dapat dihapus.", "This action is permanent. Jobs still used by positions cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="h-11 bg-rose-600 hover:bg-rose-700">
              {deleting ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Tab: Family Jabatan (tree 2-level + CRUD + export) ============
function JobFamilyTab() {
  const { t, lang } = useI18n();
  const { data, loading, error, refresh } = useApi<FamiliesRes>("/api/rekankerja/job-families");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FamilyNode | null>(null);
  const [deleting, setDeleting] = useState<FamilyNode | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);
  const [exporting, setExporting] = useState(false);

  const families = data?.families ?? [];
  const totalFamilies = families.length + families.reduce((a, f) => a + f.children.length, 0);
  const totalJobs = families.reduce((a, f) => a + f.jobCount + f.children.reduce((c, x) => c + x.jobCount, 0), 0);

  const handleDelete = async () => {
    if (!deleting) return;
    setBusyDelete(true);
    try {
      await apiSend(`/api/rekankerja/job-families?id=${encodeURIComponent(deleting.id)}`, "DELETE");
      toast.success(t('Family "{name}" dihapus', 'Family "{name}" deleted', { name: deleting.name }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus family", "Failed to delete family"));
    } finally {
      setBusyDelete(false);
    }
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/rekankerja/job-families?export=xlsx&lang=${lang}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ? String(j.error) : t("Gagal mengekspor", "Export failed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rekankerja-struktur-jabatan-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("Laporan struktur jabatan terunduh (XLSX)", "Job structure report downloaded (XLSX)"));
    } catch {
      toast.error(t("Gagal mengekspor", "Export failed"));
    } finally {
      setExporting(false);
    }
  };

  const renderRow = (f: FamilyNode, isChild: boolean) => (
    <div
      key={f.id}
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 transition hover:border-slate-200 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-slate-700",
        isChild && "ml-4 border-l-4 border-l-brand/30 sm:ml-8",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {isChild ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-deep dark:bg-brand/15 dark:text-brand/85"><Network className="h-4 w-4" /></span>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Network className="h-4 w-4" /></span>
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{f.code}</Badge>
            <span className={cn("truncate text-[13px] font-bold text-slate-800 dark:text-slate-200", isChild && "font-semibold")}>{f.name}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {isChild
              ? t("Sub-family · {n} job", "Sub-family · {n} jobs", { n: f.jobCount })
              : t("Root · {n} sub-family · {n2} job", "Root · {n} sub-families · {n2} jobs", { n: f.children.length, n2: f.jobCount })}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => { setEditing(f); setFormOpen(true); }} aria-label={t("Ubah family {name}", "Edit family {name}", { name: f.name })} title={t("Ubah family", "Edit family")}>
          <Pencil className="h-4 w-4 text-slate-400" />
        </Button>
        <Button variant="ghost" size="icon" className="h-11 w-11 hover:text-rose-600" onClick={() => setDeleting(f)} aria-label={t("Hapus family {name}", "Delete family {name}", { name: f.name })} title={t("Hapus family", "Delete family")}>
          <Trash2 className="h-4 w-4 text-slate-400" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-[11px] font-medium text-slate-400">
            {t("{n} family · {m} job teraut", "{n} families · {m} linked jobs", { n: totalFamilies, m: totalJobs })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-11 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
            </Button>
            <Button variant="outline" size="sm" className="h-11 gap-1.5 px-3" onClick={exportXlsx} disabled={exporting}>
              <Download className="h-4 w-4" /> {exporting ? t("Mengekspor…", "Exporting…") : t("Laporan Struktur Jabatan (XLSX)", "Job Structure Report (XLSX)")}
            </Button>
            <Button size="sm" className="h-11 gap-1.5 px-4 font-bold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> {t("Family Baru", "New Family")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* daftar tree 2-level */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-4">
          {loading && !data ? (
            <LoadingRows rows={6} />
          ) : error ? (
            <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} />
          ) : families.length === 0 ? (
            <EmptyState
              title={t("Belum ada family jabatan", "No job families yet")}
              description={t("Buat family pertama untuk mengelompokkan job (maksimal 2 tingkat).", "Create the first family to group jobs (maximum 2 levels).")}
              icon={<Network className="h-6 w-6" />}
            />
          ) : (
            <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
              {families.map((f) => (
                <div key={f.id} className="space-y-2">
                  {renderRow(f, false)}
                  {f.children.map((c) => renderRow(c, true))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <FamilyFormDialog open={formOpen} onOpenChange={setFormOpen} family={editing} families={families} onDone={refresh} />

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus family “{name}”?", "Delete family “{name}”?", { name: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Family yang masih dipakai job atau memiliki sub-family tidak dapat dihapus.", "This action is permanent. Families still used by jobs or that have sub-families cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busyDelete} className="h-11 bg-rose-600 hover:bg-rose-700">
              {busyDelete ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Main view — tab Katalog Job / Family Jabatan ============
export function JobView() {
  const { t } = useI18n();
  const [tab, setTab] = useState("catalog");

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Katalog Jabatan")}
        description={t(
          "Pustaka job & family jabatan beserta profil jabatan (D-BM23): mission, tugas, kualifikasi, syarat pendidikan, kondisi kerja.",
          "Library of jobs & job families with job profiles (D-BM23): mission, duties, qualifications, education requirements, working conditions.",
        )}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto rounded-2xl ov-tile p-1.5">
          <TabsTrigger value="catalog" className="gap-1.5 rounded-xl px-4 py-3 text-xs font-bold data-[state=active]:ov-fill">
            <FileText className="h-4 w-4" aria-hidden /> {t("Katalog Job", "Job Catalog")}
          </TabsTrigger>
          <TabsTrigger value="families" className="gap-1.5 rounded-xl px-4 py-3 text-xs font-bold data-[state=active]:ov-fill">
            <Network className="h-4 w-4" aria-hidden /> {t("Family Jabatan", "Job Family")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="catalog">
          <JobCatalogTab />
        </TabsContent>
        <TabsContent value="families">
          <JobFamilyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
