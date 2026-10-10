"use client";
// RekanKerja — Settings: Security & Akses (Pengguna, Access Group, Data Scheme)
import { useState } from "react";
import { useApi, apiSend, fmtDateTime, initials, avatarColor } from "@/rekankerja/shared/lib/api";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Loader2, UserCog, ShieldCheck, Check, X, Info, KeyRound, Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ================= types =================
interface AppUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  employeeId: string | null;
  active: boolean;
  lastLogin: string | null;
  accessGroups: { id: string; isApprover: boolean; accessGroup: { id: string; code: string; name: string } }[];
}
interface UsersResp { users: AppUser[]; employees: { id: string; fullName: string; employeeNo: string }[]; roles: string[] }

interface ModulePerm { module: string; view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }
interface AccessGroup {
  id: string;
  code: string;
  name: string;
  description: string | null;
  modulesJson: string;
  modules: ModulePerm[];
  members: { id: string; isApprover: boolean; user: { id: string; username: string; fullName: string; role: string } }[];
}
interface GroupsResp { groups: AccessGroup[]; users: { id: string; username: string; fullName: string; role: string; active: boolean }[] }

const ROLE_PILL: Record<string, string> = {
  Admin: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  "HR Manager": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  "HR Staff": "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  Approver: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  Viewer: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  ESS: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25",
};

function RolePill({ role }: { role: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", ROLE_PILL[role] ?? ROLE_PILL.Viewer)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      {role}
    </span>
  );
}

// =================================================================
export function SecurityView() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Keamanan & Akses", "Security & Access")}
        description={t("Kelola pengguna aplikasi, access group per modul, dan skema akses data berbasis posisi.", "Manage application users, per-module access groups, and position-based data access schemes.")}
      />
      <Tabs defaultValue="users" className="space-y-5">
        <TabsList className="h-12 rounded-xl ov-tile p-1">
          <TabsTrigger value="users" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <UserCog className="h-4 w-4" /> {t("Pengguna", "Users")}
          </TabsTrigger>
          <TabsTrigger value="groups" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <ShieldCheck className="h-4 w-4" /> {t("Access Group", "Access Group")}
          </TabsTrigger>
          <TabsTrigger value="scheme" className="h-10 gap-2 rounded-lg px-4 text-[13px] font-semibold data-[state=active]:ov-fill">
            <Network className="h-4 w-4" /> {t("Data Scheme", "Data Scheme")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="groups"><GroupsTab /></TabsContent>
        <TabsContent value="scheme"><DataSchemeTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// =================================================================
// TAB 1 — PENGGUNA
// =================================================================
function UsersTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<UsersResp>("/api/rekankerja/app-users");
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/app-users?id=${deleting.id}`, "DELETE");
      toast.success(t("User {u} dihapus", "User {u} deleted", { u: deleting.username }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus user", "Failed to delete user"), { description: (e as Error).message });
    }
  };

  const users = data?.users ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("{n} pengguna terdaftar.", "{n} registered users.", { n: users.length })}</p>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> {t("User Baru", "New User")}
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={6} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat pengguna", "Failed to load users")} description={error} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 shadow-sm dark:border-slate-800">
          <div className="max-h-[540px] overflow-y-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[110px]">{t("Username", "Username")}</TableHead>
                  <TableHead className="min-w-[170px]">{t("Nama Lengkap", "Full Name")}</TableHead>
                  <TableHead className="min-w-[110px]">{t("Role", "Role")}</TableHead>
                  <TableHead className="min-w-[140px]">{t("Access Group", "Access Group")}</TableHead>
                  <TableHead className="min-w-[120px]">{t("Login Terakhir", "Last Login")}</TableHead>
                  <TableHead className="min-w-[70px] text-center">{t("Aktif", "Aktif")}</TableHead>
                  <TableHead className="w-24" aria-label={t("Aksi", "Actions")} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className={cn("group", !u.active && "opacity-55")}>
                    <TableCell className="py-3">
                      <span className="flex items-center gap-2">
                        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", avatarColor(u.fullName))}>{initials(u.fullName)}</span>
                        <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300">{u.username}</span>
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      <p className="text-[13px] font-semibold">{u.fullName}</p>
                      {u.email && <p className="text-[11px] text-slate-400">{u.email}</p>}
                    </TableCell>
                    <TableCell className="py-3"><RolePill role={u.role} /></TableCell>
                    <TableCell className="py-3">
                      <span className="flex flex-wrap gap-1">
                        {u.accessGroups.length === 0 && <span className="text-xs text-slate-400">—</span>}
                        {u.accessGroups.map((g) => (
                          <Badge key={g.id} variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-2 text-[10px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                            {g.accessGroup.code}{g.isApprover ? " ★" : ""}
                          </Badge>
                        ))}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-xs text-slate-500">{fmtDateTime(u.lastLogin)}</TableCell>
                    <TableCell className="py-3 text-center">
                      {u.active ? <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <X className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" />}
                    </TableCell>
                    <TableCell className="py-3">
                      <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-emerald-600" onClick={() => setEditing(u)} aria-label={t("Edit {name}", "Edit {name}", { name: u.username })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(u)} disabled={u.username === "MII000001"} aria-label={t("Hapus {name}", "Delete {name}", { name: u.username })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <UserDialog
          initial={editing}
          employees={data?.employees ?? []}
          roles={data?.roles ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={refresh}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus User?", "Delete User?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("User ", "User ")}<b>{deleting?.fullName} ({deleting?.username})</b>{t(" akan dihapus permanen beserta keanggotaan access group-nya.", " will be permanently deleted along with their access group memberships.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus", "Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserDialog({ initial, employees, roles, onClose, onDone }: { initial: AppUser | null; employees: { id: string; fullName: string; employeeNo: string }[]; roles: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initial?.username ?? "");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [role, setRole] = useState(initial?.role ?? "HR Staff");
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? "none");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username.trim() || !fullName.trim()) {
      toast.error(t("Username dan nama lengkap wajib diisi", "Username and full name are required"));
      return;
    }
    setBusy(true);
    const body = {
      username: username.trim().toUpperCase(),
      fullName: fullName.trim(),
      email: email.trim() || null,
      role,
      employeeId: employeeId === "none" ? null : employeeId,
      active,
    };
    try {
      if (initial) {
        await apiSend(`/api/rekankerja/app-users?id=${initial.id}`, "PATCH", body);
        toast.success(t("User {u} diperbarui", "User {u} updated", { u: body.username }));
      } else {
        await apiSend("/api/rekankerja/app-users", "POST", body);
        toast.success(t("User {u} dibuat", "User {u} created", { u: body.username }));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(t("Gagal menyimpan user", "Failed to save user"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white">
              <KeyRound className="h-4.5 w-4.5" />
            </span>
            {initial ? t("Edit User — {u}", "Edit User — {u}", { u: initial.username }) : t("User Baru", "New User")}
          </DialogTitle>
          <DialogDescription>{t("Akun untuk mengakses RekanKerja HR Suite.", "Account for accessing RekanKerja HR Suite.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="au-username">{t("Username", "Username")} <span className="text-rose-500">*</span></Label>
              <Input id="au-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="MII000007" className="h-11 font-mono" disabled={!!initial} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="au-fullname">{t("Nama Lengkap", "Full Name")} <span className="text-rose-500">*</span></Label>
              <Input id="au-fullname" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("Nama karyawan", "Employee name")} className="h-11" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="au-email">{t("Email", "Email")}</Label>
            <Input id="au-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@mii.co.id" className="h-11" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("Role", "Role")}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => <SelectItem key={r} value={r} className="py-2.5">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("Karyawan Terkait", "Linked Employee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="h-11 w-full"><SelectValue placeholder={t("Tanpa kaitan karyawan", "No linked employee")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none" className="py-2.5">{t("Tanpa kaitan karyawan", "No linked employee")}</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <span className="font-mono text-xs text-slate-400">{e.employeeNo}</span> · {e.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch id="au-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="au-active" className="text-xs font-normal text-slate-500">{t("Akun aktif", "Active account")}</Label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">{t("Batal", "Cancel")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 bg-emerald-600 px-6 font-bold hover:bg-emerald-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// TAB 2 — ACCESS GROUP
// =================================================================
const PERM_COLS: { key: keyof Omit<ModulePerm, "module">; label: string }[] = [
  { key: "view", label: "Lihat" },
  { key: "create", label: "Buat" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Hapus" },
  { key: "approve", label: "Approve" },
];
// Peta EN paralel label kolom izin (label ID tetap sebagai key t()).
const PERM_LABEL_EN: Record<string, string> = { Lihat: "View", Buat: "Create", Edit: "Edit", Hapus: "Delete", Approve: "Approve" };
const DEFAULT_MODULES = ["HR Base", "Payroll", "Medical", "Travel", "LTA", "PA", "Other"];

function GroupsTab() {
  const { t } = useI18n();
  const { data, loading, error, refresh } = useApi<GroupsResp>("/api/rekankerja/access-groups");
  const [editing, setEditing] = useState<AccessGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AccessGroup | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiSend(`/api/rekankerja/access-groups?id=${deleting.id}`, "DELETE");
      toast.success(t("Group {code} dihapus", "Group {code} deleted", { code: deleting.code }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error(t("Gagal menghapus group", "Failed to delete group"), { description: (e as Error).message });
    }
  };

  const groups = data?.groups ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("{n} access group — matriks izin per modul.", "{n} access groups — per-module permission matrix.", { n: groups.length })}</p>
        <Button onClick={() => setCreating(true)} className="h-11 gap-2 bg-emerald-600 px-5 font-bold hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> {t("Group Baru", "New Group")}
        </Button>
      </div>

      {loading ? (
        <LoadingRows rows={4} />
      ) : error ? (
        <EmptyState title={t("Gagal memuat access group", "Failed to load access groups")} description={error} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {groups.map((g) => (
            <article key={g.id} className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-md shadow-teal-600/20">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-[15px] font-bold text-slate-900 dark:text-slate-50">{g.name}</h3>
                      <p className="font-mono text-[11px] text-slate-400">{g.code} · {t("{n} anggota", "{n} members", { n: g.members.length })}</p>
                    </div>
                  </div>
                  {g.description && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{g.description}</p>}
                </div>
                <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-emerald-600" onClick={() => setEditing(g)} aria-label={t("Edit {code}", "Edit {code}", { code: g.code })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setDeleting(g)} aria-label={t("Hapus {code}", "Delete {code}", { code: g.code })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* permission matrix */}
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/70 dark:border-slate-700/60">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-[11px]">{t("Modul", "Module")}</TableHead>
                      {PERM_COLS.map((c) => <TableHead key={c.key} className="text-center text-[11px]">{t(c.label, PERM_LABEL_EN[c.label] ?? c.label)}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.modules.map((m) => (
                      <TableRow key={m.module}>
                        <TableCell className="py-2 text-xs font-semibold">{m.module}</TableCell>
                        {PERM_COLS.map((c) => (
                          <TableCell key={c.key} className="py-2 text-center">
                            {m[c.key]
                              ? <Check className="mx-auto h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-label={`${m.module} ${t(c.label, PERM_LABEL_EN[c.label] ?? c.label)}: ${t("ya", "yes")}`} />
                              : <span className="text-slate-300 dark:text-slate-700" aria-label={`${m.module} ${t(c.label, PERM_LABEL_EN[c.label] ?? c.label)}: ${t("tidak", "no")}`}>·</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* members */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t("Anggota:", "Members:")}</span>
                {g.members.length === 0 && <span className="text-xs text-slate-400">{t("belum ada", "none yet")}</span>}
                {g.members.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-0.5 pl-0.5 pr-2.5 dark:border-slate-700 dark:bg-slate-800/60" title={`${m.user.fullName} · ${m.user.role}`}>
                    <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold", avatarColor(m.user.fullName))}>{initials(m.user.fullName)}</span>
                    <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{m.user.fullName.split(" ")[0]}</span>
                    {m.isApprover && <span className="text-[9px] text-amber-500">★</span>}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <GroupDialog
          initial={editing}
          users={data?.users ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={refresh}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Hapus Access Group?", "Delete Access Group?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Group ", "Group ")}<b>{deleting?.name} ({deleting?.code})</b>{t(" dan semua keanggotaannya akan dihapus.", " and all of its memberships will be deleted.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="h-11 bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus", "Delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GroupDialog({ initial, users, onClose, onDone }: { initial: AccessGroup | null; users: { id: string; username: string; fullName: string; role: string; active: boolean }[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [modules, setModules] = useState<ModulePerm[]>(
    initial?.modules?.length
      ? initial.modules
      : DEFAULT_MODULES.map((m) => ({ module: m, view: true, create: false, edit: false, delete: false, approve: false }))
  );
  const [memberIds, setMemberIds] = useState<string[]>(initial?.members.map((m) => m.user.id) ?? []);
  const [busy, setBusy] = useState(false);

  const togglePerm = (idx: number, key: keyof Omit<ModulePerm, "module">) => {
    setModules((ms) => ms.map((m, i) => (i === idx ? { ...m, [key]: !m[key] } : m)));
  };
  const toggleMember = (id: string) => {
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const submit = async () => {
    if (!code.trim() || !name.trim()) {
      toast.error(t("Kode dan nama group wajib diisi", "Group code and name are required"));
      return;
    }
    setBusy(true);
    const body = { code: code.trim().toUpperCase(), name: name.trim(), description: description.trim() || null, modules, memberIds };
    try {
      if (initial) {
        await apiSend(`/api/rekankerja/access-groups?id=${initial.id}`, "PATCH", body);
        toast.success(t("Group {code} diperbarui", "Group {code} updated", { code: body.code }));
      } else {
        await apiSend("/api/rekankerja/access-groups", "POST", body);
        toast.success(t("Group {code} dibuat", "Group {code} created", { code: body.code }));
      }
      onDone();
      onClose();
    } catch (e) {
      toast.error(t("Gagal menyimpan group", "Failed to save group"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? t("Edit Access Group — {code}", "Edit Access Group — {code}", { code: initial.code }) : t("Access Group Baru", "New Access Group")}</DialogTitle>
          <DialogDescription>{t("Atur matriks izin per modul dan anggota group.", "Configure the per-module permission matrix and group members.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ag-code">{t("Kode", "Code")} <span className="text-rose-500">*</span></Label>
            <Input id="ag-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AG-HR" className="h-11 font-mono" disabled={!!initial} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ag-name">{t("Nama", "Name")} <span className="text-rose-500">*</span></Label>
            <Input id="ag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="HR Administrator" className="h-11" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ag-desc">{t("Deskripsi", "Description")}</Label>
            <Input id="ag-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Full access HR Base module" className="h-11" />
          </div>
        </div>

        {/* matrix editor */}
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("Matriks Izin Modul", "Module Permission Matrix")}</Label>
          <div className="overflow-hidden rounded-xl border border-slate-200/70 dark:border-slate-700/60">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px]">{t("Modul", "Module")}</TableHead>
                  {PERM_COLS.map((c) => <TableHead key={c.key} className="text-center text-[11px]">{t(c.label, PERM_LABEL_EN[c.label] ?? c.label)}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((m, idx) => (
                  <TableRow key={m.module}>
                    <TableCell className="py-2 text-xs font-semibold">{m.module}</TableCell>
                    {PERM_COLS.map((c) => (
                      <TableCell key={c.key} className="py-2 text-center">
                        <button
                          onClick={() => togglePerm(idx, c.key)}
                          role="checkbox"
                          aria-checked={m[c.key]}
                          aria-label={`${m.module} ${t(c.label, PERM_LABEL_EN[c.label] ?? c.label)}`}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-md border transition-colors mx-auto",
                            m[c.key]
                              ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600"
                              : "border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600"
                          )}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* members */}
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("Anggota ({n})", "Members ({n})", { n: memberIds.length })}</Label>
          <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-xl border border-slate-200/70 p-2 dark:border-slate-700/60 sm:grid-cols-2">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => toggleMember(u.id)}
                role="checkbox"
                aria-checked={memberIds.includes(u.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                  memberIds.includes(u.id) ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300" : "hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold", avatarColor(u.fullName))}>{initials(u.fullName)}</span>
                <span className="min-w-0 flex-1 truncate">{u.fullName}</span>
                <span className="font-mono text-[10px] text-slate-400">{u.username}</span>
                {memberIds.includes(u.id) && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy} className="h-11 px-5">{t("Batal", "Cancel")}</Button>
          <Button onClick={() => void submit()} disabled={busy} className="h-11 bg-emerald-600 px-6 font-bold hover:bg-emerald-700">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Simpan", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
// TAB 3 — DATA SCHEME (illustrative)
// =================================================================
const SCHEME_RULES: { title: string; scope: string; desc: string; icon: React.ElementType }[] = [
  { title: "Akses Berdasarkan Posisi", scope: "Position-based", desc: "Data karyawan hanya terlihat untuk bawahan langsung dan satu tingkat di atas dalam struktur pelaporan (manager tree).", icon: Network },
  { title: "Akses Berdasarkan Unit", scope: "OrgUnit-based", desc: "HR Staff unit HRD dapat melihat seluruh karyawan; Approver hanya melihat unit yang diampu (mis. PRD untuk Dept Head Produksi).", icon: ShieldCheck },
  { title: "Akses Berdasarkan Grade", scope: "Grade structure", desc: "Data gaji (baseSalary, komponen upah) hanya terbuka untuk grade di atas level karyawan — pola data masking bertingkat.", icon: KeyRound },
];
// Peta EN paralel untuk kartu skema (judul & deskripsi ID tetap sebagai key t()).
const SCHEME_TITLE_EN: Record<string, string> = {
  "Akses Berdasarkan Posisi": "Access by Position",
  "Akses Berdasarkan Unit": "Access by Unit",
  "Akses Berdasarkan Grade": "Access by Grade",
};
const SCHEME_DESC_EN: Record<string, string> = {
  "Akses Berdasarkan Posisi": "Employee data is only visible to direct reports and one level above in the reporting structure (manager tree).",
  "Akses Berdasarkan Unit": "HR Staff in the HRD unit can see all employees; Approvers only see the units they oversee (e.g. PRD for the Production Dept Head).",
  "Akses Berdasarkan Grade": "Salary data (baseSalary, wage components) is only exposed to grades above the employee's level — a tiered data-masking pattern.",
};

function DataSchemeTab() {
  const { t } = useI18n();
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {SCHEME_RULES.map((r) => {
        const Icon = r.icon;
        return (
          <article key={r.title} className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50/60 p-5 shadow-sm dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900/20">
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md dark:from-slate-500 dark:to-slate-700">
                <Icon className="h-5 w-5" />
              </span>
              <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">{t("ILUSTRASI", "ILLUSTRATION")}</Badge>
            </div>
            <h3 className="mt-3 text-[15px] font-bold text-slate-900 dark:text-slate-50">{t(r.title, SCHEME_TITLE_EN[r.title] ?? r.title)}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-slate-400">{r.scope}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{t(r.desc, SCHEME_DESC_EN[r.title] ?? r.desc)}</p>
          </article>
        );
      })}
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5 lg:col-span-3 dark:border-slate-700 dark:bg-slate-900/30">
        <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {t("Halaman ini menampilkan skema akses data secara statis sebagai ilustrasi perilaku OranHR Scheme Setup (Company Office / Position / Grade Structure). Konfigurasi aktif ditentukan oleh kombinasi ", "This page presents the data access scheme statically as an illustration of OranHR Scheme Setup behavior (Company Office / Position / Grade Structure). The active configuration is determined by the combination of ")}<b className="text-slate-700 dark:text-slate-300">{t("access group", "access group")}</b> + <b className="text-slate-700 dark:text-slate-300">{t("posisi jabatan", "job position")}</b>{t(" masing-masing pengguna.", " for each user.")}
        </p>
      </div>
    </div>
  );
}
