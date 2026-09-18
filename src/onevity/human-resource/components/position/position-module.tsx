"use client";
// OneVity — Modul Posisi & Grading: list, job library, grades
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, initials, avatarColor } from "@/onevity/shared/lib/api";
import { useTableSort } from "@/onevity/shared/lib/use-table-sort";
import { useNav } from "@/onevity/shared/lib/store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  BriefcaseBusiness, FileText, GraduationCap, Plus, Search, Pencil, Users, Trash2,
  ChevronDown, ChevronUp, Layers, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PositionLevelView } from "./level-view";

export function PositionModule({ view }: { view: string }) {
  if (view === "jobs") return <JobLibrary />;
  if (view === "grades") return <GradeList />;
  if (view === "levels") return <PositionLevelView />;
  return <PositionList />;
}

interface Position {
  id: string; code: string; title: string; level: string | null; headcount: number; filled: number; active: boolean;
  job: { title: string; code: string } | null;
  orgUnit: { name: string; code: string } | null;
  grade: { code: string; name: string } | null;
  reportsTo: { title: string; code: string } | null;
  directReportCount: number;
  employees: { id: string; fullName: string; employeeNo: string }[];
  unitId: string | null;
}
interface UnitOpt { id: string; name: string; level: number }
interface JobOpt { id: string; code: string; title: string; category: string | null; active: boolean; positionCount: number }
interface GradeOpt { id: string; code: string; name: string; minSalary: number; maxSalary: number; employeeCount: number; positionCount: number; active: boolean }

// ================= POSITION LIST =================
function PositionList() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("all");
  const [grade, setGrade] = useState("all");
  const [selected, setSelected] = useState<Position | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState<Position | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (unit !== "all") p.set("orgUnitId", unit);
    if (grade !== "all") p.set("gradeId", grade);
    return `/api/onevity/positions?${p.toString()}`;
  }, [q, unit, grade]);

  const { data, loading, refresh } = useApi<{ positions: Position[]; total: number }>(url);
  const units = useApi<{ units: UnitOpt[] }>("/api/onevity/org-units");
  const grades = useApi<{ grades: GradeOpt[] }>("/api/onevity/grades");

  const stats = useMemo(() => {
    const ps = data?.positions ?? [];
    return {
      total: ps.length,
      filled: ps.reduce((a, p) => a + p.filled, 0),
      open: ps.reduce((a, p) => a + Math.max(p.headcount - p.filled, 0), 0),
      inactive: ps.filter((p) => !p.active).length,
    };
  }, [data]);

  const sort = useTableSort(data?.positions, {
    title: (p) => p.title,
    code: (p) => p.code,
    job: (p) => p.job?.title ?? null,
    unit: (p) => p.orgUnit?.name ?? null,
    grade: (p) => p.grade?.code ?? null,
    occupancy: (p) => (p.headcount ? p.filled / p.headcount : 0),
    holder: (p) => p.employees[0]?.fullName ?? null,
    status: (p) => (p.active ? 0 : 1),
  }, { defaultKey: "title", defaultDir: "asc" });

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Daftar Posisi")}
        description={t("{total} posisi · {filled} terisi · {open} lowongan", "{total} positions · {filled} filled · {open} open", { total: stats.total, filled: stats.filled, open: stats.open })}
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Posisi Baru")}
          </Button>
        }
      />

      {/* mini stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={t("Total Posisi", "Total Positions")} value={stats.total} icon={BriefcaseBusiness} />
        <MiniStat label={t("Terisi", "Filled")} value={stats.filled} icon={Users} />
        <MiniStat label={t("Lowongan", "Vacancies")} value={stats.open} icon={Layers} />
        <MiniStat label={t("Non-aktif", "Inactive")} value={stats.inactive} icon={ChevronDown} />
      </div>

      {/* toolbar */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Cari kode / judul posisi…", "Search code / position title…")} className="pl-9" />
          </div>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-full sm:w-52"><ChevronDown className="mr-1 h-3.5 w-3.5 text-stone-400" /><SelectValue placeholder={t("Semua unit", "All units")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua unit", "All units")}</SelectItem>
              {(units.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder={t("Semua grade", "All grades")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua grade", "All grades")}</SelectItem>
              {(grades.data?.grades ?? []).map((g) => <SelectItem key={g.id} value={g.id}>Grade {g.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* table */}
      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : data && data.positions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    {sort.head("title", t("Posisi"), "min-w-40 text-[11px] font-bold")}
                    {sort.head("job", "Job", "text-[11px] font-bold")}
                    {sort.head("unit", t("Unit Organisasi"), "text-[11px] font-bold")}
                    {sort.head("grade", t("Grade"), "text-[11px] font-bold")}
                    {sort.head("occupancy", t("Okupasi", "Occupancy"), "min-w-32 text-[11px] font-bold")}
                    {sort.head("holder", t("Pemegang", "Holder"), "text-[11px] font-bold")}
                    {sort.head("status", t("Status"), "text-[11px] font-bold")}
                    <TableHead className="w-20 text-[11px] font-bold">{t("Aksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sort.sorted.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => setSelected(p)}>
                      <TableCell>
                        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-200">{p.title}</p>
                        <p className="font-mono text-[10px] text-stone-400">{p.code}</p>
                      </TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-400">{p.job?.title ?? "—"}</TableCell>
                      <TableCell className="text-xs text-stone-600 dark:text-stone-400">{p.orgUnit?.name ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px] font-bold">{p.grade?.code ?? "—"}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={p.headcount ? (p.filled / p.headcount) * 100 : 0} className="h-1.5 w-16 [&>div]:ov-bar" />
                          <span className="text-[10px] font-bold text-stone-500">{p.filled}/{p.headcount}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.employees[0] ? (
                          <div className="flex items-center gap-1.5">
                            <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-extrabold", avatarColor(p.employees[0].fullName))}>{initials(p.employees[0].fullName)}</span>
                            <span className="max-w-28 truncate text-[11px] font-semibold">{p.employees[0].fullName}</span>
                          </div>
                        ) : <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">{t("Lowong", "Vacant")}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold", p.active ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85" : "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500")}>
                          {p.active ? t("Aktif") : t("Non-aktif", "Inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(p); setDialogOpen(true); }} aria-label={t("Ubah posisi {t}", "Edit position {t}", { t: p.title })} title={t("Ubah posisi", "Edit position")}>
                            <Pencil className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-rose-600" onClick={() => setDeleting(p)} aria-label={t("Hapus posisi {t}", "Delete position {t}", { t: p.title })} title={t("Hapus posisi", "Delete position")}>
                            <Trash2 className="h-3.5 w-3.5 text-stone-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title={t("Tidak ada posisi", "No positions")} description={t("Sesuaikan filter pencarian atau buat posisi baru.", "Adjust the search filter or create a new position.")} icon={<BriefcaseBusiness className="h-6 w-6" />} /></div>
          )}
        </CardContent>
      </Card>

      {/* detail sheet */}
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader className="border-b border-stone-100 ov-soft p-6 dark:border-stone-800">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{selected.code}</Badge>
                  {selected.grade && <Badge className="text-[10px]">G {selected.grade.code}</Badge>}
                </div>
                <SheetTitle className="text-lg">{selected.title}</SheetTitle>
                <p className="text-xs text-stone-500">{selected.job?.title} · {selected.orgUnit?.name}</p>
                <Button variant="outline" size="sm" className="mt-3 w-fit gap-2 font-bold" onClick={() => { setEditing(selected); setSelected(null); setDialogOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" /> {t("Ubah Posisi Ini", "Edit This Position")}
                </Button>
              </SheetHeader>
              <div className="space-y-5 p-6">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-brand">{selected.filled}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">{t("Terisi", "Filled")}</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-amber-600">{Math.max(selected.headcount - selected.filled, 0)}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">{t("Lowongan", "Vacancies")}</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-stone-700 dark:text-stone-300">{selected.directReportCount}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">{t("Bawahan", "Reports")}</p>
                  </div>
                </div>
                <InfoGrid items={[
                  [t("Level"), selected.level ?? "—"],
                  [t("Unit Organisasi"), selected.orgUnit?.name ?? "—"],
                  ["Job", selected.job?.title ?? "—"],
                  [t("Grade"), selected.grade ? `${selected.grade.code} — ${selected.grade.name}` : "—"],
                  [t("Melapor ke", "Reports to"), selected.reportsTo?.title ?? "—"],
                  [t("Status"), selected.active ? t("Aktif") : t("Non-aktif", "Inactive")],
                ]} />
                {selected.employees.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">{t("Pemegang Posisi", "Position Holder")}</p>
                    <div className="space-y-2">
                      {selected.employees.map((e) => (
                        <button key={e.id} onClick={() => { setSelected(null); navigate("employee", "detail", { id: e.id }); }} className="flex w-full items-center gap-3 rounded-xl border border-stone-100 p-3 text-left transition hover:ov-border-accent hover:ov-soft dark:border-stone-800">
                          <span className={cn("flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-extrabold", avatarColor(e.fullName))}>{initials(e.fullName)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold">{e.fullName}</p>
                            <p className="font-mono text-[10px] text-stone-400">{e.employeeNo}</p>
                          </div>
                          <ChevronDown className="h-4 w-4 -rotate-90 text-stone-300" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <PositionDialog open={dialogOpen} setOpen={setDialogOpen} position={editing} units={units.data?.units ?? []} jobs={[]} grades={grades.data?.grades ?? []} positions={data?.positions ?? []} onSaved={refresh} />

      {/* konfirmasi hapus posisi */}
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus posisi {t}?", "Delete position {t}?", { t: deleting?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Tindakan ini permanen. Posisi yang masih dipegang karyawan atau menjadi atasan posisi lain tidak dapat dihapus.", "This action is permanent. Positions still held by employees or referenced as a supervisor of other positions cannot be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction disabled={busyDelete} className="bg-rose-600 hover:bg-rose-700" onClick={async (e) => {
              e.preventDefault();
              if (!deleting) return;
              setBusyDelete(true);
              try {
                await apiSend(`/api/onevity/positions?id=${encodeURIComponent(deleting.id)}`, "DELETE");
                toast.success(t("Posisi {t} dihapus", "Position {t} deleted", { t: deleting.title }));
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

function InfoGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{k}</p>
          <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-200">{v}</p>
        </div>
      ))}
    </div>
  );
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ov-tile">
          <Icon className="h-4.5 w-4.5 h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
          <p className="text-lg font-extrabold text-stone-900 dark:text-stone-50">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PositionDialog({ open, setOpen, position, units, jobs, grades, positions, onSaved }: {
  open: boolean; setOpen: (v: boolean) => void; position: Position | null; units: UnitOpt[]; jobs: JobOpt[]; grades: GradeOpt[];
  positions: Position[]; onSaved: () => void;
}) {
  const jobsApi = useApi<{ jobs: JobOpt[] }>("/api/onevity/jobs");
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [jobId, setJobId] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [reportsToId, setReportsToId] = useState("");
  const [busy, setBusy] = useState(false);

  // sinkronkan form saat dialog dibuka (mode baru / mode ubah)
  useEffect(() => {
    if (!open) return;
    setCode(position?.code ?? "");
    setTitle(position?.title ?? "");
    setJobId("");
    setOrgUnitId("");
    setGradeId("");
    setHeadcount(String(position?.headcount ?? 1));
    setReportsToId("");
  }, [open, position]);

  const submit = async () => {
    if (!code.trim() || !title.trim()) { toast.error(t("Kode dan judul wajib diisi", "Code and title are required")); return; }
    setBusy(true);
    try {
      if (position) {
        await apiSend("/api/onevity/positions", "PATCH", {
          id: position.id, title: title.trim(),
          jobId: jobId || null, orgUnitId: orgUnitId || null, gradeId: gradeId || null,
          headcount: Number(headcount) || 1, reportsToId: reportsToId || null, active: position.active,
        });
        toast.success(t("Posisi {title} diperbarui", "Position {title} updated", { title }));
      } else {
        await apiSend("/api/onevity/positions", "POST", {
          code: code.trim().toUpperCase(), title: title.trim(),
          jobId: jobId || null, orgUnitId: orgUnitId || null, gradeId: gradeId || null,
          headcount: Number(headcount) || 1, reportsToId: reportsToId || null,
        });
        toast.success(t("Posisi {title} berhasil dibuat", "Position {title} created successfully", { title }));
      }
      setOpen(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  void jobs; void positions;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-4 w-4 ov-text-accent" /> {position ? t("Ubah Posisi", "Edit Position") : t("Posisi Baru")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">{t("Kode *", "Code *")}</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P-QAS2" disabled={!!position} className="mt-1 font-mono uppercase disabled:opacity-60" />
            {position && <p className="mt-1 text-[10px] text-stone-400">{t("Kode tidak dapat diubah setelah posisi dibuat.", "The code cannot be changed after the position is created.")}</p>}
          </div>
          <div>
            <Label className="text-xs">{t("Judul *", "Title *")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="QA Staff II" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Job</Label>
            <Select value={jobId || "none"} onValueChange={(v) => setJobId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih job", "Select a job")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tidak ada —", "— None —")}</SelectItem>
                {(jobsApi.data?.jobs ?? []).filter((j) => j.active).map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Unit Organisasi")}</Label>
            <Select value={orgUnitId || "none"} onValueChange={(v) => setOrgUnitId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih unit", "Select a unit")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tidak ada —", "— None —")}</SelectItem>
                {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Grade")}</Label>
            <Select value={gradeId || "none"} onValueChange={(v) => setGradeId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih grade", "Select a grade")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tidak ada —", "— None —")}</SelectItem>
                {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Headcount</Label>
            <Input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">{t("Melapor ke (posisi atasan)", "Reports to (supervisor position)")}</Label>
            <Select value={reportsToId || "none"} onValueChange={(v) => setReportsToId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t("Pilih posisi atasan", "Select a supervisor position")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("— Tanpa atasan —", "— No supervisor —")}</SelectItem>
                {positions.filter((p) => p.active && p.id !== position?.id).map((p) => <SelectItem key={p.id} value={p.id}>{p.title} ({p.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : position ? t("Simpan Perubahan", "Save Changes") : t("Simpan Posisi", "Save Position")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= JOB LIBRARY =================
function JobLibrary() {
  const { data, loading, refresh } = useApi<{ jobs: JobOpt[] }>("/api/onevity/jobs");
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<JobOpt | null>(null);

  const categoryIcon: Record<string, React.ElementType> = {
    Executive: TrendingUp, Managerial: Users, Supervisory: Layers, Staff: FileText,
  };
  const catTone: Record<string, string> = {
    Executive: "from-brand to-brand", Managerial: "from-brand to-brand",
    Supervisory: "from-amber-400 to-orange-500", Staff: "from-stone-400 to-stone-600",
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Katalog Jabatan")}
        description={t("{n} job master di kategori Executive, Managerial, Supervisory, dan Staff", "{n} master jobs in the Executive, Managerial, Supervisory, and Staff categories", { n: data?.jobs.length ?? 0 })}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Job Baru", "New Job")}
          </Button>
        }
      />
      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.jobs ?? []).map((j) => {
            const Icon = categoryIcon[j.category ?? "Staff"] ?? FileText;
            return (
              <Card key={j.id} className="group rounded-2xl border-stone-200/80 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md", catTone[j.category ?? "Staff"] ?? catTone.Staff)}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditing(j)} className="rounded-lg p-1.5 text-stone-400 opacity-0 transition group-hover:opacity-100 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label="Edit job">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-3 text-[15px] font-bold text-stone-900 dark:text-stone-100">{j.title}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{j.code}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{j.category ?? "Staff"}</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
                    <span className="text-[11px] text-stone-400">{t("Dipakai oleh", "Used by")}</span>
                    <span className="text-[11px] font-bold ov-text-accent">{t("{n} posisi", "{n} positions", { n: j.positionCount })}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <JobDialog open={createOpen} setOpen={(v) => { setCreateOpen(v); if (!v) refresh(); }} job={null} />
      <JobDialog open={!!editing} setOpen={(v) => { if (!v) { setEditing(null); refresh(); } }} job={editing} />
    </div>
  );
}

function JobDialog({ open, setOpen, job }: { open: boolean; setOpen: (v: boolean) => void; job: JobOpt | null }) {
  const { t } = useI18n();
  const [code, setCode] = useState(job?.code ?? "");
  const [title, setTitle] = useState(job?.title ?? "");
  const [category, setCategory] = useState(job?.category ?? "Staff");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  // sync when job changes
  const jobKey = job?.id ?? "new";
  if (key !== jobKey) {
    setKey(jobKey);
    setCode(job?.code ?? ""); setTitle(job?.title ?? ""); setCategory(job?.category ?? "Staff"); setDescription("");
  }

  const submit = async () => {
    if (!code.trim() || !title.trim()) { toast.error(t("Kode dan judul wajib diisi", "Code and title are required")); return; }
    setBusy(true);
    try {
      if (job) {
        await apiSend("/api/onevity/jobs", "PATCH", { id: job.id, title, category, description });
        toast.success(t("Job diperbarui", "Job updated"));
      } else {
        await apiSend("/api/onevity/jobs", "POST", { code: code.trim().toUpperCase(), title, category, description });
        toast.success(t("Job dibuat", "Job created"));
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="text-base">{job ? "Edit Job" : t("Job Baru", "New Job")}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          {!job && (
            <div>
              <Label className="text-xs">{t("Kode *", "Code *")}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="J-QAS2" className="mt-1 font-mono uppercase" />
            </div>
          )}
          <div>
            <Label className="text-xs">{t("Judul *", "Title *")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">{t("Kategori", "Category")}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Executive", "Managerial", "Supervisory", "Staff"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Deskripsi", "Description")}</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Tanggung jawab utama…", "Main responsibilities…")} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= GRADES =================
function GradeList() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ grades: GradeOpt[] }>("/api/onevity/grades");
  const maxSalary = Math.max(...(data?.grades ?? []).map((g) => g.maxSalary), 1);

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Grade & Level")}
        description={t("Struktur grade gaji G1–G8 beserta rentang minimum dan maksimum", "Salary grade structure G1–G8 with minimum and maximum ranges")}
      />
      {loading && !data ? (
        <LoadingRows rows={6} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(data?.grades ?? []).map((g) => {
            const pctMin = (g.minSalary / maxSalary) * 100;
            const pctMax = (g.maxSalary / maxSalary) * 100;
            return (
              <Card key={g.id} className="rounded-2xl border-stone-200/80 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-stone-800">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl ov-tile text-sm font-extrabold shadow-md">
                      {g.code}
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{g.name}</Badge>
                  </div>
                  <div className="mt-4 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-stone-400">Min</span>
                      <span className="font-bold text-stone-700 dark:text-stone-300">{fmtIDR(g.minSalary)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-stone-400">Max</span>
                      <span className="font-bold text-stone-700 dark:text-stone-300">{fmtIDR(g.maxSalary)}</span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className="absolute h-full rounded-full ov-chart"
                        style={{ left: `${pctMin}%`, width: `${Math.max(pctMax - pctMin, 2)}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-dashed border-stone-100 pt-3 dark:border-stone-800">
                    <div className="text-center">
                      <p className="text-base font-extrabold text-stone-900 dark:text-stone-50">{g.employeeCount}</p>
                      <p className="text-[9px] font-bold uppercase text-stone-400">{t("Karyawan")}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-extrabold text-stone-900 dark:text-stone-50">{g.positionCount}</p>
                      <p className="text-[9px] font-bold uppercase text-stone-400">{t("Posisi")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <GradeStats grades={data?.grades ?? []} />
    </div>
  );
}

function GradeStats({ grades }: { grades: GradeOpt[] }) {
  const { t } = useI18n();
  if (grades.length === 0) return null;
  const totalEmp = grades.reduce((a, g) => a + g.employeeCount, 0);
  const top = grades.filter((g) => g.employeeCount > 0).sort((a, b) => b.employeeCount - a.employeeCount)[0];
  return (
    <Card className="mt-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl ov-tile">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Grade Terpadat", "Densest Grade")}</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{top ? t("{code} — {n} karyawan", "{code} — {n} employees", { code: top.code, n: top.employeeCount }) : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Total Karyawan Ter-graded", "Total Graded Employees")}</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{t("{n} dari grade G1–G{m}", "{n} across grades G1–G{m}", { n: totalEmp, m: grades.length })}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
