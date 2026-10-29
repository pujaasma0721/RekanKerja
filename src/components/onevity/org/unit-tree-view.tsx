"use client";
// OneVity — ORGANISASI › Struktur & Unit: tree panel + detail + CRUD
import { useEffect, useMemo, useState } from "react";
import { useNav } from "@/lib/onevity/store";
import { useApi, apiSend, initials, avatarColor, fmtDate } from "@/lib/onevity/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/components/onevity/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Network, Crown, Landmark, Building2, ChevronRight, Plus, Pencil, Trash2, RefreshCw,
  Users, Layers, Hash, GitBranch, CalendarDays, Building, ChevronsUpDown, ChevronsDownUp, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmployeeBrief, EmployeesRes, OrgUnitNode, OrgUnitsRes } from "./types";
import { levelLabel } from "./types";

const LEVEL_ICON: Record<number, { icon: React.ElementType; cls: string }> = {
  1: { icon: Crown, cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400" },
  2: { icon: Landmark, cls: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400" },
  3: { icon: Building2, cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400" },
  4: { icon: Network, cls: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400" },
};

function levelIcon(level: number) {
  return LEVEL_ICON[level] ?? LEVEL_ICON[4]!;
}

// ============ Unit form dialog (create / edit) ============
function UnitFormDialog({
  open, onOpenChange, mode, unit, units, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  unit: OrgUnitNode | null;
  units: OrgUnitNode[];
  onDone: (created?: OrgUnitNode) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("none");
  const [budget, setBudget] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(mode === "edit" ? (unit?.code ?? "") : "");
    setName(mode === "edit" ? (unit?.name ?? "") : "");
    setParentId(mode === "edit" ? (unit?.parentId ?? "none") : "none");
    setBudget(mode === "edit" ? String(unit?.headcountBudget ?? 0) : "0");
  }, [open, mode, unit]);

  // exclude self + descendants from parent options when editing
  const parentOptions = useMemo(() => {
    if (mode !== "edit" || !unit) return units;
    const banned = new Set<string>([unit.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const u of units) {
        if (u.parentId && banned.has(u.parentId) && !banned.has(u.id)) { banned.add(u.id); grew = true; }
      }
    }
    return units.filter((u) => !banned.has(u.id));
  }, [units, unit, mode]);

  const parent = parentOptions.find((u) => u.id === parentId);
  const nextLevel = parent ? parent.level + 1 : 1;

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error("Kode dan nama unit wajib diisi"); return; }
    setSaving(true);
    try {
      const payload = { code: code.trim(), name: name.trim(), parentId: parentId === "none" ? null : parentId, headcountBudget: Number(budget) || 0 };
      if (mode === "create") {
        const res = await apiSend<{ unit: OrgUnitNode }>("/api/onevity/org-units", "POST", payload);
        toast.success(`Unit "${res.unit.name}" berhasil dibuat`);
        onDone(res.unit);
      } else if (unit) {
        await apiSend("/api/onevity/org-units", "PATCH", { id: unit.id, ...payload });
        toast.success("Unit berhasil diperbarui");
        onDone();
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menyimpan unit");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Unit Baru" : "Ubah Unit"}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? "Tambahkan unit organisasi baru ke struktur perusahaan." : `Perbarui data unit ${unit?.code ?? ""}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="unit-code">Kode Unit</Label>
              <Input id="unit-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MII-HRD" className="font-mono text-xs uppercase" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="unit-budget">Budget Headcount</Label>
              <Input id="unit-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="unit-name">Nama Unit</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Human Resources & General Affairs" />
          </div>
          <div className="grid gap-1.5">
            <Label>Unit Induk</Label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih unit induk" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">— Tanpa induk (level 1) —</SelectItem>
                {parentOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {"·".repeat(Math.max(0, u.level - 1))} {u.code} — {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500">Unit akan berada pada level {nextLevel} — {levelLabel(nextLevel)}</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Menyimpan…" : mode === "create" ? "Buat Unit" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Tree node (recursive) ============
function TreeNode({
  node, depth, selectedId, expanded, onSelect, onToggle,
}: {
  node: OrgUnitNode;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (u: OrgUnitNode) => void;
  onToggle: (id: string) => void;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const meta = levelIcon(node.level);
  const Icon = meta.icon;
  const over = node.headcountBudget > 0 && node._count.employees > node.headcountBudget;

  return (
    <div>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? `Tutup ${node.name}` : `Buka ${node.name}`}
            aria-expanded={isOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform duration-200", isOpen && "rotate-90")} />
          </button>
        ) : (
          <span className="h-9 w-9 shrink-0" />
        )}
        <button
          onClick={() => onSelect(node)}
          className={cn(
            "flex min-h-11 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition",
            isSelected
              ? "bg-emerald-50 text-emerald-900 shadow-sm ring-1 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/40"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900/70"
          )}
        >
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{node.name}</span>
            <span className="block truncate font-mono text-[10px] text-slate-400">{node.code}</span>
          </span>
          <span
            className={cn(
              "flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
              over
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                : isSelected
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            )}
            title={`${node._count.employees} karyawan aktif · budget ${node.headcountBudget}`}
          >
            {node._count.employees}
          </span>
        </button>
      </div>
      {hasChildren && isOpen && (
        <div role="group" className="border-l border-slate-200/80 dark:border-slate-800/80" style={{ marginLeft: depth * 14 + 20 }}>
          {node.children!.map((c) => (
            <TreeNode key={c.id} node={c} depth={0} selectedId={selectedId} expanded={expanded} onSelect={onSelect} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Main view ============
export function UnitTreeView() {
  const { navigate } = useNav();
  const unitsApi = useApi<OrgUnitsRes>("/api/onevity/org-units");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const units = useMemo(() => unitsApi.data?.units ?? [], [unitsApi.data]);
  const tree = useMemo(() => {
    const byParent = new Map<string | null, OrgUnitNode[]>();
    for (const u of units) {
      const list = byParent.get(u.parentId) ?? [];
      list.push(u);
      byParent.set(u.parentId, list);
    }
    const attach = (parentId: string | null): OrgUnitNode[] =>
      (byParent.get(parentId) ?? []).map((u) => ({ ...u, children: attach(u.id) }));
    return attach(null);
  }, [units]);

  const selected = useMemo(() => units.find((u) => u.id === selectedId) ?? null, [units, selectedId]);

  // initial: expand top 2 levels, select root
  useEffect(() => {
    if (units.length === 0) return;
    setExpanded((prev) => {
      if (prev.size > 0) return prev;
      return new Set(units.filter((u) => u.level <= 2).map((u) => u.id));
    });
    setSelectedId((prev) => prev ?? units[0]!.id);
  }, [units]);

  const employeesApi = useApi<EmployeesRes>(
    selectedId ? `/api/onevity/employees?unit=${encodeURIComponent(selectedId)}&limit=100` : null,
    [selectedId]
  );
  const employees = employeesApi.data?.employees ?? [];

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setExpanded(new Set(units.map((u) => u.id)));
  const collapseAll = () => setExpanded(new Set());

  const handleCreated = (created?: OrgUnitNode) => {
    unitsApi.refresh();
    if (created) {
      setSelectedId(created.id);
      if (created.parentId) setExpanded((prev) => new Set(prev).add(created.parentId!));
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      await apiSend(`/api/onevity/org-units?id=${encodeURIComponent(selected.id)}`, "DELETE");
      toast.success(`Unit "${selected.name}" dihapus`);
      setDeleteOpen(false);
      setSelectedId(null);
      unitsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal menghapus unit");
    } finally {
      setDeleting(false);
    }
  };

  const budgetPct = selected && selected.headcountBudget > 0
    ? Math.min(100, Math.round((selected._count.employees / selected.headcountBudget) * 100))
    : 0;

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Unit Organisasi"
        description="Pohon unit organisasi perusahaan — level, budget headcount, dan karyawan per unit."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { unitsApi.refresh(); employeesApi.refresh(); }}
              className="h-10 gap-1.5 px-3"
            >
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Muat Ulang</span>
            </Button>
            <Button size="sm" className="h-10 bg-emerald-600 px-4 font-bold hover:bg-emerald-700" onClick={() => { setFormMode("create"); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> Unit Baru
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* ==== tree panel ==== */}
        <Card className="h-fit rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Struktur Unit
              </CardTitle>
              <CardDescription className="mt-1 text-xs">{units.length} unit terdaftar</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={expandAll} aria-label="Buka semua" title="Buka semua" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <ChevronsUpDown className="h-4 w-4" />
              </button>
              <button onClick={collapseAll} aria-label="Tutup semua" title="Tutup semua" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <ChevronsDownUp className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {unitsApi.loading ? (
              <LoadingRows rows={8} />
            ) : unitsApi.error ? (
              <EmptyState title="Gagal memuat" description={unitsApi.error} />
            ) : tree.length === 0 ? (
              <EmptyState title="Belum ada unit" description="Buat unit pertama dengan tombol Unit Baru." />
            ) : (
              <div className="max-h-[68vh] space-y-0.5 overflow-y-auto pr-1" role="tree" aria-label="Pohon unit organisasi">
                {tree.map((n) => (
                  <TreeNode key={n.id} node={n} depth={0} selectedId={selectedId} expanded={expanded} onSelect={(u) => setSelectedId(u.id)} onToggle={toggle} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ==== detail panel ==== */}
        <div className="space-y-4">
          {!selected ? (
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="pt-6">
                <EmptyState
                  title="Pilih unit organisasi"
                  description="Klik salah satu unit di panel kiri untuk melihat detail, budget headcount, dan daftar karyawan."
                  icon={<Building className="h-6 w-6" />}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="space-y-0 pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      {(() => { const m = levelIcon(selected.level); const I = m.icon; return (
                        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", m.cls)}>
                          <I className="h-6 w-6" />
                        </span>
                      ); })()}
                      <div className="min-w-0">
                        <CardTitle className="truncate text-lg leading-tight">{selected.name}</CardTitle>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="font-mono text-[10px]">{selected.code}</Badge>
                          <Badge className="bg-slate-100 text-[10px] text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{levelLabel(selected.level)}</Badge>
                          <StatusPill status={selected.active ? "Active" : "Cancelled"} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={() => { setFormMode("edit"); setFormOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" /> Ubah
                      </Button>
                      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="h-10 gap-1.5 border-rose-200 px-3 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                            <Trash2 className="h-3.5 w-3.5" /> Hapus
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Hapus unit “{selected.name}”?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Tindakan ini permanen. Unit yang masih memiliki sub-unit, posisi, atau karyawan tidak dapat dihapus.
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
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-0">
                  <div className="grid gap-4 rounded-xl bg-slate-50/70 p-4 dark:bg-slate-900/40 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoTile icon={Hash} label="Kode Unit" value={selected.code} mono />
                    <InfoTile icon={GitBranch} label="Unit Induk" value={selected.parent ? `${selected.parent.code} — ${selected.parent.name}` : "—"} />
                    <InfoTile icon={Layers} label="Posisi" value={`${selected._count.positions} posisi`} />
                    <InfoTile icon={CalendarDays} label="Dibuat" value={fmtDate(selected.createdAt)} />
                  </div>

                  <div className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-800">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                        <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Headcount: Budget vs Aktual
                      </p>
                      <p className={cn(
                        "text-sm font-bold tabular-nums",
                        selected.headcountBudget === 0 ? "text-slate-500"
                          : selected._count.employees > selected.headcountBudget ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400"
                      )}>
                        {selected._count.employees} / {selected.headcountBudget || "—"} orang
                      </p>
                    </div>
                    <Progress value={budgetPct} className="h-2.5 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500" />
                    <p className="mt-2 text-[11px] text-slate-500">
                      {selected.headcountBudget === 0
                        ? "Budget headcount belum ditetapkan."
                        : budgetPct >= 100
                          ? "Budget headcount sudah tercapai."
                          : `Terisi ${budgetPct}% dari budget.`}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <UserRound className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Karyawan di Unit Ini
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs">{employees.length} karyawan · klik untuk membuka profil</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {employeesApi.loading ? (
                    <LoadingRows rows={5} />
                  ) : employees.length === 0 ? (
                    <EmptyState title="Belum ada karyawan" description="Belum ada karyawan yang terdaftar pada unit ini." />
                  ) : (
                    <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
                      {employees.map((e: EmployeeBrief) => (
                        <button
                          key={e.id}
                          onClick={() => navigate("employee", "detail", { id: e.id })}
                          className="flex w-full min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                        >
                          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarColor(e.fullName))}>
                            {initials(e.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{e.fullName}</span>
                            <span className="block truncate text-[11px] text-slate-500">
                              <span className="font-mono">{e.employeeNo}</span> · {e.position?.title ?? "Tanpa posisi"}
                            </span>
                          </span>
                          <StatusPill status={e.status} />
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <UnitFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        unit={formMode === "edit" ? selected : null}
        units={units}
        onDone={handleCreated}
      />
    </div>
  );
}

function InfoTile({ icon: Icon, label, value, mono }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className={cn("truncate text-sm font-semibold text-slate-800 dark:text-slate-200", mono && "font-mono text-xs")}>{value}</p>
      </div>
    </div>
  );
}
