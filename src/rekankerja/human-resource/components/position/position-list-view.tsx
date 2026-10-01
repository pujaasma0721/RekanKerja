"use client";
// RekanKerja — POSISI › Daftar Posisi: advanced table + filters + detail sheet + CRUD
import { useEffect, useMemo, useState } from "react";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useApi, apiSend, initials, avatarColor, fmtIDR, fmtDate } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Plus, RefreshCw, Search, Pencil, Trash2, ChevronRight, BriefcaseBusiness, Building2, GraduationCap,
  FileText, GitBranch, Users, UserRound, Layers, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GradeRow, GradesRes, JobRow, JobsRes, OrgUnitsLiteRes, PositionRow, PositionsRes } from "./types";

// active employees holding a position
function activeCount(p: PositionRow): number {
  return p.employees.filter((e) => e.status === "Active").length;
}

// ============ Position form dialog (create / edit) ============
function PositionFormDialog({
  open, onOpenChange, mode, position, jobs, grades, units, positions, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  position: PositionRow | null;
  jobs: JobRow[];
  grades: GradeRow[];
  units: { id: string; code: string; name: string; level: number }[];
  positions: PositionRow[];
  onDone: (id?: string) => void;
}) {
  const [form, setForm] = useState({
    code: "", title: "", jobId: "none", orgUnitId: "none", gradeId: "none", level: "", headcount: "1", reportsToId: "none",
  });
  const [saving, setSaving] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    setForm({
      code: mode === "edit" ? (position?.code ?? "") : "",
      title: mode === "edit" ? (position?.title ?? "") : "",
      jobId: mode === "edit" ? (position?.jobId ?? "none") : "none",
      orgUnitId: mode === "edit" ? (position?.orgUnitId ?? "none") : "none",
      gradeId: mode === "edit" ? (position?.gradeId ?? "none") : "none",
      level: mode === "edit" ? (position?.level ?? "") : "",
      headcount: mode === "edit" ? String(position?.headcount ?? 1) : "1",
      reportsToId: mode === "edit" ? (position?.reportsToId ?? "none") : "none",
    });
  }, [open, mode, position]);

  const submit = async () => {
    if (!form.code.trim() || !form.title.trim()) { toast.error(t("Kode dan nama posisi wajib diisi", "Code and position name are required")); return; }
    if (Number(form.headcount) < 1) { toast.error(t("Headcount minimal 1", "Headcount must be at least 1")); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(),
        title: form.title.trim(),
        jobId: form.jobId === "none" ? null : form.jobId,
        orgUnitId: form.orgUnitId === "none" ? null : form.orgUnitId,
        gradeId: form.gradeId === "none" ? null : form.gradeId,
        level: form.level.trim() || null,
        headcount: Number(form.headcount) || 1,
        reportsToId: form.reportsToId === "none" ? null : form.reportsToId,
      };
      if (mode === "create") {
        const res = await apiSend<{ position: PositionRow }>("/api/rekankerja/positions", "POST", payload);
        toast.success(t('Posisi "{title}" berhasil dibuat', 'Position "{title}" created successfully', { title: res.position.title }));
        onDone(res.position.id);
      } else if (position) {
        await apiSend("/api/rekankerja/positions", "PATCH", { id: position.id, ...payload });
        toast.success(t("Posisi berhasil diperbarui", "Position updated successfully"));
        onDone();
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan posisi", "Failed to save position"));
    } finally {
      setSaving(false);
    }
  };

  const reportOptions = positions.filter((p) => p.id !== position?.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? t("Posisi Baru") : t("Ubah Posisi", "Edit Position")}</DialogTitle>
          <DialogDescription>
            {mode === "create" ? t("Definisikan posisi baru beserta job, unit, grade, dan garis pelaporannya.", "Define a new position with its job, unit, grade, and reporting line.") : t("Perbarui data posisi {code}.", "Update data for position {code}.", { code: position?.code ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="p-code">{t("Kode Posisi", "Position Code")}</Label>
            <Input id="p-code" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="P-HRM" className="font-mono text-xs uppercase" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-headcount">Headcount</Label>
            <Input id="p-headcount" type="number" min={1} value={form.headcount} onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="p-title">{t("Nama / Judul Posisi", "Name / Position Title")}</Label>
            <Input id="p-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="HR Manager" />
          </div>
          <div className="grid gap-1.5">
            <Label>Job</Label>
            <Select value={form.jobId} onValueChange={(v) => setForm((f) => ({ ...f, jobId: v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih job", "Select a job")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("— Tanpa job —", "— No job —")}</SelectItem>
                {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.code} — {j.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Unit Organisasi")}</Label>
            <Select value={form.orgUnitId} onValueChange={(v) => setForm((f) => ({ ...f, orgUnitId: v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih unit", "Select a unit")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("— Tanpa unit —", "— No unit —")}</SelectItem>
                {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("Grade")}</Label>
            <Select value={form.gradeId} onValueChange={(v) => {
              const g = grades.find((x) => x.id === v);
              setForm((f) => ({ ...f, gradeId: v, level: v === "none" ? f.level : (g?.code ?? f.level) }));
            }}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih grade", "Select a grade")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("— Tanpa grade —", "— No grade —")}</SelectItem>
                {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-level">{t("Level")}</Label>
            <Input id="p-level" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))} placeholder="G5" className="uppercase" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{t("Lapor Kepada (Reports To)", "Reports To")}</Label>
            <Select value={form.reportsToId} onValueChange={(v) => setForm((f) => ({ ...f, reportsToId: v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t("Pilih posisi atasan", "Select a supervisor position")} /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="none">{t("— Tanpa atasan —", "— No supervisor —")}</SelectItem>
                {reportOptions.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={saving}>{saving ? t("Menyimpan…") : mode === "create" ? t("Buat Posisi", "Create Position") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============ Detail sheet ============
function PositionDetailSheet({
  position, open, onOpenChange, positions, onRefresh, onEdit, onDeleted, onSelectPosition,
}: {
  position: PositionRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  positions: PositionRow[];
  onRefresh: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onSelectPosition: (id: string) => void;
}) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (!position) return null;
  const act = activeCount(position);
  const pct = position.headcount > 0 ? Math.min(100, Math.round((act / position.headcount) * 100)) : 0;
  const directReports = positions.filter((p) => p.reportsToId === position.id);
  const holders = position.employees;

  const toggleActive = async () => {
    setToggling(true);
    try {
      await apiSend("/api/rekankerja/positions", "PATCH", { id: position.id, active: !position.active });
      toast.success(position.active ? t("Posisi {code} dinonaktifkan", "Position {code} deactivated", { code: position.code }) : t("Posisi {code} diaktifkan kembali", "Position {code} reactivated", { code: position.code }));
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah status posisi", "Failed to change position status"));
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiSend(`/api/rekankerja/positions?id=${encodeURIComponent(position.id)}`, "DELETE");
      toast.success(t('Posisi "{title}" dihapus', 'Position "{title}" deleted', { title: position.title }));
      setDeleteOpen(false);
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus posisi", "Failed to delete position"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="space-y-0 border-b border-slate-200/80 ov-soft px-5 py-5 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-[10px]">{position.code}</Badge>
                {position.grade && <Badge className="bg-slate-100 text-[10px] font-bold text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300">{position.grade.code}</Badge>}
                <StatusPill status={position.active ? "Active" : "Cancelled"} />
              </div>
              <SheetTitle className="text-lg font-bold leading-tight">{position.title}</SheetTitle>
              <SheetDescription className="mt-1 text-xs">
                {position.job ? `${position.job.title} · ` : ""}{position.orgUnit?.name ?? t("Tanpa unit", "No unit")}
              </SheetDescription>
            </div>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ov-tile">
              <BriefcaseBusiness className="h-5 w-5" />
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-5 py-5">
          {/* headcount */}
          <div className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-800">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                <Users className="h-4 w-4 ov-text-accent" /> {t("Okupansi Posisi", "Position Occupancy")}
              </p>
              <p className="text-sm font-bold tabular-nums ov-text-accent">{act} / {position.headcount}</p>
            </div>
            <Progress value={pct} className="h-2.5 [&>div]:ov-chart" />
            <p className="mt-2 text-[11px] text-slate-500">{position.headcount > 0 ? t("Terisi {pct}% dari kuota headcount.", "Filled {pct}% of headcount quota.", { pct }) : t("Headcount belum ditetapkan.", "Headcount not set yet.")}</p>
          </div>

          {/* info grid */}
          <div className="grid grid-cols-2 gap-3">
            <SheetTile icon={FileText} label="Job" value={position.job ? `${position.job.code} — ${position.job.title}` : "—"} />
            <SheetTile icon={Building2} label={t("Unit Organisasi")} value={position.orgUnit?.name ?? "—"} />
            <SheetTile icon={GraduationCap} label={t("Grade")} value={position.grade ? `${position.grade.code} — ${position.grade.name}` : "—"} />
            <SheetTile icon={Layers} label={t("Level")} value={position.level ?? "—"} />
            <SheetTile icon={Wallet} label={t("Rentang Gaji Grade", "Grade Salary Range")} value={position.grade ? `${fmtIDR(position.grade.minSalary)} – ${fmtIDR(position.grade.maxSalary)}` : "—"} className="col-span-2" />
            <SheetTile icon={GitBranch} label={t("Lapor Kepada", "Reports To")} value={position.reportsTo ? `${position.reportsTo.code} — ${position.reportsTo.title}` : "—"} className="col-span-2" />
            <SheetTile icon={Layers} label={t("Dibuat", "Created")} value={fmtDate(position.createdAt)} />
            <SheetTile icon={Users} label={t("Total Karyawan", "Total Employees")} value={t("{n} orang", "{n} people", { n: holders.length })} />
          </div>

          {/* direct reports */}
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <GitBranch className="h-3.5 w-3.5" /> {t("Bawahan Langsung ({n})", "Direct Reports ({n})", { n: directReports.length })}
            </p>
            {directReports.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400 dark:border-slate-800">{t("Tidak ada posisi yang melapor ke sini.", "No positions report to this one.")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {directReports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onSelectPosition(r.id)}
                    className="flex min-h-9 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:ov-border-accent hover:ov-text-accent dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                    title={`${r.code} — ${r.title}`}
                  >
                    <span className="font-mono text-[9px] text-slate-400">{r.code}</span> {r.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* employees holding */}
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <UserRound className="h-3.5 w-3.5" /> {t("Karyawan Pemegang Posisi ({n})", "Employees Holding the Position ({n})", { n: holders.length })}
            </p>
            {holders.length === 0 ? (
              <EmptyState title={t("Belum ada pemegang", "No holder yet")} description={t("Posisi ini belum dipegang karyawan mana pun.", "No employee holds this position yet.")} />
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {holders.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => navigate("employee", "detail", { id: e.id })}
                    className="flex w-full min-h-11 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
                  >
                    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", avatarColor(e.fullName))}>
                      {initials(e.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{e.fullName}</span>
                      <span className="block font-mono text-[10px] text-slate-500">{e.employeeNo}</span>
                    </span>
                    <StatusPill status={e.status} />
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* footer actions */}
        <div className="mt-auto space-y-3 border-t border-slate-200/80 bg-slate-50/70 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{t("Status Posisi", "Position Status")}</p>
              <p className="text-[11px] text-slate-500">{position.active ? t("Aktif — dapat dipegang karyawan", "Active — can be held by employees") : t("Nonaktif — tidak tersedia untuk karyawan", "Inactive — not available to employees")}</p>
            </div>
            <Switch checked={position.active} onCheckedChange={toggleActive} disabled={toggling} aria-label={t("Aktifkan posisi", "Activate position")} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 flex-1 gap-1.5" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> {t("Ubah Posisi", "Edit Position")}
            </Button>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="h-10 gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                  <Trash2 className="h-3.5 w-3.5" /> {t("Hapus")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Hapus posisi “{title}”?", "Delete position “{title}”?", { title: position.title })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("Tindakan ini permanen. Posisi yang masih dipegang karyawan tidak dapat dihapus. Posisi bawahan yang melapor ke posisi ini akan kehilangan atasan.", "This action is permanent. Positions still held by employees cannot be deleted. Positions reporting to this one will lose their supervisor.")}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SheetTile({ icon: Icon, label, value, className }: { icon: React.ElementType; label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl bg-slate-50/80 p-3 dark:bg-slate-900/40", className)}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200" title={value}>{value}</p>
      </div>
    </div>
  );
}

// ============ Main view ============
export function PositionListView() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [unitFilter, setUnitFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (unitFilter !== "all") p.set("orgUnitId", unitFilter);
    if (gradeFilter !== "all") p.set("gradeId", gradeFilter);
    if (statusFilter !== "all") p.set("active", statusFilter);
    p.set("limit", "300");
    return `/api/rekankerja/positions?${p.toString()}`;
  }, [q, unitFilter, gradeFilter, statusFilter]);

  const positionsApi = useApi<PositionsRes>(url);
  const unitsApi = useApi<OrgUnitsLiteRes>("/api/rekankerja/org-units");
  const gradesApi = useApi<GradesRes>("/api/rekankerja/grades");
  const jobsApi = useApi<JobsRes>("/api/rekankerja/jobs");

  const positions = positionsApi.data?.positions ?? [];
  const units = unitsApi.data?.units ?? [];
  const grades = gradesApi.data?.grades ?? [];
  const jobs = jobsApi.data?.jobs ?? [];

  const selected = positions.find((p) => p.id === sheetId) ?? null;
  const refreshAll = () => { positionsApi.refresh(); };

  return (
    <div>
      <PageHeader
        eyebrow={t("Posisi & Jabatan")}
        title={t("Daftar Posisi")}
        description={t("Seluruh definisi posisi beserta job, unit, grade, okupansi headcount, dan garis pelaporan.", "All position definitions with job, unit, grade, headcount occupancy, and reporting lines.")}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">{t("Muat Ulang")}</span>
            </Button>
            <Button size="sm" className="h-10 px-4 font-bold" onClick={() => { setFormMode("create"); setFormOpen(true); }}>
              <Plus className="h-4 w-4" /> {t("Posisi Baru")}
            </Button>
          </>
        }
      />

      {/* filters */}
      <Card className="mb-4 rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 sm:min-w-56 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Cari kode / judul posisi…", "Search code / position title…")}
              className="h-10 pl-9"
              aria-label={t("Cari posisi", "Search positions")}
            />
          </div>
          <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-10 w-full sm:w-48" aria-label={t("Filter unit organisasi", "Filter organizational units")}>
              <SelectValue placeholder={t("Semua unit", "All units")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Unit", "All Units")}</SelectItem>
              {units.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={gradeFilter} onValueChange={setGradeFilter}>
            <SelectTrigger className="h-10 w-full sm:w-40" aria-label={t("Filter grade", "Filter grades")}>
              <SelectValue placeholder={t("Semua grade", "All grades")} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("Semua Grade", "All Grades")}</SelectItem>
              {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.code} — {g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-10 w-full sm:w-36" aria-label={t("Filter status", "Filter status")}>
              <SelectValue placeholder={t("Semua status", "All statuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
              <SelectItem value="true">{t("Aktif")}</SelectItem>
              <SelectItem value="false">{t("Nonaktif")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {positionsApi.loading ? t("Memuat…") : t("{n} posisi", "{n} positions", { n: positionsApi.data?.total ?? 0 })}
          </span>
        </CardContent>
      </Card>

      {/* table */}
      <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
        <CardContent className="p-0">
          {positionsApi.loading ? (
            <div className="p-4"><LoadingRows rows={8} /></div>
          ) : positionsApi.error ? (
            <div className="p-4"><EmptyState title={t("Gagal memuat", "Failed to load")} description={positionsApi.error} /></div>
          ) : positions.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t("Tidak ada posisi", "No positions")}
                description={t("Coba ubah filter pencarian, atau buat posisi baru dengan tombol Posisi Baru.", "Try changing the search filter, or create a new position with the New Position button.")}
                icon={<BriefcaseBusiness className="h-6 w-6" />}
              />
            </div>
          ) : (
            <div className="max-h-[68vh] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/80 backdrop-blur dark:bg-slate-900/60">
                  <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                    <TableHead className="pl-5 text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Kode")}</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Posisi")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold uppercase tracking-wider text-slate-500 md:table-cell">Job</TableHead>
                    <TableHead className="hidden text-[11px] font-bold uppercase tracking-wider text-slate-500 lg:table-cell">{t("Unit Organisasi")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold uppercase tracking-wider text-slate-500 sm:table-cell">{t("Grade")}</TableHead>
                    <TableHead className="hidden text-[11px] font-bold uppercase tracking-wider text-slate-500 xl:table-cell">{t("Level")}</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Headcount</TableHead>
                    <TableHead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{t("Status")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => {
                    const act = activeCount(p);
                    const pct = p.headcount > 0 ? Math.min(100, Math.round((act / p.headcount) * 100)) : 0;
                    return (
                      <TableRow
                        key={p.id}
                        onClick={() => setSheetId(p.id)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                      >
                        <TableCell className="pl-5 py-3">
                          <Badge variant="outline" className="font-mono text-[10px]">{p.code}</Badge>
                        </TableCell>
                        <TableCell className="py-3">
                          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">{p.title}</p>
                          <p className="text-[11px] text-slate-500">{p.job?.title ?? "—"}</p>
                        </TableCell>
                        <TableCell className="hidden py-3 md:table-cell">
                          <p className="text-xs text-slate-600 dark:text-slate-400">{p.job ? p.job.code : "—"}</p>
                        </TableCell>
                        <TableCell className="hidden max-w-44 py-3 lg:table-cell">
                          <p className="truncate text-xs text-slate-600 dark:text-slate-400">{p.orgUnit?.name ?? "—"}</p>
                        </TableCell>
                        <TableCell className="hidden py-3 sm:table-cell">
                          {p.grade ? (
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{p.grade.code}</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden py-3 xl:table-cell">
                          <span className="text-xs font-medium text-slate-500">{p.level ?? "—"}</span>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex min-w-28 items-center gap-2">
                            <Progress value={pct} className="h-1.5 w-14 shrink-0 [&>div]:ov-bar" />
                            <span className={cn(
                              "text-xs font-semibold tabular-nums",
                              act > p.headcount ? "text-amber-600 dark:text-amber-400" : "text-slate-600 dark:text-slate-300"
                            )}>
                              {act}/{p.headcount}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          {p.active ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("Aktif")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> {t("Nonaktif")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-3 pr-4">
                          <ChevronRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PositionDetailSheet
        position={selected}
        open={sheetId !== null}
        onOpenChange={(v) => { if (!v) setSheetId(null); }}
        positions={positions}
        onRefresh={refreshAll}
        onEdit={() => { setFormMode("edit"); setFormOpen(true); }}
        onDeleted={refreshAll}
        onSelectPosition={(id) => setSheetId(id)}
      />

      <PositionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={formMode}
        position={formMode === "edit" ? selected : null}
        jobs={jobs}
        grades={grades}
        units={units}
        positions={positions}
        onDone={(id) => { refreshAll(); if (id) setSheetId(id); }}
      />
    </div>
  );
}
