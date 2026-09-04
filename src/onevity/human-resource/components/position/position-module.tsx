"use client";
// OneVity — Modul Posisi & Grading: list, job library, grades
import { useMemo, useState } from "react";
import { useApi, apiSend, fmtIDR, initials, avatarColor } from "@/onevity/shared/lib/api";
import { useNav } from "@/onevity/shared/lib/store";
import { PageHeader, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  BriefcaseBusiness, FileText, GraduationCap, Plus, Search, Pencil, Users,
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
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("all");
  const [grade, setGrade] = useState("all");
  const [selected, setSelected] = useState<Position | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Daftar Posisi"
        description={`${stats.total} posisi · ${stats.filled} terisi · ${stats.open} lowongan`}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> Posisi Baru
          </Button>
        }
      />

      {/* mini stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Total Posisi" value={stats.total} icon={BriefcaseBusiness} />
        <MiniStat label="Terisi" value={stats.filled} icon={Users} />
        <MiniStat label="Lowongan" value={stats.open} icon={Layers} />
        <MiniStat label="Non-aktif" value={stats.inactive} icon={ChevronDown} />
      </div>

      {/* toolbar */}
      <Card className="mb-4 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="flex flex-wrap items-center gap-2.5 p-3.5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari kode / judul posisi…" className="pl-9" />
          </div>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="w-full sm:w-52"><ChevronDown className="mr-1 h-3.5 w-3.5 text-stone-400" /><SelectValue placeholder="Semua unit" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua unit</SelectItem>
              {(units.data?.units ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={grade} onValueChange={setGrade}>
            <SelectTrigger className="w-full sm:w-36"><SelectValue placeholder="Semua grade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua grade</SelectItem>
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
                    <TableHead className="min-w-40 text-[11px] font-bold">Posisi</TableHead>
                    <TableHead className="text-[11px] font-bold">Job</TableHead>
                    <TableHead className="text-[11px] font-bold">Unit Organisasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Grade</TableHead>
                    <TableHead className="min-w-32 text-[11px] font-bold">Okupasi</TableHead>
                    <TableHead className="text-[11px] font-bold">Pemegang</TableHead>
                    <TableHead className="text-[11px] font-bold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.positions.map((p) => (
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
                        ) : <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Lowong</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold", p.active ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400" : "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-500")}>
                          {p.active ? "Aktif" : "Non-aktif"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title="Tidak ada posisi" description="Sesuaikan filter pencarian atau buat posisi baru." icon={<BriefcaseBusiness className="h-6 w-6" />} /></div>
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
              </SheetHeader>
              <div className="space-y-5 p-6">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-emerald-600">{selected.filled}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">Terisi</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-amber-600">{Math.max(selected.headcount - selected.filled, 0)}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">Lowongan</p>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 text-center dark:bg-stone-900">
                    <p className="text-lg font-extrabold text-stone-700 dark:text-stone-300">{selected.directReportCount}</p>
                    <p className="text-[9px] font-bold uppercase text-stone-400">Bawahan</p>
                  </div>
                </div>
                <InfoGrid items={[
                  ["Level", selected.level ?? "—"],
                  ["Unit Organisasi", selected.orgUnit?.name ?? "—"],
                  ["Job", selected.job?.title ?? "—"],
                  ["Grade", selected.grade ? `${selected.grade.code} — ${selected.grade.name}` : "—"],
                  ["Melapor ke", selected.reportsTo?.title ?? "—"],
                  ["Status", selected.active ? "Aktif" : "Non-aktif"],
                ]} />
                {selected.employees.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">Pemegang Posisi</p>
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

      <PositionDialog open={createOpen} setOpen={setCreateOpen} units={units.data?.units ?? []} jobs={[]} grades={grades.data?.grades ?? []} positions={data?.positions ?? []} onSaved={refresh} />
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

function PositionDialog({ open, setOpen, units, jobs, grades, positions, onSaved }: {
  open: boolean; setOpen: (v: boolean) => void; units: UnitOpt[]; jobs: JobOpt[]; grades: GradeOpt[];
  positions: Position[]; onSaved: () => void;
}) {
  const jobsApi = useApi<{ jobs: JobOpt[] }>("/api/onevity/jobs");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [jobId, setJobId] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [reportsToId, setReportsToId] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!code.trim() || !title.trim()) { toast.error("Kode dan judul wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/positions", "POST", {
        code: code.trim().toUpperCase(), title: title.trim(),
        jobId: jobId || null, orgUnitId: orgUnitId || null, gradeId: gradeId || null,
        headcount: Number(headcount) || 1, reportsToId: reportsToId || null,
      });
      toast.success(`Posisi ${title} berhasil dibuat`);
      setOpen(false); setCode(""); setTitle(""); setJobId(""); setOrgUnitId(""); setGradeId(""); setHeadcount("1"); setReportsToId("");
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  void jobs; void positions;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="h-4 w-4 ov-text-accent" /> Posisi Baru</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Kode *</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P-QAS2" className="mt-1 font-mono uppercase" />
          </div>
          <div>
            <Label className="text-xs">Judul *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="QA Staff II" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Job</Label>
            <Select value={jobId || "none"} onValueChange={(v) => setJobId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih job" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak ada —</SelectItem>
                {(jobsApi.data?.jobs ?? []).filter((j) => j.active).map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Unit Organisasi</Label>
            <Select value={orgUnitId || "none"} onValueChange={(v) => setOrgUnitId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih unit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak ada —</SelectItem>
                {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Grade</Label>
            <Select value={gradeId || "none"} onValueChange={(v) => setGradeId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih grade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tidak ada —</SelectItem>
                {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Headcount</Label>
            <Input type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} className="mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Melapor ke (posisi atasan)</Label>
            <Select value={reportsToId || "none"} onValueChange={(v) => setReportsToId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Pilih posisi atasan" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tanpa atasan —</SelectItem>
                {positions.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.title} ({p.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? "Menyimpan…" : "Simpan Posisi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= JOB LIBRARY =================
function JobLibrary() {
  const { data, loading, refresh } = useApi<{ jobs: JobOpt[] }>("/api/onevity/jobs");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<JobOpt | null>(null);

  const categoryIcon: Record<string, React.ElementType> = {
    Executive: TrendingUp, Managerial: Users, Supervisory: Layers, Staff: FileText,
  };
  const catTone: Record<string, string> = {
    Executive: "from-emerald-500 to-teal-600", Managerial: "from-teal-500 to-emerald-600",
    Supervisory: "from-amber-400 to-orange-500", Staff: "from-stone-400 to-stone-600",
  };

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Katalog Jabatan"
        description={`${data?.jobs.length ?? 0} job master di kategori Executive, Managerial, Supervisory, dan Staff`}
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> Job Baru
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
                    <span className="text-[11px] text-stone-400">Dipakai oleh</span>
                    <span className="text-[11px] font-bold ov-text-accent">{j.positionCount} posisi</span>
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
    if (!code.trim() || !title.trim()) { toast.error("Kode dan judul wajib diisi"); return; }
    setBusy(true);
    try {
      if (job) {
        await apiSend("/api/onevity/jobs", "PATCH", { id: job.id, title, category, description });
        toast.success("Job diperbarui");
      } else {
        await apiSend("/api/onevity/jobs", "POST", { code: code.trim().toUpperCase(), title, category, description });
        toast.success("Job dibuat");
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">{job ? "Edit Job" : "Job Baru"}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          {!job && (
            <div>
              <Label className="text-xs">Kode *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="J-QAS2" className="mt-1 font-mono uppercase" />
            </div>
          )}
          <div>
            <Label className="text-xs">Judul *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Kategori</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Executive", "Managerial", "Supervisory", "Staff"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Deskripsi</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tanggung jawab utama…" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= GRADES =================
function GradeList() {
  const { data, loading, refresh } = useApi<{ grades: GradeOpt[] }>("/api/onevity/grades");
  const maxSalary = Math.max(...(data?.grades ?? []).map((g) => g.maxSalary), 1);

  return (
    <div>
      <PageHeader
        eyebrow="POSISI & JABATAN"
        title="Grade & Level"
        description="Struktur grade gaji G1–G8 beserta rentang minimum dan maksimum"
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
                      <p className="text-[9px] font-bold uppercase text-stone-400">Karyawan</p>
                    </div>
                    <div className="text-center">
                      <p className="text-base font-extrabold text-stone-900 dark:text-stone-50">{g.positionCount}</p>
                      <p className="text-[9px] font-bold uppercase text-stone-400">Posisi</p>
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Grade Terpadat</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{top ? `${top.code} — ${top.employeeCount} karyawan` : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">Total Karyawan Ter-graded</p>
            <p className="text-sm font-extrabold text-stone-900 dark:text-stone-100">{totalEmp} dari grade G1–G{grades.length}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
