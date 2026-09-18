"use client";
// OneVity — POSISI › Job Library: card grid of jobs + CRUD dialog
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, RefreshCw, Pencil, Trash2, Crown, BriefcaseBusiness, UserCog, User, FileText, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobRow, JobsRes } from "./types";
import { JOB_CATEGORIES, jobCategoryIcon } from "./types";

const CATEGORY_ICON: Record<string, React.ElementType> = {
  crown: Crown,
  briefcase: BriefcaseBusiness,
  "user-cog": UserCog,
  user: User,
};

// ============ Job form dialog (create / edit) ============
function JobFormDialog({ open, onOpenChange, job, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  job: JobRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ code: "", title: "", category: "Staff", description: "" });
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm({
      code: job?.code ?? "",
      title: job?.title ?? "",
      category: job?.category ?? "Staff",
      description: job?.description ?? "",
    });
  }, [open, job]);

  const submit = async () => {
    if (!form.code.trim() || !form.title.trim()) { toast.error(t("Kode dan judul job wajib diisi", "Code and job title are required")); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        title: form.title.trim(),
        category: form.category,
        description: form.description.trim() || null,
      };
      if (job) {
        await apiSend("/api/onevity/jobs", "PATCH", { id: job.id, ...payload });
        toast.success(t("Job berhasil diperbarui", "Job updated successfully"));
      } else {
        await apiSend("/api/onevity/jobs", "POST", payload);
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? t("Ubah Job", "Edit Job") : t("Job Baru", "New Job")}</DialogTitle>
          <DialogDescription>
            {job ? t("Perbarui definisi job {code}.", "Update job {code} definition.", { code: job.code }) : t("Definisikan job/keluarga jabatan baru yang dapat dipetakan ke posisi.", "Define a new job/job family that can be mapped to positions.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="j-code">{t("Kode Job", "Job Code")}</Label>
              <Input id="j-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="J-HRM" className="font-mono text-xs uppercase" />
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
          <div className="grid gap-1.5">
            <Label htmlFor="j-desc">{t("Deskripsi", "Description")}</Label>
            <Textarea id="j-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={t("Tanggung jawab utama job ini…", "Main responsibilities of this job…")} className="min-h-24" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : job ? t("Simpan") : t("Buat Job", "Create Job")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function JobView() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<JobsRes>("/api/onevity/jobs");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const jobs = data?.jobs ?? [];
  const totalPositions = jobs.reduce((acc, j) => acc + j._count.positions, 0);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (j: JobRow) => { setEditing(j); setFormOpen(true); };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/jobs?id=${encodeURIComponent(editing.id)}`, "DELETE");
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

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Katalog Jabatan")}
        description={t("Pustaka definisi job/keluarga jabatan yang menjadi dasar pembuatan posisi. {j} job · {p} posisi terpetakan.", "Library of job/job family definitions that form the basis for creating positions. {j} jobs · {p} positions mapped.", { j: jobs.length, p: totalPositions })}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
            </Button>
            <Button size="sm" className="h-10 px-4 font-bold" onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("Job Baru", "New Job")}
            </Button>
          </>
        }
      />

      {loading ? (
        <LoadingCards cards={6} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} />
      ) : jobs.length === 0 ? (
        <EmptyState title={t("Belum ada job", "No jobs yet")} description={t("Buat job pertama dengan tombol Job Baru.", "Create the first job with the New Job button.")} icon={<FileText className="h-6 w-6" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {jobs.map((j) => {
            const cat = jobCategoryIcon(j.category);
            const CatIcon = CATEGORY_ICON[cat.icon] ?? User;
            return (
              <Card
                key={j.id}
                className={cn(
                  "group cursor-pointer rounded-2xl border-stone-200/80 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800",
                  !j.active && "opacity-70"
                )}
                onClick={() => openEdit(j)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", cat.cls)}>
                      <CatIcon className="h-5 w-5" />
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
                        j.active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-500/25 dark:bg-stone-500/10 dark:text-stone-400"
                      )}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", j.active ? "bg-emerald-500" : "bg-stone-400")} />
                        {j.active ? t("Aktif") : t("Nonaktif")}
                      </span>
                      {j._count.positions > 0 && (
                        <Badge className="h-6 rounded-full bg-stone-100 px-2 text-[10px] font-bold text-stone-600 hover:bg-stone-100 dark:bg-stone-800 dark:text-stone-300">
                          <Boxes className="mr-1 h-3 w-3" /> {j._count.positions}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-3.5">
                    <p className="flex items-center gap-2 text-[15px] font-bold leading-tight text-stone-900 dark:text-stone-50">
                      {j.title}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[10px]">{j.code}</Badge>
                      <Badge variant="outline" className="text-[10px] text-stone-500">{cat.label}</Badge>
                    </div>
                  </div>
                  {j.description && (
                    <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{j.description}</p>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 dark:border-stone-800/70">
                    <p className="text-[10px] font-medium text-stone-400">
                      {t("{n} posisi menggunakan job ini", "{n} positions use this job", { n: j._count.positions })}
                    </p>
                    <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(j); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-stone-100 hover:ov-text-accent dark:hover:bg-stone-800"
                        aria-label={t("Ubah job {title}", "Edit job {title}", { title: j.title })}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(j); setDeleteOpen(true); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                        aria-label={t("Hapus job {title}", "Delete job {title}", { title: j.title })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <JobFormDialog open={formOpen} onOpenChange={setFormOpen} job={editing} onDone={refresh} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus job “{title}”?", "Delete job “{title}”?", { title: editing?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Job yang masih dipakai oleh posisi tidak dapat dihapus.", "This action is permanent. Jobs still used by positions cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? t("Menghapus…", "Deleting…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
