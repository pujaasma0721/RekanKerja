"use client";
// RekanKerja — POSISI & JABATAN › Level Jabatan: master position level (PL1..PLn) + CRUD
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useTableSort } from "@/rekankerja/shared/lib/use-table-sort";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
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
  const { t } = useI18n();
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      active
        ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85"
        : "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-brand" : "bg-slate-400")} />
      {active ? t("Aktif") : t("Nonaktif")}
    </span>
  );
}

// ============ Level form dialog ============
function LevelFormDialog({ open, onOpenChange, level, nextOrder, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; level: LevelRow | null; nextOrder: number; onDone: () => void;
}) {
  const [form, setForm] = useState({ code: "", name: "", sortOrder: "0" });
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm({
      code: level?.code ?? "",
      name: level?.name ?? "",
      sortOrder: String(level?.sortOrder ?? nextOrder),
    });
  }, [open, level, nextOrder]);

  const submit = async () => {
    if (!form.code.trim() || !form.name.trim()) { toast.error(t("Kode dan nama level wajib diisi", "Code and level name are required")); return; }
    const order = Number(form.sortOrder) || 0;
    if (order < 0) { toast.error(t("Urutan tidak boleh negatif", "Order cannot be negative")); return; }
    setSaving(true);
    try {
      if (level) {
        await apiSend("/api/rekankerja/position-levels", "PATCH", { id: level.id, name: form.name.trim(), sortOrder: order });
        toast.success(t("Level {code} berhasil diperbarui", "Level {code} updated successfully", { code: level.code }));
      } else {
        const payload = { code: form.code.trim().toUpperCase(), name: form.name.trim(), sortOrder: order };
        await apiSend("/api/rekankerja/position-levels", "POST", payload);
        toast.success(t("Level {code} berhasil dibuat", "Level {code} created successfully", { code: payload.code }));
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan level jabatan", "Failed to save job level"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{level ? t("Ubah Level {code}", "Edit Level {code}", { code: level.code }) : t("Level Jabatan Baru", "New Job Level")}</DialogTitle>
          <DialogDescription>
            {level ? t("Perbarui nama dan urutan jenjang level jabatan.", "Update the job level name and order.") : t("Tambahkan level jabatan (position level) baru — dimensi jenjang karier & pencocokan approval berjenjang.", "Add a new job level (position level) — career ladder dimension & tiered approval matching.")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pl-code">{t("Kode Level", "Level Code")}</Label>
              <Input id="pl-code" value={form.code} disabled={!!level} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="PL9" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pl-order">{t("Urutan", "Order")}</Label>
              <Input id="pl-order" type="number" min={0} step={1} value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pl-name">{t("Nama Level", "Level Name")}</Label>
            <Input id="pl-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Senior Manager" />
          </div>
          <p className="text-[10px] text-slate-400">{t("Urutan kecil = jenjang bawah (mis. PL1 operator, PL8 direktur). Dipakai pencocokan struktur approval berjenjang.", "A smaller order means a lower tier (e.g. PL1 operator, PL8 director). Used for tiered approval matching.")}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : level ? t("Simpan") : t("Buat Level", "Create Level")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Main view ============
export function PositionLevelView() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<LevelsRes>("/api/rekankerja/position-levels");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LevelRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const levels = data?.levels ?? [];
  const sort = useTableSort(levels, {
    level: (l) => l.name,
    order: (l) => l.sortOrder,
    positions: (l) => l.positionCount,
    employees: (l) => l.employeeCount,
    status: (l) => l.active ? 0 : 1,
  }, { defaultKey: "order", defaultDir: "asc" });
  const totalEmployees = levels.reduce((a, l) => a + l.employeeCount, 0);

  const toggleActive = async (l: LevelRow) => {
    try {
      await apiSend("/api/rekankerja/position-levels", "PATCH", { id: l.id, active: !l.active });
      toast.success(l.active ? t("Level {code} dinonaktifkan", "Level {code} deactivated", { code: l.code }) : t("Level {code} diaktifkan", "Level {code} activated", { code: l.code }));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah status level", "Failed to change level status"));
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/position-levels?id=${encodeURIComponent(editing.id)}`, "DELETE");
      toast.success(t("Level {code} dihapus", "Level {code} deleted", { code: editing.code }));
      setDeleteOpen(false);
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus level jabatan", "Failed to delete job level"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Level Jabatan")}
        description={t("Master level jabatan (position level) — dimensi jenjang karier & pencocokan approval berjenjang. {l} level · {e} karyawan terpetakan.", "Job level master (position level) — career ladder dimension & tiered approval matching. {l} levels · {e} employees mapped.", { l: levels.length, e: totalEmployees })}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refresh}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
            </Button>
            <Button size="sm" className="h-10 gap-1.5 px-4 font-bold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> {t("Level Baru", "New Level")}
            </Button>
          </>
        }
      />

      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : error && levels.length === 0 ? (
        <EmptyState title={t("Gagal memuat", "Failed to load")} description={error} icon={<TrendingUp className="h-6 w-6" />} />
      ) : levels.length === 0 ? (
        <EmptyState title={t("Belum ada level jabatan", "No job levels yet")} description={t("Buat level pertama dengan tombol Level Baru.", "Create the first level with the New Level button.")} icon={<TrendingUp className="h-6 w-6" />} />
      ) : (
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
              <div>
                <p className="text-[13px] font-bold">{t("Master Level Jabatan", "Job Level Master")}</p>
                <p className="text-[11px] text-slate-400">{t("Diurutkan dari jenjang terbawah — dimensi pencocokan approval berjenjang", "Sorted from the lowest tier — tiered approval matching dimension")}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    {sort.head("level", t("Level"), "text-[11px] font-bold")}
                    {sort.head("order", t("Urutan", "Order"), "text-[11px] font-bold")}
                    {sort.head("positions", t("Posisi"), "text-[11px] font-bold")}
                    {sort.head("employees", t("Karyawan"), "text-[11px] font-bold")}
                    {sort.head("status", t("Status"), "text-[11px] font-bold")}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((l) => (
                    <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ov-tile font-mono text-[11px] font-extrabold shadow-md">
                            {l.code}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-200">{l.name}</p>
                            <p className="font-mono text-[10px] text-slate-400">{l.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="gap-1 text-[10px] font-bold text-slate-500">
                          <Layers className="h-3 w-3" /> {t("urutan {n}", "order {n}", { n: l.sortOrder })}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <BriefcaseBusiness className="h-3.5 w-3.5 text-brand dark:text-brand/85" /> {l.positionCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Users className="h-3.5 w-3.5 ov-text-accent" /> {l.employeeCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <button onClick={() => toggleActive(l)} title={l.active ? t("Nonaktifkan level", "Deactivate level") : t("Aktifkan level", "Activate level")}>
                          <ActivePill active={l.active} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(l); setFormOpen(true); }} aria-label={t("Ubah level {code}", "Edit level {code}", { code: l.code })}>
                            <Pencil className="h-3.5 w-3.5 text-slate-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => { setEditing(l); setDeleteOpen(true); }} aria-label={t("Hapus level {code}", "Delete level {code}", { code: l.code })}>
                            <Trash2 className="h-3.5 w-3.5 text-slate-400" />
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
            <AlertDialogTitle>{t("Hapus level {code}?", "Delete level {code}?", { code: editing?.code ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Level yang masih dipakai posisi, karyawan, atau struktur approval tidak dapat dihapus.", "This action is permanent. Levels still used by positions, employees, or approval structures cannot be deleted.")}
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

// ============ Ringkasan statistik ============
function LevelStats({ levels }: { levels: LevelRow[] }) {
  const { t } = useI18n();
  if (levels.length === 0) return null;
  const totalEmp = levels.reduce((a, l) => a + l.employeeCount, 0);
  const top = levels.filter((l) => l.employeeCount > 0).sort((a, b) => b.employeeCount - a.employeeCount)[0];
  return (
    <Card className="mt-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Level Terpadat", "Densest Level")}</p>
            <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{top ? t("{code} — {n} karyawan", "{code} — {n} employees", { code: top.code, n: top.employeeCount }) : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl ov-tile">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Total Karyawan Terpetakan", "Total Employees Mapped")}</p>
            <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">{t("{n} karyawan pada {m} level", "{n} employees across {m} levels", { n: totalEmp, m: levels.length })}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
