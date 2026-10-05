"use client";
// RekanKerja — Modul Checklist Onboarding (Task 65) =========================
// Proses penyambutan karyawan baru: dibuat OTOMATIS saat karyawan baru dibuat
// (wizard) atau manual dari daftar. Checklist per bagian (IT/GA/Finance/HR/
// Supervisor/Payroll) — email checklist dikirim ke tiap bagian dgn link
// checklist publik; di app tiap bagian hanya bisa mencentang tugasnya sendiri.
// =====================================================================
import { useCallback, useEffect, useState } from "react";
import { useApi, apiSend, fmtDate } from "@/rekankerja/shared/lib/api";
import { useNav } from "@/rekankerja/shared/lib/store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  UserPlus, Plus, ArrowLeft, Check, Minus, CircleDashed, Mail, Send,
  ClipboardCheck, Trash2,
} from "lucide-react";

export function OnboardingChecklistModule() {
  const { params, navigate } = useNav();
  if (params.id) return <OnboardingChecklistDetail id={params.id} />;
  return <OnboardingChecklistList onOpen={(id) => navigate("employee", "onboarding-checklist", { id })} />;
}

// ================= TIPE =================
interface OnRow {
  id: string; employeeId: string; startDate: string | null; note: string | null; status: string;
  createdAt: string; completedAt: string | null;
  employee: { id: string; fullName: string; employeeNo: string; status: string; joinDate: string | null; position: { title: string } | null; orgUnit: { name: string } | null };
  taskStats: { total: number; done: number };
}
interface OnTask {
  id: string; seq: number; title: string; owner: string | null; ownerLabel: string | null;
  status: string; completedAt: string | null; completedByName: string | null; completedVia: string | null; notes: string | null;
}
interface DeptMeta { dept: string; label: string }
interface OnDetail {
  id: string; employeeId: string; startDate: string | null; note: string | null; status: string;
  createdAt: string; completedAt: string | null;
  employee: { id: string; fullName: string; employeeNo: string; status: string; joinDate: string | null; email: string | null; position: { title: string } | null; orgUnit: { name: string } | null };
  tasks: OnTask[];
  taskStats: { total: number; done: number; pending: number; na: number };
}
interface ViewerMeta { allowedDepts: string[] | null; canComplete: boolean }

const STATUS_LABEL: Record<string, string> = { Done: "Selesai", Pending: "Menunggu", Na: "N/A" };
// EN paralel — konvensi peta _EN + t(map[k], mapEN[k]) seperti modul HR lain.
const STATUS_LABEL_EN: Record<string, string> = { Done: "Done", Pending: "Pending", Na: "N/A" };

// ================= DAFTAR =================
function OnboardingChecklistList({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const { data, refresh } = useApi<{ onboardings: OnRow[]; statusCounts: Record<string, number>; total: number }>("/api/rekankerja/onboarding");
  const [showNew, setShowNew] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Onboarding"
        title={t("Checklist Onboarding", "Onboarding Checklist")}
        description={t(
          "Proses penyambutan karyawan baru — checklist per bagian (IT, GA, Finance, HR, Supervisor, Payroll)",
          "New employee welcome process — per-department checklist (IT, GA, Finance, HR, Supervisor, Payroll)",
        )}
        actions={
          <>
            <Button variant="outline" onClick={() => setShowRecipients(true)}>
              <Mail className="mr-2 h-4 w-4" /> {t("Email Penerima", "Recipient Emails")}
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="mr-2 h-4 w-4" /> {t("Proses Baru", "New Process")}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {!data ? (
            <LoadingRows rows={5} />
          ) : data.onboardings.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck className="h-10 w-10" />}
              title={t("Belum ada proses onboarding", "No onboarding process yet")}
              description={t(
                "Proses dibuat otomatis saat karyawan baru ditambahkan, atau buat manual lewat tombol Proses Baru.",
                "A process is created automatically when a new employee is added, or create one manually via the New Process button.",
              )}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Karyawan", "Employee")}</TableHead>
                  <TableHead>{t("Posisi / Unit", "Position / Unit")}</TableHead>
                  <TableHead>{t("Mulai", "Start")}</TableHead>
                  <TableHead>{t("Progres", "Progress")}</TableHead>
                  <TableHead>{t("Status", "Status")}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.onboardings.map((o) => {
                  const pct = o.taskStats.total > 0 ? Math.round((o.taskStats.done / o.taskStats.total) * 100) : 0;
                  return (
                    <TableRow key={o.id} className="cursor-pointer" onClick={() => onOpen(o.id)}>
                      <TableCell>
                        <div className="font-medium">{o.employee.fullName}</div>
                        <div className="text-xs text-muted-foreground">{o.employee.employeeNo}</div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {o.employee.position?.title ?? "-"}
                        <div className="text-xs text-muted-foreground">{o.employee.orgUnit?.name ?? "-"}</div>
                      </TableCell>
                      <TableCell className="text-sm">{o.startDate ? fmtDate(o.startDate) : "-"}</TableCell>
                      <TableCell className="w-40">
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2 flex-1" />
                          <span className="w-10 text-xs text-muted-foreground">{o.taskStats.done}/{o.taskStats.total}</span>
                        </div>
                      </TableCell>
                      <TableCell><StatusPill status={o.status} /></TableCell>
                      <TableCell><Plus className="h-4 w-4 rotate-45 text-muted-foreground" /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {showNew && <NewProcessDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refresh(); }} />}
      {showRecipients && <RecipientsDialog onClose={() => setShowRecipients(false)} />}
    </div>
  );
}

// ================= DIALOG PROSES BARU =================
function NewProcessDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const { data: empData } = useApi<{ employees: { id: string; fullName: string; employeeNo: string }[] }>("/api/rekankerja/employees?pageSize=500");
  const [employeeId, setEmployeeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!employeeId) { toast.error(t("Pilih karyawan dulu", "Select an employee first")); return; }
    setBusy(true);
    try {
      await apiSend("/api/rekankerja/onboarding", "POST", { employeeId, startDate: startDate || null, note: note || null });
      toast.success(t("Proses onboarding dibuat — email checklist dikirim ke tiap bagian", "Onboarding process created — checklist email sent to each department"));
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Proses Onboarding Baru", "New Onboarding Process")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("Karyawan", "Employee")}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder={t("Pilih karyawan…", "Select an employee…")} /></SelectTrigger>
              <SelectContent>
                {(empData?.employees ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.fullName} ({e.employeeNo})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("Tanggal mulai (opsional)", "Start date (optional)")}</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("Catatan (opsional)", "Notes (optional)")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("mis. penempatan kantor pusat", "e.g. HQ placement")} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Checklist bawaan: akun user & perangkat (IT), meja & kartu akses (GA), kontrak & BPJS (HR), orientasi (Supervisor), data payroll (Payroll). Email checklist otomatis dikirim ke tiap bagian.",
              "Default checklist: user account & devices (IT), desk & access card (GA), contract & BPJS (HR), orientation (Supervisor), payroll data (Payroll). A checklist email is automatically sent to each department.",
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button onClick={() => void create()} disabled={busy}>{t("Buat & Kirim Email", "Create & Send Email")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DIALOG PENERIMA EMAIL =================
function RecipientsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data } = useApi<{ departments: { dept: string; label: string; emails: string[] }[] }>("/api/rekankerja/checklist-recipients");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // inisialisasi nilai edit saat data baru terload — derive via key reset,
  // bukan effect (react-hooks/set-state-in-effect)
  const dataKey = data?.departments.map((d) => `${d.dept}=${d.emails.join(",")}`).join("|") ?? "";
  const [initKey, setInitKey] = useState("");
  if (data && dataKey !== initKey) {
    setInitKey(dataKey);
    const init: Record<string, string> = {};
    for (const d of data.departments) init[d.dept] = d.emails.join(", ");
    setEdit(init);
  }

  async function save(dept: string) {
    setBusy(dept);
    try {
      const emails = (edit[dept] ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      await apiSend("/api/rekankerja/checklist-recipients", "PUT", { dept, emails });
      toast.success(t("Penerima email bagian {dept} disimpan", "Recipient emails for {dept} saved", { dept }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Penerima Email Checklist per Bagian", "Per-Department Checklist Recipient Emails")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t(
            "Kosong = email dikirim ke Admin/HR (fallback). Pisahkan beberapa email dengan koma.",
            "Empty = email sent to Admin/HR (fallback). Separate multiple emails with commas.",
          )}
        </p>
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {!data ? (
            <LoadingRows rows={4} />
          ) : (
            data.departments.map((d) => (
              <div key={d.dept} className="space-y-1">
                <Label className="text-xs">{d.label}</Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    value={edit[d.dept] ?? ""}
                    onChange={(e) => setEdit((p) => ({ ...p, [d.dept]: e.target.value }))}
                    placeholder={t("email1@perusahaan.com, email2@perusahaan.com", "email1@company.com, email2@company.com")}
                  />
                  <Button variant="outline" size="sm" disabled={busy === d.dept} onClick={() => void save(d.dept)}>{t("Simpan", "Save")}</Button>
                </div>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Tutup", "Close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= DETAIL =================
function OnboardingChecklistDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { navigate } = useNav();
  const { data, refresh } = useApi<{ onboarding: OnDetail; viewer: ViewerMeta; departments: DeptMeta[] }>(`/api/rekankerja/onboarding/${id}`);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [resending, setResending] = useState(false);

  const detail = data?.onboarding;
  const viewer = data?.viewer;

  const patch = useCallback(async (body: Record<string, unknown>) => {
    await apiSend(`/api/rekankerja/onboarding/${id}`, "PATCH", body);
    refresh();
  }, [id, refresh]);

  async function setTask(taskId: string, status: string) {
    setBusyTask(taskId);
    try { await patch({ action: "task", taskId, status }); } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyTask(null); }
  }

  if (!detail) {
    return <div className="p-6"><LoadingRows rows={6} /></div>;
  }

  const pct = detail.taskStats.total > 0 ? Math.round(((detail.taskStats.done + detail.taskStats.na) / detail.taskStats.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("employee", "onboarding-checklist", {})}>
          <ArrowLeft className="mr-1 h-4 w-4" /> {t("Daftar", "List")}
        </Button>
      </div>

      <PageHeader
        eyebrow={t("Checklist Onboarding", "Onboarding Checklist")}
        title={detail.employee.fullName}
        description={`${detail.employee.employeeNo} · ${detail.employee.position?.title ?? "-"} · ${detail.employee.orgUnit?.name ?? "-"}${detail.startDate ? ` · ${t("mulai", "starts")} ${fmtDate(detail.startDate)}` : ""}`}
        actions={
          viewer?.canComplete && detail.status === "Open" ? (
            <>
              <Button variant="outline" disabled={resending} onClick={async () => {
                setResending(true);
                try { await patch({ action: "resendEmail" }); toast.success(t("Email checklist dikirim ulang ke tiap bagian", "Checklist email resent to each department")); }
                catch (e) { toast.error(e instanceof Error ? e.message : t("Gagal", "Failed")); }
                finally { setResending(false); }
              }}>
                <Send className="mr-2 h-4 w-4" /> {t("Kirim Ulang Email", "Resend Email")}
              </Button>
              <Button variant="outline" onClick={async () => {
                try { await patch({ action: "cancel" }); toast.success(t("Proses dibatalkan", "Process cancelled")); }
                catch (e) { toast.error(e instanceof Error ? e.message : t("Gagal", "Failed")); }
              }}>
                <Trash2 className="mr-2 h-4 w-4" /> {t("Batalkan", "Cancel")}
              </Button>
              <Button disabled={detail.taskStats.pending > 0} onClick={async () => {
                try { await patch({ action: "complete" }); toast.success(t("Proses ditandai selesai", "Process marked complete")); }
                catch (e) { toast.error(e instanceof Error ? e.message : t("Gagal", "Failed")); }
              }}>
                <Check className="mr-2 h-4 w-4" /> {t("Tandai Selesai", "Mark Complete")}
              </Button>
            </>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="space-y-1 pt-6">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{t("Progres checklist", "Checklist progress")}</span>
            <span className="text-muted-foreground">
              {t(
                "{done} selesai · {na} N/A · {pending} menunggu — dari {total}",
                "{done} done · {na} N/A · {pending} pending — of {total}",
                { done: detail.taskStats.done, na: detail.taskStats.na, pending: detail.taskStats.pending, total: detail.taskStats.total },
              )}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t("Tugas", "Task")}</TableHead>
                <TableHead className="w-36">{t("Bagian", "Department")}</TableHead>
                <TableHead className="w-28">{t("Status", "Status")}</TableHead>
                <TableHead className="w-40">{t("Oleh", "By")}</TableHead>
                <TableHead className="w-32 text-right">{t("Aksi", "Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.tasks.map((task) => {
                // koordinator (allowedDepts null) bebas; selain itu hanya bagiannya
                const canTouch = viewer?.allowedDepts === null || (viewer?.allowedDepts ?? []).includes(task.owner ?? "");
                return (
                  <TableRow key={task.id}>
                    <TableCell className="text-muted-foreground">{task.seq}</TableCell>
                    <TableCell>
                      <div className="font-medium">{task.title}</div>
                      {task.notes && <div className="text-xs text-muted-foreground">{task.notes}</div>}
                    </TableCell>
                    <TableCell>
                      {task.owner ? <Badge variant="outline">{task.ownerLabel ?? task.owner}</Badge> : <span className="text-xs text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={task.status === "Done" ? "Completed" : task.status === "Pending" ? "Open" : "Cancelled"} />
                      <span className="sr-only">{t(STATUS_LABEL[task.status] ?? task.status, STATUS_LABEL_EN[task.status] ?? task.status)}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {task.completedByName
                        ? `${task.completedByName} (app)`
                        : task.completedVia?.startsWith("email:")
                          ? `email: ${task.completedVia.slice(6)}`
                          : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canTouch && detail.status === "Open" ? (
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="icon" className="h-7 w-7" disabled={busyTask === task.id || task.status === "Done"} title={t("Selesai", "Done")} onClick={() => void setTask(task.id, "Done")}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-7 w-7" disabled={busyTask === task.id || task.status === "Na"} title={t("Tidak berlaku", "Not applicable")} onClick={() => void setTask(task.id, "Na")}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="icon" className="h-7 w-7" disabled={busyTask === task.id || task.status === "Pending"} title={t("Kembalikan", "Reopen")} onClick={() => void setTask(task.id, "Pending")}>
                            <CircleDashed className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{detail.status !== "Open" ? t("terkunci", "locked") : t("bukan bagian Anda", "not your department")}</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showAdd && viewer?.canComplete && (
        <AddTaskDialog
          id={id}
          departments={data?.departments ?? []}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); refresh(); }}
        />
      )}
      {viewer?.canComplete && detail.status === "Open" && (
        <Button variant="ghost" onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" /> {t("Tambah Tugas", "Add Task")}
        </Button>
      )}
    </div>
  );
}

// ================= TAMBAH TUGAS =================
function AddTaskDialog({ id, departments, onClose, onAdded }: { id: string; departments: DeptMeta[]; onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!title.trim()) { toast.error(t("Judul tugas wajib diisi", "Task title is required")); return; }
    setBusy(true);
    try {
      await apiSend(`/api/rekankerja/onboarding/${id}`, "PATCH", { action: "addTask", title, owner: owner || null });
      toast.success(t("Tugas ditambahkan", "Task added"));
      onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Tambah Tugas", "Add Task")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("Judul tugas", "Task title")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("mis. Penyiapan telepon kantor", "e.g. Office phone setup")} />
          </div>
          <div className="space-y-1">
            <Label>{t("Bagian penanggung jawab", "Responsible department")}</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger><SelectValue placeholder={t("Pilih bagian…", "Select department…")} /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.dept} value={d.dept}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("Batal", "Cancel")}</Button>
          <Button disabled={busy} onClick={() => void add()}>{t("Tambah", "Add")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
