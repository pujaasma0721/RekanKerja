"use client";
// OneVity — POSISI › Job Library: card grid of jobs + CRUD dialog
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingCards } from "@/components/onevity/ui-kit";
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
    if (!form.code.trim() || !form.title.trim()) { toast.error("Kode dan judul job wajib diisi"); return; }
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
        toast.success("Job berhasil diperbarui");
      } else {
        await apiSend("/api/onevity/jobs", "POST", payload);
        toast.success(`Job "${payload.title}" berhasil dibuat`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? "Ubah Job" : "Job Baru"}</DialogTitle>
          <DialogDescription>
            {job ? `Perbarui definisi job ${job.code}.` : "Definisikan job/keluarga jabatan baru yang dapat dipetakan ke posisi."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="j-code">Kode Job</Label>
              <Input id="j-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="J-HRM" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label>Kategori</Label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {JOB_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-title">Judul Job</Label>
            <Input id="j-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="HR Manager" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="j-desc">Deskripsi</Label>
            <Textarea id="j-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Tanggung jawab utama job ini…" className="min-h-24" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : job ? "Simpan" : "Buat Job"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function JobView() {
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
      toast.success(`Job "${editing.title}" dihapus`);
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus job");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Katalog Jabatan"
        description={`Pustaka definisi job/keluarga jabatan yang menjadi dasar pembuatan posisi. ${jobs.length} job · ${totalPositions} posisi terpetakan.`}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Muat Ulang</span>
            </Button>
            <Button size="sm" className="h-10 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Job Baru
            </Button>
          </>
        }
      />

      {loading ? (
        <LoadingCards cards={6} />
      ) : error ? (
        <EmptyState title="Gagal memuat" description={error} />
      ) : jobs.length === 0 ? (
        <EmptyState title="Belum ada job" description="Buat job pertama dengan tombol Job Baru." icon={<FileText className="h-6 w-6" />} />
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
                        {j.active ? "Aktif" : "Nonaktif"}
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
                      {j._count.positions} posisi menggunakan job ini
                    </p>
                    <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(j); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-stone-100 hover:text-emerald-700 dark:hover:bg-stone-800 dark:hover:text-emerald-400"
                        aria-label={`Ubah job ${j.title}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(j); setDeleteOpen(true); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                        aria-label={`Hapus job ${j.title}`}
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
            <AlertDialogTitle>Hapus job “{editing?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Job yang masih dipakai oleh posisi tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-rose-600 hover:bg-rose-700">
              {deleting ? "Menghapus…" : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
