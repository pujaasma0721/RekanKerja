"use client";
// OneVity — POSISI › Grade & Level: grade cards G1–G8 with salary range + CRUD
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, fmtIDRShort } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingCards } from "@/onevity/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, RefreshCw, Pencil, Trash2, GraduationCap, Users, BriefcaseBusiness, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GradeRow, GradesRes } from "./types";

// ============ Grade form dialog ============
function GradeFormDialog({ open, onOpenChange, grade, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grade: GradeRow | null;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ code: "", name: "", minSalary: "0", maxSalary: "0" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: grade?.code ?? "",
      name: grade?.name ?? "",
      minSalary: String(grade?.minSalary ?? 0),
      maxSalary: String(grade?.maxSalary ?? 0),
    });
  }, [open, grade]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama grade wajib diisi"); return; }
    const min = Number(form.minSalary) || 0;
    const max = Number(form.maxSalary) || 0;
    if (min < 0 || max < 0) { toast.error("Gaji tidak boleh negatif"); return; }
    if (max < min) { toast.error("Gaji maksimum tidak boleh lebih kecil dari minimum"); return; }
    setSaving(true);
    try {
      const payload = { code: form.code.trim(), name: form.name.trim(), minSalary: min, maxSalary: max };
      if (grade) {
        await apiSend("/api/onevity/grades", "PATCH", { id: grade.id, ...payload });
        toast.success("Grade berhasil diperbarui");
      } else {
        await apiSend("/api/onevity/grades", "POST", payload);
        toast.success(`Grade ${payload.code} berhasil dibuat`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan grade");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{grade ? "Ubah Grade" : "Grade Baru"}</DialogTitle>
          <DialogDescription>
            {grade ? `Perbarui grade ${grade.code} beserta rentang gajinya.` : "Tambahkan level grade baru ke struktur kompensasi."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="g-code">Kode Grade</Label>
              <Input id="g-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="G9" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-name">Nama</Label>
              <Input id="g-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="General Manager" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="g-min">Gaji Minimum (Rp)</Label>
              <Input id="g-min" type="number" min={0} step={500000} value={form.minSalary} onChange={(e) => setForm((f) => ({ ...f, minSalary: e.target.value }))} />
              <p className="text-[10px] text-stone-400">{fmtIDR(Number(form.minSalary) || 0)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="g-max">Gaji Maksimum (Rp)</Label>
              <Input id="g-max" type="number" min={0} step={500000} value={form.maxSalary} onChange={(e) => setForm((f) => ({ ...f, maxSalary: e.target.value }))} />
              <p className="text-[10px] text-stone-400">{fmtIDR(Number(form.maxSalary) || 0)}</p>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : grade ? "Simpan" : "Buat Grade"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function GradeView() {
  const { data, loading, error, refresh } = useApi<GradesRes>("/api/onevity/grades");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GradeRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const grades = data?.grades ?? [];
  const globalMax = useMemo(() => Math.max(1, ...grades.map((g) => g.maxSalary)), [grades]);
  const totalEmployees = grades.reduce((acc, g) => acc + g._count.employees, 0);

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/grades?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(`Grade ${editing.code} dihapus`);
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus grade");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Grade & Level"
        description={`Struktur grade kompensasi beserta rentang gaji. ${grades.length} grade · ${totalEmployees} karyawan terpetakan.`}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Muat Ulang</span>
            </Button>
            <Button size="sm" className="h-10 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> Grade Baru
            </Button>
          </>
        }
      />

      {loading ? (
        <LoadingCards cards={6} />
      ) : error ? (
        <EmptyState title="Gagal memuat" description={error} />
      ) : grades.length === 0 ? (
        <EmptyState title="Belum ada grade" description="Buat grade pertama dengan tombol Grade Baru." icon={<GraduationCap className="h-6 w-6" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {grades.map((g) => {
            const left = Math.round((g.minSalary / globalMax) * 100);
            const width = Math.max(4, Math.round(((g.maxSalary - g.minSalary) / globalMax) * 100));
            return (
              <Card
                key={g.id}
                className="group cursor-pointer rounded-2xl border-stone-200/80 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800"
                onClick={() => { setEditing(g); setFormOpen(true); }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-[13px] font-extrabold text-white shadow-md">
                        {g.code}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold leading-tight text-stone-900 dark:text-stone-50">{g.name}</p>
                        <p className="mt-0.5 text-[11px] text-stone-500">
                          {fmtIDRShort(g.minSalary)} – {fmtIDRShort(g.maxSalary)}
                        </p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(g); setFormOpen(true); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-stone-100 hover:text-emerald-700 dark:hover:bg-stone-800 dark:hover:text-emerald-400"
                        aria-label={`Ubah grade ${g.code}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditing(g); setDeleteOpen(true); }}
                        className="rounded-lg p-2.5 text-stone-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                        aria-label={`Hapus grade ${g.code}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </div>

                  {/* salary range bar */}
                  <div className="mt-5">
                    <div className="relative h-2.5 w-full rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className="absolute h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                      />
                      <span className="absolute -top-1 h-4.5 w-4.5 rounded-full border-2 border-emerald-500 bg-white dark:bg-stone-900" style={{ left: `calc(${Math.min(left + width, 100)}% - 9px)` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] font-semibold text-stone-400">
                      <span>min {fmtIDR(g.minSalary)}</span>
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <TrendingUp className="h-3 w-3" /> span {fmtIDRShort(g.maxSalary - g.minSalary)}
                      </span>
                      <span>max {fmtIDR(g.maxSalary)}</span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 dark:border-stone-800/70">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                      <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> {g._count.employees} karyawan
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                      <BriefcaseBusiness className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" /> {g._count.positions} posisi
                    </span>
                    <Badge variant="outline" className="text-[9px] text-stone-400">urutan {g.sortOrder}</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <GradeFormDialog open={formOpen} onOpenChange={setFormOpen} grade={editing} onDone={refresh} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus grade {editing?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Grade yang masih dipakai karyawan atau posisi tidak dapat dihapus.
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
