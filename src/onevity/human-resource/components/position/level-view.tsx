"use client";
// OneVity — POSISI & JABATAN › Level Jabatan: master position level (PL1..PLn) + CRUD
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/onevity/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, Layers, Users, BriefcaseBusiness, Plus, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============ types (kontrak API Task 25) ============
interface LevelRow {
  id: string; code: string; name: string;
  sortOrder: number; active: boolean;
  positionCount: number; employeeCount: number;
}
interface LevelsRes { levels: LevelRow[] }

function ActivePill({ active }: { active: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      active
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400"
        : "border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-500/25 dark:bg-stone-500/10 dark:text-stone-400",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-stone-400")} />
      {active ? "Aktif" : "Nonaktif"}
    </span>
  );
}

// ============ Level form dialog ============
function LevelFormDialog({ open, onOpenChange, level, nextOrder, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; level: LevelRow | null; nextOrder: number; onDone: () => void;
}) {
  const [form, setForm] = useState({ code: "", name: "", sortOrder: "0" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: level?.code ?? "",
      name: level?.name ?? "",
      sortOrder: String(level?.sortOrder ?? nextOrder),
    });
  }, [open, level, nextOrder]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error("Kode dan nama level wajib diisi"); return; }
    const order = Number(form.sortOrder) || 0;
    if (order < 0) { toast.error("Urutan tidak boleh negatif"); return; }
    setSaving(true);
    try {
      if (level) {
        await apiSend("/api/onevity/position-levels", "PATCH", { id: level.id, name: form.name.trim(), sortOrder: order });
        toast.success(`Level ${level.code} berhasil diperbarui`);
      } else {
        const payload = { code: form.code.trim().toUpperCase(), name: form.name.trim(), sortOrder: order };
        await apiSend("/api/onevity/position-levels", "POST", payload);
        toast.success(`Level ${payload.code} berhasil dibuat`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan level jabatan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{level ? `Ubah Level ${level.code}` : "Level Jabatan Baru"}</DialogTitle>
          <DialogDescription>
            {level ? "Perbarui nama dan urutan jenjang level jabatan." : "Tambahkan level jabatan (position level) baru — dimensi jenjang karier & pencocokan approval berjenjang."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pl-code">Kode Level</Label>
              <Input id="pl-code" value={form.code} disabled={!!level} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="PL9" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pl-order">Urutan</Label>
              <Input id="pl-order" type="number" min={0} step={1} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pl-name">Nama Level</Label>
            <Input id="pl-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Senior Manager" />
          </div>
          <p className="text-[10px] text-stone-400">Urutan kecil = jenjang bawah (mis. PL1 operator, PL8 direktur). Dipakai pencocokan struktur approval berjenjang.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : level ? "Simpan" : "Buat Level"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function PositionLevelView() {
  const { data, loading, error, refresh } = useApi<LevelsRes>("/api/onevity/position-levels");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LevelRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const levels = data?.levels ?? [];
  const totalEmployees = levels.reduce((a, l) => a + l.employeeCount, 0);

  const toggleActive = async (l: LevelRow) => {
    try {
      await apiSend("/api/onevity/position-levels", "PATCH", { id: l.id, active: !l.active });
      toast.success(l.active ? `Level ${l.code} dinonaktifkan` : `Level ${l.code} diaktifkan`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengubah status level");
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/position-levels?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(`Level ${editing.code} dihapus`);
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus level jabatan");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Level Jabatan"
        description={`Master level jabatan (position level) — dimensi jenjang karier & pencocokan approval berjenjang. ${levels.length} level · ${totalEmployees} karyawan terpetakan.`}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Muat Ulang</span>
            </Button>
            <Button size="sm" className="h-10 gap-1.5 px-4 font-bold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> Level Baru
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : error && levels.length === 0 ? (
        <EmptyState title="Gagal memuat" description={error} icon={<TrendingUp className="h-6 w-6" />} />
      ) : levels.length === 0 ? (
        <EmptyState title="Belum ada level jabatan" description="Buat level pertama dengan tombol Level Baru." icon={<TrendingUp className="h-6 w-6" />} />
      ) : (
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5 dark:border-stone-800">
              <div>
                <p className="text-[13px] font-bold">Master Level Jabatan</p>
                <p className="text-[11px] text-stone-400">Diurutkan dari jenjang terbawah — dimensi pencocokan approval berjenjang</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <TableHead className="text-[11px] font-bold">Level</TableHead>
                    <TableHead className="text-[11px] font-bold">Urutan</TableHead>
                    <TableHead className="text-[11px] font-bold">Posisi</TableHead>
                    <TableHead className="text-[11px] font-bold">Karyawan</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {levels.map((l) => (
                    <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ov-tile font-mono text-[11px] font-extrabold shadow-md">
                            {l.code}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-stone-800 dark:text-stone-200">{l.name}</p>
                            <p className="font-mono text-[10px] text-stone-400">{l.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 text-[10px] font-bold text-stone-500">
                          <Layers className="h-3 w-3" /> urutan {l.sortOrder}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                          <BriefcaseBusiness className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" /> {l.positionCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
                          <Users className="h-3.5 w-3.5 ov-text-accent" /> {l.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive(l)} title={l.active ? "Nonaktifkan level" : "Aktifkan level"}>
                          <ActivePill active={l.active} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormOpen(true); }} aria-label={`Ubah level ${l.code}`}>
                            <Pencil className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(l); setDeleteOpen(true); }} aria-label={`Hapus level ${l.code}`}>
                            <Trash2 className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <LevelStats levels={levels} />

      <LevelFormDialog open={formOpen} onOpenChange={setFormOpen} level={editing} nextOrder={levels.length + 1} onDone={refresh} />

      <AlertDialog open={deleteOpen} onOpenChange={(v) => { setDeleteOpen(v); if (!v) setEditing(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus level {editing?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Level yang masih dipakai posisi, karyawan, atau struktur approval tidak dapat dihapus.
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

// ============ Ringkasan statistik ============
function LevelStats({ levels }: { levels: LevelRow[] }) {
  if (levels.length === 0) return null;
  const totalEmp = levels.reduce((a, l) => a + l.employeeCount, 0);
  const top = levels.filter((l) => l.employeeCount > 0).sort((a, b) => b.employeeCount - a.employeeCount)[0];
  return (
    <Card className="mt-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Level Terpadat</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{top ? `${top.code} — ${top.employeeCount} karyawan` : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl ov-tile">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Total Karyawan Terpetakan</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{totalEmp} karyawan pada {levels.length} level</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
