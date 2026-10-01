"use client";
// OneVity — Modul Organisasi: tree, company profile, org chart
import { useMemo, useState } from "react";
import { useApi, apiSend, initials, avatarColor } from "@/lib/onevity/api";
import { useNav } from "@/lib/onevity/store";
import { PageHeader, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Building2, Network, Landmark, ChevronRight, ChevronDown, Plus, Pencil, Users,
  MapPin, Phone, Mail, Globe, Building, Layers as LayersIcon, Trash2, Building2 as BuildingIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OrgMapView } from "./org-map-view";

interface UnitNode {
  id: string; code: string; name: string; parentId: string | null; level: number;
  headcountBudget: number; parentName: string | null;
  employeeCount: number; positionCount: number; childCount: number;
  children?: UnitNode[];
}

interface Emp {
  id: string; employeeNo: string; fullName: string; employmentStatus: string; status: string;
  position: { title: string } | null; orgUnit: { name: string } | null;
}

export function OrgModule({ view }: { view: string }) {
  if (view === "companies") return <CompanyProfile />;
  if (view === "chart") return <OrgMapView />;
  return <OrgTree />;
}

// ================= TREE =================
function OrgTree() {
  const { navigate } = useNav();
  const { data, loading, refresh } = useApi<{ tree: UnitNode[]; units: UnitNode[] }>("/api/onevity/org-units?withTree=1");
  const [selected, setSelected] = useState<UnitNode | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const employees = useApi<{ employees: Emp[]; total: number }>(
    selected ? `/api/onevity/employees?unit=${selected.id}&limit=100` : null
  );

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const renderNode = (node: UnitNode, depth: number) => {
    const isSel = selected?.id === node.id;
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isOpen = !collapsed.has(node.id);
    return (
      <div key={node.id}>
        <button
          onClick={() => { setSelected(node); if (depth < 3) toggle(node.id); }}
          className={cn(
            "group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all",
            isSel
              ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          )}
          style={{ paddingLeft: `${depth * 16 + 10}px` }}
          aria-current={isSel ? "true" : undefined}
        >
          {hasChildren ? (
            isOpen && depth < 3 ? <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isSel ? "bg-emerald-200" : "bg-slate-300 dark:bg-slate-600")} />
          )}
          {depth === 0 ? <Landmark className="h-4 w-4 shrink-0" /> : depth === 1 ? <Building className="h-4 w-4 shrink-0" /> : <Building2 className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{node.name}</span>
          <span className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold",
            isSel ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          )}>
            {node.employeeCount}
          </span>
        </button>
        {hasChildren && !collapsed.has(node.id) && (
          <div className="relative">
            <div className="absolute left-[7px] top-0 h-full w-px bg-slate-200 dark:bg-slate-700" style={{ marginLeft: `${depth * 16 + 17}px` }} />
            {node.children!.map((c) => renderNode(c, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading && !data) {
    return (
      <div>
        <PageHeader eyebrow="PERUSAHAAN & ORGANISASI" title="Unit Organisasi" description="Pohon unit organisasi perusahaan" />
        <LoadingRows rows={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Unit Organisasi"
        description={`${data?.units.length ?? 0} unit organisasi dalam 4 level hierarki`}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Unit Baru
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* tree panel */}
        <Card className="h-fit rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Network className="h-4 w-4 text-emerald-600" /> Pohon Organisasi
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[70vh] overflow-y-auto pt-0">
            {data?.tree.map((n) => renderNode(n, 0))}
          </CardContent>
        </Card>

        {/* detail panel */}
        {selected ? (
          <div className="space-y-4">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{selected.code}</Badge>
                      <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400">Level {selected.level}</Badge>
                    </div>
                    <h2 className="mt-1.5 text-lg font-bold text-slate-900 dark:text-slate-100">{selected.name}</h2>
                    <p className="text-xs text-slate-500">Induk: {selected.parentName ?? "—"}</p>
                  </div>
                  <DeleteUnitButton unit={selected} onDeleted={() => { setSelected(null); refresh(); }} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <StatMini label="Karyawan" value={String(selected.employeeCount)} icon={Users} />
                  <StatMini label="Posisi" value={String(selected.positionCount)} icon={Building2} />
                  <StatMini label="Budget HC" value={String(selected.headcountBudget)} icon={LayersIcon} />
                </div>
                {selected.headcountBudget > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-slate-500">
                      <span>Okupasi vs Budget</span>
                      <span>{selected.employeeCount}/{selected.headcountBudget} ({Math.round((selected.employeeCount / selected.headcountBudget) * 100)}%)</span>
                    </div>
                    <Progress value={Math.min((selected.employeeCount / selected.headcountBudget) * 100, 100)} className="h-2 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Users className="h-4 w-4 text-emerald-600" /> Karyawan di Unit Ini
                  <Badge variant="secondary" className="ml-auto font-mono">{employees.data?.total ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {employees.loading && !employees.data ? (
                  <LoadingRows rows={3} />
                ) : employees.data?.employees.length ? (
                  <div className="max-h-72 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                          <TableHead className="text-[11px]">Karyawan</TableHead>
                          <TableHead className="text-[11px]">Posisi</TableHead>
                          <TableHead className="text-[11px]">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employees.data.employees.map((e) => (
                          <TableRow key={e.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60" onClick={() => navigate("employee", "detail", { id: e.id })}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", avatarColor(e.fullName))}>{initials(e.fullName)}</div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-bold">{e.fullName}</p>
                                  <p className="font-mono text-[10px] text-slate-400">{e.employeeNo}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">{e.position?.title ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">{e.employmentStatus}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="Belum ada karyawan" description="Belum ada karyawan aktif di unit ini." icon={<Users className="h-6 w-6" />} />
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center rounded-2xl border-dashed border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
                <Network className="h-7 w-7" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">Pilih unit organisasi</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">Klik salah satu node di pohon untuk melihat detail, okupasi, dan daftar karyawan unit tersebut.</p>
            </div>
          </Card>
        )}
      </div>

      <NewUnitDialog open={dialogOpen} setOpen={setDialogOpen} units={data?.units ?? []} onCreated={refresh} />
    </div>
  );
}

function StatMini({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-0.5 text-xl font-extrabold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

function DeleteUnitButton({ unit, onDeleted }: { unit: UnitNode; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const doDelete = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/onevity/org-units?id=${unit.id}`, "DELETE");
      toast.success(`Unit ${unit.name} dihapus`);
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  if (unit.childCount > 0 || unit.employeeCount > 0) return null;
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400" onClick={() => setConfirmOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Hapus
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-base">Hapus unit?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Unit <b>{unit.name}</b> akan dihapus permanen.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Batal</Button>
            <Button onClick={doDelete} disabled={busy} className="bg-rose-600 hover:bg-rose-700">{busy ? "Menghapus…" : "Hapus"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewUnitDialog({ open, setOpen, units, onCreated }: { open: boolean; setOpen: (v: boolean) => void; units: UnitNode[]; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [budget, setBudget] = useState("0");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error("Kode dan nama wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/org-units", "POST", { code: code.trim().toUpperCase(), name: name.trim(), parentId, headcountBudget: Number(budget) || 0 });
      toast.success(`Unit ${name} berhasil dibuat`);
      setOpen(false); setCode(""); setName(""); setParentId(null); setBudget("0");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 text-emerald-600" /> Unit Organisasi Baru</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-code" className="text-xs">Kode Unit *</Label>
              <Input id="unit-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MII-HRD" className="mt-1 font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="unit-budget" className="text-xs">Budget Headcount</Label>
              <Input id="unit-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="unit-name" className="text-xs">Nama Unit *</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Human Resources & GA" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Unit Induk</Label>
            <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(v === "none" ? null : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih induk (root bila kosong)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tanpa induk (root) —</SelectItem>
                {units.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {"　".repeat(Math.max(u.level - 1, 0))}{u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan Unit"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= COMPANY =================
interface CompanyData {
  company: {
    id: string; code: string; name: string; shortName: string | null; taxId: string | null;
    address: string | null; city: string | null; phone: string | null; email: string | null;
    website: string | null; currency: string;
    activeEmployees: number; positions: number; orgUnitCount: number;
  };
}

function CompanyProfile() {
  const { data, loading, refresh } = useApi<CompanyData>("/api/onevity/companies");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (loading && !data) {
    return <div><PageHeader eyebrow="PERUSAHAAN & ORGANISASI" title="Perusahaan" /><LoadingRows rows={5} /></div>;
  }
  const c = data?.company;

  const openEdit = () => {
    setForm({
      name: c?.name ?? "", shortName: c?.shortName ?? "", taxId: c?.taxId ?? "",
      address: c?.address ?? "", city: c?.city ?? "", phone: c?.phone ?? "",
      email: c?.email ?? "", website: c?.website ?? "",
    });
    setEditOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await apiSend("/api/onevity/companies", "PATCH", form);
      toast.success("Profil perusahaan diperbarui");
      setEditOpen(false); refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="PERUSAHAAN & ORGANISASI"
        title="Perusahaan"
        description="Profil entitas hukum perusahaan aktif"
        actions={
          <Button variant="outline" size="sm" onClick={openEdit} className="gap-2">
            <Pencil className="h-3.5 w-3.5" /> Edit Profil
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 lg:col-span-2">
          <div className="h-24 bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800" />
          <CardContent className="relative p-6 pt-0">
            <div className="-mt-10 mb-4 flex items-end gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br from-amber-400 to-amber-600 text-lg font-extrabold text-white shadow-lg dark:border-slate-900">
                {c?.shortName?.slice(0, 3) ?? "MII"}
              </div>
              <div className="pb-1">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{c?.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{c?.code}</Badge>
                  <Badge className="gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Aktif
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">Mata uang: {c?.currency}</Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <InfoRow icon={MapPin} label="Alamat" value={`${c?.address ?? "—"}${c?.city ? `, ${c.city}` : ""}`} />
              <InfoRow icon={Phone} label="Telepon" value={c?.phone ?? "—"} />
              <InfoRow icon={Mail} label="Email" value={c?.email ?? "—"} />
              <InfoRow icon={Globe} label="Website" value={c?.website ?? "—"} />
              <InfoRow icon={BuildingIcon} label="NPWP" value={c?.taxId ?? "—"} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <StatCard label="Karyawan Aktif" value={String(c?.activeEmployees ?? 0)} icon={Users} gradient="from-emerald-500 to-teal-600" />
          <StatCard label="Unit Organisasi" value={String(c?.orgUnitCount ?? 0)} icon={Network} gradient="from-teal-500 to-emerald-600" />
          <StatCard label="Posisi Terdefinisi" value={String(c?.positions ?? 0)} icon={Building2} gradient="from-amber-400 to-orange-500" />
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="text-base">Edit Profil Perusahaan</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", "Nama Perusahaan", "full"], ["shortName", "Nama Singkat", "full"],
              ["taxId", "NPWP", "full"], ["phone", "Telepon", "full"],
              ["email", "Email", "full"], ["website", "Website", "full"],
              ["city", "Kota", "full"], ["address", "Alamat Lengkap", "full"],
            ] as const).map(([key, label]) => (
              <div key={key} className={key === "address" ? "sm:col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input value={form[key] ?? ""} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="mt-1" />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Batal</Button>
            <Button onClick={save} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-600 shadow-sm dark:bg-slate-800">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="break-words text-[13px] font-semibold text-slate-800 dark:text-slate-200">{value}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, gradient }: { label: string; value: string; icon: React.ElementType; gradient: string }) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", gradient)}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-50">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

