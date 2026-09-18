"use client";
// OneVity — Modul Offboarding: proses karyawan keluar (checklist clearance +
// exit interview + pelacakan penyelesaian). Dibuat otomatis saat PA
// Resignation/Termination/Retirement diproses, atau manual dari daftar.
import { useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime, initials, avatarColor, paTypeLabelSafe, tenure } from "@/onevity/shared/lib/api";
import { nextServerSort, ServerSortHead, useTableSort, type ServerSortDir } from "@/onevity/shared/lib/use-table-sort";
import { useNav } from "@/onevity/shared/lib/store";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  LogOut, Plus, CheckCircle2, Ban, ArrowLeft, Trash2, Pencil, Star, FileText,
  Calendar, ClipboardCheck, ChevronRight, MessageSquareText, RotateCcw, Check, Minus,
  Package, PackageCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
// Task 27-b — dialog pengembalian aset dipakai ulang di seksi clearance
import { ReturnDialog } from "@/onevity/human-resource/components/assets/assets-module";

export function OffboardingModule() {
  const { params } = useNav();
  if (params.id) return <OffboardingDetail id={params.id} />;
  return <OffboardingList />;
}

// ================= TIPE DATA =================
interface OffRow {
  id: string; employeeId: string; personnelActionId: string | null;
  lastDay: string | null; reason: string | null; status: string;
  createdAt: string; completedAt: string | null;
  employee: { id: string; fullName: string; employeeNo: string; status: string; position: { title: string } | null; orgUnit: { name: string } | null };
  sourcePA: { id: string; docNo: string; type: string } | null;
  taskStats: { total: number; done: number };
}
interface OffEmployee {
  id: string; fullName: string; employeeNo: string; status: string;
  joinDate: string; endDate: string | null;
  position: { id: string; title: string; code: string } | null;
  orgUnit: { id: string; name: string; code: string } | null;
  grade: { id: string; code: string; name: string } | null;
}
interface OffTask {
  id: string; seq: number; title: string; owner: string | null;
  status: string; completedAt: string | null; completedById: string | null;
  completedByName: string | null; notes: string | null;
}
interface ExitInterview {
  reason: string | null; nextPlan: string | null; feedback: string | null;
  satisfaction: number | null; notes: string | null;
}
interface OutstandingAsset {
  id: string;
  assignedAt: string;
  dueAt: string | null;
  notes: string | null;
  asset: { id: string; code: string; name: string; category: string; serialNumber: string | null };
}
interface OffDetail {
  id: string; employeeId: string; personnelActionId: string | null;
  lastDay: string | null; reason: string | null; status: string;
  createdAt: string; completedAt: string | null; updatedAt: string;
  employee: OffEmployee;
  sourcePA: { id: string; docNo: string; type: string; status: string; effectiveDate: string } | null;
  tasks: OffTask[];
  exitInterview: ExitInterview | null;
  taskStats: { total: number; done: number; pending: number; na: number };
  // Task 27-b — aset belum dikembalikan (clearance)
  outstandingAssets?: OutstandingAsset[];
}

// peta warna status proses offboarding (kustom — Open di sini = "Berjalan")
function ObStatusPill({ status, className }: { status: string; className?: string }) {
  const { t } = useI18n();
  const map: Record<string, { label: string; en: string; cls: string; dot: string }> = {
    Open: {
      label: "Berjalan", en: "Running",
      cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
      dot: "bg-amber-500",
    },
    Completed: {
      label: "Selesai", en: "Completed",
      cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
      dot: "bg-brand",
    },
    Cancelled: {
      label: "Dibatalkan", en: "Cancelled",
      cls: "bg-stone-100 text-stone-500 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25",
      dot: "bg-stone-400",
    },
  };
  const s = map[status] ?? { label: status, en: status, cls: "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25", dot: "bg-stone-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", s.cls, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.label, s.en)}
    </span>
  );
}

// chip pemilik tugas — warna lembut per fungsi
const OWNER_CLS: Record<string, string> = {
  IT: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  HR: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  Finance: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Supervisor: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25",
  GA: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  Payroll: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
};
const OWNERS = ["Supervisor", "IT", "Finance", "HR", "GA", "Payroll"];
function OwnerChip({ owner }: { owner: string | null }) {
  if (!owner) return <span className="text-[10px] text-stone-400">—</span>;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-px text-[10px] font-bold", OWNER_CLS[owner] ?? "bg-stone-50 text-stone-500 border-stone-200 dark:bg-stone-500/10 dark:text-stone-400 dark:border-stone-500/25")}>
      {owner}
    </span>
  );
}

// ================= DAFTAR =================
function OffboardingList() {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const [status, setStatus] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  // Task 76 — state sort server-side
  const [offSortKey, setOffSortKey] = useState<"employee" | "position" | "lastDay" | "source" | "status">("lastDay");
  const [offSortDir, setOffSortDir] = useState<ServerSortDir>("desc");
  const { data, loading, refresh } = useApi<{ offboardings: OffRow[]; statusCounts: Record<string, number>; total: number }>(
    `/api/onevity/offboarding?sortBy=${offSortKey}&sortDir=${offSortDir}`,
    [offSortKey, offSortDir],
  );

  const sc = data?.statusCounts ?? {};
  const statCards: [string, string, string, number][] = [
    ["Open", "Berjalan", "Running", sc.Open ?? 0],
    ["Completed", "Selesai", "Completed", sc.Completed ?? 0],
    ["Cancelled", "Dibatalkan", "Cancelled", sc.Cancelled ?? 0],
  ];
  const rows = (data?.offboardings ?? []).filter((r) => status === "all" || r.status === status);
  // Task 76 — sort SERVER-SIDE kecuali progress (computed dari tasks) → client-side.
  const sort = useTableSort(rows, {
    progress: (r) => (r.taskStats.total > 0 ? r.taskStats.done / r.taskStats.total : 0),
  });
  const clickSortOff = (k: "employee" | "position" | "lastDay" | "source" | "status") => {
    const n = nextServerSort(offSortKey, offSortDir, k);
    setOffSortKey(n.sortBy as typeof offSortKey);
    setOffSortDir(n.sortDir);
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("Karyawan")}
        title={t("Offboarding Karyawan", "Employee Offboarding")}
        description={t(
          "Kelola proses karyawan keluar — checklist clearance, exit interview & penyelesaian. Proses dibuat otomatis saat pengajuan Resignation/PHK/Pensiun diproses.",
          "Manage employee exits — clearance checklist, exit interview & completion. Processes are created automatically when a Resignation/Termination/Retirement request is processed.",
        )}
        actions={
          perms.can("hr", "offboarding", "create") && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2 font-bold">
              <Plus className="h-4 w-4" /> {t("Proses Baru", "New Process")}
            </Button>
          )
        }
      />

      {/* mini stats — klik utk filter status */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {statCards.map(([st, label, labelEn, val]) => (
          <button key={st} onClick={() => setStatus(status === st ? "all" : st)} className={cn(
            "rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
            status === st ? "ov-border-accent ov-soft" : "border-stone-200/80 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900",
          )}>
            <p className="text-[9px] font-bold uppercase tracking-wide text-stone-400">{t(label, labelEn)}</p>
            <p className="mt-0.5 text-xl font-extrabold text-stone-900 dark:text-stone-50">{val}</p>
          </button>
        ))}
      </div>

      <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="p-4"><LoadingRows rows={6} /></div>
          ) : rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                    <ServerSortHead label={t("Karyawan", "Employee")} active={offSortKey === "employee"} dir={offSortDir} onClick={() => clickSortOff("employee")} className="min-w-40 text-[11px] font-bold" />
                    <ServerSortHead label={t("Posisi & Unit", "Position & Unit")} active={offSortKey === "position"} dir={offSortDir} onClick={() => clickSortOff("position")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Hari Terakhir", "Last Day")} active={offSortKey === "lastDay"} dir={offSortDir} onClick={() => clickSortOff("lastDay")} className="text-[11px] font-bold" />
                    <ServerSortHead label={t("Sumber", "Source")} active={offSortKey === "source"} dir={offSortDir} onClick={() => clickSortOff("source")} className="text-[11px] font-bold" />
                    {sort.head("progress", t("Checklist"), "min-w-36 text-[11px] font-bold")}
                    <ServerSortHead label={t("Status")} active={offSortKey === "status"} dir={offSortDir} onClick={() => clickSortOff("status")} className="text-[11px] font-bold" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const pct = r.taskStats.total > 0 ? (r.taskStats.done / r.taskStats.total) * 100 : 0;
                    const allDone = r.taskStats.total > 0 && r.taskStats.done === r.taskStats.total;
                    return (
                      <TableRow key={r.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => navigate("employee", "offboarding", { id: r.id })}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold", avatarColor(r.employee.fullName))}>{initials(r.employee.fullName)}</span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold">{r.employee.fullName}</p>
                              <p className="truncate font-mono text-[10px] text-stone-400">{r.employee.employeeNo}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-stone-600 dark:text-stone-300">{r.employee.position?.title ?? "—"}</p>
                          <p className="text-[10px] text-stone-400">{r.employee.orgUnit?.name ?? "—"}</p>
                        </TableCell>
                        <TableCell className="text-xs text-stone-500">{fmtDate(r.lastDay)}</TableCell>
                        <TableCell>
                          {r.sourcePA ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate("actions", "all", { id: r.sourcePA!.id }); }}
                              className="font-mono text-[11px] font-bold ov-text-accent underline-offset-2 hover:underline"
                              title={t("Buka dokumen pengajuan", "Open the request document")}
                            >
                              {r.sourcePA.docNo}
                            </button>
                          ) : (
                            <span className="text-[11px] text-stone-400">{t("Manual", "Manual")}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={pct} className="h-1.5 w-20 [&>div]:ov-chart" />
                            <span className="text-[10px] font-bold tabular-nums text-stone-500">{r.taskStats.done}/{r.taskStats.total}</span>
                            {allDone && <CheckCircle2 className="h-3.5 w-3.5 text-brand" />}
                          </div>
                        </TableCell>
                        <TableCell><ObStatusPill status={r.status} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={<LogOut className="h-6 w-6" />}
                title={t("Belum ada proses offboarding", "No offboarding processes yet")}
                description={t(
                  "Proses dibuat otomatis saat pengajuan Resignation/PHK/Pensiun diproses — atau buat manual dengan tombol \"Proses Baru\" untuk karyawan yang akan keluar.",
                  "Processes are created automatically when a Resignation/Termination/Retirement request is processed — or create one manually with \"New Process\" for an employee who is about to leave.",
                )}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOffboardingDialog
        open={createOpen}
        setOpen={(v) => { setCreateOpen(v); if (!v) refresh(); }}
        onCreated={(newId) => { refresh(); navigate("employee", "offboarding", { id: newId }); }}
      />
    </div>
  );
}

// dialog buat proses manual
function CreateOffboardingDialog({ open, setOpen, onCreated }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const opts = useApi<{ managers: { id: string; fullName: string; employeeNo: string }[] }>("/api/onevity/employee-options");
  const [employeeId, setEmployeeId] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [empQ, setEmpQ] = useState("");

  const employees = (opts.data?.managers ?? [])
    .filter((m) => !empQ || m.fullName.toLowerCase().includes(empQ.toLowerCase()) || m.employeeNo.toLowerCase().includes(empQ.toLowerCase()))
    .slice(0, 30);

  const submit = async () => {
    if (!employeeId) { toast.error(t("Pilih karyawan", "Select an employee")); return; }
    setBusy(true);
    try {
      const res = await apiSend<{ offboarding: OffDetail }>("/api/onevity/offboarding", "POST", {
        employeeId, lastDay: lastDay || null, reason: reason || null,
      });
      toast.success(t("Proses offboarding dibuat — checklist clearance siap", "Offboarding process created — clearance checklist ready"));
      setOpen(false);
      setEmployeeId(""); setLastDay(""); setReason(""); setEmpQ("");
      onCreated(res.offboarding.id);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><LogOut className="h-4 w-4 ov-text-accent" /> {t("Proses Offboarding Baru", "New Offboarding Process")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("Karyawan *", "Employee *")}</Label>
            <Input value={empQ} onChange={(e) => setEmpQ(e.target.value)} className="mt-1.5" placeholder={t("Filter daftar karyawan…", "Filter employee list…")} />
            <Select value={employeeId || "none"} onValueChange={setEmployeeId}>
              <SelectTrigger className="mt-2"><SelectValue placeholder={t("Pilih karyawan", "Select an employee")} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">{t("— Pilih karyawan —", "— Select an employee —")}</SelectItem>
                {employees.map((m) => <SelectItem key={m.id} value={m.id}>{m.fullName} · {m.employeeNo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("Tanggal terakhir kerja", "Last working day")}</Label>
            <Input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">{t("Alasan keluar", "Exit reason")}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 min-h-20" placeholder={t("cth: pengunduran diri — peluang karier lain", "e.g.: resignation — other career opportunity")} />
          </div>
          <p className="rounded-xl bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-500 dark:bg-stone-900">
            {t(
              "Checklist clearance bawaan (9 tugas: handover, aset IT, akses sistem, clearance keuangan, BPJS, exit interview, settlement, arsip) akan dibuat otomatis — ditambah tugas pengembalian aset bila karyawan masih memegang aset perusahaan.",
              "A default clearance checklist (9 tasks: handover, IT assets, system access, financial clearance, BPJS, exit interview, settlement, archiving) will be created automatically — plus an asset return task if the employee still holds company assets.",
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Membuat…", "Creating…") : t("Buat Proses", "Create Process")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DETAIL =================
function OffboardingDetail({ id }: { id: string }) {
  const { navigate } = useNav();
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh, setData } = useApi<{ offboarding: OffDetail }>(`/api/onevity/offboarding/${id}`);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ taskId: string; title: string; status: string; notes: string } | null>(null);
  const [newTask, setNewTask] = useState("");
  const [newTaskOwner, setNewTaskOwner] = useState("HR");
  const [ivEdit, setIvEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  // Task 27-b — aset yang sedang diterima pengembaliannya (seksi clearance)
  const [returningAsset, setReturningAsset] = useState<OutstandingAsset | null>(null);

  if (loading && !data) {
    return <div><PageHeader eyebrow={t("Karyawan")} title={t("Detail Offboarding", "Offboarding Details")} /><LoadingRows rows={6} /></div>;
  }
  if (!data?.offboarding) {
    return <EmptyState title={t("Proses offboarding tidak ditemukan", "Offboarding process not found")} description={t("Kembali ke daftar dan pilih proses lain.", "Go back to the list and pick another process.")} />;
  }
  const ob = data.offboarding;
  const canUpdate = perms.can("hr", "offboarding", "update") && ob.status === "Open";
  const tasks = ob.tasks;
  const done = tasks.filter((x) => x.status === "Done").length;
  const na = tasks.filter((x) => x.status === "Na").length;
  const total = tasks.length;
  const remaining = total - done - na;
  const pct = total > 0 ? ((done + na) / total) * 100 : 0;
  const scheduled = ob.status === "Open" && ob.employee.status === "Active" && ob.lastDay != null && new Date(ob.lastDay).getTime() > Date.now();

  // PATCH umum — respons selalu membawa detail terbaru → setData sekali jalan
  const patch = async (body: Record<string, unknown>) => {
    const res = await apiSend<{ ok: boolean; offboarding: OffDetail }>(`/api/onevity/offboarding/${id}`, "PATCH", body);
    setData({ offboarding: res.offboarding });
    return res;
  };

  // toggle status tugas — optimis (UI instan), server sebagai kebenaran akhir
  const setTaskStatus = async (task: OffTask, status: "Done" | "Pending" | "Na") => {
    if (task.status === status || !canUpdate) return;
    setData((d) => d ? { offboarding: { ...d.offboarding, tasks: d.offboarding.tasks.map((x) => (x.id === task.id ? { ...x, status } : x)) } } : d);
    try {
      await patch({ action: "task", taskId: task.id, status });
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };

  const saveNote = async () => {
    if (!noteEdit) return;
    setBusy(true);
    try {
      await patch({ action: "task", taskId: noteEdit.taskId, status: noteEdit.status, notes: noteEdit.notes || null });
      toast.success(t("Catatan tugas disimpan", "Task note saved"));
      setNoteEdit(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const addTask = async () => {
    if (!newTask.trim()) { toast.error(t("Tulis judul tugas", "Write the task title")); return; }
    setBusy(true);
    try {
      await patch({ action: "addTask", title: newTask.trim(), owner: newTaskOwner });
      toast.success(t("Tugas ditambahkan ke checklist", "Task added to the checklist"));
      setNewTask("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const removeTask = async (task: OffTask) => {
    try {
      await patch({ action: "removeTask", taskId: task.id });
      toast.success(t("Tugas dihapus dari checklist", "Task removed from the checklist"));
    } catch (e) { toast.error((e as Error).message); }
  };

  const doComplete = async () => {
    setBusy(true);
    try {
      await patch({ action: "complete" });
      toast.success(t("Proses offboarding ditandai selesai", "Offboarding process marked as completed"));
      setConfirmComplete(false);
    } catch (e) { toast.error((e as Error).message); setConfirmComplete(false); } finally { setBusy(false); }
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      await patch({ action: "cancel", reason: cancelReason || null });
      toast.success(t("Proses offboarding dibatalkan", "Offboarding process cancelled"));
      setCancelOpen(false);
      setCancelReason("");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      await apiSend(`/api/onevity/offboarding/${id}`, "DELETE");
      toast.success(t("Proses dihapus dari daftar", "Process removed from the list"));
      navigate("employee", "offboarding");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const saveInterview = async (form: ExitInterview) => {
    setBusy(true);
    try {
      await patch({ action: "interview", form });
      toast.success(t("Exit interview disimpan", "Exit interview saved"));
      setIvEdit(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <button onClick={() => navigate("employee", "offboarding")} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold ov-text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" /> {t("Kembali ke Daftar", "Back to List")}
      </button>

      {/* ===== kartu ringkasan karyawan ===== */}
      <Card className="mb-4 overflow-hidden rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
        <div className={cn("h-1.5", ob.status === "Completed" ? "bg-brand" : ob.status === "Cancelled" ? "bg-stone-300" : "bg-amber-400")} />
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <ObStatusPill status={ob.status} />
                <Badge variant="outline" className="text-[10px] font-bold">{t("Offboarding", "Offboarding")}</Badge>
              </div>
              <h1 className="mt-2 text-lg font-extrabold text-stone-900 dark:text-stone-50">{ob.employee.fullName}</h1>
              <p className="text-xs text-stone-500">{ob.employee.position?.title ?? "—"} · {ob.employee.orgUnit?.name ?? "—"} · <span className="font-mono">{ob.employee.employeeNo}</span></p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <StatusPill status={ob.employee.status} />
                <Badge variant="secondary" className="text-[10px]">{t("Bergabung {date}", "Joined {date}", { date: fmtDate(ob.employee.joinDate) })}</Badge>
                <Badge variant="secondary" className="text-[10px]">{t("Masa kerja {t}", "Tenure {t}", { t: tenure(ob.employee.joinDate) })}</Badge>
                {ob.employee.grade && <Badge variant="outline" className="text-[10px]">{t("Grade {code}", "Grade {code}", { code: ob.employee.grade.code })}</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[11px] text-stone-500">
                <span><b className="text-stone-700 dark:text-stone-300">{t("Hari terakhir:", "Last day:")}</b> {fmtDate(ob.lastDay)}</span>
                <span><b className="text-stone-700 dark:text-stone-300">{t("Dibuat:", "Created:")}</b> {fmtDateTime(ob.createdAt)}</span>
                {ob.completedAt && <span><b className="text-stone-700 dark:text-stone-300">{t("Selesai:", "Completed:")}</b> {fmtDateTime(ob.completedAt)}</span>}
              </div>
            </div>
            <div className={cn("flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold", avatarColor(ob.employee.fullName))}>
              {initials(ob.employee.fullName)}
            </div>
          </div>
          {ob.reason && (
            <div className="mt-4 rounded-xl border border-stone-100 bg-stone-50 p-3.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Alasan Keluar", "Exit Reason")}</p>
              <p className="mt-0.5 text-sm italic text-stone-700 dark:text-stone-300">"{ob.reason}"</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== banner status ===== */}
      {scheduled && (
        <Card className="mb-4 rounded-2xl border-amber-200 bg-amber-50/70 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Calendar className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="flex-1 text-[13px] font-bold text-amber-800 dark:text-amber-300">
              {t("Keluar terjadwal {date} — karyawan masih aktif sampai hari terakhirnya", "Exit scheduled {date} — the employee stays active until their last day", { date: fmtDate(ob.lastDay) })}
            </p>
          </CardContent>
        </Card>
      )}
      {ob.status === "Completed" && (
        <Card className="mb-4 rounded-2xl border-brand/25 bg-brand/10/70 shadow-sm dark:border-brand/25 dark:bg-brand/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-brand dark:text-brand/85" />
            <p className="flex-1 text-[13px] font-bold text-brand-deep dark:text-brand/75">
              {t("Offboarding selesai {date} — seluruh clearance tuntas", "Offboarding completed {date} — all clearance done", { date: fmtDate(ob.completedAt) })}
            </p>
          </CardContent>
        </Card>
      )}
      {ob.status === "Cancelled" && (
        <Card className="mb-4 rounded-2xl border-stone-200 bg-stone-50 shadow-sm dark:border-stone-800 dark:bg-stone-900/60">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Ban className="h-5 w-5 shrink-0 text-stone-400" />
            <p className="flex-1 text-[13px] font-bold text-stone-600 dark:text-stone-400">
              {t("Proses offboarding dibatalkan — tidak aktif", "Offboarding process cancelled — inactive")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ===== kolom kiri: checklist + exit interview ===== */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold">
                  <ClipboardCheck className="h-4 w-4 ov-text-accent" />
                  {t("Checklist Clearance ({done}/{total} selesai)", "Clearance Checklist ({done}/{total} done)", { done: done + na, total })}
                </CardTitle>
                <span className="text-[11px] font-bold text-stone-400">{t("{n} N/A", "{n} N/A", { n: na })}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Progress value={pct} className="h-2 flex-1 [&>div]:ov-chart" />
                <span className="text-[11px] font-bold tabular-nums text-stone-500">{done + na}/{total}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {tasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors",
                    task.status === "Done" ? "border-brand/25 bg-brand/10/50 dark:border-brand/25 dark:bg-brand/5" :
                    task.status === "Na" ? "border-stone-200 bg-stone-50/70 dark:border-stone-800 dark:bg-stone-900/40" :
                    "border-stone-100 bg-white dark:border-stone-800 dark:bg-stone-900",
                  )}
                >
                  <span className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold tabular-nums",
                    task.status === "Done" ? "bg-brand/15 text-brand-deep dark:bg-brand/20 dark:text-brand/85" :
                    task.status === "Na" ? "bg-stone-100 text-stone-400 dark:bg-stone-800" :
                    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
                  )}>
                    {task.seq}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn("text-[13px] font-semibold", task.status === "Na" ? "text-stone-400 line-through" : "text-stone-800 dark:text-stone-200")}>{task.title}</p>
                      <OwnerChip owner={task.owner} />
                    </div>
                    {task.notes && <p className="mt-0.5 text-[11px] italic text-stone-500">"{task.notes}"</p>}
                    {task.status === "Done" && (
                      <p className="mt-0.5 text-[10px] text-brand dark:text-brand/85">
                        <CheckCircle2 className="mr-1 inline h-3 w-3" />
                        {t("oleh {name}, {time}", "by {name}, {time}", { name: task.completedByName ?? "—", time: fmtDateTime(task.completedAt) })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* toggle 3 status — Selesai / N/A / reset */}
                    <Button
                      size="sm" variant="outline"
                      disabled={!canUpdate || busy}
                      onClick={() => void setTaskStatus(task, task.status === "Done" ? "Pending" : "Done")}
                      title={t("Tandai selesai", "Mark as done")}
                      className={cn("h-7 gap-1 px-2 text-[11px] font-bold", task.status === "Done" && "border-brand/40 bg-brand/15 text-brand-deep hover:bg-brand/15 dark:border-brand/40 dark:bg-brand/15 dark:text-brand/85")}
                    >
                      <Check className="h-3.5 w-3.5" /> {t("Selesai", "Done")}
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      disabled={!canUpdate || busy}
                      onClick={() => void setTaskStatus(task, task.status === "Na" ? "Pending" : "Na")}
                      title={t("Tandai tidak relevan", "Mark as not applicable")}
                      className={cn("h-7 gap-1 px-2 text-[11px] font-bold", task.status === "Na" && "border-stone-300 bg-stone-100 text-stone-500 dark:bg-stone-800")}
                    >
                      <Minus className="h-3.5 w-3.5" /> N/A
                    </Button>
                    {(task.status === "Done" || task.status === "Na") && (
                      <Button
                        size="sm" variant="ghost"
                        disabled={!canUpdate || busy}
                        onClick={() => void setTaskStatus(task, "Pending")}
                        title={t("Kembalikan ke pending", "Reset to pending")}
                        className="h-7 w-7 px-0 text-stone-400 hover:text-amber-600"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost"
                      disabled={!canUpdate || busy}
                      onClick={() => setNoteEdit({ taskId: task.id, title: task.title, status: task.status, notes: task.notes ?? "" })}
                      title={t("Catatan tugas", "Task note")}
                      className="h-7 w-7 px-0 text-stone-400 hover:ov-text-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {task.status === "Pending" && canUpdate && (
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => void removeTask(task)}
                        title={t("Hapus tugas", "Remove task")}
                        className="h-7 w-7 px-0 text-stone-400 hover:text-rose-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}

              {/* tambah tugas inline */}
              {canUpdate && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-stone-300 p-2.5 dark:border-stone-700">
                  <Input
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addTask(); } }}
                    placeholder={t("Judul tugas clearance tambahan…", "Additional clearance task title…")}
                    className="h-8 min-w-40 flex-1 text-[13px]"
                  />
                  <Select value={newTaskOwner} onValueChange={setNewTaskOwner}>
                    <SelectTrigger className="h-8 w-28 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OWNERS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={() => void addTask()} disabled={busy} className="h-8 gap-1 px-3 text-[11px] font-bold">
                    <Plus className="h-3.5 w-3.5" /> {t("Tambah", "Add")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== Task 27-b: aset belum dikembalikan ===== */}
          <Card className={cn(
            "rounded-2xl shadow-sm",
            (ob.outstandingAssets?.length ?? 0) > 0
              ? "border-amber-200 dark:border-amber-500/25"
              : "border-stone-200/80 dark:border-stone-800",
          )}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <Package className="h-4 w-4 ov-text-accent" />
                {t("Aset Belum Dikembalikan", "Assets Pending Return")}
                {(ob.outstandingAssets?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
                    {t("{n} item", "{n} item(s)", { n: ob.outstandingAssets!.length })}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {(ob.outstandingAssets?.length ?? 0) === 0 ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-brand/25 bg-brand/10/70 p-3.5 dark:border-brand/25 dark:bg-brand/5">
                  <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-brand dark:text-brand/85" aria-hidden />
                  <p className="text-[12px] font-bold text-brand-deep dark:text-brand/75">
                    {t("Tidak ada aset tertunda — clearance aset tuntas", "No pending assets — asset clearance is clear")}
                  </p>
                </div>
              ) : (
                ob.outstandingAssets!.map((a) => {
                  const overdue = a.dueAt != null && new Date(a.dueAt).getTime() < Date.now();
                  return (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-100 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        <Package className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[13px] font-bold text-stone-800 dark:text-stone-200">{a.asset.name}</p>
                          <span className="font-mono text-[10px] font-bold text-stone-400">{a.asset.code}</span>
                          {a.asset.serialNumber && (
                            <span className="font-mono text-[9px] text-stone-400">SN {a.asset.serialNumber}</span>
                          )}
                          {overdue && (
                            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[9px] font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400">
                              {t("Terlambat", "Overdue")}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-stone-400">
                          {t("Dipegang sejak {date}", "Held since {date}", { date: fmtDate(a.assignedAt) })}
                          {a.dueAt ? ` · ${t("jatuh tempo", "due")} ${fmtDate(a.dueAt)}` : ""}
                        </p>
                        {a.notes && <p className="mt-0.5 line-clamp-1 text-[10.5px] italic text-stone-400">"{a.notes}"</p>}
                      </div>
                      {perms.canOp("hr", "assets", "return") && (
                        <Button
                          size="sm" variant="outline"
                          onClick={() => setReturningAsset(a)}
                          className="h-7 gap-1 px-2.5 text-[11px] font-bold hover:ov-border-accent"
                          aria-label={t("Terima pengembalian {code}", "Receive return of {code}", { code: a.asset.code })}
                        >
                          <PackageCheck className="h-3.5 w-3.5" /> {t("Kembalikan", "Return")}
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
              {(ob.outstandingAssets?.length ?? 0) > 0 && (
                <p className="pt-1 text-[10.5px] leading-relaxed text-stone-400">
                  {t(
                    "Pengembalian di sini mencatat kondisi aset (Baik/Rusak/Hilang) dan memperbarui status inventaris — riwayat tetap tersimpan di modul Aset Karyawan.",
                    "Returning here records the asset condition (Good/Damaged/Lost) and updates the inventory status — history stays in the Employee Assets module.",
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ===== exit interview ===== */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-bold">
                <MessageSquareText className="h-4 w-4 ov-text-accent" /> {t("Exit Interview", "Exit Interview")}
                <Badge variant="outline" className={cn("text-[10px] font-bold", ob.exitInterview ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400")}>
                  {ob.exitInterview ? t("Terisi", "Filled") : t("Belum terisi", "Not filled")}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {ob.exitInterview && !ivEdit ? (
                <div className="space-y-3">
                  <InterviewRow label={t("Alasan utama keluar", "Main reason for leaving")} value={ob.exitInterview.reason} />
                  <InterviewRow label={t("Rencana berikutnya", "Next plan")} value={ob.exitInterview.nextPlan} />
                  <InterviewRow label={t("Umpan balik untuk perusahaan", "Feedback for the company")} value={ob.exitInterview.feedback} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{t("Kepuasan bekerja di perusahaan", "Satisfaction working at the company")}</p>
                    <div className="mt-1 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} className={cn("h-4 w-4", (ob.exitInterview?.satisfaction ?? 0) >= n ? "fill-amber-400 text-amber-500" : "text-stone-300 dark:text-stone-600")} />
                      ))}
                      <span className="ml-1.5 text-[11px] font-bold tabular-nums text-stone-500">{ob.exitInterview?.satisfaction ?? "—"}/5</span>
                    </div>
                  </div>
                  <InterviewRow label={t("Catatan HR", "HR notes")} value={ob.exitInterview.notes} />
                  {canUpdate && (
                    <Button size="sm" variant="outline" onClick={() => setIvEdit(true)} className="gap-1.5 text-[11px] font-bold">
                      <Pencil className="h-3.5 w-3.5" /> {t("Ubah", "Edit")}
                    </Button>
                  )}
                </div>
              ) : canUpdate ? (
                <InterviewForm initial={ob.exitInterview} busy={busy} onSubmit={saveInterview} onCancel={ob.exitInterview ? () => setIvEdit(false) : undefined} />
              ) : (
                <p className="text-xs text-stone-400">{t("Exit interview belum dilakukan.", "Exit interview has not been conducted yet.")}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ===== kolom kanan: dokumen sumber + aksi ===== */}
        <div className="space-y-4">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 ov-text-accent" /> {t("Dokumen Sumber", "Source Document")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {ob.sourcePA ? (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[13px] font-extrabold text-stone-600 dark:text-stone-300">{ob.sourcePA.docNo}</p>
                    <Badge variant="outline" className="text-[10px] font-bold">{paTypeLabelSafe(ob.sourcePA.type)}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
                    <span><b className="text-stone-700 dark:text-stone-300">{t("Efektif:", "Effective:")}</b> {fmtDate(ob.sourcePA.effectiveDate)}</span>
                    <StatusPill status={ob.sourcePA.status} />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate("actions", "all", { id: ob.sourcePA!.id })} className="w-full gap-1.5 text-[11px] font-bold">
                    {t("Buka Pengajuan", "Open Request")} <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-stone-400">{t("Dibuat manual — tidak terhubung dokumen pengajuan.", "Created manually — not linked to a request document.")}</p>
              )}
            </CardContent>
          </Card>

          <Card className="sticky top-20 rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><LogOut className="h-4 w-4 ov-text-accent" /> {t("Penyelesaian Proses", "Process Completion")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div>
                <div className="mb-1.5 flex justify-between text-[11px] font-bold">
                  <span className="text-stone-400">{t("Progress Clearance", "Clearance Progress")}</span>
                  <span className="text-stone-600 dark:text-stone-400">{done + na}/{total} {t("tuntas", "done")}</span>
                </div>
                <Progress value={pct} className="h-2 [&>div]:ov-chart" />
              </div>

              {ob.status === "Open" && (
                <>
                  <Button
                    onClick={() => setConfirmComplete(true)}
                    disabled={remaining > 0 || !perms.can("hr", "offboarding", "update")}
                    className="w-full gap-2 bg-brand font-bold hover:bg-brand/70"
                  >
                    <CheckCircle2 className="h-4 w-4" /> {t("Tandai Selesai", "Mark as Completed")}
                  </Button>
                  {remaining > 0 && (
                    <p className="text-center text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      {t("Masih ada {n} tugas belum selesai", "{n} tasks still incomplete", { n: remaining })}
                    </p>
                  )}
                  <Button
                    onClick={() => setCancelOpen(true)}
                    variant="outline"
                    disabled={!perms.can("hr", "offboarding", "update")}
                    className="w-full gap-2 border-rose-200 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400"
                  >
                    <Ban className="h-4 w-4" /> {t("Batalkan Proses", "Cancel Process")}
                  </Button>
                </>
              )}

              {ob.status === "Completed" && (
                <div className="rounded-xl border border-brand/25 bg-brand/10/70 p-4 text-center dark:border-brand/25 dark:bg-brand/5">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-brand dark:text-brand/85" />
                  <p className="mt-1 text-[13px] font-bold text-brand-deep dark:text-brand/75">{t("Proses Selesai", "Process Completed")}</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">{t("Ditutup {date}", "Closed {date}", { date: fmtDateTime(ob.completedAt) })}</p>
                </div>
              )}

              {ob.status === "Cancelled" && (
                <Button
                  onClick={() => setConfirmDelete(true)}
                  variant="outline"
                  disabled={busy || !perms.can("hr", "offboarding", "delete")}
                  className="w-full gap-2 border-rose-200 font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" /> {t("Hapus dari Daftar", "Delete from List")}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===== Task 27-b — dialog pengembalian aset (clearance) ===== */}
      {returningAsset && (
        <ReturnDialog
          compact
          assignment={{
            id: returningAsset.id,
            asset: returningAsset.asset,
            employee: { fullName: ob.employee.fullName, employeeNo: ob.employee.employeeNo },
            dueAt: returningAsset.dueAt,
            notes: returningAsset.notes,
          }}
          onClose={() => setReturningAsset(null)}
          onSaved={refresh}
        />
      )}

      {/* ===== dialog edit catatan tugas ===== */}
      <Dialog open={!!noteEdit} onOpenChange={(v) => { if (!v) setNoteEdit(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Pencil className="h-4 w-4 ov-text-accent" /> {t("Catatan Tugas", "Task Note")}</DialogTitle>
          </DialogHeader>
          {noteEdit && (
            <>
              <p className="rounded-xl bg-stone-50 p-3 text-[13px] font-semibold dark:bg-stone-900">{noteEdit.title}</p>
              <div>
                <Label className="text-xs">{t("Catatan pengerjaan (opsional)", "Execution note (optional)")}</Label>
                <Textarea
                  value={noteEdit.notes}
                  onChange={(e) => setNoteEdit({ ...noteEdit, notes: e.target.value })}
                  className="mt-1.5 min-h-24"
                  placeholder={t("cth: laptop dikembalikan lengkap dengan charger & tas", "e.g.: laptop returned complete with charger & bag")}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNoteEdit(null)}>{t("Batal")}</Button>
                <Button onClick={() => void saveNote()} disabled={busy} className="font-bold">{busy ? t("Menyimpan…", "Saving…") : t("Simpan Catatan", "Save Note")}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ===== konfirmasi tandai selesai ===== */}
      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-brand" /> {t("Tandai Offboarding Selesai?", "Mark Offboarding as Completed?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Seluruh {total} tugas clearance ({done} selesai, {na} N/A) untuk {name} telah tuntas. Proses akan dikunci dan tidak bisa diubah lagi.",
                "All {total} clearance tasks ({done} done, {na} N/A) for {name} are complete. The process will be locked and can no longer be changed.",
                { total, done, na, name: ob.employee.fullName },
              )}
              {ob.exitInterview == null && (
                <span className="mt-1 block font-semibold text-amber-600 dark:text-amber-400">
                  {t("Catatan: exit interview belum diisi.", "Note: the exit interview has not been filled in.")}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doComplete()} className="bg-brand font-bold hover:bg-brand/70">
              {t("Ya, Tandai Selesai", "Yes, Mark as Completed")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== konfirmasi batalkan (dengan alasan opsional) ===== */}
      <Dialog open={cancelOpen} onOpenChange={(v) => { setCancelOpen(v); if (!v) setCancelReason(""); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Ban className="h-4 w-4 text-rose-500" /> {t("Batalkan Proses Offboarding?", "Cancel Offboarding Process?")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-500">
            {t("Checklist & exit interview tidak akan bisa dilanjutkan. Gunakan bila pengajuan keluar dibatalkan atau proses dibuat keliru.", "The checklist & exit interview can no longer be continued. Use this if the exit request was cancelled or the process was created by mistake.")}
          </p>
          <div>
            <Label className="text-xs">{t("Alasan pembatalan (opsional)", "Cancellation reason (optional)")}</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="mt-1.5 min-h-20" placeholder={t("cth: pengajuan resignasi dibatalkan", "e.g.: resignation request withdrawn")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>{t("Batal")}</Button>
            <Button onClick={() => void doCancel()} disabled={busy} className="bg-rose-600 font-bold hover:bg-rose-700">{t("Ya, Batalkan", "Yes, Cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== konfirmasi hapus (hanya Cancelled) ===== */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5 text-rose-500" /> {t("Hapus Proses dari Daftar?", "Delete Process from List?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Proses yang dibatalkan untuk {name} akan dihapus permanen beserta seluruh checklist.", "The cancelled process for {name} will be permanently deleted along with its entire checklist.", { name: ob.employee.fullName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()} className="bg-rose-600 font-bold hover:bg-rose-700">{t("Ya, Hapus", "Yes, Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InterviewRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[13px] font-medium text-stone-800 dark:text-stone-200">{value || "—"}</p>
    </div>
  );
}

// form exit interview — state lokal; kembali read-only setelah simpan
function InterviewForm({ initial, busy, onSubmit, onCancel }: {
  initial: ExitInterview | null;
  busy: boolean;
  onSubmit: (form: ExitInterview) => Promise<void>;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [nextPlan, setNextPlan] = useState(initial?.nextPlan ?? "");
  const [feedback, setFeedback] = useState(initial?.feedback ?? "");
  const [satisfaction, setSatisfaction] = useState(initial?.satisfaction ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{t("Alasan utama keluar", "Main reason for leaving")}</Label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 min-h-16" placeholder={t("cth: peluang karier di perusahaan lain", "e.g.: career opportunity at another company")} />
      </div>
      <div>
        <Label className="text-xs">{t("Rencana berikutnya", "Next plan")}</Label>
        <Input value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} className="mt-1.5" placeholder={t("cth: berwirausaha / lanjut studi", "e.g.: starting a business / further studies")} />
      </div>
      <div>
        <Label className="text-xs">{t("Umpan balik untuk perusahaan", "Feedback for the company")}</Label>
        <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} className="mt-1.5 min-h-16" placeholder={t("cth: proses administrasi bisa lebih digital", "e.g.: administration could be more digital")} />
      </div>
      <div>
        <Label className="text-xs">{t("Kepuasan bekerja di perusahaan", "Satisfaction working at the company")}</Label>
        <div className="mt-1.5 flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSatisfaction(n)}
              aria-label={t("Skor {n}", "Score {n}", { n })}
              className={cn("rounded-lg p-1 transition-transform hover:scale-110", satisfaction === n && "scale-110")}
            >
              <Star className={cn("h-6 w-6", satisfaction >= n ? "fill-amber-400 text-amber-500" : "text-stone-300 dark:text-stone-600")} />
            </button>
          ))}
          <span className="ml-1 text-[11px] font-bold tabular-nums text-stone-500">{satisfaction}/5</span>
        </div>
      </div>
      <div>
        <Label className="text-xs">{t("Catatan HR", "HR notes")}</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5 min-h-16" placeholder={t("Catatan internal HR", "Internal HR notes")} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void onSubmit({ reason: reason || null, nextPlan: nextPlan || null, feedback: feedback || null, satisfaction, notes: notes || null })} disabled={busy} className="font-bold">
          {busy ? t("Menyimpan…", "Saving…") : t("Simpan Exit Interview", "Save Exit Interview")}
        </Button>
        {onCancel && <Button variant="outline" onClick={onCancel}>{t("Batal")}</Button>}
      </div>
    </div>
  );
}
