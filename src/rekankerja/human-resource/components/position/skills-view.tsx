"use client";
// P3.2-BM (D-BM24) — Katalog Keahlian: master SkillCatalog organisasi (CRUD
// + hitung pemakaian) + pintu penilaian karyawan (dinilai di tab Keahlian
// profil karyawan — op:assess). Katalog + level SAJA — BUKAN modul training
// (D-BM28 exclude permanen; tidak ada kursus/sesi/e-learning di sini).
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Wrench, Plus, Search, Pencil, Trash2, Users, BriefcaseBusiness, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SkillRow {
  id: string;
  code: string;
  name: string;
  category: string | null;
  active: boolean;
  sortOrder: number;
  employeeCount: number;
  positionCount: number;
}

export function SkillsCatalogView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SkillRow | null>(null);
  const [deleting, setDeleting] = useState<SkillRow | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (cat !== "all") p.set("category", cat);
    return `/api/rekankerja/skills?${p.toString()}`;
  }, [q, cat]);

  const { data, loading, refresh } = useApi<{ skills: SkillRow[]; total: number }>(url);
  const skills = data?.skills ?? [];
  const categories = useMemo(
    () => [...new Set(skills.map((s) => s.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)),
    [skills],
  );

  const stats = useMemo(() => ({
    total: skills.length,
    active: skills.filter((s) => s.active).length,
    assessed: skills.reduce((a, s) => a + s.employeeCount, 0),
    inPositions: skills.reduce((a, s) => a + (s.positionCount > 0 ? 1 : 0), 0),
  }), [skills]);

  const toggleActive = async (s: SkillRow) => {
    try {
      await apiSend("/api/rekankerja/skills", "PATCH", { id: s.id, active: !s.active });
      toast.success(
        s.active
          ? t("Keahlian {n} dinonaktifkan", "Skill {n} deactivated", { n: s.name })
          : t("Keahlian {n} diaktifkan", "Skill {n} activated", { n: s.name }),
      );
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Posisi & Jabatan", "Positions & Jobs")}
        title={t("Katalog Keahlian", "Skill Catalog")}
        description={t(
          "Master keahlian lintas organisasi — dipakai untuk penilaian karyawan (level 1–5) dan syarat posisi",
          "Organization-wide skill master — used for employee assessments (level 1–5) and position requirements",
        )}
        actions={
          perms.can("hr", "skills", "create") && (
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Keahlian Baru", "New Skill")}
            </Button>
          )
        }
      />

      {/* mini stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkillStat label={t("Total Keahlian", "Total Skills")} value={stats.total} icon={Wrench} />
        <SkillStat label={t("Aktif", "Active")} value={stats.active} icon={CheckCircle2} />
        <SkillStat label={t("Penilaian Karyawan", "Employee Assessments")} value={stats.assessed} icon={Users} />
        <SkillStat label={t("Dipakai Posisi", "Used by Positions")} value={stats.inPositions} icon={BriefcaseBusiness} />
      </div>

      {/* toolbar */}
      <Card className="mb-1 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari kode / nama keahlian…", "Search code / skill name…")} className="pl-9" />
          </div>
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder={t("Semua kategori", "All categories")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua kategori", "All categories")}</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* table */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : skills.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                    <TableHead className="min-w-40 text-[11px] font-bold">{t("Keahlian", "Skill")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Kategori", "Category")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Pemakaian", "Usage")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Urutan", "Order")}</TableHead>
                    <TableHead className="text-[11px] font-bold">{t("Status")}</TableHead>
                    <TableHead className="w-20 text-[11px] font-bold">{t("Aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skills.map((s) => (
                    <TableRow key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200">{s.name}</p>
                        <p className="font-mono text-[10px] text-slate-400">{s.code}</p>
                      </TableCell>
                      <TableCell>
                        {s.category ? (
                          <Badge variant="outline" className="text-[10px] font-bold">{s.category}</Badge>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="gap-1 border-slate-200 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            <Users className="h-3 w-3" /> {s.employeeCount}
                          </Badge>
                          <Badge variant="outline" className="gap-1 border-slate-200 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300">
                            <BriefcaseBusiness className="h-3 w-3" /> {s.positionCount}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">{s.sortOrder}</TableCell>
                      <TableCell>
                        {perms.can("hr", "skills", "update") ? (
                          <div className="flex items-center gap-2">
                            <Switch checked={s.active} onCheckedChange={() => toggleActive(s)} aria-label={t("Aktifkan/nonaktifkan {n}", "Activate/deactivate {n}", { n: s.name })} />
                            <span className={cn("text-[10px] font-bold", s.active ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>
                              {s.active ? t("Aktif") : t("Non-aktif", "Inactive")}
                            </span>
                          </div>
                        ) : (
                          <Badge variant="outline" className={cn("text-[10px] font-bold", s.active ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85" : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500")}>
                            {s.active ? t("Aktif") : t("Non-aktif", "Inactive")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {perms.can("hr", "skills", "update") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(s); setDialogOpen(true); }} aria-label={t("Ubah keahlian {n}", "Edit skill {n}", { n: s.name })} title={t("Ubah", "Edit")}>
                              <Pencil className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                          {perms.can("hr", "skills", "delete") && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => setDeleting(s)} aria-label={t("Hapus keahlian {n}", "Delete skill {n}", { n: s.name })} title={t("Hapus", "Delete")}>
                              <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                title={t("Belum ada keahlian di katalog", "No skills in the catalog yet")}
                description={t("Tambahkan keahlian organisasi — mis. Microsoft Excel, Komunikasi Efektif, atau PPh 21.", "Add organization skills — e.g. Microsoft Excel, Effective Communication, or PPh 21.")}
                icon={Wrench}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <SkillCatalogDialog
        open={dialogOpen}
        setOpen={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        skill={editing}
        onSaved={refresh}
      />

      {/* konfirmasi hapus katalog */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus keahlian {n}?", "Delete skill {n}?", { n: deleting?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Keahlian yang masih dipakai penilaian karyawan atau syarat posisi tidak dapat dihapus.",
                "Skills still used by employee assessments or position requirements cannot be deleted.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction disabled={busyDelete} className="bg-rose-600 hover:bg-rose-700" onClick={async (e) => {
              e.preventDefault();
              if (!deleting) return;
              setBusyDelete(true);
              try {
                await apiSend(`/api/rekankerja/skills?id=${encodeURIComponent(deleting.id)}`, "DELETE");
                toast.success(t("Keahlian {n} dihapus", "Skill {n} deleted", { n: deleting.name }));
                setDeleting(null); refresh();
              } catch (err) { toast.error((err as Error).message); } finally { setBusyDelete(false); }
            }}>
              {busyDelete ? t("Menghapus…") : t("Ya, Hapus", "Yes, Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SkillStat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ov-tile">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-lg font-extrabold text-slate-900 dark:text-slate-50">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SkillCatalogDialog({
  open, setOpen, skill, onSaved,
}: {
  open: boolean; setOpen: (v: boolean) => void; skill: SkillRow | null; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(skill?.code ?? "");
    setName(skill?.name ?? "");
    setCategory(skill?.category ?? "");
    setSortOrder(String(skill?.sortOrder ?? 0));
    setActive(skill?.active ?? true);
  }, [open, skill]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !name.trim()) {
      toast.error(t("Kode dan nama keahlian wajib diisi", "Code and skill name are required"));
      return;
    }
    setBusy(true);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        category: category.trim() || null,
        sortOrder: Number(sortOrder) || 0,
        active,
      };
      if (skill) {
        await apiSend("/api/rekankerja/skills", "PATCH", { id: skill.id, ...payload });
        toast.success(t("Keahlian {n} diperbarui", "Skill {n} updated", { n: payload.name }));
      } else {
        await apiSend("/api/rekankerja/skills", "POST", { action: "create", ...payload });
        toast.success(t("Keahlian {n} ditambahkan", "Skill {n} added", { n: payload.name }));
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4 ov-text-accent" /> {skill ? t("Ubah Keahlian", "Edit Skill") : t("Keahlian Baru", "New Skill")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Katalog keahlian organisasi — dinilai per karyawan (level 1–5) dan bisa dijadikan syarat posisi.",
              "Organization skill catalog — assessed per employee (level 1–5) and can be set as a position requirement.",
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 py-1 sm:grid-cols-2">
          <div>
            <Label htmlFor="skl-code" className="text-xs">{t("Kode *", "Code *")}</Label>
            <Input
              id="skl-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SKL-NEW"
              disabled={!!skill}
              maxLength={24}
              className="mt-1 font-mono uppercase disabled:opacity-60"
            />
            {skill && (
              <p className="mt-1 text-[10px] text-slate-400">
                {t("Kode tidak dapat diubah setelah keahlian dibuat.", "The code cannot be changed after the skill is created.")}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="skl-name" className="text-xs">{t("Nama *", "Name *")}</Label>
            <Input id="skl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Microsoft Excel", "Microsoft Excel")} maxLength={120} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="skl-cat" className="text-xs">{t("Kategori", "Category")}</Label>
            <Input id="skl-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("Teknis / Soft Skill / Manajerial…", "Technical / Soft Skill / Managerial…")} maxLength={60} className="mt-1" />
            <p className="mt-1 text-[10px] text-slate-400">{t("Teks bebas, maks 60 karakter.", "Free text, max 60 characters.")}</p>
          </div>
          <div>
            <Label htmlFor="skl-sort" className="text-xs">{t("Urutan Tampil", "Display Order")}</Label>
            <Input id="skl-sort" type="number" min={0} max={9999} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="mt-1" />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 dark:border-slate-800 sm:col-span-2">
            <div>
              <Label htmlFor="skl-active" className="text-sm font-semibold">{t("Aktif", "Active")}</Label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("Keahlian non-aktif tidak bisa dipakai penilaian/syarat baru.", "Inactive skills cannot be used for new assessments/requirements.")}
              </p>
            </div>
            <Switch id="skl-active" checked={active} onCheckedChange={setActive} />
          </div>
          <DialogFooter className="mt-1 gap-2 sm:col-span-2">
            <Button type="button" variant="outline" className="h-11 px-5" onClick={() => setOpen(false)} disabled={busy}>{t("Batal")}</Button>
            <Button type="submit" className="h-11 gap-2 px-6 font-bold" disabled={busy}>
              {busy ? t("Menyimpan…", "Saving…") : skill ? t("Simpan Perubahan", "Save Changes") : t("Tambah Keahlian", "Add Skill")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
