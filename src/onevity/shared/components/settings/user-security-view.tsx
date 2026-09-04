"use client";
// OneVity — Settings: PENGGUNA + KEBIJAKAN KATA SANDI (Task 33) ============
// =====================================================================
// Tab Pengguna (Keamanan & Akses):
//   • TAMBAH PENGGUNA — dialog lengkap: identitas + role + tautan karyawan
//     + kata sandi awal divalidasi KEBIJAKAN (checklist live + meter). Membuat
//     AppUser tenant + akun login platform (email+sandi) sekaligus — pengguna
//     baru bisa langsung masuk.
//   • RESET KATA SANDI per pengguna — tervalidasi kebijakan + RIWAYAT
//     (tidak boleh sama dengan N sandi terakhir).
//   • Kolom umur kata sandi (lifetime) + hapus pengguna.
// Tab Kebijakan Kata Sandi:
//   • Editor aturan lengkap (kompleksitas / umur & riwayat / lockout login)
//     + kartu UJI CODO live terhadap kebijakan saat ini.
// Tombol aksi ter-gate hak aksi menu per pengguna (settings:security).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, initials } from "@/onevity/shared/lib/api";
import { EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
import { PasswordInput, PasswordRuleChecklist, PasswordStrengthBar } from "@/onevity/shared/components/password-ui";
import { actionAllowed, type MenuAction, type MenusMap } from "@/onevity/shared/lib/menu-perms";
import {
  DEFAULT_PASSWORD_POLICY,
  passwordAge,
  type PasswordPolicyData,
} from "@/onevity/shared/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCog, Eye, CalendarClock, History,
  Lock, Gauge, Save, RotateCcw, FlaskConical, UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_ROLES = ["Admin", "HR Manager", "HR Staff", "Approver", "Viewer"] as const;

const ROLE_TONE: Record<string, string> = {
  Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
  "HR Manager": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400",
  Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  Viewer: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
};

// ---------- hak aksi menu (per pengguna, Task 32) ----------

interface MeAccess { all: boolean; menus: string[]; perms?: MenusMap; isSuperAdmin: boolean }

function useSecurityActions() {
  const { data: me } = useApi<MeAccess>("/api/onevity/user-menu-access?action=me");
  return useMemo(() => {
    const perm = me?.perms?.["settings:security"];
    const can = (a: MenuAction) =>
      me == null ? false : me.all || (perm != null && perm.view && actionAllowed(perm, a));
    return { me, can };
  }, [me]);
}

// ---------- tipe data ----------

interface AppUserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  active: boolean;
  lastLogin: string | null;
  employeeId: string | null;
  passwordChangedAt: string | null;
  groups: { name: string; code: string }[];
}
interface AppUserData { users: AppUserRow[] }
interface EmployeeOption { id: string; fullName: string; employeeNo: string; status: string }

/** respons policy membawa updatedAt (string) dari DB */
type PolicyWithStamp = PasswordPolicyData & { updatedAt?: string };

// =====================================================================
// PANEL PENGGUNA
// =====================================================================

export function UsersPanel({ onConfigureAccess }: { onConfigureAccess: (userId: string) => void }) {
  const { data, loading, refresh } = useApi<AppUserData>("/api/onevity/app-users");
  const { data: policyData } = useApi<{ policy: PolicyWithStamp }>("/api/onevity/password-policy");
  const { data: empData } = useApi<{ employees: EmployeeOption[] }>("/api/onevity/employees?limit=200", [data]);
  const { can } = useSecurityActions();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AppUserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<AppUserRow | null>(null);
  const [deleting, setDeleting] = useState<AppUserRow | null>(null);

  const policy = policyData?.policy ?? DEFAULT_PASSWORD_POLICY;
  const employees = empData?.employees ?? [];
  const users = data?.users ?? [];

  const removeUser = async (u: AppUserRow) => {
    try {
      await apiSend(`/api/onevity/app-users?id=${u.id}`, "DELETE");
      toast.success(`Pengguna ${u.fullName} dihapus`);
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
      <div className="flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-2.5 border-b border-stone-200/80 px-6 pb-3 pt-6 dark:border-stone-800/80">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <UserCog className="h-4 w-4 ov-text-accent" /> Pengguna Aplikasi ({users.length})
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
            <History className="h-3 w-3" /> riwayat {policy.historyCount} sandi · umur {policy.lifetimeDays} hari
          </Badge>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={!can("create")}
            title={can("create") ? "Tambah pengguna aplikasi baru" : "Anda tidak memiliki aksi Baru pada menu ini"}
            className="h-8 gap-1.5 rounded-xl px-3 text-xs font-bold"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah Pengguna
          </Button>
        </div>
      </div>
      <CardContent className="pt-0">
        {users.length === 0 ? (
          <EmptyState title="Belum ada pengguna aplikasi" description="Tambahkan pengguna pertama untuk workspace ini." icon={UserCog} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                  <TableHead className="text-[11px] font-bold">Pengguna</TableHead>
                  <TableHead className="text-[11px] font-bold">Role</TableHead>
                  <TableHead className="text-[11px] font-bold">Login Terakhir</TableHead>
                  <TableHead className="text-[11px] font-bold">Kata Sandi</TableHead>
                  <TableHead className="text-[11px] font-bold">Status</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const age = passwordAge(u.passwordChangedAt, policy);
                  const linked = employees.find((e) => e.id === u.employeeId);
                  return (
                    <TableRow key={u.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-extrabold",
                            u.active
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : "bg-stone-100 text-stone-400 dark:bg-stone-800",
                          )}>{initials(u.fullName)}</span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[13px] font-bold">
                              {u.fullName}
                              <span className="font-mono text-[10px] font-normal text-stone-400">{u.username}</span>
                            </p>
                            <p className="truncate text-[10px] text-stone-400">
                              {u.email ?? "— tanpa email"}
                              {linked ? ` · ${linked.employeeNo}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold", ROLE_TONE[u.role] ?? "")}>{u.role}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-stone-500">
                        {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "Belum pernah"}
                      </TableCell>
                      <TableCell>
                        {u.passwordChangedAt ? (
                          <span
                            title={`Terakhir disetel: ${new Date(u.passwordChangedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} · kebijakan: umur ${policy.lifetimeDays} hari`}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                              age.expired
                                ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
                                : age.warn
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                  : "border-stone-200 bg-stone-50 text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
                            )}
                          >
                            <CalendarClock className="h-3 w-3" /> {age.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-stone-400">— belum disetel</span>
                        )}
                      </TableCell>
                      <TableCell><StatusPill status={u.active ? "Active" : "Cancelled"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <button
                            onClick={() => onConfigureAccess(u.id)}
                            className="rounded-lg p-1.5 text-stone-400 transition hover:ov-soft"
                            aria-label={`Atur hak akses ${u.fullName}`}
                            title="Atur hak akses (menu & data)"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditing(u)}
                            disabled={!can("update")}
                            title={can("update") ? "Edit pengguna" : "Tanpa aksi Ubah pada menu ini"}
                            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 disabled:opacity-30 dark:hover:bg-stone-800"
                            aria-label={`Edit ${u.fullName}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setResetTarget(u)}
                            disabled={!can("update") || !u.email}
                            title={!u.email ? "Pengguna tanpa email tidak punya akun login" : can("update") ? "Reset kata sandi (kebijakan + riwayat)" : "Tanpa aksi Ubah pada menu ini"}
                            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-30 dark:hover:bg-amber-500/10"
                            aria-label={`Reset kata sandi ${u.fullName}`}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleting(u)}
                            disabled={!can("delete")}
                            title={can("delete") ? "Hapus pengguna" : "Tanpa aksi Hapus pada menu ini"}
                            className="rounded-lg p-1.5 text-stone-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30 dark:hover:bg-rose-500/10"
                            aria-label={`Hapus ${u.fullName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* dialog tambah / edit / reset / hapus */}
      <UserCreateDialog
        open={createOpen}
        onClose={(saved) => { setCreateOpen(false); if (saved) refresh(); }}
        policy={policy}
        employees={employees}
      />
      <UserEditDialog
        user={editing}
        employees={employees}
        onClose={(saved) => { setEditing(null); if (saved) refresh(); }}
      />
      <ResetPasswordDialog
        user={resetTarget}
        policy={policy}
        onClose={(saved) => { setResetTarget(null); if (saved) refresh(); }}
      />
      <Dialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4 text-rose-500" /> Hapus Pengguna
            </DialogTitle>
            <DialogDescription>
              Pengguna <b>{deleting?.fullName}</b> ({deleting?.username}) akan dihapus dari workspace ini.
              Akun login platform &amp; membership workspace tetap dipertahankan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Batal</Button>
            <Button onClick={() => deleting && removeUser(deleting)} className="bg-rose-600 font-bold hover:bg-rose-700">Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =====================================================================
// DIALOG TAMBAH PENGGUNA
// =====================================================================

function UserCreateDialog({
  open, onClose, policy, employees,
}: {
  open: boolean;
  onClose: (saved: boolean) => void;
  policy: PasswordPolicyData;
  employees: EmployeeOption[];
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("Viewer");
  const [employeeId, setEmployeeId] = useState<string>("none");
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  // reset formulir saat dibuka
  useEffect(() => {
    if (open) {
      setFullName(""); setUsername(""); setEmail(""); setRole("Viewer");
      setEmployeeId("none"); setActive(true); setPassword(""); setConfirm("");
      setServerErrors([]); setServerError(null);
    }
  }, [open]);

  // pratinjau username otomatis dari nama (bila belum disentuh)
  const [usernameTouched, setUsernameTouched] = useState(false);
  const autoUsername = fullName.trim().toLowerCase().split(/\s+/).slice(0, 2).join(".");
  const effUsername = usernameTouched ? username : autoUsername;

  const localIssues: string[] = [];
  if (!fullName.trim()) localIssues.push("Nama lengkap wajib diisi");
  if (effUsername.trim().length < 3) localIssues.push("Username minimal 3 karakter");
  if (!EMAIL_RE.test(email.trim())) localIssues.push("Email login wajib diisi dengan format valid");
  if (password !== confirm) localIssues.push("Konfirmasi kata sandi tidak sama");

  const submit = async () => {
    if (busy) return;
    setServerErrors([]); setServerError(null);
    if (localIssues.length > 0) { setServerErrors(localIssues); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "POST", {
        username: effUsername.trim(),
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        employeeId: employeeId === "none" ? null : employeeId,
        active,
        password,
      });
      toast.success(`Pengguna ${fullName.trim()} dibuat — akun login ${email.trim()} siap dipakai`);
      onClose(true);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setServerError(err.message);
      setServerErrors(err.details ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 ov-text-accent" /> Tambah Pengguna
          </DialogTitle>
          <DialogDescription>
            Pengguna aplikasi workspace ini + akun login (email &amp; kata sandi awal divalidasi kebijakan kata sandi).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Nama Lengkap *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="cth: Dewi Lestari" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Username *</Label>
            <div className="flex items-center gap-1.5">
              <Input
                value={effUsername}
                onChange={(e) => { setUsernameTouched(true); setUsername(e.target.value); }}
                placeholder="dewi.lestari"
                className="font-mono text-xs"
              />
              {usernameTouched && (
                <button
                  type="button"
                  onClick={() => setUsernameTouched(false)}
                  title="Kembali ke usulan otomatis dari nama"
                  className="shrink-0 rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
                  aria-label="Usulkan username otomatis"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email Login *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dewi@mii.co.id" />
            <p className="text-[10px] text-stone-400">Dipakai untuk masuk (account SaaS) — harus belum terdaftar.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role Aplikasi</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APP_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">Tautkan ke Karyawan (opsional)</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">— tanpa tautan karyawan —</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employeeNo} · {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-stone-400">Pengguna terkait otomatis mengakses data dirinya (tanpa perlu rule).</p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 dark:border-stone-800 sm:col-span-2">
            <div>
              <p className="text-xs font-bold">Status Aktif</p>
              <p className="text-[10px] text-stone-400">Pengguna non-aktif tidak tampil sebagai konfigurasi aktif.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Status aktif" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kata Sandi Awal *</Label>
            <PasswordInput value={password} onChange={setPassword} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Konfirmasi Kata Sandi *</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600 dark:text-stone-300">
            <ShieldCheck className="h-3.5 w-3.5 ov-text-accent" /> Validasi Kebijakan Kata Sandi
          </p>
          <PasswordStrengthBar password={password} />
          <PasswordRuleChecklist
            policy={policy}
            password={password}
            username={effUsername || null}
            fullName={fullName || null}
            email={email || null}
            compact
          />
          {password !== confirm && confirm.length > 0 && (
            <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Konfirmasi kata sandi tidak sama.</p>
          )}
        </div>

        {(serverError || serverErrors.length > 0) && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{serverError ?? "Periksa kembali isian:"}</p>
            {serverErrors.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {serverErrors.map((d, i) => <li key={i} className="text-[11px] text-rose-600 dark:text-rose-400">{d}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">
            {busy ? "Menyimpan…" : "Buat Pengguna"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// DIALOG EDIT PENGGUNA (nama / email / role / tautan karyawan / status)
// =====================================================================

function UserEditDialog({
  user, employees, onClose,
}: {
  user: AppUserRow | null;
  employees: EmployeeOption[];
  onClose: (saved: boolean) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Viewer");
  const [employeeId, setEmployeeId] = useState("none");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const uKey = user?.id ?? "none";
  if (key !== uKey) {
    setKey(uKey);
    setFullName(user?.fullName ?? "");
    setEmail(user?.email ?? "");
    setRole(user?.role ?? "Viewer");
    setEmployeeId(user?.employeeId ?? "none");
    setActive(user?.active ?? true);
    setError(null);
  }

  const submit = async () => {
    if (!user || busy) return;
    if (!fullName.trim()) { setError("Nama wajib diisi"); return; }
    setBusy(true); setError(null);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", {
        id: user.id,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        employeeId: employeeId === "none" ? null : employeeId,
        active,
      });
      toast.success("Pengguna diperbarui");
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Pengguna — {user?.username}</DialogTitle>
          <DialogDescription>Hak akses menu &amp; data diatur di tab Hak Akses per Pengguna.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Nama Lengkap</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email Login</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APP_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tautan Karyawan</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">— tanpa tautan —</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 dark:border-stone-800">
            <div>
              <p className="text-xs font-bold">Status Aktif</p>
              <p className="text-[10px] text-stone-400">{user?.active ? "Pengguna aktif" : "Saat ini non-aktif"}</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Status aktif" />
          </div>
          {error && <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// DIALOG RESET KATA SANDI (admin, per pengguna)
// =====================================================================

function ResetPasswordDialog({
  user, policy, onClose,
}: {
  user: AppUserRow | null;
  policy: PasswordPolicyData;
  onClose: (saved: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  useEffect(() => {
    if (user) { setPassword(""); setConfirm(""); setServerError(null); setServerErrors([]); }
  }, [user]);

  const submit = async () => {
    if (!user || busy) return;
    setServerError(null); setServerErrors([]);
    if (password !== confirm) { setServerError("Konfirmasi kata sandi tidak sama"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", { id: user.id, password });
      toast.success(`Kata sandi ${user.fullName} direset`);
      onClose(true);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setServerError(err.message);
      setServerErrors(err.details ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-amber-600" /> Reset Kata Sandi
          </DialogTitle>
          <DialogDescription>
            Pengguna <b>{user?.fullName}</b> ({user?.username}) akan memakai kata sandi baru saat masuk berikutnya.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Kata Sandi Baru *</Label>
            <PasswordInput value={password} onChange={setPassword} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Konfirmasi *</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>

          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-stone-600 dark:text-stone-300">
              <History className="h-3.5 w-3.5 ov-text-accent" />
              Tidak boleh sama dengan {policy.historyCount} kata sandi terakhir pengguna ini
            </p>
            <PasswordStrengthBar password={password} />
            <PasswordRuleChecklist
              policy={policy}
              password={password}
              username={user?.username ?? null}
              fullName={user?.fullName ?? null}
              email={user?.email ?? null}
              compact
            />
          </div>

          {(serverError || serverErrors.length > 0) && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{serverError ?? "Periksa kembali:"}</p>
              {serverErrors.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {serverErrors.map((d, i) => <li key={i} className="text-[11px] text-rose-600 dark:text-rose-400">{d}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-amber-600 font-bold hover:bg-amber-700">{busy ? "Meriset…" : "Reset Kata Sandi"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// PANEL KEBIJAKAN KATA SANDI
// =====================================================================

type PolicyDraft = PasswordPolicyData;

function policyDraftOf(p: PasswordPolicyData): PolicyDraft {
  return { ...p };
}

export function PasswordPolicyPanel() {
  const { data, loading, refresh } = useApi<{ policy: PolicyWithStamp }>("/api/onevity/password-policy");
  const { can } = useSecurityActions();

  const [draft, setDraft] = useState<PolicyDraft>(policyDraftOf(DEFAULT_PASSWORD_POLICY));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPassword, setTestPassword] = useState("");
  const [testUsername, setTestUsername] = useState("");
  const [testName, setTestName] = useState("");
  const [loadKey, setLoadKey] = useState("");

  const policy: PolicyWithStamp = data?.policy ?? DEFAULT_PASSWORD_POLICY;
  const dataKey = data ? String(policy.updatedAt ?? "loaded") : "";
  if (data && loadKey !== dataKey) {
    setLoadKey(dataKey);
    setDraft(policyDraftOf(policy));
    setDirty(false);
  }

  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const crossValid = draft.minLength <= draft.maxLength && (draft.lifetimeDays === 0 || draft.warnDays <= draft.lifetimeDays);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiSend("/api/onevity/password-policy", "PUT", draft);
      toast.success("Kebijakan kata sandi tersimpan");
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {/* ---- seksi 1: kompleksitas ---- */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Gauge className="h-4 w-4 ov-text-accent" /> Kompleksitas &amp; Kombinasi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label="Panjang Minimum" value={draft.minLength} onChange={(v) => set("minLength", v)} min={4} max={draft.maxLength} suffix="karakter" />
              <PolicyNumber label="Panjang Maksimum" value={draft.maxLength} onChange={(v) => set("maxLength", v)} min={draft.minLength} max={128} suffix="karakter" />
              <PolicyNumber label="Karakter Unik Minimum" value={draft.minUniqueChars} onChange={(v) => set("minUniqueChars", v)} min={0} max={32} suffix="beda" />
              <PolicyNumber label="Maks. Karakter Sama Berturut" value={draft.maxRepeated} onChange={(v) => set("maxRepeated", v)} min={0} max={16} suffix="kali (aaa)" />
              <PolicyNumber label="Maks. Karakter Berurutan" value={draft.maxSequential} onChange={(v) => set("maxSequential", v)} min={0} max={16} suffix="kali (abc)" />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <PolicySwitch label="Wajib huruf besar (A–Z)" checked={draft.requireUppercase} onChange={(v) => set("requireUppercase", v)} />
              <PolicySwitch label="Wajib huruf kecil (a–z)" checked={draft.requireLowercase} onChange={(v) => set("requireLowercase", v)} />
              <PolicySwitch label="Wajib angka (0–9)" checked={draft.requireNumber} onChange={(v) => set("requireNumber", v)} />
              <PolicySwitch label="Wajib karakter khusus (!@#$…)" checked={draft.requireSpecial} onChange={(v) => set("requireSpecial", v)} />
              <PolicySwitch label="Larang memuat username / email" checked={draft.blockUsername} onChange={(v) => set("blockUsername", v)} />
              <PolicySwitch label="Larang memuat nama pengguna" checked={draft.blockName} onChange={(v) => set("blockName", v)} />
              <PolicySwitch label="Larang kata sandi umum (password, qwerty…)" checked={draft.blockCommon} onChange={(v) => set("blockCommon", v)} />
            </div>
          </CardContent>
        </Card>

        {/* ---- seksi 2: umur & riwayat ---- */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <CalendarClock className="h-4 w-4 ov-text-accent" /> Umur &amp; Riwayat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label="Masa Berlaku (Lifetime)" value={draft.lifetimeDays} onChange={(v) => set("lifetimeDays", v)} min={0} max={730} suffix="hari (0 = tanpa batas)" />
              <PolicyNumber label="Peringatan Sebelum Kedaluwarsa" value={draft.warnDays} onChange={(v) => set("warnDays", v)} min={0} max={draft.lifetimeDays || 90} suffix="hari sebelumnya" />
              <PolicyNumber label="Larangan Riwayat" value={draft.historyCount} onChange={(v) => set("historyCount", v)} min={0} max={24} suffix="sandi terakhir" />
            </div>
            <p className="rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400">
              Kata sandi baru tidak boleh sama dengan <b>{draft.historyCount}</b> sandi terakhir pengguna tersebut;
              umur sandi dihitung sejak terakhir disetel/direset — tabel Pengguna menampilkan sisa masa berlaku.
            </p>
          </CardContent>
        </Card>

        {/* ---- seksi 3: lockout ---- */}
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Lock className="h-4 w-4 ov-text-accent" /> Percobaan Login Gagal
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label="Batas Percobaan Gagal" value={draft.maxFailedAttempts} onChange={(v) => set("maxFailedAttempts", v)} min={0} max={20} suffix="kali" />
              <PolicyNumber label="Durasi Kunci Akun" value={draft.lockoutMinutes} onChange={(v) => set("lockoutMinutes", v)} min={0} max={720} suffix="menit" />
            </div>
            <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400">
              Melewati batas → akun terkunci sementara (login ditolak sampai waktu habis atau admin mereset sandi).
            </p>
          </CardContent>
        </Card>

        {/* aksi simpan */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={save}
            disabled={!dirty || saving || !crossValid || !can("update")}
            title={!can("update") ? "Anda tidak memiliki aksi Ubah pada menu ini" : undefined}
            className="gap-2 font-bold"
          >
            <Save className="h-4 w-4" /> {saving ? "Menyimpan…" : dirty ? "Simpan Kebijakan" : "Tersimpan"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setDraft(policyDraftOf(DEFAULT_PASSWORD_POLICY)); setDirty(true); }}
            disabled={!can("update")}
            className="gap-2 font-semibold"
          >
            <RotateCcw className="h-4 w-4" /> Kembalikan Default
          </Button>
          {!crossValid && <p className="text-xs font-semibold text-rose-600">Periksa kembali rentang nilai (min ≤ maks, peringatan ≤ masa berlaku).</p>}
        </div>
      </div>

      {/* ---- kolom kanan: uji coba + penerapan ---- */}
      <div className="space-y-4">
        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <FlaskConical className="h-4 w-4 ov-text-accent" /> Uji Coba Sandi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              Coba sebuah kata sandi terhadap <b>draft kebijakan</b> saat ini (belum tersimpan bila ada perubahan).
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Nama pengguna (uji aturan nama)</Label>
              <Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder="cth: Dewi Lestari" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Username (uji aturan username)</Label>
              <Input value={testUsername} onChange={(e) => setTestUsername(e.target.value)} placeholder="cth: dewi.lestari" className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Kata Sandi</Label>
              <PasswordInput value={testPassword} onChange={setTestPassword} />
            </div>
            <PasswordStrengthBar password={testPassword} />
            <PasswordRuleChecklist
              policy={draft}
              password={testPassword}
              username={testUsername || null}
              fullName={testName || null}
            />
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Eye className="h-4 w-4 ov-text-accent" /> Penerapan
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
              <li>• <b>Tambah pengguna</b> — kata sandi awal divalidasi seluruh aturan di atas.</li>
              <li>• <b>Reset kata sandi</b> (admin) &amp; <b>ganti kata sandi</b> (pengguna sendiri) — aturan + riwayat N terakhir.</li>
              <li>• <b>Umur</b> — sisa masa berlaku tampil di tabel Pengguna &amp; peringatan saat masuk.</li>
              <li>• <b>Lockout</b> — diterapkan saat login (policy workspace pertama pengguna).</li>
              <li>• <b>Registrasi workspace baru</b> — memakai kebijakan default.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- kontrol kecil kebijakan ----------

function PolicyNumber({
  label, value, onChange, min, max, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] leading-tight">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min);
        }}
        className="h-9 text-xs font-semibold"
      />
      {suffix && <p className="text-[10px] text-stone-400">{suffix}</p>}
    </div>
  );
}

function PolicySwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2.5 transition hover:ov-border-accent dark:border-stone-800">
      <span className="text-xs font-semibold leading-tight">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
