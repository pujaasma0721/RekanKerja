"use client";
// RekanKerja — Modul Organisasi: tree, company profile, org chart
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Building2, Network, Landmark, ChevronRight, ChevronDown, Plus, Pencil, Users,
  MapPin, Phone, Mail, Globe, Building, Layers as LayersIcon, Trash2, Building2 as BuildingIcon, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { OrgMapView } from "./org-map-view";
import { OfficeLocationView } from "./office-location-view";

interface UnitNode {
  id: string; code: string; name: string; parentId: string | null; level: number;
  headcountBudget: number; parentName: string | null;
  employeeCount: number; positionCount: number; childCount: number;
  children?: UnitNode[];
}

// F-05 — hindari dobel kata "Unit Unit …" pada toast/dialog ketika nama unit
// memang sudah berawalan "Unit" (mis. "Unit Uji Coba UAT").
const unitPhrase = (name: string) => (/^unit\b/i.test(name.trim()) ? name.trim() : `Unit ${name.trim()}`);

interface Emp {
  id: string; employeeNo: string; fullName: string; employmentStatus: string; status: string;
  position: { title: string } | null; orgUnit: { name: string } | null;
}

export function OrgModule({ view }: { view: string }) {
  if (view === "companies") return <CompanyProfile />;
  if (view === "chart") return <OrgMapView />;
  if (view === "offices") return <OfficeLocationView />;
  return <OrgTree />;
}

// ================= TREE =================
function OrgTree() {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, loading, refresh } = useApi<{ tree: UnitNode[]; units: UnitNode[] }>("/api/rekankerja/org-units?withTree=1");
  // QA-ORG-EDIT: simpan ID, bukan snapshot — supaya panel detail selalu
  // menampilkan data terbaru (nama/induk/level) setelah edit di-refresh.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => data?.units.find((u) => u.id === selectedId) ?? null,
    [data, selectedId]
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const employees = useApi<{ employees: Emp[]; total: number }>(
    selected ? `/api/rekankerja/employees?unit=${selected.id}&limit=100` : null
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
          onClick={() => { setSelectedId(node.id); if (depth < 3) toggle(node.id); }}
          className={cn(
            "group flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all",
            isSel
              ? "ov-fill shadow-md"
              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          )}
          style={{ paddingLeft: `${depth * 16 + 10}px` }}
          aria-current={isSel ? "true" : undefined}
        >
          {hasChildren ? (
            isOpen && depth < 3 ? <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isSel ? "bg-white/60" : "bg-slate-300 dark:bg-slate-600")} />
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
        <PageHeader eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")} title={t("Unit Organisasi")} description={t("Pohon unit organisasi perusahaan", "Company organizational unit tree")} />
        <LoadingRows rows={8} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")}
        title={t("Unit Organisasi")}
        description={t("{n} unit organisasi dalam 4 level hierarki", "{n} organizational units across 4 hierarchy levels", { n: data?.units.length ?? 0 })}
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Unit Baru", "New Unit")}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* tree panel */}
        <Card className="h-fit rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Network className="h-4 w-4 ov-text-accent" /> {t("Pohon Organisasi", "Organization Tree")}
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
                    <p className="text-xs text-slate-500">{t("Induk: {p}", "Parent: {p}", { p: selected.parentName ?? "—" })}</p>
                  </div>
                  {/* QA-ORG-EDIT: aksi edit + hapus unit terpilih */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1.5 font-semibold">
                      <Pencil className="h-3.5 w-3.5" /> {t("Edit Unit", "Edit Unit")}
                    </Button>
                    <DeleteUnitButton unit={selected} onDeleted={() => { setSelectedId(null); refresh(); }} />
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <StatMini label={t("Karyawan")} value={String(selected.employeeCount)} icon={Users} />
                  <StatMini label={t("Posisi")} value={String(selected.positionCount)} icon={Building2} />
                  <StatMini label={t("Budget HC", "Budget HC")} value={String(selected.headcountBudget)} icon={LayersIcon} />
                </div>
                {selected.headcountBudget > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-slate-500">
                      <span>{t("Okupasi vs Budget", "Occupancy vs Budget")}</span>
                      <span>{selected.employeeCount}/{selected.headcountBudget} ({Math.round((selected.employeeCount / selected.headcountBudget) * 100)}%)</span>
                    </div>
                    <Progress value={Math.min((selected.employeeCount / selected.headcountBudget) * 100, 100)} className="h-2 [&>div]:ov-chart" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <Users className="h-4 w-4 ov-text-accent" /> {t("Karyawan di Unit Ini", "Employees in This Unit")}
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
                          <TableHead className="text-[11px]">{t("Karyawan")}</TableHead>
                          <TableHead className="text-[11px]">{t("Posisi")}</TableHead>
                          <TableHead className="text-[11px]">{t("Status")}</TableHead>
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
                  <EmptyState title={t("Belum ada karyawan", "No employees yet")} description={t("Belum ada karyawan aktif di unit ini.", "No active employees in this unit yet.")} icon={<Users className="h-6 w-6" />} />
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card className="flex min-h-[320px] items-center justify-center rounded-2xl border-dashed border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
            <div className="p-8 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ov-fill shadow-lg">
                <Network className="h-7 w-7" />
              </div>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t("Pilih unit organisasi", "Select an organizational unit")}</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">{t("Klik salah satu node di pohon untuk melihat detail, okupasi, dan daftar karyawan unit tersebut.", "Click a node in the tree to see its details, occupancy, and employee list.")}</p>
            </div>
          </Card>
        )}
      </div>

      <NewUnitDialog open={dialogOpen} setOpen={setDialogOpen} units={data?.units ?? []} onCreated={refresh} />
      <EditUnitDialog open={editOpen} setOpen={setEditOpen} unit={selected} units={data?.units ?? []} onSaved={refresh} />
    </div>
  );
}

// QA-ORG-EDIT — dialog ubah unit: kode (unik), nama, pindah induk (bukan
// diri sendiri/keturunannya — API juga menolak via cek siklus), budget HC.
// QA-ORG-CODE-IMPACT: mengubah KODE unit memicu analisis dampak — dokumen PA
// pending yang resolve-nya hanya menyimpan kode lama akan gagal diproses;
// ditampilkan sebagai peringatan sebelum disimpan + advisory template import.
interface ImpactDoc { docNo: string; type: string; employee: string | null }
interface CodeImpact { code: string; count: number; documents: ImpactDoc[] }

function EditUnitDialog({ open, setOpen, unit, units, onSaved }: {
  open: boolean; setOpen: (v: boolean) => void;
  unit: UnitNode | null; units: UnitNode[]; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [budget, setBudget] = useState("0");
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<CodeImpact | null>(null);

  // Isi ulang form setiap kali dialog dibuka (unit bisa berganti/di-refresh)
  useEffect(() => {
    if (open && unit) {
      setCode(unit.code); setName(unit.name);
      setParentId(unit.parentId); setBudget(String(unit.headcountBudget));
      setImpact(null);
    }
  }, [open, unit]);

  // Deteksi perubahan kode → analisis dampak (debounce 400 ms, batal saat unmount).
  // Analisis memakai kode LAMA (unit.code) — dokumen yang menyimpan kode lama
  // inilah yang gagal resolve setelah unit berganti ke kode baru.
  const codeChanged = !!unit && code.trim() !== "" && code.trim().toUpperCase() !== unit.code;
  const newCode = code.trim().toUpperCase();
  useEffect(() => {
    if (!open || !unit) { setImpact(null); return; }
    if (!codeChanged) { setImpact(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await apiSend<{ impact: CodeImpact }>(`/api/rekankerja/org-units?impactCode=${encodeURIComponent(unit.code)}`, "GET");
        if (alive) setImpact(res.impact);
      } catch { if (alive) setImpact(null); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [codeChanged, open, unit]);

  // Induk kandidat = semua unit KECUALI diri sendiri & seluruh keturunannya
  const banned = useMemo(() => {
    const set = new Set<string>();
    if (!unit) return set;
    set.add(unit.id);
    const queue = [unit.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const u of units) {
        if (u.parentId === cur && !set.has(u.id)) { set.add(u.id); queue.push(u.id); }
      }
    }
    return set;
  }, [units, unit]);

  if (!unit) return null;

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error(t("Kode dan nama wajib diisi", "Code and name are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/org-units", "PATCH", {
        id: unit.id, code: code.trim().toUpperCase(), name: name.trim(),
        parentId, headcountBudget: Number(budget) || 0,
      });
      toast.success(t("{n} diperbarui", "{n} updated", { n: unitPhrase(name) }));
      setOpen(false); onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Pencil className="h-4 w-4 ov-text-accent" /> {t("Edit Unit Organisasi", "Edit Organizational Unit")}</DialogTitle>
          <DialogDescription>{t("Ubah identitas unit, induk, dan budget headcount.", "Change the unit's identity, parent, and headcount budget.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-unit-code" className="text-xs">{t("Kode Unit *", "Unit Code *")}</Label>
              <Input id="edit-unit-code" value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="edit-unit-budget" className="text-xs">{t("Budget Headcount", "Headcount Budget")}</Label>
              <Input id="edit-unit-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="edit-unit-name" className="text-xs">{t("Nama Unit *", "Unit Name *")}</Label>
            <Input id="edit-unit-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t("Unit Induk", "Parent Unit")}</Label>
            <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(v === "none" ? null : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih induk (root bila kosong)", "Select parent (root if empty)")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tanpa induk (root) —", "— No parent (root) —")}</SelectItem>
                {units.filter((u) => !banned.has(u.id)).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {"　".repeat(Math.max(u.level - 1, 0))}{u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-[11px] text-slate-400">{t("Memindahkan unit otomatis menggeser level seluruh sub-unit di bawahnya.", "Moving a unit automatically shifts the level of all its sub-units.")}</p>
          </div>
          {/* QA-ORG-CODE-IMPACT — peringatan dampak perubahan kode unit */}
          {codeChanged && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-[13px] font-bold">{t("Kode unit akan berubah — periksa dampaknya", "Unit code is about to change — check the impact")}</AlertTitle>
              <AlertDescription className="text-xs text-amber-800 dark:text-amber-300/90">
                {impact ? (
                  impact.count > 0 ? (
                    <>
                      <p>
                        {t(
                          "{n} dokumen pengajuan belum diproses dan hanya menyimpan kode {old} — dokumen ini akan gagal diproses setelah kode diganti ke {new}",
                          "{n} pending action documents rely on code {old} only — they will fail to process once the code changes to {new}",
                          { n: impact.count, old: unit?.code, new: newCode },
                        )}
                      </p>
                      <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
                        {impact.documents.slice(0, 5).map((d) => (
                          <li key={d.docNo}>• {d.docNo}{d.employee ? ` — ${d.employee}` : ""} ({d.type})</li>
                        ))}
                      </ul>
                      {impact.count > 5 && (
                        <p className="mt-1 font-mono text-[11px]">+{impact.count - 5} {t("dokumen lainnya…", "more documents…")}</p>
                      )}
                    </>
                  ) : (
                    <p>{t("Tidak ada dokumen pengajuan aktif yang bergantung pada kode lama ini.", "No active action documents depend on this legacy code.")}</p>
                  )
                ) : (
                  <p className="italic">{t("Memeriksa dokumen terkait…", "Checking related documents…")}</p>
                )}
                <p className="mt-1.5 border-t border-amber-200 pt-1.5 dark:border-amber-500/30">
                  {t(
                    "File impor Excel yang sudah disiapkan memakai kode lama akan ditolak — unduh ulang template setelah menyimpan.",
                    "Prepared Excel import files using the old code will be rejected — re-download the template after saving.",
                  )}
                </p>
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan Perubahan", "Save Changes")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const doDelete = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/rekankerja/org-units?id=${unit.id}`, "DELETE");
      toast.success(t("{n} dihapus", "{n} deleted", { n: unitPhrase(unit.name) }));
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  // F-07 — jangan sembunyikan tombol diam-diam: tampilkan NONAKTIF + alasan
  // (guard kini juga mencakup posisi, par dengan pengecekan API DELETE).
  const blockedBy: string[] = [];
  if (unit.childCount > 0) blockedBy.push(t("{n} sub-unit", "{n} sub-units", { n: unit.childCount }));
  if (unit.employeeCount > 0) blockedBy.push(t("{n} karyawan", "{n} employees", { n: unit.employeeCount }));
  if (unit.positionCount > 0) blockedBy.push(t("{n} posisi", "{n} positions", { n: unit.positionCount }));
  if (blockedBy.length > 0) {
    const reason = t("Hapus dinonaktifkan karena unit masih memiliki {x}", "Delete is disabled because the unit still has {x}", { x: blockedBy.join(", ") });
    return (
      <Button
        variant="outline"
        size="sm"
        disabled
        aria-label={reason}
        title={reason}
        className="gap-1.5 border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
      >
        <Trash2 className="h-3.5 w-3.5" /> {t("Hapus")}
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400" onClick={() => setConfirmOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> {t("Hapus")}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-base">{t("Hapus unit?", "Delete unit?")}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500"><b>{unitPhrase(unit.name)}</b> {t("akan dihapus permanen.", "will be permanently deleted.")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>{t("Batal")}</Button>
            <Button onClick={doDelete} disabled={busy} className="bg-rose-600 hover:bg-rose-700">{busy ? t("Menghapus…", "Deleting…") : t("Hapus")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewUnitDialog({ open, setOpen, units, onCreated }: { open: boolean; setOpen: (v: boolean) => void; units: UnitNode[]; onCreated: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [budget, setBudget] = useState("0");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast.error(t("Kode dan nama wajib diisi", "Code and name are required")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/org-units", "POST", { code: code.trim().toUpperCase(), name: name.trim(), parentId, headcountBudget: Number(budget) || 0 });
      toast.success(t("{n} berhasil dibuat", "{n} created successfully", { n: unitPhrase(name) }));
      setOpen(false); setCode(""); setName(""); setParentId(null); setBudget("0");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4 ov-text-accent" /> {t("Unit Organisasi Baru", "New Organizational Unit")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="unit-code" className="text-xs">{t("Kode Unit *", "Unit Code *")}</Label>
              <Input id="unit-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MII-HRD" className="mt-1 font-mono uppercase" />
            </div>
            <div>
              <Label htmlFor="unit-budget" className="text-xs">{t("Budget Headcount", "Headcount Budget")}</Label>
              <Input id="unit-budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} className="mt-1" />
            </div>
          </div>
          <div>
            <Label htmlFor="unit-name" className="text-xs">{t("Nama Unit *", "Unit Name *")}</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Human Resources & GA" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t("Unit Induk", "Parent Unit")}</Label>
            <Select value={parentId ?? "none"} onValueChange={(v) => setParentId(v === "none" ? null : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih induk (root bila kosong)", "Select parent (root if empty)")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tanpa induk (root) —", "— No parent (root) —")}</SelectItem>
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
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan Unit", "Save Unit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= COMPANY =================
// QA-COMPANY-EDIT: kontrak API pasca multi-company — GET mengembalikan
// { companies, activeId, multi, company } (company = profil AKTIF + stats),
// PATCH wajib mengirim `id` company aktif.
interface CompanyData {
  company: {
    id: string; code: string; name: string; shortName: string | null; taxId: string | null;
    address: string | null; city: string | null; phone: string | null; email: string | null;
    website: string | null; currency: string;
    activeEmployees: number; positions: number; orgUnitCount: number;
  } | null;
}

function CompanyProfile() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<CompanyData>("/api/rekankerja/companies");
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (loading && !data) {
    return <div><PageHeader eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")} title={t("Perusahaan")} /><LoadingRows rows={5} /></div>;
  }
  const c = data?.company ?? null;

  if (!c) {
    return (
      <div>
        <PageHeader eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")} title={t("Perusahaan")} />
        <EmptyState
          title={t("Data perusahaan tidak tersedia", "Company data unavailable")}
          description={t("Belum ada perusahaan aktif yang terdaftar pada sistem. Buat perusahaan terlebih dahulu sebelum mengedit profil.", "No active company is registered in the system yet. Create a company before editing its profile.")}
          icon={<Building2 className="h-6 w-6" />}
        />
      </div>
    );
  }

  const openEdit = () => {
    setForm({
      name: c.name ?? "", shortName: c.shortName ?? "", taxId: c.taxId ?? "",
      address: c.address ?? "", city: c.city ?? "", phone: c.phone ?? "",
      email: c.email ?? "", website: c.website ?? "", currency: c.currency ?? "IDR",
    });
    setEditOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error(t("Nama perusahaan wajib diisi", "Company name is required"));
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) {
      toast.error(t("Mata uang wajib kode 3 huruf (mis. IDR)", "Currency must be a 3-letter code (e.g. IDR)"));
      return;
    }
    setBusy(true);
    try {
      // QA-COMPANY-EDIT: PATCH by-id (multi-company) — tanpa `id` API menolak 400.
      await apiSend("/api/rekankerja/companies", "PATCH", {
        id: c.id, ...form, currency: form.currency.trim().toUpperCase(),
      });
      toast.success(t("Profil perusahaan diperbarui", "Company profile updated"));
      setEditOpen(false); refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("PERUSAHAAN & ORGANISASI", "COMPANY & ORGANIZATION")}
        title={t("Perusahaan")}
        description={t("Profil entitas hukum perusahaan aktif", "Profile of the active legal entity")}
        actions={
          <Button variant="outline" size="sm" onClick={openEdit} className="gap-2">
            <Pencil className="h-3.5 w-3.5" /> {t("Edit Profil", "Edit Profile")}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800 lg:col-span-2">
          <div className="h-24 ov-hero" />
          <CardContent className="relative p-6 pt-0">
            <div className="-mt-10 mb-4 flex items-end gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-4 border-white bg-gradient-to-br from-amber-400 to-amber-600 text-lg font-extrabold text-white shadow-lg dark:border-slate-900">
                {c?.shortName?.slice(0, 3) ?? "MII"}
              </div>
              <div className="pb-1">
                <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">{c?.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{c?.code}</Badge>
                  <Badge className="gap-1 bg-brand/10 text-brand-deep hover:bg-brand/10 dark:bg-brand/10 dark:text-brand/85">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand" /> {t("Aktif")}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">{t("Mata uang: {c}", "Currency: {c}", { c: c?.currency ?? "" })}</Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <InfoRow icon={MapPin} label={t("Alamat")} value={`${c?.address ?? "—"}${c?.city ? `, ${c.city}` : ""}`} />
              <InfoRow icon={Phone} label={t("Telepon")} value={c?.phone ?? "—"} />
              <InfoRow icon={Mail} label={t("Email")} value={c?.email ?? "—"} />
              <InfoRow icon={Globe} label="Website" value={c?.website ?? "—"} />
              <InfoRow icon={BuildingIcon} label="NPWP" value={c?.taxId ?? "—"} />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <StatCard label={t("Karyawan Aktif", "Active Employees")} value={String(c?.activeEmployees ?? 0)} icon={Users} />
          <StatCard label={t("Unit Organisasi")} value={String(c?.orgUnitCount ?? 0)} icon={Network} />
          <StatCard label={t("Posisi Terdefinisi", "Defined Positions")} value={String(c?.positions ?? 0)} icon={Building2} />
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{t("Edit Profil Perusahaan", "Edit Company Profile")}</DialogTitle>
            <DialogDescription>{t("Perbarui data identitas dan kontak company aktif.", "Update the active company's identity and contact details.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", t("Nama Perusahaan", "Company Name")], ["shortName", t("Nama Singkat", "Short Name")],
              ["taxId", t("NPWP", "NPWP")], ["phone", t("Telepon", "Phone")],
              ["email", t("Email", "Email")], ["website", t("Website", "Website")],
              ["city", t("Kota", "City")], ["currency", t("Mata Uang", "Currency")],
              ["address", t("Alamat Lengkap", "Full Address")],
            ] as const).map(([key, label]) => (
              <div key={key} className={key === "address" ? "sm:col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className={cn("mt-1", key === "currency" && "font-mono uppercase")}
                />
              </div>
            ))}
          </div>
          {/* F-10 — dokumentasikan bahwa kode perusahaan read-only by design */}
          <p className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            {t(
              "Kode perusahaan ({code}) bersifat tetap — tidak dapat diubah dari profil ini.",
              "The company code ({code}) is fixed — it cannot be changed from this profile.",
              { code: c.code },
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t("Batal")}</Button>
            <Button onClick={save} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white ov-text-accent shadow-sm dark:bg-slate-800">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="break-words text-[13px] font-semibold text-slate-800 dark:text-slate-200">{value}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ov-tile shadow-md">
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

